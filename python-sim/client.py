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


def process_pending_commands(plane, ws, command_queue: Queue):
    while True:
        try:
            command = command_queue.get_nowait()
        except Empty:
            break
        handle_command(command, plane, ws)


def handle_command(command, plane, ws):
    cmd_name = command.get("cmd")
    cmd_from = command.get("from")
    print(f"Handling command '{cmd_name}' from '{cmd_from}' with payload: {command}")

    if cmd_name == "drop_cake":
        landing_override = command.get("params", {}).get("landing_pos")
        try:
            ws.send(mk_cake_drop(plane, landing_override))
            print("Handled drop_cake command: dispatched cake_drop message")
        except Exception as exc:
            print("Failed to send cake_drop in response to command:", exc)
    else:
        print(f"No handler for command '{cmd_name}', ignoring")


def run(ws_url: str, origin: Optional[str] = None):
    print("Connecting to", ws_url)
    p = Plane("plane-1", x=0, y=0, z=1200, speed=140.0)
    p.tags.append("pastel:turquoise")

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
                p.step(TICK)

                # Handle incoming commands from broker
                process_pending_commands(p, ws, command_queue)

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
