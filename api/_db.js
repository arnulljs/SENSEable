// api/_db.js ────────────────────────────────────────────────────────────────
// Connection + tenant-scoping helper for the Vercel read tier.
//
// This is the CLOUD half of the two-tier design. It is deliberately limited:
// read-only, stateless, no cache, no MQTT. All authority — ingest, calibration,
// command publication — stays on the on-site edge server. If this whole
// deployment vanished, the edge would keep sensing, logging and alerting; only
// remote viewing would stop. That's the property the architecture is built for.
//
// THREE THINGS THAT ARE EASY TO GET WRONG HERE
//
// 1. POOLER MODE. We connect through Supabase's TRANSACTION-mode pooler (:6543)
//    because serverless invocations are many and short-lived; session mode
//    would exhaust the connection limit. Transaction mode means a backend
//    connection is only ours for the duration of a transaction — which is
//    exactly why withTenant() uses set_config(..., is_local => true) inside an
//    explicit BEGIN/COMMIT. A plain SET would leak the tenant to whoever
//    borrowed the connection next. The edge server's db/pool.js already did it
//    this way, so the pattern ports over unchanged.
//
// 2. MODULE-SCOPE POOL. Vercel reuses a warm function instance across requests.
//    Creating the Pool at module scope lets those reuse a connection instead of
//    paying TLS setup every time; max is deliberately tiny since the real
//    pooling happens in Supavisor.
//
// 3. FAIL-CLOSED. No tenant resolved ⇒ we do NOT fall back to "all tenants".
//    We return 400. RLS would return zero rows anyway, but failing loudly beats
//    silently rendering an empty dashboard that looks like a hardware outage.

/* global process -- Node serverless code; the repo's ESLint config is browser-only */
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Pool } = pg;

let _pool;
export function getPool() {
  if (!_pool) {
    const connectionString =
      process.env.CLOUD_DATABASE_URL_POOLED ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('CLOUD_DATABASE_URL_POOLED is not set in the Vercel environment');
    }
    _pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      // Supabase terminates TLS with its own CA. Vercel's function image has no
      // way to reference a checked-in .crt reliably, so we encrypt without
      // chain pinning here. The EDGE tier — which handles the authoritative
      // data — does verify against the pinned CA.
      // Supabase terminates TLS with its own CA and Vercel's function image has
      // no reliable way to reference a checked-in .crt, so the cloud tier
      // encrypts without chain pinning. CLOUD_DB_NO_SSL exists only so the
      // handlers can be run against a plain local Postgres in tests; a
      // deployment must never set it.
      ssl: process.env.CLOUD_DB_NO_SSL === 'true' ? false : { rejectUnauthorized: false },
    });
    _pool.on('error', (e) => console.error('[pg] idle client error:', e.message));
  }
  return _pool;
}

// The tenant a request CLAIMS. Same contract the Express API uses. On this tier
// a claim is never trusted on its own — see callerTenant().
function tenantOf(req) {
  const q = req.query ?? {};
  return req.headers?.['x-tenant-id'] || q.tenant || null;
}

// ── Caller identity ─────────────────────────────────────────────────────────
// This tier is on the public internet and its write routes actuate physical
// hardware. Until this existed, the tenant came from the x-tenant-id header and
// nothing else, so anyone — signed in or not — could read any organisation's
// data or queue commands at its pumps by naming its slug.
//
// Now every request must carry the signed-in user's Supabase access token. The
// token is verified with Supabase, the user's organisation is looked up with the
// same tenant_for_auth() the dashboard uses at login, and THAT is the tenant the
// request runs as. A header naming a different organisation is refused.
const httpErr = (status, message) => Object.assign(new Error(message), { status });

let _admin;
const admin = () => (_admin ??= createClient(
  process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }));

// Verified token → slug. The dashboard polls every couple of seconds, and a
// round trip to Supabase Auth on each poll would add latency and burn its rate
// limit, so a verified answer is reused for a minute. Consequence: disabling an
// account takes up to CALLER_TTL_MS to bite on an instance that already saw it.
const CALLER_TTL_MS = Number(process.env.CALLER_TTL_MS ?? 60_000);
const callerCache = new Map();   // token -> { slug, at }

export async function tenantForToken(token) {
  if (!token) throw httpErr(401, 'sign in required');
  const hit = callerCache.get(token);
  if (hit && Date.now() - hit.at < CALLER_TTL_MS) return hit.slug;

  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) throw httpErr(401, 'invalid or expired session — sign in again');
  if (!data.user.email_confirmed_at) throw httpErr(403, 'email not confirmed yet');

  const { data: rows, error: rpcErr } =
    await admin().rpc('tenant_for_auth', { p_auth_id: data.user.id });
  if (rpcErr) throw httpErr(500, `membership lookup failed: ${rpcErr.message}`);
  const m = rows?.[0];
  if (!m) throw httpErr(403, 'this account is not a member of any organization');
  if (m.status !== 'active') throw httpErr(403, `this account is ${m.status}`);

  // ponytail: whole-map clear at a size cap, not LRU. Warm instances are
  // short-lived and the cap is only there to stop unbounded growth.
  if (callerCache.size > 1000) callerCache.clear();
  callerCache.set(token, { slug: m.slug, at: Date.now() });
  return m.slug;
}

/** The tenant this request may act as, from its verified bearer token. */
export async function callerTenant(req) {
  const auth = req.headers?.authorization || '';
  const slug = await tenantForToken(auth.startsWith('Bearer ') ? auth.slice(7) : null);
  const claimed = tenantOf(req);
  if (claimed && claimed !== slug) {
    throw httpErr(403, `not a member of organization '${claimed}'`);
  }
  return slug;
}

/**
 * Run a read scoped to exactly one tenant.
 *
 * resolve_tenant() is a SECURITY DEFINER function (migration 005) that exists
 * solely to break the RLS bootstrap deadlock: we cannot read `tenants` to find
 * our uuid until we've declared which tenant we are. Everything after that
 * point runs as senseable_app under normal RLS — a bug in a handler physically
 * cannot read another tenant's rows.
 */
export async function withTenantScope(slug, fn) {
  if (!slug) throw Object.assign(new Error('tenant is required'), { status: 400 });

  const client = await getPool().connect();
  try {
    const { rows } = await client.query('SELECT resolve_tenant($1) AS id', [slug]);
    const tenantUuid = rows[0]?.id;
    if (!tenantUuid) {
      throw Object.assign(new Error(`unknown tenant '${slug}'`), { status: 404 });
    }

    await client.query('BEGIN');
    // is_local = true → discarded at COMMIT, so the setting can never outlive
    // this transaction on a pooled connection.
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantUuid]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Wraps a read model into a Vercel handler: GET-only, tenant-scoped, with
 * consistent error shapes and a short CDN cache so a dashboard polling every
 * few seconds doesn't hammer the database once several people are watching.
 */
export function readHandler(readFn, { cacheSeconds = 2 } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method not allowed — this tier is read-only' });
    }
    try {
      const slug = await callerTenant(req);
      const data = await withTenantScope(slug, (client) =>
        readFn(client, { tenantSlug: slug, req }));
      // PRIVATE, never shared. This used to be `public, s-maxage=N`, which let
      // Vercel's CDN cache the response keyed by URL alone — and the tenant
      // travels in a header, not the URL — so one organisation's /api/devices
      // could be served from cache to another polling the same path. `public`
      // also explicitly overrides the rule that shared caches don't store
      // authenticated responses. The cost is that every poll reaches the
      // function. `cacheSeconds` is now unused (kept so router.js's table and
      // this signature don't change).
      void cacheSeconds;
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization, x-tenant-id');
      return res.status(200).json(data);
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) console.error('[read]', err);
      return res.status(status).json({ error: err.message ?? 'read failed' });
    }
  };
}
