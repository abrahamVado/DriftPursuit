"""Flight model behavioral tests covering control modes and boost."""
from __future__ import annotations

from tunnelcave_sandbox.src.gameplay.flight import ControlMode, FlightInput, FlightParameters, integrate_flight, spawn_state
from tunnelcave_sandbox.src.gameplay.terrain import TerrainSampler


def test_arcade_mode_tracks_aim_direction() -> None:
    sampler = TerrainSampler(8)
    params = FlightParameters()
    state = spawn_state(position=(0.0, 200.0, 0.0))
    aim = (0.0, 0.2, 1.0)
    inputs = FlightInput(mode=ControlMode.ARCADE, aim_direction=aim)
    next_state = integrate_flight(state, inputs, sampler, params, dt=0.1)
    assert next_state.orientation.forward[1] > state.orientation.forward[1]


def test_direct_controls_apply_roll_with_speed_scaling() -> None:
    sampler = TerrainSampler(9)
    params = FlightParameters()
    state = spawn_state(position=(0.0, 250.0, 0.0))
    high_speed_state = integrate_flight(state, FlightInput(mode=ControlMode.DIRECT, pitch=0.0, roll=0.0, yaw=0.0), sampler, params, dt=0.5)
    inputs = FlightInput(mode=ControlMode.DIRECT, roll=1.0)
    next_state = integrate_flight(high_speed_state, inputs, sampler, params, dt=0.2)
    assert abs(next_state.bank_angle) > abs(high_speed_state.bank_angle)


def test_boost_increases_forward_velocity() -> None:
    sampler = TerrainSampler(10)
    params = FlightParameters()
    state = spawn_state(position=(0.0, 180.0, 0.0))
    inputs = FlightInput(mode=ControlMode.DIRECT, throttle_delta=1.0, boost=True)
    boosted = integrate_flight(state, inputs, sampler, params, dt=0.5)
    assert boosted.velocity[2] > state.velocity[2]
