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
		ID:          "assist-toggle",
		Label:       "Flight Assist",
		Description: "Toggle between guided tunnel-follow assist and unrestricted free-flight.",
		Shortcut:    "Keyboard F",
	},
	{
		ID:          "throttle",
		Label:       "Throttle",
		Description: "Adjust forward thrust to climb the cave stream or slow to a hover.",
		Shortcut:    "W / S, Arrow Up / Arrow Down",
	},
	{
		ID:          "yaw",
		Label:       "Yaw",
		Description: "Twist around the vertical axis for tight corridor turns.",
		Shortcut:    "J / L, Arrow Left / Arrow Right",
	},
	{
		ID:          "pitch",
		Label:       "Pitch",
		Description: "Tilt the nose to dive deeper or level back toward the horizon.",
		Shortcut:    "I / K, Arrow Up / Arrow Down",
	},
	{
		ID:          "roll",
		Label:       "Roll",
		Description: "Bank the craft with precision tunnel banking inputs.",
		Shortcut:    "A / D, Q / E",
	},
	{
		ID:          "vertical-thrust",
		Label:       "Vertical Thrust",
		Description: "Slide up or down along world-up to thread vertical shafts.",
		Shortcut:    "N / M, PageUp / PageDown",
	},
	{
		ID:          "boost",
		Label:       "Boost",
		Description: "Hold for an auxiliary thruster burst when you need extra speed.",
		Shortcut:    "Shift / Space",
	},
	{
		ID:          "reset",
		Label:       "Reset Craft",
		Description: "Respawn at the last safe ring if you clip the cave mouth.",
		Shortcut:    "Keyboard R",
	},
}

// registerControlDocEndpoints registers the HTTP handlers used by the viewer to
// fetch button documentation.  The data is served as JSON so it can be reused by
// other tooling without additional parsing work.
func registerControlDocEndpoints(mux *http.ServeMux) {
	mux.HandleFunc("/api/controls", func(w http.ResponseWriter, r *http.Request) {
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
