// DeviceOverview.jsx — Home page: device cards + tab to Interactive Map
import { useState } from 'react';
import { devices as allDevices } from '../mockData';
import GaugeCard from '../components/GaugeCard';
import EditableName from '../components/EditableName';
import RemoveButton from '../components/RemoveButton';
import PortPowerButton from '../components/PortPowerButton';

// Compact relative age for the "last seen" hint on offline hardware.
function relTime(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
import InteractiveMap from './InteractiveMap';

const IconOverview = () => (
  <svg viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
    <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
  </svg>
);
const IconMap = () => (
  <svg viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 3.5l4.5-2 5 2 4.5-2V12.5l-4.5 2-5-2-4.5 2V3.5zM5.5 2.5v9.5M10.5 3.5v9.5"/>
  </svg>
);
const IconChevron = ({ open }) => (
  <svg viewBox="0 0 16 16" fill="currentColor" style={{ transform: open ? 'rotate(180deg)' : '', transition: 'transform .2s', width: 14, height: 14 }}>
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// `devices` arrives as a prop now — already filtered down to the signed-in
// user's organization by App.jsx — but falls back to the raw mockData
// import so this component still works standalone (e.g. if it's ever
// rendered outside the authenticated shell, or during local dev/testing).
export default function DeviceOverview({
  devices: devicesProp,
  onSelectSensor,
  canEditMap = true,
  canEdit = false,          // gate on Designer role — enables renaming
  onRenameDevice,           // (deviceId, name) => Promise
  onRenameModule,           // (deviceId, moduleId, name) => Promise
  onRemoveDevice,           // (deviceId) => Promise
  onRemoveModule,           // (deviceId, moduleId) => Promise
  onRemovePort,             // (deviceId, moduleId, portId) => Promise
  onSetPortEnabled,         // (deviceId, moduleId, portId, enabled, reason) => Promise
  tenantId,
  creatorName,
}) {
  const devices = devicesProp ?? allDevices;
  const [activeTab, setActiveTab] = useState('overview');

  // Track which device/module sections are collapsed.
  // Computed from whatever is actually in `devices` — not hardcoded to
  // specific IDs — so this stays correct no matter how many ESP32 nodes
  // or expansion boards the backend reports.
  //   • A device expands by default only if it has at least one module
  //     to show (an empty device would just reveal a "no modules" line).
  //   • Every module that does exist starts expanded, since that's the
  //     whole point of the overview page.
  const [expandedDevices, setExpandedDevices] = useState(() =>
    devices.reduce((acc, d) => {
      acc[d.id] = d.modules.length > 0;
      return acc;
    }, {})
  );
  const [expandedModules, setExpandedModules] = useState(() =>
    devices.reduce((acc, d) => {
      d.modules.forEach(m => { acc[m.id] = true; });
      return acc;
    }, {})
  );

  function toggleDevice(id) {
    setExpandedDevices(prev => ({ ...prev, [id]: !prev[id] }));
  }
  function toggleModule(id) {
    setExpandedModules(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div>
      {/* Page header + tabs */}
      <div className="page-header">
        <h1 className="page-title">Device Overview</h1>
        <div className="tabs">
          <button
            className={`tab-btn${activeTab === 'overview' ? ' active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <IconOverview /> Overview
          </button>
          <button
            className={`tab-btn${activeTab === 'map' ? ' active' : ''}`}
            onClick={() => setActiveTab('map')}
          >
            <IconMap /> Interactive Map
          </button>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' ? (
        <div className="page-body">
          {devices.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-3)' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>
                No hardware detected yet
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 460, margin: '0 auto' }}>
                Nodes appear here automatically the first time they publish telemetry.
                Power on an ESP32 and confirm it&apos;s reaching the broker — its expansion
                boards and channels will be added as they&apos;re discovered.
              </div>
            </div>
          ) : (
            <div className="device-list">
              {devices.map(device => (
                <div key={device.id} className="device-card">
                  {/* Device header */}
                  <div className="device-card-header" onClick={() => toggleDevice(device.id)}>
                    <span className={`status-dot ${device.status}`} />
                    <EditableName
                      className="device-name"
                      value={device.name}
                      canEdit={canEdit && typeof onRenameDevice === 'function'}
                      onRename={(name) => onRenameDevice(device.id, name)}
                      title="Rename device"
                    />
                    <span className="device-meta">
                      {device.commMode}
                      {device.rssi && <span>· {device.rssi} dBm</span>}
                      {device.active === false && device.lastSeen && (
                        <span style={{ whiteSpace: 'nowrap' }}
                              title={`Last reported ${new Date(device.lastSeen).toLocaleString()}`}>
                          · last seen {relTime(device.lastSeen)}
                        </span>
                      )}
                    </span>
                    {canEdit && typeof onRemoveDevice === 'function' && (
                      <RemoveButton
                        active={device.active !== false}
                        label={`node "${device.name}"`}
                        title="Remove this node and everything under it"
                        onRemove={() => onRemoveDevice(device.id)}
                      />
                    )}
                    <IconChevron open={expandedDevices[device.id]} />
                  </div>

                  {/* Device body (expanded) */}
                  {expandedDevices[device.id] && (
                    device.modules.length === 0 ? (
                      <div className="device-offline-msg">
                        <span className={`status-dot ${device.status}`} />
                        Device is {device.status}. No modules detected.
                      </div>
                    ) : (
                      device.modules.map(mod => (
                        <div key={mod.id} className="module-section">
                          {/* Module header */}
                          <div className="module-header" onClick={() => toggleModule(mod.id)}>
                            <span
                              className={`status-dot ${mod.status ?? 'offline'}`}
                              title={`Board is ${mod.status ?? 'offline'}`}
                            />
                            <EditableName
                              className="module-name"
                              value={mod.name}
                              canEdit={canEdit && typeof onRenameModule === 'function'}
                              onRename={(name) => onRenameModule(device.id, mod.id, name)}
                              title="Rename expansion board"
                            />
                            <span className="module-address">{mod.address}</span>
                            {mod.active === false && mod.lastSeen && (
                              <span
                                style={{
                                  fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap',
                                  overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1,
                                }}
                                title={`Last reported ${new Date(mod.lastSeen).toLocaleString()}`}
                              >
                                last seen {relTime(mod.lastSeen)}
                              </span>
                            )}
                            {canEdit && typeof onRemoveModule === 'function' && (
                              <RemoveButton
                                active={mod.active !== false}
                                label={`board "${mod.name}"`}
                                title="Remove this expansion board and its channels"
                                onRemove={() => onRemoveModule(device.id, mod.id)}
                              />
                            )}
                            <IconChevron open={expandedModules[mod.id]} />
                          </div>

                          {/* Sensor gauge grid */}
                          {expandedModules[mod.id] && (
                            <div className="sensor-grid">
                              {mod.ports.map(port => (
                                <div
                                  key={port.id}
                                  style={{
                                    position: 'relative',
                                    // A disabled channel stays visible (so it can be
                                    // switched back on) but steps back visually. The card
                                    // itself renders the OFF badge and a muted needle, so
                                    // this is only a gentle dim — stacking a full grayscale
                                    // on top made the badge text unreadable.
                                    opacity: port.enabled === false ? 0.7 : 1,
                                    transition: 'opacity .2s ease',
                                  }}
                                >
                                  <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2,
                                                display: 'flex', alignItems: 'center', gap: 2 }}>
                                    {typeof onSetPortEnabled === 'function' && (
                                      <PortPowerButton
                                        port={port}
                                        canEdit={canEdit}
                                        onToggle={(enabled, reason) =>
                                          onSetPortEnabled(device.id, mod.id, port.id, enabled, reason)}
                                      />
                                    )}
                                    {canEdit && typeof onRemovePort === 'function' && (
                                      <RemoveButton
                                        active={port.active !== false}
                                        label={`channel ${port.id}`}
                                        title="Remove this channel"
                                        onRemove={() => onRemovePort(device.id, mod.id, port.id)}
                                      />
                                    )}
                                  </div>

                                <GaugeCard
                                  port={port}
                                  onClick={() => onSelectSensor(device, mod, port)}
                                />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <InteractiveMap
          devices={devices}
          canEdit={canEditMap}
          onSelectSensor={onSelectSensor}
          tenantId={tenantId}
          creatorName={creatorName}
        />
      )}
    </div>
  );
}
