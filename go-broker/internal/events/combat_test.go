package events

import (
	"testing"
	"time"

	pb "driftpursuit/broker/internal/proto/pb"
)

func TestCombatTelemetryToProto(t *testing.T) {
	//1.- Arrange a combat telemetry sample with rich data to exercise conversions.
	occurredAt := time.UnixMilli(1723420005123)
	telemetry := CombatTelemetry{
		SchemaVersion:    "0.2.0",
		EventID:          "evt-123",
		OccurredAt:       occurredAt,
		Kind:             pb.CombatEventKind_COMBAT_EVENT_KIND_DIRECT_HIT,
		AttackerEntityID: "vehicle-alpha",
		DefenderEntityID: "vehicle-bravo",
		Position:         Vector3{X: 1.5, Y: 2.5, Z: 3.5},
		Direction:        Vector3{X: 0.0, Y: 1.0, Z: 0.0},
		Damage:           DamageDetails{Amount: 42.5, Type: "plasma", Critical: true},
		Metadata: map[string]string{
			"weapon": "ion-cannon",
			"":       "ignore-me",
		},
	}

	//2.- Convert the telemetry snapshot into the protobuf wire representation.
	msg := telemetry.ToProto()

	//3.- Assert every field has been transferred without loss of fidelity.
	if msg.SchemaVersion != telemetry.SchemaVersion {
		t.Fatalf("expected schema version %q, got %q", telemetry.SchemaVersion, msg.SchemaVersion)
	}
	if msg.EventId != telemetry.EventID {
		t.Fatalf("expected event id %q, got %q", telemetry.EventID, msg.EventId)
	}
	if msg.OccurredAtMs != occurredAt.UnixMilli() {
		t.Fatalf("expected timestamp %d, got %d", occurredAt.UnixMilli(), msg.OccurredAtMs)
	}
	if msg.Kind != telemetry.Kind {
		t.Fatalf("unexpected kind: %v", msg.Kind)
	}
	if msg.AttackerEntityId != telemetry.AttackerEntityID {
		t.Fatalf("unexpected attacker id: %q", msg.AttackerEntityId)
	}
	if msg.DefenderEntityId != telemetry.DefenderEntityID {
		t.Fatalf("unexpected defender id: %q", msg.DefenderEntityId)
	}
	if msg.Position == nil || msg.Position.X != telemetry.Position.X {
		t.Fatalf("position mismatch: %+v", msg.Position)
	}
	if msg.Direction == nil || msg.Direction.Y != telemetry.Direction.Y {
		t.Fatalf("direction mismatch: %+v", msg.Direction)
	}
	if msg.Damage == nil || msg.Damage.Amount != telemetry.Damage.Amount {
		t.Fatalf("damage mismatch: %+v", msg.Damage)
	}
	if msg.Metadata["weapon"] != "ion-cannon" {
		t.Fatalf("expected metadata to retain weapon entry: %+v", msg.Metadata)
	}
	if _, exists := msg.Metadata[""]; exists {
		t.Fatalf("expected empty metadata key to be pruned")
	}
}
