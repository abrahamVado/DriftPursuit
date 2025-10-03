package replaycatalog

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"driftpursuit/broker/internal/replay"
)

// Entry captures a replay header alongside its resolved artefact path.
type Entry struct {
	HeaderPath string        `json:"header_path"`
	ReplayPath string        `json:"replay_path"`
	Header     replay.Header `json:"header"`
}

// List walks the directory tree and returns parsed replay headers.
func List(root string) ([]Entry, error) {
	if strings.TrimSpace(root) == "" {
		return nil, fmt.Errorf("root directory must be provided")
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("root must be a directory")
	}

	var entries []Entry
	//1.- Walk the directory tree searching for known header filenames.
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		name := d.Name()
		if name != "header.json" && !strings.HasSuffix(name, ".header.json") {
			return nil
		}
		header, err := replay.ReadHeader(path)
		if err != nil {
			return err
		}
		replayPath := header.FilePointer
		if !filepath.IsAbs(replayPath) {
			replayPath = filepath.Join(filepath.Dir(path), replayPath)
		}
		entries = append(entries, Entry{HeaderPath: path, ReplayPath: replayPath, Header: header})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Header.MatchSeed == entries[j].Header.MatchSeed {
			return entries[i].ReplayPath < entries[j].ReplayPath
		}
		return entries[i].Header.MatchSeed < entries[j].Header.MatchSeed
	})
	return entries, nil
}

// MarshalEntries produces a stable JSON representation of the entries for CLI output.
func MarshalEntries(entries []Entry) ([]byte, error) {
	//1.- Marshal with indentation to keep CLI output legible for operators.
	return json.MarshalIndent(entries, "", "  ")
}
