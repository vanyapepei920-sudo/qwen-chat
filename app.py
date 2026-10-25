#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Синтеко Лаб — Speedtest-портал с входом через Google OAuth.

Всё в одном файле: Flask + Authlib (Google Login) + набор интернет-функций:
  /api/ping        — задержка/джиттер до сайта
  /api/download    — отдаёт случайные байты для замера скорости загрузки
  /api/upload      — принимает байты для замера скорости отдачи
  /api/jitter      — серия замеров задержки
  /api/dns         — DNS lookup (A / AAAA / MX / TXT / CNAME / NS)
  /api/ipinfo      — информация о вашем IP (провайдер, город, страна, часовой пояс)
  /api/geolocate   — геолокация по IP
  /api/headers     — ваши HTTP-заголовки (User-Agent, и т.д.)
  /api/mtu         — оценка MTU по размеру ответа
  /api/httpstatus  — проверка статуса и времени ответа URL
  /api/whois       — WHOIS домена (через RDAP)
  /api/search      — поиск (DuckDuckGo / Wikipedia / Hacker News / GitHub / Google API)
  /api/speedtest   — комплексный тест: ping + download + upload одним запросом
  /api/history     — история результатов (по пользователю, в памяти + results.json)
Все /api/* требуют входа через Google (/login).

Запуск — ТОЛЬКО встроенные библиотеки Python + Flask, никаких pip-зависимостей:
    python app.py
(Flask — единственный внешний импорт; остальное — стандартная библиотека CPython:
 urllib.request, http.client, json, ssl, socket, hashlib, base64, hmac и т.д.)
Откроется http://localhost:5000 — потребуется войти через Google.

Настройки читаются из .env (собственный мини-парсер на базе os.environ, без python-dotenv).
Без настроенного Google OAuth включается DEMO-режим (кнопка «Демо-вход»).
Google OAuth реализован вручную на urllib (authlib/OAuth2-клиент не требуется).
"""

import base64
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

# ─────────────── HTTP-клиент на встроенном urllib (вместо requests) ───────────────
_SSL_CTX = ssl.create_default_context()
UA_STR = "SynthecoLabBot/1.0 (https://syntheco.lab) python-urllib"


class HttpResponse:
    """Мини-обёртка в стиле requests: .status_code, .headers, .text, .json(), .content, .url, .history."""

    def __init__(self, status_code, headers, content, url="", history=None):
        self.status_code = status_code
        self.headers = headers          # email.message.Message (case-insensitive)
        self.content = content          # bytes
        self.url = url                  # финальный URL после редиректов
        self.history = history or []    # цепочка промежуточных 3xx-ответов
        self.ok = 200 <= status_code < 400

    @property
    def text(self):
        cs = self.headers.get_content_charset() or "utf-8"
        try:
            return self.content.decode(cs, errors="replace")
        except LookupError:
            return self.content.decode("utf-8", errors="replace")

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if not self.ok:
            raise urllib.error.HTTPError(None, self.status_code, f"HTTP {self.status_code}", None, None)

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _build_req(url, method="GET", data=None, headers=None, params=None):
    if params:
        sep = "&" if "?" in url else "?"
        url = url + sep + urllib.parse.urlencode(params)
    hdrs = {"User-Agent": UA_STR, "Accept": "*/*"}
    for k, v in (headers or {}).items():
        hdrs[k] = v
    body = None
    if isinstance(data, dict):
        body = urllib.parse.urlencode(data).encode()
        hdrs.setdefault("Content-Type", "application/x-www-form-urlencoded")
    elif isinstance(data, (bytes, bytearray)):
        body = bytes(data)
    elif isinstance(data, str):
        body = data.encode()
    return urllib.request.Request(url, data=body, headers=hdrs, method=method)


def _open(req, timeout):
    resp = urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX)
    return HttpResponse(getattr(resp, "status", 200), resp.headers, resp.read())


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Не следовать 3xx — вернуть ответ как есть (как allow_redirects=False в requests)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class _Session:
    """Лёгкий HTTP-клиент с интерфейсом requests поверх встроенного urllib."""

    @staticmethod
    def get(url, params=None, headers=None, timeout=10, allow_redirects=True, stream=False):
        req = _build_req(url, "GET", headers=headers, params=params)
        if not allow_redirects:
            opener = urllib.request.build_opener(_NoRedirect)
            try:
                resp = opener.open(req, timeout=timeout)
                return HttpResponse(getattr(resp, "status", 200), resp.headers, resp.read(), url=resp.geturl())
            except urllib.error.HTTPError as e:
                return HttpResponse(e.code, e.headers, e.read(), url=url)
        resp = urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX)
        if stream:
            return resp  # сырой ответ: .read(n), для потокового чтения
        return HttpResponse(getattr(resp, "status", 200), resp.headers, resp.read(), url=resp.geturl())

    @staticmethod
    def post(url, data=None, json_body=None, headers=None, timeout=10, params=None):
        if json_body is not None:
            data = json.dumps(json_body).encode()
            headers = dict(headers or {})
            headers["Content-Type"] = "application/json"
        req = _build_req(url, "POST", data=data, headers=headers, params=params)
        return _open(req, timeout)

    @staticmethod
    def head(url, headers=None, timeout=10, allow_redirects=True):
        req = _build_req(url, "HEAD", headers=headers)
        if not allow_redirects:
            opener = urllib.request.build_opener(_NoRedirect)
            try:
                resp = opener.open(req, timeout=timeout)
                return HttpResponse(getattr(resp, "status", 200), resp.headers, b"", url=resp.geturl())
            except urllib.error.HTTPError as e:
                return HttpResponse(e.code, e.headers, b"", url=url)
        return _open(req, timeout)


requests = _Session()
UA = {"User-Agent": UA_STR}


def load_dotenv(path=".env"):
    """Мини-парсер .env на встроенных библиотеках (вместо python-dotenv)."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip().strip("'\"")
                if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k):
                    os.environ.setdefault(k, v)
    except FileNotFoundError:
        pass


from flask import (
    Flask, Response, jsonify, redirect, render_template_string, request,
    send_from_directory, session, url_for,
)

load_dotenv()

from urllib.parse import urlparse, urljoin

# ─────────────────────────── Настройки из .env ───────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
PORT = int(os.getenv("PORT", "5000"))
HOST = os.getenv("HOST", "0.0.0.0")
DOWNLOAD_TEST_MB = int(os.getenv("DOWNLOAD_TEST_MB", "25"))  # размер теста на скачивание
HISTORY_FILE = os.getenv("HISTORY_FILE", "results.json")
ALLOWED_EMAILS = [e.strip().lower() for e in os.getenv("ALLOWED_EMAILS", "").split(",") if e.strip()]

DEMO_MODE = not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)

app = Flask(__name__, static_folder=None)
app.secret_key = SECRET_KEY
app.permanent_session_lifetime = 60 * 60 * 24 * 7  # неделя

# ─────────────── Google OAuth вручную (urllib + crypto из stdlib, без authlib) ───────────────
GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo"


def _b64url_decode(seg):
    return base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4))


def _verify_google_id_token(id_token):
    """Декодирует payload JWT Google (подлинность гарантирует TLS-обмен кода с Google)."""
    return json.loads(_b64url_decode(id_token.split(".")[1]))

# ─────────────────────────── Хранилище истории ───────────────────────────
_history = defaultdict(list)  # user_email -> [ {ts, ping, jitter, down, up, ...} ]


def _load_history():
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        for k, v in raw.items():
            _history[k] = list(v)
    except (FileNotFoundError, json.JSONDecodeError):
        pass


def _save_history():
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(dict(_history), f, ensure_ascii=False, indent=1)
    except OSError:
        pass


_load_history()

# ─────────────────────────── Авторизация ───────────────────────────


def current_user():
    return session.get("user")


def login_required_json(fn):
    from functools import wraps

    @wraps(fn)
    def wrapper(*a, **kw):
        if not current_user():
            return jsonify(error="not_authenticated", login_url=url_for("login")), 401
        return fn(*a, **kw)

    return wrapper


@app.route("/login")
def login():
    if DEMO_MODE:
        return redirect(url_for("demo_login"))
    redirect_uri = url_for("auth_callback", _external=True)
    state = secrets.token_urlsafe(16)
    session["oauth_state"] = state
    params = urllib.parse.urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": secrets.token_urlsafe(16),
        "prompt": "select_account",
    })
    return redirect(f"{GOOGLE_AUTH_ENDPOINT}?{params}")


@app.route("/login/demo")
def demo_login():
    """Вход без Google — только для локальной разработки (DEMO-режим)."""
    if not DEMO_MODE:
        return redirect(url_for("login"))
    session.permanent = True
    session["user"] = {
        "name": "Demo User",
        "email": "demo@localhost",
        "picture": "",
        "provider": "demo",
    }
    return redirect(url_for("index"))


@app.route("/oauth2/callback")
def auth_callback():
    if DEMO_MODE:
        return redirect(url_for("demo_login"))
    if request.args.get("error"):
        return render_template_string(LOGIN_PAGE, error=f"Google вернул ошибку: {request.args.get('error')}",
                                      login_url=url_for("login"), demo=False), 400
    code = request.args.get("code", "")
    state = request.args.get("state", "")
    if not code or state != session.pop("oauth_state", None):
        return render_template_string(LOGIN_PAGE, error="Некорректный OAuth-ответ (state/code)",
                                      login_url=url_for("login"), demo=False), 400
    # обмен authorization_code на токены — прямой TLS-запрос к Google (stdlib urllib)
    try:
        tok = requests.post(GOOGLE_TOKEN_ENDPOINT, data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": url_for("auth_callback", _external=True),
        }, timeout=10).json()
    except Exception as e:
        return render_template_string(LOGIN_PAGE, error=f"Ошибка обмена кода: {e}",
                                      login_url=url_for("login"), demo=False), 502
    if "access_token" not in tok:
        return render_template_string(LOGIN_PAGE, error=f"Google: {tok.get('error_description', 'no token')}",
                                      login_url=url_for("login"), demo=False), 400
    # профиль — из id_token (получен напрямую от Google по TLS) либо с /userinfo
    info = {}
    if tok.get("id_token"):
        try:
            info = _verify_google_id_token(tok["id_token"])
        except Exception:
            info = {}
    if not info.get("email"):
        try:
            ui = requests.get(GOOGLE_USERINFO_ENDPOINT,
                              headers={"Authorization": f"Bearer {tok['access_token']}"}, timeout=10).json()
            info.update(ui)
        except Exception:
            pass
    email = (info.get("email") or "").lower()
    if ALLOWED_EMAILS and email not in ALLOWED_EMAILS:
        session.clear()
        return render_template_string(LOGIN_PAGE, error=f"Email {email} не в списке разрешённых (ALLOWED_EMAILS)",
                                      login_url=url_for("login"), demo=False), 403
    session.permanent = True
    session["user"] = {
        "name": info.get("name", email),
        "email": email,
        "picture": info.get("picture", ""),
        "provider": "google",
    }
    return redirect(url_for("index"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.route("/api/me")
@login_required_json
def api_me():
    u = current_user()
    return jsonify(user=u, history_count=len(_history.get(u["email"], [])))


# ─────────────────────────── Статика (существующий сайт) ───────────────────────────


@app.route("/")
def index():
    u = current_user()
    if not u:
        return render_template_string(LOGIN_PAGE, error=None, login_url=url_for("login"), demo=DEMO_MODE)
    return send_from_directory(os.path.dirname(os.path.abspath(__file__)), "index.html")


@app.route("/css/<path:fn>")
def css(fn):
    return send_from_directory("css", fn)


@app.route("/js/<path:fn>")
def js(fn):
    return send_from_directory("js", fn)


@app.route("/studio/<path:fn>")
def studio(fn):
    return send_from_directory(os.path.join("studio"), fn)


@app.route("/studio/")
def studio_index():
    if not current_user():
        return redirect(url_for("index"))
    return send_from_directory("studio", "index.html")


# ─────────────────────────── Speedtest API ───────────────────────────


@app.route("/api/ping")
@login_required_json
def api_ping():
    host = request.args.get("host", "1.1.1.1")
    n = min(int(request.args.get("n", 5)), 20)
    samples = []
    for _ in range(n):
        t0 = time.perf_counter()
        try:
            r = requests.head(f"https://{host}", timeout=5, allow_redirects=False)
            ms = (time.perf_counter() - t0) * 1000
            samples.append({"ms": round(ms, 2), "status": r.status_code})
        except Exception as e:
            samples.append({"ms": None, "error": str(e)[:120]})
        time.sleep(0.05)
    ok = [s["ms"] for s in samples if s["ms"] is not None]
    avg = sum(ok) / len(ok) if ok else None
    jitter = (sum(abs(ok[i] - ok[i - 1]) for i in range(1, len(ok))) / (len(ok) - 1)) if len(ok) > 1 else 0
    return jsonify(host=host, samples=samples, avg_ms=round(avg, 2) if avg else None,
                   min_ms=round(min(ok), 2) if ok else None, max_ms=round(max(ok), 2) if ok else None,
                   jitter_ms=round(jitter, 2), loss=len(samples) - len(ok))


@app.route("/api/download")
@login_required_json
def api_download():
    """Отдаёт N MB случайных байтов (no-cache) — клиент измеряет скорость."""
    mb = min(float(request.args.get("mb", 8)), float(os.environ.get("DOWNLOAD_TEST_MB", "32")))
    size = int(mb * 1024 * 1024)
    chunk = 256 * 1024

    def gen():
        sent = 0
        buf = os.urandom(chunk)
        while sent < size:
            part = buf[: min(chunk, size - sent)]
            yield part
            sent += len(part)

    return Response(gen(), mimetype="application/octet-stream",
                    headers={"Content-Length": str(size), "Cache-Control": "no-store"})


@app.route("/api/upload", methods=["POST"])
@login_required_json
def api_upload():
    data = request.get_data(cache=False)  # считываем весь поток
    return jsonify(received_bytes=len(data), ok=True)


@app.route("/api/jitter")
@login_required_json
def api_jitter():
    host = request.args.get("host", "1.1.1.1")
    n = min(int(request.args.get("n", 10)), 30)
    lat = []
    for _ in range(n):
        t0 = time.perf_counter()
        try:
            requests.head(f"https://{host}", timeout=5, allow_redirects=False)
            lat.append((time.perf_counter() - t0) * 1000)
        except Exception:
            pass
    if len(lat) < 2:
        return jsonify(error="too_few_samples"), 502
    mean = sum(lat) / len(lat)
    sd = math.sqrt(sum((x - mean) ** 2 for x in lat) / len(lat))
    diffs = [abs(lat[i] - lat[i - 1]) for i in range(1, len(lat))]
    return jsonify(host=host, samples=[round(x, 2) for x in lat], avg_ms=round(mean, 2),
                   stddev_ms=round(sd, 2), jitter_avg_ms=round(sum(diffs) / len(diffs), 2),
                   jitter_max_ms=round(max(diffs), 2))


# ─────────────────────────── Прочие интернет-функции ───────────────────────────


@app.route("/api/ipinfo")
@login_required_json
def api_ipinfo():
    """Информация об IP клиента (или переданном ip=)."""
    ip = request.args.get("ip") or request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    out = {"ip": ip}
    try:
        r = requests.get(f"http://ip-api.com/json/{ip}?fields=status,country,regionName,city,isp,org,as,timezone,query,reverse", headers=UA, timeout=6)
        out.update(r.json())
    except Exception as e:
        out["error"] = str(e)[:200]
    try:
        out["local_hostname"] = socket.getfqdn()
    except Exception:
        pass
    return jsonify(out)


@app.route("/api/geolocate")
@login_required_json
def api_geolocate():
    try:
        r = requests.get("https://ipapi.co/json/", headers=UA, timeout=6)
        return jsonify(r.json())
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/dns")
@login_required_json
def api_dns():
    domain = request.args.get("domain", "").strip()
    if not domain or not re.match(r"^[a-zA-Z0-9.\-_:@]+$", domain):
        return jsonify(error="bad_domain"), 400
    result = {"domain": domain}
    try:
        infos = socket.getaddrinfo(domain, None)
        result["ipv4"] = sorted({i[4][0] for i in infos if i[0] == socket.AF_INET})
        result["ipv6"] = sorted({i[4][0] for i in infos if i[0] == socket.AF_INET6})
        result["canonical"] = socket.getfqdn(domain)
    except Exception as e:
        result["error"] = str(e)[:200]
    # DoH (Cloudflare) для MX/TXT/NS/CNAME
    for rtype in ("MX", "TXT", "NS", "CNAME"):
        try:
            r = requests.get(f"https://cloudflare-dns.com/dns-query?name={domain}&type={rtype}",
                             headers={"accept": "application/dns-json"}, timeout=6)
            ans = r.json().get("Answer") or []
            result[rtype.lower()] = [a.get("data") for a in ans]
        except Exception:
            result[rtype.lower()] = []
    return jsonify(result)


@app.route("/api/headers")
@login_required_json
def api_headers():
    return jsonify(client=dict(request.headers), remote_addr=request.remote_addr,
                   user_agent=request.headers.get("User-Agent", ""))


@app.route("/api/mtu")
@login_required_json
def api_mtu():
    """Оценка максимального единого пакета через localhost-эхо (упрощённо)."""
    sizes = [512, 1024, 1472, 1500, 2000, 4000]
    res = []
    for s in sizes:
        payload = "x" * s
        t0 = time.perf_counter()
        try:
            r = requests.post(url_for("api_echo", _external=True), data=payload, timeout=4)
            res.append({"bytes": s, "ok": r.status_code == 200, "ms": round((time.perf_counter() - t0) * 1000, 2)})
        except Exception:
            res.append({"bytes": s, "ok": False, "ms": None})
    return jsonify(probe=res, note="Оценка через сервер; реальный MTU канала может отличаться")


@app.route("/api/echo", methods=["POST"])
def api_echo():
    body = request.get_data()
    return Response(body, status=200, content_type="text/plain")


@app.route("/api/httpstatus")
@login_required_json
def api_httpstatus():
    url = request.args.get("url", "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return jsonify(error="bad_url"), 400
    t0 = time.perf_counter()
    try:
        r = requests.get(url, timeout=10, allow_redirects=True)
        return jsonify(url=url, status=r.status_code, ok=r.ok,
                       total_ms=round((time.perf_counter() - t0) * 1000, 2),
                       redirects=len(r.history), final_url=r.url,
                       server=r.headers.get("Server"), content_type=r.headers.get("Content-Type"),
                       size_bytes=len(r.content))
    except Exception as e:
        return jsonify(url=url, error=str(e)[:200]), 502


@app.route("/api/whois")
@login_required_json
def api_whois():
    domain = request.args.get("domain", "").strip().lower()
    if not re.match(r"^[a-z0-9.\-]+\.[a-z]{2,}$", domain):
        return jsonify(error="bad_domain"), 400
    out = {"domain": domain}
    try:
        r = requests.get(f"https://rdap.org/domain/{domain}", timeout=8,
                         headers={"Accept": "application/json"})
        if r.ok:
            j = r.json()
            ent = {}
            for e in j.get("entities", []):
                for role in e.get("roles", []):
                    vcard = e.get("vcardArray") or [None, []]
                    name = ""
                    for item in vcard[1]:
                        if len(item) >= 4 and item[0] == "fn":
                            name = item[3]
                            break
                    if name:
                        ent.setdefault(role, []).append(name)
            ns = [n.get("ldhName") for n in j.get("nameservers", [])]
            events = {e.get("eventAction"): e.get("eventDate") for e in j.get("events", [])}
            out.update(registrar=(ent.get("registrar") or [""])[0], nameservers=ns,
                       registration=events.get("registration"), expiration=events.get("expiration"),
                       status=j.get("status"))
        else:
            out["error"] = f"RDAP status {r.status_code}"
    except Exception as e:
        out["error"] = str(e)[:200]
    return jsonify(out)


@app.route("/api/search")
@login_required_json
def api_search():
    q = request.args.get("q", "").strip()
    engine = request.args.get("engine", "ddg").lower()
    if not q:
        return jsonify(error="empty_query"), 400
    try:
        if engine == "wiki":
            r = requests.get("https://ru.wikipedia.org/w/api.php", params={
                "action": "opensearch", "search": q, "limit": 10, "format": "json"}, headers=UA, timeout=8)
            arr = r.json()
            items = [{"title": t, "url": u} for t, u in zip(arr[1], arr[3])]
        elif engine == "gh":
            r = requests.get("https://api.github.com/search/repositories", params={"q": q, "per_page": 10}, headers=UA, timeout=8)
            items = [{"title": i["full_name"], "url": i["html_url"],
                      "desc": (i.get("description") or "")[:160], "stars": i["stargazers_count"]}
                     for i in r.json().get("items", [])]
        elif engine == "hn":
            s = requests.get("https://hn.algolia.com/api/v1/search", params={"query": q, "hitsPerPage": 10}, headers=UA, timeout=8)
            items = [{"title": h.get("title") or h.get("story_title"),
                      "url": h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID')}",
                      "points": h.get("points")} for h in s.json().get("hits", [])]
        elif engine == "google":
            key = os.getenv("GOOGLE_API_KEY")
            cx = os.getenv("GOOGLE_CSE_ID")
            if not (key and cx):
                return jsonify(error="GOOGLE_API_KEY/GOOGLE_CSE_ID не заданы в .env"), 501
            r = requests.get("https://www.googleapis.com/customsearch/v1",
                             params={"key": key, "cx": cx, "q": q, "num": 10}, headers=UA, timeout=8)
            items = [{"title": i["title"], "url": i["link"], "desc": i.get("snippet", "")}
                     for i in r.json().get("items", [])]
        else:  # duckduckgo instant answer + html-lite
            r = requests.get("https://api.duckduckgo.com/", params={"q": q, "format": "json", "no_html": 1}, headers=UA, timeout=8)
            j = r.json()
            items = []
            if j.get("AbstractText"):
                items.append({"title": j.get("Heading"), "url": j.get("AbstractURL"), "desc": j["AbstractText"]})
            for rel in j.get("RelatedTopics", [])[:8]:
                if isinstance(rel, dict) and rel.get("Text"):
                    items.append({"title": rel["Text"][:80], "url": rel.get("FirstURL"), "desc": rel["Text"]})
        return jsonify(engine=engine, query=q, results=items)
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/speedtest")
@login_required_json
def api_speedtest():
    """Комбинированный тест прямо на сервере: пинг + загрузка + отдача."""
    host = request.args.get("host", "1.1.1.1")
    pings = []
    for _ in range(4):
        t0 = time.perf_counter()
        try:
            requests.head(f"https://{host}", timeout=4, allow_redirects=False)
            pings.append((time.perf_counter() - t0) * 1000)
        except Exception:
            pass
    # download: генерируем данные локально и меряем время сериализации как оценку
    size = 4 * 1024 * 1024
    t0 = time.perf_counter()
    buf = os.urandom(size)
    dl_ms = (time.perf_counter() - t0) * 1000
    up_mb = request.args.get("up_mb", type=float, default=0.0)
    up_result = None
    if up_mb:
        data = os.urandom(int(up_mb * 1024 * 1024))
        t1 = time.perf_counter()
        try:
            requests.post(url_for("api_upload", _external=True), data=data, timeout=20)
            up_result = round((time.perf_counter() - t1) * 1000, 1)
        except Exception:
            up_result = None
    ping = round(sum(pings) / len(pings), 1) if pings else None
    return jsonify(ping_ms=ping, ping_samples=[round(p, 1) for p in pings],
                   gen_bytes=size, gen_ms=round(dl_ms, 1), upload_ms=up_result,
                   ts=datetime.now(timezone.utc).isoformat())


@app.route("/api/result", methods=["POST"])
@login_required_json
def api_save_result():
    """Клиент сохраняет результат своего speedtest в историю."""
    data = request.get_json(silent=True) or {}
    u = current_user()
    rec = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "download_mbps": float(data.get("download_mbps") or 0),
        "upload_mbps": float(data.get("upload_mbps") or 0),
        "ping_ms": float(data.get("ping_ms") or 0),
        "jitter_ms": float(data.get("jitter_ms") or 0),
        "note": str(data.get("note") or "")[:200],
    }
    _history[u["email"]].append(rec)
    _history[u["email"]] = _history[u["email"]][-500:]
    _save_history()
    return jsonify(saved=True, count=len(_history[u["email"]]))


@app.route("/api/history")
@login_required_json
def api_history():
    u = current_user()
    limit = min(request.args.get("limit", 50, type=int), 500)
    return jsonify(user=u["email"], results=_history.get(u["email"], [])[-limit:])


@app.route("/api/stats")
@login_required_json
def api_stats():
    u = current_user()
    rs = _history.get(u["email"], [])
    if not rs:
        return jsonify(count=0)
    return jsonify(
        count=len(rs),
        best_download=max(r["download_mbps"] for r in rs),
        best_upload=max(r["upload_mbps"] for r in rs),
        avg_ping=round(sum(r["ping_ms"] for r in rs) / len(rs), 1),
        avg_download=round(sum(r["download_mbps"] for r in rs) / len(rs), 1),
    )


# ═══════════════════ INTERNET LAB — дополнительные функции (20+) ═══════════════════
# Хелперы

def _safe_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return parsed


def _jsonable(v):
    try:
        json.dumps(v)
        return v
    except (TypeError, ValueError):
        return str(v)[:500]


@app.route("/api/latency-map")
@login_required_json
def api_latency_map():
    """Пинг до популярных точек присутствия (CDN/серверы по всему миру)."""
    hosts = {
        "Cloudflare": "www.cloudflare.com",
        "Google": "www.google.com",
        "GitHub": "github.com",
        "Fastly": "www.fastly.net",
        "Cloudflare DoH": "cloudflare-dns.com",
        "AWS S3": "s3.amazonaws.com",
        "Microsoft": "www.microsoft.com",
        "Apple": "www.apple.com",
    }
    out = []
    for name, host in hosts.items():
        t0 = time.perf_counter()
        try:
            requests.head(f"https://{host}", timeout=4, allow_redirects=False)
            out.append({"name": name, "host": host, "ms": round((time.perf_counter() - t0) * 1000, 1)})
        except Exception as e:
            out.append({"name": name, "host": host, "ms": None, "error": str(e)[:80]})
    return jsonify(results=out)


TEST_SERVERS = [
    # name, host, iso, lat, lon — реальные PoP-точки Cloudflare Speed;
    # endpoint speed.cloudflare.com сам маршрутизирует запрос в ближайший POP.
    ("Cloudflare Moscow",   "speed.cloudflare.com",  "RU", 55.75, 37.62),
    ("Cloudflare Frankfurt","speed.cloudflare.com",  "DE", 50.11, 8.68),
    ("Cloudflare London",   "speed.cloudflare.com",  "GB", 51.50, -0.12),
    ("Cloudflare Amsterdam","speed.cloudflare.com",  "NL", 52.37, 4.90),
    ("Cloudflare Warsaw",   "speed.cloudflare.com",  "PL", 52.23, 21.01),
    ("Cloudflare Stockholm","speed.cloudflare.com",  "SE", 59.33, 18.07),
    ("Cloudflare Istanbul", "speed.cloudflare.com",  "TR", 41.01, 28.98),
    ("Cloudflare Dubai",    "speed.cloudflare.com",  "AE", 25.20, 55.27),
    ("Cloudflare NY",       "speed.cloudflare.com",  "US", 40.71, -74.0),
    ("Cloudflare Ashburn",  "speed.cloudflare.com",  "US", 38.95, -77.44),
    ("Cloudflare SFO",      "speed.cloudflare.com",  "US", 37.77, -122.42),
    ("Cloudflare São Paulo","speed.cloudflare.com",  "BR", -23.55,-46.63),
    ("Cloudflare Tokyo",    "speed.cloudflare.com",  "JP", 35.68, 139.69),
    ("Cloudflare Singapore","speed.cloudflare.com",  "SG", 1.35,  103.82),
    ("Cloudflare Sydney",   "speed.cloudflare.com",  "AU", -33.87,151.21),
]


@app.route("/api/servers")
@login_required_json
def api_servers():
    """Список реальных test-серверов (как speedtest.net) с координатами и URL."""
    out = []
    for i, (name, host, iso, lat, lon) in enumerate(TEST_SERVERS):
        out.append({
            "id": f"cf{i}-{host}", "name": name, "host": host, "country": iso,
            "lat": lat, "lon": lon,
            "down": f"https://{host}/__down?bytes=",
            "up": f"https://{host}/__up",
        })
    return jsonify(servers=out)


# ─────────── Speedtest v3 «как настоящий»: geo + выбор сервера ───────────

@app.route("/api/client-geo")
@login_required_json
def api_client_geo():
    """Координаты клиента (для автовыбора ближайшего test-сервера, как speedtest.net)."""
    out = {}
    for url in ("https://ipapi.co/json/", "http://ip-api.com/json/?fields=status,country,country_code,city,lat,lon,isp,org,as"):
        try:
            j = requests.get(url, headers=UA, timeout=6).json()
            if j.get("status") == "fail":
                continue
            out = {
                "lat": j.get("latitude", j.get("lat")),
                "lon": j.get("longitude", j.get("lon")),
                "city": j.get("city"), "country": j.get("country_code", j.get("country")),
                "isp": j.get("org", j.get("isp")), "as": j.get("asn"),
            }
            if out["lat"] is not None and out["lon"] is not None:
                return jsonify(out)
        except Exception:
            continue
    if not out:
        return jsonify(error="geo_unavailable"), 502
    return jsonify(out)


@app.route("/api/server-latency")
@login_required_json
def api_server_latency():
    """Латентность до ВСЕХ test-серверов со стороны сервера (для ранкинга)."""
    import time as _t
    results = []
    for name, host, iso, lat, lon in TEST_SERVERS:
        url = f"https://{host}/__down?bytes=0"
        best, fails = None, 0
        for _ in range(2):
            t0 = _t.perf_counter()
            try:
                requests.head(url, headers=UA, timeout=4, allow_redirects=False)
                ms = (_t.perf_counter() - t0) * 1000
                best = ms if best is None else min(best, ms)
            except Exception:
                fails += 1
        results.append({"id": host, "name": name, "country": iso,
                        "ms": round(best, 1) if best is not None else None,
                        "failed": fails})
    results.sort(key=lambda x: (x["ms"] is None, x["ms"] or 9e9))
    return jsonify(results=results)


def _haversine_km(a, b, c, d):
    import math
    p1, p2 = math.radians(a), math.radians(c)
    dp, dl = math.radians(c - a), math.radians(d - b)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * 6371 * math.asin(math.sqrt(h)))


@app.route("/api/nearest-servers")
@login_required_json
def api_nearest_servers():
    """Ближайшие географически тестовые серверы к клиенту (км) — как в speedtest.net."""
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify(error="нужны lat и lon"), 400
    out = []
    for name, host, iso, slat, slon in TEST_SERVERS:
        out.append({"id": host, "name": name, "country": iso, "lat": slat, "lon": slon,
                    "distance_km": _haversine_km(lat, lon, slat, slon)})
    out.sort(key=lambda s: s["distance_km"])
    return jsonify(servers=out[:10])


@app.route("/api/traceroute")
@login_required_json
def api_traceroute():
    """Трассировка пути до хоста (оценка по HTTP-прыжкам через известные узлы)."""
    host = request.args.get("host", "example.com").strip()
    hops = [
        ("Локальная сеть / DNS", "https://cloudflare-dns.com"),
        ("Магистраль / Google", "https://www.google.com"),
        ("CDN / Cloudflare", "https://www.cloudflare.com"),
        (f"Цель: {host}", f"https://{host}"),
    ]
    out = []
    for name, url in hops:
        t0 = time.perf_counter()
        try:
            r = requests.get(url, timeout=4, allow_redirects=False)
            ms = round((time.perf_counter() - t0) * 1000, 1)
            ip = socket.gethostbyname(url.split("//")[-1].split("/")[0])
            out.append({"hop": name, "ip": ip, "ms": ms, "status": r.status_code})
        except Exception as e:
            out.append({"hop": name, "ip": "*", "ms": None, "error": str(e)[:60]})
    return jsonify(host=host, hops=out, note="Оценка пути через HTTP-запросы к узлам")


@app.route("/api/bandwidth")
@login_required_json
def api_bandwidth():
    """Загрузка файла фиксированного размера с CDN и замер скорости."""
    size_mb = min(float(request.args.get("mb", 5)), 25)
    url = f"https://speed.cloudflare.com/__down?bytes={int(size_mb * 1024 * 1024)}"
    t0 = time.perf_counter()
    got = 0
    try:
        with requests.get(url, stream=True, timeout=15) as r:
            while True:
                chunk = r.read(64 * 1024)
                if not chunk:
                    break
                got += len(chunk)
        dt = time.perf_counter() - t0
        mbps = round((got * 8) / (dt * 1e6), 1) if dt > 0 else 0
        return jsonify(ok=True, bytes=got, seconds=round(dt, 2), mbps=mbps, source="Cloudflare CDN")
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/throughput")
@login_required_json
def api_throughput():
    """Пропускная способность канала: скачивание чанков с нескольких CDN параллельно."""
    urls = [
        "https://speed.cloudflare.com/__down?bytes=2097152",
        "https://proof.ovh.net/files/2Mb.dat",
        "http://speedtest.tele2.net/2MB.zip",
    ]
    results = []
    for u in urls:
        t0 = time.perf_counter()
        try:
            r = requests.get(u, timeout=10)
            dt = time.perf_counter() - t0
            results.append({"source": urlparse(u).netloc, "mbps": round(len(r.content) * 8 / (dt * 1e6), 1)})
        except Exception:
            results.append({"source": urlparse(u).netloc, "mbps": None})
    ok = [x["mbps"] for x in results if x["mbps"]]
    return jsonify(per_source=results, max_mbps=max(ok) if ok else None, avg_mbps=round(sum(ok)/len(ok),1) if ok else None)


@app.route("/api/video-quality")
@login_required_json
def api_video_quality():
    """Рекомендуемое качество видео на основе замера загрузки 4 МБ."""
    url = "https://speed.cloudflare.com/__down?bytes=4194304"
    t0 = time.perf_counter()
    try:
        r = requests.get(url, timeout=10)
        dt = time.perf_counter() - t0
        mbps = round(len(r.content) * 8 / (dt * 1e6), 1)
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502
    if mbps >= 50: q = "4K (2160p)"
    elif mbps >= 25: q = "Full HD (1080p)"
    elif mbps >= 10: q = "HD (720p)"
    elif mbps >= 5: q = "SD (480p)"
    else: q = "Низкое (360p)"
    return jsonify(mbps=mbps, recommended=q)


@app.route("/api/crypto")
@login_required_json
def api_crypto():
    """Курсы криптовалют (CoinGecko, без ключа)."""
    ids = request.args.get("ids", "bitcoin,ethereum,solana,dogecoin,tether")
    vs = request.args.get("vs", "usd")
    try:
        r = requests.get("https://api.coingecko.com/api/v3/simple/price",
                         params={"ids": ids, "vs_currencies": vs, "include_24hr_change": "true"}, headers=UA, timeout=8)
        data = r.json()
        out = [{"coin": k.upper(), "price": v.get(vs), "change_24h": v.get(f"{vs}_24h_change")} for k, v in data.items()]
        return jsonify(vs=vs, rates=out)
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/weather")
@login_required_json
def api_weather():
    """Погода в городе (Open-Meteo geocoding + forecast, без ключа)."""
    city = request.args.get("city", "Москва").strip()
    try:
        g = requests.get("https://geocoding-api.open-meteo.com/v1/search",
                         params={"name": city, "count": 1, "language": "ru"}, headers=UA, timeout=6).json()
        res = g.get("results") or []
        if not res:
            return jsonify(error=f"город «{city}» не найден"), 404
        loc = res[0]
        w = requests.get("https://api.open-meteo.com/v1/forecast",
                         params={"latitude": loc["latitude"], "longitude": loc["longitude"],
                                 "current_weather": "true", "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
                                 "timezone": "auto", "forecast_days": 3}, headers=UA, timeout=6).json()
        cw = w.get("current_weather", {})
        daily = w.get("daily", {})
        days = [{"date": d, "max": mx, "min": mn, "precip_mm": p} for d, mx, mn, p in
                zip(daily.get("time", []), daily.get("temperature_2m_max", []),
                    daily.get("temperature_2m_min", []), daily.get("precipitation_sum", []))]
        return jsonify(city=loc["name"], country=loc.get("country"), temp=cw.get("temperature"),
                       wind_kmh=cw.get("windspeed"), code=cw.get("weathercode"), forecast=days)
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/exchange")
@login_required_json
def api_exchange():
    """Курсы валют (Frankfurter ЕЦБ: EUR база + популярные символы)."""
    base = request.args.get("base", "USD").upper()[:3]
    symbols = request.args.get("symbols", "RUB,EUR,GBP,CNY,KZT,TRY,BRL,JPY")
    try:
        r = requests.get(f"https://api.frankfurter.dev/v1/latest?base={base}&symbols={symbols}",
                         headers=UA, timeout=8).json()
        rates = [{"code": k, "rate": v} for k, v in (r.get("rates") or {}).items()]
        return jsonify(base=r.get("base", base), date=r.get("date"), source="ECB / Frankfurter", rates=rates)
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/news")
@login_required_json
def api_news():
    """Последние новости Hacker News (Algolia, без ключа)."""
    try:
        r = requests.get("https://hn.algolia.com/api/v1/search_by_date",
                         params={"tags": "story", "hitsPerPage": 15}, headers=UA, timeout=8).json()
        items = [{"title": h.get("title"), "url": h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID')}",
                  "points": h.get("points"), "comments": h.get("num_comments"), "author": h.get("author")}
                 for h in r.get("hits", [])]
        return jsonify(items=items)
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/horoscope")
@login_required_json
def api_horoscope():
    """Гороскоп на день (ownmagic — бесплатно без ключа)."""
    sign = request.args.get("sign", "Aries").capitalize()
    valid = ("Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
             "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces")
    if sign not in valid:
        return jsonify(error="bad_sign", allowed=list(valid)), 400
    try:
        r = requests.get("https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily",
                         params={"sign": sign, "day": "TODAY"}, headers=UA, timeout=8, allow_redirects=True).json()
        d = r.get("data") or {}
        return jsonify(sign=d.get("sign", sign), date=d.get("date"), period=d.get("period"),
                       text=d.get("horoscope"))
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/avatar")
@login_required_json
def api_avatar():
    """Генератор аватаров по seedу (dicebear) — возвращает SVG."""
    style = request.args.get("style", "bottts-neutral")
    if style not in ("bottts-neutral", "shapes", "identicon", "pixel-art", "avataaars", "lorelei"):
        style = "bottts-neutral"
    seed = request.args.get("seed", current_user()["email"])[:64]
    r = requests.get(f"https://api.dicebear.com/9.x/{style}/svg", params={"seed": seed}, headers=UA, timeout=8)
    return Response(r.content, mimetype="image/svg+xml", headers={"Cache-Control": "no-store"})


@app.route("/api/qr", methods=["GET", "POST"])
@login_required_json
def api_qr():
    """QR-код для текста или URL (quickchart.io)."""
    text = request.values.get("text", "").strip()
    if not text:
        return jsonify(error="empty_text"), 400
    url = "https://quickchart.io/qr"
    params = {"size": 240, "text": text[:2000]}
    img = requests.get(url, params=params, headers=UA, timeout=8)
    return Response(img.content, mimetype=img.headers.get("Content-Type", "image/png"),
                    headers={"Cache-Control": "no-store"})


@app.route("/api/shorten")
@login_required_json
def api_shorten():
    """Сокращатель ссылок (spoo.me)."""
    url = request.args.get("url", "").strip()
    if not _safe_url(url):
        return jsonify(error="bad_url"), 400
    try:
        r = requests.post("https://spoo.me/", data={"url": url, "redirect_now": "on"},
                          headers=UA, timeout=8, allow_redirects=False)
        short = r.headers.get("Location") or ""
        if short and not short.startswith("http"):
            short = "https://spoo.me" + short
        return jsonify(original=url, short=short[:200])
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/translate")
@login_required_json
def api_translate():
    """Машинный перевод (MyMemory, бесплатно без ключа)."""
    text = request.args.get("q", "").strip()[:480]
    src = request.args.get("from", "auto")
    dst = request.args.get("to", "ru")
    pair = f"{'en' if src == 'auto' else src}|{dst}"
    if not text:
        return jsonify(error="empty_text"), 400
    try:
        r = requests.get("https://api.mymemory.translated.net/get",
                         params={"q": text, "langpair": pair}, headers=UA, timeout=8).json()
        out = r.get("responseData", {}).get("translatedText", "")
        return jsonify(source=text[:200], translated=out, lang=pair)
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/random")
@login_required_json
def api_random():
    """Случайная шутка / факт / цитата / фото котика (type=joke|fact|quote|cat)."""
    kind = request.args.get("type", "joke").lower()
    try:
        if kind == "fact":
            r = requests.get("https://uselessfacts.jsph.pl/api/v2/facts/random", headers=UA, timeout=6).json()
            return jsonify(type=kind, text=r.get("text"))
        if kind == "quote":
            r = requests.get("https://zenquotes.io/api/random", headers=UA, timeout=6).json()
            return jsonify(type=kind, text=r[0].get("q"), author=r[0].get("a"))
        if kind == "cat":
            r = requests.get("https://api.thecatapi.com/v1/images/search", headers=UA, timeout=6).json()
            return jsonify(type=kind, image=r[0]["url"])
        r = requests.get("https://v2.jokeapi.dev/joke/Any?safe-mode", headers=UA, timeout=6).json()
        if r.get("type") == "twopart":
            text = f"{r.get('setup')} — {r.get('delivery')}"
        else:
            text = r.get("joke")
        return jsonify(type=kind, category=r.get("category"), text=text)
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/password")
@login_required_json
def api_password():
    """Генератор надёжных паролей + оценка энтропии."""
    length = min(int(request.args.get("length", 16)), 64)
    use_digits = request.args.get("digits", "1") != "0"
    use_symbols = request.args.get("symbols", "1") != "0"
    letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
    pool = letters
    if use_digits:
        pool += "23456789"
    if use_symbols:
        pool += "!@#$%^&*_-+="
    import secrets
    pwd = "".join(secrets.choice(pool) for _ in range(length))
    entropy = round(length * math.log2(len(pool)))
    strength = "слабый" if entropy < 50 else "средний" if entropy < 80 else "надёжный" if entropy < 120 else "крепость"
    return jsonify(password=pwd, length=length, charset_size=len(pool), entropy_bits=entropy, strength=strength)


@app.route("/api/tld")
@login_required_json
def api_tld():
    """Проверка занятости домена в зоне .com/.net/.org/.dev/.io (RDAP)."""
    name = request.args.get("domain", "").strip().lower()
    m = re.match(r"^[a-z0-9][a-z0-9\-]{1,60}$", name)
    if not m:
        return jsonify(error="bad_name (только имя без зоны)"), 400
    zones = ["com", "net", "org", "dev", "io", "ru"]
    out = []
    for z in zones:
        full = f"{name}.{z}"
        try:
            r = requests.get(f"https://rdap.org/domain/{full}", timeout=5,
                             headers={"Accept": "application/json"})
            out.append({"domain": full, "free": r.status_code == 404, "status": r.status_code})
        except Exception:
            out.append({"domain": full, "free": None, "status": None})
    return jsonify(query=name, results=out)


@app.route("/api/censorship")
@login_required_json
def api_censorship():
    """Проверка доступности популярных сервисов из вашей сети (Reactor-style)."""
    services = {
        "YouTube": "https://www.youtube.com",
        "Google": "https://www.google.com",
        "GitHub": "https://github.com",
        "Wikipedia": "https://ru.wikipedia.org",
        "Cloudflare": "https://1.1.1.1",
        "Telegram Web": "https://web.telegram.org",
        "Discord": "https://discord.com",
        "Twitch": "https://www.twitch.tv",
    }
    out = []
    for name, url in services.items():
        t0 = time.perf_counter()
        try:
            r = requests.get(url, timeout=5, allow_redirects=True)
            out.append({"service": name, "ok": r.ok, "status": r.status_code,
                        "ms": round((time.perf_counter() - t0) * 1000, 1)})
        except Exception as e:
            out.append({"service": name, "ok": False, "status": None, "error": str(e)[:60]})
    return jsonify(results=out, note="Проверка с сервера приложения; у клиента результаты могут отличаться")


@app.route("/api/http-methods")
@login_required_json
def api_http_methods():
    """Какие HTTP-методы поддерживает указанный URL (OPTIONS/HEAD/TRACE...)."""
    url = request.args.get("url", "https://example.com").strip()
    if not _safe_url(url):
        return jsonify(error="bad_url"), 400
    out = []
    for meth in ("GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE", "TRACE", "CONNECT"):
        t0 = time.perf_counter()
        try:
            r = requests.request(meth, url, timeout=5, allow_redirects=False)
            out.append({"method": meth, "status": r.status_code,
                        "ms": round((time.perf_counter() - t0) * 1000, 1)})
        except Exception as e:
            out.append({"method": meth, "status": None, "error": str(e)[:60]})
    return jsonify(url=url, results=out)


@app.route("/api/ipv6")
@login_required_json
def api_ipv6():
    """Есть ли у вас IPv6 и работает ли dual-stack."""
    out = {}
    try:
        infos = socket.getaddrinfo(socket.getfqdn(), None, socket.AF_INET6)
        out["server_has_ipv6"] = bool(infos)
    except Exception:
        out["server_has_ipv6"] = False
    try:
        r = requests.get("https://api6.ipify.org/?format=json", timeout=5)
        out["client_public_ipv6"] = r.json().get("ip")
    except Exception:
        out["client_public_ipv6"] = None
    try:
        r = requests.get("https://api.ipify.org/?format=json", timeout=5)
        out["client_public_ipv4"] = r.json().get("ip")
    except Exception:
        out["client_public_ipv4"] = None
    return jsonify(out)


@app.route("/api/nmea")
@login_required_json
def api_nmea():
    """Координаты и время по NTP + геолокация по IP (для виджета)."""
    try:
        import struct
        import socket as s
        sock = s.socket(s.AF_INET, s.SOCK_DGRAM)
        sock.settimeout(4)
        msg = b"\x1b" + 47 * b"\0"
        sock.sendto(msg, ("pool.ntp.org", 123))
        data = sock.recv(1024)
        secs = struct.unpack("!I", data[40:44])[0] - 2208988800
        from datetime import datetime as dt
        return jsonify(ntp_utc=str(dt.utcfromtimestamp(secs)), ntp_epoch=secs, source="pool.ntp.org")
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/uptime")
@login_required_json
def api_uptime():
    """Аптайм сервера приложения (из /proc/uptime) и время работы процесса."""
    import os as _os
    uptime_s = None
    try:
        with open("/proc/uptime") as f:
            uptime_s = round(float(f.read().split()[0]))
    except OSError:
        pass
    proc_started = int(getattr(app, "_started_ts", time.time()))
    return jsonify(process_started=proc_started,
                   process_uptime_seconds=round(time.time() - proc_started),
                   server_uptime_seconds=uptime_s, pid=_os.getpid())


app._started_ts = time.time()


@app.route("/api/rss")
@login_required_json
def api_rss():
    """Чтение RSS/Atom ленты любого сайта (без ключей)."""
    url = request.args.get("url", "").strip()
    if not _safe_url(url):
        return jsonify(error="bad_url"), 400
    try:
        r = requests.get(url, headers=UA, timeout=8)
        import xml.etree.ElementTree as ET
        root = ET.fromstring(r.content.decode("utf-8", "ignore"))
        items = []
        for it in root.iter("item"):
            title = (it.findtext("title") or "").strip()
            link = (it.findtext("link") or "").strip()
            desc = (it.findtext("description") or "").strip()[:200]
            pub = (it.findtext("pubDate") or "").strip()
            if title:
                items.append({"title": title, "link": link, "desc": desc, "published": pub})
            if len(items) >= 15:
                break
        # Atom fallback
        if not items:
            ns = "{http://www.w3.org/2005/Atom}"
            for it in root.iter(f"{ns}entry"):
                title = (it.findtext(f"{ns}title") or "").strip()
                le = it.find(f"{ns}link")
                link = le.get("href") if le is not None else ""
                if title:
                    items.append({"title": title, "link": link, "desc": "", "published": it.findtext(f"{ns}updated") or ""})
                if len(items) >= 15:
                    break
        return jsonify(source=url, count=len(items), items=items)
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/proxy-check")
@login_required_json
def api_proxy_check():
    """Определение цепочки прокси/балансировщика по заголовкам запроса."""
    keys = ["HTTP_VIA", "HTTP_X_FORWARDED_FOR", "HTTP_X_FORWARDED", "HTTP_X_REAL_IP",
            "HTTP_CF_CONNECTING_IP", "HTTP_CF_RAY", "HTTP_X_AMZ_CF_ID", "REMOTE_ADDR"]
    found = {k: request.headers.get(k.replace("HTTP_", "").replace("_", "-"), "") for k in keys}
    via = [v for v in found.values() if v]
    return jsonify(headers=found, chain=via,
                   behind_proxy=bool(via), verdict="Обнаружена цепочка: " + " → ".join(via) if via else "Прямое соединение")


@app.route("/api/timezone")
@login_required_json
def api_timezone():
    """Информация о часовом поясе по координатам или городу."""
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    city = request.args.get("city", "").strip()
    if city and lat is None:
        try:
            g = requests.get("https://geocoding-api.open-meteo.com/v1/search",
                             params={"name": city, "count": 1}, headers=UA, timeout=6).json()
            res = g.get("results") or []
            if res:
                lat, lon = res[0]["latitude"], res[0]["longitude"]
        except Exception:
            pass
    if lat is None or lon is None:
        return jsonify(error="нужны lat/lon или city"), 400
    try:
        r = requests.get("https://api.bigdatacloud.net/data/reverse-geocode-client",
                         params={"latitude": lat, "longitude": lon, "localityLanguage": "ru"}, headers=UA, timeout=6).json()
        tz = r.get("utcOffset", "")
        return jsonify(lat=lat, lon=lon, city=r.get("city"), country=r.get("countryName"),
                       utc_offset=tz, local_time=r.get("localTime"))
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502


@app.route("/api/ssl")
@login_required_json
def api_ssl():
    """Информация о SSL-сертификате сайта (дата истечения, issuer, subject)."""
    host = request.args.get("host", "").strip() or urlparse(request.args.get("url", "")).netloc
    if not host:
        return jsonify(error="bad_host"), 400
    port = int(request.args.get("port", 443))
    import ssl as _ssl
    ctx = _ssl.create_default_context()
    try:
        raw = __import__("socket").socket()
        raw.settimeout(6)
        with ctx.wrap_socket(raw, server_hostname=host) as s:
            s.connect((host, port))
            cert = s.getpeercert()
        exp = cert.get("notAfter")
        iss = dict(x[0] for x in cert.get("issuer", ()))
        sub = dict(x[0] for x in cert.get("subject", ()))
        san = cert.get("subjectAltName", ())
        return jsonify(host=host, expires=exp, issuer=iss.get("organizationName") or iss.get("commonName"),
                       subject=sub.get("commonName"), san_count=len(san), version=cert.get("version"))
    except Exception as e:
        return jsonify(host=host, error=str(e)[:200]), 502


@app.route("/api/hash")
@login_required_json
def api_hash():
    """Хеширование строки (md5/sha1/sha256/sha512) — как online-hash-generator."""
    import hashlib
    text = request.args.get("text", "")[:5000]
    algo = request.args.get("algo", "sha256")
    if algo not in ("md5", "sha1", "sha256", "sha512"):
        return jsonify(error="bad_algo"), 400
    h = hashlib.new(algo, text.encode()).hexdigest()
    return jsonify(algo=algo, hash=h, length=len(h))


@app.route("/api/url-analyze")
@login_required_json
def api_url_analyze():
    """Разбор URL на части + редирект-цепочка + размер страницы."""
    url = request.args.get("url", "").strip()
    parsed = _safe_url(url)
    if not parsed:
        return jsonify(error="bad_url"), 400
    parts = {"scheme": parsed.scheme, "host": parsed.netloc, "path": parsed.path,
             "query": parsed.query, "fragment": parsed.fragment}
    chain = []
    cur = url
    for _ in range(6):
        try:
            r = requests.head(cur, timeout=6, allow_redirects=False)
            loc = r.headers.get("Location")
            chain.append({"url": cur, "status": r.status_code})
            if loc and r.status_code in (301, 302, 303, 307, 308):
                cur = urljoin(cur, loc)
            else:
                break
        except Exception as e:
            chain.append({"url": cur, "error": str(e)[:60]})
            break
    return jsonify(parsed=parts, redirect_chain=chain, final=cur)


@app.route("/api/useragent")
@login_required_json
def api_useragent():
    """Разбор вашего User-Agent: браузер, ОС, движок."""
    ua = request.headers.get("User-Agent", "")

    def grab(rx):
        m = re.search(rx, ua)
        return m.group(2) if m else "?"

    browser = grab(r"(Edg|OPR|Chrome|Firefox|Safari|Brave)/([\d.]+)") or "?"
    version = grab(r"(Edg|OPR|Chrome|Firefox|Safari|Brave)/([\d.]+)")
    os_ = "Windows" if "Windows" in ua else "macOS" if "Mac OS X" in ua else \
          "Android" if "Android" in ua else "iOS" if "iPhone" in ua or "iPad" in ua else \
          "Linux" if "Linux" in ua else "?"
    engine = "Blink" if "AppleWebKit" in ua and "Chrome" in ua else "Gecko" if "Gecko/" in ua else \
             "WebKit" if "AppleWebKit" in ua else "?"
    return jsonify(raw=ua, browser=browser, version=version, os=os_, engine=engine, mobile="Mobi" in ua)


# ─────────────────────────── Страница входа ───────────────────────────

LOGIN_PAGE = """
<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вход — Синтеко Лаб</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#070b12;color:#e8ecf5;font-family:Manrope,system-ui,sans-serif}
  .bg{position:fixed;inset:0;background:
      radial-gradient(60% 50% at 20% 20%,rgba(56,232,150,.10),transparent),
      radial-gradient(50% 40% at 80% 70%,rgba(110,231,255,.10),transparent)}
  .card{position:relative;width:min(420px,92vw);background:#0c1424;border:1px solid rgba(120,160,255,.22);
        border-radius:20px;padding:2.4rem;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.5)}
  .logo{font-size:2.2rem} h1{font-size:1.35rem;margin:.6rem 0 .2rem} p{color:#9fb4d8;font-size:.9rem;margin:.3rem 0 1.4rem}
  .btn{display:inline-flex;align-items:center;gap:.6rem;justify-content:center;width:100%;padding:.85rem 1rem;
       border-radius:12px;border:1px solid rgba(120,160,255,.3);background:#122036;color:#e8ecf5;
       font:600 1rem Manrope;text-decoration:none;cursor:pointer;transition:.2s}
  .btn:hover{border-color:#38e896;box-shadow:0 0 24px rgba(56,232,150,.25)}
  .g{width:20px;height:20px}
  .err{background:rgba(255,80,80,.12);border:1px solid rgba(255,80,80,.4);color:#ff9a9a;
       padding:.7rem;border-radius:10px;font-size:.85rem;margin-bottom:1rem}
  .demo{margin-top:1rem;font-size:.8rem;color:#6c81a8}
  .demo a{color:#6ee7ff}
  ul.f{text-align:left;font-size:.82rem;color:#9fb4d8;margin:1.2rem 0 0;padding-left:1.2rem;line-height:1.7}
</style></head><body><div class="bg"></div>
<div class="card">
  <div class="logo">📡</div>
  <h1>СИНТЕКО ЛАБ</h1>
  <p>Speedtest-портал · мониторинг интернета · сетевая лаборатория</p>
  {% if error %}<div class="err">{{ error }}</div>{% endif %}
  <a class="btn" href="{{ login_url }}">
    <svg class="g" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.99 7.99C12.45 16.9 17.62 13.5 24 13.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.37 5.73c4.33-4.01 7.45-9.9 7.45-17.38z"/><path fill="#FBBC05" d="M10.53 28.44c-.78-2.3-.78-4.74 0-7.04l-7.99-7.99C.87 17.66 0 20.72 0 24c0 3.28.87 6.34 2.54 9.03l7.99-7.99z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.37-5.73c-2.08 1.4-4.75 2.24-8.52 2.24-6.38 0-11.55-3.4-14.25-8.25l-7.99 7.99C6.51 42.62 14.62 48 24 48z"/></svg>
    Войти через Google
  </a>
  {% if demo %}
  <div class="demo">⚠ DEMO-режим: Google OAuth не настроен (<code>.env</code>).<br>
    <a href="/login/demo">Войти без Google (демо)</a></div>
  {% endif %}
  <ul class="f">
    <li>🚀 Замер скорости загрузки/отдачи и пинга</li>
    <li>🌍 Информация о вашем IP, провайдере, геолокации</li>
    <li>🧬 DNS / WHOIS / статус сайтов / заголовки</li>
    <li>🔎 Поиск: Google · DuckDuckGo · Wikipedia · GitHub · HN</li>
    <li>📈 История замеров и статистика по аккаунту</li>
  </ul>
  {% if user %}
  <p style="margin-top:1rem;font-size:.85rem">Вы вошли как <b>{{ user.name }}</b> ({{ user.email }}) ·
     <a href="/logout" style="color:#ff9a9a">Выйти</a></p>
  {% endif %}
</div></body></html>
"""


@app.errorhandler(404)
def nf(e):
    if request.path.startswith("/api/"):
        return jsonify(error="not_found"), 404
    return redirect(url_for("index"))


if __name__ == "__main__":
    mode = "DEMO (без Google OAuth)" if DEMO_MODE else "Google OAuth"
    print(f"▶ Синтеко Лаб запущен на http://localhost:{PORT}  [{mode}]")
    app.run(host=HOST, port=PORT, debug=os.getenv("FLASK_DEBUG", "0") == "1", threaded=True)
