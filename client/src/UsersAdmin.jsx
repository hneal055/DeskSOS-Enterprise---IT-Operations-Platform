import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './auth';

const ROLES = ['admin', 'operator', 'viewer'];
const ROLE_HELP = {
  admin: 'full access',
  operator: 'edits incidents',
  viewer: 'read-only',
};

const input = 'bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm focus:outline-none focus:border-purple-500';

async function readError(res) {
  const body = await res.json().catch(() => ({}));
  return body.details ? `${body.error}: ${body.details.join('; ')}` : body.error || `Request failed (${res.status})`;
}

export default function UsersAdmin({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState(null); // { who, password } shown once
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'operator' });
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState({}); // user id -> action in progress

  const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/users');
      if (res.ok) setUsers(await res.json());
      else setError(await readError(res));
    } catch {
      setError(NETWORK_ERROR);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showSecret = (who, password) => { setCopied(false); setSecret({ who, password }); };

  // Runs one action per user at a time, so double clicks can't overlap
  const withPending = async (u, action) => {
    if (pending[u.id]) return;
    setPending((p) => ({ ...p, [u.id]: true }));
    try {
      await action();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setPending((p) => { const next = { ...p }; delete next[u.id]; return next; });
    }
  };

  const addUser = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) return setError(await readError(res));
      const { user, temporaryPassword } = await res.json();
      showSecret(user, temporaryPassword);
      setForm({ name: '', email: '', role: 'operator' });
      load();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const update = (u, changes) => withPending(u, async () => {
    setError('');
    const res = await apiFetch(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
    if (!res.ok) setError(await readError(res));
    await load();
  });

  const reset = (u) => {
    if (!window.confirm(`Reset the password for ${u.name}? They will be signed out everywhere.`)) return;
    return withPending(u, async () => {
      setError('');
      const res = await apiFetch(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' });
      if (!res.ok) return setError(await readError(res));
      showSecret(u, (await res.json()).temporaryPassword);
      await load();
    });
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(secret.password); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div className="space-y-6">
      {secret && (
        <div role="status" className="bg-emerald-950/60 border border-emerald-500/40 rounded-lg p-4 space-y-2">
          <p className="text-sm text-emerald-200 font-semibold">
            Temporary password for {secret.who.name} ({secret.who.email})
          </p>
          <div className="flex items-center space-x-3">
            <code data-testid="temporary-password" className="bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-emerald-300 text-sm">
              {secret.password}
            </code>
            <button onClick={copy} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={() => setSecret(null)} className="text-xs text-slate-400 hover:text-slate-200">Done</button>
          </div>
          <p className="text-xs text-emerald-300/80">
            Give it to them securely. It is shown only once, and they must choose their own password when they first sign in.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded p-2">{error}</p>
      )}

      <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-lg">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">Add user</h2>
        <form onSubmit={addUser} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <label className="block">
            <span className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Name</span>
            <input className={`${input} w-full`} value={form.name} required
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Email</span>
            <input type="email" className={`${input} w-full`} value={form.email} required
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Role</span>
            <select className={`${input} w-full`} value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r} ({ROLE_HELP[r]})</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy}
            className="bg-gradient-to-r from-pink-600 to-purple-600 text-white font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add user'}
          </button>
        </form>
      </div>

      <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-lg overflow-x-auto">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">Users ({users.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2 pr-3">Role</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Last sign-in</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUser.id;
              return (
                <tr key={u.id} data-testid={`user-row-${u.email}`} className="border-b border-slate-800/60">
                  <td className="py-2 pr-3 text-slate-200">{u.name}{isSelf && <span className="text-slate-500"> (you)</span>}</td>
                  <td className="py-2 pr-3 text-slate-400">{u.email}</td>
                  <td className="py-2 pr-3">
                    <select aria-label={`Role for ${u.email}`} className={`${input} py-1`} value={u.role} disabled={isSelf || !!pending[u.id]}
                      onChange={(e) => update(u, { role: e.target.value })}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    {!u.active ? <span className="text-rose-400">Deactivated</span>
                      : u.mustChangePassword ? <span className="text-amber-400">Password change pending</span>
                      : <span className="text-emerald-400">Active</span>}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                  <td className="py-2 space-x-2 whitespace-nowrap">
                    {isSelf ? (
                      <span className="text-xs text-slate-500">Use “Change password” in the header</span>
                    ) : (
                      <>
                        <button onClick={() => update(u, { active: !u.active })} disabled={!!pending[u.id]}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-2.5 py-1 rounded disabled:opacity-50">
                          {u.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button onClick={() => reset(u)} disabled={!!pending[u.id]}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-2.5 py-1 rounded disabled:opacity-50">
                          {pending[u.id] ? 'Working…' : 'Reset password'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
