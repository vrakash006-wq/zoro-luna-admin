/* ===== Admin extras: overview, abandoned checkouts, visitors, customers ===== */
const RANK = ["visit", "product", "cart", "checkout", "contact", "ordered"];
const STAGE_LABEL = { visit: "Browsing", product: "Viewed product", cart: "Added to bag", checkout: "At checkout", contact: "Entered details", ordered: "Ordered" };
const LIVE_MS = 5 * 60000, ABANDON_MS = 30 * 60000;

const csvDownload = (name, cols, rows) => {
  if (!rows.length) { toast("Nothing to export"); return }
  const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const csv = [cols.map(c => c[0]).join(","), ...rows.map(r => cols.map(c => q(c[1](r))).join(","))].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = `zoro-luna-${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
};
const ago = t => {
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago"; return Math.floor(s / 86400) + " d ago";
};
const pname = id => (S.prices && S.prices.products[id] && S.prices.products[id].n) || "Product #" + id;
const cartText = c => (c || []).map(i => `${pname(i.id)} (${i.size}) ×${i.qty}`).join(", ");
const day = d => new Date(d).toDateString();
const sessAge = s => Date.now() - new Date(s.last).getTime();
const isLive = s => sessAge(s) < LIVE_MS;
const rank = s => RANK.indexOf(s.stage);
const phone10 = p => String(p || "").replace(/\D/g, "").slice(-10);
const who = s => s.name || (s.email ? s.email : "") || "Visitor " + String(s.vid || s.sid).slice(0, 5);
const waTo = (ph, text) => { const d = String(ph).replace(/\D/g, ""); return `https://wa.me/${d.length === 10 ? "91" + d : d}?text=${encodeURIComponent(text)}` };
const recoverLink = s => `${(typeof STORE_URL !== "undefined" && STORE_URL) || ""}/cart.html?r=${(s.cart || []).map(i => `${i.id}.${i.size}.${i.qty}`).join(",")}`;

/* orders that count as real sales */
const sales = () => S.orders.filter(o => !["Cancelled", "Returned"].includes(o.status) && (o.pay === "cod" || o.paystatus === "Paid"));

/* an abandoned checkout = reached bag/checkout, did not order, quiet for 30+ minutes */
function abandoned() {
  const bought = new Set(); S.orders.forEach(o => { if (o.phone) bought.add(phone10(o.phone)); if (o.email) bought.add(String(o.email).toLowerCase()) });
  return S.sessions.filter(s => rank(s) >= 2 && rank(s) < 5 && !s.order && s.cartValue > 0 && sessAge(s) > ABANDON_MS && sessAge(s) < 30 * 864e5)
    .map(s => ({ ...s, _won: (s.phone && bought.has(phone10(s.phone))) || (s.email && bought.has(String(s.email).toLowerCase())) }));
}

/* ---------- tabs ---------- */
function setView(v) {
  S.view = v; try { sessionStorage.setItem("zl_adm_view", v) } catch {}
  $$("#vtabs button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  $$(".view").forEach(x => x.hidden = x.id !== "v-" + v);
  renderExtra();
}
$("#vtabs").onclick = e => { const b = e.target.closest("[data-v]"); if (b) setView(b.dataset.v) };

async function loadPrices() {
  if (S.prices || typeof STORE_URL === "undefined" || !STORE_URL) return;
  try { const r = await fetch(STORE_URL + "/prices.json"); S.prices = await r.json(); renderExtra() } catch {}
}

/* ---------- renderers ---------- */
function renderExtra() {
  if (!S.orders) return;
  loadPrices();
  const ab = abandoned().filter(a => !a._won && a.followup !== "Recovered" && a.followup !== "Ignored");
  const live = S.sessions.filter(isLive).length;
  $("#n-orders").textContent = S.orders.filter(o => o.status === "New").length || "";
  $("#n-ab").textContent = ab.length || ""; $("#n-live").textContent = live ? "● " + live : "";
  ({ overview: viewOverview, abandoned: viewAbandoned, sessions: viewSessions, customers: viewCustomers }[S.view] || (() => {}))();
}

const card = (l, v, sub, hot) => `<div class="st ${hot ? "hot" : ""}"><span>${l}</span><b>${v}</b>${sub ? `<small class="sub">${sub}</small>` : ""}</div>`;
const pct = (a, b) => b ? Math.round(a / b * 100) + "%" : "—";

function viewOverview() {
  const el = $("#v-overview"), now = Date.now(), wk = now - 7 * 864e5, today = new Date().toDateString();
  const S7 = S.sessions.filter(s => new Date(s.first).getTime() >= wk), Sd = S.sessions.filter(s => day(s.first) === today);
  const sale = sales(), od = sale.filter(o => day(o.date) === today), o7 = sale.filter(o => new Date(o.date).getTime() >= wk);
  const rev = a => a.reduce((s, o) => s + o.total, 0);
  const ab = abandoned(), abOpen = ab.filter(a => !a._won && a.followup !== "Recovered" && a.followup !== "Ignored");
  const visitorsToday = new Set(Sd.map(s => s.vid)).size;
  const funnel = [["Visits", S7.length], ["Viewed a product", S7.filter(s => rank(s) >= 1).length], ["Added to bag", S7.filter(s => rank(s) >= 2).length], ["Started checkout", S7.filter(s => rank(s) >= 3).length], ["Placed an order", S7.filter(s => rank(s) >= 5).length]];
  const fmax = Math.max(1, funnel[0][1]);
  // revenue by day (7)
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(now - (6 - i) * 864e5); return { k: d.toDateString(), l: d.toLocaleDateString("en-IN", { weekday: "short" }), v: 0, n: 0 } });
  sale.forEach(o => { const d = days.find(x => x.k === day(o.date)); if (d) { d.v += o.total; d.n++ } });
  const dmax = Math.max(1, ...days.map(d => d.v));
  const group = (arr, f) => { const m = {}; arr.forEach(x => { const k = f(x) || "unknown"; m[k] = (m[k] || 0) + 1 }); return Object.entries(m).sort((a, b) => b[1] - a[1]) };
  const srcs = group(S7, s => s.source).slice(0, 6), devs = group(S7, s => s.device);
  const ordersBySrc = {}; S7.filter(s => rank(s) >= 5).forEach(s => { ordersBySrc[s.source] = (ordersBySrc[s.source] || 0) + 1 });
  const items = {}; sale.forEach(o => o.items.forEach(l => { const k = l.n; items[k] = items[k] || { u: 0, r: 0 }; items[k].u += +l.qty; items[k].r += l.p * l.qty }));
  const top = Object.entries(items).sort((a, b) => b[1].r - a[1].r).slice(0, 6);
  const viewed = {}; S7.forEach(s => (s.viewed || []).forEach(id => viewed[id] = (viewed[id] || 0) + 1));
  const topViewed = Object.entries(viewed).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const cod = sale.filter(o => o.pay === "cod").length, online = sale.length - cod;
  const pipe = ["New", "Confirmed", "Packed", "Shipped", "Delivered"].map(s => [s, S.orders.filter(o => o.status === s).length]);
  const bar = (rows, max, fmt) => rows.length ? rows.map(([l, v, x]) => `<div class="bar-r"><span class="bl">${esc(l)}</span><span class="bt"><i style="width:${Math.max(3, v / max * 100)}%"></i></span><span class="bv">${fmt ? fmt(v, x) : v}</span></div>`).join("") : '<p class="note">No data yet.</p>';
  el.innerHTML = `
  <div class="a-stats five">
    ${card("Visitors today", visitorsToday, Sd.length + " session" + (Sd.length === 1 ? "" : "s"))}
    ${card("Live now", S.sessions.filter(isLive).length, "active in last 5 min", S.sessions.some(isLive))}
    ${card("Orders today", od.length, inr(rev(od)))}
    ${card("Conversion (7d)", pct(o7.length, S7.length), o7.length + " orders / " + S7.length + " visits")}
    ${card("Revenue (7d)", inr(rev(o7)), "AOV " + inr(o7.length ? rev(o7) / o7.length : 0))}
  </div>
  <div class="a-stats five">
    ${card("Abandoned checkouts", abOpen.length, "open to follow up", abOpen.length > 0)}
    ${card("Recoverable value", inr(abOpen.reduce((s, a) => s + a.cartValue, 0)), "in unfinished bags")}
    ${card("With contact details", abOpen.filter(a => a.phone || a.email).length, "can be contacted")}
    ${card("Unpaid online orders", S.orders.filter(o => o.pay === "online" && o.paystatus !== "Paid" && !["Cancelled", "Returned"].includes(o.status)).length, "payment pending")}
    ${card("Customers", new Set(S.orders.map(o => phone10(o.phone) || o.email)).size, "repeat: " + Object.values(S.orders.reduce((m, o) => { const k = phone10(o.phone) || o.email; m[k] = (m[k] || 0) + 1; return m }, {})).filter(n => n > 1).length)}
  </div>
  <div class="a-grid">
    <div class="panel"><h3>Revenue — last 7 days</h3><div class="cols7">${days.map(d => `<div class="c7"><i style="height:${Math.max(2, d.v / dmax * 100)}%" title="${inr(d.v)}"></i><b>${d.v ? inr(d.v).replace("₹", "") : ""}</b><span>${d.l}</span></div>`).join("")}</div></div>
    <div class="panel"><h3>Conversion funnel — 7 days</h3>${bar(funnel.map(([l, v]) => [l, v]), fmax, (v) => `${v} <small>${pct(v, funnel[0][1])}</small>`)}</div>
    <div class="panel"><h3>Order pipeline</h3>${bar(pipe, Math.max(1, ...pipe.map(p => p[1])))}<p class="note" style="margin-top:.8rem">Payment mix: ${cod} COD · ${online} paid online</p></div>
    <div class="panel"><h3>Where visitors come from (7d)</h3>${bar(srcs, srcs[0] ? srcs[0][1] : 1, (v, x) => `${v} <small>${ordersBySrc[x] ? ordersBySrc[x] + " ordered" : ""}</small>`)}<p class="note" style="margin-top:.8rem">Devices: ${devs.map(([k, v]) => `${k} ${pct(v, S7.length)}`).join(" · ") || "—"}</p></div>
    <div class="panel"><h3>Best sellers</h3>${bar(top.map(([n, v]) => [n, v.r, v]), top[0] ? top[0][1].r : 1, (v, x) => `${inr(v)} <small>${x.u} sold</small>`)}</div>
    <div class="panel"><h3>Most viewed (7d)</h3>${bar(topViewed.map(([id, n]) => [pname(id), n]), topViewed[0] ? topViewed[0][1] : 1)}</div>
  </div>
  ${!S.sessions.length ? '<p class="note" style="text-align:center;margin-top:1.4rem">No visitor data yet. Once the updated store is live, visits and abandoned checkouts appear here automatically.</p>' : ""}`;
}

function viewAbandoned() {
  const el = $("#v-abandoned"), f = S.abFilter || "open";
  const all = abandoned().sort((a, b) => new Date(b.last) - new Date(a.last));
  const set = {
    open: all.filter(a => !a._won && !["Recovered", "Ignored"].includes(a.followup)),
    contact: all.filter(a => !a._won && (a.phone || a.email) && !["Recovered", "Ignored"].includes(a.followup)),
    contacted: all.filter(a => a.followup === "Contacted"),
    recovered: all.filter(a => a._won || a.followup === "Recovered"),
    ignored: all.filter(a => a.followup === "Ignored")
  };
  const rows = set[f] || set.open, val = a => a.reduce((s, x) => s + x.cartValue, 0);
  const chips = [["open", "Needs follow-up"], ["contact", "With contact"], ["contacted", "Contacted"], ["recovered", "Recovered"], ["ignored", "Ignored"]];
  el.innerHTML = `
  <div class="a-stats">
    ${card("Open carts", set.open.length, "", set.open.length > 0)}${card("Recoverable", inr(val(set.open)))}${card("Can be contacted", set.contact.length)}${card("Recovered", set.recovered.length, inr(val(set.recovered)))}
  </div>
  <div class="a-bar"><div class="a-chips" style="margin:0">${chips.map(([k, l]) => `<button class="chip ${f === k ? "on" : ""}" data-f="${k}">${l}<em>${set[k].length}</em></button>`).join("")}</div>
    <div class="a-bar-r"><button class="btn ghost sm" id="ab-csv">Export CSV</button></div></div>
  <p class="note" style="margin-bottom:1rem">A checkout counts as abandoned after 30 minutes without an order. Contact details appear only if the visitor typed them at checkout.</p>
  <div class="ab-list">${rows.length ? rows.map(a => {
    const first = (a.name || "").split(" ")[0] || "there", link = recoverLink(a), names = (a.cart || []).map(i => pname(i.id)).slice(0, 2).join(" & ");
    const msg = `Hi ${first}, you left ${names || "a few pieces"} in your Zoro Luna bag. We've saved it for you — complete your order here: ${link} (use code ZLUNA10 for 10% off).`;
    return `<article class="ab" data-sid="${esc(a.sid)}">
      <div class="ab-h"><div><b>${esc(who(a))}</b>${a._won ? ' <span class="badge2 s-Delivered">Ordered later</span>' : ""}<small>${esc(a.phone || "")}${a.phone && a.email ? " · " : ""}${esc(a.email || "")}${!a.phone && !a.email ? "No contact details" : ""}</small></div>
        <div class="ab-v">${inr(a.cartValue)}<small>${ago(a.last)}</small></div></div>
      <p class="ab-i">${esc(cartText(a.cart) || "Bag details unavailable")}</p>
      <p class="ab-m"><span class="badge2 st-${a.stage}">${STAGE_LABEL[a.stage]}</span> ${esc(a.device)} · ${esc(a.browser)} · from ${esc(a.source)}</p>
      <div class="ab-a">
        ${a.phone ? `<a class="btn sm" target="_blank" rel="noopener" href="${waTo(a.phone, msg)}" data-act="wa">WhatsApp</a>` : ""}
        ${a.email ? `<a class="btn ghost sm" href="mailto:${esc(a.email)}?subject=${encodeURIComponent("You left something in your Zoro Luna bag")}&body=${encodeURIComponent(msg)}" data-act="mail">Email</a>` : ""}
        <button class="btn ghost sm" data-act="copy" data-l="${esc(link)}">Copy recovery link</button>
        <select class="sel sm-sel" data-act="fu" aria-label="Follow-up status">${["", "Contacted", "Recovered", "Ignored"].map(x => `<option value="${x}" ${x === (a.followup || "") ? "selected" : ""}>${x || "Not contacted"}</option>`).join("")}</select>
        <input class="note-in" data-act="note" placeholder="Note…" value="${esc(a.note || "")}" maxlength="300"></div></article>`;
  }).join("") : `<div class="empty-l">${S.sessions.length ? "Nothing here — nice." : "No visitor data yet. It will appear once customers start using the updated store."}</div>`}</div>`;
  $$("#v-abandoned .chip").forEach(b => b.onclick = () => { S.abFilter = b.dataset.f; viewAbandoned() });
  $("#ab-csv").onclick = () => csvDownload("abandoned-checkouts", [["last_active", a => a.last], ["name", a => a.name], ["phone", a => a.phone], ["email", a => a.email], ["cart", a => cartText(a.cart)], ["value", a => a.cartValue], ["stage", a => STAGE_LABEL[a.stage]], ["source", a => a.source], ["device", a => a.device], ["follow_up", a => a.followup], ["note", a => a.note]], rows);
  $("#v-abandoned .ab-list").onchange = e => { if (e.target.dataset.act === "fu") upd(e.target.closest("[data-sid]").dataset.sid, { followup: e.target.value }) };
  $("#v-abandoned .ab-list").onfocusout = e => { if (e.target.dataset.act === "note") upd(e.target.closest("[data-sid]").dataset.sid, { note: e.target.value }, true) };
  $("#v-abandoned .ab-list").onclick = e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    if (b.dataset.act === "copy") (navigator.clipboard?.writeText(b.dataset.l) || Promise.reject()).then(() => toast("Recovery link copied"), () => toast("Copy failed"));
    if (b.dataset.act === "wa" || b.dataset.act === "mail") { const sid = b.closest("[data-sid]").dataset.sid, s = S.sessions.find(x => x.sid === sid); if (s && !s.followup) upd(sid, { followup: "Contacted" }, true) }
  };
}
async function upd(sid, fields, silent) {
  const s = S.sessions.find(x => x.sid === sid); if (s) Object.assign(s, fields);
  try { if (S.demo) demo.updateSession(sid, fields); else await call({ action: "sessionUpdate", sid, fields }); if (!silent) toast("Saved") } catch (e) { toast("Couldn't save: " + e.message) }
  if (!silent) renderExtra();
}

function viewSessions() {
  const el = $("#v-sessions"), f = S.sFilter || "today", q = (S.sQ || "").toLowerCase(), today = new Date().toDateString();
  let rows = S.sessions.slice().sort((a, b) => new Date(b.last) - new Date(a.last));
  if (f === "live") rows = rows.filter(isLive); if (f === "today") rows = rows.filter(s => day(s.last) === today);
  if (f === "cart") rows = rows.filter(s => rank(s) >= 2);
  if (q) rows = rows.filter(s => [s.name, s.email, s.phone, s.source, s.landing, s.browser, s.device, s.sid].some(v => String(v || "").toLowerCase().includes(q)));
  const chips = [["live", "Live now", S.sessions.filter(isLive).length], ["today", "Today", S.sessions.filter(s => day(s.last) === today).length], ["cart", "Added to bag", S.sessions.filter(s => rank(s) >= 2).length], ["all", "All", S.sessions.length]];
  el.innerHTML = `
  <div class="a-bar"><input class="a-search" id="s-q" type="search" placeholder="Search visitor, source, device, phone…" value="${esc(S.sQ || "")}" aria-label="Search visitors">
    <div class="a-bar-r"><button class="btn ghost sm" id="s-csv">Export CSV</button></div></div>
  <div class="a-chips">${chips.map(([k, l, n]) => `<button class="chip ${f === k ? "on" : ""}" data-f="${k}">${l}<em>${n}</em></button>`).join("")}</div>
  <div class="a-list sess">${rows.length ? `<div class="s-h"><span>Last active</span><span>Visitor</span><span>Device</span><span>Source</span><span>Landing</span><span>Pages</span><span>Bag</span><span>Stage</span></div>` + rows.slice(0, 200).map(s => `
    <div class="s-r" data-sid="${esc(s.sid)}"><span>${isLive(s) ? '<i class="newdot"></i>Live' : ago(s.last)}</span><span>${esc(who(s))}</span>
      <span>${esc(s.device)}<small>${esc(s.browser)} · ${esc(s.os)}</small></span><span>${esc(s.source)}<small>${esc(s.medium || "")}${s.campaign ? " · " + esc(s.campaign) : ""}</small></span>
      <span>${esc(s.landing || "/")}</span><span>${s.pages}</span><span>${s.cartValue ? inr(s.cartValue) : "—"}</span><span><span class="badge2 st-${s.stage}">${STAGE_LABEL[s.stage]}</span></span>
      <div class="s-d" hidden><p><b>Viewed:</b> ${esc((s.viewed || []).map(pname).join(", ") || "—")}</p><p><b>Bag:</b> ${esc(cartText(s.cart) || "—")}</p>
        <p><b>First seen:</b> ${esc(fmt(s.first))} · <b>Last:</b> ${esc(fmt(s.last))} · <b>Time zone:</b> ${esc(s.tz || "—")}</p>${s.order ? `<p><b>Order:</b> ${esc(s.order)}</p>` : ""}
        ${s.phone ? `<p><b>Contact:</b> ${esc(s.name)} · ${esc(s.phone)} ${s.email ? "· " + esc(s.email) : ""}</p>` : ""}</div></div>`).join("") : `<div class="empty-l">${S.sessions.length ? "No visitors match." : "No visitor data yet. It will appear once customers start using the updated store."}</div>`}</div>`;
  $$("#v-sessions .chip").forEach(b => b.onclick = () => { S.sFilter = b.dataset.f; viewSessions() });
  $("#s-q").oninput = e => { S.sQ = e.target.value; const p = e.target.selectionStart; viewSessions(); const n = $("#s-q"); n.focus(); n.setSelectionRange(p, p) };
  $("#s-csv").onclick = () => csvDownload("visitors", [["first_seen", s => s.first], ["last_active", s => s.last], ["visitor", s => who(s)], ["device", s => s.device], ["browser", s => s.browser], ["os", s => s.os], ["source", s => s.source], ["medium", s => s.medium], ["campaign", s => s.campaign], ["landing", s => s.landing], ["pages", s => s.pages], ["bag_value", s => s.cartValue], ["stage", s => STAGE_LABEL[s.stage]], ["order", s => s.order]], rows);
  $("#v-sessions .sess").onclick = e => { const r = e.target.closest(".s-r"); if (r) { const d = r.querySelector(".s-d"); d.hidden = !d.hidden; r.classList.toggle("open", !d.hidden) } };
}

function viewCustomers() {
  const el = $("#v-customers"), m = {};
  S.orders.forEach(o => {
    const k = phone10(o.phone) || String(o.email || "").toLowerCase() || o.id; const c = m[k] = m[k] || { name: o.name, phone: o.phone, email: o.email, city: o.city, state: o.state, n: 0, spent: 0, first: o.date, last: o.date, lastId: o.id };
    c.n++; if (!["Cancelled", "Returned"].includes(o.status) && (o.pay === "cod" || o.paystatus === "Paid")) c.spent += o.total;
    if (new Date(o.date) >= new Date(c.last)) { c.last = o.date; c.lastId = o.id; c.name = o.name; c.city = o.city }
    if (new Date(o.date) < new Date(c.first)) c.first = o.date;
  });
  const q = (S.cQ || "").toLowerCase(), list = Object.values(m).filter(c => !q || [c.name, c.phone, c.email, c.city].some(v => String(v || "").toLowerCase().includes(q))).sort((a, b) => b.spent - a.spent);
  const rep = Object.values(m).filter(c => c.n > 1).length, tot = Object.values(m).reduce((s, c) => s + c.spent, 0);
  el.innerHTML = `
  <div class="a-stats">${card("Customers", Object.keys(m).length)}${card("Repeat customers", rep, pct(rep, Object.keys(m).length) + " of customers")}${card("Lifetime revenue", inr(tot))}${card("Avg per customer", inr(Object.keys(m).length ? tot / Object.keys(m).length : 0))}</div>
  <div class="a-bar"><input class="a-search" id="c-q" type="search" placeholder="Search customer, phone, email, city…" value="${esc(S.cQ || "")}" aria-label="Search customers"><div class="a-bar-r"><button class="btn ghost sm" id="c-csv">Export CSV</button></div></div>
  <div class="a-list cust">${list.length ? `<div class="c-h"><span>Customer</span><span>Contact</span><span>City</span><span>Orders</span><span>Spent</span><span>Last order</span></div>` + list.map(c => `
    <div class="c-r" data-id="${esc(c.lastId)}"><span>${esc(c.name)}${c.n > 1 ? ' <span class="badge2 s-Delivered">Repeat</span>' : ""}</span><span>${esc(c.phone)}<small>${esc(c.email || "")}</small></span>
      <span>${esc(c.city)}<small>${esc(c.state || "")}</small></span><span>${c.n}</span><span>${inr(c.spent)}</span><span>${esc(fmt(c.last))}</span></div>`).join("") : '<div class="empty-l">No customers yet.</div>'}</div>`;
  $("#c-q").oninput = e => { S.cQ = e.target.value; const p = e.target.selectionStart; viewCustomers(); const n = $("#c-q"); n.focus(); n.setSelectionRange(p, p) };
  $("#c-csv").onclick = () => csvDownload("customers", [["name", c => c.name], ["phone", c => c.phone], ["email", c => c.email], ["city", c => c.city], ["state", c => c.state], ["orders", c => c.n], ["spent", c => c.spent], ["first_order", c => c.first], ["last_order", c => c.last]], list);
  $("#v-customers .cust").onclick = e => { const r = e.target.closest(".c-r"); if (r) openDr(r.dataset.id) };
}

/* restore last tab */
try { const v = sessionStorage.getItem("zl_adm_view"); if (v && ["overview", "orders", "abandoned", "sessions", "customers"].includes(v)) { S.view = v; $$("#vtabs button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); $$(".view").forEach(x => x.hidden = x.id !== "v-" + v) } } catch {}
setTimeout(() => { if (!$("#app").hidden) renderExtra() }, 0);
