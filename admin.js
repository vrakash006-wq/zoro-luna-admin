/* ===== Zoro Luna admin dashboard ===== */
const STATUSES = ["New", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled", "Returned"];
const POLL_MS = 20000;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const inr = n => "₹" + Math.round(+n || 0).toLocaleString("en-IN");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = d => { const x = new Date(d); return isNaN(x) ? "" : x.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) };
const store = {
  get(k, d, s = localStorage) { try { return JSON.parse(s.getItem(k)) ?? d } catch { return d } },
  set(k, v, s = localStorage) { try { s.setItem(k, JSON.stringify(v)) } catch {} }
};

const S = { api: "", token: "", demo: false, orders: [], filter: "All", q: "", sel: null, known: null, seen: new Set(store.get("zl_adm_seen", [])), alerts: store.get("zl_adm_alerts", false), timer: null, busy: false };

/* ---------- data layer ---------- */
async function call(body) {
  let j;
  for (let i = 0; i < 3; i++) {                       // Google occasionally returns a cold-start error page: retry
    try {
      const r = await fetch(S.api, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...body, token: S.token }), redirect: "follow" });
      j = await r.json(); break;
    } catch (e) { if (i === 2) throw new Error("network"); await new Promise(res => setTimeout(res, 700 * (i + 1))); }
  }
  if (!j.ok) throw new Error(j.error || "request failed");
  return j;
}
function explain(e) {
  const m = e.message;
  if (m === "invalid") return "Incorrect email or password.";
  if (m === "locked") return "Too many attempts. Try again in 15 minutes.";
  if (m === "not configured") return "Backend isn't ready: add ADMIN_EMAIL and ADMIN_PASSWORD in the Apps Script project's Script properties, then redeploy.";
  if (m === "unauthorized") return "Your session expired — please sign in again.";
  if (m === "network" || m === "badreply")
    return "Couldn't reach the backend. Check the URL ends in /exec, the deployment access is “Anyone”, and you've deployed the latest version of the script.";
  return "Backend error: " + m;
}
const norm = o => ({
  id: String(o.id), date: o.date, status: STATUSES.includes(o.status) ? o.status : "New", name: o.name || "", phone: String(o.phone || ""), email: o.email || "",
  addr: o.addr || "", city: o.city || "", pin: String(o.pin || ""), state: o.state || "", pay: o.pay || "cod", coupon: o.coupon || "", total: +o.total || 0,
  items: Array.isArray(o.items) ? o.items : [], tracking: o.tracking || "", notes: o.notes || "",
  paystatus: o.paystatus || ((o.pay || "cod") === "cod" ? "COD" : "Pending"), payid: o.payid || ""
});
/* demo mode: orders placed in this browser by the storefront */
const demo = {
  list() {
    const edits = store.get("zl_adm_demo", {}), gone = store.get("zl_adm_gone", []);
    return store.get("zl_orders", []).filter(o => !gone.includes(o.id)).map(o => {
      const c = o.cust || {};
      return norm({ id: o.id, date: o.date, name: c.name, phone: c.phone, email: c.email, addr: c.addr, city: c.city, pin: c.pin, state: c.state, pay: o.pay, coupon: o.coupon, total: o.total, items: o.lines, ...(edits[o.id] || {}) });
    });
  },
  update(id, f) { const e = store.get("zl_adm_demo", {}); e[id] = { ...(e[id] || {}), ...f }; store.set("zl_adm_demo", e) },
  remove(id) { const g = store.get("zl_adm_gone", []); g.push(id); store.set("zl_adm_gone", g) },
  add() {
    const names = ["Aarav Mehta", "Diya Nair", "Kabir Singh", "Meera Iyer"], cities = ["Chennai", "Mumbai", "Bengaluru", "Delhi"], i = Math.floor(Math.random() * 4);
    const p = [["Eclipse Oversized Tee", 1399], ["Medusa Heavy Hoodie", 2499], ["Moon Sweatpant", 1899], ["Varsity Jacket", 3299]][Math.floor(Math.random() * 4)];
    const o = store.get("zl_orders", []);
    o.push({ id: "ZL" + Date.now().toString().slice(-7), date: new Date().toISOString(), pay: Math.random() > .5 ? "cod" : "online", coupon: "", total: p[1] + 50,
      cust: { name: names[i], phone: "98765" + (10000 + Math.floor(Math.random() * 89999)), email: "test@example.com", addr: "12 Test Street", city: cities[i], pin: "600001", state: "Tamil Nadu" },
      lines: [{ n: p[0], size: "M", qty: 1, p: p[1] }] });
    store.set("zl_orders", o);
  }
};
async function fetchOrders() {
  if (S.demo) return demo.list();
  return (await call({ action: "list" })).orders.map(norm);
}
async function saveFields(id, fields) {
  if (S.demo) demo.update(id, fields); else await call({ action: "update", id, fields });
  const o = S.orders.find(x => x.id === id); if (o) Object.assign(o, fields);
}

/* ---------- sign-in ---------- */
function showApp(on) { $("#login").hidden = on; $("#app").hidden = !on; document.title = on ? "Orders — Zoro Luna Admin" : "Sign in — Zoro Luna Admin" }
async function start(api, token, demoMode, remember, silent) {
  S.api = api; S.token = token; S.demo = demoMode;
  try { S.orders = await fetchOrders(); }
  catch (e) { if (!silent || e.message !== "unauthorized") $("#l-msg").textContent = explain(e); showApp(false); return false; }
  const pack = { api, token, demo: demoMode };
  if (remember) store.set("zl_adm_auth", pack); else store.set("zl_adm_auth", pack, sessionStorage);
    S.known = new Set(S.orders.map(o => o.id));
  $("#demoPill").hidden = !demoMode; $("#sim").hidden = !demoMode;
  showApp(true); render(); setBell(); clearInterval(S.timer); S.timer = setInterval(poll, POLL_MS); stamp();
  return true;
}
async function logout() {
  clearInterval(S.timer);
  if (!S.demo && S.token) { try { await call({ action: "logout" }) } catch {} }
  try { localStorage.removeItem("zl_adm_auth"); sessionStorage.removeItem("zl_adm_auth") } catch {}
  S.token = ""; S.orders = []; $("#l-pass").value = ""; closeDr(); showApp(false);
}
$("#lf").onsubmit = async e => {
  e.preventDefault(); const msg = $("#l-msg"); msg.textContent = "";
  const api = (typeof ORDERS_API !== "undefined" && ORDERS_API) || "", email = $("#l-email").value.trim(), password = $("#l-pass").value, remember = $("#l-rem").checked;
  if (!/^https:\/\/script\.google\.com\/.+/.test(api)) { msg.textContent = "The backend isn't connected yet. Set ORDERS_API in config.js (see SETUP.md), or use demo mode."; return }
  const btn = $("#l-go"); btn.disabled = true; btn.textContent = "Signing in…";
  try {
    S.api = api; S.token = "";
    const r = await call({ action: "login", email, password, remember });
    store.set("zl_adm_email", email);
    await start(api, r.token, false, remember);
  } catch (err) { msg.textContent = explain(err) }
  finally { btn.disabled = false; btn.textContent = "Sign in"; $("#l-pass").value = "" }
};
$("#logout").onclick = logout;
$("#l-show").onclick = () => { const p = $("#l-pass"); p.type = p.type === "password" ? "text" : "password"; $("#l-show").textContent = p.type === "password" ? "Show" : "Hide" };
$("#l-demo").onclick = () => start("", "", true, false);
$("#logout").onclick = logout;

/* ---------- render ---------- */
const visible = () => {
  const q = S.q.toLowerCase();
  return S.orders.filter(o => (S.filter === "All" || o.status === S.filter) &&
    (!q || [o.id, o.name, o.phone, o.city, o.email].some(v => String(v).toLowerCase().includes(q))))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
};
function render() {
  const all = S.orders, today = new Date().toDateString();
  const live = all.filter(o => !["Cancelled", "Returned"].includes(o.status) && (o.pay === "cod" || o.paystatus === "Paid"));
  const rev = live.reduce((s, o) => s + o.total, 0);
  const unseen = all.filter(o => o.status === "New" && !S.seen.has(o.id)).length;
  const st = [
    ["New orders", all.filter(o => o.status === "New").length, unseen > 0],
    ["Today", all.filter(o => new Date(o.date).toDateString() === today).length],
    ["To ship", all.filter(o => ["Confirmed", "Packed"].includes(o.status)).length],
    ["Revenue", inr(rev)],
    ["Avg order", inr(live.length ? rev / live.length : 0)]
  ];
  $("#stats").innerHTML = st.map(([l, v, hot]) => `<div class="st ${hot ? "hot" : ""}"><span>${l}</span><b>${v}</b></div>`).join("");
  $("#chips").innerHTML = ["All", ...STATUSES].map(c => {
    const n = c === "All" ? all.length : all.filter(o => o.status === c).length;
    return `<button class="chip ${S.filter === c ? "on" : ""}" data-c="${c}">${c}<em>${n}</em></button>`;
  }).join("");
  const rows = visible();
  $("#list").innerHTML = (rows.length ? `<div class="a-h"><span>Order</span><span>Date</span><span>Customer</span><span>Items</span><span>Total</span><span>Payment</span><span>Status</span></div>` +
    rows.map(o => {
      const n = o.items.reduce((s, l) => s + (+l.qty || 0), 0), isNew = o.status === "New" && !S.seen.has(o.id);
      return `<div class="a-r ${S.sel === o.id ? "sel" : ""}" data-id="${esc(o.id)}" role="row" tabindex="0">
        <span class="id">${isNew ? '<i class="newdot"></i>' : ""}${esc(o.id)}</span><span>${esc(fmt(o.date))}</span>
        <span>${esc(o.name)}<small>${esc(o.city)}${o.state ? ", " + esc(o.state) : ""}</small></span>
        <span>${n} item${n === 1 ? "" : "s"}<small>${esc(o.items.map(l => l.n).join(", ")).slice(0, 60)}</small></span>
        <span>${inr(o.total)}</span><span><span class="pay-b p-${o.paystatus}">${o.paystatus === "COD" ? "COD" : o.paystatus === "Paid" ? "Paid" : o.paystatus === "Refunded" ? "Refunded" : "Unpaid"}</span></span>
        <span><span class="badge2 s-${o.status}">${o.status}</span></span></div>`;
    }).join("") : `<div class="empty-l">${S.orders.length ? "No orders match." : "No orders yet — they'll appear here the moment they come in."}</div>`);
  const base = "Orders — Zoro Luna Admin"; document.title = unseen ? `(${unseen}) New orders — Zoro Luna` : base;
}
$("#chips").onclick = e => { const c = e.target.closest("[data-c]"); if (c) { S.filter = c.dataset.c; render() } };
$("#q").oninput = e => { S.q = e.target.value; render() };
$("#list").onclick = e => { const r = e.target.closest("[data-id]"); if (r) openDr(r.dataset.id) };
$("#list").onkeydown = e => { if (e.key === "Enter") { const r = e.target.closest("[data-id]"); if (r) openDr(r.dataset.id) } };
const stamp = () => { $("#upd").textContent = "Updated " + new Date().toLocaleTimeString("en-IN", { timeStyle: "short" }) };

/* ---------- drawer ---------- */
function waLink(o) {
  const ph = o.phone.replace(/\D/g, ""), num = ph.length === 10 ? "91" + ph : ph, first = (o.name || "").split(" ")[0] || "there";
  const t = {
    New: `Hi ${first}, thank you for your Zoro Luna order ${o.id} (${inr(o.total)}). We're confirming it now and will update you shortly.`,
    Confirmed: `Hi ${first}, your Zoro Luna order ${o.id} is confirmed and being prepared. It will ship in 2–3 working days.`,
    Packed: `Hi ${first}, your Zoro Luna order ${o.id} is packed and will be handed to the courier soon.`,
    Shipped: `Hi ${first}, your Zoro Luna order ${o.id} has shipped.${o.tracking ? " Tracking: " + o.tracking : ""} Expect it in 3–5 days.`,
    Delivered: `Hi ${first}, your Zoro Luna order ${o.id} was delivered. We hope you love it! Tag @zoroluna to be featured.`,
    Cancelled: `Hi ${first}, your Zoro Luna order ${o.id} has been cancelled. Message us if you'd like to reorder.`,
    Returned: `Hi ${first}, we've received the return for order ${o.id}. We'll process it shortly.`
  }[o.status];
  return `https://wa.me/${num}?text=${encodeURIComponent(t)}`;
}
function openDr(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  S.sel = id; S.seen.add(id); store.set("zl_adm_seen", [...S.seen]);
  const idx = STATUSES.indexOf(o.status), bad = ["Cancelled", "Returned"].includes(o.status);
  const sub = o.items.reduce((s, l) => s + l.p * l.qty, 0);
  $("#dr").innerHTML = `
  <div class="d-h"><div><h2>${esc(o.id)}</h2><small>${esc(fmt(o.date))} · ${o.pay === "cod" ? "Cash on delivery" : "Online (Razorpay)"}</small></div><button class="ib" id="dClose" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
  <div class="d-b">
    <div class="timeline" aria-hidden="true">${["New", "Confirmed", "Packed", "Shipped", "Delivered"].map((s, i) => `<i class="${bad ? "bad" : i <= idx ? "on" : ""}"></i>`).join("")}</div>
    <div class="d-sec"><h3>Status</h3><label class="fld"><select id="f-status">${STATUSES.map(s => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>
    <div class="d-sec"><h3>Payment</h3><div class="d-grid">
      <label class="fld">Payment status<select id="f-paystatus">${["COD", "Pending", "Paid", "Refunded"].map(s => `<option value="${s}" ${s === o.paystatus ? "selected" : ""}>${s === "Pending" ? "Unpaid" : s}</option>`).join("")}</select></label>
      <label class="fld">Payment ID<input id="f-payid" value="${esc(o.payid)}" placeholder="pay_…"></label></div>
      ${o.pay === "online" && o.paystatus !== "Paid" && !S.demo ? '<p class="note">Customer closed the payment window or it\'s still processing? <button class="btn ghost sm" id="rec" type="button">Check payment with Razorpay</button></p>' : ""}</div>
    <div class="d-sec d-items"><h3>Items</h3>
      ${o.items.map(l => `<div class="li"><div>${esc(l.n)}<small>Size ${esc(l.size)} · Qty ${esc(l.qty)} · ${inr(l.p)} each</small></div><div>${inr(l.p * l.qty)}</div></div>`).join("")}
      <div class="d-tot"><span>Total${o.coupon ? ` <small style="font-family:var(--sans);font-size:.7rem;color:var(--mute)">(code ${esc(o.coupon)})</small>` : ""}</span><span>${inr(o.total)}</span></div>
      ${Math.round(sub) !== Math.round(o.total) ? `<p class="note">Items ${inr(sub)} · difference is shipping, COD fee or discounts.</p>` : ""}
    </div>
    <div class="d-sec"><h3>Customer &amp; delivery (editable)</h3><div class="d-grid">
      <label class="fld">Name<input id="f-name" value="${esc(o.name)}"></label>
      <label class="fld">Phone<input id="f-phone" inputmode="numeric" value="${esc(o.phone)}"></label>
      <label class="fld full">Email<input id="f-email" value="${esc(o.email)}"></label>
      <label class="fld full">Address<textarea id="f-addr" rows="2">${esc(o.addr)}</textarea></label>
      <label class="fld">City<input id="f-city" value="${esc(o.city)}"></label>
      <label class="fld">Pincode<input id="f-pin" inputmode="numeric" value="${esc(o.pin)}"></label>
      <label class="fld full">State<input id="f-state" value="${esc(o.state)}"></label></div></div>
    <div class="d-sec"><h3>Shipping &amp; notes</h3><div class="d-grid">
      <label class="fld full">Tracking / AWB<input id="f-tracking" value="${esc(o.tracking)}" placeholder="Courier + tracking number"></label>
      <label class="fld full">Internal notes<textarea id="f-notes" rows="3" placeholder="Only you can see this">${esc(o.notes)}</textarea></label></div></div>
    <div class="d-sec"><h3>Quick actions</h3><div class="d-act">
      <a class="btn sm" id="wa" target="_blank" rel="noopener" href="${waLink(o)}">WhatsApp customer</a>
      <a class="btn ghost sm" href="tel:${esc(o.phone)}">Call</a>
      <button class="btn ghost sm" id="cp">Copy address</button>
      <button class="btn ghost sm" id="pr">Print invoice</button></div></div>
  </div>
  <div class="d-f"><button class="btn danger sm" id="del" style="flex:0 0 auto">Delete</button><button class="btn solid" id="save">Save changes</button></div>`;
  document.body.classList.add("dr-open"); render();
  $("#dClose").onclick = closeDr;
  $("#f-status").onchange = () => { const t = { ...o, status: $("#f-status").value, tracking: $("#f-tracking").value }; $("#wa").href = waLink(t) };
  $("#f-tracking").oninput = $("#f-status").onchange;
  $("#cp").onclick = () => { const t = `${$("#f-name").value}\n${$("#f-phone").value}\n${$("#f-addr").value}, ${$("#f-city").value}, ${$("#f-state").value} ${$("#f-pin").value}`; (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => toast("Address copied"), () => toast("Copy failed")) };
  $("#pr").onclick = () => printInvoice(o);
  const rec = $("#rec");
  if (rec) rec.onclick = async () => {
    rec.disabled = true; rec.textContent = "Checking…";
    try { const r = await call({ action: "reconcile", id }); if (r.paid) { Object.assign(o, { paystatus: "Paid", payid: r.payid, status: o.status === "New" ? "Confirmed" : o.status }); toast("Payment found — marked Paid"); render(); openDr(id) } else { toast("No payment received for this order yet"); rec.disabled = false; rec.textContent = "Check payment with Razorpay" } }
    catch (e) { toast("Couldn't check: " + e.message); rec.disabled = false; rec.textContent = "Check payment with Razorpay" }
  };
  $("#save").onclick = async () => {
    const f = { status: $("#f-status").value, paystatus: $("#f-paystatus").value, payid: $("#f-payid").value.trim(), name: $("#f-name").value.trim(), phone: $("#f-phone").value.trim(), email: $("#f-email").value.trim(), addr: $("#f-addr").value.trim(),
      city: $("#f-city").value.trim(), pin: $("#f-pin").value.trim(), state: $("#f-state").value.trim(), tracking: $("#f-tracking").value.trim(), notes: $("#f-notes").value.trim() };
    $("#save").disabled = true; $("#save").textContent = "Saving…";
    try { await saveFields(id, f); toast("Order updated"); render(); openDr(id) } catch (e) { toast("Couldn't save: " + e.message); $("#save").disabled = false; $("#save").textContent = "Save changes" }
  };
  $("#del").onclick = async () => {
    if (!confirm(`Delete order ${id}? This can't be undone.`)) return;
    try { if (S.demo) demo.remove(id); else await call({ action: "delete", id }); S.orders = S.orders.filter(x => x.id !== id); closeDr(); render(); toast("Order deleted") } catch (e) { toast("Couldn't delete: " + e.message) }
  };
}
function closeDr() { document.body.classList.remove("dr-open"); S.sel = null; render() }
$("#ov").onclick = closeDr;
document.addEventListener("keydown", e => { if (e.key === "Escape" && document.body.classList.contains("dr-open")) closeDr() });

function printInvoice(o) {
  const w = window.open("", "_blank"); if (!w) { toast("Allow pop-ups to print"); return }
  const sub = o.items.reduce((s, l) => s + l.p * l.qty, 0);
  w.document.write(`<!doctype html><title>Invoice ${esc(o.id)}</title><style>body{font:14px/1.5 Inter,Arial,sans-serif;max-width:720px;margin:30px auto;padding:0 20px;color:#222}h1{letter-spacing:.3em;font-weight:400;margin:0}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}td:last-child,th:last-child{text-align:right}.m{color:#666}</style>
  <h1>ZORO LUNA</h1><p class="m">Moonlit luxury streetwear</p><hr><p><b>Order ${esc(o.id)}</b><br>${esc(fmt(o.date))} · ${o.pay === "cod" ? "Cash on delivery" : o.paystatus === "Paid" ? "Paid online" : "Payment pending"}</p>
  <p><b>Ship to</b><br>${esc(o.name)}<br>${esc(o.addr)}<br>${esc(o.city)}, ${esc(o.state)} ${esc(o.pin)}<br>${esc(o.phone)}</p>
  <table><tr><th>Item</th><th>Size</th><th>Qty</th><th>Amount</th></tr>${o.items.map(l => `<tr><td>${esc(l.n)}</td><td>${esc(l.size)}</td><td>${esc(l.qty)}</td><td>${inr(l.p * l.qty)}</td></tr>`).join("")}
  <tr><td colspan="3">Items subtotal</td><td>${inr(sub)}</td></tr><tr><td colspan="3"><b>Total ${o.pay === "cod" ? "to collect" : "paid"}</b></td><td><b>${inr(o.total)}</b></td></tr></table>
  <p class="m">Thank you for shopping with Zoro Luna.</p><script>onload=()=>print()<\/script>`);
  w.document.close();
}

/* ---------- notifications + polling ---------- */
function chime() {
  try {
    const A = new (window.AudioContext || window.webkitAudioContext)(), t = A.currentTime;
    [[880, 0], [1320, .16]].forEach(([f, d]) => { const o = A.createOscillator(), g = A.createGain(); o.frequency.value = f; o.type = "sine"; o.connect(g); g.connect(A.destination);
      g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(.18, t + d + .02); g.gain.exponentialRampToValueAtTime(.001, t + d + .5); o.start(t + d); o.stop(t + d + .55) });
  } catch {}
}
function toast(msg, ms = 3200) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), ms) }
function setBell() { $("#bell").classList.toggle("on", !!S.alerts) }
$("#bell").onclick = async () => {
  if (!S.alerts) {
    if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission() } catch {} }
    S.alerts = true; chime(); toast("Alerts on — sound" + ("Notification" in window && Notification.permission === "granted" ? " + desktop notifications" : "") + " for new orders");
  } else { S.alerts = false; toast("Alerts off") }
  store.set("zl_adm_alerts", S.alerts); setBell();
};
async function poll(manual) {
  if (S.busy || (!S.token && !S.demo)) return; S.busy = true;
  const btn = $("#refresh"); if (manual) btn.classList.add("spin");
  try {
    const fresh = await fetchOrders(), add = fresh.filter(o => !S.known.has(o.id));
    S.orders = fresh; fresh.forEach(o => S.known.add(o.id));
    if (add.length) {
      add.forEach(o => { const msg = `New order ${o.id} — ${o.name} · ${inr(o.total)}`;
        toast("🛍 " + msg, 6000);
        if (S.alerts && "Notification" in window && Notification.permission === "granted") { try { new Notification("New Zoro Luna order", { body: `${o.name} · ${inr(o.total)} · ${o.items.length} item(s)`, icon: "img/logo.jpg", tag: o.id }) } catch {} }
      });
      if (S.alerts) chime();
    }
    render(); if (S.sel && !add.length) { /* keep drawer as is */ } stamp();
  } catch (e) { if (e.message === "unauthorized") { await logout(); $("#l-msg").textContent = explain(e) } else if (manual) toast("Couldn't refresh: " + e.message) }
  finally { S.busy = false; setTimeout(() => btn.classList.remove("spin"), 600) }
}
$("#refresh").onclick = () => poll(true);
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#app").hidden) poll() });
$("#sim").onclick = () => { demo.add(); poll(true) };

/* ---------- export + theme ---------- */
$("#csv").onclick = () => {
  const rows = visible(); if (!rows.length) { toast("Nothing to export"); return }
  const cols = ["id", "date", "status", "name", "phone", "email", "addr", "city", "pin", "state", "pay", "paystatus", "payid", "coupon", "total", "items", "tracking", "notes"];
  const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const csv = [cols.join(","), ...rows.map(o => cols.map(c => q(c === "items" ? o.items.map(l => `${l.n} (${l.size}) x${l.qty}`).join("; ") : o[c])).join(","))].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = `zoro-luna-orders-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
};
$("#theme").onclick = () => { const d = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = d; try { localStorage.setItem("zl_theme", d) } catch {} };

/* ---------- boot ---------- */
(function boot() {
  $("#l-email").value = store.get("zl_adm_email", "");
  const a = store.get("zl_adm_auth", null) || store.get("zl_adm_auth", null, sessionStorage);
  if (a && (a.demo || (a.api && a.token))) { start(a.api, a.token, !!a.demo, !!store.get("zl_adm_auth", null), true) } else showApp(false);
})();
