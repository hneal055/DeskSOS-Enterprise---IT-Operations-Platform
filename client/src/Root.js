import React, { useCallback, useEffect, useState } from 'react';
import App from './App';
import { LoginScreen, ChangePasswordScreen } from './AuthScreens';
import { clearToken, fetchCurrentUser, logout, setSessionHandlers } from './auth';

// Decides what to show: sign-in, the forced password change, or the dashboard.
export default function Root() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const endSession = useCallback((message) => {
    clearToken();
    setUser(null);
    setNotice(message || '');
  }, []);

  useEffect(() => {
    setSessionHandlers({
      ended: endSession,
      passwordChangeRequired: () => setUser((u) => (u ? { ...u, mustChangePassword: true } : u)),
    });
    // Resume a session saved in this tab, if its token is still valid
    fetchCurrentUser()
      .then((u) => setUser(u))
      .finally(() => setChecking(false));
  }, [endSession]);

  const signOut = async () => {
    await logout();
    endSession('You have signed out.');
  };

  if (checking) {
    return <div className="min-h-screen bg-slate-950" />;
  }
  if (!user) {
    return <LoginScreen notice={notice} onSignedIn={(u) => { setNotice(''); setUser(u); }} />;
  }
  if (user.mustChangePassword) {
    return <ChangePasswordScreen user={user} onChanged={setUser} onSignOut={signOut} />;
  }
  if (changingPassword) {
    return (
      <ChangePasswordScreen
        user={user}
        onChanged={(u) => { setUser(u); setChangingPassword(false); }}
        onCancel={() => setChangingPassword(false)}
      />
    );
  }
  return (
    <App user={user} onSignOut={signOut} onSessionEnded={endSession}
      onChangePassword={() => setChangingPassword(true)} />
  );
}
