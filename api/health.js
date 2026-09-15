// api/health.js — liveness, plus the freshness the dashboard's connection banner
// needs. Deliberately does NOT require a tenant: it proves the function can
// reach Supabase at all, which is the question being asked when the dashboard
// has stopped moving.
//
// `tier` used to be 'cloud-read'. That is no longer true: under cloud-first this
// deployment ingests live telemetry and accepts writes through api/_write.js, so
// the label would tell the UI to disable controls that work.
//
// newestTelemetryAgeMs is the cloud tier's only view of hardware health. The
// edge can report the observed MQTT route because it holds broker connections;
// this tier cannot see a broker at all, so "nothing has arrived in two minutes"
// is the closest available signal and it is what src/api.js falls back to.
import { getPool } from './_db.js';

export default async function handler(_req, res) {
  try {
    const { rows } = await getPool().query(
      `SELECT current_user,
              now() AS ts,
              (SELECT max(ts) FROM readings) AS newest,
              (SELECT count(*) FROM readings WHERE NOT synced) AS unsynced`);
    const newest = rows[0].newest ? new Date(rows[0].newest).getTime() : null;

    res.status(200).json({
      ok: true,
      tier: 'cloud',
      store: 'supabase',
      role: rows[0].current_user,
      newestTelemetryAgeMs: newest ? Date.now() - newest : null,
      // Non-zero here means rows are sitting in the CLOUD marked unsynced, which
      // should never happen: the cloud is the sync destination, not a source. It
      // is surfaced because a non-zero value indicates a misconfigured tier
      // (TIER not set to 'cloud' on the bridge), not a transient condition.
      unsyncedInCloud: Number(rows[0].unsynced),
      now: rows[0].ts,
    });
  } catch (err) {
    console.error('[health]', err);
    res.status(503).json({ ok: false, tier: 'cloud', error: err.message });
  }
}
