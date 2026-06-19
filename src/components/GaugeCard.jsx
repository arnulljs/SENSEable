// GaugeCard.jsx — Semicircle speedometer gauge for a sensor port

const STATUS_COLOR = {
  Normal:  '#22C55E',
  Warning: '#F59E0B',
  Fault:   '#EF4444',
  Offline: '#9CA3AF',
};

// Convert a standard-math angle (degrees, CCW from +x, y-up) to an SVG point
// SVG y-axis is inverted, so we negate the sin component.
function angleToPoint(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

// Build the SVG arc path for the gauge fill.
// The gauge sweeps 180° from 9-o'clock (left) to 3-o'clock (right) through 12-o'clock (top).
// In standard math angles: left = 180°, top = 90°, right = 0°.
// pct: 0 (left/min) → 1 (right/max)
//
// We split into two ≤90° arcs at the top to avoid SVG large-arc-flag ambiguity.
// sweep-flag=1 traces the correct circle (centered at cx,cy) going left→top→right;
// sweep-flag=0 would draw the mirrored circle on the wrong side, producing two
// disjointed half-arcs instead of one continuous semicircle.
function buildFillPath(cx, cy, r, pct) {
  if (pct <= 0) return null;
  const clamped = Math.min(pct, 1);

  // Current angle: from 180° (left) down to 0° (right) as pct goes 0→1
  const currentAngle = 180 - clamped * 180;
  const end = angleToPoint(cx, cy, r, currentAngle);
  const left = angleToPoint(cx, cy, r, 180);
  const top  = angleToPoint(cx, cy, r, 90);

  if (clamped <= 0.5) {
    // Single arc: left → current point (0–90°)
    return `M ${left.x} ${left.y} A ${r} ${r} 0 0 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
  }
  // Two arcs: left → top, then top → current point (each ≤90°)
  return (
    `M ${left.x} ${left.y}` +
    ` A ${r} ${r} 0 0 1 ${top.x} ${top.y}` +
    ` A ${r} ${r} 0 0 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`
  );
}

// Full background semicircle (two 90° arcs, no ambiguity)
function buildBgPath(cx, cy, r) {
  const left = angleToPoint(cx, cy, r, 180);
  const top  = angleToPoint(cx, cy, r, 90);
  const right = angleToPoint(cx, cy, r, 0);
  return (
    `M ${left.x} ${left.y}` +
    ` A ${r} ${r} 0 0 1 ${top.x} ${top.y}` +
    ` A ${r} ${r} 0 0 1 ${right.x} ${right.y}`
  );
}

export default function GaugeCard({ port, onClick }) {
  const { id, label, unit, value, rangeMin, rangeMax, status } = port;

  const pct = Math.max(0, Math.min(1, (value - rangeMin) / (rangeMax - rangeMin)));
  const fillColor = STATUS_COLOR[status] ?? STATUS_COLOR.Offline;

  // SVG canvas: 140 wide × 90 tall; gauge center slightly below midpoint for labels
  const cx = 70, cy = 72, r = 50;
  const bgPath   = buildBgPath(cx, cy, r);
  const fillPath = buildFillPath(cx, cy, r, pct);

  // Needle: from center toward current angle
  const needleAngle = 180 - pct * 180;
  const needleTip = angleToPoint(cx, cy, r - 11, needleAngle);

  // Range labels sit just below the arc endpoints
  const leftLabel  = angleToPoint(cx, cy, r + 10, 180);
  const rightLabel = angleToPoint(cx, cy, r + 10, 0);

  return (
    <div className="gauge-card" onClick={onClick} role="button" tabIndex={0}
         onKeyDown={e => e.key === 'Enter' && onClick?.()}>
      <div className="gauge-card-label">{label}</div>

      <svg viewBox="0 0 140 90" className="gauge-svg" aria-label={`${label}: ${value} ${unit}`}>
        {/* Background arc */}
        <path d={bgPath} fill="none" stroke="#E5E7EB" strokeWidth={8} strokeLinecap="round" />

        {/* Coloured fill arc */}
        {fillPath && (
          <path d={fillPath} fill="none" stroke={fillColor} strokeWidth={8} strokeLinecap="round" />
        )}

        {/* Needle */}
        <line
          x1={cx} y1={cy}
          x2={needleTip.x} y2={needleTip.y}
          stroke="#374151" strokeWidth={2} strokeLinecap="round"
        />

        {/* Centre pivot dot */}
        <circle cx={cx} cy={cy} r={4} fill="#374151" />

        {/* Min / max labels */}
        <text x={leftLabel.x}  y={leftLabel.y + 4} textAnchor="middle" fontSize={8.5} fill="#9CA3AF">{rangeMin}</text>
        <text x={rightLabel.x} y={rightLabel.y + 4} textAnchor="middle" fontSize={8.5} fill="#9CA3AF">{rangeMax}</text>
      </svg>

      <div className="gauge-value-display">
        {value}
        <span className="gauge-unit">{unit}</span>
      </div>

      <span className={`status-badge ${status}`}>{status}</span>
    </div>
  );
}
