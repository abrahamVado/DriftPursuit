# python-sim/client.py
# Minimal simulation client that sends telemetry and occasional cake_drop messages to ws://localhost:8080/ws
import json
import random
import threading
import time
from queue import Empty, Queue

import numpy as np
from websocket import WebSocketConnectionClosedException, create_connection

WS_URL = "ws://localhost:8080/ws"
TICK = 1.0/30.0

class Plane:
    def __init__(self, id, x=0,y=0,z=1000, speed=120.0):
        self.id = id
        self.pos = np.array([x,y,z], dtype=float)
        self.vel = np.array([speed,0,0], dtype=float)
        self.ori = [0,0,0]
        self.tags = []

    def step(self, dt):
        self.pos += self.vel * dt

def mk_telemetry(plane, t):
    return json.dumps({
        "type":"telemetry",
        "id": plane.id,
        "t": t,
        "pos": [float(plane.pos[0]), float(plane.pos[1]), float(plane.pos[2])],
        "vel": [float(plane.vel[0]), float(plane.vel[1]), float(plane.vel[2])],
        "ori": plane.ori,
        "tags": plane.tags
    })

def mk_cake_drop(plane, landing_pos=None, status="in_flight"):
    landing = landing_pos or [float(plane.pos[0] + 50), float(plane.pos[1] - 20), 0.0]
    landing = [float(component) for component in landing]
    return json.dumps({
        "type":"cake_drop",
        "id": f"cake-{int(time.time())}",
        "from": plane.id,
        "pos": [float(plane.pos[0]), float(plane.pos[1]), float(plane.pos[2])],
        "landing_pos": landing,
        "status": status,
    })

def receiver_loop(ws, command_queue, stop_event):
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

        msg_type = msg.get("type")
        if msg_type == "command":
            command_queue.put(msg)
            print("Receiver loop: queued command", msg)
        else:
            print(f"Receiver loop: ignoring unsupported message type '{msg_type}'")

    stop_event.set()

def process_pending_commands(plane, ws, command_queue):
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

def run():
    print("Connecting to", WS_URL)
    try:
        ws = create_connection(WS_URL)
    except Exception as e:
        print("Failed to connect:", e)
        return
    p = Plane("plane-1", x=0, y=0, z=1200, speed=140.0)
    p.tags.append("pastel:turquoise")
    t0 = time.time()
    last_cake = -10.0
    stop_event = threading.Event()
    command_queue = Queue()
    receiver = threading.Thread(target=receiver_loop, args=(ws, command_queue, stop_event), daemon=True)
    receiver.start()
    try:
        while not stop_event.is_set():
            t = time.time() - t0
            p.step(TICK)
            process_pending_commands(p, ws, command_queue)
            try:
                ws.send(mk_telemetry(p, t))
            except WebSocketConnectionClosedException:
                print("Connection closed"); break
            # simple cake drop every ~8-12s randomly
            if (t - last_cake) > 8.0 and random.random() < 0.02:
                last_cake = t
                try:
                    cake_msg = mk_cake_drop(p)
                    ws.send(cake_msg)
                    print("Sent cake_drop", cake_msg)
                except Exception as e:
                    print("send cake err", e)
            time.sleep(TICK)
    finally:
        stop_event.set()
        ws.close()
        receiver.join(timeout=1.0)

if __name__ == '__main__':
    run()
