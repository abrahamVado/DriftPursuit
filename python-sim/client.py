# python-sim/client.py
# Minimal simulation client that sends telemetry and occasional cake_drop messages to ws://localhost:8080/ws
import time, json, math, random
from websocket import create_connection, WebSocketConnectionClosedException
import numpy as np

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
    try:
        while True:
            t = time.time() - t0
            p.step(TICK)
            try:
                ws.send(mk_telemetry(p, t))
            except WebSocketConnectionClosedException:
                print("Connection closed"); break
            # simple cake drop every ~8-12s randomly
            if (t - last_cake) > 8.0 and random.random() < 0.02:
                last_cake = t
                cake_msg = json.dumps({
                    "type":"cake_drop",
                    "id": f"cake-{int(t)}",
                    "from": p.id,
                    "pos": [float(p.pos[0]), float(p.pos[1]), float(p.pos[2])],
                    "landing_pos": [float(p.pos[0]+50), float(p.pos[1]-20), 0.0],
                    "status":"in_flight"
                })
                try:
                    ws.send(cake_msg)
                    print("Sent cake_drop", cake_msg)
                except Exception as e:
                    print("send cake err", e)
            time.sleep(TICK)
    finally:
        ws.close()

if __name__ == '__main__':
    run()
