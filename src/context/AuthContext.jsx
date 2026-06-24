// context/AuthContext.jsx — Mock multi-tenant auth/session layer.
//
// There is no backend yet, so this context plays the role that a real auth
// service + the TENANTS/USERS tables (thesis Appendix I.2, "Tenant and
// Access ERD") will eventually play. It seeds itself once from
// mockData.js, then treats localStorage as the source of truth for the
// rest of the session — the same pattern InteractiveMap.jsx already uses
// for its own saved map profiles, just one layer up.
//
// Every place marked "→ backend" below is the exact seam where a real
// `fetch('/api/...')` call replaces the in-memory/localStorage logic. The
// function signatures (login, registerOrganization, joinOrganization,
// inviteOperator, removeMember) are written to stay the same after that
// swap, so components calling `useAuth()` shouldn't need to change.
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { organizations as seedOrganizations, users as seedUsers, roles } from '../mockData';

const ORGS_KEY    = 'senseful_auth_orgs';
const USERS_KEY   = 'senseful_auth_users';
const SESSION_KEY = 'senseful_auth_session'; // just the logged-in userId

function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full — session still works for this tab,
    // it just won't survive a reload.
  }
}

// Simulates the round-trip latency of a real auth API, so any loading
// state built against this context (spinners, disabled buttons) keeps
// working unchanged once `login`/`registerOrganization`/`joinOrganization`
// below are swapped for real requests.
function networkDelay(ms = 450) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateOrgCode(name) {
  const letters = (name.match(/[A-Za-z]/g) || ['X']).slice(0, 4).join('').toUpperCase().padEnd(4, 'X');
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${letters}-${suffix}`;
}

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'org';
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [organizations, setOrganizations] = useState(() => readJSON(ORGS_KEY, seedOrganizations));
  const [users, setUsers]                 = useState(() => readJSON(USERS_KEY, seedUsers));
  const [currentUserId, setCurrentUserId] = useState(() => readJSON(SESSION_KEY, null));
  const [authLoading, setAuthLoading]      = useState(false);

  useEffect(() => { writeJSON(ORGS_KEY, organizations); }, [organizations]);
  useEffect(() => { writeJSON(USERS_KEY, users); }, [users]);
  useEffect(() => { writeJSON(SESSION_KEY, currentUserId); }, [currentUserId]);

  const currentUser = useMemo(
    () => users.find(u => u.id === currentUserId) ?? null,
    [users, currentUserId]
  );
  const currentOrg = useMemo(
    () => (currentUser ? organizations.find(o => o.id === currentUser.tenantId) ?? null : null),
    [organizations, currentUser]
  );
  const role = useMemo(
    () => roles.find(r => r.id === currentUser?.roleId) ?? null,
    [currentUser]
  );
  const isDesigner = role?.id === 'designer';
  const isOperator = role?.id === 'operator';

  // Every account in the signed-in user's organization — this is the
  // "designer and operator share what's inside the org" surface (Team
  // page). Scoped purely by tenantId, same as devices/notifications.
  const orgUsers = useMemo(
    () => (currentOrg ? users.filter(u => u.tenantId === currentOrg.id) : []),
    [users, currentOrg]
  );

  function findUserByEmail(email) {
    return users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  }

  const login = useCallback(async (email, password) => {
    if (!email?.trim() || !password) {
      return { ok: false, error: 'Enter your email and password.' };
    }
    setAuthLoading(true);
    await networkDelay(); // → backend: POST /api/auth/login { email, password }
    setAuthLoading(false);

    const user = findUserByEmail(email);
    if (!user || user.password !== password) {
      return { ok: false, error: 'Incorrect email or password.' };
    }
    if (user.status !== 'active') {
      return { ok: false, error: 'This account has been deactivated. Contact your organization\u2019s Designer.' };
    }
    setCurrentUserId(user.id);
    return { ok: true };
  }, [users]); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = useCallback(() => {
    setCurrentUserId(null);
  }, []);

  // Tier 1 (Service Provider) is the one who normally provisions the first
  // Designer account for a new tenant, per the thesis's role hierarchy.
  // This form simulates that provisioning step so the prototype can be
  // evaluated end-to-end without a live backend or staff workflow behind
  // it — swap the body for a real provisioning request once one exists.
  const registerOrganization = useCallback(async ({ orgName, fullName, email, password }) => {
    if (!orgName?.trim() || !fullName?.trim() || !email?.trim() || !password) {
      return { ok: false, error: 'All fields are required.' };
    }
    if (password.length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters.' };
    }
    if (findUserByEmail(email)) {
      return { ok: false, error: 'An account with that email already exists.' };
    }

    setAuthLoading(true);
    await networkDelay(); // → backend: POST /api/orgs (creates a TENANTS row + its initial Designer USERS row)
    setAuthLoading(false);

    const orgId = `tnt_${Date.now()}`;
    const newOrg = {
      id: orgId,
      name: orgName.trim(),
      slug: slugify(orgName),
      orgCode: generateOrgCode(orgName),
      status: 'active',
      plan: 'Pilot',
      maxUsers: 6,
      createdAt: new Date().toISOString(),
    };
    const newUser = {
      id: `usr_${Date.now()}`,
      tenantId: orgId,
      roleId: 'designer',
      fullName: fullName.trim(),
      email: email.trim(),
      password,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    setOrganizations(prev => [...prev, newOrg]);
    setUsers(prev => [...prev, newUser]);
    setCurrentUserId(newUser.id);
    return { ok: true, org: newOrg };
  }, [users]); // eslint-disable-line react-hooks/exhaustive-deps

  const joinOrganization = useCallback(async ({ orgCode, fullName, email, password }) => {
    if (!orgCode?.trim() || !fullName?.trim() || !email?.trim() || !password) {
      return { ok: false, error: 'All fields are required.' };
    }
    if (password.length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters.' };
    }
    const org = organizations.find(o => o.orgCode.toLowerCase() === orgCode.trim().toLowerCase());
    if (!org) {
      return { ok: false, error: 'That organization code wasn\u2019t recognized.' };
    }
    if (findUserByEmail(email)) {
      return { ok: false, error: 'An account with that email already exists.' };
    }
    const seatCount = users.filter(u => u.tenantId === org.id).length;
    if (seatCount >= org.maxUsers) {
      return { ok: false, error: `${org.name} has reached its seat limit (${org.maxUsers}). Ask your Designer to free up a seat.` };
    }

    setAuthLoading(true);
    await networkDelay(); // → backend: POST /api/orgs/:orgCode/join (creates a USERS row scoped to that tenant_id)
    setAuthLoading(false);

    const newUser = {
      id: `usr_${Date.now()}`,
      tenantId: org.id,
      roleId: 'operator',
      fullName: fullName.trim(),
      email: email.trim(),
      password,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    setUsers(prev => [...prev, newUser]);
    setCurrentUserId(newUser.id);
    return { ok: true, org };
  }, [organizations, users]); // eslint-disable-line react-hooks/exhaustive-deps

  // Designer-only: provisions an Operator account inside the Designer's
  // own organization. There's no email infrastructure in this prototype,
  // so the generated temporary password is handed back once for the
  // Designer to relay out-of-band — a real backend would email an invite
  // link instead and never round-trip a password to the client at all.
  const inviteOperator = useCallback(({ fullName, email }) => {
    if (!isDesigner || !currentOrg) {
      return { ok: false, error: 'Only Designers can add team members.' };
    }
    if (!fullName?.trim() || !email?.trim()) {
      return { ok: false, error: 'Name and email are required.' };
    }
    if (findUserByEmail(email)) {
      return { ok: false, error: 'An account with that email already exists.' };
    }
    if (orgUsers.length >= currentOrg.maxUsers) {
      return { ok: false, error: `${currentOrg.name} has reached its seat limit (${currentOrg.maxUsers}).` };
    }

    const tempPassword = Math.random().toString(36).slice(2, 8);
    const newUser = {
      id: `usr_${Date.now()}`,
      tenantId: currentOrg.id,
      roleId: 'operator',
      fullName: fullName.trim(),
      email: email.trim(),
      password: tempPassword, // → backend: invite email + password_hash; never returned to the client
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    setUsers(prev => [...prev, newUser]); // → backend: POST /api/orgs/:id/members
    return { ok: true, user: newUser, tempPassword };
  }, [isDesigner, currentOrg, orgUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeMember = useCallback((userId) => {
    if (!isDesigner) {
      return { ok: false, error: 'Only Designers can remove team members.' };
    }
    const target = users.find(u => u.id === userId);
    if (!target || target.tenantId !== currentOrg?.id) {
      return { ok: false, error: 'User not found in this organization.' };
    }
    if (target.roleId === 'designer') {
      return { ok: false, error: 'Designer accounts can\u2019t be removed from here.' };
    }
    setUsers(prev => prev.filter(u => u.id !== userId)); // → backend: DELETE /api/orgs/:id/members/:userId (or soft-deactivate)
    return { ok: true };
  }, [isDesigner, users, currentOrg]);

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
