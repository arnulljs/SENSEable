// api/channel-assignments.js — read-only, tenant-scoped. See _db.js for the scoping model.
import { readHandler } from './_db.js';
import { readChannelAssignments } from './_read.js';

export default readHandler(readChannelAssignments, { cacheSeconds: 30 });
