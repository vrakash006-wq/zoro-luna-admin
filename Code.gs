/**
 * Zoro Luna — order backend (Google Apps Script bound to a Google Sheet).
 * Setup steps are in SETUP.md. Secrets live in Script Properties, never in this file:
 *   ADMIN_KEY     – the password you type into the dashboard
 *   NOTIFY_EMAIL  – where new-order emails go (defaults to your Google account)
 */
const SHEET = 'Orders';
const HEAD = ['id', 'date', 'status', 'name', 'phone', 'email', 'addr', 'city', 'pin', 'state', 'pay', 'coupon', 'total', 'items', 'tracking', 'notes', 'updated'];
const EDITABLE = ['status', 'name', 'phone', 'email', 'addr', 'city', 'pin', 'state', 'pay', 'coupon', 'total', 'tracking', 'notes'];
const STATUSES = ['New', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled', 'Returned'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(SHEET);
  if (!s) { s = ss.insertSheet(SHEET); s.appendRow(HEAD); s.setFrozenRows(1); }
  return s;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function clip_(v, n) { return String(v == null ? '' : v).slice(0, n); }
function rows_() {
  const s = sheet_(), v = s.getDataRange().getValues();
  return v.slice(1).map(function (r) {
    const o = {}; HEAD.forEach(function (h, i) { o[h] = r[i]; });
    try { o.items = JSON.parse(o.items || '[]'); } catch (e) { o.items = []; }
    o.date = o.date instanceof Date ? o.date.toISOString() : String(o.date);
    o.pin = String(o.pin); o.phone = String(o.phone);
    return o;
  });
}
function findRow_(id) {
  const s = sheet_(), ids = s.getRange(2, 1, Math.max(s.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    // Public: a customer placing an order (no key needed)
    if (d.action === 'order') {
      if (d.hp) return json_({ ok: true });                       // honeypot
      const o = d.order || {};
      if (!o.id || !o.name || !o.phone || !o.items || !o.items.length) return json_({ ok: false, error: 'invalid' });
      if (findRow_(o.id)) return json_({ ok: false, error: 'duplicate' });
      const row = [clip_(o.id, 20), clip_(o.date, 40), 'New', clip_(o.name, 80), clip_(o.phone, 15), clip_(o.email, 120), clip_(o.addr, 300),
        clip_(o.city, 60), clip_(o.pin, 10), clip_(o.state, 40), clip_(o.pay, 10), clip_(o.coupon, 20), Number(o.total) || 0,
        JSON.stringify(o.items).slice(0, 4000), '', '', new Date().toISOString()];
      sheet_().appendRow(row);
      notify_(o);
      return json_({ ok: true });
    }
    // Everything else needs the admin key
    if (!prop_('ADMIN_KEY') || d.key !== prop_('ADMIN_KEY')) return json_({ ok: false, error: 'unauthorized' });
    if (d.action === 'list') return json_({ ok: true, orders: rows_() });
    if (d.action === 'update') {
      const r = findRow_(d.id); if (!r) return json_({ ok: false, error: 'not found' });
      const s = sheet_(); const f = d.fields || {};
      EDITABLE.forEach(function (k) {
        if (f[k] === undefined) return;
        if (k === 'status' && STATUSES.indexOf(f[k]) < 0) return;
        s.getRange(r, HEAD.indexOf(k) + 1).setValue(k === 'total' ? Number(f[k]) || 0 : clip_(f[k], 300));
      });
      s.getRange(r, HEAD.indexOf('updated') + 1).setValue(new Date().toISOString());
      return json_({ ok: true });
    }
    if (d.action === 'delete') {
      const r = findRow_(d.id); if (!r) return json_({ ok: false, error: 'not found' });
      sheet_().deleteRow(r); return json_({ ok: true });
    }
    return json_({ ok: false, error: 'unknown action' });
  } finally { lock.releaseLock(); }
}
function doGet() { return json_({ ok: true, service: 'Zoro Luna orders' }); }

function notify_(o) {
  const to = prop_('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail();
  const lines = o.items.map(function (l) { return '• ' + l.n + ' (' + l.size + ') × ' + l.qty + ' — ₹' + (l.p * l.qty); }).join('\n');
  const body = 'New order ' + o.id + '\n\n' + lines + '\n\nTotal: ₹' + o.total + ' (' + (o.pay === 'cod' ? 'Cash on delivery' : 'Online payment') + ')\n\n' +
    o.name + '\n' + o.phone + (o.email ? '\n' + o.email : '') + '\n' + o.addr + ', ' + o.city + ', ' + o.state + ' ' + o.pin +
    '\n\nOpen your dashboard to confirm it.';
  MailApp.sendEmail(to, 'New Zoro Luna order ' + o.id + ' — ₹' + o.total, body);
}

/** Run once from the editor to authorise email + sheet access. */
function setup() { sheet_(); MailApp.getRemainingDailyQuota(); }
