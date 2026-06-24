// InteractiveMap.jsx — Konva canvas: sensor placement + rect/circle/line drawing
//
// Role gating: per the thesis's role hierarchy, laying out / editing the
// map is the one function reserved exclusively for the Designer tier.
// Operators get the same canvas rendered read-only — they can pick which
// of their organization's published layouts to view and double-click a
// sensor to jump to its detail page, but every editing affordance (tools,
// drawing, dragging, save/export/import, clear canvas) is gone entirely
// rather than just disabled, so there's nothing to discover that wouldn't
// work anyway.
import { useState, useRef, useEffect, useMemo } from 'react';
import { Stage, Layer, Rect, Circle, Text, Group, Line } from 'react-konva';
import { mapSensors as initialPlacements, devices as defaultDevices } from '../mockData';

// Status colours match the rest of the app (GaugeCard, DeviceOverview) —
// a sensor's dot on the map uses the exact same vocabulary as its gauge.
const PORT_STATUS_COLOR = { Normal: '#22C55E', Warning: '#F59E0B', Fault: '#EF4444', Offline: '#9CA3AF' };

// Deterministic colour per sensor label, so the same physical sensor
// always gets the same colour, and any new/unrecognised sensor label
// still gets *some* distinct colour automatically — no manual mapping
// needed when new hardware/sensor types show up.
const CHANNEL_COLOR_PALETTE = ['#2563EB', '#0891B2', '#EA580C', '#7C3AED', '#65A30D', '#CA8A04', '#DB2777', '#0D9488'];
function colorForLabel(label) {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return CHANNEL_COLOR_PALETTE[hash % CHANNEL_COLOR_PALETTE.length];
}

const SHAPE_COLORS = ['#1B3461', '#2563EB', '#DC2626', '#16A34A', '#9333EA', '#EA580C', '#9CA3AF'];

// Shared inline styles for the Save/Load sidebar section
const ghostBtnStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  padding: '6px 8px', fontSize: 11.5, fontWeight: 600,
  border: '1px solid #E5E7EB', borderRadius: 5,
  background: '#fff', color: '#4B5563', cursor: 'pointer',
};
const profileRowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
  padding: '5px 8px', fontSize: 12, color: '#374151',
  background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: 4,
};
const iconBtnStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, padding: 0,
  background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer',
};

// ── Icons ──────────────────────────────────────────────────────────────────
const IconSelect = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
    <path d="M2 2l4 12 2.5-4.5L13 12l1.5-1.5-4.5-4.5L14 3.5 2 2z"/>
  </svg>
);
const IconDraw = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
    <path d="M13.5 1.5l1 1-10 10-2 1 1-2 10-10z"/>
  </svg>
);
const IconRect = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <rect x="2" y="4" width="12" height="9" rx="1"/>
  </svg>
);
const IconCircle = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
    <circle cx="8" cy="8.5" r="5.5"/>
  </svg>
);
const IconLine = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" width="16" height="16">
    <line x1="2" y1="13" x2="14" y2="3"/>
  </svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
       strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <path d="M3 5h10M7 5V3h2v2M5 5l.7 8h4.6L11 5H5z"/>
  </svg>
);
// Cursor arrow + red ✕ badge — conveys "click anything to delete it"
const IconErase = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
    <path d="M2 2l3.8 11.4 2.2-3.9 4.5 3.5 1.3-1.3-3.5-4.5 3.9-2.2z" opacity="0.85"/>
    <circle cx="12.5" cy="3.5" r="3" fill="#EF4444"/>
    <path d="M11.2 2.2l2.6 2.6M13.8 2.2l-2.6 2.6"
      stroke="white" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
  </svg>
);
const IconDownload = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
       strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <path d="M8 1.5v8M5 6.5l3 3 3-3M2.5 13h11"/>
  </svg>
);
const IconUpload = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
       strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <path d="M8 9.5v-8M5 4.5l3-3 3 3M2.5 13h11"/>
  </svg>
);
const IconSave = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
       strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <path d="M2.5 2h8l3 3v9h-11V2z"/>
    <path d="M5 2v3.5h5V2M4.5 9h7v4h-7V9z"/>
  </svg>
);
const IconLoad = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
       strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <path d="M8 1.8a6.2 6.2 0 105.4 3.1M14 1.8v3.5h-3.5"/>
  </svg>
);

// localStorage keys for named save profiles. Namespaced per tenant so a
// Designer's saved layouts are scoped to their own organization's "shared
// database" of layouts (per the thesis's LAYOUTS table, tenant-scoped) —
// switching organizations never shows another tenant's maps. A real
// backend replaces this with GET/POST against /api/orgs/:id/layouts
// (the LAYOUTS + LAYOUT_NODES tables) without touching anything below.
function profilesKey(tenantId) {
  return `senseful_map_profiles::${tenantId || 'default'}`;
}

// Sidebar width — bigger default so labels like "Dissolved Oxygen" plus
// the board name they belong to don't get cramped, but still adjustable
// by dragging, and remembered between visits. This is a personal UI
// preference rather than organization data, so unlike the profiles above
// it's intentionally *not* tenant-scoped.
const SIDEBAR_WIDTH_KEY = 'senseful_map_sidebar_width';
const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;

function loadSidebarWidth() {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, n)) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function loadProfilesFromStorage(tenantId) {
  try {
    const raw = window.localStorage.getItem(profilesKey(tenantId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistProfiles(tenantId, profiles) {
  try {
    window.localStorage.setItem(profilesKey(tenantId), JSON.stringify(profiles));
  } catch {
    // Storage unavailable or full — the in-memory list still works for
    // this session, it just won't survive a page reload.
  }
}

// A placed sensor doesn't store its own label/status — it only stores
// *which* physical channel it represents, via this key. Everything else
// (label, unit, live status) is looked up from `devices` at render time,
// so the map always reflects whatever is currently connected.
function channelKey(deviceId, moduleId, portId) {
  return `${deviceId}::${moduleId}::${portId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function InteractiveMap({
  devices: devicesProp,
  canEdit = true,
  onSelectSensor,
  tenantId = 'default',
  creatorName,
}) {
  // Falls back to the raw mockData import for standalone use — the same
  // pattern used by DeviceOverview/Calibration, so all three pages stay
  // consistent about how tenant-scoped data flows in.
  const devices = devicesProp ?? defaultDevices;

  const containerRef  = useRef(null);
  const [stageSize, setStageSize] = useState({ width: 600, height: 480 });

  // Sidebar width — draggable via the handle between the sidebar and the
  // canvas, persisted in localStorage so it's remembered between visits.
  const [sidebarWidth, setSidebarWidth] = useState(() => loadSidebarWidth());
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const resizeStateRef = useRef(null);   // { startX, startWidth } while dragging
  const sidebarWidthRef = useRef(sidebarWidth); // lets the drag's mouseup handler read the latest width without going stale
  useEffect(() => { sidebarWidthRef.current = sidebarWidth; }, [sidebarWidth]);

  function startSidebarResize(e) {
    e.preventDefault();
    resizeStateRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    setIsResizingSidebar(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev) {
      const { startX, startWidth } = resizeStateRef.current;
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + (ev.clientX - startX)));
      setSidebarWidth(next);
    }
    function onUp() {
      setIsResizingSidebar(false);
      resizeStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current)); } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Placed sensors only store position + which channel they represent.
  // Their label/unit/status are resolved live from `devices` below.
  const [sensors, setSensors] = useState(() =>
    initialPlacements.map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      channelKey: channelKey(p.deviceId, p.moduleId, p.portId),
    }))
  );

  // Drawn shapes
  const [shapes, setShapes]   = useState([]);
  const isDrawingRef           = useRef(false);
  const drawStartRef           = useRef(null);
  const drawingIdRef           = useRef(null);
  const justDrewRef            = useRef(false); // suppress stage-click after a drag-draw

  // Unified selection (sensors + shapes share same id space)
  const [selectedId, setSelectedId] = useState(null);

  // Tools: 'select' | 'draw' | 'rect' | 'circle' | 'line' | 'eraser'
  const [activeTool, setActiveTool]   = useState('select');
  const [pendingChannelKey, setPendingChannelKey] = useState(null);  // for 'draw' sensor placement
  const [shapeColor, setShapeColor]   = useState(SHAPE_COLORS[1]);

  // ── Live sensor channels ─────────────────────────────────────────────────
  // Flatten every port across every currently-connected ESP32 node/board
  // into one list. Recomputed from `devices` whenever it changes, so this
  // always reflects what hardware is actually reporting right now — add a
  // board, remove one, and this list (and everything derived from it)
  // updates with no other code changes needed.
  const allChannels = useMemo(() => {
    const list = [];
    devices.forEach(device => {
      device.modules.forEach(mod => {
        mod.ports.forEach(port => {
          const key = channelKey(device.id, mod.id, port.id);
          list.push({
            key,
            deviceId: device.id, moduleId: mod.id, portId: port.id,
            label: port.label, unit: port.unit, status: port.status,
            deviceName: device.name, moduleName: mod.name,
            color: colorForLabel(port.label),
          });
        });
      });
    });
    return list;
  }, [devices]); // depends on devices directly — once this comes from live backend state/props instead of a static import, this list updates automatically

  const channelByKey = useMemo(() => {
    const map = {};
    allChannels.forEach(ch => { map[ch.key] = ch; });
    return map;
  }, [allChannels]);

  // Channels not yet placed anywhere on the canvas — this is what shows up
  // in the "Sensors" palette, and it shrinks/grows as sensors are placed
  // or removed.
  const placedChannelKeys = useMemo(
    () => new Set(sensors.map(s => s.channelKey)),
    [sensors]
  );
  const availableChannels = useMemo(
    () => allChannels.filter(ch => !placedChannelKeys.has(ch.key)),
    [allChannels, placedChannelKeys]
  );

  // Look up a placed sensor's live info. Falls back gracefully if the
  // channel it pointed to is no longer reported (board/node disconnected),
  // instead of crashing.
  function resolveChannel(key) {
    return channelByKey[key] ?? {
      key, label: 'Unknown Sensor', unit: '', status: 'Offline',
      deviceName: '—', moduleName: '—', color: '#9CA3AF',
    };
  }

  // Like resolveChannel, but returns the actual device/module/port
  // objects (not just the flattened display info) so a double-click can
  // hand them straight to onSelectSensor — the same shape App.jsx already
  // expects from DeviceOverview's gauge cards. Returns null if the
  // channel's source board is no longer connected, same "stale pointer,
  // don't crash" philosophy as resolveChannel above.
  function resolveFullChannel(key) {
    for (const device of devices) {
      for (const mod of device.modules) {
        for (const port of mod.ports) {
          if (channelKey(device.id, mod.id, port.id) === key) {
            return { device, module: mod, port };
          }
        }
      }
    }
    return null;
  }

  // Save / Load — export to a JSON file, or save a named profile in
  // localStorage that can be reloaded later without a file dialog.
  const fileInputRef       = useRef(null);
  const statusTimeoutRef   = useRef(null);
  const [profileName, setProfileName] = useState('');
  const [profiles, setProfiles]       = useState(() => loadProfilesFromStorage(tenantId));
  const [statusMsg, setStatusMsg]     = useState(null); // { text, error }

  // ── Measure canvas ──────────────────────────────────────────────────────
  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        setStageSize({
          width:  containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // ── Keyboard: Delete / Escape ────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (!canEdit) return; // Operators: nothing on this canvas is deletable
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        setSensors(prev => prev.filter(s => s.id !== selectedId));
        setShapes  (prev => prev.filter(s => s.id !== selectedId));
        setSelectedId(null);
      }
      if (e.key === 'Escape') {
        setSelectedId(null);
        setPendingChannelKey(null);
        switchTool('select');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, canEdit]); // eslint-disable-line

  // ── Tool switch ──────────────────────────────────────────────────────────
  function switchTool(tool) {
    if (!canEdit) return;
    setActiveTool(tool);
    if (tool !== 'draw') setPendingChannelKey(null);
    setSelectedId(null);
    isDrawingRef.current = false;
  }

  // ── Delete selected ──────────────────────────────────────────────────────
  function deleteSelected() {
    if (!canEdit) return;
    setSensors(prev => prev.filter(s => s.id !== selectedId));
    setShapes  (prev => prev.filter(s => s.id !== selectedId));
    setSelectedId(null);
  }

  // ── Sensor drag ──────────────────────────────────────────────────────────
  function handleSensorDragEnd(id, e) {
    setSensors(prev => prev.map(s =>
      s.id === id ? { ...s, x: e.target.x(), y: e.target.y() } : s
    ));
  }

  // ── Shape drag ───────────────────────────────────────────────────────────
  function handleShapeDragEnd(shape, e) {
    if (shape.type === 'line') {
      // Line's position drifts during drag; fold the offset back into absolute points
      const dx = e.target.x(), dy = e.target.y();
      const [x1, y1, x2, y2] = shape.points;
      setShapes(prev => prev.map(s =>
        s.id === shape.id
          ? { ...s, points: [x1 + dx, y1 + dy, x2 + dx, y2 + dy] }
          : s
      ));
      e.target.position({ x: 0, y: 0 }); // reset node position immediately
    } else {
      setShapes(prev => prev.map(s =>
        s.id === shape.id
          ? { ...s, x: e.target.x(), y: e.target.y() }
          : s
      ));
    }
  }

  // ── Stage: mousedown — starts shape drawing ──────────────────────────────
  function handleStageMouseDown(e) {
    if (!canEdit) return;
    if (!['rect', 'circle', 'line'].includes(activeTool)) return;
    justDrewRef.current = false;

    const pos = e.target.getStage().getPointerPosition();
    const id  = `shape_${Date.now()}`;

    isDrawingRef.current = true;
    drawStartRef.current = pos;
    drawingIdRef.current = id;

    let base = { id, type: activeTool, color: shapeColor };
    let newShape;
    if (activeTool === 'rect') {
      newShape = { ...base, x: pos.x, y: pos.y, width: 0, height: 0 };
    } else if (activeTool === 'circle') {
      newShape = { ...base, x: pos.x, y: pos.y, radius: 0 };
    } else {
      newShape = { ...base, points: [pos.x, pos.y, pos.x, pos.y] };
    }
    setShapes(prev => [...prev, newShape]);
  }

  // ── Stage: mousemove — update in-progress shape ──────────────────────────
  function handleStageMouseMove(e) {
    if (!isDrawingRef.current || !drawStartRef.current || !drawingIdRef.current) return;
    const pos   = e.target.getStage().getPointerPosition();
    const start = drawStartRef.current;

    setShapes(prev => prev.map(s => {
      if (s.id !== drawingIdRef.current) return s;
      if (s.type === 'rect') {
        return {
          ...s,
          x: Math.min(start.x, pos.x),
          y: Math.min(start.y, pos.y),
          width:  Math.abs(pos.x - start.x),
          height: Math.abs(pos.y - start.y),
        };
      }
      if (s.type === 'circle') {
        // Bounding-box style: click point and drag point are opposite corners.
        // Center = midpoint, radius = half the distance between the two corners.
        const cx = (start.x + pos.x) / 2;
        const cy = (start.y + pos.y) / 2;
        const radius = Math.hypot(pos.x - start.x, pos.y - start.y) / 2;
        return { ...s, x: cx, y: cy, radius };
      }
      // line
      return { ...s, points: [start.x, start.y, pos.x, pos.y] };
    }));
  }

  // ── Stage: mouseup — finalize shape ─────────────────────────────────────
  function handleStageMouseUp() {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    justDrewRef.current  = true;

    const id = drawingIdRef.current;
    // Remove if too small (accidental click, not a real draw)
    setShapes(prev => prev.filter(s => {
      if (s.id !== id) return true;
      if (s.type === 'rect')   return s.width > 8 && s.height > 8;
      if (s.type === 'circle') return s.radius > 8;
      if (s.type === 'line') {
        const [x1, y1, x2, y2] = s.points;
        return Math.hypot(x2 - x1, y2 - y1) > 12;
      }
      return true;
    }));
    drawStartRef.current = null;
    drawingIdRef.current = null;
  }

  // ── Stage: click — sensor placement + background deselect ────────────────
  function handleStageClick(e) {
    // Suppress if this click was the end of a drag-draw
    if (justDrewRef.current) { justDrewRef.current = false; return; }

    const target = e.target;
    const isBg   = target === target.getStage()
      || target.name() === 'canvas-bg'
      || target.name() === 'grid-v'
      || target.name() === 'grid-h'
      || target.name() === 'floor-plan';

    if (!canEdit) {
      if (isBg) setSelectedId(null);
      return;
    }

    // Sensor placement — allowed on background AND on top of shapes/lines
    if (activeTool === 'draw' && pendingChannelKey) {
      // Guard: the channel must still exist and not already be placed
      // (e.g. it could have gone stale if devices changed mid-selection).
      if (!channelByKey[pendingChannelKey] || placedChannelKeys.has(pendingChannelKey)) {
        setPendingChannelKey(null);
        return;
      }
      const pos = e.target.getStage().getPointerPosition();
      setSensors(prev => [...prev, {
        id: `s${Date.now()}`,
        x: pos.x, y: pos.y,
        channelKey: pendingChannelKey,
      }]);
      setPendingChannelKey(null); // that channel is now placed — clear the pending selection
      return;
    }

    // Deselect on background click
    if (isBg) setSelectedId(null);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const isShapeTool  = canEdit && ['rect', 'circle', 'line'].includes(activeTool);
  const hasSelection = !!selectedId;

  // Wipe everything from the canvas
  function clearAll() {
    if (!canEdit) return;
    setSensors([]);
    setShapes([]);
    setSelectedId(null);
  }

  // Fill color = shape color at ~16% opacity (hex alpha)
  function fillOf(color) { return color + '28'; }

  // ── Save / Load helpers ──────────────────────────────────────────────────
  // Brief inline feedback (success or error), auto-clears after 3s.
  function flashStatus(text, isError = false) {
    setStatusMsg({ text, error: isError });
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => setStatusMsg(null), 3000);
  }

  // The full, human-readable shape of a saved map — used for both the
  // downloadable .json file and the localStorage profiles, so the two
  // stay perfectly interchangeable (export a profile, or save an
  // imported file as a profile). `createdBy` is an addition beyond the
  // thesis's documented LAYOUTS columns (layout_id/tenant_id/layout_name/
  // background_data/created_at) — a reasonable extension once a real
  // schema adds a created_by_user_id FK, kept here so Operators can see
  // whose layout they're viewing.
  function buildSnapshot(name) {
    return {
      version: 1,
      name: name || 'Untitled Map',
      savedAt: new Date().toISOString(),
      createdBy: creatorName || undefined,
      canvas: { width: stageSize.width, height: stageSize.height },
      sensors,
      shapes,
    };
  }

  function applySnapshot(snapshot) {
    setSensors(Array.isArray(snapshot?.sensors) ? snapshot.sensors : []);
    setShapes(Array.isArray(snapshot?.shapes) ? snapshot.shapes : []);
    setSelectedId(null);
  }

  // Download the current canvas as a readable, re-importable .json file
  function exportTemplate() {
    if (!canEdit) return;
    const snapshot = buildSnapshot(profileName.trim() || 'SENSEful Map');
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const safeName = (snapshot.name || 'senseful-map').trim().replace(/[^a-z0-9\-_]+/gi, '_') || 'senseful-map';

    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flashStatus('Template downloaded.');
  }

  function triggerImport() {
    if (!canEdit) return;
    fileInputRef.current?.click();
  }

  // Read an uploaded .json template and load it onto the canvas
  function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file || !canEdit) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || (!Array.isArray(parsed.sensors) && !Array.isArray(parsed.shapes))) {
          throw new Error('missing sensors/shapes');
        }
        applySnapshot(parsed);
        if (parsed.name) setProfileName(parsed.name);
        flashStatus(`Loaded "${parsed.name || file.name}".`);
      } catch {
        flashStatus('That file isn\u2019t a valid SENSEful map template.', true);
      }
    };
    reader.onerror = () => flashStatus('Could not read that file.', true);
    reader.readAsText(file);
  }

  // Save the current canvas as a named profile in localStorage (Designer-
  // only — this is what becomes the organization's "published" layout
  // that Operators can browse and load read-only).
  function saveProfile() {
    if (!canEdit) return;
    const name = profileName.trim();
    if (!name) { flashStatus('Enter a profile name first.', true); return; }
    const snapshot = buildSnapshot(name);
    setProfiles(prev => {
      const next = { ...prev, [name]: snapshot };
      persistProfiles(tenantId, next);
      return next;
    });
    flashStatus(`Profile "${name}" saved.`);
  }

  // Loads a saved profile onto the canvas. Used by both roles — Designers
  // to resume editing a saved layout, Operators to view a published one
  // (the surrounding UI is what makes it read-only for Operators, not
  // this function).
  function loadProfile(name) {
    const snapshot = profiles[name];
    if (!snapshot) return;
    applySnapshot(snapshot);
    setProfileName(name);
    flashStatus(`Loaded "${name}".`);
  }

  function deleteProfile(name) {
    if (!canEdit) return;
    setProfiles(prev => {
      const next = { ...prev };
      delete next[name];
      persistProfiles(tenantId, next);
      return next;
    });
    flashStatus(`Deleted profile "${name}".`);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="map-layout">

      {/* ── Left panel ── */}
      <aside className="map-sidebar" style={{ width: sidebarWidth }}>

        {canEdit ? (
          <>
            {/* Tools (2-column grid so all 6 fit) */}
            <div className="map-sidebar-section">
              <div className="map-sidebar-section-title">Tools</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {[
                  { key: 'select', label: 'Select',  Icon: IconSelect  },
                  { key: 'draw',   label: 'Sensor',  Icon: IconDraw    },
                  { key: 'rect',   label: 'Rect',    Icon: IconRect    },
                  { key: 'circle', label: 'Circle',  Icon: IconCircle  },
                  { key: 'line',   label: 'Line',    Icon: IconLine    },
                  { key: 'eraser', label: 'Erase',   Icon: IconErase   },
                ].map(({ key, label, Icon }) => (
                  <button key={key}
                    className={`map-tool-btn${activeTool === key ? ' active' : ''}`}
                    onClick={() => switchTool(key)}>
                    <Icon /> {label}
                  </button>
                ))}
              </div>

              {/* Eraser hint */}
              {activeTool === 'eraser' && (
                <p style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.4 }}>
                  Click any shape or sensor on the canvas to remove it.
                </p>
              )}

              {/* Shape color picker */}
              {isShapeTool && (
                <div style={{ marginTop: 10 }}>
                  <div className="map-sidebar-section-title" style={{ marginBottom: 6 }}>Color</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {SHAPE_COLORS.map(c => (
                      <button key={c} onClick={() => setShapeColor(c)}
                        style={{
                          width: 20, height: 20, borderRadius: '50%',
                          background: c, border: 'none', cursor: 'pointer',
                          outline: shapeColor === c ? `2.5px solid ${c}` : 'none',
                          outlineOffset: 2, flexShrink: 0,
                        }} />
                    ))}
                  </div>
                  <p style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 7, lineHeight: 1.4 }}>
                    {activeTool === 'line'
                      ? 'Click & drag on the canvas to draw a line.'
                      : `Click & drag on the canvas to draw a ${activeTool}.`}
                  </p>
                </div>
              )}

              {/* Sensor draw hint */}
              {activeTool === 'draw' && (
                <p style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.4 }}>
                  {pendingChannelKey
                    ? `Click canvas to place "${resolveChannel(pendingChannelKey).label}"`
                    : availableChannels.length > 0
                      ? 'Pick a sensor below, then click the canvas.'
                      : allChannels.length === 0
                        ? 'No sensors are currently reporting from any connected ESP32 module.'
                        : 'Every currently connected sensor is already placed on the map.'}
                </p>
              )}
            </div>

            {/* Delete selected */}
            {hasSelection && activeTool === 'select' && (
              <div className="map-sidebar-section">
                <button onClick={deleteSelected}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '7px 10px', borderRadius: 5,
                    background: '#FEE2E2', border: '1px solid #FECACA',
                    color: '#DC2626', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  }}>
                  <IconTrash /> Delete Selected
                </button>
                <p style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 5, lineHeight: 1.4 }}>
                  or press{' '}
                  <kbd style={{ fontSize: 10, background: '#F3F4F6', padding: '1px 4px',
                    borderRadius: 3, border: '1px solid #D1D5DB' }}>Del</kbd>
                </p>
              </div>
            )}

            {/* Sensor palette (draw tool only) — live, currently-unplaced channels */}
            {activeTool === 'draw' && (
              <div className="map-sidebar-section">
                <div className="map-sidebar-section-title">Sensors</div>
                {availableChannels.length === 0 ? (
                  <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>
                    {allChannels.length === 0
                      ? 'No connected ESP32 module is reporting any sensors yet.'
                      : 'All connected sensors are already placed on the map.'}
                  </p>
                ) : (
                  <div className="sensor-palette">
                    {availableChannels.map(ch => (
                      <div key={ch.key} className="palette-item"
                        style={{ background: pendingChannelKey === ch.key ? '#EFF6FF' : '' }}
                        onClick={() => setPendingChannelKey(ch.key)}>
                        <span className="palette-dot" style={{ background: ch.color }} />
                        {ch.label}
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
                          {ch.moduleName}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Status legend — matches each sensor's live port status */}
            <div className="map-sidebar-section">
              <div className="map-sidebar-section-title">Status</div>
              <div className="status-legend">
                {Object.entries(PORT_STATUS_COLOR).map(([label, color]) => (
                  <div key={label} className="legend-item">
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
                    {label}
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Save / Load — export & import a readable .json template, or
                save/load a named profile from the browser's local storage */}
            <div className="map-sidebar-section">
              <div className="map-sidebar-section-title">Save / Load Map</div>

              <input
                className="input-field"
                placeholder="Map name (e.g. Pond A Layout)"
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                style={{ marginBottom: 8, fontSize: 12, padding: '6px 9px' }}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                <button onClick={exportTemplate} style={ghostBtnStyle} title="Download as a .json file">
                  <IconDownload /> Export
                </button>
                <button onClick={triggerImport} style={ghostBtnStyle} title="Load a .json template from disk">
                  <IconUpload /> Import
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportFile}
                style={{ display: 'none' }}
              />

              <button onClick={saveProfile}
                style={{ ...ghostBtnStyle, width: '100%', background: '#2563EB', borderColor: '#2563EB', color: '#fff', marginBottom: 8 }}>
                <IconSave /> Save as Profile
              </button>
              <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: -4, marginBottom: 8, lineHeight: 1.4 }}>
                Saved profiles are visible to every Operator in your organization.
              </p>

              {Object.keys(profiles).length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
                  {Object.values(profiles)
                    .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))
                    .map(p => (
                      <div key={p.name} style={profileRowStyle}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={p.name}>
                          {p.name}
                        </span>
                        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                          <button onClick={() => loadProfile(p.name)} title="Load this profile"
                            style={iconBtnStyle}>
                            <IconLoad />
                          </button>
                          <button onClick={() => deleteProfile(p.name)} title="Delete this profile"
                            style={{ ...iconBtnStyle, color: '#DC2626' }}>
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {statusMsg && (
                <p style={{
                  fontSize: 11, marginTop: 8, lineHeight: 1.4,
                  color: statusMsg.error ? '#DC2626' : '#16A34A',
                }}>
                  {statusMsg.error ? '⚠ ' : '✓ '}{statusMsg.text}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            {/* ── Operator: read-only view ── */}
            <div className="map-sidebar-section">
              <div className="map-sidebar-section-title">Layout</div>
              <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5 }}>
                Read-only view. Only your organization&rsquo;s Designer can create
                or edit map layouts. Double-click a sensor to open its details.
              </p>
            </div>

            <div className="map-sidebar-section">
              <div className="map-sidebar-section-title">Published Layouts</div>
              {Object.keys(profiles).length === 0 ? (
                <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5 }}>
                  Your Designer hasn&rsquo;t published a layout yet.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Object.values(profiles)
                    .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))
                    .map(p => (
                      <button key={p.name} onClick={() => loadProfile(p.name)}
                        style={{
                          ...ghostBtnStyle, width: '100%', justifyContent: 'space-between',
                          flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '8px 10px',
                          background: profileName === p.name ? '#EFF6FF' : '#fff',
                          borderColor: profileName === p.name ? '#BFDBFE' : '#E5E7EB',
                        }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                          <IconLoad />
                        </span>
                        {p.createdBy && (
                          <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 400 }}>by {p.createdBy}</span>
                        )}
                      </button>
                    ))}
                </div>
              )}
              {statusMsg && (
                <p style={{
                  fontSize: 11, marginTop: 8, lineHeight: 1.4,
                  color: statusMsg.error ? '#DC2626' : '#16A34A',
                }}>
                  {statusMsg.error ? '⚠ ' : '✓ '}{statusMsg.text}
                </p>
              )}
            </div>

            {/* Status legend — still useful read-only context */}
            <div className="map-sidebar-section">
              <div className="map-sidebar-section-title">Status</div>
              <div className="status-legend">
                {Object.entries(PORT_STATUS_COLOR).map(([label, color]) => (
                  <div key={label} className="legend-item">
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </aside>

      {/* ── Drag handle to resize the sidebar ── */}
      <div
        onMouseDown={startSidebarResize}
        title="Drag to resize"
        style={{
          width: 6, flexShrink: 0, cursor: 'col-resize',
          background: isResizingSidebar ? '#BFDBFE' : 'transparent',
          transition: isResizingSidebar ? 'none' : 'background 0.15s',
          position: 'relative',
        }}
        onMouseEnter={e => { if (!isResizingSidebar) e.currentTarget.style.background = '#E5E7EB'; }}
        onMouseLeave={e => { if (!isResizingSidebar) e.currentTarget.style.background = 'transparent'; }}
      />

      {/* ── Konva canvas ── */}
      <div ref={containerRef} className="map-canvas-area"
        style={{
          position: 'relative',
          cursor: isShapeTool || (canEdit && activeTool === 'eraser') ? 'crosshair' : 'default',
        }}>

        {/* Read-only badge — Operator view */}
        {!canEdit && (
          <div style={{
            position: 'absolute', top: 10, left: 10, zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 11px', background: 'rgba(255,255,255,0.92)',
            border: '1px solid #E5E7EB', borderRadius: 20,
            fontSize: 11.5, fontWeight: 600, color: '#6B7280',
            boxShadow: '0 1px 4px rgba(0,0,0,0.10)', backdropFilter: 'blur(4px)',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#9CA3AF', display: 'inline-block' }} />
            Read-only
          </div>
        )}

        {/* Clear Canvas button — top-right overlay (Designer only) */}
        {canEdit && (
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, display: 'flex', gap: 8 }}>
            <button
              onClick={clearAll}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 12px',
                background: 'rgba(255,255,255,0.92)',
                border: '1px solid #E5E7EB',
                borderRadius: 6,
                fontSize: 12, fontWeight: 600, color: '#6B7280',
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                backdropFilter: 'blur(4px)',
                transition: 'background 0.12s, color 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#FEE2E2'; e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.borderColor = '#FECACA'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.92)'; e.currentTarget.style.color = '#6B7280'; e.currentTarget.style.borderColor = '#E5E7EB'; }}
            >
              <IconTrash /> Clear Canvas
            </button>
          </div>
        )}
        <Stage
          width={stageSize.width}
          height={stageSize.height}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onClick={handleStageClick}
        >
          <Layer>
            {/* Background */}
            <Rect name="canvas-bg"
              x={0} y={0} width={stageSize.width} height={stageSize.height}
              fill="#F0F3F8" />

            {/* Grid lines — listening:false so they don't intercept clicks */}
            {Array.from({ length: Math.ceil(stageSize.width / 40) }, (_, i) => (
              <Rect key={`vg${i}`} name="grid-v"
                x={i * 40} y={0} width={1} height={stageSize.height}
                fill="#E5E7EB" listening={false} />
            ))}
            {Array.from({ length: Math.ceil(stageSize.height / 40) }, (_, i) => (
              <Rect key={`hg${i}`} name="grid-h"
                x={0} y={i * 40} width={stageSize.width} height={1}
                fill="#E5E7EB" listening={false} />
            ))}

            {/* Floor plan outline */}
            <Rect name="floor-plan"
              x={40} y={40}
              width={stageSize.width - 80} height={stageSize.height - 80}
              stroke="#CBD5E1" strokeWidth={1.5} dash={[8, 4]}
              fill="rgba(255,255,255,0.5)" cornerRadius={4} />

            {/* ── Drawn shapes ── */}
            {shapes.map(shape => {
              const sel       = selectedId === shape.id;
              const draggable = canEdit && activeTool === 'select';

              // Shared click handler: erase in eraser mode, select in select mode,
              // and in draw mode let the click pass through to the stage.
              const onShapeClick = e => {
                if (!canEdit) { e.cancelBubble = true; setSelectedId(shape.id); return; }
                if (activeTool === 'draw') return; // bubble up → stage places sensor
                e.cancelBubble = true;
                if (activeTool === 'eraser') {
                  setShapes(prev => prev.filter(s => s.id !== shape.id));
                  if (selectedId === shape.id) setSelectedId(null);
                } else if (activeTool === 'select') {
                  setSelectedId(shape.id);
                }
              };

              if (shape.type === 'rect') return (
                <Group key={shape.id}>
                  {/* Selection outline (not clickable) */}
                  {sel && (
                    <Rect
                      x={shape.x - 3} y={shape.y - 3}
                      width={shape.width + 6} height={shape.height + 6}
                      stroke="#2563EB" strokeWidth={1.5} dash={[4, 3]}
                      fill="transparent" listening={false} cornerRadius={3}
                    />
                  )}
                  <Rect
                    x={shape.x} y={shape.y}
                    width={shape.width} height={shape.height}
                    fill={fillOf(shape.color)}
                    stroke={shape.color} strokeWidth={sel ? 2.5 : 2}
                    cornerRadius={2}
                    draggable={draggable}
                    onClick={onShapeClick}
                    onDragEnd={e => handleShapeDragEnd(shape, e)}
                  />
                </Group>
              );

              if (shape.type === 'circle') return (
                <Group key={shape.id}>
                  {sel && (
                    <Circle
                      x={shape.x} y={shape.y} radius={shape.radius + 4}
                      stroke="#2563EB" strokeWidth={1.5} dash={[4, 3]}
                      fill="transparent" listening={false}
                    />
                  )}
                  <Circle
                    x={shape.x} y={shape.y} radius={shape.radius}
                    fill={fillOf(shape.color)}
                    stroke={shape.color} strokeWidth={sel ? 2.5 : 2}
                    draggable={draggable}
                    onClick={onShapeClick}
                    onDragEnd={e => handleShapeDragEnd(shape, e)}
                  />
                </Group>
              );

              if (shape.type === 'line') {
                const [x1, y1, x2, y2] = shape.points;
                return (
                  <Group key={shape.id}>
                    {/* Endpoint dots when selected */}
                    {sel && <>
                      <Circle x={x1} y={y1} radius={4} fill="#2563EB" listening={false} />
                      <Circle x={x2} y={y2} radius={4} fill="#2563EB" listening={false} />
                    </>}
                    <Line
                      points={shape.points}
                      x={0} y={0}
                      stroke={shape.color} strokeWidth={sel ? 3 : 2.5}
                      lineCap="round"
                      hitStrokeWidth={14}   // wide invisible hit area for easy clicking
                      draggable={draggable}
                      onClick={onShapeClick}
                      onDragEnd={e => handleShapeDragEnd(shape, e)}
                    />
                  </Group>
                );
              }

              return null;
            })}

            {/* ── Placed sensors — label/status/colour resolved live from `devices` ── */}
            {sensors.map(sensor => {
              const ch          = resolveChannel(sensor.channelKey);
              const sColor      = ch.color;
              const dotColor    = PORT_STATUS_COLOR[ch.status] ?? '#9CA3AF';
              const isSelected  = selectedId === sensor.id;
              return (
                <Group
                  key={sensor.id}
                  x={sensor.x} y={sensor.y}
                  draggable={canEdit && activeTool === 'select'}
                  onDragEnd={e => handleSensorDragEnd(sensor.id, e)}
                  onClick={e => {
                    e.cancelBubble = true;
                    if (!canEdit) { setSelectedId(sensor.id); return; }
                    if (activeTool === 'eraser') {
                      setSensors(prev => prev.filter(s => s.id !== sensor.id));
                      if (selectedId === sensor.id) setSelectedId(null);
                    } else if (activeTool === 'select') {
                      setSelectedId(sensor.id);
                    }
                  }}
                  onDblClick={e => {
                    // Available to both roles — this is the Operator's
                    // primary way to act on the map: jump straight to the
                    // sensor's full detail page instead of just viewing
                    // its dot on the layout.
                    e.cancelBubble = true;
                    const full = resolveFullChannel(sensor.channelKey);
                    if (!full) {
                      flashStatus('This sensor\u2019s source board is no longer connected.', true);
                      return;
                    }
                    onSelectSensor?.(full.device, full.module, full.port);
                  }}
                >
                  {isSelected && (
                    <Circle radius={26} fill="transparent"
                      stroke="#2563EB" strokeWidth={2} dash={[4, 2]} />
                  )}
                  <Circle radius={20} fill={sColor} opacity={0.15} />
                  <Circle radius={14} fill={sColor} />
                  <Text
                    text={ch.label.charAt(0).toUpperCase()}
                    fontSize={12} fontStyle="bold" fill="white"
                    offsetX={4} offsetY={6}
                  />
                  <Text
                    text={ch.label}
                    fontSize={11} fill="#374151"
                    offsetX={ch.label.length * 3} y={22}
                  />
                  {/* Live status dot — reflects the port's current status, not a stored one */}
                  <Circle
                    x={12} y={-12} radius={5}
                    fill={dotColor}
                    stroke="white" strokeWidth={1.5}
                  />
                  {isSelected && (
                    <Text
                      text={`${ch.moduleName} \u2022 ${ch.status}`}
                      fontSize={10} fill="#2563EB"
                      offsetX={(ch.moduleName.length + ch.status.length + 3) * 2.6}
                      y={-30}
                    />
                  )}
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
