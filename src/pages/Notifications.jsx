// Notifications.jsx — System notifications list
import { notifications as allNotifications } from '../mockData';

const ICONS = {
  warning: '⚠️',
  info:    'ℹ️',
  success: '✅',
  fault:   '🔴',
};

// `notifications` arrives pre-filtered to the signed-in org by App.jsx and is
// fetched from the backend, which raises a notification when a port crosses its
// configured safe range. The mockData import remains only as a standalone
// fallback for rendering this page in isolation.
//
// The list is rendered straight from props rather than copied into state. It
// used to be `useState(notificationsProp ?? allNotifications)`, and a useState
// initializer runs ONCE — so the component kept its first-render snapshot
// forever. New alerts arriving from the backend never appeared, and the page
// silently showed a stale list while the database had unread threshold
// breaches on it. Read state is owned by App.jsx, which persists it.
export default function Notifications({
  notifications: notificationsProp,
  onMarkRead,
  onMarkAllRead,
  readOnly = false,
}) {
  const notifs = notificationsProp ?? allNotifications;

  function markAllRead() {
    if (readOnly) return;
    onMarkAllRead?.();
  }

  function markRead(id) {
    if (readOnly) return;
    onMarkRead?.(id);
  }

  const unread = notifs.filter(n => !n.read).length;

  return (
    <div>
      <div className="page-header" style={{ paddingBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            Notifications
            {unread > 0 && (
              <span style={{
                marginLeft: 10, fontSize: 12, background: 'var(--orange)', color: '#fff',
                padding: '2px 8px', borderRadius: 12, fontWeight: 600,
              }}>
                {unread} new
              </span>
            )}
          </h1>
          {unread > 0 && !readOnly && (
            <button className="btn-ghost" onClick={markAllRead}>
              Mark all as read
            </button>
          )}
        </div>
      </div>

      <div className="page-body">
        {notifs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-3)' }}>
            No notifications yet.
          </div>
        ) : (
          <div className="notif-list">
            {notifs.map(notif => (
              <div
                key={notif.id}
                className={`notif-item${!notif.read ? ' unread' : ''}`}
                onClick={() => markRead(notif.id)}
              >
                <div className={`notif-icon ${notif.type}`}>
                  {ICONS[notif.type] ?? '•'}
                </div>
                <div className="notif-body">
                  <div className="notif-title">{notif.title}</div>
                  <div className="notif-msg">{notif.message}</div>
                  <div className="notif-time">{notif.time}</div>
                </div>
                {!notif.read && <div className="notif-unread-dot" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
