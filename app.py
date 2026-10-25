"""NetPulse — сервер. Вся логика, Google-вход/регистрация, поиск, SQLite."""
import os, json, time, sqlite3, logging, secrets
from pathlib import Path
from datetime import timedelta, datetime
from functools import wraps

import requests as http_lib
from dotenv import load_dotenv
from flask import (Flask, render_template, request, jsonify, session,
                   g, redirect, url_for)
from flask_cors import CORS

try:
    from google.oauth2 import id_token as _g_id_token
    from google.auth.transport import requests as _g_requests
    HAVE_GOOGLE_AUTH = True
except Exception:
    HAVE_GOOGLE_AUTH = False

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

GOOGLE_CLIENT_ID      = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET  = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_SEARCH_API_KEY = os.getenv("GOOGLE_SEARCH_API_KEY", "")
GOOGLE_SEARCH_CX      = os.getenv("GOOGLE_SEARCH_CX", "")
SECRET_KEY            = os.getenv("FLASK_SECRET_KEY", secrets.token_urlsafe(32))
DEBUG                 = os.getenv("FLASK_DEBUG", "False") == "True"
SESSION_HOURS         = int(os.getenv("SESSION_LIFETIME_HOURS", "24"))
HOST                  = os.getenv("HOST", "127.0.0.1")
PORT                  = int(os.getenv("PORT", "5000"))

for d in ["assets/css","assets/img","assets/js","assets/sounds",
          "cache","data","instance","logs","templates"]:
    (BASE_DIR / d).mkdir(parents=True, exist_ok=True)

DB_PATH   = BASE_DIR / "instance" / "netpulse.db"
LOG_PATH  = BASE_DIR / "logs" / "server.log"
DATA_PATH = BASE_DIR / "data" / "history_backup.json"

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    handlers=[logging.FileHandler(LOG_PATH, encoding="utf-8"), logging.StreamHandler()])
log = logging.getLogger("netpulse")

app = Flask(__name__, template_folder="templates",
            static_folder="assets", static_url_path="/assets")
app.config["SECRET_KEY"] = SECRET_KEY
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=SESSION_HOURS)
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

def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
    CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT, sub TEXT UNIQUE NOT NULL,
        name TEXT, email TEXT, picture TEXT, registered INTEGER DEFAULT 0,
        created_at TEXT, last_login TEXT);
    CREATE TABLE IF NOT EXISTS tests(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        ts INTEGER NOT NULL, kind TEXT DEFAULT 'speed',
        down REAL, up REAL, ping REAL, jitter REAL, loss REAL, sim INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS prefs(
        user_id INTEGER PRIMARY KEY, data TEXT);
    CREATE INDEX IF NOT EXISTS idx_tests_user ON tests(user_id, ts DESC);
    """)
    db.commit(); db.close()
    log.info("БД готова: %s", DB_PATH)

# ---------------- Google ----------------
def verify_google_token(token):
    try:
        if HAVE_GOOGLE_AUTH:
            info = _g_id_token.verify_oauth2_token(
                token, _g_requests.Request(), audience=GOOGLE_CLIENT_ID)
        else:
            r = http_lib.get("https://oauth2.googleapis.com/tokeninfo",
                             params={"id_token": token}, timeout=10)
            if r.status_code != 200: return None
            info = r.json()
            if int(info.get("exp", 0)) < time.time(): return None
        if info.get("aud") != GOOGLE_CLIENT_ID: return None
        return {"sub": info.get("sub"), "name": info.get("name"),
                "email": info.get("email"), "picture": info.get("picture"),
                "email_verified": info.get("email_verified", False)}
    except Exception as e:
        log.warning("token verify failed: %s", e); return None

def _upsert_user(p, register):
    now = datetime.now().isoformat(timespec="seconds")
    db = get_db()
    row = db.execute("SELECT id,registered FROM users WHERE sub=?", (p["sub"],)).fetchone()
    if row:
        reg = 1 if (register or row["registered"]) else 0
        db.execute("UPDATE users SET name=?,email=?,picture=?,registered=?,last_login=? WHERE sub=?",
                   (p["name"], p["email"], p["picture"], reg, now, p["sub"]))
        uid = row["id"]
    else:
        cur = db.execute("INSERT INTO users(sub,name,email,picture,registered,created_at,last_login) VALUES(?,?,?,?,?,?,?)",
                   (p["sub"], p["name"], p["email"], p["picture"], 1 if register else 0, now, now))
        uid = cur.lastrowid
    db.commit()
    p["db_id"] = uid
    p["registered"] = bool(register or (row and row["registered"]))
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

# ---------------- страницы ----------------
@app.route("/")
def root():
    return redirect(url_for("dashboard") if session.get("user") else url_for("login"))

@app.route("/login")
def login():
    if session.get("user"): return redirect(url_for("dashboard"))
    return render_template("login.html", google_client_id=GOOGLE_CLIENT_ID, page="login")

@app.route("/register")
def register():
    if session.get("user"): return redirect(url_for("dashboard"))
    return render_template("register.html", google_client_id=GOOGLE_CLIENT_ID, page="register")

PAGES = {"dashboard":"Дашборд","ping":"Пинг","traceroute":"Трассировка","dns":"DNS",
         "wifi":"Wi‑Fi","search":"Поиск","history":"История","settings":"Настройки"}
for _name in PAGES:
    def _mk(nm):
        @login_required_html
        def view(nm=nm): return render_template(nm+".html", user=session["user"], page=nm)
        view.__name__ = nm
        return view
    app.add_url_rule("/"+_name, _name, _mk(_name))

@app.route("/about")
@login_required_html
def about():
    return render_template("about.html", user=session["user"], page="about")

# ---------------- API ----------------
@app.route("/api/auth/google", methods=["POST"])
def auth_google():
    body = request.get_json(silent=True) or {}
    register = (request.args.get("mode") == "register") or (body.get("mode") == "register")
    cred = body.get("credential")
    if not cred: return jsonify(ok=False, error="missing_credential"), 400
    p = verify_google_token(cred)
    if not p: return jsonify(ok=False, error="invalid_token"), 401
    p = _upsert_user(p, register)
    session.permanent = True; session["user"] = p
    log.info("%s: %s <%s>", "Регистрация" if register else "Вход", p.get("name"), p.get("email"))
    return jsonify(ok=True, user=p, registered=register)

@app.route("/api/me")
def me():
    u = session.get("user")
    if not u: return jsonify(ok=False, error="not_authenticated"), 401
    return jsonify(ok=True, user=u)

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear(); return jsonify(ok=True)

@app.route("/api/history", methods=["GET"])
@login_required
def history_get():
    uid = session["user"]["db_id"]; kind = request.args.get("kind")
    sql = "SELECT ts,kind,down,up,ping,jitter,loss,sim FROM tests WHERE user_id=?"; args = [uid]
    if kind: sql += " AND kind=?"; args.append(kind)
    sql += " ORDER BY ts DESC LIMIT 200"
    rows = get_db().execute(sql, args).fetchall()
    return jsonify(ok=True, history=[dict(r) for r in rows])

@app.route("/api/history", methods=["POST"])
@login_required
def history_add():
    uid = session["user"]["db_id"]; d = request.get_json(silent=True) or {}
    get_db().execute("INSERT INTO tests(user_id,ts,kind,down,up,ping,jitter,loss,sim) VALUES(?,?,?,?,?,?,?,?,?)",
        (uid, int(d.get("ts", time.time()*1000)), d.get("kind","speed"),
         d.get("down"), d.get("up"), d.get("ping"), d.get("jitter"), d.get("loss"),
         1 if d.get("sim") else 0))
    get_db().commit()
    try:
        rows = get_db().execute("SELECT ts,kind,down,up,ping,jitter,loss,sim FROM tests WHERE user_id=? ORDER BY ts DESC LIMIT 200",(uid,)).fetchall()
        DATA_PATH.write_text(json.dumps([dict(r) for r in rows], ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception as e: log.warning("backup: %s", e)
    return jsonify(ok=True)

@app.route("/api/history", methods=["DELETE"])
@login_required
def history_clear():
    get_db().execute("DELETE FROM tests WHERE user_id=?", (session["user"]["db_id"],)); get_db().commit()
    return jsonify(ok=True)

@app.route("/api/prefs", methods=["GET"])
@login_required
def prefs_get():
    r = get_db().execute("SELECT data FROM prefs WHERE user_id=?", (session["user"]["db_id"],)).fetchone()
    return jsonify(ok=True, prefs=json.loads(r["data"]) if r else {})

@app.route("/api/prefs", methods=["POST"])
@login_required
def prefs_set():
    d = request.get_json(silent=True) or {}
    get_db().execute("INSERT INTO prefs(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
                     (session["user"]["db_id"], json.dumps(d)))
    get_db().commit(); return jsonify(ok=True)

@app.route("/api/search")
@login_required
def api_search():
    if not GOOGLE_SEARCH_API_KEY or not GOOGLE_SEARCH_CX:
        return jsonify(ok=False, error="search_not_configured",
                       hint="Заполните GOOGLE_SEARCH_API_KEY и GOOGLE_SEARCH_CX в .env"), 503
    q = (request.args.get("q") or "").strip()
    if not q: return jsonify(ok=False, error="empty_query"), 400
    mode = request.args.get("mode", "web")
    start = max(1, int(request.args.get("start", 1)))
    try:
        params = {"key": GOOGLE_SEARCH_API_KEY, "cx": GOOGLE_SEARCH_CX,
                  "q": q, "start": start, "num": 10, "safe": "active"}
        if mode == "image": params["searchType"] = "image"
        r = http_lib.get("https://www.googleapis.com/customsearch/v1", params=params, timeout=15)
        data = r.json()
        if r.status_code != 200:
            err = data.get("error", {})
            log.warning("search api %s: %s", r.status_code, err.get("message"))
            return jsonify(ok=False, error="upstream",
                           message=err.get("message", "HTTP " + str(r.status_code))), r.status_code
        items = []
        for it in data.get("items", []):
            thumb = None; pm = it.get("pagemap", {})
            if mode == "image": thumb = it.get("link")
            elif pm.get("cse_thumbnail"): thumb = pm["cse_thumbnail"][0].get("src")
            elif pm.get("thumbnail"): thumb = pm["thumbnail"][0].get("src")
            items.append({"title": it.get("title"), "link": it.get("link"),
                          "snippet": it.get("snippet"), "display": it.get("displayLink"), "thumb": thumb})
        info = data.get("searchInformation", {})
        return jsonify(ok=True, query=q, mode=mode, start=start,
                       total=info.get("formattedTotalResults", "—"),
                       time=info.get("formattedSearchTime", "—"),
                       next=bool(data.get("queries", {}).get("nextPage")), items=items)
    except Exception as e:
        log.error("search failed: %s", e)
        return jsonify(ok=False, error="proxy", message=str(e)), 500

@app.route("/api/health")
def health():
    return jsonify(ok=True, service="netpulse", google_auth=HAVE_GOOGLE_AUTH,
                   search=bool(GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX),
                   time=datetime.now().isoformat(timespec="seconds"))

@app.errorhandler(403)
def e403(_e): return render_template("403.html"), 403
@app.errorhandler(404)
def e404(_e): return render_template("404.html"), 404
@app.errorhandler(500)
def e500(_e): return render_template("500.html"), 500

if __name__ == "__main__":
    init_db()
    log.info("NetPulse: http://%s:%s | google_auth=%s | search=%s",
             HOST, PORT, HAVE_GOOGLE_AUTH, bool(GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX))
    app.run(host=HOST, port=PORT, debug=DEBUG)
