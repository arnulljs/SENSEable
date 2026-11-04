// node src/lib/calRig.test.mjs   (no test runner in this repo; plain asserts)
import assert from 'node:assert/strict';
import { validateReply, RIG_MV_PER_COUNT } from './calRig.js';

const req = { cid: 'cal-1', tenantId: 'aquatech-856f', channel: 'A0' };
const reply = (raw, mv) => ({ cid: 'cal-1', tenant_id: 'aquatech-856f', rig_id: 'RIG-1', channel: 'A0',
                              raw_adc: raw, millivolts: mv, samples_used: 20, status: 'valid' });

assert.equal(RIG_MV_PER_COUNT, 0.1875);
// Rig at the nodes' ±6.144 V scale: 17530 × 0.1875 = 3286.875 mV → accepted
assert.deepEqual(validateReply(reply(17530, 3286.9), req),
  { rawAdc: 17530, millivolts: 3286.9, rigId: 'RIG-1', samples: 20 });
// Same voltage from a rig still at the old ±4.096 V scale (26296 × 0.125 = 3287 mV) → rejected
assert.throws(() => validateReply(reply(26296, 3287.0), req), /inconsistent/);
// The rig's error replies still surface as errors
assert.throws(() => validateReply({ status: 'error', message: 'no ADC' }, req), /Rig refused: no ADC/);
console.log('calRig: 3/3 passed');
