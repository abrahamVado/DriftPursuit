package radar

import (
	"sync"
	"testing"
	"time"

	pb "driftpursuit/broker/internal/proto/pb"
	"driftpursuit/broker/internal/simulation"
)

type stubVehicles struct {
	mu       sync.Mutex
	states   []*pb.VehicleState
	loadouts map[string]string
}

func (s *stubVehicles) Snapshot() []*pb.VehicleState {
	s.mu.Lock()
	defer s.mu.Unlock()
	//1.- Clone the stored states to emulate the production vehicle store behaviour.
	clones := make([]*pb.VehicleState, 0, len(s.states))
	for _, state := range s.states {
		if state == nil {
			continue
		}
		clones = append(clones, protoClone(state))
	}
	return clones
}

func (s *stubVehicles) LoadoutFor(vehicleID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loadouts == nil {
		return ""
	}
	return s.loadouts[vehicleID]
}

func protoClone(state *pb.VehicleState) *pb.VehicleState {
	if state == nil {
		return nil
	}
	//1.- Copy scalar fields and duplicate the nested vectors that the scanner reads.
	clone := *state
	if state.Position != nil {
		clone.Position = &pb.Vector3{X: state.Position.X, Y: state.Position.Y, Z: state.Position.Z}
	}
	if state.Velocity != nil {
		clone.Velocity = &pb.Vector3{X: state.Velocity.X, Y: state.Velocity.Y, Z: state.Velocity.Z}
	}
	return &clone
}

func TestScannerEmitsVisibleContacts(t *testing.T) {
	//1.- Seed a simple world with an observer and target inside the configured radar range.
	vehicles := &stubVehicles{
		states: []*pb.VehicleState{
			{VehicleId: "observer", Position: &pb.Vector3{X: 0, Y: 0, Z: 0}},
			{VehicleId: "target", Position: &pb.Vector3{X: 500, Y: 0, Z: 0}},
		},
		loadouts: map[string]string{"observer": "skiff-raider"},
	}

	var frames []*pb.RadarFrame
	//2.- Capture emitted frames so assertions can inspect the synthetic contacts.
	scanner := NewScanner(Options{Vehicles: vehicles, Handler: func(frame *pb.RadarFrame) {
		frames = append(frames, frame)
	}, Now: func() time.Time { return time.UnixMilli(0) }})

	scanner.sweep()

	if len(frames) != 1 {
		t.Fatalf("expected one frame, got %d", len(frames))
	}
	var observerContact *pb.RadarContact
	for _, contact := range frames[0].GetContacts() {
		if contact.GetSourceEntityId() == "observer" {
			observerContact = contact
			break
		}
	}
	if observerContact == nil {
		t.Fatalf("expected observer contact bundle")
	}
	if len(observerContact.GetEntries()) != 1 {
		t.Fatalf("expected single entry for observer, got %d", len(observerContact.GetEntries()))
	}
	entry := observerContact.GetEntries()[0]
	if entry.GetTargetEntityId() != "target" {
		t.Fatalf("unexpected target id %q", entry.GetTargetEntityId())
	}
	if entry.GetOccluded() {
		t.Fatalf("visible contact should not be occluded")
	}
	if entry.GetConfidence() != 1 {
		t.Fatalf("expected full confidence, got %.2f", entry.GetConfidence())
	}
}

func TestScannerMaintainsLastKnownWhenOccluded(t *testing.T) {
	now := time.UnixMilli(0)
	//1.- Start with the target visible so the scanner records an initial last known position.
	vehicles := &stubVehicles{
		states: []*pb.VehicleState{
			{VehicleId: "observer", Position: &pb.Vector3{X: 0, Y: 0, Z: 0}},
			{VehicleId: "target", Position: &pb.Vector3{X: 500, Y: 0, Z: 0}},
		},
		loadouts: map[string]string{"observer": "skiff-strike"},
	}
	var frames []*pb.RadarFrame
	field := simulation.SphereField{Center: simulation.Vec3{X: 250, Y: 0, Z: 0}, Radius: 25}
	//2.- Inject an occluding SDF on the second sweep to force reliance on the cached contact.
	scanner := NewScanner(Options{Vehicles: vehicles, Handler: func(frame *pb.RadarFrame) {
		frames = append(frames, frame)
	}, Now: func() time.Time { return now }})

	scanner.sweep()
	if len(frames) == 0 {
		t.Fatalf("expected initial frame")
	}
	frames = frames[:0]

	now = now.Add(250 * time.Millisecond)
	scanner.field = field
	scanner.sweep()

	if len(frames) != 1 {
		t.Fatalf("expected occluded frame, got %d", len(frames))
	}
	var occludedEntry *pb.RadarContactEntry
	for _, contact := range frames[0].GetContacts() {
		if contact.GetSourceEntityId() != "observer" {
			continue
		}
		if len(contact.GetEntries()) == 0 {
			continue
		}
		occludedEntry = contact.GetEntries()[0]
		break
	}
	if occludedEntry == nil {
		t.Fatalf("expected occluded entry for observer")
	}
	if !occludedEntry.GetOccluded() {
		t.Fatalf("expected occluded flag to be set")
	}
	if occludedEntry.GetConfidence() >= 1 {
		t.Fatalf("expected degraded confidence, got %.2f", occludedEntry.GetConfidence())
	}
	if occludedEntry.GetPosition().GetX() != 500 {
		t.Fatalf("last known position should be retained, got %.2f", occludedEntry.GetPosition().GetX())
	}
}

func TestScannerExpiresDormantContacts(t *testing.T) {
	now := time.UnixMilli(0)
	//1.- Configure the scanner with a short retention window to simplify the expiry check.
	vehicles := &stubVehicles{
		states: []*pb.VehicleState{
			{VehicleId: "observer", Position: &pb.Vector3{X: 0, Y: 0, Z: 0}},
			{VehicleId: "target", Position: &pb.Vector3{X: 500, Y: 0, Z: 0}},
		},
		loadouts: map[string]string{"observer": "skiff-strike"},
	}
	field := simulation.SphereField{Center: simulation.Vec3{X: 250, Y: 0, Z: 0}, Radius: 25}
	var frames []*pb.RadarFrame
	scanner := NewScanner(Options{Vehicles: vehicles, Handler: func(frame *pb.RadarFrame) {
		frames = append(frames, frame)
	}, LastKnownTTL: 500 * time.Millisecond, Now: func() time.Time { return now }})

	scanner.sweep()
	frames = frames[:0]

	now = now.Add(100 * time.Millisecond)
	scanner.field = field
	scanner.sweep()
	if len(frames) != 1 {
		t.Fatalf("expected occluded frame before expiry")
	}
	frames = frames[:0]

	now = now.Add(time.Second)
	vehicles.mu.Lock()
	vehicles.states = vehicles.states[:1]
	vehicles.mu.Unlock()
	scanner.sweep()

	if len(frames) != 0 {
		t.Fatalf("expected no frames after last known expiry, got %d", len(frames))
	}
}
