package bots

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPLauncherScale(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		//1.- Ensure the controller posts the requested target payload.
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		var payload struct {
			Target int `json:"target"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload.Target != 7 {
			t.Fatalf("expected target 7, got %d", payload.Target)
		}
		_ = json.NewEncoder(w).Encode(map[string]int{"running": 6})
	}))
	defer server.Close()

	launcher, err := NewHTTPLauncher(server.URL, server.Client())
	if err != nil {
		t.Fatalf("launcher init: %v", err)
	}
	count, err := launcher.Scale(context.Background(), 7)
	if err != nil {
		t.Fatalf("scale: %v", err)
	}
	if count != 6 {
		t.Fatalf("expected running count 6, got %d", count)
	}
}

func TestHTTPLauncherErrorStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	launcher, err := NewHTTPLauncher(server.URL, server.Client())
	if err != nil {
		t.Fatalf("launcher init: %v", err)
	}
	if _, err := launcher.Scale(context.Background(), 3); err == nil {
		t.Fatal("expected error from non-2xx response")
	}
}
