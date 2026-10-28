# Kinesis — AI-Powered 6-DOF Robot Arm Simulation

<p align="center">
  <strong>From a trained reinforcement-learning policy to an interactive robotics lab in the browser.</strong>
</p>

<p align="center">
  <a href="https://github.com/sakthiveltofficial/kinesis-6dof-arm"><img alt="GitHub" src="https://img.shields.io/badge/GitHub-kinesis--6dof--arm-181717?logo=github"></a>
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows%20%2B%20WSL2-0078D4?logo=windows">
  <img alt="Simulation" src="https://img.shields.io/badge/Simulation-MuJoCo%20%2B%20MJLab-00A67D">
  <img alt="Inference" src="https://img.shields.io/badge/Inference-ONNX%20Runtime-6B55D3">
  <img alt="Frontend" src="https://img.shields.io/badge/Frontend-React%20%2B%20Three.js-61DAFB?logo=react">
</p>

**Kinesis** is a robotics engineering project by **Sakthivel Thangaraj** that connects a trained reinforcement-learning policy to a live MuJoCo/MJLab simulation and makes it accessible through an interactive 3D browser application.

Open the Windows browser, place a cube in the workspace, select a target, and watch the trained policy control the simulated Yam arm. The physics and policy run in MJLab inside WSL2; the interactive interface is built with React, TypeScript, and Three.js.

> **Project focus:** embodied AI · reinforcement learning · robotics simulation · ONNX inference · full-stack engineering

## At a glance

| | |
|---|---|
| **Robot** | i2rt YAM arm with parallel gripper |
| **Task** | Cube lifting and target reaching |
| **Simulation** | MJLab 1.6.0 / MuJoCo |
| **Policy** | Trained RSL-RL policy exported to ONNX |
| **Inference contract** | 29 observations → 7 action outputs |
| **Frontend** | React, TypeScript, Vite, Three.js |
| **Backend** | FastAPI + WebSockets |
| **Host workflow** | Windows UI connected to Ubuntu 24.04 in WSL2 |
| **Hardware used for verification** | NVIDIA GeForce RTX 5060 Ti, 8 GB VRAM |

## Demo

The simulator lets you:

1. Explore the robot in an interactive 3D workspace.
2. Place the cube inside the permitted starting region.
3. Select a target in 3D or set its XYZ coordinates.
4. Run the ONNX policy against the actual MJLab simulation.
5. Pause, resume, reset, or replay an episode while observing live state updates.

<!-- Add a short GIF or screenshot here when available.
<p align="center">
  <img src="docs/demo.gif" alt="Kinesis robot arm picking up and moving a cube" width="900">
</p>
-->

## Why I built it

I wanted to connect the pieces of a practical robotics AI workflow: a robot model, a trained policy, a physics simulator, runtime inference, and an interface that makes the result easy to explore.

This project brings those pieces together:

- **Reinforcement learning to runtime inference:** use an existing RSL-RL checkpoint exported to ONNX.
- **Simulation fidelity:** keep MJLab/MuJoCo as the source of truth for the robot, contacts, object pose, and physics.
- **Interactive 3D controls:** connect workspace clicks and coordinate controls to the live simulation, not frontend-only objects.
- **Cross-platform engineering:** run the Linux robotics stack in WSL2 while interacting from a Windows browser.
- **Observable behavior:** expose simulation state and episode controls through an API and WebSocket stream.

## Architecture

```text
Windows Browser
      │
      ▼
React + TypeScript + Three.js
      │  HTTP API + WebSocket
      ▼
FastAPI Backend (inside WSL2)
      │
      ├── ONNX Runtime
      │     └── Trained RSL-RL policy
      │           29 observations → 7 actions
      │
      └── MJLab / MuJoCo
            ├── Yam robot and gripper
            ├── Cube and target command
            ├── ObservationManager
            ├── Existing action processing
            └── Physics stepping
```

**Design principle:** the browser provides interaction and visualization; the backend remains responsible for simulation state, observation construction, action processing, and physics.

### Reused assets

The project reuses the Yam MJCF model and its STL meshes from the source MJLab repository. The original training checkpoint and ONNX model remain in WSL2; the website does not need to duplicate the full MJLab environment or Python virtual environment on Windows.

- **WSL distribution:** `Ubuntu-24.04`
- **WSL project:** `/home/webnox/workspace/mjlab-linux`
- **Task ID:** `Mjlab-Lift-Cube-Yam`
- **Robot model:** `i2rt_yam/xmls/yam.xml`
- **Inference model:** `2026-10-28_05-58-03.onnx`

## Results from the recorded verification run

The repository's existing verification record reports these results:

| Check | Observed result |
|---|---|
| ONNX input | `(1, 29)` |
| ONNX output | `(1, 7)` |
| Cube starting position | `[0.31, -0.09, 0.02] m` |
| Selected target | `[0.39, 0.11, 0.27] m` |
| Final cube position | `[0.3903, 0.1151, 0.2751] m` |
| Final position error | `0.0072 m (7.2 mm)` |
| WebSocket frames received | `153` |
| Episode status | `episode_success = True` |

The recorded run also reports successful cube-position updates, target-command updates, reset, pause/resume, replay, and Windows frontend health checks against the WSL backend.

These are results from the recorded test configuration, not a guarantee that every arbitrary target position will succeed.

## Quick start — Windows

### Prerequisites

- Windows 11 with WSL2 enabled.
- An Ubuntu distribution named `Ubuntu-24.04`.
- The existing MJLab project in WSL2 at `~/workspace/mjlab-linux`.
- The trained ONNX policy at the path below.
- Node.js and npm available on Windows.
- Python/MJLab dependencies installed in the WSL environment.

The current launcher configuration expects WSL username `webnox` and project path `/home/webnox/workspace/mjlab-linux`. Adjust the launcher configuration if your environment differs.

### Launch the full application

From the repository directory in PowerShell:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\start_web_demo.ps1
```

Or double-click:

```text
start_web_demo.bat
```

The launcher is designed to verify WSL asset access, start the FastAPI backend inside WSL2, start the Vite frontend, and open the website.

### URLs

- **Web application:** http://127.0.0.1:5173
- **Backend health:** http://127.0.0.1:8005/api/health
- **Backend configuration:** http://127.0.0.1:8005/api/config

### Start components separately

```powershell
.\start_backend.ps1
.\start_frontend.ps1
```

### Frontend setup

```powershell
cd frontend
npm install
npm run build
```

The WSL backend uses the existing MJLab environment. The project's recorded backend dependency setup is:

```bash
cd ~/workspace/mjlab-linux
uv pip install fastapi uvicorn httpx
```

## Using the simulator

### 1. Place the cube

Enable **Click to Place Cube** and select a location on the table inside the workspace boundary, or enter XYZ coordinates. The backend validates the requested position and updates the cube's actual MuJoCo state.

Configured placement boundary:

- `X ∈ [0.16, 0.46] m`
- `Y ∈ [-0.26, 0.26] m`

### 2. Choose a target

Enable **Click to Set Target** and choose a point, or edit XYZ values. The backend updates MJLab's `LiftingCommand` target so that goal-relative observations reflect the selected target.

### 3. Run the policy

Select **Run Pick and Place**. The backend obtains observations from MJLab, calls ONNX Runtime, applies predicted actions through the existing action pipeline, advances MuJoCo, and streams the state to the browser.

### 4. Control the episode

Use pause, resume, stop/reset, replay, randomize setup, and reset camera to explore the run.

## Policy and simulation details

### Observation vector

The model expects a float32 observation with shape `(1, 29)`:

| Group | Dimensions | Meaning |
|---|---:|---|
| `joint_pos` | 8 | Relative positions of six arm joints and two gripper joints |
| `joint_vel` | 8 | Joint velocities |
| `ee_to_cube` | 3 | End-effector-to-cube displacement |
| `cube_to_goal` | 3 | Cube-to-target displacement |
| `actions` | 7 | Previous action values |
| **Total** | **29** | |

The policy outputs `(1, 7)` actions. These are passed through the existing vector-environment wrapper and joint-position action processing rather than being mapped manually in the browser.

### Training envelope

The recorded task configuration uses a dynamic lifting command:

- **Cube spawn:** `X ∈ [0.20, 0.40] m`, `Y ∈ [-0.20, 0.20] m`, `Z ∈ [0.02, 0.05] m`
- **Goal:** `X ∈ [0.30, 0.50] m`, `Y ∈ [-0.20, 0.20] m`, `Z ∈ [0.20, 0.40] m`
- **Success threshold:** `0.05 m`

The interactive workspace can expose positions outside the model's training distribution. Results outside the demonstrated envelope are not guaranteed. This task demonstrates lifting and target reaching; it should not be interpreted as a universally capable pick-and-place policy for arbitrary objects and goals.

## API reference

Base URL: `http://127.0.0.1:8005`

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Backend health, device, and model status |
| `GET` | `/api/config` | Robot, mesh, and workspace configuration |
| `GET` | `/api/state` | Current simulation snapshot |
| `POST` | `/api/simulation/reset` | Reset episode |
| `POST` | `/api/object/position` | Validate and set cube position |
| `POST` | `/api/target` | Validate and set target command |
| `POST` | `/api/simulation/start` | Start policy inference loop |
| `POST` | `/api/simulation/pause` | Pause simulation |
| `POST` | `/api/simulation/resume` | Resume simulation |
| `POST` | `/api/simulation/stop` | Stop simulation |
| `POST` | `/api/simulation/replay` | Replay recorded episode |
| `WS` | `/ws/simulation` | Stream live simulation state |

## Tech stack

- **Robotics & physics:** MJLab, MuJoCo, RSL-RL
- **Policy inference:** ONNX Runtime
- **Backend:** Python, FastAPI, WebSockets
- **Frontend:** React, TypeScript, Vite, Three.js, React Three Fiber
- **Development environment:** Windows 11, WSL2, Ubuntu 24.04
- **GPU used in verification:** NVIDIA GeForce RTX 5060 Ti, 8 GB VRAM

## Engineering challenges addressed

- Reusing a Linux robotics environment from a Windows-first workflow.
- Keeping frontend robot geometry synchronized with live simulator state.
- Preserving the trained policy's observation order and environment action semantics.
- Applying clicked cube positions and targets to the simulation itself.
- Streaming state to a browser through WebSockets.
- Supporting episode controls without replacing the trained policy with a scripted animation.

## Roadmap

- [ ] Add a short demo GIF and screenshots from the browser simulator.
- [ ] Evaluate repeatable results across a matrix of cube starts and targets.
- [ ] Report success rate and position error across multiple seeded episodes.
- [ ] Explore policy retraining for broader target distributions and explicit gripper-release behavior.
- [ ] Simplify first-time installation and Windows setup.

## About the builder

Hi, I’m **Sakthivel Thangaraj** — a **Full-Stack & AI Engineer** working across product engineering, AI-native development, and applied AI systems. I enjoy taking an idea from architecture through implementation and into a usable product.

My work spans web applications, AI-assisted engineering workflows, agentic systems, and now embodied AI: connecting learned policies to simulation, runtime inference, and interactive tools. Kinesis is a hands-on exploration of that intersection.

### A few highlights

- Built an AI ticket-support platform for a UAE fuel retailer operating **50+ stations**, with a reported **70% reduction in ticket resolution time**.
- Helped digitize a college ERP project that was featured in Tamil Nadu newspapers.
- Invited speaker at **Multimedia University (MMU), Malaysia**.
- Delivered **20+ technical talks** on software and emerging technologies.
- Currently exploring **reinforcement learning, MuJoCo/MJLab, ONNX deployment, and embodied AI** through projects like Kinesis.

I’m especially interested in engineering that closes the gap between a model that works in a notebook and a system people can actually use.

- GitHub: [@sakthiveltofficial](https://github.com/sakthiveltofficial)
- Project: [kinesis-6dof-arm](https://github.com/sakthiveltofficial/kinesis-6dof-arm)

## Contributing

Issues, technical feedback, and improvements are welcome. Please include reproducible setup details and distinguish observed results from expected behavior.

## License

No license is declared in this repository yet. Before redistributing or reusing code or robot assets, check applicable upstream asset licenses and add an explicit license for this project.
