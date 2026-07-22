// api/notifications.js — read-only, tenant-scoped. See _db.js for the scoping model.
import { readHandler } from './_db.js';
import { readNotifications } from './_read.js';

export default readHandler(readNotifications, { cacheSeconds: 5 });
