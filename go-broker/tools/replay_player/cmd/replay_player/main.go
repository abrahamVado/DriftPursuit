package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"driftpursuit/broker/tools/replay_player"
)

func main() {
	path := flag.String("path", "", "Path to a replay directory or manifest.json")
	flag.Parse()

	if *path == "" {
		fmt.Fprintln(os.Stderr, "path flag is required")
		os.Exit(1)
	}

	manifest, events, frames, err := replayplayer.ReplayBundle(*path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(2)
	}

	payload := struct {
		Manifest interface{}          `json:"manifest"`
		Events   []replayplayer.Event `json:"events"`
		Frames   []replayplayer.Frame `json:"frames"`
	}{
		Manifest: manifest,
		Events:   events,
		Frames:   frames,
	}

	//1.- Render the replay bundle as JSON so callers can pipe the output elsewhere.
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(payload); err != nil {
		fmt.Fprintln(os.Stderr, "encode error:", err)
		os.Exit(3)
	}
}
