package replay

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

var matchIDCleaner = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

// TickFrame stores the payload for a single simulation tick.
type TickFrame struct {
	Tick        uint64
	CapturedAt  time.Time
	SimulatedMs int64
	Payload     []byte
}

// WorldFrame captures a full world snapshot suitable for deterministic replays.
type WorldFrame struct {
	Tick        uint64
	CapturedAt  time.Time
	SimulatedMs int64
	Payload     []byte
}

// EventRecord stores a single gameplay event emitted during a match.
type EventRecord struct {
	Tick        uint64
	CapturedAt  time.Time
	SimulatedMs int64
	Payload     []byte
}

// Recorder buffers authoritative tick deltas until they are flushed to disk.
type Recorder struct {
	mu          sync.Mutex
	dir         string
	now         func() time.Time
	frames      []TickFrame
	worldFrames []WorldFrame
	events      []EventRecord
	bytes       int64
	dumps       int64
	lastDump    time.Time
	lastDumpURI string
}

// Stats summarises recorder health for monitoring endpoints.
type Stats struct {
	BufferedFrames int
	BufferedWorld  int
	BufferedEvents int
	BufferedBytes  int64
	Dumps          int64
	LastDumpURI    string
	LastDumpTime   time.Time
}

// NewRecorder constructs a replay recorder that writes JSON artefacts into dir.
func NewRecorder(dir string, clock func() time.Time) (*Recorder, error) {
	if dir == "" {
		return nil, fmt.Errorf("replay directory must be provided")
	}
	if clock == nil {
		clock = time.Now
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Recorder{dir: dir, now: clock}, nil
}

// RecordTick appends the encoded delta for the supplied tick to the buffer.
func (r *Recorder) RecordTick(tick uint64, simulatedMs int64, payload []byte) {
	if r == nil || len(payload) == 0 {
		return
	}
	clone := append([]byte(nil), payload...)
	captured := r.now().UTC()

	r.mu.Lock()
	//1.- Track buffered frames so future monitoring captures outstanding work.
	r.frames = append(r.frames, TickFrame{Tick: tick, CapturedAt: captured, SimulatedMs: simulatedMs, Payload: clone})
	r.bytes += int64(len(clone))
	r.mu.Unlock()
}

// RecordWorldFrame appends a full world snapshot captured at the configured cadence.
func (r *Recorder) RecordWorldFrame(tick uint64, simulatedMs int64, payload []byte) {
	if r == nil || len(payload) == 0 {
		return
	}
	clone := append([]byte(nil), payload...)
	captured := r.now().UTC()

	r.mu.Lock()
	//1.- Buffer the snapshot so match teardown can persist deterministic frames.
	r.worldFrames = append(r.worldFrames, WorldFrame{Tick: tick, CapturedAt: captured, SimulatedMs: simulatedMs, Payload: clone})
	r.bytes += int64(len(clone))
	r.mu.Unlock()
}

// RecordEvent appends a single gameplay event payload for later persistence.
func (r *Recorder) RecordEvent(tick uint64, simulatedMs int64, payload []byte) {
	if r == nil || len(payload) == 0 {
		return
	}
	clone := append([]byte(nil), payload...)
	captured := r.now().UTC()

	r.mu.Lock()
	//1.- Buffer each event independently so the loader can reconstruct timelines.
	r.events = append(r.events, EventRecord{Tick: tick, CapturedAt: captured, SimulatedMs: simulatedMs, Payload: clone})
	r.bytes += int64(len(clone))
	r.mu.Unlock()
}

// Roll writes the buffered frames to disk and clears the in-memory buffer.
func (r *Recorder) Roll(matchID string) (string, error) {
	if r == nil {
		return "", fmt.Errorf("recorder not configured")
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	//1.- Bail out gracefully when nothing has been recorded yet.
	if len(r.frames) == 0 && len(r.worldFrames) == 0 && len(r.events) == 0 {
		return "", fmt.Errorf("no replay frames buffered")
	}

	cleanedID := matchIDCleaner.ReplaceAllString(matchID, "")
	if cleanedID == "" {
		cleanedID = "match"
	}
	timestamp := r.now().UTC().Format("20060102T150405Z")
	filename := fmt.Sprintf("%s-%s.json.gz", cleanedID, timestamp)
	path := filepath.Join(r.dir, filename)

	//2.- Encode frames using JSON so downstream tooling can parse them easily.
	envelope := struct {
		SavedAt string `json:"saved_at"`
		Frames  []struct {
			Tick        uint64          `json:"tick"`
			CapturedAt  string          `json:"captured_at"`
			SimulatedMs int64           `json:"simulated_ms"`
			Payload     json.RawMessage `json:"payload"`
		} `json:"frames"`
		WorldFrames []struct {
			Tick        uint64          `json:"tick"`
			CapturedAt  string          `json:"captured_at"`
			SimulatedMs int64           `json:"simulated_ms"`
			Payload     json.RawMessage `json:"payload"`
		} `json:"world_frames"`
		Events []struct {
			Tick        uint64          `json:"tick"`
			CapturedAt  string          `json:"captured_at"`
			SimulatedMs int64           `json:"simulated_ms"`
			Payload     json.RawMessage `json:"payload"`
		} `json:"events"`
	}{SavedAt: timestamp}
	envelope.Frames = make([]struct {
		Tick        uint64          `json:"tick"`
		CapturedAt  string          `json:"captured_at"`
		SimulatedMs int64           `json:"simulated_ms"`
		Payload     json.RawMessage `json:"payload"`
	}, len(r.frames))
	envelope.WorldFrames = make([]struct {
		Tick        uint64          `json:"tick"`
		CapturedAt  string          `json:"captured_at"`
		SimulatedMs int64           `json:"simulated_ms"`
		Payload     json.RawMessage `json:"payload"`
	}, len(r.worldFrames))
	envelope.Events = make([]struct {
		Tick        uint64          `json:"tick"`
		CapturedAt  string          `json:"captured_at"`
		SimulatedMs int64           `json:"simulated_ms"`
		Payload     json.RawMessage `json:"payload"`
	}, len(r.events))

	for idx, frame := range r.frames {
		envelope.Frames[idx].Tick = frame.Tick
		envelope.Frames[idx].CapturedAt = frame.CapturedAt.Format(time.RFC3339Nano)
		envelope.Frames[idx].SimulatedMs = frame.SimulatedMs
		envelope.Frames[idx].Payload = json.RawMessage(frame.Payload)
	}

	for idx, frame := range r.worldFrames {
		envelope.WorldFrames[idx].Tick = frame.Tick
		envelope.WorldFrames[idx].CapturedAt = frame.CapturedAt.Format(time.RFC3339Nano)
		envelope.WorldFrames[idx].SimulatedMs = frame.SimulatedMs
		envelope.WorldFrames[idx].Payload = json.RawMessage(frame.Payload)
	}

	for idx, event := range r.events {
		envelope.Events[idx].Tick = event.Tick
		envelope.Events[idx].CapturedAt = event.CapturedAt.Format(time.RFC3339Nano)
		envelope.Events[idx].SimulatedMs = event.SimulatedMs
		envelope.Events[idx].Payload = json.RawMessage(event.Payload)
	}

	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return "", err
	}
	file, err := os.Create(path)
	if err != nil {
		return "", err
	}
	writer := gzip.NewWriter(file)
	if _, err := writer.Write(data); err != nil {
		_ = writer.Close()
		_ = file.Close()
		return "", err
	}
	if err := writer.Close(); err != nil {
		_ = file.Close()
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}

	//3.- Reset the buffer so a fresh match can begin immediately.
	r.frames = nil
	r.worldFrames = nil
	r.events = nil
	r.bytes = 0
	r.dumps++
	r.lastDump = r.now().UTC()
	r.lastDumpURI = path
	return path, nil
}

// Snapshot returns statistics describing the recorder state.
func (r *Recorder) Snapshot() Stats {
	if r == nil {
		return Stats{}
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	//1.- Copy the counters so monitoring endpoints avoid racing with the writer.
	stats := Stats{
		BufferedFrames: len(r.frames),
		BufferedWorld:  len(r.worldFrames),
		BufferedEvents: len(r.events),
		BufferedBytes:  r.bytes,
		Dumps:          r.dumps,
		LastDumpURI:    r.lastDumpURI,
		LastDumpTime:   r.lastDump,
	}
	return stats
}
