// api/[resource].js — every read-only, tenant-scoped collection endpoint.
//
// One file instead of seven near-identical ones. Vercel's filesystem router
// gives each route its own module, and the six that existed differed only in
// which reader they called and how long the response may be cached. Static
// files (health.js, ws.js) still win over this dynamic route, so they are
// unaffected.
//
// See _db.js for the tenant scoping model.
import { readHandler } from './_db.js';
import {
  readDevices, readFormulas, readNotifications, readMapSensors,
  readSensorProfiles, readChannelAssignments, readCommands,
} from './_read.js';

// resource -> [reader, cacheSeconds]. Telemetry is cached for seconds;
// configuration for far longer, since it only changes when someone edits it.
const ROUTES = {
  'devices':             [readDevices,            2],
  'commands':            [
    // Read-only: issuing a command must reach the broker, which only the edge
    // tier can do, so POST is intentionally not served here.
    (client, { tenantSlug, req }) =>
      readCommands(client, { tenantSlug, deviceId: req.query?.device ?? null }),
    2,
  ],
  'notifications':       [readNotifications,      5],
  'map-sensors':         [readMapSensors,        10],
  'formulas':            [readFormulas,          30],
  'sensor-profiles':     [readSensorProfiles,    30],
  'channel-assignments': [readChannelAssignments, 30],
};

export default function handler(req, res) {
  const route = ROUTES[req.query?.resource];
  if (!route) {
    res.status(404).json({ error: `unknown resource '${req.query?.resource}'` });
    return;
  }
  const [reader, cacheSeconds] = route;
  return readHandler(reader, { cacheSeconds })(req, res);
}
