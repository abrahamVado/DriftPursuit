package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
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

func dialTestWebSocket(t *testing.T, serverURL string) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(serverURL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	return conn
}

type wsReadResult struct {
	msg []byte
	err error
}

func listenOnce(conn *websocket.Conn) <-chan wsReadResult {
	ch := make(chan wsReadResult, 1)
	go func() {
		_, msg, err := conn.ReadMessage()
		ch <- wsReadResult{msg: msg, err: err}
	}()
	return ch
}

func TestServeWSDropsInvalidMessages(t *testing.T) {
	upgrader.CheckOrigin = func(*http.Request) bool { return true }
	broker := NewBroker(defaultMaxPayloadBytes)

	server := httptest.NewServer(http.HandlerFunc(broker.serveWS))
	defer server.Close()

	receiver := dialTestWebSocket(t, server.URL)
	defer receiver.Close()

	sender := dialTestWebSocket(t, server.URL)
	defer sender.Close()

	pending := listenOnce(receiver)

	if err := sender.WriteMessage(websocket.TextMessage, []byte("not json")); err != nil {
		t.Fatalf("write invalid message: %v", err)
	}
	select {
	case res := <-pending:
		if res.err != nil {
			t.Fatalf("receiver connection error after invalid message: %v", res.err)
		}
		t.Fatalf("unexpected broadcast after invalid message: %s", string(res.msg))
	case <-time.After(200 * time.Millisecond):
	}

	valid := []byte(`{"type":"update","id":"123"}`)
	if err := sender.WriteMessage(websocket.TextMessage, valid); err != nil {
		t.Fatalf("write valid message: %v", err)
	}

	select {
	case res := <-pending:
		if res.err != nil {
			t.Fatalf("receiver connection error waiting for valid broadcast: %v", res.err)
		}
		var envelope inboundEnvelope
		if err := json.Unmarshal(res.msg, &envelope); err != nil {
			t.Fatalf("unmarshal broadcast: %v", err)
		}
		if envelope.Type != "update" || envelope.ID != "123" {
			t.Fatalf("unexpected broadcast payload: %+v", envelope)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for normalized broadcast")
	}
}

func TestServeWSRejectsOversizedMessages(t *testing.T) {
	upgrader.CheckOrigin = func(*http.Request) bool { return true }
	broker := NewBroker(64)

	server := httptest.NewServer(http.HandlerFunc(broker.serveWS))
	defer server.Close()

	receiver := dialTestWebSocket(t, server.URL)
	defer receiver.Close()

	sender := dialTestWebSocket(t, server.URL)
	defer sender.Close()

	pending := listenOnce(receiver)

	oversized := []byte(fmt.Sprintf(`{"type":"big","id":"%s"}`, strings.Repeat("x", 80)))
	if int64(len(oversized)) <= broker.maxPayloadBytes {
		t.Fatalf("constructed message length %d does not exceed broker limit %d", len(oversized), broker.maxPayloadBytes)
	}

	if err := sender.WriteMessage(websocket.TextMessage, oversized); err != nil {
		t.Fatalf("write oversized message: %v", err)
	}

	if err := sender.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	if _, _, err := sender.ReadMessage(); err == nil {
		t.Fatal("expected connection to close after oversized message")
	} else if !websocket.IsCloseError(err, websocket.CloseMessageTooBig) {
		t.Fatalf("expected CloseMessageTooBig error, got %v", err)
	}
	if err := sender.SetReadDeadline(time.Time{}); err != nil {
		t.Fatalf("reset read deadline: %v", err)
	}

	select {
	case res := <-pending:
		if res.err != nil {
			t.Fatalf("receiver connection error after oversized message: %v", res.err)
		}
		t.Fatalf("unexpected broadcast after oversized message: %s", string(res.msg))
	case <-time.After(200 * time.Millisecond):
	}

	replacement := dialTestWebSocket(t, server.URL)
	defer replacement.Close()

	valid := []byte(`{"type":"ok","id":"42"}`)
	if err := replacement.WriteMessage(websocket.TextMessage, valid); err != nil {
		t.Fatalf("write valid message from replacement client: %v", err)
	}

	select {
	case res := <-pending:
		if res.err != nil {
			t.Fatalf("receiver connection error waiting for broadcast: %v", res.err)
		}
		var envelope inboundEnvelope
		if err := json.Unmarshal(res.msg, &envelope); err != nil {
			t.Fatalf("unmarshal broadcast: %v", err)
		}
		if envelope.Type != "ok" || envelope.ID != "42" {
			t.Fatalf("unexpected broadcast payload: %+v", envelope)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for broadcast after oversized message")
	}
}
