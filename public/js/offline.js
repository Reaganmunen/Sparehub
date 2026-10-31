// Offline support for the till. Loaded after api.js (pos.html loads it itself; every other page gets it from layout.js).
//
//  - keeps a copy of the shop's products on this computer (IndexedDB), so the POS can search and sell with no internet
//  - saves every sale taken offline in a queue on this computer, and uploads it to /api/sales/sync when the internet is back
//  - shows a small status badge (bottom left) with how many sales are waiting, and a panel to retry / check them
//
// Public API is window.Offline (used by pos.js and api.js).
(function () {
  'use strict';
  if (window.Offline) return;

  const HEALTH = (typeof API_BASE === 'string' && /^https?:/i.test(API_BASE) ? API_BASE.replace(/\/api\/?$/, '') : '') + '/health';
  const CATALOG_FRESH_MS = 10 * 60 * 1000;
  const PROBE_EVERY_MS = 15 * 1000;

  const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const r2 = (n) => Math.round(n * 100) / 100;

  // ------------------------------------------------------------------ IndexedDB
  let dbPromise;
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('This browser cannot save data for offline use'));
        const r = indexedDB.open('sparehub-offline', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore('queue', { keyPath: 'client_ref' }); // sales waiting to be uploaded
          d.createObjectStore('meta', { keyPath: 'key' });          // small things: branches, settings, shift, recently synced
          d.createObjectStore('catalog', { keyPath: 'branch_id' }); // the product list of each shop
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return dbPromise;
  }
  const wrap = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  async function os(name, mode) { return (await openDb()).transaction(name, mode).objectStore(name); }
  const dbGet = async (s, k) => wrap((await os(s, 'readonly')).get(k));
  const dbPut = async (s, v) => wrap((await os(s, 'readwrite')).put(v));
  const dbDel = async (s, k) => wrap((await os(s, 'readwrite')).delete(k));
  const dbAll = async (s) => wrap((await os(s, 'readonly')).getAll());

  async function saveMeta(key, value) { try { await dbPut('meta', { key, value }); } catch { /* not critical */ } }
  async function getMeta(key) { try { const r = await dbGet('meta', key); return r ? r.value : null; } catch { return null; } }

  // ------------------------------------------------------------------ connection state
  let down = false;
  let counts = { pending: 0, failed: 0 };
  let syncing = false;
  let lastSyncError = '';

  function setDown(v) {
    if (v === down) return;
    down = v;
    paint();
    emit('offline:status', { down });
    if (!v) sync();
  }

  async function ping() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    try {
      await fetch(HEALTH + '?t=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
      setDown(false); // any answer at all, even an error page, means the server can be reached
    } catch { setDown(true); } finally { clearTimeout(t); }
    return !down;
  }

  // ------------------------------------------------------------------ the product list kept on this computer
  const freshAt = {};
  async function cacheCatalog(branchId, { force = false } = {}) {
    const key = Number(branchId);
    if (!key) return 0;
    if (!force && freshAt[key] && Date.now() - freshAt[key] < CATALOG_FRESH_MS) return -1;
    if (!force && !freshAt[key]) {
      const rec = await dbGet('catalog', key).catch(() => null);
      if (rec && Date.now() - rec.saved_ms < CATALOG_FRESH_MS) { freshAt[key] = rec.saved_ms; return -1; }
    }
    const r = await api('/products/pos/all?branch_id=' + encodeURIComponent(key));
    const rows = r.data || [];
    await dbPut('catalog', { branch_id: key, rows, saved_at: r.as_of || new Date().toISOString(), saved_ms: Date.now() });
    freshAt[key] = Date.now();
    return rows.length;
  }

  /** How many of each product are in sales that are saved here but not on the server yet. */
  async function waitingQty(branchId) {
    const used = new Map();
    for (const q of await dbAll('queue').catch(() => [])) {
      if (Number(q.branch_id) !== Number(branchId)) continue;
      for (const it of q.items) used.set(it.product_id, (used.get(it.product_id) || 0) + Number(it.quantity));
    }
    return used;
  }
  const withStock = (p, used) => (p.track_stock ? { ...p, quantity: Number(p.quantity) - (used.get(p.product_id) || 0) } : p);

  /** Same filters as the server search. Returns null when nothing is saved for that shop yet. */
  async function searchCatalog(branchId, f = {}) {
    const rec = await dbGet('catalog', Number(branchId)).catch(() => null);
    if (!rec) return null;
    const used = await waitingQty(branchId);
    const q = String(f.q || '').trim().toLowerCase();
    let rows = rec.rows;
    if (q) {
      const words = q.split(/\s+/);
      rows = rows.filter((p) => {
        const hay = [p.product_name, p.sku, p.barcode, p.part_number].join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      const exact = (p) => [p.barcode, p.sku, p.part_number].some((x) => x && String(x).toLowerCase() === q);
      rows = [...rows.filter(exact), ...rows.filter((p) => !exact(p))];
    }
    if (f.category_id) rows = rows.filter((p) => String(p.category_id) === String(f.category_id));
    rows = rows.map((p) => withStock(p, used));
    if (f.in_stock) rows = rows.filter((p) => !p.track_stock || p.quantity > 0);
    return rows.slice(0, f.limit || 60);
  }

  async function findByCode(branchId, code) {
    const rec = await dbGet('catalog', Number(branchId)).catch(() => null);
    if (!rec) return null;
    const c = String(code).trim().toLowerCase();
    const p = rec.rows.find((x) => (x.barcode && String(x.barcode).toLowerCase() === c) || (x.sku && String(x.sku).toLowerCase() === c));
    return p ? withStock(p, await waitingQty(branchId)) : null;
  }

  // ------------------------------------------------------------------ the queue of offline sales
  async function refreshCounts() {
    try {
      const all = await dbAll('queue');
      counts = { pending: all.filter((q) => q.status !== 'failed').length, failed: all.filter((q) => q.status === 'failed').length };
    } catch { counts = { pending: 0, failed: 0 }; }
    paint();
    emit('offline:queue', counts);
  }

  async function enqueue(rec) {
    rec.status = 'pending';
    rec.attempts = 0;
    await dbPut('queue', rec);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); // ask the browser not to clear this
    await refreshCounts();
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  /** A unique id for the upload, plus the temporary receipt number printed for the customer: OFF-<shop>-<computer>-<n>. */
  async function newRef(branchCode) {
    let dev = localStorage.getItem('spare_device');
    if (!dev) { dev = newId().replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase(); localStorage.setItem('spare_device', dev); }
    const seq = (Number(localStorage.getItem('spare_off_seq')) || 0) + 1;
    localStorage.setItem('spare_off_seq', String(seq));
    return { client_ref: newId(), label: `OFF-${branchCode || 'XX'}-${dev}-${String(seq).padStart(4, '0')}` };
  }

  const itemsTotal = (q) => r2(q.items.reduce((a, it) => a + Number(it.quantity) * Number(it.unit_price), 0));

  /** The receipt as text, same layout as the server's receipt, for a sale that is not on the server yet. */
  function receiptText({ rec, branch = {}, business, cashier }) {
    const when = new Date(rec.sold_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
    const L = [];
    L.push(business || branch.name || 'Spare Hub');
    L.push(`${branch.name || ''}${branch.town ? ', ' + branch.town : ''}`.replace(/^, /, ''));
    if (branch.phone) L.push(`Tel: ${branch.phone}`);
    if (branch.receipt_header) L.push(branch.receipt_header);
    L.push('', `Receipt: ${rec.label}`, `Date: ${when}`, `Served by: ${cashier || ''}`, '--------------------------');
    for (const it of rec.items) {
      L.push(`${it.quantity} x ${it.name}`);
      L.push(`   @ ${money(it.unit_price)} = ${money(Number(it.quantity) * Number(it.unit_price))}`);
    }
    L.push('--------------------------', `TOTAL: ${money(itemsTotal(rec))}`);
    const label = { mpesa: 'M-Pesa', bank_transfer: 'Bank', card: 'Card', cash: 'Cash' };
    for (const p of rec.payments) L.push(`Paid (${label[p.method] || 'Cash'}): ${money(p.amount)}${p.reference ? ` [${String(p.reference).toUpperCase()}]` : ''}`);
    if (branch.receipt_footer) L.push('', branch.receipt_footer);
    return L.join('\n');
  }

  const wire = (q) => ({
    client_ref: q.client_ref, label: q.label, branch_id: q.branch_id, cashier_id: q.cashier_id, shift_id: q.shift_id,
    sale_type: q.sale_type, customer_id: q.customer_id, sold_at: q.sold_at, notes: q.notes, expected_total: q.expected_total,
    items: q.items.map((it) => ({ product_id: it.product_id, name: it.name, quantity: it.quantity, unit_price: it.unit_price })),
    payments: q.payments,
  });

  async function logSynced(q, r) {
    const log = (await getMeta('synced_log')) || [];
    log.unshift({ label: q.label, receipt_no: r.receipt_no || null, total: itemsTotal(q), at: new Date().toISOString(), warning: r.warning || null, duplicate: r.status === 'duplicate' });
    await saveMeta('synced_log', log.slice(0, 15));
  }

  /** Uploads everything waiting that this user may upload (own sales; managers and the owner: all). */
  async function sync() {
    if (syncing || down) return;
    if (typeof Auth === 'undefined' || !Auth.token) return;
    syncing = true;
    lastSyncError = '';
    paint();
    const touched = new Set();
    let done = 0;
    try {
      const me = Auth.user || {};
      const mgr = me.role === 'owner' || me.role === 'manager';
      const rows = (await dbAll('queue'))
        .filter((q) => q.status !== 'failed' && (mgr || q.user_id === me.id))
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      while (rows.length) {
        const chunk = rows.splice(0, 10);
        let results;
        try {
          results = (await api('/sales/sync', { method: 'POST', body: { sales: chunk.map(wire) } })).data || [];
        } catch (e) {
          lastSyncError = e.message;
          if (e.code === 'NETWORK') setDown(true);
          break;
        }
        for (const r of results) {
          const q = chunk.find((c) => c.client_ref === r.client_ref);
          if (!q) continue;
          if (r.status === 'synced' || r.status === 'duplicate') {
            await dbDel('queue', q.client_ref); await logSynced(q, r); touched.add(q.branch_id); done++;
          } else if (r.transient) {
            q.attempts = (q.attempts || 0) + 1; q.error = r.message; await dbPut('queue', q);
          } else {
            q.status = 'failed'; q.error = r.message; q.code = r.code || null; await dbPut('queue', q);
          }
        }
      }
    } finally {
      syncing = false;
      await refreshCounts();
    }
    if (done) {
      for (const b of touched) await cacheCatalog(b, { force: true }).catch(() => {}); // stock changed on the server
      emit('offline:synced', { count: done });
      flash(`${done} offline sale${done === 1 ? '' : 's'} sent to the system`);
    }
  }

  async function retry(ref) {
    const q = await dbGet('queue', ref);
    if (!q) return;
    q.status = 'pending'; q.error = null; q.attempts = 0;
    await dbPut('queue', q);
    await refreshCounts();
    if (await ping()) await sync();
    renderPanel();
  }

  async function discard(ref) {
    const q = await dbGet('queue', ref);
    if (!q) return;
    if (!confirm(`Throw away offline sale ${q.label} (${money(itemsTotal(q))})?\n\nThe customer already paid for it. Only do this if you are sure it was recorded another way.`)) return;
    await dbDel('queue', ref);
    await refreshCounts();
    renderPanel();
  }

  // ------------------------------------------------------------------ the little badge + panel
  let pill, panel, flashTimer;
  const STYLE = `
.off-pill{position:fixed;left:14px;bottom:14px;z-index:2100;display:none;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;border:1px solid transparent;
  font:500 13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18)}
.off-pill.show{display:inline-flex}.off-pill .dot{width:9px;height:9px;border-radius:50%;background:currentColor}
.off-pill.warn{background:#fef3c7;color:#92400e;border-color:#fcd34d}.off-pill.bad{background:#fee2e2;color:#991b1b;border-color:#fca5a5}
.off-pill.ok{background:#dcfce7;color:#166534;border-color:#86efac}.off-pill.info{background:#e0f2fe;color:#075985;border-color:#7dd3fc}
.off-panel{position:fixed;left:14px;bottom:60px;z-index:2100;width:min(420px,calc(100vw - 28px));max-height:70vh;overflow:auto;display:none;background:#fff;color:#1f2937;
  border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.off-panel.show{display:block}.off-panel h6{margin:0;font-size:14px;font-weight:600}.off-panel .hd{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #eee}
.off-panel .it{padding:10px 14px;border-bottom:1px solid #f3f4f6}.off-panel .sub{color:#6b7280;font-size:12px}.off-panel .err{color:#b91c1c;font-size:12px;margin-top:4px}
.off-panel .mono{font-family:ui-monospace,Menlo,Consolas,monospace}.off-panel button{border:1px solid #d1d5db;background:#fff;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer}
.off-panel button.pri{background:#111;color:#fff;border-color:#111}.off-panel .ft{padding:10px 14px;display:flex;gap:8px;justify-content:flex-end}
.off-panel .sec{padding:8px 14px;background:#f9fafb;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280}`;

  function paint() {
    if (!pill) return;
    const { pending, failed } = counts;
    let text = '', cls = '';
    if (failed) { text = `${failed} offline sale${failed === 1 ? '' : 's'} need${failed === 1 ? 's' : ''} attention`; cls = 'bad'; }
    else if (down) { text = pending ? `No internet · ${pending} sale${pending === 1 ? '' : 's'} saved here` : 'No internet'; cls = 'warn'; }
    else if (pending) { text = syncing ? `Sending ${pending} sale${pending === 1 ? '' : 's'}...` : `${pending} sale${pending === 1 ? '' : 's'} waiting to send`; cls = 'info'; }
    pill.className = 'off-pill' + (text ? ' show ' + cls : '');
    pill.innerHTML = text ? `<span class="dot"></span>${escH(text)}` : '';
    if (panel && panel.classList.contains('show')) renderPanel();
  }

  function flash(text) {
    if (!pill) return;
    clearTimeout(flashTimer);
    pill.className = 'off-pill show ok';
    pill.innerHTML = `<span class="dot"></span>${escH(text)}`;
    flashTimer = setTimeout(paint, 4000);
  }

  async function renderPanel() {
    if (!panel) return;
    const me = (typeof Auth !== 'undefined' && Auth.user) || {};
    const mgr = me.role === 'owner' || me.role === 'manager';
    const queue = (await dbAll('queue').catch(() => [])).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const log = (await getMeta('synced_log')) || [];
    const when = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    panel.innerHTML = `<div class="hd"><h6>Offline sales</h6><button data-x="close" aria-label="Close">Close</button></div>
      <div class="it"><b>${down ? 'No internet' : 'Connected'}</b><div class="sub">${down
        ? 'You can keep selling. Sales are saved on this computer and sent when the internet is back.'
        : counts.pending ? 'Sales saved on this computer are being sent to the system.' : 'Nothing is waiting.'}${lastSyncError ? `<div class="err">Last attempt: ${escH(lastSyncError)}</div>` : ''}</div></div>
      ${queue.length ? '<div class="sec">Not on the system yet</div>' : ''}
      ${queue.map((q) => `<div class="it"><div style="display:flex;justify-content:space-between;gap:8px"><span class="mono">${escH(q.label)}</span><b>${money(itemsTotal(q))}</b></div>
        <div class="sub">${when(q.sold_at)} · ${q.items.length} item${q.items.length === 1 ? '' : 's'} · ${q.status === 'failed' ? 'needs attention' : 'waiting'}</div>
        ${q.error ? `<div class="err">${escH(q.error)}</div>` : ''}
        ${q.status === 'failed' ? `<div style="margin-top:6px;display:flex;gap:6px"><button data-retry="${escH(q.client_ref)}">Try again</button>${mgr ? `<button data-drop="${escH(q.client_ref)}">Discard</button>` : ''}</div>` : ''}</div>`).join('')}
      ${log.length ? '<div class="sec">Recently sent</div>' : ''}
      ${log.map((l) => `<div class="it"><div style="display:flex;justify-content:space-between;gap:8px"><span class="mono">${escH(l.label)}</span><span class="mono">${escH(l.receipt_no || '')}</span></div>
        <div class="sub">${when(l.at)} · ${money(l.total)}${l.duplicate ? ' · was already on the system' : ''}</div>${l.warning ? `<div class="err">${escH(l.warning)}</div>` : ''}</div>`).join('')}
      <div class="ft"><button class="pri" data-x="sync">Send now</button></div>`;
  }

  function mountUi() {
    if (pill) return;
    const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
    pill = document.createElement('button'); pill.type = 'button'; pill.className = 'off-pill'; pill.setAttribute('aria-live', 'polite');
    panel = document.createElement('div'); panel.className = 'off-panel';
    document.body.append(pill, panel);
    pill.onclick = async () => { panel.classList.toggle('show'); if (panel.classList.contains('show')) renderPanel(); };
    panel.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x === 'close') panel.classList.remove('show');
      else if (b.dataset.x === 'sync') { b.disabled = true; if (await ping()) await sync(); else flash('Still no internet'); renderPanel(); }
      else if (b.dataset.retry) retry(b.dataset.retry);
      else if (b.dataset.drop) discard(b.dataset.drop);
    });
    paint();
  }

  // ------------------------------------------------------------------ start
  function start() {
    mountUi();
    refreshCounts();
    ping().then(() => { if (!down) sync(); });
    setInterval(async () => { await ping(); if (!down && counts.pending) sync(); }, PROBE_EVERY_MS);
  }
  window.addEventListener('offline', () => setDown(true));
  window.addEventListener('online', () => ping());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // makes the app installable and keeps the pages available with no internet
  const link = document.createElement('link'); link.rel = 'manifest'; link.href = 'manifest.webmanifest'; document.head.appendChild(link);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* needs https or localhost */ });

  window.Offline = {
    isDown: () => down,
    markDown: () => setDown(true),
    markUp: () => { if (down) setDown(false); },
    pendingCount: () => counts.pending + counts.failed,
    ping, sync, saveMeta, getMeta, cacheCatalog, searchCatalog, findByCode, enqueue, newRef, receiptText,
  };
})();
