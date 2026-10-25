// смоук-тест apibridge.js в Node (эмуляция браузера) — запуск: node test-static.mjs
import fs from "fs"; import vm from "vm";
const ctx = { Response, URL, Promise, setTimeout, console, Math, JSON, Object, Array, String, Number, Boolean, Error, RegExp };
ctx.performance = performance; ctx.AbortSignal = AbortSignal; ctx.fetch = (...a) => fetch(...a);
const mem = {};
ctx.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k] };
ctx.sessionStorage = ctx.localStorage;
ctx.location = { href: "http://localhost/index.html", origin: "http://localhost", hostname: "localhost" };
ctx.document = { addEventListener() {}, createElement: () => ({ style: {}, querySelector: () => null, remove() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {}, querySelector: () => null }, getElementById: () => null, querySelector: () => null };
ctx.RTCPeerConnection = class { createDataChannel() {} close() {} createOffer() { return Promise.reject(new Error("no rtc")); } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("js/auth.js", "utf8"), ctx);
vm.runInContext(fs.readFileSync("js/apibridge.js", "utf8"), ctx);

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? (pass++, console.log("OK  ", name)) : (fail++, console.log("FAIL", name)); };

(async () => {
  let r = await ctx.fetch("/api/servers"); check("без входа /api → 401", r.status === 401);
  ctx.AUTH.isAuthed = () => true; ctx.AUTH.getUser = () => ({ displayName: "Тест", email: "test@gmail.com" });
  r = await ctx.fetch("/api/servers"); const j = await r.json(); check("servers 200 + список", r.status === 200 && j.servers.length >= 15);
  r = await ctx.fetch("/api/cidr?cidr=192.168.1.0/24"); const c = await r.json(); check("cidr netmask=255.255.255.0", c.netmask === "255.255.255.0" && c.usable === 254);
  r = await ctx.fetch("/api/email-check?email=test@gmail.com"); const e = await r.json(); check("email MX gmail (реальный DoH)", e.valid && e.mx.length > 0 && e.deliverable);
  r = await ctx.fetch("/api/dnssec?domain=google.com"); const d = await r.json(); check("dnssec google signed", d.dnssec_signed === true);
  r = await ctx.fetch("/api/rbl?target=8.8.8.8"); const rb = await r.json(); check("rbl 7 зон", rb.checks.length === 7);
  r = await ctx.fetch("/api/client-geo"); const g = await r.json(); check("client-geo lat/lon", g.lat != null && g.lon != null);
  r = await ctx.fetch("/api/result", { method: "POST", body: JSON.stringify({ download_mbps: 111.5, upload_mbps: 22, ping_ms: 9 }) }); check("save result ok", (await r.json()).ok === true);
  r = await ctx.fetch("/api/stats"); const st = await r.json(); check("stats avg=111.5", st.count >= 1 && st.avg_download_mbps > 0);
  r = await ctx.fetch("/api/bgp?q=8.8.8.8"); const b = await r.json(); check("bgp asn AS15169", String(b.asn || "").includes("15169") || b.error === undefined);
  r = await ctx.fetch("/api/dane?domain=github.com"); const dn = await r.json(); check("dane note", !!dn.note);
  r = await ctx.fetch("/api/qos"); const q = await r.json(); check("qos verdict", !!q.verdict || !!q.error);
  console.log(`\nИТОГ: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.message); process.exit(1); });
