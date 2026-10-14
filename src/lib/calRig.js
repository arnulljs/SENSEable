// lib/calRig.js — Web Serial bridge to the ESP8266 calibration rig
// ("Standalone ESP8266 Calibration Module" spec). Line-delimited JSON at 115200:
//   → {"cid":"cal-…","channel":"A0","tenant_id":"aquatech-856f"}
//   ← {"cid","tenant_id","rig_id","channel","samples_used","raw_adc","millivolts","status":"valid"}
//   ← {"status":"error","message":"…"}       (the rig's error replies carry no cid)
// raw_adc is an ADS1115 count at ±4.096 V, the same scale the field nodes report,
// so a formula fitted here applies to their raw counts unchanged.
// Web Serial exists only in Chromium browsers (Chrome, Edge) on desktop, over HTTPS.
export const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

const BAUD = 115200;
const BOOT_SETTLE_MS = 1500;   // opening the port resets the ESP8266 (DTR/RTS)
const REPLY_TIMEOUT_MS = 4000; // 20 averaged samples take ~0.5 s

// Throws with a message fit to show the operator; returns the reading.
export function validateReply(msg, { cid, tenantId, channel }) {
  if (msg?.status === 'error') throw new Error(`Rig refused: ${msg.message ?? 'unknown error'}`);
  if (msg?.status !== 'valid') throw new Error('Rig sent an unrecognised reply.');
  if (msg.cid !== cid) throw new Error('Rig answered a different request.');
  if (msg.tenant_id !== tenantId) throw new Error('Rig answered for a different Tenant ID.');
  if (msg.channel !== channel) throw new Error(`Rig measured ${msg.channel}, not ${channel}.`);
  const raw = msg.raw_adc;
  if (!Number.isInteger(raw) || raw < -32768 || raw > 32767) throw new Error('Rig reported an impossible ADC count.');
  const mv = Number(msg.millivolts);
  // 0.125 mV per count at ±4.096 V; anything else means a corrupted line.
  if (!Number.isFinite(mv) || Math.abs(mv - raw * 0.125) > 1) throw new Error('Rig reply is inconsistent (raw_adc vs millivolts).');
  return { rawAdc: raw, millivolts: mv, rigId: String(msg.rig_id ?? ''), samples: Number(msg.samples_used) || null };
}

// Opens the browser's port picker. Resolves to { measure, close }.
export async function connectRig({ onClose, serial = globalThis.navigator?.serial } = {}) {
  const port = await serial.requestPort();
  await port.open({ baudRate: BAUD });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = port.readable.getReader();
  let waiter = null;   // the one request in flight
  let closed = false;

  (async () => {
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('{')) continue;          // boot noise, debug prints
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          waiter?.(msg);
        }
        if (buf.length > 4096) buf = '';                 // a line that never ends
      }
    } catch { /* cable pulled */ }
    finally { closed = true; onClose?.(); }
  })();

  const settled = new Promise((r) => setTimeout(r, BOOT_SETTLE_MS));
  let queue = Promise.resolve();

  function measure({ tenantId, channel = 'A0' }) {
    const run = queue.then(async () => {
      await settled;
      if (closed) throw new Error('Calibration rig disconnected.');
      const cid = `cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const reply = new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          waiter = null;
          reject(new Error('The rig did not answer within 4 s. Check the cable, or reconnect.'));
        }, REPLY_TIMEOUT_MS);
        waiter = (msg) => {
          if (msg.cid === cid || msg.status === 'error') { clearTimeout(t); waiter = null; resolve(msg); }
        };
      });
      const w = port.writable.getWriter();
      try { await w.write(encoder.encode(`${JSON.stringify({ cid, channel, tenant_id: tenantId })}\n`)); }
      finally { w.releaseLock(); }
      return validateReply(await reply, { cid, tenantId, channel });
    });
    queue = run.catch(() => {});   // one request at a time; a failure doesn't block the next
    return run;
  }

  async function close() {
    try { await reader.cancel(); } catch { /* already gone */ }
    try { reader.releaseLock(); } catch { /* already gone */ }
    try { await port.close(); } catch { /* already gone */ }
  }

  return { measure, close };
}
