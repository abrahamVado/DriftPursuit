package radar

import (
	"context"
	"math"
	"sync"
	"time"

	"driftpursuit/broker/internal/gameplay"
	pb "driftpursuit/broker/internal/proto/pb"
	"driftpursuit/broker/internal/simulation"
)

const (
	defaultScanFrequencyHz = 4.0
	defaultFrameSchema     = "radar.v1"
)

// vehicleSource exposes the subset of vehicle store behaviour needed by the scanner.
type vehicleSource interface {
	Snapshot() []*pb.VehicleState
	LoadoutFor(vehicleID string) string
}

// Options configure how the scanner samples the authoritative world state.
type Options struct {
	Vehicles     vehicleSource
	Field        simulation.SignedDistanceField
	Handler      func(*pb.RadarFrame)
	Interval     time.Duration
	LastKnownTTL time.Duration
	Now          func() time.Time
}

type trackedContact struct {
	entry  *pb.RadarContactEntry
	seenAt time.Time
}

// Scanner periodically sweeps the vehicle roster and emits synthetic radar frames.
type Scanner struct {
	mu           sync.Mutex
	vehicles     vehicleSource
	field        simulation.SignedDistanceField
	handler      func(*pb.RadarFrame)
	interval     time.Duration
	lastKnownTTL time.Duration
	now          func() time.Time
	frameID      uint64
	lastContacts map[string]map[string]*trackedContact
	cancel       context.CancelFunc
	running      bool
	done         chan struct{}
}

// NewScanner wires the radar sweep pipeline using the provided configuration.
func NewScanner(opts Options) *Scanner {
	interval := opts.Interval
	if interval <= 0 {
		//1.- Convert the desired frequency into a tick interval while guarding against zero.
		interval = time.Duration(float64(time.Second) / defaultScanFrequencyHz)
		if interval <= 0 {
			interval = time.Second / 4
		}
	}
	ttl := opts.LastKnownTTL
	if ttl <= 0 {
		//2.- Retain stale contacts for a short window so HUDs can present last known tracks.
		ttl = 6 * time.Second
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	handler := opts.Handler
	if handler == nil {
		handler = func(*pb.RadarFrame) {}
	}
	return &Scanner{
		vehicles:     opts.Vehicles,
		field:        opts.Field,
		handler:      handler,
		interval:     interval,
		lastKnownTTL: ttl,
		now:          now,
		lastContacts: make(map[string]map[string]*trackedContact),
	}
}

// Start begins ticking radar sweeps until the context is cancelled or Stop is invoked.
func (s *Scanner) Start(ctx context.Context) {
	if s == nil {
		return
	}
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ticker := time.NewTicker(s.interval)
	derived, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	s.cancel = cancel
	s.done = done
	s.running = true
	s.mu.Unlock()

	go func() {
		defer close(done)
		defer ticker.Stop()
		for {
			select {
			case <-derived.Done():
				return
			case <-ticker.C:
				//1.- Perform a sweep on every tick to honour the 4 Hz cadence.
				s.sweep()
			}
		}
	}()
}

// Stop cancels the radar sweep loop and waits for the worker to exit.
func (s *Scanner) Stop() {
	if s == nil {
		return
	}
	s.mu.Lock()
	cancel := s.cancel
	done := s.done
	s.cancel = nil
	s.done = nil
	s.running = false
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

func (s *Scanner) sweep() {
	frame := s.buildFrame()
	if frame != nil {
		s.handler(frame)
	}
}

func (s *Scanner) buildFrame() *pb.RadarFrame {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.vehicles == nil {
		return nil
	}

	now := s.now()
	states := s.vehicles.Snapshot()
	if len(states) == 0 {
		//1.- Purge stale contacts when no observers are present in the world snapshot.
		s.pruneExpiredLocked(now)
		return nil
	}

	contacts := make([]*pb.RadarContact, 0, len(states))
	for _, observer := range states {
		if observer == nil || observer.VehicleId == "" || observer.GetPosition() == nil {
			continue
		}
		entries := s.collectEntriesLocked(observer, states, now)
		if len(entries) == 0 {
			continue
		}
		contact := &pb.RadarContact{
			SchemaVersion:  defaultFrameSchema,
			SourceEntityId: observer.VehicleId,
			Entries:        entries,
		}
		contacts = append(contacts, contact)
	}

	if len(contacts) == 0 {
		s.pruneExpiredLocked(now)
		return nil
	}

	s.frameID++
	frame := &pb.RadarFrame{
		SchemaVersion: defaultFrameSchema,
		FrameId:       s.frameID,
		CapturedAtMs:  now.UTC().UnixMilli(),
		Contacts:      contacts,
	}
	//2.- Trim any contact memory that exceeded the retention budget after building the frame.
	s.pruneExpiredLocked(now)
	return frame
}

func (s *Scanner) collectEntriesLocked(observer *pb.VehicleState, states []*pb.VehicleState, now time.Time) []*pb.RadarContactEntry {
	observerID := observer.GetVehicleId()
	if observerID == "" {
		return nil
	}
	tracked := s.ensureTrackerLocked(observerID)
	rangeMeters := gameplay.LoadoutRadarRange(s.vehicles.LoadoutFor(observerID))
	origin := toVec3(observer.GetPosition())
	entries := make([]*pb.RadarContactEntry, 0)
	touched := make(map[string]struct{})

	for _, target := range states {
		if target == nil || target.GetVehicleId() == "" {
			continue
		}
		if target.GetVehicleId() == observerID {
			continue
		}
		position := target.GetPosition()
		if position == nil {
			continue
		}
		delta := toVec3(position).Sub(origin)
		distance := delta.Length()
		if distance <= rangeMeters && !s.isOccluded(origin, toVec3(position), distance) {
			//1.- Track a freshly visible contact with maximum confidence.
			entry := s.buildLiveEntry(target)
			entries = append(entries, entry)
			tracked[target.GetVehicleId()] = &trackedContact{entry: cloneRadarEntry(entry), seenAt: now}
			touched[target.GetVehicleId()] = struct{}{}
			continue
		}
		if contact := tracked[target.GetVehicleId()]; contact != nil {
			if now.Sub(contact.seenAt) > s.lastKnownTTL {
				continue
			}
			//2.- Surface the cached last known state flagged as occluded or out of range.
			entry := cloneRadarEntry(contact.entry)
			if entry == nil {
				continue
			}
			entry.Occluded = true
			entry.Confidence = s.confidenceForAge(now.Sub(contact.seenAt))
			entries = append(entries, entry)
			touched[target.GetVehicleId()] = struct{}{}
		}
	}

	for targetID, contact := range tracked {
		if _, ok := touched[targetID]; ok {
			continue
		}
		if now.Sub(contact.seenAt) > s.lastKnownTTL {
			delete(tracked, targetID)
			continue
		}
		//3.- Preserve dormant contacts so HUDs can retain situational awareness overlays.
		entry := cloneRadarEntry(contact.entry)
		if entry == nil {
			continue
		}
		entry.Occluded = true
		entry.Confidence = s.confidenceForAge(now.Sub(contact.seenAt))
		entries = append(entries, entry)
	}

	return entries
}

func (s *Scanner) ensureTrackerLocked(observerID string) map[string]*trackedContact {
	tracker, ok := s.lastContacts[observerID]
	if !ok {
		tracker = make(map[string]*trackedContact)
		s.lastContacts[observerID] = tracker
	}
	return tracker
}

func (s *Scanner) pruneExpiredLocked(now time.Time) {
	ttl := s.lastKnownTTL
	for observer, tracker := range s.lastContacts {
		for target, contact := range tracker {
			if contact == nil {
				delete(tracker, target)
				continue
			}
			if now.Sub(contact.seenAt) > ttl {
				delete(tracker, target)
			}
		}
		if len(tracker) == 0 {
			delete(s.lastContacts, observer)
		}
	}
}

func (s *Scanner) confidenceForAge(age time.Duration) float64 {
	ttl := s.lastKnownTTL
	if ttl <= 0 {
		return 0
	}
	ratio := 1 - age.Seconds()/ttl.Seconds()
	if ratio <= 0 {
		return 0.1
	}
	return math.Max(0.1, ratio)
}

func (s *Scanner) buildLiveEntry(target *pb.VehicleState) *pb.RadarContactEntry {
	//1.- Clone position and velocity vectors to avoid aliasing shared protobuf instances.
	var position *pb.Vector3
	if target.GetPosition() != nil {
		position = &pb.Vector3{X: target.GetPosition().GetX(), Y: target.GetPosition().GetY(), Z: target.GetPosition().GetZ()}
	}
	var velocity *pb.Vector3
	if target.GetVelocity() != nil {
		velocity = &pb.Vector3{X: target.GetVelocity().GetX(), Y: target.GetVelocity().GetY(), Z: target.GetVelocity().GetZ()}
	}
	return &pb.RadarContactEntry{
		TargetEntityId: target.GetVehicleId(),
		Position:       position,
		Velocity:       velocity,
		Confidence:     1,
		Occluded:       false,
		SuggestedTier:  pb.InterestTier_INTEREST_TIER_RADAR,
	}
}

func (s *Scanner) isOccluded(origin, target simulation.Vec3, distance float64) bool {
	if s.field == nil {
		return false
	}
	hit, hitDistance, _ := simulation.Raycast(s.field, origin, target.Sub(origin), distance, 64, 0.25)
	if !hit {
		return false
	}
	//1.- Treat any intersection before the target range as an occluder.
	return hitDistance < distance-0.25
}

func toVec3(v *pb.Vector3) simulation.Vec3 {
	if v == nil {
		return simulation.Vec3{}
	}
	return simulation.Vec3{X: v.GetX(), Y: v.GetY(), Z: v.GetZ()}
}

func cloneRadarEntry(entry *pb.RadarContactEntry) *pb.RadarContactEntry {
	if entry == nil {
		return nil
	}
	clone := &pb.RadarContactEntry{
		TargetEntityId: entry.GetTargetEntityId(),
		Confidence:     entry.GetConfidence(),
		Occluded:       entry.GetOccluded(),
		SuggestedTier:  entry.GetSuggestedTier(),
	}
	if entry.GetPosition() != nil {
		clone.Position = &pb.Vector3{X: entry.GetPosition().GetX(), Y: entry.GetPosition().GetY(), Z: entry.GetPosition().GetZ()}
	}
	if entry.GetVelocity() != nil {
		clone.Velocity = &pb.Vector3{X: entry.GetVelocity().GetX(), Y: entry.GetVelocity().GetY(), Z: entry.GetVelocity().GetZ()}
	}
	return clone
}
