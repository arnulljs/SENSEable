/* global process -- Node serverless code; the repo's ESLint config is browser-only */
// api/_mqtt.js ──────────────────────────────────────────────────────────────
// One-shot publish to the CLOUD broker (HiveMQ) from a Vercel function.
//
// WHY THIS EXISTS. Cloud-first means a command pressed on the cloud dashboard
// must reach the hardware without the on-site server. Until now it could not:
// the cloud only wrote the command to the outbox, and the ONLY thing that ever
// published outbox rows was the edge's dispatcher, after the edge's sync worker
// had pulled the row down — so a Start pressed on Vercel did nothing unless the
// laptop on the farm was on, synced, and healthy.
//
// A serverless function cannot hold a broker connection open between requests,
// but it does not need to: connect, publish QoS 1, wait for the broker's
// PUBACK, disconnect. About a second over TLS. The node is subscribed to its
// command topic on this same broker, so that is the whole delivery path.
//
// Returns true only when the broker acknowledged the message. Anything else —
// no credentials configured, broker unreachable, timeout — returns false and
// the command simply stays in the outbox for the cloud bridge to deliver.
import mqtt from 'mqtt';
import { randomUUID } from 'node:crypto';

const TIMEOUT_MS = Number(process.env.MQTT_PUBLISH_TIMEOUT_MS ?? 5000);

export function publishOnce(topic, payload) {
  const url = process.env.MQTT_URL;
  if (!url) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const client = mqtt.connect(url, {
      // Same variable names as the Lambda bridge, so one set of HiveMQ
      // credentials can be copied to both.
      username: process.env.MQTT_CLOUD_USERNAME ?? process.env.MQTT_USERNAME,
      password: process.env.MQTT_CLOUD_PASSWORD ?? process.env.MQTT_PASSWORD,
      // Unique per invocation: two concurrent functions sharing an id would
      // kick each other off the broker.
      clientId: `senseable-vercel-${randomUUID().slice(0, 8)}`,
      clean: true,
      reconnectPeriod: 0,             // one attempt; the outbox is the retry
      connectTimeout: TIMEOUT_MS,
    });
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end(true);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), TIMEOUT_MS);
    client.on('error', (e) => { console.warn('[mqtt] direct publish failed:', e.message); done(false); });
    client.on('connect', () => {
      client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => done(!err));
    });
  });
}
