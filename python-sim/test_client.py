"""Tests for the command processing helpers used by the simulation client."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from queue import Queue

import numpy as np
import pytest


THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.append(str(THIS_DIR))

import client  # noqa: E402  - imported after path adjustments
from collision import CollisionSystem  # noqa: E402
from navigation import (  # noqa: E402
    CruiseController,
    FlightPathPlanner,
    build_default_waypoints,
)
from world import WorldStreamer  # noqa: E402


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
    streamer = WorldStreamer()
    collision_system = CollisionSystem(
        spawn_position=plane.pos.copy(),
        spawn_orientation=plane.ori,
        ground_height_fn=streamer.sample_ground_height,
    )
    streamer.update(plane.pos[:2])
    return plane, planner, cruise, ws, queue, streamer, collision_system


def _last_status(ws: DummyWebSocket) -> dict:
    status_payloads = []
    for raw in ws.sent_messages:
        payload = json.loads(raw)
        if payload.get("type") == "command_status":
            status_payloads.append(payload)
    assert status_payloads, "expected at least one command_status message"
    return status_payloads[-1]


def _send_command(
    plane,
    planner,
    cruise,
    ws,
    queue,
    payload_logger,
    streamer,
    collision_system,
):
    client.process_pending_commands(
        plane,
        planner,
        cruise,
        ws,
        queue,
        payload_logger,
        streamer,
        collision_system,
    )


def test_process_pending_commands_handles_drop_cake():
    plane, planner, cruise, ws, queue, streamer, collision_system = _build_sim_context()
    queue.put({"type": "command", "cmd": "drop_cake", "from": "tester", "params": {}})

    _send_command(plane, planner, cruise, ws, queue, None, streamer, collision_system)

    assert len(ws.sent_messages) == 2
    cake = json.loads(ws.sent_messages[0])
    assert cake["type"] == "cake_drop"
    status = _last_status(ws)
    assert status["cmd"] == "drop_cake"
    assert status["status"] == "ok"


def test_set_waypoints_command_updates_planner():
    plane, planner, cruise, ws, queue, streamer, collision_system = _build_sim_context()
    new_waypoints = [[10, 20, 30], [40, 50, 60]]
    queue.put(
        {
            "type": "command",
            "cmd": "set_waypoints",
            "from": "tester",
            "params": {"waypoints": new_waypoints, "loop": False, "arrival_tolerance": 42},
        }
    )

    _send_command(plane, planner, cruise, ws, queue, None, streamer, collision_system)

    target = planner.current_target()
    assert (target.x, target.y, target.z) == (10.0, 20.0, 30.0)
    status = _last_status(ws)
    assert status["cmd"] == "set_waypoints"
    assert status["status"] == "ok"
    assert status["result"]["waypoint_count"] == len(new_waypoints)
    assert status["result"]["loop"] is False
    assert status["result"]["arrival_tolerance"] == 42.0


def test_set_speed_command_updates_cruise_controller():
    plane, planner, cruise, ws, queue, streamer, collision_system = _build_sim_context()
    queue.put(
        {
            "type": "command",
            "cmd": "set_speed",
            "from": "tester",
            "params": {"max_speed": 310, "acceleration": 25},
        }
    )

    _send_command(plane, planner, cruise, ws, queue, None, streamer, collision_system)

    assert cruise.max_speed == 310
    assert cruise.acceleration == 25
    status = _last_status(ws)
    assert status["cmd"] == "set_speed"
    assert status["status"] == "ok"
    assert status["result"]["max_speed"] == 310
    assert status["result"]["acceleration"] == 25


def test_set_map_command_updates_world_streamer():
    plane, planner, cruise, ws, queue, streamer, collision_system = _build_sim_context()
    plane.pos[:] = np.array([400.0, 400.0, 50.0])

    descriptor = {
        "id": "test_map",
        "type": "tilemap",
        "tileSize": 100,
        "visibleRadius": 1,
        "tiles": [
            {"coords": [0, 0], "baseHeight": 10.0},
        ],
        "fallback": {"type": "none"},
    }

    queue.put({"type": "command", "cmd": "set_map", "from": "tester", "params": {"descriptor": descriptor}})

    _send_command(plane, planner, cruise, ws, queue, None, streamer, collision_system)

    status = _last_status(ws)
    assert status["cmd"] == "set_map"
    assert status["status"] == "ok"
    assert status["result"]["map_id"] == "test_map"
    assert streamer.descriptor.id == "test_map"

    ground = streamer.sample_ground_height(0.0, 0.0)
    assert ground == pytest.approx(10.0)

    # Plane was outside bounds, so it should have been clamped near the tile center
    assert plane.pos[0] == pytest.approx(5.0)
    assert plane.pos[1] == pytest.approx(5.0)
    assert plane.pos[2] >= ground + 120.0


def test_parse_args_defaults_to_30_hz_tick():
    args = client.parse_args([])

    assert args.tick_rate == client.DEFAULT_TICK_RATE
    assert client.tick_rate_to_interval(args.tick_rate) == pytest.approx(1.0 / 30.0)


def test_parse_args_allows_tick_rate_override():
    args = client.parse_args(["--tick-rate", "60"])

    assert args.tick_rate == 60.0
    assert client.tick_rate_to_interval(args.tick_rate) == pytest.approx(1.0 / 60.0)


def test_parse_args_rejects_invalid_tick_rate(capfd):
    with pytest.raises(SystemExit):
        client.parse_args(["--tick-rate", "0"])
    err = capfd.readouterr().err
    assert "Tick rate must be positive" in err

    with pytest.raises(SystemExit):
        client.parse_args(["--tick-rate", "5000"])
    err = capfd.readouterr().err
    assert "Tick rate must be between" in err
