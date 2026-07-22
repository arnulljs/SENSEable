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

import pg from 'pg';

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
      ssl: { rejectUnauthorized: false },
    });
    _pool.on('error', (e) => console.error('[pg] idle client error:', e.message));
  }
  return _pool;
}

// The tenant a request is scoped to. Same contract the Express API uses, so the
// frontend's api.js needs no changes when it's pointed at the cloud tier.
export function tenantOf(req) {
  const q = req.query ?? {};
  return req.headers?.['x-tenant-id'] || q.tenant || null;
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
      const slug = tenantOf(req);
      const data = await withTenantScope(slug, (client) =>
        readFn(client, { tenantSlug: slug, req }));
      res.setHeader('Cache-Control',
        `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=10`);
      return res.status(200).json(data);
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) console.error('[read]', err);
      return res.status(status).json({ error: err.message ?? 'read failed' });
    }
  };
}
