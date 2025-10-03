package replayplayer

import (
	"bufio"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang/snappy"
	"github.com/klauspost/compress/zstd"

	"driftpursuit/broker/internal/replay"
)

// Event represents a single event decoded from the JSONL log.
type Event struct {
	Tick        uint64
	SimulatedMs int64
	CapturedAt  time.Time
	Type        string
	Payload     []byte
}

// Frame represents a single frame decoded from the binary blob stream.
type Frame struct {
	Tick        uint64
	SimulatedMs int64
	CapturedAt  time.Time
	Payload     []byte
}

// ReplayBundle loads the manifest, events and frames for inspection.
func ReplayBundle(path string) (replay.Manifest, []Event, []Frame, error) {
	if path == "" {
		return replay.Manifest{}, nil, nil, fmt.Errorf("path is required")
	}

	//1.- Locate the manifest so downstream parsing reuses relative asset paths.
	manifestPath := path
	info, err := os.Stat(path)
	if err != nil {
		return replay.Manifest{}, nil, nil, err
	}
	if info.IsDir() {
		manifestPath = filepath.Join(path, "manifest.json")
	}
	manifestDir := filepath.Dir(manifestPath)

	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return replay.Manifest{}, nil, nil, err
	}
	var manifest replay.Manifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return replay.Manifest{}, nil, nil, err
	}
	if manifest.Version != 1 {
		return replay.Manifest{}, nil, nil, fmt.Errorf("unsupported manifest version %d", manifest.Version)
	}

	//2.- Decode events first so validation tools can reconstruct the timeline.
	events, err := loadEvents(filepath.Join(manifestDir, manifest.EventsPath))
	if err != nil {
		return replay.Manifest{}, nil, nil, err
	}

	//3.- Decode frames afterwards because they can be replayed incrementally.
	frames, err := loadFrames(filepath.Join(manifestDir, manifest.FramesPath))
	if err != nil {
		return replay.Manifest{}, nil, nil, err
	}

	return manifest, events, frames, nil
}

func loadEvents(path string) ([]Event, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader := snappy.NewReader(file)
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

	var events []Event
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		//1.- Decode the JSON payload and convert the base64 field into raw bytes.
		var raw struct {
			Tick        uint64 `json:"tick"`
			SimulatedMs int64  `json:"simulated_ms"`
			CapturedAt  string `json:"captured_at"`
			Type        string `json:"type"`
			PayloadB64  string `json:"payload_b64"`
		}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			return nil, err
		}
		captured, err := time.Parse(time.RFC3339Nano, raw.CapturedAt)
		if err != nil {
			return nil, err
		}
		payload, err := base64.StdEncoding.DecodeString(raw.PayloadB64)
		if err != nil {
			return nil, err
		}
		events = append(events, Event{
			Tick:        raw.Tick,
			SimulatedMs: raw.SimulatedMs,
			CapturedAt:  captured,
			Type:        raw.Type,
			Payload:     payload,
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func loadFrames(path string) ([]Frame, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader, err := zstd.NewReader(file)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	payload, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}

	var frames []Frame
	offset := 0
	for offset+28 <= len(payload) {
		//1.- Read the fixed header then hydrate the payload bytes for replay consumption.
		tick := binary.LittleEndian.Uint64(payload[offset : offset+8])
		offset += 8
		sim := int64(binary.LittleEndian.Uint64(payload[offset : offset+8]))
		offset += 8
		captured := int64(binary.LittleEndian.Uint64(payload[offset : offset+8]))
		offset += 8
		size := int(binary.LittleEndian.Uint32(payload[offset : offset+4]))
		offset += 4
		if size < 0 || offset+size > len(payload) {
			return nil, fmt.Errorf("frame payload truncated")
		}
		blob := append([]byte(nil), payload[offset:offset+size]...)
		offset += size
		frames = append(frames, Frame{
			Tick:        tick,
			SimulatedMs: sim,
			CapturedAt:  time.Unix(0, captured).UTC(),
			Payload:     blob,
		})
	}
	return frames, nil
}
