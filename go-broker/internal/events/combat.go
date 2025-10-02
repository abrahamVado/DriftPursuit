package events

import (
	"time"

	pb "driftpursuit/broker/internal/proto/pb"
)

// Vector3 represents a 3D vector using float64 precision.
type Vector3 struct {
	X float64
	Y float64
	Z float64
}

// DamageDetails captures combat damage metrics.
type DamageDetails struct {
	Amount   float64
	Type     string
	Critical bool
}

// CombatTelemetry describes a combat event before protobuf serialization.
type CombatTelemetry struct {
	SchemaVersion    string
	EventID          string
	OccurredAt       time.Time
	Kind             pb.CombatEventKind
	AttackerEntityID string
	DefenderEntityID string
	Position         Vector3
	Direction        Vector3
	Damage           DamageDetails
	Metadata         map[string]string
}

// ToProto converts the combat telemetry into the protobuf CombatEvent message.
func (c CombatTelemetry) ToProto() *pb.CombatEvent {
	//1.- Clean the metadata map to avoid empty keys or nil maps leaking to clients.
	metadata := make(map[string]string, len(c.Metadata))
	for key, value := range c.Metadata {
		if key == "" {
			continue
		}
		metadata[key] = value
	}

	//2.- Assemble the protobuf CombatEvent with normalized vectors and damage snapshot.
	return &pb.CombatEvent{
		SchemaVersion:    c.SchemaVersion,
		EventId:          c.EventID,
		OccurredAtMs:     c.OccurredAt.UnixMilli(),
		Kind:             c.Kind,
		AttackerEntityId: c.AttackerEntityID,
		DefenderEntityId: c.DefenderEntityID,
		Position:         vectorToProto(c.Position),
		Direction:        vectorToProto(c.Direction),
		Damage: &pb.DamageSummary{
			Amount:   c.Damage.Amount,
			Type:     c.Damage.Type,
			Critical: c.Damage.Critical,
		},
		Metadata: metadata,
	}
}

func vectorToProto(v Vector3) *pb.Vector3 {
	//1.- Always allocate a vector so downstream code can rely on non-nil pointers.
	return &pb.Vector3{X: v.X, Y: v.Y, Z: v.Z}
}
