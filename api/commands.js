// api/commands.js — recent downward commands + their latest ack status.
// Read-only: issuing a command must reach the broker, which only the edge tier
// can do, so POST is intentionally not served here.
import { readHandler } from './_db.js';
import { readCommands } from './_read.js';

export default readHandler(
  (client, { tenantSlug, req }) =>
    readCommands(client, { tenantSlug, deviceId: req.query?.device ?? null }),
  { cacheSeconds: 2 }
);
