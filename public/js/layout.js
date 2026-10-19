// Draws the sidebar on every signed-in page.  renderShell({ active: 'dashboard', branches, branchId, onBranch })
const NAV = [
  ['Main menu', [['dashboard', 'index.html', 'bi-grid-1x2', 'Dashboard'], ['pos', 'pos.html', 'bi-bag-check', 'Point of sale'],
    ['sales', 'sales.html', 'bi-receipt', 'Sales'], ['products', 'products.html', 'bi-box-seam', 'Products'], ['stock', 'stock.html', 'bi-boxes', 'Stock']]],
  ['People & suppliers', [['customers', 'customers.html', 'bi-people', 'Customers & credit'], ['suppliers', 'suppliers.html', 'bi-truck', 'Suppliers'],
    ['purchases', 'purchases.html', 'bi-cart-plus', 'Purchases'], ['transfers', 'transfers.html', 'bi-arrow-left-right', 'Shop transfers']]],
  ['Management', [['reports', 'reports.html', 'bi-bar-chart-line', 'Reports'], ['expenses', 'expenses.html', 'bi-wallet2', 'Expenses'],
    ['users', 'users.html', 'bi-person-gear', 'Users & roles'], ['audit', 'audit.html', 'bi-shield-check', 'Activity log'], ['settings', 'settings.html', 'bi-gear', 'Settings']]],
];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KES = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });

function requireLogin() { if (!Auth.token) { location.href = 'login.html'; throw new Error('redirect'); } return Auth.user; }

function renderShell({ active, branches = [], branchId = '', onBranch }) {
  const u = requireLogin(), owner = u.role === 'owner';
  const opts = (owner ? '<option value="">Both shops</option>' : '') +
    branches.map((b) => `<option value="${b.id}" ${String(b.id) === String(branchId) ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  document.getElementById('sidebar').innerHTML = `<div class="offcanvas-body">
    <div class="shop-pick"><span class="logo"><i class="bi bi-gear-wide-connected"></i></span>
      <div class="flex-grow-1"><small>Viewing</small><select id="shopSelect" aria-label="Choose shop" ${owner ? '' : 'disabled'}>${opts}</select></div></div>
    ${NAV.map(([g, items]) => `<div class="nav-group"><span class="label-mono">${g}</span>${items.map(([k, href, ic, t]) =>
      `<a class="nav-i ${k === active ? 'active' : ''}" href="${href}"><i class="bi ${ic}"></i>${t}</a>`).join('')}</div>`).join('')}
    <div class="me"><span class="av">${esc((u.full_name || '?')[0])}</span><div><b>${esc(u.full_name)}</b><small>${esc(u.role)}</small></div>
      <button id="signOut" title="Sign out" aria-label="Sign out"><i class="bi bi-box-arrow-right"></i></button></div></div>`;
  document.getElementById('signOut').onclick = () => { Auth.clear(); location.href = 'login.html'; };
  const sel = document.getElementById('shopSelect');
  if (onBranch) sel.onchange = () => onBranch(sel.value);
}