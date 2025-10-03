package replay

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/golang/snappy"
	"github.com/klauspost/compress/zstd"
)

var writerMatchCleaner = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

const frameInterval = 200 * time.Millisecond

// frameBlob stores frame metadata before it is persisted to disk.
type frameBlob struct {
	Tick        uint64
	SimulatedMs int64
	CapturedAt  time.Time
	Payload     []byte
}

// Writer streams gameplay artefacts to disk using the high-frequency format.
type Writer struct {
	mu            sync.Mutex
	dir           string
	now           func() time.Time
	eventFile     *os.File
	eventStream   *snappy.Writer
	frameFile     *os.File
	frameStream   *zstd.Encoder
	pending       []frameBlob
	lastFlush     time.Time
	headerSeed    string
	headerTerrain TerrainParameters
}

// Manifest describes the replay bundle layout so tooling can locate artefacts.
type Manifest struct {
	Version         int    `json:"version"`
	CreatedAt       string `json:"created_at"`
	FrameIntervalMs int    `json:"frame_interval_ms"`
	EventsPath      string `json:"events_path"`
	FramesPath      string `json:"frames_path"`
}

// NewWriter prepares the replay directory and opens compressed sinks.
func NewWriter(root, matchID string, clock func() time.Time) (*Writer, Manifest, error) {
	if root == "" {
		return nil, Manifest{}, fmt.Errorf("replay root must be provided")
	}
	if clock == nil {
		clock = time.Now
	}

	cleaned := writerMatchCleaner.ReplaceAllString(matchID, "")
	if cleaned == "" {
		cleaned = "match"
	}
	created := clock().UTC()
	folder := fmt.Sprintf("%s-%s", cleaned, created.Format("20060102T150405Z"))
	path := filepath.Join(root, folder)

	if err := os.MkdirAll(path, 0o755); err != nil {
		return nil, Manifest{}, err
	}

	eventsPath := filepath.Join(path, "events.jsonl.sz")
	framesPath := filepath.Join(path, "frames.bin.zst")
	manifestPath := filepath.Join(path, "manifest.json")

	eventFile, err := os.Create(eventsPath)
	if err != nil {
		return nil, Manifest{}, err
	}
	eventStream := snappy.NewBufferedWriter(eventFile)

	frameFile, err := os.Create(framesPath)
	if err != nil {
		eventFile.Close()
		return nil, Manifest{}, err
	}
	frameStream, err := zstd.NewWriter(frameFile)
	if err != nil {
		eventStream.Close()
		eventFile.Close()
		frameFile.Close()
		return nil, Manifest{}, err
	}

	manifest := Manifest{
		Version:         1,
		CreatedAt:       created.Format(time.RFC3339Nano),
		FrameIntervalMs: int(frameInterval / time.Millisecond),
		EventsPath:      "events.jsonl.sz",
		FramesPath:      "frames.bin.zst",
	}

	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		frameStream.Close()
		frameFile.Close()
		eventStream.Close()
		eventFile.Close()
		return nil, Manifest{}, err
	}
	if err := os.WriteFile(manifestPath, data, 0o644); err != nil {
		frameStream.Close()
		frameFile.Close()
		eventStream.Close()
		eventFile.Close()
		return nil, Manifest{}, err
	}

	writer := &Writer{
		dir:         path,
		now:         clock,
		eventFile:   eventFile,
		eventStream: eventStream,
		frameFile:   frameFile,
		frameStream: frameStream,
	}

	return writer, manifest, nil
}

// Directory exposes the directory backing the replay bundle.
func (w *Writer) Directory() string {
	if w == nil {
		return ""
	}
	return w.dir
}

// AppendEvent writes a single JSON event line to the compressed event log.
func (w *Writer) AppendEvent(tick uint64, simulatedMs int64, eventType string, payload []byte) error {
	if w == nil {
		return fmt.Errorf("writer not initialised")
	}
	captured := w.now().UTC()

	w.mu.Lock()
	defer w.mu.Unlock()

	//1.- Encode the event payload with metadata so downstream JSONL parsers can stream it safely.
	record := struct {
		Tick        uint64 `json:"tick"`
		SimulatedMs int64  `json:"simulated_ms"`
		CapturedAt  string `json:"captured_at"`
		Type        string `json:"type"`
		PayloadB64  string `json:"payload_b64"`
	}{
		Tick:        tick,
		SimulatedMs: simulatedMs,
		CapturedAt:  captured.Format(time.RFC3339Nano),
		Type:        eventType,
		PayloadB64:  base64.StdEncoding.EncodeToString(payload),
	}
	line, err := json.Marshal(record)
	if err != nil {
		return err
	}
	if _, err := w.eventStream.Write(line); err != nil {
		return err
	}
	if _, err := w.eventStream.Write([]byte("\n")); err != nil {
		return err
	}
	return w.eventStream.Flush()
}

// AppendFrame buffers a binary frame until the 5 Hz cadence is reached.
func (w *Writer) AppendFrame(tick uint64, simulatedMs int64, payload []byte) error {
	if w == nil {
		return fmt.Errorf("writer not initialised")
	}
	captured := w.now().UTC()
	clone := append([]byte(nil), payload...)

	w.mu.Lock()
	defer w.mu.Unlock()

	//1.- Stage the frame so cadence enforcement can persist batches together.
	w.pending = append(w.pending, frameBlob{Tick: tick, SimulatedMs: simulatedMs, CapturedAt: captured, Payload: clone})
	if w.lastFlush.IsZero() {
		w.lastFlush = captured
		return nil
	}
	if captured.Sub(w.lastFlush) >= frameInterval {
		if err := w.flushLocked(); err != nil {
			return err
		}
		w.lastFlush = captured
	}
	return nil
}

// SetHeaderMetadata configures the header persisted alongside the replay bundle.
func (w *Writer) SetHeaderMetadata(seed string, terrain TerrainParameters) {
	if w == nil {
		return
	}
	w.mu.Lock()
	//1.- Cache the seed for later header emission when the writer closes.
	w.headerSeed = seed
	//2.- Clone terrain parameters to avoid retaining shared mutable references.
	w.headerTerrain = terrain.Clone()
	w.mu.Unlock()
}

// Flush forces pending frames to be written regardless of cadence.
func (w *Writer) Flush() error {
	if w == nil {
		return fmt.Errorf("writer not initialised")
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	//1.- Persist pending frames then refresh the cadence anchor to avoid bursts.
	if err := w.flushLocked(); err != nil {
		return err
	}
	w.lastFlush = w.now().UTC()
	return nil
}

// Close synchronously flushes all buffers and releases file handles.
func (w *Writer) Close() error {
	if w == nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	//1.- Persist the metadata header before dismantling the streaming sinks.
	var firstErr error
	headerPath := filepath.Join(w.dir, "header.json")
	header := Header{SchemaVersion: HeaderSchemaVersion, MatchSeed: w.headerSeed, TerrainParams: w.headerTerrain.Clone(), FilePointer: "manifest.json"}
	if err := WriteHeader(headerPath, header); err != nil && firstErr == nil {
		firstErr = err
	}
	//2.- Attempt every flush/close and surface the first failure for callers to inspect.
	if err := w.flushLocked(); err != nil && firstErr == nil {
		firstErr = err
	}
	if err := w.eventStream.Flush(); err != nil && firstErr == nil {
		firstErr = err
	}
	if err := w.eventStream.Close(); err != nil && firstErr == nil {
		firstErr = err
	}
	if err := w.eventFile.Close(); err != nil && firstErr == nil {
		firstErr = err
	}
	if err := w.frameStream.Close(); err != nil && firstErr == nil {
		firstErr = err
	}
	if err := w.frameFile.Close(); err != nil && firstErr == nil {
		firstErr = err
	}
	return firstErr
}

// flushLocked writes buffered frames to the zstd stream; callers must hold the mutex.
func (w *Writer) flushLocked() error {
	if len(w.pending) == 0 {
		return nil
	}
	//1.- Write length-prefixed frames so replayers can step efficiently.
	for _, frame := range w.pending {
		header := make([]byte, 8+8+8+4)
		binary.LittleEndian.PutUint64(header[0:8], frame.Tick)
		binary.LittleEndian.PutUint64(header[8:16], uint64(frame.SimulatedMs))
		binary.LittleEndian.PutUint64(header[16:24], uint64(frame.CapturedAt.UnixNano()))
		binary.LittleEndian.PutUint32(header[24:28], uint32(len(frame.Payload)))
		if _, err := w.frameStream.Write(header); err != nil {
			return err
		}
		if _, err := w.frameStream.Write(frame.Payload); err != nil {
			return err
		}
	}
	w.pending = w.pending[:0]
	return nil
}
