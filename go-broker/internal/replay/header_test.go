package replay

import (
	"path/filepath"
	"testing"
)

func TestWriteAndReadHeader(t *testing.T) {
	dir := t.TempDir()
	header := Header{
		SchemaVersion: HeaderSchemaVersion,
		MatchSeed:     "seed-9",
		TerrainParams: TerrainParameters{"roughness": 0.5},
		FilePointer:   "match.json.gz",
	}
	path := filepath.Join(dir, "example.header.json")
	if err := WriteHeader(path, header); err != nil {
		t.Fatalf("WriteHeader: %v", err)
	}
	loaded, err := ReadHeader(path)
	if err != nil {
		t.Fatalf("ReadHeader: %v", err)
	}
	if loaded.SchemaVersion != header.SchemaVersion || loaded.MatchSeed != header.MatchSeed {
		t.Fatalf("unexpected header values: %+v", loaded)
	}
	if loaded.TerrainParams["roughness"] != 0.5 {
		t.Fatalf("unexpected terrain params: %#v", loaded.TerrainParams)
	}
	if loaded.FilePointer != header.FilePointer {
		t.Fatalf("unexpected file pointer: %q", loaded.FilePointer)
	}
}
