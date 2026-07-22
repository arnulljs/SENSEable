// api/formulas.js — read-only, tenant-scoped. See _db.js for the scoping model.
import { readHandler } from './_db.js';
import { readFormulas } from './_read.js';

export default readHandler(readFormulas, { cacheSeconds: 30 });
