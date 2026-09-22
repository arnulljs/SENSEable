// api/health.js — liveness, plus the freshness the connection banner needs.
//
// TWO QUERIES, TWO FAILURE MODES, DELIBERATELY SEPARATED.
//
// Liveness has to answer without a tenant: it is what a curl, an uptime probe or
// a browser hitting a cold function asks, and it must not depend on anything
// except "can this function reach the database".
//
// Freshness cannot. `readings` is under row-level security, and the policy
// compares tenant_id against current_setting('app.current_tenant')::uuid. With
// no tenant set that setting is the empty string, the uuid cast throws, and the
// WHOLE endpoint returned 503 with "invalid input syntax for type uuid" — which
// the dashboard correctly read as "cannot reach the server", because from its
// point of view that is exactly what happened.
//
// So freshness runs only when a tenant is supplied, inside the same scoped
// transaction the read routes use, and a failure there degrades to nulls rather
// than taking liveness down with it.
import { getPool, withTenantScope } from './_db.js';

export default async function handler(req, res) {
  let base;
  try {
    const { rows } = await getPool().query('SELECT current_user, now() AS ts');
    base = { ok: true, tier: 'cloud', store: 'supabase', role: rows[0].current_user, now: rows[0].ts };
  } catch (err) {
    console.error('[health] database unreachable:', err);
    return res.status(503).json({ ok: false, tier: 'cloud', error: err.message });
  }

  const slug = req.headers?.['x-tenant-id'] || req.query?.tenant || null;
  if (!slug) return res.status(200).json(base);

  try {
    const data = await withTenantScope(slug, async (client) => {
      const { rows } = await client.query(
        `SELECT max(ts) AS newest,
                count(*) FILTER (WHERE NOT synced) AS unsynced
           FROM readings`);
      const newest = rows[0].newest ? new Date(rows[0].newest).getTime() : null;
      return {
        newestTelemetryAgeMs: newest ? Date.now() - newest : null,
        // Non-zero should be impossible: the cloud is the sync DESTINATION, not
        // a source. A number here means a tier is running without TIER=cloud.
        unsyncedInCloud: Number(rows[0].unsynced),
      };
    });
    return res.status(200).json({ ...base, ...data });
  } catch (err) {
    // An unknown tenant or an RLS refusal is not a health failure. Say so and
    // let liveness stand.
    console.error('[health] freshness unavailable:', err.message);
    return res.status(200).json({ ...base, newestTelemetryAgeMs: null, freshnessError: err.message });
  }
}
