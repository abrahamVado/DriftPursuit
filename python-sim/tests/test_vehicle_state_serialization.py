import pathlib
import sys

import pytest

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from driftpursuit_proto.go_broker.internal.proto import types_pb2, vehicle_pb2


def test_vehicle_state_round_trip() -> None:
    state = vehicle_pb2.VehicleState(
        schema_version="0.2.0",
        vehicle_id="veh-001",
        position=types_pb2.Vector3(x=1.0, y=2.0, z=3.0),
        velocity=types_pb2.Vector3(x=4.0, y=5.0, z=6.0),
        orientation=types_pb2.Orientation(yaw_deg=10.0, pitch_deg=5.0, roll_deg=1.0),
        angular_velocity=types_pb2.Vector3(x=0.1, y=0.2, z=0.3),
        speed_mps=123.4,
        throttle_pct=0.5,
        vertical_thrust_pct=-0.25,
        boost_pct=0.9,
        boost_active=True,
        flight_assist_enabled=True,
        energy_remaining_pct=0.75,
        updated_at_ms=123456789,
    )

    encoded = state.SerializeToString()
    decoded = vehicle_pb2.VehicleState.FromString(encoded)

    assert decoded.vehicle_id == state.vehicle_id
    assert decoded.orientation.yaw_deg == pytest.approx(10.0)
    assert decoded.throttle_pct == pytest.approx(0.5)
    assert decoded.position.x == pytest.approx(1.0)
