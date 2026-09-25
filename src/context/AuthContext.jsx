// context/AuthContext.jsx — real auth on Supabase Auth (identity) + our tenant
// membership (api/orgs + tenant_for_auth). Same public shape the mock exposed, so
// every consumer of useAuth() keeps working unchanged:
//   currentUser {id, fullName, email, tenantId, roleId}
//   currentOrg  {id, name, slug, orgCode}
//   role {id}, isDesigner, isOperator, orgUsers, authLoading
//   login, logout, registerOrganization, joinOrganization, inviteOperator, removeMember
//
// FLOW
//   sign up / log in  → Supabase Auth (email confirmation handled by Supabase).
//   after a session exists → GET membership via tenant_for_auth(); if the user
//     has none yet (just confirmed, not yet in a tenant), currentUser is null
//     and the app shows the create-account screen so they register or join.
//   register / join   → POST /api/orgs/{register,join} with the access token;
//     on success we re-resolve membership.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

async function api(action, token, body) {
  const res = await fetch(`/api/orgs/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [membership, setMembership] = useState(null); // tenant_for_auth row, or null
  const [authLoading, setAuthLoading] = useState(true);

  // Track the Supabase session (persisted, auto-refreshed).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Whenever the session changes, resolve which tenant this auth user belongs to.
  const resolveMembership = useCallback(async () => {
    if (!session?.user) { setMembership(null); return; }
    const { data, error } = await supabase.rpc('tenant_for_auth', { p_auth_id: session.user.id });
    setMembership(!error && data && data[0] ? data[0] : null);
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAuthLoading(true);
      await resolveMembership().catch(() => {});
      if (!cancelled) setAuthLoading(false);
    })();
    return () => { cancelled = true; };
  }, [resolveMembership]);

  // Shape the mock's fields from (session ⨝ membership).
  const currentUser = useMemo(() => {
    if (!session?.user || !membership) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      fullName: membership.full_name,
      tenantId: membership.tenant_id,
      roleId: membership.role_id,
    };
  }, [session, membership]);

  const currentOrg = useMemo(() => {
    if (!membership) return null;
    return { id: membership.tenant_id, slug: membership.slug, name: membership.slug };
  }, [membership]);

  const role = useMemo(() => (membership ? { id: membership.role_id } : null), [membership]);
  const isDesigner = role?.id === 'designer';
  const isOperator = role?.id === 'operator';

  // orgUsers (team page) requires an authorized read of the tenant's users; that
  // belongs behind the JWT-scoped read pass (Stage B follow-up). Empty for now
  // so the page renders without exposing anything cross-tenant.
  const orgUsers = useMemo(() => (currentUser ? [currentUser] : []), [currentUser]);

  const login = useCallback(async (email, password) => {
    if (!email || !password) return { ok: false, error: 'Enter your email and password.' };
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(), password,
    });
    if (error) {
      const msg = /confirm/i.test(error.message)
        ? 'Please confirm your email first — check your inbox for the link.'
        : 'Incorrect email or password.';
      return { ok: false, error: msg };
    }
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setMembership(null);
  }, []);

  // Sign up (Supabase sends the confirmation email), then create the tenant.
  // Because email confirmation is required, the tenant is created on the FIRST
  // authenticated call after the user confirms and returns — api/orgs rejects an
  // unconfirmed token. So we sign up, and if a session is immediately available
  // (confirmations disabled) we create right away; otherwise we tell the user to
  // confirm, and the create runs after they log in.
  const registerOrganization = useCallback(async ({ orgName, fullName, email, password, isTest }) => {
    if (!orgName || !fullName || !email || !password) return { ok: false, error: 'All fields are required.' };
    if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
    });
    if (error) {
      if (/registered/i.test(error.message)) return { ok: false, error: 'An account with that email already exists.' };
      return { ok: false, error: error.message };
    }
    // Remember the intended org name so we can finish after confirmation.
    try { window.localStorage.setItem('senseable_pending_org', orgName);
      window.localStorage.setItem('senseable_pending_org_test', isTest ? '1' : ''); } catch { /* ignore */ }

    if (!data.session) {
      return { ok: true, pendingConfirmation: true,
        message: 'Check your email to confirm your account, then log in to finish creating your organization.' };
    }
    const r = await api('register', data.session.access_token, { orgName, isTest: !!isTest });
    if (!r.ok) return { ok: false, error: r.data.error ?? 'Could not create organization.' };
    await resolveMembership();
    return { ok: true, org: r.data };
  }, [resolveMembership]);

  const joinOrganization = useCallback(async ({ orgCode, fullName, email, password }) => {
    if (!orgCode || !fullName || !email || !password) return { ok: false, error: 'All fields are required.' };
    if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
    });
    if (error) {
      if (/registered/i.test(error.message)) return { ok: false, error: 'An account with that email already exists.' };
      return { ok: false, error: error.message };
    }
    try { window.localStorage.setItem('senseable_pending_join', orgCode.trim().toUpperCase()); } catch { /* ignore */ }

    if (!data.session) {
      return { ok: true, pendingConfirmation: true,
        message: 'Check your email to confirm your account, then log in to join the organization.' };
    }
    const r = await api('join', data.session.access_token, { orgCode });
    if (!r.ok) return { ok: false, error: r.data.error ?? 'Could not join organization.' };
    await resolveMembership();
    return { ok: true, org: r.data };
  }, [resolveMembership]);

  // After a login, if the user confirmed but has no membership yet, finish the
  // register/join they started before confirming.
  useEffect(() => {
    if (!session?.user || membership || authLoading) return;
    (async () => {
      let pendingOrg, pendingJoin;
      try {
        pendingOrg = window.localStorage.getItem('senseable_pending_org');
        pendingJoin = window.localStorage.getItem('senseable_pending_join');
      } catch { /* ignore */ }
      const token = session.access_token;
      if (pendingOrg) {
        let pendingTest = false;
        try { pendingTest = window.localStorage.getItem('senseable_pending_org_test') === '1'; } catch {}
        const r = await api('register', token, { orgName: pendingOrg, isTest: pendingTest });
        if (r.ok) { try { window.localStorage.removeItem('senseable_pending_org'); window.localStorage.removeItem('senseable_pending_org_test'); } catch {} await resolveMembership(); }
      } else if (pendingJoin) {
        const r = await api('join', token, { orgCode: pendingJoin });
        if (r.ok) { try { window.localStorage.removeItem('senseable_pending_join'); } catch {} await resolveMembership(); }
      }
    })();
  }, [session, membership, authLoading, resolveMembership]);

  // Invites / member management need the authorized users-read pass; kept as
  // clear not-yet-available responses so the Team UI degrades gracefully.
  const inviteOperator = useCallback(async () =>
    ({ ok: false, error: 'Inviting members is not available yet in this build.' }), []);
  const removeMember = useCallback(async () =>
    ({ ok: false, error: 'Removing members is not available yet in this build.' }), []);

  const value = {
    currentUser, currentOrg, role, isDesigner, isOperator,
    orgUsers, authLoading,
    login, logout, registerOrganization, joinOrganization, inviteOperator, removeMember,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
