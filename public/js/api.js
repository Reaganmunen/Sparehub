// Shared fetch helper. Same-origin by default; set window.API_BASE before this file to point elsewhere.
const API_BASE = window.API_BASE || '/api';
const Auth = {
  get token() { return localStorage.getItem('spare_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('spare_user')); } catch { return null; } },
  save(token, user) { localStorage.setItem('spare_token', token); localStorage.setItem('spare_user', JSON.stringify(user)); },
  clear() { localStorage.removeItem('spare_token'); localStorage.removeItem('spare_user'); },
};

async function api(path, { method = 'GET', body, token = Auth.token } = {}) {
  if (window.Offline && Offline.isDown()) throw Object.assign(new Error('Cannot reach the server. Check your internet connection.'), { code: 'NETWORK' });
  let res;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000); // a hanging connection counts as "no internet"
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch {
    if (window.Offline) Offline.markDown();
    throw Object.assign(new Error('Cannot reach the server. Check your internet connection.'), { code: 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }
  if (window.Offline) Offline.markUp();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error || {};
    if (res.status === 401 && e.code !== undefined && !location.pathname.endsWith('login.html') && path !== '/auth/login') {
      Auth.clear(); location.href = 'login.html';
    }
    throw Object.assign(new Error(e.message || 'Something went wrong. Try again.'), { status: res.status, code: e.code });
  }
  return data;
}