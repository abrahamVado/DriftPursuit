"""Unit tests for the lightweight simulation control HTTP server."""

from __future__ import annotations

import json
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict

import pytest

# //1.- Ensure the python-sim package directory is importable when tests execute from the repository root.
sys.path.append(str(Path(__file__).resolve().parents[1]))

from web_bridge.server import BridgeState, SimulationControlServer


def _wait_for_server(host: str, port: int, timeout: float = 2.0) -> None:
    """Poll the handshake endpoint until the server responds or the timeout elapses."""

    # //1.- Loop until the handshake request returns successfully or the timeout fires.
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://{host}:{port}/handshake"):
                return
        except urllib.error.URLError:
            time.sleep(0.05)
    raise TimeoutError("Server did not respond within the allotted time")


@pytest.fixture()
def running_server() -> SimulationControlServer:
    """Spin up the control server for the duration of a test and tear it down afterwards."""

    # //1.- Start the server on an ephemeral port so tests can run in parallel without clashing.
    server = SimulationControlServer()
    server.start()
    host, port = server.address
    _wait_for_server(host, port)
    yield server
    # //2.- Guarantee the socket is closed after each scenario completes.
    server.stop()


def test_handshake_returns_success(running_server: SimulationControlServer) -> None:
    """Verify the handshake endpoint advertises the server as ready."""

    # //1.- Issue a GET request and decode the JSON payload returned by the server.
    host, port = running_server.address
    with urllib.request.urlopen(f"http://{host}:{port}/handshake") as response:
        payload = json.loads(response.read().decode("utf-8"))
    # //2.- Confirm the bridge signals a healthy state to the caller.
    assert payload["status"] == "ok"
    assert "Simulation bridge online" in payload["message"]


def test_state_endpoint_uses_provider(running_server: SimulationControlServer) -> None:
    """Ensure the state endpoint relays telemetry from the provided callback."""

    # //1.- Replace the provider with a deterministic payload so assertions remain stable.
    telemetry_called = threading.Event()

    def custom_provider() -> BridgeState:
        # //1.- Flag that the provider was invoked and return a predictable snapshot.
        telemetry_called.set()
        return BridgeState(tick_id=12, captured_at_ms=34.5, vehicles={"car": {"x": 1.0}})

    running_server.stop()
    server = SimulationControlServer(state_provider=custom_provider)
    server.start()
    host, port = server.address
    _wait_for_server(host, port)
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/state") as response:
            payload = json.loads(response.read().decode("utf-8"))
    finally:
        server.stop()
    # //2.- Validate the response mirrors the custom provider output.
    assert telemetry_called.is_set()
    assert payload == {
        "status": "ok",
        "tickId": 12,
        "capturedAtMs": 34.5,
        "vehicles": {"car": {"x": 1.0}},
    }


def test_post_command_invokes_handler() -> None:
    """Confirm that POST /command forwards the payload to the registered handler."""

    # //1.- Capture the command payload within the custom handler for verification.
    received: Dict[str, object] = {}

    def handler(payload: Dict[str, object]) -> None:
        received.update(payload)

    server = SimulationControlServer(command_handler=handler)
    server.start()
    host, port = server.address
    _wait_for_server(host, port)
    try:
        request = urllib.request.Request(
            f"http://{host}:{port}/command",
            data=json.dumps({"command": "throttle", "value": 1.0}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request) as response:
            payload = json.loads(response.read().decode("utf-8"))
    finally:
        server.stop()
    # //2.- Ensure the handler observed the command and the response echoes the payload.
    assert received == {"command": "throttle", "value": 1.0}
    assert payload["status"] == "ok"
    assert payload["command"] == {"command": "throttle", "value": 1.0}
