const $ = (id) => document.getElementById(id);
const me = requireLogin();
const isOwner = me.role === 'owner';
const state = { page: 1, limit: 20, total: 0, rows: [], branches: [], suppliers: [], branchId: isOwner ? '' : String(me.branch_id || ''), lines: [], editing: null, view: null };
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.set(k, v)); const s = p.toString(); return s ? '?' + s : ''; };
const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
const ymd = (d) => (d ? String(d).slice(0, 10) : '');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shopName = (id) => (state.branches.find((b) => b.id === Number(id)) || {}).name || 'Shop ' + id;
const showErr = (id, msg) => { const e = $(id); e.textContent = msg || ''; e.classList.toggle('d-none', !msg); };
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast-x' + (err ? ' err' : ''); t.textContent = msg; $('toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3000); }
const STATUS = { draft: ['Draft', 'part'], received: ['Received', ''], cancelled: ['Cancelled', 'due'] };
const PAY = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid' };

// ---------- list ----------
async function load() {
  $('tbody').innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Loading purchases</td></tr>';
  try {
    const r = await api('/purchases' + qs({ branch_id: state.branchId, q: $('fSearch').value.trim(), supplier_id: $('fSupplier').value, status: $('fStatus').value, payment_status: $('fPay').value, from: $('fFrom').value, to: $('fTo').value, page: state.page, limit: state.limit }));
    state.total = Number(r.total || 0); state.rows = r.data || []; $('notice').innerHTML = ''; render();
  } catch (e) { $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`; $('tbody').innerHTML = '<tr><td colspan="7" class="empty">Could not load purchases</td></tr>'; }
}
function render() {
  $('tbody').innerHTML = state.rows.length ? state.rows.map((p) => {
    const [t, c] = STATUS[p.status] || [p.status, 'part'], owing = p.status === 'received' && num(p.balance_due) > 0.004;
    const late = owing && p.due_date && ymd(p.due_date) < today();
    return `<tr class="${p.status === 'cancelled' ? 'off' : ''}"><td><span class="mono">${esc(p.purchase_no)}</span><div class="small text-muted">${day(p.purchase_date)}${p.supplier_invoice_no ? ' · inv ' + esc(p.supplier_invoice_no) : ''}</div></td>
      <td>${esc(p.supplier_name)}</td><td>${esc(shopName(p.branch_id))}</td><td class="text-end mono fw-semibold">${KES(p.total)}</td>
      <td class="text-end mono ${owing ? 'text-danger' : ''}">${owing ? KES(p.balance_due) : '-'}${late ? '<div class="small">overdue</div>' : ''}</td>
      <td><span class="st ${c}">${t}</span>${p.status === 'received' ? `<span class="sub">${PAY[p.payment_status] || ''}</span>` : ''}</td>
      <td class="text-end"><button class="ibtn" data-open="${p.id}" title="Open" aria-label="Open ${esc(p.purchase_no)}"><i class="bi bi-eye"></i></button></td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No purchases found. Use <b>New purchase</b>.</td></tr>';
  const from = state.total ? (state.page - 1) * state.limit + 1 : 0, to = Math.min(state.page * state.limit, state.total);
  $('pageInfo').textContent = `${from}-${to} of ${state.total}`; $('total').textContent = state.total ? `(${state.total})` : '';
  $('prevBtn').disabled = state.page <= 1; $('nextBtn').disabled = to >= state.total;
}
$('prevBtn').onclick = () => { state.page--; load(); }; $('nextBtn').onclick = () => { state.page++; load(); };
let t; $('fSearch').oninput = () => { clearTimeout(t); t = setTimeout(() => { state.page = 1; load(); }, 350); };
['fSupplier', 'fStatus', 'fPay', 'fFrom', 'fTo'].forEach((id) => ($(id).onchange = () => { state.page = 1; load(); }));
$('tbody').onclick = (e) => { const b = e.target.closest('[data-open]'); if (b) openView(b.dataset.open); };

// ---------- new / edit form ----------
const lineTotal = (l) => r2(num(l.qty) * num(l.cost));
function renderLines() {
  $('fLines').innerHTML = state.lines.length ? state.lines.map((l, i) => `<tr><td><b class="fw-medium">${esc(l.name)}</b><span class="sub">${esc(l.sku || '')}</span></td>
    <td><input class="form-control form-control-sm mono" data-q="${i}" value="${l.qty}" inputmode="decimal" aria-label="Quantity"></td>
    <td><input class="form-control form-control-sm mono" data-c="${i}" value="${l.cost}" inputmode="decimal" placeholder="0.00" aria-label="Buying price"></td>
    <td class="text-end mono">${KES(lineTotal(l))}</td><td><button class="ibtn" data-rm="${i}" aria-label="Remove ${esc(l.name)}"><i class="bi bi-x-lg"></i></button></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">Search above to add the products you bought.</td></tr>';
  totals();
}
function totals() {
  const items = r2(state.lines.reduce((a, l) => a + lineTotal(l), 0)), extra = r2(num($('fTransport').value) + num($('fOther').value));
  $('fItems').textContent = KES(items); $('fExtra').textContent = KES(extra); $('fTotal').textContent = KES(items + extra);
}
$('fLines').addEventListener('change', (e) => {
  const d = e.target.dataset;
  if (d.q !== undefined) state.lines[+d.q].qty = e.target.value;
  if (d.c !== undefined) state.lines[+d.c].cost = e.target.value;
  renderLines();
});
$('fLines').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { state.lines.splice(+b.dataset.rm, 1); renderLines(); } });
['fTransport', 'fOther'].forEach((id) => ($(id).oninput = totals));

let ft; $('fFind').oninput = () => {
  clearTimeout(ft); const q = $('fFind').value.trim(), list = $('fFindList'); if (q.length < 2) return list.classList.add('d-none');
  ft = setTimeout(async () => {
    try {
      const rows = (await api('/products' + qs({ q, is_active: 'true', limit: 8 }))).data || [];
      list._rows = rows;
      list.innerHTML = rows.map((p, i) => `<button data-p="${i}"><span>${esc(p.name)} <span class="text-muted mono small">${esc(p.sku)}</span></span><span class="text-muted small">${esc(p.unit || '')}</span></button>`).join('') || '<div class="p-2 small text-muted">No products found. Add it on the Products page first.</div>';
      list.classList.remove('d-none');
    } catch (e) { showErr('fErr', e.message); }
  }, 250);
};
$('fFindList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-p]'); if (!b) return; const p = $('fFindList')._rows[+b.dataset.p];
  const have = state.lines.find((l) => l.id === p.id);
  if (have) toast(`"${p.name}" is already on the list. Change its quantity instead.`, true);
  else state.lines.push({ id: p.id, name: p.name, sku: p.sku, qty: 1, cost: p.buying_price != null ? p.buying_price : '' });
  $('fFind').value = ''; $('fFindList').classList.add('d-none'); renderLines();
});
document.addEventListener('click', (e) => { if (!e.target.closest('#fFind') && !e.target.closest('#fFindList')) $('fFindList').classList.add('d-none'); });

function fillSuppliers(sel, withAll) {
  $(sel).innerHTML = (withAll ? '<option value="">All suppliers</option>' : '<option value="">Choose supplier</option>') + state.suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
}
function openForm(p) {
  state.editing = p || null; showErr('fErr', '');
  $('fTitle').textContent = p ? `Edit draft ${p.purchase_no}` : 'New purchase';
  fillSuppliers('fSup', false);
  $('fShopBox').classList.toggle('d-none', !isOwner || !!p);
  if (isOwner) $('fShop').innerHTML = state.branches.map((b) => `<option value="${b.id}" ${String(b.id) === state.branchId ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  $('fSup').value = p ? p.supplier_id : ''; $('fInv').value = p ? p.supplier_invoice_no || '' : '';
  $('fDate').value = p ? ymd(p.purchase_date) : today(); $('fDue').value = p ? ymd(p.due_date) : '';
  $('fTransport').value = p ? num(p.transport_cost) : 0; $('fOther').value = p ? num(p.other_costs) : 0; $('fNotes').value = p ? p.notes || '' : '';
  state.lines = p ? p.items.map((i) => ({ id: i.product_id, name: i.product_name, sku: i.sku, qty: num(i.quantity), cost: num(i.unit_cost) })) : [];
  $('fReceive').classList.toggle('d-none', !!p); $('fDraft').textContent = p ? 'Save changes' : 'Save as draft';
  renderLines(); modal('fModal').show();
}
$('addBtn').onclick = () => openForm(null);

function formBody() {
  if (!$('fSup').value) throw new Error('Choose the supplier.');
  if (!state.lines.length) throw new Error('Add at least one product.');
  for (const l of state.lines) {
    if (!(num(l.qty) > 0)) throw new Error(`Enter a quantity for "${l.name}".`);
    if (l.cost === '' || num(l.cost) < 0) throw new Error(`Enter the buying price for "${l.name}".`);
  }
  return { supplier_id: Number($('fSup').value), supplier_invoice_no: $('fInv').value.trim() || null, purchase_date: $('fDate').value || undefined, due_date: $('fDue').value || undefined,
    transport_cost: num($('fTransport').value), other_costs: num($('fOther').value), notes: $('fNotes').value.trim() || null,
    items: state.lines.map((l) => ({ product_id: l.id, quantity: num(l.qty), unit_cost: num(l.cost) })) };
}
async function save(receive) {
  showErr('fErr', ''); let body; try { body = formBody(); } catch (e) { return showErr('fErr', e.message); }
  if (receive && !confirm('Receive this stock now? Quantities go into the shop and buying prices update.')) return;
  const btns = [$('fDraft'), $('fReceive')]; btns.forEach((b) => (b.disabled = true));
  try {
    if (state.editing) await api('/purchases/' + state.editing.id, { method: 'PUT', body });
    else await api('/purchases', { method: 'POST', body: { ...body, ...(isOwner ? { branch_id: $('fShop').value } : {}), receive } });
    modal('fModal').hide(); toast(state.editing ? 'Draft updated' : receive ? 'Purchase saved and stock received' : 'Draft saved'); load();
  } catch (e) { showErr('fErr', e.message); } finally { btns.forEach((b) => (b.disabled = false)); }
}
$('fDraft').onclick = () => save(false); $('fReceive').onclick = () => save(true);

// ---------- view one ----------
async function openView(id) {
  showErr('vErr', ''); $('vPayBox').classList.add('d-none');
  try {
    const p = (await api('/purchases/' + id)).data; state.view = p;
    const [st, c] = STATUS[p.status] || [p.status, 'part'], owing = p.status === 'received' && num(p.balance_due) > 0.004, live = (p.payments || []).filter((x) => !x.voided_at);
    $('vTitle').textContent = `${p.purchase_no} · ${p.supplier_name}`;
    $('vBody').innerHTML = `<div class="d-flex flex-wrap justify-content-between gap-2 mb-3"><div><span class="st ${c}">${st}</span><div class="small text-muted mt-1">${day(p.purchase_date)} · ${esc(p.branch_name)}${p.supplier_invoice_no ? ' · invoice ' + esc(p.supplier_invoice_no) : ''}</div>${p.due_date ? `<div class="small text-muted">Pay by ${day(p.due_date)}</div>` : ''}</div>
      <div class="text-end"><div class="label-mono">Total</div><div class="big mono">${KES(p.total)}</div>${owing ? `<div class="text-danger mono small">we owe ${KES(p.balance_due)}</div>` : ''}</div></div>
      <div class="table-responsive"><table class="table table-sm align-middle tx"><thead><tr><th>Product</th><th class="text-end">Qty</th><th class="text-end">Buying price</th><th class="text-end">True cost each</th><th class="text-end">Line total</th></tr></thead><tbody>
      ${p.items.map((i) => `<tr><td>${esc(i.product_name)}<span class="sub">${esc(i.sku || '')}</span></td><td class="text-end mono">${num(i.quantity)}</td><td class="text-end mono">${KES(i.unit_cost)}</td><td class="text-end mono">${i.landed_unit_cost != null ? KES(i.landed_unit_cost) : '-'}</td><td class="text-end mono">${KES(i.line_total)}</td></tr>`).join('')}</tbody></table></div>
      ${num(p.transport_cost) || num(p.other_costs) ? `<div class="small text-muted">Transport ${KES(p.transport_cost)} · other ${KES(p.other_costs)}</div>` : ''}
      ${p.notes ? `<div class="small text-muted mt-1">Note: ${esc(p.notes)}</div>` : ''}
      ${live.length ? `<div class="mt-3"><span class="label-mono">Payments to supplier</span>${live.map((x) => `<div class="pline mt-1"><span>${day(x.paid_at)} · ${esc(String(x.method).replace('_', ' '))}${x.reference ? ' · <span class="mono">' + esc(x.reference) + '</span>' : ''}</span><b class="mono">${KES(x.amount)}</b></div>`).join('')}</div>` : ''}`;
    $('vReceive').classList.toggle('d-none', p.status !== 'draft'); $('vEdit').classList.toggle('d-none', p.status !== 'draft');
    $('vCancel').classList.toggle('d-none', p.status !== 'draft'); $('vPay').classList.toggle('d-none', !owing);
    $('vpAmount').value = owing ? num(p.balance_due) : ''; $('vpRef').value = '';
    $('vpShopBox').classList.toggle('d-none', !isOwner);
    if (isOwner) $('vpShop').innerHTML = state.branches.map((b) => `<option value="${b.id}" ${b.id === p.branch_id ? 'selected' : ''}>Paid from ${esc(b.name)}</option>`).join('');
    modal('vModal').show();
  } catch (e) { toast(e.message, true); }
}
async function act(btn, fn, okMsg) {
  btn.disabled = true; showErr('vErr', '');
  try { await fn(); toast(okMsg); await openView(state.view.id); load(); } catch (e) { showErr('vErr', e.message); } finally { btn.disabled = false; }
}
$('vReceive').onclick = (e) => { if (confirm('Receive this stock now? Quantities go into the shop and buying prices update.')) act(e.currentTarget, () => api(`/purchases/${state.view.id}/receive`, { method: 'POST', body: {} }), 'Stock received'); };
$('vCancel').onclick = (e) => { if (confirm('Cancel this draft purchase?')) act(e.currentTarget, () => api(`/purchases/${state.view.id}/cancel`, { method: 'POST', body: {} }), 'Purchase cancelled'); };
$('vEdit').onclick = () => { modal('vModal').hide(); openForm(state.view); };
$('vPay').onclick = () => $('vPayBox').classList.toggle('d-none');
$('vpGo').onclick = (e) => {
  const amt = num($('vpAmount').value); if (!(amt > 0)) return showErr('vErr', 'Enter an amount above zero.');
  act(e.currentTarget, () => api(`/suppliers/${state.view.supplier_id}/payments`, { method: 'POST', body: { purchase_id: state.view.id, amount: amt, method: $('vpMethod').value, reference: $('vpRef').value.trim() || undefined, ...(isOwner ? { branch_id: $('vpShop').value } : {}) } }), 'Payment saved');
};
$('vPrint').onclick = () => {
  const p = state.view, w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', true);
  w.document.write(`<title>${esc(p.purchase_no)}</title><body style="font-family:sans-serif;max-width:720px;margin:24px auto"><h2>Purchase ${esc(p.purchase_no)}</h2>
    <p>${esc(p.supplier_name)} · ${day(p.purchase_date)} · ${esc(p.branch_name)}${p.supplier_invoice_no ? ' · invoice ' + esc(p.supplier_invoice_no) : ''}</p>
    <table border="1" cellspacing="0" cellpadding="6" width="100%" style="border-collapse:collapse"><tr><th align="left">Product</th><th>Qty</th><th>Buying price</th><th>Total</th></tr>
    ${p.items.map((i) => `<tr><td>${esc(i.product_name)}</td><td align="right">${num(i.quantity)}</td><td align="right">${KES(i.unit_cost)}</td><td align="right">${KES(i.line_total)}</td></tr>`).join('')}</table>
    <h3 align="right">Total ${KES(p.total)}</h3></body>`);
  w.document.close(); w.focus(); w.print();
};

// ---------- start ----------
(async () => {
  try { const [b, s] = await Promise.all([api('/branches'), api('/suppliers')]); state.branches = b.data || []; state.suppliers = (s.data || []).filter((x) => x.is_active !== false); } catch (e) { $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`; }
  fillSuppliers('fSupplier', true);
  renderShell({ active: 'purchases', branches: state.branches, branchId: state.branchId, onBranch: (v) => { state.branchId = v; state.page = 1; load(); } });
  load();
})();