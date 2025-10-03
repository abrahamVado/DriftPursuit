package replayplayer

import (
	"testing"
	"time"

	"driftpursuit/broker/internal/replay"
)

func TestReplayBundle(t *testing.T) {
	tmp := t.TempDir()
	base := time.Date(2024, 7, 10, 15, 0, 0, 0, time.UTC)
	now := base
	clock := func() time.Time { return now }

	writer, manifest, err := replay.NewWriter(tmp, "Integration", clock)
	if err != nil {
		t.Fatalf("new writer: %v", err)
	}

	if err := writer.AppendEvent(5, 50, "start", []byte("hello")); err != nil {
		t.Fatalf("append event: %v", err)
	}

	if err := writer.AppendFrame(1, 10, []byte{0x01}); err != nil {
		t.Fatalf("append frame 1: %v", err)
	}
	now = now.Add(250 * time.Millisecond)
	if err := writer.AppendFrame(2, 20, []byte{0x02}); err != nil {
		t.Fatalf("append frame 2: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	loadedManifest, events, frames, err := ReplayBundle(writer.Directory())
	if err != nil {
		t.Fatalf("replay bundle: %v", err)
	}

	if loadedManifest.Version != manifest.Version {
		t.Fatalf("manifest mismatch: %v vs %v", loadedManifest.Version, manifest.Version)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if len(frames) != 2 {
		t.Fatalf("expected 2 frames, got %d", len(frames))
	}
	if string(events[0].Payload) != "hello" {
		t.Fatalf("unexpected event payload: %q", events[0].Payload)
	}
}
