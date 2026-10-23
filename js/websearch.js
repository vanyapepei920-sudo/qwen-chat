/* ═══════════ websearch.js — поиск в интернете (Google CSE API, DuckDuckGo, Wikipedia, GitHub, HN) + интернет-функции ═══════════ */
"use strict";

var WEBSEARCH = (() => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const $out = () => document.querySelector("#wsOut");
  const out = t => { const e = $out(); if (e) e.textContent = t; };
  const meta = t => { const e = document.querySelector("#wsMeta"); if (e) e.textContent = t; };

  function logEvent(level, text) { if (window.DASH && DASH.logEvent) DASH.logEvent(level, text); }

  async function jfetch(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error("HTTP " + r.status + " " + r.statusText);
    return r.json();
  }

  /* ─────────── движки поиска ─────────── */
  const ENGINES = {
    google: { name: "Google Custom Search", needsKey: true },
    ddg:    { name: "DuckDuckGo Instant Answer", needsKey: false },
    wiki:   { name: "Wikipedia", needsKey: false },
    gh:     { name: "GitHub Repositories", needsKey: false },
    hn:     { name: "Hacker News (Algolia)", needsKey: false },
  };

  async function searchGoogle(q) {
    const key = store.get("gs.key", ""), cx = store.get("gs.cx", "");
    if (!key || !cx) throw new Error("Нужны Google API key и Search Engine ID (cx) — раскройте «🔑 Ключи» выше");
    const d = await jfetch(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&num=10`);
    if (d.error) throw new Error(d.error.message || "ошибка Google API");
    return (d.items || []).map(it => ({ title: it.title, url: it.link, snippet: it.snippet, extra: it.displayLink }));
  }

  async function searchDDG(q) {
    const d = await jfetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`);
    const res = [];
    if (d.AbstractText) res.push({ title: d.Heading || q, url: d.AbstractURL || "#", snippet: d.AbstractText, extra: d.Source });
    (d.RelatedTopics || []).forEach(t => {
      const x = t.FirstURL || (t.Topics && t.Topics[0] && t.Topics[0].FirstURL);
      const txt = t.Text || (t.Topics && t.Topics[0] && t.Topics[0].Text);
      if (x && txt) res.push({ title: txt.split(" - ")[0], url: x, snippet: txt, extra: "related" });
    });
    if (d.Answer) res.unshift({ title: "⚡ Quick answer", url: "#", snippet: typeof d.Answer === "string" ? d.Answer : JSON.stringify(d.Answer), extra: "answer" });
    if (!res.length) res.push({ title: "Нет мгновенного ответа от DuckDuckGo", url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`, snippet: "Открыть полный поиск в новой вкладке →", extra: "" });
    return res.slice(0, 12);
  }

  async function searchWiki(q) {
    const lang = (navigator.language || "en").slice(0, 2);
    const d = await jfetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=8&format=json&origin=*`);
    return (d.query?.search || []).map(it => ({
      title: it.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(it.title.replace(/ /g, "_"))}`,
      snippet: it.snippet.replace(/<\/?span[^>]*>/g, "").replace(/<[^>]+>/g, ""), extra: "wiki · " + (it.timestamp || "").slice(0, 10),
    }));
  }

  async function searchGH(q) {
    const d = await jfetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=8`);
    return (d.items || []).map(r => ({
      title: r.full_name + " ⭐" + r.stargazers_count.toLocaleString("ru-RU"), url: r.html_url,
      snippet: r.description || "без описания", extra: r.language || "—",
    }));
  }

  async function searchHN(q) {
    const d = await jfetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&hitsPerPage=8`);
    return (d.hits || []).map(h => ({
      title: h.title || h.story_title || "(комментарий)", url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: h.comment_text ? h.comment_text.replace(/<[^>]+>/g, "").slice(0, 200) : "points: " + (h.points ?? 0),
      extra: "HN · " + (h._tags || [""]).join(","),
    }));
  }

  const RUNNERS = { google: searchGoogle, ddg: searchDDG, wiki: searchWiki, gh: searchGH, hn: searchHN };

  /* ─────────── рендер результатов ─────────── */
  function renderResults(list, engineName, ms) {
    const box = document.querySelector("#wsResults");
    if (!box) return;
    box.innerHTML = list.length
      ? `<ol class="ws-list">` + list.map(r => `
          <li class="ws-item">
            <a class="ws-title" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
            <div class="ws-snippet">${esc(r.snippet)}</div>
            <div class="ws-url mono">${esc(r.url)}${r.extra ? " · " + esc(r.extra) : ""}</div>
          </li>`).join("") + `</ol>`
      : `<p class="hint">Ничего не найдено.</p>`;
    meta(`${engineName} · ${list.length} результатов за ${ms} мс · ${new Date().toLocaleTimeString("ru-RU")}`);
  }

  async function runSearch() {
    const engSel = document.querySelector("#wsEngine"), qEl = document.querySelector("#wsQuery");
    if (!engSel || !qEl) return;
    const engine = engSel.value, q = qEl.value.trim();
    if (!q) { toast("Введите поисковый запрос", "warn"); return; }
    const btn = document.querySelector("#wsGo");
    btn.disabled = true; btn.textContent = "Поиск…";
    const t0 = performance.now();
    try {
      const list = await RUNNERS[engine](q);
      renderResults(list, ENGINES[engine].name, Math.round(performance.now() - t0));
      logEvent("info", `Поиск «${q}» через ${ENGINES[engine].name}: ${list.length} результатов`);
    } catch (e) {
      meta("");
      const box = document.querySelector("#wsResults");
      if (box) box.innerHTML = `<p class="hint" style="color:#ff5470">✖ ${esc(e.message)}</p>`;
      logEvent("warn", "Ошибка поиска: " + e.message);
    } finally { btn.disabled = false; btn.textContent = "Искать"; }
  }

  /* ─────────── быстрые ссылки ─────────── */
  const QUICK = [
    ["Google", "https://www.google.com/search?q="], ["YouTube", "https://www.youtube.com/results?search_query="],
    ["Wikipedia", "https://ru.wikipedia.org/w/index.php?search="], ["GitHub", "https://github.com/search?q="],
    ["Stack Overflow", "https://stackoverflow.com/search?q="], ["Hacker News", "https://hn.algolia.com/?q="],
    ["Reddit", "https://www.reddit.com/search/?q="], ["Amazon", "https://www.amazon.com/s?k="],
    ["Переводчик", "https://translate.google.com/?sl=auto&text="], ["Карты", "https://www.google.com/maps/search/"],
  ];
  function quickHref(base, q) {
    if (base.endsWith("=")) return base + encodeURIComponent(q);
    const sep = base.includes("?") ? "&" : "?";
    return base + sep + "q=" + encodeURIComponent(q);
  }
  function renderQuick() {
    const el = document.querySelector("#wsQuick"); if (!el) return;
    el.innerHTML = QUICK.map(([n, u]) => `<a class="chip ws-quick-a" target="_blank" rel="noopener" data-base="${u}" href="${u}">${n} ↗</a>`).join("");
    el.addEventListener("click", e => {
      const a = e.target.closest("a.ws-quick-a"); if (!a) return;
      const q = document.querySelector("#wsQuery")?.value.trim();
      a.href = q ? quickHref(a.dataset.base, q) : a.dataset.base;
    });
  }

  /* ─────────── интернет-функции ─────────── */
  const HOSTS_LATENCY = [
    ["Cloudflare edge", "https://speed.cloudflare.com/__down?bytes=1000"],
    ["GitHub CDN", "https://raw.githubusercontent.com/git/git/master/README.md"],
    ["Google", "https://www.gstatic.com/generate_204"],
    ["Yandex", "https://yandex.com/images/icon-home.svg"],
    ["HTTP Bingo", "https://httpbingo.org/delay/0"],
    ["OpenAI API", "https://api.openai.com/v1/models"],
  ];

  async function timedFetch(url) {
    const t0 = performance.now();
    try { await fetch(url, { mode: "no-cors", cache: "no-store" }); return Math.round(performance.now() - t0); }
    catch (e) { return null; }
  }

  const TOOLS = {
    async dns() {
      out("DNS/IP: запрашиваю …");
      try {
        const g = await jfetch("https://ipinfo.io/json");
        out(`IP: ${g.ip}\nHostname: ${g.hostname || "—"}\nГород: ${g.city}, ${g.region}, ${g.country}\nОрганизация: ${g.org}\nТаймзона: ${g.timezone}\nПочтовый индекс: ${g.postal || "—"}`);
      } catch (e) { out("✖ Ошибка: " + e.message); }
    },
    async geo() {
      out("Геолокация по IP …");
      try {
        const g = await jfetch("https://ipapi.co/json/");
        out(`IP: ${g.ip}\nПровайдер: ${g.org}\nСтрана: ${g.country_name} (${g.country_code})\nРегион: ${g.region}\nГород: ${g.city}\nШирота/долгота: ${g.latitude}, ${g.longitude}\nЧасовой пояс: ${g.timezone}\nASN: ${g.asn}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async isp() {
      out("Проверяю провайдера и ASN …");
      try {
        const g = await jfetch("https://ipwho.is/");
        const info = await jfetch("https://ipinfo.io/json");
        out(`Провайдер (ISP): ${(g.connection && g.connection.isp) || info.org}\nДомен провайдера: ${(g.connection && g.connection.domain) || "—"}\nASN: ${(g.connection && g.connection.asn) || "—"}\nVPN/прокси/Tor: ${JSON.stringify(g.security || {})}\nКонтинент: ${g.continent || "—"}\nСтрана: ${g.country || "—"}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async headers() {
      out("Запрашиваю httpbingo.org/headers …");
      try {
        const t0 = performance.now();
        const d = await jfetch("https://httpbingo.org/headers?_=" + Date.now());
        const rows = Object.entries(d.headers || {}).map(([k, v]) => k + ": " + (Array.isArray(v) ? v.join(", ") : v));
        out(`Ответ за ${Math.round(performance.now() - t0)} мс. Заголовки, которые сервер увидел ОТ вашего браузера:\n${rows.join("\n")}`);
      } catch (e) { out("✖ " + e.message); }
    },
    async latency() {
      out("Замеряю задержку до 6 серверов …");
      const rows = [];
      for (const [name, url] of HOSTS_LATENCY) {
        const ms = await timedFetch(url);
        rows.push((name + "                        ").slice(0, 22) + " " + (ms === null ? "недоступен ✖" : ms + " мс"));
      }
      out("Задержка до серверов (HTTP round-trip):\n" + rows.join("\n"));
    },
    async mtu() {
      out("Оценка максимального размера полезной нагрузки POST …");
      const sizes = [1400, 1460, 8000, 65000];
      const res = [];
      for (const n of sizes) {
        const t0 = performance.now();
        try {
          const r = await fetch("https://httpbingo.org/post", { method: "POST", body: new Uint8Array(n), cache: "no-store" });
          await r.arrayBuffer();
          res.push(`payload ${n} Б → OK, ${Math.round(performance.now() - t0)} мс`);
        } catch (e) { res.push(`payload ${n} Б → ✖ ${e.message}`); }
      }
      out(res.join("\n") + "\n\nПодсказка: типичный MTU канала 1500 Б (полезная нагрузка TCP ~1460 Б);\nбольшие фрагменты режет TCP, а не сеть.");
    },
    async connectivity() {
      const host = prompt("Хост для проверки доступности:", "github.com");
      if (!host) return;
      out(`Проверяю доступность https://${host} …`);
      const tries = [`https://${host}/`, `https://${host}/favicon.ico`, `https://${host}/robots.txt`];
      let okAny = false; const lines = [];
      for (const u of tries) {
        const t0 = performance.now();
        try { await fetch(u, { mode: "no-cors", cache: "no-store" }); lines.push(`${u} → ответ за ${Math.round(performance.now() - t0)} мс`); okAny = true; }
        catch (e) { lines.push(`${u} → ✖ ${e.message}`); }
      }
      out(lines.join("\n") + `\n\nВывод: хост ${okAny ? "ДОСТУПЕН из браузера" : "НЕДОСТУПЕН (заблокирован или не отвечает)"}`);
    },
    async httpstatus() {
      const url = prompt("URL для проверки кода ответа:", "https://example.com");
      if (!url) return;
      out(`GET ${url} …`);
      try {
        const t0 = performance.now();
        const r = await fetch(url, { cache: "no-store" });
        out(`HTTP ${r.status} ${r.statusText} · type=${r.type} · ${Math.round(performance.now() - t0)} мс\n${r.ok ? "✔ успешный ответ" : "⚠ неуспешный код"}`);
      } catch (e) { out("✖ Запрос невозможен (CORS/сеть): " + e.message + "\nСовет: многие сайты запрещают кросс-доменные GET — используйте «Тест доступности хоста»"); }
    },
    async throughput() {
      out("Скачиваю 5 МБ с Cloudflare Speed edge …");
      const t0 = performance.now();
      try {
        const r = await fetch("https://speed.cloudflare.com/__down?bytes=5000000&_=" + Date.now());
        let bytes = 0;
        if (r.body && r.body.getReader) {
          const reader = r.body.getReader();
          while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; }
        } else { bytes = (await r.arrayBuffer()).byteLength; }
        const sec = (performance.now() - t0) / 1000;
        const mbps = (bytes * 8) / sec / 1e6;
        out(`Принято ${(bytes / 1048576).toFixed(1)} МБ за ${sec.toFixed(2)} с\nПропускная способность: ${mbps.toFixed(0)} Мбит/с (${(bytes / 1048576 / sec).toFixed(1)} МБ/с)`);
        logEvent("info", `Throughput-тест: ${mbps.toFixed(0)} Мбит/с`);
      } catch (e) { out("✖ " + e.message); }
    },
    async jitter2() {
      out("20 замеров подряд (cloudflare)…");
      const vals = [];
      for (let i = 0; i < 20; i++) {
        const ms = await timedFetch("https://speed.cloudflare.com/__down?bytes=1000&r=" + i + "_" + Date.now());
        if (ms !== null) vals.push(ms);
        out(`20 замеров подряд: выполнено ${i + 1}/20 …`);
      }
      if (vals.length < 2) { out("✖ Мало успешных замеров: " + vals.length); return; }
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const jit = vals.slice(1).reduce((a, b, i) => a + Math.abs(b - vals[i]), 0) / (vals.length - 1);
      const sorted = vals.slice().sort((a, b) => a - b);
      out(`Замеров успешно: ${vals.length}/20\nmin ${sorted[0]} мс · med ${sorted[Math.floor(sorted.length / 2)]} мс · max ${sorted[sorted.length - 1]} мс\nсредний пинг: ${avg.toFixed(1)} мс\nджиттер (mean|Δ|): ${jit.toFixed(1)} мс\n${jit < 5 ? "✔ отличная стабильность" : jit < 20 ? "нормально для Wi-Fi" : "⚠ сеть дрожит — звонки будут рваться"}`);
    },
  };

  /* ─────────── init ─────────── */
  function init() {
    renderQuick();
    document.querySelector("#wsGo")?.addEventListener("click", runSearch);
    document.querySelector("#wsQuery")?.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });
    document.querySelector("#wsKeysSave")?.addEventListener("click", () => {
      const k = document.querySelector("#wsGKey").value.trim(), c = document.querySelector("#wsGCx").value.trim();
      if (!k || !c) { toast("Заполните оба поля: API key и cx", "warn"); return; }
      store.set("gs.key", k); store.set("gs.cx", c);
      toast("Ключи Google CSE сохранены локально", "ok");
      logEvent("info", "Сохранены ключи Google Custom Search API");
    });
    const savedK = store.get("gs.key", ""), savedC = store.get("gs.cx", "");
    if (savedK) document.querySelector("#wsGKey").placeholder = "ключ сохранён ✓";
    if (savedC) document.querySelector("#wsGCx").value = savedC;
    document.querySelector("#wsTools")?.addEventListener("click", e => {
      const b = e.target.closest(".wt"); if (!b) return;
      const fn = TOOLS[b.dataset.tool]; if (!fn) return;
      document.querySelectorAll(".wt").forEach(x => x.classList.remove("wt-active"));
      b.classList.add("wt-active");
      Promise.resolve(fn()).finally(() => b.classList.remove("wt-active"));
    });
  }

  return { init, runSearch };
})();

document.addEventListener("DOMContentLoaded", () => WEBSEARCH.init());
