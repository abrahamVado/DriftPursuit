package replay

import (
	"encoding/json"
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

	recorder.RecordTick(1, []byte(`{"tick":1}`))
	current = current.Add(10 * time.Millisecond)
	recorder.RecordTick(2, []byte(`{"tick":2}`))

	stats := recorder.Snapshot()
	if stats.BufferedFrames != 2 {
		t.Fatalf("expected 2 buffered frames, got %d", stats.BufferedFrames)
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

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var file struct {
		SavedAt string `json:"saved_at"`
		Frames  []struct {
			Tick       uint64          `json:"tick"`
			CapturedAt string          `json:"captured_at"`
			Payload    json.RawMessage `json:"payload"`
		} `json:"frames"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatalf("decode roll: %v", err)
	}
	if len(file.Frames) != 2 {
		t.Fatalf("expected two frames, got %d", len(file.Frames))
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
