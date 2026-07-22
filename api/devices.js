// api/devices.js — read-only, tenant-scoped. See _db.js for the scoping model.
import { readHandler } from './_db.js';
import { readDevices } from './_read.js';

export default readHandler(readDevices, { cacheSeconds: 2 });
