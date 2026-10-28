# YAM Robotics Lab — Windows Web Simulator for WSL2 MJLab (`Mjlab-Lift-Cube-Yam`)

A browser-based 3D robot pick-and-place simulator on Windows connected to the live **MJLab 1.6.0 (`mujoco-warp`)** physics simulation and trained **RSL-RL ONNX policy** (`2026-10-28_05-58-03.onnx`) running inside WSL2 (`Ubuntu-24.04`).

---

## 1. Architecture & Reused WSL Assets

This project uses the **Windows Frontend + WSL2 Simulation Backend** architecture:

- **WSL2 Ubuntu-24.04 Source of Truth**:
  - WSL Username: `webnox`
  - WSL Project Path: `/home/webnox/workspace/mjlab-linux`
  - Windows UNC Path: `\\wsl.localhost\Ubuntu-24.04\home\webnox\workspace\mjlab-linux`
  - Task ID: `Mjlab-Lift-Cube-Yam`
  - Trained ONNX Policy: `/home/webnox/workspace/mjlab-linux/logs/rsl_rl/yam_lift_cube/2026-10-28_05-58-03/2026-10-28_05-58-03.onnx`
  - Trained Checkpoint: `/home/webnox/workspace/mjlab-linux/logs/rsl_rl/yam_lift_cube/2026-10-28_05-58-03/model_1999.pt`
  - YAM Robot MJCF & 18 STL Meshes: `/home/webnox/workspace/mjlab-linux/src/mjlab/asset_zoo/robots/i2rt_yam/xmls/yam.xml` and `assets/*.stl` (copied into `frontend/public/meshes/` and `assets/i2rt_yam/` for fast browser rendering while preserving original files untouched).

- **Simulation & Policy Pipeline**:
  - **Observations (`1 × 29`)**: Computed directly by MJLab's `ObservationManager`:
    - `joint_pos` (8): relative joint positions (`joint1..6`, `left_finger`, `right_finger`)
    - `joint_vel` (8): relative joint velocities
    - `ee_to_cube` (3): end-effector (`grasp_site`) to cube vector in robot base frame
    - `cube_to_goal` (3): cube to `lift_height` command target vector in robot base frame
    - `actions` (7): previous step actions
  - **Actions (`1 × 7`)**: Predicted by ONNX Runtime (`onnxruntime 1.30.0`) and applied via MJLab's `RslRlVecEnvWrapper` and `JointPositionAction` (`YAM_ACTION_SCALE`) with `decimation = 4` (`physics_dt = 0.005s`, `step_dt = 0.02s` / 50 Hz).

---

## 2. Quick Launch on Windows

### One-Click Launch
From Windows Explorer or PowerShell in `d:\sakthivel workspace\Workspace\RnD\Robotics`:

1. Double-click **`start_web_demo.bat`** or run **`.\start_web_demo.ps1`** in PowerShell:
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File .\start_web_demo.ps1
   ```
2. The script automatically:
   - Verifies access to the WSL2 MJLab assets via UNC path.
   - Starts the FastAPI simulation backend inside WSL2 on `http://127.0.0.1:8005`.
   - Starts the React + TypeScript + Three.js Vite frontend on `http://127.0.0.1:5173`.
   - Opens `http://127.0.0.1:5173` in your default Windows browser.

### Separate Backend / Frontend Launchers
- Start WSL2 Backend only:
  ```powershell
  .\start_backend.ps1
  ```
- Start Windows Frontend only:
  ```powershell
  .\start_frontend.ps1
  ```

### First-Time Dependency Setup (Already Completed)
- **WSL2 Backend** (inside `/home/webnox/workspace/mjlab-linux/.venv`):
  ```bash
  cd ~/workspace/mjlab-linux && uv pip install fastapi uvicorn httpx
  ```
- **Windows Frontend**:
  ```powershell
  cd frontend
  npm install
  ```

---

## 3. Website Controls & Features

Open **`http://127.0.0.1:5173`** in your Windows browser:

- **Place Cube**:
  - Toggle **Place Cube Mode** (`Click to Place Cube`) and click directly on the 3D table inside the cyan boundary (`X ∈ [0.16, 0.46]m`, `Y ∈ [-0.26, 0.26]m`), or adjust the `X / Y / Z` sliders and click **Place Cube in Simulation**.
  - Immediately writes the new root pose and zero velocity to the `cube` freejoint in MuJoCo (`write_root_link_pose_to_sim` + `sim.forward()`).
- **Set Target**:
  - Toggle **Set Target Mode** (`Click to Set Target`) and click on the 3D workspace (uses the configured Target Z height), or adjust the `X / Y / Z` sliders / presets and click **Set Target in Simulation**.
  - Immediately updates `LiftingCommand.target_pos` in MJLab's `command_manager` and recomputes `cube_to_goal` observations.
- **Run Pick and Place**: Executes the loaded ONNX policy in real time at 50 Hz, streaming all 18 visual mesh world poses, joint states, cube pose, end-effector pose, and reward metrics over WebSockets (`/ws/simulation`).
- **Pause / Resume**: Pauses and resumes the live simulation loop safely.
- **Reset Episode / Randomize Setup**: Resets the robot to `HOME_KEYFRAME` and restores the configured cube/target coordinates (or samples random in-distribution poses when clicking **Randomize Setup**).
- **Replay Episode**: Replays the recorded trajectory by restoring each recorded `qpos`/`qvel`/`ctrl` snapshot into MuJoCo (`sim.forward()`) and streaming the resulting state.
- **Reset Camera**: Resets the 3D OrbitControls camera to the default laboratory view.

---

## 4. Target Behavior & Policy Characteristics

The existing `Mjlab-Lift-Cube-Yam` checkpoint (`model_1999.pt` / `2026-10-28_05-58-03.onnx`) was trained with `LiftingCommandCfg` (`difficulty="dynamic"`):
- **Trained Cube Spawn Region**: `X ∈ [0.20, 0.40]m`, `Y ∈ [-0.20, 0.20]m`, `Z ∈ [0.02, 0.05]m`
- **Trained 3D Goal Region**: `X ∈ [0.30, 0.50]m`, `Y ∈ [-0.20, 0.20]m`, `Z ∈ [0.20, 0.40]m` (`success_threshold = 0.05m`)

### Observed Real Policy Behavior Across Target Locations
1. **3D Targets inside the Trained Lift Envelope (`Z ∈ [0.20, 0.40]m`)**:
   - The robot reaches down to the cube, closes the parallel crank gripper around the cube, lifts it smoothly, and holds it stably at the 3D target position with **2 mm – 8 mm steady-state error** (`episode_success = True`).
2. **Low-Z / Near-Table Targets (`Z ∈ [0.05, 0.15]m`)**:
   - Because `Mjlab-Lift-Cube-Yam` is formulated as a continuous 3D goal-reaching/holding task without a gripper-release command term, when given a low target (`Z = 0.05m`), the policy grasps the cube and transports it horizontally to the target `(X, Y)` coordinates while holding it in the gripper at `Z ≈ 0.08m` (`position_error ≈ 0.031m < 0.05m`).

---

## 5. Backend API Reference (`http://127.0.0.1:8005`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Returns backend health, CUDA device, ONNX load status, and `(1, 29)` / `(1, 7)` shapes |
| `GET` | `/api/config` | Returns robot joints, limits, 18 visual geom mesh definitions, and workspace bounds |
| `GET` | `/api/state` | Returns a full snapshot of the current MuJoCo simulation state |
| `POST` | `/api/simulation/reset` | Resets episode (`{"randomize": false}` or `{"randomize": true}`) |
| `POST` | `/api/object/position` | Validates bounds and updates actual cube pose in MuJoCo (`{"x", "y", "z", "yaw"}`) |
| `POST` | `/api/target` | Validates bounds and updates `LiftingCommand.target_pos` (`{"x", "y", "z"}`) |
| `POST` | `/api/simulation/start` | Starts ONNX policy execution (`{"reset_to_configured": false, "max_steps": 400}`) |
| `POST` | `/api/simulation/pause` | Pauses active simulation or replay |
| `POST` | `/api/simulation/resume` | Resumes paused simulation or replay |
| `POST` | `/api/simulation/stop` | Stops simulation loop |
| `POST` | `/api/simulation/replay` | Replays the recorded episode through MuJoCo state |
| `WS` | `/ws/simulation` | Streams live 50 Hz simulation state packets to connected browsers |

---

## 6. Executed Verification Results

All checks were executed against the live WSL2 MJLab environment (`NVIDIA GeForce RTX 5060 Ti`, `cuda:0`) and Windows frontend proxy (`backend/verify_e2e.py`):

- **WSL Asset Access**: Verified UNC path `\\wsl.localhost\Ubuntu-24.04\home\webnox\workspace\mjlab-linux` and copied 18 STL meshes.
- **ONNX Model Load & Shapes**: Loaded `2026-10-28_05-58-03.onnx`; verified input `obs` shape `(1, 29)` and output `actions` shape `(1, 7)`.
- **Cube Position Update (`POST /api/object/position`)**: Set cube to `[0.31, -0.09, 0.02]m`; verified MuJoCo `root_link_pos_w` updated immediately.
- **Target Update (`POST /api/target`)**: Set target to `[0.39, 0.11, 0.27]m`; verified MJLab `LiftingCommand.target_pos` updated immediately.
- **Live Pick-and-Place Execution (`POST /api/simulation/start`)**:
  - Cube started at `[0.31, -0.09, 0.02]m`, Target at `[0.39, 0.11, 0.27]m`.
  - Streamed 153 live WebSocket frames to client.
  - Final cube position: `[0.3903, 0.1151, 0.2751]m` (**`0.0072 m` (7.2 mm) final position error**, `episode_success = True`).
- **Pause / Resume / Replay / Reset**: Verified state transitions (`running` -> `paused` at step 25 -> `running` -> `completed` -> `replaying` -> `idle` -> `reset` at step 0).
- **Windows Launcher & Proxy**: Verified `.\start_web_demo.ps1` health checks on both `http://127.0.0.1:8005/api/health` and `http://127.0.0.1:5173/api/health`.
