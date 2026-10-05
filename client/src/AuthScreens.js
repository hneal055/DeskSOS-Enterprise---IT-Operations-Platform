import React, { useState } from 'react';
import { login, changePassword } from './auth';

const MIN_PASSWORD_LENGTH = 12;

function Shell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-sm bg-slate-900/80 border border-slate-800 rounded-lg p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold tracking-wide bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
            DeskSOS Enterprise
          </h1>
          <p className="text-sm font-semibold text-slate-200 mt-3">{title}</p>
          {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-slate-400 mb-1">{label}</span>
      <input
        {...props}
        className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm focus:outline-none focus:border-purple-500"
      />
    </label>
  );
}

function ErrorText({ message }) {
  return message ? (
    <p role="alert" className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded p-2">
      {message}
    </p>
  ) : null;
}

const buttonClass =
  'w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white font-semibold py-2.5 rounded shadow hover:opacity-90 transition disabled:opacity-50';

export function LoginScreen({ onSignedIn, notice }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      onSignedIn(await login(email, password));
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Sign in" subtitle={notice}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" type="email" autoComplete="username" value={email}
          onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <Field label="Password" type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} required />
        <ErrorText message={error} />
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </Shell>
  );
}

// Forced on first sign-in (no onCancel), or opened voluntarily from the
// dashboard header (with onCancel).
export function ChangePasswordScreen({ user, onChanged, onSignOut, onCancel }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < MIN_PASSWORD_LENGTH) return setError(`The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      onChanged(await changePassword(current, next));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={onCancel ? 'Change your password' : 'Choose a new password'}
      subtitle={onCancel
        ? `Signed in as ${user.email}. Your other sessions will be signed out.`
        : `Signed in as ${user.email}. You need to set your own password before continuing.`}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Current password" type="password" autoComplete="current-password" value={current}
          onChange={(e) => setCurrent(e.target.value)} required autoFocus />
        <Field label={`New password (at least ${MIN_PASSWORD_LENGTH} characters)`} type="password"
          autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} required />
        <ErrorText message={error} />
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? 'Saving…' : 'Set password'}
        </button>
        <button type="button" onClick={onCancel || onSignOut}
          className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold py-2 rounded transition">
          {onCancel ? 'Cancel' : 'Sign out'}
        </button>
      </form>
    </Shell>
  );
}
