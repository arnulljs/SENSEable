import { useState } from 'react';
import { devices, savedFormulas as initialFormulas, channelAssignments as initAssignments } from '../mockData';

// ── simple linear regression helper ──────────────────────────────────────────
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  const sumX  = points.reduce((s, p) => s + p.adc, 0);
  const sumY  = points.reduce((s, p) => s + p.unit, 0);
  const sumXY = points.reduce((s, p) => s + p.adc * p.unit, 0);
  const sumX2 = points.reduce((s, p) => s + p.adc * p.adc, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const yBar  = sumY / n;
  const ssTot = points.reduce((s, p) => s + Math.pow(p.unit - yBar, 2), 0);
  const ssRes = points.reduce((s, p) => s + Math.pow(p.unit - (slope * p.adc + intercept), 2), 0);
  const r2    = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

// ── preset formulas for Guided mode ──────────────────────────────────────────
const PRESETS = [
  { label: 'DO (Dissolved Oxygen)', formula: 'x * 0.0021 - 0.38' },
  { label: 'Temperature (NTC)',     formula: '(x * 0.003906) - 40.0' },
  { label: 'Salinity (EC probe)',   formula: 'x * 0.05182 + 0.0' },
  { label: 'pH (atlas scientific)', formula: 'x * (-0.001693) + 14.011' },
];

// ── icons ─────────────────────────────────────────────────────────────────────
const IconOverview = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" width={15} height={15}>
    <rect x="1" y="1" width="6" height="6" rx="1"/>
    <rect x="9" y="1" width="6" height="6" rx="1"/>
    <rect x="1" y="9" width="6" height="6" rx="1"/>
    <rect x="9" y="9" width="6" height="6" rx="1"/>
  </svg>
);
const IconMap = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
       strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <path d="M1 3.5l4.5-2 5 2 4.5-2V12.5l-4.5 2-5-2-4.5 2V3.5z"/>
    <line x1="5.5" y1="1.5" x2="5.5" y2="12"/>
    <line x1="10.5" y1="3.5" x2="10.5" y2="13.5"/>
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
export default function Calibration() {
  // ── Calibration Module state ──────────────────────────────────────────────
  const [ready, setReady]           = useState(false);
  const [serialPort, setSerialPort] = useState('');
  const [sensorCh, setSensorCh]     = useState('');
  const [calMode, setCalMode]       = useState('unguided');

  // Unguided state
  const [unitInput, setUnitInput]       = useState('');
  const [adcInput, setAdcInput]         = useState('');
  const [dataPoints, setDataPoints]     = useState([]);
  const [regression, setRegression]     = useState(null);
  const [formulaLabel, setFormulaLabel] = useState('');
  const [savedMsg, setSavedMsg]         = useState('');

  // Guided state
  const [guidedType, setGuidedType]     = useState('2-point');
  const [g1Known, setG1Known]           = useState('');
  const [g1Adc, setG1Adc]               = useState('');
  const [g2Low, setG2Low]               = useState('');
  const [g2LowAdc, setG2LowAdc]         = useState('');
  const [g2High, setG2High]             = useState('');
  const [g2HighAdc, setG2HighAdc]       = useState('');
  const [guidedPreset, setGuidedPreset] = useState(PRESETS[0].label);
  const [customExpr, setCustomExpr]     = useState('');
  const [guidedResult, setGuidedResult] = useState(null);
  const [guidedLabel, setGuidedLabel]   = useState('');

  // ── Manage Formulas state ─────────────────────────────────────────────────
  const [formulas, setFormulas]           = useState(initialFormulas);
  const [assignments, setAssignments]     = useState(initAssignments);
  // Every board reported by any ESP32 node starts expanded — computed from
  // `devices` rather than a hardcoded board id, so this stays correct
  // regardless of how many boards are actually connected.
  const [boardExpanded, setBoardExpanded] = useState(() =>
    devices.reduce((acc, d) => {
      d.modules.forEach(m => { acc[m.id] = true; });
      return acc;
    }, {})
  );

  // ── Helpers: Unguided ────────────────────────────────────────────────────
  function addDataPoint() {
    const u = parseFloat(unitInput), a = parseFloat(adcInput);
    if (isNaN(u) || isNaN(a)) return;
    setDataPoints(prev => [...prev, { unit: u, adc: a }]);
    setUnitInput(''); setAdcInput('');
    setRegression(null); setSavedMsg('');
  }

  function removeDataPoint(idx) {
    setDataPoints(prev => prev.filter((_, i) => i !== idx));
    setRegression(null); setSavedMsg('');
  }

  function simulateMeasure() {
    setAdcInput((Math.random() * 15000 + 5000).toFixed(0));
  }

  function runRegression() {
    if (dataPoints.length < 2) return;
    setRegression(linearRegression(dataPoints));
    setSavedMsg('');
  }

  function buildUnguidedFormula() {
    if (!regression) return '';
    const { slope, intercept } = regression;
    const op = intercept >= 0 ? '+' : '-';
    return `x * ${slope.toExponential(6)} ${op} ${Math.abs(intercept).toExponential(6)}`;
  }

  function saveUnguidedFormula() {
    if (!regression || !formulaLabel.trim()) return;
    const formula = buildUnguidedFormula();
    setFormulas(prev => {
      const idx = prev.findIndex(f => f.label === formulaLabel.trim());
      if (idx >= 0) {
        const copy = [...prev]; copy[idx] = { ...copy[idx], formula }; return copy;
      }
      return [...prev, { id: Date.now(), label: formulaLabel.trim(), formula }];
    });
    setSavedMsg(`"${formulaLabel.trim()}" saved successfully.`);
    setDataPoints([]); setRegression(null); setFormulaLabel('');
    setUnitInput(''); setAdcInput('');
  }

  // ── Helpers: Guided ──────────────────────────────────────────────────────
  function runGuided() {
    let result = null;
    if (guidedType === '1-point') {
      const known = parseFloat(g1Known), raw = parseFloat(g1Adc);
      if (!isNaN(known) && !isNaN(raw) && raw !== 0) {
        result = { formula: `x * ${(known / raw).toExponential(6)}` };
      }
    } else if (guidedType === '2-point') {
      const yLo = parseFloat(g2Low), xLo = parseFloat(g2LowAdc);
      const yHi = parseFloat(g2High), xHi = parseFloat(g2HighAdc);
      if ([yLo, xLo, yHi, xHi].every(v => !isNaN(v)) && xHi !== xLo) {
        const slope = (yHi - yLo) / (xHi - xLo);
        const intercept = yLo - slope * xLo;
        const op = intercept >= 0 ? '+' : '-';
        result = { formula: `x * ${slope.toExponential(6)} ${op} ${Math.abs(intercept).toExponential(6)}` };
      }
    } else if (guidedType === 'preset') {
      const found = PRESETS.find(p => p.label === guidedPreset);
      if (found) result = { formula: found.formula };
    } else if (guidedType === 'custom') {
      if (customExpr.trim()) result = { formula: customExpr.trim() };
    }
    setGuidedResult(result);
  }

  function saveGuidedFormula() {
    if (!guidedResult || !guidedLabel.trim()) return;
    setFormulas(prev => {
      const idx = prev.findIndex(f => f.label === guidedLabel.trim());
      if (idx >= 0) {
        const copy = [...prev]; copy[idx] = { ...copy[idx], formula: guidedResult.formula }; return copy;
      }
      return [...prev, { id: Date.now(), label: guidedLabel.trim(), formula: guidedResult.formula }];
    });
    setGuidedResult(null); setGuidedLabel('');
    setG1Known(''); setG1Adc('');
    setG2Low(''); setG2LowAdc(''); setG2High(''); setG2HighAdc('');
    setCustomExpr('');
  }

  // ── Helpers: Assignments ─────────────────────────────────────────────────
  // Assign (or clear) a formula from the bank directly onto a channel —
  // commits immediately, no separate edit/save step.
  function assignChannel(boardId, ch, label) {
    setAssignments(prev => ({
      ...prev,
      [boardId]: { ...(prev[boardId] || {}), [ch]: label || null },
    }));
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const allBoards = devices.flatMap(d => d.modules.map(m => ({ ...m, deviceName: d.name })));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Page header ── */}
      <div className="page-header">
        <h1 className="page-title">Calibration</h1>
        <div className="tabs">
          <button className="tab-btn"><IconOverview /> Overview</button>
          <button className="tab-btn"><IconMap /> Interactive Map</button>
        </div>
      </div>

      <div className="page-body">
        <div className="cal-layout">

          {/* ── LEFT: Calibration Module ──────────────────────────────── */}
          <div className="cal-card">
            {/* Card header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span className="cal-card-title" style={{ margin: 0 }}>Calibration Module</span>
              <button
                onClick={() => setReady(r => !r)}
                style={{
                  padding: '4px 11px', borderRadius: 4, border: 'none',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: ready ? '#DCFCE7' : '#F3F4F6',
                  color: ready ? '#15803D' : '#6B7280',
                }}
              >
                {ready ? '✓ Edit Ready' : '○ Not Ready'}
              </button>
            </div>

            {/* Detect rows */}
            <div className="detect-row">
              <div className="field">
                <label>Serial Port</label>
                <input className="input-field" placeholder="e.g. COM3 or /dev/ttyUSB0"
                  value={serialPort} onChange={e => setSerialPort(e.target.value)} />
              </div>
              <button className="detect-btn" onClick={() => setSerialPort('COM3')}>Detect</button>
            </div>
            <div className="detect-row">
              <div className="field">
                <label>Sensor Channel</label>
                <input className="input-field" placeholder="e.g. A0"
                  value={sensorCh} onChange={e => setSensorCh(e.target.value)} />
              </div>
              <button className="detect-btn" onClick={() => setSensorCh('A0')}>Detect</button>
            </div>

            {/* Mode tabs */}
            <div className="cal-tabs">
              <button className={`cal-tab${calMode === 'guided' ? ' active' : ''}`}
                onClick={() => { setCalMode('guided'); setRegression(null); setSavedMsg(''); }}>
                Guided Mode
              </button>
              <button className={`cal-tab${calMode === 'unguided' ? ' active' : ''}`}
                onClick={() => { setCalMode('unguided'); setGuidedResult(null); }}>
                Unguided Mode
              </button>
            </div>

            {/* ── UNGUIDED MODE ────────────────────────────────────────── */}
            {calMode === 'unguided' && (
              <>
                {/* Step 1 */}
                <div className="cal-step">
                  <div className="cal-step-title">Step 1: Data Collection</div>
                  <div className="cal-row">
                    <input className="input-field" placeholder="Unit value" type="number"
                      value={unitInput} onChange={e => setUnitInput(e.target.value)} />
                    <input className="input-field" placeholder="ADC raw" type="number"
                      value={adcInput} onChange={e => setAdcInput(e.target.value)} />
                    <button className="measure-btn" onClick={simulateMeasure}>Measure</button>
                    <button
                      onClick={() => { setUnitInput(''); setAdcInput(''); }}
                      title="Clear inputs"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>
                      ⊗
                    </button>
                  </div>

                  {dataPoints.length > 0 && (
                    <div className="data-points-list">
                      <div className="dp-header">
                        <span>Unit value</span><span>ADC count</span><span />
                      </div>
                      {dataPoints.map((pt, i) => (
                        <div className="dp-row" key={i}>
                          <span>{pt.unit}</span>
                          <span>{pt.adc}</span>
                          <button className="dp-del" onClick={() => removeDataPoint(i)}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={addDataPoint}
                    disabled={unitInput === '' || adcInput === ''}
                    style={{
                      width: '100%', padding: '8px', marginTop: 8,
                      background: 'none', border: '1px solid var(--blue)',
                      borderRadius: 'var(--radius-sm)', color: 'var(--blue)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      opacity: (unitInput === '' || adcInput === '') ? 0.4 : 1,
                    }}>
                    + Add Data Point
                  </button>
                </div>

                {/* Step 2 */}
                <div className="cal-step">
                  <div className="cal-step-title">Step 2: Generate Formula</div>
                  <button className="cal-primary-btn" onClick={runRegression}
                    disabled={dataPoints.length < 2}>
                    Start Calibration
                  </button>
                  {dataPoints.length < 2 && (
                    <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: -4, marginBottom: 0 }}>
                      Add at least 2 data points first.
                    </p>
                  )}
                </div>

                {/* Step 3 */}
                <div className="cal-step">
                  <div className="cal-step-title">Step 3: Verify and Save Formula</div>
                  <button className="cal-primary-btn" onClick={runRegression}
                    disabled={!regression}>
                    Start Calibration
                  </button>

                  <input className="input-field"
                    placeholder="e.g., pH Level, Dissolved Oxygen, Temperature"
                    value={formulaLabel} onChange={e => setFormulaLabel(e.target.value)}
                    style={{ marginBottom: 8 }} />

                  <div className="generated-formula">
                    {regression
                      ? buildUnguidedFormula()
                      : <span style={{ color: 'var(--text-3)', fontFamily: 'inherit', fontSize: 12.5 }}>Generated Formula:</span>}
                  </div>

                  <div className="accuracy-row">
                    Accuracy (R²):{' '}
                    {regression ? <strong>{(regression.r2 * 100).toFixed(2)}%</strong> : '—'}
                  </div>

                  <button className="cal-primary-btn" onClick={saveUnguidedFormula}
                    disabled={!regression || !formulaLabel.trim()}>
                    Save ADC Formula
                  </button>

                  {savedMsg && (
                    <p style={{ fontSize: 12, color: 'var(--green-text)', marginTop: 4 }}>✓ {savedMsg}</p>
                  )}
                </div>
              </>
            )}

            {/* ── GUIDED MODE ──────────────────────────────────────────── */}
            {calMode === 'guided' && (
              <>
                {/* Sub-type selector */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                  {[
                    { key: '1-point', label: '1-Point Cal.' },
                    { key: '2-point', label: '2-Point Cal.' },
                    { key: 'preset',  label: 'Preset Formula' },
                    { key: 'custom',  label: 'Custom Expr.' },
                  ].map(({ key, label }) => (
                    <button key={key}
                      onClick={() => { setGuidedType(key); setGuidedResult(null); }}
                      style={{
                        padding: '5px 11px', fontSize: 12, fontWeight: 500,
                        borderRadius: 4, border: '1px solid var(--border)',
                        background: guidedType === key ? 'var(--blue)' : 'var(--bg)',
                        color: guidedType === key ? '#fff' : 'var(--text-2)',
                        cursor: 'pointer',
                      }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* 1-Point */}
                {guidedType === '1-point' && (
                  <div className="cal-step">
                    <div className="cal-step-title">Step 1: Single Reference Point</div>
                    <div className="cal-row">
                      <input className="input-field" placeholder="Known unit value" type="number"
                        value={g1Known} onChange={e => setG1Known(e.target.value)} />
                      <input className="input-field" placeholder="Raw ADC count" type="number"
                        value={g1Adc} onChange={e => setG1Adc(e.target.value)} />
                      <button className="measure-btn"
                        onClick={() => setG1Adc((Math.random() * 15000 + 5000).toFixed(0))}>
                        Measure
                      </button>
                    </div>
                  </div>
                )}

                {/* 2-Point */}
                {guidedType === '2-point' && (
                  <div className="cal-step">
                    <div className="cal-step-title">Step 1: Low Reference Point</div>
                    <div className="cal-row">
                      <input className="input-field" placeholder="Known low value" type="number"
                        value={g2Low} onChange={e => setG2Low(e.target.value)} />
                      <input className="input-field" placeholder="Raw ADC (low)" type="number"
                        value={g2LowAdc} onChange={e => setG2LowAdc(e.target.value)} />
                      <button className="measure-btn"
                        onClick={() => setG2LowAdc((Math.random() * 6000 + 4000).toFixed(0))}>
                        Measure
                      </button>
                    </div>
                    <div className="cal-step-title" style={{ marginTop: 12 }}>Step 2: High Reference Point</div>
                    <div className="cal-row">
                      <input className="input-field" placeholder="Known high value" type="number"
                        value={g2High} onChange={e => setG2High(e.target.value)} />
                      <input className="input-field" placeholder="Raw ADC (high)" type="number"
                        value={g2HighAdc} onChange={e => setG2HighAdc(e.target.value)} />
                      <button className="measure-btn"
                        onClick={() => setG2HighAdc((Math.random() * 6000 + 12000).toFixed(0))}>
                        Measure
                      </button>
                    </div>
                  </div>
                )}

                {/* Preset */}
                {guidedType === 'preset' && (
                  <div className="cal-step">
                    <div className="cal-step-title">Select Preset Formula</div>
                    <select className="input-field" value={guidedPreset}
                      onChange={e => setGuidedPreset(e.target.value)}
                      style={{ marginBottom: 8 }}>
                      {PRESETS.map(p => <option key={p.label}>{p.label}</option>)}
                    </select>
                    <div className="generated-formula">
                      {PRESETS.find(p => p.label === guidedPreset)?.formula}
                    </div>
                  </div>
                )}

                {/* Custom */}
                {guidedType === 'custom' && (
                  <div className="cal-step">
                    <div className="cal-step-title">Enter Custom Expression</div>
                    <textarea className="input-field" rows={3}
                      placeholder={'e.g.  x * 0.0021 - 0.38\n(use \'x\' as the raw ADC input variable)'}
                      value={customExpr} onChange={e => setCustomExpr(e.target.value)}
                      style={{ resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                  </div>
                )}

                {/* Generate + Save */}
                <div className="cal-step">
                  <div className="cal-step-title">Generate &amp; Save Formula</div>
                  <button className="cal-primary-btn" onClick={runGuided}>
                    Generate Formula
                  </button>

                  {guidedResult && (
                    <>
                      <div className="generated-formula">{guidedResult.formula}</div>
                      <input className="input-field"
                        placeholder="Formula label (e.g., Temperature)"
                        value={guidedLabel} onChange={e => setGuidedLabel(e.target.value)}
                        style={{ marginBottom: 8 }} />
                      <button className="cal-primary-btn" onClick={saveGuidedFormula}
                        disabled={!guidedLabel.trim()}>
                        Save ADC Formula
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── RIGHT: Manage Formulas ────────────────────────────────── */}
          <div>
            {/* Channel Assignments card */}
            <div className="cal-card" style={{ marginBottom: 16 }}>
              <div className="manage-header">
                <span className="manage-title">Channel Assignments</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>from formula bank below</span>
              </div>

              {allBoards.map(board => (
                <div className="board-section" key={board.id}>
                  <div className="board-section-title">
                    <span>{board.name}</span>
                    <button
                      onClick={() => setBoardExpanded(p => ({ ...p, [board.id]: !p[board.id] }))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-2)' }}>
                      {boardExpanded[board.id] ? '▾' : '▸'}
                    </button>
                  </div>

                  {boardExpanded[board.id] && (
                    <>
                      {Object.entries(assignments[board.id] || {}).map(([ch, assigned]) => (
                        <div className="channel-row" key={ch}>
                          <span className="channel-id">Channel {ch}</span>
                          <select
                            className="input-field"
                            style={{ width: 150, padding: '3px 7px', fontSize: 12 }}
                            value={assigned ?? ''}
                            onChange={e => assignChannel(board.id, ch, e.target.value)}
                          >
                            <option value="">— Unassigned —</option>
                            {formulas.map(f => (
                              <option key={f.id} value={f.label}>{f.label}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Formulas table card */}
            <div className="cal-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Manage Formulas</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{formulas.length} saved</span>
              </div>

              {formulas.length === 0
                ? <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>No formulas saved yet.</p>
                : (
                  <table className="formula-table">
                    <thead>
                      <tr>
                        <th style={{ width: '32%' }}>Label</th>
                        <th>Formula</th>
                        <th style={{ width: 24 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {formulas.map(f => (
                        <tr key={f.id}>
                          <td className="formula-label-cell">{f.label}</td>
                          <td className="formula-code">{f.formula}</td>
                          <td>
                            <button className="dp-del" title="Delete"
                              onClick={() => {
                                setFormulas(prev => prev.filter(x => x.id !== f.id));
                                // Clear this formula from any channel it was assigned to,
                                // so no dropdown is left pointing at a deleted formula.
                                setAssignments(prev => {
                                  const next = {};
                                  Object.entries(prev).forEach(([boardId, chs]) => {
                                    next[boardId] = {};
                                    Object.entries(chs).forEach(([ch, label]) => {
                                      next[boardId][ch] = label === f.label ? null : label;
                                    });
                                  });
                                  return next;
                                });
                              }}>
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
