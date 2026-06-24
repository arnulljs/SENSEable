// SensorDetail.jsx — Per-port detail view (gauge + trend + history + Edit Sensor)
import { useState } from 'react';
import GaugeCard from '../components/GaugeCard';
import { sensorProfiles as defaultProfiles } from '../mockData';

// Saved sensor profiles persist in localStorage (same pattern as the
// Interactive Map's named save profiles) so they survive page navigation
// and reloads, not just the lifetime of this component. Seeded from
// mockData's defaults the first time, then the person's own saved/edited/
// deleted profiles take over.
const PROFILES_KEY = 'senseful_sensor_profiles';

function loadProfiles() {
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    return raw ? JSON.parse(raw) : defaultProfiles;
  } catch {
    return defaultProfiles;
  }
}

function persistProfiles(profiles) {
  try {
    window.localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // Storage unavailable or full — saved profiles still work for this
    // session, they just won't survive a reload.
  }
}

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

// ── Edit Sensor Modal ────────────────────────────────────────────────────────
// Lets the user revise a port's configuration metadata (label/unit/range/
// safe range) — the same fields the thesis's port-configuration workflow
// describes as "sensor metadata and settings" — and optionally bank the
// current values as a reusable named profile, or apply a previously saved
// one. Telemetry fields (value/status/history) are never edited here; those
// stay live.
function EditSensorModal({ port, profiles, onSaveProfile, onDeleteProfile, onSave, onClose }) {
  const [form, setForm] = useState({
    label: port.label,
    unit: port.unit,
    rangeMin: String(port.rangeMin),
    rangeMax: String(port.rangeMax),
    safeMin: String(port.safeMin),
    safeMax: String(port.safeMax),
  });
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [error, setError] = useState('');
  const [profileMsg, setProfileMsg] = useState('');

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
    setError('');
  }

  function handleApplyProfile(id) {
    setSelectedProfileId(id);
    if (!id) return;
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;
    setForm({
      label: profile.label,
      unit: profile.unit,
      rangeMin: String(profile.rangeMin),
      rangeMax: String(profile.rangeMax),
      safeMin: String(profile.safeMin),
      safeMax: String(profile.safeMax),
    });
    setError('');
  }

  // Parses + validates the form, returning either { values } or { error }.
  function validate() {
    const label = form.label.trim();
    const unit = form.unit.trim();
    const rangeMin = parseFloat(form.rangeMin);
    const rangeMax = parseFloat(form.rangeMax);
    const safeMin = parseFloat(form.safeMin);
    const safeMax = parseFloat(form.safeMax);

    if (!label) return { error: 'Label is required.' };
    if (!unit) return { error: 'Unit is required.' };
    if ([rangeMin, rangeMax, safeMin, safeMax].some(Number.isNaN)) {
      return { error: 'Range and safe values must be numbers.' };
    }
    if (rangeMin >= rangeMax) return { error: 'Range min must be less than range max.' };
    if (safeMin > safeMax) return { error: 'Safe min must not be greater than safe max.' };
    if (safeMin < rangeMin || safeMax > rangeMax) {
      return { error: 'Safe range must fall within the overall range.' };
    }

    return { values: { label, unit, rangeMin, rangeMax, safeMin, safeMax } };
  }

  function handleSaveAsProfile() {
    const result = validate();
    if (result.error) { setError(result.error); return; }
    if (!newProfileName.trim()) { setError('Enter a name to save this profile.'); return; }
    onSaveProfile({ name: newProfileName.trim(), ...result.values });
    setNewProfileName('');
    setProfileMsg(`Saved "${newProfileName.trim()}" to profiles.`);
  }

  function handleSubmit() {
    const result = validate();
    if (result.error) { setError(result.error); return; }
    onSave(result.values);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Edit Sensor</span>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {/* Load from a saved profile */}
          <div className="form-field">
            <label>Load from Saved Profile</label>
            <select
              className="input-field"
              value={selectedProfileId}
              onChange={e => handleApplyProfile(e.target.value)}
            >
              <option value="">— Select a profile —</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <hr className="divider" />

          <div className="form-field">
            <label>Sensor Label</label>
            <input className="input-field" value={form.label}
              onChange={e => setField('label', e.target.value)} placeholder="e.g. Dissolved Oxygen" />
          </div>
          <div className="form-field">
            <label>Unit</label>
            <input className="input-field" value={form.unit}
              onChange={e => setField('unit', e.target.value)} placeholder="e.g. mg/L" />
          </div>
          <div className="form-field">
            <label>Range (min – max)</label>
            <div className="cal-row">
              <input className="input-field" type="number" value={form.rangeMin}
                onChange={e => setField('rangeMin', e.target.value)} placeholder="Min" />
              <input className="input-field" type="number" value={form.rangeMax}
                onChange={e => setField('rangeMax', e.target.value)} placeholder="Max" />
            </div>
          </div>
          <div className="form-field">
            <label>Safe Range (min – max)</label>
            <div className="cal-row">
              <input className="input-field" type="number" value={form.safeMin}
                onChange={e => setField('safeMin', e.target.value)} placeholder="Min" />
              <input className="input-field" type="number" value={form.safeMax}
                onChange={e => setField('safeMax', e.target.value)} placeholder="Max" />
            </div>
          </div>

          {error && <p className="modal-error">{error}</p>}

          <hr className="divider" />

          {/* Save current values as a new reusable profile */}
          <div className="form-field">
            <label>Save Current Values as Profile</label>
            <div className="cal-row">
              <input className="input-field" value={newProfileName}
                onChange={e => { setNewProfileName(e.target.value); setProfileMsg(''); }}
                placeholder="Profile name (e.g. Dissolved Oxygen mg/L)" />
              <button className="detect-btn" onClick={handleSaveAsProfile}>Save</button>
            </div>
            {profileMsg && <p className="modal-success">{profileMsg}</p>}
          </div>

          {profiles.length > 0 && (
            <div className="saved-profile-list">
              {profiles.map(p => (
                <div className="saved-profile-row" key={p.id}>
                  <span>{p.name}</span>
                  <button className="dp-del" title="Delete profile"
                    onClick={() => onDeleteProfile(p.id)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// ── Sensor Detail Page ───────────────────────────────────────────────────────
export default function SensorDetail({ device, module, port, onBack, onUpdatePort }) {
  const { label, unit, value, rangeMin, rangeMax, safeMin, safeMax, status, history } = port;

  const [showEditModal, setShowEditModal] = useState(false);
  const [profiles, setProfiles] = useState(() => loadProfiles());

  function handleSaveProfile(profile) {
    setProfiles(prev => {
      const next = [...prev, { id: `profile-${Date.now()}`, ...profile }];
      persistProfiles(next);
      return next;
    });
  }

  function handleDeleteProfile(id) {
    setProfiles(prev => {
      const next = prev.filter(p => p.id !== id);
      persistProfiles(next);
      return next;
    });
  }

  function handleSaveSensor(values) {
    onUpdatePort?.(values);
    setShowEditModal(false);
  }

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
        <button className="edit-sensor-btn" onClick={() => setShowEditModal(true)}>Edit Sensor</button>
      </div>

      {showEditModal && (
        <EditSensorModal
          port={port}
          profiles={profiles}
          onSaveProfile={handleSaveProfile}
          onDeleteProfile={handleDeleteProfile}
          onSave={handleSaveSensor}
          onClose={() => setShowEditModal(false)}
        />
      )}

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
