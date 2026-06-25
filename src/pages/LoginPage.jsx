// pages/LoginPage.jsx — Sign-in screen.
// Validates against AuthContext's mock user store today; the only thing
// that changes when a real backend exists is what happens inside
// `login()` in AuthContext.jsx — this component doesn't need to change.
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import AuthBrandPanel from '../components/AuthBrandPanel';

// Seeded accounts (see mockData.js) — surfaced here so the prototype can
// be evaluated end-to-end (all three role/org combinations) without
// anyone having to read the source to find working credentials.
const DEMO_ACCOUNTS = [
  { label: 'Designer \u00b7 AquaTech Hatchery Corp',      email: 'mariz@aquatech.ph', password: 'designer123' },
  { label: 'Operator \u00b7 AquaTech Hatchery Corp',      email: 'jay@aquatech.ph',   password: 'operator123' },
  { label: 'Designer \u00b7 Lapu-Lapu Bay Aquafarms',     email: 'dane@llba.ph',      password: 'designer123' },
];

export default function LoginPage({ onSwitchToSignup }) {
  const { login, authLoading } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState(null);
  const [showDemo, setShowDemo] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const res = await login(email, password);
    if (!res.ok) setError(res.error);
  }

  function fillDemo(acc) {
    setEmail(acc.email);
    setPassword(acc.password);
    setError(null);
  }

  return (
    <div className="auth-shell">
      <AuthBrandPanel />

      <div className="auth-form-panel">
        <div className="auth-form-card">
          <h1 className="auth-title">Sign in</h1>
          <p className="auth-subtitle">Monitor and manage your organization&rsquo;s sensor network.</p>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <label className="auth-label" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="input-field" type="email" autoComplete="email"
              placeholder="you@organization.ph"
              value={email} onChange={e => setEmail(e.target.value)} required
            />

            <label className="auth-label" htmlFor="login-pw" style={{ marginTop: 12 }}>Password</label>
            <div className="auth-password-row">
              <input
                id="login-pw"
                className="input-field" type={showPw ? 'text' : 'password'} autoComplete="current-password"
                placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} required
              />
              <button type="button" className="auth-pw-toggle" onClick={() => setShowPw(s => !s)}>
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>

            <button className="btn-primary auth-submit-btn" type="submit" disabled={authLoading}>
              {authLoading ? 'Signing in\u2026' : 'Sign in'}
            </button>
          </form>

          <button type="button" className="auth-link-btn" onClick={() => setShowDemo(s => !s)}>
            {showDemo ? 'Hide demo accounts' : 'Try a demo account'}
          </button>
          {showDemo && (
            <div className="auth-demo-list">
              {DEMO_ACCOUNTS.map(acc => (
                <button key={acc.email} type="button" className="auth-demo-item" onClick={() => fillDemo(acc)}>
                  <span>{acc.label}</span>
                  <span className="auth-demo-email">{acc.email}</span>
                </button>
              ))}
            </div>
          )}

          <div className="auth-switch">
            Don&rsquo;t have an organization yet?{' '}
            <button type="button" className="auth-switch-link" onClick={onSwitchToSignup}>
              Create an account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
