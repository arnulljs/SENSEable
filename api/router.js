// api/router.js ─────────────────────────────────────────────────────────────
// The cloud tier's single API entry point.
//
// This replaces api/[resource].js. A single dynamic segment could only ever
// match /api/devices-shaped paths, and cloud-first needs nested write routes
// (/api/notifications/:id/read, /api/devices/:id/modules/:mid/ports/:pid/enabled)
// that a one-segment matcher cannot express. A catch-all keeps ONE routing table
// for both verbs instead of scattering handlers across a dozen files.
//
// The table below is the contract with the edge server's Express router. Every
// entry here has a counterpart in SENSEable-API/src/routes.js and must return the
// same JSON shape, because src/api.js does not know which tier answered it.

import { readHandler } from './_db.js';
import {
  readDevices, readNotifications, readMapSensors, readFormulas,
  readSensorProfiles, readChannelAssignments, readCommands,
} from './_read.js';
import {
  writeHandler, markAllNotificationsRead, markNotificationRead,
  createFormula, deleteFormula, fitLinear, assignChannel, saveMapSensors,
  renameDevice, renameModule, renameActuator, setPortEnabled,
  removeDevice, removeModule, removePort, postCommand,
} from './_write.js';

// Reads: [reader, cacheSeconds]. Telemetry is cached for seconds; configuration
// for far longer, since it only changes when someone edits it.
const READS = {
  'devices':             [readDevices,            2],
  'commands':            [(c, { tenantSlug, req }) =>
                            readCommands(c, { tenantSlug, deviceId: req.query?.device ?? null }), 2],
  'notifications':       [readNotifications,      5],
  'map-sensors':         [readMapSensors,        10],
  'formulas':            [readFormulas,          30],
  'sensor-profiles':     [readSensorProfiles,    30],
  'channel-assignments': [readChannelAssignments, 30],
};

// Writes, matched against the path segments. `:name` captures a segment and is
// passed to the handler under that name. Order matters only in that a literal
// segment always beats a capture at the same position.
const WRITES = [
  ['POST',   ['notifications', 'read-all'],            markAllNotificationsRead],
  ['POST',   ['notifications', ':id', 'read'],         markNotificationRead],

  ['POST',   ['formulas', 'fit'],                      fitLinear],
  ['POST',   ['formulas'],                             createFormula],
  ['DELETE', ['formulas', ':id'],                      deleteFormula],

  ['PUT',    ['channel-assignments', ':board', ':channel'], assignChannel],
  ['PUT',    ['map-sensors'],                          saveMapSensors],

  ['POST',   ['commands'],                             postCommand],

  ['PATCH',  ['devices', ':deviceId'],                 renameDevice],
  ['PATCH',  ['devices', ':deviceId', 'modules', ':moduleId'], renameModule],
  ['PATCH',  ['devices', ':deviceId', 'actuators', ':actuatorId'], renameActuator],
  ['PATCH',  ['devices', ':deviceId', 'modules', ':moduleId', 'ports', ':portId', 'enabled'],
                                                       setPortEnabled],

  ['DELETE', ['devices', ':deviceId'],                 removeDevice],
  ['DELETE', ['devices', ':deviceId', 'modules', ':moduleId'], removeModule],
  ['DELETE', ['devices', ':deviceId', 'modules', ':moduleId', 'ports', ':portId'], removePort],
];

function matchWrite(method, segments) {
  for (const [verb, pattern, fn] of WRITES) {
    if (verb !== method || pattern.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i += 1) {
      const p = pattern[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segments[i]);
      else if (p !== segments[i]) { ok = false; break; }
    }
    if (ok) return { fn, params, verb };
  }
  return null;
}

export default function handler(req, res) {
  // Reached through the vercel.json rewrite /api/(.*) -> /api/router?path=$1,
  // so `path` arrives as one slash-joined string. (It used to be the file name
  // api/[...path].js, but catch-all file routing is a Next.js feature; on this
  // Vite project Vercel never routed to it, and every route but /api/health —
  // its own file — answered 404.) An array is still accepted for local tooling.
  const raw = req.query?.path ?? '';
  const segments = (Array.isArray(raw) ? raw : String(raw).split('/')).filter(Boolean);

  if (req.method === 'GET') {
    const route = segments.length === 1 ? READS[segments[0]] : null;
    if (route) {
      const [reader, cacheSeconds] = route;
      return readHandler(reader, { cacheSeconds })(req, res);
    }
    return res.status(404).json({ error: `unknown resource '${segments.join('/')}'` });
  }

  const hit = matchWrite(req.method, segments);
  if (!hit) {
    return res.status(404).json({ error: `no ${req.method} route for '/${segments.join('/')}'` });
  }
  // Captured path parameters are merged into req.query so the handler reads them
  // the same way it reads a query string, which is what lets one signature serve
  // both.
  req.query = { ...req.query, ...hit.params };
  return writeHandler(hit.fn, { methods: [hit.verb] })(req, res);
}
