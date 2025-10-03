package replaycatalog

import (
	"os"
	"path/filepath"
	"testing"

	"driftpursuit/broker/internal/replay"
)

func TestListCollectsHeaders(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "alpha")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	header := replay.Header{
		SchemaVersion: replay.HeaderSchemaVersion,
		MatchSeed:     "seed-alpha",
		TerrainParams: replay.TerrainParameters{"roughness": 0.4},
		FilePointer:   "match.json.gz",
	}
	headerPath := filepath.Join(dataDir, "header.json")
	if err := replay.WriteHeader(headerPath, header); err != nil {
		t.Fatalf("WriteHeader: %v", err)
	}

	entries, err := List(dir)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected single entry, got %d", len(entries))
	}
	entry := entries[0]
	if entry.Header.MatchSeed != "seed-alpha" {
		t.Fatalf("unexpected match seed: %q", entry.Header.MatchSeed)
	}
	if entry.ReplayPath != filepath.Join(dataDir, "match.json.gz") {
		t.Fatalf("unexpected replay path: %q", entry.ReplayPath)
	}

	payload, err := MarshalEntries(entries)
	if err != nil {
		t.Fatalf("MarshalEntries: %v", err)
	}
	if len(payload) == 0 {
		t.Fatalf("expected JSON payload to be non-empty")
	}
}
