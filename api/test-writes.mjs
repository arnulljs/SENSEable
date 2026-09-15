// Exercises every cloud-tier mutation against a real database + real RLS.
import {
  createFormula, deleteFormula, assignChannel, saveMapSensors,
  markAllNotificationsRead, renameDevice, renameModule, setPortEnabled,
  postCommand, fitLinear, removePort,
} from './_write.js';
import { withTenantScope, getPool } from './_db.js';

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const run = (fn, args = {}) => withTenantScope('aquatech', (c) =>
  fn(c, { tenantSlug: 'aquatech', ...args }));

const DEV = 'aquatech:N001';

try {
  is('fitLinear', (await run(fitLinear, { body: { points: [{raw:0,value:0},{raw:100,value:10}] } })).slope, 0.1);

  const f = await run(createFormula, { body: { label: 'DO mg/L', formula: 'raw * 0.00125' } });
  is('createFormula returns id', typeof f.id === 'string' && f.id.length === 36, true);

  const again = await run(createFormula, { body: { label: 'DO mg/L', formula: 'raw * 0.002' } });
  is('same label is the same row (no duplicate)', again.id, f.id);

  const assigned = await run(assignChannel, { board: '0x48', channel: 'A0', body: { formulaLabel: 'DO mg/L' } });
  is('assignChannel binds A0', assigned.A0, 'DO mg/L');

  const cleared = await run(assignChannel, { board: '0x48', channel: 'A0', body: { formulaLabel: null } });
  is('assignChannel clears A0', cleared.A0, null);

  await run(assignChannel, { board: '0x48', channel: 'A1', body: { formulaLabel: 'DO mg/L' } });
  await run(deleteFormula, { id: f.id });
  const afterDelete = await run(assignChannel, { board: '0x48', channel: 'A2', body: { formulaLabel: null } });
  is('deleting a formula unassigns its channels', afterDelete.A1, null);

  is('markAllNotificationsRead', await run(markAllNotificationsRead), { ok: true, unread: 0 });
  is('renameDevice', (await run(renameDevice, { deviceId: DEV, body: { name: 'Pond A Node' } })).name, 'Pond A Node');
  is('renameModule', (await run(renameModule, { deviceId: DEV, moduleId: '0x48', body: { name: 'Board 1' } })).name, 'Board 1');

  const map = await run(saveMapSensors, { body: [
    { deviceId: DEV, moduleId: '0x48', portId: 'A0', x: 120, y: 80 },
    { deviceId: DEV, moduleId: '0x99', portId: 'A0', x: 5, y: 5 },   // stale reference
  ]});
  is('saveMapSensors keeps valid, drops stale', map.length, 1);

  const dis = await run(setPortEnabled, { deviceId: DEV, moduleId: '0x48', portId: 'A2', body: { enabled: false } });
  is('setPortEnabled persists', dis.enabled, false);
  is('setPortEnabled queues a command', dis.command.published, false);

  const cmd = await run(postCommand, { body: { deviceId: DEV, action: 'actuate', port: 1, state: 1 } });
  is('postCommand queues, does not publish', cmd.queued, true);

  const queued = await withTenantScope('aquatech', (c) =>
    c.query("SELECT count(*)::int n FROM commands WHERE published_at IS NULL"));
  is('outbox holds both commands', queued.rows[0].n, 2);

  let blocked = null;
  try { await run(removePort, { deviceId: DEV, moduleId: '0x48', portId: 'A0' }); }
  catch (e) { blocked = e.status; }
  is('cannot remove hardware that is still reporting', blocked, 409);

  let cross = null;
  try {
    await withTenantScope('llba', (c) => renameDevice(c, { deviceId: DEV, body: { name: 'hijacked' } }));
  } catch (e) { cross = e.status; }
  is('RLS blocks a cross-tenant write', cross, 404);
} catch (e) {
  console.error('  ERROR', e);
  fail++;
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await getPool().end();
process.exit(fail ? 1 : 0);
