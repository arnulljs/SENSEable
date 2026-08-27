import { useState, useMemo, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import DeviceOverview from './pages/DeviceOverview';
import SensorDetail from './pages/SensorDetail';
import Notifications from './pages/Notifications';
import Calibration from './pages/Calibration';
import Actuators from './pages/Actuators';
import Team from './pages/Team';
import LoginPage from './pages/LoginPage';
import CreateAccountPage from './pages/CreateAccountPage';
import { useAuth } from './context/AuthContext';
import { connectRealtime } from './realtime';
import {
  devices as seedDevices,
  notifications as allNotifications,
  computeSensorStatus,
  buildActuatorCommand,
  clampDuty,
} from './mockData';
import {
  fetchDevices, actuate, setTenant,
  renameDevice as apiRenameDevice,
  renameModule as apiRenameModule,
  renameActuator as apiRenameActuator,
  removeDevice as apiRemoveDevice,
  removeModule as apiRemoveModule,
  removePort as apiRemovePort,
  setPortEnabled as apiSetPortEnabled,
} from './api';
import './App.css';

// How often to pull fresh readings from the backend. 0 = fetch once on load
// and never poll.
const POLL_MS = 3000;

// Merge live backend telemetry into App's device state WITHOUT clobbering
// sensor CONFIG. Division of ownership:
//   backend owns → live value, history, node status/commMode/uptime/rssi/heap,
//                   and the actuator cmd/ack lifecycle (last_ack, state, duty)
//   frontend owns → label, unit, ranges, safe band (via Edit Sensor)
//
// Status is always RECOMPUTED from the merged value against the *local*
// thresholds, so an Edit Sensor change reflects immediately and is never
// overwritten by the next poll.
function mergeTelemetry(localDevices, backendDevices) {
  const localById = new Map(localDevices.map(d => [d.id, d]));

  return backendDevices.map(bd => {
    const ld = localById.get(bd.id);

    // Brand-new device the backend reported but we've never seen. NOTE the
    // `actuators: []` default — Actuators.jsx does an unguarded
    // `d.actuators.map(...)`, so a device without the field crashes the
    // Control page. The backend never sends one.
    if (!ld) return { ...bd, actuators: bd.actuators ?? [] };

    return {
      ...ld,                       // keep local config/name AND local actuators
      status: bd.status,           // live node status from backend
      commMode: bd.commMode,
      uptime: bd.uptime,
      rssi: bd.rssi,
      freeHeap: bd.freeHeap,
      // PRESENCE IS BACKEND-OWNED. Only the server knows when hardware last
      // reported, so these must be copied on every poll. Leaving them to the
      // `...ld` spread froze them at whatever the first page load returned —
      // which is why a node publishing right now still read "last seen 22h ago".
      lastSeen: bd.lastSeen ?? null,
      active: bd.active,
      configured: bd.configured,
      // Actuators: the backend now owns the cmd/ack lifecycle (last_ack, state,
      // duty), so merge its state over local by id. If the backend returned none
      // (e.g. it's offline), keep whatever we had locally so the page still works.
      actuators: (bd.actuators && bd.actuators.length)
        ? bd.actuators.map(ba => {
            const la = (ld.actuators || []).find(a => a.id === ba.id);
            return la ? { ...la, ...ba } : ba;
          })
        : (ld.actuators ?? []),
      modules: bd.modules.map(bm => {
        const lm = ld.modules.find(m => m.id === bm.id);
        if (!lm) return bm;        // newly discovered board
        return {
          ...lm,
          // Board presence + its own status rollup are backend-derived too.
          lastSeen: bm.lastSeen ?? null,
          active: bm.active,
          status: bm.status,
          configured: bm.configured,
          ports: bm.ports.map(bp => {
            const lp = lm.ports.find(p => p.id === bp.id);
            if (!lp) return bp;    // newly discovered port
            const value = bp.value;

            // Status is a JOINT decision and the split matters:
            //
            //   Backend-only  Disabled (operator switched the channel off) and
            //                 Offline (nothing reported inside STALE_MS). The
            //                 browser cannot derive either — it has no clock
            //                 against last_seen and no enabled flag of its own.
            //
            //   Client-side   Normal / Warning / Fault, because those depend on
            //                 the safe band, which the operator may have edited
            //                 locally and not yet saved.
            //
            // Recomputing unconditionally (the old behaviour) discarded the two
            // verdicts only the server can make, so a dead or disabled channel
            // kept showing a cheerful colour derived from its last known value.
            const status = (bp.status === 'Disabled' || bp.status === 'Offline')
              ? bp.status
              : computeSensorStatus(value, lp.rangeMin, lp.rangeMax, lp.safeMin, lp.safeMax);

            const history = (bp.history || []).map(h => ({
              ...h,
              status: computeSensorStatus(
                h.value, lp.rangeMin, lp.rangeMax, lp.safeMin, lp.safeMax
              ),
            }));
            return {
              ...lp,
              value, status, history,
              lastSeen: bp.lastSeen ?? null,
              active: bp.active,
              enabled: bp.enabled,
              configured: bp.configured,
              activeFlag: bp.activeFlag,
              connState: bp.connState ?? null,
              masked: !!bp.masked,
            };
          }),
        };
      }),
    };
  });
}

// Shown whenever there's no signed-in user. Its own tiny bit of local
// state just toggles between the two auth screens — nothing here needs
// to live in AuthContext since neither screen is "navigable to" once
// signed in.
function AuthGate() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  return mode === 'login'
    ? <LoginPage onSwitchToSignup={() => setMode('signup')} />
    : <CreateAccountPage onSwitchToLogin={() => setMode('login')} />;
}

export default function App() {
  const { currentUser, currentOrg, isDesigner } = useAuth();

  // Top-level navigation
  const [currentPage, setCurrentPage] = useState('home'); // 'home' | 'notifications' | 'calibration' | 'control' | 'team'

  // The FULL (unfiltered, all-tenants) device list lives here as App-level
  // state — not a static mockData import — so Edit Sensor edits persist and
  // propagate to every page that reads them for the rest of the session.
  // `orgDevices` below is just a tenant-scoped *view* over this state; the
  // edit itself always happens against the full list so it isn't lost when
  // switching pages/users.
  const [allDevicesState, setAllDevicesState] = useState([]);

  // ── Live backend telemetry ────────────────────────────────────────────
  // Seeded from mockData above so the UI renders instantly and STILL WORKS
  // if the backend is down. This effect then merges live data over it.
  // Fetches every tenant's devices (each carries tenantId); `orgDevices`
  // below still does the per-org scoping, so nothing here knows about auth.
  // Backend unreachable → fetch throws → we keep the state we had.
  const tenantSlug = currentOrg?.slug ?? null;

  useEffect(() => {
    let alive = true;
    let pollId = null;

    // Declare the tenant BEFORE the first fetch. The cloud tier fails closed:
    // an unscoped read is a 400, not an empty list, so a request that races
    // ahead of this call is simply lost.
    setTenant(tenantSlug);
    if (!tenantSlug) return () => { alive = false; };

    // Socket frames and REST responses carry the identical projectDevices()
    // shape, so both land here and the merge doesn't care which arrived.
    const apply = (backend) => {
      if (!alive) return;
      // Functional update: always merge against the freshest local state,
      // including an Edit Sensor change the user made mid-poll.
      setAllDevicesState(prev => mergeTelemetry(prev, backend));
    };

    async function pull() {
      try { apply(await fetchDevices()); }
      catch { /* Backend offline — leave current state untouched. */ }
    }

    // First paint comes from REST regardless: it renders immediately rather
    // than waiting on a socket handshake, and it's the path that still works
    // against the read-only cloud tier.
    pull();

    const startPolling = () => {
      if (pollId != null || !POLL_MS) return;
      pollId = setInterval(pull, POLL_MS);
    };
    const stopPolling = () => {
      if (pollId == null) return;
      clearInterval(pollId);
      pollId = null;
    };

    startPolling();

    // While the socket is live, polling is redundant — the server pushes on
    // every change. The moment it drops, polling resumes, so a socket failure
    // costs latency and nothing else.
    const disconnect = connectRealtime(
      tenantSlug,
      apply,
      (isFallback) => {
        if (!alive) return;
        if (isFallback) startPolling();
        else stopPolling();
      },
    );

    return () => { alive = false; stopPolling(); disconnect(); };
  }, [tenantSlug]);

  // When set, shows the Sensor Detail view within the home context. Stored
  // as IDs (not object references) so the detail view always re-derives the
  // live device/module/port from `orgDevices` below — editing a sensor
  // updates `allDevicesState`, and the open detail page picks up the new
  // values automatically instead of holding onto a stale snapshot taken at
  // selection time.
  const [selectedSensor, setSelectedSensor] = useState(null); // { deviceId, moduleId, portId }

  // ── Tenant scoping ────────────────────────────────────────────────────
  // `notifications` in mockData.js is still a single global array (see the
  // comments there) — this filter is the seam. Once it comes from a real
  // per-tenant API response instead of a static import, this `useMemo`
  // goes away entirely and the prop below just passes through whatever the
  // API already scoped to the signed-in org.
  const orgDevices = useMemo(
    () => (tenantSlug ? allDevicesState.filter(d => d.tenantId === tenantSlug) : []),
    [allDevicesState, tenantSlug]
  );
  const orgNotifications = useMemo(
    () => (currentOrg ? allNotifications.filter(n => n.tenantId === currentOrg.id) : []),
    [currentOrg]
  );

  // Unread notification badge count — seeded from the org-scoped list so
  // switching accounts doesn't carry over another organization's count.
  const [unreadCount, setUnreadCount] = useState(
    () => orgNotifications.filter(n => !n.read).length
  );

  function handleNavigate(page) {
    setCurrentPage(page);
    setSelectedSensor(null); // clear sensor detail when switching pages
  }

  function handleSelectSensor(device, module, port) {
    setCurrentPage('home');
    setSelectedSensor({ deviceId: device.id, moduleId: module.id, portId: port.id });
  }

  function handleBackFromDetail() {
    setSelectedSensor(null);
  }

  // Immutably patches one port's metadata (label/unit/range/safe range/etc.)
  // wherever it lives in the devices→modules→ports tree. Used by Edit Sensor.
  // Status is never just copied through — it's always recomputed from the
  // resulting value + thresholds, so lowering safeMax/rangeMax (or raising
  // safeMin/rangeMin) below/above the current reading immediately flips the
  // badge instead of leaving it pointing at whatever it was set to before.
  function updatePort(deviceId, moduleId, portId, updates) {
    setAllDevicesState(prev => prev.map(d => {
      if (d.id !== deviceId) return d;
      return {
        ...d,
        modules: d.modules.map(m => {
          if (m.id !== moduleId) return m;
          return {
            ...m,
            ports: m.ports.map(p => {
              if (p.id !== portId) return p;
              const merged = { ...p, ...updates };
              const status = computeSensorStatus(
                merged.value, merged.rangeMin, merged.rangeMax, merged.safeMin, merged.safeMax
              );
              // Data History rows carry their own recorded value, but their
              // status badge should reflect the *current* thresholds too —
              // otherwise the history table would show stale Normal badges
              // for readings that are now flagged Warning/Fault under the
              // newly edited range, contradicting the just-changed config.
              const history = merged.history.map(h => ({
                ...h,
                status: computeSensorStatus(
                  h.value, merged.rangeMin, merged.rangeMax, merged.safeMin, merged.safeMax
                ),
              }));
              return { ...merged, status, history };
            }),
          };
        }),
      };
    }));
  }

  // Issues an actuator command from the Control page. Builds the downlink
  // command packet (the exact wire shape the backend/MQTT path will publish)
  // and optimistically applies the resulting output state to the actuator on
  // the owning device. Kept here — not in the page — so App stays the single
  // owner of device state, exactly like updatePort above. Returns the built
  // packet so the Control page can show it in its command inspector.
  //
  // `lastAck` is set optimistically to 'ok' because there's no broker yet to
  // return a real acknowledgment packet; once MQTT is wired, this becomes
  // 'pending' on send and flips to the ack's `res` value when it arrives.
  // ── Renames (device / expansion board / actuator) ─────────────────────
  // Optimistically patch the shared devices state so the new name shows
  // instantly everywhere it's referenced, then persist to the backend (which
  // writes it to Postgres). If the write fails, revert to the old name and
  // rethrow so EditableName snaps its draft back too. Because merge keeps
  // local device/module names between polls and a page reload re-seeds names
  // straight from the DB, the rename is durable across sessions.
  async function renameDeviceName(deviceId, name) {
    const old = allDevicesState.find(d => d.id === deviceId)?.name;
    setAllDevicesState(prev => prev.map(d => (d.id === deviceId ? { ...d, name } : d)));
    try {
      await apiRenameDevice(deviceId, name);
    } catch (e) {
      setAllDevicesState(prev => prev.map(d => (d.id === deviceId ? { ...d, name: old } : d)));
      throw e;
    }
  }

  async function renameModuleName(deviceId, moduleId, name) {
    const old = allDevicesState.find(d => d.id === deviceId)
      ?.modules.find(m => m.id === moduleId)?.name;
    const patch = (nm) => (d) => (d.id !== deviceId ? d : {
      ...d, modules: d.modules.map(m => (m.id === moduleId ? { ...m, name: nm } : m)),
    });
    setAllDevicesState(prev => prev.map(patch(name)));
    try {
      await apiRenameModule(deviceId, moduleId, name);
    } catch (e) {
      setAllDevicesState(prev => prev.map(patch(old)));
      throw e;
    }
  }

  async function renameActuatorName(deviceId, actuatorId, name) {
    const old = allDevicesState.find(d => d.id === deviceId)
      ?.actuators?.find(a => a.id === actuatorId)?.name;
    const patch = (nm) => (d) => (d.id !== deviceId ? d : {
      ...d, actuators: (d.actuators || []).map(a => (a.id === actuatorId ? { ...a, name: nm } : a)),
    });
    setAllDevicesState(prev => prev.map(patch(name)));
    try {
      await apiRenameActuator(deviceId, actuatorId, name);
    } catch (e) {
      setAllDevicesState(prev => prev.map(patch(old)));
      throw e;
    }
  }

  // ── Enabling / disabling a channel ─────────────────────────────────────
  // Optimistic, because the operator is asserting a fact about the physical
  // world ("nothing is plugged into A2") rather than requesting something that
  // might be refused. The backend records it unconditionally; only a network
  // failure can undo it, and then we put the flag back.
  async function setPortEnabledEntry(deviceId, moduleId, portId, enabled, reason) {
    const patch = (on) => (d) => (d.id !== deviceId ? d : {
      ...d,
      modules: d.modules.map(m => (m.id !== moduleId ? m : {
        ...m,
        ports: m.ports.map(p => (p.id !== portId ? p : {
          ...p, enabled: on, status: on ? p.status : 'Disabled',
        })),
      })),
    });
    setAllDevicesState(prev => prev.map(patch(enabled)));
    try {
      await apiSetPortEnabled(deviceId, moduleId, portId, enabled, reason);
    } catch (e) {
      setAllDevicesState(prev => prev.map(patch(!enabled)));
      throw e;
    }
  }

  // ── Removing hardware ──────────────────────────────────────────────────
  // The backend is the authority on whether a removal is allowed (it refuses
  // with 409 while the hardware is still reporting), so we wait for it to
  // succeed BEFORE touching local state. Optimistically dropping the row first
  // would make a refused delete look like it worked until the next poll.
  async function removeDeviceEntry(deviceId) {
    await apiRemoveDevice(deviceId);
    setAllDevicesState(prev => prev.filter(d => d.id !== deviceId));
  }

  async function removeModuleEntry(deviceId, moduleId) {
    await apiRemoveModule(deviceId, moduleId);
    setAllDevicesState(prev => prev.map(d => (d.id !== deviceId ? d : {
      ...d, modules: d.modules.filter(m => m.id !== moduleId),
    })));
  }

  async function removePortEntry(deviceId, moduleId, portId) {
    await apiRemovePort(deviceId, moduleId, portId);
    setAllDevicesState(prev => prev.map(d => (d.id !== deviceId ? d : {
      ...d,
      modules: d.modules.map(m => (m.id !== moduleId ? m : {
        ...m, ports: m.ports.filter(p => p.id !== portId),
      })),
    })));
  }

  function commandActuator(deviceId, actuatorId, out) {
    const device = allDevicesState.find(d => d.id === deviceId);
    const actuator = device?.actuators?.find(a => a.id === actuatorId);
    if (!device || !actuator) return null;

    const packet = buildActuatorCommand(device, actuator, out);
    const mode = out.mode === 'bin' ? 'bin' : 'pwm';
    const state = out.state ? 1 : 0;
    const dur = Math.max(0, Math.round(Number(out.dur) || 0));

    // Optimistic: reflect the intent immediately as 'pending'. The REAL ack
    // lifecycle (started → completed/stopped, or failed/error) arrives through
    // the /devices poll, which mergeTelemetry now folds in from the backend.
    setAllDevicesState(prev => prev.map(d => {
      if (d.id !== deviceId) return d;
      return {
        ...d,
        actuators: (d.actuators || []).map(a => {
          if (a.id !== actuatorId) return a;
          return {
            ...a,
            mode,
            state,
            duty: mode === 'pwm' ? clampDuty(out.duty) : a.duty,
            dur,
            lastAck: 'pending',
            updatedAt: Date.now(),
          };
        }),
      };
    }));

    // Publish through the backend: it resolves the broker `tid` from
    // tenants.mqtt_tid, stamps a real cid, logs the command, and publishes to
    // usc/thesis/{tid}/{nid}/cmd if a broker is connected. Fire-and-forget; on
    // network failure flag the actuator so the badge reflects it.
    actuate(deviceId, {
      actuatorId,
      mode,
      state,
      duty: mode === 'pwm' ? clampDuty(out.duty) : undefined,
      dur,
    }).catch(() => {
      setAllDevicesState(prev => prev.map(d => (d.id !== deviceId ? d : {
        ...d,
        actuators: (d.actuators || []).map(a =>
          a.id === actuatorId ? { ...a, lastAck: 'failed', updatedAt: Date.now() } : a),
      })));
    });

    return packet;
  }

  // Not signed in → the whole app is just the auth screens. Everything
  // below this point can safely assume `currentUser`/`currentOrg` exist.
  if (!currentUser) {
    return <AuthGate />;
  }

  function renderPage() {
    // Sensor detail takes priority when a sensor is selected on the home page
    if (currentPage === 'home' && selectedSensor) {
      const device = orgDevices.find(d => d.id === selectedSensor.deviceId);
      const module = device?.modules.find(m => m.id === selectedSensor.moduleId);
      const port   = module?.ports.find(p => p.id === selectedSensor.portId);

      // Defensive fallback: if the port this view pointed at is no longer
      // reported (board/node disconnected), don't crash — drop back to Overview.
      if (!device || !module || !port) {
        return (
          <DeviceOverview
            devices={orgDevices}
            onSelectSensor={handleSelectSensor}
            canEditMap={isDesigner}
            canEdit={isDesigner}
            onRenameDevice={renameDeviceName}
            onRenameModule={renameModuleName}
            onRemoveDevice={removeDeviceEntry}
            onRemoveModule={removeModuleEntry}
            onRemovePort={removePortEntry}
            onSetPortEnabled={setPortEnabledEntry}
            tenantId={currentOrg.id}
            creatorName={currentUser.fullName}
          />
        );
      }

      return (
        <SensorDetail
          device={device}
          module={module}
          port={port}
          onBack={handleBackFromDetail}
          onUpdatePort={updates => updatePort(device.id, module.id, port.id, updates)}
        />
      );
    }

    switch (currentPage) {
      case 'home':
        return (
          <DeviceOverview
            devices={orgDevices}
            onSelectSensor={handleSelectSensor}
            canEditMap={isDesigner}
            canEdit={isDesigner}
            onRenameDevice={renameDeviceName}
            onRenameModule={renameModuleName}
            onRemoveDevice={removeDeviceEntry}
            onRemoveModule={removeModuleEntry}
            onRemovePort={removePortEntry}
            onSetPortEnabled={setPortEnabledEntry}
            tenantId={currentOrg.id}
            creatorName={currentUser.fullName}
          />
        );
      case 'notifications':
        return (
          <Notifications
            notifications={orgNotifications}
            onMarkAllRead={() => setUnreadCount(0)}
          />
        );
      case 'calibration':
        return <Calibration devices={orgDevices} />;
      case 'control':
        return <Actuators devices={orgDevices} onCommandActuator={commandActuator} canEdit={isDesigner} onRenameActuator={renameActuatorName} />;
      case 'team':
        return <Team />;
      default:
        return (
          <DeviceOverview
            devices={orgDevices}
            onSelectSensor={handleSelectSensor}
            canEditMap={isDesigner}
            canEdit={isDesigner}
            onRenameDevice={renameDeviceName}
            onRenameModule={renameModuleName}
            onRemoveDevice={removeDeviceEntry}
            onRemoveModule={removeModuleEntry}
            onRemovePort={removePortEntry}
            onSetPortEnabled={setPortEnabledEntry}
            tenantId={currentOrg.id}
            creatorName={currentUser.fullName}
          />
        );
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        unreadCount={unreadCount}
      />
      <main className="app-main">
        {renderPage()}
      </main>
    </div>
  );
}
