"""HTTP bridge exposing simulation control primitives."""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Dict, Optional, Tuple
from urllib.parse import urlparse

LOGGER = logging.getLogger(__name__)


@dataclass
class BridgeState:
    """Container describing the simulation state returned by the bridge."""

    # //1.- Track a monotonically increasing identifier representing the simulation tick.
    tick_id: int = 0
    # //2.- Expose the captured timestamp so clients can interpolate updates.
    captured_at_ms: float = 0.0
    # //3.- Store a mapping of vehicle identifiers to lightweight telemetry dictionaries.
    vehicles: Dict[str, Dict[str, float]] = field(default_factory=dict)


def default_state_provider() -> BridgeState:
    """Return a placeholder state payload while the real simulation integration is wired up."""

    # //1.- Capture the current time once to ensure consistent timestamps within the payload.
    now_ms = time.time() * 1000.0
    # //2.- Populate the placeholder telemetry with a single vehicle parked at the origin.
    vehicles = {
        "demo_vehicle": {
            "x": 0.0,
            "y": 0.0,
            "z": 0.0,
            "speed": 0.0,
        }
    }
    # //3.- Return the bridge state featuring the static telemetry and a dummy tick identifier.
    return BridgeState(tick_id=0, captured_at_ms=now_ms, vehicles=vehicles)


class SimulationControlServer:
    """Threaded HTTP server exposing simulation handshake, state, and command endpoints."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 0,
        state_provider: Callable[[], BridgeState] = default_state_provider,
        command_handler: Optional[Callable[[Dict[str, object]], None]] = None,
    ) -> None:
        # //1.- Persist constructor arguments so the HTTP handler can query state and dispatch commands.
        self._host = host
        self._port = port
        self._state_provider = state_provider
        self._command_handler = command_handler or self._record_last_command
        # //2.- Internal bookkeeping ensures we can expose diagnostics to tests and other tooling.
        self._httpd: Optional[ThreadingHTTPServer] = None
        self._serve_thread: Optional[threading.Thread] = None
        self._last_command_lock = threading.Lock()
        self._last_command: Optional[Dict[str, object]] = None

    @property
    def address(self) -> Tuple[str, int]:
        """Return the socket binding once the server is running."""

        # //1.- Ensure the server has been started before exposing the bind address.
        if not self._httpd:
            raise RuntimeError("Server is not running")
        # //2.- Return the canonical host and port tuple the HTTP daemon resolved to.
        return self._httpd.server_address  # type: ignore[return-value]

    def start(self) -> None:
        """Launch the HTTP server on a background thread."""

        # //1.- Guard against accidental double starts that would leak sockets and threads.
        if self._httpd is not None:
            raise RuntimeError("Server already running")

        # //2.- Manufacture a request handler class bound to this server instance.
        server_ref = self

        class RequestHandler(BaseHTTPRequestHandler):
            # //1.- Explicitly disable the default logging to keep test output quiet.
            def log_message(self, format: str, *args: object) -> None:  # type: ignore[override]
                LOGGER.debug("web_bridge: %s", format % args)

            def _set_headers(self, status: HTTPStatus, content_type: str = "application/json") -> None:
                # //1.- Emit the HTTP status line and base headers shared across responses.
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")

            def _write_json(self, payload: Dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
                # //1.- Serialise the payload and flush it to the client with the appropriate headers.
                body = json.dumps(payload).encode("utf-8")
                self._set_headers(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self) -> None:  # type: ignore[override]
                # //1.- Respond to CORS preflight checks without invoking the provider or handler.
                self._set_headers(HTTPStatus.NO_CONTENT)
                self.end_headers()

            def do_GET(self) -> None:  # type: ignore[override]
                # //1.- Normalise the request path to strip query strings before routing.
                path = urlparse(self.path).path
                if path == "/handshake":
                    # //2.- Confirm to the client that the bridge is reachable and ready.
                    payload = {
                        "status": "ok",
                        "message": "Simulation bridge online",
                    }
                    self._write_json(payload)
                    return
                if path == "/state":
                    try:
                        # //3.- Request the latest telemetry snapshot from the provider.
                        snapshot = server_ref._state_provider()
                        payload = {
                            "status": "ok",
                            "tickId": snapshot.tick_id,
                            "capturedAtMs": snapshot.captured_at_ms,
                            "vehicles": snapshot.vehicles,
                        }
                        self._write_json(payload)
                    except Exception as exc:  # noqa: BLE001
                        LOGGER.exception("Failed to gather simulation state")
                        self._write_json(
                            {"status": "error", "message": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR
                        )
                    return
                # //4.- Return a not found response for any unrecognised path.
                self._write_json({"status": "error", "message": "Not found"}, status=HTTPStatus.NOT_FOUND)

            def do_POST(self) -> None:  # type: ignore[override]
                # //1.- Restrict POST handling to the command endpoint and reject others.
                path = urlparse(self.path).path
                if path != "/command":
                    self._write_json({"status": "error", "message": "Not found"}, status=HTTPStatus.NOT_FOUND)
                    return
                try:
                    # //2.- Read and decode the JSON payload carrying the command details.
                    content_length = int(self.headers.get("Content-Length", "0"))
                    raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
                    command_payload = json.loads(raw_body.decode("utf-8") or "{}")
                    # //3.- Forward the command to the registered handler so the simulation can react.
                    server_ref._command_handler(command_payload)
                    response = {"status": "ok", "command": command_payload}
                    self._write_json(response)
                except json.JSONDecodeError as exc:
                    # //4.- Handle malformed JSON gracefully so the client receives actionable feedback.
                    self._write_json(
                        {"status": "error", "message": f"Invalid JSON payload: {exc}"},
                        status=HTTPStatus.BAD_REQUEST,
                    )
                except Exception as exc:  # noqa: BLE001
                    LOGGER.exception("Command handler failed")
                    self._write_json(
                        {"status": "error", "message": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR
                    )

        # //3.- Instantiate the HTTP daemon bound to the requested interface and port.
        self._httpd = ThreadingHTTPServer((self._host, self._port), RequestHandler)
        # //4.- Capture the resolved port number in case the caller requested an ephemeral port.
        self._port = self._httpd.server_address[1]
        # //5.- Run the server loop on a dedicated daemon thread so tests can stop it quickly.
        self._serve_thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._serve_thread.start()

    def stop(self) -> None:
        """Terminate the HTTP server and wait for the thread to exit."""

        # //1.- Exit gracefully when stop is invoked before the server has been started.
        if self._httpd is None:
            return
        # //2.- Ask the HTTP daemon to shut down and join the background thread for cleanliness.
        self._httpd.shutdown()
        self._httpd.server_close()
        if self._serve_thread:
            self._serve_thread.join(timeout=2.0)
        # //3.- Reset the internal state so the instance can be started again if needed.
        self._httpd = None
        self._serve_thread = None

    def last_command(self) -> Optional[Dict[str, object]]:
        """Return the most recent command observed by the default handler."""

        # //1.- Synchronise access to the shared state to keep multi-threaded reads safe.
        with self._last_command_lock:
            return dict(self._last_command) if self._last_command is not None else None

    def _record_last_command(self, payload: Dict[str, object]) -> None:
        """Default handler that records the incoming command for later inspection."""

        # //1.- Persist the payload so tests can confirm that commands were routed correctly.
        with self._last_command_lock:
            self._last_command = dict(payload)


def _run_default_server() -> None:
    """Launch the bridge server with the default provider when executed as a script."""

    # //1.- Instantiate the server and begin listening for HTTP traffic.
    server = SimulationControlServer()
    server.start()
    host, port = server.address
    LOGGER.info("Simulation control server listening on http://%s:%s", host, port)
    try:
        # //2.- Keep the main thread alive so the daemon can continue serving requests.
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        LOGGER.info("Stopping simulation control server")
    finally:
        # //3.- Ensure resources are reclaimed when the process exits.
        server.stop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    _run_default_server()
