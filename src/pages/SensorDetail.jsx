// SensorDetail.jsx — Per-port detail view (gauge + trend + history)
import GaugeCard from '../components/GaugeCard';

// ── Tiny SVG line chart ──────────────────────────────────────────────────────
function TrendChart({ history, rangeMin, rangeMax }) {
  const W = 320, H = 80, PAD_X = 10, PAD_Y = 8;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;
  const span = rangeMax - rangeMin || 1;
  const n = history.length;

  const pts = history.map((h, i) => ({
    x: PAD_X + (i / Math.max(n - 1, 1)) * innerW,
    y: PAD_Y + innerH - ((h.value - rangeMin) / span) * innerH,
  }));

  const polyline = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Fill area under the line
  const areaPoints = [
    `${pts[0].x},${H - PAD_Y}`,
    ...pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `${pts[pts.length - 1].x},${H - PAD_Y}`,
  ].join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart">
      {/* Horizontal grid lines */}
      {[0, 0.5, 1].map(t => (
        <line key={t}
          x1={PAD_X} y1={PAD_Y + innerH * (1 - t)}
          x2={W - PAD_X} y2={PAD_Y + innerH * (1 - t)}
          stroke="#E5E7EB" strokeWidth={1}
        />
      ))}

      {/* Fill area */}
      <polygon points={areaPoints} fill="#2563EB" opacity={0.07} />

      {/* Line */}
      <polyline points={polyline} fill="none" stroke="#2563EB" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* Data points */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === n - 1 ? 4 : 2.5}
          fill={i === n - 1 ? '#2563EB' : '#93C5FD'}
          stroke={i === n - 1 ? 'white' : 'none'}
          strokeWidth={i === n - 1 ? 1.5 : 0}
        />
      ))}
    </svg>
  );
}

// ── Sensor Detail Page ───────────────────────────────────────────────────────
export default function SensorDetail({ device, module, port, onBack }) {
  const { label, unit, value, rangeMin, rangeMax, safeMin, safeMax, status, history } = port;

  function handleExport() {
    const json = JSON.stringify(history, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label.replace(/\s+/g, '_')}_history.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Header */}
      <div className="detail-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, flex: 1 }}>
          <button className="back-btn" onClick={onBack}>
            ← Back
          </button>
          <div className="detail-title-group">
            <h1 className="detail-title">{label} — Sensor Details</h1>
            <p className="detail-subtitle">
              {module.name} · Port {port.id}
            </p>
          </div>
        </div>
        <button className="edit-sensor-btn">Edit Sensor</button>
      </div>

      {/* Three-column cards row */}
      <div className="detail-cards-row">
        {/* 1. Sensor Reading */}
        <div className="detail-card">
          <div className="detail-card-title">Sensor Reading</div>
          <GaugeCard port={port} />
          <div className="reading-range">
            <span>Range: {rangeMin}–{rangeMax} {unit}</span><br />
            <span>Safe: {safeMin}–{safeMax} {unit}</span>
          </div>
        </div>

        {/* 2. Data Trend Tracker */}
        <div className="detail-card">
          <div className="detail-card-title">Data Trend Tracker</div>
          <TrendChart history={history} rangeMin={rangeMin} rangeMax={rangeMax} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
            <span>{history[0]?.timestamp}</span>
            <span>{history[history.length - 1]?.timestamp}</span>
          </div>
        </div>

        {/* 3. Real-Time Value */}
        <div className="detail-card">
          <div className="detail-card-title">Real Time Value</div>
          <div className="rtv-display">
            {value}
            <span className="rtv-unit">{unit}</span>
          </div>
          <span className={`status-badge ${status}`}>{status}</span>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-3)' }}>
            <div>Device: {device.name}</div>
            <div>Comm: {device.commMode}</div>
            {device.rssi && <div>RSSI: {device.rssi} dBm</div>}
          </div>
        </div>
      </div>

      {/* Data History */}
      <div className="detail-history">
        <div className="history-header">
          <span className="history-title">Data History</span>
          <button className="export-btn" onClick={handleExport}>
            ↓ Export JSON
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((row, i) => (
              <tr key={i}>
                <td className="mono">{row.timestamp}</td>
                <td className="mono">{row.value} {unit}</td>
                <td><span className={`status-badge ${row.status}`}>{row.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
