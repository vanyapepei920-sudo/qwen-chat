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

GOOGLE_CLIENT_ID      = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET  = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_SEARCH_API_KEY = os.getenv("GOOGLE_SEARCH_API_KEY", "")
GOOGLE_SEARCH_CX      = os.getenv("GOOGLE_SEARCH_CX", "")
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
    CREATE INDEX IF NOT EXISTS idx_tests_user ON tests(user_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_res_monitor ON monitor_results(monitor_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, ts DESC);
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
         "wifi":"Wi‑Fi","search":"Поиск","history":"История","monitor":"Мониторинг",
         "settings":"Настройки"}
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
    if prev is not None and bool(prev["ok"]) != res["ok"]:   # смена состояния → уведомление
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
                if prev is not None and bool(prev["ok"]) != res["ok"]:
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
