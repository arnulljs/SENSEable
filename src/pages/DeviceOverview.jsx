// DeviceOverview.jsx — Home page: device cards + tab to Interactive Map
import { useState } from 'react';
import { devices } from '../mockData';
import GaugeCard from '../components/GaugeCard';
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

export default function DeviceOverview({ onSelectSensor }) {
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
          <div className="device-list">
            {devices.map(device => (
              <div key={device.id} className="device-card">
                {/* Device header */}
                <div className="device-card-header" onClick={() => toggleDevice(device.id)}>
                  <span className={`status-dot ${device.status}`} />
                  <span className="device-name">{device.name}</span>
                  <span className="device-meta">
                    {device.commMode}
                    {device.rssi && <span>· {device.rssi} dBm</span>}
                  </span>
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
                          <span className="module-name">{mod.name}</span>
                          <span className="module-address">{mod.address}</span>
                          <IconChevron open={expandedModules[mod.id]} />
                        </div>

                        {/* Sensor gauge grid */}
                        {expandedModules[mod.id] && (
                          <div className="sensor-grid">
                            {mod.ports.map(port => (
                              <GaugeCard
                                key={port.id}
                                port={port}
                                onClick={() => onSelectSensor(device, mod, port)}
                              />
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
        </div>
      ) : (
        <InteractiveMap />
      )}
    </div>
  );
}
