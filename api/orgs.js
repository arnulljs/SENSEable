// api/orgs.js — organization registration & join (Vercel serverless function)
//
// Identity is Supabase Auth. These endpoints run AFTER the caller has a valid
// Supabase session (signed up + confirmed email, or logged in) and turn that
// identity into tenant membership:
//
//   POST /api/orgs/register  { orgName }          → new tenant, caller = Designer
//   POST /api/orgs/join      { orgCode }          → existing tenant, caller = Operator
//
// The caller proves who they are with their Supabase access token in the
// Authorization header; the SECRET key is used server-side only to verify that
// token and to write the tenant/user rows (bypassing RLS deliberately, since
// creating a brand-new tenant is exactly the one write that has no tenant scope
// yet). Never expose the secret key to the browser.
//
// Idempotent: a caller who already belongs to a tenant gets their existing
// membership back instead of a second tenant — so a double-submit or a retry
// after a flaky network can't create duplicates.

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Pool } = pg;
let _pool;
function getPool() {
  if (!_pool) {
    const connectionString = process.env.CLOUD_DATABASE_URL_POOLED ?? process.env.DATABASE_URL_OWNER;
    if (!connectionString) throw new Error('CLOUD_DATABASE_URL_POOLED not set');
    _pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 3 });
  }
  return _pool;
}

const admin = () =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

function slugify(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40) || 'org';
}
// e.g. "MOD Clinic" → "MODC-3812"
function orgCodeFrom(name) {
  const letters = String(name).toUpperCase().replace(/[^A-Z]/g, '').padEnd(4, 'X').slice(0, 4);
  return `${letters}-${Math.floor(1000 + Math.random() * 9000)}`;
}

async function callerFromToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return { error: 'missing bearer token' };
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) return { error: 'invalid or expired session' };
  if (!data.user.email_confirmed_at) return { error: 'email not confirmed yet' };
  return { user: data.user };
}

async function existingMembership(pool, authId) {
  const { rows } = await pool.query('SELECT * FROM tenant_for_auth($1)', [authId]);
  return rows[0] ?? null;
}

async function register(req, res, pool, user) {
  const orgName = String(req.body?.orgName ?? '').trim();
  const isTest = req.body?.isTest === true;
  if (orgName.length < 2) return res.status(400).json({ error: 'orgName is required' });

  const already = await existingMembership(pool, user.id);
  if (already) return res.status(200).json({ ok: true, alreadyMember: true, ...already });

  const fullName = user.user_metadata?.full_name ?? user.email.split('@')[0];
  // Retry a couple of times on the astronomically unlikely slug/code collision.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? slugify(orgName) : `${slugify(orgName)}-${Math.floor(Math.random() * 900 + 100)}`;
    const code = orgCodeFrom(orgName);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const t = await c.query(
        `INSERT INTO tenants (slug, org_code, name, status, is_test) VALUES ($1,$2,$3,'active',$4)
         RETURNING tenant_id, slug, org_code`, [slug, code, orgName, isTest]);
      const tenantId = t.rows[0].tenant_id;
      await c.query(
        `INSERT INTO users (tenant_id, role_id, full_name, email, auth_id, status)
         VALUES ($1,'designer',$2,$3,$4,'active')`,
        [tenantId, fullName, user.email, user.id]);
      await c.query('COMMIT');
      return res.status(201).json({
        ok: true, tenant_id: tenantId, slug: t.rows[0].slug,
        org_code: t.rows[0].org_code, role_id: 'designer', full_name: fullName,
      });
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      if (e.code === '23505') continue;         // unique violation → retry with a new slug/code
      throw e;
    } finally { c.release(); }
  }
  return res.status(409).json({ error: 'could not allocate a unique org slug — try a different name' });
}

async function join(req, res, pool, user) {
  const orgCode = String(req.body?.orgCode ?? '').trim().toUpperCase();
  if (!orgCode) return res.status(400).json({ error: 'orgCode is required' });

  const already = await existingMembership(pool, user.id);
  if (already) return res.status(200).json({ ok: true, alreadyMember: true, ...already });

  const t = await pool.query('SELECT tenant_id, slug, name, max_users FROM tenants WHERE org_code = $1', [orgCode]);
  if (!t.rows.length) return res.status(404).json({ error: 'no organization with that code' });
  const tenant = t.rows[0];

  const count = await pool.query('SELECT count(*)::int AS n FROM users WHERE tenant_id = $1', [tenant.tenant_id]);
  if (count.rows[0].n >= tenant.max_users) {
    return res.status(403).json({ error: 'this organization has reached its member limit' });
  }

  const fullName = user.user_metadata?.full_name ?? user.email.split('@')[0];
  try {
    await pool.query(
      `INSERT INTO users (tenant_id, role_id, full_name, email, auth_id, status)
       VALUES ($1,'operator',$2,$3,$4,'active')`,
      [tenant.tenant_id, fullName, user.email, user.id]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'this email already belongs to an organization' });
    throw e;
  }
  return res.status(201).json({
    ok: true, tenant_id: tenant.tenant_id, slug: tenant.slug,
    role_id: 'operator', full_name: fullName,
  });
}

// Purge test tenants and their Supabase Auth users. Guarded by ADMIN_WIPE_TOKEN
// (a Vercel env var you set) — NOT a normal user session, since it deletes data
// with the service key. olderThanHours filters by age; 0 wipes all test tenants.
async function wipe(req, res, pool) {
  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_WIPE_TOKEN || token !== process.env.ADMIN_WIPE_TOKEN) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const hours = Number(req.body?.olderThanHours ?? 0);
  const interval = `${Number.isFinite(hours) && hours > 0 ? hours : 0} hours`;
  const { rows } = await pool.query('SELECT auth_id FROM purge_test_tenants($1::interval)', [interval]);
  const sb = admin();
  let deletedAuth = 0;
  for (const r of rows) {
    if (!r.auth_id) continue;
    const { error } = await sb.auth.admin.deleteUser(r.auth_id);
    if (!error) deletedAuth += 1;
  }
  return res.status(200).json({ ok: true, tenantsWiped: rows.length, authUsersDeleted: deletedAuth });
}

// Vercel Cron calls this daily; it purges test tenants older than 24h. Vercel
// signs cron requests with CRON_SECRET in the Authorization header, so no manual
// token is needed for the scheduled path.
async function wipeCron(req, res, pool) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(403).json({ error: 'forbidden' });
  }
  const { rows } = await pool.query("SELECT auth_id FROM purge_test_tenants(interval '24 hours')");
  const sb = admin();
  let deletedAuth = 0;
  for (const r of rows) { if (r.auth_id) { const { error } = await sb.auth.admin.deleteUser(r.auth_id); if (!error) deletedAuth += 1; } }
  console.log(`[orgs] wipe-cron: ${rows.length} test tenants >24h purged, ${deletedAuth} auth users deleted`);
  return res.status(200).json({ ok: true, tenantsWiped: rows.length, authUsersDeleted: deletedAuth });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only' }); }
  const action = (req.query?.action ?? '').toString();
  try {
    const pool = getPool();
    if (action === 'wipe') return await wipe(req, res, pool);
    if (action === 'wipe-cron') return await wipeCron(req, res, pool);
    const { user, error } = await callerFromToken(req);
    if (error) return res.status(401).json({ error });
    if (action === 'register') return await register(req, res, pool, user);
    if (action === 'join')     return await join(req, res, pool, user);
    return res.status(404).json({ error: 'unknown action; use /api/orgs/register or /api/orgs/join' });
  } catch (e) {
    console.error('[orgs]', e);
    return res.status(500).json({ error: e.message });
  }
}
