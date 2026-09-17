// ConnectionBanner.jsx ──────────────────────────────────────────────────────
// Tells the operator which path their data is taking right now.
//
// Cloud-first has three states that look IDENTICAL on a dashboard unless they
// are drawn, and confusing them is expensive:
//
//   Cloud live      node → cloud broker → Supabase. Normal operation.
//   Failover        node → local broker → edge. Data is being recorded, but the
//                   cloud is behind until the backlog drains. A remote viewer is
//                   looking at a frozen picture and must know that.
//   Unreachable     this browser cannot reach its server at all. Nothing is
//                   lost — the edge is still logging — but nothing shown here is
//                   current either.
//
// The third state is what justifies the component. Without it an outage renders
// as a dashboard that simply stops updating, which is indistinguishable from
// hardware that has gone quiet, and the operator's first instinct is to go look
// at the tank.

import { useEffect, useState } from 'react';
import { onConnectionChange } from '../api';

const WarnIcon = () => (
  <svg className="conn-banner__icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
  </svg>
);

const ErrorIcon = () => (
  <svg className="conn-banner__icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
  </svg>
);

const LOOKS = {
  failover: {
    cls: 'conn-banner conn-banner--warn',
    Icon: WarnIcon,
    title: 'Running on the on-site server',
    detail: 'The node lost its cloud link and is publishing locally. Readings are still being ' +
            'recorded and will sync automatically when the link returns.',
  },
  unreachable: {
    cls: 'conn-banner conn-banner--error',
    Icon: ErrorIcon,
    title: 'Cannot reach the server',
    detail: 'This view is not updating. The on-site server keeps recording regardless.',
  },
  stale: {
    cls: 'conn-banner conn-banner--warn',
    Icon: WarnIcon,
    title: 'No recent telemetry',
    detail: 'The server is responding but no node has published lately. Check the hardware.',
  },
};

// Telemetry older than this with a healthy server means the HARDWARE is quiet,
// which is a different problem from a broken link and gets a different message.
const STALE_MS = 120_000;

export default function ConnectionBanner() {
  const [conn, setConn] = useState(null);
  useEffect(() => onConnectionChange(setConn), []);
  if (!conn || conn.state === 'unknown') return null;

  let key = null;
  if (conn.state === 'unreachable') key = 'unreachable';
  else if (conn.route === 'ROUTE_LOCAL_FAILOVER') key = 'failover';
  else if (conn.newestTelemetryAgeMs != null && conn.newestTelemetryAgeMs > STALE_MS) key = 'stale';

  // Normal operation gets a small chip, not a banner. A bar that is always
  // present is a bar nobody reads, which costs you the two states that matter.
  if (!key) {
    return (
      <div className="conn-chip" title={`Serving tier: ${conn.tier ?? 'unknown'}`}>
        <span className="conn-chip__dot" />
        {conn.tier === 'edge' ? 'On-site server' : 'Cloud live'}
      </div>
    );
  }

  const { cls, Icon, title, detail } = LOOKS[key];
  return (
    <div className={cls} role="status" aria-live="polite">
      <Icon />
      <span className="conn-banner__text">
        <span className="conn-banner__title">{title}</span>
        <span className="conn-banner__detail">{detail}</span>
      </span>
      {key === 'unreachable' && conn.edgeHint ? (
        <a className="conn-banner__link" href={conn.edgeHint}>Open on-site dashboard</a>
      ) : null}
    </div>
  );
}
