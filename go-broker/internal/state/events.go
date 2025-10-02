package state

import (
	"sync"

	pb "driftpursuit/broker/internal/proto/pb"
)

// EventDiff contains the batch of gameplay events ready for broadcast.
type EventDiff struct {
	Events []*pb.GameEvent
}

// EventStore buffers gameplay events until the next tick publishes them.
type EventStore struct {
	mu     sync.Mutex
	events []*pb.GameEvent
}

// NewEventStore constructs an event buffer.
func NewEventStore() *EventStore {
	return &EventStore{}
}

// Add enqueues a gameplay event for the next diff.
func (s *EventStore) Add(event *pb.GameEvent) {
	if s == nil || event == nil {
		return
	}

	clone := protoClone(event)
	s.mu.Lock()
	//1.- Append the cloned event while holding the mutex to ensure ordering.
	s.events = append(s.events, clone)
	s.mu.Unlock()
}

// ConsumeDiff flushes and returns the queued events.
func (s *EventStore) ConsumeDiff() EventDiff {
	if s == nil {
		return EventDiff{}
	}

	s.mu.Lock()
	//1.- Swap out the current slice with a fresh buffer for the next tick.
	events := s.events
	s.events = nil
	s.mu.Unlock()

	if len(events) == 0 {
		return EventDiff{}
	}

	//2.- Clone each event to prevent callers mutating the stored pointers.
	diff := make([]*pb.GameEvent, 0, len(events))
	for _, event := range events {
		diff = append(diff, protoClone(event))
	}
	return EventDiff{Events: diff}
}

// protoClone provides a minimal protobuf clone helper without importing proto in every file.
func protoClone(event *pb.GameEvent) *pb.GameEvent {
	if event == nil {
		return nil
	}
	clone := *event
	if event.Metadata != nil {
		clone.Metadata = make(map[string]string, len(event.Metadata))
		for key, value := range event.Metadata {
			clone.Metadata[key] = value
		}
	}
	if event.RelatedEntityIds != nil {
		clone.RelatedEntityIds = append([]string(nil), event.RelatedEntityIds...)
	}
	return &clone
}
