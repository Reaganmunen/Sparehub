const $ = (id) => document.getElementById(id);
const me = requireLogin();
const isOwner = me.role === 'owner';
const state = { rows: [], branches: [], branchId: isOwner ? '' : String(me.branch_id || ''), editing: null, payFor: null, stmt: null, voidId: null };
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.set(k, v)); const s = p.toString(); return s ? '?' + s : ''; };
const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
const today = () => new Date().toISOString().slice(0, 10);
const showErr = (id, msg) => { const e = $(id); e.textContent = msg || ''; e.classList.toggle('d-none', !msg); };
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast-x' + (err ? ' err' : ''); t.textContent = msg; $('toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3000); }

// ---------- list ----------
async function load() {
  $('tbody').innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Loading suppliers</td></tr>';
  try {
    state.rows = (await api('/suppliers' + qs({ q: $('fSearch').value.trim(), only_owed: $('fOwed').checked ? 'true' : '' }))).data || [];
    $('notice').innerHTML = ''; render();
  } catch (e) { $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`; $('tbody').innerHTML = '<tr><td colspan="6" class="empty">Could not load suppliers</td></tr>'; }
}
function render() {
  const rows = state.rows, owed = rows.reduce((a, s) => a + num(s.balance_owed), 0), late = rows.filter((s) => num(s.balance_owed) > 0 && s.oldest_due_date && String(s.oldest_due_date).slice(0, 10) < today());
  $('total').textContent = rows.length ? `(${rows.length})` : '';
  $('kpis').innerHTML = [['We owe suppliers', KES(owed), `${rows.filter((s) => num(s.balance_owed) > 0).length} suppliers to pay`], ['Overdue to pay', KES(late.reduce((a, s) => a + num(s.balance_owed), 0)), `${late.length} suppliers past due date`]]
    .map(([l, v, f]) => `<div class="col-6"><div class="kpi"><div class="kpi-in"><span class="label-mono">${l}</span><div class="v">${v}</div></div><div class="kpi-f"><span>${f}</span></div></div></div>`).join('');
  $('tbody').innerHTML = rows.length ? rows.map((s, i) => {
    const owes = num(s.balance_owed), over = owes > 0 && s.oldest_due_date && String(s.oldest_due_date).slice(0, 10) < today();
    return `<tr class="${s.is_active === false ? 'off' : ''}"><td><b class="fw-medium">${esc(s.name)}</b>${s.contact_person ? `<span class="sub">${esc(s.contact_person)}</span>` : ''}</td>
      <td class="mono">${esc(s.phone || '-')}</td><td>${num(s.payment_terms_days) ? num(s.payment_terms_days) + ' days' : 'On delivery'}</td>
      <td class="text-end mono fw-semibold ${owes > 0 ? 'text-danger' : ''}">${owes > 0 ? KES(owes) : '-'}</td>
      <td>${owes > 0 ? `<span class="st ${over ? 'due' : 'part'}">${over ? 'Overdue · ' : ''}${day(s.oldest_due_date)}</span>` : '-'}</td>
      <td class="text-end text-nowrap">${owes > 0 ? `<button class="ibtn" data-act="pay" data-i="${i}" title="Pay supplier" aria-label="Pay ${esc(s.name)}"><i class="bi bi-cash-coin"></i></button>` : ''}
        <button class="ibtn" data-act="stmt" data-i="${i}" title="Statement" aria-label="Statement for ${esc(s.name)}"><i class="bi bi-journal-text"></i></button>
        <button class="ibtn" data-act="edit" data-i="${i}" title="Edit" aria-label="Edit ${esc(s.name)}"><i class="bi bi-pencil"></i></button></td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">No suppliers found. Use <b>Add supplier</b>.</td></tr>';
}
let t; $('fSearch').oninput = () => { clearTimeout(t); t = setTimeout(load, 350); }; $('fOwed').onchange = load;
$('tbody').onclick = (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return; const s = state.rows[+b.dataset.i];
  if (b.dataset.act === 'pay') openPay(s.id, s.name, s.balance_owed); else if (b.dataset.act === 'stmt') openStatement(s.id); else openEdit(s);
};

// ---------- add / edit ----------
const F = { sName: 'name', sContact: 'contact_person', sPhone: 'phone', sEmail: 'email', sPin: 'kra_pin', sAddr: 'address', sNotes: 'notes' };
function openAdd() { state.editing = null; showErr('sErr', ''); $('sTitle').textContent = 'Add supplier'; Object.keys(F).forEach((i) => ($(i).value = '')); $('sTerms').value = ''; $('sActiveBox').classList.add('d-none'); modal('sModal').show(); }
async function openEdit(s) {
  state.editing = s; showErr('sErr', ''); $('sTitle').textContent = 'Edit supplier';
  try { const full = (await api('/suppliers/' + s.id)).data; Object.entries(F).forEach(([i, k]) => ($(i).value = full[k] || '')); $('sTerms').value = full.payment_terms_days ?? ''; $('sActive').checked = full.is_active !== false; }
  catch (e) { return $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`; }
  $('sActiveBox').classList.remove('d-none'); modal('sModal').show();
}
$('addBtn').onclick = openAdd;
$('sSave').onclick = async () => {
  const body = {}; Object.entries(F).forEach(([i, k]) => (body[k] = $(i).value.trim()));
  if (!body.name) return showErr('sErr', 'Enter the supplier name.');
  if ($('sTerms').value !== '') body.payment_terms_days = num($('sTerms').value);
  if (state.editing) body.is_active = $('sActive').checked;
  const btn = $('sSave'); btn.disabled = true; showErr('sErr', '');
  try { await api(state.editing ? '/suppliers/' + state.editing.id : '/suppliers', { method: state.editing ? 'PUT' : 'POST', body }); modal('sModal').hide(); toast(state.editing ? 'Supplier updated' : 'Supplier added'); load(); }
  catch (e) { showErr('sErr', e.message); } finally { btn.disabled = false; }
};

// ---------- pay ----------
async function openPay(id, name, owes) {
  state.payFor = { id, name }; showErr('pErr', ''); $('pName').textContent = name; $('pOwes').textContent = KES(owes);
  $('pMethod').value = 'cash'; $('pAmount').value = num(owes); $('pRef').value = ''; $('pNotes').value = '';
  $('pPurchase').innerHTML = '<option value="">General payment on account</option>';
  $('pShopBox').classList.toggle('d-none', !isOwner);
  if (isOwner) $('pShop').innerHTML = state.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  modal('pModal').show();
  try {
    const s = (await api('/suppliers/' + id)).data;
    s.purchases.filter((p) => p.status === 'received' && num(p.total) - num(p.amount_paid) > 0.004).forEach((p) => {
      $('pPurchase').insertAdjacentHTML('beforeend', `<option value="${p.id}" data-due="${num(p.total) - num(p.amount_paid)}">${esc(p.purchase_no)} · ${day(p.purchase_date)} · owes ${KES(num(p.total) - num(p.amount_paid))}</option>`);
    });
  } catch { /* general payment still works */ }
}
$('pPurchase').onchange = () => { const o = $('pPurchase').selectedOptions[0]; if (o && o.dataset.due) $('pAmount').value = o.dataset.due; };
$('pGo').onclick = async () => {
  const amt = num($('pAmount').value), m = $('pMethod').value; if (!(amt > 0)) return showErr('pErr', 'Enter an amount above zero.');
  const btn = $('pGo'); btn.disabled = true; showErr('pErr', '');
  try {
    await api(`/suppliers/${state.payFor.id}/payments`, { method: 'POST', body: { amount: amt, method: m, purchase_id: $('pPurchase').value || undefined, reference: $('pRef').value.trim() || undefined, notes: $('pNotes').value.trim() || undefined, ...(isOwner ? { branch_id: $('pShop').value } : {}) } });
    modal('pModal').hide(); toast(`Paid ${KES(amt)} to ${state.payFor.name}`); load();
  } catch (e) { showErr('pErr', e.message); } finally { btn.disabled = false; }
};

// ---------- statement ----------
async function openStatement(id) {
  showErr('stErr', ''); $('stVoid').classList.add('d-none'); $('stPurchases').innerHTML = '<tr><td colspan="6" class="text-muted">Loading</td></tr>'; $('stPays').innerHTML = ''; modal('stModal').show();
  try {
    const s = (await api('/suppliers/' + id)).data; state.stmt = s; $('stTitle').textContent = s.name;
    $('stHead').innerHTML = `<div><div class="mono">${esc(s.phone || 'No phone')}</div><div class="small text-muted">${esc(s.contact_person || '')}${s.email ? ' · ' + esc(s.email) : ''}</div></div>
      <div class="text-end"><div class="label-mono">We owe</div><div class="big mono ${num(s.balance_owed) > 0 ? 'text-danger' : ''}">${KES(s.balance_owed)}</div>${num(s.balance_owed) > 0 && s.oldest_due_date ? `<div class="small text-muted">oldest due ${day(s.oldest_due_date)}</div>` : ''}</div>`;
    $('stPurchases').innerHTML = s.purchases.length ? s.purchases.map((p) => `<tr><td class="mono">${esc(p.purchase_no)}</td><td>${day(p.purchase_date)}</td><td><span class="st ${p.status === 'received' ? '' : p.status === 'cancelled' ? 'due' : 'part'}">${esc(p.status)}</span></td>
      <td class="text-end mono">${KES(p.total)}</td><td class="text-end mono">${KES(p.amount_paid)}</td><td class="text-end mono ${p.status === 'received' && num(p.total) - num(p.amount_paid) > 0.004 ? 'text-danger' : ''}">${p.status === 'received' && num(p.total) - num(p.amount_paid) > 0.004 ? KES(num(p.total) - num(p.amount_paid)) : '-'}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No purchases yet.</td></tr>';
    $('stPays').innerHTML = s.payments.length ? s.payments.map((p) => `<div class="pline ${p.voided_at ? 'off' : ''}"><span>${day(p.paid_at)} · ${esc(String(p.method).replace('_', ' '))}${p.reference ? ' · <span class="mono">' + esc(p.reference) + '</span>' : ''}${p.voided_at ? ' · <b class="text-danger">voided</b>' : ''}</span>
      <span class="d-flex gap-2 align-items-center"><b class="mono">${KES(p.amount)}</b>${isOwner && !p.voided_at ? `<button data-void="${p.id}" title="Void this payment" aria-label="Void this payment"><i class="bi bi-x-circle"></i></button>` : ''}</span></div>`).join('')
      : '<div class="small text-muted">No payments yet.</div>';
  } catch (e) { showErr('stErr', e.message); }
}
$('stPays').onclick = (e) => { const b = e.target.closest('[data-void]'); if (!b) return; state.voidId = b.dataset.void; $('svReason').value = ''; $('stVoid').classList.remove('d-none'); $('svReason').focus(); };
$('svGo').onclick = async () => {
  if (!confirm('Void this payment? The supplier balance goes back up.')) return;
  const btn = $('svGo'); btn.disabled = true; showErr('stErr', '');
  try { await api(`/supplier-payments/${state.voidId}/void`, { method: 'POST', body: { reason: $('svReason').value.trim() } }); toast('Payment voided'); await openStatement(state.stmt.id); load(); }
  catch (e) { showErr('stErr', e.message); } finally { btn.disabled = false; }
};

// ---------- start ----------
(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch { /* sidebar still works */ }
  renderShell({ active: 'suppliers', branches: state.branches, branchId: state.branchId, onBranch: () => {} });
  load();
})();