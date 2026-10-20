const $ = (id) => document.getElementById(id);
const me = requireLogin();
const isOwner = me.role === 'owner', myShop = Number(me.branch_id || 0);
const state = { page: 1, limit: 20, total: 0, rows: [], branches: [], branchId: isOwner ? '' : String(me.branch_id || ''), lines: [], view: null };
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.set(k, v)); const s = p.toString(); return s ? '?' + s : ''; };
const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fq = (n) => String(Number(num(n).toFixed(3)));
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const shopName = (id) => (state.branches.find((b) => b.id === Number(id)) || {}).name || 'Shop ' + id;
const showErr = (id, msg) => { const e = $(id); e.textContent = msg || ''; e.classList.toggle('d-none', !msg); };
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast-x' + (err ? ' err' : ''); t.textContent = msg; $('toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3000); }
const STATUS = { requested: ['Requested', 'part'], dispatched: ['On the way', 'part'], received: ['Received', ''], cancelled: ['Cancelled', 'due'] };

// ---------- list ----------
async function load() {
  $('tbody').innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Loading transfers</td></tr>';
  try {
    const r = await api('/transfers' + qs({ branch_id: state.branchId, status: $('fStatus').value, page: state.page, limit: state.limit }));
    state.total = Number(r.total || 0); state.rows = r.data || []; $('notice').innerHTML = ''; render();
  } catch (e) { $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`; $('tbody').innerHTML = '<tr><td colspan="6" class="empty">Could not load transfers</td></tr>'; }
}
// For a manager: tell them which transfers need THEIR action
const needsMe = (t) => (t.status === 'requested' && (isOwner || t.from_branch_id === myShop)) ? 'Your shop must send' : (t.status === 'dispatched' && (isOwner || t.to_branch_id === myShop)) ? 'Waiting for you to confirm arrival' : '';
function render() {
  $('tbody').innerHTML = state.rows.length ? state.rows.map((t) => {
    const [s, c] = STATUS[t.status] || [t.status, 'part'], n = needsMe(t);
    return `<tr class="${t.status === 'cancelled' ? 'off' : ''}"><td><span class="mono">${esc(t.transfer_no)}</span><div class="small text-muted">${when(t.requested_at)}</div></td>
      <td>${esc(t.from_branch_name)}</td><td>${esc(t.to_branch_name)}</td><td class="text-end mono">${num(t.item_count)}</td>
      <td><span class="st ${c}">${s}</span>${n ? `<span class="sub text-danger">${n}</span>` : ''}</td>
      <td class="text-end"><button class="ibtn" data-open="${t.id}" title="Open" aria-label="Open ${esc(t.transfer_no)}"><i class="bi bi-eye"></i></button></td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">No transfers yet. Use <b>New transfer</b>.</td></tr>';
  const from = state.total ? (state.page - 1) * state.limit + 1 : 0, to = Math.min(state.page * state.limit, state.total);
  $('pageInfo').textContent = `${from}-${to} of ${state.total}`; $('total').textContent = state.total ? `(${state.total})` : '';
  $('prevBtn').disabled = state.page <= 1; $('nextBtn').disabled = to >= state.total;
}
$('prevBtn').onclick = () => { state.page--; load(); }; $('nextBtn').onclick = () => { state.page++; load(); };
$('fStatus').onchange = () => { state.page = 1; load(); };
$('tbody').onclick = (e) => { const b = e.target.closest('[data-open]'); if (b) openView(b.dataset.open); };

// ---------- new transfer ----------
const shopOpts = (sel) => state.branches.map((b) => `<option value="${b.id}" ${String(b.id) === String(sel) ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
function syncShops() {
  // a manager's own shop is always one side of the transfer
  if (isOwner) return;
  const ask = $('dir-ask').checked; // ask = my shop receives
  $('fFrom').disabled = !ask ? true : false; $('fTo').disabled = ask ? true : false;
  if (ask) { $('fTo').value = myShop; if (Number($('fFrom').value) === myShop) { const o = state.branches.find((b) => b.id !== myShop); if (o) $('fFrom').value = o.id; } }
  else { $('fFrom').value = myShop; if (Number($('fTo').value) === myShop) { const o = state.branches.find((b) => b.id !== myShop); if (o) $('fTo').value = o.id; } }
}
function openForm() {
  showErr('fErr', ''); state.lines = []; $('fNotes').value = ''; $('fFind').value = '';
  $('fFrom').innerHTML = shopOpts(''); $('fTo').innerHTML = shopOpts('');
  const other = state.branches.find((b) => b.id !== myShop) || state.branches[1] || state.branches[0];
  $('fFrom').value = other ? other.id : ''; $('fTo').value = isOwner ? (state.branches.find((b) => b.id !== Number($('fFrom').value)) || {}).id : myShop;
  $('fDirBox').classList.toggle('d-none', isOwner); $('dir-ask').checked = true; syncShops(); renderLines(); modal('fModal').show();
}
document.querySelectorAll('[name=dir]').forEach((r) => (r.onchange = () => { syncShops(); state.lines = []; renderLines(); }));
$('fFrom').onchange = () => { state.lines = []; renderLines(); };
$('addBtn').onclick = openForm;

function renderLines() {
  $('fLines').innerHTML = state.lines.length ? state.lines.map((l, i) => `<tr><td><b class="fw-medium">${esc(l.name)}</b><span class="sub">${esc(l.sku || '')}</span></td>
    <td class="text-end mono ${num(l.qty) > num(l.avail) ? 'text-danger' : ''}">${fq(l.avail)}</td>
    <td><input class="form-control form-control-sm mono" data-q="${i}" value="${l.qty}" inputmode="decimal" aria-label="Quantity"></td>
    <td><button class="ibtn" data-rm="${i}" aria-label="Remove ${esc(l.name)}"><i class="bi bi-x-lg"></i></button></td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">Search above to add the products to move.</td></tr>';
}
$('fLines').addEventListener('change', (e) => { if (e.target.dataset.q !== undefined) { state.lines[+e.target.dataset.q].qty = e.target.value; renderLines(); } });
$('fLines').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { state.lines.splice(+b.dataset.rm, 1); renderLines(); } });

let ft; $('fFind').oninput = () => {
  clearTimeout(ft); const q = $('fFind').value.trim(), list = $('fFindList'); if (q.length < 2) return list.classList.add('d-none');
  ft = setTimeout(async () => {
    try {
      const rows = (await api('/products/pos' + qs({ branch_id: $('fFrom').value, q, limit: 8 }))).data || [];
      list._rows = rows;
      list.innerHTML = rows.map((p, i) => `<button data-p="${i}"><span>${esc(p.product_name)} <span class="text-muted mono small">${esc(p.sku || '')}</span></span><span class="mono small">${fq(p.quantity)} ${esc(p.unit || '')}</span></button>`).join('') || '<div class="p-2 small text-muted">Not found at the sending shop.</div>';
      list.classList.remove('d-none');
    } catch (e) { showErr('fErr', e.message); }
  }, 250);
};
$('fFindList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-p]'); if (!b) return; const p = $('fFindList')._rows[+b.dataset.p];
  if (state.lines.some((l) => l.id === p.product_id)) toast(`"${p.product_name}" is already on the list.`, true);
  else state.lines.push({ id: p.product_id, name: p.product_name, sku: p.sku, avail: num(p.quantity), qty: 1 });
  $('fFind').value = ''; $('fFindList').classList.add('d-none'); renderLines();
});
document.addEventListener('click', (e) => { if (!e.target.closest('#fFind') && !e.target.closest('#fFindList')) $('fFindList').classList.add('d-none'); });

$('fSave').onclick = async () => {
  const from = Number($('fFrom').value), to = Number($('fTo').value);
  if (!from || !to || from === to) return showErr('fErr', 'Choose two different shops.');
  if (!state.lines.length) return showErr('fErr', 'Add at least one product.');
  for (const l of state.lines) if (!(num(l.qty) > 0)) return showErr('fErr', `Enter a quantity for "${l.name}".`);
  const btn = $('fSave'); btn.disabled = true; showErr('fErr', '');
  try {
    await api('/transfers', { method: 'POST', body: { from_branch_id: from, to_branch_id: to, notes: $('fNotes').value.trim() || undefined, items: state.lines.map((l) => ({ product_id: l.id, quantity: num(l.qty) })) } });
    modal('fModal').hide(); toast('Transfer created'); load();
  } catch (e) { showErr('fErr', e.message); } finally { btn.disabled = false; }
};

// ---------- view / dispatch / receive / cancel ----------
async function openView(id) {
  showErr('vErr', '');
  try {
    const t = (await api('/transfers/' + id)).data; state.view = t;
    const [s, c] = STATUS[t.status] || [t.status, 'part'];
    const canSend = t.status === 'requested' && (isOwner || myShop === t.from_branch_id), canGet = t.status === 'dispatched' && (isOwner || myShop === t.to_branch_id);
    $('vTitle').textContent = t.transfer_no;
    $('vHead').innerHTML = `<div class="d-flex flex-wrap justify-content-between gap-2 mb-3"><div><b>${esc(t.from_branch_name)}</b> <i class="bi bi-arrow-right mx-1"></i> <b>${esc(t.to_branch_name)}</b></div><span class="st ${c}">${s}</span></div>
      <div class="small text-muted mb-3">Requested ${when(t.requested_at)} by ${esc(t.requested_by_name)}${t.dispatched_at ? ` · sent ${when(t.dispatched_at)}${t.dispatched_by_name ? ' by ' + esc(t.dispatched_by_name) : ''}` : ''}${t.received_at ? ` · received ${when(t.received_at)}${t.received_by_name ? ' by ' + esc(t.received_by_name) : ''}` : ''}</div>`;
    $('vThead').innerHTML = `<tr><th>Product</th><th class="text-end">Requested</th><th class="text-end">Sent</th><th class="text-end">Received</th></tr>`;
    $('vLines').innerHTML = t.items.map((i, k) => {
      const sent = canSend ? `<input class="form-control form-control-sm mono text-end" style="width:90px;margin-left:auto" data-sent="${k}" value="${fq(i.quantity_requested)}" aria-label="Quantity sent">` : (i.quantity_sent != null ? fq(i.quantity_sent) : '-');
      const got = canGet ? `<input class="form-control form-control-sm mono text-end" style="width:90px;margin-left:auto" data-got="${k}" value="${fq(i.quantity_sent != null ? i.quantity_sent : i.quantity_requested)}" aria-label="Quantity received">` : (i.quantity_received != null ? fq(i.quantity_received) : '-');
      const diff = t.status === 'received' && i.quantity_received != null && i.quantity_sent != null && num(i.quantity_received) !== num(i.quantity_sent);
      return `<tr><td>${esc(i.product_name)}<span class="sub">${esc(i.sku || '')}</span></td><td class="text-end mono">${fq(i.quantity_requested)}</td><td class="text-end mono">${sent}</td><td class="text-end mono ${diff ? 'text-danger fw-semibold' : ''}">${got}</td></tr>`;
    }).join('');
    $('vHelp').textContent = canSend ? 'Sending takes the quantities out of your shop now. Change "Sent" if you send less than was asked.'
      : canGet ? 'Count what arrived. Confirming adds these quantities to your shop. Change "Received" if the count is different.'
      : t.status === 'requested' ? `Waiting for ${t.from_branch_name} to send the stock.` : t.status === 'dispatched' ? `On the way. ${t.to_branch_name} must confirm it arrived.` : '';
    $('vNotes').textContent = t.notes ? 'Note: ' + t.notes : '';
    $('vDispatch').classList.toggle('d-none', !canSend); $('vReceive').classList.toggle('d-none', !canGet);
    $('vCancel').classList.toggle('d-none', !['requested', 'dispatched'].includes(t.status));
    modal('vModal').show();
  } catch (e) { toast(e.message, true); }
}
async function act(btn, fn, okMsg) {
  btn.disabled = true; showErr('vErr', '');
  try { await fn(); toast(okMsg); await openView(state.view.id); load(); } catch (e) { showErr('vErr', e.message); } finally { btn.disabled = false; }
}
const readQty = (attr, key) => [...document.querySelectorAll(`[${attr}]`)].map((el) => ({ product_id: state.view.items[+el.getAttribute(attr)].product_id, [key]: num(el.value) }));
$('vDispatch').onclick = (e) => {
  const items = readQty('data-sent', 'quantity_sent');
  if (items.some((i) => i.quantity_sent < 0)) return showErr('vErr', 'Quantities cannot be negative.');
  if (confirm('Send this stock now? It leaves your shop.')) act(e.currentTarget, () => api(`/transfers/${state.view.id}/dispatch`, { method: 'POST', body: { items } }), 'Stock sent');
};
$('vReceive').onclick = (e) => {
  const items = readQty('data-got', 'quantity_received');
  if (items.some((i) => i.quantity_received < 0)) return showErr('vErr', 'Quantities cannot be negative.');
  if (confirm('Confirm this stock arrived? It is added to your shop.')) act(e.currentTarget, () => api(`/transfers/${state.view.id}/receive`, { method: 'POST', body: { items } }), 'Stock received');
};
$('vCancel').onclick = (e) => {
  const sent = state.view.status === 'dispatched';
  if (confirm(sent ? 'Cancel this transfer? The stock already sent goes back to the sending shop.' : 'Cancel this transfer request?')) act(e.currentTarget, () => api(`/transfers/${state.view.id}/cancel`, { method: 'POST', body: {} }), 'Transfer cancelled');
};
$('vPrint').onclick = () => {
  const t = state.view, w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', true);
  w.document.write(`<title>${esc(t.transfer_no)}</title><body style="font-family:sans-serif;max-width:720px;margin:24px auto"><h2>Stock transfer ${esc(t.transfer_no)}</h2>
    <p><b>${esc(t.from_branch_name)}</b> &rarr; <b>${esc(t.to_branch_name)}</b><br>Requested ${when(t.requested_at)} by ${esc(t.requested_by_name)}</p>
    <table border="1" cellspacing="0" cellpadding="6" width="100%" style="border-collapse:collapse"><tr><th align="left">Product</th><th>Requested</th><th>Sent</th><th>Received</th></tr>
    ${t.items.map((i) => `<tr><td>${esc(i.product_name)} <small>${esc(i.sku || '')}</small></td><td align="right">${fq(i.quantity_requested)}</td><td align="right">${i.quantity_sent != null ? fq(i.quantity_sent) : ''}</td><td align="right">${i.quantity_received != null ? fq(i.quantity_received) : ''}</td></tr>`).join('')}</table>
    <br><br><p>Sent by: ____________________ &nbsp;&nbsp; Received by: ____________________</p></body>`);
  w.document.close(); w.focus(); w.print();
};

// ---------- start ----------
(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch (e) { $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`; }
  renderShell({ active: 'transfers', branches: state.branches, branchId: state.branchId, onBranch: (v) => { state.branchId = v; state.page = 1; load(); } });
  load();
})();