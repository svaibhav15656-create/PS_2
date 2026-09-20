// api.js — thin fetch wrapper shared by every page. Keeps a JWT in
// localStorage to demonstrate the federated-identity/SSO flow: log in once,
// the same token is used against every "department" endpoint.
const API_BASE = 'http://localhost:4000/api';

function getToken() { return localStorage.getItem('gi_token'); }
function getUser() { try { return JSON.parse(localStorage.getItem('gi_user')); } catch { return null; } }
function setSession(token, user) {
  localStorage.setItem('gi_token', token);
  localStorage.setItem('gi_user', JSON.stringify(user));
}
function clearSession() { localStorage.removeItem('gi_token'); localStorage.removeItem('gi_user'); }

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function requireSession(allowedRoles) {
  const user = getUser();
  if (!getToken() || !user) { window.location.href = '/index.html'; return null; }
  if (allowedRoles && !allowedRoles.includes(user.role)) { window.location.href = '/index.html'; return null; }
  return user;
}

function fmtDate(iso) { return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }

function statusTag(status) {
  const cls = status === 'Completed' ? 'completed' : status === 'Rejected' ? 'rejected' : 'progress';
  return `<span class="tag ${cls}">${status}</span>`;
}
