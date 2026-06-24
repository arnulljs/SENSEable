// pages/CreateAccountPage.jsx — Account creation, in the two shapes the
// thesis's role hierarchy actually supports:
//   • "Join an Organization"   → becomes an Operator inside an existing tenant.
//   • "Register an Organization" → becomes that tenant's first Designer.
// In production, registering a brand-new organization is a Tier 1 (Service
// Provider) action, not a public signup form — see the note rendered in
// that mode below. It's left open here so the prototype can be evaluated
// without a SENSEful staff workflow behind it.
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import AuthBrandPanel from '../components/AuthBrandPanel';

export default function CreateAccountPage({ onSwitchToLogin }) {
  const { registerOrganization, joinOrganization, authLoading } = useAuth();
  const [mode, setMode] = useState('join'); // 'join' | 'register'

  const [fullName, setFullName]               = useState('');
  const [email, setEmail]                     = useState('');
  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [orgCode, setOrgCode]                 = useState('');
  const [orgName, setOrgName]                 = useState('');
  const [error, setError]                     = useState(null);

  function switchMode(next) {
    setMode(next);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords don\u2019t match.');
      return;
    }
    const res = mode === 'join'
      ? await joinOrganization({ orgCode, fullName, email, password })
      : await registerOrganization({ orgName, fullName, email, password });
    if (!res.ok) setError(res.error);
    // On success AuthContext sets currentUser — App.jsx swaps to the
    // signed-in shell automatically, no navigation call needed here.
  }

  return (
    <div className="auth-shell">
      <AuthBrandPanel />

      <div className="auth-form-panel">
        <div className="auth-form-card">
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-subtitle">
            {mode === 'join'
              ? 'Join your organization\u2019s existing workspace as an Operator.'
              : 'Register a new organization workspace as its Designer.'}
          </p>

          <div className="auth-mode-toggle">
            <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => switchMode('join')}>
              Join an Organization
            </button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>
              Register an Organization
            </button>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            {mode === 'join' ? (
              <>
                <label className="auth-label" htmlFor="signup-orgcode">Organization Code</label>
                <input
                  id="signup-orgcode" className="input-field" placeholder="e.g. AQUA-7421"
                  value={orgCode} onChange={e => setOrgCode(e.target.value)} required
                />
                <p className="auth-hint">Ask your organization&rsquo;s Designer for this code.</p>
              </>
            ) : (
              <>
                <label className="auth-label" htmlFor="signup-orgname">Organization Name</label>
                <input
                  id="signup-orgname" className="input-field" placeholder="e.g. Mactan Bay Aquafarms"
                  value={orgName} onChange={e => setOrgName(e.target.value)} required
                />
                <p className="auth-hint">
                  In production this step is provisioned by the SENSEful team
                  (Tier 1 Service Provider). This form simulates that step for
                  prototype evaluation.
                </p>
              </>
            )}

            <label className="auth-label" htmlFor="signup-name" style={{ marginTop: 12 }}>Full Name</label>
            <input
              id="signup-name" className="input-field" placeholder="Juan Dela Cruz"
              value={fullName} onChange={e => setFullName(e.target.value)} required
            />

            <label className="auth-label" htmlFor="signup-email" style={{ marginTop: 12 }}>Email</label>
            <input
              id="signup-email" className="input-field" type="email" placeholder="you@organization.ph"
              value={email} onChange={e => setEmail(e.target.value)} required
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <div>
                <label className="auth-label" htmlFor="signup-pw">Password</label>
                <input
                  id="signup-pw" className="input-field" type="password" minLength={6}
                  value={password} onChange={e => setPassword(e.target.value)} required
                />
              </div>
              <div>
                <label className="auth-label" htmlFor="signup-pw2">Confirm</label>
                <input
                  id="signup-pw2" className="input-field" type="password" minLength={6}
                  value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required
                />
              </div>
            </div>

            <button className="btn-primary auth-submit-btn" type="submit" disabled={authLoading}>
              {authLoading
                ? 'Creating account\u2026'
                : mode === 'join' ? 'Join Organization' : 'Register Organization'}
            </button>
          </form>

          <div className="auth-switch">
            Already have an account?{' '}
            <button type="button" className="auth-switch-link" onClick={onSwitchToLogin}>Sign in</button>
          </div>
        </div>
      </div>
    </div>
  );
}
