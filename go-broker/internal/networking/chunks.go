package networking

import (
	"math"
	"sort"
	"sync"

	pb "driftpursuit/broker/internal/proto/pb"
)

const (
	defaultArcChunkDegrees = 15.0
	chunkUnassigned        = -1
)

// ArcChunkIndex groups entity identifiers into polar arc chunks so the streaming
// subsystem can limit geometry updates to nearby world slices.
type ArcChunkIndex struct {
	mu sync.RWMutex

	arcRadians float64
	chunkCount int

	entityChunks map[string]int
	chunks       map[int]map[string]struct{}
	global       map[string]struct{}
}

// NewArcChunkIndex constructs the index using the desired arc width in degrees.
func NewArcChunkIndex(arcDegrees float64) *ArcChunkIndex {
	//1.- Clamp invalid angles to a reasonable default so callers receive a usable index.
	if arcDegrees <= 0 || arcDegrees >= 360 {
		arcDegrees = defaultArcChunkDegrees
	}
	arcRadians := arcDegrees * math.Pi / 180.0
	//2.- Derive the number of addressable chunks from the angular resolution.
	chunkCount := int(math.Ceil((2 * math.Pi) / arcRadians))
	if chunkCount < 1 {
		chunkCount = 1
	}
	return &ArcChunkIndex{
		arcRadians:   arcRadians,
		chunkCount:   chunkCount,
		entityChunks: make(map[string]int),
		chunks:       make(map[int]map[string]struct{}),
		global:       make(map[string]struct{}),
	}
}

// Update registers or repositions an entity within the arc index and returns its chunk.
func (i *ArcChunkIndex) Update(entityID string, position *pb.Vector3) int {
	if i == nil || entityID == "" {
		return chunkUnassigned
	}
	chunk := i.chunkForPosition(position)

	i.mu.Lock()
	defer i.mu.Unlock()
	i.removeLocked(entityID)
	if chunk == chunkUnassigned {
		//1.- Track unpositioned entities separately so every observer sees them.
		i.global[entityID] = struct{}{}
	} else {
		if _, ok := i.chunks[chunk]; !ok {
			i.chunks[chunk] = make(map[string]struct{})
		}
		i.chunks[chunk][entityID] = struct{}{}
	}
	i.entityChunks[entityID] = chunk
	return chunk
}

// Remove evicts the entity from the index so future range queries ignore it.
func (i *ArcChunkIndex) Remove(entityID string) {
	if i == nil || entityID == "" {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	i.removeLocked(entityID)
	delete(i.entityChunks, entityID)
}

// EntitiesNear returns the entity identifiers that fall within the requested chunk radius.
func (i *ArcChunkIndex) EntitiesNear(position *pb.Vector3, radius int) []string {
	if i == nil {
		return nil
	}
	i.mu.RLock()
	defer i.mu.RUnlock()
	if len(i.entityChunks) == 0 {
		return nil
	}

	//1.- Seed the candidate set with globally visible entities.
	candidates := make(map[string]struct{})
	for id := range i.global {
		candidates[id] = struct{}{}
	}
	if radius < 0 || i.chunkCount == 0 {
		//2.- Fallback to returning every indexed entity when no radius is provided.
		for id := range i.entityChunks {
			candidates[id] = struct{}{}
		}
		return sortIdentifiers(candidates)
	}
	center := i.chunkForPosition(position)
	if center == chunkUnassigned {
		//3.- Observers without a valid position receive the complete entity list.
		for id := range i.entityChunks {
			candidates[id] = struct{}{}
		}
		return sortIdentifiers(candidates)
	}

	//4.- Collect entities from each neighbouring chunk within the radius.
	for _, chunk := range i.chunkRange(center, radius) {
		if entities, ok := i.chunks[chunk]; ok {
			for id := range entities {
				candidates[id] = struct{}{}
			}
		}
	}
	return sortIdentifiers(candidates)
}

// chunkForPosition projects the world position into a polar arc identifier.
func (i *ArcChunkIndex) chunkForPosition(position *pb.Vector3) int {
	if i == nil || position == nil {
		return chunkUnassigned
	}
	angle := math.Atan2(position.GetY(), position.GetX())
	if angle < 0 {
		angle += 2 * math.Pi
	}
	if i.arcRadians <= 0 {
		return chunkUnassigned
	}
	chunk := int(math.Floor(angle / i.arcRadians))
	if chunk >= i.chunkCount {
		chunk = i.chunkCount - 1
	}
	return chunk
}

// chunkRange enumerates chunk identifiers within the symmetric radius of center.
func (i *ArcChunkIndex) chunkRange(center, radius int) []int {
	if i == nil || i.chunkCount == 0 || radius < 0 {
		return nil
	}
	size := radius*2 + 1
	if size <= 0 {
		size = 1
	}
	//1.- Allocate the backing slice so wrap-around arithmetic stays allocation free.
	result := make([]int, 0, size)
	for offset := -radius; offset <= radius; offset++ {
		chunk := (center + offset) % i.chunkCount
		if chunk < 0 {
			chunk += i.chunkCount
		}
		result = append(result, chunk)
	}
	return result
}

func (i *ArcChunkIndex) removeLocked(entityID string) {
	if i == nil {
		return
	}
	if chunk, ok := i.entityChunks[entityID]; ok {
		//1.- Unlink the entity from its previous chunk bucket if present.
		if chunk == chunkUnassigned {
			delete(i.global, entityID)
			return
		}
		if entities, exists := i.chunks[chunk]; exists {
			delete(entities, entityID)
			if len(entities) == 0 {
				delete(i.chunks, chunk)
			} else {
				i.chunks[chunk] = entities
			}
		}
	}
	delete(i.global, entityID)
}

func sortIdentifiers(values map[string]struct{}) []string {
	if len(values) == 0 {
		return nil
	}
	//1.- Materialise the identifiers to enforce deterministic ordering in tests and snapshots.
	result := make([]string, 0, len(values))
	for id := range values {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}
