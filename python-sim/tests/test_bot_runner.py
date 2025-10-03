"""Tests for the Docker-oriented bridge runtime harness."""

from __future__ import annotations

import json
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest

# //1.- Ensure the python-sim package directory is importable when tests execute from the repository root.
sys.path.append(str(Path(__file__).resolve().parents[1]))

from bot_runner import BridgeApplication, BridgeConfig, load_config_from_env


def _wait_for_handshake(host: str, port: int, timeout: float = 2.0) -> None:
    """Poll the handshake endpoint until it responds or a timeout elapses."""

    # //1.- Continuously attempt a request until the expected response arrives.
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://{host}:{port}/handshake", timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise TimeoutError("bridge handshake endpoint did not become ready in time")


def test_bridge_application_serves_handshake() -> None:
    """BridgeApplication should expose the underlying SimulationControlServer."""

    # //1.- Start the application on an ephemeral port to avoid conflicts.
    app = BridgeApplication(BridgeConfig(host="127.0.0.1", port=0, log_interval_seconds=60.0))
    app.start()
    host, port = app.address
    _wait_for_handshake(host, port)
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/handshake", timeout=0.5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    finally:
        app.stop()
    # //2.- Verify the JSON payload echoes the success contract defined by the server.
    assert payload["status"] == "ok"
    assert "Simulation bridge online" in payload["message"]


def test_wait_forever_returns_after_stop() -> None:
    """The wait loop should exit once ``stop`` is called from another thread."""

    # //1.- Launch the application and block on ``wait_forever`` using a background thread.
    app = BridgeApplication(BridgeConfig(host="127.0.0.1", port=0, log_interval_seconds=60.0))
    app.start()
    waiter = threading.Thread(target=app.wait_forever, daemon=True)
    waiter.start()
    _wait_for_handshake(*app.address)
    # //2.- Stop the server and confirm the waiting thread finishes promptly.
    app.stop()
    waiter.join(timeout=1.0)
    assert not waiter.is_alive()


def test_load_config_from_env_handles_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing environment variables should fall back to documented defaults."""

    # //1.- Clear the relevant environment variables to simulate a fresh container boot.
    monkeypatch.delenv("WEB_BRIDGE_HOST", raising=False)
    monkeypatch.delenv("WEB_BRIDGE_PORT", raising=False)
    monkeypatch.delenv("WEB_BRIDGE_LOG_INTERVAL_SEC", raising=False)
    config = load_config_from_env({})
    # //2.- Validate that the default host, port, and heartbeat interval are applied.
    assert config.host == "0.0.0.0"
    assert config.port == 8000
    assert config.log_interval_seconds == pytest.approx(30.0)

