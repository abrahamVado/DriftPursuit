"""Tests for the command processing helpers used by the simulation client."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from queue import Queue


THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.append(str(THIS_DIR))

import client  # noqa: E402  - imported after path adjustments
from navigation import (  # noqa: E402
    CruiseController,
    FlightPathPlanner,
    build_default_waypoints,
)


class DummyWebSocket:
    """Capture messages that would normally be sent over the network."""

    def __init__(self) -> None:
        self.sent_messages: list[str] = []

    def send(self, message: str) -> None:
        self.sent_messages.append(message)


def _build_sim_context():
    plane = client.Plane("plane-1")
    planner = FlightPathPlanner(build_default_waypoints(), loop=True, arrival_tolerance=80.0)
    cruise = CruiseController(acceleration=18.0, max_speed=250.0)
    ws = DummyWebSocket()
    queue: Queue = Queue()
    return plane, planner, cruise, ws, queue


def _last_status(ws: DummyWebSocket) -> dict:
    status_payloads = []
    for raw in ws.sent_messages:
        payload = json.loads(raw)
        if payload.get("type") == "command_status":
            status_payloads.append(payload)
    assert status_payloads, "expected at least one command_status message"
    return status_payloads[-1]


def test_process_pending_commands_handles_drop_cake():
    plane, planner, cruise, ws, queue = _build_sim_context()
    queue.put({"type": "command", "cmd": "drop_cake", "from": "tester", "params": {}})

    client.process_pending_commands(plane, planner, cruise, ws, queue)

    assert len(ws.sent_messages) == 2
    cake = json.loads(ws.sent_messages[0])
    assert cake["type"] == "cake_drop"
    status = _last_status(ws)
    assert status["cmd"] == "drop_cake"
    assert status["status"] == "ok"


def test_set_waypoints_command_updates_planner():
    plane, planner, cruise, ws, queue = _build_sim_context()
    new_waypoints = [[10, 20, 30], [40, 50, 60]]
    queue.put(
        {
            "type": "command",
            "cmd": "set_waypoints",
            "from": "tester",
            "params": {"waypoints": new_waypoints, "loop": False, "arrival_tolerance": 42},
        }
    )

    client.process_pending_commands(plane, planner, cruise, ws, queue)

    target = planner.current_target()
    assert (target.x, target.y, target.z) == (10.0, 20.0, 30.0)
    status = _last_status(ws)
    assert status["cmd"] == "set_waypoints"
    assert status["status"] == "ok"
    assert status["result"]["waypoint_count"] == len(new_waypoints)
    assert status["result"]["loop"] is False
    assert status["result"]["arrival_tolerance"] == 42.0


def test_set_speed_command_updates_cruise_controller():
    plane, planner, cruise, ws, queue = _build_sim_context()
    queue.put(
        {
            "type": "command",
            "cmd": "set_speed",
            "from": "tester",
            "params": {"max_speed": 310, "acceleration": 25},
        }
    )

    client.process_pending_commands(plane, planner, cruise, ws, queue)

    assert cruise.max_speed == 310
    assert cruise.acceleration == 25
    status = _last_status(ws)
    assert status["cmd"] == "set_speed"
    assert status["status"] == "ok"
    assert status["result"]["max_speed"] == 310
    assert status["result"]["acceleration"] == 25
