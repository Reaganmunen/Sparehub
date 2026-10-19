const $ = (id) => document.getElementById(id);
const me = requireLogin();
if (me.role === 'cashier') { location.href = 'pos.html'; throw new Error('redirect'); }
const owner = me.role === 'owner';
const seeCosts = owner || !!me.can_view_costs;
const state = { page: 1, limit: 25, total: 0, q: '', category: '', brand: '', status: 'true', branches: [], cats: [], brands: [], units: [], models: [], editing: null, checkedFits: new Set() };
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.set(k, v)); const s = p.toString(); return s ? '?' + s : ''; };
const shopName = (id) => (state.branches.find((b) => b.id === Number(id)) || {}).name || 'Shop ' + id;
const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
const showErr = (id, msg) => { const el = $(id); el.textContent = msg; el.classList.toggle('d-none', !msg); };
const num = (id) => ($(id).value === '' ? undefined : Number($(id).value));
const COLS = 6 + (seeCosts ? 2 : 0) + 1; // sku, product, category, brand, selling, status, actions (+ buying, min)

// ---------- page header ----------
$('actions').innerHTML = owner
  ? `<button class="btn btn-light border btn-sm" id="importBtn"><i class="bi bi-file-earmark-arrow-up me-1"></i>Import</button>
     <button class="btn btn-ink btn-sm px-3" id="addBtn"><i class="bi bi-plus-lg me-1"></i>Add product</button>`
  : '<span class="label-mono">View only. The owner manages products.</span>';
$('thead').innerHTML = `<tr><th>SKU</th><th>Product</th><th>Category</th><th>Brand</th>${seeCosts ? '<th class="text-end">Buying</th>' : ''}<th class="text-end">Selling</th>${seeCosts ? '<th class="text-end">Min</th>' : ''}<th>Status</th><th></th></tr>`;
document.querySelectorAll('.cost-only').forEach((el) => el.classList.toggle('d-none', !seeCosts));

// ---------- list ----------
async function load() {
  $('tbody').innerHTML = `<tr><td colspan="${COLS}" class="text-center text-muted py-4">Loading products</td></tr>`;
  try {
    const r = await api('/products' + qs({ q: state.q, category_id: state.category, brand_id: state.brand, is_active: state.status, page: state.page, limit: state.limit }));
    state.total = Number(r.total || 0);
    render(r.data);
    $('notice').innerHTML = '';
  } catch (e) {
    $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`;
    $('tbody').innerHTML = `<tr><td colspan="${COLS}" class="empty">Could not load products</td></tr>`;
  }
}

function render(rows) {
  if (!rows.length) {
    $('tbody').innerHTML = `<tr><td colspan="${COLS}" class="empty">No products found${owner ? '. Use <b>Add product</b> or <b>Import</b> to get started.' : '.'}</td></tr>`;
  } else {
    $('tbody').innerHTML = rows.map((p) => `<tr class="${p.is_active ? '' : 'off'}">
      <td class="sku">${esc(p.sku)}</td>
      <td><b class="fw-medium">${esc(p.name)}</b>${p.part_number ? `<span class="sub">Part ${esc(p.part_number)}</span>` : ''}</td>
      <td>${esc(p.category || '-')}</td><td>${esc(p.brand || '-')}</td>
      ${seeCosts ? `<td class="text-end mono">${p.buying_price != null ? KES(p.buying_price) : '-'}</td>` : ''}
      <td class="text-end mono">${KES(p.selling_price)}</td>
      ${seeCosts ? `<td class="text-end mono">${p.min_selling_price != null ? KES(p.min_selling_price) : '-'}</td>` : ''}
      <td><span class="st ${p.is_active ? '' : 'due'}">${p.is_active ? 'Active' : 'Off'}</span></td>
      <td class="text-end text-nowrap">
        <button class="ibtn" data-act="open" data-id="${p.id}" title="${owner ? 'Edit' : 'View'}" aria-label="${owner ? 'Edit' : 'View'} ${esc(p.name)}"><i class="bi ${owner ? 'bi-pencil' : 'bi-eye'}"></i></button>
        ${owner ? `<button class="ibtn" data-act="toggle" data-id="${p.id}" data-on="${p.is_active ? 1 : 0}" title="${p.is_active ? 'Switch off' : 'Switch on'}" aria-label="${p.is_active ? 'Switch off' : 'Switch on'} ${esc(p.name)}"><i class="bi ${p.is_active ? 'bi-toggle-on' : 'bi-toggle-off'}"></i></button>` : ''}
      </td></tr>`).join('');
  }
  const from = state.total ? (state.page - 1) * state.limit + 1 : 0, to = Math.min(state.page * state.limit, state.total);
  $('pageInfo').textContent = `${from}-${to} of ${state.total}`;
  $('totalLabel').textContent = state.total ? `(${state.total})` : '';
  $('prevBtn').disabled = state.page <= 1;
  $('nextBtn').disabled = to >= state.total;
}

$('tbody').onclick = async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.act === 'open') return openProduct(id);
  b.disabled = true;
  try {
    await api(`/products/${id}/active`, { method: 'POST', body: { is_active: b.dataset.on !== '1' } });
    await load();
  } catch (err) { $('notice').innerHTML = `<div class="alert-x">${esc(err.message)}</div>`; b.disabled = false; }
};
$('prevBtn').onclick = () => { state.page--; load(); };
$('nextBtn').onclick = () => { state.page++; load(); };
let t; $('fSearch').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; load(); }, 350); };
$('fCategory').onchange = (e) => { state.category = e.target.value; state.page = 1; load(); };
$('fBrand').onchange = (e) => { state.brand = e.target.value; state.page = 1; load(); };
$('fStatus').onchange = (e) => { state.status = e.target.value; state.page = 1; load(); };

// ---------- lookups ----------
function fillSelects() {
  const keepCat = $('f_cat').value, keepBrand = $('f_brand').value;
  $('fCategory').innerHTML = opt('', 'All categories') + state.cats.map((c) => opt(c.id, c.name, String(c.id) === state.category)).join('');
  $('fBrand').innerHTML = opt('', 'All brands') + state.brands.map((c) => opt(c.id, c.name, String(c.id) === state.brand)).join('');
  $('f_cat').innerHTML = opt('', 'None') + state.cats.map((c) => opt(c.id, c.name, String(c.id) === keepCat)).join('');
  $('f_brand').innerHTML = opt('', 'None') + state.brands.map((c) => opt(c.id, c.name, String(c.id) === keepBrand)).join('');
  $('f_unit').innerHTML = state.units.map((u) => opt(u.id, `${u.name} (${u.abbreviation})`, u.abbreviation === 'pc')).join('');
  $('vmTypes').innerHTML = [...new Set(state.models.map((m) => m.vehicle_type).filter(Boolean))].map((v) => `<option value="${esc(v)}">`).join('');
}
async function loadLookups() {
  const [c, b, u, v, br] = await Promise.all([api('/categories'), api('/brands'), api('/units'), api('/vehicle-models'), api('/branches')]);
  Object.assign(state, { cats: c.data, brands: b.data, units: u.data, models: v.data, branches: br.data });
}
async function quickAdd(path, label, key) {
  const name = (prompt(`New ${label} name:`) || '').trim(); if (!name) return;
  try { const r = await api(path, { method: 'POST', body: { name } }); state[key] = (await api(path)).data; fillSelects(); return r.data.id; }
  catch (e) { showErr('pmError', e.message); }
}
$('addCat').onclick = async () => { const id = await quickAdd('/categories', 'category', 'cats'); if (id) $('f_cat').value = id; };
$('addBrand').onclick = async () => { const id = await quickAdd('/brands', 'brand', 'brands'); if (id) $('f_brand').value = id; };

// ---------- fitments ----------
function renderFits() {
  const term = $('fitSearch').value.trim().toLowerCase();
  const list = state.models.filter((m) => !term || `${m.vehicle_type} ${m.make} ${m.model}`.toLowerCase().includes(term));
  if (!list.length) { $('fitList').innerHTML = '<span class="text-muted small">No vehicles yet. Add one below.</span>'; return; }
  let last = null, html = '';
  list.forEach((m) => {
    if (m.vehicle_type !== last) { html += `<span class="vt">${esc(String(m.vehicle_type || 'other').replace(/_/g, ' '))}</span>`; last = m.vehicle_type; }
    html += `<label><input type="checkbox" value="${m.id}" ${state.checkedFits.has(m.id) ? 'checked' : ''}${owner ? '' : ' disabled'}>${esc(m.make)} ${esc(m.model)}</label>`;
  });
  $('fitList').innerHTML = html;
}
$('fitList').onchange = (e) => { const id = Number(e.target.value); e.target.checked ? state.checkedFits.add(id) : state.checkedFits.delete(id); };
$('fitSearch').oninput = renderFits;
$('vmAdd').onclick = async () => {
  const body = { vehicle_type: $('vm_type').value.trim(), make: $('vm_make').value.trim(), model: $('vm_model').value.trim() };
  if (!body.vehicle_type || !body.make || !body.model) return showErr('pmError', 'Enter the vehicle type, make and model.');
  try {
    const r = await api('/vehicle-models', { method: 'POST', body });
    state.models = (await api('/vehicle-models')).data; state.checkedFits.add(r.data.id);
    ['vm_make', 'vm_model'].forEach((i) => ($(i).value = '')); showErr('pmError', ''); fillSelects(); renderFits();
  } catch (e) { showErr('pmError', e.message); }
};

// ---------- add / edit / view modal ----------
function resetForm() {
  ['f_sku', 'f_name', 'f_part', 'f_barcode', 'f_buy', 'f_sell', 'f_min', 'f_whole', 'f_desc', 'fitSearch'].forEach((i) => ($(i).value = ''));
  $('f_tax').value = 0; $('f_reorder').value = 0; $('f_track').checked = true;
  fillSelects(); showErr('pmError', ''); $('histList').innerHTML = '';
  state.checkedFits = new Set();
}
function setReadOnly(ro) {
  document.querySelectorAll('#productModal input:not(#fitSearch):not(#vm_type):not(#vm_make):not(#vm_model), #productModal select').forEach((el) => { if (!el.closest('#fitList')) el.disabled = ro; });
  $('pmSave').classList.toggle('d-none', ro); $('addCat').disabled = ro; $('addBrand').disabled = ro; $('fitNew').classList.toggle('d-none', ro);
}
function renderShopRows() {
  $('shopRows').innerHTML = state.branches.map((b) => `<div class="shop-row" data-branch="${b.id}">
    <div class="form-check"><input class="form-check-input sr-on" type="checkbox" id="sr_${b.id}" checked><label class="form-check-label" for="sr_${b.id}">${esc(b.name)}</label></div>
    <input type="number" min="0" step="1" class="form-control sr-qty" placeholder="Qty in stock" aria-label="Opening quantity at ${esc(b.name)}">
    <input type="number" min="0" step="0.01" class="form-control sr-cost" placeholder="Cost each (default buying)" aria-label="Unit cost at ${esc(b.name)}"></div>`).join('');
}

function openNew() {
  state.editing = null; resetForm(); setReadOnly(false);
  $('pmTitle').textContent = 'Add product';
  $('newShopBox').classList.remove('d-none'); $('stockBox').classList.add('d-none'); $('histBox').classList.add('d-none');
  renderShopRows(); renderFits(); modal('productModal').show();
}

async function openProduct(id) {
  try {
    const p = (await api('/products/' + id)).data;
    state.editing = p; resetForm();
    $('pmTitle').textContent = owner ? 'Edit product' : 'Product details';
    $('f_sku').value = p.sku || ''; $('f_name').value = p.name || ''; $('f_part').value = p.part_number || ''; $('f_barcode').value = p.barcode || '';
    $('f_unit').value = p.unit_id; $('f_cat').value = p.category_id || ''; $('f_brand').value = p.brand_id || '';
    $('f_buy').value = p.buying_price ?? ''; $('f_sell').value = p.selling_price ?? ''; $('f_min').value = p.min_selling_price ?? '';
    $('f_whole').value = p.wholesale_price ?? ''; $('f_tax').value = p.tax_rate ?? 0; $('f_reorder').value = p.default_reorder_level ?? 0;
    $('f_track').checked = !!p.track_stock; $('f_desc').value = p.description || '';
    state.checkedFits = new Set((p.fitments || []).map((f) => f.id));
    renderFits();
    $('newShopBox').classList.add('d-none'); $('stockBox').classList.remove('d-none');
    $('stockInfo').innerHTML = (p.stock || []).length
      ? p.stock.map((s) => `<div class="d-flex justify-content-between border-top py-1"><span>${esc(shopName(s.branch_id))}${s.shelf_location ? ` <span class="text-muted">(${esc(s.shelf_location)})</span>` : ''}</span><span class="mono">${Number(s.quantity)} in stock · reorder at ${Number(s.reorder_level)}</span></div>`).join('')
      : '<span class="text-muted">Not listed in any shop yet.</span>';
    $('histBox').classList.toggle('d-none', !seeCosts);
    setReadOnly(!owner); modal('productModal').show();
  } catch (e) { $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`; }
}

$('histBtn').onclick = async () => {
  if (!state.editing) return;
  $('histList').innerHTML = '<span class="text-muted">Loading</span>';
  try {
    const rows = (await api(`/products/${state.editing.id}/price-history`)).data;
    const skip = new Set(['id', 'product_id', 'changed_by', 'changed_at', 'changed_by_name']);
    $('histList').innerHTML = rows.length ? rows.map((h) => `<div class="hist-row"><span>${esc(new Date(h.changed_at).toLocaleString('en-KE'))} · ${esc(h.changed_by_name || 'system')}</span>
      <span class="text-end">${Object.entries(h).filter(([k, v]) => !skip.has(k) && v != null).map(([k, v]) => `${esc(k.replace(/_/g, ' '))}: ${esc(v)}`).join(' · ')}</span></div>`).join('') : '<span class="text-muted">No price changes yet.</span>';
  } catch (e) { $('histList').innerHTML = `<span class="text-danger">${esc(e.message)}</span>`; }
};

$('pmSave').onclick = async () => {
  const sku = $('f_sku').value.trim(), name = $('f_name').value.trim(), sell = num('f_sell'), min = num('f_min'), buy = num('f_buy');
  if (!sku || !name) return showErr('pmError', 'SKU and product name are required.');
  if (sell === undefined) return showErr('pmError', 'The selling price is required.');
  if (min !== undefined && min > sell) return showErr('pmError', 'The minimum price cannot be higher than the selling price.');
  const body = {
    sku, name, part_number: $('f_part').value.trim(), barcode: $('f_barcode').value.trim(), description: $('f_desc').value.trim(),
    category_id: $('f_cat').value, brand_id: $('f_brand').value, selling_price: sell,
    wholesale_price: $('f_whole').value === '' ? '' : Number($('f_whole').value),
    tax_rate: num('f_tax') ?? 0, default_reorder_level: num('f_reorder') ?? 0, track_stock: $('f_track').checked,
    fitments: [...state.checkedFits],
  };
  if ($('f_unit').value) body.unit_id = Number($('f_unit').value);
  if (buy !== undefined) body.buying_price = buy;
  if (min !== undefined) body.min_selling_price = min;
  const editing = state.editing;
  if (!editing) {
    body.branch_ids = []; body.opening_stock = [];
    document.querySelectorAll('#shopRows .shop-row').forEach((row) => {
      const bid = Number(row.dataset.branch);
      if (!row.querySelector('.sr-on').checked) return;
      body.branch_ids.push(bid);
      const qty = Number(row.querySelector('.sr-qty').value);
      if (qty > 0) { const c = row.querySelector('.sr-cost').value; body.opening_stock.push({ branch_id: bid, quantity: qty, unit_cost: c === '' ? (buy ?? 0) : Number(c) }); }
    });
  }
  const btn = $('pmSave'); btn.disabled = true; showErr('pmError', '');
  try {
    await api(editing ? '/products/' + editing.id : '/products', { method: editing ? 'PUT' : 'POST', body });
    modal('productModal').hide();
    $('notice').innerHTML = `<div class="alert-ok">${editing ? 'Product updated' : 'Product added'}: ${esc(name)}</div>`;
    setTimeout(() => { if ($('notice').firstChild && $('notice').firstChild.className === 'alert-ok') $('notice').innerHTML = ''; }, 4000);
    await load();
  } catch (e) { showErr('pmError', e.message); } finally { btn.disabled = false; }
};

// ---------- import ----------
async function downloadTemplate() {
  try {
    const res = await fetch(API_BASE + '/products/import/template', { headers: { Authorization: 'Bearer ' + Auth.token } });
    if (!res.ok) throw new Error('Could not download the template');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'product-import-template.csv'; a.click();
  } catch (e) { showErr('imError', e.message); }
}
async function runImport() {
  const f = $('imFile').files[0];
  if (!f) return showErr('imError', 'Choose a file first.');
  const fd = new FormData(); fd.append('file', f); if ($('imBranch').value) fd.append('branch_id', $('imBranch').value);
  const btn = $('imGo'); btn.disabled = true; showErr('imError', ''); $('imResult').innerHTML = '';
  try {
    const res = await fetch(API_BASE + '/products/import', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || 'Import failed');
    const r = data.data;
    $('imResult').innerHTML = `<div class="alert-ok mb-2">${r.created} added, ${r.updated} updated, ${r.failed.length} skipped.</div>` +
      (r.failed.length ? `<div class="border rounded-3 p-2" style="max-height:180px;overflow:auto">${r.failed.map((x) => `<div class="hist-row"><span>Row ${x.row} ${esc(x.sku || '')}</span><span class="text-danger text-end">${esc(x.error)}</span></div>`).join('')}</div>` : '');
    load();
  } catch (e) { showErr('imError', e.message); } finally { btn.disabled = false; }
}

if (owner) {
  $('addBtn').onclick = openNew;
  $('importBtn').onclick = () => { $('imFile').value = ''; $('imResult').innerHTML = ''; showErr('imError', ''); modal('importModal').show(); };
  $('tplBtn').onclick = downloadTemplate;
  $('imGo').onclick = runImport;
}

// ---------- start ----------
(async () => {
  try { await loadLookups(); } catch (e) { $('notice').innerHTML = `<div class="alert-x">${esc(e.message)}</div>`; }
  renderShell({ active: 'products', branches: state.branches, branchId: '' });
  $('imBranch').innerHTML = opt('', 'None (only products, no stock)') + state.branches.map((b) => opt(b.id, b.name)).join('');
  fillSelects();
  load();
})();