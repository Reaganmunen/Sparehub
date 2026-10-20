const me = requireLogin();
const isOwner = me.role === 'owner', canCosts = isOwner || !!me.can_view_costs;
const state = { branches: [], branchId: isOwner ? '' : String(me.branch_id || ''), ran: false };
const shopName = (id) => (state.branches.find((b) => Number(b.id) === Number(id)) || {}).name || (id ? 'Shop ' + id : '-');

// key, label, options (dates / order / days / overdue), who may see it
const REPORTS = [
  ['daily-sales', 'Daily sales', { dates: 1 }], ['sales-summary', 'Sales summary (totals)', { dates: 1 }],
  ['top-products', 'Best-selling products', { dates: 1, order: 1 }], ['slow-movers', 'Slow-moving stock', { days: 1 }],
  ['low-stock', 'Low stock', {}], ['stock-value', 'Stock value', {}],
  ['payments-by-method', 'Payments by method', { dates: 1 }], ['cashier-performance', 'Cashier performance', { dates: 1 }],
  ['expenses', 'Expenses by category', { dates: 1 }], ['debtors', 'Customers who owe us', { overdue: 1 }],
  ['overdue-sales', 'Overdue credit sales', {}],
  ...(isOwner ? [['creditors', 'What we owe suppliers', {}]] : []),
  ...(canCosts ? [['monthly-profit', 'Monthly profit and loss', { dates: 1 }]] : []),
];
const SUMMABLE = /(sales|revenue|total|amount|profit|cost|expense|discount|returns|transactions|quantity_sold|count|entries|value|balance|owed)/i, NOT_SUM = /(_id$|price|average|percent|margin|days|limit|date|open_)/i;
const ONE_PER_SHOP = ['debtors', 'creditors']; // these ignore the shop picker

$('rName').innerHTML = REPORTS.map(([k, l]) => opt(k, l, 'daily-sales')).join('');
const d30 = new Date(); d30.setDate(d30.getDate() - 29); $('rFrom').value = ymd(d30); $('rTo').value = today();

function current() { const k = $('rName').value; return REPORTS.find((r) => r[0] === k); }
function syncControls() {
  const o = current()[2];
  $('rFrom').classList.toggle('d-none', !o.dates); $('rTo').classList.toggle('d-none', !o.dates);
  $('rOrder').classList.toggle('d-none', !o.order); $('rDays').classList.toggle('d-none', !o.days);
  $('rOverdueBox').classList.toggle('d-none', !o.overdue); $('rOverdueBox').classList.toggle('d-flex', !!o.overdue);
}
$('rName').onchange = () => { syncControls(); $('rRun').click(); };
function params() {
  const o = current()[2], p = { branch_id: state.branchId };
  if (o.dates) { p.from = $('rFrom').value; p.to = $('rTo').value; }
  if (o.order) { p.order_by = $('rOrder').value; p.limit = 100; }
  if (o.days) p.days = $('rDays').value || 60;
  if (o.overdue && $('rOverdue').checked) p.only_overdue = 'true';
  return p;
}
function table(rows) {
  const name = $('rName').value;
  const keys = Object.keys(rows[0]).filter((k) => k !== 'total_count' && !(/_id$/.test(k) && k !== 'branch_id') && !(k === 'branch_name' && 'branch_id' in rows[0]));
  const head = keys.map((k) => (k === 'branch_id' || k === 'branch_name' ? 'Shop' : labelize(k)));
  const isNum = (k) => rows.every((r) => r[k] === null || r[k] === '' || (!isNaN(Number(r[k])) && !/(phone|sku|receipt|_no$|_id$)/i.test(k) && !/(_date|_at|^month$|^date$)/.test(k)));
  const right = keys.map((k) => k !== 'branch_id' && isNum(k));
  $('rHead').innerHTML = `<tr>${head.map((h, i) => `<th class="${right[i] ? 'text-end' : ''}">${esc(h)}</th>`).join('')}</tr>`;
  $('rBody').innerHTML = rows.map((r) => `<tr>${keys.map((k, i) => `<td class="${right[i] ? 'text-end mono' : ''}">${esc(k === 'branch_id' ? shopName(r[k]) : fmtCell(k, r[k]))}</td>`).join('')}</tr>`).join('');
  const sums = keys.map((k, i) => (right[i] && SUMMABLE.test(k) && !NOT_SUM.test(k) ? rows.reduce((a, r) => a + num(r[k]), 0) : null));
  $('rFoot').innerHTML = sums.some((s) => s !== null) && rows.length > 1
    ? `<tr>${keys.map((k, i) => `<td class="${right[i] ? 'text-end mono' : ''}">${i === 0 ? 'Total' : sums[i] !== null ? esc(fmtCell(k, sums[i])) : ''}</td>`).join('')}</tr>` : '';
  $('rInfo').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;
}
function cards(obj) {
  const keys = Object.keys(obj);
  $('rKpis').style.display = ''; $('rKpis').innerHTML = `<div class="row g-3">${keys.map((k) => `<div class="col-6 col-lg-4"><div class="kpi"><div class="kpi-in"><span class="label-mono">${esc(labelize(k))}</span><div class="v">${esc(fmtCell(k, obj[k]))}</div></div></div></div>`).join('')}</div>`;
}
$('rRun').onclick = async () => {
  pageNotice(''); $('rKpis').style.display = 'none'; $('rHead').innerHTML = ''; $('rFoot').innerHTML = '';
  $('rBody').innerHTML = '<tr><td class="text-center text-muted py-4">Loading report</td></tr>'; $('rInfo').textContent = '';
  const btn = $('rRun'); btn.disabled = true;
  try {
    const r = (await api(`/reports/${$('rName').value}` + qs(params()))).data;
    state.ran = true;
    if (Array.isArray(r)) { if (!r.length) { $('rBody').innerHTML = '<tr><td class="empty">Nothing to show for this report and period.</td></tr>'; $('rInfo').textContent = '0 rows'; } else table(r); }
    else if (r) { cards(r); $('rBody').innerHTML = ''; $('rInfo').textContent = ''; }
    else $('rBody').innerHTML = '<tr><td class="empty">Nothing to show for this report and period.</td></tr>';
  } catch (e) { pageNotice(e.message); $('rBody').innerHTML = '<tr><td class="empty">Could not load this report</td></tr>'; }
  finally { btn.disabled = false; }
};
async function exportAs(format, btn) {
  btn.disabled = true;
  try { await downloadFile(`/reports/${$('rName').value}/export` + qs({ ...params(), format }), `${$('rName').value}.${format}`); }
  catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
}
$('rXlsx').onclick = (e) => exportAs('xlsx', e.currentTarget); $('rPdf').onclick = (e) => exportAs('pdf', e.currentTarget);

// M-Pesa payments the system could not match cleanly
async function loadReview() {
  try {
    const r = await api('/mpesa/review' + qs({ branch_id: state.branchId })), rows = r.data || r || [];
    if (!Array.isArray(rows) || !rows.length) { $('reviewPanel').classList.add('d-none'); return; }
    $('reviewPanel').classList.remove('d-none'); $('reviewCount').textContent = rows.length;
    $('reviewBody').innerHTML = rows.map((x) => `<tr><td>${when(x.created_at)}</td><td class="mono">${esc(x.phone_number || '-')}</td><td class="text-end mono">${KES(x.amount)}</td><td class="mono">${esc(x.mpesa_receipt_number || '-')}</td><td class="small" style="white-space:normal;min-width:220px">${esc(x.result_desc || '')}</td></tr>`).join('');
  } catch { $('reviewPanel').classList.add('d-none'); }
}

(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch { /* sidebar still works */ }
  renderShell({ active: 'reports', branches: state.branches, branchId: state.branchId, onBranch: (v) => { state.branchId = v; loadReview(); if (state.ran) $('rRun').click(); if (window.loadCharts) loadCharts(); } });
  syncControls(); loadReview(); if (window.loadCharts) loadCharts();
})();
