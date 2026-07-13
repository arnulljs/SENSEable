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
import {
  devices as seedDevices,
  notifications as allNotifications,
  computeSensorStatus,
  buildActuatorCommand,
  clampDuty,
} from './mockData';
import { fetchDevices } from './api';
import './App.css';

// How often to pull fresh readings from the backend. 0 = fetch once on load
// and never poll.
const POLL_MS = 3000;

// Merge live backend telemetry into App's device state WITHOUT clobbering
// sensor CONFIG. Division of ownership:
//   backend owns → live value, history, node status/commMode/uptime/rssi/heap
//   frontend owns → label, unit, ranges, safe band (via Edit Sensor), and
//                   actuators (the firmware has no `actuate` branch yet, and
//                   projectDevices() doesn't return an actuators field at all)
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
      actuators: ld.actuators ?? [],
      modules: bd.modules.map(bm => {
        const lm = ld.modules.find(m => m.id === bm.id);
        if (!lm) return bm;        // newly discovered board
        return {
          ...lm,
          ports: bm.ports.map(bp => {
            const lp = lm.ports.find(p => p.id === bp.id);
            if (!lp) return bp;    // newly discovered port
            const value = bp.value;
            const status = computeSensorStatus(
              value, lp.rangeMin, lp.rangeMax, lp.safeMin, lp.safeMax
            );
            const history = (bp.history || []).map(h => ({
              ...h,
              status: computeSensorStatus(
                h.value, lp.rangeMin, lp.rangeMax, lp.safeMin, lp.safeMax
              ),
            }));
            return { ...lp, value, status, history };
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
  useEffect(() => {
    let alive = true;

    async function pull() {
      try {
        const backend = await fetchDevices();
        if (!alive) return;
        // Functional update: always merge against the freshest local state,
        // including an Edit Sensor change the user made mid-poll.
        setAllDevicesState(prev => mergeTelemetry(prev, backend));
      } catch {
        // Backend offline — leave current state untouched.
      }
    }

    pull();
    if (!POLL_MS) return () => { alive = false; };
    const id = setInterval(pull, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

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
    () => (currentOrg ? allDevicesState.filter(d => d.tenantId === currentOrg.id) : []),
    [allDevicesState, currentOrg]
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
  function commandActuator(deviceId, actuatorId, out) {
    const device = allDevicesState.find(d => d.id === deviceId);
    const actuator = device?.actuators?.find(a => a.id === actuatorId);
    if (!device || !actuator) return null;

    const packet = buildActuatorCommand(device, actuator, out);
    const mode = out.mode === 'binary' ? 'binary' : 'pwm';

    setAllDevicesState(prev => prev.map(d => {
      if (d.id !== deviceId) return d;
      return {
        ...d,
        actuators: (d.actuators || []).map(a => {
          if (a.id !== actuatorId) return a;
          return {
            ...a,
            mode,
            state: out.state ? 1 : 0,
            // Duty only applies to PWM; binary keeps its stored value untouched.
            duty: mode === 'pwm' ? clampDuty(out.duty) : a.duty,
            dur: Math.max(0, Math.round(Number(out.dur) || 0)),
            lastAck: 'ok',
            updatedAt: Date.now(),
          };
        }),
      };
    }));

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
        return <Actuators devices={orgDevices} onCommandActuator={commandActuator} />;
      case 'team':
        return <Team />;
      default:
        return (
          <DeviceOverview
            devices={orgDevices}
            onSelectSensor={handleSelectSensor}
            canEditMap={isDesigner}
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
