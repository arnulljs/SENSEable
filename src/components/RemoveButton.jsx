// RemoveButton.jsx ──────────────────────────────────────────────────────────
// Removes a piece of hardware from the inventory.
//
// The rule this enforces visually: inventory is never removed just because
// something went quiet — a node that drops off for ten minutes would otherwise
// take an operator's calibration work with it. Removal is a deliberate act, and
// only permitted while the target is genuinely offline.
//
// So the button is hidden entirely while `active` is true. The backend refuses
// the same case with a 409 regardless; hiding it here just avoids offering an
// action that cannot succeed.
//
// The confirmation renders as an ANCHORED POPOVER rather than expanding inline.
// Inline expansion pushed the surrounding header content sideways and, in tight
// rows like a board header, overlapped the name and address text. A popover is
// taken out of flow, so nothing around it moves.
import { useState, useEffect, useRef } from 'react';

const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none"
       stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4" />
    <path d="M6.5 7v4M9.5 7v4" />
  </svg>
);

export default function RemoveButton({
  active,          // currently reporting → removal refused, button hidden
  label,           // what's being removed, for the confirm prompt
  onRemove,        // () => Promise
  title = 'Remove',
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);

  // Click-away and Escape both dismiss, so the popover can never be left
  // stranded over content the operator is trying to read.
  useEffect(() => {
    if (!confirming) return undefined;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setConfirming(false); };
    const onKey = (e) => { if (e.key === 'Escape') setConfirming(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [confirming]);

  if (active) return null;

  async function doRemove(e) {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      await onRemove();
      // No cleanup needed — the parent drops this row from state on success.
    } catch (err) {
      setError(err?.message ?? 'Remove failed');
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <span ref={wrapRef}
          style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      <button
        type="button"
        title={title}
        aria-label={title}
        onClick={(e) => { e.stopPropagation(); setError(null); setConfirming(v => !v); }}
        style={{
          border: 'none', background: 'none', cursor: 'pointer', padding: 2,
          lineHeight: 0, color: confirming ? 'var(--fault, #DC2626)' : 'var(--text-3, #94A3B8)',
          opacity: confirming ? 1 : 0.6, flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1';
                               e.currentTarget.style.color = 'var(--fault, #DC2626)'; }}
        onMouseLeave={(e) => { if (confirming) return;
                               e.currentTarget.style.opacity = '0.6';
                               e.currentTarget.style.color = 'var(--text-3, #94A3B8)'; }}
      >
        <TrashIcon />
      </button>

      {confirming && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40,
            width: 232, padding: 10, borderRadius: 8, textAlign: 'left',
            background: 'var(--bg-1, #fff)',
            border: '1px solid var(--border, #E2E8F0)',
            boxShadow: '0 8px 24px rgba(15,23,42,.14)',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1, #0F172A)', marginBottom: 4 }}>
            Remove {label}?
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-2, #475569)', marginBottom: 8 }}>
            Its settings and history are deleted. If the hardware reconnects it
            will be added back as a new, unconfigured entry.
          </div>
          {error && (
            <div style={{ fontSize: 11, color: 'var(--fault, #DC2626)', marginBottom: 6 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button" onClick={doRemove} disabled={busy}
              style={{
                flex: 1, fontSize: 11, padding: '5px 8px', borderRadius: 5, cursor: 'pointer',
                border: '1px solid var(--fault, #DC2626)', background: 'var(--fault, #DC2626)',
                color: '#fff', opacity: busy ? 0.6 : 1,
              }}
            >{busy ? 'Removing…' : 'Remove'}</button>
            <button
              type="button" disabled={busy}
              onClick={(e) => { e.stopPropagation(); setConfirming(false); }}
              style={{
                flex: 1, fontSize: 11, padding: '5px 8px', borderRadius: 5, cursor: 'pointer',
                border: '1px solid var(--border, #E2E8F0)', background: 'transparent',
                color: 'var(--text-2, #475569)',
              }}
            >Cancel</button>
          </div>
        </div>
      )}
    </span>
  );
}
