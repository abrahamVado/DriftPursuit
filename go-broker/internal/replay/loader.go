package replay

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"time"
)

// TimelineEntry represents a single replay datum ready for deterministic iteration.
type TimelineEntry struct {
	Tick        uint64
	SimulatedMs int64
	CapturedAt  time.Time
	Type        string
	Payload     json.RawMessage
}

// Loader rehydrates compressed replay artefacts for validation workflows.
type Loader struct {
	entries []TimelineEntry
}

// Load constructs a loader from the provided replay file path.
func Load(path string) (*Loader, error) {
	if path == "" {
		return nil, fmt.Errorf("replay path must be provided")
	}

	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader, err := gzip.NewReader(file)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}

	var envelope struct {
		Frames []struct {
			Tick        uint64          `json:"tick"`
			CapturedAt  string          `json:"captured_at"`
			SimulatedMs int64           `json:"simulated_ms"`
			Payload     json.RawMessage `json:"payload"`
		} `json:"frames"`
		WorldFrames []struct {
			Tick        uint64          `json:"tick"`
			CapturedAt  string          `json:"captured_at"`
			SimulatedMs int64           `json:"simulated_ms"`
			Payload     json.RawMessage `json:"payload"`
		} `json:"world_frames"`
		Events []struct {
			Tick        uint64          `json:"tick"`
			CapturedAt  string          `json:"captured_at"`
			SimulatedMs int64           `json:"simulated_ms"`
			Payload     json.RawMessage `json:"payload"`
		} `json:"events"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, err
	}

	entries := make([]TimelineEntry, 0, len(envelope.Frames)+len(envelope.WorldFrames)+len(envelope.Events))

	//1.- Rehydrate tick diffs so deterministic replays can include authoritative deltas.
	for _, frame := range envelope.Frames {
		captured, err := time.Parse(time.RFC3339Nano, frame.CapturedAt)
		if err != nil {
			return nil, fmt.Errorf("parse frame captured_at: %w", err)
		}
		entries = append(entries, TimelineEntry{
			Tick:        frame.Tick,
			SimulatedMs: frame.SimulatedMs,
			CapturedAt:  captured,
			Type:        "diff",
			Payload:     append(json.RawMessage(nil), frame.Payload...),
		})
	}

	//2.- Append world frames to feed deterministic validation runs.
	for _, frame := range envelope.WorldFrames {
		captured, err := time.Parse(time.RFC3339Nano, frame.CapturedAt)
		if err != nil {
			return nil, fmt.Errorf("parse world_frame captured_at: %w", err)
		}
		entries = append(entries, TimelineEntry{
			Tick:        frame.Tick,
			SimulatedMs: frame.SimulatedMs,
			CapturedAt:  captured,
			Type:        "world",
			Payload:     append(json.RawMessage(nil), frame.Payload...),
		})
	}

	//3.- Include gameplay events so match logs replay deterministically.
	for _, event := range envelope.Events {
		captured, err := time.Parse(time.RFC3339Nano, event.CapturedAt)
		if err != nil {
			return nil, fmt.Errorf("parse event captured_at: %w", err)
		}
		entries = append(entries, TimelineEntry{
			Tick:        event.Tick,
			SimulatedMs: event.SimulatedMs,
			CapturedAt:  captured,
			Type:        "event",
			Payload:     append(json.RawMessage(nil), event.Payload...),
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].SimulatedMs == entries[j].SimulatedMs {
			if entries[i].Tick == entries[j].Tick {
				return entries[i].Type < entries[j].Type
			}
			return entries[i].Tick < entries[j].Tick
		}
		return entries[i].SimulatedMs < entries[j].SimulatedMs
	})

	return &Loader{entries: entries}, nil
}

// Replay iterates over the loaded entries in deterministic order.
func (l *Loader) Replay(apply func(TimelineEntry) error) error {
	if l == nil {
		return fmt.Errorf("loader not initialised")
	}
	if apply == nil {
		return fmt.Errorf("replay callback must be provided")
	}
	for _, entry := range l.entries {
		//1.- Invoke the callback for each timeline entry to drive the validation sim.
		if err := apply(entry); err != nil {
			return err
		}
	}
	return nil
}

// Entries exposes a defensive copy of the timeline for external assertions.
func (l *Loader) Entries() []TimelineEntry {
	if l == nil {
		return nil
	}
	out := make([]TimelineEntry, len(l.entries))
	copy(out, l.entries)
	return out
}
