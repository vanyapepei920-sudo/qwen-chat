"""Scuarfy Store — магазин приложений.
Google-вход, категории, загрузка приложений (админы), скачивание, отзывы и лайки,
рекомендации (по лайкам, скачиваниям и оценкам), поиск.
Секретная страница активации прав администратора: /admin_streaker
"""
import os, sys, re, time, json, uuid, sqlite3, logging, secrets, hashlib, base64, threading
from pathlib import Path
from datetime import timedelta, datetime
from functools import wraps

import requests
from dotenv import load_dotenv
from flask import (Flask, render_template, request, jsonify, session,
                   g, redirect, url_for, send_file, abort)
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
SECRET_KEY         = os.getenv("FLASK_SECRET_KEY") or ""
if not SECRET_KEY:
    SECRET_KEY = secrets.token_urlsafe(32)
    print("[!] FLASK_SECRET_KEY не задан — сгенерирован временный ключ "
          "(сессии сбросятся после перезапуска; задайте его в .env)", file=sys.stderr)
DEBUG              = os.getenv("FLASK_DEBUG", "False") == "True"
SESSION_HOURS      = int(os.getenv("SESSION_LIFETIME_HOURS", "24"))
HOST               = os.getenv("HOST", "127.0.0.1")
PORT               = int(os.getenv("PORT", "5000"))
MAX_APP_GB         = int(genv("MAX_APP_SIZE_GB", "80"))   # максимальный размер файла приложения

for d in ["assets/css", "assets/img/icons", "assets/img/brands", "assets/js", "instance", "logs",
          "templates", "uploads/apps", "uploads/icons", "uploads/brands",
          "uploads/requests", "uploads/chats"]:
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


@app.before_request
def _inject_user():
    """session['user'] доступен в шаблонах как current_user (user передаётся явно)."""
    g.current_user = session.get("user")

@app.context_processor
def inject_globals():
    return {"google_client_id": genv("GOOGLE_CLIENT_ID")}
app.config["SECRET_KEY"] = SECRET_KEY
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=SESSION_HOURS)
# ~85 ГБ с запасом: лимит тела запроса чуть больше пользовательского лимита 80 ГБ,
# чтобы точный ответ «файл больше 80 ГБ» отдавала наша проверка, а не Flask.
app.config["MAX_CONTENT_LENGTH"] = int(MAX_APP_GB * 1.06 * 1024**3)
_cors_origins = [f"http://{HOST}:{PORT}", f"https://{HOST}:{PORT}",
                 "http://localhost:5000", "http://127.0.0.1:5000",
                 f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"]
for _o in (genv("ALLOWED_ORIGINS") or "").split(","):
    _o = _o.strip().rstrip("/")
    if _o and _o not in _cors_origins:
        _cors_origins.append(_o)
CORS(app, supports_credentials=True, origins=_cors_origins)

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
    """Публичный ID приложения: 4hex-6hex-5hex-8hex-9hex (используются все 32 hex-символа UUID)."""
    h = uuid.uuid4().hex  # 32 hex-символа
    return f"{h[0:4]}-{h[4:10]}-{h[10:15]}-{h[15:23]}-{h[23:32]}"

PID_RE = re.compile(r"^[0-9a-f]{4}-[0-9a-f]{6}-[0-9a-f]{5}-[0-9a-f]{8}-[0-9a-f]{9}$")

# разрешённые расширения изображений (иконки/логотипы) — определяются по сигнатуре файла
IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"}

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
        brand_logo TEXT DEFAULT '', org_request_id INTEGER,
        created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS org_requests(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL DEFAULT '',
        first_name TEXT NOT NULL, last_name TEXT NOT NULL,
        org_name TEXT NOT NULL, org_type TEXT DEFAULT 'organization',
        email TEXT NOT NULL, phone TEXT DEFAULT '', country TEXT DEFAULT '',
        website TEXT DEFAULT '', app_name TEXT DEFAULT '', app_desc TEXT DEFAULT '',
        message TEXT DEFAULT '', logo_path TEXT DEFAULT '', pdf_path TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        user_sub TEXT DEFAULT '', user_email TEXT DEFAULT '', user_name TEXT DEFAULT '',
        admin_note TEXT DEFAULT '', decided_by TEXT DEFAULT '', decided_at TEXT DEFAULT '',
        created_at TEXT);
    CREATE TABLE IF NOT EXISTS ai_messages(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_sub TEXT NOT NULL,
        role TEXT NOT NULL, text TEXT DEFAULT '', created_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_ai_sub ON ai_messages(user_sub, id);
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

def _migrate_columns():
    """Добавляет недостающие колонки в старые БД (idempotent)."""
    db = get_db()
    def cols(table):
        return {r["name"] for r in db.execute(f"PRAGMA table_info({table})").fetchall()}
    scols = cols("store_apps")
    for col, decl in [("brand_logo", "TEXT DEFAULT ''"), ("org_request_id", "INTEGER")]:
        if col not in scols:
            db.execute(f"ALTER TABLE store_apps ADD COLUMN {col} {decl}")
    orcols = cols("org_requests")
    for col, decl in [("uuid", "TEXT UNIQUE DEFAULT ''"), ("admin_note", "TEXT DEFAULT ''"),
                      ("decided_by", "TEXT DEFAULT ''"), ("decided_at", "TEXT DEFAULT ''")]:
        if col not in orcols:
            try:
                db.execute(f"ALTER TABLE org_requests ADD COLUMN {col} {decl}")
            except sqlite3.OperationalError:
                pass  # UNIQUE через ALTER не поддерживается — uuid заполняется при вставке
    db.commit()

# ---------------- Google / авторизация ----------------
def _profile_from_payload(payload):
    """Извлечение профиля из проверенных claims ID-токена."""
    if not payload.get("email") and not payload.get("sub"):
        return None
    return {"sub": str(payload.get("sub")), "name": payload.get("name", ""),
            "email": payload.get("email", ""), "picture": payload.get("picture", "")}

def _jwt_decode_unverified(token):
    """Раскодировать JWT без проверки подписи (для диагностики и claims)."""
    parts = token.split(".")
    if len(parts) < 2: raise ValueError("не JWT: мало сегментов")
    def b64(s): return json.loads(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)))
    return b64(parts[0]), b64(parts[1])

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
_certs_cache = {"ts": 0, "certs": None}

def _google_certs():
    """Публичные ключи Google (кэшируются на 1 час)."""
    if _certs_cache["certs"] and time.time() - _certs_cache["ts"] < 3600:
        return _certs_cache["certs"]
    r = requests.get(GOOGLE_CERTS_URL, timeout=10); r.raise_for_status()
    certs = {c["kid"]: c for c in r.json().get("keys", [])}
    _certs_cache.update(ts=time.time(), certs=certs)
    return certs

# ---------- Чистый RSA-PKCS1-v1_5 верификатор без cryptography/google-auth ----------
# Нужен для Termux/Android, где сборка cryptography (Rust) часто невозможна.
_B64URL_PAD = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def _rsa_verify_pkcs1_sha256(n: int, e: int, message: bytes, sig: bytes) -> bool:
    """Проверка подписи RSA PKCS#1 v1.5 (SHA-256) на чистом Python."""
    k = (n.bit_length() + 7) // 8
    if len(sig) != k or k < 64:
        return False
    s = pow(int.from_bytes(sig, "big"), e, n)
    em = s.to_bytes(k, "big")
    digest = hashlib.sha256(message).digest()
    # EMSA-PKCS1-v1_5: 0x00 0x01 <PS: 0xFF...> 0x00 || DigestInfo(SHA-256)
    digest_info = (b"\x30\x31\x30\x0d\x06\x09\x60\x86\x48\x01\x65\x03\x04\x02\x01"
                   b"\x05\x00\x04\x20") + digest
    ff_len = k - 3 - len(digest_info)
    if ff_len < 8:
        return False
    expected = b"\x00\x01" + b"\xff" * ff_len + b"\x00" + digest_info
    return em == expected

def _verify_google_sig_purepy(token, cid):
    """Верификация ID-токена Google без сторонних криптобиблиотек.
    Возвращает профиль либо None; бросает исключение только при сетевых сбоях."""
    parts = token.split(".")
    if len(parts) != 3:
        log.warning("google verify (pure-python): некорректная структура JWT"); return None
    try:
        header = json.loads(_B64URL_PAD(parts[0]))
        payload = json.loads(_B64URL_PAD(parts[1]))
    except Exception:
        log.warning("google verify (pure-python): не удалось декодировать JWT"); return None
    if header.get("alg") != "RS256":
        log.warning("google verify (pure-python): неподдерживаемый alg=%s", header.get("alg"))
        return None
    aud = payload.get("aud")
    aud_set = {aud} if isinstance(aud, str) else set(aud or [])
    if payload.get("iss") not in ("https://accounts.google.com", "accounts.google.com"):
        log.warning("google verify (pure-python): неверный iss=%s", payload.get("iss")); return None
    if cid not in aud_set:
        log.warning("google verify (pure-python): audience=%s не совпадает с GOOGLE_CLIENT_ID", aud); return None
    try:
        exp_ts = int(payload.get("exp", 0))
    except (TypeError, ValueError):
        exp_ts = 0
    if exp_ts < time.time() - 300:  # skew ±5 минут как у google-auth
        log.warning("google verify (pure-python): срок токена истёк"); return None
    certs = _google_certs()
    jwk = certs.get(header.get("kid"))
    if not jwk:
        _certs_cache["ts"] = 0  # ключи могли ротироваться — сбрасываем кэш и пробуем ещё раз
        certs = _google_certs()
        jwk = certs.get(header.get("kid"))
    if not jwk:
        log.warning("google verify (pure-python): kid=%s не найден в JWKS", header.get("kid")); return None
    n = int.from_bytes(_B64URL_PAD(jwk["n"]), "big")
    e = int.from_bytes(_B64URL_PAD(jwk["e"]), "big")
    signing_input = ".".join(parts[:2]).encode()
    sig = _B64URL_PAD(parts[2])
    if not _rsa_verify_pkcs1_sha256(n, e, signing_input, sig):
        log.warning("google verify (pure-python): подпись не прошла проверку"); return None
    log.info("google verify: токен принят через pure-python RS256 (без cryptography/google-auth)")
    return _profile_from_payload(payload)

def _verify_google_tokeninfo(token, cid):
    """Фолбэк через эндпоинт tokeninfo (подпись проверяет сам Google)."""
    try:
        r = requests.get(f"{GOOGLE_TOKENINFO_URL}?id_token={token}", timeout=10)
        if r.status_code != 200:
            log.warning("google verify (tokeninfo): HTTP %s", r.status_code); return None
        data = r.json()
        aud = data.get("aud")
        aud_set = {aud} if isinstance(aud, str) else set(aud or [])
        if data.get("iss") not in ("https://accounts.google.com", "accounts.google.com"):
            log.warning("google verify (tokeninfo): неверный iss=%s", data.get("iss")); return None
        if cid not in aud_set:
            log.warning("google verify (tokeninfo): audience=%s не совпадает с GOOGLE_CLIENT_ID", aud); return None
        exp = data.get("exp")
        if exp and int(exp) < time.time():
            log.warning("google verify (tokeninfo): срок токена истёк"); return None
        log.info("google verify: токен принят через tokeninfo-фолбэк")
        return _profile_from_payload(data)
    except Exception as e:
        log.warning("google verify (tokeninfo): %s", e)
        return None

def verify_google_token(token):
    cid = genv("GOOGLE_CLIENT_ID")
    if not token:
        log.warning("google verify: пустой credential"); return None
    if not cid:
        log.warning("google verify: GOOGLE_CLIENT_ID не настроен"); return None
    # 1) Официальная библиотека (если установлена — работает быстрее всех)
    if HAVE_GOOGLE_AUTH:
        try:
            info = _g_id_token.verify_oauth2_token(token, _g_requests.Request(), cid)
            p = _profile_from_payload(info)
            if p: return p
        except Exception as e:
            log.warning("google verify (google-auth): %s", e)
    # 2) Pure-Python RS256 (работает на Termux без cryptography и google-auth)
    try:
        p = _verify_google_sig_purepy(token, cid)
        if p: return p
    except Exception as e:
        log.warning("google verify (pure-python): %s", e)
    # 3) PyJWT + JWKS (если cryptography всё же доступен)
    try:
        import jwt as _pyjwt
        header, data = _jwt_decode_unverified(token)
        certs = _google_certs()
        from jwt import PyJWK as _PyJWK
        jwk_obj = certs.get(header.get("kid"))
        if not jwk_obj:
            log.warning("google verify (jwks): ключ kid=%s не найден", header.get("kid")); return None
        jwk = _PyJWK.from_dict(jwk_obj).key  # cryptography public key
        aud = data.get("aud")
        aud_set = {aud} if isinstance(aud, str) else set(aud or [])
        issuer_ok = data.get("iss") in ("https://accounts.google.com", "accounts.google.com")
        if not issuer_ok:
            log.warning("google verify (jwks): неверный iss=%s", data.get("iss")); return None
        if cid not in aud_set:
            log.warning("google verify (jwks): audience=%s не совпадает с GOOGLE_CLIENT_ID", aud); return None
        if int(data.get("exp", 0)) < time.time():
            log.warning("google verify (jwks): срок токена истёк"); return None
        payload = _pyjwt.decode(token, jwk, algorithms=["RS256"], audience=cid,
                                issuer=("https://accounts.google.com", "accounts.google.com"))
        p = _profile_from_payload(payload)
        if p:
            log.info("google verify: токен принят через PyJWT+JWKS-фолбэк")
            return p
    except ImportError:
        pass
    except Exception as e:
        log.warning("google verify (jwks): %s", e)
    # 4) Tokeninfo (последний резерв — проверка подписи на стороне Google)
    p = _verify_google_tokeninfo(token, cid)
    if p: return p
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
            return redirect(url_for("login", next=request.path))
        return fn(*a, **k)
    return w

# ---------------- Права администратора (admin_streaker) ----------------
def _hash_pwd(p): return hashlib.sha256(("scuarfy-store::" + p).encode("utf-8")).hexdigest()

def _admin_hash_from_db():
    try:
        r = get_db().execute("SELECT value FROM settings WHERE key='admin_pass_hash'").fetchone()
        return r["value"] if r else None
    except Exception:
        return None

def store_admin_password():
    """Пароль активации админки.
    Приоритет — хеш, заданный первым владельцем на странице /admin_streaker;
    если его нет — используется ADMIN_PASSWORD из .env / переменных окружения."""
    h = _admin_hash_from_db()
    if h: return "__hashed__:" + h
    return os.environ.get("ADMIN_PASSWORD") or None

def admin_panel_enabled():
    return bool(store_admin_password())

def is_admin():
    u = session.get("user") or {}
    if not session.get("store_admin"): return False
    sub = u.get("sub")
    if not sub: return False
    try:
        r = get_db().execute("SELECT 1 FROM store_admins WHERE user_sub=?", (sub,)).fetchone()
    except Exception:
        return False
    return bool(r)

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
            return redirect(url_for("login", next=request.path))
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

# ---------------- Классы приложений (свои иконки-бейджи) ----------------
APP_CLASSES = {
    "bestseller": {"label": "Бестселлер",      "icon": "/assets/img/icons/class-bestseller.svg"},
    "trending":   {"label": "На подъёме",       "icon": "/assets/img/icons/class-trending.svg"},
    "new":        {"label": "Новинка",          "icon": "/assets/img/icons/class-new.svg"},
    "choice":     {"label": "Выбор сообщества", "icon": "/assets/img/icons/class-choice.svg"},
    "editor":     {"label": "Выбор редакции",   "icon": "/assets/img/icons/class-editor.svg"},
    "verified":   {"label": "Проверенный издатель", "icon": "/assets/img/icons/class-verified.svg"},
}

def compute_app_class(a, rank_bestseller=None, rank_trending=None):
    """Определяет «класс» приложения по лайкам, скачиваниям и отзывам."""
    dl, likes, rating, votes = a.get("downloads") or 0, a.get("likes") or 0, a.get("rating") or 0, a.get("votes") or 0
    if rank_bestseller is not None and rank_bestseller <= 3 and dl >= 5:
        return "bestseller"
    if rank_trending is not None and rank_trending <= 5 and likes + votes >= 3:
        return "trending"
    if votes >= 3 and rating >= 4.5:
        return "choice"
    age_days = 0
    try:
        age_days = (datetime.now() - datetime.fromisoformat(a.get("created_at", ""))).days
    except Exception:
        pass
    if age_days <= 14:
        return "new"
    if dl >= 50:
        return "editor"
    return None

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

def attach_app_classes(apps):
    """Проставляет app_class по всему магазину (топ по скачиваниям/лайкам, отзывы, новинки)."""
    if not apps:
        return apps
    try:
        db = get_db()
        top_dl  = [x["id"] for x in db.execute(
            "SELECT id FROM store_apps ORDER BY downloads DESC, likes DESC LIMIT 3").fetchall()]
        top_act = [x["id"] for x in db.execute(
            "SELECT id FROM store_apps ORDER BY (likes+votes) DESC, downloads DESC LIMIT 5").fetchall()]
        rank_dl  = {aid: i + 1 for i, aid in enumerate(top_dl)}
        rank_act = {aid: i + 1 for i, aid in enumerate(top_act)}
    except Exception:
        rank_dl, rank_act = {}, {}
    for a in apps:
        key = compute_app_class(a, rank_dl.get(a["id"]), rank_act.get(a["id"]))
        a["app_class"] = key
        a["class_label"] = APP_CLASSES[key]["label"] if key else ""
        a["class_icon"] = APP_CLASSES[key]["icon"] if key else ""
    return apps

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
    return attach_app_classes([_app_row_to_dict(r) for r in rows])

def _get_category(cid):
    r = get_db().execute("SELECT * FROM app_categories WHERE id=?", (cid,)).fetchone()
    return dict(r) if r else None

def _uid():
    return (session.get("user") or {}).get("db_id")

def _save_image(fi, subdir):
    """Сохраняет загруженное изображение (иконка/логотип), возвращает публичный путь."""
    if not fi or not fi.filename:
        return ""
    ext = os.path.splitext(fi.filename)[1].lower()
    if ext not in IMG_EXT:
        return ""
    rel = f"assets/img/{subdir}/" + uuid.uuid4().hex[:12] + ext
    fi.save(BASE_DIR / rel)
    return "/" + rel

def _check_upload_size(f):
    """Проверка лимита MAX_APP_GB без чтения всего файла в память."""
    try:
        pos = f.stream.tell(); f.stream.seek(0, os.SEEK_END)
        size = f.stream.tell(); f.stream.seek(pos)
    except Exception:
        size = None
    limit = MAX_APP_GB * 1024**3
    if size is not None and size > limit:
        return None, f"Файл больше максимально допустимого размера ({MAX_APP_GB} ГБ)"
    return limit, None

def _store_save_file(f):
    """Сохраняет файл приложения на диск с проверкой размера. Возвращает (путь, ошибка)."""
    safe = f"{uuid.uuid4().hex[:10]}_{_safe_name(f.filename)}"
    dest = STORE_DIR / "apps" / safe
    limit, err = _check_upload_size(f)
    if err:
        return None, err
    written = 0
    try:
        with open(dest, "wb") as out:
            while True:
                chunk = f.stream.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > limit:
                    dest.unlink(missing_ok=True)
                    return None, f"Файл больше максимально допустимого размера ({MAX_APP_GB} ГБ)"
                out.write(chunk)
    except Exception as e:
        dest.unlink(missing_ok=True)
        log.warning("save upload: %s", e)
        return None, "Не удалось сохранить файл"
    return dest, None

# ---------------- Заявки организаций ----------------
# PDF не используется: вся анкета хранится в БД и показывается в админ-панели
# как заполненная форма; там же заявку можно принять или отклонить.

# ---------------- Чат ИИ-помощника (Pollinations) ----------------
AI_SYSTEM_PROMPT = (
    "Ты — Scuarfy, встроенный ИИ-помощник магазина приложений «Scuarfy Store». "
    "Отвечай коротко, дружелюбно и по делу, на языке пользователя (обычно русский).\n"
    "Знай о сервисе:\n"
    "- Scuarfy Store — магазин приложений: пользователи скачивают приложения, ставят лайки, пишут отзывы со звёздами (1–5).\n"
    "- Интерфейс в стиле Microsoft Store: главная /store с живым поиском, категориями и рекомендациями; отдельная страница приложения /store/app/<id>; отдельная страница категории /store/category/<id>.\n"
    "- Рекомендации формируются автоматически: чем больше лайков, скачиваний и хороших отзывов у приложения, тем выше оно в подборке «Рекомендуем».\n"
    "- Каждому приложению выдаётся собственный публичный ID вида a3f2-9c1be4-77ab2-1f09dc34-88ae5b21.\n"
    "- Максимальный размер загружаемого файла приложения — 80 ГБ.\n"
    "- Загружать приложения могут только администраторы через панель /store-admin. Секретная страница активации прав — /admin_streaker (пароль активации); кнопки админки в интерфейсе нет — переход вручную.\n"
    "- Организации и игровые студии могут запросить права публиковать свои приложения: форма «Запрос прав организации» (/store/request-access): имя, фамилия, название организации, контакты, данные о приложении. Заявка сохраняется в базе и видна администраторам в панели /store-admin (вкладка «Заявки») — PDF не используется, заявку можно принять или отклонить прямо там.\n"
    "- Приложения получают классы-бейджи: Бестселлер, На подъёме, Новинка, Выбор сообщества.\n"
    "- Вход через Google; пользователь может удалить или обновить только свой отзыв.\n"
    "Не выдумывай функции, которых нет. Ты НЕ OpenAI, НЕ ChatGPT и НЕ другая модель — тебя зовут Scuarfy, "
    "ты помощник именно этого магазина приложений. На вопросы «кто ты / какая модель» отвечай: «Я Scuarfy, "
    "ИИ-помощник Scuarfy Store». Не предлагай рассказать про OpenAI, GPT и подобные темы — перевод разговор "
    "на возможности магазина. Отвечай на языке пользователя (обычно русский), коротко и по делу.\n"
    "Форматирование: интерфейс понимает markdown — выделяй **важные слова** жирным, а примеры кода, команды "
    "и пути оформляй блоками в тройных обратных кавычках (```python ... ```). Не используй markdown-заголовки "
    "с решёткой (#)."
)

_ai_lock = threading.Lock()
_ai_last = {}

def _ai_throttle(sub):
    with _ai_lock:
        now = time.time()
        if now - _ai_last.get(sub, 0) < 3:
            return False
        _ai_last[sub] = now
        return True

def _parse_llm_resp(data):
    """Вытащить текст ответа из OpenAI-совместимого JSON или простого текста."""
    if isinstance(data, dict):
        try:
            c = ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
            if c:
                return str(c).strip()
        except Exception:
            pass
        for k in ("content", "response", "text"):
            v = data.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
    elif isinstance(data, str) and data.strip():
        return data.strip()
    return None

_OFFTOPIC_RE = re.compile(
    r"openai|chatgpt|\bGPT[-\s]?[0-9]|language model|as an ai|я \-? (?:языковая модель|искусственный интеллект)",
    re.I)

def _sanitize_llm(ans, q):
    """Не выпускать наружу оффтоп-болтовню модели про OpenAI/GPT и т.п."""
    if not ans:
        return None
    if _OFFTOPIC_RE.search(ans):
        return ("Я **Scuarfy** — ИИ-помощник магазина приложений Scuarfy Store 🙂\n"
                "Спрошу лучше про сервис: как скачать приложение, оставить отзыв, "
                "запросить права организации или активировать админ-права через /admin_streaker.")
    return ans

def _pollinations_chat(messages):
    """Чат через Pollinations. Эндпоинт /chat больше не существует (400/404
    'Cannot POST /chat') — используем OpenAI-совместимый POST /openai, а также
    GET /openai и корневой POST / как запасные варианты."""
    key = genv("POLLINATIONS_API_KEY")
    model = genv("POLLINATIONS_MODEL", "openai")
    base = genv("POLLINATIONS_URL", "https://text.pollinations.ai").rstrip("/")
    payload = {"messages": messages, "model": model,
               "private": True, "referrer": "scuarfy-store",
               "temperature": 0.5}
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    attempts = [("POST", base + "/openai", payload),
                ("GET",  base + "/openai", payload),
                ("POST", base + "/",       payload)]
    for method, url, body in attempts:
        try:
            r = requests.request(method, url, json=body, headers=headers, timeout=(10, 90))
        except Exception as e:
            log.warning("pollinations %s %s -> %s", method, url, e)
            continue
        if r.status_code == 200:
            try:
                data = r.json()
            except ValueError:
                data = r.text
            ans = _sanitize_llm(_parse_llm_resp(data), None)
            if ans:
                return ans
        log.warning("pollinations %s %s -> HTTP %s: %s", method, url, r.status_code, r.text[:150])
    return None

def _ollama_local(prompt):
    """Локальный фолбэк: ollama (удобно на Termux без внешнего API)."""
    try:
        r = requests.post(genv("OLLAMA_URL", "http://127.0.0.1:11434") + "/api/chat",
                          json={"model": genv("OLLAMA_MODEL", "llama3.2"),
                                "messages": [{"role": "system", "content": AI_SYSTEM_PROMPT},
                                             {"role": "user", "content": prompt}], "stream": False},
                          timeout=(5, 120))
        if r.status_code == 200:
            return _sanitize_llm((r.json().get("message") or {}).get("content"), None)
    except Exception:
        pass
    return None

def _rulebot_answer(q):
    """Оффлайн-ответы, «обученные» на самом Scuarfy Store (когда ИИ-API недоступен)."""
    ql = q.lower()
    def has(*words): return any(w in ql for w in words)
    if has("админ", "admin_streaker", "панель", "загрузить приложение", "выложить", "опубликовать"):
        return ("Загружать приложения могут только администраторы. Откройте секретную страницу "
                "/admin_streaker (кнопки в интерфейсе нет — введите адрес вручную), активируйте права "
                "паролем — и станет доступна панель /store-admin с формой загрузки. Кнопка «рекомендовать» "
                "при публикации не нужна: рекомендации считаются автоматически.")
    if has("рекоменд", "подборк", "что нового", "совет"):
        return ("В разделе «Рекомендуем» на главной показываются приложения с наибольшим числом лайков, "
                "скачиваний и хорошими отзывами. Больше активности вокруг приложения — выше оно в подборке.")
    if has("категор"):
        return ("Категории создаются в админ-панели (вкладка «Категории»). У каждой категории своя страница "
                "/store/category/<id> со списком приложений, поиском и сортировкой.")
    if has("размер", "гб", "макс", "лимит", "gb", "big"):
        return f"Максимальный размер файла приложения — {MAX_APP_GB} ГБ. Лимит проверяется при загрузке в админ-панели."
    if has("id", "идентиф", "айди"):
        return ("У каждого приложения собственный публичный ID вида a3f2-9c1be4-77ab2-1f09dc34-88ae5b21. "
                "Он показывается на странице приложения, рядом есть кнопка копирования.")
    if has("отзыв", "оценк", "звезд", "review"):
        return ("На странице приложения поставьте 1–5 звёзд и напишите текст отзыва. Свой отзыв можно "
                "обновить или удалить — рядом с ним есть кнопка удаления. Рейтинг пересчитывается автоматически.")
    if has("скачать", "качать", "download"):
        return ("Нажмите «Скачать» на карточке или странице приложения — файл сразу начнёт загружаться "
                "на ваше устройство.")
    if has("организ", "компани", "студи", "игр", "права", "заявк", "access"):
        return ("Если вы организация или игровая студия, откройте «Запрос прав организации» "
                "(кнопка внизу главной магазина или адрес /store/request-access). Заполните анкету: имя, "
                "фамилия, название организации, контакты, данные о приложении. Заявка сохранится в базе и "
                "будет видна администраторам во вкладке «Заявки» панели /store-admin — там её примут или отклонят.")
    if has("войти", "вход", "логин", "google", "аккаунт"):
        return ("Вход выполняется через Google. Аккаунт нужен, чтобы скачивать приложения, ставить лайки "
                "и писать отзывы.")
    if has("поиск", "найти", "искать"):
        return ("Поиск работает прямо на главной: начните вводить запрос в строку сверху — результаты "
                "обновляются мгновенно по названию, издателю и описанию.")
    if has("привет", "здравств", "hello", "hi", "помощь", "help", "кто ты", "что умеешь"):
        return ("Привет! Я Scuarfy — помощник этого магазина. Рассказу, как скачивать приложения, "
                "становиться администратором, получать права организации, как работают категории, "
                "рекомендации, лайки и отзывы. Справайте!")
    return None

# ---------------- Страницы ----------------
@app.route("/")
def root():
    return redirect(url_for("store") if session.get("user") else url_for("login"))

@app.route("/login")
def login():
    nxt = request.args.get("next", "")
    if session.get("user"):
        return redirect(nxt if nxt.startswith("/") else url_for("store"))
    return render_template("login.html", user=None, page="login")

@app.route("/register")
def register():
    if session.get("user"): return redirect(url_for("store"))
    return render_template("register.html", user=None, page="register")

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
        """SELECT rv.id AS review_id, rv.*, u.name AS uname, u.picture AS upic FROM app_reviews rv
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
    app_dict = attach_app_classes([_app_row_to_dict(r)])[0]
    return render_template("store_app.html", user=session["user"], page="store",
                           app=app_dict, reviews=reviews, my_review=my,
                           liked=bool(liked), similar=similar, is_admin_flag=is_admin())

@app.route("/store/request-access")
@login_required_html
def store_request_access():
    """Форма запроса прав организации/игровой студии (заявка → админ-панель, без PDF)."""
    db = get_db()
    mine = []
    u = session["user"]
    if u.get("sub"):
        mine = [dict(r) for r in db.execute(
            "SELECT uuid,org_name,app_name,status,admin_note,created_at FROM org_requests "
            "WHERE user_sub=? ORDER BY id DESC", (u["sub"],)).fetchall()]
    return render_template("store_request_access.html", user=session["user"], page="request-access", mine=mine)

@app.route("/ai")
@login_required_html
def ai_page():
    """Страница ИИ-помощника Scuarfy (Pollinations + оффлайн-обучение на сервисе)."""
    hist = []
    uid = _uid()
    sub = (session.get("user") or {}).get("sub")
    if sub:
        rows = get_db().execute(
            "SELECT role,text,created_at FROM ai_messages WHERE user_sub=? ORDER BY id DESC LIMIT 40",
            (sub,)).fetchall()[::-1]
        hist = [{"role": r["role"], "text": r["text"], "ts": r["created_at"]} for r in rows]
    return render_template("ai_chat.html", user=session["user"], page="ai", history=hist, has_uid=bool(uid))

@app.route("/admin_streaker")
def admin_streaker():
    """Секретная страница активации прав администратора (доступна только по прямой ссылке).
    Открыта без входа: при отсутствии пароля сразу показывает форму его установки."""
    return render_template("admin_streaker.html", user=session.get("user"), page="admin_streaker",
                           enabled=admin_panel_enabled(), already=is_admin())

@app.route("/store-admin")
@admin_required_html
def store_admin():
    db = get_db()
    cats = [dict(r) for r in db.execute("SELECT * FROM app_categories ORDER BY name").fetchall()]
    apps = attach_app_classes([_app_row_to_dict(r) for r in db.execute(
        """SELECT a.*, c.name AS category_name FROM store_apps a
           LEFT JOIN app_categories c ON c.id=a.category_id ORDER BY a.created_at DESC""").fetchall()])
    admins = [dict(r) for r in db.execute("SELECT * FROM store_admins ORDER BY created_at").fetchall()]
    reqs = [dict(r) for r in db.execute(
        "SELECT * FROM org_requests ORDER BY (status='pending') DESC, created_at DESC").fetchall()]
    pending_cnt = sum(1 for r in reqs if r["status"] == "pending")
    return render_template("store_admin.html", user=session["user"], page="store-admin",
                           cats=cats, apps=apps, admins=admins, max_gb=MAX_APP_GB,
                           requests=reqs, pending_cnt=pending_cnt)

# ---------------- API: авторизация ----------------
@app.route("/api/auth/google", methods=["POST"])
def auth_google():
    body = request.get_json(silent=True) or {}
    cred = body.get("credential")
    cid = genv("GOOGLE_CLIENT_ID")
    if not cid:
        log.error("auth/google: GOOGLE_CLIENT_ID не настроен на сервере")
        return jsonify(ok=False, error="server_not_configured",
                       hint="Задайте GOOGLE_CLIENT_ID в .env / переменных окружения и перезапустите приложение"), 500
    if not cred:
        log.warning("auth/google: credential отсутствует в запросе")
        return jsonify(ok=False, error="missing_credential"), 400
    p = verify_google_token(cred)
    if not p:
        #диагностика: логируем claims без проверки подписи (только iss/aud/exp — не секреты)
        diag = ""
        try:
            import base64
            parts = cred.split(".")
            if len(parts) >= 2:
                pl = parts[1] + "=" * (-len(parts[1]) % 4)
                cl = json.loads(base64.urlsafe_b64decode(pl))
                diag = "iss=%s aud=%s exp_past=%s" % (cl.get("iss"), cl.get("aud"),
                        int(cl.get("exp", 0)) < time.time())
        except Exception:
            pass
        log.warning("auth/google: токен не принят (%s) | google_auth=%s | client_id=%s", diag or "не удалось разобрать JWT", HAVE_GOOGLE_AUTH, (cid[:24] + "...") if cid else "<пусто>")
        return jsonify(ok=False, error="invalid_token",
                       hint="Проверьте GOOGLE_CLIENT_ID и что сайт добавлен в Authorized JavaScript origins"), 401
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
    if len(pwd) < 4:
        return jsonify(ok=False, error="too_short"), 400
    stored = store_admin_password()   # может отсутствовать при гонке первого запуска
    first_time = stored is None
    if first_time:
        stored = "__hashed__:" + _hash_pwd(pwd)
    ok = (pwd == stored) if not stored.startswith("__hashed__:") \
         else (_hash_pwd(pwd) == stored.split(":", 1)[1])
    if not ok:
        time.sleep(0.6)  # замедляем перебор паролей
        return jsonify(ok=False, error="wrong_password"), 403
    u = session["user"]
    now = datetime.now().isoformat(timespec="seconds")
    db = get_db()
    db.execute("""INSERT INTO store_admins(user_sub,user_email,user_name,created_at)
                        VALUES(?,?,?,?)
                        ON CONFLICT(user_sub) DO UPDATE SET user_email=excluded.user_email,
                        user_name=excluded.user_name""",
                     (u.get("sub"), u.get("email") or "", u.get("name") or "", now))
    # Фиксируем пароль и владельца в БД (в т.ч. когда пароль пришёл из ADMIN_PASSWORD):
    # первый активировавший становится владельцем, и случайный гость, узнавший env-пароль,
    # больше не сможет выдать себе права.
    if _admin_hash_from_db() is None:
        db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('admin_pass_hash',?)",
                   (_hash_pwd(pwd),))
    db.commit()
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
    rv = db.execute("SELECT id FROM app_reviews WHERE app_id=? AND user_id=?", (aid, uid)).fetchone()
    return jsonify(ok=True, review_id=(rv["id"] if rv else None))

@app.route("/api/store/reviews/<int:rid>", methods=["DELETE"])
@login_required
def store_review_delete(rid):
    """Пользователь может удалить только свой отзыв."""
    db = get_db()
    r = db.execute("SELECT * FROM app_reviews WHERE id=?", (rid,)).fetchone()
    if not r:
        return jsonify(ok=False, error="not_found"), 404
    if r["user_id"] != _uid() and not is_admin():
        return jsonify(ok=False, error="forbidden"), 403
    db.execute("DELETE FROM app_reviews WHERE id=?", (rid,))
    _recalc_rating(db, r["app_id"]); db.commit()
    return jsonify(ok=True)

# ---------------- API: заявки организаций ----------------
@app.route("/api/store/org-requests", methods=["POST"])
@login_required
def org_request_submit():
    d = request.get_json(silent=True) or {}
    def field(k, maxlen):
        return str(d.get(k) or "").strip()[:maxlen]
    first_name = field("first_name", 60); last_name = field("last_name", 60)
    org_name   = field("org_name", 120);  email    = field("email", 120)
    if not (first_name and last_name and org_name and email):
        return jsonify(ok=False, error="missing_fields",
                       message="Заполните имя, фамилию, название организации и email"), 400
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$", email):
        return jsonify(ok=False, error="bad_email"), 400
    org_type = "game" if field("org_type", 20) == "game" else "organization"
    u = session["user"]
    now = datetime.now().isoformat(timespec="seconds")
    req_uuid = uuid.uuid4().hex[:8] + "-" + uuid.uuid4().hex[:8]
    logo_path = ""
    lf = request.files.get("logo") if request.content_type and "multipart" in request.content_type else None
    if lf:
        logo_path = _save_image(lf, "brands")
    db = get_db()
    db.execute("""INSERT INTO org_requests(uuid,first_name,last_name,org_name,org_type,email,phone,
        country,website,app_name,app_desc,message,logo_path,user_sub,user_email,user_name,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (req_uuid, first_name, last_name, org_name, org_type, email, field("phone", 40),
         field("country", 60), field("website", 120), field("app_name", 120), field("app_desc", 1500),
         field("message", 3000), logo_path, u.get("sub") or "", u.get("email") or "", u.get("name") or "", now))
    db.commit()
    log.info("Оргзаявка %s от %s (%s)", req_uuid, org_name, u.get("email"))
    return jsonify(ok=True, uuid=req_uuid)

# ---------------- API: ИИ-помощник ----------------
@app.route("/api/ai/chat", methods=["POST"])
@login_required
def ai_chat():
    d = request.get_json(silent=True) or {}
    q = str(d.get("message") or "").strip()[:2000]
    if not q:
        return jsonify(ok=False, error="empty_message"), 400
    sub = (session.get("user") or {}).get("sub") or "anon"
    if not _ai_throttle(sub):
        return jsonify(ok=False, error="slow_down", message="Подождите пару секунд между сообщениями"), 429
    db = get_db()
    now = datetime.now().isoformat(timespec="seconds")
    db.execute("INSERT INTO ai_messages(user_sub,role,text,created_at) VALUES(?,?,?,?)", (sub, "user", q, now))
    # контекст последних реплик (до 10)
    ctx = [dict(r) for r in db.execute(
        "SELECT role,text FROM ai_messages WHERE user_sub=? ORDER BY id DESC LIMIT 10", (sub,)).fetchall()][::-1]
    messages = [{"role": "system", "content": AI_SYSTEM_PROMPT}]
    for m in ctx:
        messages.append({"role": m["role"] if m["role"] in ("user", "assistant") else "user",
                         "content": m["text"]})
    answer, source = None, None
    try:
        answer = _pollinations_chat(messages)
        if answer: source = "pollinations"
    except Exception as e:
        log.warning("pollinations chat: %s", e)
    if not answer and genv("OLLAMA_FALLBACK", "").lower() in ("1", "true", "yes"):
        answer = _ollama_local(q)
        if answer: source = "ollama"
    if not answer:
        answer = _rulebot_answer(q) or ("Похоже, ИИ-сервис временно недоступен. Я оффлайн-ассистент Scuarfy Store: "
            "могу рассказать про скачивание приложений, категории, рекомендации, отзывы, права администратора "
            "(/admin_streaker) и запрос прав организации (/store/request-access). Попробуйте ещё раз чуть позже.")
        source = "offline"
    db.execute("INSERT INTO ai_messages(user_sub,role,text,created_at) VALUES(?,?,?,?)",
               (sub, "assistant", answer, datetime.now().isoformat(timespec="seconds")))
    db.commit()
    return jsonify(ok=True, reply=answer, source=source)

@app.route("/api/ai/history", methods=["DELETE"])
@login_required
def ai_history_clear():
    sub = (session.get("user") or {}).get("sub")
    if sub:
        db = get_db(); db.execute("DELETE FROM ai_messages WHERE user_sub=?", (sub,)); db.commit()
    return jsonify(ok=True)

# ---------------- API: админ — заявки организаций ----------------
@app.route("/api/store/admin/org-requests/<ruuid>/decision", methods=["POST"])
@admin_required
def admin_org_decision(ruuid):
    d = request.get_json(silent=True) or {}
    decision = str(d.get("decision") or "")
    if decision not in ("approved", "rejected"):
        return jsonify(ok=False, error="bad_decision"), 400
    db = get_db()
    r = db.execute("SELECT * FROM org_requests WHERE uuid=?", (ruuid,)).fetchone()
    if not r:
        return jsonify(ok=False, error="not_found"), 404
    note = str(d.get("note") or "").strip()[:1000]
    who = (session.get("user") or {}).get("email") or (session.get("user") or {}).get("name") or "admin"
    db.execute("UPDATE org_requests SET status=?, admin_note=?, decided_by=?, decided_at=? WHERE uuid=?",
               (decision, note, who, datetime.now().isoformat(timespec="seconds"), ruuid))
    if decision == "approved" and r["user_sub"]:
        u = db.execute("SELECT * FROM users WHERE sub=?", (r["user_sub"],)).fetchone()
        now = datetime.now().isoformat(timespec="seconds")
        db.execute("""INSERT INTO store_admins(user_sub,user_email,user_name,created_at) VALUES(?,?,?,?)
                      ON CONFLICT(user_sub) DO UPDATE SET user_email=excluded.user_email, user_name=excluded.user_name""",
                   (r["user_sub"], u["email"] if u else "", u["name"] if u else "", now))
        # заявленная организация становится «издателем» для будущих загрузок
        db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
                   ("org:" + r["user_sub"], r["org_name"]))
    db.commit()
    log.info("Заявка %s: %s (админ %s)", ruuid, decision, who)
    return jsonify(ok=True)

@app.route("/uploads/<path:relpath>")
def serve_upload(relpath):
    """Раздача загруженных изображений (логотипы организаций и т.п.) из uploads/ с проверкой пути."""
    base = (STORE_DIR.resolve())
    target = (base / relpath).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        abort(404)
    if not target.is_file():
        abort(404)
    return send_file(target)

# ---------------- API: админ (загрузка/редактирование) ----------------
@app.route("/api/store/admin/apps", methods=["POST"])
@admin_required
def store_admin_upload():
    title = (request.form.get("title") or "").strip()[:120]
    if not title: return jsonify(ok=False, error="empty_title"), 400
    f = request.files.get("file")
    if not f or not f.filename: return jsonify(ok=False, error="no_file"), 400
    dest, err = _store_save_file(f)
    if err: return jsonify(ok=False, error="too_large", message=err), 400
    safe = dest.name
    size = dest.stat().st_size
    icon_path = _save_image(request.files.get("icon"), "icons")
    brand_logo = _save_image(request.files.get("brand_logo"), "brands")
    try: cid = int(request.form.get("category_id") or 0) or None
    except Exception: cid = None
    now = datetime.now().isoformat(timespec="seconds")
    db = get_db()
    while True:
        pid = _gen_public_id()
        if not db.execute("SELECT 1 FROM store_apps WHERE public_id=?", (pid,)).fetchone(): break
    cur = db.execute(
        """INSERT INTO store_apps(public_id,title,publisher,description,tagline,version,category_id,
           filename,orig_name,icon_path,size,brand_logo,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (pid, title, (request.form.get("publisher") or "").strip()[:80],
         (request.form.get("description") or "").strip()[:5000],
         (request.form.get("tagline") or "").strip()[:200],
         (request.form.get("version") or "1.0").strip()[:30], cid, safe,
         _safe_name(f.filename), icon_path, size, brand_logo, now, now))
    db.commit()
    log.info("Store: uploaded app %s '%s' (%s)", pid, title, _fmt_size(size))
    return jsonify(ok=True, id=cur.lastrowid, public_id=pid)

@app.route("/api/store/admin/apps/<int:aid>", methods=["PUT"])
@admin_required
def store_admin_update(aid):
    d = request.get_json(silent=True) or {}
    fields, vals = [], []
    for k in ("title", "publisher", "description", "tagline", "version"):
        if k in d:
            # int(...) приводит булевы значения к 0/1 и не даёт обрезать строки до «True»/«False»
            fields.append(f"{k}=?"); vals.append(str(d[k] if isinstance(d[k], bool) else (d[k] or "")).strip()[:5000])
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
    dest, err = _store_save_file(f)   # та же проверка лимита {MAX_APP_GB} ГБ, что и при публикации
    if err: return jsonify(ok=False, error="too_large", message=err), 400
    safe = dest.name
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
@app.errorhandler(413)
def e413(_e): return _json_err_page(413)
@app.errorhandler(500)
def e500(_e): return _json_err_page(500)

def _json_err_page(code):
    if request.path.startswith("/api/"):
        msg = {403: "Forbidden", 404: "Not found", 413: "File too large",
               500: "Internal server error"}[code]
        err = {413: "too_large"}.get(code, "server_error" if code == 500 else "not_found")
        return jsonify(ok=False, error=err, code=code, message=msg), code
    tpl = {403: "403.html", 404: "404.html", 413: "404.html", 500: "500.html"}[code]
    try:
        return render_template(tpl, user=session.get("user")), code
    except Exception:
        return jsonify(ok=False, code=code), code

# ---------------- старт ----------------
init_db()
with app.app_context():
    _seed_categories()
    _migrate_columns()
    _migrate_public_ids()

if __name__ == "__main__":
    log.info("Scuarfy Store: http://%s:%s | google_auth=%s", HOST, PORT, HAVE_GOOGLE_AUTH)
    app.run(host=HOST, port=PORT, debug=DEBUG)
