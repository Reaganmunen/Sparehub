const me = requireLogin(), isOwner = me.role === 'owner', isCashier = me.role === 'cashier';
const state = { branches: [], branchId: isOwner ? '' : String(me.branch_id || ''), sale: null, page: 1, limit: 20, total: 0 };
const PG = { info: 'pageInfo', prev: 'prevBtn', next: 'nextBtn' };
const SETTLE = { refund: 'Money back', credit_note: 'Credit note', exchange: 'Exchange' };
if (isCashier) { $('histPanel').remove(); $('rcApproveBox').classList.remove('d-none'); }

// ---------- find a sale ----------
async function search() {
  const q = $('rcSearch').value.trim(), box = $('rcResults');
  if (q.length < 2) { box.classList.add('d-none'); return; }
  try {
    const rows = (await api('/sales' + qs({ branch_id: state.branchId, mine: isCashier ? 'true' : '', q, status: 'completed', limit: 8 }))).data || [];
    box.classList.remove('d-none');
    box.innerHTML = rows.length ? rows.map((s) => `<button data-id="${s.id}"><span><b class="mono">${esc(s.receipt_no)}</b> · ${esc(s.customer_name || 'Walk-in')}</span><span class="mono text-muted">${day(s.sold_at)} · ${KES(num(s.total) - num(s.returned_total))}</span></button>`).join('')
      : '<div class="empty">No completed sale matches that.</div>';
  } catch (e) { box.classList.remove('d-none'); box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
$('rcSearch').oninput = debounce(search);
$('rcResults').onclick = (e) => { const b = e.target.closest('button[data-id]'); if (b) pick(b.dataset.id); };

async function pick(id) {
  showErr('rcErr', '');
  try {
    const s = (await api('/sales/' + id)).data; state.sale = s;
    $('findBox').classList.add('d-none'); $('rcForm').classList.remove('d-none');
    $('rcReceipt').textContent = 'Receipt ' + s.receipt_no;
    $('rcMeta').textContent = `${day(s.sold_at)} · ${s.customer_name || 'Walk-in customer'} · ${s.branch_name || ''}`;
    $('rcItems').innerHTML = s.items.map((it, i) => {
      const left = num(it.quantity) - num(it.returned_quantity), each = num(it.quantity) ? num(it.line_total) / num(it.quantity) : 0;
      return `<tr><td style="white-space:normal">${esc(it.description)}</td><td class="text-end mono">${KES(each)}</td><td class="text-end mono">${left}</td>
        <td class="text-end">${left > 0 ? `<input type="number" class="cell-input" min="0" max="${left}" step="any" value="0" data-i="${i}" data-max="${left}" data-each="${each}" aria-label="Quantity of ${esc(it.description)} to return">` : '<span class="text-muted small">All returned</span>'}</td></tr>`;
    }).join('');
    ['rcReason', 'rcNotes', 'rcRef', 'rcAUser', 'rcAPass'].forEach((x) => ($(x).value = '')); $('rcSettle').value = 'refund'; $('rcMethod').value = 'cash'; $('rcRestock').checked = true;
    syncSettle(); total();
  } catch (e) { toast(e.message, true); }
}
function total() { let t = 0; document.querySelectorAll('#rcItems input').forEach((i) => { t += num(i.value) * num(i.dataset.each); }); $('rcTotal').textContent = KES(t); return t; }
$('rcItems').oninput = total;
function syncSettle() {
  const refund = $('rcSettle').value === 'refund';
  $('rcMethodBox').classList.toggle('d-none', !refund); $('rcRefBox').classList.toggle('d-none', !(refund && $('rcMethod').value === 'mpesa'));
}
$('rcSettle').onchange = syncSettle; $('rcMethod').onchange = syncSettle;
function reset() { state.sale = null; $('rcForm').classList.add('d-none'); $('findBox').classList.remove('d-none'); $('rcSearch').value = ''; $('rcResults').classList.add('d-none'); showErr('rcErr', ''); }
$('rcChange').onclick = reset;

$('rcGo').onclick = async () => {
  const items = []; let bad = '';
  document.querySelectorAll('#rcItems input').forEach((i) => { const q = num(i.value); if (q < 0 || q > num(i.dataset.max)) bad = 'You cannot bring back more than was sold.'; if (q > 0) items.push({ sale_item_id: state.sale.items[+i.dataset.i].id, quantity: q }); });
  if (bad) return showErr('rcErr', bad);
  if (!items.length) return showErr('rcErr', 'Enter how many of each item are coming back.');
  const reason = $('rcReason').value.trim(); if (!reason) return showErr('rcErr', 'Give a reason for the return.');
  const settlement = $('rcSettle').value, body = { sale_id: state.sale.id, reason, notes: $('rcNotes').value.trim() || undefined, settlement, restock: $('rcRestock').checked, items };
  if (settlement === 'refund') { body.refund_method = $('rcMethod').value; if (body.refund_method === 'mpesa' && $('rcRef').value.trim()) body.refund_reference = $('rcRef').value.trim(); }
  if (isCashier) { const u = $('rcAUser').value.trim(), p = $('rcAPass').value; if (!u || !p) return showErr('rcErr', 'A manager must type their username and password to approve this.'); body.approval = { username: u, password: p }; }
  const btn = $('rcGo'); btn.disabled = true; showErr('rcErr', '');
  try {
    const r = (await api('/returns', { method: 'POST', body })).data;
    toast(`Return ${r.return_no || ''} saved${r.return_total != null ? ' · ' + KES(r.return_total) : ''}`); reset(); if (!isCashier) { state.page = 1; load(); }
  } catch (e) { showErr('rcErr', e.message); } finally { btn.disabled = false; }
};

// ---------- history (managers and owner) ----------
let rows = [];
async function load() {
  if (isCashier) return;
  $('tbody').innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Loading returns</td></tr>';
  try {
    const r = await api('/returns' + qs({ branch_id: state.branchId, from: $('fFrom').value, to: $('fTo').value, page: state.page, limit: state.limit }));
    rows = r.data || []; state.total = Number(r.total || 0); pageNotice('');
    $('tbody').innerHTML = rows.length ? rows.map((x, i) => `<tr><td><span class="mono">${esc(x.return_no)}</span><span class="sub">${when(x.returned_at)}</span></td><td class="mono">${esc(x.receipt_no)}</td>
      <td style="white-space:normal;min-width:160px">${esc(x.reason)}</td><td><span class="flag">${esc(SETTLE[x.settlement] || x.settlement)}</span></td><td class="text-end mono fw-semibold">${KES(x.return_total)}</td><td>${esc(x.processed_by_name || '-')}</td>
      <td class="text-end"><button class="ibtn" data-i="${i}" title="Open" aria-label="Open return ${esc(x.return_no)}"><i class="bi bi-eye"></i></button></td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">No returns yet.</td></tr>';
    $('total').textContent = state.total ? `(${state.total})` : ''; paintPager(PG, state);
  } catch (e) { pageNotice(e.message); $('tbody').innerHTML = '<tr><td colspan="7" class="empty">Could not load returns</td></tr>'; }
}
if (!isCashier) {
  bindPager(PG, state, load); ['fFrom', 'fTo'].forEach((i) => ($(i).onchange = () => { state.page = 1; load(); }));
  $('tbody').onclick = async (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return; const x = rows[+b.dataset.i];
    $('rvModalTitle').textContent = 'Return ' + x.return_no; $('rvBody').innerHTML = '<div class="text-muted">Loading</div>'; showErr('rvModalErr', ''); modal('rvModal').show();
    try {
      const r = (await api('/returns/' + x.id)).data;
      $('rvBody').innerHTML = `<div class="d-flex justify-content-between small text-muted mb-2"><span>${when(r.returned_at)} · Receipt <span class="mono">${esc(r.receipt_no)}</span></span><span>${esc(r.processed_by_name || '')}${r.approved_by_name ? ' · approved by ' + esc(r.approved_by_name) : ''}</span></div>
        <div class="mb-2"><span class="flag">${esc(SETTLE[r.settlement] || r.settlement)}</span>${r.restock === false ? '<span class="flag red">Not restocked</span>' : '<span class="flag">Restocked</span>'}</div>
        <div class="mb-2"><b>Reason:</b> ${esc(r.reason)}${r.notes ? `<div class="small text-muted">${esc(r.notes)}</div>` : ''}</div>
        ${(r.items || []).map((it) => `<div class="d-flex justify-content-between border-top py-2 gap-2"><span>${esc(it.description)}<div class="small text-muted mono">${num(it.quantity)} x ${KES(it.unit_price)}</div></span><span class="mono">${KES(it.line_total)}</span></div>`).join('')}
        <div class="sum mt-2"><div class="d-flex justify-content-between"><span class="label-mono">Total returned</span><span class="mono fw-semibold">${KES(r.return_total)}</span></div>
        ${(r.payments || []).map((p) => `<div class="d-flex justify-content-between small"><span>Refunded · ${esc(String(p.method).replace('_', ' '))}${p.reference ? ' · <span class="mono">' + esc(p.reference) + '</span>' : ''}</span><span class="mono">${KES(p.amount)}</span></div>`).join('')}</div>`;
    } catch (err) { showErr('rvModalErr', err.message); $('rvBody').innerHTML = ''; }
  };
}

(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch { /* ignore */ }
  renderShell({ active: 'returns', branches: state.branches, branchId: state.branchId, onBranch: (v) => { state.branchId = v; state.page = 1; load(); } });
  load();
})();
