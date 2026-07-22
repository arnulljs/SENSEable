// api/health.js — liveness + which tier answered. Deliberately does NOT need a
// tenant: it proves the function can reach Supabase at all.
import { getPool } from './_db.js';

export default async function handler(_req, res) {
  try {
    const { rows } = await getPool().query(
      'SELECT current_user, now() AS ts, (SELECT count(*) FROM pg_class WHERE relname=$1) AS ok',
      ['devices']);
    res.status(200).json({
      ok: true,
      tier: 'cloud-read',
      store: 'supabase',
      role: rows[0].current_user,
      now: rows[0].ts,
    });
  } catch (err) {
    console.error('[health]', err);
    res.status(503).json({ ok: false, tier: 'cloud-read', error: err.message });
  }
}
