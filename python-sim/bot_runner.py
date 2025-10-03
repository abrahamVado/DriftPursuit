"""Runtime harness that exposes the simulation bridge via HTTP for Docker use."""

from __future__ import annotations

import logging
import os
import signal
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

from web_bridge.server import BridgeState, SimulationControlServer, default_state_provider


LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class BridgeConfig:
    """Resolved configuration describing how the bridge server should run."""

    # //1.- Host interface that the HTTP server should bind to inside the container.
    host: str
    # //2.- TCP port exposed so other services (for example the web UI) can communicate.
    port: int
    # //3.- Interval used for periodic heartbeat logging to reassure operators.
    log_interval_seconds: float


def load_config_from_env(env: Optional[dict[str, str]] = None) -> BridgeConfig:
    """Construct a :class:`BridgeConfig` instance from environment variables."""

    # //1.- Allow dependency injection during testing by accepting a custom mapping.
    source = env if env is not None else os.environ
    # //2.- Fall back to sensible defaults so the container works without extra configuration.
    host = source.get("WEB_BRIDGE_HOST", "0.0.0.0")
    port = int(source.get("WEB_BRIDGE_PORT", "8000"))
    log_interval = float(source.get("WEB_BRIDGE_LOG_INTERVAL_SEC", "30.0"))
    # //3.- Return the immutable configuration object used by the runtime harness.
    return BridgeConfig(host=host, port=port, log_interval_seconds=log_interval)


class BridgeApplication:
    """Lifecycle manager that wraps :class:`SimulationControlServer`."""

    def __init__(
        self,
        config: BridgeConfig,
        *,
        state_provider: Callable[[], BridgeState] = default_state_provider,
    ) -> None:
        # //1.- Persist the configuration and injectable collaborators for later use.
        self._config = config
        self._state_provider = state_provider
        # //2.- Lazily instantiate the HTTP server so tests can introspect state between runs.
        self._server: Optional[SimulationControlServer] = None
        # //3.- Coordinate shutdown between the signal handler and the wait loop.
        self._shutdown_event = threading.Event()
        # //4.- Serialise logging to avoid duplicate heartbeats in multi-threaded contexts.
        self._heartbeat_lock = threading.Lock()
        self._last_log = 0.0

    def start(self) -> None:
        """Boot the HTTP server and begin serving requests."""

        # //1.- Prevent accidental double starts which would leak sockets.
        if self._server is not None:
            raise RuntimeError("BridgeApplication already running")
        # //2.- Start the simulation control server using the resolved configuration.
        server = SimulationControlServer(
            host=self._config.host,
            port=self._config.port,
            state_provider=self._state_provider,
        )
        server.start()
        # //3.- Record bookkeeping information for future stop and heartbeat calls.
        self._server = server
        host, port = server.address
        LOGGER.info("Bridge server listening on http://%s:%s", host, port)

    def stop(self) -> None:
        """Terminate the HTTP server and signal any waiting threads to exit."""

        # //1.- Exit quickly if the server was never started to keep shutdown idempotent.
        if self._server is None:
            self._shutdown_event.set()
            return
        # //2.- Stop the underlying HTTP daemon and release the stored reference.
        self._server.stop()
        self._server = None
        # //3.- Notify listeners that shutdown completed so ``wait_forever`` can return.
        self._shutdown_event.set()

    def wait_forever(self) -> None:
        """Block until shutdown is requested while emitting periodic heartbeats."""

        # //1.- Loop until ``stop`` is called, logging a heartbeat at the configured cadence.
        while not self._shutdown_event.wait(timeout=1.0):
            self._maybe_log_heartbeat()

    def _maybe_log_heartbeat(self) -> None:
        """Emit a log line at the configured interval to aid container diagnostics."""

        # //1.- Guard against races when multiple threads attempt to log simultaneously.
        with self._heartbeat_lock:
            now = time.monotonic()
            # //2.- Compare the elapsed time to the configured interval before logging.
            if now - self._last_log < self._config.log_interval_seconds:
                return
            self._last_log = now
        # //3.- Include the effective bind address in the message for operator clarity.
        if self._server is not None:
            host, port = self._server.address
            LOGGER.info("Bridge heartbeat active on http://%s:%s", host, port)

    @property
    def address(self) -> tuple[str, int]:
        """Expose the bind address so tests can perform HTTP requests."""

        # //1.- Ensure the application was started before a caller attempts to read metadata.
        if self._server is None:
            raise RuntimeError("BridgeApplication is not running")
        return self._server.address


def _install_signal_handlers(app: BridgeApplication) -> None:
    """Register POSIX signal handlers that trigger a graceful shutdown."""

    # //1.- Create a closure so the handlers can reference the application instance.
    def _handler(signum: int, _frame) -> None:  # type: ignore[override]
        LOGGER.info("Received signal %s, shutting down bridge", signum)
        app.stop()

    # //2.- Register handlers for SIGINT and SIGTERM which Docker commonly forwards.
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, _handler)


def run(config: Optional[BridgeConfig] = None) -> None:
    """Entry point used by the container CMD and unit tests."""

    # //1.- Resolve configuration from the environment when not explicitly provided.
    resolved_config = config or load_config_from_env()
    app = BridgeApplication(resolved_config)
    # //2.- Start the server and wire up signal handlers before blocking indefinitely.
    app.start()
    _install_signal_handlers(app)
    try:
        app.wait_forever()
    finally:
        # //3.- Guarantee the server is stopped even if the wait loop raises unexpectedly.
        app.stop()


def main() -> int:
    """Console script entry point invoked via ``python -m bot_runner``."""

    # //1.- Enable a default logging configuration suitable for container stdout capture.
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")
    run()
    # //2.- Return the conventional success code so Docker observes a clean exit.
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised via ``python -m`` execution
    raise SystemExit(main())

