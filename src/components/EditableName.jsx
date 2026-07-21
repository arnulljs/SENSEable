// EditableName.jsx — inline click-to-edit label used for device / expansion
// board / actuator names. Renders the text with a small pencil affordance;
// clicking it (only when `canEdit`) swaps to an input that commits on Enter or
// blur and cancels on Escape.
//
// `onRename(next)` MUST return a promise (it hits the backend). The parent is
// expected to update its own state optimistically; if the promise rejects, we
// snap the draft back to the last good `value`. Because the name lives in the
// shared devices state, a successful rename propagates to every page that
// renders this entity — overview, map, calibration, control — with no extra
// wiring.
import { useState, useRef, useEffect } from 'react';

const PencilIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none"
       stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.5 2.5l2 2L6 12l-2.8.8L4 10l7.5-7.5z" />
    <path d="M10.5 3.5l2 2" />
  </svg>
);

export default function EditableName({
  value,
  canEdit = false,
  onRename,
  className,
  title = 'Rename',
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const committing = useRef(false);

  // Keep the draft in sync when not actively editing (e.g. a poll refreshed it).
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editing]);

  function start(e) {
    e.stopPropagation();
    if (canEdit && !busy) { setDraft(value); setEditing(true); }
  }

  async function commit() {
    if (committing.current) return;      // guard: blur + Enter both fire
    committing.current = true;
    const next = draft.trim();
    setEditing(false);
    if (!next || next === value) { setDraft(value); committing.current = false; return; }
    setBusy(true);
    try {
      await onRename(next);
    } catch {
      setDraft(value);                   // revert on failure
    } finally {
      setBusy(false);
      committing.current = false;
    }
  }

  function cancel() { setDraft(value); setEditing(false); }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        onBlur={commit}
        maxLength={120}
        style={{
          font: 'inherit',
          color: 'var(--text-1, #0f172a)',
          background: 'var(--bg-1, #fff)',
          border: '1px solid var(--blue, #2563EB)',
          borderRadius: 4,
          padding: '1px 6px',
          minWidth: 90,
          maxWidth: 280,
        }}
      />
    );
  }

  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
      {canEdit && (
        <button
          type="button"
          onClick={start}
          title={title}
          aria-label={title}
          style={{
            border: 'none', background: 'none', cursor: busy ? 'wait' : 'pointer',
            padding: 2, lineHeight: 0, color: 'var(--text-3, #94a3b8)',
            opacity: busy ? 0.4 : 0.65, flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = busy ? '0.4' : '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = busy ? '0.4' : '0.65'; }}
        >
          <PencilIcon />
        </button>
      )}
    </span>
  );
}
