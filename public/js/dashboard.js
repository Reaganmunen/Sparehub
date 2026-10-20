const $ = (id) => document.getElementById(id);
const me = requireLogin();
const owner = me.role === 'owner';
const state = { branchId: owner ? '' : String(me.branch_id || ''), days: 7, branches: [] };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.set(k, v)); const s = p.toString(); return s ? '?' + s : ''; };
const compact = (n) => (n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0).replace('.0', '') + 'k' : String(Math.round(n)));
const shopName = (id) => (state.branches.find((b) => b.id === Number(id)) || {}).name || 'Shop';
const period = () => { const to = new Date(), from = new Date(); from.setDate(to.getDate() - (state.days - 1)); return { from: ymd(from), to: ymd(to) }; };

// Cashiers get a plain dashboard: their own recent sales only. Everything that comes from reports is removed from the page.
const cashier = me.role === 'cashier';
if (cashier) {
  document.querySelectorAll('[data-staff]').forEach((el) => el.remove());
  $('salesCol').className = 'col-12'; $('salesTitle').textContent = 'My recent sales';
}

$('hello').textContent = `Welcome back, ${(me.full_name || '').split(' ')[0]}`;

// ---------- KPI cards ----------
function renderKpis(d, daily) {
  const t = d.totals, shops = d.shops || [];
  const byShop = (key, fmt) => shops.map((s) => `${esc(shopName(s.branch_id))} ${fmt(s[key])}`).join(' · ');
  const last7 = {}; daily.forEach((r) => { const k = String(r.sale_date).slice(0, 10); last7[k] = last7[k] || { s: 0, t: 0 }; last7[k].s += Number(r.net_sales || 0); last7[k].t += Number(r.transactions || 0); });
  const keys = Object.keys(last7).sort().slice(-8);
  const spark = (f) => { const v = keys.map((k) => f(last7[k])), m = Math.max(...v, 1); return `<span class="spark">${v.map((x) => `<i style="height:${Math.max(8, (x / m) * 100)}%"></i>`).join('')}</span>`; };
  const cards = [
    ['Sales today', KES(t.net_sales_today), '', spark((x) => x.s), byShop('net_sales_today', (v) => compact(v))],
    ['Sales made', Number(t.transactions_today || 0).toLocaleString(), 'today', spark((x) => x.t), byShop('transactions_today', (v) => v)],
    ['M-Pesa today', KES(t.mpesa_today), '', '', `Cash ${KES(t.cash_today)}`],
    ['Unpaid credit', KES(t.unpaid_credit), '', '', `${Number(t.low_stock_items || 0)} items low on stock`],
  ];
  $('kpis').innerHTML = cards.map(([l, v, u, sp, f]) => `<div class="col-6 col-xl-3"><div class="kpi"><div class="kpi-in">
    <div class="d-flex justify-content-between align-items-start"><span class="label-mono">${l}</span>${sp}</div>
    <div class="v">${v}${u ? `<span class="unit">${u}</span>` : ''}</div></div><div class="kpi-f"><span>${f || '&nbsp;'}</span></div></div></div>`).join('');
}

// ---------- pixel-grid sales trend ----------
function renderTrend(daily) {
  const { from } = period(), shops = state.branchId ? state.branches.filter((b) => String(b.id) === state.branchId) : state.branches;
  const days = []; const d0 = new Date(from + 'T00:00:00');
  for (let i = 0; i < state.days; i++) { const d = new Date(d0); d.setDate(d0.getDate() + i); days.push(ymd(d)); }
  const val = {}; daily.forEach((r) => { const k = String(r.sale_date).slice(0, 10) + '|' + r.branch_id; val[k] = (val[k] || 0) + Number(r.net_sales || 0); });
  const col = days.map((d) => shops.map((s) => val[d + '|' + s.id] || 0));
  const totals = col.map((c) => c.reduce((a, b) => a + b, 0)), max = Math.max(...totals, 1);
  const step = Math.pow(10, Math.floor(Math.log10(max))), ymax = Math.ceil(max / step) * step, ROWS = 12;
  $('trendTotal').textContent = KES(totals.reduce((a, b) => a + b, 0));
  $('legend').innerHTML = shops.slice(0, 2).map((s, i) => `<span><i style="background:${i ? 'var(--red)' : '#141414'}"></i>${esc(s.name)}</span>`).join('');
  $('yaxis').innerHTML = [4, 3, 2, 1, 0].map((i) => `<span>${compact((ymax * i) / 4)}</span>`).join('');
  $('pix').innerHTML = col.map((c, ci) => {
    const cells = []; c.slice(0, 2).forEach((v, si) => { const n = v > 0 ? Math.max(1, Math.round((v / ymax) * ROWS)) : 0; for (let k = 0; k < n; k++) cells.push(si ? 'b' : 'a'); });
    const top = cells.slice(0, ROWS), pad = Array(ROWS - top.length).fill('');
    return `<div class="pc" data-c="${ci}">${[...pad, ...top.reverse()].map((c) => `<i class="${c}"></i>`).join('')}</div>`;
  }).join('');
  const every = state.days > 14 ? 5 : 1;
  $('xaxis').innerHTML = days.map((d, i) => `<span>${i % every === 0 ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</span>`).join('');
  const tip = $('tip'), wrap = document.querySelector('.pix-wrap');
  $('pix').onmousemove = (e) => {
    const c = e.target.closest('.pc'); if (!c) return; const i = +c.dataset.c, r = c.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    tip.innerHTML = `<b>${new Date(days[i] + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</b>` +
      shops.map((s, si) => `<div><span><i class="bi bi-square-fill me-1" style="color:${si ? 'var(--red)' : '#141414'};font-size:.55rem"></i>${esc(s.name)}</span><span>${compact(col[i][si])}</span></div>`).join('');
    tip.style.display = 'block'; const left = r.left - w.left + r.width + 10; tip.style.left = (left + 170 > w.width ? r.left - w.left - 170 : left) + 'px';
  };
  $('pix').onmouseleave = () => (tip.style.display = 'none');
}

// ---------- best sellers, low stock, recent sales ----------
function renderBest(rows) {
  const m = Math.max(...rows.map((r) => Number(r.revenue)), 1);
  $('bestTotal').textContent = KES(rows.reduce((a, r) => a + Number(r.revenue || 0), 0));
  $('bars').innerHTML = rows.length ? rows.map((r) => `<div class="col" title="${esc(r.product_name)}: ${KES(r.revenue)}"><i style="height:${(Number(r.revenue) / m) * 100}%"></i></div>`).join('') : '<div class="empty w-100">No sales in this period yet.</div>';
  $('bestList').innerHTML = rows.slice(0, 3).map((r) => `<li><span>${esc(r.product_name)}</span><span class="mono">${Number(r.quantity_sold)} sold</span></li>`).join('');
}
function renderLow(rows) {
  $('lowCount').textContent = rows.length;
  $('lowList').innerHTML = rows.length ? rows.slice(0, 7).map((r) => { const lvl = Number(r.reorder_level) || 1, pct = Math.min(100, (Number(r.quantity) / lvl) * 100);
    return `<div class="low"><div class="d-flex justify-content-between gap-2"><span class="text-truncate">${esc(r.product_name)}</span><span class="mono small flex-none">${Number(r.quantity)} / ${lvl}</span></div>
    <div class="small text-muted">${esc(r.branch_name || shopName(r.branch_id))}</div><div class="meter"><i style="width:${pct}%"></i></div></div>`; }).join('')
    : '<div class="empty">Every item is above its reorder level.</div>';
}
const STATUS = { paid: ['Paid', ''], partial: ['Part paid', 'part'], unpaid: ['Unpaid', 'due'] };
function renderSales(res) {
  const rows = res.data || [];
  $('txBody').innerHTML = rows.length ? rows.map((s) => { const [t, c] = STATUS[s.payment_status] || [s.payment_status, 'part'];
    return `<tr><td><span class="mono">${esc(s.receipt_no)}</span><div class="small text-muted">${new Date(s.sold_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></td>
    <td>${esc(s.customer_name || 'Walk-in')}</td><td>${esc(s.branch_name)}</td>${cashier ? '' : `<td>${esc(s.cashier_name)}</td>`}
    <td class="text-end mono fw-semibold">${KES(s.total - s.returned_total)}</td><td><span class="st ${c}">${esc(t)}</span></td></tr>`; }).join('')
    : `<tr><td colspan="${cashier ? 5 : 6}" class="empty">No sales found.</td></tr>`;
}

// ---------- loading ----------
const loadSales = () => api('/sales' + qs({ branch_id: state.branchId, mine: cashier ? 'true' : '', limit: 8, q: $('txSearch').value.trim() })).then(renderSales);
async function load() {
  loadSales().catch((e) => ($('txBody').innerHTML = `<tr><td colspan="${cashier ? 5 : 6}" class="empty">${esc(e.message)}</td></tr>`));
  if (cashier) return;
  const { from, to } = period(), b = { branch_id: state.branchId };
  try {
    const [dash, daily, top, low] = await Promise.all([
      api('/reports/dashboard' + qs(b)), api('/reports/daily-sales' + qs({ ...b, from, to })),
      api('/reports/top-products' + qs({ ...b, from, to, limit: 10, order_by: 'revenue' })), api('/reports/low-stock' + qs(b)),
    ]);
    $('notice').classList.add('d-none');
    renderKpis(dash.data, daily.data); renderTrend(daily.data); renderBest(top.data); renderLow(low.data);
  } catch (e) {
    $('notice').classList.remove('d-none');
    $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`;
  }
}

// ---------- events ----------
if (!cashier) $('range').onchange = (e) => { state.days = +e.target.value; load(); };
let t; const search = (v) => { clearTimeout(t); $('txSearch').value = v; $('globalSearch').value = v; t = setTimeout(() => loadSales().catch(() => {}), 350); };
$('txSearch').oninput = (e) => search(e.target.value); $('globalSearch').oninput = (e) => search(e.target.value);
if (!cashier) $('exportBtn').onclick = async () => {
  const { from, to } = period(), btn = $('exportBtn'); btn.disabled = true;
  try {
    const res = await fetch(API_BASE + '/reports/daily-sales/export' + qs({ format: 'xlsx', branch_id: state.branchId, from, to }), { headers: { Authorization: 'Bearer ' + Auth.token } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || 'Could not export');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `daily-sales-${from}-to-${to}.xlsx`; a.click();
  } catch (e) { $('notice').classList.remove('d-none'); $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`; } finally { btn.disabled = false; }
};

(async () => {
  try { state.branches = (await api('/branches')).data; } catch { /* sidebar still works */ }
  renderShell({ active: 'dashboard', branches: state.branches, branchId: state.branchId, onBranch: (v) => { state.branchId = v; load(); } });
  load();
})();