"""Minimal simulation client that sends telemetry to a DriftPursuit broker.

The client can optionally persist every telemetry and cake_drop payload to a log
file using ``--log-file`` (defaulting to JSON Lines output). Control the
simulation update frequency with ``--tick-rate`` (in Hertz) when you need
slower or faster loops than the 30 Hz default.
"""

import argparse
import math
import os
import json
import random
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional, Tuple, List, Sequence
from queue import Empty, Queue
from urllib.parse import urlparse

import numpy as np
from websocket import create_connection, WebSocketConnectionClosedException

from collision import CollisionSystem
from world import MapDescriptor, WorldStreamer
from navigation import (
    CruiseController,
    FlightPathPlanner,
    Waypoint,
    build_default_waypoints,
    load_waypoints_from_file,
)

DEFAULT_WS_URL = "ws://localhost:43127/ws"  # match Go broker default
DEFAULT_TICK_RATE = 30.0
MIN_TICK_RATE = 1.0
MAX_TICK_RATE = 240.0
ORIGIN_ENV_VAR = "SIM_ORIGIN"

PayloadLogger = Callable[[str], None]


@dataclass
class ManualOverrideState:
    enabled: bool = False
    velocity: np.ndarray = field(default_factory=lambda: np.zeros(3, dtype=float))
    orientation: Optional[List[float]] = None
    last_update: float = 0.0

    def disable(self) -> None:
        self.enabled = False
        self.velocity = np.zeros(3, dtype=float)
        self.orientation = None
        self.last_update = time.time()


def make_payload_logger(handle, log_format: str = "jsonl") -> PayloadLogger:
    """Return a callable that appends payloads to ``handle`` using ``log_format``."""
    normalized_format = (log_format or "jsonl").lower()

    def _logger(payload: str) -> None:
        if handle is None:
            return
        if normalized_format == "jsonl":
            handle.write(payload.rstrip("\n") + "\n")
        else:
            handle.write(payload if payload.endswith("\n") else payload + "\n")
        handle.flush()

    return _logger


class Plane:
    def __init__(self, id, x=0, y=0, z=1000, speed=120.0):
        self.id = id
        self.pos = np.array([x, y, z], dtype=float)
        self.vel = np.array([speed, 0, 0], dtype=float)
        self.ori = [0, 0, 0]
        self.tags = []
        self.manual_override = ManualOverrideState()

    def step(self, dt):
        """Advance the position using the current velocity vector."""
        self.pos += self.vel * dt


def mk_telemetry(plane, t):
    return json.dumps({
        "type": "telemetry",
        "id": plane.id,
        "t": t,
        "pos": [float(plane.pos[0]), float(plane.pos[1]), float(plane.pos[2])],
        "vel": [float(plane.vel[0]), float(plane.vel[1]), float(plane.vel[2])],
        "ori": plane.ori,
        "tags": plane.tags,
    })


def apply_noise(
    plane, rng: np.random.Generator, pos_noise: float, vel_noise: float
) -> Tuple[Optional[np.ndarray], Optional[np.ndarray]]:
    """Apply bounded uniform noise to the plane's position and velocity.

    Returns the generated deltas so callers can restore the original state
    after emitting telemetry.
    """
    if (pos_noise <= 0 and vel_noise <= 0) or rng is None:
        return None, None

    pos_delta: Optional[np.ndarray] = None
    vel_delta: Optional[np.ndarray] = None

    if pos_noise > 0:
        pos_delta = rng.uniform(-pos_noise, pos_noise, size=plane.pos.shape)
        plane.pos += pos_delta

    if vel_noise > 0:
        vel_delta = rng.uniform(-vel_noise, vel_noise, size=plane.vel.shape)
        plane.vel += vel_delta

    return pos_delta, vel_delta


def mk_cake_drop(plane, landing_pos=None, status="in_flight"):
    landing = landing_pos or [float(plane.pos[0] + 50), float(plane.pos[1] - 20), 0.0]
    landing = [float(component) for component in landing]
    return json.dumps({
        "type": "cake_drop",
        "id": f"cake-{int(time.time())}",
        "from": plane.id,
        "pos": [float(plane.pos[0]), float(plane.pos[1]), float(plane.pos[2])],
        "landing_pos": landing,
        "status": status,
    })


def send_command_status(ws, plane_id, command, status, detail=None, result=None):
    payload = {
        "type": "command_status",
        "cmd": command.get("cmd"),
        "status": status,
        "from": plane_id,
        "target_id": command.get("target_id") or plane_id,
        "id": plane_id,
    }
    if "command_id" in command:
        payload["command_id"] = command["command_id"]
    if detail:
        payload["detail"] = detail
    if result is not None:
        payload["result"] = result

    try:
        ws.send(json.dumps(payload))
    except Exception as exc:
        print("Failed to send command status:", exc)


def parse_waypoint_list(raw_waypoints):
    if not isinstance(raw_waypoints, list) or not raw_waypoints:
        raise ValueError("params.waypoints must be a non-empty list")

    waypoints = []
    for index, entry in enumerate(raw_waypoints):
        if not isinstance(entry, (list, tuple)) or len(entry) != 3:
            raise ValueError(f"waypoint #{index + 1} must be a list of three numbers")
        try:
            x, y, z = (float(entry[0]), float(entry[1]), float(entry[2]))
        except (TypeError, ValueError):
            raise ValueError(f"waypoint #{index + 1} contains non-numeric values")
        waypoints.append(Waypoint(x, y, z))

    return waypoints


def parse_float(params, key):
    if key not in params:
        return None
    value = params[key]
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"params.{key} must be a number")


def parse_vector3(params, key):
    if key not in params:
        return None
    value = params[key]
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"params.{key} must be a list of three numbers")
    try:
        return np.array([float(value[0]), float(value[1]), float(value[2])], dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"params.{key} must contain numeric values") from exc


def parse_orientation(params, key):
    if key not in params:
        return None
    value = params[key]
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"params.{key} must be a list of three numbers")
    try:
        return [float(value[0]), float(value[1]), float(value[2])]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"params.{key} must contain numeric values") from exc


def ensure_tag(tags: List[str], value: str, present: bool) -> None:
    if present:
        if value not in tags:
            tags.append(value)
    else:
        while value in tags:
            tags.remove(value)


def receiver_loop(ws, command_queue, stop_event: threading.Event):
    """Background loop to receive messages from broker and enqueue commands."""
    while not stop_event.is_set():
        try:
            raw_msg = ws.recv()
        except WebSocketConnectionClosedException:
            print("Receiver loop: connection closed")
            break
        except Exception as exc:
            if not stop_event.is_set():
                print("Receiver loop error:", exc)
            break

        if raw_msg is None:
            continue

        try:
            msg = json.loads(raw_msg)
        except json.JSONDecodeError:
            print("Receiver loop: invalid JSON", raw_msg)
            continue

        if msg.get("type") == "command":
            command_queue.put(msg)
            print("Receiver loop: queued command", msg)
        # else: ignore other message types

    stop_event.set()


def process_pending_commands(
    plane,
    planner,
    cruise,
    ws,
    command_queue: Queue,
    payload_logger: Optional[PayloadLogger],
    world_streamer: Optional[WorldStreamer] = None,
    collision_system: Optional[CollisionSystem] = None,
):
    while True:
        try:
            command = command_queue.get_nowait()
        except Empty:
            break
        handle_command(
            command,
            plane,
            planner,
            cruise,
            ws,
            payload_logger,
            world_streamer,
            collision_system,
        )


def handle_command(
    command,
    plane,
    planner,
    cruise,
    ws,
    payload_logger: Optional[PayloadLogger],
    world_streamer: Optional[WorldStreamer] = None,
    collision_system: Optional[CollisionSystem] = None,
):
    cmd_name = command.get("cmd")
    cmd_from = command.get("from")
    print(f"Handling command '{cmd_name}' from '{cmd_from}' with payload: {command}")

    params = command.get("params") or {}

    try:
        if cmd_name == "drop_cake":
            landing_override = params.get("landing_pos")
            payload = mk_cake_drop(plane, landing_override)
            ws.send(payload)
            if payload_logger:
                payload_logger(payload)
            print("Handled drop_cake command: dispatched cake_drop message")
            send_command_status(ws, plane.id, command, "ok", detail="cake_drop dispatched")

        elif cmd_name == "set_waypoints":
            waypoints = parse_waypoint_list(params.get("waypoints"))
            loop = params.get("loop")
            if loop is not None and not isinstance(loop, bool):
                raise ValueError("params.loop must be a boolean if provided")
            arrival = parse_float(params, "arrival_tolerance")
            planner.reset_path(waypoints, loop=loop, arrival_tolerance=arrival)
            result_payload = {
                "waypoint_count": len(waypoints),
                "first_waypoint": [waypoints[0].x, waypoints[0].y, waypoints[0].z],
                "loop": planner.loop,
                "arrival_tolerance": planner.arrival_tolerance,
            }
            send_command_status(ws, plane.id, command, "ok", detail="updated flight path", result=result_payload)

        elif cmd_name == "set_speed":
            acceleration = parse_float(params, "acceleration")
            max_speed = parse_float(params, "max_speed")
            cruise.update_parameters(acceleration=acceleration, max_speed=max_speed)
            result_payload = {}
            if acceleration is not None:
                result_payload["acceleration"] = cruise.acceleration
            if max_speed is not None:
                result_payload["max_speed"] = cruise.max_speed
            send_command_status(ws, plane.id, command, "ok", detail="updated cruise controller", result=result_payload)

        elif cmd_name == "manual_override":
            if "enabled" not in params:
                raise ValueError("params.enabled is required")

            enabled_value = params.get("enabled")
            if isinstance(enabled_value, bool):
                enabled = enabled_value
            elif isinstance(enabled_value, (int, float)):
                enabled = bool(enabled_value)
            else:
                raise ValueError("params.enabled must be a boolean")

            velocity = parse_vector3(params, "velocity")
            orientation = parse_orientation(params, "orientation")

            override = plane.manual_override
            result_payload = {"enabled": enabled}

            if enabled:
                if velocity is None:
                    raise ValueError("params.velocity is required when enabling manual override")
                override.enabled = True
                override.velocity = velocity
                override.orientation = orientation if orientation is not None else None
                override.last_update = time.time()
                ensure_tag(plane.tags, "manual:override", True)
                result_payload["velocity"] = [float(component) for component in velocity]
                if orientation is not None:
                    result_payload["orientation"] = orientation
                detail = "manual override enabled"
            else:
                override.disable()
                ensure_tag(plane.tags, "manual:override", False)
                if orientation is not None:
                    override.orientation = orientation
                result_payload["velocity"] = [float(component) for component in override.velocity]
                detail = "manual override disabled"

            send_command_status(ws, plane.id, command, "ok", detail=detail, result=result_payload)

        elif cmd_name == "set_map":
            if world_streamer is None or collision_system is None:
                raise ValueError("World streaming is unavailable")

            descriptor_payload = params.get("descriptor") or params.get("map")
            if not isinstance(descriptor_payload, dict):
                raise ValueError("params.descriptor must be a mapping")

            descriptor = MapDescriptor.from_mapping(descriptor_payload)
            world_streamer.apply_descriptor(descriptor)
            world_streamer.update(plane.pos[:2])
            adjusted_position, snapped = world_streamer.ensure_position_within_bounds(plane.pos)
            if snapped:
                plane.pos = adjusted_position
                plane.vel = np.zeros_like(plane.vel)

            collision_system.reset_world(
                spawn_position=plane.pos.copy(),
                spawn_orientation=plane.ori,
                ground_height_fn=world_streamer.sample_ground_height,
            )
            world_streamer.update(plane.pos[:2])

            result_payload = dict(world_streamer.summary())
            if snapped:
                result_payload["position"] = [float(component) for component in plane.pos]
                result_payload["snapped"] = True
            send_command_status(ws, plane.id, command, "ok", detail="map updated", result=result_payload)

        else:
            detail = f"No handler for command '{cmd_name}'"
            print(detail)
            send_command_status(ws, plane.id, command, "error", detail=detail)

    except ValueError as exc:
        print(f"Validation error while handling command '{cmd_name}':", exc)
        send_command_status(ws, plane.id, command, "error", detail=str(exc))
    except Exception as exc:
        print(f"Unexpected error while handling command '{cmd_name}':", exc)
        send_command_status(ws, plane.id, command, "error", detail=f"internal error: {exc}")


def resolve_waypoints(waypoints: Optional[Sequence[Waypoint]]) -> List[Waypoint]:
    """Return the waypoint list used by the autopilot."""
    if waypoints is None:
        return list(build_default_waypoints())
    return list(waypoints)


def tick_rate_to_interval(tick_rate_hz: float) -> float:
    """Convert a tick frequency in Hz to the corresponding interval in seconds."""

    return 1.0 / tick_rate_hz


def run(
    ws_url: str,
    origin: Optional[str] = None,
    *,
    waypoints: Optional[Sequence[Waypoint]] = None,
    log_file: Optional[str] = None,
    log_format: str = "jsonl",
    pos_noise: float = 0.0,
    vel_noise: float = 0.0,
    random_seed: Optional[int] = None,
    tick_rate_hz: float = DEFAULT_TICK_RATE,
):
    print("Connecting to", ws_url)
    p = Plane("plane-1", x=0, y=0, z=1200, speed=140.0)
    p.tags.append("pastel:turquoise")
    p.tags.append("autopilot:cruise")

    # Autopilot path (default or custom)
    waypoint_list = resolve_waypoints(waypoints)
    planner = FlightPathPlanner(waypoint_list, loop=True, arrival_tolerance=80.0)
    cruise = CruiseController(acceleration=18.0, max_speed=250.0)

    world_streamer = WorldStreamer()
    collision_system = CollisionSystem(
        spawn_position=p.pos.copy(),
        spawn_orientation=p.ori,
        start_time=time.time(),
        ground_height_fn=world_streamer.sample_ground_height,
    )
    world_streamer.update(p.pos[:2])

    rng = np.random.default_rng(random_seed)

    t0 = time.time()
    last_cake = -10.0
    backoff = 1.0
    max_backoff = 10.0
    should_stop = False

    log_handle = None
    payload_logger: Optional[PayloadLogger] = None

    if tick_rate_hz <= 0:
        raise ValueError("tick_rate_hz must be positive")

    tick_interval = tick_rate_to_interval(tick_rate_hz)

    try:
        if log_file:
            log_handle = open(log_file, "a", encoding="utf-8")
            payload_logger = make_payload_logger(log_handle, log_format)

        while not should_stop:
            ws = None
            stop_event = threading.Event()
            command_queue: Queue = Queue()
            receiver: Optional[threading.Thread] = None

            try:
                connect_kwargs = {}
                if origin:
                    connect_kwargs["origin"] = origin
                    print("Using origin", origin)

                print("Connecting to", ws_url)
                ws = create_connection(ws_url, **connect_kwargs)
                print("Connected to", ws_url)
                backoff = 1.0

                # Start background receiver
                receiver = threading.Thread(
                    target=receiver_loop, args=(ws, command_queue, stop_event), daemon=True
                )
                receiver.start()

                while not stop_event.is_set():
                    t = time.time() - t0

                    # Update autopilot first so telemetry mirrors controls.
                    desired_direction = planner.tick(p.pos, tick_interval)
                    if p.manual_override.enabled:
                        override = p.manual_override
                        p.vel = override.velocity.copy()
                        p.step(tick_interval)
                        if override.orientation is not None:
                            p.ori = list(override.orientation)
                        else:
                            p.ori = list(CruiseController.orientation_from_velocity(p.vel))
                    else:
                        p.vel = cruise.apply(p.vel, desired_direction, tick_interval)
                        p.ori = list(CruiseController.orientation_from_velocity(p.vel))
                        p.step(tick_interval)

                    # Handle collisions before processing commands so resets
                    # happen with the freshest aircraft state.
                    world_streamer.update(p.pos[:2])

                    hit, crashed = collision_system.handle_step(p, ensure_tag_fn=ensure_tag)
                    if crashed:
                        print("Collision detected – resetting aircraft to last safe checkpoint")

                    # Handle incoming commands
                    process_pending_commands(
                        p,
                        planner,
                        cruise,
                        ws,
                        command_queue,
                        payload_logger,
                        world_streamer,
                        collision_system,
                    )

                    # Send telemetry (with optional noise)
                    pos_delta, vel_delta = apply_noise(p, rng, pos_noise, vel_noise)
                    try:
                        payload = mk_telemetry(p, t)
                        ws.send(payload)
                        if payload_logger:
                            payload_logger(payload)
                    except WebSocketConnectionClosedException:
                        print("Connection closed while sending telemetry")
                        raise
                    finally:
                        # Restore state after noise
                        if pos_delta is not None:
                            p.pos -= pos_delta
                        if vel_delta is not None:
                            p.vel -= vel_delta

                    # Occasional cake drop
                    if (t - last_cake) > 8.0 and random.random() < 0.02:
                        last_cake = t
                        try:
                            cake_msg = mk_cake_drop(p)
                            ws.send(cake_msg)
                            if payload_logger:
                                payload_logger(cake_msg)
                            print("Sent cake_drop", cake_msg)
                        except WebSocketConnectionClosedException:
                            print("Connection closed while sending cake_drop")
                            raise
                        except Exception as e:
                            print("send cake err", e)

                    time.sleep(tick_interval)

            except KeyboardInterrupt:
                print("Stopping client")
                should_stop = True
            except WebSocketConnectionClosedException:
                print("Lost connection to server")
            except Exception as e:
                print("Connection error:", e)
            finally:
                # Signal receiver to stop and close socket
                stop_event.set()
                if ws is not None:
                    try:
                        ws.close()
                    except Exception:
                        pass
                if receiver is not None:
                    receiver.join(timeout=1.0)

            if should_stop:
                break

            print(f"Reconnecting in {backoff:.1f}s...")
            time.sleep(backoff)
            backoff = min(backoff * 2, max_backoff)

    finally:
        if log_handle is not None:
            try:
                log_handle.flush()
            finally:
                log_handle.close()


def non_negative_float(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"'{value}' is not a valid number") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("Noise values must be non-negative")
    return parsed


def tick_rate_value(value: str) -> float:
    try:
        rate = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"'{value}' is not a valid tick rate") from exc

    if not math.isfinite(rate):
        raise argparse.ArgumentTypeError("Tick rate must be a finite number")
    if rate <= 0:
        raise argparse.ArgumentTypeError("Tick rate must be positive")
    if rate < MIN_TICK_RATE or rate > MAX_TICK_RATE:
        raise argparse.ArgumentTypeError(
            f"Tick rate must be between {MIN_TICK_RATE:g} and {MAX_TICK_RATE:g} Hz"
        )
    return rate


def parse_args(argv: Optional[Sequence[str]] = None):
    parser = argparse.ArgumentParser(
        description=(
            "Minimal simulation client that sends telemetry and occasional "
            "cake_drop messages to a DriftPursuit broker, optionally logging "
            "each payload to disk."
        )
    )
    parser.add_argument(
        "--broker-url", "-b",
        help="WebSocket URL of the broker (overrides SIM_BROKER_URL).",
    )
    parser.add_argument(
        "--origin",
        help="HTTP(S) Origin to send during the WebSocket handshake (overrides SIM_ORIGIN).",
    )
    # Logging options
    parser.add_argument(
        "--log-file",
        help="Append every telemetry and cake_drop payload to this file.",
    )
    parser.add_argument(
        "--log-format",
        default="jsonl",
        help="Format to use for log entries when --log-file is provided (default: jsonl).",
    )
    # Noise + RNG
    parser.add_argument(
        "--pos-noise",
        type=non_negative_float,
        default=0.0,
        metavar="METERS",
        help="Maximum absolute positional noise in meters (default: 0.0).",
    )
    parser.add_argument(
        "--vel-noise",
        type=non_negative_float,
        default=0.0,
        metavar="MPS",
        help="Maximum absolute velocity noise in m/s (default: 0.0).",
    )
    parser.add_argument(
        "--random-seed",
        type=int,
        default=None,
        help="Seed for the telemetry noise RNG (default: random).",
    )
    parser.add_argument(
        "--tick-rate",
        type=tick_rate_value,
        default=DEFAULT_TICK_RATE,
        metavar="HZ",
        help=(
            "Simulation update frequency in Hertz (default: 30). "
            f"Valid range: {MIN_TICK_RATE:g}-{MAX_TICK_RATE:g}."
        ),
    )
    # Waypoints
    parser.add_argument(
        "--waypoints-file",
        help="Path to a JSON or YAML file describing a custom waypoint loop for the autopilot.",
    )
    return parser.parse_args(argv)


def get_ws_url(cli_url: Optional[str]) -> str:
    if cli_url:
        return cli_url
    env_url = os.getenv("SIM_BROKER_URL")
    if env_url:
        return env_url
    return DEFAULT_WS_URL


def derive_origin(ws_url: str) -> str:
    parsed = urlparse(ws_url)
    if not parsed.scheme:
        raise ValueError("Broker URL must include a scheme (ws:// or wss://)")
    if parsed.hostname is None:
        raise ValueError("Broker URL must include a host")

    origin_scheme = "https" if parsed.scheme == "wss" else "http"
    return f"{origin_scheme}://{parsed.hostname}"


def get_origin(cli_origin: Optional[str], ws_url: str) -> str:
    if cli_origin:
        return cli_origin
    env_origin = os.getenv(ORIGIN_ENV_VAR)
    if env_origin:
        return env_origin
    return derive_origin(ws_url)


if __name__ == '__main__':
    args = parse_args()
    ws_url = get_ws_url(args.broker_url)
    origin = get_origin(args.origin, ws_url)

    # Waypoints: file -> list -> pass to run
    waypoints = None
    if args.waypoints_file:
        waypoints = load_waypoints_from_file(args.waypoints_file)

    run(
        ws_url,
        origin,
        waypoints=waypoints,
        log_file=args.log_file,
        log_format=args.log_format,
        pos_noise=args.pos_noise,
        vel_noise=args.vel_noise,
        random_seed=args.random_seed,
        tick_rate_hz=args.tick_rate,
    )
