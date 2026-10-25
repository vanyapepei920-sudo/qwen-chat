"""NetPulse — сервер. Google-вход, поиск, мониторинг сайтов, уведомления, экспорт, API-токены."""
import os, json, time, sqlite3, logging, secrets, re, csv, io, hmac, hashlib
from pathlib import Path
from datetime import timedelta, datetime
from functools import wraps

import requests as http_lib
from dotenv import load_dotenv
from flask import (Flask, render_template, request, jsonify, session,
                   g, redirect, url_for, Response)
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

app = Flask(__name__, template_folder="templates",
            static_folder="assets", static_url_path="/assets")
app.config["SECRET_KEY"] = SECRET_KEY
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=SESSION_HOURS)
CORS(app, supports_credentials=True,
     origins=[f"http://{HOST}:{PORT}", "http://localhost:5000", "http://127.0.0.1:5000"])

# Публичный Developer API (/api/v1) доступен с ЛЮБОГО сайта (ключи npk_ вместо cookies)
@app.after_request
def _cors_devapi(resp):
    if request.path.startswith("/api/v1/"):
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
DEV_SCOPES = {"basic": ["ping","status"], "net": ["dns","whois"], "search": ["search"]}

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

def _dev_auth():
    """Ищет dev-ключ в заголовке X-NetPulse-Key / Authorization Bearer sp-… / ?key= (старый npk_ тоже принимается)"""
    raw = (request.headers.get("X-NetPulse-Key") or "").strip()
    if not raw:
        hdr = request.headers.get("Authorization","")
        if hdr.startswith("Bearer sp-") or hdr.startswith("Bearer npk_"): raw = hdr.split(None,1)[1].strip()
    if not raw: raw = (request.args.get("key") or "").strip()
    if not (raw.startswith("sp-") or raw.startswith("npk_")): return None, None
    h = hashlib.sha256(raw.encode()).hexdigest()
    db = get_db()
    k = db.execute("SELECT * FROM dev_keys WHERE key_hash=?", (h,)).fetchone()
    if not k or not k["active"] or k["revoked"]: return None, "invalid_key"
    if (k["expires_at"] or "") and k["expires_at"] < datetime.now().isoformat(timespec="seconds"):
        return None, "expired_key"
    origin = request.headers.get("Origin","").strip()   # CORS allow-list по Origin (если задан)
    if origin and not _origin_ok(k, origin): return None, "origin_denied"
    now_ms = int(time.time()*1000)
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
    return {"key": dict(k), "user": dict(u)}, None

def dev_required(fn):
    @wraps(fn)
    def w(*a, **k):
        auth, err = _dev_auth()
        if not auth:
            hint = {"invalid_key":"Ключ не найден, выключен или отозван. Проверьте статус в Настройках → Developer API.",
                    "rate_limited":"Превышен лимит запросов в минуту (настройка ключа «Лимит»).",
                    "quota_exceeded":"Исчерпана дневная квота ключа (настройка «Дневная квота»).",
                    "expired_key":"Срок действия ключа истёк — создайте новый или продлите в настройках ключа.",
                    "origin_denied":"Запрос с этого Origin запрещён настройкой «Разрешённые домены» ключа."}
            return jsonify(ok=False, error=err or "missing_key",
                           hint=hint.get(err, "Передайте ключ: заголовок 'X-NetPulse-Key: npk_…' или ?key=npk_…")), \
                   429 if err=="rate_limited" else 401
        g.dev = auth; return fn(*a, **k)
    return w

def _dev_scope(name):
    sc = (g.dev["key"]["scopes"] or "basic").split(",")
    allowed = [e for s in sc for e in DEV_SCOPES.get(s, [])]
    if name not in allowed:
        return jsonify(ok=False, error="scope_denied", scope=name,
                       hint="Добавьте scope '%s' при создании ключа (пересоздайте ключ)." %
                            next((s for s,e in DEV_SCOPES.items() if name in e), name)), 403
    return None

@app.route("/api/v1/info")
@dev_required
def dev_info():
    k = g.dev["key"]
    return jsonify(ok=True, key_name=k["name"], env=k["env"], scopes=k["scopes"].split(","),
                   rate_limit_per_min=k["rate_limit"], quota_day=k["quota_day"],
                   allowed_origins=(k["allowed_origins"] or "*").split(","),
                   expires_at=k["expires_at"] or None, total_calls=k["calls"],
                   owner=g.dev["user"].get("name"), api_version="v1",
                   endpoints=["/api/v1/info","/api/v1/ping?url=","/api/v1/status?url=",
                              "/api/v1/dns?host=","/api/v1/whois?domain=","/api/v1/search?q=",
                              "/api/v1/subnet?cidr=","/api/v1/units?v=&from=&to=",
                              "/api/v1/ip","/api/v1/uptime?url=&interval_sec="])

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
def assistant_api_url():
    # адрес текстового бэкенда помощника (только из .env, значения по умолчанию в коде нет)
    return genv("ASSISTANT_API_URL")

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
    "Developer API: GET /api/v1/info|ping|status|dns|whois|search|subnet|units|ip|uptime, "
    "ключ передаётся заголовком X-NetPulse-Key или Authorization: Bearer, CORS открыт для сторонних сайтов.\n"
    "Отвечай кратко (до ~120 слов) по-русски, дружелюбно, шаг за шагом. Если вопрос не про NetPulse, "
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
    r = http_lib.post(
        assistant_api_url(),
        json={"messages": messages, "model": model, "referrer": "netpulse",
              "seed": int(time.time()) % 100000,
              "temperature": 0.5, "max_tokens": 700},
        timeout=45)
    data = r.json()
    if r.status_code != 200:
        err = (data.get("error") or data.get("message") or f"HTTP {r.status_code}")
        if isinstance(err, dict): err = err.get("message", str(err))
        log.warning("assistant backend: %s", err)
        raise RuntimeError(str(err)[:200])
    choice = (data.get("choices") or [{}])[0]
    txt = ((choice.get("message") or {}).get("content") or "").strip()
    if not txt:
        txt = (data.get("text") or "").strip()  # редкий fallback-формат
    if not txt:
        raise RuntimeError("пустой ответ модели")
    return txt

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
            reply = f"⚠ Ошибка помощника: {e}"; status = 502
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
