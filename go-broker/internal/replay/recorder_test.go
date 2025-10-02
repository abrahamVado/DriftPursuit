package replay

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRecorderRollsToDisk(t *testing.T) {
	dir := t.TempDir()
	current := time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC)
	clock := func() time.Time { return current }

	recorder, err := NewRecorder(dir, clock)
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}

	recorder.RecordTick(1, 0, []byte(`{"tick":1}`))
	recorder.RecordWorldFrame(1, 0, []byte(`{"state":"frame"}`))
	recorder.RecordEvent(1, 0, []byte(`{"event":"spawn"}`))
	current = current.Add(10 * time.Millisecond)
	recorder.RecordTick(2, 10, []byte(`{"tick":2}`))
	recorder.RecordEvent(2, 10, []byte(`{"event":"score"}`))

	stats := recorder.Snapshot()
	if stats.BufferedFrames != 2 {
		t.Fatalf("expected 2 buffered frames, got %d", stats.BufferedFrames)
	}
	if stats.BufferedWorld != 1 {
		t.Fatalf("expected 1 buffered world frame, got %d", stats.BufferedWorld)
	}
	if stats.BufferedEvents != 2 {
		t.Fatalf("expected 2 buffered events, got %d", stats.BufferedEvents)
	}
	if stats.BufferedBytes == 0 {
		t.Fatalf("expected buffered bytes to be tracked")
	}

	path, err := recorder.Roll("alpha")
	if err != nil {
		t.Fatalf("Roll: %v", err)
	}
	if filepath.Dir(path) != dir {
		t.Fatalf("unexpected roll directory: %s", path)
	}

	artifact, err := os.Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer artifact.Close()

	gz, err := gzip.NewReader(artifact)
	if err != nil {
		t.Fatalf("gzip: %v", err)
	}
	defer gz.Close()
	data, err := io.ReadAll(gz)
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	var dump struct {
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
	}
	if err := json.Unmarshal(data, &dump); err != nil {
		t.Fatalf("decode roll: %v", err)
	}
	if len(dump.Frames) != 2 {
		t.Fatalf("expected two frames, got %d", len(dump.Frames))
	}
	if len(dump.WorldFrames) != 1 {
		t.Fatalf("expected one world frame, got %d", len(dump.WorldFrames))
	}
	if len(dump.Events) != 2 {
		t.Fatalf("expected two events, got %d", len(dump.Events))
	}

	stats = recorder.Snapshot()
	if stats.BufferedFrames != 0 {
		t.Fatalf("expected buffer to be cleared after roll")
	}
	if stats.Dumps != 1 {
		t.Fatalf("expected dumps counter to increment")
	}
	if stats.LastDumpURI != path {
		t.Fatalf("expected last dump uri to match path")
	}
}
