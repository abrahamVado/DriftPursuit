package radar

import (
	"sync"

	pb "driftpursuit/broker/internal/proto/pb"
	"google.golang.org/protobuf/proto"
)

// Processor receives radar frames and emits bundled contacts per source.
type Processor struct {
	mu     sync.Mutex
	events chan<- *pb.RadarContact
}

// NewProcessor constructs a radar processor that delivers events to the provided channel.
func NewProcessor(events chan<- *pb.RadarContact) *Processor {
	return &Processor{events: events}
}

// Process groups the frame contacts by source and forwards aggregated events.
func (p *Processor) Process(frame *pb.RadarFrame) {
	//1.- Guard against missing dependencies so callers can invoke the processor safely.
	if p == nil || frame == nil || len(frame.GetContacts()) == 0 {
		return
	}

	//2.- Aggregate contacts by their originating source identifier.
	bundles := make(map[string]*pb.RadarContact)
	for _, contact := range frame.GetContacts() {
		if contact == nil {
			continue
		}
		sourceID := contact.GetSourceEntityId()
		if sourceID == "" {
			sourceID = frame.GetEmitterEntityId()
		}
		if sourceID == "" {
			continue
		}
		bundle, exists := bundles[sourceID]
		if !exists {
			bundle = &pb.RadarContact{
				SchemaVersion:  contact.GetSchemaVersion(),
				SourceEntityId: sourceID,
			}
			if bundle.SchemaVersion == "" {
				bundle.SchemaVersion = frame.GetSchemaVersion()
			}
			bundles[sourceID] = bundle
		}
		if bundle.SchemaVersion == "" && contact.GetSchemaVersion() != "" {
			bundle.SchemaVersion = contact.GetSchemaVersion()
		}
		for _, entry := range contact.GetEntries() {
			if entry == nil {
				continue
			}
			bundle.Entries = append(bundle.Entries, cloneEntry(entry))
		}
	}

	//3.- Emit each aggregated bundle to the downstream event channel.
	for _, bundle := range bundles {
		if bundle == nil || len(bundle.GetEntries()) == 0 {
			continue
		}
		p.dispatch(bundle)
	}
}

func (p *Processor) dispatch(bundle *pb.RadarContact) {
	if p == nil || bundle == nil || p.events == nil {
		return
	}
	//1.- Clone the bundle so downstream consumers own independent data copies.
	clone, ok := proto.Clone(bundle).(*pb.RadarContact)
	if !ok {
		return
	}
	//2.- Deliver the clone without blocking slow consumers.
	p.mu.Lock()
	defer p.mu.Unlock()
	select {
	case p.events <- clone:
	default:
	}
}

func cloneEntry(entry *pb.RadarContactEntry) *pb.RadarContactEntry {
	if entry == nil {
		return nil
	}
	//1.- Duplicate the nested vectors when present to avoid pointer aliasing.
	var position *pb.Vector3
	if v := entry.GetPosition(); v != nil {
		position = &pb.Vector3{X: v.GetX(), Y: v.GetY(), Z: v.GetZ()}
	}
	//2.- Duplicate the velocity vector to keep snapshots immutable downstream.
	var velocity *pb.Vector3
	if v := entry.GetVelocity(); v != nil {
		velocity = &pb.Vector3{X: v.GetX(), Y: v.GetY(), Z: v.GetZ()}
	}
	//3.- Rebuild the contact entry with copied scalar fields.
	return &pb.RadarContactEntry{
		TargetEntityId: entry.GetTargetEntityId(),
		Position:       position,
		Velocity:       velocity,
		Confidence:     entry.GetConfidence(),
		Occluded:       entry.GetOccluded(),
		SuggestedTier:  entry.GetSuggestedTier(),
	}
}
