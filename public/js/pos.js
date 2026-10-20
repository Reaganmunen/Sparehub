// Point of sale. Prices, totals and stock rules always come from the server; this page only collects the cart.
const $ = (id) => document.getElementById(id);
const me = requireLogin();
const isCashier = me.role === 'cashier', isOwner = me.role === 'owner';
const state = {
  branchId: isOwner ? localStorage.getItem('spare_pos_branch') || '' : String(me.branch_id || ''),
  branches: [], products: [], cart: [], saleType: 'retail', customer: null, settings: {},
  shift: null, heldId: null, approval: null, sale: null, lines: [], busy: false, stop: false,
};
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.set(k, v)); const s = p.toString(); return s ? '?' + s : ''; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
const shiftRequired = () => isCashier && state.settings.require_open_shift !== false;
const allowNegative = () => state.settings.allow_negative_stock === true;

function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast-x' + (err ? ' err' : ''); t.textContent = msg;
  $('toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3000);
}
function notice(html) { const n = $('notice'); n.classList.toggle('d-none', !html); n.innerHTML = html ? `<div class="alert-x">${html}</div>` : ''; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- cart maths ----------
const listPrice = (l) => (state.saleType === 'wholesale' && l.wholesale != null ? l.wholesale : l.retail);
const priceOf = (l) => (l.custom ? l.price : listPrice(l));
const cartTotal = () => r2(state.cart.reduce((a, l) => a + priceOf(l) * l.qty, 0));

function renderCart() {
  const box = $('lines');
  box.innerHTML = state.cart.length ? state.cart.map((l, i) => `<div class="line">
      <div class="d-flex justify-content-between gap-2"><span class="nm">${esc(l.name)}</span>
        <button class="btn btn-sm p-0 text-muted" data-rm="${i}" aria-label="Remove ${esc(l.name)}"><i class="bi bi-x-lg"></i></button></div>
      <div class="d-flex justify-content-between align-items-center mt-2 gap-2">
        <span class="qtybox"><button data-dec="${i}" aria-label="Less">&minus;</button><input data-qty="${i}" value="${l.qty}" inputmode="decimal" aria-label="Quantity"><button data-inc="${i}" aria-label="More">+</button></span>
        <span class="d-flex align-items-center gap-1"><span class="small text-muted">@</span><input class="form-control form-control-sm pi" data-price="${i}" value="${priceOf(l)}" inputmode="decimal" aria-label="Unit price"></span>
        <span class="mono fw-semibold flex-none">${KES(priceOf(l) * l.qty)}</span></div></div>`).join('')
    : '<div class="empty">Scan or tap a product to start a sale.</div>';
  $('itemCount').textContent = state.cart.reduce((a, l) => a + l.qty, 0);
  $('total').textContent = KES(cartTotal());
  const ready = state.cart.length > 0 && state.branchId;
  $('payBtn').disabled = !ready; $('holdBtn').disabled = !ready; $('clearBtn').disabled = !state.cart.length && !state.heldId;
}
$('lines').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
  if (d.rm !== undefined) state.cart.splice(+d.rm, 1);
  else if (d.inc !== undefined) setQty(+d.inc, state.cart[+d.inc].qty + 1);
  else if (d.dec !== undefined) setQty(+d.dec, state.cart[+d.dec].qty - 1);
  else return;
  renderCart();
});
$('lines').addEventListener('change', (e) => {
  const d = e.target.dataset;
  if (d.qty !== undefined) setQty(+d.qty, num(e.target.value));
  if (d.price !== undefined) { const l = state.cart[+d.price], v = e.target.value.trim(); if (v === '' || num(v) < 0) l.custom = false; else { l.custom = true; l.price = num(v); } }
  renderCart();
});
function setQty(i, q) {
  const l = state.cart[i]; if (!l) return;
  if (!(q > 0)) { state.cart.splice(i, 1); return; }
  if (l.track && !allowNegative() && l.stock != null && q > l.stock) { toast(`Only ${l.stock} of "${l.name}" in stock`, true); q = Math.max(l.stock, 0); if (!q) { state.cart.splice(i, 1); return; } }
  l.qty = q;
}
function addProduct(p) {
  const found = state.cart.find((l) => l.id === p.product_id);
  if (found) setQty(state.cart.indexOf(found), found.qty + 1);
  else {
    if (p.track_stock && !allowNegative() && num(p.quantity) <= 0) return toast(`"${p.product_name}" is out of stock`, true);
    state.cart.push({ id: p.product_id, name: p.product_name, retail: num(p.selling_price), wholesale: p.wholesale_price == null ? null : num(p.wholesale_price),
      qty: 1, track: !!p.track_stock, stock: num(p.quantity), custom: false, price: 0 });
  }
  renderCart();
}

// ---------- products ----------
function renderProducts() {
  $('resultInfo').textContent = state.products.length ? `${state.products.length} shown` : '';
  $('grid').innerHTML = state.products.length ? state.products.map((p, i) => {
    const q = num(p.quantity), out = p.track_stock && q <= 0, cls = out ? 'out' : p.track_stock && q <= 3 ? 'low' : '';
    return `<button class="pcard" data-i="${i}" ${out && !allowNegative() ? 'disabled' : ''}>
      <span class="nm">${esc(p.product_name)}</span><span class="sk">${esc(p.sku || p.part_number || '')}${p.shelf_location ? ' · ' + esc(p.shelf_location) : ''}</span>
      <span class="d-flex justify-content-between align-items-baseline"><span class="pr">${KES(p.selling_price)}</span>
      <span class="qty ${cls}">${p.track_stock ? (out ? 'Out of stock' : q + ' ' + esc(p.unit || '')) : 'In stock'}</span></span></button>`;
  }).join('') : '<div class="empty" style="grid-column:1/-1">No products found.</div>';
}
$('grid').addEventListener('click', (e) => { const b = e.target.closest('.pcard'); if (b) { addProduct(state.products[+b.dataset.i]); $('q').focus(); } });

let searchSeq = 0;
async function loadProducts() {
  if (!state.branchId) { $('grid').innerHTML = '<div class="empty" style="grid-column:1/-1">Choose a shop (top of the sidebar) to start selling.</div>'; return; }
  const seq = ++searchSeq;
  try {
    const r = await api('/products/pos' + qs({ branch_id: state.branchId, q: $('q').value.trim(), category_id: $('cat').value, in_stock: $('inStock').checked ? 'true' : '', limit: 60 }));
    if (seq !== searchSeq) return;
    state.products = r.data || []; renderProducts();
  } catch (e) { $('grid').innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(e.message)}</div>`; }
}
let qt; $('q').oninput = () => { clearTimeout(qt); qt = setTimeout(loadProducts, 250); };
$('cat').onchange = loadProducts; $('inStock').onchange = loadProducts;
$('q').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return; e.preventDefault();
  const code = $('q').value.trim(); if (!code || !state.branchId) return;
  clearTimeout(qt);
  try { addProduct((await api(`/products/pos/scan/${encodeURIComponent(code)}` + qs({ branch_id: state.branchId }))).data); $('q').value = ''; loadProducts(); }
  catch (err) {
    if (err.status !== 404) return toast(err.message, true);
    await loadProducts();
    if (state.products.length === 1) { addProduct(state.products[0]); $('q').value = ''; loadProducts(); } else toast('Pick the item from the list', false);
  }
});

// ---------- sale type + customer ----------
document.querySelectorAll('[name=stype]').forEach((r) => (r.onchange = () => { state.saleType = r.value; renderCart(); }));

function renderCustomer() {
  const c = state.customer;
  $('custChip').classList.toggle('d-none', !c); $('custPick').classList.toggle('d-none', !!c);
  if (c) $('custChip').innerHTML = `<span><i class="bi bi-person-circle me-1"></i><b>${esc(c.name)}</b>${num(c.balance_due) > 0 ? ` <span class="text-danger small">owes ${KES(c.balance_due)}</span>` : ''}</span>
    <button class="btn btn-sm p-0 text-muted" id="custX" aria-label="Remove customer"><i class="bi bi-x-lg"></i></button>`;
  const x = $('custX'); if (x) x.onclick = () => { state.customer = null; renderCustomer(); };
}
let ct; $('custQ').oninput = () => {
  clearTimeout(ct); const q = $('custQ').value.trim(), list = $('custList');
  if (q.length < 2) return list.classList.add('d-none');
  ct = setTimeout(async () => {
    try {
      const rows = (await api('/customers' + qs({ q, limit: 8 }))).data || [];
      list.innerHTML = rows.map((c, i) => `<button data-c="${i}"><span>${esc(c.name)}</span><span class="text-muted small">${esc(c.phone || '')}</span></button>`).join('')
        + `<button data-new="1" class="text-danger"><span><i class="bi bi-plus-lg me-1"></i>New customer</span></button>`;
      list._rows = rows; list.classList.remove('d-none');
    } catch (e) { toast(e.message, true); }
  }, 250);
};
$('custList').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; const list = $('custList');
  if (b.dataset.new) { $('ncName').value = $('custQ').value.trim(); $('ncPhone').value = ''; $('ncErr').classList.add('d-none'); modal('custModal').show(); }
  else { state.customer = list._rows[+b.dataset.c]; renderCustomer(); $('custQ').value = ''; }
  list.classList.add('d-none');
});
document.addEventListener('click', (e) => { if (!e.target.closest('#custPick')) $('custList').classList.add('d-none'); });
$('ncOk').onclick = async () => {
  const err = $('ncErr'); err.classList.add('d-none');
  try {
    const r = await api('/customers', { method: 'POST', body: { name: $('ncName').value.trim(), phone: $('ncPhone').value.trim() } });
    state.customer = r.data; renderCustomer(); $('custQ').value = ''; modal('custModal').hide();
  } catch (e) { err.textContent = e.message; err.classList.remove('d-none'); }
};

// ---------- manager approval (cashiers only) ----------
const APPROVAL_CODES = ['APPROVAL_REQUIRED', 'BELOW_MIN_PRICE', 'DISCOUNT_LIMIT'];
function askApproval(why) {
  return new Promise((resolve) => {
    const m = modal('apprModal'); let done = false;
    $('apprWhy').textContent = why; $('apprErr').classList.add('d-none'); $('apprPass').value = '';
    const finish = (v) => { if (done) return; done = true; $('apprOk').onclick = null; $('apprModal').removeEventListener('hidden.bs.modal', onHide); resolve(v); };
    const onHide = () => finish(null);
    $('apprModal').addEventListener('hidden.bs.modal', onHide);
    $('apprOk').onclick = () => {
      const u = $('apprUser').value.trim(), p = $('apprPass').value;
      if (!u || !p) { $('apprErr').textContent = 'Enter the manager username and password.'; return $('apprErr').classList.remove('d-none'); }
      finish({ username: u, password: p }); m.hide();
    };
    m.show(); setTimeout(() => $('apprUser').focus(), 300);
  });
}

// ---------- saving the cart on the server ----------
const itemsBody = () => state.cart.map((l) => ({ product_id: l.id, quantity: l.qty, ...(l.custom ? { unit_price: l.price } : {}) }));
async function saveHeld() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = { customer_id: state.customer ? state.customer.id : null, sale_type: state.saleType, notes: $('notes').value.trim() || null, items: itemsBody(),
      ...(state.approval ? { approval: state.approval } : {}) };
    try {
      if (state.heldId) { await api('/sales/' + state.heldId, { method: 'PUT', body }); return state.heldId; }
      const r = await api('/sales/hold', { method: 'POST', body: { ...body, branch_id: state.branchId } });
      state.heldId = r.data.id; refreshHeldCount(); return state.heldId;
    } catch (e) {
      if (attempt === 0 && isCashier && APPROVAL_CODES.includes(e.code)) {
        const a = await askApproval(e.message); if (!a) throw Object.assign(new Error('Cancelled'), { quiet: true });
        state.approval = a; continue;
      }
      throw e;
    }
  }
}
async function guarded(fn) { try { return await fn(); } catch (e) { if (!e.quiet) toast(e.message, true); throw e; } }

function resetCart() {
  state.cart = []; state.customer = null; state.heldId = null; state.approval = null; state.sale = null; state.lines = [];
  $('notes').value = ''; renderCustomer(); renderCart();
}
$('clearBtn').onclick = async () => {
  if (state.cart.length && !confirm('Clear this sale?')) return;
  if (state.heldId) await api('/sales/' + state.heldId, { method: 'DELETE' }).catch(() => {});
  resetCart(); refreshHeldCount();
};
$('holdBtn').onclick = () => guarded(async () => {
  await saveHeld(); toast('Sale held. Find it under Held.'); state.heldId = null; resetCart(); refreshHeldCount();
}).catch(() => {});

// ---------- held sales ----------
async function refreshHeldCount() {
  if (!state.branchId) return;
  try { $('heldCount').textContent = ((await api('/sales/held' + qs({ branch_id: state.branchId }))).data || []).length; } catch { /* not critical */ }
}
$('heldBtn').onclick = async () => {
  const body = $('heldBody'); body.innerHTML = '<div class="empty">Loading</div>'; modal('heldModal').show();
  try {
    const rows = (await api('/sales/held' + qs({ branch_id: state.branchId }))).data || [];
    body.innerHTML = rows.length ? rows.map((h) => `<div class="pline" style="padding:10px 12px"><div><b>${esc(h.customer_name || 'Walk-in')}</b>
      <div class="small text-muted">${esc(h.cashier_name || '')} ${h.created_at ? new Date(h.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</div></div>
      <div class="d-flex align-items-center gap-2"><span class="mono">${KES(h.total)}</span>
      <button class="btn btn-sm btn-ink px-3" data-resume="${h.id}">Resume</button><button data-drop="${h.id}" aria-label="Discard"><i class="bi bi-trash3"></i></button></div></div>`).join('')
      : '<div class="empty">No held sales.</div>';
  } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
};
$('heldBody').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.drop) { if (!confirm('Discard this held sale?')) return; await api('/sales/' + b.dataset.drop, { method: 'DELETE' }); b.closest('.pline').remove(); refreshHeldCount(); }
    if (b.dataset.resume) {
      if (state.cart.length && !confirm('Replace the sale on screen?')) return;
      const s = (await api('/sales/' + b.dataset.resume)).data;
      resetCart(); state.heldId = s.id; state.saleType = s.sale_type === 'wholesale' ? 'wholesale' : 'retail';
      document.getElementById('st-' + state.saleType).checked = true;
      state.cart = s.items.map((it) => ({ id: it.product_id, name: it.description, retail: num(it.unit_price), wholesale: null, qty: num(it.quantity), track: false, stock: null, custom: true, price: num(it.unit_price) }));
      state.customer = s.customer_id ? { id: s.customer_id, name: s.customer_name, phone: s.customer_phone } : null;
      $('notes').value = s.notes || ''; renderCustomer(); renderCart(); modal('heldModal').hide();
    }
  } catch (err) { toast(err.message, true); }
});

// ---------- shifts (cashiers) ----------
function renderShift() {
  const chip = $('shiftChip');
  if (!isCashier) return chip.classList.add('d-none');
  chip.classList.remove('d-none');
  const s = state.shift;
  chip.innerHTML = s ? `<button class="chip" id="shiftBtn">Shift open since ${new Date(s.opened_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · Close</button>`
    : `<button class="chip off" id="shiftBtn">No open shift · Open</button>`;
  $('shiftBtn').onclick = openShiftModal;
  notice(!s && shiftRequired() ? 'Open your shift before you sell. Use the red button at the top.' : '');
}
async function loadShift() { if (!isCashier) return; try { state.shift = (await api('/shifts/current')).data; } catch { state.shift = null; } renderShift(); }
function openShiftModal() {
  const s = state.shift; $('shiftErr').classList.add('d-none');
  $('shiftTitle').textContent = s ? 'Close your shift' : 'Open your shift';
  $('shiftLabel').textContent = s ? 'Cash you counted in the till' : 'Cash in the till now (opening float)';
  $('shiftInfo').textContent = s ? `Expected cash: ${KES(s.expected_cash ?? 0)}` : '';
  $('shiftNotes').classList.toggle('d-none', !s); $('shiftOk').textContent = s ? 'Close shift' : 'Open shift'; $('shiftCash').value = s ? '' : 0;
  modal('shiftModal').show();
}
$('shiftOk').onclick = async () => {
  const s = state.shift, err = $('shiftErr'); err.classList.add('d-none');
  try {
    if (s) { await api(`/shifts/${s.shift_id || s.id}/close`, { method: 'POST', body: { counted_cash: num($('shiftCash').value), notes: $('shiftNotes').value.trim() } }); state.shift = null; toast('Shift closed'); }
    else { await api('/shifts/open', { method: 'POST', body: { opening_float: num($('shiftCash').value) } }); await loadShift(); toast('Shift opened'); }
    modal('shiftModal').hide(); renderShift();
  } catch (e) { err.textContent = e.message; err.classList.remove('d-none'); }
};

// ---------- payment ----------
const dueOf = (s) => r2(num(s.total) - num(s.returned_total) - num(s.amount_paid));
const METHOD_LABEL = { cash: 'Cash', mpesa_stk: 'M-Pesa prompt', mpesa: 'M-Pesa code', card: 'Card', bank_transfer: 'Bank transfer' };
function payErr(msg) { const e = $('payErr'); e.textContent = msg || ''; e.classList.toggle('d-none', !msg); }

/** Splits what the cashier typed into what is really applied (never more than is due) and any change owed. */
function applied() {
  let left = dueOf(state.sale), change = 0;
  const out = state.lines.map((l) => { const a = Math.min(l.amount, Math.max(left, 0)); left = r2(left - a); if (l.method === 'cash') change += l.amount - a; return { ...l, applied: r2(a) }; });
  return { lines: out.filter((l) => l.applied > 0), left: Math.max(left, 0), change: r2(change) };
}
function renderPay() {
  const a = applied(), due = dueOf(state.sale), paid = r2(due - a.left);
  $('payTotal').textContent = KES(due);
  $('payLines').innerHTML = state.lines.map((l, i) => `<div class="pline"><span>${esc(METHOD_LABEL[l.method])}${l.ref ? ' · <span class="mono">' + esc(l.ref) + '</span>' : ''}</span>
    <span class="d-flex gap-2 align-items-center"><b class="mono">${KES(l.amount)}</b><button data-del="${i}" aria-label="Remove payment"><i class="bi bi-x-lg"></i></button></span></div>`).join('');
  $('paidSum').textContent = KES(paid);
  const credit = a.left > 0.004;
  $('remLabel').textContent = credit ? 'Left to pay' : 'Fully paid'; $('remSum').textContent = KES(a.left);
  $('changeRow').classList.toggle('d-none', !(a.change > 0)); $('changeSum').textContent = KES(a.change);
  const note = $('creditNote'); note.classList.add('d-none');
  let ok = state.lines.length > 0 || false;
  if (credit) {
    if (state.customer) { note.textContent = `${KES(a.left)} will be put on ${state.customer.name}'s credit account.`; note.classList.remove('d-none'); ok = true; }
    else { note.textContent = 'Add the full amount, or pick a customer on the cart to put the balance on credit.'; note.classList.remove('d-none'); ok = false; }
  }
  if (!state.lines.length && credit && state.customer) ok = true; // whole sale on credit
  $('confirmPay').disabled = !ok || state.busy;
  $('pAmount').value = a.left > 0 ? a.left : '';
}
function syncPayForm() {
  const m = $('pMethod').value, row = $('pRefRow');
  row.classList.toggle('d-none', m === 'cash');
  $('pRefLabel').textContent = m === 'mpesa_stk' ? 'Customer M-Pesa phone' : m === 'mpesa' ? 'M-Pesa transaction code' : 'Reference';
  $('pRef').placeholder = m === 'mpesa_stk' ? '07xx xxx xxx' : m === 'mpesa' ? 'e.g. SJK2L9XXXX' : 'Optional';
  if (m === 'mpesa_stk' && !$('pRef').value && state.customer && state.customer.phone) $('pRef').value = state.customer.phone;
}
$('pMethod').onchange = syncPayForm;
$('pAdd').onclick = () => {
  payErr(''); const m = $('pMethod').value, amt = num($('pAmount').value), ref = $('pRef').value.trim();
  if (!(amt > 0)) return payErr('Enter an amount above zero.');
  if (m === 'mpesa' && !ref) return payErr('Enter the M-Pesa transaction code.');
  if (m === 'mpesa_stk') { if (!ref) return payErr("Enter the customer's M-Pesa phone number."); if (state.lines.some((l) => l.method === 'mpesa_stk')) return payErr('Only one M-Pesa prompt per sale.'); }
  if (m !== 'cash' && amt > applied().left + 0.004) return payErr('This is more than is left to pay. Only cash can give change.');
  state.lines.push({ method: m, amount: amt, ref }); $('pRef').value = ''; renderPay();
};
$('payLines').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { state.lines.splice(+b.dataset.del, 1); renderPay(); } });

$('payBtn').onclick = () => {
  if (shiftRequired() && !state.shift) return openShiftModal();
  guarded(async () => {
    $('payBtn').disabled = true;
    try { const id = await saveHeld(); state.sale = (await api('/sales/' + id)).data; } finally { renderCart(); }
    state.lines = []; payErr(''); $('pMethod').value = 'cash'; $('pRef').value = ''; syncPayForm();
    $('payForm').classList.remove('d-none'); $('stkWait').classList.add('d-none'); $('payFoot').classList.remove('d-none');
    renderPay(); modal('payModal').show(); setTimeout(() => $('pAmount').focus(), 300);
  }).catch(() => {});
};

async function finishSale(saleId) {
  const r = (await api(`/sales/${saleId}/receipt` + qs({ phone: state.customer && state.customer.phone }))).data;
  $('rcptText').textContent = r.text || '';
  const wa = $('rcptWa'); wa.classList.toggle('d-none', !r.whatsapp_link); if (r.whatsapp_link) wa.href = r.whatsapp_link;
  modal('payModal').hide(); modal('rcptModal').show();
}
$('rcptDone').onclick = () => { resetCart(); loadProducts(); refreshHeldCount(); $('q').focus(); };
$('rcptPrint').onclick = () => window.print();

$('confirmPay').onclick = async () => {
  payErr(''); state.busy = true; state.stop = false; $('confirmPay').disabled = true; $('payClose').disabled = true;
  const id = state.sale.id, a = applied(), stk = a.lines.find((l) => l.method === 'mpesa_stk');
  try {
    for (const l of a.lines.filter((x) => x.method !== 'mpesa_stk')) {
      await api(`/sales/${id}/payments`, { method: 'POST', body: { method: l.method, amount: l.applied, reference: l.ref || undefined } });
    }
    let sale = (await api('/sales/' + id)).data;
    if (stk) { sale = await runStk(id, stk); if (!sale) return; }
    if (sale.status === 'held') await api(`/sales/${id}/complete`, { method: 'POST', body: {} });
    await finishSale(id);
  } catch (e) { payErr(e.message + (state.sale ? ' The sale is still held, so nothing is lost.' : '')); }
  finally { state.busy = false; $('payClose').disabled = false; if (!$('payForm').classList.contains('d-none')) renderPay(); }
};

/** Sends the M-Pesa prompt, then waits for the customer. Returns the sale when paid, or null if the cashier stopped waiting / it failed. */
async function runStk(id, l) {
  $('payForm').classList.add('d-none'); $('payFoot').classList.add('d-none'); $('stkWait').classList.remove('d-none');
  $('stkMsg').textContent = 'Sending the M-Pesa prompt'; $('stkSub').textContent = '';
  const back = (msg) => { $('stkWait').classList.add('d-none'); $('payForm').classList.remove('d-none'); $('payFoot').classList.remove('d-none'); state.lines = state.lines.filter((x) => x !== l); renderPay(); payErr(msg); return null; };
  try { await api('/mpesa/stk-push', { method: 'POST', body: { sale_id: id, phone: l.ref, amount: l.applied } }); }
  catch (e) { return back(e.message); }
  $('stkMsg').textContent = 'Waiting for the customer to enter their M-Pesa PIN'; $('stkSub').textContent = `Prompt sent to ${l.ref} for ${KES(l.applied)}`;
  $('stkCancel').onclick = () => (state.stop = true);
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    if (state.stop) return back('Stopped waiting. If the customer paid anyway, add the M-Pesa code as a payment.');
    let r; try { r = (await api('/mpesa/sales/' + id)).data; } catch { continue; }
    const tx = (r.transactions || [])[0];
    if (r.sale.status === 'completed' || r.sale.balance_due <= 0.004 || (tx && tx.status === 'success')) return (await api('/sales/' + id)).data;
    if (tx && ['failed', 'cancelled', 'timeout'].includes(tx.status)) return back(`M-Pesa: ${tx.result_desc || tx.status}. Try again or use another method.`);
  }
  return back('No response from the customer. Try again, or add the M-Pesa code if they paid.');
}

// ---------- start ----------
document.addEventListener('keydown', (e) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('q').focus(); } });
(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch { /* sidebar still works */ }
  if (isOwner && !state.branches.some((b) => String(b.id) === state.branchId)) state.branchId = state.branches[0] ? String(state.branches[0].id) : '';
  const shell = () => renderShell({ active: 'pos', branches: state.branches, branchId: state.branchId, allowAll: false, onBranch });
  function onBranch(v) {
    if (state.cart.length && !confirm('Changing shop clears the sale on screen. Continue?')) return shell();
    state.branchId = v; localStorage.setItem('spare_pos_branch', v); state.heldId = null; resetCart(); loadProducts(); refreshHeldCount();
  }
  shell();
  try { const s = (await api('/settings/public')).data || {}; Object.keys(s).forEach((k) => (state.settings[k] = s[k] === true || s[k] === 'true' ? true : s[k] === false || s[k] === 'false' ? false : s[k])); } catch { /* defaults */ }
  try { const c = await api('/categories'); (c.data || []).forEach((x) => $('cat').insertAdjacentHTML('beforeend', `<option value="${x.id}">${esc(x.name)}</option>`)); } catch { /* filter is optional */ }
  renderCart(); renderCustomer(); loadShift(); loadProducts(); refreshHeldCount();
})();
