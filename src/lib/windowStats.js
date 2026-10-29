// windowStats.js ─────────────────────────────────────────────────────────────
// Firmware 2026-10-28 sends each reading as the mean of a window, with the
// samples behind it (n), the window length (winMs) and the extremes (min/max,
// already calibrated by the backend). These turn that into the labels the
// dashboard shows.

// Port status codes whose meaning a plain Warning/Fault badge would hide.
// 2: some sample in the window hit the ADC limit — clipped, not broken.
// 3: every read in the window failed.
export const CODE_LABEL = { 2: 'Saturated during window', 3: 'Read failed' };

// The badge text for a port or history row: the code's meaning when it is what
// drives the status, otherwise the status itself.
export function statusLabel(status, code) {
  if ((status === 'Warning' && code === 2) || (status === 'Fault' && code === 3)) return CODE_LABEL[code];
  return status;
}

// A status set by the node's code must survive the browser's own recompute
// from the value and safe range, which knows nothing about saturation or
// failed reads.
export const codeDrivesStatus = (code) => code === 2 || code === 3;

export const fmt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2);
};

// "min 4.91 · max 5.32 · n 30/30", or null when the row has none of it (older
// firmware). `low` flags a window with clearly fewer samples than seconds —
// failed reads, or the board was replugged mid-window.
export function windowLine(h) {
  if (!h || (h.n == null && h.min == null)) return null;
  const expected = Number.isFinite(h.winMs) && h.winMs > 0 ? Math.round(h.winMs / 1000) : null;
  const low = h.n != null && expected != null && h.n < expected * 0.9;
  const parts = [];
  if (h.min != null && h.max != null) parts.push(`min ${fmt(h.min)} · max ${fmt(h.max)}`);
  if (h.n != null) parts.push(`n ${h.n}${expected != null ? `/${expected}` : ''}`);
  return { text: parts.join(' · '), low };
}
