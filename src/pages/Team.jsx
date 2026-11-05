// pages/Team.jsx — Organization member management.
// Designers can add and remove Operator accounts inside their own tenant;
// Operators get a read-only roster. This is the in-app counterpart to the
// "Designer accounts are given by us, and Designers create Operator
// accounts for their org" rule — everything here is scoped to
// `currentOrg`, the same tenant boundary used everywhere else in the app.
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

function initials(name) {
  return (name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('');
}

function formatDate(iso) {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '\u2014';
  }
}

export default function Team() {
  const { currentUser, currentOrg, orgUsers, isDesigner, inviteOperator, removeMember } = useAuth();

  const [showInvite, setShowInvite] = useState(false);
  const [fullName, setFullName]     = useState('');
  const [email, setEmail]           = useState('');
  const [error, setError]           = useState(null);
  const [created, setCreated]       = useState(null); // the invited member
  const [busy, setBusy]             = useState(false);
  const [listError, setListError]   = useState(null);

  async function handleInvite(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await inviteOperator({ fullName, email });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setCreated(res.member);
    setFullName(''); setEmail('');
  }

  async function handleRemove(userId, name) {
    if (!window.confirm(`Remove ${name} from ${currentOrg.name}? Their account is deleted and they lose access immediately.`)) return;
    setListError(null);
    const res = await removeMember(userId);
    if (!res.ok) setListError(res.error);
  }

  const seatsUsed = orgUsers.length;
  const seatsMax  = currentOrg?.maxUsers ?? 0;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Team</h1>
      </div>

      <div className="page-body">
        {/* Org summary + invite */}
        <div className="cal-card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{currentOrg?.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3 }}>
                {currentOrg?.plan && <>{currentOrg.plan} plan &middot; </>}
                Org code{' '}
                <span className="mono-chip" title="Operators use this to join the organization">{currentOrg?.orgCode ?? '—'}</span>
                {' '}&middot; Tenant ID{' '}
                {/* What each node's setup portal needs; links the nodes to this workspace. */}
                <span className="mono-chip" title="Enter this in each node's setup portal">{currentOrg?.tid ?? 'not assigned'}</span>
                {seatsMax > 0 && <> &middot; {seatsUsed} of {seatsMax} seats used</>}
              </div>
            </div>
            {isDesigner && (
              <button
                className="btn-primary"
                onClick={() => { setShowInvite(s => !s); setCreated(null); setError(null); }}
              >
                {showInvite ? 'Cancel' : '+ Add Operator'}
              </button>
            )}
          </div>

          {isDesigner && showInvite && (
            <form onSubmit={handleInvite} style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              {error && <div className="auth-error" style={{ marginBottom: 10 }}>{error}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
                <div>
                  <label className="auth-label" htmlFor="invite-name">Full Name</label>
                  <input id="invite-name" className="input-field" value={fullName}
                    onChange={e => setFullName(e.target.value)} required />
                </div>
                <div>
                  <label className="auth-label" htmlFor="invite-email">Email</label>
                  <input id="invite-email" className="input-field" type="email" value={email}
                    onChange={e => setEmail(e.target.value)} required />
                </div>
                <button className="cal-primary-btn" type="submit" disabled={busy} style={{ marginBottom: 0, width: 'auto', padding: '8px 16px', whiteSpace: 'nowrap' }}>
                  {busy ? 'Sending invite\u2026' : 'Send Invite'}
                </button>
              </div>
            </form>
          )}

          {created && (
            <div className="auth-success" style={{ marginTop: 14 }}>
              Invitation sent to <code>{created.email}</code>. <strong>{created.fullName}</strong> clicks the link in
              the email, chooses a password, and is signed in as an Operator. They show as &ldquo;Invited&rdquo; until
              then. The link expires after 24 hours; if it does, remove them and add them again.
            </div>
          )}
        </div>

        {/* Member list */}
        <div className="cal-card">
          <div className="manage-header">
            <span className="manage-title">Members</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{orgUsers.length} total</span>
          </div>
          {listError && <div className="auth-error" style={{ marginBottom: 10 }}>{listError}</div>}

          <div className="team-table">
            <div className="team-row team-row-head">
              <span>Name</span><span>Email</span><span>Role</span><span>Joined</span><span />
            </div>
            {orgUsers.map(u => (
              <div className="team-row" key={u.id}>
                <span className="team-name-cell">
                  <span className="team-avatar">{initials(u.fullName)}</span>
                  {u.fullName}
                  {u.id === currentUser.id && <span className="team-you-tag">You</span>}
                </span>
                <span className="team-email-cell">{u.email}</span>
                <span>
                  <span className={`role-badge ${u.roleId}`}>{u.roleId === 'designer' ? 'Designer' : 'Operator'}</span>
                  {u.status === 'invited' && <span className="team-you-tag" title="Hasn't accepted the invitation yet">Invited</span>}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatDate(u.createdAt)}</span>
                <span>
                  {isDesigner && u.roleId !== 'designer' && (
                    <button className="dp-del" title="Remove" onClick={() => handleRemove(u.id, u.fullName)}>Remove</button>
                  )}
                </span>
              </div>
            ))}
          </div>

          {!isDesigner && (
            <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 12 }}>
              Only your organization&rsquo;s Designer can add or remove team members.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
