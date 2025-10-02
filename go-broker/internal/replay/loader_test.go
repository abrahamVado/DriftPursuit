package replay

import (
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestLoaderReplayOrdering(t *testing.T) {
	dir := t.TempDir()
	current := time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC)
	clock := func() time.Time { return current }

	recorder, err := NewRecorder(dir, clock)
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}

	recorder.RecordEvent(5, 900, []byte(`{"event":"late"}`))
	recorder.RecordWorldFrame(3, 600, []byte(`{"frame":3}`))
	recorder.RecordTick(1, 100, []byte(`{"tick":1}`))
	recorder.RecordEvent(1, 100, []byte(`{"event":"start"}`))
	recorder.RecordWorldFrame(2, 400, []byte(`{"frame":2}`))
	recorder.RecordTick(2, 300, []byte(`{"tick":2}`))

	path, err := recorder.Roll("beta")
	if err != nil {
		t.Fatalf("Roll: %v", err)
	}

	if filepath.Ext(path) != ".gz" {
		t.Fatalf("expected gzip artefact, got %s", path)
	}

	loader, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	var sequence []string
	err = loader.Replay(func(entry TimelineEntry) error {
		//1.- Capture the ordered sequence for deterministic assertions.
		sequence = append(sequence, fmt.Sprintf("%s:%d:%d", entry.Type, entry.Tick, entry.SimulatedMs))
		return nil
	})
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}

	expected := []string{
		"diff:1:100",
		"event:1:100",
		"diff:2:300",
		"world:2:400",
		"world:3:600",
		"event:5:900",
	}
	if !reflect.DeepEqual(sequence, expected) {
		t.Fatalf("unexpected replay order: %v", sequence)
	}

	entries := loader.Entries()
	if len(entries) != len(sequence) {
		t.Fatalf("expected %d entries copy, got %d", len(sequence), len(entries))
	}
	if &entries[0] == &loader.entries[0] {
		t.Fatalf("Entries must return a defensive copy")
	}
}
