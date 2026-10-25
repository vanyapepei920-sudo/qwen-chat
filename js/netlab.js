/* ═══════════ netlab.js — Сеть-лаборатория: 12 расширенных интернет-тестов,
   непрерывный мониторинг канала, параметры live-монитора, пороги тревог ═══════════ */
"use strict";

var NETLAB = (() => {
  const $ = s => document.querySelector(s);
  const out = t => { const e = $("#nlOut"); if (e) e.textContent = t; };
  function logEvent(level, text) { if (window.DASH && DASH.logEvent) DASH.logEvent(level, text); }

  async function jfetch(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  async function timed(url, opts) {
    const t0 = performance.now();
    try { const r = await fetch(url, Object.assign({ cache: "no-store" }, opts)); await r.arrayBuffer().catch(() => {}); return Math.round(performance.now() - t0); }
    catch (e) { return null; }
  }

  /* ─────────── ТЕСТЫ ─────────── */
  const TESTS = {
    async speedtest() {
      out("🚀 Быстрый speedtest: download 8 МБ + upload 1.5 МБ + ping…");
      const dlBytes = 8 * 1048576;
      const t0 = performance.now(); let got = 0;
      const r = await fetch("https://speed.cloudflare.com/__down?bytes=" + dlBytes + "&cb=" + Date.now());
      const rd = r.body.getReader();
      while (true) { const { done, value } = await rd.read(); if (done) break; got += value.length; }
      const dsec = (performance.now() - t0) / 1000;
      const down = got * 8 / dsec / 1e6;
      const upBlob = new Uint8Array(1.5 * 1048576);
      const u0 = performance.now();
      await fetch("https://speed.cloudflare.com/__up?cb=" + Date.now(), { method: "POST", body: upBlob, cache: "no-store" });
      const up = upBlob.length * 8 / ((performance.now() - u0) / 1000) / 1e6;
      const pings = [];
      for (let i = 0; i < 6; i++) { const ms = await timed("https://api.github.com/zen?cb=" + Date.now() + i); if (ms !== null) pings.push(ms); }
      const avg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;
      const grade = down > 200 && up > 100 ? "A+ оптика" : down > 80 ? "A быстрый канал" : down > 30 ? "B нормальный" : down > 10 ? "C слабый" : "D очень медленный";
      out(`DOWNLOAD ↓: ${down.toFixed(1)} Мбит/с (${got} Б за ${dsec.toFixed(2)} с)\nUPLOAD ↑: ${up.toFixed(1)} Мбит/с\nPING: ${avg ?? "—"} мс (${pings.join(", ")})\nОЦЕНКА: ${grade}`);
      logEvent("info", `NetLab speedtest: ↓${down.toFixed(0)} ↑${up.toFixed(0)} Мбит/с, пинг ${avg} мс`);
    },
    async trace() {
      out("🗺 Замер задержки до точек присутствия Cloudflare по регионам…");
      const cols = [
        ["США San Jose", "sjc"], ["Нью-Йорк", "lga"], ["Чикаго", "ord"], ["Лондон", "lhr"],
        ["Франкфурт", "fra"], ["Амстердам", "ams"], ["Стокгольм", "arn"],
        ["Стамбул", "ist"], ["Токио", "nrt"], ["Сидней", "syd"], ["Сан Паулу", "gru"],
      ];
      const lines = [];
      for (const [name, colo] of cols) {
        const ms = await timed(`https://${colo}.cfargotunnel.com/__down?bytes=0&cb=` + Date.now());
        lines.push((name + "               ").slice(0, 16) + (ms === null ? " ✖ нет прямого доступа из браузера" : " " + ms + " мс"));
      }
      out("Точка присутствия → RTT (HTTP round-trip):\n" + lines.join("\n") + "\n\nПримечание: браузер не делает ICMP traceroute — это честная HTTP-оценка дальних узлов.");
    },
    async bwpoll() {
      out("📊 Непрерывный замер пропускной способности 60 с (chunk 2 МБ)…");
      const bytes = 2 * 1048576; const samples = [];
      const tEnd = performance.now() + 60000;
      while (performance.now() < tEnd) {
        const t0 = performance.now();
        try {
          const r = await fetch("https://speed.cloudflare.com/__down?bytes=" + bytes + "&cb=" + Date.now());
          const b = await r.arrayBuffer();
          const mbps = b.byteLength * 8 / ((performance.now() - t0) / 1000) / 1e6;
          samples.push(Math.round(mbps));
        } catch (e) { samples.push(0); }
        const secLeft = Math.ceil((tEnd - performance.now()) / 1000);
        out(`📊 Осталось ${secLeft} с · семплов: ${samples.length} · текущий: ${samples[samples.length - 1]} Мбит/с`);
      }
      const sorted = samples.slice().sort((a, b) => a - b);
      const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
      out(`60-секундный стрим-тест:\nсемплов: ${samples.length} · средний: ${avg} Мбит/с\nmin: ${sorted[0]} · p50: ${sorted[Math.floor(sorted.length / 2)]} · max: ${sorted[sorted.length - 1]} Мбит/с\nразброс: ${(sorted[sorted.length - 1] - sorted[0])} Мбит/с ${sorted[sorted.length - 1] - sorted[0] > avg ? "⚠ нестабильный канал" : "✔ стабильно"}`);
    },
    async browser() {
      const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const L = navigator;
      out(`ПАРАМЕТРЫ БРАУЗЕРА И СОЕДИНЕНИЯ:\n` +
        `Язык: ${L.language} · всего языков: ${(L.languages || []).join(", ")}\n` +
        `Платформа: ${L.platform} · ядер CPU: ${L.hardwareConcurrency || "?"}\n` +
        `Память устройства: ${(L.deviceMemory || "?")} ГБ · экран: ${screen.width}×${screen.height} @${devicePixelRatio}x\n` +
        `Cookie включены: ${L.cookieEnabled} · Do Not Track: ${L.doNotTrack || "нет"}\n` +
        `Online: ${L.onLine} · User-Agent: ${navigator.userAgent.slice(0, 90)}\n\n` +
        `Network Information API:\n` +
        (c ? `Тип сети: ${c.effectiveType || "н/д"} · downlink: ${c.downlink || "?"} Мбит/с · RTT: ${c.rtt || "?"} мс · saveData: ${c.saveData}` : "не поддерживается этим браузером"));
      if (navigator.getBattery) {
        try { const b = await navigator.getBattery(); out($("#nlOut").textContent + `\nБатарея: ${(b.level * 100).toFixed(0)}% · зарядка: ${b.charging}`); } catch (e) {}
      }
    },
    async storage() {
      out("💾 Запрашиваю квоты хранилища…");
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          const pct = est.quota ? (est.usage / est.quota * 100).toFixed(2) : "?";
          out(`Storage Management API:\nКвота диска: ${(est.quota / 1073741824).toFixed(2)} ГБ\nЗанято этим сайтом: ${(est.usage / 1048576).toFixed(1)} МБ (${pct}%)\nТипы: IndexedDB + Cache API + localStorage\nПерсистентность: ` + (navigator.storage.persist ? `${await navigator.storage.persisted() ? "закреплена ✓" : "не запрошена (нажмите «Применить» после grant)"}` : "нет API"));
        } else out("Storage Mgmt API недоступен");
      } catch (e) { out("✖ " + e.message); }
    },
    async media() {
      out("🎥 Проверяю пригодность канала и железа для стрима/звонка…");
      const pings = [];
      for (let i = 0; i < 8; i++) { const ms = await timed("https://speed.cloudflare.com/__down?bytes=1000&r=" + Date.now() + i); if (ms !== null) pings.push(ms); }
      let jit = null;
      if (pings.length > 1) { let s = 0; for (let i = 1; i < pings.length; i++) s += Math.abs(pings[i] - pings[i - 1]); jit = (s / (pings.length - 1)).toFixed(1); }
      const upBlob = new Uint8Array(1048576);
      const u0 = performance.now();
      let upMbps = null;
      try { await fetch("https://speed.cloudflare.com/__up", { method: "POST", body: upBlob, cache: "no-store" }); upMbps = upBlob.length * 8 / ((performance.now() - u0) / 1000) / 1e6; } catch (e) {}
      const cam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      const med = pings.length ? pings.sort((a, b) => a - b)[Math.floor(pings.length / 2)] : null;
      const verdict = (med !== null && med < 120 && jit < 30 && upMbps > 3)
        ? "✔ ГОДНО для видеозвонков и стрима 1080p" : upMbps > 1 ? "⚠ базовый 720p возможен, звонки могут дрожать" : "✖ канал не тянет видеозвонок";
      out(`Ping med: ${med ?? "—"} мс · max ${pings.length ? Math.max(...pings) : "—"} мс\nJitter: ${jit} мс (для VoIP нужно < 30)\nUpload: ${upMbps ? upMbps.toFixed(1) + " Мбит/с" : "—"} (для 1080p нужно > 5)\nКамера/микрофон доступны: ${cam ? "да" : "нет"}\n\nВЕРДИКТ: ${verdict}`);
    },
    async dnssec() {
      out("🔐 Сравнение DNS-резолверов (DoH)…");
      const name = prompt("Домен для DNS-запроса:", "github.com") || "github.com";
      const rows = [];
      for (const [lbl, url] of [
        ["Cloudflare 1.1.1.1", `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`],
        ["Google 8.8.8.8", `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=A`],
      ]) {
        const t0 = performance.now();
        try {
          const d = await jfetch(url, { headers: { Accept: "application/dns-json" } });
          const ips = (d.Answer || []).filter(a => a.type === 1).map(a => a.data).join(", ");
          rows.push(`${lbl}: ${Math.round(performance.now() - t0)} мс · A-записи: ${ips || "нет"} · TTL: ${(d.Answer || [])[0]?.TTL ?? "?"} c`);
        } catch (e) { rows.push(`${lbl}: ✖ ${e.message}`); }
      }
      out(`DNS-запрос «${name}» (A, DNS-over-HTTPS):\n${rows.join("\n")}\n\nОба резолвера шифруют запрос — провайдер не видит, какой домен вы резолвите.`);
    },
    async httpver() {
      out("📡 Оценка качества TLS/HTTP-соединений…");
      const targets = [["GitHub", "https://api.github.com/zen"], ["Cloudflare", "https://speed.cloudflare.com/__down?bytes=0"], ["Google", "https://www.gstatic.com/generate_204"]];
      const lines = [];
      for (const [n, u] of targets) {
        const cold = await timed(u + "?cb=c" + Date.now());
        const warm = await timed(u + "?cb=w" + Date.now());
        lines.push(`${n}: первый запрос (TLS handshake) ${cold ?? "✖"} мс · повторный (keep-alive) ${warm ?? "✖"} мс · экономия ${cold && warm ? cold - warm : "?"} мс`);
      }
      const res = await fetch("https://speed.cloudflare.com/meta", { cache: "no-store" }).then(r => r.json()).catch(() => null);
      out(lines.join("\n") + (res ? `\n\nВаши данные как видит Cloudflare edge:\nIP: ${res.clientIp} · ASN: ${res.asOrganization?.asn ?? "?"} · провайдер: ${res.asOrganization?.name ?? "?"}\nГород: ${res.city}, ${res.country}` : ""));
    },
    async lossburst() {
      out("📉 Серия из 30 пакетов (потери/таймауты)…");
      let ok = 0; const lat = [];
      for (let i = 0; i < 30; i++) {
        const ms = await timed("https://httpbingo.org/status/200?seq=" + i + "_" + Date.now());
        if (ms !== null) { ok++; lat.push(ms); }
        if (i % 5 === 4) out(`📉 отправлено ${i + 1}/30 · ответов ${ok}`);
      }
      const loss = ((30 - ok) / 30 * 100).toFixed(1);
      lat.sort((a, b) => a - b);
      out(`Серия 30 HTTP-ping к httpbingo.org:\nОтветило: ${ok}/30 · потери: ${loss}%\nlatency min/p50/max: ${lat[0] ?? "—"}/${lat[Math.floor(lat.length / 2)] ?? "—"}/${lat[lat.length - 1] ?? "—"} мс\n${loss > 10 ? "✖ серьёзные потери — проблема на линии" : loss > 0 ? "⚠ единичные потери" : "✔ потерь нет"}`);
    },
    async uplatency() {
      out("⏱ Ping под upload-нагрузкой (bufferbloat-тест)…");
      const base = [];
      for (let i = 0; i < 5; i++) { const m = await timed("https://speed.cloudflare.com/__down?bytes=1000&b=" + Date.now() + i); if (m !== null) base.push(m); }
      const stopLoad = { on: true };
      const loadLoop = (async () => {
        while (stopLoad.on) {
          try { await fetch("https://speed.cloudflare.com/__up", { method: "POST", body: new Uint8Array(2 * 1048576), cache: "no-store" }); } catch (e) { break; }
        }
      })();
      await new Promise(r => setTimeout(r, 1200));
      const under = [];
      for (let i = 0; i < 8; i++) { const m = await timed("https://speed.cloudflare.com/__down?bytes=1000&u=" + Date.now() + i); if (m !== null) under.push(m); }
      stopLoad.on = false; await loadLoop.catch(() => {});
      const bm = base.length ? base.sort((a, b) => a - b)[Math.floor(base.length / 2)] : 0;
      const um = under.length ? under.sort((a, b) => a - b)[Math.floor(under.length / 2)] : 0;
      const delta = um - bm;
      out(`Idle ping (med): ${bm} мс\nPing под upload-нагрузкой: ${um} мс\nЗадержка от нагрузки (bufferbloat): +${delta} мс\n${delta < 20 ? "✔ bufferbloat низкий — роутер/канал справляются" : delta < 80 ? "⚠ заметный bufferbloat — включите QoS на роутере" : "✖ сильный bufferbloat: звонки лагают, когда кто-то отдаёт трафик"}`);
    },
    async proxy() {
      out("🕵️ Детект VPN / прокси / дата-центра…");
      try {
        const w = await jfetch("https://ipwho.is/");
        const info = await jfetch("https://ipinfo.io/json");
        const sec = w.security || {};
        const isDC = /\b(cloud|hosting|cdn|datacenter|amazon|google|azure|digitalocean|ovh|hetzner)\b/i.test(info.org || "");
        out(`IP: ${w.ip} (${info.ip})\nПровайдер: ${(w.connection || {}).isp || info.org}\nASN: ${(w.connection || {}).asn || "?"} · тип сети: ${(w.connection || {}).type || "?"}\nVPN: ${sec.vpn ? "⚠ ОБНАРУЖЕН" : "нет"} · Proxy: ${sec.proxy ? "⚠ да" : "нет"} · Tor: ${sec.tor ? "⚠ да" : "нет"}\nДата-центр по org: ${isDC ? "⚠ похож на хостинг" : "нет — домашний/мобильный"}\nГеология: ${w.city}, ${w.country} (${w.latitude}, ${w.longitude})`);
      } catch (e) { out("✖ " + e.message); }
    },
    async ports() {
      const host = prompt("Хост для скана портов:", "example.com") || "example.com";
      out("🔌 Сканирую TCP-порты " + host + "…");
      try {
        const d = await jfetch("/api/ports?host=" + encodeURIComponent(host));
        const rows = d.results.map(r => (r.port + "       ").slice(0, 8) + (r.open ? "✔ ОТКРЫТ" : "✖ закрыт") + " · " + r.ms + " мс").join("\n");
        out(`Порты ${host}:\n${rows}\n\nОткрыто: ${d.open.join(", ") || "нет"}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async cidr() {
      const c = prompt("CIDR-подсеть (например 192.168.1.0/24):", "10.0.0.0/22") || "";
      try {
        const d = await jfetch("/api/cidr?cidr=" + encodeURIComponent(c));
        if (d.error) return out("✖ " + d.error);
        out(`CIDR ${c} →\nСеть: ${d.network}/${d.prefixlen} · маска: ${d.netmask}\nВсего адресов: ${d.hosts_total.toLocaleString()} · хостовых: ${d.usable.toLocaleString()}\nПервый хост: ${d.first_host} · последний: ${d.last_host}\nBroadcast: ${d.broadcast ?? "—"} · wildcard: ${d.wildcard ?? "—"}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async emailchk() {
      const em = prompt("Email для проверки:", "") || "";
      if (!em) return;
      try {
        const d = await jfetch("/api/email-check?email=" + encodeURIComponent(em));
        if (!d.valid) return out("✖ " + d.reason);
        out(`Email: ${d.email}\nЛокальная часть: ${d.local} · домен: ${d.domain}\nMX-серверы: ${(d.mx || []).join(", ") || "нет"}\nДоставка возможна: ${d.deliverable ? "да ✔" : "нет ✖"}\nПочтовый сервис бесплатный: ${d.free_mail ? "да" : "нет"} · ролевой ящик: ${d.role_account ? "да ⚠" : "нет"}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async bgpq() {
      const q = prompt("IP или номер ASN (например 8.8.8.8 или AS15164):", "8.8.8.8") || "";
      try {
        const d = await jfetch("/api/bgp?q=" + encodeURIComponent(q.replace(/^AS/i, "")));
        if (d.error) return out("✖ " + d.error);
        out("BGP/IRR данные (Team Cymru):\n" + Object.entries(d).map(([k, v]) => k + ": " + v).join("\n"));
      } catch (e) { out("✖ " + e.message); }
    },
    async rblchk() {
      const t = prompt("IP или домен для проверки в спам-листах:", "") || "";
      if (!t) return;
      out("🚫 Проверяю " + t + " в 7 RBL-зонах…");
      try {
        const d = await jfetch("/api/rbl?target=" + encodeURIComponent(t));
        const rows = d.checks.map(c => (c.list.padEnd(24)) + (c.listed ? "⚠ В СПИСКЕ" : "✔ чист")).join("\n");
        out(`RBL-проверка ${t}:\n${rows}\n\n${d.clean ? "✔ IP/домен не в блоклистах" : "⚠ найден в " + d.blacklisted + " списках"}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async dnssecapi() {
      const dm = prompt("Домен:", "google.com") || "google.com";
      try {
        const d = await jfetch("/api/dnssec?domain=" + encodeURIComponent(dm));
        out(`DNSSEC ${dm}:\nПодписан (DS-запись): ${d.dnssec_signed ? "да ✔" : "нет"}\nAuthenticated Data: ${d.authenticated_data ? "да ✔" : "нет"}\nA-записи: ${(d.answers || []).join(", ")}\n${d.trust_chain_note || d.error || ""}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async dane() {
      const dm = prompt("Домен для DANE/TLSA:", "github.com") || "";
      try {
        const d = await jfetch("/api/dane?domain=" + encodeURIComponent(dm));
        const rows = Object.entries(d.records).map(([k, v]) => k + ": " + (v.length ? v.join(" | ").slice(0, 80) : "нет записей")).join("\n");
        out(`DANE ${dm}:\n${rows}\n\n${d.note}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async qosapi() {
      out("🎮 QoS-классификация канала (10 замеров)…");
      try {
        const d = await jfetch("/api/qos");
        out(`QoS вашего канала (со стороны сервера):\nRTT: ${d.avg_ms} мс · джиттер: ${d.jitter_ms} мс · потери: ${d.loss_pct}%\nVoIP/звонки: ${d.voip_ok ? "✔ годно" : "✖ нет"}\nОнлайн-игры: ${d.gaming_ok ? "✔ годно" : "✖ нет"}\nСтриминг: ${d.streaming_ok ? "✔ годно" : "✖ нет"}\nВЕРДИКТ: ${d.verdict}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async tlsbench() {
      out("🤝 TLS-бенчмарк: хендшейки к 5 сайтам…");
      try {
        const d = await jfetch("/api/tls-benchmark");
        const rows = d.results.map(r => (r.host.padEnd(18)) + (r.error ? "✖ " + r.error.slice(0, 30) : `${r.handshake_ms} мс · ${r.tls_version} · ${r.cipher.split("-").slice(0, 2).join("-")}`)).join("\n");
        out("TLS handshake (полный, без сессии):\n" + rows);
      } catch (e) { out("✖ " + e.message); }
    },
    async nattype() {
      try {
        const d = await jfetch("/api/nat-type");
        out(`Оценка NAT по пути запроса:\nПубличный IP: ${d.public_ip}\nПрокси-хопов (XFF): ${d.x_forwarded_hops} · Via: ${d.via || "нет"}\nТип (оценка): ${d.estimated_nat}\n${d.note}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async health() {
      out("🌍 Проверяю здоровье ключевых сервисов интернета…");
      try {
        const d = await jfetch("/api/internet-health");
        const rows = d.global_checks.map(c => (c.service.padEnd(18)) + (c.status === "unreachable" ? "✖ недоступен" : `✔ ${c.status} · ${c.ms} мс`)).join("\n");
        out(`Глобальные статусы:\n${rows}\n\nВаши последние тесты: ${d.your_last_tests} · средний download: ${d.your_avg_download_mbps ?? "—"} Мбит/с\nОбщий вердикт: ${d.overall}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async hchart() {
      try {
        const d = await jfetch("/api/speed-history-chart?n=30");
        if (!d.labels.length) return out("История замеров пуста — сначала пройдите Speedtest.");
        const maxD = Math.max(...d.download.filter(x => x), 1);
        const bars = d.labels.map((lb, i) => lb + " ↓" + String(d.download[i] ?? 0).padStart(6) + " ↑" + String(d.upload[i] ?? 0).padStart(6) + " " + "█".repeat(Math.round((d.download[i] || 0) / maxD * 20))).join("\n");
        out(`История замеров (${d.labels.length}):\n${bars}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async uptime() {
      const url = prompt("URL для фонового uptime-мониторинга:", "https://api.github.com/zen");
      if (!url) return;
      if (NL.uptimeTimer) clearInterval(NL.uptimeTimer);
      let up = 0, down = 0, last = null;
      NL.uptimeTimer = setInterval(async () => {
        const ms = await timed(url + "?up=" + Date.now());
        const alive = ms !== null;
        alive ? up++ : down++; last = alive ? ms : "✖";
        const el = $("#nlHint");
        if (el) el.textContent = `uptime ${url.replace(/^https?:\/\//, "").slice(0, 24)}: ✔${up} ✖${down} · последняя ${typeof last === "number" ? last + " мс" : last}`;
        if (!alive) logEvent("warn", `Uptime-монитор: ${url} не ответил`);
      }, 15000);
      out(`🟢 Uptime-монитор запущен: ${url}\nПроверка каждые 15 с, счётчик — в шапке лаборатории. Повторный запуск теста заменяет монитор.`);
    },
  };

  const NL = { uptimeTimer: null, alarmState: false };

  /* ─────────── мониторинг + график + тревоги ─────────── */
  function renderStats(st) {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set("nlPingMin", st.pingMin != null ? st.pingMin + " мс" : "—");
    set("nlPingAvg", st.pingAvg != null ? st.pingAvg + " мс" : "—");
    set("nlPingMax", st.pingMax != null ? st.pingMax + " мс" : "—");
    set("nlLossTotal", NETMON.state.lastLoss + " % (текущ.)");
    set("nlCycles", st.cycles);
    set("nlTraffic", ((st.totalDownBytes + st.totalUpBytes) / 1048576).toFixed(1) + " МБ");
    drawChart(st.pings);
  }
  function drawChart(pings) {
    const cv = document.getElementById("nlChart");
    if (!cv || !window.CHARTS || pings.length < 2) return;
    CHARTS.line(cv, pings, { color: "#6ee7ff", area: true });
    const meta = document.getElementById("nlChartMeta");
    if (meta) meta.textContent = `пинг · ${pings.length} замеров · min ${Math.min(...pings)} / max ${Math.max(...pings)} мс`;
  }
  function checkAlarm(d) {
    const ap = +(localStorage.getItem("nl_alarm_ping") || 150);
    const asig = +(localStorage.getItem("nl_alarm_sig") || 45);
    const firstOk = (d.hosts.find(h => h.ok) || {}).ms;
    const bad = firstOk !== undefined && (firstOk > ap || d.signal < asig);
    if (bad && !NL.alarmState) {
      NL.alarmState = true;
      const msg = `Тревога качества связи: пинг ${firstOk} мс / сигнал ${d.signal}%`;
      toast(msg, "error"); logEvent("crit", msg);
      if (localStorage.getItem("nl_beep") === "1" && window.beep) beep(220, 0.35);
    } else if (!bad) NL.alarmState = false;
    const ab = document.getElementById("nlAlarmBtn");
    if (ab) ab.hidden = !NL.alarmState;
  }

  /* ─────────── init ─────────── */
  function init() {
    const tools = $("#nlTools");
    if (!tools) return;
    tools.addEventListener("click", e => {
      const b = e.target.closest(".wt"); if (!b) return;
      const fn = TESTS[b.dataset.tool]; if (!fn) return;
      document.querySelectorAll("#nlTools .wt").forEach(x => x.classList.remove("wt-active"));
      b.classList.add("wt-active");
      Promise.resolve(fn()).catch(err => out("✖ Ошибка теста: " + err.message)).finally(() => b.classList.remove("wt-active"));
    });

    const g = id => document.getElementById(id);
    if (g("nlPeriod")) g("nlPeriod").value = localStorage.getItem("nl_period") || "2500";
    if (g("nlDlBytes")) g("nlDlBytes").value = localStorage.getItem("nl_dl_bytes") || "4194304";
    if (g("nlHosts")) g("nlHosts").value = localStorage.getItem("nl_hosts") || "3";
    if (g("nlAutoPause")) g("nlAutoPause").checked = localStorage.getItem("nl_autopause") !== "0";
    if (g("nlAlarmPing")) g("nlAlarmPing").value = localStorage.getItem("nl_alarm_ping") || 150;
    if (g("nlAlarmSig")) g("nlAlarmSig").value = localStorage.getItem("nl_alarm_sig") || 45;
    if (g("nlBeepAlarm")) g("nlBeepAlarm").checked = localStorage.getItem("nl_beep") === "1";

    $("#nlApplyParams")?.addEventListener("click", () => {
      const p = +g("nlPeriod").value, d = +g("nlDlBytes").value, h = +g("nlHosts").value;
      localStorage.setItem("nl_period", p); localStorage.setItem("nl_dl_bytes", d); localStorage.setItem("nl_hosts", h);
      localStorage.setItem("nl_autopause", g("nlAutoPause").checked ? "1" : "0");
      localStorage.setItem("nl_alarm_ping", g("nlAlarmPing").value);
      localStorage.setItem("nl_alarm_sig", g("nlAlarmSig").value);
      localStorage.setItem("nl_beep", g("nlBeepAlarm").checked ? "1" : "0");
      NETMON.setConfig({ periodMs: p, dlBytes: d, hostsCount: h });
      if (NETMON.state.running) NETMON.restart();
      toast("Параметры применены" + (NETMON.state.running ? " · монитор перезапущен" : ""), "ok");
      logEvent("info", `Параметры сети обновлены: период ${p} мс, download ${d / 1048576} МБ, хостов ${h}`);
    });
    $("#nlResetStats")?.addEventListener("click", () => { NETMON.resetStats(); toast("Статистика сброшена", "ok"); });

    // при открытии вкладки лаборатории — автоматически запускаем live-мониторинг
    document.querySelector('[data-tab="netlab"]')?.addEventListener("click", () => {
      setTimeout(() => { if (!NETMON.state.running) NETMON.start(); renderStats(NETMON.getStats()); }, 40);
    });

    NETMON.on((evt, d) => {
      if (evt === "stats") renderStats(d);
      if (evt === "ping") checkAlarm(d);
    });
    renderStats(NETMON.getStats());
    // чип пользователя в топбаре (Google-аккаунт)
    jfetch("/api/me").then(d => {
      const n = document.getElementById("ucName"), av = document.getElementById("ucAvatar");
      if (n) n.textContent = (d.user.name || d.user.email).split(" ")[0];
      if (av && d.user.picture) { av.src = d.user.picture; av.hidden = false; }
    }).catch(() => {});


    document.addEventListener("visibilitychange", () => {
      if (localStorage.getItem("nl_autopause") === "0") return;
      const panel = document.getElementById("panel-netmon");
      const active = panel && panel.classList.contains("active");
      if (document.hidden && active && NETMON.state.running) NETMON.stop();
      else if (!document.hidden && active && !NETMON.state.running) { const b = document.getElementById("nmToggle"); if (b) b.click(); }
    });
  }

  return { init, TESTS, NL };
})();

document.addEventListener("DOMContentLoaded", () => NETLAB.init());
