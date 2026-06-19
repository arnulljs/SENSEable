// ─── SENSEful Mock Data ────────────────────────────────────────────────────
// No database or MQTT connected yet — all data is in-memory for UI prototyping.

function generateHistory(base, safeMin, safeMax, count = 10) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const noise = (Math.random() - 0.5) * (safeMax - safeMin) * 0.14;
    const v = parseFloat((base + noise).toFixed(4));
    const ts = new Date(now - (count - i) * 9 * 60000);
    return {
      timestamp: ts.toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }),
      value: v,
      status: 'Normal',
    };
  });
}

// Each entry in `devices` represents one physical ESP32 node reporting in.
// `modules` holds whatever expansion boards that node currently reports —
// zero, one, or many. Each module's `address` is its I2C bus address on that
// specific ESP32, which is how the backend ties a board to its parent node.
// Nothing in the UI assumes a fixed device/module/port count — DeviceOverview
// and Calibration both map over these arrays, so this object is the single
// source of truth for "what hardware is currently connected." Once the real
// backend/MQTT feed is wired up, this array gets replaced by live data with
// the exact same shape.
export const devices = [
  {
    id: 'n1',
    name: 'ESP32 Module 1',
    nodeId: 'N001',
    status: 'online',       // online | warning | fault | offline
    commMode: 'Wi-Fi',
    uptime: 86400,
    rssi: -61,
    freeHeap: 138240,
    modules: [
      {
        id: 'board-1',
        address: '0x48',
        name: 'Expansion Board 1',
        ports: [
          {
            id: 'A0', label: 'Dissolved Oxygen', unit: 'mg/L',
            value: 8.19, rangeMin: 0, rangeMax: 20, safeMin: 6, safeMax: 9,
            status: 'Normal', history: generateHistory(8.19, 6, 9),
          },
          {
            id: 'A1', label: 'Salinity', unit: 'PSU',
            value: 44.97, rangeMin: 0, rangeMax: 70, safeMin: 35, safeMax: 50,
            status: 'Normal', history: generateHistory(44.97, 35, 50),
          },
          {
            id: 'A2', label: 'Temperature', unit: '°C',
            value: 29.62, rangeMin: 0, rangeMax: 50, safeMin: 25, safeMax: 32,
            status: 'Normal', history: generateHistory(29.62, 25, 32),
          },
        ],
      },
    ],
  },
  {
    // No expansion board has reported in for this node yet — `modules: []`.
    // DeviceOverview renders this as "No modules detected" instead of a
    // sensor grid, and Calibration's board list simply has nothing to show
    // for this device, all driven by the empty array below.
    id: 'n2',
    name: 'ESP32 Module 2',
    nodeId: 'N002',
    status: 'online',
    commMode: 'Wi-Fi',
    uptime: 41760,
    rssi: -54,
    freeHeap: 151040,
    modules: [],
  },
];

export const notifications = [
  { id: 1, type: 'warning', title: 'Dissolved Oxygen Low', message: 'Port A0 on Expansion Board 1 (ESP32 Module 1) is approaching the lower safe threshold.', time: '2 min ago', read: false },
  { id: 2, type: 'info',    title: 'Device Connected',    message: 'ESP32 Module 1 connected via Wi-Fi at −61 dBm.', time: '1 hr ago', read: false },
  { id: 3, type: 'success', title: 'Calibration Saved',   message: 'Formula for Dissolved Oxygen (DO) has been saved successfully.', time: '3 hr ago', read: true },
  { id: 4, type: 'fault',   title: 'Sensor Port Fault',   message: 'Port A3 on Expansion Board 1 reports no valid response. Check wiring.', time: 'Yesterday', read: true },
];

export const savedFormulas = [
  { id: 1, label: 'temperaTURE', formula: '(+0.00000000*x**0 - 20.0199576*x**2 + 0.00751695*x**2 + 1440.577831)*1' },
  { id: 2, label: 'DO',          formula: 'x*(13453.23451 - 194.23421*np.floor(CH2))/(1175*123*CH2 - 25.64)' },
  { id: 3, label: 'salinity',    formula: '(+0.0000*x**0 - 20.0199576*x - 194.2342)/1000*3.0 + 7.0' },
];

export const channelAssignments = {
  'board-1': { A0: 'DO', A1: 'salinity', A2: 'temperaTURE', A3: null },
};

// Sensors pre-placed on the interactive canvas (Konva Stage coords).
// Only position + which physical channel they represent is stored here —
// label, unit, and live status are resolved from `devices` above (by
// deviceId/moduleId/portId) every time the map renders. This is what
// makes the map "dynamic": rename a port, change its status, or remove
// the whole board from `devices`, and every placed sensor that points at
// it updates (or gracefully falls back) with no changes needed here.
export const mapSensors = [
  { id: 's1', x: 210, y: 145, deviceId: 'n1', moduleId: 'board-1', portId: 'A0' }, // Dissolved Oxygen
  { id: 's2', x: 375, y: 148, deviceId: 'n1', moduleId: 'board-1', portId: 'A1' }, // Salinity
  { id: 's3', x: 295, y: 265, deviceId: 'n1', moduleId: 'board-1', portId: 'A2' }, // Temperature
];

// Legacy generic sensor-type palette — no longer used by InteractiveMap
// (the map now builds its placement palette live from `devices`/`mapSensors`
// above), kept here only in case other code in the wider project still
// imports it.
export const sensorTypes = [
  { type: 'pH Sensor',      color: '#7C3AED' },
  { type: 'Temperature',    color: '#EA580C' },
  { type: 'Dissolved O2',   color: '#2563EB' },
  { type: 'Salinity',       color: '#0891B2' },
  { type: 'Light',          color: '#CA8A04' },
  { type: 'Turbidity',      color: '#65A30D' },
];
