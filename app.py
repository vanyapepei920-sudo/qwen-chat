"""NetPulse — сервер. Google-вход, поиск, мониторинг сайтов, уведомления, экспорт, API-токены."""
import os, json, time, sqlite3, logging, secrets, re, csv, io, hmac, hashlib
from pathlib import Path
from datetime import timedelta, datetime
from functools import wraps

import requests as http_lib
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from dotenv import load_dotenv
from flask import (Flask, render_template, request, jsonify, session,
                   g, redirect, url_for, Response, make_response)
from flask_cors import CORS

try:
    from google.oauth2 import id_token as _g_id_token
    from google.auth.transport import requests as _g_requests
    HAVE_GOOGLE_AUTH = True
except Exception:
    HAVE_GOOGLE_AUTH = False

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# Все Google-настройки читаются ТОЛЬКО из .env (см. .env.example) — в коде ключей нет.
def _env(name, default=""):
    """Читает переменную окружения; значения всегда берутся из .env / env, не из кода."""
    return os.environ.get(name) or os.getenv(name, default) or ""

def genv(name, default=""):
    """Google-настройки читаются из .env в МОМЕНТ запроса — можно менять без рестарта."""
    return os.environ.get(name) or os.getenv(name, default) or default

GOOGLE_CLIENT_ID      = _env("GOOGLE_CLIENT_ID")       # снимок на старте (для логов)
GOOGLE_CLIENT_SECRET  = _env("GOOGLE_CLIENT_SECRET")
GOOGLE_SEARCH_API_KEY = _env("GOOGLE_SEARCH_API_KEY")
GOOGLE_SEARCH_CX      = _env("GOOGLE_SEARCH_CX")
WEBHOOK_URL           = os.getenv("WEBHOOK_URL", "")          # Discord/Telegram-bridge/slack — любой webhook
TELEGRAM_BOT_TOKEN    = os.getenv("TELEGRAM_BOT_TOKEN", "")  # optional
TELEGRAM_CHAT_ID      = os.getenv("TELEGRAM_CHAT_ID", "")    # optional
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

# Ключи API могут читаться из переменных окружения (для деплоя: задайте их в панели хостинга)
ENV_API_KEYS = {k.strip() for k in os.environ.get("API_KEYS", "").split(",") if k.strip()}

app = Flask(__name__, template_folder="templates",
            static_folder="assets", static_url_path="/assets")
app.config["SECRET_KEY"] = SECRET_KEY
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=SESSION_HOURS)
CORS(app, supports_credentials=True,
     origins=[f"http://{HOST}:{PORT}", "http://localhost:5000", "http://127.0.0.1:5000"],
     resources={r"/api/v1/*": {"origins": "*"}, r"/api/v1": {"origins": "*"}})

# Публичный Developer API (/api/v1) доступен с ЛЮБОГО сайта (ключи sp-test-… вместо cookies)
@app.after_request
def _cors_devapi(resp):
    if request.path.startswith("/api/v1"):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-NetPulse-Key, Authorization"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp

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
    CREATE TABLE IF NOT EXISTS monitors(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        url TEXT NOT NULL, name TEXT DEFAULT '', interval_sec INTEGER DEFAULT 300,
        enabled INTEGER DEFAULT 1, last_check INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE IF NOT EXISTS monitor_results(
        id INTEGER PRIMARY KEY AUTOINCREMENT, monitor_id INTEGER NOT NULL,
        ts INTEGER NOT NULL, ok INTEGER, status INTEGER, latency_ms REAL, error TEXT);
    CREATE TABLE IF NOT EXISTS notifications(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        ts INTEGER NOT NULL, kind TEXT, text TEXT, read INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS api_tokens(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        label TEXT, token_hash TEXT UNIQUE NOT NULL, created_at TEXT, last_used TEXT);
    CREATE TABLE IF NOT EXISTS dev_keys(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        name TEXT, key_hash TEXT UNIQUE NOT NULL, secret TEXT DEFAULT '',
        scopes TEXT DEFAULT 'basic', active INTEGER DEFAULT 1,
        rate_limit INTEGER DEFAULT 60, created_at TEXT, last_used TEXT, calls INTEGER DEFAULT 0,
        env TEXT DEFAULT 'test', allowed_origins TEXT DEFAULT '*', quota_day INTEGER DEFAULT 0,
        revoked INTEGER DEFAULT 0, note TEXT DEFAULT '', expires_at TEXT DEFAULT '',
        key_mask TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS chat_messages(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        ts INTEGER NOT NULL, role TEXT, text TEXT);
    CREATE TABLE IF NOT EXISTS key_usage(
        id INTEGER PRIMARY KEY AUTOINCREMENT, key_id INTEGER NOT NULL, ts INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_tests_user ON tests(user_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_res_monitor ON monitor_results(monitor_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_key ON key_usage(key_id, ts DESC);
    """)
    # миграция: добавляем недостающие колонки (если таблица создана старой версией)
    for tbl, col, decl in [("dev_keys","secret","TEXT DEFAULT ''"),
                           ("dev_keys","calls","INTEGER DEFAULT 0"),
                           ("dev_keys","env","TEXT DEFAULT 'test'"),
                           ("dev_keys","allowed_origins","TEXT DEFAULT '*'"),
                           ("dev_keys","quota_day","INTEGER DEFAULT 0"),
                           ("dev_keys","revoked","INTEGER DEFAULT 0"),
                           ("dev_keys","note","TEXT DEFAULT ''"),
                           ("dev_keys","expires_at","TEXT DEFAULT ''"),
                           ("dev_keys","key_mask","TEXT DEFAULT ''")]:
        cols = [r[1] for r in db.execute(f"PRAGMA table_info({tbl})").fetchall()]
        if col not in cols:
            db.execute(f"ALTER TABLE {tbl} ADD COLUMN {col} {decl}")
    db.commit(); db.close()
    log.info("БД готова: %s", DB_PATH)

# ---------------- Google ----------------
def verify_google_token(token):
    try:
        if HAVE_GOOGLE_AUTH:
            info = _g_id_token.verify_oauth2_token(
                token, _g_requests.Request(), audience=genv("GOOGLE_CLIENT_ID"))
        else:
            r = http_lib.get("https://oauth2.googleapis.com/tokeninfo",
                             params={"id_token": token}, timeout=10)
            if r.status_code != 200: return None
            info = r.json()
            if int(info.get("exp", 0)) < time.time(): return None
        if info.get("aud") != genv("GOOGLE_CLIENT_ID"): return None
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
    return render_template("login.html", google_client_id=genv("GOOGLE_CLIENT_ID"), page="login")

@app.route("/register")
def register():
    if session.get("user"): return redirect(url_for("dashboard"))
    return render_template("register.html", google_client_id=genv("GOOGLE_CLIENT_ID"), page="register")

PAGES = {"dashboard":"Спидтест","ping":"Пинг","traceroute":"Трассировка","dns":"DNS",
         "wifi":"Wi‑Fi","search":"Поиск","history":"История","monitor":"Мониторинг",
         "assistant":"Ассистент","settings":"Настройки"}
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
    key, cx = genv("GOOGLE_SEARCH_API_KEY"), genv("GOOGLE_SEARCH_CX")
    if not key or not cx:
        return jsonify(ok=False, error="search_not_configured",
                       hint="Заполните GOOGLE_SEARCH_API_KEY и GOOGLE_SEARCH_CX в .env"), 503
    q = (request.args.get("q") or "").strip()
    if not q: return jsonify(ok=False, error="empty_query"), 400
    mode = request.args.get("mode", "web")
    start = max(1, int(request.args.get("start", 1)))
    try:
        params = {"key": key, "cx": cx,
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
                   search=bool(genv("GOOGLE_SEARCH_API_KEY") and genv("GOOGLE_SEARCH_CX")),
                   google_login=bool(genv("GOOGLE_CLIENT_ID")),
                   assistant="ready",
                   time=datetime.now().isoformat(timespec="seconds"))

# ============ НОВЫЕ ФУНКЦИИ ============

# --- уведомления (колокол) ---
def _notify(uid, kind, text):
    db = get_db()
    db.execute("INSERT INTO notifications(user_id,ts,kind,text) VALUES(?,?,?,?)",
               (uid, int(time.time()*1000), kind, text)); db.commit()
    # внешние каналы
    if WEBHOOK_URL:
        try: http_lib.post(WEBHOOK_URL, json={"content": f"[NetPulse] {text}"}, timeout=5)
        except Exception as e: log.warning("webhook: %s", e)
    if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID:
        try: http_lib.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": TELEGRAM_CHAT_ID, "text": f"📡 NetPulse: {text}"}, timeout=5)
        except Exception as e: log.warning("telegram: %s", e)

@app.route("/api/notifications")
@login_required
def notif_list():
    rows = get_db().execute(
        "SELECT id,ts,kind,text,read FROM notifications WHERE user_id=? ORDER BY ts DESC LIMIT 50",
        (session["user"]["db_id"],)).fetchall()
    unread = sum(1 for r in rows if not r["read"])
    return jsonify(ok=True, items=[dict(r) for r in rows], unread=unread)

@app.route("/api/notifications/read", methods=["POST"])
@login_required
def notif_read():
    get_db().execute("UPDATE notifications SET read=1 WHERE user_id=?", (session["user"]["db_id"],))
    get_db().commit(); return jsonify(ok=True)

# --- утилиты: калькуляторы IP и конвертеры единиц ---
def _netmask_to_prefix(mask):
    try:
        parts = [int(p) for p in mask.split(".")]
        if len(parts) != 4 or any(p < 0 or p > 255 for p in parts): return None
        bits = (parts[0]<<24)|(parts[1]<<16)|(parts[2]<<8)|parts[3]
        if bin(bits).count("1") + bin((1<<32)-1-bits).count("1") != 32: return None
        return bin(bits).count("1")
    except Exception: return None

@app.route("/api/tools/subnet")
@login_required
def tool_subnet():
    ip = request.args.get("ip","").strip(); pref = request.args.get("prefix","").strip()
    m = re.match(r"^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:/(\d{1,2}))?$", ip)
    if not m: return jsonify(ok=False, error="bad_ip"), 400
    octs = [int(x) for x in m.groups()[:4]]
    if any(o > 255 for o in octs): return jsonify(ok=False, error="bad_ip"), 400
    inline_pref = m.group(5)
    if inline_pref is not None: pref = inline_pref
    try: p = int(pref)
    except Exception: return jsonify(ok=False, error="bad_prefix", hint="укажите /24 или поле prefix"), 400
    if p < 0 or p > 32: return jsonify(ok=False, error="bad_prefix"), 400
    addr = (octs[0]<<24)|(octs[1]<<16)|(octs[2]<<8)|octs[3]
    mask = ((1<<p)-1) << (32-p) & 0xFFFFFFFF if p else 0
    hostmask = (~mask) & 0xFFFFFFFF
    net = addr & mask; bcast = net | hostmask
    def d2s(x): return ".".join(str((x>>s)&255) for s in (24,16,8,0))
    total = hostmask+1; usable = max(0, total-2) if p <= 30 else (1 if p==31 else 0)
    return jsonify(ok=True, network=d2s(net), broadcast=d2s(bcast),
                   first_host=d2s(net+1) if usable else None, last_host=d2s(bcast-1) if usable else None,
                   netmask=d2s(mask), wildcard=d2s(hostmask), prefix=p,
                   total=total, usable=usable,
                   version="IPv4", cidr=f"{d2s(net)}/{p}")

@app.route("/api/tools/units")
@login_required
def tool_units():
    try: val = float(request.args.get("value","0")); frm = request.args.get("from","mbps")
    except ValueError: return jsonify(ok=False, error="bad_value"), 400
    rates = {"bps":1,"kbps":1e3,"mbps":1e6,"gbps":1e9}
    bytes_ = {"B":1,"KB":1024,"MB":1024**2,"GB":1024**3,"TB":1024**4}
    if frm in rates:
        base = val*rates[frm]; res = {k: base/v for k,v in rates.items()}
        res["bytes_per_sec_MB"] = base/8/1024**2
        return jsonify(ok=True, kind="speed", input=f"{val} {frm}", results=res)
    fu = frm.upper()
    if fu in bytes_:
        base = val*bytes_[fu]
        return jsonify(ok=True, kind="size", input=f"{val} {fu}",
                       results={k: base/v for k,v in bytes_.items()})
    return jsonify(ok=False, error="unknown_unit", hint="bps|kbps|mbps|gbps|B|KB|MB|GB|TB"), 400

# --- экспорт истории ---
@app.route("/api/history/export")
@login_required
def history_export():
    fmt = request.args.get("format","json")
    uid = session["user"]["db_id"]
    rows = get_db().execute(
        "SELECT ts,kind,down,up,ping,jitter,loss,sim FROM tests WHERE user_id=? ORDER BY ts DESC",
        (uid,)).fetchall()
    data = [dict(r) for r in rows]
    if fmt == "csv":
        buf = io.StringIO(); w = csv.DictWriter(buf, fieldnames=list(data[0].keys()) if data else ["ts","kind"])
        w.writeheader(); [w.writerow(r) for r in data]
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition":"attachment; filename=netpulse_history.csv"})
    return Response(json.dumps(data, ensure_ascii=False, indent=1), mimetype="application/json",
                    headers={"Content-Disposition":"attachment; filename=netpulse_history.json"})

# --- мониторинг сайтов (uptime) ---
URL_RE = re.compile(r"^https?://[^\s/$.?#].[^\s]*$")

def _check_url(url):
    t0 = time.perf_counter()
    try:
        r = http_lib.get(url, timeout=10, allow_redirects=True,
                         headers={"User-Agent":"NetPulseMonitor/1.0"})
        lat = (time.perf_counter()-t0)*1000
        return {"ok": r.status_code < 400, "status": r.status_code, "latency_ms": round(lat,1)}
    except Exception as e:
        return {"ok": False, "status": None, "latency_ms": None, "error": str(e)[:200]}

@app.route("/api/monitors", methods=["GET"])
@login_required
def monitors_list():
    uid = session["user"]["db_id"]; db = get_db()
    mons = db.execute("SELECT * FROM monitors WHERE user_id=? ORDER BY id", (uid,)).fetchall()
    out = []
    for mo in mons:
        last = db.execute("SELECT ok,status,latency_ms,error,ts FROM monitor_results WHERE monitor_id=? ORDER BY ts DESC LIMIT 1",(mo["id"],)).fetchone()
        stats = db.execute("SELECT COUNT(*) c, SUM(ok) up FROM monitor_results WHERE monitor_id=? AND ts>?",
                           (mo["id"], int(time.time()*1000)-86400000)).fetchone()
        uptime = round(100*stats["up"]/stats["c"],2) if stats["c"] else None
        out.append({**dict(mo), "last": dict(last) if last else None, "uptime_24h": uptime, "checks_24h": stats["c"]})
    return jsonify(ok=True, monitors=out)

@app.route("/api/monitors", methods=["POST"])
@login_required
def monitors_add():
    d = request.get_json(silent=True) or {}
    url = (d.get("url") or "").strip()
    if not URL_RE.match(url): return jsonify(ok=False, error="bad_url"), 400
    interval = int(d.get("interval_sec", 300)); interval = max(60, min(3600, interval))
    cur = get_db().execute("INSERT INTO monitors(user_id,url,name,interval_sec,created_at) VALUES(?,?,?,?,?)",
        (session["user"]["db_id"], url, (d.get("name") or url)[:80], interval, datetime.now().isoformat(timespec="seconds")))
    get_db().commit()
    res = _check_url(url); mid = cur.lastrowid
    get_db().execute("INSERT INTO monitor_results(monitor_id,ts,ok,status,latency_ms,error) VALUES(?,?,?,?,?,?)",
        (mid, int(time.time()*1000), 1 if res["ok"] else 0, res["status"], res["latency_ms"], res.get("error")))
    get_db().execute("UPDATE monitors SET last_check=? WHERE id=?", (int(time.time()*1000), mid)); get_db().commit()
    return jsonify(ok=True, id=mid, result=res)

@app.route("/api/monitors/<int:mid>", methods=["DELETE"])
@login_required
def monitors_del(mid):
    db = get_db(); mo = db.execute("SELECT id FROM monitors WHERE id=? AND user_id=?",(mid, session["user"]["db_id"])).fetchone()
    if not mo: return jsonify(ok=False, error="not_found"), 404
    db.execute("DELETE FROM monitor_results WHERE monitor_id=?",(mid,)); db.execute("DELETE FROM monitors WHERE id=?",(mid,))
    db.commit(); return jsonify(ok=True)

@app.route("/api/monitors/<int:mid>/toggle", methods=["POST"])
@login_required
def monitors_toggle(mid):
    db = get_db(); mo = db.execute("SELECT * FROM monitors WHERE id=? AND user_id=?",(mid, session["user"]["db_id"])).fetchone()
    if not mo: return jsonify(ok=False, error="not_found"), 404
    en = 0 if mo["enabled"] else 1
    db.execute("UPDATE monitors SET enabled=? WHERE id=?",(en,mid)); db.commit()
    return jsonify(ok=True, enabled=bool(en))

@app.route("/api/monitors/<int:mid>/run", methods=["POST"])
@login_required
def monitors_run(mid):
    db = get_db(); mo = db.execute("SELECT * FROM monitors WHERE id=? AND user_id=?",(mid, session["user"]["db_id"])).fetchone()
    if not mo: return jsonify(ok=False, error="not_found"), 404
    res = _check_url(mo["url"]); now = int(time.time()*1000)
    prev = db.execute("SELECT ok FROM monitor_results WHERE monitor_id=? ORDER BY ts DESC LIMIT 1",(mid,)).fetchone()
    db.execute("INSERT INTO monitor_results(monitor_id,ts,ok,status,latency_ms,error) VALUES(?,?,?,?,?,?)",
        (mid, now, 1 if res["ok"] else 0, res["status"], res["latency_ms"], res.get("error")))
    db.execute("UPDATE monitors SET last_check=? WHERE id=?",(now,mid))
    if prev is None and not res["ok"]:                        # сразу упал → уведомление
        _notify(session["user"]["db_id"], "monitor", f"{mo['url']} ⛔ недоступен (HTTP {res['status'] or '—'})")
    elif prev is not None and bool(prev["ok"]) != res["ok"]:  # смена состояния → уведомление
        state = "✅ снова доступен" if res["ok"] else "⛔ недоступен"
        _notify(session["user"]["db_id"], "monitor", f"{mo['url']} {state} (HTTP {res['status'] or '—'})")
    db.commit()
    return jsonify(ok=True, result=res)

@app.route("/api/monitors/<int:mid>/history")
@login_required
def monitors_history(mid):
    db = get_db(); mo = db.execute("SELECT id FROM monitors WHERE id=? AND user_id=?",(mid, session["user"]["db_id"])).fetchone()
    if not mo: return jsonify(ok=False, error="not_found"), 404
    rows = db.execute("SELECT ts,ok,status,latency_ms FROM monitor_results WHERE monitor_id=? ORDER BY ts DESC LIMIT 100",(mid,)).fetchall()
    return jsonify(ok=True, items=[dict(r) for r in rows])

def run_due_monitors():
    """фоновый обход мониторов, у которых наступило время проверки"""
    try:
        with app.app_context():
            now = int(time.time()*1000)
            due = get_db().execute("SELECT * FROM monitors WHERE enabled=1 AND last_check<=?",
                                   (now - 60000,)).fetchall()
            for mo in due:
                if now - mo["last_check"] < mo["interval_sec"]*1000: continue
                res = _check_url(mo["url"]); db = get_db()
                prev = db.execute("SELECT ok FROM monitor_results WHERE monitor_id=? ORDER BY ts DESC LIMIT 1",(mo["id"],)).fetchone()
                db.execute("INSERT INTO monitor_results(monitor_id,ts,ok,status,latency_ms,error) VALUES(?,?,?,?,?,?)",
                    (mo["id"], now, 1 if res["ok"] else 0, res["status"], res["latency_ms"], res.get("error")))
                db.execute("UPDATE monitors SET last_check=? WHERE id=?",(now, mo["id"]))
                if prev is None and not res["ok"]:
                    _notify(mo["user_id"], "monitor", f"{mo['url']} ⛔ недоступен (HTTP {res['status'] or '—'})")
                elif prev is not None and bool(prev["ok"]) != res["ok"]:
                    state = "✅ снова доступен" if res["ok"] else "⛔ недоступен"
                    _notify(mo["user_id"], "monitor", f"{mo['url']} {state} (HTTP {res['status'] or '—'})")
                db.commit()
    except Exception as e:
        log.warning("monitor loop: %s", e)

import threading
def _bg_loop():
    while True:
        time.sleep(30); run_due_monitors()
threading.Thread(target=_bg_loop, daemon=True).start()

# --- публичные API-токены ---
@app.route("/api/tokens", methods=["GET"])
@login_required
def tokens_list():
    rows = get_db().execute("SELECT id,label,created_at,last_used FROM api_tokens WHERE user_id=? ORDER BY id DESC",
                            (session["user"]["db_id"],)).fetchall()
    return jsonify(ok=True, tokens=[dict(r) for r in rows])

@app.route("/api/tokens", methods=["POST"])
@login_required
def tokens_create():
    label = ((request.get_json(silent=True) or {}).get("label") or "token")[:60]
    raw = "np_" + secrets.token_urlsafe(32)
    h = hashlib.sha256(raw.encode()).hexdigest()
    get_db().execute("INSERT INTO api_tokens(user_id,label,token_hash,created_at) VALUES(?,?,?,?)",
        (session["user"]["db_id"], label, h, datetime.now().isoformat(timespec="seconds")))
    get_db().commit()
    return jsonify(ok=True, token=raw, note="Показан один раз — сохраните его сейчас")

@app.route("/api/tokens/<int:tid>", methods=["DELETE"])
@login_required
def tokens_revoke(tid):
    db = get_db(); t = db.execute("SELECT id FROM api_tokens WHERE id=? AND user_id=?",(tid, session["user"]["db_id"])).fetchone()
    if not t: return jsonify(ok=False, error="not_found"), 404
    db.execute("DELETE FROM api_tokens WHERE id=?",(tid,)); db.commit(); return jsonify(ok=True)

# ============ ПУБЛИЧНЫЙ DEVELOPER API (/api/v1) ============
# Ключи создаются в Настройках → «Developer API». Используются с ЛЮБОГО сайта/скрипта:
#   fetch("https://ваш-netpulse/api/v1/ping?url=https://example.com",
#         {headers:{'X-NetPulse-Key':'npk_...'}})
# все эндпоинты API (для scope=all и карточек /api/v1, /api/v1/info)
DEV_ENDPOINTS = ["/info", "/ping?url=", "/status?url=", "/latency?host=&port=&n=",
                 "/speedtest/start?bytes=&downloads=&upload=true", "/speedtest/result?id=",
                 "/speed?bytes=&downloads=&upload=", "/trace?url=", "/dns?host=", "/whois?domain=",
                 "/search?q=", "/subnet?cidr=", "/units?v=&from=&to=", "/ip", "/uptime?url=&interval_sec="]
DEV_SCOPES = {"basic": ["ping", "status", "speed", "info"], "net": ["dns", "whois", "trace", "latency"],
              "search": ["search"],
              "all": ["ping", "status", "speed", "dns", "whois", "trace", "latency", "search",
                      "subnet", "units", "ip", "uptime", "info"]}

def _gen_key(env="test"):
    """sp-<env>-aj21ak-14ddad-3144d-3f4ffw — человекочитаемый ключ с префиксом окружения."""
    import secrets as _s
    h = lambda n: _s.token_hex((n+1)//2)[:n]
    return f"sp-{env}-{h(6)}-{h(6)}-{h(5)}-{h(6)}"

def _key_prefix(raw):
    """Маска для отображения в списке: sp-test-aj21…fw (реальный ключ не хранится)."""
    parts = raw.split("-")
    if len(parts) >= 6:
        return f"{parts[0]}-{parts[1]}-{parts[2][:4]}…{parts[-1][-2:]}"
    return raw[:10] + "…"

def _origin_ok(key_row, origin):
    ao = (key_row["allowed_origins"] or "*").strip()
    if ao in ("*", ""): return True
    allow = {o.strip().lower() for o in ao.split(",") if o.strip()}
    return origin.strip().lower() in allow

def _db_ready(db):
    try:
        db.execute("SELECT 1 FROM dev_keys LIMIT 1"); return True
    except sqlite3.Error:
        return False

def _env_key_row(raw):
    """Ключ из переменных окружения (API_KEYS) — работает даже без созданной БД."""
    parts = raw.split("-")
    env_name = parts[1] if len(parts) > 4 and parts[0] == "sp" else "test"
    return {"id": -1, "user_id": 0, "name": "env-key", "secret": "", "scopes": "basic,net,search",
            "active": 1, "rate_limit": 120, "created_at": "", "last_used": "", "calls": 0,
            "env": env_name, "allowed_origins": "*", "quota_day": 0, "revoked": 0,
            "note": "задан переменной окружения API_KEYS", "expires_at": "", "key_mask": raw[:14] + "…"}

def _dev_auth():
    """Ищет dev-ключ в заголовке X-NetPulse-Key / Authorization Bearer sp-… / ?key= (старый npk_ тоже принимается)"""
    raw = (request.headers.get("X-NetPulse-Key") or "").strip()
    if not raw:
        hdr = request.headers.get("Authorization","")
        if hdr.startswith("Bearer sp-") or hdr.startswith("Bearer npk_"): raw = hdr.split(None,1)[1].strip()
    if not raw: raw = (request.args.get("key") or "").strip()
    if not (raw.startswith("sp-") or raw.startswith("npk_")): return None, None
    db = get_db()
    if not _db_ready(db):                    # если хранилище ещё не инициализировано — создаём его на лету
        try:
            init_db(); db.execute("SELECT 1 FROM dev_keys LIMIT 1")
        except Exception as e:
            log.warning("auto init_db failed: %s", e)
    if raw in ENV_API_KEYS:                  # ключ из переменных окружения (для деплоя)
        return {"key": _env_key_row(raw), "user": {"id": 0, "name": "API", "email": ""}}, None
    h = hashlib.sha256(raw.encode()).hexdigest()
    k = db.execute("SELECT * FROM dev_keys WHERE key_hash=?", (h,)).fetchone()
    if not k or not k["active"] or k["revoked"]: return None, "invalid_key"
    if (k["expires_at"] or "") and k["expires_at"] < datetime.now().isoformat(timespec="seconds"):
        return None, "expired_key"
    origin = request.headers.get("Origin","").strip()   # CORS allow-list по Origin (если задан)
    if origin and not _origin_ok(k, origin): return None, "origin_denied"
    now_ms = int(time.time()*1000)
    if k["id"] == -1:                        # env-ключ: без счётчиков — сразу пропускаем
        return {"key": dict(k), "user": {"id": 0, "name": "API", "email": ""}}, None
    # rate limit: скользящее окно 60 сек
    cnt = db.execute("SELECT COUNT(*) c FROM key_usage WHERE key_id=? AND ts>?",
                     (k["id"], now_ms-60000)).fetchone()["c"]
    if cnt >= k["rate_limit"]: return None, "rate_limited"
    qd = k["quota_day"] or 0                              # дневная квота (quota_day>0)
    if qd:
        day_cnt = db.execute("SELECT COUNT(*) c FROM key_usage WHERE key_id=? AND ts>?",
                             (k["id"], now_ms - now_ms%86400000)).fetchone()["c"]
        if day_cnt >= qd: return None, "quota_exceeded"
    db.execute("INSERT INTO key_usage(key_id,ts) VALUES(?,?)", (k["id"], now_ms))
    db.execute("UPDATE dev_keys SET last_used=?, calls=calls+1 WHERE id=?",
               (datetime.now().isoformat(timespec="seconds"), k["id"]))
    db.commit()
    u = db.execute("SELECT id,name,email FROM users WHERE id=?", (k["user_id"],)).fetchone()
    if u is None:                            # пользователь удалён/не найден — не падаем (было dict(None))
        u = {"id": k["user_id"], "name": "API", "email": ""}
    return {"key": dict(k), "user": dict(u)}, None

def dev_required(fn):
    @wraps(fn)
    def w(*a, **k):
        auth, err = _dev_auth()
        if not auth:
            # «как у всех»: публичные диагностические эндпоинты работают и без ключа
            if public_allowed():
                g.dev = None
                return fn(*a, **k)
            # без ключа → 403 Forbidden (+подсказка), невалидный ключ → тоже 403,
            # лимиты/квоты → 429 Too Many Requests с заголовком Retry-After
            status = {"rate_limited": 429, "quota_exceeded": 429}.get(err, 403)
            hint = {"invalid_key":"Ключ не найден, выключен или отозван. Проверьте статус в Настройках → Developer API.",
                    "expired_key":"Срок действия ключа истёк — создайте новый или продлите в настройках ключа.",
                    "origin_denied":"Запрос с этого Origin запрещён настройкой «Разрешённые домены» ключа.",
                    "rate_limited":"Превышен лимит запросов в минуту (настройка ключа «Лимит»).",
                    "quota_exceeded":"Исчерпана дневная квота ключа (настройка «Дневная квота»).",
                    "missing_key":"Требуется API-ключ. Создайте его: сайт → Настройки → Developer API."}
            resp = jsonify(ok=False, error=err or "missing_key", code=status,
                           message="Forbidden: API key required" if status==403 else "Too Many Requests",
                           type={"rate_limited":"rate_limit_error","quota_exceeded":"rate_limit_error"
                                 }.get(err, "authentication_error"),
                           hint=hint.get(err, "Передайте ключ: заголовок 'X-NetPulse-Key: sp-test-…'"),
                           docs="/api/v1")
            r = make_response(resp); r.status_code = status
            if status == 429: r.headers["Retry-After"] = "60"
            if status == 403: r.headers["WWW-Authenticate"] = 'Bearer realm="NetPulse API", error="%s"' % (err or "missing_key")
            return r
        g.dev = auth
        try:
            return fn(*a, **k)
        except Exception as e:               # чтобы вместо «голой» 500 был понятный JSON
            log.exception("dev api %s failed", request.path)
            return jsonify(ok=False, error="server_error", code=500, detail=str(e)[:200]), 500
    return w

def public_allowed():
    """Без ключа разрешены только публичные диагностические эндпоинты (как health-check у всех)."""
    return request.path in ("/api/v1/ping", "/api/v1/status", "/api/v1/ip")

def _dev_scope(name):
    if g.dev is None:            # публичный вызов без ключа — разрешены только public_allowed() эндпоинты
        return None
    sc = (g.dev["key"]["scopes"] or "basic").split(",")
    allowed = [e for s in sc for e in DEV_SCOPES.get(s, [])]
    if name not in allowed:
        resp = jsonify(ok=False, error="insufficient_scope", scope=name, code=403,
                       message="Forbidden: insufficient scope",
                       hint="Добавьте scope '%s' при создании ключа (пересоздайте ключ)." %
                            next((s for s,e in DEV_SCOPES.items() if name in e), name))
        r = make_response(resp); r.status_code = 403
        r.headers["WWW-Authenticate"] = 'Bearer realm="NetPulse API", error="insufficient_scope"'
        return r
    return None

@app.route("/api/v1")
def dev_root():
    """Корень API — открытая карточка без ключа: что доступно и как подключиться."""
    return jsonify(ok=True, service="NetPulse Developer API", api_version="v1",
                   base_url="https://help.reallyvisuals.cloudpub.ru/api/v1",
                   auth={"header": "X-NetPulse-Key: sp-test-…",
                         "alt": "Authorization: Bearer sp-test-… или ?key=sp-test-…",
                         "where": "Создайте ключ: сайт → Настройки → Developer API"},
                   public_endpoints=["GET /api/v1 (эта карточка)", "GET /api/v1/ping?url=",
                                     "GET /api/v1/status?url=", "GET /api/v1/ip"],
                   endpoints=["/api/v1/info","/api/v1/ping?url=","/api/v1/status?url=",
                              "/api/v1/latency?host=&port=&n=","/api/v1/speedtest/start?bytes=&downloads=&upload=true",
                              "/api/v1/speedtest/result?id=","/api/v1/speed?bytes=&downloads=&upload=",
                              "/api/v1/trace?url=","/api/v1/dns?host=","/api/v1/whois?domain=",
                              "/api/v1/search?q=","/api/v1/subnet?cidr=","/api/v1/units?v=&from=&to=",
                              "/api/v1/ip","/api/v1/uptime?url=&interval_sec="],
                   example="curl -H 'X-NetPulse-Key: sp-test-…' https://help.reallyvisuals.cloudpub.ru/api/v1/ping?url=https://example.com")

@app.route("/api/v1/info")
@dev_required
def dev_info():
    denied = _dev_scope("info")
    if denied: return denied
    k = g.dev["key"]
    return jsonify(ok=True, key_name=k["name"], env=k["env"], scopes=k["scopes"].split(","),
                   rate_limit_per_min=k["rate_limit"], quota_day=k["quota_day"],
                   allowed_origins=(k["allowed_origins"] or "*").split(","),
                   expires_at=k["expires_at"] or None, total_calls=k["calls"],
                   owner=g.dev["user"].get("name"), api_version="v1",
                   base_url="https://help.reallyvisuals.cloudpub.ru/api/v1",
                   auth_header="X-NetPulse-Key: sp-test-… (или Authorization: Bearer sp-…)",
                   endpoints=["/api/v1/info","/api/v1/ping?url=","/api/v1/status?url=",
                              "/api/v1/latency?host=&port=&n=","/api/v1/speed?bytes=&downloads=&upload=",
                              "/api/v1/trace?url=",
                              "/api/v1/dns?host=","/api/v1/whois?domain=","/api/v1/search?q=",
                              "/api/v1/subnet?cidr=","/api/v1/units?v=&from=&to=",
                              "/api/v1/ip","/api/v1/uptime?url=&interval_sec="],
                   services=["speedtest (наш спидтест через Cloudflare edge)", "ping", "latency/jitter",
                             "traceroute", "dns", "whois", "google search", "subnet calculator",
                             "unit converter", "ip info", "uptime monitoring"])

# ---------- СПИДТЕСТ ЧЕРЕЗ API (asynchronous, как у нормальных провайдеров) ----------
# POST/GET /api/v1/speedtest/start  → id задания; сервер измеряет down/up/ping в фоне
# GET  /api/v1/speedtest/result?id= → статус queued|running|done|error и метрики
SPEED_JOBS = {}

def _speed_job(job_id, mb, conns, do_up):
    """Фоновое выполнение спидтеста для задания job_id."""
    SPEED_JOBS[job_id]["status"] = "running"
    payload = b"\0" * (mb * 1_000_000)
    from concurrent.futures import ThreadPoolExecutor
    def dl(_i):
        t0 = time.perf_counter()
        try:
            r = http_lib.get(f"https://speed.cloudflare.com/__down?bytes={mb*1_000_000}&r={time.time():.6f}{_i}",
                             stream=True, timeout=30, headers={"User-Agent": "NetPulseAPI/1.0"})
            got = 0
            for chunk in r.iter_content(65536):
                got += len(chunk)
            dt = time.perf_counter() - t0
            return round(got * 8 / dt / 1e6, 1) if dt > 0 else 0.0
        except Exception:
            return None
    try:
        with ThreadPoolExecutor(max_workers=conns) as ex:
            results = [x for x in ex.map(dl, range(conns)) if x is not None]
        down = round(sum(results)/len(results), 1) if results else 0.0
        up = None
        if do_up:
            try:
                t0 = time.perf_counter()
                http_lib.post("https://speed.cloudflare.com/__up", data=payload[:2_000_000],
                              timeout=30, headers={"User-Agent": "NetPulseAPI/1.0"})
                dt = time.perf_counter() - t0
                up = round(2_000_000 * 8 / dt / 1e6, 1) if dt > 0 else 0.0
            except Exception:
                up = None
        ping = None
        try:
            t0 = time.perf_counter()
            http_lib.head("https://speed.cloudflare.com/meta", timeout=10)
            ping = round((time.perf_counter()-t0)*1000, 1)
        except Exception:
            pass
        SPEED_JOBS[job_id].update(status="done", download_mbps=down, upload_mbps=up, ping_ms=ping,
                                  finished_at=datetime.now().isoformat(timespec="seconds"))
    except Exception as e:
        SPEED_JOBS[job_id].update(status="error", error=str(e)[:200])

@app.route("/api/v1/speedtest/start", methods=["GET", "POST"])
@dev_required
def dev_speedtest_start():
    denied = _dev_scope("speed")
    if denied: return denied
    mb   = min(max(int(request.values.get("bytes", 5)), 1), 25)
    conns= min(max(int(request.values.get("downloads", 3)), 1), 6)
    do_up= str(request.values.get("upload", "false")).lower() in ("1","true","yes")
    # держим не более ~50 заданий: чистим старые завершённые
    if len(SPEED_JOBS) > 50:
        for jid, v in list(SPEED_JOBS.items()):
            if v["status"] in ("done","error"): SPEED_JOBS.pop(jid, None)
    import uuid as _u
    jid = _u.uuid4().hex[:12]
    SPEED_JOBS[jid] = {"id": jid, "status": "queued", "streams": conns, "sample_mb": mb,
                       "upload": do_up, "created_at": datetime.now().isoformat(timespec="seconds")}
    threading.Thread(target=_speed_job, args=(jid, mb, conns, do_up), daemon=True).start()
    return jsonify(ok=True, id=jid, status="queued",
                   poll="/api/v1/speedtest/result?id=%s" % jid,
                   hint="Опрашивайте result каждые 2 сек до status=done")

@app.route("/api/v1/speedtest/result")
@dev_required
def dev_speedtest_result():
    denied = _dev_scope("speed")
    if denied: return denied
    jid = (request.args.get("id") or "").strip()
    job = SPEED_JOBS.get(jid)
    if not job: return jsonify(ok=False, error="job_not_found", hint="Сначала вызовите /api/v1/speedtest/start"), 404
    return jsonify(ok=True, **job)

@app.route("/api/v1/ping")
@dev_required
def dev_ping():
    denied = _dev_scope("ping")
    if denied: return denied
    url = (request.args.get("url") or "").strip()
    host = (request.args.get("host") or "").strip()
    if url and not URL_RE.match(url): return jsonify(ok=False, error="bad_url"), 400
    t0=time.perf_counter()
    try:
        import socket
        if url:
            r = http_lib.head(url, timeout=8, allow_redirects=True, headers={"User-Agent":"NetPulseAPI/1.0"})
            lat=(time.perf_counter()-t0)*1000
            return jsonify(ok=True, target=url, reachable=True, status=r.status_code, latency_ms=round(lat,1))
        ip = socket.gethostbyname(host)
        s = socket.create_connection((ip, int(request.args.get("port", 80))), timeout=5); s.close()
        return jsonify(ok=True, target=host, ip=ip, reachable=True,
                       latency_ms=round((time.perf_counter()-t0)*1000,1))
    except Exception as e:
        return jsonify(ok=True, target=url or host, reachable=False, error=str(e)[:200])

@app.route("/api/v1/status")
@dev_required
def dev_status():
    denied = _dev_scope("status")
    if denied: return denied
    url = (request.args.get("url") or "").strip()
    if not URL_RE.match(url): return jsonify(ok=False, error="bad_url"), 400
    res = _check_url(url)
    return jsonify(ok=True, url=url, **res)

@app.route("/api/v1/latency")
@dev_required
def dev_latency():
    """Задержка до узла: несколько замеров → avg/min/max/jitter."""
    denied = _dev_scope("latency")
    if denied: return denied
    host = (request.args.get("host") or "").strip()
    port = int(request.args.get("port", 80))
    n = min(int(request.args.get("n", 5)), 10)
    if not host: return jsonify(ok=False, error="bad_host"), 400
    import socket
    try:
        ip = socket.gethostbyname(host)
    except Exception as e:
        return jsonify(ok=False, error=f"dns: {str(e)[:120]}"), 422
    samples = []
    for _ in range(n):
        t0 = time.perf_counter()
        try:
            s = socket.create_connection((ip, port), timeout=5); s.close()
            samples.append(round((time.perf_counter()-t0)*1000, 1))
        except Exception:
            pass
    if not samples:
        return jsonify(ok=True, host=host, ip=ip, reachable=False)
    return jsonify(ok=True, host=host, ip=ip, reachable=True, samples=samples,
                   avg_ms=round(sum(samples)/len(samples),1), min_ms=min(samples),
                   max_ms=max(samples), jitter_ms=round(max(samples)-min(samples),1))

@app.route("/api/v1/speed")
@dev_required
def dev_speed():
    """Серверный замер скорости канала через edge-узлы Cloudflare Speed.
       ?bytes=1..25 МБ · downloads=N потоков · upload=true|false"""
    denied = _dev_scope("speed")
    if denied: return denied
    mb = min(max(int(request.args.get("bytes", 5)), 1), 25)
    conns = min(max(int(request.args.get("downloads", 3)), 1), 6)
    do_up = (request.args.get("upload") or "false").lower() in ("1", "true", "yes")
    payload = b"\0" * (mb * 1_000_000)
    from concurrent.futures import ThreadPoolExecutor
    def dl(_i):
        t0 = time.perf_counter()
        r = http_lib.get(f"https://speed.cloudflare.com/__down?bytes={mb*1_000_000}&r={time.time():.6f}{_i}",
                         stream=True, timeout=30, headers={"User-Agent": "NetPulseAPI/1.0"})
        got = 0
        for chunk in r.iter_content(65536):
            got += len(chunk)
        dt = time.perf_counter() - t0
        return round(got * 8 / dt / 1e6, 1) if dt > 0 else 0.0
    results = []
    try:
        with ThreadPoolExecutor(max_workers=conns) as ex:
            results = list(ex.map(dl, range(conns)))
    except Exception as e:
        return jsonify(ok=False, error=f"download failed: {str(e)[:150]}"), 502
    down_mbps = round(sum(results) / len(results), 1) if results else 0.0
    up_mbps = None
    if do_up:
        try:
            t0 = time.perf_counter()
            http_lib.post("https://speed.cloudflare.com/__up", data=payload[:2_000_000],
                          timeout=30, headers={"User-Agent": "NetPulseAPI/1.0"})
            dt = time.perf_counter() - t0
            up_mbps = round(2_000_000 * 8 / dt / 1e6, 1) if dt > 0 else 0.0
        except Exception:
            up_mbps = None
    # заодно измерим задержку до edge
    t0 = time.perf_counter()
    try:
        http_lib.head("https://speed.cloudflare.com/meta", timeout=10)
        ping = round((time.perf_counter()-t0)*1000, 1)
    except Exception:
        ping = None
    return jsonify(ok=True, method="server-side cloudflare-edge",
                   download_mbps=down_mbps, upload_mbps=up_mbps, ping_ms=ping,
                   streams=conns, sample_mb=mb)

@app.route("/api/v1/trace")
@dev_required
def dev_trace():
    """Трассировка пути HTTP-hop по edge-узлам Cloudflare (аналог раздела «Трассировка» сайта)."""
    denied = _dev_scope("trace")
    if denied: return denied
    target = (request.args.get("url") or request.args.get("host") or "").strip()
    if target and not target.startswith("http"):
        target = "https://" + target
    if not target: return jsonify(ok=False, error="bad_target"), 400
    hops = []
    try:
        r = http_lib.get(target, timeout=15, allow_redirects=False,
                         headers={"User-Agent": "NetPulseAPI/1.0"})
        loc = r.headers.get("Location", "")
        cf_ray = r.headers.get("Cf-Ray", "")
        hops.append({"hop": 1, "status": r.status_code, "location": loc[:200],
                     "colo": (cf_ray.split(".")[-1] if "." in cf_ray else "?"),
                     "ray": cf_ray[:40]})
    except Exception as e:
        return jsonify(ok=False, error=str(e)[:150]), 502
    return jsonify(ok=True, target=target, hops=hops, note="HTTP-trace через CDN edge")

@app.route("/api/v1/dns")
@dev_required
def dev_dns():
    denied = _dev_scope("dns")
    if denied: return denied
    host = (request.args.get("host") or "").strip()
    if not re.match(r"^[A-Za-z0-9.\-]{1,253}$", host): return jsonify(ok=False, error="bad_host"), 400
    import socket
    recs = {}
    try:
        infos = socket.getaddrinfo(host, None)
        recs["A"]  = sorted({i[4][0] for i in infos if i[0]==socket.AF_INET})
        recs["AAAA"]= sorted({i[4][0] for i in infos if i[0]==socket.AF_INET6})
    except Exception as e:
        return jsonify(ok=True, host=host, error=str(e)[:200], records={})
    return jsonify(ok=True, host=host, records=recs)

@app.route("/api/v1/whois")
@dev_required
def dev_whois():
    denied = _dev_scope("whois")
    if denied: return denied
    domain = (request.args.get("domain") or "").strip().lower()
    if not re.match(r"^[a-z0-9.\-]{2,253}$", domain): return jsonify(ok=False, error="bad_domain"), 400
    try:
        import whois
        w = whois.whois(domain)
        d = {k: (v.isoformat() if hasattr(v,"isoformat") else v)
             for k,v in (w.__dict__ if hasattr(w,"__dict__") else {}).items() if v}
        return jsonify(ok=True, domain=domain, whois=d)
    except ImportError:
        return jsonify(ok=False, error="whois_not_installed", hint="pip install python-whois"), 501
    except Exception as e:
        return jsonify(ok=False, domain=domain, error=str(e)[:200])

@app.route("/api/v1/search")
@dev_required
def dev_search():
    denied = _dev_scope("search")
    if denied: return denied
    key, cx = genv("GOOGLE_SEARCH_API_KEY"), genv("GOOGLE_SEARCH_CX")
    if not key or not cx:
        return jsonify(ok=False, error="search_not_configured",
                       hint="На сервере не заполнены GOOGLE_SEARCH_API_KEY/CX в .env"), 503
    q = (request.args.get("q") or "").strip()[:200]
    if not q: return jsonify(ok=False, error="empty_query"), 400
    params = {"key": key, "cx": cx, "q": q, "num": min(10,int(request.args.get("num",10) or 10)), "safe":"active"}
    if request.args.get("mode") == "image": params["searchType"]="image"
    r = http_lib.get("https://www.googleapis.com/customsearch/v1", params=params, timeout=15)
    data = r.json()
    items = [{"title":i["title"],"link":i["link"],"snippet":i.get("snippet","")}
             for i in data.get("items",[])]
    return jsonify(ok=True, query=q, count=len(items), results=items)

@app.route("/api/v1/subnet")
@dev_required
def dev_subnet_api():
    denied = _dev_scope("subnet")
    if denied: return denied
    cidr = (request.args.get("cidr") or "").strip()
    m = re.match(r"^(\d{1,3}(?:\.\d{1,3}){3})/(\d{1,2})$", cidr)
    if not m: return jsonify(ok=False, error="bad_cidr", example="192.168.1.10/24"), 400
    import ipaddress
    try: net = ipaddress.ip_network(f"{m.group(1)}/{m.group(2)}", strict=False)
    except ValueError as e: return jsonify(ok=False, error=str(e)), 400
    hosts = list(net.hosts())
    return jsonify(ok=True, cidr=str(net), network=str(net.network_address),
                   netmask=str(net.netmask), broadcast=str(net.broadcast_address),
                   prefixlen=net.prefixlen, total_addresses=net.num_addresses,
                   usable_hosts=max(0, net.num_addresses-2),
                   first_host=str(hosts[0]) if hosts else None,
                   last_host=str(hosts[-1]) if hosts else None)

@app.route("/api/v1/units")
@dev_required
def dev_units_api():
    denied = _dev_scope("units")
    if denied: return denied
    val = request.args.get("v"); frm = request.args.get("from","mbps"); to = request.args.get("to","auto")
    try: val=float(val)
    except (TypeError,ValueError): return jsonify(ok=False, error="bad_value"), 400
    SPEED={"bps":1,"kbps":1e3,"mbps":1e6,"gbps":1e9,"MB/s":8e6,"KB/s":8e3}
    SIZE={"B":1,"KB":1024,"MB":1024**2,"GB":1024**3,"TB":1024**4}
    table = SPEED if frm in SPEED else SIZE
    if frm not in table: return jsonify(ok=False, error="bad_unit", units=list(table)), 400
    base = val*table[frm]
    out = {u: base/t for u,t in table.items()}
    if to=="auto":
        u=list(table); i=0
        while i<len(u)-1 and out[u[i]]>=1000*(1024 if table is SIZE else 1): i+=1
        best=u[i]
        return jsonify(ok=True, value=val, unit=frm, result=round(out[best],4), best_unit=best, all=out)
    if to not in table: return jsonify(ok=False, error="bad_target"), 400
    return jsonify(ok=True, value=val, unit=frm, to=to, result=round(out[to],6))

@app.route("/api/v1/ip")
@dev_required
def dev_ip():
    fwd = request.headers.get("X-Forwarded-For","")
    client = (fwd.split(",")[0].strip() if fwd else request.remote_addr) or ""
    geo=None
    if request.args.get("geo")=="1" and client:
        try: geo = http_lib.get(f"http://ip-api.com/json/{client}?fields=status,country,regionName,city,isp", timeout=6).json()
        except Exception: pass
    return jsonify(ok=True, ip=client, user_agent=request.headers.get("User-Agent","")[:200], geo=geo)

@app.route("/api/v1/uptime", methods=["GET"])
@dev_required
def dev_uptime_get():
    denied = _dev_scope("status")
    if denied: return denied
    uid = g.dev["user"]["id"]; db = get_db()
    mons = db.execute("SELECT id,url,name,interval_sec,enabled FROM monitors WHERE user_id=?",(uid,)).fetchall()
    out=[]
    for mo in mons:
        st = db.execute("SELECT COUNT(*) c, SUM(ok) up FROM monitor_results WHERE monitor_id=? AND ts>?",
                        (mo["id"], int(time.time()*1000)-86400000)).fetchone()
        last = db.execute("SELECT ok,status,latency_ms,ts FROM monitor_results WHERE monitor_id=? ORDER BY ts DESC LIMIT 1",(mo["id"],)).fetchone()
        out.append({**dict(mo), "uptime_24h": round(100*st["up"]/st["c"],2) if st["c"] else None,
                    "checks_24h": st["c"], "last": dict(last) if last else None})
    return jsonify(ok=True, monitors=out)

@app.route("/api/v1/uptime", methods=["POST"])
@dev_required
def dev_uptime_add():
    denied = _dev_scope("status")
    if denied: return denied
    d = request.values if request.method=="POST" and request.is_json is False else (request.get_json(silent=True) or request.values)
    url = (d.get("url") or "").strip()
    if not URL_RE.match(url): return jsonify(ok=False, error="bad_url"), 400
    interval = max(60, min(3600, int(d.get("interval_sec", 300) or 300)))
    db = get_db()
    cur = db.execute("INSERT INTO monitors(user_id,url,name,interval_sec,created_at) VALUES(?,?,?,?,?)",
        (g.dev["user"]["id"], url, (d.get("name") or url)[:80], interval, datetime.now().isoformat(timespec="seconds")))
    db.commit(); mid = cur.lastrowid
    res = _check_url(url); now=int(time.time()*1000)
    db.execute("INSERT INTO monitor_results(monitor_id,ts,ok,status,latency_ms,error) VALUES(?,?,?,?,?,?)",
        (mid, now, 1 if res["ok"] else 0, res["status"], res["latency_ms"], res.get("error")))
    db.execute("UPDATE monitors SET last_check=? WHERE id=?",(now,mid)); db.commit()
    return jsonify(ok=True, id=mid, result=res)


# ============ БОТ-ПОМОЩНИК — бэкенд генерации текста (без ключей) ============
# Модель задаётся в .env: ASSISTANT_MODEL (по умолчанию openai)
# адреса текстовых бэкендов помощника (в основном из .env; запасные — на случай сбоя основного)
ASSISTANT_FALLBACK_URLS = [
    "https://text.pollinations.ai/openai",
    "https://syntho.pollinations.ai/openai",
]

def assistant_api_urls():
    raw = genv("ASSISTANT_API_URL") or ""
    urls = [u.strip() for u in raw.split(",") if u.strip()]
    for fb in ASSISTANT_FALLBACK_URLS:
        if fb not in urls:
            urls.append(fb)
    return urls


class _AssistantSession(http_lib.Session):
    """Отдельная сессия с keep-alive и повторными попытками на уровне соединения.
    При обрыве TLS (SSLEOFError / ProtocolError) requests внутри urllib3 не
    переиспользует «протухшее» соединение — каждое новое обращение получает свежий коннект."""

    def __init__(self):
        super().__init__()
        retry = Retry(total=3, connect=3, read=2, backoff_factor=0.6,
                      status_forcelist=[], allowed_methods=frozenset(["GET", "POST"]),
                      raise_on_status=False)
        adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=8)
        self.mount("https://", adapter)
        self.mount("http://", adapter)


_assistant_http = None

def _assistant_client():
    global _assistant_http
    if _assistant_http is None:
        _assistant_http = _AssistantSession()
    return _assistant_http

ASSISTANT_SYSTEM_PROMPT = (
    "Ты — Палс, встроенный помощник сайта NetPulse (сервис проверки скорости интернета, "
    "пинга, трассировки, DNS, Wi-Fi аналитики, поиска Google, истории измерений, "
    "мониторинга доступности сайтов uptime и Developer API).\n"
    "Разделы сайта: Спидтест (главная, кнопка «Старт», live-график), Пинг, Трассировка, DNS, "
    "Wi-Fi (анализ каналов 2.4/5/6 ГГц), Поиск (web/images), История (экспорт JSON/CSV), "
    "Мониторинг (URL-проверки каждые N секунд, аптайм за 24ч, уведомления при падении), "
    "Настройки (профиль, Developer API ключи вида sp-test-… или sp-live-…, scopes basic/net/search, "
    "лимит запросов в минуту, дневная квота, разрешённые Origin, срок действия, отзыв/ротация ключей), "
    "О проекте. Вход — только через Google.\n"
    "Developer API (публичный, как у OpenAI): базовый адрес https://help.reallyvisuals.cloudpub.ru , "
    "эндпоинты: GET /api/v1/info|ping?url=|status?url=|latency?host=&port=&n=|speed?bytes=&downloads=&upload=|"
    "trace?url=|dns?host=|whois?domain=|search?q=&mode=|subnet?cidr=|units?v=&from=&to=|ip|uptime; "
    "POST /api/v1/uptime {url,interval_sec}. Спидтест через API — асинхронный: "
    "GET/POST /api/v1/speedtest/start?bytes=1..25&downloads=1..6&upload=true → вернёт id задания, "
    "затем опрашивать GET /api/v1/speedtest/result?id= каждые ~2 сек до status=done (download_mbps, upload_mbps, ping_ms). "
    "Без ключа работают только публичные эндпоинты: карточка /api/v1, /api/v1/ping, /api/v1/status и /api/v1/ip; "
    "остальные требуют ключ и вернут 403 Forbidden с подсказкой, при превышении лимита — 429 Too Many Requests. "
    "Ключ передаётся заголовком 'X-NetPulse-Key: sp-test-…' (или 'Authorization: Bearer sp-…'). "
    "CORS открыт — можно вызывать fetch() прямо со сторонних сайтов.\n"
    "Через API доступны ВСЕ наши сервисы: спидтест (/api/v1/speedtest/start+result или быстрый синхронный /api/v1/speed — серверный замер скорости через "
    "Cloudflare edge, параметры bytes=1..25 МБ, downloads=1..6 потоков, upload=true → download_mbps, "
    "upload_mbps, ping_ms), пинг и задержка (/api/v1/ping, /api/v1/latency с avg/min/max/jitter), "
    "трассировка (/api/v1/trace), DNS, WHOIS, поиск Google, калькулятор подсетей, конвертер единиц, "
    "IP-инфо и uptime-мониторинг. Если пользователь хочет использовать наш спидтест или сеть-сервисы "
    "на своём сайте — покажи пример с нужным эндпоинтом.\n"
    "Пример для пользователя (показывай кодом):\n"
    "```js\n// спидтест через наш API (асинхронно: старт + опрос результата)\nconst H={headers:{'X-NetPulse-Key':'sp-test-ВАШ_КЛЮЧ'}};\n"
    "const st = await fetch('https://help.reallyvisuals.cloudpub.ru/api/v1/speedtest/start?bytes=10&downloads=4&upload=true',H).then(r=>r.json());\n"
    "let res; do { await new Promise(x=>setTimeout(x,2000));\n"
    "  res = await fetch('https://help.reallyvisuals.cloudpub.ru/api/v1/speedtest/result?id='+st.id,H).then(r=>r.json());\n"
    "} while(res.status!=='done' && res.status!=='error');\nconsole.log(res); // download_mbps, upload_mbps, ping_ms\n"
    "// пинг до сайта (работает даже без ключа)\nconst p = await fetch('https://help.reallyvisuals.cloudpub.ru/api/v1/ping?url=https://example.com');\nconsole.log((await p.json()));\n```\n"
    "ФОРМАТИРОВАНИЕ ОТВЕТОВ (обязательно): пиши в лёгком Markdown — **жирный** для важного, "
    "*курсив* для акцентов, `код/команды/URL` в обратных кавычках, списки через «- ». "
    "Любой код (JS, curl, Python, JSON) оформляй fenced-блоками с указанием языка:\n"
    "```js\n...\n```\nИнтерфейс сайта отрисует жирный шрифт и блоки кода с кнопкой «Копировать». "
    "Не используй таблицы и HTML-теги.\n"
    "Отвечай кратко (до ~150 слов) по-русски, дружелюбно, шаг за шагом. Если вопрос не про NetPulse, "
    "сеть или компьютеры — вежливо откажи и верни тему. Не выдумывай функции, которых нет."
)

def assistant_available():
    # Публичный API без ключа: «доступен» всегда
    return True

def _assistant_call(history, user_text):
    model = genv("ASSISTANT_MODEL", "openai")
    messages = [{"role": "system", "content": ASSISTANT_SYSTEM_PROMPT}]
    for m in history[-10:]:
        role = "assistant" if m["role"] == "assistant" else "user"
        messages.append({"role": role, "content": m["text"]})
    messages.append({"role": "user", "content": user_text})
    payload = {"messages": messages, "model": model, "referrer": "netpulse",
               "seed": int(time.time()) % 100000,
               "temperature": 0.5, "max_tokens": 700}
    last_err = None
    client = _assistant_client()
    # пробуем каждый адрес до 2 раз; при сетевых/SSL-сбоях переключаемся на следующий
    for url in assistant_api_urls():
        for attempt in range(2):
            try:
                r = client.post(url, json=payload, timeout=(10, 40))
                try:
                    data = r.json()
                except ValueError:
                    data = {}
                if r.status_code == 200:
                    choice = (data.get("choices") or [{}])[0]
                    txt = ((choice.get("message") or {}).get("content") or "").strip()
                    if not txt:
                        txt = (data.get("text") or "").strip()  # редкий fallback-формат
                    if txt:
                        return txt
                    last_err = "пустой ответ модели"
                else:
                    err = (data.get("error") or data.get("message") or f"HTTP {r.status_code}")
                    if isinstance(err, dict): err = err.get("message", str(err))
                    last_err = str(err)[:200]
                    if r.status_code in (401, 403, 404):
                        break  # адрес не годится — сразу на следующий
            except (http_lib.exceptions.RequestException, OSError) as e:
                last_err = type(e).__name__
                log.warning("assistant backend %s attempt %d: %s", url, attempt + 1, e)
                time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"Помощник временно недоступен (сетевой сбой). Повторите вопрос через пару секунд. [{str(last_err)[:80]}]")


def _assistant_stream(history, user_text):
    """Генератор: отдаёт текст ответа по мере написания (SSE-стриминг).
    Пробует адреса из assistant_api_urls(); первый же успешный стримится до конца."""
    model = genv("ASSISTANT_MODEL", "openai")
    messages = [{"role": "system", "content": ASSISTANT_SYSTEM_PROMPT}]
    for m in history[-10:]:
        role = "assistant" if m["role"] == "assistant" else "user"
        messages.append({"role": role, "content": m["text"]})
    messages.append({"role": "user", "content": user_text})
    payload = {"messages": messages, "model": model, "referrer": "netpulse",
               "seed": int(time.time()) % 100000,
               "temperature": 0.5, "max_tokens": 700, "stream": True}
    client = _assistant_client()
    last_err = None
    for url in assistant_api_urls():
        got = False
        try:
            with client.post(url, json=payload, timeout=(10, 60), stream=True) as r:
                if r.status_code != 200:
                    last_err = f"HTTP {r.status_code}"
                    continue
                ctype = r.headers.get("Content-Type", "")
                if "event-stream" not in ctype and "ndjson" not in ctype and "json" in ctype:
                    # сервер проигнорировал stream=true — работаем как с обычным JSON
                    data = r.json()
                    choice = (data.get("choices") or [{}])[0]
                    txt = ((choice.get("message") or {}).get("content") or "").strip()
                    if txt:
                        yield txt; return
                    last_err = "пустой ответ модели"; continue
                buf = b""
                for chunk in r.iter_content(1024):
                    if not chunk: continue
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        line = line.strip()
                        if not line.startswith(b"data:"): continue
                        data = line[5:].strip()
                        if data == b"[DONE]":
                            if got: return
                            break
                        try:
                            j = json.loads(data.decode("utf-8", "ignore"))
                        except ValueError:
                            continue
                        d = ""
                        try:
                            ch = (j.get("choices") or [{}])[0]
                            d = ((ch.get("delta") or {}).get("content")
                                 or (ch.get("message") or {}).get("content") or "")
                        except AttributeError:
                            d = ""
                        if d:
                            got = True
                            yield d
                if got: return
        except (http_lib.exceptions.RequestException, OSError) as e:
            last_err = type(e).__name__
            log.warning("assistant stream %s: %s", url, e)
            if got:   # часть текста уже отправлена — не переключаем адрес
                return
    yield "\n\n⚠ Сервис помощника сейчас недоступен. Попробуйте ещё раз через 10–20 секунд."


@app.route("/api/chat/stream", methods=["POST"])
@login_required
def chat_stream():
    d = request.get_json(silent=True) or {}
    text = (d.get("text") or "").strip()[:900]
    if not text: return jsonify(ok=False, error="empty"), 400
    db = get_db(); uid = session["user"]["db_id"]; now = int(time.time()*1000)
    db.execute("INSERT INTO chat_messages(user_id,ts,role,text) VALUES(?,?,?,?)", (uid, now, "user", text))
    db.commit()

    def gen():
        full = []
        # отдельное соединение: контекст запроса закрывается до окончания стрима
        try:
            conn = sqlite3.connect(DB_PATH); conn.row_factory = sqlite3.Row
            history = [dict(r) for r in conn.execute(
                "SELECT role,text FROM chat_messages WHERE user_id=? ORDER BY ts DESC LIMIT 11",
                (uid,)).fetchall()][::-1][:-1]
        except Exception:
            conn = None; history = []
        try:
            for piece in _assistant_stream(history, text):
                full.append(piece)
                yield "d" + json.dumps({"t": piece}, ensure_ascii=False) + "\n"
        except Exception as e:
            log.warning("chat stream error: %s", e)
            yield "d" + json.dumps({"t": "⚠ Сервис помощника сейчас недоступен — попробуйте ещё раз через 10–20 секунд."}, ensure_ascii=False) + "\n"
        reply = "".join(full).strip()
        if reply and conn is not None:
            try:
                conn.execute("INSERT INTO chat_messages(user_id,ts,role,text) VALUES(?,?,?,?)",
                             (uid, int(time.time()*1000), "assistant", reply))
                conn.commit()
            except Exception as e:
                log.warning("chat save error: %s", e)
        if conn is not None:
            try: conn.close()
            except Exception: pass
        yield "e" + json.dumps({"ok": bool(reply)}) + "\n"

    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/chat", methods=["POST"])
@login_required
def chat_send():
    d = request.get_json(silent=True) or {}
    text = (d.get("text") or "").strip()[:900]
    if not text: return jsonify(ok=False, error="empty"), 400
    db = get_db(); uid = session["user"]["db_id"]; now = int(time.time()*1000)
    db.execute("INSERT INTO chat_messages(user_id,ts,role,text) VALUES(?,?,?,?)", (uid, now, "user", text))
    db.commit()
    if not assistant_available():
        reply = "🤖 Помощник временно недоступен."
        status = 503
    else:
        try:
            history = [dict(r) for r in db.execute(
                "SELECT role,text FROM chat_messages WHERE user_id=? ORDER BY ts DESC LIMIT 11",
                (uid,)).fetchall()][::-1][:-1]
            reply = _assistant_call(history, text); status = 200
        except Exception as e:
            log.warning("chat backend error: %s", e)
            # не показываем пользователю технические детали (URL, стектрейсы)
            reply = ("⚠ Сервис помощника сейчас недоступен — это внешняя сеть, "
                     "а не ваш аккаунт. Попробуйте ещё раз через 10–20 секунд "
                     "(или отправьте вопрос повторно чуть позже).")
            status = 503
    db.execute("INSERT INTO chat_messages(user_id,ts,role,text) VALUES(?,?,?,?)", (uid, int(time.time()*1000), "assistant", reply))
    db.commit()
    return jsonify(ok=status==200, reply=reply), status

@app.route("/api/chat", methods=["GET"])
@login_required
def chat_get():
    rows = get_db().execute("SELECT ts,role,text FROM chat_messages WHERE user_id=? ORDER BY ts ASC LIMIT 200",
                            (session["user"]["db_id"],)).fetchall()
    return jsonify(ok=True, messages=[dict(r) for r in rows], assistant_ready=assistant_available())

@app.route("/api/chat", methods=["DELETE"])
@login_required
def chat_clear():
    get_db().execute("DELETE FROM chat_messages WHERE user_id=?", (session["user"]["db_id"],))
    get_db().commit(); return jsonify(ok=True)

# --- управление dev-ключами (нужен вход через Google, cookies) ---
@app.route("/api/devkeys", methods=["GET"])
@login_required
def devkeys_list():
    rows = get_db().execute(
        "SELECT id,name,key_prefix,scopes,active,rate_limit,created_at,last_used,calls,"
        "env,allowed_origins,quota_day,revoked,note,expires_at FROM ("
        "SELECT *, COALESCE(NULLIF(key_mask,''),'sp-***') key_prefix FROM dev_keys WHERE user_id=?) ORDER BY id DESC",
        (session["user"]["db_id"],)).fetchall()
    return jsonify(ok=True, keys=[dict(r) for r in rows])

@app.route("/api/devkeys", methods=["POST"])
@login_required
def devkeys_create():
    d = request.get_json(silent=True) or {}
    name = (d.get("name") or "api key")[:60]
    env  = d.get("env") if d.get("env") in ("test","live") else "test"
    scopes = d.get("scopes") or ["basic"]
    if isinstance(scopes, str): scopes = [x for x in scopes.split(",") if x]
    scopes = [s for s in scopes if s in DEV_SCOPES] or ["basic"]
    rl = max(5, min(600, int(d.get("rate_limit", 60) or 60)))
    quota_day = max(0, min(1_000_000, int(d.get("quota_day", 0) or 0)))
    origins = d.get("allowed_origins") or "*"
    if isinstance(origins, list): origins = ",".join(origins)
    origins = origins.strip() or "*"
    expires_days = int(d.get("expires_days", 0) or 0)
    expires_at = (datetime.now() + timedelta(days=expires_days)).isoformat(timespec="seconds") if expires_days > 0 else ""
    note = (d.get("note") or "")[:140]
    raw = _gen_key(env); secret = secrets.token_hex(16)
    h = hashlib.sha256(raw.encode()).hexdigest()
    get_db().execute(
        "INSERT INTO dev_keys(user_id,name,key_hash,key_mask,secret,scopes,rate_limit,env,"
        "allowed_origins,quota_day,expires_at,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (session["user"]["db_id"], name, h, _key_prefix(raw), secret, ",".join(scopes), rl, env,
         origins, quota_day, expires_at, note, datetime.now().isoformat(timespec="seconds")))
    get_db().commit()
    return jsonify(ok=True, key=raw, secret=secret, env=env,
                   note="Ключ показан ОДИН раз — сохраните его сейчас")

@app.route("/api/devkeys/<int:kid>", methods=["PATCH"])
@login_required
def devkeys_update(kid):
    d = request.get_json(silent=True) or {}
    db = get_db(); k = db.execute("SELECT * FROM dev_keys WHERE id=? AND user_id=?", (kid, session["user"]["db_id"])).fetchone()
    if not k: return jsonify(ok=False, error="not_found"), 404
    sets, args = [], []
    if "name"   in d: sets.append("name=?");        args.append((d["name"] or k["name"])[:60])
    if "note"   in d: sets.append("note=?");        args.append((d["note"] or "")[:140])
    if "rate_limit" in d: sets.append("rate_limit=?"); args.append(max(5, min(600, int(d["rate_limit"] or 60))))
    if "quota_day"  in d: sets.append("quota_day=?");  args.append(max(0, min(1_000_000, int(d["quota_day"] or 0))))
    if "active"     in d: sets.append("active=?");     args.append(1 if d["active"] else 0)
    if "env" in d and d["env"] in ("test","live"):
        # окружение зашито в префикс ключа — смена env требует перевыпуска
        return jsonify(ok=False, error="env_immutable",
                       hint="Окружение (test/live) задаётся при создании. Для смены — создайте новый ключ."), 400
    if "allowed_origins" in d:
        o = d["allowed_origins"]
        if isinstance(o, list): o = ",".join(o)
        sets.append("allowed_origins=?"); args.append((o or "*").strip() or "*")
    if "scopes" in d:
        sc = d["scopes"]
        if isinstance(sc, str): sc = [x for x in sc.split(",") if x]
        sc = [s for s in sc if s in DEV_SCOPES] or ["basic"]
        sets.append("scopes=?"); args.append(",".join(sc))
    if "expires_days" in d:
        ed = int(d["expires_days"] or 0)
        val = (datetime.now() + timedelta(days=ed)).isoformat(timespec="seconds") if ed > 0 else ""
        sets.append("expires_at=?"); args.append(val)
    if sets:
        args.append(kid); db.execute(f"UPDATE dev_keys SET {','.join(sets)} WHERE id=?", args); db.commit()
    return jsonify(ok=True)

@app.route("/api/devkeys/<int:kid>/revoke", methods=["POST"])
@login_required
def devkeys_revoke(kid):
    db = get_db(); k = db.execute("SELECT id FROM dev_keys WHERE id=? AND user_id=?", (kid, session["user"]["db_id"])).fetchone()
    if not k: return jsonify(ok=False, error="not_found"), 404
    db.execute("UPDATE dev_keys SET revoked=1, active=0 WHERE id=?", (kid,)); db.commit()
    return jsonify(ok=True, revoked=True)

@app.route("/api/devkeys/<int:kid>/unrevoke", methods=["POST"])
@login_required
def devkeys_unrevoke(kid):
    db = get_db(); k = db.execute("SELECT id FROM dev_keys WHERE id=? AND user_id=?", (kid, session["user"]["db_id"])).fetchone()
    if not k: return jsonify(ok=False, error="not_found"), 404
    db.execute("UPDATE dev_keys SET revoked=0, active=1 WHERE id=?", (kid,)); db.commit()
    return jsonify(ok=True, revoked=False)

@app.route("/api/devkeys/<int:kid>/rotate", methods=["POST"])
@login_required
def devkeys_rotate(kid):
    """Перевыпуск ключа: новый sp-… со старыми настройками."""
    db = get_db(); k = db.execute("SELECT * FROM dev_keys WHERE id=? AND user_id=?", (kid, session["user"]["db_id"])).fetchone()
    if not k: return jsonify(ok=False, error="not_found"), 404
    raw = _gen_key(k["env"]); h = hashlib.sha256(raw.encode()).hexdigest()
    db.execute("UPDATE dev_keys SET key_hash=?, key_mask=?, revoked=0, active=1 WHERE id=?",
               (h, _key_prefix(raw), kid)); db.commit()
    return jsonify(ok=True, key=raw, note="Старый ключ перестал работать. Новый показан один раз.")

@app.route("/api/devkeys/<int:kid>/usage")
@login_required
def devkeys_usage(kid):
    db = get_db(); k = db.execute("SELECT id FROM dev_keys WHERE id=? AND user_id=?", (kid, session["user"]["db_id"])).fetchone()
    if not k: return jsonify(ok=False, error="not_found"), 404
    now_ms = int(time.time()*1000)
    day = db.execute("SELECT COUNT(*) c FROM key_usage WHERE key_id=? AND ts>?", (kid, now_ms - now_ms%86400000)).fetchone()["c"]
    hour = db.execute("SELECT COUNT(*) c FROM key_usage WHERE key_id=? AND ts>?", (kid, now_ms-3600000)).fetchone()["c"]
    return jsonify(ok=True, today=day, last_hour=hour, total=k["calls"] if hasattr(k,"calls") else 0)

@app.route("/api/devkeys/<int:kid>/toggle", methods=["POST"])
@login_required
def devkeys_toggle(kid):
    db=get_db(); k=db.execute("SELECT id,active FROM dev_keys WHERE id=? AND user_id=?",(kid,session["user"]["db_id"])).fetchone()
    if not k: return jsonify(ok=False, error="not_found"), 404
    db.execute("UPDATE dev_keys SET active=? WHERE id=?",(0 if k["active"] else 1,kid)); db.commit()
    return jsonify(ok=True, active=not bool(k["active"]))

@app.route("/api/devkeys/<int:kid>", methods=["DELETE"])
@login_required
def devkeys_delete(kid):
    db=get_db(); k=db.execute("SELECT id FROM dev_keys WHERE id=? AND user_id=?",(kid,session["user"]["db_id"])).fetchone()
    if not k: return jsonify(ok=False, error="not_found"), 404
    db.execute("DELETE FROM key_usage WHERE key_id=?",(kid,)); db.execute("DELETE FROM dev_keys WHERE id=?",(kid,))
    db.commit(); return jsonify(ok=True)

def auth_via_token():
    """Bearer np_… для /openapi/*"""
    hdr = request.headers.get("Authorization","")
    if not hdr.startswith("Bearer np_"): return None
    raw = hdr.split(None,1)[1].strip()
    h = hashlib.sha256(raw.encode()).hexdigest()
    db = get_db()
    t = db.execute("SELECT * FROM api_tokens WHERE token_hash=?", (h,)).fetchone()
    if not t: return None
    db.execute("UPDATE api_tokens SET last_used=? WHERE id=?", (datetime.now().isoformat(timespec="seconds"), t["id"]))
    db.commit()
    u = db.execute("SELECT id,sub,name,email,picture FROM users WHERE id=?", (t["user_id"],)).fetchone()
    return dict(u) if u else None

def token_required(fn):
    @wraps(fn)
    def w(*a,**k):
        u = auth_via_token()
        if not u: return jsonify(ok=False, error="unauthorized", hint="Header: Authorization: Bearer np_…"), 401
        g.api_user = u
        return fn(*a,**k)
    return w

# --- OpenAPI (для curl/скриптов, авторизация токеном) ---
@app.route("/openapi/v1/me")
@token_required
def openapi_me():
    return jsonify(ok=True, user=g.api_user)

@app.route("/openapi/v1/history")
@token_required
def openapi_history():
    rows = get_db().execute("SELECT ts,kind,down,up,ping,jitter,loss FROM tests WHERE user_id=? ORDER BY ts DESC LIMIT 100",
                            (g.api_user["id"],)).fetchall()
    return jsonify(ok=True, history=[dict(r) for r in rows])

@app.route("/openapi/v1/ping/<host>")
@token_required
def openapi_ping(host):
    if not re.match(r"^[A-Za-z0-9.\-]{1,253}$", host): return jsonify(ok=False, error="bad_host"), 400
    import socket
    t0=time.perf_counter()
    try:
        ip = socket.gethostbyname(host)
        tcp_t0=time.perf_counter()
        s=socket.create_connection((ip, 80 if ":" not in host else 80), timeout=5); s.close()
        return jsonify(ok=True, host=host, ip=ip, dns_ms=round((tcp_t0-t0)*1000,1),
                       tcp_connect_ms=round((time.perf_counter()-tcp_t0)*1000,1))
    except Exception as e:
        return jsonify(ok=False, host=host, error=str(e)[:200])

def _json_err_page(code):
    """Для API-запросов отдаём JSON вместо HTML-страницы ошибки (и не падаем, если шаблона нет)."""
    if request.path.startswith("/api/"):
        msg = {403: "Forbidden", 404: "Not found", 500: "Internal server error"}[code]
        return jsonify(ok=False, error="server_error" if code == 500 else "not_found",
                       code=code, message=msg), code
    tpl = {403: "403.html", 404: "404.html", 500: "500.html"}[code]
    try:
        return render_template(tpl), code
    except Exception:
        return jsonify(ok=False, code=code), code

@app.errorhandler(403)
def e403(_e): return _json_err_page(403)
@app.errorhandler(404)
def e404(_e): return _json_err_page(404)
@app.errorhandler(500)
def e500(_e): return _json_err_page(500)

if __name__ == "__main__":
    init_db()
    log.info("NetPulse: http://%s:%s | google_auth=%s | search=%s",
             HOST, PORT, HAVE_GOOGLE_AUTH, bool(GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX))
    app.run(host=HOST, port=PORT, debug=DEBUG)
