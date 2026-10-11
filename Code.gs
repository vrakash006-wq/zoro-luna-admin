/**
 * Zoro Luna — order + payment backend (Google Apps Script bound to a Google Sheet).
 * Setup steps are in SETUP.md. Secrets live in Script Properties, never in this file:
 *   ADMIN_EMAIL          – the email you sign in to the dashboard with
 *   ADMIN_PASSWORD       – your dashboard password (use a long one)
 *   NOTIFY_EMAIL         – where new-order emails go (defaults to your Google account)
 *   RAZORPAY_KEY_ID      – Razorpay key id   (rzp_test_… while testing, rzp_live_… when live)
 *   RAZORPAY_KEY_SECRET  – Razorpay key secret
 *   PRICES_URL           – (optional) defaults to https://zoroluna.shop/prices.json
 */
const SHEET = 'Orders';
const HEAD = ['id', 'date', 'status', 'name', 'phone', 'email', 'addr', 'city', 'pin', 'state', 'pay', 'coupon', 'total', 'items', 'tracking', 'notes', 'updated', 'paystatus', 'payid', 'rzp'];
const EDITABLE = ['status', 'name', 'phone', 'email', 'addr', 'city', 'pin', 'state', 'pay', 'coupon', 'total', 'tracking', 'notes', 'paystatus', 'payid'];
const PAYSTATUS = ['COD', 'Pending', 'Paid', 'Refunded'];
const SESSION_DAYS = 30;
const STATUSES = ['New', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled', 'Returned'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(SHEET);
  if (!s) { s = ss.insertSheet(SHEET); s.appendRow(HEAD); s.setFrozenRows(1); }
  if (s.getLastColumn() < HEAD.length) s.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);   // upgrade older sheets
  return s;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function clip_(v, n) { return String(v == null ? '' : v).slice(0, n); }
function eq_(a, b) {                                   // constant-time compare
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------- admin sessions ---------- */
function sessions_() { try { return JSON.parse(prop_('SESSIONS') || '{}'); } catch (e) { return {}; } }
function saveSessions_(s) { PropertiesService.getScriptProperties().setProperty('SESSIONS', JSON.stringify(s)); }
function validToken_(t) { if (!t) return false; const exp = sessions_()[t]; return !!exp && exp > Date.now(); }
function login_(d) {
  if (!prop_('ADMIN_EMAIL') || !prop_('ADMIN_PASSWORD')) return { ok: false, error: 'not configured' };
  const cache = CacheService.getScriptCache(), fails = Number(cache.get('fails') || 0);
  if (fails >= 8) return { ok: false, error: 'locked' };                 // 8 wrong tries -> 15 min lock
  const okE = eq_(String(d.email || '').trim().toLowerCase(), String(prop_('ADMIN_EMAIL')).trim().toLowerCase());
  const okP = eq_(d.password, prop_('ADMIN_PASSWORD'));
  if (!(okE && okP)) { cache.put('fails', String(fails + 1), 900); Utilities.sleep(800); return { ok: false, error: 'invalid' }; }
  cache.remove('fails');
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const s = sessions_(), now = Date.now();
  Object.keys(s).forEach(function (k) { if (s[k] < now) delete s[k]; });
  s[token] = now + (d.remember ? SESSION_DAYS : 1) * 864e5; saveSessions_(s);
  return { ok: true, token: token, expires: s[token] };
}

/* ---------- sheet helpers ---------- */
function rows_() {
  const s = sheet_(), v = s.getDataRange().getValues();
  return v.slice(1).map(function (r) {
    const o = {}; HEAD.forEach(function (h, i) { o[h] = r[i] === undefined ? '' : r[i]; });
    try { o.items = JSON.parse(o.items || '[]'); } catch (e) { o.items = []; }
    o.date = o.date instanceof Date ? o.date.toISOString() : String(o.date);
    o.pin = String(o.pin); o.phone = String(o.phone);
    if (!o.paystatus) o.paystatus = o.pay === 'cod' ? 'COD' : 'Pending';
    delete o.rzp;
    return o;
  });
}
function findRow_(id) {
  const s = sheet_(), ids = s.getRange(2, 1, Math.max(s.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}
function getRow_(r) {
  const v = sheet_().getRange(r, 1, 1, HEAD.length).getValues()[0], o = {};
  HEAD.forEach(function (h, i) { o[h] = v[i]; });
  try { o.items = JSON.parse(o.items || '[]'); } catch (e) { o.items = []; }
  return o;
}
function setCell_(r, col, val) { sheet_().getRange(r, HEAD.indexOf(col) + 1).setValue(val); }

/* ---------- trusted pricing (never trust totals from the browser) ---------- */
function prices_() {
  const cache = CacheService.getScriptCache();
  let j = cache.get('prices');
  if (!j) {
    const res = UrlFetchApp.fetch(prop_('PRICES_URL') || 'https://zoroluna.shop/prices.json', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('price list unavailable');
    j = res.getContentText(); JSON.parse(j); cache.put('prices', j, 300);
  }
  return JSON.parse(j);
}
function priceOrder_(items, coupon, pay) {
  const P = prices_(), lines = [];
  let sub = 0;
  (items || []).slice(0, 30).forEach(function (it) {
    const p = P.products[String(it.id)]; if (!p) return;
    const qty = Math.max(1, Math.min(10, Number(it.qty) || 1));
    lines.push({ id: Number(it.id), n: p.n, size: clip_(it.size, 5), qty: qty, p: p.p }); sub += p.p * qty;
  });
  if (!lines.length) return null;
  const rate = P.coupons[String(coupon || '').toUpperCase()] || 0;
  const disc = rate ? Math.round(sub * rate) : 0, base = sub - disc;
  const pre = pay === 'online' ? Math.round(base * P.prepaidOff) : 0;
  const ship = base >= P.shipFree ? 0 : P.shipFee, cod = pay === 'cod' ? P.codFee : 0;
  return { lines: lines, coupon: rate ? String(coupon).toUpperCase() : '', total: base - pre + ship + cod };
}

/* ---------- Razorpay ---------- */
function rzpReady_() { return !!(prop_('RAZORPAY_KEY_ID') && prop_('RAZORPAY_KEY_SECRET')); }
function rzpAuth_() { return 'Basic ' + Utilities.base64Encode(prop_('RAZORPAY_KEY_ID') + ':' + prop_('RAZORPAY_KEY_SECRET')); }
function rzpCall_(method, path, payload) {
  const opt = { method: method, headers: { Authorization: rzpAuth_() }, muteHttpExceptions: true };
  if (payload) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  const res = UrlFetchApp.fetch('https://api.razorpay.com/v1' + path, opt), j = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) throw new Error((j.error && j.error.description) || 'Razorpay error ' + res.getResponseCode());
  return j;
}
function rzpOrderFor_(r, o) {
  const ro = rzpCall_('post', '/orders', { amount: Math.round(Number(o.total) * 100), currency: 'INR', receipt: String(o.id), notes: { order: String(o.id) } });
  setCell_(r, 'rzp', ro.id);
  return { ok: true, keyId: prop_('RAZORPAY_KEY_ID'), rzpOrderId: ro.id, amount: ro.amount, total: Number(o.total) };
}
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function markPaid_(r, payId) {
  const o = getRow_(r); if (o.paystatus === 'Paid') return;
  setCell_(r, 'paystatus', 'Paid'); setCell_(r, 'payid', payId);
  if (o.status === 'New') setCell_(r, 'status', 'Confirmed');
  setCell_(r, 'updated', new Date().toISOString());
  notify_({ id: o.id, name: o.name, phone: o.phone, email: o.email, addr: o.addr, city: o.city, pin: o.pin, state: o.state, pay: 'online', total: o.total, items: o.items }, 'Payment received');
}

/* ---------- web app ---------- */
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    /* ---- public: customers ---- */
    if (d.action === 'order' || d.action === 'payInit') {
      if (d.hp) return json_({ ok: true });                                  // honeypot
      const o = d.order || {}, online = d.action === 'payInit';
      if (!o.id || !o.name || !o.phone) return json_({ ok: false, error: 'invalid' });
      let r = findRow_(o.id);
      if (online && !rzpReady_()) return json_({ ok: false, error: 'payments not configured' });
      if (r) {                                                                // existing order: allow payment retry only
        const ex = getRow_(r);
        if (!(online && ex.pay === 'online' && ex.paystatus !== 'Paid')) return json_({ ok: false, error: 'duplicate' });
        return json_(rzpOrderFor_(r, ex));
      }
      const pay = online ? 'online' : 'cod', priced = priceOrder_(o.items, o.coupon, pay);
      if (!priced) return json_({ ok: false, error: 'invalid items' });
      const row = [clip_(o.id, 20), clip_(o.date, 40), 'New', clip_(o.name, 80), clip_(o.phone, 15), clip_(o.email, 120), clip_(o.addr, 300),
        clip_(o.city, 60), clip_(o.pin, 10), clip_(o.state, 40), pay, priced.coupon, priced.total, JSON.stringify(priced.lines), '', '',
        new Date().toISOString(), online ? 'Pending' : 'COD', '', ''];
      sheet_().appendRow(row); r = findRow_(o.id);
      const full = { id: o.id, name: o.name, phone: o.phone, email: o.email, addr: o.addr, city: o.city, pin: o.pin, state: o.state, pay: pay, total: priced.total, items: priced.lines };
      if (!online) { notify_(full); return json_({ ok: true, total: priced.total }); }
      return json_(rzpOrderFor_(r, full));
    }
    if (d.action === 'payVerify') {
      const r = findRow_(d.id); if (!r) return json_({ ok: false, error: 'not found' });
      const o = getRow_(r);
      if (!d.razorpay_order_id || !d.razorpay_payment_id || !d.razorpay_signature) return json_({ ok: false, error: 'invalid' });
      if (!eq_(o.rzp, d.razorpay_order_id)) return json_({ ok: false, error: 'order mismatch' });
      const sig = hex_(Utilities.computeHmacSha256Signature(d.razorpay_order_id + '|' + d.razorpay_payment_id, prop_('RAZORPAY_KEY_SECRET')));
      if (!eq_(sig, d.razorpay_signature)) return json_({ ok: false, error: 'bad signature' });
      markPaid_(r, d.razorpay_payment_id);
      return json_({ ok: true });
    }
    /* ---- admin ---- */
    if (d.action === 'login') return json_(login_(d));
    if (d.action === 'logout') { const s = sessions_(); delete s[d.token]; saveSessions_(s); return json_({ ok: true }); }
    if (!validToken_(d.token)) return json_({ ok: false, error: 'unauthorized' });
    if (d.action === 'list') return json_({ ok: true, orders: rows_() });
    if (d.action === 'update') {
      const r = findRow_(d.id); if (!r) return json_({ ok: false, error: 'not found' });
      const f = d.fields || {};
      EDITABLE.forEach(function (k) {
        if (f[k] === undefined) return;
        if (k === 'status' && STATUSES.indexOf(f[k]) < 0) return;
        if (k === 'paystatus' && PAYSTATUS.indexOf(f[k]) < 0) return;
        setCell_(r, k, k === 'total' ? Number(f[k]) || 0 : clip_(f[k], 300));
      });
      setCell_(r, 'updated', new Date().toISOString());
      return json_({ ok: true });
    }
    if (d.action === 'reconcile') {                                           // ask Razorpay whether this order was paid
      const r = findRow_(d.id); if (!r) return json_({ ok: false, error: 'not found' });
      const o = getRow_(r); if (!o.rzp) return json_({ ok: false, error: 'no online payment started' });
      const pays = rzpCall_('get', '/orders/' + o.rzp + '/payments').items || [];
      const ok = pays.filter(function (p) { return p.status === 'captured' || p.status === 'authorized'; })[0];
      if (ok) { markPaid_(r, ok.id); return json_({ ok: true, paid: true, payid: ok.id }); }
      return json_({ ok: true, paid: false });
    }
    if (d.action === 'delete') {
      const r = findRow_(d.id); if (!r) return json_({ ok: false, error: 'not found' });
      sheet_().deleteRow(r); return json_({ ok: true });
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  } finally { lock.releaseLock(); }
}
function doGet() { return json_({ ok: true, service: 'Zoro Luna orders', payments: rzpReady_() }); }

function notify_(o, subjectPrefix) {
  const to = prop_('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail();
  const lines = o.items.map(function (l) { return '• ' + l.n + ' (' + l.size + ') × ' + l.qty + ' — ₹' + (l.p * l.qty); }).join('\n');
  const body = (subjectPrefix || 'New order') + ' ' + o.id + '\n\n' + lines + '\n\nTotal: ₹' + o.total + ' (' + (o.pay === 'cod' ? 'Cash on delivery' : 'Paid online') + ')\n\n' +
    o.name + '\n' + o.phone + (o.email ? '\n' + o.email : '') + '\n' + o.addr + ', ' + o.city + ', ' + o.state + ' ' + o.pin +
    '\n\nOpen your dashboard to confirm it.';
  MailApp.sendEmail(to, (subjectPrefix || 'New Zoro Luna order') + ' ' + o.id + ' — ₹' + o.total, body);
}

/** Run once from the editor to authorise Sheets, Mail and web requests (Razorpay). */
function setup() {
  sheet_(); MailApp.getRemainingDailyQuota();
  UrlFetchApp.fetch(prop_('PRICES_URL') || 'https://zoroluna.shop/prices.json', { muteHttpExceptions: true });
}
