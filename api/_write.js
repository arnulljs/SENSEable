// api/_write.js ─────────────────────────────────────────────────────────────
// Tenant-scoped MUTATIONS for the cloud tier.
//
// Until cloud-first this file did not exist and could not have: the edge server
// was authoritative, the cloud was a read replica, and every write went to the
// LAN. Cloud-first inverts that. The dashboard is now served from Vercel and
// must be usable from anywhere, so configuration writes land in Supabase and the
// edge picks them up through the sync worker's downward pass.
//
// THREE RULES THIS FILE FOLLOWS
//
// 1. SAME ISOLATION AS THE READS. Every mutation runs through withTenantScope(),
//    which is resolve_tenant() plus a transaction-local app.current_tenant. A
//    bug in a handler physically cannot write into another tenant's rows,
//    because RLS enforces it in the database rather than here. Nothing in this
//    file needs the owner role, and it must never be given one.
//
// 2. IDENTITY IS DERIVED, NOT GENERATED. The derive_pk() triggers from migration
//    009 mean a formula created here gets the same uuid the edge would have
//    given it. That is what lets a row created in the cloud and the "same" row
//    created on the edge during an outage merge instead of duplicating.
//
// 3. NO BROKER, SO COMMANDS ARE QUEUED, NOT PUBLISHED. A Vercel function cannot
//    hold an MQTT connection. POST /commands therefore writes a row to the
//    `commands` outbox with published_at NULL, and the edge server's dispatcher
//    publishes it on whichever broker the hardware is currently using. The
//    dashboard gets the same {cid, published} response shape either way —
//    published is false here, meaning "accepted, delivery pending".

import { withTenantScope } from './_db.js';

const bad = (status, message) => Object.assign(new Error(message), { status });

// The frontend's device id is `${slug}:${nodeId}`; the database stores node_id.
const nodeIdOf = (deviceId) => String(deviceId ?? '').split(':').slice(1).join(':');

// ── Notifications ───────────────────────────────────────────────────────────

export const markAllNotificationsRead = async (client) => {
  await client.query('UPDATE notifications SET is_read = true WHERE NOT is_read');
  return { ok: true, unread: 0 };
};

export const markNotificationRead = async (client, { id }) => {
  const { rowCount } = await client.query(
    'UPDATE notifications SET is_read = true WHERE notification_id = $1', [id]);
  if (!rowCount) throw bad(404, 'not found');
  return { ok: true };
};

// ── Calibration formulas ────────────────────────────────────────────────────

export const createFormula = async (client, { tenantSlug, body }) => {
  const { label, formula } = body ?? {};
  if (!label || !formula) throw bad(400, 'label and formula required');

  const { rows } = await client.query(
    `SELECT tenant_id FROM tenants WHERE slug = $1`, [tenantSlug]);
  const tenantId = rows[0]?.tenant_id;
  if (!tenantId) throw bad(404, `unknown tenant '${tenantSlug}'`);

  // ON CONFLICT rather than a plain insert: the edge may already have created
  // this exact formula during an outage and replicated it up. Same label in the
  // same tenant is the same formula, and derive_pk() gives both the same id.
  const { rows: out } = await client.query(
    `INSERT INTO calibration_formulas (tenant_id, label, expression)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, label) DO UPDATE SET expression = EXCLUDED.expression
     RETURNING formula_id, label, expression`,
    [tenantId, label, formula]);

  return { id: out[0].formula_id, tenantId: tenantSlug,
           label: out[0].label, formula: out[0].expression };
};

// ports.formula_id is ON DELETE SET NULL, so the database clears the formula
// from every channel it was assigned to. No second statement needed, and no way
// for a channel to end up pointing at a formula that no longer exists.
export const deleteFormula = async (client, { id }) => {
  const { rowCount } = await client.query(
    'DELETE FROM calibration_formulas WHERE formula_id = $1', [id]);
  return { ok: true, removed: rowCount };
};

// ── Channel assignments ─────────────────────────────────────────────────────

export const assignChannel = async (client, { board, channel, body }) => {
  const label = body?.formulaLabel ?? null;

  const { rows: portRows } = await client.query(
    `SELECT p.port_id, p.tenant_id
       FROM ports p JOIN modules m ON m.module_id = p.module_id
      WHERE lower(m.i2c_address) = lower($1) AND p.port_code = $2`,
    [board, channel]);
  if (!portRows.length) throw bad(404, `unknown channel ${board}/${channel}`);
  const port = portRows[0];

  let formulaId = null;
  if (label) {
    const { rows } = await client.query(
      'SELECT formula_id FROM calibration_formulas WHERE label = $1', [label]);
    if (!rows.length) throw bad(404, `unknown formula '${label}'`);
    formulaId = rows[0].formula_id;
  }

  // cal_type flips with the assignment: 'expr' evaluates the formula, 'linear'
  // falls back to the stored slope/offset. Leaving it stale would keep the
  // ingest pipeline on the old conversion after the operator changed it.
  await client.query(
    `UPDATE ports SET formula_id = $2, cal_type = $3 WHERE port_id = $1`,
    [port.port_id, formulaId, formulaId ? 'expr' : 'linear']);

  const { rows: assigned } = await client.query(
    `SELECT p.port_code, f.label
       FROM ports p
       JOIN modules m ON m.module_id = p.module_id
       LEFT JOIN calibration_formulas f ON f.formula_id = p.formula_id
      WHERE lower(m.i2c_address) = lower($1)
      ORDER BY p.port_index`, [board]);

  return Object.fromEntries(assigned.map((r) => [r.port_code, r.label ?? null]));
};

// ── Interactive map ─────────────────────────────────────────────────────────

export const saveMapSensors = async (client, { body }) => {
  if (!Array.isArray(body)) throw bad(400, 'expected an array');

  // Replace-then-insert inside ONE transaction (withTenantScope wraps it), so a
  // failure halfway cannot leave the map empty. RLS confines the DELETE to the
  // caller's tenant, which is why it needs no explicit tenant predicate.
  await client.query('DELETE FROM map_sensors');

  for (const s of body) {
    const { rows } = await client.query(
      `SELECT p.port_id, p.tenant_id
         FROM ports p
         JOIN modules m ON m.module_id = p.module_id
         JOIN devices d ON d.device_id = m.device_id
        WHERE d.node_id = $1 AND lower(m.i2c_address) = lower($2) AND p.port_code = $3`,
      [nodeIdOf(s.deviceId), s.moduleId, s.portId]);
    if (!rows.length) continue;              // stale reference to removed hardware
    await client.query(
      `INSERT INTO map_sensors (tenant_id, port_id, x, y) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, port_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y`,
      [rows[0].tenant_id, rows[0].port_id, s.x, s.y]);
  }

  const { rows } = await client.query(
    `SELECT d.node_id, m.i2c_address, p.port_code, ms.x, ms.y
       FROM map_sensors ms
       JOIN ports p   ON p.port_id = ms.port_id
       JOIN modules m ON m.module_id = p.module_id
       JOIN devices d ON d.device_id = m.device_id
       JOIN tenants t ON t.tenant_id = ms.tenant_id
      ORDER BY d.node_id, m.i2c_address, p.port_index`);
  return rows.map((r, i) => ({
    id: `map-${i}`, deviceId: r.node_id, moduleId: r.i2c_address,
    portId: r.port_code, x: r.x, y: r.y,
  }));
};

// ── Renames and inventory edits ─────────────────────────────────────────────
// `configured = true` is what distinguishes a name a human chose from the
// generated placeholder provisioning assigned, so it is set on every rename.

export const renameDevice = async (client, { deviceId, body }) => {
  const name = String(body?.name ?? '').trim();
  if (!name) throw bad(400, 'name required');
  const { rowCount } = await client.query(
    'UPDATE devices SET name = $2, configured = true WHERE node_id = $1',
    [nodeIdOf(deviceId), name]);
  if (!rowCount) throw bad(404, 'device not found');
  return { ok: true, name };
};

export const renameModule = async (client, { deviceId, moduleId, body }) => {
  const name = String(body?.name ?? '').trim();
  if (!name) throw bad(400, 'name required');
  const { rowCount } = await client.query(
    `UPDATE modules SET name = $3, configured = true
       WHERE lower(i2c_address) = lower($2)
         AND device_id = (SELECT device_id FROM devices WHERE node_id = $1)`,
    [nodeIdOf(deviceId), moduleId, name]);
  if (!rowCount) throw bad(404, 'module not found');
  return { ok: true, name };
};

export const renameActuator = async (client, { deviceId, actuatorId, body }) => {
  const name = String(body?.name ?? '').trim();
  if (!name) throw bad(400, 'name required');
  const { rowCount } = await client.query(
    `UPDATE actuators SET name = $3
       WHERE actuator_code = $2
         AND device_id = (SELECT device_id FROM devices WHERE node_id = $1)`,
    [nodeIdOf(deviceId), actuatorId, name]);
  if (!rowCount) throw bad(404, 'actuator not found');
  return { ok: true, name };
};

// Enabling or disabling a channel is BOTH a database fact and a hardware
// instruction. This tier can only do the first half; the command outbox carries
// the second half to the node through the edge dispatcher.
export const setPortEnabled = async (client, { deviceId, moduleId, portId, body }) => {
  const enabled = body?.enabled !== false;
  const { rows } = await client.query(
    `UPDATE ports SET enabled = $4
       WHERE port_code = $3
         AND module_id = (
           SELECT m.module_id FROM modules m
             JOIN devices d ON d.device_id = m.device_id
            WHERE d.node_id = $1 AND lower(m.i2c_address) = lower($2))
     RETURNING port_id, tenant_id, port_index`,
    [nodeIdOf(deviceId), moduleId, portId, enabled]);
  if (!rows.length) throw bad(404, 'channel not found');

  // The wire action is directional: sensor_port_up / sensor_port_down, not a
  // single action with a state field. The database CHECK enforces the frozen
  // vocabulary, so getting this wrong fails loudly at insert rather than
  // silently sending the node something it will reject.
  //
  // `chip` is the board's bus index, NOT its I2C address string. The address is
  // what the dashboard shows and what identifies the row; the firmware addresses
  // boards by position on the bus.
  const chip = Math.max(0, parseInt(moduleId, 16) - 0x48);
  const command = await queueCommand(client, {
    deviceId,
    action: enabled ? 'sensor_port_up' : 'sensor_port_down',
    // commands.port is the ACTUATOR output (OUT1..OUT6, CHECK 1..6). A sensor
    // channel is addressed by chip + ch in the payload, so port stays NULL —
    // exactly as the edge tier records it. Passing the channel index here put
    // 0..3 into that column and the insert failed commands_port_check.
    port: null,
    payload: { chip, ch: rows[0].port_index },
  });
  return { ok: true, enabled, command };
};

// Deletes stay guarded the same way the edge guards them: hardware that is still
// reporting must not be removable, or it reappears on the next packet and the
// operator is left wondering whether the delete worked.
const STALE_MS = Number(process.env.STALE_MS ?? 30_000);

const assertStale = async (client, sql, params, what) => {
  const { rows } = await client.query(sql, params);
  if (!rows.length) throw bad(404, `${what} not found`);
  const seen = rows[0].last_seen ? new Date(rows[0].last_seen).getTime() : 0;
  if (Date.now() - seen <= STALE_MS) {
    throw bad(409, `${what} is still reporting — it can only be removed once offline`);
  }
  return rows[0];
};

export const removeDevice = async (client, { deviceId }) => {
  const row = await assertStale(client,
    'SELECT device_id, last_seen FROM devices WHERE node_id = $1',
    [nodeIdOf(deviceId)], 'device');
  await client.query('DELETE FROM devices WHERE device_id = $1', [row.device_id]);
  return { ok: true, removed: 1 };
};

export const removeModule = async (client, { deviceId, moduleId }) => {
  const row = await assertStale(client,
    `SELECT m.module_id, m.last_seen FROM modules m
       JOIN devices d ON d.device_id = m.device_id
      WHERE d.node_id = $1 AND lower(m.i2c_address) = lower($2)`,
    [nodeIdOf(deviceId), moduleId], 'board');
  await client.query('DELETE FROM modules WHERE module_id = $1', [row.module_id]);
  return { ok: true, removed: 1 };
};

export const removePort = async (client, { deviceId, moduleId, portId }) => {
  const row = await assertStale(client,
    `SELECT p.port_id, p.last_seen FROM ports p
       JOIN modules m ON m.module_id = p.module_id
       JOIN devices d ON d.device_id = m.device_id
      WHERE d.node_id = $1 AND lower(m.i2c_address) = lower($2) AND p.port_code = $3`,
    [nodeIdOf(deviceId), moduleId, portId], 'channel');
  await client.query('DELETE FROM ports WHERE port_id = $1', [row.port_id]);
  return { ok: true, removed: 1 };
};

// ── Command outbox ──────────────────────────────────────────────────────────
// The downlink half of cloud-first. Nothing here touches a broker; the row is
// the message, and the edge dispatcher is the transport.

const newCid = () => `cmd-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;

export async function queueCommand(client, { deviceId, action, payload, mode = null, port = null }) {
  const { rows } = await client.query(
    `SELECT d.device_id, d.tenant_id, t.mqtt_tid
       FROM devices d JOIN tenants t ON t.tenant_id = d.tenant_id
      WHERE d.node_id = $1`, [nodeIdOf(deviceId)]);
  if (!rows.length) throw bad(404, `unknown device '${deviceId}'`);

  const cid = newCid();
  // The stored payload is the COMPLETE frozen-schema envelope, so the edge
  // dispatcher publishes it verbatim and never has to rebuild it. Two places
  // constructing the same envelope is two places for it to drift.
  const envelope = {
    // tid included so a cloud-queued envelope matches the edge's byte for byte.
    t: 'cmd', v: 1, tid: rows[0].mqtt_tid ?? undefined, nid: nodeIdOf(deviceId), cid,
    ts: Date.now(), action, ...(payload ?? {}),
  };

  await client.query(
    `INSERT INTO commands (tenant_id, device_id, cid, action, mode, port, payload, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
    [rows[0].tenant_id, rows[0].device_id, cid, action, mode, port,
     JSON.stringify(envelope)]);

  // published:false means "accepted, not yet on the wire". The dashboard already
  // renders that state, because the edge tier returns it whenever no broker is
  // connected.
  return { cid, published: false, action, queued: true };
}

export const postCommand = async (client, { body }) => {
  const { deviceId, action, ...rest } = body ?? {};
  if (!deviceId || !action) throw bad(400, 'deviceId and action required');
  return queueCommand(client, {
    deviceId, action, payload: rest,
    mode: rest.mode ?? null, port: rest.port ?? null,
  });
};

// ── Linear fit ──────────────────────────────────────────────────────────────
// Pure arithmetic, no database. Duplicated from the edge's calibration.js rather
// than imported because the two tiers are separate deployments; it is twelve
// lines of least-squares and it has no state to drift.
export const fitLinear = async (_client, { body }) => {
  const pts = (body?.points ?? [])
    .map((p) => ({ raw: Number(p.raw), value: Number(p.value) }))
    .filter((p) => Number.isFinite(p.raw) && Number.isFinite(p.value));
  if (pts.length < 2) throw bad(400, 'need >= 2 valid {raw,value} points');

  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p.raw, 0);
  const sy = pts.reduce((a, p) => a + p.value, 0);
  const sxx = pts.reduce((a, p) => a + p.raw * p.raw, 0);
  const sxy = pts.reduce((a, p) => a + p.raw * p.value, 0);
  const denom = n * sxx - sx * sx;
  if (!denom) throw bad(400, 'all points share one raw value — slope is undefined');

  const slope = (n * sxy - sx * sy) / denom;
  const offset = (sy - slope * sx) / n;
  const mean = sy / n;
  const ssTot = pts.reduce((a, p) => a + (p.value - mean) ** 2, 0);
  const ssRes = pts.reduce((a, p) => a + (p.value - (slope * p.raw + offset)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, offset, r2, points: n };
};

/**
 * Wrap a mutation into a Vercel handler. Mirrors readHandler(), minus the cache
 * header: a mutation response must never be cached by the CDN.
 */
export function writeHandler(fn, { methods = ['POST'] } = {}) {
  return async function handler(req, res) {
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return res.status(405).json({ error: `method not allowed — expected ${methods.join('/')}` });
    }
    try {
      const slug = req.headers?.['x-tenant-id'] || req.query?.tenant || null;
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
      const data = await withTenantScope(slug, (client) =>
        fn(client, { ...req.query, tenantSlug: slug, body, req }));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(req.method === 'POST' ? 201 : 200).json(data);
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) console.error('[write]', err);
      return res.status(status).json({ error: err.message ?? 'write failed' });
    }
  };
}
