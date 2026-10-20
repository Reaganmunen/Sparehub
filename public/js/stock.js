const $ = (id) => document.getElementById(id);
const me = requireLogin();
const isOwner = me.role === 'owner', isCashier = me.role === 'cashier', staff = !isCashier;
const seeCosts = isOwner || !!me.can_view_costs;
const state = { branchId: isOwner ? '' : String(me.branch_id || ''), branches: [], cats: [], lv: { page: 1, limit: 25, total: 0, rows: [] }, mv: { page: 1, limit: 50, total: 0, product: null, branch: '' }, adj: null, set: null };
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.set(k, v)); const s = p.toString(); return s ? '?' + s : ''; };
const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmtQty = (n) => String(Number(num(n).toFixed(3)));
const shopName = (id) => (state.branches.find((b) => b.id === Number(id)) || {}).name || 'Shop ' + id;
const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const showErr = (id, msg) => { const e = $(id); e.textContent = msg || ''; e.classList.toggle('d-none', !msg); };
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast-x' + (err ? ' err' : ''); t.textContent = msg; $('toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3000); }
const notice = (html) => ($('notice').innerHTML = html ? `<div class="alert-x">${html}</div>` : '');

// Cashiers see quantities only: no history tab, no edit buttons, no cost columns (removed from the page, not hidden).
if (!staff) document.querySelectorAll('[data-staff]').forEach((el) => el.remove());
if (!isOwner) document.querySelectorAll('.owner-only').forEach((el) => el.remove());
if (isOwner) $('listBtn').classList.remove('d-none');
const bothShops = () => isOwner && !state.branchId;
const cols = () => 4 + (bothShops() ? 1 : 0) + (seeCosts ? 2 : 0) + (staff ? 1 : 0);

// ---------- tabs ----------
document.querySelectorAll('[name=tab]').forEach((r) => (r.onchange = () => showTab(r.value)));
function showTab(t) {
  $('levelsPanel').classList.toggle('d-none', t !== 'levels'); $('movesPanel').classList.toggle('d-none', t !== 'moves');
  if (t === 'moves') loadMoves(); else loadLevels();
}

// ---------- levels ----------
function head() {
  $('lvHead').innerHTML = `<tr><th>Product</th>${bothShops() ? '<th>Shop</th>' : ''}<th>Category</th><th class="text-end">In stock</th><th class="text-end">Reorder at</th>${seeCosts ? '<th class="text-end">Avg cost</th><th class="text-end">Value at cost</th>' : ''}<th>Status</th>${staff ? '<th></th>' : ''}</tr>`;
}
async function loadLevels() {
  head(); $('lvBody').innerHTML = `<tr><td colspan="${cols()}" class="text-center text-muted py-4">Loading stock</td></tr>`;
  try {
    const l = state.lv;
    const r = await api('/stock' + qs({ branch_id: state.branchId, q: $('lvSearch').value.trim(), category_id: $('lvCat').value, low_only: $('lvLow').checked ? 'true' : '', page: l.page, limit: l.limit }));
    l.total = Number(r.total || 0); l.rows = r.data || []; notice(''); renderLevels();
  } catch (e) { notice(esc(e.message)); $('lvBody').innerHTML = `<tr><td colspan="${cols()}" class="empty">Could not load stock</td></tr>`; }
}
function renderLevels() {
  const l = state.lv;
  $('lvBody').innerHTML = l.rows.length ? l.rows.map((s, i) => {
    const q = num(s.quantity), low = s.is_low_stock, out = q <= 0;
    return `<tr><td><b class="fw-medium">${esc(s.product_name)}</b><span class="sub">${esc(s.sku || '')}${s.part_number ? ' · Part ' + esc(s.part_number) : ''}${s.shelf_location ? ' · ' + esc(s.shelf_location) : ''}</span></td>
      ${bothShops() ? `<td>${esc(s.branch_name || shopName(s.branch_id))}</td>` : ''}<td>${esc(s.category || '-')}</td>
      <td class="text-end mono fw-semibold">${fmtQty(q)} <span class="text-muted small">${esc(s.unit || '')}</span></td><td class="text-end mono">${fmtQty(s.reorder_level)}</td>
      ${seeCosts ? `<td class="text-end mono">${s.average_cost != null ? KES(s.average_cost) : '-'}</td><td class="text-end mono">${s.stock_value_at_cost != null ? KES(s.stock_value_at_cost) : '-'}</td>` : ''}
      <td><span class="st ${out ? 'due' : low ? 'part' : ''}">${out ? 'Out' : low ? 'Low' : 'OK'}</span></td>
      ${staff ? `<td class="text-end text-nowrap"><button class="ibtn" data-act="adj" data-i="${i}" title="Change stock" aria-label="Change stock for ${esc(s.product_name)}"><i class="bi bi-plus-slash-minus"></i></button>
        <button class="ibtn" data-act="set" data-i="${i}" title="Shop settings" aria-label="Settings for ${esc(s.product_name)}"><i class="bi bi-sliders"></i></button>
        <button class="ibtn" data-act="hist" data-i="${i}" title="History" aria-label="History of ${esc(s.product_name)}"><i class="bi bi-clock-history"></i></button></td>` : ''}</tr>`;
  }).join('') : `<tr><td colspan="${cols()}" class="empty">${$('lvLow').checked ? 'Nothing is low on stock.' : 'No stock found.'}</td></tr>`;
  const from = l.total ? (l.page - 1) * l.limit + 1 : 0, to = Math.min(l.page * l.limit, l.total);
  $('lvInfo').textContent = `${from}-${to} of ${l.total}`; $('lvTotal').textContent = l.total ? `(${l.total})` : '';
  $('lvPrev').disabled = l.page <= 1; $('lvNext').disabled = to >= l.total;
}
$('lvPrev').onclick = () => { state.lv.page--; loadLevels(); }; $('lvNext').onclick = () => { state.lv.page++; loadLevels(); };
let t; $('lvSearch').oninput = () => { clearTimeout(t); t = setTimeout(() => { state.lv.page = 1; loadLevels(); }, 350); };
$('lvCat').onchange = $('lvLow').onchange = () => { state.lv.page = 1; loadLevels(); };
$('lvBody').onclick = (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return; const s = state.lv.rows[+b.dataset.i];
  if (b.dataset.act === 'adj') openAdjust(s); else if (b.dataset.act === 'set') openSettings(s);
  else { state.mv.product = { id: s.product_id, name: s.product_name }; state.mv.branch = String(s.branch_id); state.mv.page = 1; $('tab-moves').checked = true; showTab('moves'); }
};

// ---------- change stock ----------
const ADJ_TYPES = [['adjustment_in', 'Add stock (found / recount)'], ['adjustment_out', 'Remove stock (lost / recount)'], ['damage', 'Damaged / expired'], ['supplier_return', 'Returned to supplier']];
function openAdjust(s) {
  state.adj = s; showErr('adjErr', '');
  $('adjName').textContent = s.product_name; $('adjWhere').textContent = `${shopName(s.branch_id)} · now ${fmtQty(s.quantity)} ${s.unit || ''}`;
  $('adjType').innerHTML = (isOwner ? [['opening_stock', 'Opening stock (first count)'], ...ADJ_TYPES] : ADJ_TYPES).map(([v, t2]) => `<option value="${v}">${t2}</option>`).join('');
  $('adjType').value = 'adjustment_in'; $('adjQty').value = ''; $('adjCost').value = ''; $('adjReason').value = ''; syncAdj(); modal('adjModal').show();
}
function syncAdj() { const t2 = $('adjType').value; $('adjCostRow').classList.toggle('d-none', !(seeCosts && (t2 === 'adjustment_in' || t2 === 'opening_stock'))); }
$('adjType').onchange = syncAdj;
$('adjGo').onclick = async () => {
  const s = state.adj, qty = num($('adjQty').value), type = $('adjType').value, reason = $('adjReason').value.trim();
  if (!(qty > 0)) return showErr('adjErr', 'Enter a quantity above zero.');
  if (type !== 'opening_stock' && !reason) return showErr('adjErr', 'Give a reason for this change.');
  const btn = $('adjGo'); btn.disabled = true; showErr('adjErr', '');
  try {
    await api('/stock/adjust', { method: 'POST', body: { branch_id: s.branch_id, product_id: s.product_id, type, quantity: qty, reason, ...($('adjCost').value !== '' ? { unit_cost: num($('adjCost').value) } : {}) } });
    modal('adjModal').hide(); toast('Stock updated'); loadLevels();
  } catch (e) { showErr('adjErr', e.message); } finally { btn.disabled = false; }
};

// ---------- shop settings ----------
async function openSettings(s) {
  state.set = s; showErr('setErr', '');
  $('setName').textContent = s.product_name; $('setWhere').textContent = shopName(s.branch_id);
  $('setReorder').value = s.reorder_level ?? ''; $('setShelf').value = s.shelf_location || '';
  if (isOwner) { $('setSell').value = ''; $('setMin').value = ''; $('setWhole').value = ''; }
  modal('setModal').show();
}
$('setGo').onclick = async () => {
  const s = state.set, btn = $('setGo'), body = { reorder_level: num($('setReorder').value), shelf_location: $('setShelf').value.trim() };
  if (isOwner) ['Sell:selling_price', 'Min:min_selling_price', 'Whole:wholesale_price'].forEach((p) => { const [k, f] = p.split(':'), v = $('set' + k).value; if (v !== '') body[f] = num(v); });
  btn.disabled = true; showErr('setErr', '');
  try { await api(`/stock/${s.branch_id}/${s.product_id}`, { method: 'PUT', body }); modal('setModal').hide(); toast('Saved'); loadLevels(); }
  catch (e) { showErr('setErr', e.message); } finally { btn.disabled = false; }
};

// ---------- list a product in a shop (owner) ----------
if (isOwner) {
  $('listBtn').onclick = () => { $('lstShop').innerHTML = state.branches.map((b) => `<option value="${b.id}" ${String(b.id) === state.branchId ? 'selected' : ''}>${esc(b.name)}</option>`).join(''); $('lstQ').value = ''; $('lstRes').innerHTML = ''; showErr('lstErr', ''); modal('lstModal').show(); };
  let lt; $('lstQ').oninput = () => {
    clearTimeout(lt); const q = $('lstQ').value.trim(); if (q.length < 2) return ($('lstRes').innerHTML = '');
    lt = setTimeout(async () => {
      try { const rows = (await api('/products' + qs({ q, is_active: 'true', limit: 8 }))).data || [];
        $('lstRes').innerHTML = rows.map((p) => `<button class="pline w-100 text-start" data-p="${p.id}"><span>${esc(p.name)} <span class="text-muted mono">${esc(p.sku)}</span></span><span class="text-danger">List</span></button>`).join('') || '<div class="text-muted">No products found.</div>';
      } catch (e) { showErr('lstErr', e.message); }
    }, 300);
  };
  $('lstRes').onclick = async (e) => {
    const b = e.target.closest('button[data-p]'); if (!b) return; showErr('lstErr', '');
    try { await api(`/stock/${$('lstShop').value}/products/${b.dataset.p}`, { method: 'POST', body: {} }); modal('lstModal').hide(); toast('Product listed in that shop'); loadLevels(); }
    catch (err) { showErr('lstErr', err.message); }
  };
}

// ---------- movements ----------
async function loadMoves() {
  const m = state.mv; $('mvBody').innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Loading history</td></tr>';
  const chip = $('mvProduct'); chip.classList.toggle('d-none', !m.product);
  if (m.product) { chip.innerHTML = `${esc(m.product.name)} <button class="btn btn-sm p-0 ms-1 text-muted" id="mvClear" aria-label="Show all products"><i class="bi bi-x-lg"></i></button>`; $('mvClear').onclick = () => { m.product = null; m.branch = ''; m.page = 1; loadMoves(); }; }
  try {
    const r = await api('/stock/movements' + qs({ branch_id: m.branch || state.branchId, product_id: m.product ? m.product.id : '', type: $('mvType').value, from: $('mvFrom').value, to: $('mvTo').value, page: m.page, limit: m.limit }));
    m.total = Number(r.total || 0); notice('');
    $('mvBody').innerHTML = (r.data || []).length ? r.data.map((x) => { const c = num(x.quantity_change);
      return `<tr><td class="small">${new Date(x.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(shopName(x.branch_id))}</td>
        <td><b class="fw-medium">${esc(x.product_name)}</b><span class="sub">${esc(x.sku || '')}</span></td><td>${esc(pretty(x.movement_type))}</td>
        <td class="text-end mono fw-semibold ${c < 0 ? 'text-danger' : 'text-success'}">${c > 0 ? '+' : ''}${fmtQty(c)}</td><td class="text-end mono">${x.quantity_after != null ? fmtQty(x.quantity_after) : ''}</td>
        <td class="small">${esc(x.reason || '')}</td><td class="small">${esc(x.created_by_name || 'system')}</td></tr>`; }).join('')
      : '<tr><td colspan="8" class="empty">No stock changes found.</td></tr>';
    const from = m.total ? (m.page - 1) * m.limit + 1 : 0, to = Math.min(m.page * m.limit, m.total);
    $('mvInfo').textContent = `${from}-${to} of ${m.total}`; $('mvTotal').textContent = m.total ? `(${m.total})` : ''; $('mvPrev').disabled = m.page <= 1; $('mvNext').disabled = to >= m.total;
  } catch (e) { notice(esc(e.message)); $('mvBody').innerHTML = '<tr><td colspan="8" class="empty">Could not load history</td></tr>'; }
}
if (staff) {
  $('mvPrev').onclick = () => { state.mv.page--; loadMoves(); }; $('mvNext').onclick = () => { state.mv.page++; loadMoves(); };
  ['mvType', 'mvFrom', 'mvTo'].forEach((id) => ($(id).onchange = () => { state.mv.page = 1; loadMoves(); }));
}

// ---------- start ----------
(async () => {
  try { const [b, c] = await Promise.all([api('/branches'), api('/categories')]); state.branches = b.data || []; state.cats = c.data || []; } catch (e) { notice(esc(e.message)); }
  $('lvCat').innerHTML = '<option value="">All categories</option>' + state.cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  renderShell({ active: 'stock', branches: state.branches, branchId: state.branchId, onBranch: (v) => { state.branchId = v; state.lv.page = 1; state.mv.page = 1; state.mv.product = null; state.mv.branch = ''; loadLevels(); if (staff && !$('movesPanel').classList.contains('d-none')) loadMoves(); } });
  loadLevels();
})();