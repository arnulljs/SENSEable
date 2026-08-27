// api.js ────────────────────────────────────────────────────────────────────
// The single seam between the React app and whichever tier is answering.
//
// TWO TIERS, ONE CLIENT
//   edge   — Express on the local network, full read/write, MQTT publication.
//            VITE_API_URL unset  ->  http://localhost:4000
//   cloud  — Vercel serverless functions over Supabase, READ-ONLY.
//            VITE_API_URL set to '' -> same-origin '/api/...'
//
// Both tiers return byte-identical shapes (senseable-api/src/read.js and
// SENSEable/api/_read.js are mirrors of each other), so nothing downstream of
// this file needs to know which one it's talking to.
//
// TENANCY
// Every request must declare a tenant. The cloud tier resolves it through
// resolve_tenant() and then runs the whole transaction under RLS as
// senseable_app, so a handler bug physically cannot read another tenant's
// rows. It FAILS CLOSED: no tenant -> 400, not "all tenants".
//
// The slug is held at module scope rather than threaded through all ~25
// exported functions. App.jsx calls setTenant() whenever the signed-in
// organization changes; every request after that carries x-tenant-id.

const BASE = import.meta.env?.VITE_API_URL ?? 'http://localhost:4000';

// ── Tenant scoping ──────────────────────────────────────────────────────────

let currentTenant = null;

/**
 * Declare which tenant subsequent requests belong to. Pass the SLUG
 * (tenants.slug in Postgres — 'aquatech', 'llba'), not the AuthContext org id.
 * They happen to be equal for the two seeded organizations, but an org created
 * through the UI gets a generated id and a slugify()'d slug, and only the slug
 * exists server-side.
 *
 * Pass null on sign-out so a stale tenant can't leak into the next session.
 */
export function setTenant(slug) {
  currentTenant = slug || null;
}

export function getTenant() {
  return currentTenant;
}

/**
 * True when the app is pointed at the read-only cloud tier, so the UI can hide
 * or disable controls that would only produce a 405. An empty VITE_API_URL
 * means same-origin, which is only ever the Vercel deployment; the edge server
 * is always reached through an explicit host.
 */
export const isReadOnlyTier = BASE === '';

// ── Transport ───────────────────────────────────────────────────────────────

function headers(extra) {
  const h = { ...extra };
  // Omitted entirely rather than sent empty: the server distinguishes "no
  // tenant declared" (400) from "unknown tenant" (404), and an empty string
  // would muddy that into a confusing 404.
  if (currentTenant) h['x-tenant-id'] = currentTenant;
  return h;
}

// Turns transport failures into messages that say what actually went wrong.
// A bare "GET /devices -> 405" sent someone debugging the database for an hour
// when the real answer was "that tier doesn't accept writes."
async function fail(method, path, res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error ? ` — ${body.error}` : '';
  } catch {
    // Non-JSON body (an HTML error page, or an empty 502). Nothing to add.
  }

  if (res.status === 400 && !currentTenant) {
    return new Error(
      `${method} ${path} — no organization selected. ` +
      'The API is tenant-scoped and refuses unscoped reads.');
  }
  // READ-ONLY CHECK MUST COME FIRST. The cloud tier's api/ directory contains
  // only GET handlers, so a PATCH/POST/DELETE never reaches readHandler's 405 —
  // Vercel has no route for it and answers 404. Testing for the tenant case
  // first therefore blamed a perfectly healthy tenant for what is really "this
  // deployment doesn't accept writes", which is exactly the wrong thing to tell
  // someone whose dashboard is streaming that tenant's live data.
  if (res.status === 405 || (isReadOnlyTier && method !== 'GET')) {
    return new Error(
      `${method} ${path} — this is the remote monitoring view, which is read-only. ` +
      'Channel changes, calibration and commands are made on the on-site server.');
  }
  if (res.status === 404 && currentTenant) {
    return new Error(
      `${method} ${path} — organization '${currentTenant}' has no data on this tier. ` +
      'It may exist only in this browser and never have been provisioned server-side.');
  }
  return new Error(`${method} ${path} -> ${res.status}${detail}`);
}

async function get(path) {
  const res = await fetch(`${BASE}/api${path}`, { headers: headers() });
  if (!res.ok) throw await fail('GET', path, res);
  return res.json();
}

async function send(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await fail(method, path, res);
  return res.json();
}

// ── Reads ───────────────────────────────────────────────────────────────────

export const fetchDevices = () => get('/devices');
export const fetchNotifications = () => get('/notifications');
export const fetchFormulas = () => get('/formulas');
export const fetchChannelAssignments = () => get('/channel-assignments');
export const fetchMapSensors = () => get('/map-sensors');

// Recent command log (with latest ack status), optionally scoped to one device.
export const fetchCommands = (deviceId) =>
  get(`/commands${deviceId ? `?device=${encodeURIComponent(deviceId)}` : ''}`);

// ── Writes (edge tier only — 405 on cloud) ──────────────────────────────────

export const markAllNotificationsRead = () => send('POST', '/notifications/read-all');
export const markNotificationRead = (id) => send('POST', `/notifications/${id}/read`);
export const createFormula = (label, formula) => send('POST', '/formulas', { label, formula });
export const deleteFormula = (id) => send('DELETE', `/formulas/${id}`);
export const fitFormula = (points) => send('POST', '/formulas/fit', { points });
export const assignChannel = (board, channel, formulaLabel) =>
  send('PUT', `/channel-assignments/${board}/${channel}`, { formulaLabel });
export const saveMapSensors = (sensors) => send('PUT', '/map-sensors', sensors);

// ── Renames (persist to the DB; response echoes the updated device) ─────────

export const renameDevice = (deviceId, name) =>
  send('PATCH', `/devices/${encodeURIComponent(deviceId)}`, { name });
export const renameModule = (deviceId, moduleId, name) =>
  send('PATCH', `/devices/${encodeURIComponent(deviceId)}/modules/${encodeURIComponent(moduleId)}`, { name });
export const renameActuator = (deviceId, actuatorId, name) =>
  send('PATCH', `/devices/${encodeURIComponent(deviceId)}/actuators/${encodeURIComponent(actuatorId)}`, { name });

// ── Enabling / disabling a channel ──────────────────────────────────────────
// An ADS1115 input with nothing wired to it floats and reads leakage voltage,
// which is indistinguishable from a real signal downstream. Disabling tells the
// server to stop monitoring and recording it, and asks the firmware (via
// sensor_port_down) to stop sampling it at source.
export const setPortEnabled = (deviceId, moduleId, portId, enabled, reason = null) =>
  send('PATCH',
    `/devices/${encodeURIComponent(deviceId)}/modules/${encodeURIComponent(moduleId)}/ports/${encodeURIComponent(portId)}/enabled`,
    { enabled, reason });

// ── Removing hardware from the inventory ────────────────────────────────────
// Only permitted while the target is offline. Hardware that has merely gone
// quiet is kept (reading Offline) so its calibration and naming survive a
// dropped connection; the backend answers 409 if you try to remove something
// that's still reporting.
export const removeDevice = (deviceId) =>
  send('DELETE', `/devices/${encodeURIComponent(deviceId)}`);
export const removeModule = (deviceId, moduleId) =>
  send('DELETE', `/devices/${encodeURIComponent(deviceId)}/modules/${encodeURIComponent(moduleId)}`);
export const removePort = (deviceId, moduleId, portId) =>
  send('DELETE', `/devices/${encodeURIComponent(deviceId)}/modules/${encodeURIComponent(moduleId)}/ports/${encodeURIComponent(portId)}`);

// ── Downward commands (actuate / bus_recovery / sensor_port_up|down) ─────────
// The backend resolves the broker `tid` from tenants.mqtt_tid, builds the exact
// wire envelope, logs it (cid), and publishes to usc/thesis/{tid}/{nid}/cmd if a
// broker is connected. It returns { ok, cid, topic, published, envelope }.
export const sendCommand = (deviceId, action, params = {}) =>
  send('POST', '/commands', { deviceId, action, ...params });

// Actuate an output. Target by actuatorId (preferred) or a raw port (1..6 /
// "OUT3"). mode 'bin' -> pass state 0|1; mode 'pwm' -> pass duty 0..255.
export const actuate = (deviceId, { actuatorId, port, mode, state, duty, dur = 0 }) =>
  sendCommand(deviceId, 'actuate', { actuatorId, port, mode, state, duty, dur });

export const busRecovery = (deviceId, busId = 0) =>
  sendCommand(deviceId, 'bus_recovery', { busId });

// direction: 'up' (enable) | 'down' (disable). chip 0..3 (0x48..0x4B), ch 0..3.
export const sensorPortToggle = (deviceId, direction, chip, ch) =>
  sendCommand(deviceId, `sensor_port_${direction}`, { chip, ch });
