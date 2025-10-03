package main

import (
	"flag"
	"fmt"
	"os"
	"sort"

	"driftpursuit/broker/tools/replay_catalog"
)

func main() {
	root := flag.String("dir", ".", "directory containing replay headers")
	jsonFlag := flag.Bool("json", false, "emit JSON instead of human-readable output")
	flag.Parse()

	entries, err := replaycatalog.List(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	if *jsonFlag {
		payload, err := replaycatalog.MarshalEntries(entries)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(payload))
		return
	}

	for _, entry := range entries {
		fmt.Printf("%s (schema %d)\n", entry.ReplayPath, entry.Header.SchemaVersion)
		if entry.Header.MatchSeed != "" {
			fmt.Printf("  seed: %s\n", entry.Header.MatchSeed)
		}
		if len(entry.Header.TerrainParams) > 0 {
			keys := make([]string, 0, len(entry.Header.TerrainParams))
			for key := range entry.Header.TerrainParams {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			fmt.Printf("  terrain:\n")
			for _, key := range keys {
				fmt.Printf("    %s: %.3f\n", key, entry.Header.TerrainParams[key])
			}
		}
		fmt.Printf("  header: %s\n", entry.HeaderPath)
	}
}
