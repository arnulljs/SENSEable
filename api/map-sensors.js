// api/map-sensors.js — read-only, tenant-scoped. See _db.js for the scoping model.
import { readHandler } from './_db.js';
import { readMapSensors } from './_read.js';

export default readHandler(readMapSensors, { cacheSeconds: 10 });
