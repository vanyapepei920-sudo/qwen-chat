import "./style.css";
import { projects } from "./data.js";

const app = document.getElementById("app");

app.innerHTML = `
  <div class="grain" aria-hidden="true"></div>

  <header class="site-header">
    <a class="logo" href="#top">REALLY<span>VISUALS</span></a>
    <nav class="nav">
      <a href="#work">Работы</a>
      <a href="#services">Услуги</a>
      <a href="#studio">Студия</a>
      <a href="#contact">Контакты</a>
    </nav>
    <a class="btn btn-small" href="#contact">Обсудить проект</a>
    <button class="burger" aria-label="Меню"><span></span><span></span></button>
  </header>

  <main id="top">
    <!-- HERO -->
    <section class="hero">
      <div class="hero-bg" id="heroBg"></div>
      <p class="hero-kicker reveal">Продакшн видеографики · с 2016 года</p>
      <h1 class="hero-title">
        <span class="line"><em>Двигаем</em> пиксели,</span>
        <span class="line">чтобы их <em>смотрели</em></span>
      </h1>
      <p class="hero-sub reveal">Анимация, VFX, титры и брендинг для кино, рекламы, музыки и цифровых продуктов.</p>
      <div class="hero-cta reveal">
        <a class="btn btn-primary" href="#work">Смотреть шоурил <span class="arrow">→</span></a>
        <a class="btn btn-ghost" href="#contact">Написать нам</a>
      </div>
      <div class="hero-marquee" aria-hidden="true">
        <div class="marquee-track">
          ${"<span>MOTION DESIGN ✦ VFX ✦ 3D ✦ TITLE SEQUENCES ✦ BRAND IDENTITY ✦ </span>".repeat(4)}
        </div>
      </div>
    </section>

    <!-- STATS -->
    <section class="stats">
      <div class="stat reveal"><b data-count="240">0</b><i>+</i><p>проектов в год</p></div>
      <div class="stat reveal"><b data-count="18">0</b><i></i><p>наград и номинаций</p></div>
      <div class="stat reveal"><b data-count="35">0</b><i>+</i><p>художников в команде</p></div>
      <div class="stat reveal"><b data-count="9">0</b><i> лет</i><p>на рынке продакшна</p></div>
    </section>

    <!-- WORK -->
    <section class="work" id="work">
      <div class="section-head">
        <h2 class="reveal">Избранные<br/><em>работы</em></h2>
        <p class="reveal">Кейсы, которыми мы гордимся. Наведи курсор — оживи кадр.</p>
      </div>
      <div class="grid" id="workGrid"></div>
      <div class="center"><a class="btn btn-ghost" href="#contact">Запросить полный шоурил</a></div>
    </section>

    <!-- SERVICES -->
    <section class="services" id="services">
      <div class="section-head">
        <h2 class="reveal">Что мы<br/><em>умеем</em></h2>
      </div>
      <div class="service-list" id="serviceList"></div>
    </section>

    <!-- STUDIO / CLIENTS -->
    <section class="studio" id="studio">
      <div class="section-head">
        <h2 class="reveal">Студия<br/><em>о нас</em></h2>
        <p class="reveal">Независимый продакшн видеографики. Собираем кадры из движения, света и звука — от идеи до мастеринга. Работаем с клиентами по всему миру, 24/7 в разных часовых поясах.</p>
      </div>
      <div class="clients reveal" id="clients"></div>
    </section>

    <!-- CTA -->
    <section class="cta" id="contact">
      <h2 class="reveal">Есть идея?<br/><em>Сделаем красиво.</em></h2>
      <a class="btn btn-primary big reveal" href="mailto:hello@reallyvisuals.example">hello@reallyvisuals.example</a>
      <div class="socials reveal">
        <a href="#">Behance</a><a href="#">Instagram</a><a href="#">Vimeo</a><a href="#">Telegram</a>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <p>© ${new Date().getFullYear()} Really Visuals — демо-сайт в стиле reallyvisuals.me</p>
    <a href="#top">Наверх ↑</a>
  </footer>
`;

/* ---------- project cards ---------- */
const grid = document.getElementById("workGrid");
projects.forEach((p) => {
  const card = document.createElement("article");
  card.className = "card reveal";
  card.style.setProperty("--hue", p.hue);
  card.innerHTML = `
    <div class="thumb">
      <div class="thumb-art"><span>${p.initials}</span></div>
      <div class="badge">${p.year}</div>
    </div>
    <div class="card-meta">
      <h3>${p.title}</h3>
      <p>${p.client} · ${p.tags.join(" / ")}</p>
    </div>`;
  card.addEventListener("mouseenter", () => card.classList.add("playing"));
  card.addEventListener("mouseleave", () => card.classList.remove("playing"));
  grid.appendChild(card);
});

/* ---------- services accordion ---------- */
const serviceList = document.getElementById("serviceList");
const services = [
  ["Моушн-дизайн", "Реклама, продукт-видео, explainer, 2D/3D-анимация любого уровня сложности."],
  ["VFX и композ", "Рото, трекинг, clean-up, симуляции, интеграция CG в живой съёмочный материал."],
  ["Титры и broadcast", "Титровые последовательности для кино и сериалов, lower thirds для broadcast и live-продакшна."],
  ["Бренд-видеографика", "Айдентика в движении: логотипы, стили, гайдлайны и motion-системы для брендов."],
];
services.forEach(([t, d], i) => {
  const row = document.createElement("div");
  row.className = "service reveal";
  row.innerHTML = `
    <button class="service-head"><span class="num">0${i + 1}</span><h3>${t}</h3><i>+</i></button>
    <div class="service-body"><p>${d}</p></div>`;
  row.querySelector("button").addEventListener("click", () => {
    row.classList.toggle("open");
  });
  serviceList.appendChild(row);
});

/* ---------- clients marquee ---------- */
const clientNames = ["NIKE", "NETFLIX", "SPOTIFY", "APPLE TV", "YANDEX", "KION", "A24", "SONY MUSIC", "HBO MAX", "VK"];
const clients = document.getElementById("clients");
clients.innerHTML = `<div class="marquee-track light">${
  clientNames.map((c) => `<span>${c}</span>`).join("") + clientNames.map((c) => `<span>${c}</span>`).join("")
}</div>`;

/* ---------- scroll reveal ---------- */
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("visible")),
  { threshold: 0.15 }
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

/* ---------- counters ---------- */
const cio = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target;
    const target = +el.dataset.count;
    const t0 = performance.now();
    const dur = 1400;
    (function tick(now) {
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
    cio.unobserve(el);
  });
}, { threshold: 0.6 });
document.querySelectorAll("[data-count]").forEach((el) => cio.observe(el));

/* ---------- hero animated bg (canvas) ---------- */
const canvas = document.createElement("canvas");
document.getElementById("heroBg").appendChild(canvas);
const ctx = canvas.getContext("2d");
let W, H;
function resize() {
  W = canvas.width = canvas.offsetWidth * devicePixelRatio;
  H = canvas.height = canvas.offsetHeight * devicePixelRatio;
}
resize();
addEventListener("resize", resize);
const blobs = Array.from({ length: 6 }, (_, i) => ({
  x: Math.random(), y: Math.random(),
  r: 0.18 + Math.random() * 0.22,
  dx: (Math.random() - 0.5) * 0.0006,
  dy: (Math.random() - 0.5) * 0.0006,
  hue: [265, 320, 200, 45, 180, 300][i],
}));
let mx = 0.5, my = 0.5;
addEventListener("pointermove", (e) => {
  mx = e.clientX / innerWidth;
  my = e.clientY / innerHeight;
});
(function draw() {
  ctx.clearRect(0, 0, W, H);
  for (const b of blobs) {
    b.x += b.dx; b.y += b.dy;
    if (b.x < -0.2 || b.x > 1.2) b.dx *= -1;
    if (b.y < -0.2 || b.y > 1.2) b.dy *= -1;
    const px = (b.x + (mx - 0.5) * 0.05) * W;
    const py = (b.y + (my - 0.5) * 0.05) * H;
    const g = ctx.createRadialGradient(px, py, 0, px, py, b.r * W);
    g.addColorStop(0, `hsla(${b.hue},90%,60%,0.22)`);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, b.r * W, 0, Math.PI * 2);
    ctx.fill();
  }
  requestAnimationFrame(draw);
})();

/* ---------- mobile burger ---------- */
document.querySelector(".burger").addEventListener("click", () => {
  document.body.classList.toggle("menu-open");
});
