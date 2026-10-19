const $ = (id) => document.getElementById(id);
const DASHBOARD = 'index.html';

// --- decorative pixel chart (sample shape only) ---
(function pixelChart() {
  const heights = [3,5,4,8,6,4,9,5,7,12,6,4,8,5,10,7,5,9,6,4,7,11,5,8,6,4,9,5];
  const rows = 14, el = $('pixels'); let html = '';
  for (let r = rows; r >= 1; r--) heights.forEach((h, c) => {
    const on = r <= Math.round(h * 0.6), peak = h === 12 && on;
    html += `<i class="${peak ? 'pk' : on ? 'on' : r <= h + 2 ? 'ghost' : ''}"></i>`;
  });
  el.style.gridTemplateColumns = `repeat(${heights.length},1fr)`;
  el.innerHTML = html;
})();

// --- helpers ---
function showError(msg) { const a = $('alert'); a.textContent = msg; a.classList.remove('d-none'); }
function clearError() { $('alert').classList.add('d-none'); }
function busy(btn, on, text) {
  btn.disabled = on;
  btn.innerHTML = on ? '<span class="spinner-border spinner-border-sm me-2"></span>' + text : btn.dataset.label;
}
function go(user) {
  // Cashiers are tied to one shop; this keeps their branch handy for the POS screen.
  location.href = DASHBOARD;
}
document.querySelectorAll('[data-toggle-pass]').forEach((b) =>
  b.addEventListener('click', () => {
    const i = $(b.dataset.togglePass), show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    b.innerHTML = `<i class="bi bi-eye${show ? '-slash' : ''}"></i>`;
    b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  })
);
$('username').value = localStorage.getItem('spare_last_username') || '';

// --- already signed in? ---
if (Auth.token) api('/auth/me').then((r) => { if (!r.data.must_change_password) go(r.data); }).catch(() => Auth.clear());

// --- sign in ---
let pendingToken = null;
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); clearError();
  const btn = $('loginBtn');
  busy(btn, true, 'Signing in');
  try {
    const { token, user } = await api('/auth/login', {
      method: 'POST', token: null,
      body: { username: $('username').value.trim(), password: $('password').value },
    });
    localStorage.setItem('spare_last_username', user.username);
    if (user.must_change_password) {
      pendingToken = token; Auth.save(token, user);
      $('loginForm').classList.add('d-none'); $('pwForm').classList.remove('d-none');
      $('formTitle').textContent = 'Choose a new password';
      $('formSub').textContent = 'The owner reset your password. Set your own to continue.';
      $('current_password').value = $('password').value; $('new_password').focus();
    } else { Auth.save(token, user); go(user); }
  } catch (err) {
    showError(err.message);
    $('password').value = ''; $('password').focus();
  } finally { busy(btn, false); }
});

// --- forced password change ---
$('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault(); clearError();
  if ($('new_password').value !== $('confirm_password').value) return showError('The two new passwords do not match.');
  const btn = $('pwBtn'); busy(btn, true, 'Saving');
  try {
    await api('/auth/change-password', { method: 'POST', token: pendingToken,
      body: { current_password: $('current_password').value, new_password: $('new_password').value } });
    const me = await api('/auth/me', { token: pendingToken });
    Auth.save(pendingToken, me.data); go(me.data);
  } catch (err) { showError(err.message); } finally { busy(btn, false); }
});