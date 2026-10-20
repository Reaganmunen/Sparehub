const me = requireLogin();
const state = { settings: [], changed: {}, branches: [], editing: null };

// ---------- tabs ----------
$('tabs').onclick = (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $('tabBiz').classList.toggle('d-none', b.dataset.tab !== 'biz'); $('tabShops').classList.toggle('d-none', b.dataset.tab !== 'shops');
};

// ---------- business settings ----------
const kind = (v) => (v === 'true' || v === 'false' ? 'bool' : v !== '' && !isNaN(Number(v)) ? 'num' : 'text');
function renderSettings() {
  $('setList').innerHTML = state.settings.length ? state.settings.map((s) => {
    const k = kind(s.value), id = 'set_' + s.key;
    const input = k === 'bool' ? `<div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" id="${id}" data-key="${esc(s.key)}" data-kind="bool" ${s.value === 'true' ? 'checked' : ''}></div>`
      : `<input class="form-control" id="${id}" data-key="${esc(s.key)}" data-kind="${k}" ${k === 'num' ? 'type="number" step="any"' : 'type="text"'} value="${esc(s.value)}">`;
    return `<div class="set-row"><div><label for="${id}" class="fw-medium">${esc(labelize(s.key))}</label><div class="d">${esc(s.description || '')}</div></div>${input}</div>`;
  }).join('') : '<div class="empty">No settings found.</div>';
  state.changed = {}; $('setSave').disabled = true;
}
$('setList').oninput = $('setList').onchange = (e) => {
  const el = e.target.closest('[data-key]'); if (!el) return;
  const orig = state.settings.find((s) => s.key === el.dataset.key), v = el.dataset.kind === 'bool' ? String(el.checked) : el.value.trim();
  if (v === String(orig.value)) delete state.changed[el.dataset.key]; else state.changed[el.dataset.key] = v;
  $('setSave').disabled = !Object.keys(state.changed).length;
};
async function loadSettings() {
  try { state.settings = (await api('/settings')).data || []; renderSettings(); pageNotice(''); }
  catch (e) { pageNotice(e.message); $('setList').innerHTML = '<div class="empty">Could not load settings</div>'; }
}
$('setSave').onclick = async () => {
  for (const [k, v] of Object.entries(state.changed)) if (kind(state.settings.find((s) => s.key === k).value) === 'num' && (v === '' || isNaN(Number(v)))) return toast(`${labelize(k)} must be a number.`, true);
  const btn = $('setSave'); btn.disabled = true;
  try { state.settings = (await api('/settings', { method: 'PUT', body: { settings: state.changed } })).data || state.settings; renderSettings(); toast('Settings saved'); }
  catch (e) { toast(e.message, true); btn.disabled = false; }
};

// ---------- shops ----------
async function loadShops() {
  try { state.branches = (await api('/branches')).data || []; } catch (e) { pageNotice(e.message); }
  $('shopBody').innerHTML = state.branches.length ? state.branches.map((b, i) => `<tr class="${b.is_active === false ? 'off' : ''}">
    <td><b class="fw-medium">${esc(b.name)}</b><span class="sub">${esc([b.shop_type && String(b.shop_type).replace(/_/g, ' '), b.town].filter(Boolean).join(' · '))}</span></td>
    <td class="mono">${esc(b.code)}</td><td class="mono">${esc(b.phone || '-')}<span class="sub">${esc(b.email || '')}</span></td>
    <td class="mono">${esc(b.mpesa_till_number || '-')}</td><td><span class="st ${b.is_active === false ? 'due' : ''}">${b.is_active === false ? 'Switched off' : 'Active'}</span></td>
    <td class="text-end"><button class="ibtn" data-i="${i}" title="Edit" aria-label="Edit ${esc(b.name)}"><i class="bi bi-pencil"></i></button></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">No shops yet.</td></tr>';
}
const SHOP_FIELDS = { sName: 'name', sCode: 'code', sType: 'shop_type', sTown: 'town', sAddr: 'address', sPhone: 'phone', sEmail: 'email', sPin: 'kra_pin', sTill: 'mpesa_till_number', sShort: 'mpesa_business_shortcode', sHead: 'receipt_header', sFoot: 'receipt_footer' };
function openShop(b) {
  state.editing = b || null; showErr('sModalErr', ''); $('sModalTitle').textContent = b ? 'Edit shop' : 'Add shop';
  Object.entries(SHOP_FIELDS).forEach(([id, k]) => ($(id).value = b ? b[k] ?? '' : ''));
  $('sTypeBox').classList.toggle('d-none', !!b); // the type is chosen once, when the shop is created
  $('sActiveBox').classList.toggle('d-none', !b); $('sActive').checked = b ? b.is_active !== false : true; modal('sModal').show();
}
$('shopAdd').onclick = () => openShop(null);
$('shopBody').onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) openShop(state.branches[+b.dataset.i]); };
$('sSave').onclick = async () => {
  const body = {}; Object.entries(SHOP_FIELDS).forEach(([id, k]) => { if (k === 'shop_type' && state.editing) return; const v = $(id).value.trim(); body[k] = v === '' ? null : v; });
  if (!body.name) return showErr('sModalErr', 'Enter the shop name.');
  if (!body.code) return showErr('sModalErr', 'Enter a short code for the shop, for example BB.');
  if (state.editing) body.is_active = $('sActive').checked;
  const btn = $('sSave'); btn.disabled = true; showErr('sModalErr', '');
  try { await api(state.editing ? '/branches/' + state.editing.id : '/branches', { method: state.editing ? 'PUT' : 'POST', body }); modal('sModal').hide(); toast(state.editing ? 'Shop updated' : 'Shop added'); loadShops(); }
  catch (e) { showErr('sModalErr', e.message); } finally { btn.disabled = false; }
};

(async () => {
  await loadShops();
  renderShell({ active: 'settings', branches: state.branches, branchId: '', onBranch: () => {} });
  loadSettings();
})();
