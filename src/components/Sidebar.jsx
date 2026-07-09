// Sidebar.jsx — SENSEful left navigation panel
import { useAuth } from '../context/AuthContext';

const IconHome = () => (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h4a1 1 0 001-1v-3h2v3a1 1 0 001 1h4a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
  </svg>
);

const IconBell = () => (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
  </svg>
);

const IconWrench = () => (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  </svg>
);

const IconControl = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <line x1="3" y1="6" x2="17" y2="6" />
    <line x1="3" y1="14" x2="17" y2="14" />
    <circle cx="8" cy="6" r="2.2" fill="currentColor" stroke="none" />
    <circle cx="13" cy="14" r="2.2" fill="currentColor" stroke="none" />
  </svg>
);

const IconTeam = () => (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path d="M7 9a3 3 0 100-6 3 3 0 000 6zM3 16.5c0-2.49 2.015-4.5 4.5-4.5h1c2.485 0 4.5 2.01 4.5 4.5v.25a.25.25 0 01-.25.25H3.25a.25.25 0 01-.25-.25v-.25z" />
    <path d="M13.5 9.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM12.3 12.06A4.49 4.49 0 0116 16.25v.5a.25.25 0 01-.25.25H14v-.5c0-1.6-.66-3.04-1.7-4.06z" opacity="0.75" />
  </svg>
);

// The SENSEful logo globe/sensor icon (simplified)
const IconSensor = () => (
  <svg viewBox="0 0 20 20" fill="white">
    <circle cx="10" cy="10" r="3" />
    <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 2a6 6 0 110 12A6 6 0 0110 4z" opacity="0.6" />
    <path d="M10 5a5 5 0 100 10A5 5 0 0010 5zm0 2a3 3 0 110 6A3 3 0 0110 7z" opacity="0.3" />
  </svg>
);

const IconLogout = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.5 17.5H5a1.5 1.5 0 01-1.5-1.5v-12A1.5 1.5 0 015 2.5h2.5M13 14l4-4-4-4M17 10H7.5" />
  </svg>
);

function initials(name) {
  return (name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('');
}

const NAV_ITEMS = [
  { id: 'home',          label: 'Home',          Icon: IconHome    },
  { id: 'notifications', label: 'Notifications', Icon: IconBell    },
  { id: 'calibration',   label: 'Calibration',   Icon: IconWrench  },
  { id: 'control',       label: 'Control',       Icon: IconControl },
  { id: 'team',          label: 'Team',          Icon: IconTeam    },
];

export default function Sidebar({ currentPage, onNavigate, unreadCount }) {
  const { currentUser, currentOrg, role, logout } = useAuth();

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <IconSensor />
        </div>
        <span className="sidebar-wordmark">SENSEable</span>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`sidebar-nav-item${currentPage === id ? ' active' : ''}`}
            onClick={() => onNavigate(id)}
          >
            <Icon />
            {label}
            {id === 'notifications' && unreadCount > 0 && (
              <span className="notif-badge">{unreadCount}</span>
            )}
          </button>
        ))}
      </nav>

      {/* User / organization footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user-row">
          <span className="sidebar-avatar">{initials(currentUser?.fullName)}</span>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{currentUser?.fullName}</div>
            <div className="sidebar-user-org">{currentOrg?.name}</div>
          </div>
        </div>
        <div className="sidebar-role-row">
          <span className={`role-badge ${role?.id}`}>{role?.name}</span>
          <button className="sidebar-logout-btn" onClick={logout} title="Log out">
            <IconLogout />
          </button>
        </div>
      </div>
    </aside>
  );
}
