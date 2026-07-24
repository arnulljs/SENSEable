// GaugeCard.jsx — Semicircle speedometer gauge for a sensor port
//
// TWO STATES, NOT ONE
// A channel has two independent facts about it, and collapsing them into a
// single badge loses information:
//
//   ACTIVE  — is this channel switched on and being monitored at all?
//             (operator intent: ON / OFF)
//   READING — given that it IS monitored, how healthy is the value?
//             (Normal / Warning / Fault / Offline)
//
// A disabled channel has no meaningful reading status — nobody is watching it —
// so it shows OFF and nothing else. A channel that's ON but silent shows
// ON + Offline, which is a real and distinct condition: we're monitoring it and
// it has stopped answering.
//
// MOTION
// Telemetry lands in discrete polls, so a naively re-rendered gauge teleports
// between values. A real dial has mass: the needle accelerates, sweeps, and
// settles with a slight overshoot. Both the needle and the arc fill are animated
// with CSS transitions rather than being redrawn per frame — the needle via a
// rotate() transform, and the arc via stroke-dashoffset on a fixed path. Neither
// can be done by interpolating the path `d` string, which is why the fill is
// drawn as one full semicircle that gets progressively revealed.

const STATUS_COLOR = {
  Normal:   '#22C55E',
  Warning:  '#F59E0B',
  Fault:    '#EF4444',
  Offline:  '#9CA3AF',
  Disabled: '#CBD5E1',
};

// Convert a standard-math angle (degrees, CCW from +x, y-up) to an SVG point.
// SVG's y-axis is inverted, so we negate the sin component.
function angleToPoint(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

// The full 180° sweep, 9-o'clock → 12 → 3-o'clock. Split into two ≤90° arcs to
// avoid SVG's large-arc-flag ambiguity. sweep-flag=1 traces the circle centred
// at (cx,cy); sweep-flag=0 would draw the mirrored circle on the wrong side and
// produce two disjointed half-arcs.
function buildSemicircle(cx, cy, r) {
  const left  = angleToPoint(cx, cy, r, 180);
  const top   = angleToPoint(cx, cy, r, 90);
  const right = angleToPoint(cx, cy, r, 0);
  return (
    `M ${left.x} ${left.y}` +
    ` A ${r} ${r} 0 0 1 ${top.x} ${top.y}` +
    ` A ${r} ${r} 0 0 1 ${right.x} ${right.y}`
  );
}

// Range endpoints can be raw ADC counts (up to 32767), which overflow the tick
// label and collide with the arc. Compact them instead of truncating.
function compact(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return String(v);
}

// A calibrated value may be 7.42 mg/L; a raw count is 26096. Same formatter has
// to read well for both.
function formatValue(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (Number.isInteger(n)) return String(n);
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2);
}

export default function GaugeCard({ port, onClick }) {
  const { id, label, unit, value, rangeMin, rangeMax, status } = port;
  const enabled = port.enabled !== false;

  const span = Number(rangeMax) - Number(rangeMin);
  const pct = (!Number.isFinite(Number(value)) || !Number.isFinite(span) || span <= 0)
    ? 0
    : Math.max(0, Math.min(1, (Number(value) - Number(rangeMin)) / span));

  const fillColor = enabled
    ? (STATUS_COLOR[status] ?? STATUS_COLOR.Offline)
    : STATUS_COLOR.Disabled;

  // SVG canvas: 140 × 96. Centre sits low so the arc has headroom and the tick
  // labels have somewhere to live without overlapping it.
  const cx = 70, cy = 74, r = 48;
  const arcPath = buildSemicircle(cx, cy, r);

  // The needle is drawn once pointing LEFT (the minimum) and rotated clockwise
  // by pct × 180°, so the transform is a single interpolatable number — which is
  // what lets CSS animate it. Drawing it at a computed endpoint each render
  // would give the teleporting behaviour we're trying to avoid.
  //
  // The pivot is expressed as translate() with the needle drawn from the local
  // origin, NOT as SVG's three-argument rotate(deg cx cy). Those two forms both
  // encode a pivot, and combining either with a CSS transform-origin applies the
  // offset twice — which visibly detaches the needle from its centre dot.
  const needleDeg = pct * 180;
  const needleLen = r - 12;

  // A touch of overshoot on the way to the target, the way a moving-coil meter
  // settles. Pure ease-out feels mechanical; this reads as a physical dial.
  const sweep = 'transform 900ms cubic-bezier(0.34, 1.30, 0.55, 1)';

  return (
    <div className="gauge-card" onClick={onClick} role="button" tabIndex={0}
         onKeyDown={e => e.key === 'Enter' && onClick?.()}>
      <div className="gauge-card-label" title={`${label} (${id})`}>{label}</div>

      <svg viewBox="0 0 140 96" className="gauge-svg"
           aria-label={`${label}: ${formatValue(value)} ${unit}, ${enabled ? 'on' : 'off'}, ${status}`}>
        {/* Background track */}
        <path d={arcPath} fill="none" stroke="#E5E7EB" strokeWidth={8} strokeLinecap="round" />

        {/* Value fill. pathLength=1 normalises the path so the dash maths is just
            the fraction — no need to know the real arc length. Revealing it via
            stroke-dashoffset is what makes the fill animate smoothly; the `d`
            attribute itself is not interpolatable. */}
        <path
          d={arcPath}
          fill="none"
          stroke={fillColor}
          strokeWidth={8}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - pct}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.34, 1.30, 0.55, 1), stroke 300ms ease' }}
        />

        {/* Needle. translate() puts the local origin exactly on the pivot, then
            rotate() spins about that origin — one pivot, applied once. The needle
            itself runs from (0,0) out to the left, so rotate(0) reads minimum and
            rotate(180) reads maximum. */}
        <g transform={`translate(${cx} ${cy}) rotate(${needleDeg})`}
           style={{ transition: sweep }}>
          <line x1={0} y1={0} x2={-needleLen} y2={0}
                stroke={enabled ? '#374151' : '#9CA3AF'} strokeWidth={2} strokeLinecap="round" />
        </g>

        {/* Pivot dot, drawn after the needle so it caps the join cleanly */}
        <circle cx={cx} cy={cy} r={4} fill={enabled ? '#374151' : '#9CA3AF'} />

        {/* Range ticks. Anchored to the outer edges rather than centred on the
            arc endpoints, so a five-digit raw count can't run off the canvas or
            collide with the opposite label. */}
        <text x={cx - r - 8} y={cy + 12} textAnchor="start" fontSize={7.5} fill="#9CA3AF">
          {compact(rangeMin)}
        </text>
        <text x={cx + r + 8} y={cy + 12} textAnchor="end" fontSize={7.5} fill="#9CA3AF">
          {compact(rangeMax)}
        </text>
      </svg>

      <div className="gauge-value-display">
        {enabled ? formatValue(value) : '—'}
        <span className="gauge-unit">{unit}</span>
      </div>

      {/* Two independent badges: whether the channel is switched on, and — only
          if it is — how its reading looks. */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center',
                    flexWrap: 'wrap', marginTop: 2 }}>
        <span
          title={enabled
            ? 'This channel is switched on and being monitored'
            : 'Switched off — not monitored, not recorded'}
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.05em',
            padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase',
            border: `1px solid ${enabled ? '#22C55E' : '#CBD5E1'}`,
            background: enabled ? 'rgba(34,197,94,.10)' : 'rgba(148,163,184,.12)',
            color: enabled ? '#15803D' : '#64748B',
          }}
        >
          <span style={{
            display: 'inline-block', width: 5, height: 5, borderRadius: 999, marginRight: 4,
            verticalAlign: 'middle',
            background: enabled ? '#22C55E' : '#94A3B8',
          }} />
          {enabled ? 'On' : 'Off'}
        </span>

        {enabled && <span className={`status-badge ${status}`}>{status}</span>}
      </div>
    </div>
  );
}
