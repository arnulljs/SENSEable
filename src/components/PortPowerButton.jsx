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
//
// SWITCHING ON NEEDS A FORMULA
// New channels arrive disabled, and the backend refuses to enable one without a
// calibration formula (409). Clicking such a channel opens a picker: choose the
// formula and the channel is assigned it and switched on in one step.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useConfirmPopover, POPOVER_FIXED } from './useConfirmPopover';
import { fetchFormulas } from '../api';

const PowerIcon = ({ on }) => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none"
       stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M8 2v6" />
    <path d="M4.6 4.4a4.5 4.5 0 106.8 0" />
    {!on && <path d="M2.5 13.5l11-11" strokeWidth="1.3" />}
  </svg>
);

export default function PortPowerButton({
  port,            // needs { id, label, enabled, active, value, unit, status, formulaLabel }
  onToggle,        // (enabled, reason) => Promise
  onAssignFormula, // (label) => Promise — sets this port's calibration formula
  canEdit = false,
}) {
  const { busy, setBusy, confirming, setConfirming, error, setError, wrapRef, popRef } =
    useConfirmPopover();
  const [formulas, setFormulas] = useState(null);   // null = not loaded yet
  const [choice, setChoice] = useState('');
  // Which popover is open. Fixed when it opens: assigning the formula clears
  // needsFormula while the picker is still up, and the picker must not turn
  // into the "this channel is live" warning mid-action.
  const [picking, setPicking] = useState(false);

  if (!canEdit) return null;

  const enabled = port.enabled !== false;
  const needsFormula = !enabled && !port.formulaLabel;

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
    setPicking(needsFormula);
    if (needsFormula) {
      setError(null);
      setConfirming(true);
      fetchFormulas()
        .then((f) => setFormulas(Array.isArray(f) ? f : []))
        .catch((err) => { setFormulas([]); setError(`Could not load formulas — ${err.message}`); });
      return;
    }
    if (!enabled) return apply(true, null);          // calibrated, so enabling is safe
    // Disabling a channel that's actively reporting deserves a second look.
    if (port.active) return setConfirming(true);
    return apply(false, 'no sensor connected');
  }

  async function assignAndEnable() {
    setBusy(true);
    setError(null);
    try {
      await onAssignFormula(choice);
      await onToggle(true, null);
      setConfirming(false);
    } catch (e) {
      setError(e?.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (confirming && picking) {
    const canAssign = typeof onAssignFormula === 'function';
    return (
      <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
        <button type="button" disabled
                style={{ border: 'none', background: 'none', padding: 2, lineHeight: 0,
                         color: 'var(--blue, #2563EB)' }}>
          <PowerIcon on={false} />
        </button>
        {createPortal(<div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            ...POPOVER_FIXED,
            width: 272, padding: 10, borderRadius: 8, textAlign: 'left',
            background: 'var(--bg-1, #fff)',
            border: '1px solid var(--border, #E2E8F0)',
            boxShadow: '0 8px 24px rgba(15,23,42,.16)',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1, #0F172A)', marginBottom: 4 }}>
            Calibrate {port.id} to switch it on
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-2, #475569)', marginBottom: 8 }}>
            Pick the formula for the sensor wired to this input. New formulas are
            made on the Calibration page.
          </div>
          {formulas === null ? (
            <div style={{ fontSize: 11, color: 'var(--text-3, #94A3B8)', marginBottom: 8 }}>Loading formulas…</div>
          ) : formulas.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-3, #94A3B8)', marginBottom: 8 }}>
              No formulas yet — create one on the Calibration page first.
            </div>
          ) : (
            <select className="input-field" value={choice} disabled={busy || !canAssign}
                    onChange={(e) => setChoice(e.target.value)}
                    style={{ width: '100%', padding: '4px 7px', fontSize: 12, marginBottom: 8 }}>
              <option value="">— Choose a formula —</option>
              {formulas.map((f) => <option key={f.id} value={f.label}>{f.label}</option>)}
            </select>
          )}
          {error && (
            <div style={{ fontSize: 11, color: 'var(--fault, #DC2626)', marginBottom: 6 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button" disabled={busy || !choice || !canAssign} onClick={assignAndEnable}
              style={{
                flex: 1, fontSize: 11, padding: '5px 8px', borderRadius: 5,
                cursor: busy || !choice ? 'default' : 'pointer',
                border: '1px solid var(--blue, #2563EB)', background: 'var(--blue, #2563EB)',
                color: '#fff', opacity: busy || !choice ? 0.55 : 1,
              }}
            >{busy ? 'Switching on…' : 'Assign & switch on'}</button>
            <button
              type="button" disabled={busy} onClick={() => setConfirming(false)}
              style={{
                flex: 1, fontSize: 11, padding: '5px 8px', borderRadius: 5, cursor: 'pointer',
                border: '1px solid var(--border, #E2E8F0)', background: 'transparent',
                color: 'var(--text-2, #475569)',
              }}
            >Cancel</button>
          </div>
        </div>, document.body)}
      </span>
    );
  }

  if (confirming) {
    return (
      <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
        <button type="button" disabled
                style={{ border: 'none', background: 'none', padding: 2, lineHeight: 0,
                         color: 'var(--warning, #B45309)' }}>
          <PowerIcon on />
        </button>
        {createPortal(<div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            ...POPOVER_FIXED,
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
        </div>, document.body)}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={click}
      disabled={busy}
      title={error ?? (enabled
        ? 'Disable this channel (use for inputs with nothing connected)'
        : needsFormula
          ? `${port.id} needs a calibration formula — click to choose one and switch it on`
          : 'Enable this channel')}
      aria-label={enabled ? 'Disable channel' : 'Enable channel'}
      style={{
        border: 'none', background: 'none',
        cursor: busy ? 'wait' : 'pointer',
        padding: 2, lineHeight: 0, flexShrink: 0,
        color: error ? 'var(--fault, #DC2626)'
          : (enabled || needsFormula ? 'var(--text-3, #94A3B8)' : 'var(--blue, #2563EB)'),
        opacity: busy ? 0.4 : (enabled ? 0.55 : 1),
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = busy ? '0.4' : (enabled ? '0.55' : '1'); }}
    >
      <PowerIcon on={enabled} />
    </button>
  );
}
