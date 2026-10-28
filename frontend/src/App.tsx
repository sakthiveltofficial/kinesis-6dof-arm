import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Box,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Crosshair,
  Hand,
  HelpCircle,
  MousePointerClick,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Shuffle,
  Sliders,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { RobotScene } from './components/RobotScene';
import { ConfigResponse, InteractionMode, SimulationState } from './types';

const API_BASE = import.meta.env.VITE_API_BASE || '';

export const App: React.FC = () => {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [simState, setSimState] = useState<SimulationState | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Step 1: Click anywhere inside the glowing table zone to place the cube'
  );

  // Start in 'place_cube' mode so any new user can immediately click the 3D table!
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('place_cube');
  const [autoAdvanceStep, setAutoAdvanceStep] = useState<boolean>(true);
  const [hasPlacedCube, setHasPlacedCube] = useState<boolean>(false);
  const [hasSetTarget, setHasSetTarget] = useState<boolean>(false);

  // Secondary Collapsible Drawers (Sliders are secondary, 3D click is primary)
  const [showCubeSliders, setShowCubeSliders] = useState<boolean>(false);
  const [showTargetSliders, setShowTargetSliders] = useState<boolean>(false);
  const [showJointInspector, setShowJointInspector] = useState<boolean>(true);
  const [showGuideModal, setShowGuideModal] = useState<boolean>(false);

  const [cubeX, setCubeX] = useState<number>(0.3);
  const [cubeY, setCubeY] = useState<number>(-0.08);
  const [cubeZ, setCubeZ] = useState<number>(0.02);

  const [targetX, setTargetX] = useState<number>(0.38);
  const [targetY, setTargetY] = useState<number>(0.1);
  const [targetZ, setTargetZ] = useState<number>(0.26);

  const [showTrainedVolume, setShowTrainedVolume] = useState<boolean>(true);
  const [resetCameraTrigger, setResetCameraTrigger] = useState<number>(0);

  const wsRef = useRef<WebSocket | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ConfigResponse = await res.json();
      setConfig(data);
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner(`Backend connection error: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    fetchConfig();

    let reconnectTimer: number | null = null;
    let isUnmounted = false;

    const connectWs = () => {
      if (isUnmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl =
        import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}/ws/simulation`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmounted) return;
        setWsConnected(true);
        setErrorBanner(null);
        fetchConfig();
      };

      ws.onmessage = (event) => {
        if (isUnmounted) return;
        try {
          const data = JSON.parse(event.data);
          if (data && data.simulation) {
            setSimState(data as SimulationState);
          }
        } catch {
          // ignore malformed packet
        }
      };

      ws.onclose = () => {
        if (isUnmounted) return;
        setWsConnected(false);
        reconnectTimer = window.setTimeout(connectWs, 1500);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWs();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchConfig]);

  const postApi = async (endpoint: string, body?: object, successMsg?: string) => {
    try {
      setErrorBanner(null);
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || `Request failed (${res.status})`);
      }
      if (data.state) {
        setSimState(data.state);
      }
      if (successMsg || data.message) {
        setStatusMessage(successMsg || data.message);
      }
      return data;
    } catch (err: any) {
      setErrorBanner(err.message);
      return null;
    }
  };

  // Live Cube Placement (via 3D Click, Preset, or Secondary Slider)
  const handlePlaceCube = useCallback(
    async (x: number, y: number, z: number, from3DClick = false) => {
      setCubeX(x);
      setCubeY(y);
      setCubeZ(z);
      setHasPlacedCube(true);
      setSimState((prev) =>
        prev
          ? {
              ...prev,
              cube: { ...prev.cube, pos: [x, y, z], configured_pos: [x, y, z] },
            }
          : prev
      );
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'set_cube', x, y, z, yaw: 0.0 }));
      } else {
        await postApi('/api/object/position', { x, y, z, yaw: 0.0 });
      }

      if (from3DClick && autoAdvanceStep) {
        setInteractionMode('set_target');
        setStatusMessage(
          `Cube placed at (${x.toFixed(2)}, ${y.toFixed(2)})m — Now click in 3D space to set the Target Goal!`
        );
      } else {
        setStatusMessage(
          `Cube placed at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})m`
        );
      }
    },
    [autoAdvanceStep]
  );

  // Live Target Selection (via 3D Click, Preset, or Secondary Slider)
  const handleSetTarget = useCallback(
    async (x: number, y: number, z: number, from3DClick = false) => {
      setTargetX(x);
      setTargetY(y);
      setTargetZ(z);
      setHasSetTarget(true);
      setSimState((prev) =>
        prev
          ? {
              ...prev,
              target: { ...prev.target, pos: [x, y, z], configured_pos: [x, y, z] },
            }
          : prev
      );
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'set_target', x, y, z }));
      } else {
        await postApi('/api/target', { x, y, z });
      }

      if (from3DClick && autoAdvanceStep) {
        setInteractionMode('orbit');
        setStatusMessage(
          `Target locked at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})m — Ready! Click "Run Pick & Place" to launch.`
        );
      } else {
        setStatusMessage(
          `Target updated to (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})m`
        );
      }
    },
    [autoAdvanceStep]
  );

  const handleAdjustTargetZ = useCallback(
    (newZ: number) => {
      handleSetTarget(targetX, targetY, newZ, false);
    },
    [targetX, targetY, handleSetTarget]
  );

  const handleStartPickAndPlace = async () => {
    setInteractionMode('orbit');
    await postApi(
      '/api/simulation/start',
      { reset_to_configured: false, max_steps: 400 },
      'Executing trained ONNX policy in MuJoCo simulation...'
    );
  };

  const handlePause = async () => {
    await postApi('/api/simulation/pause', undefined, 'Simulation paused');
  };

  const handleResume = async () => {
    await postApi('/api/simulation/resume', undefined, 'Simulation resumed');
  };

  const handleResetEpisode = async (randomize = false) => {
    const data = await postApi(
      '/api/simulation/reset',
      { randomize },
      randomize
        ? 'Randomized cube & target within trained workspace'
        : 'Reset robot arm to home and restored cube & target positions'
    );
    if (data?.state) {
      const c = data.state.cube.configured_pos;
      const t = data.state.target.configured_pos;
      setCubeX(Number(c[0].toFixed(3)));
      setCubeY(Number(c[1].toFixed(3)));
      setCubeZ(Number(c[2].toFixed(3)));
      setTargetX(Number(t[0].toFixed(3)));
      setTargetY(Number(t[1].toFixed(3)));
      setTargetZ(Number(t[2].toFixed(3)));
    }
  };

  const handleReplayEpisode = async () => {
    setInteractionMode('orbit');
    await postApi(
      '/api/simulation/replay',
      undefined,
      'Replaying recorded episode through MuJoCo kinematics...'
    );
  };

  const handleResetCamera = () => {
    setResetCameraTrigger((prev) => prev + 1);
    setStatusMessage('Camera view reset');
  };

  const simStatus = simState?.simulation.status ?? 'idle';
  const isRunning = simStatus === 'running' || simStatus === 'replaying';
  const isPaused = simStatus === 'paused';
  const atGoal = simState?.target.at_goal ?? false;
  const episodeSuccess = simState?.target.episode_success ?? false;
  const inTrainedTargetRange = simState?.target.in_trained_range ?? true;

  return (
    <div className="ww-root">
      {/* Top Warmwind OS Navigation Header */}
      <header className="ww-header">
        <div className="ww-brand">
          <div className="ww-logo-mark">
            <Sparkles size={17} />
          </div>
          <div className="ww-brand-text">
            <div className="ww-title-row">
              <h1>YAM Robotics Lab</h1>
              <span className="ww-tag-pill">MJLab 1.6 &bull; ONNX Policy</span>
            </div>
            <p>
              Interactive 3D Robot Pick-and-Place Simulator &mdash; Place the cube, choose a 3D target, and watch the neural policy execute live.
            </p>
          </div>
        </div>

        <div className="ww-header-right">
          <div className={`ww-status-badge state-${simStatus}`}>
            <span className="ww-pulse-dot" />
            <span>{simStatus.toUpperCase()}</span>
          </div>

          <div className={`ww-goal-badge ${episodeSuccess ? 'is-success' : ''}`}>
            <CheckCircle2 size={14} />
            <span>{episodeSuccess ? 'Goal Reached' : atGoal ? 'At Target' : 'Ready'}</span>
          </div>

          <div className="ww-stat-chip">
            <span>Device</span>
            <strong>{config?.device || 'cuda:0'}</strong>
          </div>

          <div className={`ww-conn-chip ${wsConnected ? 'online' : 'offline'}`}>
            {wsConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span>{wsConnected ? '50Hz Live' : 'Reconnecting'}</span>
          </div>

          <button
            className="ww-help-btn"
            onClick={() => setShowGuideModal(!showGuideModal)}
            title="How to use YAM Robotics Lab"
          >
            <HelpCircle size={15} />
            <span>How it works</span>
          </button>
        </div>
      </header>

      {errorBanner && (
        <div className="ww-error-bar">
          <AlertTriangle size={15} />
          <span>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)}>Dismiss</button>
        </div>
      )}

      {/* Optional Quick Guide Popover */}
      {showGuideModal && (
        <div className="ww-guide-banner">
          <div className="ww-guide-steps">
            <div className="ww-guide-step">
              <span className="step-num">1</span>
              <div>
                <strong>Click Table to Place Cube</strong>
                <p>Select "1. Place Cube" on the top dock and click anywhere inside the highlighted table zone.</p>
              </div>
            </div>
            <div className="ww-guide-step">
              <span className="step-num">2</span>
              <div>
                <strong>Click Space to Set Target</strong>
                <p>Select "2. Set Target", use your scroll wheel or height pills to pick a Z height, and click in 3D space.</p>
              </div>
            </div>
            <div className="ww-guide-step">
              <span className="step-num">3</span>
              <div>
                <strong>Run AI Pick &amp; Place</strong>
                <p>Click "Run Pick &amp; Place" to watch the trained 29D-to-7D neural network grasp and lift the cube.</p>
              </div>
            </div>
          </div>
          <button className="ww-guide-close" onClick={() => setShowGuideModal(false)}>
            Got it
          </button>
        </div>
      )}

      {/* Main Spatial Workspace */}
      <main className="ww-workspace">
        {/* Left Sidebar: Guided 1-2-3 Workflow */}
        <aside className="ww-sidebar ww-sidebar-left">
          {/* Guided Workflow Card */}
          <div className="ww-card ww-workflow-card">
            <div className="ww-card-eyebrow">
              <MousePointerClick size={13} />
              <span>Interactive 3-Step Workflow</span>
            </div>

            {/* STEP 1: PLACE CUBE */}
            <div
              className={`ww-step-box ${
                interactionMode === 'place_cube' ? 'is-active-cube' : ''
              }`}
            >
              <div
                className="ww-step-header"
                onClick={() => setInteractionMode('place_cube')}
              >
                <div className="ww-step-badge badge-cube">1</div>
                <div className="ww-step-title-group">
                  <h3>Place Cube on Table</h3>
                  <p>Click directly on the 3D table surface</p>
                </div>
                <span className="ww-coord-pill">
                  {cubeX.toFixed(2)}, {cubeY.toFixed(2)}m
                </span>
              </div>

              <div className="ww-step-body">
                <button
                  className={`ww-spatial-btn ${
                    interactionMode === 'place_cube' ? 'active-amber' : ''
                  }`}
                  onClick={() =>
                    setInteractionMode(
                      interactionMode === 'place_cube' ? 'orbit' : 'place_cube'
                    )
                  }
                >
                  <Box size={14} />
                  <span>
                    {interactionMode === 'place_cube'
                      ? 'Clicking Table Active — Click in 3D View'
                      : 'Click in 3D Space to Place Cube'}
                  </span>
                </button>

                <div className="ww-quick-presets">
                  <span className="preset-label">Quick spots:</span>
                  <button onClick={() => handlePlaceCube(0.30, -0.08, 0.02)}>
                    Right
                  </button>
                  <button onClick={() => handlePlaceCube(0.32, 0.0, 0.02)}>
                    Center
                  </button>
                  <button onClick={() => handlePlaceCube(0.28, 0.10, 0.02)}>
                    Left
                  </button>
                </div>

                {/* Secondary Slider Drawer */}
                <button
                  className="ww-drawer-toggle"
                  onClick={() => setShowCubeSliders(!showCubeSliders)}
                >
                  <Sliders size={12} />
                  <span>Fine-tune XYZ with sliders (optional)</span>
                  {showCubeSliders ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>

                {showCubeSliders && (
                  <div className="ww-sliders-drawer">
                    <div className="ww-slider-row">
                      <label>X</label>
                      <input
                        type="range"
                        min={config?.workspace.cube_bounds.x[0] ?? 0.16}
                        max={config?.workspace.cube_bounds.x[1] ?? 0.46}
                        step={0.005}
                        value={cubeX}
                        onChange={(e) =>
                          handlePlaceCube(parseFloat(e.target.value), cubeY, cubeZ)
                        }
                      />
                      <span>{cubeX.toFixed(2)}m</span>
                    </div>
                    <div className="ww-slider-row">
                      <label>Y</label>
                      <input
                        type="range"
                        min={config?.workspace.cube_bounds.y[0] ?? -0.26}
                        max={config?.workspace.cube_bounds.y[1] ?? 0.26}
                        step={0.005}
                        value={cubeY}
                        onChange={(e) =>
                          handlePlaceCube(cubeX, parseFloat(e.target.value), cubeZ)
                        }
                      />
                      <span>{cubeY.toFixed(2)}m</span>
                    </div>
                    <div className="ww-slider-row">
                      <label>Z</label>
                      <input
                        type="range"
                        min={config?.workspace.cube_bounds.z[0] ?? 0.02}
                        max={config?.workspace.cube_bounds.z[1] ?? 0.08}
                        step={0.005}
                        value={cubeZ}
                        onChange={(e) =>
                          handlePlaceCube(cubeX, cubeY, parseFloat(e.target.value))
                        }
                      />
                      <span>{cubeZ.toFixed(2)}m</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* STEP 2: SET TARGET */}
            <div
              className={`ww-step-box ${
                interactionMode === 'set_target' ? 'is-active-target' : ''
              }`}
            >
              <div
                className="ww-step-header"
                onClick={() => setInteractionMode('set_target')}
              >
                <div className="ww-step-badge badge-target">2</div>
                <div className="ww-step-title-group">
                  <h3>Set 3D Target Goal</h3>
                  <p>Click in 3D space &amp; choose lift height</p>
                </div>
                <span className="ww-coord-pill">
                  {targetX.toFixed(2)}, {targetY.toFixed(2)}, {targetZ.toFixed(2)}m
                </span>
              </div>

              <div className="ww-step-body">
                <button
                  className={`ww-spatial-btn ${
                    interactionMode === 'set_target' ? 'active-sky' : ''
                  }`}
                  onClick={() =>
                    setInteractionMode(
                      interactionMode === 'set_target' ? 'orbit' : 'set_target'
                    )
                  }
                >
                  <Crosshair size={14} />
                  <span>
                    {interactionMode === 'set_target'
                      ? 'Clicking Target Active — Click in 3D View'
                      : 'Click in 3D Space to Set Target'}
                  </span>
                </button>

                {/* Quick Height Selector Pills */}
                <div className="ww-quick-presets">
                  <span className="preset-label">Lift Height:</span>
                  {[
                    { label: 'Low 10cm', z: 0.1 },
                    { label: 'Mid 24cm', z: 0.24 },
                    { label: 'High 30cm', z: 0.3 },
                    { label: 'Max 36cm', z: 0.36 },
                  ].map((h) => (
                    <button
                      key={h.label}
                      className={Math.abs(targetZ - h.z) < 0.02 ? 'active-chip' : ''}
                      onClick={() => handleSetTarget(targetX, targetY, h.z)}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>

                <div className="ww-quick-presets">
                  <span className="preset-label">Presets:</span>
                  <button onClick={() => handleSetTarget(0.38, 0.10, 0.26)}>
                    Lift Left
                  </button>
                  <button onClick={() => handleSetTarget(0.40, 0.0, 0.30)}>
                    Center High
                  </button>
                  <button onClick={() => handleSetTarget(0.42, -0.12, 0.28)}>
                    Lift Right
                  </button>
                </div>

                {/* Secondary Slider Drawer */}
                <button
                  className="ww-drawer-toggle"
                  onClick={() => setShowTargetSliders(!showTargetSliders)}
                >
                  <Sliders size={12} />
                  <span>Fine-tune Target XYZ with sliders (optional)</span>
                  {showTargetSliders ? (
                    <ChevronUp size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                </button>

                {showTargetSliders && (
                  <div className="ww-sliders-drawer">
                    <div className="ww-slider-row">
                      <label>X</label>
                      <input
                        type="range"
                        min={config?.workspace.target_bounds.x[0] ?? 0.16}
                        max={config?.workspace.target_bounds.x[1] ?? 0.52}
                        step={0.005}
                        value={targetX}
                        onChange={(e) =>
                          handleSetTarget(
                            parseFloat(e.target.value),
                            targetY,
                            targetZ
                          )
                        }
                      />
                      <span>{targetX.toFixed(2)}m</span>
                    </div>
                    <div className="ww-slider-row">
                      <label>Y</label>
                      <input
                        type="range"
                        min={config?.workspace.target_bounds.y[0] ?? -0.28}
                        max={config?.workspace.target_bounds.y[1] ?? 0.28}
                        step={0.005}
                        value={targetY}
                        onChange={(e) =>
                          handleSetTarget(
                            targetX,
                            parseFloat(e.target.value),
                            targetZ
                          )
                        }
                      />
                      <span>{targetY.toFixed(2)}m</span>
                    </div>
                    <div className="ww-slider-row">
                      <label>Z</label>
                      <input
                        type="range"
                        min={config?.workspace.target_bounds.z[0] ?? 0.02}
                        max={config?.workspace.target_bounds.z[1] ?? 0.45}
                        step={0.005}
                        value={targetZ}
                        onChange={(e) =>
                          handleSetTarget(
                            targetX,
                            targetY,
                            parseFloat(e.target.value)
                          )
                        }
                      />
                      <span>{targetZ.toFixed(2)}m</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* STEP 3: EXECUTE POLICY */}
            <div className="ww-step-box is-step-run">
              <div className="ww-step-header">
                <div className="ww-step-badge badge-run">3</div>
                <div className="ww-step-title-group">
                  <h3>Execute Neural Policy</h3>
                  <p>Run real-time ONNX inference in MuJoCo</p>
                </div>
              </div>

              <div className="ww-step-body">
                <button
                  className="ww-btn-hero"
                  onClick={handleStartPickAndPlace}
                  disabled={!wsConnected}
                >
                  <Play size={16} fill="currentColor" />
                  <span>Run Pick and Place</span>
                </button>

                <div className="ww-control-grid">
                  <button
                    className="ww-btn-ctrl"
                    onClick={handlePause}
                    disabled={!isRunning}
                  >
                    <Pause size={14} />
                    <span>Pause</span>
                  </button>
                  <button
                    className="ww-btn-ctrl"
                    onClick={handleResume}
                    disabled={!isPaused}
                  >
                    <Play size={14} />
                    <span>Resume</span>
                  </button>
                  <button
                    className="ww-btn-ctrl"
                    onClick={() => handleResetEpisode(false)}
                  >
                    <RotateCcw size={14} />
                    <span>Reset Episode</span>
                  </button>
                  <button className="ww-btn-ctrl" onClick={handleReplayEpisode}>
                    <RefreshCw size={14} />
                    <span>Replay Episode</span>
                  </button>
                  <button
                    className="ww-btn-ctrl"
                    onClick={() => handleResetEpisode(true)}
                  >
                    <Shuffle size={14} />
                    <span>Randomize</span>
                  </button>
                  <button className="ww-btn-ctrl" onClick={handleResetCamera}>
                    <Camera size={14} />
                    <span>Reset Camera</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Center 3D Spatial Canvas with Floating Warmwind Action Dock */}
        <section className="ww-stage">
          {/* Primary Floating Spatial Dock inside 3D Viewport */}
          <div className="ww-floating-dock-wrapper">
            <div className="ww-floating-dock">
              <button
                className={`ww-dock-btn ${
                  interactionMode === 'place_cube' ? 'active-cube' : ''
                }`}
                onClick={() => setInteractionMode('place_cube')}
              >
                <span className="dock-step">1</span>
                <Box size={14} />
                <span>Click to Place Cube</span>
              </button>

              <div className="ww-dock-divider" />

              <button
                className={`ww-dock-btn ${
                  interactionMode === 'set_target' ? 'active-target' : ''
                }`}
                onClick={() => setInteractionMode('set_target')}
              >
                <span className="dock-step">2</span>
                <Crosshair size={14} />
                <span>Click to Set Target</span>
              </button>

              <div className="ww-dock-divider" />

              <button
                className="ww-dock-btn dock-run-cta"
                onClick={handleStartPickAndPlace}
                disabled={!wsConnected}
              >
                <span className="dock-step">3</span>
                <Play size={13} fill="currentColor" />
                <span>Run Pick &amp; Place</span>
              </button>

              <div className="ww-dock-divider" />

              <button
                className={`ww-dock-btn ${
                  interactionMode === 'orbit' ? 'active-orbit' : ''
                }`}
                onClick={() => setInteractionMode('orbit')}
                title="Drag to rotate camera"
              >
                <Hand size={14} />
                <span>Orbit Camera</span>
              </button>
            </div>

            {/* Contextual Instruction Pill right below the dock */}
            <div className="ww-context-hint">
              {interactionMode === 'place_cube' && (
                <span>
                  <strong>Mode: Place Cube</strong> &mdash; Move your cursor over the 3D table and <strong>click anywhere inside the amber box</strong> to place the red cube.
                </span>
              )}
              {interactionMode === 'set_target' && (
                <div className="ww-target-context-bar">
                  <span>
                    <strong>Mode: Set 3D Target</strong> &mdash; Click on the workspace to place the goal. Scroll wheel or pick height:
                  </span>
                  <div className="ww-inline-heights">
                    {[0.1, 0.22, 0.28, 0.34].map((zVal) => (
                      <button
                        key={zVal}
                        className={Math.abs(targetZ - zVal) < 0.02 ? 'active' : ''}
                        onClick={() => handleSetTarget(targetX, targetY, zVal)}
                      >
                        {(zVal * 100).toFixed(0)}cm
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {interactionMode === 'orbit' && (
                <span>
                  <strong>Mode: Orbit Camera</strong> &mdash; Drag to rotate, scroll to zoom, or select <strong>1. Place Cube</strong> / <strong>2. Set Target</strong> above.
                </span>
              )}
            </div>
          </div>

          <RobotScene
            config={config}
            simState={simState}
            interactionMode={interactionMode}
            pendingCubeZ={cubeZ}
            pendingTargetZ={targetZ}
            resetCameraTrigger={resetCameraTrigger}
            showTrainedVolume={showTrainedVolume}
            onPlaceCubeClick={(x, y, z) => handlePlaceCube(x, y, z, true)}
            onSetTargetClick={(x, y, z) => handleSetTarget(x, y, z, true)}
            onAdjustTargetZ={handleAdjustTargetZ}
          />

          {/* Bottom Floating Stage Bar */}
          <div className="ww-stage-footer">
            <div className="ww-legend">
              <span>
                <i className="ww-dot dot-amber" /> Interactive Table Bounds
              </span>
              <span>
                <i className="ww-dot dot-emerald" /> Trained Cube Zone
              </span>
              <label className="ww-toggle-inline">
                <input
                  type="checkbox"
                  checked={showTrainedVolume}
                  onChange={(e) => setShowTrainedVolume(e.target.checked)}
                />
                <span>Show 3D Goal Envelope</span>
              </label>
              <label className="ww-toggle-inline">
                <input
                  type="checkbox"
                  checked={autoAdvanceStep}
                  onChange={(e) => setAutoAdvanceStep(e.target.checked)}
                />
                <span>Auto-advance Step 1 &rarr; 2</span>
              </label>
            </div>

            <div className="ww-live-toast">{statusMessage}</div>
          </div>
        </section>

        {/* Right Sidebar: Live Coordinates & Telemetry */}
        <aside className="ww-sidebar ww-sidebar-right">
          {/* Primary Telemetry Card */}
          <div className="ww-card">
            <div className="ww-card-eyebrow">
              <Activity size={13} />
              <span>Live Spatial Telemetry</span>
            </div>

            <div className="ww-metric-hero-row">
              <div className="ww-metric-tile">
                <span>Cube-to-Target Error</span>
                <strong className={atGoal ? 'text-emerald' : 'text-amber'}>
                  {((simState?.target.position_error ?? 0) * 100).toFixed(1)} cm
                </strong>
                <small>Success &lt; 5.0 cm</small>
              </div>
              <div className="ww-metric-tile">
                <span>Gripper-to-Cube</span>
                <strong className="text-sky">
                  {((simState?.end_effector.distance_to_cube ?? 0) * 100).toFixed(1)} cm
                </strong>
                <small>
                  Sim Time: {(simState?.simulation.sim_time ?? 0).toFixed(2)}s
                </small>
              </div>
            </div>

            <div className="ww-xyz-list">
              <div className="ww-xyz-item">
                <div className="ww-xyz-top">
                  <span className="ww-xyz-label">
                    <i className="ww-dot dot-red" /> Cube Position
                  </span>
                  <span className="ww-xyz-sub">MuJoCo Freejoint</span>
                </div>
                <div className="ww-xyz-vals">
                  <span>
                    <small>X</small> {(simState?.cube.pos[0] ?? 0).toFixed(3)}m
                  </span>
                  <span>
                    <small>Y</small> {(simState?.cube.pos[1] ?? 0).toFixed(3)}m
                  </span>
                  <span>
                    <small>Z</small> {(simState?.cube.pos[2] ?? 0).toFixed(3)}m
                  </span>
                </div>
              </div>

              <div className="ww-xyz-item">
                <div className="ww-xyz-top">
                  <span className="ww-xyz-label">
                    <i className="ww-dot dot-amber" /> Target Goal
                  </span>
                  <span
                    className={`ww-xyz-badge ${
                      inTrainedTargetRange ? 'ok' : 'warn'
                    }`}
                  >
                    {inTrainedTargetRange ? 'Trained Zone' : 'Extended Zone'}
                  </span>
                </div>
                <div className="ww-xyz-vals">
                  <span>
                    <small>X</small> {(simState?.target.pos[0] ?? 0).toFixed(3)}m
                  </span>
                  <span>
                    <small>Y</small> {(simState?.target.pos[1] ?? 0).toFixed(3)}m
                  </span>
                  <span>
                    <small>Z</small> {(simState?.target.pos[2] ?? 0).toFixed(3)}m
                  </span>
                </div>
              </div>

              <div className="ww-xyz-item">
                <div className="ww-xyz-top">
                  <span className="ww-xyz-label">
                    <i className="ww-dot dot-sky" /> End-Effector
                  </span>
                  <span className="ww-xyz-sub">
                    Gripper: {((simState?.end_effector.gripper_opening ?? 0) * 1000).toFixed(1)}mm
                  </span>
                </div>
                <div className="ww-xyz-vals">
                  <span>
                    <small>X</small>{' '}
                    {(simState?.end_effector.pos[0] ?? 0).toFixed(3)}m
                  </span>
                  <span>
                    <small>Y</small>{' '}
                    {(simState?.end_effector.pos[1] ?? 0).toFixed(3)}m
                  </span>
                  <span>
                    <small>Z</small>{' '}
                    {(simState?.end_effector.pos[2] ?? 0).toFixed(3)}m
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Collapsible Robot Joints & ONNX Inspector Card */}
          <div className="ww-card">
            <button
              className="ww-card-collapse-header"
              onClick={() => setShowJointInspector(!showJointInspector)}
            >
              <div className="ww-card-eyebrow" style={{ marginBottom: 0 }}>
                <Cpu size={13} />
                <span>Robot Joints (8 DOF) &amp; ONNX Policy</span>
              </div>
              {showJointInspector ? (
                <ChevronUp size={15} />
              ) : (
                <ChevronDown size={15} />
              )}
            </button>

            {showJointInspector && (
              <div className="ww-inspector-body">
                <div className="ww-joints-list">
                  {(simState?.joints.names ?? []).map((name, idx) => {
                    const pos = simState?.joints.pos[idx] ?? 0;
                    const limits = config?.robot.joint_limits[idx] ?? [-3.14, 3.14];
                    const span = Math.max(0.001, limits[1] - limits[0]);
                    const pct = Math.min(
                      100,
                      Math.max(0, ((pos - limits[0]) / span) * 100)
                    );

                    return (
                      <div key={name} className="ww-joint-row">
                        <div className="ww-joint-meta">
                          <span>{name}</span>
                          <strong>{pos.toFixed(3)}</strong>
                        </div>
                        <div className="ww-joint-track">
                          <div
                            className="ww-joint-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="ww-onnx-box">
                  <div className="ww-onnx-meta">
                    <span>ONNX (1&times;29 &rarr; 1&times;7)</span>
                    <span>
                      {(simState?.policy.inference_ms ?? 0).toFixed(2)} ms
                    </span>
                  </div>
                  <div className="ww-action-grid">
                    {(simState?.policy.action ?? []).map((act, i) => (
                      <div key={i} className="ww-act-cell">
                        <small>A{i + 1}</small>
                        <strong>{act.toFixed(2)}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ww-note">
                  <strong>Policy Behavior Note:</strong> Trained for 3D goal lifting (`Z: 20–40cm`) with `&lt;1cm` accuracy. For low table targets (`Z &lt; 15cm`), it grasps and carries the cube horizontally to `(X, Y)` while holding it in the gripper.
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
};

export default App;
