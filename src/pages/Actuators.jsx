import { useState } from 'react';
import { macSuffixOf } from '../api';
import { devices as allDevices, buildActuatorCommand, clampDuty, dutyPct } from '../mockData';
import EditableName from '../components/EditableName';

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

function ActuatorCard({ device, actuator, onCommand, canEdit = false, onRename }) {
  const a = actuator;
  const isOn = a.state === 1;

  // ── Staged settings, explicit send ────────────────────────────────────────
  //
  // Every control here used to publish immediately: clicking a mode, releasing
  // the slider, and EVERY KEYSTROKE in the auto-off box. Typing "15" issued
  // three separate commands (1, then 15, plus whatever leading zero the number
  // input produced), which is why the field showed "015" and why the command
  // rate limiter tripped during ordinary use.
  //
  // Worse than the noise: each intermediate value was a real actuation. Typing
  // "30" briefly commanded a 3-second window before the 30-second one. On a
  // dosing pump that is not a cosmetic problem.
  //
  // So the card now stages changes locally and sends ONCE, when the operator
  // says to. That matches how the hardware is actually used — set the duty and
  // the duration, THEN start the pump — and it makes the packet the operator
  // reviews the packet that gets sent.
  const [draft, setDraft] = useState({
    mode: a.mode,
    duty: a.duty,
    durSec: a.dur ? a.dur / 1000 : 0,
  });

  // Re-sync when the device reports something we didn't stage — an ack landing,
  // or another operator commanding the same output. Previous-prop pattern, so
  // no effect and no cascading render.
  const [prevCommitted, setPrevCommitted] = useState({ mode: a.mode, duty: a.duty, dur: a.dur });
  if (prevCommitted.mode !== a.mode || prevCommitted.duty !== a.duty || prevCommitted.dur !== a.dur) {
    setPrevCommitted({ mode: a.mode, duty: a.duty, dur: a.dur });
    setDraft({ mode: a.mode, duty: a.duty, durSec: a.dur ? a.dur / 1000 : 0 });
  }

  const [showCmd, setShowCmd] = useState(false);
  const [lastPacket, setLastPacket] = useState(null);

  const isPwm = draft.mode === 'pwm';

  // Is there anything staged that the device hasn't been told about?
  const dirty =
    draft.mode !== a.mode ||
    (draft.mode === 'pwm' && draft.duty !== a.duty) ||
    Math.round(draft.durSec * 1000) !== a.dur;

  // UNITS: the wire protocol carries `dur` in MILLISECONDS — the firmware does
  // vTaskDelay(pdMS_TO_TICKS(dur)). The operator thinks in seconds ("run the
  // pump for 30 seconds"), so the conversion happens here at the UI boundary
  // and the frozen wire format is untouched.
  function send(state) {
    const stopping = state === 0;

    // In PWM mode the firmware does NOT read `state` — it derives on/off from
    // the duty alone (`actuator_active_state = duty_val > 0`). So a stop that
    // carried the staged duty would set that duty and drive the output straight
    // back on, which is exactly what happened: the UI showed OFF optimistically,
    // the ack came back "started", and the toggle flipped again.
    //
    // A stop therefore sends duty 0. It also sends dur 0, because an auto-off
    // window on a command whose whole purpose is to stop is meaningless — and
    // arming a timer here is how the earlier dur=1 workaround accidentally
    // became the only way to turn something off.
    const packet = onCommand(device.id, a.id, {
      mode: draft.mode,
      state,
      duty: draft.mode === 'pwm' ? (stopping ? 0 : clampDuty(draft.duty)) : undefined,
      dur: stopping ? 0 : Math.round(Math.max(0, Number(draft.durSec) || 0) * 1000),
    });
    if (packet) setLastPacket(packet);
  }

  return (
    <div className="cal-card" style={{ padding: 16 }}>
      {/* Header: name + live state + ack */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span className={`status-dot ${isOn ? 'online' : 'offline'}`} />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
          <EditableName
            value={a.name}
            canEdit={canEdit && typeof onRename === 'function'}
            onRename={(name) => onRename(device.id, a.id, name)}
            title="Rename actuator"
          />
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: isOn ? 'var(--green-text)' : 'var(--text-3)' }}>
          {isOn ? (a.mode === 'pwm' ? `ON · ${dutyPct(a.duty)}%` : 'ON') : 'OFF'}
        </span>
      </div>

      {/* Output port (wire target) + hardware meta */}
      <div className="channel-id" style={{ marginBottom: 12 }}>
        {a.port} · {a.id} · GPIO {a.gpio}
      </div>

      {/* Mode: PWM vs Binary — staged, not sent */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)', width: 48 }}>Mode</span>
        <button style={seg(isPwm)} onClick={() => setDraft(d => ({ ...d, mode: 'pwm' }))}>PWM</button>
        <button style={seg(!isPwm)} onClick={() => setDraft(d => ({ ...d, mode: 'bin' }))}>Binary</button>
      </div>

      {/* Duty cycle — PWM only. Staged; omitted from the command in binary mode. */}
      {isPwm && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
            <span>Duty cycle (8-bit)</span>
            <strong style={{ color: 'var(--blue)', fontFamily: 'var(--font-mono)' }}>
              {draft.duty} · ≈{dutyPct(draft.duty)}%
            </strong>
          </div>
          <input
            type="range" min={0} max={255} value={draft.duty}
            onChange={e => setDraft(d => ({ ...d, duty: clampDuty(e.target.value) }))}
            style={{ width: '100%', accentColor: 'var(--blue)', cursor: 'pointer' }}
          />
        </div>
      )}

      {/* Auto-off window, in seconds. 0 = hold until the next command. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)', width: 48 }}>Auto-off</span>
        <input
          className="input-field" type="number" min={0} step={0.1}
          value={draft.durSec}
          onChange={e => setDraft(d => ({ ...d, durSec: e.target.value }))}
          onBlur={e => setDraft(d => ({ ...d, durSec: Math.max(0, Number(e.target.value) || 0) }))}
          style={{ width: 90, padding: '4px 8px', fontSize: 12 }}
        />
        <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>sec (0 = hold)</span>
      </div>

      {/* Send. Two explicit verbs rather than a toggle, so the operator states
          intent — "start with these settings" or "stop" — instead of flipping
          a switch whose meaning depends on current state. Stop is always
          enabled and never staged: turning something OFF must never be blocked
          by unsaved edits. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <button
          style={{ ...seg(true, 'var(--green)', '#fff'), flex: 1, padding: '7px 0', fontWeight: 700 }}
          onClick={() => send(1)}
        >
          {isOn ? 'Apply / Restart' : 'Start'}
        </button>
        <button
          style={{ ...seg(!isOn, 'var(--gray)', '#fff'), flex: 1, padding: '7px 0', fontWeight: 700 }}
          onClick={() => send(0)}
        >
          Stop
        </button>
      </div>

      {dirty && (
        <div style={{ fontSize: 11, color: 'var(--amber-text, #92400E)', marginBottom: 8 }}>
          Unsent changes — press Start to apply.
        </div>
      )}

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
            : '// Configure the output above, then press Start to issue a command.'}
        </pre>
      )}
    </div>
  );
}

export default function Actuators({ devices: devicesProp, onCommandActuator, canEdit = false, onRenameActuator }) {
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
                  {device.nodeId}
                  {macSuffixOf(device.nodeId) && (
                    // The id encodes the ESP32's MAC, so show the bytes it came
                    // from. Two nodes named NODE-A1B2C3 and NODE-A1B2D7 differ by
                    // one character in the id but are obviously distinct boards
                    // once the MAC is visible — which matters when an operator is
                    // standing in front of a rack deciding which one to unplug.
                    <> · MAC …{macSuffixOf(device.nodeId)}</>
                  )}
                  {' · '}{device.commMode}
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
                    <ActuatorCard key={act.id} device={device} actuator={act} onCommand={command} canEdit={canEdit} onRename={onRenameActuator} />
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
