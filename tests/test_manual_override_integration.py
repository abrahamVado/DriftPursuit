import json
import os
import select
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

# Ensure the python-sim package is importable when running tests from repo root.
SIM_PATH = Path(__file__).resolve().parents[1] / "python-sim"
if str(SIM_PATH) not in sys.path:
    sys.path.insert(0, str(SIM_PATH))

websocket = pytest.importorskip("websocket")

REPO_ROOT = Path(__file__).resolve().parents[1]
BROKER_ROOT = REPO_ROOT / "go-broker"


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for_output(proc: subprocess.Popen, needle: str, timeout: float = 30.0):
    deadline = time.time() + timeout
    captured: list[str] = []
    stream = proc.stdout
    assert stream is not None
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(
                f"Process exited early with code {proc.returncode}. Output: {''.join(captured)}"
            )
        remaining = max(0.0, deadline - time.time())
        ready, _, _ = select.select([stream], [], [], remaining)
        if ready:
            line = stream.readline()
            if not line:
                continue
            captured.append(line)
            if needle in line:
                return captured
    raise TimeoutError(f"Timed out waiting for '{needle}'. Output so far: {''.join(captured)}")


def await_message(ws, predicate, timeout: float = 10.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        remaining = max(0.0, deadline - time.time())
        ws.settimeout(max(0.1, remaining))
        try:
            raw = ws.recv()
        except websocket.WebSocketTimeoutException:
            continue
        last = json.loads(raw)
        if predicate(last):
            return last
    raise AssertionError(f"Did not observe expected message before timeout. Last payload: {last}")


def test_manual_override_roundtrip():
    port = find_free_port()
    broker_cmd = [
        "go",
        "run",
        ".",
        "--addr",
        f"127.0.0.1:{port}",
    ]
    broker_env = os.environ.copy()
    broker_env.setdefault("GO111MODULE", "on")
    broker_proc = subprocess.Popen(
        broker_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        cwd=BROKER_ROOT,
        env=broker_env,
    )

    sim_proc = None
    viewer_ws = None
    try:
        deadline = time.time() + 30.0
        while time.time() < deadline:
            if broker_proc.poll() is not None:
                raise RuntimeError(
                    f"Broker exited early with code {broker_proc.returncode}"
                )
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1.0):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise TimeoutError("Timed out waiting for broker TCP port to open")

        sim_cmd = [
            sys.executable,
            "python-sim/client.py",
            "--broker-url",
            f"ws://127.0.0.1:{port}/ws",
        ]
        sim_env = os.environ.copy()
        sim_env.setdefault("PYTHONUNBUFFERED", "1")
        sim_proc = subprocess.Popen(
            sim_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=REPO_ROOT,
            env=sim_env,
        )

        wait_for_output(sim_proc, "Connected to")

        viewer_ws = websocket.create_connection(
            f"ws://127.0.0.1:{port}/ws",
            origin="http://localhost",
        )

        await_message(
            viewer_ws,
            lambda msg: msg.get("type") == "telemetry" and msg.get("id") == "plane-1",
            timeout=15.0,
        )

        enable_command = {
            "type": "command",
            "id": "plane-1",
            "cmd": "manual_override",
            "from": "integration-test",
            "target_id": "plane-1",
            "params": {
                "enabled": True,
                "velocity": [150.0, 25.0, 0.0],
                "orientation": [0.0, 0.0, 0.0],
            },
            "command_id": "integration-1",
        }
        viewer_ws.send(json.dumps(enable_command))

        await_message(
            viewer_ws,
            lambda msg: msg.get("type") == "command_status"
            and msg.get("cmd") == "manual_override"
            and msg.get("status") == "ok",
        )

        target_velocity = [150.0, 25.0, 0.0]

        def velocity_matches(msg):
            if msg.get("type") != "telemetry" or msg.get("id") != "plane-1":
                return False
            if "manual:override" not in (msg.get("tags") or []):
                return False
            vel = msg.get("vel")
            if not vel:
                return False
            return all(abs(float(vel[i]) - target_velocity[i]) < 5.0 for i in range(3))

        manual_msg = await_message(viewer_ws, velocity_matches, timeout=10.0)
        assert manual_msg is not None
        assert "manual:override" in manual_msg.get("tags", [])

        disable_command = {
            "type": "command",
            "id": "plane-1",
            "cmd": "manual_override",
            "from": "integration-test",
            "target_id": "plane-1",
            "params": {"enabled": False},
            "command_id": "integration-2",
        }
        viewer_ws.send(json.dumps(disable_command))

        await_message(
            viewer_ws,
            lambda msg: msg.get("type") == "command_status"
            and msg.get("cmd") == "manual_override"
            and msg.get("status") == "ok",
        )

        cleared_msg = await_message(
            viewer_ws,
            lambda msg: msg.get("type") == "telemetry"
            and msg.get("id") == "plane-1"
            and "manual:override" not in (msg.get("tags") or []),
            timeout=10.0,
        )
        assert "manual:override" not in cleared_msg.get("tags", [])
    finally:
        if viewer_ws is not None:
            try:
                viewer_ws.close()
            except Exception:
                pass
        if sim_proc is not None:
            try:
                sim_proc.send_signal(signal.SIGINT)
                sim_proc.wait(timeout=10.0)
            except Exception:
                sim_proc.kill()
        broker_proc.terminate()
        try:
            broker_proc.wait(timeout=10.0)
        except Exception:
            broker_proc.kill()
