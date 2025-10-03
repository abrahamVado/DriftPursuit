package replay

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// HeaderSchemaVersion tracks the schema version for replay header documents.
const HeaderSchemaVersion = 1

// TerrainParameters captures configurable terrain tuning metadata for the match.
type TerrainParameters map[string]float64

// Clone returns a defensive copy of the terrain parameters map.
func (p TerrainParameters) Clone() TerrainParameters {
	if len(p) == 0 {
		return nil
	}
	//1.- Allocate a fresh map so callers can mutate clones without touching shared state.
	clone := make(TerrainParameters, len(p))
	for key, value := range p {
		clone[key] = value
	}
	return clone
}

// Header represents the metadata persisted alongside a replay artefact.
type Header struct {
	SchemaVersion int               `json:"schema_version"`
	MatchSeed     string            `json:"match_seed"`
	TerrainParams TerrainParameters `json:"terrain_params,omitempty"`
	FilePointer   string            `json:"file_pointer"`
}

// Validate ensures the header contains enough information for catalogue tooling.
func (h Header) Validate() error {
	if h.SchemaVersion <= 0 {
		return fmt.Errorf("schema_version must be positive")
	}
	//1.- Ensure catalogue tooling can locate the replay artefact reliably.
	if strings.TrimSpace(h.FilePointer) == "" {
		return fmt.Errorf("file_pointer must not be empty")
	}
	return nil
}

// WriteHeader persists the supplied header to the provided file path.
func WriteHeader(path string, header Header) error {
	if err := header.Validate(); err != nil {
		return err
	}
	//1.- Encode using indented JSON so manual inspection remains readable.
	payload, err := json.MarshalIndent(header, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	//2.- Ensure the directory hierarchy exists even when tooling supplies nested paths.
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	//3.- Terminate with a newline so POSIX tooling can append easily.
	return os.WriteFile(path, append(payload, '\n'), 0o644)
}

// ReadHeader loads and decodes a replay header from disk.
func ReadHeader(path string) (Header, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Header{}, err
	}
	var header Header
	if err := json.Unmarshal(data, &header); err != nil {
		return Header{}, err
	}
	//1.- Reuse validation so callers receive consistent error semantics.
	if err := header.Validate(); err != nil {
		return Header{}, err
	}
	return header, nil
}
