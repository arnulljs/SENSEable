// PortPowerButton.jsx ───────────────────────────────────────────────────────
// Switches a single ADC channel on or off.
//
// WHY THIS CONTROL EXISTS
// An ADS1115 input with nothing wired to it doesn't read zero — it floats, and
// leakage current plus crosstalk from the neighbouring channel push it to a few
// thousand counts that drift around. The pipeline has no way to tell that from a
// real sensor, so an empty socket renders as a confident green gauge. Only a
// person knows the channel is empty; this is how they say so.
//
// THE CONFIRMATION IS DELIBERATE
// Disabling a channel that IS currently reporting is the dangerous case: it
// might be a working sensor someone else installed. So a channel with live data
// gets an explicit warning naming its current reading, while a channel that's
// already silent switches off without ceremony.
import { useState, useEffect, useRef } from 'react';

const PowerIcon = ({ on }) => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none"
       stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M8 2v6" />
    <path d={on ? 'M4.6 4.4a4.5 4.5 0 106.8 0' : 'M4.6 4.4a4.5 4.5 0 106.8 0'} />
    {!on && <path d="M2.5 13.5l11-11" strokeWidth="1.3" />}
  </svg>
);

export default function PortPowerButton({
  port,            // needs { id, label, enabled, active, value, unit, status }
  onToggle,        // (enabled, reason) => Promise
  canEdit = false,
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);

  // Click-away / Escape dismiss, so the popover never sits over the gauge.
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

  if (!canEdit) return null;

  const enabled = port.enabled !== false;

  async function apply(next, reason) {
    setBusy(true);
    setError(null);
    try {
      await onToggle(next, reason);
      setConfirming(false);
    } catch (e) {
      setError(e?.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }

  function click(e) {
    e.stopPropagation();
    if (!enabled) return apply(true, null);          // re-enabling is never risky
    // Disabling a channel that's actively reporting deserves a second look.
    if (port.active) return setConfirming(true);
    return apply(false, 'no sensor connected');
  }

  if (confirming) {
    return (
      <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
        <button type="button" disabled
                style={{ border: 'none', background: 'none', padding: 2, lineHeight: 0,
                         color: 'var(--warning, #B45309)' }}>
          <PowerIcon on />
        </button>
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40,
            width: 236, padding: 10, borderRadius: 8, textAlign: 'left',
            background: 'var(--bg-1, #fff)',
            border: '1px solid var(--warning, #F59E0B)',
            boxShadow: '0 8px 24px rgba(15,23,42,.16)',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning, #B45309)', marginBottom: 4 }}>
            This channel is live
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-2, #475569)', marginBottom: 8 }}>
            {port.id} is reporting
            {port.value != null && Number.isFinite(Number(port.value)) && (
              <> <strong>{Number(port.value).toFixed(2)} {port.unit}</strong></>
            )}
            . Switch off only if nothing is physically connected and this is
            stray voltage.
          </div>
          {error && (
            <div style={{ fontSize: 11, color: 'var(--fault, #DC2626)', marginBottom: 6 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button" disabled={busy}
              onClick={() => apply(false, 'disabled while active — assumed floating input')}
              style={{
                flex: 1, fontSize: 11, padding: '5px 8px', borderRadius: 5, cursor: 'pointer',
                border: '1px solid var(--warning, #F59E0B)',
                background: 'var(--warning, #F59E0B)', color: '#fff', opacity: busy ? 0.6 : 1,
              }}
            >{busy ? 'Disabling…' : 'Switch off'}</button>
            <button
              type="button" disabled={busy} onClick={() => setConfirming(false)}
              style={{
                flex: 1, fontSize: 11, padding: '5px 8px', borderRadius: 5, cursor: 'pointer',
                border: '1px solid var(--border, #E2E8F0)', background: 'transparent',
                color: 'var(--text-2, #475569)',
              }}
            >Keep on</button>
          </div>
        </div>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={click}
      disabled={busy}
      title={enabled
        ? 'Disable this channel (use for inputs with nothing connected)'
        : 'Re-enable this channel'}
      aria-label={enabled ? 'Disable channel' : 'Enable channel'}
      style={{
        border: 'none', background: 'none', cursor: busy ? 'wait' : 'pointer',
        padding: 2, lineHeight: 0, flexShrink: 0,
        color: enabled ? 'var(--text-3, #94A3B8)' : 'var(--blue, #2563EB)',
        opacity: busy ? 0.4 : (enabled ? 0.55 : 1),
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = busy ? '0.4' : (enabled ? '0.55' : '1'); }}
    >
      <PowerIcon on={enabled} />
    </button>
  );
}
