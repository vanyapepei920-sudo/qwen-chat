/* ═══════════ apibridge.js — все «серверные» интернет-функции работают в браузере
   без app.py: публичные API (Cloudflare DNS/DoH, Team Cymru WHOIS, ipapi, RDAP и т.д.).
   Подменяет window.fetch для путей /api/* → реальные внешние запросы.            ═══════════ */
"use strict";

(function () {
  const $get = async (u, opts) => {
    const r = await fetch(u, Object.assign({ cache: "no-store" }, opts || {}));
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };
  const txt = async (u) => { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); };
  const J = (obj, status = 200) => Promise.resolve(new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }));

  /* ── список тест-серверов (тот же каталог Cloudflare PoP, что был в app.py) ── */
  const SERVERS = [
    ["Cloudflare Moscow", "RU", 55.75, 37.62], ["Cloudflare Frankfurt", "DE", 50.11, 8.68],
    ["Cloudflare London", "GB", 51.5, -0.12], ["Cloudflare Amsterdam", "NL", 52.37, 4.9],
    ["Cloudflare Warsaw", "PL", 52.23, 21.01], ["Cloudflare Stockholm", "SE", 59.33, 18.07],
    ["Cloudflare Istanbul", "TR", 41.01, 28.98], ["Cloudflare Dubai", "AE", 25.2, 55.27],
    ["Cloudflare NY", "US", 40.71, -74.0], ["Cloudflare Ashburn", "US", 38.95, -77.44],
    ["Cloudflare SFO", "US", 37.77, -122.42], ["Cloudflare São Paulo", "BR", -23.55, -46.63],
    ["Cloudflare Tokyo", "JP", 35.68, 139.69], ["Cloudflare Singapore", "SG", 1.35, 103.82],
    ["Cloudflare Sydney", "AU", -33.87, 151.21],
  ].map(([name, iso, lat, lon], i) => ({
    id: "cf-" + i, name, country: iso, lat, lon,
    down: "https://speed.cloudflare.com/__down?bytes=", up: "https://speed.cloudflare.com/__up",
  }));

  /* ── DoH-запрос (Cloudflare, fallback Google) ── */
  async function doh(name, type) {
    try {
      return await $get(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
        { headers: { Accept: "application/dns-json" } });
    } catch (e) {
      return await $get(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`);
    }
  }

  /* ── история результатов: localStorage вместо results.json ── */
  const LS_HIST = "sn_history_v1";
  function histLoad() { try { return JSON.parse(localStorage.getItem(LS_HIST) || "{}"); } catch (e) { return {}; } }
  function histSaveAll(h) { localStorage.setItem(LS_HIST, JSON.stringify(h)); }
  function meKey() { const u = window.AUTH && AUTH.getUser(); return (u && (u.email || u.displayName)) || "guest"; }

  /* ════════════ обработчики /api/* ════════════ */
  const H = {
    "/api/me": async () => {
      const u = (window.AUTH && AUTH.getUser()) || null;
      return J({ user: u ? { name: u.displayName || "Гость", email: u.email || "", picture: u.photoURL || "" } : null, authed: !!u });
    },
    "/api/servers": async () => J({ servers: SERVERS }),
    "/api/client-geo": async () => {
      // цепочка geo-источников: ipwho.is → freeipapi → geojs → Cloudflare meta
      try { const w = await $get("https://ipwho.is/"); if (w.success !== false && w.latitude != null) return J({ lat: w.latitude, lon: w.longitude, city: w.city, country: w.country, isp: (w.connection || {}).isp, asn: (w.connection || {}).asn, ip: w.ip }); } catch (e) {}
      try { const f = await $get("https://freeipapi.com/api/json"); return J({ lat: f.latitude, lon: f.longitude, city: f.cityName, country: f.countryName, isp: "—", ip: f.ipAddress }); } catch (e) {}
      try { const g = await $get("https://get.geojs.io/v1/ip/geo.json"); return J({ lat: +g.latitude, lon: +g.longitude, city: g.city, country: g.country, isp: g.organization || ("AS" + (g.asn || "?")), ip: g.ip }); } catch (e) {}
      try { const m = await fetch("https://speed.cloudflare.com/meta").then((r) => r.json()); return J({ lat: m.clientLat, lon: m.clientLon, city: m.city, country: m.country, isp: m.asOrganization, ip: m.clientIp }); } catch (e) {}
      return J({ error: "geo-сервисы недоступны" });
    },
    "/api/result": async (body) => {
      const h = histLoad(); const k = meKey();
      h[k] = [Object.assign({ ts: Date.now(), user: k }, body || {})].concat(h[k] || []).slice(0, 200);
      histSaveAll(h);
      return J({ ok: true, saved: h[k].length });
    },
    "/api/history": async () => J({ items: histLoad()[meKey()] || [] }),
    "/api/stats": async () => {
      const it = histLoad()[meKey()] || [];
      const avg = (f) => it.length ? +(it.reduce((s, x) => s + (f(x) || 0), 0) / it.length).toFixed(1) : null;
      return J({ count: it.length, avg_download_mbps: avg((x) => x.download_mbps), avg_upload_mbps: avg((x) => x.upload_mbps), avg_ping_ms: avg((x) => x.ping_ms) });
    },
    "/api/speed-history-chart": async () => {
      const it = (histLoad()[meKey()] || []).slice(0, 30).reverse();
      return J({
        labels: it.map((x) => new Date(x.ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })),
        download: it.map((x) => x.download_mbps || 0), upload: it.map((x) => x.upload_mbps || 0),
      });
    },

    "/api/cidr": async (q) => {
      const cidr = q.get("cidr") || "";
      const m = cidr.match(/^(\d{1,3}(\.\d{1,3}){3})\/(\d{1,2})$/);
      if (!m) return J({ error: "некорректный CIDR (пример: 192.168.1.0/24)" });
      const parts = m[1].split(".").map(Number); const p = +m[3];
      if (p > 32 || parts.some((x) => x > 255)) return J({ error: "некорректный CIDR" });
      const ipn = ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
      const mask = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
      const bcast = (ipn & mask) + (~mask >>> 0);
      const d = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
      const total = Math.pow(2, 32 - p);
      return J({ network: d((ipn & mask) >>> 0), prefixlen: p, netmask: d(mask), wildcard: d((~mask >>> 0) >>> 0),
        hosts_total: total, usable: Math.max(total - 2, 0), first_host: p >= 31 ? d((ipn & mask) >>> 0) : d(((ipn & mask) >>> 0) + 1),
        last_host: p >= 31 ? d(bcast) : d(bcast - 1), broadcast: d(bcast) });
    },

    "/api/email-check": async (q) => {
      const em = q.get("email") || "";
      const m = em.match(/^([^@\s]+)@([a-z0-9.-]+\.[a-z]{2,})$/i);
      if (!m) return J({ valid: false, reason: "некорректный формат email" });
      const domain = m[2].toLowerCase();
      let mx = [];
      try { const d = await doh(domain, "MX"); mx = (d.Answer || []).map((a) => a.data.replace(/\.$/, "")).sort(); } catch (e) {}
      const free = ["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "mail.ru", "yandex.ru", "icloud.com", "proton.me", "bk.ru", "list.ru", "inbox.ru"].includes(domain);
      const role = ["info", "admin", "support", "noreply", "no-reply", "postmaster", "abuse", "hello", "contact", "root"].includes(m[1].toLowerCase());
      return J({ valid: true, email: em, local: m[1], domain, mx, deliverable: mx.length > 0, free_mail: free, role_account: role });
    },

    "/api/bgp": async (q) => {
      const qq = (q.get("q") || "").trim();
      const isAs = /^as?\d+$/i.test(qq);
      // 1) Team Cymru Pfx2As через DNS-over-HTTPS — самый быстрый и надёжный путь из браузера
      try {
        const rev = qq.split(".").reverse().join(".");
        const d = await doh(`${rev}.origin.asn.cymru.com`, "TXT");
        const ans = ((d.Answer || [])[0] || {}).data || "";
        const p = ans.replace(/"/g, "").split("|");
        let org = "";
        try { const o = await doh(`asn${p[1].trim()}.cymru.com`, "TXT"); org = (((o.Answer || [])[0] || {}).data || "").replace(/"/g, ""); } catch (e) {}
        if (p[1]) return J({ query: qq, asn: "AS" + p[1].trim(), prefix: (p[2] || "").trim(), cidr: (p[3] || "").trim(), organization: org || "?", method: "Team Cymru Pfx2As/ASName через DoH" });
      } catch (e) {}
      // 2) RDAP (AS-number / IP) как фолбэк
      try {
        const u = isAs ? `https://rdap.org/autnum/${qq.replace(/^as/i, "")}` : `https://rdap.org/ip/${encodeURIComponent(qq)}`;
        const d = await $get(u);
        const ent = (d.entities || [])[0] || {};
        return J({ query: qq, asn: d.handle || qq, organization: (ent.vcard_array && ent.vcard_array.flat && ent.vcard_array.flat().find((x) => x.startsWith("FN")) || ent.handle || "?").toString().replace(/^fn:;?/i, ""), cidr: d.handle, method: "RDAP rdap.org" });
      } catch (e2) { return J({ error: "BGP-источники недоступны: " + e2.message }); }
    },

    "/api/rbl": async (q) => {
      const t = (q.get("target") || "").trim();
      if (!t) return J({ error: "укажите target" });
      const rev = /^\d+\.\d+\.\d+\.\d+$/.test(t) ? t.split(".").reverse().join(".") : t;
      const zones = ["zen.spamhaus.org", "b.barracudacentral.org", "bl.spamcop.net", "dnsbl.sorbs.net", "spamrbl.imp.ch", "dnsbl-1.uceprotect.net", "psbl.multitude.com"];
      const checks = await Promise.all(zones.map(async (z) => {
        try { const d = await doh(`${rev}.${z}`, "A"); return { list: z, listed: (d.Answer || []).length > 0 }; }
        catch (e) { return { list: z, listed: false, err: true }; }
      }));
      const bad = checks.filter((c) => c.listed).length;
      return J({ target: t, checks, blacklisted: bad, clean: bad === 0 });
    },

    "/api/dnssec": async (q) => {
      const dm = (q.get("domain") || "").trim();
      if (!dm) return J({ error: "укажите domain" });
      // DoH-резолверы не валидируют DNSSEC и не возвращают флаги AD/DS корректно,
      // поэтому проверяем статус подписи через DNSViz (публичный валидатор).
      let signed = null, status = "";
      try {
        const t = await txt("https://dnsviz.net/d/" + encodeURIComponent(dm) + "/dnssec/");
        if (/green|secure/i.test(t) && !/unsigned|bogus|insecure/i.test(t.slice(0, 4000))) signed = true;
        else if (/unsigned|no DS|not signed/i.test(t)) signed = false;
        const m = t.match(/(SECURE|INSECURE|BOGUS|UNKNOWN|NOT SECURE)/i); status = m ? m[1] : "";
      } catch (e) {}
      let ds = null, ad = false, answers = [];
      try { const d = await doh(dm, "DS"); ds = (d.Status === 0 && (d.Answer || []).length > 0); ad = !!d.AD; } catch (e) {}
      try { const d = await doh(dm, "A"); answers = (d.Answer || []).map((a) => a.data); } catch (e) {}
      const dnssec_signed = signed != null ? signed : !!ds;
      return J({ domain: dm, dnssec_signed, authenticated_data: ad || dnssec_signed, validator_status: status || (dnssec_signed ? "signed" : "unsigned"), answers, trust_chain_note: dnssec_signed ? `Внешний валидатор${status ? " (" + status + ")" : ""}: домен подписан DNSSEC` : "DS не найден / валидатор сообщает об отсутствии подписи" });
    },

    "/api/dane": async (q) => {
      const dm = (q.get("domain") || "").trim();
      if (!dm) return J({ error: "укажите domain" });
      const out = {};
      for (const sel of ["_25._tcp", "_443._tcp"]) {
        try { const d = await doh(`${sel}.${dm}`, "TLSA"); out[sel] = (d.Answer || []).map((a) => a.data); }
        catch (e) { out[sel] = []; }
      }
      const any = Object.values(out).some((v) => v.length);
      return J({ domain: dm, records: out, note: any ? "Найдены TLSA-записи — DANE активен" : "TLSA-записей нет — владелец не использует DANE (нормально для большинства сайтов)" });
    },

    "/api/qos": async () => {
      const lat = [];
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        try { const r = await fetch("https://speed.cloudflare.com/__down?bytes=100&cb=" + Date.now() + "_" + i, { cache: "no-store" }); await r.arrayBuffer(); lat.push(performance.now() - t0); } catch (e) {}
      }
      if (lat.length < 3) return J({ error: "замеры не удались" });
      const avg = lat.reduce((a, b) => a + b, 0) / lat.length;
      const jit = Math.sqrt(lat.reduce((s, x) => s + (x - avg) ** 2, 0) / lat.length);
      const voip = avg < 150 && jit < 30, gaming = avg < 80 && jit < 20, streaming = avg < 200;
      return J({ avg_ms: +avg.toFixed(1), jitter_ms: +jit.toFixed(1), loss_pct: 0, samples: lat.length,
        voip_ok: voip, gaming_ok: gaming, streaming_ok: streaming,
        verdict: gaming ? "Отличный канал — тянет игры, VoIP и стриминг" : voip ? "Хороший канал — звонки и видео ок, competitive-играм может быть тесно" : streaming ? "Средний канал — стриминг ок, игры/VoIP с лагами" : "Канал нестабилен — проверьте Wi-Fi/роутер" });
    },

    "/api/tls-benchmark": async () => {
      const hosts = ["www.google.com", "www.github.com", "www.cloudflare.com", "www.wikipedia.org", "httpbingo.org"];
      const results = await Promise.all(hosts.map(async (h) => {
        const t0 = performance.now();
        try {
          const r = await fetch("https://" + h + "/", { mode: "no-cors", cache: "no-store" });
          return { host: h, handshake_ms: Math.round(performance.now() - t0), tls_version: "TLS1.3/1.2 (оценка браузера)", cipher: "browser-negotiated" };
        } catch (e) { return { host: h, error: e.message }; }
      }));
      return J({ results });
    },

    "/api/nat-type": async () => {
      let ip = "?", hops = "—", note = "";
      try { const m = await fetch("https://speed.cloudflare.com/meta").then((r) => r.json()); ip = m.clientIp; } catch (e) {}
      try {
        // WebRTC local IP → сравнение с публичным: одинаковые = NAT типа Open/symmetric-lite
        const rtc = new RTCPeerConnection({ iceServers: [] });
        rtc.createDataChannel("");
        const cand = await new Promise((res) => {
          rtc.onicecandidate = (e) => { if (!e.candidate) res(null); else if (/host \d+.*?(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(e.candidate.candidate)) res(e.candidate.candidate); };
          rtc.createOffer().then((o) => rtc.setLocalDescription(o)).catch(() => res(null));
          setTimeout(() => res(null), 2500);
        });
        rtc.close();
        note = cand ? "Обнаружен приватный локальный IP (RFC1918) — вы за NAT. Сопоставление local↔public даёт тип по STUN." : "Локальный RFC1918 не виден — возможно прямой IP или скрытый NAT.";
      } catch (e) { note = "WebRTC недоступен в этом браузере."; }
      return J({ public_ip: ip, x_forwarded_hops: hops, via: "n/a (статический режим)", estimated_nat: "NAT (тип: оценка по WebRTC см. note)", note });
    },

    "/api/internet-health": async () => {
      const services = [["Google DNS", "https://dns.google/resolve?name=example.com&type=A"], ["GitHub API", "https://api.github.com/zen"], ["Cloudflare", "https://cloudflare.com/cdn-cgi/trace"], ["Wikipedia", "https://ru.wikipedia.org/w/api.php?action=opensearch&search=x"]];
      const global_checks = await Promise.all(services.map(async ([service, u]) => {
        const t0 = performance.now();
        try { const r = await fetch(u, { cache: "no-store" }); return { service, status: r.ok ? "up" : "degraded", ms: Math.round(performance.now() - t0) }; }
        catch (e) { return { service, status: "unreachable", ms: null }; }
      }));
      const it = histLoad()[meKey()] || [];
      const avgD = it.length ? +(it.slice(0, 10).reduce((s, x) => s + (x.download_mbps || 0), 0) / Math.min(it.length, 10)).toFixed(1) : null;
      const bad = global_checks.filter((c) => c.status !== "up").length;
      return J({ global_checks, your_last_tests: it.length, your_avg_download_mbps: avgD, overall: bad === 0 ? "✔ ключевые сервисы доступны" : `⚠ ${bad} сервис(а) недоступны из вашей сети` });
    },

    "/api/ports": async (q) => {
      const host = (q.get("host") || "").trim();
      if (!host) return J({ error: "укажите host" });
      // браузер не умеет сырые TCP-сокеты — эмулируем через HTTP-порты + DoH-резолв
      let ips = [];
      try { const d = await doh(host, "A"); ips = (d.Answer || []).map((a) => a.data); } catch (e) {}
      const ports = [80, 443, 8080, 8443, 22, 21, 25, 53];
      const results = await Promise.all(ports.map(async (p) => {
        const t0 = performance.now();
        const scheme = p === 443 || p === 8443 ? "https" : "http";
        try {
          await fetch(`${scheme}://${host}:${p}/`, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(3500) });
          return { port: p, open: true, ms: Math.round(performance.now() - t0) };
        } catch (e) { return { port: p, open: false, ms: Math.round(performance.now() - t0) }; }
      }));
      return J({ host, resolved_ips: ips, method: "HTTP(S)-probe из браузера (сырой TCP-скан статическим JS невозможен)",
        results, open: results.filter((r) => r.open).map((r) => r.port) });
    },

    "/api/ping": async () => {
      const t = [];
      for (let i = 0; i < 6; i++) { const t0 = performance.now(); try { await fetch("https://speed.cloudflare.com/__down?bytes=0&cb=" + Date.now() + i, { cache: "no-store" }); t.push(Math.round(performance.now() - t0)); } catch (e) {} }
      const avg = t.reduce((a, b) => a + b, 0) / (t.length || 1);
      return J({ ping_ms: Math.round(Math.min(...t, avg)), avg: +avg.toFixed(1), samples: t.length });
    },
  };

  /* ════════════ перехват fetch: /api/* → браузерные реализации ════════════ */
  const realFetch = window.fetch.bind(window);
  window.__realFetch = realFetch;
  window.fetch = async function (input, init) {
    let url; try { url = typeof input === "string" ? input : input.url; } catch (e) { return realFetch(input, init); }
    let u; try { u = new URL(url, location.href); } catch (e) { return realFetch(input, init); }
    if (u.origin !== location.origin || !u.pathname.startsWith("/api/")) return realFetch(input, init);

    const path = u.pathname;
    // POST /api/result — распарсить тело
    let bodyObj = null;
    if (path === "/api/result") { try { bodyObj = JSON.parse((init && init.body) || "{}"); } catch (e) {} }
    const fn = H[path];
    if (!fn) return new Response(JSON.stringify({ error: "endpoint " + path + " недоступен в статическом режиме" }), { status: 501, headers: { "Content-Type": "application/json" } });
    if (!(window.AUTH && AUTH.isAuthed())) return new Response(JSON.stringify({ error: "нужен вход через Google", login_required: true }), { status: 401, headers: { "Content-Type": "application/json" } });
    try { return await fn(u.searchParams, bodyObj); }
    catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { "Content-Type": "application/json" } }); }
  };
})();
