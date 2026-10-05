// Session handling for the dashboard.
//
// The token is kept in sessionStorage: it survives a page refresh but not
// closing the tab, a reasonable default for a shared operations console.
// apiFetch adds the token to every request and reports a rejected session to
// the root component, which then shows the sign-in screen.

const TOKEN_KEY = 'desksos.token';

let onSessionEnded = () => {};
let onPasswordChangeRequired = () => {};

export function setSessionHandlers({ ended, passwordChangeRequired }) {
  onSessionEnded = ended || (() => {});
  onPasswordChangeRequired = passwordChangeRequired || (() => {});
}

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function saveToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    onSessionEnded('Your session has ended. Please sign in again.');
  } else if (res.status === 403) {
    const body = await res.clone().json().catch(() => ({}));
    if (body.code === 'PASSWORD_CHANGE_REQUIRED') onPasswordChangeRequired();
  }
  return res;
}

export async function login(email, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Sign-in failed');
  saveToken(body.token);
  return body.user;
}

export async function fetchCurrentUser() {
  if (!getToken()) return null;
  const res = await apiFetch('/api/auth/me');
  return res.ok ? res.json() : null;
}

export async function changePassword(currentPassword, newPassword) {
  const res = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Password change failed');
  saveToken(body.token); // the old token stops working after a change
  return body.user;
}

export async function logout() {
  await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  clearToken();
}
