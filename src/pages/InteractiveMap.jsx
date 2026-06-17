// InteractiveMap.jsx — Konva-based canvas for sensor placement
import { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Rect, Circle, Text, Group } from 'react-konva';
import { mapSensors as initialSensors, sensorTypes } from '../mockData';

const STATUS_COLOR = { online: '#22C55E', warning: '#F59E0B', offline: '#EF4444' };

const IconSelect = () => (
  <svg viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 2l4 12 2.5-4.5L13 12l1.5-1.5-4.5-4.5L14 3.5 2 2z"/>
  </svg>
);
const IconDraw = () => (
  <svg viewBox="0 0 16 16" fill="currentColor">
    <path d="M13.5 1.5l1 1-10 10-2 1 1-2 10-10zm-1.5 0L3 10l-.5 2 2-.5L13.5 2.5 12 0z" stroke="currentColor" strokeWidth="0.5"/>
  </svg>
);

export default function InteractiveMap() {
  const containerRef = useRef(null);
  const [stageSize, setStageSize] = useState({ width: 600, height: 480 });
  const [sensors, setSensors] = useState(initialSensors);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTool, setActiveTool] = useState('select'); // 'select' | 'draw'
  const [pendingType, setPendingType] = useState(null);

  // Measure available canvas space
  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  function handleDragEnd(id, e) {
    setSensors(prev => prev.map(s => s.id === id ? { ...s, x: e.target.x(), y: e.target.y() } : s));
  }

  // Click on canvas while draw tool active → place a new sensor
  function handleStageClick(e) {
    if (activeTool !== 'draw' || !pendingType) return;
    // Only place on the background, not on existing sensors
    if (e.target !== e.target.getStage() && e.target.name() !== 'canvas-bg') return;
    const pos = e.target.getStage().getPointerPosition();
    const typeInfo = sensorTypes.find(t => t.type === pendingType);
    const newSensor = {
      id: `s${Date.now()}`,
      label: pendingType.replace(' ', '\n'),
      x: pos.x,
      y: pos.y,
      status: 'online',
      color: typeInfo?.color ?? '#6B7280',
    };
    setSensors(prev => [...prev, newSensor]);
  }

  return (
    <div className="map-layout">
      {/* Left panel */}
      <aside className="map-sidebar">
        {/* Tools */}
        <div className="map-sidebar-section">
          <div className="map-sidebar-section-title">Tools</div>
          <div className="map-tools">
            <button
              className={`map-tool-btn${activeTool === 'select' ? ' active' : ''}`}
              onClick={() => { setActiveTool('select'); setPendingType(null); }}
            >
              <IconSelect /> Select
            </button>
            <button
              className={`map-tool-btn${activeTool === 'draw' ? ' active' : ''}`}
              onClick={() => setActiveTool('draw')}
            >
              <IconDraw /> Draw
            </button>
          </div>
          {activeTool === 'draw' && (
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
              {pendingType
                ? `Click canvas to place "${pendingType}"`
                : 'Select a sensor type below, then click the canvas.'}
            </p>
          )}
        </div>

        {/* Sensor palette */}
        <div className="map-sidebar-section">
          <div className="map-sidebar-section-title">Sensors</div>
          <div className="sensor-palette">
            {sensorTypes.map(({ type, color }) => (
              <div
                key={type}
                className="palette-item"
                style={{ background: activeTool === 'draw' && pendingType === type ? 'var(--blue-muted)' : '' }}
                onClick={() => {
                  if (activeTool === 'draw') setPendingType(type);
                }}
              >
                <span className="palette-dot" style={{ background: color }} />
                {type}
              </div>
            ))}
          </div>
        </div>

        {/* Status legend */}
        <div className="map-sidebar-section">
          <div className="map-sidebar-section-title">Status</div>
          <div className="status-legend">
            {[['Online', '#22C55E'], ['Warning', '#F59E0B'], ['Offline', '#EF4444'], ['Waiting', '#9CA3AF']].map(
              ([label, color]) => (
                <div key={label} className="legend-item">
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
                  {label}
                </div>
              )
            )}
          </div>
        </div>
      </aside>

      {/* Konva canvas */}
      <div ref={containerRef} className="map-canvas-area">
        <Stage
          width={stageSize.width}
          height={stageSize.height}
          onClick={handleStageClick}
        >
          <Layer>
            {/* Canvas background */}
            <Rect
              name="canvas-bg"
              x={0} y={0}
              width={stageSize.width}
              height={stageSize.height}
              fill="#F0F3F8"
            />

            {/* Grid lines (blueprint feel) */}
            {Array.from({ length: Math.ceil(stageSize.width / 40) }, (_, i) => (
              <Rect key={`vg${i}`} x={i * 40} y={0} width={1} height={stageSize.height} fill="#E5E7EB" />
            ))}
            {Array.from({ length: Math.ceil(stageSize.height / 40) }, (_, i) => (
              <Rect key={`hg${i}`} x={0} y={i * 40} width={stageSize.width} height={1} fill="#E5E7EB" />
            ))}

            {/* Floor plan placeholder outline */}
            <Rect x={40} y={40} width={stageSize.width - 80} height={stageSize.height - 80}
              stroke="#CBD5E1" strokeWidth={1.5} dash={[8, 4]} fill="rgba(255,255,255,0.5)" cornerRadius={4} />

            {/* Placed sensors */}
            {sensors.map(sensor => {
              const sColor = sensor.color ?? STATUS_COLOR[sensor.status] ?? '#2563EB';
              const isSelected = selectedId === sensor.id;
              return (
                <Group
                  key={sensor.id}
                  x={sensor.x} y={sensor.y}
                  draggable={activeTool === 'select'}
                  onDragEnd={e => handleDragEnd(sensor.id, e)}
                  onClick={e => { e.cancelBubble = true; setSelectedId(sensor.id); }}
                >
                  {/* Selection ring */}
                  {isSelected && <Circle radius={26} fill="transparent" stroke="#2563EB" strokeWidth={2} dash={[4, 2]} />}

                  {/* Sensor circle */}
                  <Circle radius={20} fill={sColor} opacity={0.15} />
                  <Circle radius={14} fill={sColor} />

                  {/* Initial letter */}
                  <Text
                    text={sensor.label.charAt(0).toUpperCase()}
                    fontSize={12} fontStyle="bold" fill="white"
                    offsetX={4} offsetY={6}
                  />

                  {/* Label below */}
                  <Text
                    text={sensor.label}
                    fontSize={11} fill="#374151"
                    offsetX={sensor.label.length * 3}
                    y={22}
                  />

                  {/* Status dot */}
                  <Circle
                    x={12} y={-12}
                    radius={5}
                    fill={STATUS_COLOR[sensor.status] ?? '#9CA3AF'}
                    stroke="white" strokeWidth={1.5}
                  />

                  {/* Click-to-view tooltip (only when selected) */}
                  {isSelected && (
                    <Text
                      text="Click to View"
                      fontSize={10} fill="#2563EB"
                      offsetX={20} y={-30}
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
