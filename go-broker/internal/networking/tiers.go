package networking

import (
	"math"
	"sort"
	"sync"

	pb "driftpursuit/broker/internal/proto/pb"
	"google.golang.org/protobuf/proto"
)

const (
	defaultNearbyRangeMeters   = 600.0
	defaultRadarRangeMeters    = 3000.0
	defaultExtendedRangeMeters = 9000.0
)

// TierConfig controls how the broker converts spatial information into
// subscription tiers for each observer.
type TierConfig struct {
	NearbyRangeMeters   float64
	RadarRangeMeters    float64
	ExtendedRangeMeters float64
}

// DefaultTierConfig returns the production defaults used by the broker.
func DefaultTierConfig() TierConfig {
	return TierConfig{
		NearbyRangeMeters:   defaultNearbyRangeMeters,
		RadarRangeMeters:    defaultRadarRangeMeters,
		ExtendedRangeMeters: defaultExtendedRangeMeters,
	}
}

// TierBuckets groups entities by the interest tier assigned to a subscriber.
type TierBuckets map[pb.InterestTier][]*pb.EntitySnapshot

// clone returns a deep copy of the tier buckets so callers cannot mutate the
// internal state managed by the tier manager.
func (b TierBuckets) clone() TierBuckets {
	if b == nil {
		return nil
	}
	clone := make(TierBuckets, len(b))
	for tier, entities := range b {
		if len(entities) == 0 {
			continue
		}
		clonedEntities := make([]*pb.EntitySnapshot, len(entities))
		for i, entity := range entities {
			if entity == nil {
				continue
			}
			if msg, ok := proto.Clone(entity).(*pb.EntitySnapshot); ok {
				clonedEntities[i] = msg
			}
		}
		clone[tier] = clonedEntities
	}
	return clone
}

// TierManager maintains the most recent observer and entity states so that it
// can bucket entities into interest tiers using spatial heuristics.
type TierManager struct {
	mu sync.RWMutex

	config TierConfig

	observers map[string]*pb.ObserverState
	entities  map[string]*pb.EntitySnapshot
	buckets   map[string]TierBuckets

	radarHints map[string]pb.InterestTier
}

// NewTierManager constructs a TierManager using the provided configuration.
func NewTierManager(cfg TierConfig) *TierManager {
	cfg = normalizeConfig(cfg)
	return &TierManager{
		config:     cfg,
		observers:  make(map[string]*pb.ObserverState),
		entities:   make(map[string]*pb.EntitySnapshot),
		buckets:    make(map[string]TierBuckets),
		radarHints: make(map[string]pb.InterestTier),
	}
}

// UpdateObserver stores the most recent observer state for the provided key.
// The key typically maps to a websocket client.
func (m *TierManager) UpdateObserver(key string, state *pb.ObserverState) {
	if m == nil || key == "" || state == nil {
		return
	}
	clone := cloneObserver(state)
	if clone.ObserverId == "" {
		clone.ObserverId = key
	}

	m.mu.Lock()
	m.observers[key] = clone
	m.recomputeLocked()
	m.mu.Unlock()
}

// RemoveObserver discards the cached state for the provided observer key.
func (m *TierManager) RemoveObserver(key string) {
	if m == nil || key == "" {
		return
	}
	m.mu.Lock()
	delete(m.observers, key)
	delete(m.buckets, key)
	m.mu.Unlock()
}

// UpdateEntity stores the latest snapshot for an entity and recomputes the tier
// assignments for all observers.
func (m *TierManager) UpdateEntity(snapshot *pb.EntitySnapshot) {
	if m == nil || snapshot == nil || snapshot.EntityId == "" {
		return
	}
	clone := cloneEntity(snapshot)

	m.mu.Lock()
	m.entities[clone.EntityId] = clone
	m.recomputeLocked()
	m.mu.Unlock()
}

// RemoveEntity evicts the entity from all tier buckets.
func (m *TierManager) RemoveEntity(entityID string) {
	if m == nil || entityID == "" {
		return
	}
	m.mu.Lock()
	delete(m.entities, entityID)
	for observer, buckets := range m.buckets {
		if len(buckets) == 0 {
			continue
		}
		for tier, entities := range buckets {
			filtered := entities[:0]
			for _, entity := range entities {
				if entity.GetEntityId() == entityID {
					continue
				}
				filtered = append(filtered, entity)
			}
			if len(filtered) == 0 {
				delete(buckets, tier)
			} else {
				buckets[tier] = filtered
			}
		}
		if len(buckets) == 0 {
			delete(m.buckets, observer)
		} else {
			m.buckets[observer] = buckets
		}
	}
	m.mu.Unlock()
}

// ApplyRadarFrame ingests sensor contacts and folds the suggested tiers into
// future bucket computations.
func (m *TierManager) ApplyRadarFrame(frame *pb.RadarFrame) {
	if m == nil || frame == nil {
		return
	}
	m.mu.Lock()
	for _, contact := range frame.Contacts {
		if contact == nil || contact.EntityId == "" {
			continue
		}
		if contact.SuggestedTier == pb.InterestTier_INTEREST_TIER_UNSPECIFIED {
			continue
		}
		m.radarHints[contact.EntityId] = contact.SuggestedTier
	}
	m.recomputeLocked()
	m.mu.Unlock()
}

// IngestWorldSnapshot seeds the manager with the entities carried in a
// world-snapshot payload.
func (m *TierManager) IngestWorldSnapshot(snapshot *pb.WorldSnapshot) {
	if m == nil || snapshot == nil {
		return
	}
	m.mu.Lock()
	for _, entity := range snapshot.Entities {
		if entity == nil || entity.EntityId == "" {
			continue
		}
		m.entities[entity.EntityId] = cloneEntity(entity)
	}
	m.recomputeLocked()
	m.mu.Unlock()
}

// Buckets returns a copy of the cached tier buckets for the supplied observer.
func (m *TierManager) Buckets(observerKey string) TierBuckets {
	if m == nil || observerKey == "" {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.buckets[observerKey].clone()
}

// TierAssignments materialises the computed assignments across all observers so
// they can be embedded into snapshot payloads.
func (m *TierManager) TierAssignments() []*pb.TierAssignment {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	assignments := make([]*pb.TierAssignment, 0)
	for observer, buckets := range m.buckets {
		for tier, entities := range buckets {
			for _, entity := range entities {
				if entity == nil {
					continue
				}
				assignments = append(assignments, &pb.TierAssignment{
					SchemaVersion: entity.SchemaVersion,
					ObserverId:    observer,
					EntityId:      entity.GetEntityId(),
					Tier:          tier,
					ComputedAtMs:  entity.GetCapturedAtMs(),
				})
			}
		}
	}
	return assignments
}

func (m *TierManager) recomputeLocked() {
	if m == nil {
		return
	}
	for observerKey, observer := range m.observers {
		buckets := make(TierBuckets)
		for _, entity := range m.entities {
			if entity == nil || entity.EntityId == "" {
				continue
			}
			tier := m.classify(observer, entity)
			if tier == pb.InterestTier_INTEREST_TIER_UNSPECIFIED {
				continue
			}
			cloned := cloneEntity(entity)
			buckets[tier] = append(buckets[tier], cloned)
		}
		for tier := range buckets {
			sort.Slice(buckets[tier], func(i, j int) bool {
				return buckets[tier][i].GetEntityId() < buckets[tier][j].GetEntityId()
			})
		}
		if len(buckets) == 0 {
			delete(m.buckets, observerKey)
			continue
		}
		m.buckets[observerKey] = buckets
	}
}

func (m *TierManager) classify(observer *pb.ObserverState, entity *pb.EntitySnapshot) pb.InterestTier {
	if entity == nil {
		return pb.InterestTier_INTEREST_TIER_UNSPECIFIED
	}
	if observer != nil && entity.GetEntityId() != "" && entity.GetEntityId() == observer.GetObserverId() {
		return pb.InterestTier_INTEREST_TIER_SELF
	}
	if !entity.GetActive() {
		return pb.InterestTier_INTEREST_TIER_PASSIVE
	}

	cfg := m.config
	if observer != nil {
		if observer.NearbyRangeM > 0 {
			cfg.NearbyRangeMeters = observer.NearbyRangeM
		}
		if observer.RadarRangeM > 0 {
			cfg.RadarRangeMeters = math.Max(observer.RadarRangeM, cfg.NearbyRangeMeters)
		}
	}

	distance := math.Inf(1)
	if observer != nil {
		distance = distanceBetween(observer.GetPosition(), entity.GetPosition())
	}

	tier := pb.InterestTier_INTEREST_TIER_EXTENDED
	switch {
	case distance <= cfg.NearbyRangeMeters:
		tier = pb.InterestTier_INTEREST_TIER_NEARBY
	case distance <= cfg.RadarRangeMeters:
		tier = pb.InterestTier_INTEREST_TIER_RADAR
	case distance <= cfg.ExtendedRangeMeters:
		tier = pb.InterestTier_INTEREST_TIER_EXTENDED
	default:
		tier = pb.InterestTier_INTEREST_TIER_PASSIVE
	}

	if override, ok := m.radarHints[entity.GetEntityId()]; ok && override != pb.InterestTier_INTEREST_TIER_UNSPECIFIED {
		if override < tier {
			tier = override
		}
	}

	return tier
}

func normalizeConfig(cfg TierConfig) TierConfig {
	if cfg.NearbyRangeMeters <= 0 {
		cfg.NearbyRangeMeters = defaultNearbyRangeMeters
	}
	if cfg.RadarRangeMeters <= 0 {
		cfg.RadarRangeMeters = defaultRadarRangeMeters
	}
	if cfg.ExtendedRangeMeters <= 0 {
		cfg.ExtendedRangeMeters = defaultExtendedRangeMeters
	}
	if cfg.RadarRangeMeters < cfg.NearbyRangeMeters {
		cfg.RadarRangeMeters = cfg.NearbyRangeMeters
	}
	if cfg.ExtendedRangeMeters < cfg.RadarRangeMeters {
		cfg.ExtendedRangeMeters = cfg.RadarRangeMeters
	}
	return cfg
}

func cloneObserver(state *pb.ObserverState) *pb.ObserverState {
	if state == nil {
		return nil
	}
	if msg, ok := proto.Clone(state).(*pb.ObserverState); ok {
		return msg
	}
	return &pb.ObserverState{}
}

func cloneEntity(entity *pb.EntitySnapshot) *pb.EntitySnapshot {
	if entity == nil {
		return nil
	}
	if msg, ok := proto.Clone(entity).(*pb.EntitySnapshot); ok {
		return msg
	}
	return &pb.EntitySnapshot{}
}

func distanceBetween(a, b *pb.Vector3) float64 {
	if a == nil || b == nil {
		return math.Inf(1)
	}
	dx := a.GetX() - b.GetX()
	dy := a.GetY() - b.GetY()
	dz := a.GetZ() - b.GetZ()
	return math.Sqrt(dx*dx + dy*dy + dz*dz)
}
