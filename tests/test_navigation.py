import math
import sys
from pathlib import Path

import numpy as np
import pytest

# Make the python-sim module importable when tests run from the repo root
SIM_PATH = Path(__file__).resolve().parents[1] / "python-sim"
if str(SIM_PATH) not in sys.path:
    sys.path.insert(0, str(SIM_PATH))

from navigation import CruiseController, FlightPathPlanner, Waypoint  # noqa: E402


class TestFlightPathPlanner:
    def test_loops_when_enabled(self):
        waypoints = [
            Waypoint(0.0, 0.0, 0.0),
            Waypoint(100.0, 0.0, 0.0),
        ]
        planner = FlightPathPlanner(waypoints, loop=True, arrival_tolerance=5.0)

        # Initially targeting the first waypoint.
        assert planner.current_target() == waypoints[0]

        # Reaching the first waypoint advances to the second.
        planner.advance_if_needed(np.array([0.0, 0.0, 0.0]))
        assert planner.current_target() == waypoints[1]

        # Reaching the final waypoint loops back to the first waypoint.
        planner.advance_if_needed(np.array([100.0, 0.0, 0.0]))
        assert planner.current_target() == waypoints[0]

    def test_respects_tolerance_and_stops_when_not_looping(self):
        waypoints = [
            Waypoint(0.0, 0.0, 0.0),
            Waypoint(100.0, 0.0, 0.0),
        ]
        planner = FlightPathPlanner(waypoints, loop=False, arrival_tolerance=10.0)

        # Outside the tolerance radius -> still targeting the first waypoint.
        planner.advance_if_needed(np.array([50.0, 0.0, 0.0]))
        assert planner.current_target() == waypoints[0]

        # Within tolerance -> advance to the final waypoint.
        planner.advance_if_needed(np.array([2.0, 0.0, 0.0]))
        assert planner.current_target() == waypoints[1]

        # Once the last waypoint is reached the planner keeps targeting it.
        planner.advance_if_needed(np.array([100.0, 0.0, 0.0]))
        assert planner.current_target() == waypoints[1]


class TestCruiseController:
    def test_converges_towards_desired_heading(self):
        controller = CruiseController(
            acceleration=40.0,
            max_speed=150.0,
            heading_lerp=0.5,
            climb_lerp=0.5,
        )
        velocity = np.array([120.0, 0.0, 0.0])
        desired = np.array([0.0, 1.0, 0.0])

        for _ in range(25):
            velocity = controller.apply(velocity, desired, dt=0.1)

        planar_speed = np.linalg.norm(velocity[:2])
        assert planar_speed > 0
        cos_angle = np.dot(velocity[:2], desired[:2]) / (planar_speed * np.linalg.norm(desired[:2]))
        angle = math.acos(np.clip(cos_angle, -1.0, 1.0))
        assert angle < math.radians(12)

    def test_respects_max_speed_limit(self):
        controller = CruiseController(acceleration=300.0, max_speed=90.0)
        velocity = np.zeros(3)
        desired = np.array([1.0, 0.0, 0.0])

        for _ in range(10):
            velocity = controller.apply(velocity, desired, dt=1.0)
            speed = np.linalg.norm(velocity)
            assert speed <= controller.max_speed + 1e-6

        assert pytest.approx(controller.max_speed, rel=1e-2) == np.linalg.norm(velocity)


class TestOrientationFromVelocity:
    def test_zero_velocity_returns_neutral_orientation(self):
        assert CruiseController.orientation_from_velocity(np.zeros(3)) == [0.0, 0.0, 0.0]

    def test_vertical_climb_alignment(self):
        yaw, pitch, roll = CruiseController.orientation_from_velocity(np.array([0.0, 0.0, 10.0]))
        assert yaw == pytest.approx(0.0, abs=1e-7)
        assert pitch == pytest.approx(math.pi / 2, rel=1e-7)
        assert roll == pytest.approx(0.0, abs=1e-7)

