package events

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"

	pb "driftpursuit/broker/internal/proto/pb"
	"google.golang.org/protobuf/proto"
)

// Kind enumerates the supported gameplay event payloads carried by the stream.
type Kind string

const (
	KindCombat    Kind = "combat"
	KindRadar     Kind = "radar"
	KindRespawn   Kind = "respawn"
	KindLifecycle Kind = "lifecycle"
)

// Envelope carries the concrete protobuf payload together with sequencing metadata.
type Envelope struct {
	Sequence uint64
	Kind     Kind
	Combat   *pb.CombatEvent
	Radar    *pb.RadarContact
	Game     *pb.GameEvent
}

// Clone duplicates the underlying protobuf payloads so tests can mutate their copy safely.
func (e *Envelope) Clone() *Envelope {
	if e == nil {
		return nil
	}
	clone := *e
	if e.Combat != nil {
		if msg, ok := proto.Clone(e.Combat).(*pb.CombatEvent); ok {
			clone.Combat = msg
		}
	}
	if e.Radar != nil {
		if msg, ok := proto.Clone(e.Radar).(*pb.RadarContact); ok {
			clone.Radar = msg
		}
	}
	if e.Game != nil {
		if msg, ok := proto.Clone(e.Game).(*pb.GameEvent); ok {
			clone.Game = msg
		}
	}
	return &clone
}

// Config controls the retention policy for the stream log and subscriber buffers.
type Config struct {
	Retain int
}

// Default retention keeps the last 512 events if no explicit value is provided.
const defaultRetention = 512

// Stream coordinates ordered event delivery with at-least-once semantics per subscriber.
type Stream struct {
	mu          sync.Mutex
	nextSeq     uint64
	retention   int
	logOrder    []uint64
	logPayloads map[uint64]*Envelope
	subscribers map[string]*subscriberState
}

// subscriberState persists acknowledgement state between transient connections.
type subscriberState struct {
	id      string
	pending []uint64
	lastAck uint64
	ch      chan *Envelope
	active  bool
}

// Subscription exposes the event channel and acknowledgement helpers for a subscriber.
type Subscription struct {
	id     string
	stream *Stream
	events <-chan *Envelope
	once   sync.Once
}

// ErrOutOfOrderAck signals that a subscriber attempted to acknowledge future sequences.
var ErrOutOfOrderAck = errors.New("ack sequence must match the next pending event")

// NewStream constructs a stream using the provided configuration.
func NewStream(cfg Config) *Stream {
	retention := cfg.Retain
	if retention <= 0 {
		retention = defaultRetention
	}
	return &Stream{
		retention:   retention,
		logPayloads: make(map[uint64]*Envelope),
		subscribers: make(map[string]*subscriberState),
	}
}

// Subscribe attaches the logical subscriber to the stream and replays outstanding events.
func (s *Stream) Subscribe(ctx context.Context, subscriberID string, buffer int) (*Subscription, error) {
	if s == nil {
		return nil, errors.New("nil stream")
	}
	if subscriberID == "" {
		return nil, errors.New("subscriber id must be provided")
	}
	if buffer <= 0 {
		buffer = 32
	}

	s.mu.Lock()
	state := s.ensureSubscriberLocked(subscriberID)
	replay := s.collectReplayLocked(state)
	ch := make(chan *Envelope, buffer)
	state.ch = ch
	state.active = true
	state.pending = append([]uint64(nil), replay...)
	deliveries := s.prepareDeliveriesLocked(state, replay)
	s.mu.Unlock()

	go func() {
		// 1.- Replay any outstanding events immediately after subscription.
		for _, env := range deliveries {
			select {
			case <-ctx.Done():
				return
			case ch <- env:
			}
		}
	}()

	return &Subscription{id: subscriberID, stream: s, events: ch}, nil
}

// Events exposes the ordered delivery channel for the subscriber.
func (s *Subscription) Events() <-chan *Envelope {
	if s == nil {
		return nil
	}
	return s.events
}

// Ack informs the stream that the subscriber processed the given sequence.
func (s *Subscription) Ack(sequence uint64) error {
	if s == nil || s.stream == nil {
		return errors.New("subscription closed")
	}
	return s.stream.ack(s.id, sequence)
}

// Close marks the subscription as inactive while preserving acknowledgement state.
func (s *Subscription) Close() {
	if s == nil || s.stream == nil {
		return
	}
	s.once.Do(func() {
		s.stream.deactivateSubscriber(s.id)
	})
}

func (s *Stream) ensureSubscriberLocked(subscriberID string) *subscriberState {
	state, ok := s.subscribers[subscriberID]
	if !ok {
		state = &subscriberState{id: subscriberID}
		s.subscribers[subscriberID] = state
	}
	return state
}

func (s *Stream) collectReplayLocked(state *subscriberState) []uint64 {
	// 1.- When a subscriber reconnects we must replay any sequence greater than lastAck.
	replay := state.pending[:0]
	for _, seq := range s.logOrder {
		if seq <= state.lastAck {
			continue
		}
		replay = append(replay, seq)
	}
	return append([]uint64(nil), replay...)
}

func (s *Stream) prepareDeliveriesLocked(state *subscriberState, sequences []uint64) []*Envelope {
	deliveries := make([]*Envelope, 0, len(sequences))
	for _, seq := range sequences {
		if payload, ok := s.logPayloads[seq]; ok {
			deliveries = append(deliveries, payload.Clone())
		}
	}
	return deliveries
}

// PublishCombat converts the telemetry and enqueues it for reliable delivery.
func (s *Stream) PublishCombat(telemetry CombatTelemetry) (uint64, error) {
	if s == nil {
		return 0, errors.New("nil stream")
	}
	message := telemetry.ToProto()
	return s.publishEnvelope(&Envelope{Kind: KindCombat, Combat: message})
}

// PublishRadar enqueues bundled radar contacts.
func (s *Stream) PublishRadar(contact *pb.RadarContact) (uint64, error) {
	if s == nil {
		return 0, errors.New("nil stream")
	}
	if contact == nil {
		return 0, errors.New("radar contact required")
	}
	clone, ok := proto.Clone(contact).(*pb.RadarContact)
	if !ok {
		return 0, errors.New("radar contact clone failed")
	}
	return s.publishEnvelope(&Envelope{Kind: KindRadar, Radar: clone})
}

// PublishRespawn emits respawn notifications which are modelled as spawn game events.
func (s *Stream) PublishRespawn(event *pb.GameEvent) (uint64, error) {
	if s == nil {
		return 0, errors.New("nil stream")
	}
	if event == nil {
		return 0, errors.New("respawn event required")
	}
	if event.GetType() != pb.EventType_EVENT_TYPE_SPAWNED {
		return 0, fmt.Errorf("respawn must use SPAWNED type, got %v", event.GetType())
	}
	clone, ok := proto.Clone(event).(*pb.GameEvent)
	if !ok {
		return 0, errors.New("respawn clone failed")
	}
	return s.publishEnvelope(&Envelope{Kind: KindRespawn, Game: clone})
}

// PublishLifecycle captures other lifecycle transitions such as destruction or objective updates.
func (s *Stream) PublishLifecycle(event *pb.GameEvent) (uint64, error) {
	if s == nil {
		return 0, errors.New("nil stream")
	}
	if event == nil {
		return 0, errors.New("lifecycle event required")
	}
	switch event.GetType() {
	case pb.EventType_EVENT_TYPE_DESTROYED, pb.EventType_EVENT_TYPE_OBJECTIVE_CAPTURED, pb.EventType_EVENT_TYPE_SCORE_UPDATE:
	default:
		return 0, fmt.Errorf("unsupported lifecycle event type %v", event.GetType())
	}
	clone, ok := proto.Clone(event).(*pb.GameEvent)
	if !ok {
		return 0, errors.New("lifecycle clone failed")
	}
	return s.publishEnvelope(&Envelope{Kind: KindLifecycle, Game: clone})
}

func (s *Stream) publishEnvelope(envelope *Envelope) (uint64, error) {
	if envelope == nil {
		return 0, errors.New("envelope required")
	}

	s.mu.Lock()
	s.nextSeq++
	seq := s.nextSeq
	envelope.Sequence = seq
	s.logPayloads[seq] = envelope
	s.logOrder = append(s.logOrder, seq)

	deliveries := make([]delivery, 0, len(s.subscribers))
	for _, state := range s.subscribers {
		state.pending = append(state.pending, seq)
		if state.active && state.ch != nil {
			deliveries = append(deliveries, delivery{ch: state.ch, payload: envelope.Clone()})
		}
	}
	s.enforceRetentionLocked()
	s.mu.Unlock()

	for _, item := range deliveries {
		// 1.- Deliver asynchronously to avoid blocking the publisher on slow subscribers.
		select {
		case item.ch <- item.payload:
		default:
		}
	}

	return seq, nil
}

type delivery struct {
	ch      chan<- *Envelope
	payload *Envelope
}

func (s *Stream) enforceRetentionLocked() {
	// 1.- Determine the lowest acknowledgement across subscribers to retain necessary history.
	if len(s.logOrder) <= s.retention {
		return
	}
	minAck := s.nextSeq
	for _, state := range s.subscribers {
		if state.lastAck < minAck {
			minAck = state.lastAck
		}
	}
	cutoff := uint64(0)
	if len(s.logOrder) > s.retention {
		cutoff = s.logOrder[len(s.logOrder)-s.retention]
	}
	pruneBefore := minAck
	if cutoff < pruneBefore {
		pruneBefore = cutoff
	}
	if pruneBefore == 0 {
		return
	}
	idx := sort.Search(len(s.logOrder), func(i int) bool { return s.logOrder[i] > pruneBefore })
	for _, seq := range s.logOrder[:idx] {
		delete(s.logPayloads, seq)
	}
	s.logOrder = append([]uint64(nil), s.logOrder[idx:]...)
}

func (s *Stream) ack(subscriberID string, sequence uint64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, ok := s.subscribers[subscriberID]
	if !ok {
		return fmt.Errorf("unknown subscriber %q", subscriberID)
	}
	if len(state.pending) == 0 {
		if sequence <= state.lastAck {
			return nil
		}
		return ErrOutOfOrderAck
	}
	expected := state.pending[0]
	if sequence != expected {
		return ErrOutOfOrderAck
	}
	state.pending = state.pending[1:]
	state.lastAck = sequence
	s.enforceRetentionLocked()
	return nil
}

func (s *Stream) deactivateSubscriber(subscriberID string) {
	s.mu.Lock()
	state, ok := s.subscribers[subscriberID]
	if ok {
		state.active = false
		if state.ch != nil {
			close(state.ch)
			state.ch = nil
		}
	}
	s.mu.Unlock()
}
