const me = requireLogin();
const state = { rows: [], branches: [], editing: null, pwFor: null };
const shopName = (id) => (state.branches.find((b) => Number(b.id) === Number(id)) || {}).name || '-';

async function load() {
  $('tbody').innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Loading people</td></tr>';
  try {
    state.rows = (await api('/users' + qs({ q: $('fSearch').value.trim(), role: $('fRole').value, is_active: $('fActive').value }))).data || []; pageNotice('');
    $('total').textContent = state.rows.length ? `(${state.rows.length})` : '';
    $('tbody').innerHTML = state.rows.length ? state.rows.map((u, i) => `<tr class="${u.is_active === false ? 'off' : ''}">
      <td><b class="fw-medium">${esc(u.full_name)}</b><span class="sub">${esc(u.username)}${u.phone ? ' · ' + esc(u.phone) : ''}</span></td>
      <td><span class="flag ${u.role === 'owner' ? 'red' : ''}">${esc(u.role)}</span></td>
      <td>${u.branch_id ? esc(shopName(u.branch_id)) : '<span class="text-muted">Both shops</span>'}</td>
      <td style="white-space:normal;min-width:200px">${u.can_override_min_price ? '<span class="flag">Below min price</span>' : ''}${u.can_view_costs ? '<span class="flag">Sees costs</span>' : ''}${num(u.max_discount_percent) > 0 ? `<span class="flag">Discount up to ${num(u.max_discount_percent)}%</span>` : ''}${u.is_active === false ? '<span class="flag red">Switched off</span>' : ''}${u.must_change_password ? '<span class="flag">Must set password</span>' : ''}</td>
      <td>${u.last_login_at ? when(u.last_login_at) : '<span class="text-muted">Never</span>'}</td>
      <td class="text-end text-nowrap"><button class="ibtn" data-act="edit" data-i="${i}" title="Edit" aria-label="Edit ${esc(u.full_name)}"><i class="bi bi-pencil"></i></button>
        <button class="ibtn" data-act="pw" data-i="${i}" title="Reset password" aria-label="Reset password for ${esc(u.full_name)}"><i class="bi bi-key"></i></button></td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">Nobody found.</td></tr>';
  } catch (e) { pageNotice(e.message); $('tbody').innerHTML = '<tr><td colspan="6" class="empty">Could not load people</td></tr>'; }
}
$('fSearch').oninput = debounce(load); ['fRole', 'fActive'].forEach((i) => ($(i).onchange = load));
$('tbody').onclick = (e) => { const b = e.target.closest('button[data-act]'); if (!b) return; const u = state.rows[+b.dataset.i]; b.dataset.act === 'pw' ? openPw(u) : openForm(u); };

function syncRole() { $('uShopBox').classList.toggle('d-none', $('uRole').value === 'owner'); }
$('uRole').onchange = syncRole;
function openForm(u) {
  state.editing = u || null; showErr('uModalErr', '');
  $('uModalTitle').textContent = u ? 'Edit person' : 'Add person';
  $('uShop').innerHTML = state.branches.map((b) => opt(b.id, b.name, u ? u.branch_id : '')).join('');
  $('uPassBox').classList.toggle('d-none', !!u); $('uActiveBox').classList.toggle('d-none', !u);
  $('uName').value = u ? u.full_name || '' : ''; $('uUser').value = u ? u.username || '' : ''; $('uPass').value = '';
  $('uPhone').value = u ? u.phone || '' : ''; $('uEmail').value = u ? u.email || '' : ''; $('uRole').value = u ? u.role : 'cashier';
  $('uDisc').value = u ? num(u.max_discount_percent) : 0; $('uOverride').checked = !!(u && u.can_override_min_price); $('uCosts').checked = !!(u && u.can_view_costs);
  $('uActive').checked = u ? u.is_active !== false : true; syncRole(); modal('uModal').show();
}
function openPw(u) { state.pwFor = u; showErr('pwModalErr', ''); $('pwWho').textContent = u.full_name; $('pwNew').value = ''; modal('pwModal').show(); }
$('addBtn').onclick = () => openForm(null);

$('uSave').onclick = async () => {
  const role = $('uRole').value;
  const body = { full_name: $('uName').value.trim(), username: $('uUser').value.trim(), phone: $('uPhone').value.trim() || null, email: $('uEmail').value.trim() || null, role,
    branch_id: role === 'owner' ? null : $('uShop').value, max_discount_percent: num($('uDisc').value), can_override_min_price: $('uOverride').checked, can_view_costs: $('uCosts').checked };
  if (!body.full_name) return showErr('uModalErr', 'Enter their full name.');
  if (!body.username) return showErr('uModalErr', 'Enter a username they will sign in with.');
  if (role !== 'owner' && !body.branch_id) return showErr('uModalErr', 'Choose the shop they work in.');
  if (state.editing) body.is_active = $('uActive').checked;
  else { body.password = $('uPass').value; if (body.password.length < 6) return showErr('uModalErr', 'The starting password must be at least 6 characters.'); }
  const btn = $('uSave'); btn.disabled = true; showErr('uModalErr', '');
  try {
    await api(state.editing ? '/users/' + state.editing.id : '/users', { method: state.editing ? 'PUT' : 'POST', body });
    modal('uModal').hide(); toast(state.editing ? 'Changes saved' : 'Person added'); load();
  } catch (e) { showErr('uModalErr', e.message); } finally { btn.disabled = false; }
};
$('pwSave').onclick = async () => {
  const pw = $('pwNew').value; if (pw.length < 6) return showErr('pwModalErr', 'The password must be at least 6 characters.');
  const btn = $('pwSave'); btn.disabled = true; showErr('pwModalErr', '');
  try { await api(`/users/${state.pwFor.id}/reset-password`, { method: 'POST', body: { new_password: pw } }); modal('pwModal').hide(); toast('Password reset. They will choose a new one at next sign in.'); load(); }
  catch (e) { showErr('pwModalErr', e.message); } finally { btn.disabled = false; }
};

(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch { /* ignore */ }
  renderShell({ active: 'users', branches: state.branches, branchId: '', onBranch: () => {} });
  load();
})();
