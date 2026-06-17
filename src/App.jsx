import { useState } from 'react';
import Sidebar from './components/Sidebar';
import DeviceOverview from './pages/DeviceOverview';
import SensorDetail from './pages/SensorDetail';
import Notifications from './pages/Notifications';
import Calibration from './pages/Calibration';
import './App.css';

export default function App() {
  // Top-level navigation
  const [currentPage, setCurrentPage] = useState('home'); // 'home' | 'notifications' | 'calibration'
  // When set, shows the Sensor Detail view within the home context
  const [selectedSensor, setSelectedSensor] = useState(null); // { device, module, port }
  // Unread notification badge count
  const [unreadCount, setUnreadCount] = useState(2);

  function handleNavigate(page) {
    setCurrentPage(page);
    setSelectedSensor(null); // clear sensor detail when switching pages
  }

  function handleSelectSensor(device, module, port) {
    setCurrentPage('home');
    setSelectedSensor({ device, module, port });
  }

  function handleBackFromDetail() {
    setSelectedSensor(null);
  }

  function renderPage() {
    // Sensor detail takes priority when a sensor is selected on the home page
    if (currentPage === 'home' && selectedSensor) {
      return (
        <SensorDetail
          device={selectedSensor.device}
          module={selectedSensor.module}
          port={selectedSensor.port}
          onBack={handleBackFromDetail}
        />
      );
    }

    switch (currentPage) {
      case 'home':
        return <DeviceOverview onSelectSensor={handleSelectSensor} />;
      case 'notifications':
        return <Notifications onMarkAllRead={() => setUnreadCount(0)} />;
      case 'calibration':
        return <Calibration />;
      default:
        return <DeviceOverview onSelectSensor={handleSelectSensor} />;
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
