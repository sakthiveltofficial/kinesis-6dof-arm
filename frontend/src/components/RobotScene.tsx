import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent, useLoader, useThree } from '@react-three/fiber';
import { Grid, Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three-stdlib';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  ConfigResponse,
  InteractionMode,
  Pose3D,
  SimulationState,
  VisualGeomMeta,
} from '../types';

interface RobotMeshPartProps {
  meta: VisualGeomMeta;
  pose?: Pose3D;
}

const RobotMeshPart: React.FC<RobotMeshPartProps> = ({ meta, pose }) => {
  const geometry = useLoader(STLLoader, `/meshes/${meta.mesh_file}?v=compiled2`);

  useMemo(() => {
    geometry.computeVertexNormals();
  }, [geometry]);

  const position: [number, number, number] = pose
    ? [pose.pos[0], pose.pos[1], pose.pos[2]]
    : [0, 0, 0];

  // MuJoCo quaternion is [w, x, y, z]; Three.js Quaternion is [x, y, z, w]
  const quaternion: [number, number, number, number] = pose
    ? [pose.quat[1], pose.quat[2], pose.quat[3], pose.quat[0]]
    : [0, 0, 0, 1];

  const isLightMaterial = meta.rgba[0] > 0.5;
  const color = useMemo(
    () =>
      isLightMaterial
        ? new THREE.Color('#dfe3e8') // Brushed anodized silver-white
        : new THREE.Color('#272b33'), // Deep precision graphite
    [isLightMaterial]
  );

  return (
    <mesh
      geometry={geometry}
      position={position}
      quaternion={quaternion}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={color}
        metalness={isLightMaterial ? 0.25 : 0.4}
        roughness={isLightMaterial ? 0.35 : 0.42}
      />
    </mesh>
  );
};

interface CameraControllerProps {
  resetTrigger: number;
  enableRotate: boolean;
}

const DEFAULT_CAM_POS: [number, number, number] = [0.76, -0.66, 0.46];
const DEFAULT_CAM_TARGET: [number, number, number] = [0.28, 0.0, 0.14];

const CameraController: React.FC<CameraControllerProps> = ({
  resetTrigger,
  enableRotate,
}) => {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();

  useEffect(() => {
    camera.up.set(0, 0, 1);
    camera.position.set(...DEFAULT_CAM_POS);
    if (controlsRef.current) {
      controlsRef.current.target.set(...DEFAULT_CAM_TARGET);
      controlsRef.current.update();
    }
  }, [resetTrigger, camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={DEFAULT_CAM_TARGET}
      enableDamping
      dampingFactor={0.08}
      enableZoom={enableRotate}
      minDistance={0.25}
      maxDistance={2.4}
      maxPolarAngle={Math.PI * 0.49}
    />
  );
};

interface WorkspaceBoundsOverlayProps {
  config: ConfigResponse;
  showTrainedVolume: boolean;
  interactionMode: InteractionMode;
}

const WorkspaceBoundsOverlay: React.FC<WorkspaceBoundsOverlayProps> = ({
  config,
  showTrainedVolume,
  interactionMode,
}) => {
  const cb = config.workspace.cube_bounds;
  const tcb = config.workspace.trained_cube_bounds;
  const ttb = config.workspace.trained_target_bounds;

  // Outer interactive cube workspace rectangle on ground (z = 0.0015)
  const outerRectPoints: [number, number, number][] = [
    [cb.x[0], cb.y[0], 0.0015],
    [cb.x[1], cb.y[0], 0.0015],
    [cb.x[1], cb.y[1], 0.0015],
    [cb.x[0], cb.y[1], 0.0015],
    [cb.x[0], cb.y[0], 0.0015],
  ];

  // Inner trained cube placement zone on ground (z = 0.002)
  const trainedCubeRectPoints: [number, number, number][] = [
    [tcb.x[0], tcb.y[0], 0.002],
    [tcb.x[1], tcb.y[0], 0.002],
    [tcb.x[1], tcb.y[1], 0.002],
    [tcb.x[0], tcb.y[1], 0.002],
    [tcb.x[0], tcb.y[0], 0.002],
  ];

  const targetBoxCenter: [number, number, number] = [
    (ttb.x[0] + ttb.x[1]) / 2,
    (ttb.y[0] + ttb.y[1]) / 2,
    (ttb.z[0] + ttb.z[1]) / 2,
  ];
  const targetBoxSize: [number, number, number] = [
    ttb.x[1] - ttb.x[0],
    ttb.y[1] - ttb.y[0],
    ttb.z[1] - ttb.z[0],
  ];

  const isPlacing = interactionMode === 'place_cube';
  const isTargeting = interactionMode === 'set_target';

  return (
    <group>
      {/* Interactive Cube Placement Boundary */}
      <Line
        points={outerRectPoints}
        color={isPlacing ? '#d97706' : '#94a3b8'}
        lineWidth={isPlacing ? 2.6 : 1.5}
        transparent
        opacity={isPlacing ? 0.95 : 0.65}
      />

      {/* Trained Cube Spawn Region */}
      <Line
        points={trainedCubeRectPoints}
        color="#059669"
        lineWidth={1.8}
        dashed
        dashScale={45}
        dashSize={1}
        gapSize={0.7}
        transparent
        opacity={0.85}
      />

      {/* Subtle warm interactive pad fill on workspace */}
      <mesh
        position={[
          (cb.x[0] + cb.x[1]) / 2,
          (cb.y[0] + cb.y[1]) / 2,
          0.0008,
        ]}
      >
        <planeGeometry args={[cb.x[1] - cb.x[0], cb.y[1] - cb.y[0]]} />
        <meshBasicMaterial
          color={isPlacing ? '#f59e0b' : isTargeting ? '#0284c7' : '#64748b'}
          transparent
          opacity={isPlacing || isTargeting ? 0.1 : 0.03}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Trained 3D Target Lift Envelope Box */}
      {showTrainedVolume && (
        <group position={targetBoxCenter}>
          <mesh>
            <boxGeometry args={targetBoxSize} />
            <meshBasicMaterial
              color={isTargeting ? '#0284c7' : '#94a3b8'}
              wireframe
              transparent
              opacity={isTargeting ? 0.35 : 0.22}
            />
          </mesh>
        </group>
      )}
    </group>
  );
};

interface RobotSceneProps {
  config: ConfigResponse | null;
  simState: SimulationState | null;
  interactionMode: InteractionMode;
  pendingCubeZ: number;
  pendingTargetZ: number;
  resetCameraTrigger: number;
  showTrainedVolume: boolean;
  onPlaceCubeClick: (x: number, y: number, z: number) => void;
  onSetTargetClick: (x: number, y: number, z: number) => void;
  onAdjustTargetZ?: (newZ: number) => void;
}

export const RobotScene: React.FC<RobotSceneProps> = ({
  config,
  simState,
  interactionMode,
  pendingCubeZ,
  pendingTargetZ,
  resetCameraTrigger,
  showTrainedVolume,
  onPlaceCubeClick,
  onSetTargetClick,
  onAdjustTargetZ,
}) => {
  const [hoverPoint, setHoverPoint] = useState<[number, number] | null>(null);

  const clampToBounds = (
    x: number,
    y: number,
    bounds: { x: [number, number]; y: [number, number] }
  ): [number, number] => {
    const cx = Math.min(bounds.x[1], Math.max(bounds.x[0], x));
    const cy = Math.min(bounds.y[1], Math.max(bounds.y[0], y));
    return [cx, cy];
  };

  const handlePlanePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (interactionMode === 'orbit' || !config) {
      if (hoverPoint !== null) setHoverPoint(null);
      return;
    }
    const bounds =
      interactionMode === 'place_cube'
        ? config.workspace.cube_bounds
        : config.workspace.target_bounds;
    const [cx, cy] = clampToBounds(e.point.x, e.point.y, bounds);
    setHoverPoint([Number(cx.toFixed(3)), Number(cy.toFixed(3))]);
  };

  const handlePlaneWheel = (e: ThreeEvent<WheelEvent>) => {
    if (interactionMode === 'set_target' && onAdjustTargetZ && config) {
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.02 : -0.02;
      const [zMin, zMax] = config.workspace.target_bounds.z;
      const nextZ = Math.min(zMax, Math.max(zMin, Number((pendingTargetZ + delta).toFixed(2))));
      onAdjustTargetZ(nextZ);
    }
  };

  const handlePlaneClick = (e: ThreeEvent<MouseEvent>) => {
    if (interactionMode === 'orbit' || !config) return;
    if (e.delta > 6) return;
    e.stopPropagation();
    if (interactionMode === 'place_cube') {
      const [cx, cy] = clampToBounds(
        e.point.x,
        e.point.y,
        config.workspace.cube_bounds
      );
      onPlaceCubeClick(
        Number(cx.toFixed(3)),
        Number(cy.toFixed(3)),
        pendingCubeZ
      );
    } else if (interactionMode === 'set_target') {
      const [cx, cy] = clampToBounds(
        e.point.x,
        e.point.y,
        config.workspace.target_bounds
      );
      onSetTargetClick(
        Number(cx.toFixed(3)),
        Number(cy.toFixed(3)),
        pendingTargetZ
      );
    }
  };

  const cubePos: [number, number, number] = simState
    ? simState.cube.pos
    : [0.3, -0.08, 0.02];
  const cubeQuat: [number, number, number, number] = simState
    ? [
        simState.cube.quat[1],
        simState.cube.quat[2],
        simState.cube.quat[3],
        simState.cube.quat[0],
      ]
    : [0, 0, 0, 1];

  const targetPos: [number, number, number] = simState
    ? simState.target.pos
    : [0.38, 0.1, 0.26];
  const eePos: [number, number, number] = simState
    ? simState.end_effector.pos
    : [0.255, 0.0, 0.202];
  const atGoal = simState?.target.at_goal ?? false;

  return (
    <div
      className={`scene-canvas-wrapper mode-${interactionMode}`}
      style={{
        width: '100%',
        height: '100%',
        flex: 1,
        position: 'relative',
        cursor: interactionMode === 'orbit' ? 'grab' : 'crosshair',
      }}
    >
      <Canvas
        shadows
        camera={{ position: DEFAULT_CAM_POS, up: [0, 0, 1], fov: 38, near: 0.01, far: 20 }}
        gl={{ antialias: true }}
      >
        {/* Warmwind Clean Light Studio Background */}
        <color attach="background" args={['#efede8']} />
        <fog attach="fog" args={['#efede8', 2.2, 5.8]} />

        <CameraController
          resetTrigger={resetCameraTrigger}
          enableRotate={!(interactionMode === 'set_target' && hoverPoint !== null)}
        />

        {/* Bright Daylight Studio Lighting */}
        <ambientLight intensity={1.35} />
        <directionalLight
          position={[1.4, -1.2, 2.1]}
          intensity={1.65}
          color="#ffffff"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-near={0.1}
          shadow-camera-far={5}
          shadow-camera-left={-1}
          shadow-camera-right={1}
          shadow-camera-top={1}
          shadow-camera-bottom={-1}
        />
        <directionalLight position={[-1.2, 1.3, 1.2]} intensity={0.75} color="#f8fafc" />
        <pointLight position={[0.35, 0.0, 0.7]} intensity={0.45} color="#ffffff" />

        {/* Clean White/Alabaster Studio Table Surface */}
        <mesh
          position={[0, 0, -0.001]}
          receiveShadow
          onPointerMove={handlePlanePointerMove}
          onPointerOut={() => setHoverPoint(null)}
          onWheel={handlePlaneWheel}
          onClick={handlePlaneClick}
        >
          <planeGeometry args={[4.0, 4.0]} />
          <meshStandardMaterial color="#f7f6f2" roughness={0.9} metalness={0.02} />
        </mesh>

        {/* Subtle Architectural Grid */}
        <Grid
          position={[0, 0, 0.0005]}
          rotation={[Math.PI / 2, 0, 0]}
          args={[3.0, 3.0]}
          cellSize={0.05}
          cellThickness={0.5}
          cellColor="#e2e0d8"
          sectionSize={0.2}
          sectionThickness={1.0}
          sectionColor="#cbc8be"
          fadeDistance={2.2}
          fadeStrength={1.3}
        />

        {/* Workspace Boundaries */}
        {config && (
          <WorkspaceBoundsOverlay
            config={config}
            showTrainedVolume={showTrainedVolume}
            interactionMode={interactionMode}
          />
        )}

        {/* Actual YAM Robot Meshes Driven by MuJoCo World Geom Poses */}
        <Suspense fallback={null}>
          {config?.robot.visual_geoms.map((meta) => (
            <RobotMeshPart
              key={meta.geom_id}
              meta={meta}
              pose={simState?.geom_poses[String(meta.geom_id)]}
            />
          ))}
        </Suspense>

        {/* End-Effector Grasp Site Indicator */}
        <group position={eePos}>
          <mesh>
            <sphereGeometry args={[0.006, 16, 16]} />
            <meshBasicMaterial color="#0284c7" />
          </mesh>
        </group>

        {/* Subtle Line from End Effector to Cube */}
        <Line
          points={[eePos, cubePos]}
          color="#0284c7"
          lineWidth={1.2}
          dashed
          dashScale={50}
          dashSize={1}
          gapSize={1}
          transparent
          opacity={0.45}
        />

        {/* Line from Cube to Target Goal */}
        <Line
          points={[cubePos, targetPos]}
          color={atGoal ? '#059669' : '#d97706'}
          lineWidth={1.6}
          dashed
          dashScale={40}
          dashSize={1}
          gapSize={0.8}
          transparent
          opacity={0.7}
        />

        {/* Actual MuJoCo Cube (0.04m box) */}
        <group position={cubePos} quaternion={cubeQuat}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.04, 0.04, 0.04]} />
            <meshStandardMaterial
              color="#dc2626"
              roughness={0.25}
              metalness={0.1}
            />
          </mesh>
          <Html position={[0, 0, 0.036]} center style={{ pointerEvents: 'none' }}>
            <div className="scene-tag scene-tag-cube">
              Cube ({cubePos[0].toFixed(2)}, {cubePos[1].toFixed(2)}, {cubePos[2].toFixed(2)})
            </div>
          </Html>
        </group>

        {/* Target Marker & Success Threshold Sphere (radius = 0.05m) */}
        <group position={targetPos}>
          <mesh>
            <sphereGeometry args={[0.013, 24, 24]} />
            <meshStandardMaterial
              color={atGoal ? '#059669' : '#d97706'}
              emissive={atGoal ? '#059669' : '#d97706'}
              emissiveIntensity={0.5}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.05, 24, 24]} />
            <meshBasicMaterial
              color={atGoal ? '#059669' : '#d97706'}
              transparent
              opacity={0.2}
              wireframe
            />
          </mesh>
          <Html position={[0, 0, 0.065]} center style={{ pointerEvents: 'none' }}>
            <div className={`scene-tag ${atGoal ? 'scene-tag-goal' : 'scene-tag-target'}`}>
              {atGoal ? 'Goal Reached' : 'Target'} ({targetPos[0].toFixed(2)}, {targetPos[1].toFixed(2)}, {targetPos[2].toFixed(2)})
            </div>
          </Html>
        </group>

        {/* Target Vertical Projection Stem to Table Surface */}
        <Line
          points={[
            [targetPos[0], targetPos[1], 0.002],
            [targetPos[0], targetPos[1], targetPos[2]],
          ]}
          color={atGoal ? '#059669' : '#d97706'}
          lineWidth={1.5}
          transparent
          opacity={0.55}
        />
        <mesh position={[targetPos[0], targetPos[1], 0.002]}>
          <ringGeometry args={[0.016, 0.022, 32]} />
          <meshBasicMaterial
            color={atGoal ? '#059669' : '#d97706'}
            side={THREE.DoubleSide}
            transparent
            opacity={0.8}
          />
        </mesh>

        {/* Interactive 3D Ghost Preview for Place Cube */}
        {hoverPoint && interactionMode === 'place_cube' && (
          <group position={[hoverPoint[0], hoverPoint[1], pendingCubeZ]}>
            <mesh>
              <boxGeometry args={[0.042, 0.042, 0.042]} />
              <meshStandardMaterial
                color="#d97706"
                emissive="#f59e0b"
                emissiveIntensity={0.35}
                transparent
                opacity={0.65}
              />
            </mesh>
            <mesh position={[0, 0, -pendingCubeZ + 0.002]}>
              <ringGeometry args={[0.028, 0.035, 32]} />
              <meshBasicMaterial color="#d97706" side={THREE.DoubleSide} />
            </mesh>
            <Html position={[0, 0, 0.045]} center style={{ pointerEvents: 'none' }}>
              <div className="scene-tag scene-tag-cube">
                Click to Place Cube ({hoverPoint[0].toFixed(2)}, {hoverPoint[1].toFixed(2)})
              </div>
            </Html>
          </group>
        )}

        {/* Interactive 3D Ghost Preview for Set Target */}
        {hoverPoint && interactionMode === 'set_target' && (
          <group>
            <Line
              points={[
                [hoverPoint[0], hoverPoint[1], 0.002],
                [hoverPoint[0], hoverPoint[1], pendingTargetZ],
              ]}
              color="#0284c7"
              lineWidth={2}
            />
            <mesh position={[hoverPoint[0], hoverPoint[1], 0.002]}>
              <ringGeometry args={[0.02, 0.028, 32]} />
              <meshBasicMaterial color="#0284c7" side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[hoverPoint[0], hoverPoint[1], pendingTargetZ]}>
              <sphereGeometry args={[0.015, 24, 24]} />
              <meshStandardMaterial
                color="#0284c7"
                emissive="#0284c7"
                emissiveIntensity={0.5}
                transparent
                opacity={0.85}
              />
            </mesh>
            <mesh position={[hoverPoint[0], hoverPoint[1], pendingTargetZ]}>
              <sphereGeometry args={[0.05, 20, 20]} />
              <meshBasicMaterial color="#0284c7" transparent opacity={0.25} wireframe />
            </mesh>
            <Html
              position={[hoverPoint[0], hoverPoint[1], pendingTargetZ + 0.062]}
              center
              style={{ pointerEvents: 'none' }}
            >
              <div className="scene-tag scene-tag-target">
                Click to Set Target ({hoverPoint[0].toFixed(2)}, {hoverPoint[1].toFixed(2)}, H:{pendingTargetZ.toFixed(2)}m)
              </div>
            </Html>
          </group>
        )}
      </Canvas>
    </div>
  );
};
