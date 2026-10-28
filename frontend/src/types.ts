export interface VisualGeomMeta {
  geom_id: number;
  body_id: number;
  body_name: string;
  mesh_name: string;
  mesh_file: string;
  rgba: [number, number, number, number];
  local_pos: [number, number, number];
  local_quat: [number, number, number, number];
}

export interface Bounds3D {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

export interface ConfigResponse {
  task_id: string;
  device: string;
  onnx_model_path: string;
  checkpoint_path: string;
  yam_xml_path: string;
  onnx_io: {
    input_name: string;
    input_shape: number[];
    output_shape: number[];
    providers: string[];
    metadata: Record<string, string>;
  };
  robot: {
    name: string;
    base_pos: [number, number, number];
    joint_names: string[];
    actuator_names: string[];
    body_names: string[];
    site_names: string[];
    default_joint_pos: number[];
    joint_limits: [number, number][];
    visual_geoms: VisualGeomMeta[];
  };
  workspace: {
    cube_bounds: Bounds3D;
    trained_cube_bounds: Bounds3D;
    target_bounds: Bounds3D;
    trained_target_bounds: Bounds3D;
    cube_half_size: number;
    success_threshold: number;
    target_behavior_note: string;
  };
}

export interface Pose3D {
  pos: [number, number, number];
  quat: [number, number, number, number]; // MuJoCo wxyz
}

export interface SimulationState {
  timestamp: number;
  simulation: {
    status: 'idle' | 'running' | 'paused' | 'completed' | 'replaying';
    step_count: number;
    max_steps: number;
    sim_time: number;
    dt: number;
    physics_dt: number;
    decimation: number;
    reward: number;
    has_recording: boolean;
    recorded_frames: number;
    replay_index: number;
    ee_ground_contact_force: number;
  };
  cube: {
    pos: [number, number, number];
    quat: [number, number, number, number];
    lin_vel: [number, number, number];
    configured_pos: [number, number, number];
    size: [number, number, number];
  };
  target: {
    pos: [number, number, number];
    configured_pos: [number, number, number];
    position_error: number;
    success_threshold: number;
    at_goal: boolean;
    episode_success: boolean;
    in_trained_range: boolean;
  };
  end_effector: {
    pos: [number, number, number];
    quat: [number, number, number, number];
    distance_to_cube: number;
    gripper_opening: number;
  };
  joints: {
    names: string[];
    pos: number[];
    vel: number[];
  };
  policy: {
    obs: number[];
    action: number[];
    inference_ms: number;
  };
  geom_poses: Record<string, Pose3D>;
  body_poses: Record<string, Pose3D>;
}

export type InteractionMode = 'place_cube' | 'set_target' | 'orbit';
