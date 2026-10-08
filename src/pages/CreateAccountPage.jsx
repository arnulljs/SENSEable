// pages/CreateAccountPage.jsx — Account creation, in the two shapes the
// thesis's role hierarchy actually supports:
//   • "Join an Organization"   → becomes an Operator inside an existing tenant.
//   • "Register an Organization" → becomes that tenant's first Designer.
// In production, registering a brand-new organization is a Tier 1 (Service
// Provider) action, not a public signup form — see the note rendered in
// that mode below. It's left open here so the prototype can be evaluated
// without a SENSEful staff workflow behind it.
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import AuthBrandPanel from '../components/AuthBrandPanel';
import { generateTid } from '../../api/_tid.js';

// What the provider hands to the organization after creating it.
function Handoff({ summary, pending, onDone }) {
  const [copied, setCopied] = useState(false);
  const text =
    `Organization: ${summary.orgName}\n` +
    `Device Tenant ID: ${summary.tid}\n` +
    `Designer sign-in: ${summary.email} (with the password set at registration)\n` +
    (summary.orgCode ? `Organization code (for operators to join): ${summary.orgCode}\n` : '') +
    `\nNode setup: power the node in setup mode, join the Wi-Fi network "SENSEable-Setup-<node>", ` +
    `and enter the Device Tenant ID above in the Tenant ID field.`;
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setCopied(false); window.getSelection()?.selectAllChildren(document.getElementById('handoff-text')); }
  }
  const row = (label, value, mono) => (
    <div style={{ display: 'grid', gap: 2, padding: '8px 0', borderTop: '1px solid var(--border-light, #e2e8f0)' }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>
      <span className={mono ? 'mono-chip' : undefined} style={{ justifySelf: 'start', fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <h1 className="auth-title">Organization set up</h1>
        <p className="auth-subtitle" style={{ marginBottom: 0 }}>
          Give these details to the organization. The Tenant ID is what links their nodes to this workspace.
        </p>
      </div>
      <div id="handoff-text" style={{ textAlign: 'left' }}>
        {row('Organization', summary.orgName)}
        {row('Device Tenant ID: enter in each node’s setup portal', summary.tid, true)}
        {row('Designer sign-in', summary.email)}
        {summary.orgCode && row('Organization code: operators use it to join', summary.orgCode, true)}
      </div>
      {pending && (
        <div className="auth-hint" style={{ fontSize: 13, marginTop: 0 }}>
          {pending} The organization code appears on the Team page after the first sign-in.
        </div>
      )}
      <button type="button" className="btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy details'}</button>
      <button type="button" className="auth-switch-link" onClick={onDone} style={{ justifySelf: 'center' }}>Go to sign in</button>
    </div>
  );
}

export default function CreateAccountPage({ onSwitchToLogin }) {
  const { registerOrganization, joinOrganization, authLoading } = useAuth();
  const [mode, setMode] = useState('join'); // 'join' | 'register'
  const [handoff, setHandoff] = useState(null); // { summary, pending }

  const [fullName, setFullName]               = useState('');
  const [email, setEmail]                     = useState('');
  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [orgCode, setOrgCode]                 = useState('');
  const [orgName, setOrgName]                 = useState('');
  const [isTest, setIsTest]                   = useState(false);
  const [error, setError]                     = useState(null);
  // Device Tenant ID, recomputed as the name is typed. The server derives it
  // again from the same name; this is the preview.
  const [tid, setTid] = useState(null);
  useEffect(() => {
    let stale = false;
    generateTid(orgName).then((t) => { if (!stale) setTid(t); }, () => { if (!stale) setTid(null); });
    return () => { stale = true; };
  }, [orgName]);

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
    if (mode === 'register' && !tid) {
      setError('The organization name needs at least two letters or numbers.');
      return;
    }
    const res = mode === 'join'
      ? await joinOrganization({ orgCode, fullName, email, password })
      : await registerOrganization({ orgName, fullName, email, password, isTest });
    if (!res.ok) { setError(res.error); return; }
    // With email confirmation on, nothing signs in yet: show what to hand over.
    // Without it, AuthContext sets currentUser and App.jsx swaps to the
    // signed-in shell, where the Team page shows the same details.
    if (mode === 'register' && res.summary) setHandoff({ summary: res.summary, pending: res.pendingConfirmation ? res.message : null });
    else if (res.pendingConfirmation) setError(res.message);
  }

  if (handoff) {
    return (
      <div className="auth-shell">
        <AuthBrandPanel />
        <div className="auth-form-panel">
          <div className="auth-form-card">
            <Handoff summary={handoff.summary} pending={handoff.pending} onDone={onSwitchToLogin} />
          </div>
        </div>
      </div>
    );
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
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  required
                />
                <p className="auth-hint">
                  In production this step is provisioned by the SENSEful team
                  (Tier 1 Service Provider). This form simulates that step for
                  prototype evaluation.
                </p>

                <label className="auth-label" htmlFor="signup-tid" style={{ marginTop: 12 }}>Device Tenant ID</label>
                <input
                  id="signup-tid" className="input-field" readOnly tabIndex={-1}
                  style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', background: 'var(--gray-bg)' }}
                  value={tid ?? ''} placeholder="Generated from the organization name"
                />
                <p className="auth-hint">
                  Generated from the organization name and fixed once registered. The organization
                  enters it in each node&rsquo;s setup portal; it links their nodes to this workspace.
                </p>
                <label className="auth-testflag">
                  <input type="checkbox" checked={isTest}
                    onChange={e => setIsTest(e.target.checked)} />
                  <span>This is a test account (can be wiped)</span>
                </label>
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
