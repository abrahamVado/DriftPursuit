package radar

import (
	"testing"

	pb "driftpursuit/broker/internal/proto/pb"
)

func TestProcessorBundlesContactsBySource(t *testing.T) {
	//1.- Arrange a frame containing contacts from multiple sources and targets.
	events := make(chan *pb.RadarContact, 4)
	processor := NewProcessor(events)
	frame := &pb.RadarFrame{
		SchemaVersion:   "1.0.0",
		EmitterEntityId: "emitter-alpha",
		Contacts: []*pb.RadarContact{
			{
				SchemaVersion:  "1.0.0",
				SourceEntityId: "radar-1",
				Entries: []*pb.RadarContactEntry{
					{
						TargetEntityId: "target-a",
						Position:       &pb.Vector3{X: 1, Y: 2, Z: 3},
						Velocity:       &pb.Vector3{X: 4, Y: 5, Z: 6},
						Confidence:     0.95,
						SuggestedTier:  pb.InterestTier_INTEREST_TIER_RADAR,
					},
				},
			},
			{
				SchemaVersion:  "1.0.0",
				SourceEntityId: "radar-1",
				Entries: []*pb.RadarContactEntry{
					{
						TargetEntityId: "target-b",
						Position:       &pb.Vector3{X: -1, Y: -2, Z: -3},
						Velocity:       &pb.Vector3{X: -4, Y: -5, Z: -6},
						Confidence:     0.5,
					},
				},
			},
			{
				SchemaVersion: "1.0.0",
				Entries: []*pb.RadarContactEntry{
					{
						TargetEntityId: "target-c",
						Confidence:     0.25,
						Occluded:       true,
					},
				},
			},
		},
	}

	//2.- Execute the processor and mutate the original frame to validate cloning.
	processor.Process(frame)
	frame.Contacts[0].Entries[0].Confidence = 0

	//3.- Collect the emitted bundles keyed by their source identifier.
	emitted := make(map[string]*pb.RadarContact)
	for len(events) > 0 {
		contact := <-events
		emitted[contact.GetSourceEntityId()] = contact
	}

	if len(emitted) != 2 {
		t.Fatalf("expected two bundled contacts, got %d", len(emitted))
	}

	radar1 := emitted["radar-1"]
	if radar1 == nil || len(radar1.GetEntries()) != 2 {
		t.Fatalf("expected radar-1 to have two entries, got %+v", radar1)
	}
	if radar1.GetEntries()[0].GetConfidence() != 0.95 {
		t.Fatalf("expected confidence cloning to protect source data")
	}

	fallback := emitted["emitter-alpha"]
	if fallback == nil || len(fallback.GetEntries()) != 1 {
		t.Fatalf("expected emitter fallback to aggregate one entry, got %+v", fallback)
	}
	if !fallback.GetEntries()[0].GetOccluded() {
		t.Fatalf("expected occlusion flag to propagate")
	}
}

func TestProcessorIgnoresMissingChannel(t *testing.T) {
	//1.- Create a processor with no event channel and a simple frame input.
	processor := NewProcessor(nil)
	frame := &pb.RadarFrame{Contacts: []*pb.RadarContact{{SourceEntityId: "radar", Entries: []*pb.RadarContactEntry{{TargetEntityId: "target"}}}}}

	//2.- Ensure Process returns without panicking when no channel is present.
	processor.Process(frame)
}
