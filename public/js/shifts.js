const me = requireLogin(), isOwner = me.role === 'owner', isCashier = me.role === 'cashier';
const state = { page: 1, limit: 25, total: 0, rows: [], branches: [], branchId: isOwner ? '' : String(me.branch_id || ''), mine: null };
const PG = { info: 'pageInfo', prev: 'prevBtn', next: 'nextBtn' };
const shopName = (id) => (state.branches.find((b) => Number(b.id) === Number(id)) || {}).name || '-';
const sid = (r) => r.shift_id || r.id;
const cashierOf = (r) => r.cashier_name || r.cashier || r.cashier_full_name || '-';
const diffOf = (r) => { const d = r.difference ?? r.cash_difference ?? r.variance; if (d !== undefined && d !== null) return num(d); return r.counted_cash != null && r.expected_cash != null ? num(r.counted_cash) - num(r.expected_cash) : null; };

// ---------- my shift (cashiers) ----------
async function loadMine() {
  if (!isCashier) return; $('myPanel').classList.remove('d-none');
  try { state.mine = (await api('/shifts/current')).data; } catch { state.mine = null; }
  const s = state.mine;
  $('myInfo').innerHTML = s ? `<span class="chip">Open since ${when(s.opened_at)}</span><div class="mt-2 small text-muted">Cash that should be in the till: <b class="mono text-dark">${KES(s.expected_cash ?? 0)}</b></div>`
    : '<span class="chip off">No shift open</span><div class="mt-2 small text-muted">Open a shift before you sell or take money.</div>';
  $('myBtn').textContent = s ? 'Close shift' : 'Open shift';
}
$('myBtn').onclick = () => {
  const s = state.mine; showErr('shModalErr', '');
  $('shModalTitle').textContent = s ? 'Close your shift' : 'Open your shift';
  $('shLabel').textContent = s ? 'Cash you counted in the till' : 'Cash in the till now (opening float)';
  $('shInfo').textContent = s ? `Expected cash: ${KES(s.expected_cash ?? 0)}` : ''; $('shNotes').classList.toggle('d-none', !s); $('shNotes').value = '';
  $('shCash').value = s ? '' : 0; $('shOk').textContent = s ? 'Close shift' : 'Open shift'; modal('shModal').show();
};
$('shOk').onclick = async () => {
  const s = state.mine, cash = $('shCash').value; if (cash === '' || num(cash) < 0) return showErr('shModalErr', 'Enter the amount of cash.');
  const btn = $('shOk'); btn.disabled = true; showErr('shModalErr', '');
  try {
    if (s) {
      const r = (await api(`/shifts/${sid(s)}/close`, { method: 'POST', body: { counted_cash: num(cash), notes: $('shNotes').value.trim() || undefined } })).data, d = r ? diffOf(r) : null;
      toast(d === null ? 'Shift closed' : Math.abs(d) < 0.5 ? 'Shift closed. The cash balances.' : `Shift closed. Cash is ${d > 0 ? 'over' : 'short'} by ${KES(Math.abs(d))}.`);
    } else { await api('/shifts/open', { method: 'POST', body: { opening_float: num(cash) } }); toast('Shift opened'); }
    modal('shModal').hide(); loadMine(); load();
  } catch (e) { showErr('shModalErr', e.message); } finally { btn.disabled = false; }
};

// ---------- list ----------
async function load() {
  $('tbody').innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Loading shifts</td></tr>';
  try {
    const r = await api('/shifts' + qs({ branch_id: state.branchId, cashier_id: isCashier ? '' : $('fCashier').value, status: $('fStatus').value, from: $('fFrom').value, to: $('fTo').value, page: state.page, limit: state.limit }));
    state.rows = r.data || []; state.total = Number(r.total || 0); pageNotice('');
    $('tbody').innerHTML = state.rows.length ? state.rows.map((s, i) => {
      const open = s.status === 'open', d = open ? null : diffOf(s);
      return `<tr><td>${when(s.opened_at)}${s.closed_at ? `<span class="sub">closed ${when(s.closed_at)}</span>` : ''}</td><td>${esc(cashierOf(s))}</td><td>${esc(shopName(s.branch_id))}</td>
        <td><span class="st ${open ? 'part' : ''}">${open ? 'Open' : 'Closed'}</span></td><td class="text-end mono">${s.expected_cash != null ? KES(s.expected_cash) : '-'}</td>
        <td class="text-end mono">${!open && s.counted_cash != null ? KES(s.counted_cash) : '-'}</td>
        <td class="text-end mono fw-semibold ${d !== null && Math.abs(d) >= 0.5 ? (d < 0 ? 'diff-down' : 'diff-up') : ''}">${d === null ? '-' : Math.abs(d) < 0.5 ? 'Balanced' : (d > 0 ? '+' : '-') + KES(Math.abs(d))}</td>
        <td class="text-end"><button class="ibtn" data-i="${i}" title="Details" aria-label="Shift details"><i class="bi bi-eye"></i></button></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty">No shifts found.</td></tr>';
    $('total').textContent = state.total ? `(${state.total})` : ''; paintPager(PG, state);
  } catch (e) { pageNotice(e.message); $('tbody').innerHTML = '<tr><td colspan="8" class="empty">Could not load shifts</td></tr>'; }
}
bindPager(PG, state, load);
['fCashier', 'fStatus', 'fFrom', 'fTo'].forEach((i) => ($(i).onchange = () => { state.page = 1; load(); }));
$('tbody').onclick = async (e) => {
  const b = e.target.closest('button[data-i]'); if (!b) return; const s = state.rows[+b.dataset.i];
  $('dtBody').innerHTML = '<span>Loading</span><span></span>'; showErr('dtModalErr', ''); modal('dtModal').show();
  try {
    const r = (await api('/shifts/' + sid(s))).data;
    $('dtBody').innerHTML = Object.keys(r).filter((k) => k !== 'total_count').map((k) => `<span>${esc(labelize(k))}</span><span>${esc(k === 'branch_id' ? shopName(r[k]) : fmtCell(k, r[k]))}</span>`).join('');
  } catch (err) { showErr('dtModalErr', err.message); $('dtBody').innerHTML = ''; }
};

(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch { /* ignore */ }
  if (!isCashier) { $('fCashier').classList.remove('d-none'); try { const us = (await api('/users' + qs({ role: 'cashier' }))).data || []; $('fCashier').innerHTML += us.map((u) => opt(u.id, u.full_name)).join(''); } catch { /* ignore */ } }
  renderShell({ active: 'shifts', branches: state.branches, branchId: state.branchId, onBranch: (v) => { state.branchId = v; state.page = 1; load(); } });
  loadMine(); load();
})();
