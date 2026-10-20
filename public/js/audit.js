const me = requireLogin(), isOwner = me.role === 'owner';
const state = { page: 1, limit: 50, total: 0, rows: [], branches: [], branchId: isOwner ? '' : String(me.branch_id || '') };
const PG = { info: 'pageInfo', prev: 'prevBtn', next: 'nextBtn' };
const TYPES = ['sale', 'sale_return', 'payment', 'product', 'stock', 'purchase', 'supplier', 'customer', 'transfer', 'stocktake', 'shift', 'expense', 'user', 'settings'];
$('fType').innerHTML += TYPES.map((t) => opt(t, labelize(t))).join('');
const shopName = (id) => (state.branches.find((b) => Number(b.id) === Number(id)) || {}).name || (id ? 'Shop ' + id : '-');

async function load() {
  $('tbody').innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Loading activity</td></tr>';
  try {
    const r = await api('/audit' + qs({ branch_id: state.branchId, action: $('fAction').value.trim(), entity_type: $('fType').value, user_id: $('fUser').value, from: $('fFrom').value, to: $('fTo').value, page: state.page, limit: state.limit }));
    state.rows = r.data || []; state.total = Number(r.total || 0); pageNotice('');
    $('tbody').innerHTML = state.rows.length ? state.rows.map((a, i) => `<tr><td>${when(a.created_at)}</td><td>${esc(a.user_name || 'System')}</td>
      <td><span class="flag">${esc(a.action)}</span></td><td>${a.entity_type ? esc(labelize(a.entity_type)) + (a.entity_id ? ' <span class="mono text-muted">#' + esc(a.entity_id) + '</span>' : '') : '-'}</td>
      <td>${a.branch_id ? esc(shopName(a.branch_id)) : '-'}</td>
      <td class="text-end">${a.details ? `<button class="ibtn" data-i="${i}" title="Show details" aria-label="Show details"><i class="bi bi-chevron-down"></i></button>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No activity found for these filters.</td></tr>';
    $('total').textContent = state.total ? `(${state.total})` : ''; paintPager(PG, state);
  } catch (e) { pageNotice(e.message); $('tbody').innerHTML = '<tr><td colspan="6" class="empty">Could not load the activity log</td></tr>'; }
}
const refresh = () => { state.page = 1; load(); };
bindPager(PG, state, load);
$('fAction').oninput = debounce(refresh); ['fType', 'fUser', 'fFrom', 'fTo'].forEach((i) => ($(i).onchange = refresh));
$('tbody').onclick = (e) => {
  const b = e.target.closest('button[data-i]'); if (!b) return; const tr = b.closest('tr'), nxt = tr.nextElementSibling;
  if (nxt && nxt.classList.contains('det')) { nxt.remove(); b.innerHTML = '<i class="bi bi-chevron-down"></i>'; return; }
  const a = state.rows[+b.dataset.i], row = document.createElement('tr'); row.className = 'det';
  let d = a.details; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { /* keep text */ } }
  row.innerHTML = `<td colspan="6" style="white-space:normal"><div class="small text-muted mono">${a.ip_address ? 'From ' + esc(a.ip_address) : ''}</div><pre class="json">${esc(typeof d === 'string' ? d : JSON.stringify(d, null, 2))}</pre></td>`;
  tr.after(row); b.innerHTML = '<i class="bi bi-chevron-up"></i>';
};

(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch { /* ignore */ }
  try { const us = (await api('/users')).data || []; $('fUser').innerHTML += us.map((u) => opt(u.id, u.full_name)).join(''); } catch { /* ignore */ }
  renderShell({ active: 'audit', branches: state.branches, branchId: state.branchId, onBranch: (v) => { state.branchId = v; refresh(); } });
  load();
})();
