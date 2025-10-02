import pathlib
import sys

import pytest

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from driftpursuit_proto.go_broker.internal.proto import events_pb2, types_pb2


def test_combat_event_round_trip() -> None:
    # 1.- Arrange a combat event populated with nested vectors and metadata.
    event = events_pb2.CombatEvent(
        schema_version="0.2.0",
        event_id="evt-9000",
        occurred_at_ms=1700000000123,
        kind=events_pb2.CombatEventKind.COMBAT_EVENT_KIND_SHIELD_BREAK,
        attacker_entity_id="unit-001",
        defender_entity_id="unit-002",
        position=types_pb2.Vector3(x=5.0, y=10.0, z=15.0),
        direction=types_pb2.Vector3(x=0.0, y=0.0, z=-1.0),
        damage=events_pb2.DamageSummary(amount=12.5, type="explosive", critical=False),
        metadata={"weapon": "rocket", "impact_zone": "aft"},
    )

    # 2.- Serialize to bytes and immediately parse to emulate broker exchange.
    encoded = event.SerializeToString()
    decoded = events_pb2.CombatEvent.FromString(encoded)

    # 3.- Validate the decoded message preserves the original field values.
    assert decoded.kind == events_pb2.CombatEventKind.COMBAT_EVENT_KIND_SHIELD_BREAK
    assert decoded.damage.amount == pytest.approx(12.5)
    assert decoded.metadata["impact_zone"] == "aft"
    assert decoded.position.z == pytest.approx(15.0)
