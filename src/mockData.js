// ─── SENSEful Mock Data ────────────────────────────────────────────────────
// No database or MQTT connected yet — all data is in-memory for UI prototyping.

// A port's status is always derived from its current reading relative to
// its own range/safe thresholds — never stored as independent truth. This
// is the single function that decides Normal/Warning/Fault for a reading,
// used both when seeding mock data below and whenever Edit Sensor changes
// a port's range or safe thresholds (see App.jsx's updatePort), so the
// status badge can never go stale relative to the configured parameters.
//   • Outside the physical range entirely → Fault (the reading itself is
//     no longer plausible for this sensor).
//   • Inside range but outside the safe band → Warning.
//   • Inside the safe band → Normal.
// ('Offline' is handled separately — it only applies when a port's parent
// board/node has dropped out of `devices` entirely, e.g. in InteractiveMap's
// resolveChannel fallback — not something derived from a value.)
export function computeSensorStatus(value, rangeMin, rangeMax, safeMin, safeMax) {
  if (value < rangeMin || value > rangeMax) return 'Fault';
  if (value < safeMin || value > safeMax) return 'Warning';
  return 'Normal';
}

// ─── Actuator command builder ───────────────────────────────────────────────
// Actuation is deliberately a SEPARATE concern from sensing. Actuators live on
// the ESP32 mainboard's PWM-capable GPIO (LEDC peripheral), NOT on the modular
// I²C sensing path — so in the data model they hang off the *device*, parallel
// to `modules`, never inside one.
//
// This is the pure, side-effect-free builder for the downlink command payload,
// matching the `CommandPayload` JSON Schema (Branch B: "actuate") from the
// firmware progress spec. It's the exact wire shape the backend/MQTT path will
// eventually publish to `usc/thesis/{tid}/{nid}/cmd`; the Control page only
// calls this + hands the result to App, so once a real broker is wired up
// nothing in the page changes.
//
// The command is FLAT (no nested act/out/safe wrappers) and discriminated by
// `action`. For actuation (frozen "actuate" branch):
//   action : "actuate"
//   port   : integer 1..6      — OUT1..OUT6 (the wire carries the number, not "OUT1")
//   mode   : "bin" | "pwm"     — the literal is "bin", not "binary"
//   dur    : integer ≥ 0       — ALWAYS required (0 = hold until next command)
//   state  : 0 | 1             — required for bin
//   duty   : integer 0..255    — required for pwm (8-bit LEDC resolution)
//
// This offline builder exists only for standalone/jsdom rendering (the "View
// command" preview). In the running app the REAL command goes through the
// backend (POST /commands), which resolves the broker `tid` from
// tenants.mqtt_tid — the browser is never trusted to stamp it. Here we show
// device.mqttTid if present so the preview matches the eventual wire packet.
// Duty is 8-bit end-to-end now (slider is 0..255), so no percent conversion.
export function clampDuty(v) {
  const n = Math.round(Number(v));
  if (Number.isNaN(n)) return 0;
  return Math.min(255, Math.max(0, n));
}

// 8-bit duty → display percent (for the "≈X%" readout next to the slider).
export function dutyPct(raw) {
  return Math.round((clampDuty(raw) / 255) * 100);
}

// "OUT3" | "out3" | 3 → 3
function portNumber(port) {
  if (typeof port === 'number') return port;
  const m = String(port).match(/(\d+)/);
  return m ? Number(m[1]) : NaN;
}

let _cmdSeq = 0;
export function buildActuatorCommand(device, actuator, out = {}) {
  const mode = (out.mode === 'binary' || out.mode === 'bin') ? 'bin' : 'pwm';
  const dur = Math.max(0, Math.round(Number(out.dur) || 0));
  const on = out.state ? 1 : 0;

  _cmdSeq += 1;
  const cmd = {
    t: 'cmd',
    v: 1,
    tid: device.mqttTid ?? '<resolved server-side>', // broker tid, stamped by backend
    nid: device.nodeId,            // route by node id (matches firmware, e.g. "N001")
    cid: 'c' + String(_cmdSeq).padStart(4, '0'),
    ts: Math.floor(Date.now() / 1000),
    action: 'actuate',
    port: portNumber(actuator.port), // integer 1..6 on the wire
    mode,
    dur,
  };

  if (mode === 'bin') {
    cmd.state = on;                // binary carries explicit on/off
  } else {
    cmd.duty = on ? clampDuty(out.duty) : 0; // pwm off ⇒ duty 0 (8-bit)
  }

  return cmd;
}

function generateHistory(base, rangeMin, rangeMax, safeMin, safeMax, count = 10) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const noise = (Math.random() - 0.5) * (safeMax - safeMin) * 0.14;
    const v = parseFloat((base + noise).toFixed(4));
    const ts = new Date(now - (count - i) * 9 * 60000);
    return {
      timestamp: ts.toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }),
      value: v,
      status: computeSensorStatus(v, rangeMin, rangeMax, safeMin, safeMax),
    };
  });
}

// ─── Tenant & Access layer ──────────────────────────────────────────────────
// Mirrors the thesis's "Tenant and Access ERD" (Appendix I.2): TENANTS,
// ROLES, and USERS tables. This is the multi-tenant SaaS foundation —
// everything else in this file (devices, notifications, ...) is scoped to
// one of these organizations via a `tenantId` field. There's no backend
// yet, so AuthContext.jsx seeds itself from these arrays once and then
// reads/writes a localStorage mirror for the rest of the session. Swapping
// in a real API later means replacing that seed + persistence logic in
// AuthContext — nothing in the page components needs to change, since they
// already only ever see whatever `devices`/`notifications` they're handed
// as props.
//
// Per the thesis's three-tier role hierarchy, Tier 1 (Service Provider) is
// out of scope for this application — that's SENSEful's own staff tooling.
// What's modeled here is Tier 2 (Designer / Client Admin) and Tier 3
// (Operator), scoped within each tenant.

// → roles.role_id / role_name / description
export const roles = [
  {
    id: 'designer',
    name: 'Designer',
    tier: 2,
    description:
      'Client admin. Full operational access, plus the only role that can create, lay out, and edit interactive map designs for the organization.',
  },
  {
    id: 'operator',
    name: 'Operator',
    tier: 3,
    description:
      'Operational access — calibration, sensor metadata, actuator control. Views interactive map designs read-only.',
  },
];

// → tenants.tenant_id / name / status / created_at
// `orgCode` and `maxUsers` aren't in the documented ERD's TENANTS columns —
// they're prototype-only conveniences (a join code for the signup flow, and
// a stand-in for the proposed TENANT_LIMITS.max_users row) kept here rather
// than invented ad hoc in AuthContext.
export const organizations = [
  {
    id: 'aquatech',
    name: 'AquaTech Hatchery Corp',
    slug: 'aquatech',
    orgCode: 'AQUA-7421',
    status: 'active',
    plan: 'Pilot',
    maxUsers: 6,
    createdAt: '2026-02-03T08:00:00.000Z',
  },
  {
    // Deliberately has zero devices below — same proof-of-dynamism idea as
    // ESP32 Module 2's `modules: []`, just one level up: a whole tenant
    // with no hardware registered yet, so the UI's empty states get
    // exercised at the organization level too, not just the device level.
    id: 'llba',
    name: 'Lapu-Lapu Bay Aquafarms',
    slug: 'llba',
    orgCode: 'LLBA-3309',
    status: 'active',
    plan: 'Pilot',
    maxUsers: 4,
    createdAt: '2026-04-11T08:00:00.000Z',
  },
];

// → users.user_id / tenant_id / role_id / full_name / email / password_hash /
//   status / created_at
// `password` is plaintext here ONLY because this is a frontend-only
// prototype with nowhere to hash it. A real backend stores `password_hash`
// and verifies it server-side — the client should never hold or compare
// raw passwords the way AuthContext currently has to.
export const users = [
  {
    id: 'usr_mariz',
    tenantId: 'aquatech',
    roleId: 'designer',
    fullName: 'Mariz Santos',
    email: 'mariz@aquatech.ph',
    password: 'designer123',
    status: 'active',
    createdAt: '2026-02-03T08:05:00.000Z',
  },
  {
    id: 'usr_jay',
    tenantId: 'aquatech',
    roleId: 'operator',
    fullName: 'Jay Bautista',
    email: 'jay@aquatech.ph',
    password: 'operator123',
    status: 'active',
    createdAt: '2026-02-10T09:00:00.000Z',
  },
  {
    id: 'usr_dane',
    tenantId: 'llba',
    roleId: 'designer',
    fullName: 'Dane Lim',
    email: 'dane@llba.ph',
    password: 'designer123',
    status: 'active',
    createdAt: '2026-04-11T08:10:00.000Z',
  },
];

// Each entry in `devices` represents one physical ESP32 node reporting in.
// `modules` holds whatever expansion boards that node currently reports —
// zero, one, or many. Each module's `address` is its I2C bus address on that
// specific ESP32, which is how the backend ties a board to its parent node.
// Nothing in the UI assumes a fixed device/module/port count — DeviceOverview
// and Calibration both map over these arrays, so this object is the single
// source of truth for "what hardware is currently connected." Once the real
// backend/MQTT feed is wired up, this array gets replaced by live data with
// the exact same shape.
//
// `tenantId` (→ devices.tenant_id in the "Devices and Sensing ERD") is the
// multi-tenant foundation: App.jsx filters this array down to the signed-in
// user's organization before handing it to any page, so a Designer or
// Operator only ever sees their own org's hardware.
export const savedFormulas = [
  { id: 1, label: 'temperaTURE', formula: '(+0.00000000*x**0 - 20.0199576*x**2 + 0.00751695*x**2 + 1440.577831)*1' },
  { id: 2, label: 'DO',          formula: 'x*(13453.23451 - 194.23421*np.floor(CH2))/(1175*123*CH2 - 25.64)' },
  { id: 3, label: 'salinity',    formula: '(+0.0000*x**0 - 20.0199576*x - 194.2342)/1000*3.0 + 7.0' },
];

export const channelAssignments = {
  'board-1': { A0: 'DO', A1: 'salinity', A2: 'temperaTURE', A3: null },
};

// Saved sensor profiles — reusable metadata templates (label, unit, range,
// safe range) for the Edit Sensor feature. Letting a user pick "Dissolved
// Oxygen (mg/L)" from a dropdown instead of re-typing the same six fields
// every time the same physical sensor model gets wired to a new port is
// exactly the "reuse of saved sensor profiles" behavior called out in the
// thesis's port-configuration workflow (Appendix J discovery flowchart).
// Mirrors the calibration formula bank's save-once/reuse-anywhere pattern.
export const sensorProfiles = [
  { id: 'profile-1', name: 'Dissolved Oxygen (mg/L)', label: 'Dissolved Oxygen', unit: 'mg/L', rangeMin: 0, rangeMax: 20, safeMin: 6, safeMax: 9 },
  { id: 'profile-2', name: 'Salinity (PSU)',           label: 'Salinity',        unit: 'PSU',  rangeMin: 0, rangeMax: 70, safeMin: 35, safeMax: 50 },
  { id: 'profile-3', name: 'Temperature (°C)',         label: 'Temperature',     unit: '°C',   rangeMin: 0, rangeMax: 50, safeMin: 25, safeMax: 32 },
];

// Sensors pre-placed on the interactive canvas (Konva Stage coords).
// Only position + which physical channel they represent is stored here —
// label, unit, and live status are resolved from `devices` above (by
// deviceId/moduleId/portId) every time the map renders. This is what
// makes the map "dynamic": rename a port, change its status, or remove
// the whole board from `devices`, and every placed sensor that points at
// it updates (or gracefully falls back) with no changes needed here.
export const mapSensors = [
  { id: 's1', x: 210, y: 145, deviceId: 'aquatech:N001', moduleId: '0x48', portId: 'A0' }, // Dissolved Oxygen
  { id: 's2', x: 375, y: 148, deviceId: 'aquatech:N001', moduleId: '0x48', portId: 'A1' }, // Salinity
  { id: 's3', x: 295, y: 265, deviceId: 'aquatech:N001', moduleId: '0x48', portId: 'A2' }, // Temperature
];

// Legacy generic sensor-type palette — no longer used by InteractiveMap
// (the map now builds its placement palette live from `devices`/`mapSensors`
// above), kept here only in case other code in the wider project still
// imports it.
