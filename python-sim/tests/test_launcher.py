"""Tests for the bot launcher process manager and HTTP interface."""

from __future__ import annotations

import json
import socket
import threading
from contextlib import closing
from http.client import HTTPConnection
from typing import List

import pytest

from bot_sdk.launcher import BotProcessManager, BotSnapshot, create_server


class FakeProcess:
    """Minimal stand-in for subprocess.Popen used in unit tests."""

    def __init__(self) -> None:
        self.terminated = False
        self.killed = False
        self._returncode = None

    def terminate(self) -> None:
        # //1.- Flag the termination request so tests can assert on graceful shutdowns.
        self.terminated = True
        self._returncode = 0

    def kill(self) -> None:
        # //2.- Record when the manager escalates to a kill signal.
        self.killed = True
        self._returncode = -9

    def wait(self, timeout: float | None = None) -> int:
        # //3.- Simulate synchronous waits by returning immediately with the exit code.
        return self._returncode or 0

    def poll(self) -> int | None:
        # //4.- Report None while running and the exit code after termination.
        return self._returncode


class FakePopenFactory:
    """Factory that records spawn commands and returns fake processes."""

    def __init__(self) -> None:
        self.commands: List[List[str]] = []
        self.processes: List[FakeProcess] = []

    def __call__(self, command: List[str]) -> FakeProcess:
        # //5.- Persist the spawn command so scale() invocations can be asserted.
        self.commands.append(list(command))
        proc = FakeProcess()
        self.processes.append(proc)
        return proc


@pytest.fixture()
def popen_factory() -> FakePopenFactory:
    return FakePopenFactory()


def test_process_manager_scales_up_and_down(popen_factory: FakePopenFactory) -> None:
    manager = BotProcessManager(lambda idx: ["python", "bot.py", f"--id={idx}"], popen=popen_factory)

    snapshot = manager.scale(3)
    assert snapshot == BotSnapshot(target=3, running=3)
    assert len(popen_factory.commands) == 3

    # Retire a single bot and ensure the process receives terminate.
    snapshot = manager.scale(2)
    assert snapshot == BotSnapshot(target=2, running=2)
    assert popen_factory.processes[2].terminated is True

    # Re-scaling with the same target should avoid additional spawns.
    snapshot = manager.scale(2)
    assert snapshot == BotSnapshot(target=2, running=2)
    assert len(popen_factory.commands) == 3


def test_process_manager_reaps_exited(popen_factory: FakePopenFactory) -> None:
    manager = BotProcessManager(lambda idx: ["python", "bot.py", f"--id={idx}"], popen=popen_factory)
    manager.scale(2)
    popen_factory.processes[0].terminate()

    snapshot = manager.snapshot()
    assert snapshot.running == 1
    assert snapshot.target == 2


def test_http_server_scales_manager(popen_factory: FakePopenFactory) -> None:
    manager = BotProcessManager(lambda idx: ["python", "bot.py", f"--id={idx}"], popen=popen_factory)

    with closing(socket.socket()) as sock:
        sock.bind(("127.0.0.1", 0))
        host, port = sock.getsockname()

    server = create_server(host, port, manager)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        conn = HTTPConnection(host, port)
        payload = json.dumps({"target": 4})
        conn.request("POST", "/scale", body=payload, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        assert resp.status == 200
        body = json.loads(resp.read())
        assert body == {"target": 4, "running": 4}
    finally:
        server.shutdown()
        thread.join()
