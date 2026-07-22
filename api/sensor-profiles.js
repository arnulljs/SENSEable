// api/sensor-profiles.js — read-only, tenant-scoped. See _db.js for the scoping model.
import { readHandler } from './_db.js';
import { readSensorProfiles } from './_read.js';

export default readHandler(readSensorProfiles, { cacheSeconds: 30 });
