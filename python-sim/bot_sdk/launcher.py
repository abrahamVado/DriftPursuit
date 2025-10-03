"""Bot process launcher and HTTP control surface for broker automation."""

from __future__ import annotations

import json
import subprocess
import threading
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Dict, List, Sequence


@dataclass
class BotSnapshot:
    """Compact view of the bot pool used by the broker controller."""

    target: int
    running: int


class BotProcessManager:
    """Manage a pool of bot subprocesses according to a desired population."""

    def __init__(
        self,
        command_factory: Callable[[int], Sequence[str]],
        *,
        popen: Callable[..., subprocess.Popen] | None = None,
        terminate_timeout: float = 5.0,
    ) -> None:
        if command_factory is None:
            raise ValueError("command_factory must be provided")
        # //1.- Retain the injected factories and initialise bookkeeping structures.
        self._command_factory = command_factory
        self._popen = popen or subprocess.Popen
        self._terminate_timeout = terminate_timeout
        self._processes: Dict[int, subprocess.Popen] = {}
        self._next_identity = 1
        self._target = 0
        self._lock = threading.Lock()

    def scale(self, target: int) -> BotSnapshot:
        """Ensure the desired number of bots are running and return a snapshot."""

        if target < 0:
            raise ValueError("target must be non-negative")
        with self._lock:
            # //2.- Drop exited workers before reconciling the remaining population.
            self._reap_exited_locked()
            self._target = target
            running = len(self._processes)
            if target > running:
                self._spawn_locked(target - running)
            elif target < running:
                self._retire_locked(running - target)
            # //3.- Report the updated pool so callers can surface accurate metrics.
            return BotSnapshot(target=self._target, running=len(self._processes))

    def snapshot(self) -> BotSnapshot:
        """Return the current target and running counts without mutating state."""

        with self._lock:
            self._reap_exited_locked()
            # //4.- Provide a defensive copy so readers avoid holding the manager lock.
            return BotSnapshot(target=self._target, running=len(self._processes))

    def _spawn_locked(self, count: int) -> None:
        for _ in range(count):
            identity = self._next_identity
            self._next_identity += 1
            command = list(self._command_factory(identity))
            if not command:
                raise ValueError("command_factory returned an empty command sequence")
            # //5.- Spawn the bot process using the injected Popen factory.
            proc = self._popen(command)
            self._processes[identity] = proc

    def _retire_locked(self, count: int) -> None:
        identities = sorted(self._processes.keys(), reverse=True)
        for identity in identities[:count]:
            proc = self._processes.pop(identity)
            # //6.- Request a graceful shutdown before escalating to SIGKILL.
            proc.terminate()
            try:
                proc.wait(timeout=self._terminate_timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=self._terminate_timeout)

    def _reap_exited_locked(self) -> None:
        stale: List[int] = []
        for identity, proc in self._processes.items():
            if proc.poll() is not None:
                stale.append(identity)
        # //7.- Remove exited processes outside the iterator to avoid mutation issues.
        for identity in stale:
            self._processes.pop(identity, None)


class ScalingRequestHandler(BaseHTTPRequestHandler):
    """HTTP interface exposing bot scaling semantics."""

    manager: BotProcessManager | None = None

    def do_POST(self) -> None:  # noqa: N802 - required signature
        if self.path != "/scale":
            self.send_error(HTTPStatus.NOT_FOUND, "unknown endpoint")
            return
        if not self.manager:
            self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "bot manager unavailable")
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body or b"{}")
            target = int(payload.get("target"))
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self.send_error(HTTPStatus.BAD_REQUEST, f"invalid payload: {exc}")
            return
        try:
            # //8.- Reconcile the manager pool based on the requested target.
            snapshot = self.manager.scale(target)
        except ValueError as exc:
            self.send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return
        response = json.dumps({"target": snapshot.target, "running": snapshot.running}).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format: str, *args) -> None:  # noqa: D401
        """Silence the default stderr logging to keep tests tidy."""

        return


def create_server(
    host: str,
    port: int,
    manager: BotProcessManager,
) -> ThreadingHTTPServer:
    """Build a ThreadingHTTPServer bound to the provided manager instance."""

    handler_class = type(  # type: ignore[no-untyped-call]
        "BoundScalingRequestHandler",
        (ScalingRequestHandler,),
        {"manager": manager},
    )
    # //9.- Construct the threaded HTTP server using the specialised handler type.
    server = ThreadingHTTPServer((host, port), handler_class)
    return server


__all__ = ["BotProcessManager", "BotSnapshot", "ScalingRequestHandler", "create_server"]
