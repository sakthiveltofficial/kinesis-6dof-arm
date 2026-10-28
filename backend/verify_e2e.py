"""End-to-end verification suite for YAM Robotics Lab Backend & WebSocket streaming."""

import asyncio
import json
import httpx
import websockets

BASE_URL = "http://127.0.0.1:8005"
WS_URL = "ws://127.0.0.1:8005/ws/simulation"


async def run_verification() -> None:
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=15.0) as client:
        # 1. Health Check
        r = await client.get("/api/health")
        assert r.status_code == 200, f"Health check failed: {r.text}"
        health = r.json()
        print("[PASS] 1. /api/health:", json.dumps(health))
        assert health["onnx_loaded"] is True
        assert health["obs_shape"] == [1, 29]
        assert health["action_shape"] == [1, 7]

        # 2. Config Check
        r = await client.get("/api/config")
        assert r.status_code == 200
        cfg = r.json()
        print(
            f"[PASS] 2. /api/config: task={cfg['task_id']}, "
            f"joints={len(cfg['robot']['joint_names'])}, "
            f"visual_geoms={len(cfg['robot']['visual_geoms'])}"
        )
        assert len(cfg["robot"]["joint_names"]) == 8
        assert len(cfg["robot"]["visual_geoms"]) == 18

        # 3. Connect WebSocket & verify initial state frame
        async with websockets.connect(WS_URL) as ws:
            init_frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
            assert len(init_frame["policy"]["obs"]) == 29
            assert len(init_frame["policy"]["action"]) == 7
            print(
                f"[PASS] 3. WebSocket initial frame received: "
                f"obs_len={len(init_frame['policy']['obs'])}, "
                f"act_len={len(init_frame['policy']['action'])}"
            )

            # 4. Update Cube Position & verify MuJoCo state update over REST + WS
            new_cube = {"x": 0.31, "y": -0.09, "z": 0.02, "yaw": 0.0}
            r = await client.post("/api/object/position", json=new_cube)
            assert r.status_code == 200
            cube_state = r.json()["state"]["cube"]["pos"]
            assert abs(cube_state[0] - 0.31) < 1e-3 and abs(cube_state[1] - (-0.09)) < 1e-3
            ws_frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
            assert abs(ws_frame["cube"]["pos"][0] - 0.31) < 1e-3
            print(f"[PASS] 4. /api/object/position updated MuJoCo cube to {cube_state}")

            # 5. Update Target Position & verify MJLab LiftingCommand.target_pos update
            new_target = {"x": 0.39, "y": 0.11, "z": 0.27}
            r = await client.post("/api/target", json=new_target)
            assert r.status_code == 200
            target_state = r.json()["state"]["target"]["pos"]
            assert (
                abs(target_state[0] - 0.39) < 1e-3
                and abs(target_state[1] - 0.11) < 1e-3
                and abs(target_state[2] - 0.27) < 1e-3
            )
            ws_frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
            assert abs(ws_frame["target"]["pos"][2] - 0.27) < 1e-3
            print(f"[PASS] 5. /api/target updated MJLab command target to {target_state}")

            # 6. Start Pick-and-Place & stream WebSocket updates
            r = await client.post(
                "/api/simulation/start",
                json={"reset_to_configured": True, "max_steps": 150},
            )
            assert r.status_code == 200
            print("[PASS] 6. /api/simulation/start triggered live ONNX pick-and-place")

            frames_received = 0
            for _ in range(25):
                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
                frames_received += 1

            # 7. Test Pause and Resume
            r = await client.post("/api/simulation/pause")
            assert r.status_code == 200
            assert r.json()["state"]["simulation"]["status"] == "paused"
            print(
                f"[PASS] 7a. /api/simulation/pause paused at step "
                f"{r.json()['state']['simulation']['step_count']}"
            )

            r = await client.post("/api/simulation/resume")
            assert r.status_code == 200
            assert r.json()["state"]["simulation"]["status"] == "running"
            print("[PASS] 7b. /api/simulation/resume resumed simulation")

            # Wait for completion of the 150-step pick-and-place run
            final_frame = None
            while True:
                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
                frames_received += 1
                if frame["simulation"]["status"] == "completed":
                    final_frame = frame
                    break

            print(
                f"[PASS] 8. Pick-and-Place episode completed ({frames_received} WS frames): "
                f"final_cube={final_frame['cube']['pos']}, "
                f"target={final_frame['target']['pos']}, "
                f"pos_error={final_frame['target']['position_error']}m, "
                f"episode_success={final_frame['target']['episode_success']}"
            )
            assert final_frame["target"]["episode_success"] is True

            # 8. Test Replay Episode
            r = await client.post("/api/simulation/replay")
            assert r.status_code == 200
            assert r.json()["state"]["simulation"]["status"] == "replaying"
            replay_frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
            print(
                f"[PASS] 9. /api/simulation/replay active, status={replay_frame['simulation']['status']}"
            )

            # 9. Test Stop and Reset
            r = await client.post("/api/simulation/stop")
            assert r.status_code == 200
            assert r.json()["state"]["simulation"]["status"] == "idle"

            r = await client.post("/api/simulation/reset", json={"randomize": False})
            assert r.status_code == 200
            reset_state = r.json()["state"]
            assert reset_state["simulation"]["step_count"] == 0
            print("[PASS] 10. /api/simulation/stop & /api/simulation/reset verified.")


if __name__ == "__main__":
    asyncio.run(run_verification())
