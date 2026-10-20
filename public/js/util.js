// Small helpers shared by the newer pages (reports, expenses, users, audit, settings, returns, shifts, stocktake, catalogue).
// Load after api.js and layout.js.
const $ = (id) => document.getElementById(id);
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.set(k, v)); const s = p.toString(); return s ? '?' + s : ''; };
const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const monthStart = () => { const d = new Date(); d.setDate(1); return ymd(d); };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
const labelize = (k) => String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const showErr = (id, msg) => { const e = $(id); if (!e) return; e.textContent = msg || ''; e.classList.toggle('d-none', !msg); };
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast-x' + (err ? ' err' : ''); t.textContent = msg; $('toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3000); }
function pageNotice(msg) { const n = $('notice'); if (n) n.innerHTML = msg ? `<div class="alert-x">${esc(msg)}</div>` : ''; }
const debounce = (fn, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const opt = (v, t, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`;
const dateOnly = (d) => (d ? String(d).slice(0, 10) : '');
// Turns any value into display text based on the column name (used by the generic tables)
const MONEY = /(sales|revenue|cost|profit|total|value|balance|owed|amount|expenses?|discounts?|returns?_value|^returns$|cash|mpesa|float|price|limit|takings|paid|due)/i;
function fmtCell(key, v) {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (/(_at|_date|^date$|^month$|^day$)/.test(key) || /^\d{4}-\d{2}-\d{2}(T|$)/.test(String(v))) return /_at$/.test(key) ? when(v) : (key === 'month' ? new Date(v).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : day(v));
  if (typeof v === 'object') return JSON.stringify(v);
  if (!isNaN(Number(v)) && String(v).trim() !== '') { if (/(_id$|^id$|phone|sku|receipt|_no$|number)/i.test(key)) return String(v); if (MONEY.test(key) && !/(count|quantity|transactions|entries|days|items|open_sales|voided_sales|in_stock)/i.test(key)) return KES(v); return Number(v).toLocaleString('en-KE', { maximumFractionDigits: 2 }); }
  return String(v).replace(/_/g, ' ');
}
// Authenticated file download (the reports export needs the login header, so a plain link will not work)
async function downloadFile(path, fallbackName) {
  const res = await fetch(API_BASE + path, { headers: { Authorization: `Bearer ${Auth.token}` } });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d.error && d.error.message) || 'Could not download the file.'); }
  const blob = await res.blob(), cd = res.headers.get('content-disposition') || '', m = /filename="?([^";]+)"?/.exec(cd);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = m ? m[1] : fallbackName; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// Pager used by list pages: pager({ info, prev, next }, state, load)
function bindPager(ids, state, load) {
  $(ids.prev).onclick = () => { state.page--; load(); }; $(ids.next).onclick = () => { state.page++; load(); };
}
function paintPager(ids, state) {
  const from = state.total ? (state.page - 1) * state.limit + 1 : 0, to = Math.min(state.page * state.limit, state.total);
  $(ids.info).textContent = `${from}-${to} of ${state.total}`; $(ids.prev).disabled = state.page <= 1; $(ids.next).disabled = to >= state.total;
}
