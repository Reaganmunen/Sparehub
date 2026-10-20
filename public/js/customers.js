const $ = (id) => document.getElementById(id);
const me = requireLogin();
const isOwner = me.role === 'owner', isCashier = me.role === 'cashier', staff = !isCashier;
const state = { page: 1, limit: 25, total: 0, rows: [], branches: [], branchId: isOwner ? '' : String(me.branch_id || ''), editing: null, payFor: null, stmt: null, voidId: null };
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.set(k, v)); const s = p.toString(); return s ? '?' + s : ''; };
const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
const today = () => new Date().toISOString().slice(0, 10);
const showErr = (id, msg) => { const e = $(id); e.textContent = msg || ''; e.classList.toggle('d-none', !msg); };
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast-x' + (err ? ' err' : ''); t.textContent = msg; $('toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3000); }

// Cashiers can find, add and take payments from customers. Credit limits, statements, editing and totals are removed from their page.
if (isCashier) document.querySelectorAll('[data-staff]').forEach((el) => el.remove());
const COLS = isCashier ? 5 : 6;
const waLink = (c) => {
  if (!c.phone) return '';
  let p = String(c.phone).replace(/\D/g, ''); if (p.startsWith('0')) p = '254' + p.slice(1);
  const msg = `Hello ${c.name}, a friendly reminder: your balance with us is ${KES(c.balance_due)}${c.oldest_due_date ? ' (due ' + day(c.oldest_due_date) + ')' : ''}. Thank you.`;
  return `https://wa.me/${p}?text=${encodeURIComponent(msg)}`;
};

// ---------- list ----------
async function load() {
  $('tbody').innerHTML = `<tr><td colspan="${COLS}" class="text-center text-muted py-4">Loading customers</td></tr>`;
  try {
    const r = await api('/customers' + qs({ q: $('fSearch').value.trim(), only_owing: $('fOwing').checked ? 'true' : '', is_active: isCashier ? 'true' : $('fActive').value, page: state.page, limit: state.limit }));
    state.total = Number(r.total || 0); state.rows = r.data || []; $('notice').innerHTML = ''; render();
  } catch (e) { $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`; $('tbody').innerHTML = `<tr><td colspan="${COLS}" class="empty">Could not load customers</td></tr>`; }
}
function render() {
  $('tbody').innerHTML = state.rows.length ? state.rows.map((c, i) => {
    const owes = num(c.balance_due), late = owes > 0 && c.oldest_due_date && String(c.oldest_due_date).slice(0, 10) < today();
    return `<tr class="${c.is_active === false ? 'off' : ''}"><td><b class="fw-medium">${esc(c.name)}</b>${c.customer_type ? `<span class="sub">${esc(String(c.customer_type).replace(/_/g, ' '))}</span>` : ''}</td>
      <td class="mono">${esc(c.phone || '-')}</td>
      <td class="text-end mono fw-semibold ${owes > 0 ? 'text-danger' : ''}">${owes > 0 ? KES(owes) : '-'}${owes > 0 && num(c.open_sales) ? `<span class="sub">${num(c.open_sales)} open sale${num(c.open_sales) > 1 ? 's' : ''}</span>` : ''}</td>
      ${staff ? `<td class="text-end mono">${num(c.credit_limit) > 0 ? KES(c.credit_limit) : '<span class="text-muted">No credit</span>'}</td>` : ''}
      <td>${owes > 0 ? `<span class="st ${late ? 'due' : 'part'}">${late ? 'Overdue · ' : ''}${day(c.oldest_due_date)}</span>` : '-'}</td>
      <td class="text-end text-nowrap">
        ${owes > 0 ? `<button class="ibtn" data-act="pay" data-i="${i}" title="Receive payment" aria-label="Receive payment from ${esc(c.name)}"><i class="bi bi-cash-coin"></i></button>` : ''}
        ${owes > 0 && c.phone ? `<a class="ibtn d-inline-grid" style="place-items:center" href="${waLink(c)}" target="_blank" rel="noopener" title="Remind on WhatsApp" aria-label="Remind ${esc(c.name)} on WhatsApp"><i class="bi bi-whatsapp"></i></a>` : ''}
        ${staff ? `<button class="ibtn" data-act="stmt" data-i="${i}" title="Statement" aria-label="Statement for ${esc(c.name)}"><i class="bi bi-journal-text"></i></button>
        <button class="ibtn" data-act="edit" data-i="${i}" title="Edit" aria-label="Edit ${esc(c.name)}"><i class="bi bi-pencil"></i></button>` : ''}</td></tr>`;
  }).join('') : `<tr><td colspan="${COLS}" class="empty">${$('fOwing').checked ? 'Nobody owes anything.' : 'No customers found. Use <b>Add customer</b>.'}</td></tr>`;
  const from = state.total ? (state.page - 1) * state.limit + 1 : 0, to = Math.min(state.page * state.limit, state.total);
  $('pageInfo').textContent = `${from}-${to} of ${state.total}`; $('total').textContent = state.total ? `(${state.total})` : '';
  $('prevBtn').disabled = state.page <= 1; $('nextBtn').disabled = to >= state.total;
}
$('prevBtn').onclick = () => { state.page--; load(); }; $('nextBtn').onclick = () => { state.page++; load(); };
let t; $('fSearch').oninput = () => { clearTimeout(t); t = setTimeout(() => { state.page = 1; load(); }, 350); };
$('fOwing').onchange = () => { state.page = 1; load(); };
if (staff) $('fActive').onchange = () => { state.page = 1; load(); };
$('tbody').onclick = (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return; const c = state.rows[+b.dataset.i];
  if (b.dataset.act === 'pay') openPay(c); else if (b.dataset.act === 'stmt') openStatement(c.id); else openEdit(c);
};

// ---------- owing summary (managers and owner) ----------
async function loadKpis() {
  if (!staff) return;
  try {
    const r = await api('/customers' + qs({ only_owing: 'true', is_active: 'true', limit: 100 })), rows = r.data || [];
    const sum = rows.reduce((a, c) => a + num(c.balance_due), 0), late = rows.filter((c) => c.oldest_due_date && String(c.oldest_due_date).slice(0, 10) < today());
    const lateSum = late.reduce((a, c) => a + num(c.balance_due), 0), more = Number(r.total || 0) > rows.length ? '+' : '';
    $('kpis').innerHTML = [['Total owed to you', KES(sum) + more, `${Number(r.total || 0)} customers owe`], ['Overdue', KES(lateSum) + more, `${late.length} customers past their due date`]]
      .map(([l, v, f]) => `<div class="col-6"><div class="kpi"><div class="kpi-in"><span class="label-mono">${l}</span><div class="v">${v}</div></div><div class="kpi-f"><span>${f}</span></div></div></div>`).join('');
  } catch { $('kpis').innerHTML = ''; }
}

// ---------- add / edit ----------
function openAdd() {
  state.editing = null; showErr('cErr', ''); $('cTitle').textContent = 'Add customer';
  ['cName', 'cPhone', 'cEmail', 'cLimit', 'cPin', 'cAddr', 'cNotes'].forEach((i) => { const el = $(i); if (el) el.value = ''; });
  $('cLimitBox').classList.toggle('d-none', isCashier); // only managers and the owner can give credit
  $('cActiveBox').classList.add('d-none'); modal('cModal').show();
}
function openEdit(c) {
  state.editing = c; showErr('cErr', ''); $('cTitle').textContent = 'Edit customer';
  $('cName').value = c.name || ''; $('cPhone').value = c.phone || ''; $('cEmail').value = c.email || ''; $('cLimit').value = c.credit_limit ?? '';
  $('cLimit').disabled = !isOwner; $('cLimitBox').classList.remove('d-none'); // credit limit: owner only
  $('cActiveBox').classList.remove('d-none'); $('cActive').checked = c.is_active !== false;
  // the list does not carry these, so load them
  $('cPin').value = ''; $('cAddr').value = ''; $('cNotes').value = '';
  api('/customers/' + c.id).then((r) => { $('cPin').value = r.data.kra_pin || ''; $('cAddr').value = r.data.address || ''; $('cNotes').value = r.data.notes || ''; }).catch(() => {});
  modal('cModal').show();
}
$('addBtn').onclick = openAdd;
$('cSave').onclick = async () => {
  const name = $('cName').value.trim(); if (!name) return showErr('cErr', 'Enter the customer name.');
  const body = { name, phone: $('cPhone').value.trim(), email: $('cEmail').value.trim() };
  if (staff) Object.assign(body, { kra_pin: $('cPin').value.trim(), address: $('cAddr').value.trim(), notes: $('cNotes').value.trim() });
  const limit = $('cLimit').value;
  if (!isCashier && (!state.editing || isOwner) && limit !== '') body.credit_limit = num(limit);
  if (state.editing) body.is_active = $('cActive').checked;
  const btn = $('cSave'); btn.disabled = true; showErr('cErr', '');
  try {
    await api(state.editing ? '/customers/' + state.editing.id : '/customers', { method: state.editing ? 'PUT' : 'POST', body });
    modal('cModal').hide(); toast(state.editing ? 'Customer updated' : 'Customer added'); load(); loadKpis();
  } catch (e) { showErr('cErr', e.message); } finally { btn.disabled = false; }
};

// ---------- receive a payment ----------
function openPay(c) {
  state.payFor = c; showErr('pErr', ''); $('pName').textContent = c.name; $('pOwes').textContent = KES(c.balance_due);
  $('pMethod').value = 'cash'; $('pAmount').value = num(c.balance_due); $('pRef').value = ''; $('pNotes').value = ''; syncPay();
  $('pShopBox').classList.toggle('d-none', !isOwner);
  if (isOwner) $('pShop').innerHTML = state.branches.map((b) => `<option value="${b.id}" ${String(b.id) === state.branchId ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  modal('pModal').show();
}
function syncPay() { const m = $('pMethod').value; $('pRefBox').classList.toggle('d-none', m === 'cash'); $('pRefLabel').textContent = m === 'mpesa' ? 'M-Pesa transaction code' : 'Reference'; }
$('pMethod').onchange = syncPay;
$('pGo').onclick = async () => {
  const c = state.payFor, m = $('pMethod').value, amt = num($('pAmount').value), ref = $('pRef').value.trim();
  if (!(amt > 0)) return showErr('pErr', 'Enter an amount above zero.');
  if (m === 'mpesa' && !ref) return showErr('pErr', 'Enter the M-Pesa transaction code.');
  const btn = $('pGo'); btn.disabled = true; showErr('pErr', '');
  try {
    const r = (await api('/payments/settle-debt', { method: 'POST', body: { customer_id: c.id, amount: amt, method: m, reference: ref || undefined, notes: $('pNotes').value.trim() || undefined, ...(isOwner ? { branch_id: $('pShop').value } : {}) } })).data;
    modal('pModal').hide();
    const left = r.balance ? num(r.balance.balance_due) : null;
    toast(`Payment of ${KES(amt)} saved${left != null ? (left > 0.004 ? `. Still owes ${KES(left)}` : '. Fully paid up') : ''}`);
    load(); loadKpis();
  } catch (e) { showErr('pErr', e.message); } finally { btn.disabled = false; }
};

// ---------- statement ----------
async function openStatement(id) {
  showErr('sErr', ''); $('sVoid').classList.add('d-none'); state.voidId = null;
  $('sSales').innerHTML = '<tr><td colspan="6" class="text-muted">Loading</td></tr>'; $('sPays').innerHTML = ''; modal('sModal').show();
  try {
    const s = (await api('/customers/' + id)).data; state.stmt = s;
    $('sTitle').textContent = s.name;
    $('sHead').innerHTML = `<div><div class="mono">${esc(s.phone || 'No phone')}</div><div class="small text-muted">${esc(s.email || '')}${s.address ? ' · ' + esc(s.address) : ''}</div></div>
      <div class="text-end"><div class="label-mono">Owes</div><div class="big mono ${num(s.balance_due) > 0 ? 'text-danger' : ''}">${KES(s.balance_due)}</div>
      <div class="small text-muted">Limit ${num(s.credit_limit) > 0 ? KES(s.credit_limit) : 'none'}${num(s.balance_due) > 0 && s.oldest_due_date ? ' · oldest due ' + day(s.oldest_due_date) : ''}</div></div>`;
    const ST = { paid: ['Paid', ''], partial: ['Part paid', 'part'], unpaid: ['Unpaid', 'due'] };
    $('sSales').innerHTML = s.sales.length ? s.sales.map((x) => { const [t2, c] = ST[x.payment_status] || [x.payment_status, 'part'];
      return `<tr><td class="mono">${esc(x.receipt_no)}</td><td>${day(x.sold_at)}</td><td class="text-end mono">${KES(num(x.total) - num(x.returned_total))}</td><td class="text-end mono">${KES(x.amount_paid)}</td><td class="text-end mono ${num(x.balance) > 0.004 ? 'text-danger' : ''}">${num(x.balance) > 0.004 ? KES(x.balance) : '-'}</td><td><span class="st ${c}">${t2}</span></td></tr>`; }).join('')
      : '<tr><td colspan="6" class="empty">No purchases yet.</td></tr>';
    $('sPays').innerHTML = s.payments.length ? s.payments.map((p) => `<div class="pline"><span>${day(p.paid_at)} · ${p.direction === 'out' ? 'Refund' : esc(String(p.method).replace('_', ' '))}${p.reference ? ' · <span class="mono">' + esc(p.reference) + '</span>' : ''}</span>
      <span class="d-flex gap-2 align-items-center"><b class="mono">${p.direction === 'out' ? '-' : ''}${KES(p.amount)}</b><button data-void="${p.id}" title="Void this payment" aria-label="Void this payment"><i class="bi bi-x-circle"></i></button></span></div>`).join('')
      : '<div class="small text-muted">No payments yet.</div>';
  } catch (e) { showErr('sErr', e.message); }
}
$('sPays').onclick = (e) => { const b = e.target.closest('[data-void]'); if (!b) return; state.voidId = b.dataset.void; $('svReason').value = ''; $('sVoid').classList.remove('d-none'); $('svReason').focus(); };
$('svGo').onclick = async () => {
  const reason = $('svReason').value.trim(); if (!reason) return showErr('sErr', 'Give a reason for voiding this payment.');
  if (!confirm('Void this payment? The customer will owe it again.')) return;
  const btn = $('svGo'); btn.disabled = true; showErr('sErr', '');
  try { await api(`/payments/${state.voidId}/void`, { method: 'POST', body: { reason } }); toast('Payment voided'); await openStatement(state.stmt.id); load(); loadKpis(); }
  catch (e) { showErr('sErr', e.message); } finally { btn.disabled = false; }
};

// ---------- start ----------
(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch { /* sidebar still works */ }
  if (isOwner && !state.branchId && state.branches[0]) state.branchId = String(state.branches[0].id);
  renderShell({ active: 'customers', branches: state.branches, branchId: state.branchId, allowAll: false, onBranch: (v) => { state.branchId = v; } });
  load(); loadKpis();
})();