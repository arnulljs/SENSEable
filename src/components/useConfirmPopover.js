// useConfirmPopover.js ───────────────────────────────────────────────────────
// The state and dismissal behaviour shared by every anchored confirm popover:
// busy/error while the action runs, and click-away + Escape to dismiss.
//
// The confirmation renders as an ANCHORED POPOVER rather than expanding inline.
// Inline expansion pushed surrounding header content sideways and, in tight
// rows like a board header, overlapped the name and address text. A popover is
// taken out of flow, so nothing around it moves — and it can never be left
// stranded over content the operator is trying to read.
//
// It is rendered into document.body (portal) with position: fixed, placed next
// to its button and kept inside the window: drawn inside the card, the cards'
// overflow:hidden cut it off, and next to the left-most gauge it ran off-screen.
// Callers: <div ref={popRef} style={{ ...POPOVER_FIXED, … }}> via createPortal.
import { useState, useEffect, useLayoutEffect, useRef } from 'react';

export const POPOVER_FIXED = { position: 'fixed', top: 0, left: 0, zIndex: 1000, visibility: 'hidden' };

export function useConfirmPopover() {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);
  const popRef = useRef(null);

  // Below the button, right edges aligned; above it when there is no room
  // below; always at least 8px inside the window. Written straight to the
  // element (no state) and redone on scroll/resize so it follows its button.
  useLayoutEffect(() => {
    if (!confirming) return undefined;
    const place = () => {
      const a = wrapRef.current?.getBoundingClientRect();
      const p = popRef.current;
      if (!a || !p) return;
      const m = 8, gap = 6, w = p.offsetWidth, h = p.offsetHeight;
      const left = Math.max(m, Math.min(a.right - w, window.innerWidth - w - m));
      const below = a.bottom + gap;
      const top = below + h > window.innerHeight - m && a.top - gap - h >= m ? a.top - gap - h : below;
      Object.assign(p.style, { left: `${left}px`, top: `${top}px`, visibility: 'visible' });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [confirming]);

  useEffect(() => {
    if (!confirming) return undefined;
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) setConfirming(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setConfirming(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [confirming]);

  return { busy, setBusy, confirming, setConfirming, error, setError, wrapRef, popRef };
}
