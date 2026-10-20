const me = requireLogin();
// One screen for the small lists that other pages pick from.  f = [column, label, kind, required]
const CFG = {
  categories: { label: 'Categories', one: 'category', path: '/categories', active: true, f: [['name', 'Name', 'text', 1], ['parent_id', 'Belongs under', 'parent']], cols: [['name', 'Name'], ['parent_id', 'Under', 'parent']] },
  brands: { label: 'Brands', one: 'brand', path: '/brands', active: true, f: [['name', 'Name', 'text', 1]], cols: [['name', 'Name']] },
  units: { label: 'Units', one: 'unit', path: '/units', active: false, f: [['name', 'Name', 'text', 1], ['abbreviation', 'Short form', 'text']], cols: [['name', 'Name'], ['abbreviation', 'Short form']] },
  'vehicle-models': { label: 'Vehicle models', one: 'vehicle model', path: '/vehicle-models', active: false,
    f: [['vehicle_type', 'Vehicle type', 'type', 1], ['make', 'Make', 'text', 1], ['model', 'Model', 'text', 1], ['year_from', 'Year from', 'number'], ['year_to', 'Year to', 'number'], ['engine_cc', 'Engine (cc)', 'number'], ['notes', 'Notes', 'text']],
    cols: [['vehicle_type', 'Type'], ['make', 'Make'], ['model', 'Model'], ['year_from', 'Years', 'years'], ['engine_cc', 'Engine (cc)']] },
  'expense-categories': { label: 'Expense categories', one: 'expense category', path: '/expense-categories', active: true, f: [['name', 'Name', 'text', 1]], cols: [['name', 'Name']] },
};
const state = { key: 'categories', rows: [], editing: null, parents: [] };
const cfg = () => CFG[state.key];

$('tabs').innerHTML = Object.entries(CFG).map(([k, c]) => `<button data-k="${k}" class="${k === state.key ? 'on' : ''}">${c.label}</button>`).join('');
$('tabs').onclick = (e) => { const b = e.target.closest('button[data-k]'); if (!b) return; state.key = b.dataset.k; document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); $('cSearch').value = ''; setup(); };

function setup() {
  const c = cfg(); $('cTitle').textContent = c.label; $('addLabel').textContent = 'Add ' + c.one;
  $('cActiveF').classList.toggle('d-none', !c.active); $('cActiveF').value = 'true';
  $('cHead').innerHTML = `<tr>${c.cols.map(([, l]) => `<th>${l}</th>`).join('')}${c.active ? '<th>Status</th>' : ''}<th></th></tr>`; load();
}
const cell = (r, [k, , kind]) => {
  if (kind === 'parent') { const p = state.rows.find((x) => x.id === r.parent_id); return r.parent_id ? esc(p ? p.name : '#' + r.parent_id) : '<span class="text-muted">-</span>'; }
  if (kind === 'years') return r.year_from || r.year_to ? `${esc(r.year_from || '?')} - ${esc(r.year_to || 'now')}` : '-';
  return k === 'vehicle_type' ? esc(String(r[k] || '').replace(/_/g, ' ')) : esc(r[k] ?? '-');
};
async function load() {
  const c = cfg(), span = c.cols.length + (c.active ? 2 : 1);
  $('cBody').innerHTML = `<tr><td colspan="${span}" class="text-center text-muted py-4">Loading</td></tr>`;
  try {
    state.rows = (await api(c.path + (c.active ? '?is_active=' + $('cActiveF').value : ''))).data || []; pageNotice(''); paint();
  } catch (e) { pageNotice(e.message); $('cBody').innerHTML = `<tr><td colspan="${span}" class="empty">Could not load this list</td></tr>`; }
}
function paint() {
  const c = cfg(), span = c.cols.length + (c.active ? 2 : 1), term = $('cSearch').value.trim().toLowerCase();
  const rows = state.rows.filter((r) => !term || Object.values(r).join(' ').toLowerCase().includes(term));
  $('cBody').innerHTML = rows.length ? rows.map((r) => `<tr class="${r.is_active === false ? 'off' : ''}">${c.cols.map((col) => `<td>${cell(r, col)}</td>`).join('')}${c.active ? `<td><span class="st ${r.is_active === false ? 'due' : ''}">${r.is_active === false ? 'Switched off' : 'Active'}</span></td>` : ''}
    <td class="text-end"><button class="ibtn" data-id="${r.id}" title="Edit" aria-label="Edit"><i class="bi bi-pencil"></i></button></td></tr>`).join('')
    : `<tr><td colspan="${span}" class="empty">Nothing here yet. Use the Add button.</td></tr>`;
}
$('cSearch').oninput = debounce(paint, 200); $('cActiveF').onchange = load;
$('cBody').onclick = (e) => { const b = e.target.closest('button[data-id]'); if (b) openForm(state.rows.find((r) => String(r.id) === b.dataset.id)); };
$('addBtn').onclick = () => openForm(null);

async function openForm(r) {
  const c = cfg(); state.editing = r || null; showErr('cModalErr', '');
  if (state.key === 'categories') { try { state.parents = (await api('/categories')).data || []; } catch { state.parents = []; } }
  $('cModalTitle').textContent = (r ? 'Edit ' : 'Add ') + c.one;
  $('vtList').innerHTML = [...new Set(['boda_boda', 'tuk_tuk', ...state.rows.map((x) => x.vehicle_type).filter(Boolean)])].map((v) => `<option value="${esc(v)}">`).join('');
  $('cFields').innerHTML = c.f.map(([k, label, kind, req]) => {
    const v = r ? r[k] ?? '' : '', id = 'cf_' + k, lab = `<label class="form-label" for="${id}">${label}${req ? ' *' : ''}</label>`;
    if (kind === 'parent') return `<div class="col-12">${lab}<select id="${id}" class="form-select"><option value="">Top level</option>${state.parents.filter((p) => !r || p.id !== r.id).map((p) => opt(p.id, p.name, v)).join('')}</select></div>`;
    if (kind === 'number') return `<div class="col-6">${lab}<input id="${id}" type="number" min="0" step="1" class="form-control mono" value="${esc(v)}"></div>`;
    if (kind === 'type') return `<div class="col-12">${lab}<input id="${id}" class="form-control" list="vtList" autocomplete="off" value="${esc(v)}" placeholder="e.g. boda_boda"></div>`;
    return `<div class="col-12">${lab}<input id="${id}" class="form-control" autocomplete="off" value="${esc(v)}"></div>`;
  }).join('') + (c.active && r ? `<div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="cf_active" ${r.is_active !== false ? 'checked' : ''}><label class="form-check-label" for="cf_active">Active</label></div></div>` : '');
  modal('cModal').show();
}
$('cSave').onclick = async () => {
  const c = cfg(), body = {};
  for (const [k, label, kind, req] of c.f) {
    const v = $('cf_' + k).value.trim();
    if (req && !v) return showErr('cModalErr', `Enter the ${label.toLowerCase()}.`);
    body[k] = v === '' ? null : kind === 'number' || kind === 'parent' ? Number(v) : v;
  }
  if (c.active && state.editing) body.is_active = $('cf_active').checked;
  const btn = $('cSave'); btn.disabled = true; showErr('cModalErr', '');
  try { await api(c.path + (state.editing ? '/' + state.editing.id : ''), { method: state.editing ? 'PUT' : 'POST', body }); modal('cModal').hide(); toast(state.editing ? 'Changes saved' : 'Added'); load(); }
  catch (e) { showErr('cModalErr', e.message); } finally { btn.disabled = false; }
};

(async () => {
  let branches = []; try { branches = (await api('/branches')).data || []; } catch { /* ignore */ }
  renderShell({ active: 'catalogue', branches, branchId: me.role === 'owner' ? '' : String(me.branch_id || ''), onBranch: () => {} });
  setup();
})();
