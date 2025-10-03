package replay

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang/snappy"
	"github.com/klauspost/compress/zstd"
)

func TestWriterAppendAndFlushCadence(t *testing.T) {
	tmp := t.TempDir()
	base := time.Date(2024, 7, 10, 12, 0, 0, 0, time.UTC)
	now := base
	clock := func() time.Time { return now }

	writer, manifest, err := NewWriter(tmp, "Test Match", clock)
	if err != nil {
		t.Fatalf("create writer: %v", err)
	}

	writer.SetHeaderMetadata("seed-abc", TerrainParameters{"roughness": 0.6})

	if manifest.FrameIntervalMs != 200 {
		t.Fatalf("expected frame interval 200 ms, got %d", manifest.FrameIntervalMs)
	}

	if err := writer.AppendEvent(10, 33, "spawn", []byte("alpha")); err != nil {
		t.Fatalf("append event: %v", err)
	}

	framePayload := []byte{0x01, 0x02, 0x03}

	if err := writer.AppendFrame(1, 100, framePayload); err != nil {
		t.Fatalf("append frame 1: %v", err)
	}

	now = now.Add(100 * time.Millisecond)
	if err := writer.AppendFrame(2, 200, framePayload); err != nil {
		t.Fatalf("append frame 2: %v", err)
	}

	now = now.Add(120 * time.Millisecond)
	if err := writer.AppendFrame(3, 300, framePayload); err != nil {
		t.Fatalf("append frame 3: %v", err)
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	manifestBytes, err := os.ReadFile(filepath.Join(writer.Directory(), "manifest.json"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var onDisk Manifest
	if err := json.Unmarshal(manifestBytes, &onDisk); err != nil {
		t.Fatalf("unmarshal manifest: %v", err)
	}
	if onDisk.EventsPath != "events.jsonl.sz" || onDisk.FramesPath != "frames.bin.zst" {
		t.Fatalf("unexpected manifest paths: %+v", onDisk)
	}

	eventFile, err := os.Open(filepath.Join(writer.Directory(), onDisk.EventsPath))
	if err != nil {
		t.Fatalf("open events: %v", err)
	}
	defer eventFile.Close()

	eventReader := snappy.NewReader(eventFile)
	eventData, err := io.ReadAll(eventReader)
	if err != nil {
		t.Fatalf("read events: %v", err)
	}
	lines := bytesSplitLines(eventData)
	if len(lines) != 1 {
		t.Fatalf("expected 1 event line, got %d", len(lines))
	}

	var eventRecord struct {
		Tick        uint64 `json:"tick"`
		SimulatedMs int64  `json:"simulated_ms"`
		CapturedAt  string `json:"captured_at"`
		Type        string `json:"type"`
		PayloadB64  string `json:"payload_b64"`
	}
	if err := json.Unmarshal(lines[0], &eventRecord); err != nil {
		t.Fatalf("unmarshal event: %v", err)
	}
	if eventRecord.Tick != 10 || eventRecord.Type != "spawn" {
		t.Fatalf("unexpected event data: %+v", eventRecord)
	}
	payload, err := base64.StdEncoding.DecodeString(eventRecord.PayloadB64)
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if string(payload) != "alpha" {
		t.Fatalf("unexpected event payload: %q", payload)
	}

	frameFile, err := os.Open(filepath.Join(writer.Directory(), onDisk.FramesPath))
	if err != nil {
		t.Fatalf("open frames: %v", err)
	}
	defer frameFile.Close()

	frameReader, err := zstd.NewReader(frameFile)
	if err != nil {
		t.Fatalf("frame reader: %v", err)
	}
	defer frameReader.Close()

	frameBytes, err := io.ReadAll(frameReader)
	if err != nil {
		t.Fatalf("read frames: %v", err)
	}

	frames := decodeFrameBlobs(frameBytes)
	if len(frames) != 3 {
		t.Fatalf("expected 3 frames, got %d", len(frames))
	}
	for idx, fr := range frames {
		if fr.Tick != uint64(idx+1) {
			t.Fatalf("unexpected frame tick at %d: %d", idx, fr.Tick)
		}
		if fr.SimulatedMs != int64((idx+1)*100) {
			t.Fatalf("unexpected frame simulated ms at %d: %d", idx, fr.SimulatedMs)
		}
		if len(fr.Payload) != len(framePayload) {
			t.Fatalf("unexpected frame payload size: %d", len(fr.Payload))
		}
	}

	header, err := ReadHeader(filepath.Join(writer.Directory(), "header.json"))
	if err != nil {
		t.Fatalf("read header: %v", err)
	}
	if header.MatchSeed != "seed-abc" {
		t.Fatalf("unexpected header seed: %q", header.MatchSeed)
	}
	if header.FilePointer != "manifest.json" {
		t.Fatalf("unexpected header file pointer: %q", header.FilePointer)
	}
	if header.TerrainParams["roughness"] != 0.6 {
		t.Fatalf("unexpected header terrain params: %#v", header.TerrainParams)
	}
}

func TestWriterManualFlush(t *testing.T) {
	tmp := t.TempDir()
	base := time.Date(2024, 7, 10, 13, 0, 0, 0, time.UTC)
	now := base
	clock := func() time.Time { return now }

	writer, _, err := NewWriter(tmp, "Manual", clock)
	if err != nil {
		t.Fatalf("create writer: %v", err)
	}

	writer.SetHeaderMetadata("seed-manual", TerrainParameters{"roughness": 0.3})

	payload := []byte{0xAA, 0xBB}

	if err := writer.AppendFrame(1, 10, payload); err != nil {
		t.Fatalf("append frame 1: %v", err)
	}
	now = now.Add(50 * time.Millisecond)
	if err := writer.AppendFrame(2, 20, payload); err != nil {
		t.Fatalf("append frame 2: %v", err)
	}

	if err := writer.Flush(); err != nil {
		t.Fatalf("manual flush: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	frameFile, err := os.Open(filepath.Join(writer.Directory(), "frames.bin.zst"))
	if err != nil {
		t.Fatalf("open frames: %v", err)
	}
	defer frameFile.Close()

	frameReader, err := zstd.NewReader(frameFile)
	if err != nil {
		t.Fatalf("frame reader: %v", err)
	}
	defer frameReader.Close()

	frameBytes, err := io.ReadAll(frameReader)
	if err != nil {
		t.Fatalf("read frames: %v", err)
	}
	frames := decodeFrameBlobs(frameBytes)
	if len(frames) != 2 {
		t.Fatalf("expected 2 frames, got %d", len(frames))
	}

	header, err := ReadHeader(filepath.Join(writer.Directory(), "header.json"))
	if err != nil {
		t.Fatalf("read header: %v", err)
	}
	if header.MatchSeed != "seed-manual" {
		t.Fatalf("unexpected manual header seed: %q", header.MatchSeed)
	}
}

type decodedFrame struct {
	Tick        uint64
	SimulatedMs int64
	CapturedAt  time.Time
	Payload     []byte
}

func decodeFrameBlobs(raw []byte) []decodedFrame {
	var frames []decodedFrame
	offset := 0
	for offset+28 <= len(raw) {
		tick := binary.LittleEndian.Uint64(raw[offset : offset+8])
		offset += 8
		sim := int64(binary.LittleEndian.Uint64(raw[offset : offset+8]))
		offset += 8
		captured := int64(binary.LittleEndian.Uint64(raw[offset : offset+8]))
		offset += 8
		size := int(binary.LittleEndian.Uint32(raw[offset : offset+4]))
		offset += 4
		if offset+size > len(raw) {
			break
		}
		payload := append([]byte(nil), raw[offset:offset+size]...)
		offset += size
		frames = append(frames, decodedFrame{
			Tick:        tick,
			SimulatedMs: sim,
			CapturedAt:  time.Unix(0, captured).UTC(),
			Payload:     payload,
		})
	}
	return frames
}

func bytesSplitLines(data []byte) [][]byte {
	var lines [][]byte
	start := 0
	for idx, b := range data {
		if b == '\n' {
			line := append([]byte(nil), data[start:idx]...)
			lines = append(lines, line)
			start = idx + 1
		}
	}
	if start < len(data) {
		line := append([]byte(nil), data[start:]...)
		lines = append(lines, line)
	}
	return lines
}
