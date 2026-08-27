// api/ws.js ──────────────────────────────────────────────────────────────────
// WebSocket endpoint for the CLOUD read tier (Vercel Functions + Fluid compute).
//
// The edge server pushes the moment a packet lands, because it is the ingest
// point. This tier has no such signal: it only reads a Supabase replica, and a
// replica doesn't announce itself. So the sync worker issues NOTIFY
// 'senseable_sync' at the end of every pass that moved rows, and this function
// LISTENs for it and re-reads. That closes the loop without polling.
//
// FOUR CONSTRAINTS THIS FILE IS SHAPED BY
//
// 1. LISTEN NEEDS A SESSION. Supavisor's transaction pooler (:6543) hands a
//    backend connection back after every transaction, so a LISTEN registered on
//    it would be silently dropped. The listener therefore uses the SESSION
//    pooler (:5432) via CLOUD_DATABASE_URL_SESSION. Reads still go through the
//    transaction pooler exactly as before — only the listener is different.
//
// 2. ONE LISTENER PER INSTANCE, NOT PER SOCKET. Supabase Nano allows 15 backend
//    connections total. A listener per socket would exhaust that at 15 open
//    dashboards. Instead the listener is module-scoped and shared by every
//    socket the instance is handling, so N dashboards on one instance cost one
//    connection.
//
// 3. INSTANCES ARE NOT STICKY. Vercel does not guarantee a reconnecting client
//    reaches the same instance, and a connection is torn down when the function
//    hits its max duration. Nothing durable may live in memory here — the only
//    in-memory state is the socket set for THIS instance, which is exactly the
//    set this instance must notify. Everything authoritative is re-read from
//    Postgres. The client handles reconnect with backoff.
//
// 4. RLS STILL APPLIES. Every read goes through withTenantScope() — the same
//    SECURITY DEFINER resolve_tenant() + transaction-local app.current_tenant
//    the REST handlers use. A socket cannot see another tenant's rows even if
//    this file had a bug, because the isolation is enforced in the database.

import http from 'http';
import { WebSocketServer } from 'ws';
import pg from 'pg';
import { withTenantScope } from './_db.js';
import { readDevices } from './_read.js';

const { Client } = pg;

const CHANNEL = 'senseable_sync';

// Collapse a burst of NOTIFYs into one read. The sync worker emits once per
// pass, but a backlog drain can fire several passes in quick succession.
const COALESCE_MS = Number(process.env.WS_COALESCE_MS ?? 250);

// Re-read on a slow timer even with no NOTIFY. This is a safety net, not the
// primary path: it catches a dropped listener or a sync worker that died, so a
// dashboard degrades to slow-but-correct instead of silently frozen.
const SAFETY_POLL_MS = Number(process.env.WS_SAFETY_POLL_MS ?? 45_000);

const server = http.createServer();
const wss = new WebSocketServer({ server });

// Sockets handled by THIS instance, grouped by tenant slug so a NOTIFY triggers
// one read per distinct tenant rather than one per socket.
const byTenant = new Map();          // slug -> Set<ws>

let listener = null;                 // pg Client holding the LISTEN
let listenerStarting = null;         // in-flight connect, so we start only once
let coalesceTimer = null;
let safetyTimer = null;

function trackSocket(ws, slug) {
  if (!byTenant.has(slug)) byTenant.set(slug, new Set());
  byTenant.get(slug).add(ws);
}

function untrackSocket(ws) {
  if (!ws.tenantSlug) return;
  const set = byTenant.get(ws.tenantSlug);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) byTenant.delete(ws.tenantSlug);
}

function send(ws, obj) {
  if (ws.readyState !== ws.OPEN) return false;
  try { ws.send(JSON.stringify(obj)); return true; }
  catch { return false; }
}

// Read one tenant's devices and fan out to that tenant's sockets on this
// instance. One database round trip serves however many dashboards are watching
// that tenant here.
async function pushTenant(slug) {
  const sockets = byTenant.get(slug);
  if (!sockets || sockets.size === 0) return;

  let devices;
  try {
    devices = await withTenantScope(slug, (client) =>
      readDevices(client, { tenantSlug: slug }));
  } catch (err) {
    console.error(`[ws] read failed for '${slug}':`, err.message);
    return;                           // clients keep their last good state
  }

  const frame = { type: 'devices', tenant: slug, devices, ts: Date.now() };
  for (const ws of sockets) send(ws, frame);
}

function pushAllTenants() {
  for (const slug of byTenant.keys()) pushTenant(slug);
}

function schedulePush() {
  if (coalesceTimer) return;          // already pending; absorb this one
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null;
    pushAllTenants();
  }, COALESCE_MS);
}

// Start (or restart) the shared LISTEN connection. Idempotent: concurrent
// callers await the same in-flight attempt rather than opening duplicates.
function ensureListener() {
  if (listener || listenerStarting) return listenerStarting ?? Promise.resolve();

  const connectionString =
    process.env.CLOUD_DATABASE_URL_SESSION ?? process.env.CLOUD_DATABASE_URL_OWNER;

  if (!connectionString) {
    console.warn('[ws] CLOUD_DATABASE_URL_SESSION not set — NOTIFY disabled, ' +
                 'falling back to the safety poll only');
    return Promise.resolve();
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });

  listenerStarting = client.connect()
    .then(() => client.query(`LISTEN ${CHANNEL}`))
    .then(() => {
      listener = client;
      listenerStarting = null;

      client.on('notification', (msg) => {
        if (msg.channel !== CHANNEL) return;
        schedulePush();
      });

      // A dropped listener must not silently stop the push path. Clear it so
      // the next socket event rebuilds it; the safety poll covers the gap.
      client.on('error', (e) => {
        console.error('[ws] listener error:', e.message);
        listener = null;
        try { client.end(); } catch { /* already gone */ }
      });
      client.on('end', () => { listener = null; });

      console.log(`[ws] listening on ${CHANNEL}`);
    })
    .catch((e) => {
      console.error('[ws] LISTEN failed:', e.message);
      listenerStarting = null;
      try { client.end(); } catch { /* already gone */ }
    });

  return listenerStarting;
}

function ensureSafetyPoll() {
  if (safetyTimer || !SAFETY_POLL_MS) return;
  safetyTimer = setInterval(() => {
    if (byTenant.size === 0) return;
    pushAllTenants();
  }, SAFETY_POLL_MS);
  safetyTimer.unref?.();
}

async function handleSubscribe(ws, slug) {
  if (!slug) {
    return send(ws, { type: 'error', error: 'tenant is required' });
  }

  // Validate by doing the real scoped read. resolve_tenant() throws 404 for an
  // unknown slug, so an invalid tenant is rejected here rather than being
  // tracked and silently receiving nothing.
  let devices;
  try {
    devices = await withTenantScope(slug, (client) =>
      readDevices(client, { tenantSlug: slug }));
  } catch (err) {
    return send(ws, {
      type: 'error',
      error: err.status === 404 ? `unknown tenant '${slug}'` : (err.message ?? 'read failed'),
    });
  }

  ws.tenantSlug = slug;
  trackSocket(ws, slug);

  ensureListener();
  ensureSafetyPoll();

  send(ws, { type: 'subscribed', tenant: slug });
  send(ws, { type: 'devices', tenant: slug, devices, ts: Date.now() });
}

wss.on('connection', (ws) => {
  ws.tenantSlug = null;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return send(ws, { type: 'error', error: 'malformed JSON' }); }

    if (msg?.type === 'subscribe') return handleSubscribe(ws, msg.tenant);
    return send(ws, { type: 'error', error: `unknown message type '${msg?.type}'` });
  });

  ws.on('close', () => untrackSocket(ws));
  ws.on('error', () => untrackSocket(ws));

  send(ws, { type: 'hello', tier: 'cloud', coalesceMs: COALESCE_MS });
});

// Fluid compute keeps an instance alive across connections, so dead sockets
// would otherwise accumulate against the tenant map.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { untrackSocket(ws); ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { untrackSocket(ws); ws.terminate(); }
  }
}, 30_000);
heartbeat.unref?.();

export default server;
