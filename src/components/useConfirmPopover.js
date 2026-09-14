// useConfirmPopover.js ───────────────────────────────────────────────────────
// The state and dismissal behaviour shared by every anchored confirm popover:
// busy/error while the action runs, and click-away + Escape to dismiss.
//
// The confirmation renders as an ANCHORED POPOVER rather than expanding inline.
// Inline expansion pushed surrounding header content sideways and, in tight
// rows like a board header, overlapped the name and address text. A popover is
// taken out of flow, so nothing around it moves — and it can never be left
// stranded over content the operator is trying to read.
import { useState, useEffect, useRef } from 'react';

export function useConfirmPopover() {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);

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

  return { busy, setBusy, confirming, setConfirming, error, setError, wrapRef };
}
