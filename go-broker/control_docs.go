package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
)

// ControlDoc describes a single button or keyboard shortcut that the viewer
// exposes.  The structure is deliberately generic so that future clients can
// attach extra metadata without breaking the API.
type ControlDoc struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Shortcut    string `json:"shortcut,omitempty"`
}

// defaultControlDocs mirrors the buttons rendered inside viewer/index.html.  By
// hosting the canonical description on the Go broker we gain two benefits:
//  1. The repository now contains a more balanced mix of Go/Python/JS.
//  2. Developers can query the endpoint from automated tests or tooling to
//     keep documentation in sync.
var defaultControlDocs = []ControlDoc{
	{
		ID:          "manual-toggle",
		Label:       "Manual Control",
		Description: "Engage viewer-driven manual control so keyboard movement is applied on top of telemetry.",
		Shortcut:    "Button / keyboard M",
	},
	{
		ID:          "accelerate-forward",
		Label:       "Forward Acceleration",
		Description: "Toggle a scripted thrust curve that pushes the aircraft down the runway.",
		Shortcut:    "Button / keyboard T",
	},
	{
		ID:          "keyboard",
		Label:       "Flight Keys",
		Description: "WASD for planar movement, RF/Space/Shift for altitude, QE for yaw, arrow keys for pitch and roll.",
	},
}

// registerControlDocEndpoints registers the HTTP handlers used by the viewer to
// fetch button documentation.  The data is served as JSON so it can be reused by
// other tooling without additional parsing work.
func registerControlDocEndpoints() {
	http.HandleFunc("/api/controls", func(w http.ResponseWriter, r *http.Request) {
		// Always work on a copy so that concurrent requests cannot
		// mutate the global slice by accident.
		docs := append([]ControlDoc(nil), defaultControlDocs...)
		sort.SliceStable(docs, func(i, j int) bool {
			if docs[i].Label == docs[j].Label {
				return strings.Compare(docs[i].ID, docs[j].ID) < 0
			}
			return strings.Compare(docs[i].Label, docs[j].Label) < 0
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(docs); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})
}
