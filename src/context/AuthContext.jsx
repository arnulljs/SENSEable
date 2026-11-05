// context/AuthContext.jsx — real auth on Supabase Auth (identity) + our tenant
// membership (api/orgs + tenant_for_auth). Same public shape the mock exposed, so
// every consumer of useAuth() keeps working unchanged:
//   currentUser {id, fullName, email, tenantId, roleId}
//   currentOrg  {id, name, slug, orgCode, tid, maxUsers}
//   role {id}, isDesigner, isOperator, orgUsers, authLoading
//   login, logout, registerOrganization, joinOrganization, inviteOperator, removeMember
//   passwordSetup, sessionReady, linkError, completePasswordSetup, requestPasswordReset
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

// Email links (operator invite, password reset) return here with
// ?set-password=invite|reset, which the app answers with the set-password
// screen. Read once at load: supabase-js consumes the #access_token hash itself,
// but a failed link (expired, already used) leaves #error_description, which it
// does not, so that is read here too.
const initialUrl = typeof window === 'undefined' ? null : new URL(window.location.href);
const initialSetup = initialUrl?.searchParams.get('set-password') || null;
// Email templates link here with ?token_hash=…&type=recovery|invite (see the
// Supabase template note in SetPasswordPage). The token is verified by THIS
// page's JavaScript, so a mail scanner that pre-opens the link (which burned
// Supabase's own one-click verify links: "Email link is invalid or has
// expired" on the first real click) cannot use it up.
const initialTokenHash = initialUrl?.searchParams.get('token_hash') || null;
const initialOtpType = initialUrl?.searchParams.get('type') || null;
const initialLinkError = (() => {
  const h = new URLSearchParams((initialUrl?.hash ?? '').replace(/^#/, ''));
  return h.get('error_description')?.replace(/\+/g, ' ') ?? null;
})();
const redirectFor = (kind) => `${window.location.origin}/?set-password=${kind}`;

async function api(action, token, body) {
  const res = await fetch(`/api/orgs/${action}`, {
    method: 'POST',
    headers: token
      ? { 'content-type': 'application/json', authorization: `Bearer ${token}` }
      : { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [membership, setMembership] = useState(null); // tenant_for_auth row, or null
  const [authLoading, setAuthLoading] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [passwordSetup, setPasswordSetup] = useState(initialSetup);   // 'invite' | 'reset' | null
  const [linkError, setLinkError] = useState(initialLinkError);

  // Track the Supabase session (persisted, auto-refreshed).
  useEffect(() => {
    (async () => {
      if (initialTokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: initialTokenHash, type: initialOtpType === 'invite' ? 'invite' : 'recovery' });
        if (error) setLinkError(error.message);
        // Drop the one-time token from the address bar: a reload must not reuse it.
        const u = new URL(window.location.href);
        u.searchParams.delete('token_hash'); u.searchParams.delete('type');
        window.history.replaceState(null, '', u.pathname + u.search);
      }
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setSessionReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s ?? null);
      // A reset link opened without our query string still lands here.
      if (event === 'PASSWORD_RECOVERY') setPasswordSetup((k) => k ?? 'reset');
    });
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

  // The login lookup only carries ids, so the organization's real name, join
  // code and Tenant ID come from /api/orgs/me. Served by the
  // cloud tier; where it isn't (the edge's own copy of this app) the fields
  // stay empty and the page shows what it has.
  const [orgInfo, setOrgInfo] = useState(null);
  const accessToken = session?.access_token;
  useEffect(() => {
    if (!membership || !accessToken) return;
    let cancelled = false;
    api('me', accessToken)
      .then((r) => { if (!cancelled) setOrgInfo(r.ok ? r.data : null); })
      .catch(() => { if (!cancelled) setOrgInfo(null); });
    return () => { cancelled = true; };
  }, [membership, accessToken]);
  // After an invite or removal, re-read the roster.
  const refreshOrg = useCallback(async () => {
    if (!membership || !accessToken) return;
    const r = await api('me', accessToken).catch(() => null);
    if (r?.ok) setOrgInfo(r.data);
  }, [membership, accessToken]);

  const currentOrg = useMemo(() => {
    if (!membership) return null;
    // Details fetched for a previous sign-in are ignored rather than cleared.
    const info = orgInfo?.slug === membership.slug ? orgInfo : null;
    return {
      id: membership.tenant_id, slug: membership.slug,
      name: info?.name ?? membership.slug,
      orgCode: info?.org_code ?? null,
      tid: info?.mqtt_tid ?? null,
      maxUsers: info?.max_users ?? null,
    };
  }, [membership, orgInfo]);

  const role = useMemo(() => (membership ? { id: membership.role_id } : null), [membership]);
  const isDesigner = role?.id === 'designer';
  const isOperator = role?.id === 'operator';

  // Team page members, from /api/orgs/me (scoped server-side to the caller's
  // tenant). Until it answers, or where it isn't served, just the signed-in user.
  const orgUsers = useMemo(() => {
    const info = orgInfo?.slug === membership?.slug ? orgInfo : null;
    return info?.members ?? (currentUser ? [currentUser] : []);
  }, [orgInfo, membership, currentUser]);

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

    // The server derives the Tenant ID from the name; check it's free BEFORE
    // creating the account. With email confirmation on, the organization is only
    // created after the designer confirms, so a clash found then would fail
    // where nobody sees it.
    const check = await api('tid-check', null, { orgName });
    if (!check.ok) return { ok: false, error: check.data.error ?? 'Could not check the Tenant ID. Try again.' };
    if (!check.data.available) return { ok: false, error: check.data.error };
    const summary = { orgName, tid: check.data.tid, email: email.trim() };

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
      return { ok: true, pendingConfirmation: true, summary,
        message: 'Confirm the email address, then sign in to finish creating the organization.' };
    }
    const r = await api('register', data.session.access_token, { orgName, isTest: !!isTest });
    if (!r.ok) return { ok: false, error: r.data.error ?? 'Could not create organization.' };
    await resolveMembership();
    return { ok: true, org: r.data, summary: { ...summary, tid: r.data.mqtt_tid ?? summary.tid, orgCode: r.data.org_code } };
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
        // ponytail: a tid taken by someone else between the form's check and this
        // call is only logged, and the next sign-in retries. The form checked it
        // seconds or minutes earlier, so this needs two same-name registrations
        // racing; surface it on the login screen if that ever happens in practice.
        const r = await api('register', token, { orgName: pendingOrg, isTest: pendingTest });
        if (r.ok) {
          try { ['senseable_pending_org', 'senseable_pending_org_test']
            .forEach((k) => window.localStorage.removeItem(k)); } catch {}
          await resolveMembership();
        } else {
          console.error('[auth] finishing organization registration failed:', r.data.error);
        }
      } else if (pendingJoin) {
        const r = await api('join', token, { orgCode: pendingJoin });
        if (r.ok) { try { window.localStorage.removeItem('senseable_pending_join'); } catch {} await resolveMembership(); }
      }
    })();
  }, [session, membership, authLoading, resolveMembership]);

  // Designer member management (api/orgs/invite, /remove). The invited person
  // gets an email from Supabase whose link opens the set-password screen.
  const inviteOperator = useCallback(async ({ fullName, email }) => {
    if (!fullName?.trim() || !email?.trim()) return { ok: false, error: 'Enter a full name and an email.' };
    const r = await api('invite', accessToken, { fullName, email }).catch(() => null);
    if (!r) return { ok: false, error: 'Could not reach the server. Try again.' };
    if (!r.ok) return { ok: false, error: r.data.error ?? 'Could not add the operator.' };
    await refreshOrg();
    return { ok: true, member: r.data.member };
  }, [accessToken, refreshOrg]);
  const removeMember = useCallback(async (userId) => {
    const r = await api('remove', accessToken, { userId }).catch(() => null);
    if (!r) return { ok: false, error: 'Could not reach the server. Try again.' };
    if (!r.ok) return { ok: false, error: r.data.error ?? 'Could not remove the member.' };
    await refreshOrg();
    return { ok: true };
  }, [accessToken, refreshOrg]);

  // Set the password from an invite or reset link (the link already signed the
  // person in). Clears the query string so a reload doesn't ask again.
  const completePasswordSetup = useCallback(async (password) => {
    if (!password || password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, error: error.message };
    window.history.replaceState(null, '', window.location.pathname);
    setPasswordSetup(null);
    return { ok: true };
  }, []);

  // "Forgot password": always reports success, so the form can't be used to
  // find out which emails have accounts.
  const requestPasswordReset = useCallback(async (email) => {
    if (!email?.trim()) return { ok: false, error: 'Enter your email.' };
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectFor('reset') });
    if (error && /rate|limit|seconds/i.test(error.message)) return { ok: false, error: error.message };
    return { ok: true };
  }, []);

  const value = {
    currentUser, currentOrg, role, isDesigner, isOperator,
    orgUsers, authLoading, sessionReady, session,
    login, logout, registerOrganization, joinOrganization, inviteOperator, removeMember,
    passwordSetup, linkError, completePasswordSetup, requestPasswordReset,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
