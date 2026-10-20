const me = requireLogin(), isOwner = me.role === 'owner';
const state = { page: 1, limit: 25, total: 0, branches: [], cats: [], branchId: isOwner ? '' : String(me.branch_id || '') };
const PG = { info: 'pageInfo', prev: 'prevBtn', next: 'nextBtn' };
const filters = () => ({ branch_id: state.branchId, category_id: $('fCat').value, q: $('fSearch').value.trim(), from: $('fFrom').value, to: $('fTo').value });
const method = (m) => String(m || '').replace(/_/g, ' ');

async function load() {
  $('tbody').innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Loading expenses</td></tr>';
  try {
    const r = await api('/expenses' + qs({ ...filters(), page: state.page, limit: state.limit }));
    state.total = Number(r.total || 0); const rows = r.data || []; pageNotice('');
    $('tbody').innerHTML = rows.length ? rows.map((x) => `<tr><td>${day(x.expense_date)}</td><td>${esc(x.category)}</td>
      <td style="white-space:normal;min-width:200px"><b class="fw-medium">${esc(x.description)}</b>${x.paid_to || x.reference ? `<span class="sub">${esc([x.paid_to, x.reference].filter(Boolean).join(' · '))}</span>` : ''}</td>
      <td><span class="flag">${esc(method(x.method))}</span></td><td class="text-end mono fw-semibold">${KES(x.amount)}</td><td>${esc(x.created_by_name || '-')}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No expenses found for these filters.</td></tr>';
    $('total').textContent = state.total ? `(${state.total})` : ''; paintPager(PG, state);
  } catch (e) { pageNotice(e.message); $('tbody').innerHTML = '<tr><td colspan="6" class="empty">Could not load expenses</td></tr>'; }
}
async function loadTotals() {
  try {
    const f = filters(), rows = (await api('/expenses/totals' + qs({ branch_id: f.branch_id, from: f.from, to: f.to }))).data || [];
    const sum = rows.reduce((a, r) => a + num(r.total), 0), n = rows.reduce((a, r) => a + num(r.entries), 0), top = rows[0];
    $('kpis').innerHTML = [['Total spent', KES(sum), $('fFrom').value || $('fTo').value ? 'in the chosen dates' : 'all time'], ['Entries', n.toLocaleString(), 'expenses recorded'], ['Biggest category', top ? esc(top.category) : '-', top ? KES(top.total) : '']]
      .map(([l, v, f2], i) => `<div class="col-${i === 2 ? 12 : 6} col-lg-4"><div class="kpi"><div class="kpi-in"><span class="label-mono">${l}</span><div class="v" style="${i === 2 ? 'font-size:1.15rem' : ''}">${v}</div></div><div class="kpi-f"><span>${f2 || '&nbsp;'}</span></div></div></div>`).join('');
  } catch { $('kpis').innerHTML = ''; }
}
const refresh = () => { state.page = 1; load(); loadTotals(); };
bindPager(PG, state, load);
$('fSearch').oninput = debounce(refresh); ['fCat', 'fFrom', 'fTo'].forEach((i) => ($(i).onchange = refresh));

function openAdd() {
  showErr('eModalErr', '');
  $('eShopBox').classList.toggle('d-none', !isOwner);
  if (isOwner) $('eShop').innerHTML = state.branches.map((b) => opt(b.id, b.name, state.branchId || (state.branches[0] || {}).id)).join('');
  $('eCat').innerHTML = '<option value="">Choose a category</option>' + state.cats.map((c) => opt(c.id, c.name)).join('');
  ['eAmount', 'eDesc', 'ePaidTo', 'eRef'].forEach((i) => ($(i).value = '')); $('eDate').value = today(); $('eMethod').value = 'cash';
  modal('eModal').show();
}
$('addBtn').onclick = openAdd;
$('eSave').onclick = async () => {
  const body = { category_id: $('eCat').value, amount: num($('eAmount').value), description: $('eDesc').value.trim(), expense_date: $('eDate').value || undefined, method: $('eMethod').value, paid_to: $('ePaidTo').value.trim() || undefined, reference: $('eRef').value.trim() || undefined };
  if (isOwner) body.branch_id = $('eShop').value;
  if (!body.category_id) return showErr('eModalErr', 'Choose a category.');
  if (!(body.amount > 0)) return showErr('eModalErr', 'Enter an amount above zero.');
  if (!body.description) return showErr('eModalErr', 'Say what the money was spent on.');
  const btn = $('eSave'); btn.disabled = true; showErr('eModalErr', '');
  try { await api('/expenses', { method: 'POST', body }); modal('eModal').hide(); toast('Expense saved'); load(); loadTotals(); }
  catch (e) { showErr('eModalErr', e.message); } finally { btn.disabled = false; }
};

(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch { /* ignore */ }
  try { state.cats = (await api('/expense-categories')).data || []; } catch { /* ignore */ }
  $('fCat').innerHTML = '<option value="">All categories</option>' + state.cats.map((c) => opt(c.id, c.name)).join('');
  $('fFrom').value = monthStart(); $('fTo').value = today();
  renderShell({ active: 'expenses', branches: state.branches, branchId: state.branchId, onBranch: (v) => { state.branchId = v; refresh(); } });
  refresh();
})();
