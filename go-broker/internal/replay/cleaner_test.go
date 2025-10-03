package replay

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"driftpursuit/broker/internal/logging"
)

func TestCleanerEnforcesMaxMatches(t *testing.T) {
	tmp := t.TempDir()
	now := time.Date(2024, 7, 15, 12, 0, 0, 0, time.UTC)
	//1.- Seed three synthetic replays so the cleaner has artefacts to prune.
	writeReplayFiles(t, tmp, "alpha", now.Add(-3*time.Hour), 64)
	writeReplayFiles(t, tmp, "bravo", now.Add(-2*time.Hour), 32)
	writeReplayFiles(t, tmp, "charlie", now.Add(-time.Hour), 48)

	cleaner := NewCleaner(tmp, RetentionPolicy{MaxMatches: 2}, logging.NewTestLogger())
	cleaner.now = func() time.Time { return now }
	//2.- Trigger a single sweep to enforce the retention policy immediately.
	cleaner.RunOnce()

	remaining := listReplayBases(t, tmp)
	if len(remaining) != 2 {
		t.Fatalf("expected 2 matches retained, got %d (%v)", len(remaining), remaining)
	}
	expected := []string{"bravo.json.gz", "charlie.json.gz"}
	if remaining[0] != expected[0] || remaining[1] != expected[1] {
		t.Fatalf("unexpected retained matches: %v", remaining)
	}

	stats := cleaner.Stats()
	if stats.Matches != 2 {
		t.Fatalf("expected stats to report 2 matches, got %d", stats.Matches)
	}
	if stats.Headers != 2 {
		t.Fatalf("expected stats to report 2 headers, got %d", stats.Headers)
	}
	if stats.Bytes != int64(48+32+2+2) {
		t.Fatalf("expected byte total 84, got %d", stats.Bytes)
	}
	if stats.LastSweep.IsZero() {
		t.Fatalf("expected last sweep timestamp to be recorded")
	}
}

func TestCleanerPrunesByAgeIncludingDirectories(t *testing.T) {
	tmp := t.TempDir()
	now := time.Date(2024, 7, 16, 9, 0, 0, 0, time.UTC)
	//1.- Mix file- and directory-based replays to ensure both formats are handled.
	writeReplayFiles(t, tmp, "delta", now.Add(-48*time.Hour), 16)
	writeReplayDirectory(t, tmp, "echo-20240714T080000Z", now.Add(-72*time.Hour), 3)
	writeReplayDirectory(t, tmp, "foxtrot-20240716T070000Z", now.Add(-time.Hour), 5)

	cleaner := NewCleaner(tmp, RetentionPolicy{MaxAge: 36 * time.Hour, MaxMatches: 5}, logging.NewTestLogger())
	cleaner.now = func() time.Time { return now }
	//2.- Execute a sweep so the age threshold applies to the seeded artefacts.
	cleaner.RunOnce()

	remaining := listReplayBases(t, tmp)
	for _, name := range remaining {
		if name == "delta.json.gz" {
			t.Fatalf("expected delta replay to be pruned due to age")
		}
		if name == "echo-20240714T080000Z" {
			t.Fatalf("expected echo directory to be pruned due to age")
		}
	}
	foundFoxtrot := false
	for _, name := range remaining {
		if name == "foxtrot-20240716T070000Z" {
			foundFoxtrot = true
		}
	}
	if !foundFoxtrot {
		t.Fatalf("expected foxtrot directory to remain: %v", remaining)
	}
}

func writeReplayFiles(t *testing.T, dir, base string, mod time.Time, payload int) {
	t.Helper()
	//1.- Prepare deterministic payload bytes so size calculations are predictable.
	data := make([]byte, payload)
	basePath := filepath.Join(dir, base+".json.gz")
	if err := os.WriteFile(basePath, data, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	headerPath := basePath + ".header.json"
	if err := os.WriteFile(headerPath, []byte("{}"), 0o644); err != nil {
		t.Fatalf("WriteFile header: %v", err)
	}
	if err := os.Chtimes(basePath, mod, mod); err != nil {
		t.Fatalf("Chtimes base: %v", err)
	}
	if err := os.Chtimes(headerPath, mod, mod); err != nil {
		t.Fatalf("Chtimes header: %v", err)
	}
}

func writeReplayDirectory(t *testing.T, dir, name string, mod time.Time, files int) {
	t.Helper()
	matchDir := filepath.Join(dir, name)
	if err := os.MkdirAll(matchDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	for i := 0; i < files; i++ {
		path := filepath.Join(matchDir, fmt.Sprintf("frame-%d.bin", i))
		if err := os.WriteFile(path, []byte{byte(i)}, 0o644); err != nil {
			t.Fatalf("WriteFile frame: %v", err)
		}
		if err := os.Chtimes(path, mod, mod); err != nil {
			t.Fatalf("Chtimes frame: %v", err)
		}
	}
	if err := os.Chtimes(matchDir, mod, mod); err != nil {
		t.Fatalf("Chtimes dir: %v", err)
	}
}

func listReplayBases(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasSuffix(name, ".header.json") {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
