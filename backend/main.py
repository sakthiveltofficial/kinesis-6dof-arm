"""YAM Robotics Lab — FastAPI + WebSocket Backend for WSL2 MJLab Simulation.

Connects the existing `Mjlab-Lift-Cube-Yam` task, MuJoCo-Warp physics simulation,
and trained RSL-RL ONNX policy (`2026-10-28_05-58-03.onnx`) to the Windows web UI.
"""

from __future__ import annotations

import asyncio
import math
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

import mujoco
import numpy as np
import onnx
import onnxruntime as ort
import torch
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import mjlab.tasks  # noqa: F401 - populates MJLab task registry
from mjviser.conversions import mujoco_mesh_to_trimesh
from mjlab.entity import Entity
from mjlab.envs import ManagerBasedRlEnv
from mjlab.rl import RslRlVecEnvWrapper
from mjlab.tasks.manipulation.mdp.commands import LiftingCommand
from mjlab.tasks.registry import load_env_cfg, load_rl_cfg
from mjlab.utils.lab_api.math import quat_from_euler_xyz, quat_from_matrix
from mjlab.utils.torch import configure_torch_backends

# ---------------------------------------------------------------------------
# Paths & Constants
# ---------------------------------------------------------------------------

MJLAB_ROOT = Path("/home/webnox/workspace/mjlab-linux")
ONNX_MODEL_PATH = (
    MJLAB_ROOT
    / "logs"
    / "rsl_rl"
    / "yam_lift_cube"
    / "2026-10-28_05-58-03"
    / "2026-10-28_05-58-03.onnx"
)
CHECKPOINT_PATH = (
    MJLAB_ROOT
    / "logs"
    / "rsl_rl"
    / "yam_lift_cube"
    / "2026-10-28_05-58-03"
    / "model_1999.pt"
)
YAM_XML_PATH = (
    MJLAB_ROOT / "src" / "mjlab" / "asset_zoo" / "robots" / "i2rt_yam" / "xmls" / "yam.xml"
)
YAM_MESHES_DIR = YAM_XML_PATH.parent / "assets"

TASK_ID = "Mjlab-Lift-Cube-Yam"

# Workspace bounds
CUBE_BOUNDS = {
    "x": (0.16, 0.46),
    "y": (-0.26, 0.26),
    "z": (0.02, 0.08),
}
TRAINED_CUBE_BOUNDS = {
    "x": (0.20, 0.40),
    "y": (-0.20, 0.20),
    "z": (0.02, 0.05),
}
TARGET_BOUNDS = {
    "x": (0.16, 0.52),
    "y": (-0.28, 0.28),
    "z": (0.02, 0.45),
}
TRAINED_TARGET_BOUNDS = {
    "x": (0.30, 0.50),
    "y": (-0.20, 0.20),
    "z": (0.20, 0.40),
}

DEFAULT_MAX_EPISODE_STEPS = 400  # 8.0 seconds at 50 Hz (step_dt = 0.02s)


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------


class CubePositionRequest(BaseModel):
    x: float = Field(..., description="Cube X coordinate in meters (world frame)")
    y: float = Field(..., description="Cube Y coordinate in meters (world frame)")
    z: float = Field(default=0.02, description="Cube Z coordinate in meters (world frame)")
    yaw: float = Field(default=0.0, description="Cube yaw orientation in radians")


class TargetPositionRequest(BaseModel):
    x: float = Field(..., description="Target X coordinate in meters (world frame)")
    y: float = Field(..., description="Target Y coordinate in meters (world frame)")
    z: float = Field(default=0.26, description="Target Z coordinate in meters (world frame)")


class ResetRequest(BaseModel):
    randomize: bool = Field(
        default=False,
        description="If True, sample random cube and target poses within trained bounds. "
        "If False, reset robot to home and restore configured cube & target poses.",
    )


class StartRequest(BaseModel):
    reset_to_configured: bool = Field(
        default=False,
        description="If True, reset robot to home and place cube at configured start pose before running.",
    )
    max_steps: int = Field(
        default=DEFAULT_MAX_EPISODE_STEPS,
        ge=20,
        le=2000,
        description="Maximum policy steps for this run.",
    )


# ---------------------------------------------------------------------------
# Simulation Controller
# ---------------------------------------------------------------------------


class YamSimulationController:
    """Thread/async-safe controller managing one MJLab environment and ONNX policy."""

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.clients: set[WebSocket] = set()
        self.loop_task: asyncio.Task | None = None
        self.shutdown_event = asyncio.Event()

        self.status: Literal["idle", "running", "paused", "completed", "replaying"] = "idle"
        self.step_count: int = 0
        self.max_steps: int = DEFAULT_MAX_EPISODE_STEPS
        self.last_reward: float = 0.0
        self.last_inference_ms: float = 0.0
        self.last_obs_list: list[float] = [0.0] * 29
        self.last_action_list: list[float] = [0.0] * 7

        # Configured cube and target positions (preserved across non-random resets)
        self.configured_cube_pos: list[float] = [0.30, -0.08, 0.02]
        self.configured_cube_yaw: float = 0.0
        self.configured_target_pos: list[float] = [0.38, 0.10, 0.26]

        # Episode recording for true MuJoCo replay
        self.recorded_episode: list[dict[str, Any]] = []
        self.replay_index: int = 0

        self.device: str = "cpu"
        self.env: ManagerBasedRlEnv | None = None
        self.vec_env: RslRlVecEnvWrapper | None = None
        self.ort_session: ort.InferenceSession | None = None
        self.ort_input_name: str = "obs"
        self.onnx_metadata: dict[str, str] = {}
        self.visual_geoms_meta: list[dict[str, Any]] = []
        self.visual_geom_ids: list[int] = []
        self.grasp_site_id: int = 1
        self.tcp_site_id: int = 0

    def initialize(self) -> None:
        """Load ONNX model and initialize the MJLab environment once."""
        if not ONNX_MODEL_PATH.exists():
            raise FileNotFoundError(f"ONNX model not found at {ONNX_MODEL_PATH}")

        # 1. Load ONNX metadata & create ONNX Runtime session
        onnx_proto = onnx.load(str(ONNX_MODEL_PATH))
        self.onnx_metadata = {p.key: p.value for p in onnx_proto.metadata_props}

        # Use CPUExecutionProvider for fast, deterministic 1x29 MLP inference (<0.1ms)
        available_providers = ort.get_available_providers()
        providers = ["CPUExecutionProvider"]
        self.ort_session = ort.InferenceSession(str(ONNX_MODEL_PATH), providers=providers)
        self.ort_input_name = self.ort_session.get_inputs()[0].name
        self.ort_input_shape = list(self.ort_session.get_inputs()[0].shape)
        self.ort_output_shape = list(self.ort_session.get_outputs()[0].shape)
        self.ort_providers = available_providers

        # 2. Initialize MJLab environment
        configure_torch_backends()
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"

        env_cfg = load_env_cfg(TASK_ID, play=True)
        env_cfg.scene.num_envs = 1
        # Prevent automatic command timer resampling from overwriting user target/cube
        env_cfg.commands["lift_height"].resampling_time_range = (1e9, 1e9)
        # Disable auto-termination resets during interactive runs so user state is never wiped unexpectedly
        env_cfg.terminations = {}

        self.env = ManagerBasedRlEnv(cfg=env_cfg, device=self.device)
        rl_cfg = load_rl_cfg(TASK_ID)
        self.vec_env = RslRlVecEnvWrapper(self.env, clip_actions=rl_cfg.clip_actions)

        # 3. Extract static visual geometry metadata & ensure compiled meshes are exported
        mj_model = self.env.sim.mj_model
        self.visual_geoms_meta = []
        self.visual_geom_ids = []
        frontend_meshes_dir = Path("/mnt/d/sakthivel workspace/Workspace/RnD/Robotics/frontend/public/meshes")
        frontend_meshes_dir.mkdir(parents=True, exist_ok=True)

        for gid in range(mj_model.ngeom):
            gtype = int(mj_model.geom_type[gid])
            ggroup = int(mj_model.geom_group[gid])
            dataid = int(mj_model.geom_dataid[gid])
            if ggroup == 2 and gtype == int(mujoco.mjtGeom.mjGEOM_MESH) and dataid >= 0:
                mesh_full_name = mujoco.mj_id2name(mj_model, mujoco.mjtObj.mjOBJ_MESH, dataid)
                short_mesh_name = mesh_full_name.split("/")[-1] if mesh_full_name else f"mesh_{dataid}"
                mesh_file = "d405.stl" if short_mesh_name == "camera_d405" else f"{short_mesh_name}.stl"
                # Export MuJoCo-compiled mesh (centered & aligned to geom_xpos/geom_xmat)
                out_stl = frontend_meshes_dir / mesh_file
                tmesh = mujoco_mesh_to_trimesh(mj_model, gid)
                tmesh.export(str(out_stl))
                body_id = int(mj_model.geom_bodyid[gid])
                body_name = mujoco.mj_id2name(mj_model, mujoco.mjtObj.mjOBJ_BODY, body_id) or f"body_{body_id}"
                mat_id = int(mj_model.geom_matid[gid])
                rgba = (
                    mj_model.mat_rgba[mat_id].tolist()
                    if mat_id >= 0
                    else mj_model.geom_rgba[gid].tolist()
                )
                self.visual_geom_ids.append(gid)
                self.visual_geoms_meta.append(
                    {
                        "geom_id": gid,
                        "body_id": body_id,
                        "body_name": body_name,
                        "mesh_name": short_mesh_name,
                        "mesh_file": mesh_file,
                        "rgba": [round(float(c), 4) for c in rgba],
                        "local_pos": [float(x) for x in mj_model.geom_pos[gid]],
                        "local_quat": [float(x) for x in mj_model.geom_quat[gid]],
                    }
                )

        # Find site IDs
        for sid in range(mj_model.nsite):
            sname = mujoco.mj_id2name(mj_model, mujoco.mjtObj.mjOBJ_SITE, sid) or ""
            if sname.endswith("grasp_site"):
                self.grasp_site_id = sid
            elif sname.endswith("tcp_site"):
                self.tcp_site_id = sid

        # 4. Initial reset and apply default user cube & target positions
        self._reset_sim_internal(randomize=False)

    # -----------------------------------------------------------------------
    # Internal Simulation Helpers (caller must hold self.lock)
    # -----------------------------------------------------------------------

    def _get_robot(self) -> Entity:
        assert self.env is not None
        return self.env.scene["robot"]

    def _get_cube(self) -> Entity:
        assert self.env is not None
        return self.env.scene["cube"]

    def _get_lift_cmd(self) -> LiftingCommand:
        assert self.env is not None
        cmd = self.env.command_manager.get_term("lift_height")
        assert isinstance(cmd, LiftingCommand)
        return cmd

    def _apply_cube_pose_internal(self, x: float, y: float, z: float, yaw: float = 0.0) -> None:
        assert self.env is not None
        cube = self._get_cube()
        pos = torch.tensor([[x, y, z]], dtype=torch.float32, device=self.device)
        quat = quat_from_euler_xyz(
            torch.zeros(1, device=self.device),
            torch.zeros(1, device=self.device),
            torch.tensor([yaw], dtype=torch.float32, device=self.device),
        )
        pose = torch.cat([pos, quat], dim=-1)
        zero_vel = torch.zeros(1, 6, dtype=torch.float32, device=self.device)
        cube.write_root_link_pose_to_sim(pose)
        cube.write_root_link_velocity_to_sim(zero_vel)

    def _apply_target_internal(self, x: float, y: float, z: float) -> None:
        cmd = self._get_lift_cmd()
        cmd.target_pos[:] = torch.tensor([[x, y, z]], dtype=torch.float32, device=self.device)
        cmd.episode_success[:] = 0.0

    def _refresh_sim_and_obs(self) -> np.ndarray:
        """Forward kinematics, sensors, command metrics, and actor observations."""
        assert self.env is not None
        self.env.scene.write_data_to_sim()
        self.env.sim.forward()
        cmd = self._get_lift_cmd()
        cmd._update_metrics()
        self.env.sim.sense()
        obs_dict = self.env.observation_manager.compute(update_history=True)
        actor_obs = obs_dict["actor"]
        obs_np = actor_obs.detach().cpu().numpy().astype(np.float32)
        self.last_obs_list = [round(float(v), 5) for v in obs_np[0]]
        return obs_np

    def _capture_mujc_snapshot(self) -> dict[str, Any]:
        """Capture full MuJoCo qpos, qvel, ctrl, and target for authentic replay."""
        assert self.env is not None
        cmd = self._get_lift_cmd()
        return {
            "qpos": self.env.sim.data.qpos[0].detach().cpu().clone(),
            "qvel": self.env.sim.data.qvel[0].detach().cpu().clone(),
            "ctrl": self.env.sim.data.ctrl[0].detach().cpu().clone(),
            "target_pos": cmd.target_pos[0].detach().cpu().clone(),
            "last_action": list(self.last_action_list),
            "reward": float(self.last_reward),
        }

    def _restore_mujc_snapshot(self, snap: dict[str, Any]) -> None:
        """Write a recorded snapshot directly into MuJoCo state and run forward()."""
        assert self.env is not None
        self.env.sim.data.qpos[0] = snap["qpos"].to(self.device)
        self.env.sim.data.qvel[0] = snap["qvel"].to(self.device)
        self.env.sim.data.ctrl[0] = snap["ctrl"].to(self.device)
        cmd = self._get_lift_cmd()
        cmd.target_pos[0] = snap["target_pos"].to(self.device)
        self.last_action_list = list(snap["last_action"])
        self.last_reward = float(snap["reward"])
        self.env.sim.forward()
        cmd._update_metrics()
        self.env.sim.sense()
        obs_dict = self.env.observation_manager.compute(update_history=False)
        obs_np = obs_dict["actor"].detach().cpu().numpy().astype(np.float32)
        self.last_obs_list = [round(float(v), 5) for v in obs_np[0]]

    def _reset_sim_internal(self, randomize: bool = False) -> None:
        assert self.vec_env is not None and self.env is not None
        self.vec_env.reset()
        self.step_count = 0
        self.last_reward = 0.0
        self.last_action_list = [0.0] * 7

        cmd = self._get_lift_cmd()
        cube = self._get_cube()

        if randomize:
            # Sample random cube & target from MJLab's LiftingCommand reset
            c_pos = cube.data.root_link_pos_w[0].detach().cpu().tolist()
            t_pos = cmd.target_pos[0].detach().cpu().tolist()
            self.configured_cube_pos = [round(float(c), 4) for c in c_pos]
            self.configured_target_pos = [round(float(t), 4) for t in t_pos]
        else:
            self._apply_cube_pose_internal(
                self.configured_cube_pos[0],
                self.configured_cube_pos[1],
                self.configured_cube_pos[2],
                self.configured_cube_yaw,
            )
            self._apply_target_internal(
                self.configured_target_pos[0],
                self.configured_target_pos[1],
                self.configured_target_pos[2],
            )

        self._refresh_sim_and_obs()
        self.status = "idle"

    def _step_policy_once(self) -> None:
        """Compute observation, run ONNX inference, and advance MJLab env by 1 step."""
        assert self.env is not None and self.vec_env is not None and self.ort_session is not None

        obs_dict = self.env.observation_manager.compute(update_history=False)
        obs_np = obs_dict["actor"].detach().cpu().numpy().astype(np.float32)

        t0 = time.perf_counter()
        actions_np = self.ort_session.run(None, {self.ort_input_name: obs_np})[0]
        self.last_inference_ms = (time.perf_counter() - t0) * 1000.0

        actions_tensor = torch.from_numpy(actions_np).to(self.device)
        obs_td, rew, dones, extras = self.vec_env.step(actions_tensor)

        self.step_count += 1
        self.last_reward = float(rew[0].item())
        self.last_action_list = [round(float(a), 5) for a in actions_np[0]]
        new_obs_np = obs_td["actor"].detach().cpu().numpy().astype(np.float32)
        self.last_obs_list = [round(float(v), 5) for v in new_obs_np[0]]

        # Record frame into episode buffer
        self.recorded_episode.append(self._capture_mujc_snapshot())

        if self.step_count >= self.max_steps:
            self.status = "completed"

    def get_state_dict(self) -> dict[str, Any]:
        """Construct JSON-serializable live simulation state."""
        assert self.env is not None
        robot = self._get_robot()
        cube = self._get_cube()
        cmd = self._get_lift_cmd()
        sim_data = self.env.sim.data

        # 1. Visual geom world poses (18 robot STL meshes)
        geom_xpos = sim_data.geom_xpos[0, self.visual_geom_ids]  # (18, 3)
        geom_xmat = sim_data.geom_xmat[0, self.visual_geom_ids]  # (18, 3, 3)
        geom_xquat = quat_from_matrix(geom_xmat)  # (18, 4) wxyz

        geom_poses: dict[str, dict[str, list[float]]] = {}
        for idx, gid in enumerate(self.visual_geom_ids):
            pos_list = [round(float(v), 5) for v in geom_xpos[idx].detach().cpu().tolist()]
            quat_list = [round(float(v), 5) for v in geom_xquat[idx].detach().cpu().tolist()]
            geom_poses[str(gid)] = {"pos": pos_list, "quat": quat_list}

        # 2. Robot body poses
        body_poses_t = robot.data.body_link_pose_w[0].detach().cpu().tolist()
        body_poses: dict[str, dict[str, list[float]]] = {}
        for b_idx, b_name in enumerate(robot.body_names):
            pose = body_poses_t[b_idx]
            body_poses[b_name] = {
                "pos": [round(float(v), 5) for v in pose[:3]],
                "quat": [round(float(v), 5) for v in pose[3:7]],
            }

        # 3. Cube state
        cube_pose = cube.data.root_link_pose_w[0].detach().cpu().tolist()
        cube_vel = cube.data.root_link_vel_w[0].detach().cpu().tolist()
        cube_pos = [round(float(v), 5) for v in cube_pose[:3]]
        cube_quat = [round(float(v), 5) for v in cube_pose[3:7]]

        # 4. End-effector (grasp_site) state
        ee_pos_t = sim_data.site_xpos[0, self.grasp_site_id].detach().cpu().tolist()
        ee_mat_t = sim_data.site_xmat[0, self.grasp_site_id : self.grasp_site_id + 1]
        ee_quat_t = quat_from_matrix(ee_mat_t)[0].detach().cpu().tolist()
        ee_pos = [round(float(v), 5) for v in ee_pos_t]
        ee_quat = [round(float(v), 5) for v in ee_quat_t]

        ee_to_cube_dist = float(
            math.sqrt(sum((cube_pos[i] - ee_pos[i]) ** 2 for i in range(3)))
        )

        # 5. Target & Command metrics
        target_pos_t = cmd.target_pos[0].detach().cpu().tolist()
        target_pos = [round(float(v), 5) for v in target_pos_t]
        pos_error = float(cmd.metrics["position_error"][0].item())
        at_goal = bool(cmd.metrics["at_goal"][0].item() > 0.5)
        episode_success = bool(cmd.metrics["episode_success"][0].item() > 0.5)

        in_trained_target_range = (
            TRAINED_TARGET_BOUNDS["x"][0] <= target_pos[0] <= TRAINED_TARGET_BOUNDS["x"][1]
            and TRAINED_TARGET_BOUNDS["y"][0] <= target_pos[1] <= TRAINED_TARGET_BOUNDS["y"][1]
            and TRAINED_TARGET_BOUNDS["z"][0] <= target_pos[2] <= TRAINED_TARGET_BOUNDS["z"][1]
        )

        # 6. Joint state
        joint_pos = [round(float(v), 5) for v in robot.data.joint_pos[0].detach().cpu().tolist()]
        joint_vel = [round(float(v), 5) for v in robot.data.joint_vel[0].detach().cpu().tolist()]
        # Gripper opening is left_finger - right_finger (m)
        gripper_opening = float(joint_pos[6] - joint_pos[7]) if len(joint_pos) >= 8 else 0.0

        # 7. Ground contact sensor force
        ee_ground_force = 0.0
        if "ee_ground_collision" in self.env.scene.sensors:
            sensor = self.env.scene.sensors["ee_ground_collision"]
            if sensor.data.force is not None:
                ee_ground_force = float(torch.norm(sensor.data.force[0]).item())

        return {
            "timestamp": time.time(),
            "simulation": {
                "status": self.status,
                "step_count": self.step_count,
                "max_steps": self.max_steps,
                "sim_time": round(self.step_count * self.env.step_dt, 3),
                "dt": self.env.step_dt,
                "physics_dt": self.env.physics_dt,
                "decimation": self.env.cfg.decimation,
                "reward": round(self.last_reward, 5),
                "has_recording": len(self.recorded_episode) > 0,
                "recorded_frames": len(self.recorded_episode),
                "replay_index": self.replay_index if self.status == "replaying" else 0,
                "ee_ground_contact_force": round(ee_ground_force, 3),
            },
            "cube": {
                "pos": cube_pos,
                "quat": cube_quat,
                "lin_vel": [round(float(v), 4) for v in cube_vel[:3]],
                "configured_pos": self.configured_cube_pos,
                "size": [0.02, 0.02, 0.02],
            },
            "target": {
                "pos": target_pos,
                "configured_pos": self.configured_target_pos,
                "position_error": round(pos_error, 4),
                "success_threshold": cmd.cfg.success_threshold,
                "at_goal": at_goal,
                "episode_success": episode_success,
                "in_trained_range": in_trained_target_range,
            },
            "end_effector": {
                "pos": ee_pos,
                "quat": ee_quat,
                "distance_to_cube": round(ee_to_cube_dist, 4),
                "gripper_opening": round(gripper_opening, 4),
            },
            "joints": {
                "names": list(robot.joint_names),
                "pos": joint_pos,
                "vel": joint_vel,
            },
            "policy": {
                "obs": self.last_obs_list,
                "action": self.last_action_list,
                "inference_ms": round(self.last_inference_ms, 3),
            },
            "geom_poses": geom_poses,
            "body_poses": body_poses,
        }

    def get_config_dict(self) -> dict[str, Any]:
        """Return static robot, task, workspace, and ONNX configuration."""
        assert self.env is not None
        robot = self._get_robot()
        default_jpos = [
            round(float(v), 4) for v in robot.data.default_joint_pos[0].detach().cpu().tolist()
        ]
        jlimits = [
            [round(float(lim[0]), 4), round(float(lim[1]), 4)]
            for lim in robot.data.joint_pos_limits[0].detach().cpu().tolist()
        ]
        return {
            "task_id": TASK_ID,
            "device": self.device,
            "onnx_model_path": str(ONNX_MODEL_PATH),
            "checkpoint_path": str(CHECKPOINT_PATH),
            "yam_xml_path": str(YAM_XML_PATH),
            "onnx_io": {
                "input_name": self.ort_input_name,
                "input_shape": self.ort_input_shape,
                "output_shape": self.ort_output_shape,
                "providers": self.ort_providers,
                "metadata": self.onnx_metadata,
            },
            "robot": {
                "name": "i2rt_yam",
                "base_pos": [0.0, 0.0, 0.01],
                "joint_names": list(robot.joint_names),
                "actuator_names": list(robot.actuator_names),
                "body_names": list(robot.body_names),
                "site_names": list(robot.site_names),
                "default_joint_pos": default_jpos,
                "joint_limits": jlimits,
                "visual_geoms": self.visual_geoms_meta,
            },
            "workspace": {
                "cube_bounds": CUBE_BOUNDS,
                "trained_cube_bounds": TRAINED_CUBE_BOUNDS,
                "target_bounds": TARGET_BOUNDS,
                "trained_target_bounds": TRAINED_TARGET_BOUNDS,
                "cube_half_size": 0.02,
                "success_threshold": 0.05,
                "target_behavior_note": (
                    "Mjlab-Lift-Cube-Yam was trained with dynamic 3D goal targets in "
                    "X=[0.30, 0.50]m, Y=[-0.20, 0.20]m, Z=[0.20, 0.40]m. Within this "
                    "trained lift envelope, the policy grasps the cube and holds it at "
                    "the 3D target with <1cm error. For low-Z targets near the table "
                    "(Z < 0.15m), the policy still picks and carries the cube to the "
                    "target (X, Y) coordinates, holding it in the gripper ~8cm above the surface."
                ),
            },
        }

    async def broadcast_state(self) -> None:
        if not self.clients:
            return
        state = self.get_state_dict()
        dead_clients: list[WebSocket] = []
        for ws in list(self.clients):
            try:
                await ws.send_json(state)
            except Exception:
                dead_clients.append(ws)
        for ws in dead_clients:
            self.clients.discard(ws)

    async def simulation_loop(self) -> None:
        """Background loop that steps the environment when running or replaying."""
        while not self.shutdown_event.is_set():
            t_start = time.perf_counter()
            should_broadcast = False

            async with self.lock:
                if self.status == "running":
                    self._step_policy_once()
                    should_broadcast = True
                elif self.status == "replaying":
                    if self.replay_index < len(self.recorded_episode):
                        snap = self.recorded_episode[self.replay_index]
                        self._restore_mujc_snapshot(snap)
                        self.step_count = self.replay_index + 1
                        self.replay_index += 1
                        should_broadcast = True
                    else:
                        self.status = "completed"
                        should_broadcast = True

            if should_broadcast:
                await self.broadcast_state()

            elapsed = time.perf_counter() - t_start
            # Step at 50 Hz (0.02s) when active, or idle sleep at 20 Hz
            target_dt = 0.02 if should_broadcast else 0.05
            sleep_time = max(0.002, target_dt - elapsed)
            await asyncio.sleep(sleep_time)


controller = YamSimulationController()


# ---------------------------------------------------------------------------
# FastAPI Lifespan & App Setup
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[YAM Backend] Initializing MJLab environment and ONNX policy...")
    controller.initialize()
    controller.loop_task = asyncio.create_task(controller.simulation_loop())
    print("[YAM Backend] Ready on http://127.0.0.1:8005")
    yield
    controller.shutdown_event.set()
    if controller.loop_task:
        await controller.loop_task
    if controller.vec_env:
        controller.vec_env.close()


app = FastAPI(
    title="YAM Robotics Lab Backend",
    version="1.0.0",
    description="Real-time MuJoCo + MJLab + ONNX Policy Simulation API for YAM Robot",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve original STL meshes directly from the WSL MJLab asset zoo as well
if YAM_MESHES_DIR.exists():
    app.mount("/meshes", StaticFiles(directory=str(YAM_MESHES_DIR)), name="meshes")


# ---------------------------------------------------------------------------
# Coordinate Validation Helpers
# ---------------------------------------------------------------------------


def validate_bounds(
    x: float, y: float, z: float, bounds: dict[str, tuple[float, float]], label: str
) -> None:
    for axis, val in (("x", x), ("y", y), ("z", z)):
        lo, hi = bounds[axis]
        if not (lo <= val <= hi):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid {label} {axis.upper()}={val:.3f}m. "
                    f"Must be within [{lo:.2f}, {hi:.2f}]m."
                ),
            )


# ---------------------------------------------------------------------------
# REST API Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def get_health() -> dict[str, Any]:
    return {
        "status": "ok",
        "task_id": TASK_ID,
        "device": controller.device,
        "onnx_loaded": controller.ort_session is not None,
        "onnx_path": str(ONNX_MODEL_PATH),
        "obs_shape": controller.ort_input_shape,
        "action_shape": controller.ort_output_shape,
        "sim_status": controller.status,
    }


@app.get("/api/config")
async def get_config() -> dict[str, Any]:
    async with controller.lock:
        return controller.get_config_dict()


@app.get("/api/state")
async def get_state() -> dict[str, Any]:
    async with controller.lock:
        return controller.get_state_dict()


@app.post("/api/simulation/reset")
async def reset_simulation(req: ResetRequest = ResetRequest()) -> dict[str, Any]:
    async with controller.lock:
        controller._reset_sim_internal(randomize=req.randomize)
        state = controller.get_state_dict()
    await controller.broadcast_state()
    return {"status": "ok", "message": "Simulation reset", "state": state}


@app.post("/api/object/position")
async def set_object_position(req: CubePositionRequest) -> dict[str, Any]:
    validate_bounds(req.x, req.y, req.z, CUBE_BOUNDS, "cube")
    async with controller.lock:
        controller.configured_cube_pos = [
            round(float(req.x), 4),
            round(float(req.y), 4),
            round(float(req.z), 4),
        ]
        controller.configured_cube_yaw = float(req.yaw)
        controller._apply_cube_pose_internal(req.x, req.y, req.z, req.yaw)
        # Reset episode success when cube is moved
        controller._get_lift_cmd().episode_success[:] = 0.0
        controller._refresh_sim_and_obs()
        state = controller.get_state_dict()
    await controller.broadcast_state()
    return {"status": "ok", "cube_pos": controller.configured_cube_pos, "state": state}


@app.post("/api/target")
async def set_target_position(req: TargetPositionRequest) -> dict[str, Any]:
    validate_bounds(req.x, req.y, req.z, TARGET_BOUNDS, "target")
    async with controller.lock:
        controller.configured_target_pos = [
            round(float(req.x), 4),
            round(float(req.y), 4),
            round(float(req.z), 4),
        ]
        controller._apply_target_internal(req.x, req.y, req.z)
        controller._refresh_sim_and_obs()
        state = controller.get_state_dict()
    await controller.broadcast_state()
    return {
        "status": "ok",
        "target_pos": controller.configured_target_pos,
        "in_trained_range": state["target"]["in_trained_range"],
        "state": state,
    }


@app.post("/api/simulation/start")
async def start_simulation(req: StartRequest = StartRequest()) -> dict[str, Any]:
    async with controller.lock:
        if req.reset_to_configured or controller.status in ("completed", "replaying"):
            controller._reset_sim_internal(randomize=False)
        controller.max_steps = req.max_steps
        controller.step_count = 0
        controller.recorded_episode = [controller._capture_mujc_snapshot()]
        controller.status = "running"
        state = controller.get_state_dict()
    await controller.broadcast_state()
    return {"status": "ok", "message": "Pick and place started", "state": state}


@app.post("/api/simulation/pause")
async def pause_simulation() -> dict[str, Any]:
    async with controller.lock:
        if controller.status in ("running", "replaying"):
            controller.status = "paused"
        state = controller.get_state_dict()
    await controller.broadcast_state()
    return {"status": "ok", "message": "Simulation paused", "state": state}


@app.post("/api/simulation/resume")
async def resume_simulation() -> dict[str, Any]:
    async with controller.lock:
        if controller.status == "paused":
            if 0 < controller.replay_index < len(controller.recorded_episode):
                controller.status = "replaying"
            else:
                controller.status = "running"
        state = controller.get_state_dict()
    await controller.broadcast_state()
    return {"status": "ok", "message": "Simulation resumed", "state": state}


@app.post("/api/simulation/stop")
async def stop_simulation() -> dict[str, Any]:
    async with controller.lock:
        controller.status = "idle"
        controller.replay_index = 0
        state = controller.get_state_dict()
    await controller.broadcast_state()
    return {"status": "ok", "message": "Simulation stopped", "state": state}


@app.post("/api/simulation/replay")
async def replay_simulation() -> dict[str, Any]:
    async with controller.lock:
        if not controller.recorded_episode:
            # If no episode was recorded yet, start a fresh recorded run from configured state
            controller._reset_sim_internal(randomize=False)
            controller.recorded_episode = [controller._capture_mujc_snapshot()]
            controller.status = "running"
            msg = "No prior recording found; started new episode run"
        else:
            controller.replay_index = 0
            controller._restore_mujc_snapshot(controller.recorded_episode[0])
            controller.step_count = 0
            controller.status = "replaying"
            msg = f"Replaying {len(controller.recorded_episode)} recorded MuJoCo frames"
        state = controller.get_state_dict()
    await controller.broadcast_state()
    return {"status": "ok", "message": msg, "state": state}


# ---------------------------------------------------------------------------
# WebSocket Endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws/simulation")
async def websocket_simulation(websocket: WebSocket) -> None:
    await websocket.accept()
    controller.clients.add(websocket)
    try:
        # Immediately send current simulation state upon connection
        async with controller.lock:
            initial_state = controller.get_state_dict()
        await websocket.send_json(initial_state)

        while True:
            data = await websocket.receive_json()
            cmd_type = data.get("type")
            if cmd_type == "ping":
                await websocket.send_json({"type": "pong", "timestamp": time.time()})
            elif cmd_type == "get_state":
                async with controller.lock:
                    state = controller.get_state_dict()
                await websocket.send_json(state)
            elif cmd_type == "set_cube":
                x = float(data.get("x", controller.configured_cube_pos[0]))
                y = float(data.get("y", controller.configured_cube_pos[1]))
                z = float(data.get("z", controller.configured_cube_pos[2]))
                yaw = float(data.get("yaw", controller.configured_cube_yaw))
                x = max(CUBE_BOUNDS["x"][0], min(CUBE_BOUNDS["x"][1], x))
                y = max(CUBE_BOUNDS["y"][0], min(CUBE_BOUNDS["y"][1], y))
                z = max(CUBE_BOUNDS["z"][0], min(CUBE_BOUNDS["z"][1], z))
                async with controller.lock:
                    controller.configured_cube_pos = [round(x, 4), round(y, 4), round(z, 4)]
                    controller.configured_cube_yaw = yaw
                    controller._apply_cube_pose_internal(x, y, z, yaw)
                    controller._get_lift_cmd().episode_success[:] = 0.0
                    controller._refresh_sim_and_obs()
                await controller.broadcast_state()
            elif cmd_type == "set_target":
                x = float(data.get("x", controller.configured_target_pos[0]))
                y = float(data.get("y", controller.configured_target_pos[1]))
                z = float(data.get("z", controller.configured_target_pos[2]))
                x = max(TARGET_BOUNDS["x"][0], min(TARGET_BOUNDS["x"][1], x))
                y = max(TARGET_BOUNDS["y"][0], min(TARGET_BOUNDS["y"][1], y))
                z = max(TARGET_BOUNDS["z"][0], min(TARGET_BOUNDS["z"][1], z))
                async with controller.lock:
                    controller.configured_target_pos = [round(x, 4), round(y, 4), round(z, 4)]
                    controller._apply_target_internal(x, y, z)
                    controller._refresh_sim_and_obs()
                await controller.broadcast_state()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        controller.clients.discard(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8005, log_level="info")
