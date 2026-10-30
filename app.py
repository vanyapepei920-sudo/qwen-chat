"""Scuarfy Store — магазин приложений.
Google-вход, категории, загрузка приложений (админы), скачивание, отзывы и лайки,
рекомендации (по лайкам, скачиваниям и оценкам), поиск.
Секретная страница активации прав администратора: /admin_streaker
"""
import os, re, time, json, uuid, sqlite3, logging, secrets, hashlib
from pathlib import Path
from datetime import timedelta, datetime
from functools import wraps

from dotenv import load_dotenv
from flask import (Flask, render_template, request, jsonify, session,
                   g, redirect, url_for, send_file)
from flask_cors import CORS

try:
    from google.oauth2 import id_token as _g_id_token
    from google.auth.transport import requests as _g_requests
    HAVE_GOOGLE_AUTH = True
except Exception:
    HAVE_GOOGLE_AUTH = False

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

def genv(name, default=""):
    """Настройки читаются из .env / переменных окружения в момент запроса."""
    return os.environ.get(name) or os.getenv(name, default) or default

GOOGLE_CLIENT_ID   = genv("GOOGLE_CLIENT_ID")
SECRET_KEY         = os.getenv("FLASK_SECRET_KEY", secrets.token_urlsafe(32))
DEBUG              = os.getenv("FLASK_DEBUG", "False") == "True"
SESSION_HOURS      = int(os.getenv("SESSION_LIFETIME_HOURS", "24"))
HOST               = os.getenv("HOST", "127.0.0.1")
PORT               = int(os.getenv("PORT", "5000"))
MAX_APP_MB         = int(os.getenv("MAX_APP_SIZE_MB", "300"))

for d in ["assets/css", "assets/img/icons", "assets/js", "instance", "logs",
          "templates", "uploads/apps", "uploads/icons"]:
    (BASE_DIR / d).mkdir(parents=True, exist_ok=True)

DB_PATH  = BASE_DIR / "instance" / "scuarfy.db"
LOG_PATH = BASE_DIR / "logs" / "server.log"
STORE_DIR = BASE_DIR / "uploads"

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    handlers=[logging.FileHandler(LOG_PATH, encoding="utf-8"), logging.StreamHandler()])
log = logging.getLogger("scuarfy")

app = Flask(__name__, template_folder="templates",
            static_folder="assets", static_url_path="/assets")
app.config["SECRET_KEY"] = SECRET_KEY
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=SESSION_HOURS)
app.config["MAX_CONTENT_LENGTH"] = MAX_APP_MB * 1024 * 1024
CORS(app, supports_credentials=True,
     origins=[f"http://{HOST}:{PORT}", "http://localhost:5000", "http://127.0.0.1:5000"])

# ---------------- БД ----------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH); g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(_e):
    db = g.pop("db", None)
    if db: db.close()

def _gen_public_id():
    """Публичный ID приложения: 4hex-6hex-5hex-8hex-8hex (например a3f2-9c1be4-77ab2-1f09dc34-88ae5b21)."""
    h = uuid.uuid4().hex  # 32 hex-символа
    return f"{h[0:4]}-{h[4:10]}-{h[10:15]}-{h[15:23]}-{h[23:31]}"

PID_RE = re.compile(r"^[0-9a-f]{4}-[0-9a-f]{6}-[0-9a-f]{5}-[0-9a-f]{8}-[0-9a-f]{8}$")

def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT, sub TEXT UNIQUE NOT NULL,
        name TEXT, email TEXT, picture TEXT, created_at TEXT, last_login TEXT);
    CREATE TABLE IF NOT EXISTS app_categories(
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
        emoji TEXT DEFAULT '📦', created_at TEXT);
    CREATE TABLE IF NOT EXISTS store_apps(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT UNIQUE NOT NULL DEFAULT '',
        title TEXT NOT NULL, publisher TEXT DEFAULT '',
        description TEXT DEFAULT '', tagline TEXT DEFAULT '', version TEXT DEFAULT '1.0',
        category_id INTEGER, filename TEXT DEFAULT '', orig_name TEXT DEFAULT '',
        icon_path TEXT DEFAULT '', size INTEGER DEFAULT 0, downloads INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0, rating REAL DEFAULT 0, votes INTEGER DEFAULT 0,
        created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS store_admins(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_sub TEXT UNIQUE NOT NULL,
        user_email TEXT DEFAULT '', user_name TEXT DEFAULT '', created_at TEXT);
    CREATE TABLE IF NOT EXISTS app_reviews(
        id INTEGER PRIMARY KEY AUTOINCREMENT, app_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
        stars INTEGER NOT NULL, text TEXT DEFAULT '', created_at TEXT,
        UNIQUE(app_id, user_id));
    CREATE TABLE IF NOT EXISTS app_likes(
        app_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT,
        PRIMARY KEY(app_id, user_id));
    CREATE INDEX IF NOT EXISTS idx_reviews_app ON app_reviews(app_id);
    CREATE INDEX IF NOT EXISTS idx_apps_pid ON store_apps(public_id);
    """)
    db.commit(); db.close()

def _seed_categories():
    try:
        db = get_db()
        if not db.execute("SELECT 1 FROM app_categories LIMIT 1").fetchone():
            now = datetime.now().isoformat(timespec="seconds")
            for nm, em in [("Игры", "🎮"), ("Приложения", "📦"), ("Инструменты", "🛠️"),
                           ("Развлечения", "🎬"), ("Общение", "💬"), ("Работа", "💼")]:
                db.execute("INSERT INTO app_categories(name,emoji,created_at) VALUES(?,?,?)", (nm, em, now))
            db.commit()
    except Exception as e:
        log.warning("seed categories: %s", e)

def _migrate_public_ids():
    """Выдаёт публичные ID всем приложениям без них (старые строки)."""
    try:
        db = get_db()
        rows = db.execute("SELECT id FROM store_apps WHERE public_id='' OR public_id IS NULL").fetchall()
        for r in rows:
            while True:
                pid = _gen_public_id()
                try:
                    db.execute("UPDATE store_apps SET public_id=? WHERE id=?", (pid, r["id"]))
                    break
                except sqlite3.IntegrityError:
                    continue
        if rows:
            db.commit()
            log.info("Миграция: выдано публичных ID %s приложениям", len(rows))
    except Exception as e:
        log.warning("migrate public ids: %s", e)

# ---------------- Google / авторизация ----------------
def verify_google_token(token):
    try:
        if HAVE_GOOGLE_AUTH:
            info = _g_id_token.verify_oauth2_token(
                token, _g_requests.Request(), genv("GOOGLE_CLIENT_ID"))
            return {"sub": str(info.get("sub")), "name": info.get("name", ""),
                    "email": info.get("email", ""), "picture": info.get("picture", "")}
    except Exception as e:
        log.warning("google token: %s", e)
    return None

def _upsert_user(p):
    now = datetime.now().isoformat(timespec="seconds")
    db = get_db()
    row = db.execute("SELECT id FROM users WHERE sub=?", (p["sub"],)).fetchone()
    if row:
        db.execute("UPDATE users SET name=?,email=?,picture=?,last_login=? WHERE sub=?",
                   (p["name"], p["email"], p["picture"], now, p["sub"]))
        uid = row["id"]
    else:
        cur = db.execute("INSERT INTO users(sub,name,email,picture,created_at,last_login) VALUES(?,?,?,?,?,?)",
                   (p["sub"], p["name"], p["email"], p["picture"], now, now))
        uid = cur.lastrowid
    db.commit()
    p["db_id"] = uid
    return p

def login_required(fn):
    @wraps(fn)
    def w(*a, **k):
        if not session.get("user"):
            return jsonify(ok=False, error="not_authenticated"), 401
        return fn(*a, **k)
    return w

def login_required_html(fn):
    @wraps(fn)
    def w(*a, **k):
        if not session.get("user"):
            return redirect(url_for("login"))
        return fn(*a, **k)
    return w

# ---------------- Права администратора (admin_streaker) ----------------
def _hash_pwd(p): return hashlib.sha256(("scuarfy-store::" + p).encode("utf-8")).hexdigest()

def store_admin_password():
    """Пароль активации админки: ADMIN_PASSWORD из .env либо хеш в settings."""
    envp = os.environ.get("ADMIN_PASSWORD") or ""
    if envp: return envp
    try:
        r = get_db().execute("SELECT value FROM settings WHERE key='admin_pass_hash'").fetchone()
        return ("__hashed__:" + r["value"]) if r else None
    except Exception:
        return None

def admin_panel_enabled():
    return bool(store_admin_password())

def is_admin():
    u = session.get("user") or {}
    if not session.get("store_admin"): return False
    sub = u.get("sub")
    if not sub: return False
    try:
        r = get_db().execute("SELECT email FROM users WHERE sub=?", (sub,)).fetchone()
        email = (r["email"] if r else "") or ""
        rows = get_db().execute("SELECT user_email FROM store_admins WHERE user_sub=?", (sub,)).fetchall()
    except Exception:
        return False
    return any((a["user_email"] or "").lower() == email.lower() for a in rows)

def admin_required(fn):
    @wraps(fn)
    def w(*a, **k):
        if not session.get("user"):
            return jsonify(ok=False, error="not_authenticated"), 401
        if not is_admin():
            return jsonify(ok=False, error="not_admin"), 403
        return fn(*a, **k)
    return w

def admin_required_html(fn):
    @wraps(fn)
    def w(*a, **k):
        if not session.get("user"):
            return redirect(url_for("login"))
        if not is_admin():
            return render_template("403.html", user=session["user"], page="store-admin"), 403
        return fn(*a, **k)
    return w

# ---------------- Вспомогательные функции магазина ----------------
def _safe_name(fn):
    fn = re.sub(r"[^\w.\-]+", "_", os.path.basename(fn or ""), flags=re.U)
    return fn[:120] or "file.bin"

def _fmt_size(n):
    n = float(n or 0)
    for unit in ["Б", "КБ", "МБ", "ГБ"]:
        if n < 1024: return f"{n:.0f} {unit}" if unit == "Б" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} ТБ"

def _recalc_rating(db, app_id):
    r = db.execute("SELECT AVG(stars) a, COUNT(*) c FROM app_reviews WHERE app_id=?", (app_id,)).fetchone()
    db.execute("UPDATE store_apps SET rating=COALESCE(?,0), votes=? WHERE id=?",
               (round(r["a"], 2) if r["a"] else 0, r["c"], app_id))

def _sync_likes(db, app_id):
    c = db.execute("SELECT COUNT(*) c FROM app_likes WHERE app_id=?", (app_id,)).fetchone()["c"]
    db.execute("UPDATE store_apps SET likes=? WHERE id=?", (c, app_id))

def _app_row_to_dict(r):
    d = dict(r)
    d["size_h"] = _fmt_size(d.get("size"))
    return d

def _find_app(pid_or_id):
    """Находит приложение по публичному ID (строка) или внутреннему числовому id."""
    db = get_db()
    s = str(pid_or_id or "")
    if PID_RE.match(s):
        return db.execute("""SELECT a.*, c.name AS category_name, c.emoji AS category_emoji
                             FROM store_apps a LEFT JOIN app_categories c ON c.id=a.category_id
                             WHERE a.public_id=?""", (s,)).fetchone()
    if s.isdigit():
        return db.execute("""SELECT a.*, c.name AS category_name, c.emoji AS category_emoji
                             FROM store_apps a LEFT JOIN app_categories c ON c.id=a.category_id
                             WHERE a.id=?""", (int(s),)).fetchone()
    return None

def _store_apps_query(cat_name=None, cat_id=None, q="", sort="popular", limit=None,
                      exclude_id=None, liked_by=None):
    """Список приложений с фильтром по категории/поиску/сортировке.
    sort=recommended — рекомендации: много лайков + скачиваний + хорошие отзывы."""
    order = {
        "popular":    "a.downloads DESC",
        "new":        "a.created_at DESC",
        "rating":     "a.rating DESC, a.votes DESC",
        "name":       "LOWER(a.title) ASC",
        # рейтинг рекомендаций: взвешенная сумма лайков, скачиваний и отзывов
        "recommended":"(a.likes*3 + MIN(a.downloads,500)/5 + a.rating*a.votes) DESC, a.likes DESC",
    }
    sql = """SELECT a.*, c.name AS category_name, c.emoji AS category_emoji"""
    if liked_by is not None:
        sql += ", COALESCE(l.user_id IS NOT NULL, 0) AS liked"
    sql += """ FROM store_apps a LEFT JOIN app_categories c ON c.id=a.category_id"""
    if liked_by is not None:
        sql += " LEFT JOIN app_likes l ON l.app_id=a.id AND l.user_id=?"
    sql += " WHERE 1=1"
    args = []
    if liked_by is not None: args.append(liked_by)
    if cat_id is not None: sql += " AND c.id=?"; args.append(cat_id)
    if cat_name:           sql += " AND c.name=?"; args.append(cat_name)
    if q:
        sql += (" AND (LOWER(a.title) LIKE ? OR LOWER(a.publisher) LIKE ? "
                "OR LOWER(a.description) LIKE ? OR LOWER(a.tagline) LIKE ?)")
        args += [f"%{q.lower()}%"] * 4
    if exclude_id: sql += " AND a.id<>?"; args.append(exclude_id)
    sql += " ORDER BY " + order.get(sort, order["popular"])
    if limit: sql += f" LIMIT {int(limit)}"
    try:
        rows = get_db().execute(sql, args).fetchall()
    except Exception as e:
        log.warning("apps query: %s", e)
        rows = []
    return [_app_row_to_dict(r) for r in rows]

def _get_category(cid):
    r = get_db().execute("SELECT * FROM app_categories WHERE id=?", (cid,)).fetchone()
    return dict(r) if r else None

def _uid():
    return (session.get("user") or {}).get("db_id")

# ---------------- Страницы ----------------
@app.route("/")
def root():
    return redirect(url_for("store") if session.get("user") else url_for("login"))

@app.route("/login")
def login():
    if session.get("user"): return redirect(url_for("store"))
    return render_template("login.html", google_client_id=genv("GOOGLE_CLIENT_ID"), page="login")

@app.route("/register")
def register():
    if session.get("user"): return redirect(url_for("store"))
    return render_template("register.html", google_client_id=genv("GOOGLE_CLIENT_ID"), page="register")

@app.route("/store")
@login_required_html
def store():
    """Главная магазина: поиск, категории, рекомендации, все приложения."""
    db = get_db()
    cats = [dict(r) for r in db.execute("SELECT * FROM app_categories ORDER BY name").fetchall()]
    counts = {r["cid"]: r["c"] for r in db.execute(
        "SELECT category_id AS cid, COUNT(*) AS c FROM store_apps WHERE category_id IS NOT NULL GROUP BY category_id").fetchall()}
    uid = _uid()
    recs = _store_apps_query(sort="recommended", limit=8, liked_by=uid)
    apps = _store_apps_query(sort="popular", liked_by=uid)
    return render_template("store.html", user=session["user"], page="store",
                           cats=cats, cat_counts=counts, apps=apps, recs=recs,
                           is_admin_flag=is_admin(), admin_enabled=admin_panel_enabled())

@app.route("/store/category/<int:cid>")
@login_required_html
def store_category(cid):
    """Отдельная страница категории."""
    cat = _get_category(cid)
    if not cat: return _json_err_page(404)
    sort = request.args.get("sort") or "popular"
    q = (request.args.get("q") or "").strip()
    apps = _store_apps_query(cat_id=cid, q=q, sort=sort, liked_by=_uid())
    db = get_db()
    related = [dict(r) for r in db.execute("SELECT * FROM app_categories WHERE id<>? ORDER BY name", (cid,)).fetchall()]
    return render_template("store_category.html", user=session["user"], page="store",
                           cat=cat, apps=apps, sort=sort, q=q, related=related,
                           is_admin_flag=is_admin())

@app.route("/store/app/<pid>")
@login_required_html
def store_app(pid):
    """Отдельная страница приложения (по публичному ID вида xxxx-xxxxxx-xxxxx-xxxxxxxx-xxxxxxxx)."""
    r = _find_app(pid)
    if not r: return _json_err_page(404)
    aid = r["id"]
    db = get_db()
    reviews = [dict(x) for x in db.execute(
        """SELECT rv.*, u.name AS uname, u.picture AS upic FROM app_reviews rv
           LEFT JOIN users u ON u.id=rv.user_id WHERE rv.app_id=? ORDER BY rv.created_at DESC""",
        (aid,)).fetchall()]
    my = None
    uid = _uid()
    if uid:
        m = db.execute("SELECT stars, text FROM app_reviews WHERE app_id=? AND user_id=?", (aid, uid)).fetchone()
        my = dict(m) if m else None
        liked = db.execute("SELECT 1 FROM app_likes WHERE app_id=? AND user_id=?", (aid, uid)).fetchone()
    else:
        liked = None
    similar = _store_apps_query(cat_id=r["category_id"], limit=8, exclude_id=aid) if r["category_id"] else []
    if len(similar) < 6:
        extra = _store_apps_query(limit=8, exclude_id=aid, sort="recommended")
        seen = {a["id"] for a in similar}
        similar += [a for a in extra if a["id"] not in seen]
    similar = similar[:6]
    return render_template("store_app.html", user=session["user"], page="store",
                           app=_app_row_to_dict(r), reviews=reviews, my_review=my,
                           liked=bool(liked), similar=similar, is_admin_flag=is_admin())

@app.route("/admin_streaker")
@login_required_html
def admin_streaker():
    """Секретная страница активации прав администратора (доступна только по прямой ссылке)."""
    return render_template("admin_streaker.html", user=session["user"], page="admin_streaker",
                           enabled=admin_panel_enabled(), already=is_admin())

@app.route("/store-admin")
@admin_required_html
def store_admin():
    db = get_db()
    cats = [dict(r) for r in db.execute("SELECT * FROM app_categories ORDER BY name").fetchall()]
    apps = [_app_row_to_dict(r) for r in db.execute(
        """SELECT a.*, c.name AS category_name FROM store_apps a
           LEFT JOIN app_categories c ON c.id=a.category_id ORDER BY a.created_at DESC""").fetchall()]
    admins = [dict(r) for r in db.execute("SELECT * FROM store_admins ORDER BY created_at").fetchall()]
    return render_template("store_admin.html", user=session["user"], page="store-admin",
                           cats=cats, apps=apps, admins=admins, max_mb=MAX_APP_MB)

# ---------------- API: авторизация ----------------
@app.route("/api/auth/google", methods=["POST"])
def auth_google():
    body = request.get_json(silent=True) or {}
    cred = body.get("credential")
    if not cred: return jsonify(ok=False, error="missing_credential"), 400
    p = verify_google_token(cred)
    if not p: return jsonify(ok=False, error="invalid_token"), 401
    p = _upsert_user(p)
    session.permanent = True; session["user"] = p
    log.info("Вход: %s <%s>", p.get("name"), p.get("email"))
    return jsonify(ok=True, user=p)

@app.route("/api/me")
def me():
    u = session.get("user")
    if not u: return jsonify(ok=False, error="not_authenticated"), 401
    return jsonify(ok=True, user=u)

@app.route("/api/auth/demo", methods=["POST"])
def auth_demo():
    """Демо-вход (для тестирования без Google OAuth)."""
    if not genv("DEMO_LOGIN", "True").lower() in ("1", "true", "yes"):
        return jsonify(ok=False, error="disabled"), 403
    p = _upsert_user({"name": "Гость Демо", "email": "demo@scuarfy.app", "picture": "", "sub": "demo"})
    session.permanent = True; session["user"] = p
    return jsonify(ok=True, user=p)

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify(ok=True)

# ---------------- API: права администратора ----------------
@app.route("/api/store/activate", methods=["POST"])
@login_required
def store_activate():
    d = request.get_json(silent=True) or {}
    pwd = str(d.get("password") or "")
    stored = store_admin_password()
    first_time = False
    if not stored:
        if len(pwd) < 4:
            return jsonify(ok=False, error="too_short"), 400
        get_db().execute("INSERT OR REPLACE INTO settings(key,value) VALUES('admin_pass_hash',?)",
                         (_hash_pwd(pwd),))
        get_db().commit()
        stored = "__hashed__:" + _hash_pwd(pwd)
        first_time = True
    ok = (pwd == stored) if not stored.startswith("__hashed__:") \
         else (_hash_pwd(pwd) == stored.split(":", 1)[1])
    if not ok:
        time.sleep(0.6)  # замедляем перебор паролей
        return jsonify(ok=False, error="wrong_password"), 403
    u = session["user"]
    now = datetime.now().isoformat(timespec="seconds")
    get_db().execute("""INSERT INTO store_admins(user_sub,user_email,user_name,created_at)
                        VALUES(?,?,?,?)
                        ON CONFLICT(user_sub) DO UPDATE SET user_email=excluded.user_email,
                        user_name=excluded.user_name""",
                     (u.get("sub"), u.get("email") or "", u.get("name") or "", now))
    get_db().commit()
    session["store_admin"] = True
    log.info("Admin activated for %s%s", u.get("email") or u.get("sub"),
             " (first-time setup)" if first_time else "")
    return jsonify(ok=True, redirect="/store-admin", first_time=first_time)

@app.route("/api/store/deactivate", methods=["POST"])
@login_required
def store_deactivate():
    session.pop("store_admin", None)
    return jsonify(ok=True)

# ---------------- API: категории ----------------
@app.route("/api/store/categories", methods=["GET"])
def store_cats_list():
    rows = get_db().execute("SELECT * FROM app_categories ORDER BY name").fetchall()
    return jsonify(ok=True, items=[dict(r) for r in rows])

@app.route("/api/store/categories", methods=["POST"])
@admin_required
def store_cats_add():
    d = request.get_json(silent=True) or {}
    name = str(d.get("name") or "").strip()[:60]
    emoji = str(d.get("emoji") or "📦").strip()[:4] or "📦"
    if not name: return jsonify(ok=False, error="empty_name"), 400
    db = get_db()
    if db.execute("SELECT 1 FROM app_categories WHERE LOWER(name)=?", (name.lower(),)).fetchone():
        return jsonify(ok=False, error="already_exists"), 409
    now = datetime.now().isoformat(timespec="seconds")
    cur = db.execute("INSERT INTO app_categories(name,emoji,created_at) VALUES(?,?,?)", (name, emoji, now))
    db.commit()
    return jsonify(ok=True, id=cur.lastrowid)

@app.route("/api/store/categories/<int:cid>", methods=["PUT"])
@admin_required
def store_cats_upd(cid):
    d = request.get_json(silent=True) or {}
    name = str(d.get("name") or "").strip()[:60]
    emoji = str(d.get("emoji") or "📦").strip()[:4] or "📦"
    db = get_db()
    if not db.execute("SELECT 1 FROM app_categories WHERE id=?", (cid,)).fetchone():
        return jsonify(ok=False, error="not_found"), 404
    dup = db.execute("SELECT 1 FROM app_categories WHERE LOWER(name)=? AND id<>?", (name.lower(), cid)).fetchone()
    if dup: return jsonify(ok=False, error="already_exists"), 409
    db.execute("UPDATE app_categories SET name=?, emoji=? WHERE id=?", (name, emoji, cid))
    db.commit()
    return jsonify(ok=True)

@app.route("/api/store/categories/<int:cid>", methods=["DELETE"])
@admin_required
def store_cats_del(cid):
    db = get_db()
    db.execute("UPDATE store_apps SET category_id=NULL WHERE category_id=?", (cid,))
    db.execute("DELETE FROM app_categories WHERE id=?", (cid,))
    db.commit()
    return jsonify(ok=True)

# ---------------- API: приложения (чтение) ----------------
@app.route("/api/store/apps")
@login_required
def store_apps_list():
    q = (request.args.get("q") or "").strip().lower()
    cat = request.args.get("category") or ""
    sort = request.args.get("sort") or "popular"
    items = _store_apps_query(cat_name=(cat if cat not in ("all", "none") else None),
                              q=q, sort=sort, liked_by=_uid())
    return jsonify(ok=True, items=items)

@app.route("/api/store/recommended")
@login_required
def store_recommended():
    """Рекомендации: приложения с наибольшим числом лайков, скачиваний и хорошими отзывами."""
    limit = min(int(request.args.get("limit") or 8), 24)
    items = _store_apps_query(sort="recommended", limit=limit, liked_by=_uid())
    return jsonify(ok=True, items=items)

@app.route("/api/store/apps/<pid>")
@login_required
def store_app_get(pid):
    r = _find_app(pid)
    if not r: return jsonify(ok=False, error="not_found"), 404
    return jsonify(ok=True, app=_app_row_to_dict(r))

@app.route("/api/store/apps/<pid>/download", methods=["GET", "POST"])
@login_required
def store_app_download(pid):
    """Кнопка «Скачать» на любой странице ведёт сюда — браузер скачивает файл напрямую."""
    r = _find_app(pid)
    if not r: return jsonify(ok=False, error="not_found"), 404
    if not r["filename"]: return jsonify(ok=False, error="no_file"), 404
    p = STORE_DIR / "apps" / r["filename"]
    if not p.is_file(): return jsonify(ok=False, error="file_missing"), 404
    db = get_db()
    db.execute("UPDATE store_apps SET downloads=downloads+1 WHERE id=?", (r["id"],)); db.commit()
    return send_file(p, as_attachment=True, download_name=r["orig_name"] or p.name)

# ---------------- API: лайки ----------------
@app.route("/api/store/apps/<pid>/like", methods=["POST"])
@login_required
def store_app_like(pid):
    r = _find_app(pid)
    if not r: return jsonify(ok=False, error="not_found"), 404
    uid = _uid()
    if not uid: return jsonify(ok=False, error="no_account"), 400
    db = get_db()
    had = db.execute("SELECT 1 FROM app_likes WHERE app_id=? AND user_id=?", (r["id"], uid)).fetchone()
    if had:
        db.execute("DELETE FROM app_likes WHERE app_id=? AND user_id=?", (r["id"], uid))
    else:
        db.execute("INSERT INTO app_likes(app_id,user_id,created_at) VALUES(?,?,?)",
                   (r["id"], uid, datetime.now().isoformat(timespec="seconds")))
    _sync_likes(db, r["id"]); db.commit()
    cnt = db.execute("SELECT likes FROM store_apps WHERE id=?", (r["id"],)).fetchone()["likes"]
    return jsonify(ok=True, liked=not had, likes=cnt)

# ---------------- API: отзывы ----------------
@app.route("/api/store/reviews", methods=["POST"])
@login_required
def store_review_add():
    d = request.get_json(silent=True) or {}
    r = _find_app(d.get("app_id"))
    if not r: return jsonify(ok=False, error="not_found"), 404
    aid = r["id"]
    try: stars = max(1, min(5, int(d.get("stars") or 0)))
    except Exception: return jsonify(ok=False, error="bad_stars"), 400
    text = str(d.get("text") or "").strip()[:1000]
    uid = _uid()
    if not uid: return jsonify(ok=False, error="no_account"), 400
    db = get_db()
    now = datetime.now().isoformat(timespec="seconds")
    db.execute("""INSERT INTO app_reviews(app_id,user_id,stars,text,created_at) VALUES(?,?,?,?,?)
                  ON CONFLICT(app_id,user_id) DO UPDATE SET stars=excluded.stars, text=excluded.text""",
               (aid, uid, stars, text, now))
    _recalc_rating(db, aid); db.commit()
    return jsonify(ok=True)

# ---------------- API: админ (загрузка/редактирование) ----------------
@app.route("/api/store/admin/apps", methods=["POST"])
@admin_required
def store_admin_upload():
    title = (request.form.get("title") or "").strip()[:120]
    if not title: return jsonify(ok=False, error="empty_title"), 400
    f = request.files.get("file")
    if not f or not f.filename: return jsonify(ok=False, error="no_file"), 400
    safe = f"{uuid.uuid4().hex[:10]}_{_safe_name(f.filename)}"
    dest = STORE_DIR / "apps" / safe
    f.save(dest)
    size = dest.stat().st_size
    icon_path = ""
    fi = request.files.get("icon")
    if fi and fi.filename:
        ext = os.path.splitext(fi.filename)[1].lower()
        if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"):
            icon_path = "/assets/img/icons/" + uuid.uuid4().hex[:10] + ext
            fi.save(BASE_DIR / icon_path.lstrip("/"))
    try: cid = int(request.form.get("category_id") or 0) or None
    except Exception: cid = None
    now = datetime.now().isoformat(timespec="seconds")
    db = get_db()
    while True:
        pid = _gen_public_id()
        if not db.execute("SELECT 1 FROM store_apps WHERE public_id=?", (pid,)).fetchone(): break
    cur = db.execute(
        """INSERT INTO store_apps(public_id,title,publisher,description,tagline,version,category_id,
           filename,orig_name,icon_path,size,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (pid, title, (request.form.get("publisher") or "").strip()[:80],
         (request.form.get("description") or "").strip()[:5000],
         (request.form.get("tagline") or "").strip()[:200],
         (request.form.get("version") or "1.0").strip()[:30], cid, safe,
         _safe_name(f.filename), icon_path, size, now, now))
    db.commit()
    log.info("Store: uploaded app %s '%s' (%s)", pid, title, _fmt_size(size))
    return jsonify(ok=True, id=cur.lastrowid, public_id=pid)

@app.route("/api/store/admin/apps/<int:aid>", methods=["PUT"])
@admin_required
def store_admin_update(aid):
    d = request.get_json(silent=True) or {}
    fields, vals = [], []
    for k in ("title", "publisher", "description", "tagline", "version"):
        if k in d: fields.append(f"{k}=?"); vals.append(str(d[k]).strip()[:5000])
    if "category_id" in d:
        fields.append("category_id=?"); vals.append(int(d["category_id"] or 0) or None)
    if not fields: return jsonify(ok=False, error="nothing_to_update"), 400
    fields.append("updated_at=?"); vals.append(datetime.now().isoformat(timespec="seconds"))
    db = get_db()
    db.execute(f"UPDATE store_apps SET {', '.join(fields)} WHERE id=?", (*vals, aid))
    if d.get("clear_file"):
        r = db.execute("SELECT filename FROM store_apps WHERE id=?", (aid,)).fetchone()
        if r and r["filename"]:
            try: (STORE_DIR / "apps" / r["filename"]).unlink(missing_ok=True)
            except Exception: pass
        db.execute("UPDATE store_apps SET filename='', orig_name='', size=0 WHERE id=?", (aid,))
    db.commit()
    return jsonify(ok=True)

@app.route("/api/store/admin/apps/<int:aid>/file", methods=["POST"])
@admin_required
def store_admin_replace_file(aid):
    db = get_db()
    r = db.execute("SELECT * FROM store_apps WHERE id=?", (aid,)).fetchone()
    if not r: return jsonify(ok=False, error="not_found"), 404
    f = request.files.get("file")
    if not f or not f.filename: return jsonify(ok=False, error="no_file"), 400
    safe = f"{uuid.uuid4().hex[:10]}_{_safe_name(f.filename)}"
    dest = STORE_DIR / "apps" / safe
    f.save(dest)
    if r["filename"]:
        try: (STORE_DIR / "apps" / r["filename"]).unlink(missing_ok=True)
        except Exception: pass
    db.execute("UPDATE store_apps SET filename=?, orig_name=?, size=?, updated_at=? WHERE id=?",
               (safe, _safe_name(f.filename), dest.stat().st_size,
                datetime.now().isoformat(timespec="seconds"), aid))
    db.commit()
    return jsonify(ok=True)

@app.route("/api/store/admin/apps/<int:aid>", methods=["DELETE"])
@admin_required
def store_admin_delete(aid):
    db = get_db()
    r = db.execute("SELECT * FROM store_apps WHERE id=?", (aid,)).fetchone()
    if not r: return jsonify(ok=False, error="not_found"), 404
    if r["filename"]:
        try: (STORE_DIR / "apps" / r["filename"]).unlink(missing_ok=True)
        except Exception: pass
    if r["icon_path"]:
        try: (BASE_DIR / r["icon_path"].lstrip("/")).unlink(missing_ok=True)
        except Exception: pass
    db.execute("DELETE FROM app_reviews WHERE app_id=?", (aid,))
    db.execute("DELETE FROM app_likes WHERE app_id=?", (aid,))
    db.execute("DELETE FROM store_apps WHERE id=?", (aid,))
    db.commit()
    return jsonify(ok=True)

@app.route("/api/store/admin/admins")
@admin_required
def store_admin_list():
    rows = get_db().execute("SELECT * FROM store_admins ORDER BY created_at").fetchall()
    return jsonify(ok=True, items=[dict(r) for r in rows])

@app.route("/api/store/admin/admins", methods=["POST"])
@admin_required
def store_admin_grant():
    d = request.get_json(silent=True) or {}
    email = str(d.get("email") or "").strip().lower()
    if not email: return jsonify(ok=False, error="empty_email"), 400
    u = get_db().execute("SELECT sub,name FROM users WHERE LOWER(email)=?", (email,)).fetchone()
    if not u: return jsonify(ok=False, error="user_not_found"), 404
    now = datetime.now().isoformat(timespec="seconds")
    get_db().execute("""INSERT INTO store_admins(user_sub,user_email,user_name,created_at)
                        VALUES(?,?,?,?) ON CONFLICT(user_sub) DO UPDATE SET user_email=excluded.user_email""",
                     (u["sub"], email, u["name"] or "", now))
    get_db().commit()
    return jsonify(ok=True)

@app.route("/api/store/admin/admins/<int:aid>", methods=["DELETE"])
@admin_required
def store_admin_revoke(aid):
    me_sub = (session.get("user") or {}).get("sub")
    row = get_db().execute("SELECT user_sub FROM store_admins WHERE id=?", (aid,)).fetchone()
    if not row: return jsonify(ok=False, error="not_found"), 404
    if row["user_sub"] == me_sub:
        return jsonify(ok=False, error="cannot_revoke_self"), 400
    get_db().execute("DELETE FROM store_admins WHERE id=?", (aid,))
    get_db().commit()
    return jsonify(ok=True)

# ---------------- Ошибки ----------------
@app.errorhandler(403)
def e403(_e): return _json_err_page(403)
@app.errorhandler(404)
def e404(_e): return _json_err_page(404)
@app.errorhandler(500)
def e500(_e): return _json_err_page(500)

def _json_err_page(code):
    if request.path.startswith("/api/"):
        msg = {403: "Forbidden", 404: "Not found", 500: "Internal server error"}[code]
        return jsonify(ok=False, error="server_error" if code == 500 else "not_found",
                       code=code, message=msg), code
    tpl = {403: "403.html", 404: "404.html", 500: "500.html"}[code]
    try:
        return render_template(tpl, user=session.get("user")), code
    except Exception:
        return jsonify(ok=False, code=code), code

# ---------------- старт ----------------
init_db()
with app.app_context():
    _seed_categories()
    _migrate_public_ids()

if __name__ == "__main__":
    log.info("Scuarfy Store: http://%s:%s | google_auth=%s", HOST, PORT, HAVE_GOOGLE_AUTH)
    app.run(host=HOST, port=PORT, debug=DEBUG)
