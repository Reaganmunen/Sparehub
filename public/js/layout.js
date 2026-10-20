// Draws the sidebar on every signed-in page.  renderShell({ active: 'dashboard', branches, branchId, onBranch })
const ALL = ['owner', 'manager', 'cashier'], STAFF = ['owner', 'manager'], OWNER = ['owner'];
// [key, page, icon, label, roles allowed].  Anything a role may not use is removed from the sidebar completely.
// These mirror the server's rules (src/routes/*), which still enforce them even if someone types the address.
const NAV = [
  ['Main menu', [['dashboard', 'index.html', 'bi-grid-1x2', 'Dashboard', ALL], ['pos', 'pos.html', 'bi-bag-check', 'Point of sale', ALL],
    ['sales', 'sales.html', 'bi-receipt', 'Sales', ALL], ['products', 'products.html', 'bi-box-seam', 'Products', STAFF], ['stock', 'stock.html', 'bi-boxes', 'Stock', ALL]]],
  ['People & suppliers', [['customers', 'customers.html', 'bi-people', 'Customers & credit', ALL], ['suppliers', 'suppliers.html', 'bi-truck', 'Suppliers', STAFF],
    ['purchases', 'purchases.html', 'bi-cart-plus', 'Purchases', STAFF], ['transfers', 'transfers.html', 'bi-arrow-left-right', 'Shop transfers', STAFF]]],
  ['Management', [['reports', 'reports.html', 'bi-bar-chart-line', 'Reports', STAFF], ['expenses', 'expenses.html', 'bi-wallet2', 'Expenses', STAFF],
    ['users', 'users.html', 'bi-person-gear', 'Users & roles', OWNER], ['audit', 'audit.html', 'bi-shield-check', 'Activity log', STAFF], ['settings', 'settings.html', 'bi-gear', 'Settings', OWNER]]],
];
const canOpen = (key, role) => NAV.some(([, items]) => items.some(([k, , , , roles]) => k === key && roles.includes(role)));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KES = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });

function requireLogin() { if (!Auth.token) { location.href = 'login.html'; throw new Error('redirect'); } return Auth.user; }

function renderShell({ active, branches = [], branchId = '', onBranch, allowAll = true }) {
  const u = requireLogin(), owner = u.role === 'owner';
  // someone typed a page address their role cannot use: send them home
  if (!canOpen(active, u.role)) { location.replace('index.html'); throw new Error('redirect'); }
  const opts = (owner && allowAll ? '<option value="">Both shops</option>' : '') +
    branches.map((b) => `<option value="${b.id}" ${String(b.id) === String(branchId) ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  document.getElementById('sidebar').innerHTML = `<div class="offcanvas-body">
    <div class="shop-pick"><span class="logo"><i class="bi bi-gear-wide-connected"></i></span>
      <div class="flex-grow-1"><small>Viewing</small><select id="shopSelect" aria-label="Choose shop" ${owner ? '' : 'disabled'}>${opts}</select></div></div>
    ${NAV.map(([g, items]) => [g, items.filter((i) => i[4].includes(u.role))]).filter(([, items]) => items.length).map(([g, items]) => `<div class="nav-group"><span class="label-mono">${g}</span>${items.map(([k, href, ic, t]) =>
      `<a class="nav-i ${k === active ? 'active' : ''}" href="${href}"><i class="bi ${ic}"></i>${t}</a>`).join('')}</div>`).join('')}
    <div class="me"><span class="av">${esc((u.full_name || '?')[0])}</span><div><b>${esc(u.full_name)}</b><small>${esc(u.role)}</small></div>
      <button id="signOut" title="Sign out" aria-label="Sign out"><i class="bi bi-box-arrow-right"></i></button></div></div>`;
  document.getElementById('signOut').onclick = () => { Auth.clear(); location.href = 'login.html'; };
  const sel = document.getElementById('shopSelect');
  if (onBranch) sel.onchange = () => onBranch(sel.value);
}