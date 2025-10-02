package replay

import (
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
	Tick       uint64
	CapturedAt time.Time
	Payload    []byte
}

// Recorder buffers authoritative tick deltas until they are flushed to disk.
type Recorder struct {
	mu          sync.Mutex
	dir         string
	now         func() time.Time
	frames      []TickFrame
	bytes       int64
	dumps       int64
	lastDump    time.Time
	lastDumpURI string
}

// Stats summarises recorder health for monitoring endpoints.
type Stats struct {
	BufferedFrames int
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
func (r *Recorder) RecordTick(tick uint64, payload []byte) {
	if r == nil || len(payload) == 0 {
		return
	}
	clone := append([]byte(nil), payload...)
	captured := r.now().UTC()

	r.mu.Lock()
	//1.- Track buffered frames so future monitoring captures outstanding work.
	r.frames = append(r.frames, TickFrame{Tick: tick, CapturedAt: captured, Payload: clone})
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
	if len(r.frames) == 0 {
		return "", fmt.Errorf("no replay frames buffered")
	}

	cleanedID := matchIDCleaner.ReplaceAllString(matchID, "")
	if cleanedID == "" {
		cleanedID = "match"
	}
	timestamp := r.now().UTC().Format("20060102T150405Z")
	filename := fmt.Sprintf("%s-%s.json", cleanedID, timestamp)
	path := filepath.Join(r.dir, filename)

	//2.- Encode frames using JSON so downstream tooling can parse them easily.
	envelope := struct {
		SavedAt string `json:"saved_at"`
		Frames  []struct {
			Tick       uint64          `json:"tick"`
			CapturedAt string          `json:"captured_at"`
			Payload    json.RawMessage `json:"payload"`
		} `json:"frames"`
	}{SavedAt: timestamp}
	envelope.Frames = make([]struct {
		Tick       uint64          `json:"tick"`
		CapturedAt string          `json:"captured_at"`
		Payload    json.RawMessage `json:"payload"`
	}, len(r.frames))

	for idx, frame := range r.frames {
		envelope.Frames[idx].Tick = frame.Tick
		envelope.Frames[idx].CapturedAt = frame.CapturedAt.Format(time.RFC3339Nano)
		envelope.Frames[idx].Payload = json.RawMessage(frame.Payload)
	}

	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}

	//3.- Reset the buffer so a fresh match can begin immediately.
	r.frames = nil
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
		BufferedBytes:  r.bytes,
		Dumps:          r.dumps,
		LastDumpURI:    r.lastDumpURI,
		LastDumpTime:   r.lastDump,
	}
	return stats
}
