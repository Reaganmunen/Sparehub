const me = requireLogin(), isOwner = me.role === 'owner';
const MAX_ROWS = 300;
const state = { branches: [], branchId: isOwner ? '' : String(me.branch_id || ''), list: [], st: null, edits: {}, busy: false };
const STATUS = { in_progress: ['In progress', 'part'], completed: ['Finished', ''], cancelled: ['Cancelled', 'due'] };
const shopName = (id) => (state.branches.find((b) => Number(b.id) === Number(id)) || {}).name || '-';
window.addEventListener('beforeunload', (e) => { if (Object.keys(state.edits).length) { e.preventDefault(); e.returnValue = ''; } });

// ---------- list ----------
async function loadList() {
  $('tbody').innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Loading</td></tr>';
  try {
    state.list = (await api('/stocktakes' + qs({ branch_id: state.branchId }))).data || []; pageNotice('');
    $('tbody').innerHTML = state.list.length ? state.list.map((s, i) => { const [t, c] = STATUS[s.status] || [s.status, 'part'];
      return `<tr><td>${when(s.started_at)}</td><td>${esc(s.branch_name || shopName(s.branch_id))}</td><td>${esc(s.started_by_name || '-')}</td><td><span class="st ${c}">${t}</span></td><td>${s.completed_at ? when(s.completed_at) : '-'}</td>
        <td class="text-end"><button class="ibtn" data-i="${i}" title="Open" aria-label="Open stock count"><i class="bi bi-box-arrow-in-right"></i></button></td></tr>`; }).join('')
      : '<tr><td colspan="6" class="empty">No stock counts yet. Use <b>Start stock count</b>.</td></tr>';
  } catch (e) { pageNotice(e.message); $('tbody').innerHTML = '<tr><td colspan="6" class="empty">Could not load stock counts</td></tr>'; }
}
$('tbody').onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) openSheet(state.list[+b.dataset.i].id); };

$('startBtn').onclick = () => {
  showErr('stModalErr', ''); $('stShopBox').classList.toggle('d-none', !isOwner);
  if (isOwner) $('stShop').innerHTML = state.branches.map((b) => opt(b.id, b.name, state.branchId || (state.branches[0] || {}).id)).join('');
  modal('stModal').show();
};
$('stGo').onclick = async () => {
  const btn = $('stGo'); btn.disabled = true; showErr('stModalErr', '');
  try {
    const st = (await api('/stocktakes', { method: 'POST', body: isOwner ? { branch_id: $('stShop').value } : {} })).data;
    modal('stModal').hide(); toast('Count sheet ready'); show(st); loadList();
  } catch (e) { showErr('stModalErr', e.message); } finally { btn.disabled = false; }
};

// ---------- count sheet ----------
async function openSheet(id) {
  try { show((await api('/stocktakes/' + id)).data); } catch (e) { toast(e.message, true); }
}
function show(st) {
  state.st = st; state.edits = {}; $('fSearch').value = ''; $('fView').value = 'all';
  $('listView').classList.add('d-none'); $('sheetView').classList.remove('d-none'); $('startBtn').classList.add('d-none');
  const live = st.status === 'in_progress', [t] = STATUS[st.status] || [st.status];
  $('sheetTitle').textContent = `${st.branch_name || shopName(st.branch_id)} · ${t} · started ${when(st.started_at)}`;
  $('sheetActions').classList.toggle('d-none', !live); renderSheet();
}
const eff = (it) => { const e = state.edits[it.product_id]; const v = e && e.counted !== undefined ? e.counted : it.counted_quantity; return v === null || v === undefined || v === '' ? null : num(v); };
const reasonOf = (it) => { const e = state.edits[it.product_id]; return e && e.reason !== undefined ? e.reason : it.reason || ''; };
const diffOf = (it) => { const c = eff(it); return c === null ? null : c - num(it.system_quantity); };
const fmtDiff = (d) => (d === null ? '-' : d === 0 ? '0' : (d > 0 ? '+' : '') + d.toLocaleString('en-KE', { maximumFractionDigits: 3 }));
function summary() {
  const items = state.st.items || [], counted = items.filter((i) => eff(i) !== null).length, diffs = items.filter((i) => { const d = diffOf(i); return d !== null && d !== 0; }).length;
  $('sheetSummary').textContent = `${counted} of ${items.length} counted · ${diffs} differ`;
}
function renderSheet() {
  const st = state.st, live = st.status === 'in_progress', term = $('fSearch').value.trim().toLowerCase(), view = $('fView').value;
  let items = (st.items || []).filter((it) => !term || `${it.product_name} ${it.sku} ${it.barcode || ''}`.toLowerCase().includes(term));
  if (view === 'todo') items = items.filter((it) => eff(it) === null); else if (view === 'diff') items = items.filter((it) => { const d = diffOf(it); return d !== null && d !== 0; });
  const shown = items.slice(0, MAX_ROWS);
  $('sheetBody').innerHTML = shown.length ? shown.map((it) => { const d = diffOf(it), c = eff(it);
    return `<tr><td style="white-space:normal;min-width:180px"><b class="fw-medium">${esc(it.product_name)}</b><span class="sub">${esc(it.sku || '')}${it.barcode ? ' · ' + esc(it.barcode) : ''}</span></td>
      <td class="text-end mono">${num(it.system_quantity)}</td>
      <td class="text-end">${live ? `<input type="number" step="any" min="0" class="cell-input" data-p="${it.product_id}" data-f="counted" value="${c === null ? '' : c}" aria-label="Counted quantity for ${esc(it.product_name)}">` : `<span class="mono">${c === null ? '-' : c}</span>`}</td>
      <td class="text-end mono fw-semibold ${d ? (d < 0 ? 'diff-down' : 'diff-up') : ''}" id="d_${it.product_id}">${fmtDiff(d)}</td>
      <td>${live ? `<input class="form-control form-control-sm" style="min-width:150px" data-p="${it.product_id}" data-f="reason" value="${esc(reasonOf(it))}" placeholder="Why different?" aria-label="Reason for ${esc(it.product_name)}">` : esc(reasonOf(it) || '')}</td></tr>`; }).join('')
    : '<tr><td colspan="5" class="empty">Nothing to show here.</td></tr>';
  $('sheetNote').textContent = items.length > MAX_ROWS ? `Showing the first ${MAX_ROWS} of ${items.length} items. Use the search box to find the rest.` : '';
  summary();
}
$('fSearch').oninput = debounce(renderSheet, 250); $('fView').onchange = renderSheet;
$('sheetBody').oninput = (e) => {
  const el = e.target.closest('[data-p]'); if (!el) return; const p = el.dataset.p; state.edits[p] = state.edits[p] || {};
  state.edits[p][el.dataset.f] = el.value;
  if (el.dataset.f === 'counted') { const it = state.st.items.find((x) => String(x.product_id) === p), d = diffOf(it), cell = $('d_' + p); cell.textContent = fmtDiff(d); cell.className = 'text-end mono fw-semibold ' + (d ? (d < 0 ? 'diff-down' : 'diff-up') : ''); }
  summary();
};

async function saveCounts(quiet) {
  const counts = Object.entries(state.edits).filter(([, e]) => e.counted !== undefined && e.counted !== '').map(([p, e]) => ({ product_id: Number(p), counted_quantity: num(e.counted), ...(e.reason ? { reason: e.reason } : {}) }));
  if (!counts.length) { if (!quiet) toast('Nothing new to save'); return true; }
  try {
    const r = (await api(`/stocktakes/${state.st.id}/counts`, { method: 'PUT', body: { counts } })).data;
    if (r && r.items) state.st = r; else counts.forEach((c) => { const it = state.st.items.find((x) => x.product_id === c.product_id); if (it) { it.counted_quantity = c.counted_quantity; if (c.reason) it.reason = c.reason; } });
    state.edits = {}; renderSheet(); if (!quiet) toast(`${counts.length} count${counts.length > 1 ? 's' : ''} saved`); return true;
  } catch (e) { toast(e.message, true); return false; }
}
$('saveBtn').onclick = async (e) => { e.currentTarget.disabled = true; await saveCounts(false); e.currentTarget.disabled = false; };
$('doneBtn').onclick = async (e) => {
  const btn = e.currentTarget; btn.disabled = true;
  try {
    if (!(await saveCounts(true))) return;
    const items = state.st.items || [], todo = items.filter((i) => eff(i) === null).length, diffs = items.filter((i) => { const d = diffOf(i); return d !== null && d !== 0; }).length;
    if (!confirm(`Finish this count?\n\n${diffs} item${diffs === 1 ? '' : 's'} with a difference will be corrected in your stock.${todo ? `\n${todo} item${todo === 1 ? ' has' : 's have'} not been counted.` : ''}\n\nThis cannot be undone.`)) return;
    const done = (await api(`/stocktakes/${state.st.id}/complete`, { method: 'POST' })).data; toast('Stock count finished. Stock levels updated.'); show(done); loadList();
  } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
};
$('cancelBtn').onclick = async (e) => {
  if (!confirm('Cancel this stock count? Nothing will change in your stock.')) return; const btn = e.currentTarget; btn.disabled = true;
  try { const r = (await api(`/stocktakes/${state.st.id}/cancel`, { method: 'POST' })).data; toast('Stock count cancelled'); state.edits = {}; if (r && r.items) show(r); else back(); loadList(); }
  catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
};
function back() {
  if (Object.keys(state.edits).length && !confirm('You have counts that are not saved. Leave without saving them?')) return;
  state.edits = {}; state.st = null; $('sheetView').classList.add('d-none'); $('listView').classList.remove('d-none'); $('startBtn').classList.remove('d-none'); loadList();
}
$('backBtn').onclick = back;

(async () => {
  try { state.branches = (await api('/branches')).data || []; } catch { /* ignore */ }
  renderShell({ active: 'stocktake', branches: state.branches, branchId: state.branchId, onBranch: (v) => { state.branchId = v; if (!state.st) loadList(); } });
  loadList();
})();
