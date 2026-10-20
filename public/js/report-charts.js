// Charts view of the Reports page. Needs Chart.js plus the helpers and state from reports.js.
const PAL = ['#141414', '#e5322d', '#ff7a63', '#e9a23b', '#0f9d68', '#4a6fa5', '#78756f', '#8a4fff', '#b8b5ae'];
Chart.defaults.font.family = "'Geist', system-ui, sans-serif"; Chart.defaults.color = '#78756f'; Chart.defaults.borderColor = '#ece9e4';
const charts = {}, cdata = { prof: null, profMode: 'month' };
const kfmt = (n) => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : a >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'k' : String(Math.round(n)); };
const short = (s, n = 24) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const sumBy = (rows, keyFn, valFn) => { const m = new Map(); rows.forEach((r) => m.set(keyFn(r), (m.get(keyFn(r)) || 0) + valFn(r))); return m; };
const firstKey = (row, list) => (row ? list.find((k) => k in row) : undefined);

// ---------- cards ----------
const toggle = '<div class="tabs-x" id="pToggle"><button data-m="month" class="on">Monthly</button><button data-m="year">Yearly</button></div>';
const daysSel = '<select id="deadDays" class="form-select form-select-sm pill-select" style="min-width:130px" aria-label="Days without a sale"><option value="30">30 days</option><option value="60" selected>60 days</option><option value="90">90 days</option><option value="180">180 days</option></select>';
const CARDS = [
  ['line', 'Sales trend', 'col-12', '', 'tall'], ['pay', 'Payments by method', 'col-12 col-xl-4', ''], ['exp', 'Where the money goes (expenses)', 'col-12 col-xl-4', ''], ['shops', 'Sales by shop', 'col-12 col-xl-4', ''],
  ['profit', canCosts ? 'Profit by month / year' : 'Profit', 'col-12', canCosts ? toggle : '', 'tall'],
  ['sellers', 'Best sellers (share of sales)', 'col-12 col-xl-4', ''], ['qty', 'Sales by item (units sold)', 'col-12 col-xl-8', ''],
  ['cash', 'Best cashiers', 'col-12 col-xl-6', ''], ['dead', 'Dead stock (no sales for…)', 'col-12 col-xl-6', daysSel],
];
$('chartGrid').innerHTML = CARDS.map(([id, t, col, extra, h]) => `<div class="${col}" id="card_${id}"><div class="panel"><div class="panel-h"><span class="label-mono">${t}</span>${extra}</div>
  <div class="panel-b"><div class="chart-box ${h || ''}" id="box_${id}"><canvas id="cv_${id}"></canvas></div><div class="empty d-none" id="em_${id}">Nothing to show for this period.</div></div></div></div>`).join('');

function draw(id, cfg, has, msg) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  $('box_' + id).classList.toggle('d-none', !has); $('em_' + id).classList.toggle('d-none', has); if (msg) $('em_' + id).textContent = msg;
  if (has) charts[id] = new Chart($('cv_' + id), cfg);
}
const money = (v) => KES(v);
function donut(labels, values, fulls) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  return { type: 'doughnut', data: { labels: labels.map((l) => short(l)), datasets: [{ data: values, backgroundColor: labels.map((_, i) => PAL[i % PAL.length]), borderWidth: 2, borderColor: '#fff' }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 12 } },
      tooltip: { callbacks: { title: (i) => (fulls || labels)[i[0].dataIndex], label: (c) => ` ${money(c.parsed)} (${Math.round((c.parsed / total) * 100)}%)` } } } } };
}
function hbar(labels, values, fulls, fmt, color, extraTip) {
  return { type: 'bar', data: { labels: labels.map((l) => short(l, 28)), datasets: [{ data: values, backgroundColor: color || '#141414', borderRadius: 6, maxBarThickness: 22 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (i) => (fulls || labels)[i[0].dataIndex], label: (c) => ' ' + fmt(c.parsed.x), afterLabel: (c) => (extraTip ? extraTip(c.dataIndex) : '') } } },
      scales: { x: { ticks: { callback: (v) => kfmt(v) }, grid: { color: '#f0eeea' } }, y: { grid: { display: false } } } } };
}

// ---------- period ----------
function range() {
  const v = $('cPeriod').value, to = new Date(), from = new Date();
  if (v === 'ytd') { from.setMonth(0, 1); } else from.setDate(to.getDate() - (Number(v) - 1));
  return { from: ymd(from), to: ymd(to) };
}
const dayList = (from, to) => { const out = [], d = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00'); while (d <= end && out.length < 400) { out.push(ymd(d)); d.setDate(d.getDate() + 1); } return out; };

// ---------- the individual charts ----------
function kpis(daily, exp) {
  const net = daily.reduce((a, r) => a + num(r.net_sales), 0), tx = daily.reduce((a, r) => a + num(r.transactions), 0), spent = exp.reduce((a, r) => a + num(r.total), 0);
  const gp = daily.reduce((a, r) => a + num(r.gross_profit), 0), hasGp = canCosts && daily.length && 'gross_profit' in daily[0];
  const cards = [['Net sales', KES(net), 'after returns and discounts'], ['Sales made', tx.toLocaleString(), tx ? `average ${KES(net / tx)}` : ''], ['Expenses', KES(spent), 'in this period'],
    hasGp ? ['Estimated profit', KES(gp - spent), `gross ${KES(gp)} less expenses`] : ['Average sale', tx ? KES(net / tx) : '-', '']];
  $('chartKpis').innerHTML = cards.map(([l, v, f]) => `<div class="col-6 col-xl-3"><div class="kpi"><div class="kpi-in"><span class="label-mono">${l}</span><div class="v">${v}</div></div><div class="kpi-f"><span>${f || '&nbsp;'}</span></div></div></div>`).join('');
}
function drawLine(daily, p) {
  const days = dayList(p.from, p.to), ids = [...new Set(daily.map((r) => String(r.branch_id)))], multi = ids.length > 1;
  const per = (bid, key) => { const m = sumBy(daily.filter((r) => bid === null || String(r.branch_id) === bid), (r) => String(r.sale_date).slice(0, 10), (r) => num(r[key])); return days.map((d) => m.get(d) || 0); };
  const sets = [];
  if (multi) ids.forEach((id, i) => sets.push({ label: shopName(id), data: per(id, 'net_sales'), borderColor: PAL[i], backgroundColor: PAL[i], tension: .3, pointRadius: 0, borderWidth: 2 }));
  sets.push({ label: multi ? 'Both shops' : 'Net sales', data: per(null, 'net_sales'), borderColor: multi ? '#b8b5ae' : '#e5322d', backgroundColor: multi ? 'transparent' : 'rgba(229,50,45,.10)', fill: !multi, borderDash: multi ? [5, 4] : [], tension: .3, pointRadius: days.length > 45 ? 0 : 3, borderWidth: 2 });
  if (canCosts && daily.length && 'gross_profit' in daily[0]) sets.push({ label: 'Gross profit', data: per(null, 'gross_profit'), borderColor: '#0f9d68', backgroundColor: '#0f9d68', tension: .3, pointRadius: 0, borderWidth: 2 });
  const labels = days.map((d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  draw('line', { type: 'line', data: { labels, datasets: sets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.parsed.y)}` } } },
    scales: { y: { beginAtZero: true, ticks: { callback: (v) => kfmt(v) }, grid: { color: '#f0eeea' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0 } } } } }, daily.length > 0);
  // shop share (only when both shops are in the data)
  const tot = sumBy(daily, (r) => String(r.branch_id), (r) => num(r.net_sales)), entries = [...tot.entries()].filter(([, v]) => v > 0);
  const show = ids.length > 1; $('card_shops').classList.toggle('d-none', !show);
  ['pay', 'exp'].forEach((k) => ($('card_' + k).className = show ? 'col-12 col-xl-4' : 'col-12 col-xl-6'));
  if (show) draw('shops', donut(entries.map(([k]) => shopName(k)), entries.map(([, v]) => v)), entries.length > 0);
}
function drawPay(rows) {
  const k = firstKey(rows[0], ['amount', 'total', 'total_amount', 'net_amount', 'collected']) || Object.keys(rows[0] || {}).find((x) => /(amount|total)/i.test(x) && !/_id$/.test(x)), mk = firstKey(rows[0], ['method', 'payment_method']);
  if (!rows.length || !k || !mk) return draw('pay', null, false);
  const m = [...sumBy(rows, (r) => labelize(r[mk]), (r) => num(r[k])).entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  draw('pay', donut(m.map((x) => x[0]), m.map((x) => x[1])), m.length > 0);
}
function drawExp(rows) { const r = rows.filter((x) => num(x.total) > 0); draw('exp', donut(r.map((x) => x.category), r.map((x) => num(x.total))), r.length > 0); }
function drawSellers(top) { const r = top.filter((x) => num(x.revenue) > 0); draw('sellers', donut(r.map((x) => x.product_name), r.map((x) => num(x.revenue))), r.length > 0); }
function drawQty(topQ) { draw('qty', hbar(topQ.map((x) => x.product_name), topQ.map((x) => num(x.quantity_sold)), null, (v) => `${Number(v).toLocaleString()} sold`, '#e5322d', (i) => `Sales value: ${KES(topQ[i].revenue)}`), topQ.length > 0); }
function drawCash(rows) {
  const m = new Map(); rows.forEach((r) => { const o = m.get(r.cashier) || { v: 0, n: 0 }; o.v += num(r.net_sales); o.n += num(r.sales_count); m.set(r.cashier, o); });
  const list = [...m.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 8);
  draw('cash', hbar(list.map((x) => x[0]), list.map((x) => x[1].v), null, money, '#141414', (i) => `${list[i][1].n} sales`), list.length > 0);
}
function drawDead(rows) {
  const useVal = rows.length && 'stock_value_at_cost' in rows[0], key = useVal ? 'stock_value_at_cost' : 'quantity';
  const list = [...rows].sort((a, b) => num(b[key]) - num(a[key])).slice(0, 10);
  draw('dead', hbar(list.map((x) => x.product_name), list.map((x) => num(x[key])), null, (v) => (useVal ? money(v) : `${v} in stock`), '#e9a23b', (i) => `${useVal ? num(list[i].quantity) + ' in stock · ' : ''}last sold: ${list[i].last_sold_at ? day(list[i].last_sold_at) : 'never'}`), list.length > 0,
    'No dead stock. Everything has sold recently.');
}
function drawProfit() {
  if (!canCosts) return draw('profit', null, false, 'Profit figures are hidden for your account.');
  const rows = cdata.prof || [];
  if (!rows.length) return draw('profit', null, false, 'No profit data yet.');
  const r0 = rows[0], sk = firstKey(r0, ['net_sales', 'sales', 'total_sales', 'revenue']), gk = firstKey(r0, ['gross_profit']), nk = firstKey(r0, ['net_profit']), ek = firstKey(r0, ['expenses', 'total_expenses', 'expenses_total']);
  const year = cdata.profMode === 'year', keyOf = (r) => String(r.month).slice(0, year ? 4 : 7);
  let keys = [...new Set(rows.map(keyOf))].sort(); if (!year) keys = keys.slice(-12);
  const agg = (k) => { if (!k) return null; const m = sumBy(rows, keyOf, (r) => num(r[k])); return keys.map((x) => m.get(x) || 0); };
  const sales = agg(sk), gross = agg(gk); let net = agg(nk); if (!net && gross && ek) { const e = agg(ek); net = gross.map((g, i) => g - e[i]); }
  const labels = keys.map((k) => (year ? k : new Date(k + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })));
  const sets = [];
  if (sales) sets.push({ type: 'bar', label: 'Net sales', data: sales, backgroundColor: '#e4e2dd', borderRadius: 6, order: 3 });
  if (gross) sets.push({ type: 'bar', label: 'Gross profit', data: gross, backgroundColor: '#141414', borderRadius: 6, order: 2 });
  if (net) sets.push({ type: 'line', label: 'Net profit (after expenses)', data: net, borderColor: '#e5322d', backgroundColor: '#e5322d', tension: .3, borderWidth: 2.5, pointRadius: 4, order: 1 });
  draw('profit', { data: { labels, datasets: sets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.parsed.y)}` } } },
    scales: { y: { ticks: { callback: (v) => kfmt(v) }, grid: { color: '#f0eeea' } }, x: { grid: { display: false } } } } }, sets.length > 0);
}

// ---------- loading ----------
async function getReport(name, extra) { try { return (await api(`/reports/${name}` + qs({ branch_id: state.branchId, ...extra }))).data; } catch { return null; } }
async function loadDead() { drawDead((await getReport('slow-movers', { days: $('deadDays').value, limit: 100 })) || []); }
async function loadCharts() {
  const p = range(), y3 = new Date(); y3.setFullYear(y3.getFullYear() - 3); y3.setMonth(0, 1);
  $('chartGrid').style.opacity = '.55';
  const [daily, top, topQ, pay, exp, cash, prof] = await Promise.all([
    getReport('daily-sales', p), getReport('top-products', { ...p, order_by: 'revenue', limit: 8 }), getReport('top-products', { ...p, order_by: 'quantity', limit: 10 }),
    getReport('payments-by-method', p), getReport('expenses', p), getReport('cashier-performance', p), canCosts ? getReport('monthly-profit', { from: ymd(y3), to: today() }) : null,
  ]);
  loadDead();
  if (daily === null && top === null && pay === null) pageNotice('Could not load the charts. Check your connection and try again.'); else pageNotice('');
  kpis(daily || [], exp || []); drawLine(daily || [], p); drawPay(pay || []); drawExp(exp || []); drawSellers(top || []); drawQty(topQ || []); drawCash(cash || []);
  cdata.prof = prof; drawProfit(); $('chartGrid').style.opacity = '';
}
$('cPeriod').onchange = loadCharts; $('deadDays').onchange = loadDead;
if ($('pToggle')) $('pToggle').onclick = (e) => { const b = e.target.closest('button[data-m]'); if (!b) return; cdata.profMode = b.dataset.m; document.querySelectorAll('#pToggle button').forEach((x) => x.classList.toggle('on', x === b)); drawProfit(); };
$('vTabs').onclick = (e) => {
  const b = e.target.closest('button[data-v]'); if (!b) return; const charts_ = b.dataset.v === 'charts';
  document.querySelectorAll('#vTabs button').forEach((x) => x.classList.toggle('on', x === b));
  $('tabCharts').classList.toggle('d-none', !charts_); $('tabTables').classList.toggle('d-none', charts_); $('cPeriod').classList.toggle('d-none', !charts_);
  if (!charts_ && !state.ran) $('rRun').click();
};
