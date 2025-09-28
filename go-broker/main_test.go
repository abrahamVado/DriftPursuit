package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

type fakeBroker struct {
	stats BrokerStats
	mu    sync.Mutex
	calls int
}

func (f *fakeBroker) Stats() BrokerStats {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	return f.stats
}

func TestStatsHandlerReturnsJSON(t *testing.T) {
	fake := &fakeBroker{stats: BrokerStats{Broadcasts: 5, Clients: 2}}
	req := httptest.NewRequest(http.MethodGet, "/api/stats", nil)
	rr := httptest.NewRecorder()

	statsHandler(fake).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d", rr.Code)
	}

	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("unexpected content type: got %q", ct)
	}

	var resp BrokerStats
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if resp != fake.stats {
		t.Fatalf("unexpected stats: got %+v want %+v", resp, fake.stats)
	}

	if fake.calls != 1 {
		t.Fatalf("expected Stats to be called once, got %d", fake.calls)
	}
}

type blockingBroker struct {
	stats   BrokerStats
	wait    chan struct{}
	started chan struct{}
	calls   int
	mu      sync.Mutex
}

func (b *blockingBroker) Stats() BrokerStats {
	b.mu.Lock()
	b.calls++
	if b.started != nil {
		close(b.started)
		b.started = nil
	}
	b.mu.Unlock()
	<-b.wait
	return b.stats
}

func TestStatsHandlerHonorsLocking(t *testing.T) {
	blocker := &blockingBroker{
		stats:   BrokerStats{Broadcasts: 1, Clients: 1},
		wait:    make(chan struct{}),
		started: make(chan struct{}),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/stats", nil)
	rr := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		statsHandler(blocker).ServeHTTP(rr, req)
		close(done)
	}()

	<-blocker.started

	select {
	case <-done:
		t.Fatal("handler returned before broker released lock")
	default:
	}

	close(blocker.wait)

	<-done

	blocker.mu.Lock()
	calls := blocker.calls
	blocker.mu.Unlock()
	if calls != 1 {
		t.Fatalf("expected Stats to be called once, got %d", calls)
	}
}

func TestServeWSRejectsWhenAtCapacity(t *testing.T) {
	b := NewBroker(1)
	existing := &Client{send: make(chan []byte, 1)}

	if b.maxClients != 1 {
		t.Fatalf("expected max clients to be 1, got %d", b.maxClients)
	}

	b.lock.Lock()
	b.clients[existing] = true
	b.stats.Clients = 1
	b.lock.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	rr := httptest.NewRecorder()

	b.serveWS(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d", http.StatusServiceUnavailable, rr.Code)
	}

	b.lock.Lock()
	clientCount := len(b.clients)
	pending := b.pendingClients
	b.lock.Unlock()

	if clientCount != 1 {
		t.Fatalf("expected client count to remain 1, got %d", clientCount)
	}
	if pending != 0 {
		t.Fatalf("expected pending clients to be 0, got %d", pending)
	}
}
