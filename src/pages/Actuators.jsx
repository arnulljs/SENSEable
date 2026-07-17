import { useState } from 'react';
import { devices as allDevices, buildActuatorCommand, clampDuty, dutyPct } from '../mockData';

// ─── Actuator Control ────────────────────────────────────────────────────────
// The thesis models actuation as its own concern, distinct from sensing:
// "sensing functions and actuator functions will remain separate ... in both
// the user interface and the underlying application logic." So this is a
// dedicated control panel — a top-level tab — not a button buried in each
// sensor card. It mirrors the thesis's "control panel for actuator-enabled
// nodes," through which both Tier 2 Designers and Tier 3 Operators issue
// manual on/off commands and assign PWM duty-cycle values.
//
// Because PWM outputs are localized on the ESP32 mainboard (LEDC), actuators
// are grouped BY NODE here, parallel to how DeviceOverview groups sensors by
// module. `devices` arrives already tenant-scoped from App (with a mockData
// fallback for standalone/jsdom rendering). Every control action calls
// `onCommandActuator`, which builds the downlink command packet and applies
// the optimistic new state — so this page never owns device state in the real
// app; App remains the single data seam.

function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Map the edge node's acknowledgment onto the app's existing status vocabulary
// so the badge colors stay consistent with the rest of the UI.
function ackClass(ack) {
  // Frozen ack lifecycle: started | completed | stopped | failed | error | success
  if (ack === 'success' || ack === 'completed' || ack === 'ok' || ack === 'executed') return 'Normal';
  if (ack === 'failed' || ack === 'error' || ack === 'rejected' || ack === 'expired') return 'Fault';
  return 'offline'; // pending / started / stopped / unknown (in-flight)
}

// Segmented-button style, matching Calibration's guided-type selector.
function seg(active, activeBg = 'var(--blue)', activeFg = '#fff') {
  return {
    padding: '5px 12px', fontSize: 12, fontWeight: 600,
    borderRadius: 4, border: '1px solid var(--border)',
    background: active ? activeBg : 'var(--bg)',
    color: active ? activeFg : 'var(--text-2)',
    cursor: 'pointer',
  };
}

function ActuatorCard({ device, actuator, onCommand }) {
  const a = actuator;
  const isPwm = a.mode === 'pwm';
  const isOn = a.state === 1;

  // Draft duty is local so dragging the slider is smooth; the command only
  // fires on release (pointer up / keyboard). If the committed duty changes
  // upstream (e.g. another command patched it), re-sync during render using
  // the previous-prop pattern — no effect, so no cascading render.
  const [duty, setDuty] = useState(a.duty);
  const [prevDuty, setPrevDuty] = useState(a.duty);
  if (prevDuty !== a.duty) {
    setPrevDuty(a.duty);
    setDuty(a.duty);
  }

  const [showCmd, setShowCmd] = useState(false);
  const [lastPacket, setLastPacket] = useState(null);

  function send(out) {
    const packet = onCommand(device.id, a.id, out);
    if (packet) setLastPacket(packet);
  }

  const base = { mode: a.mode, state: a.state, duty, dur: a.dur };

  function setPower(state) { send({ ...base, state: state ? 1 : 0 }); }
  function setMode(mode)   { send({ ...base, mode }); }
  function commitDuty()    { send({ ...base, duty }); }         // slider release
  function setDur(dur)     { send({ ...base, dur: Math.max(0, Number(dur) || 0) }); }

  return (
    <div className="cal-card" style={{ padding: 16 }}>
      {/* Header: name + live state + ack */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span className={`status-dot ${isOn ? 'online' : 'offline'}`} />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{a.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: isOn ? 'var(--green-text)' : 'var(--text-3)' }}>
          {isOn ? (isPwm ? `ON · ${dutyPct(a.duty)}%` : 'ON') : 'OFF'}
        </span>
      </div>

      {/* Output port (wire target) + hardware meta */}
      <div className="channel-id" style={{ marginBottom: 12 }}>
        {a.port} · {a.id} · GPIO {a.gpio}
      </div>

      {/* Mode: PWM vs Binary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)', width: 48 }}>Mode</span>
        <button style={seg(isPwm)} onClick={() => setMode('pwm')}>PWM</button>
        <button style={seg(!isPwm)} onClick={() => setMode('bin')}>Binary</button>
      </div>

      {/* Power: Off / On */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isPwm ? 10 : 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)', width: 48 }}>Power</span>
        <button style={seg(!isOn, 'var(--gray)', '#fff')} onClick={() => setPower(0)}>Off</button>
        <button style={seg(isOn, 'var(--green)', '#fff')} onClick={() => setPower(1)}>On</button>
      </div>

      {/* Duty cycle — PWM only. Ignored/omitted from the command in binary mode. */}
      {isPwm && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
            <span>Duty cycle (8-bit)</span>
            <strong style={{ color: 'var(--blue)', fontFamily: 'var(--font-mono)' }}>{duty} · ≈{dutyPct(duty)}%</strong>
          </div>
          <input
            type="range" min={0} max={255} value={duty}
            onChange={e => setDuty(clampDuty(e.target.value))}
            onMouseUp={commitDuty}
            onTouchEnd={commitDuty}
            onKeyUp={commitDuty}
            style={{ width: '100%', accentColor: 'var(--blue)', cursor: 'pointer' }}
          />
        </div>
      )}

      {/* Auto-off window (dur, seconds). 0 = hold until next command. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)', width: 48 }}>Auto-off</span>
        <input
          className="input-field" type="number" min={0} value={a.dur}
          onChange={e => setDur(e.target.value)}
          style={{ width: 90, padding: '4px 8px', fontSize: 12 }}
        />
        <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>sec (0 = hold)</span>
      </div>

      {/* Ack + last-updated + command inspector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border-light)', paddingTop: 10 }}>
        <span className={`status-badge ${ackClass(a.lastAck)}`}>{a.lastAck}</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{ago(a.updatedAt)}</span>
        <button
          onClick={() => setShowCmd(s => !s)}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, color: 'var(--blue)' }}
        >
          {showCmd ? 'Hide command' : 'View command'}
        </button>
      </div>

      {showCmd && (
        <pre style={{
          marginTop: 8, marginBottom: 0, padding: 10, background: '#0F172A', color: '#E2E8F0',
          borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 11,
          lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {lastPacket
            ? JSON.stringify(lastPacket, null, 2)
            : '// Issue a command to preview the downlink packet\n// (no broker connected yet — command is not published)'}
        </pre>
      )}
    </div>
  );
}

export default function Actuators({ devices: devicesProp, onCommandActuator }) {
  const hasHandler = typeof onCommandActuator === 'function';

  // In the real app, render purely from App's tenant-scoped `devices` prop and
  // route every command through `onCommandActuator` (App owns the state). When
  // rendered standalone (no handler — e.g. jsdom render tests), keep a local
  // optimistic copy so the controls still work in isolation.
  const [fallbackDevices, setFallbackDevices] = useState(
    () => (hasHandler ? null : (devicesProp ?? allDevices))
  );
  const devices = hasHandler ? (devicesProp ?? []) : fallbackDevices;

  const command = hasHandler
    ? onCommandActuator
    : (deviceId, actId, out) => {
        const device = fallbackDevices.find(d => d.id === deviceId);
        const actuator = device?.actuators?.find(x => x.id === actId);
        if (!device || !actuator) return null;
        const packet = buildActuatorCommand(device, actuator, out);
        setFallbackDevices(prev => prev.map(d => (d.id !== deviceId ? d : {
          ...d,
          actuators: d.actuators.map(x => (x.id !== actId ? x : {
            ...x,
            mode: out.mode === 'bin' ? 'bin' : 'pwm',
            state: out.state ? 1 : 0,
            duty: out.mode === 'bin' ? x.duty : clampDuty(out.duty),
            dur: Math.max(0, Math.round(Number(out.dur) || 0)),
            lastAck: 'success',
            updatedAt: Date.now(),
          })),
        })));
        return packet;
      };

  const totalActuators = devices.reduce((n, d) => n + (d.actuators?.length || 0), 0);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Actuator Control</h1>
      </div>

      <div className="page-body">
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 20px', maxWidth: 680 }}>
          Manual control for actuator-enabled nodes. Each output runs as a plain
          on/off (<strong>Binary</strong>) load or a variable <strong>PWM</strong> output
          with an 8-bit (0–255) duty cycle. Commands are addressed per node — actuators are
          wired to the ESP32 mainboard, independent of the I²C sensing modules.
        </p>

        {devices.length === 0 ? (
          <div className="cal-card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-3)', fontSize: 13 }}>
            No devices registered for this organization yet.
          </div>
        ) : (
          devices.map(device => (
            <div key={device.id} style={{ marginBottom: 22 }}>
              {/* Node header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span className={`status-dot ${device.status}`} />
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{device.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                  {device.nodeId} · {device.commMode}
                  {device.rssi ? ` · ${device.rssi} dBm` : ''}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-3)' }}>
                  {(device.actuators?.length || 0)} output{(device.actuators?.length || 0) === 1 ? '' : 's'}
                </span>
              </div>

              {(device.actuators?.length || 0) === 0 ? (
                <div className="device-offline-msg">
                  <span className={`status-dot ${device.status}`} />
                  Node is {device.status}. No actuators configured.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                  {device.actuators.map(act => (
                    <ActuatorCard key={act.id} device={device} actuator={act} onCommand={command} />
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {totalActuators > 0 && (
          <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>
            {totalActuators} actuator output{totalActuators === 1 ? '' : 's'} across {devices.length} node{devices.length === 1 ? '' : 's'}.
            Commands publish through the backend (POST /commands); the ack lifecycle flips each badge as it arrives.
          </p>
        )}
      </div>
    </div>
  );
}
