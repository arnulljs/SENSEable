// Exercises every cloud-tier mutation against a real database + real RLS.
import {
  createFormula, deleteFormula, assignChannel, saveMapSensors,
  markAllNotificationsRead, renameDevice, renameModule, setPortEnabled,
  postCommand, fitLinear, removePort,
} from './_write.js';
import { withTenantScope, getPool } from './_db.js';
import router from './router.js';
import http from 'node:http';

// A stand-in for Supabase Auth + PostgREST, serving only the two calls the
// caller check makes, so supabase-js runs its real code path against it.
const UID = { aqua: '11111111-1111-4111-8111-111111111111',
              dis:  '22222222-2222-4222-8222-222222222222',
              unc:  '33333333-3333-4333-8333-333333333333' };
const USERS = {
  'tok-aqua': { id: UID.aqua, aud: 'authenticated', email: 'a@aquatech.ph', email_confirmed_at: '2026-01-01T00:00:00Z' },
  'tok-dis':  { id: UID.dis,  aud: 'authenticated', email: 'd@aquatech.ph', email_confirmed_at: '2026-01-01T00:00:00Z' },
  'tok-unc':  { id: UID.unc,  aud: 'authenticated', email: 'u@aquatech.ph', email_confirmed_at: null },
};
const MEMBERS = {
  [UID.aqua]: [{ slug: 'aquatech', status: 'active' }],
  [UID.dis]:  [{ slug: 'aquatech', status: 'disabled' }],
  [UID.unc]:  [{ slug: 'aquatech', status: 'active' }],
};
const fake = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => { b += d; });
  req.on('end', () => {
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (req.url.startsWith('/auth/v1/user')) return USERS[tok] ? json(200, USERS[tok]) : json(401, { code: 401, msg: 'invalid JWT' });
    if (req.url.startsWith('/rest/v1/rpc/tenant_for_auth')) return json(200, MEMBERS[JSON.parse(b || '{}').p_auth_id] ?? []);
    return json(404, {});
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.SUPABASE_SECRET_KEY = 'test-secret';

// Drive the real Vercel entry point with a minimal req/res.
const call = (method, path, { token, tenant, body } = {}) => new Promise((resolve) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (tenant) headers['x-tenant-id'] = tenant;
  const res = {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { resolve({ status: this.statusCode, body: d, headers: this.headers }); },
  };
  router({ method, query: { path }, headers, body }, res);
});

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

  // The exact body the dashboard sends (App.jsx commandActuator → api.actuate):
  // an actuator id, never an output number. Plus spoofed identity fields, which
  // must be ignored.
  const cmd = await run(postCommand, { body: {
    deviceId: DEV, action: 'actuate', actuatorId: 'out3', mode: 'bin', state: 1, dur: 0,
    cid: 'forged-cid', tid: 'someone-else', nid: 'NODE-X',
  } });
  is('postCommand queues, does not publish', cmd.queued, true);
  const e = cmd.envelope;
  is('envelope routes to OUT3 as integer port', e.port, 3);
  is('envelope has the frozen actuate shape',
    [e.t, e.v, e.action, e.mode, e.state, e.dur], ['cmd', 1, 'actuate', 'bin', 1, 0]);
  is('no actuatorId leaks onto the wire', 'actuatorId' in e, false);
  is('tid/nid come from the database, not the body', [e.tid, e.nid], ['tenant-123', 'N001']);
  is('caller cannot forge the cid', e.cid === 'forged-cid', false);
  is('ts is unix seconds, like the edge', e.ts < 1e11, true);
  const stored = await withTenantScope('aquatech', (c) =>
    c.query('SELECT port, mode, payload FROM commands WHERE cid = $1', [e.cid]));
  is('commands.port column holds the output number', stored.rows[0].port, 3);
  // jsonb normalises key order, so compare key-sorted.
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  is('stored payload is the built envelope', sorted(stored.rows[0].payload), sorted(e));
  const act = await withTenantScope('aquatech', (c) =>
    c.query("SELECT last_ack, state, mode FROM actuators WHERE actuator_code = 'out3'"));
  is('actuator reads pending at once (cross-operator lockout)',
    [act.rows[0].last_ack, act.rows[0].state, act.rows[0].mode], ['pending', 1, 'bin']);

  const pwmStop = await run(postCommand, { body: {
    deviceId: DEV, action: 'actuate', actuatorId: 'out5', mode: 'pwm', state: 0, duty: 0, dur: 0 } });
  is('PWM stop carries duty 0 and the state:0 STOP guard',
    [pwmStop.envelope.port, pwmStop.envelope.duty, pwmStop.envelope.state], [5, 0, 0]);

  let noMode = null;
  try { await run(postCommand, { body: { deviceId: DEV, action: 'actuate', actuatorId: 'out1', state: 1 } }); }
  catch (err) { noMode = err.status; }
  is('malformed actuate is refused, not queued', noMode, 400);

  let ghost = null;
  try { await run(postCommand, { body: { deviceId: DEV, action: 'actuate', actuatorId: 'out99', mode: 'bin', state: 1 } }); }
  catch (err) { ghost = err.status; }
  is('unknown actuator is a 404', ghost, 404);

  let crossCmd = null;
  try {
    await withTenantScope('llba', (c) => postCommand(c, { body: {
      deviceId: DEV, action: 'actuate', actuatorId: 'out1', mode: 'bin', state: 1 } }));
  } catch (err) { crossCmd = err.status; }
  is("RLS blocks actuating another tenant's node", crossCmd, 404);

  const queued = await withTenantScope('aquatech', (c) =>
    c.query("SELECT count(*)::int n FROM commands WHERE published_at IS NULL"));
  is('outbox holds the three accepted commands', queued.rows[0].n, 3);

  let blocked = null;
  try { await run(removePort, { deviceId: DEV, moduleId: '0x48', portId: 'A0' }); }
  catch (e) { blocked = e.status; }
  is('cannot remove hardware that is still reporting', blocked, 409);

  let cross = null;
  try {
    await withTenantScope('llba', (c) => renameDevice(c, { deviceId: DEV, body: { name: 'hijacked' } }));
  } catch (e) { cross = e.status; }
  is('RLS blocks a cross-tenant write', cross, 404);

  // ── Tenant binding through the real router ──────────────────────────────
  const actuate = { deviceId: DEV, action: 'actuate', actuatorId: 'out1', mode: 'bin', state: 1, dur: 0 };
  is('old attack: header only, no token → 401',
    (await call('POST', 'commands', { tenant: 'aquatech', body: actuate })).status, 401);
  is('read with no token → 401',
    (await call('GET', 'devices', { tenant: 'aquatech' })).status, 401);
  is('garbage token → 401',
    (await call('GET', 'devices', { token: 'nope', tenant: 'aquatech' })).status, 401);
  is('valid session claiming another org → 403',
    (await call('POST', 'commands', { token: 'tok-aqua', tenant: 'llba', body: actuate })).status, 403);
  is('valid session reading another org → 403',
    (await call('GET', 'devices', { token: 'tok-aqua', tenant: 'llba' })).status, 403);
  is('disabled account → 403',
    (await call('POST', 'commands', { token: 'tok-dis', tenant: 'aquatech', body: actuate })).status, 403);
  is('unconfirmed email → 403',
    (await call('GET', 'devices', { token: 'tok-unc', tenant: 'aquatech' })).status, 403);

  const okRead = await call('GET', 'devices', { token: 'tok-aqua', tenant: 'aquatech' });
  is('member reads own org → 200', okRead.status, 200);
  is('tenant data is never CDN-cacheable', okRead.headers['Cache-Control'], 'private, no-store');
  is('read returns own device', okRead.body.map?.((d) => d.id).includes(DEV), true);

  const okCmd = await call('POST', 'commands', { token: 'tok-aqua', tenant: 'aquatech', body: actuate });
  is('member actuates own node → 201 with OUT1', [okCmd.status, okCmd.body.envelope?.port], [201, 1]);
} catch (e) {
  console.error('  ERROR', e);
  fail++;
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await getPool().end();
fake.close();
process.exit(fail ? 1 : 0);
