// pages/SetPasswordPage.jsx — choose a password after an email link.
// Two links land here (AuthContext.passwordSetup):
//   invite  a Designer added this person as an Operator; the invite email's
//           link signed them in with their email confirmed, and they have no
//           password yet.
//   reset   "Forgot password" on the sign-in screen.
// Either way the link already created a session, so this is just updateUser.
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import AuthBrandPanel from '../components/AuthBrandPanel';

export default function SetPasswordPage() {
  const { passwordSetup, sessionReady, session, linkError, completePasswordSetup, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState(null);
  const [busy, setBusy]         = useState(false);

  const invite = passwordSetup === 'invite';

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    setBusy(true);
    const res = await completePasswordSetup(password);
    setBusy(false);
    if (!res.ok) setError(res.error);
  }

  // The link failed (expired, already used) or never produced a session.
  const dead = linkError || (sessionReady && !session);

  return (
    <div className="auth-shell">
      <AuthBrandPanel />
      <div className="auth-form-panel">
        <div className="auth-form-card">
          <h1 className="auth-title">{invite ? 'Welcome — set your password' : 'Set a new password'}</h1>
          <p className="auth-subtitle">
            {invite
              ? 'Your organization added you as an Operator. Choose a password to finish setting up your account.'
              : 'Choose a new password for your account.'}
          </p>

          {!sessionReady && !linkError && <p className="auth-subtitle">Checking your link&hellip;</p>}

          {dead && (
            <>
              <div className="auth-error">
                {linkError
                  ? `This link can't be used: ${linkError}.`
                  : 'This link has expired or was already used.'}{' '}
                {invite
                  ? 'Ask your Designer to remove and add you again, or use “Forgot password” on the sign-in screen.'
                  : 'Request a new one with “Forgot password” on the sign-in screen.'}
              </div>
              <button type="button" className="btn-primary auth-submit-btn"
                onClick={async () => { window.history.replaceState(null, '', '/'); await logout(); window.location.reload(); }}>
                Go to sign in
              </button>
            </>
          )}

          {sessionReady && session && !linkError && (
            <form onSubmit={handleSubmit}>
              {error && <div className="auth-error">{error}</div>}
              <label className="auth-label">Account</label>
              <input className="input-field" value={session.user.email} disabled />

              <label className="auth-label" htmlFor="new-pw" style={{ marginTop: 12 }}>New password</label>
              <div className="auth-password-row">
                <input id="new-pw" className="input-field" type={showPw ? 'text' : 'password'}
                  autoComplete="new-password" minLength={6} required
                  value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="auth-pw-toggle" onClick={() => setShowPw((s) => !s)}>
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>

              <label className="auth-label" htmlFor="new-pw2" style={{ marginTop: 12 }}>Confirm password</label>
              <input id="new-pw2" className="input-field" type={showPw ? 'text' : 'password'}
                autoComplete="new-password" minLength={6} required
                value={confirm} onChange={(e) => setConfirm(e.target.value)} />

              <button className="btn-primary auth-submit-btn" type="submit" disabled={busy}>
                {busy ? 'Saving…' : invite ? 'Set password and continue' : 'Save new password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
