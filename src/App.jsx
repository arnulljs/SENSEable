import { useState, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import DeviceOverview from './pages/DeviceOverview';
import SensorDetail from './pages/SensorDetail';
import Notifications from './pages/Notifications';
import Calibration from './pages/Calibration';
import Team from './pages/Team';
import LoginPage from './pages/LoginPage';
import CreateAccountPage from './pages/CreateAccountPage';
import { useAuth } from './context/AuthContext';
import { devices as seedDevices, notifications as allNotifications, computeSensorStatus } from './mockData';
import './App.css';

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
  const [currentPage, setCurrentPage] = useState('home'); // 'home' | 'notifications' | 'calibration' | 'team'

  // The FULL (unfiltered, all-tenants) device list lives here as App-level
  // state — not a static mockData import — so Edit Sensor edits persist and
  // propagate to every page that reads them for the rest of the session.
  // `orgDevices` below is just a tenant-scoped *view* over this state; the
  // edit itself always happens against the full list so it isn't lost when
  // switching pages/users.
  const [allDevicesState, setAllDevicesState] = useState(seedDevices);

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
