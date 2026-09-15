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
// The third state is the one that justifies the component. Without it an outage
// renders as a dashboard that simply stops updating, which is indistinguishable
// from hardware that has gone quiet, and the operator's first instinct is to go
// look at the tank.

import { useEffect, useState } from 'react';
import { onConnectionChange } from '../api';

const LOOKS = {
  failover: {
    cls: 'conn-banner conn-banner--warn',
    title: 'Running on the on-site server',
    detail: 'The node lost its cloud link and is publishing locally. Readings are still being ' +
            'recorded and will sync to the cloud automatically when the link returns.',
  },
  unreachable: {
    cls: 'conn-banner conn-banner--error',
    title: 'Cannot reach the server',
    detail: 'This view is not updating. The on-site server keeps recording regardless.',
  },
  stale: {
    cls: 'conn-banner conn-banner--warn',
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
  if (!conn) return null;

  let key = null;
  if (conn.state === 'unreachable') key = 'unreachable';
  else if (conn.route === 'ROUTE_LOCAL_FAILOVER') key = 'failover';
  else if (conn.newestTelemetryAgeMs != null && conn.newestTelemetryAgeMs > STALE_MS) key = 'stale';

  // Normal operation gets a small chip, not a banner. A persistent green bar
  // teaches people to ignore the bar, which costs you the two states that matter.
  if (!key) {
    return (
      <div className="conn-chip" title={`Serving tier: ${conn.tier ?? 'unknown'}`}>
        <span className="conn-chip__dot" />
        {conn.tier === 'edge' ? 'On-site server' : 'Cloud live'}
      </div>
    );
  }

  const look = LOOKS[key];
  return (
    <div className={look.cls} role="status" aria-live="polite">
      <strong>{look.title}</strong>
      <span>{look.detail}</span>
      {key === 'unreachable' && conn.edgeHint ? (
        <a className="conn-banner__link" href={conn.edgeHint}>
          Open the on-site dashboard
        </a>
      ) : null}
    </div>
  );
}
