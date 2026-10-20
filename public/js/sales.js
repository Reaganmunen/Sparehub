const $ = (id) => document.getElementById(id);
const me = requireLogin();
const isOwner = me.role === 'owner', isCashier = me.role === 'cashier';
const state = { page: 1, limit: 20, total: 0, branchId: isOwner ? '' : String(me.branch_id || ''), branches: [], sale: null };
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.set(k, v)); const s = p.toString(); return s ? '?' + s : ''; };
const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const when = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const STATUS = { paid: ['Paid', ''], partial: ['Part paid', 'part'], unpaid: ['Unpaid', 'due'] };
const COLS = isCashier ? 6 : 7;
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast-x' + (err ? ' err' : ''); t.textContent = msg; $('toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3000); }
const showErr = (msg) => { $('smErr').textContent = msg || ''; $('smErr').classList.toggle('d-none', !msg); };

// Cashiers only ever see their own sales and no cashier column; the column is removed, not hidden.
if (isCashier) { document.querySelectorAll('[data-staff]').forEach((el) => el.remove()); $('title').textContent = 'My sales'; }

// ---------- list ----------
async function load() {
  $('tbody').innerHTML = `<tr><td colspan="${COLS}" class="text-center text-muted py-4">Loading sales</td></tr>`;
  try {
    const r = await api('/sales' + qs({ branch_id: state.branchId, mine: isCashier ? 'true' : '', q: $('fSearch').value.trim(), payment_status: $('fPay').value,
      status: $('fStatus').value, from: $('fFrom').value, to: $('fTo').value, page: state.page, limit: state.limit }));
    state.total = Number(r.total || 0); $('notice').innerHTML = ''; render(r.data || []);
  } catch (e) {
    $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`;
    $('tbody').innerHTML = `<tr><td colspan="${COLS}" class="empty">Could not load sales</td></tr>`;
  }
}
function render(rows) {
  $('tbody').innerHTML = rows.length ? rows.map((s) => {
    const voided = s.status === 'voided', [t, c] = STATUS[s.payment_status] || [s.payment_status, 'part'];
    return `<tr class="${voided ? 'off' : ''}"><td><span class="mono">${esc(s.receipt_no)}</span><div class="small text-muted">${when(s.sold_at)}</div></td>
      <td>${esc(s.customer_name || 'Walk-in')}</td><td>${esc(s.branch_name)}</td>${isCashier ? '' : `<td>${esc(s.cashier_name)}</td>`}
      <td class="text-end mono fw-semibold">${KES(num(s.total) - num(s.returned_total))}</td>
      <td>${voided ? '<span class="st due">Voided</span>' : `<span class="st ${c}">${esc(t)}</span>`}${!voided && num(s.balance_due) > 0.004 ? `<div class="small text-danger mono">owes ${KES(s.balance_due)}</div>` : ''}</td>
      <td class="text-end text-nowrap"><button class="ibtn" data-open="${s.id}" title="Open and share receipt" aria-label="Open receipt ${esc(s.receipt_no)}"><i class="bi bi-receipt"></i></button></td></tr>`;
  }).join('') : `<tr><td colspan="${COLS}" class="empty">No sales found.</td></tr>`;
  const from = state.total ? (state.page - 1) * state.limit + 1 : 0, to = Math.min(state.page * state.limit, state.total);
  $('pageInfo').textContent = `${from}-${to} of ${state.total}`; $('totalLabel').textContent = state.total ? `(${state.total})` : '';
  $('prevBtn').disabled = state.page <= 1; $('nextBtn').disabled = to >= state.total;
}
$('tbody').onclick = (e) => { const b = e.target.closest('[data-open]'); if (b) openSale(b.dataset.open); };
$('prevBtn').onclick = () => { state.page--; load(); }; $('nextBtn').onclick = () => { state.page++; load(); };
let t; $('fSearch').oninput = () => { clearTimeout(t); t = setTimeout(() => { state.page = 1; load(); }, 350); };
['fPay', 'fStatus', 'fFrom', 'fTo'].forEach((id) => ($(id).onchange = () => { state.page = 1; load(); }));

// ---------- one sale ----------
async function openSale(id) {
  try {
    const s = (await api('/sales/' + id)).data; state.sale = s; showErr('');
    const live = s.payments.filter((p) => !p.voided_at), due = num(s.balance_due), voided = s.status === 'voided';
    $('smTitle').textContent = `Receipt ${s.receipt_no}`;
    $('smBody').innerHTML = `<div class="d-flex justify-content-between small text-muted mb-2"><span>${when(s.sold_at)} · ${esc(s.branch_name)}</span><span>${esc(s.cashier_name)}</span></div>
      <div class="mb-2"><b>${esc(s.customer_name || 'Walk-in customer')}</b>${s.customer_phone ? ` <span class="text-muted small mono">${esc(s.customer_phone)}</span>` : ''}${voided ? ' <span class="st due ms-2">Voided</span>' : ''}</div>
      ${s.items.map((it) => `<div class="d-flex justify-content-between border-top py-2 gap-2"><span>${esc(it.description)}<div class="small text-muted mono">${num(it.quantity)} x ${KES(it.unit_price)}${num(it.returned_quantity) ? ` · ${num(it.returned_quantity)} returned` : ''}</div></span><span class="mono">${KES(it.line_total)}</span></div>`).join('')}
      <div class="sum mt-2"><div class="d-flex justify-content-between"><span class="label-mono">Total</span><span class="mono fw-semibold">${KES(num(s.total) - num(s.returned_total))}</span></div>
      ${live.map((p) => `<div class="d-flex justify-content-between small"><span>${p.direction === 'out' ? 'Refunded' : 'Paid'} · ${esc(p.method.replace('_', ' '))}${p.reference ? ' · <span class="mono">' + esc(p.reference) + '</span>' : ''}</span><span class="mono">${KES(p.amount)}</span></div>`).join('')}
      ${!voided && due > 0.004 ? `<div class="d-flex justify-content-between text-danger"><span class="label-mono text-danger">Balance due</span><span class="mono fw-semibold">${KES(due)}</span></div>` : ''}</div>
      ${s.notes ? `<div class="small text-muted mt-2">Note: ${esc(s.notes)}</div>` : ''}`;
    const canPay = !voided && s.status === 'completed' && due > 0.004;
    $('bPay').classList.toggle('d-none', !canPay); $('bVoid').classList.toggle('d-none', voided);
    $('payBox').classList.add('d-none'); $('voidBox').classList.add('d-none');
    $('apAmount').value = canPay ? due : ''; $('apRef').value = ''; $('vReason').value = ''; $('vRef').value = '';
    $('vRefundRow').classList.toggle('d-none', !(num(s.amount_paid) > 0));
    modal('saleModal').show();
  } catch (e) { toast(e.message, true); }
}

// ---------- receipt: PDF, print, WhatsApp ----------
const busy = (btn, on) => { btn.disabled = on; };
async function withReceipt(btn, fn) {
  busy(btn, true); showErr('');
  try { await fn((await Receipt.load(state.sale.id)).receipt); } catch (e) { showErr(e.message); } finally { busy(btn, false); }
}
$('bPdf').onclick = (e) => withReceipt(e.currentTarget, (r) => Receipt.download(r));
$('bPrint').onclick = (e) => withReceipt(e.currentTarget, (r) => Receipt.print(r));
$('bWa').onclick = () => { $('waPhone').value = (state.sale && state.sale.customer_phone) || ''; $('waErr').classList.add('d-none'); modal('waModal').show(); };
$('waGo').onclick = async () => {
  const btn = $('waGo'), err = $('waErr'); err.classList.add('d-none'); busy(btn, true);
  try {
    const res = await Receipt.share(state.sale.id, $('waPhone').value.trim());
    modal('waModal').hide();
    if (res === 'whatsapp') toast('PDF downloaded. Attach it in the WhatsApp chat that just opened.');
  } catch (e) { err.textContent = e.message; err.classList.remove('d-none'); } finally { busy(btn, false); }
};

// ---------- receive payment on credit ----------
$('bPay').onclick = () => { $('payBox').classList.toggle('d-none'); $('voidBox').classList.add('d-none'); };
$('apMethod').onchange = () => { $('apRef').classList.toggle('d-none', $('apMethod').value === 'cash'); };
$('apGo').onclick = async () => {
  const btn = $('apGo'), m = $('apMethod').value, ref = $('apRef').value.trim(), amt = num($('apAmount').value);
  if (!(amt > 0)) return showErr('Enter an amount above zero.');
  if (m === 'mpesa' && !ref) return showErr('Enter the M-Pesa transaction code.');
  busy(btn, true); showErr('');
  try {
    await api(`/sales/${state.sale.id}/payments`, { method: 'POST', body: { method: m, amount: amt, reference: ref || undefined } });
    toast('Payment saved'); await openSale(state.sale.id); load();
  } catch (e) { showErr(e.message); } finally { busy(btn, false); }
};

// ---------- void ----------
function askApproval() {
  return new Promise((resolve) => {
    const m = modal('apprModal'); let done = false; $('apprErr').classList.add('d-none'); $('apprPass').value = '';
    const finish = (v) => { if (done) return; done = true; $('apprOk').onclick = null; $('apprModal').removeEventListener('hidden.bs.modal', onHide); resolve(v); };
    const onHide = () => finish(null); $('apprModal').addEventListener('hidden.bs.modal', onHide);
    $('apprOk').onclick = () => {
      const u = $('apprUser').value.trim(), p = $('apprPass').value;
      if (!u || !p) { $('apprErr').textContent = 'Enter the manager username and password.'; return $('apprErr').classList.remove('d-none'); }
      finish({ username: u, password: p }); m.hide();
    };
    m.show(); setTimeout(() => $('apprUser').focus(), 300);
  });
}
$('bVoid').onclick = () => { $('voidBox').classList.toggle('d-none'); $('payBox').classList.add('d-none'); };
$('vGo').onclick = async () => {
  const reason = $('vReason').value.trim(); if (!reason) return showErr('Give a reason for voiding this sale.');
  if (!confirm('Void this sale? Stock is returned and this cannot be undone.')) return;
  const btn = $('vGo'); busy(btn, true); showErr('');
  const body = { reason };
  if (num(state.sale.amount_paid) > 0) { body.refund_method = $('vMethod').value; if ($('vRef').value.trim()) body.refund_reference = $('vRef').value.trim(); }
  try {
    if (isCashier) { const a = await askApproval(); if (!a) return; body.approval = a; }
    await api(`/sales/${state.sale.id}/void`, { method: 'POST', body });
    toast('Sale voided'); await openSale(state.sale.id); load();
  } catch (e) { showErr(e.message); } finally { busy(btn, false); }
};

// ---------- start ----------
(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch { /* sidebar still works */ }
  renderShell({ active: 'sales', branches: state.branches, branchId: state.branchId, onBranch: (v) => { state.branchId = v; state.page = 1; load(); } });
  load();
})();