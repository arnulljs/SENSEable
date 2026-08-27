// realtime.js ────────────────────────────────────────────────────────────────
// WebSocket client for the live device stream.
//
// Pairs with senseable-api/src/realtime.js. The server pushes the SAME payload
// shape that GET /api/devices returns — it is literally the same
// projectDevices() call — so App.jsx feeds socket frames through the existing
// mergeTelemetry() unchanged and nothing downstream knows the difference.
//
// DEGRADES, NEVER BREAKS
// The cloud read tier on Vercel is serverless and cannot hold a socket open, and
// a local backend may simply be down. Either way this must not leave the
// dashboard blank. connectRealtime() reports its state through onFallback, and
// App.jsx keeps REST polling alive whenever the socket is not connected. The
// socket is an optimisation over polling, not a replacement that can strand the
// UI when it fails.

// The two tiers expose the socket at different paths, because they're built
// differently: the edge server mounts ws on its own Express HTTP server at /ws,
// while the cloud tier is a Vercel Function and is therefore addressed by its
// file path, /api/ws. Same protocol and same message contract either way.
const EDGE_PATH = '/ws';
const CLOUD_PATH = '/api/ws';

// ws:// for http://, wss:// for https:// — inherits whatever TLS the page has.
function socketUrl() {
  const base = import.meta.env?.VITE_API_URL;

  // Same-origin (production build) ⇒ we're on the Vercel cloud tier.
  if (!base) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${CLOUD_PATH}`;
  }

  // Explicit backend origin (dev: http://localhost:4000) ⇒ the edge server.
  try {
    const u = new URL(base);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${u.host}${EDGE_PATH}`;
  } catch {
    return null;                                  // malformed — caller falls back
  }
}

// Reconnect backoff. Starts fast so a backend restart during development
// reconnects almost immediately, then backs off so a genuinely absent server
// isn't hammered.
const BACKOFF_MS = [500, 1000, 2000, 5000, 10_000];

/**
 * Open a tenant-scoped live subscription.
 *
 * @param {string}   tenantSlug         tenant to subscribe to
 * @param {function} onDevices          (devices[]) => void — a fresh projection
 * @param {function} onFallback         (isFallback: boolean) => void — true when
 *                                      the socket is down and REST polling
 *                                      should carry the load
 * @returns {function} cleanup — closes the socket and stops reconnecting
 */
export function connectRealtime(tenantSlug, onDevices, onFallback) {
  const url = socketUrl();
  if (!url || typeof WebSocket === 'undefined' || !tenantSlug) {
    onFallback?.(true);
    return () => {};
  }

  let ws = null;
  let attempt = 0;
  let retryTimer = null;
  let closed = false;                             // set by cleanup; stops retries

  function scheduleRetry() {
    if (closed) return;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    retryTimer = setTimeout(open, delay);
  }

  function open() {
    retryTimer = null;
    if (closed) return;

    try { ws = new WebSocket(url); }
    catch { onFallback?.(true); scheduleRetry(); return; }

    ws.onopen = () => {
      attempt = 0;                                // reset backoff on success
      ws.send(JSON.stringify({ type: 'subscribe', tenant: tenantSlug }));
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'devices' && Array.isArray(msg.devices)) {
        // Only now is the socket genuinely carrying data. Waiting for the first
        // real frame rather than flipping on 'subscribed' avoids a window where
        // polling has stopped but nothing has arrived yet.
        onFallback?.(false);
        onDevices(msg.devices);
      } else if (msg.type === 'error') {
        // Server refused the subscription (unknown tenant, most likely). Retrying
        // won't help, so hand back to REST — which surfaces the same problem with
        // a clearer HTTP status.
        console.warn('[ws]', msg.error);
        onFallback?.(true);
        closed = true;
        try { ws.close(); } catch { /* already gone */ }
      }
    };

    ws.onerror = () => { /* close fires next; handled there */ };

    ws.onclose = () => {
      ws = null;
      if (closed) return;
      onFallback?.(true);                         // resume polling immediately
      scheduleRetry();
    };
  }

  open();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (ws) { try { ws.close(); } catch { /* already gone */ } }
  };
}
