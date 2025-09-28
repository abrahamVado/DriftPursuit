# python-sim/client.py
# Minimal simulation client that sends telemetry and occasional cake_drop messages to ws://localhost:8080/ws

import argparse
import os
from typing import Optional
import json
import random
import threading
import time
from queue import Empty, Queue
from urllib.parse import urlparse

import numpy as np
from websocket import create_connection, WebSocketConnectionClosedException

from navigation import (
    CruiseController,
    FlightPathPlanner,
    Waypoint,
    build_default_waypoints,
)

DEFAULT_WS_URL = "ws://localhost:8080/ws"
TICK = 1.0 / 30.0
ORIGIN_ENV_VAR = "SIM_ORIGIN"


class Plane:
    def __init__(self, id, x=0, y=0, z=1000, speed=120.0):
        self.id = id
        self.pos = np.array([x, y, z], dtype=float)
        self.vel = np.array([speed, 0, 0], dtype=float)
        self.ori = [0, 0, 0]
        self.tags = []

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


def process_pending_commands(plane, planner, cruise, ws, command_queue: Queue):
    while True:
        try:
            command = command_queue.get_nowait()
        except Empty:
            break
        handle_command(command, plane, planner, cruise, ws)


def handle_command(command, plane, planner, cruise, ws):
    cmd_name = command.get("cmd")
    cmd_from = command.get("from")
    print(f"Handling command '{cmd_name}' from '{cmd_from}' with payload: {command}")

    params = command.get("params") or {}

    try:
        if cmd_name == "drop_cake":
            landing_override = params.get("landing_pos")
            ws.send(mk_cake_drop(plane, landing_override))
            print("Handled drop_cake command: dispatched cake_drop message")
            send_command_status(
                ws,
                plane.id,
                command,
                "ok",
                detail="cake_drop dispatched",
            )
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
            send_command_status(
                ws,
                plane.id,
                command,
                "ok",
                detail="updated flight path",
                result=result_payload,
            )
        elif cmd_name == "set_speed":
            acceleration = parse_float(params, "acceleration")
            max_speed = parse_float(params, "max_speed")
            cruise.update_parameters(acceleration=acceleration, max_speed=max_speed)
            result_payload = {}
            if acceleration is not None:
                result_payload["acceleration"] = cruise.acceleration
            if max_speed is not None:
                result_payload["max_speed"] = cruise.max_speed
            send_command_status(
                ws,
                plane.id,
                command,
                "ok",
                detail="updated cruise controller",
                result=result_payload,
            )
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


def run(ws_url: str, origin: Optional[str] = None):
    print("Connecting to", ws_url)
    p = Plane("plane-1", x=0, y=0, z=1200, speed=140.0)
    p.tags.append("pastel:turquoise")
    p.tags.append("autopilot:cruise")

    # Build a deterministic loop around the new scenic environment so the
    # aircraft continuously showcases the parallax of the buildings and trees.
    planner = FlightPathPlanner(build_default_waypoints(), loop=True, arrival_tolerance=80.0)
    cruise = CruiseController(acceleration=18.0, max_speed=250.0)

    t0 = time.time()
    last_cake = -10.0
    backoff = 1.0
    max_backoff = 10.0
    should_stop = False

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
            receiver = threading.Thread(target=receiver_loop, args=(ws, command_queue, stop_event), daemon=True)
            receiver.start()

            while not stop_event.is_set():
                t = time.time() - t0
                # Update the autopilot before moving the aircraft so the
                # telemetry matches the controls shown in the viewer.
                desired_direction = planner.tick(p.pos, TICK)
                p.vel = cruise.apply(p.vel, desired_direction, TICK)
                p.ori = list(CruiseController.orientation_from_velocity(p.vel))
                p.step(TICK)

                # Handle incoming commands from broker
                process_pending_commands(p, planner, cruise, ws, command_queue)

                # Send telemetry
                try:
                    ws.send(mk_telemetry(p, t))
                except WebSocketConnectionClosedException:
                    print("Connection closed while sending telemetry")
                    raise

                # Occasional cake drop
                if (t - last_cake) > 8.0 and random.random() < 0.02:
                    last_cake = t
                    try:
                        cake_msg = mk_cake_drop(p)
                        ws.send(cake_msg)
                        print("Sent cake_drop", cake_msg)
                    except WebSocketConnectionClosedException:
                        print("Connection closed while sending cake_drop")
                        raise
                    except Exception as e:
                        print("send cake err", e)

                time.sleep(TICK)

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


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Minimal simulation client that sends telemetry and occasional "
            "cake_drop messages to a DriftPursuit broker."
        )
    )
    parser.add_argument(
        "--broker-url",
        "-b",
        help=(
            "WebSocket URL of the broker to connect to. Overrides the "
            "SIM_BROKER_URL environment variable."
        ),
    )
    parser.add_argument(
        "--origin",
        help=(
            "HTTP(S) origin to send during the WebSocket handshake. Overrides "
            "the SIM_ORIGIN environment variable."
        ),
    )
    return parser.parse_args()


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

    if parsed.scheme == "wss":
        origin_scheme = "https"
    else:
        origin_scheme = "http"

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
    run(ws_url, origin)
