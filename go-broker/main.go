package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Will be configured in main() after parsing flags/env.
var upgrader = websocket.Upgrader{}

const (
	maxMessageSize     = 1 << 20
	writeWait          = 10 * time.Second
	pongWaitMultiplier = 2
)

var pingInterval = 30 * time.Second

// Always allow localhost for dev convenience.
var localHosts = map[string]struct{}{
	"127.0.0.1": {},
	"localhost": {},
	"::1":       {},
}

type Client struct {
	conn *websocket.Conn
	send chan []byte
	id   string
}

type Broker struct {
	clients map[*Client]bool
	lock    sync.Mutex
	stats   BrokerStats
}

func NewBroker() *Broker {
	return &Broker{clients: make(map[*Client]bool)}
}

type BrokerStats struct {
	Broadcasts int `json:"broadcasts"`
	Clients    int `json:"clients"`
}

type statsProvider interface {
	Stats() BrokerStats
}

func (b *Broker) deregisterClient(client *Client) {
	b.lock.Lock()
	if _, exists := b.clients[client]; exists {
		delete(b.clients, client)
		close(client.send)
		if b.stats.Clients > 0 {
			b.stats.Clients--
		}
	}
	b.lock.Unlock()
}

func (b *Broker) broadcast(msg []byte) {
	b.lock.Lock()
	b.stats.Broadcasts++
	defer b.lock.Unlock()
	for c := range b.clients {
		select {
		case c.send <- msg:
		default:
			close(c.send)
			delete(b.clients, c)
			if b.stats.Clients > 0 {
				b.stats.Clients--
			}
		}
	}
}

func (b *Broker) Stats() BrokerStats {
	b.lock.Lock()
	defer b.lock.Unlock()
	return b.stats
}

// --- Origin allowlist helpers ---

func parseAllowedOrigins(raw string) []string {
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		origin := strings.TrimSpace(part)
		if origin == "" {
			continue
		}
		origins = append(origins, origin)
	}
	return origins
}

func buildOriginChecker(allowlist []string) func(*http.Request) bool {
	allowed := make(map[string]struct{}, len(allowlist))
	for _, origin := range allowlist {
		u, err := url.Parse(origin)
		if err != nil || u.Scheme == "" || u.Host == "" {
			log.Printf("ignoring invalid allowed origin %q: %v", origin, err)
			continue
		}
		key := strings.ToLower(u.Scheme + "://" + u.Host)
		allowed[key] = struct{}{}
	}

	return func(r *http.Request) bool {
		originHeader := r.Header.Get("Origin")
		if originHeader == "" {
			// No Origin usually means non-browser client; reject by default.
			return false
		}

		originURL, err := url.Parse(originHeader)
		if err != nil || originURL.Host == "" {
			log.Printf("rejecting request with invalid origin %q: %v", originHeader, err)
			return false
		}

		// Always allow localhost for dev workflows.
		if _, ok := localHosts[originURL.Hostname()]; ok {
			return true
		}

		key := strings.ToLower(originURL.Scheme + "://" + originURL.Host)
		if _, ok := allowed[key]; ok {
			return true
		}

		log.Printf("rejecting request from disallowed origin %q", originHeader)
		return false
	}
}

// --- WS handler ---

func (b *Broker) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}
	client := &Client{conn: conn, send: make(chan []byte, 256), id: r.RemoteAddr}

	waitDuration := time.Duration(pongWaitMultiplier) * pingInterval
	client.conn.SetReadLimit(maxMessageSize)
	if err := client.conn.SetReadDeadline(time.Now().Add(waitDuration)); err != nil {
		log.Printf("set initial read deadline for %s: %v", client.id, err)
		_ = client.conn.Close()
		return
	}
	client.conn.SetPongHandler(func(string) error {
		return client.conn.SetReadDeadline(time.Now().Add(waitDuration))
	})

	b.lock.Lock()
	b.clients[client] = true
	b.stats.Clients++
	b.lock.Unlock()

	// reader
	go func() {
		defer func() {
			b.deregisterClient(client)
			_ = client.conn.Close()
		}()
		for {
			_, msg, err := client.conn.ReadMessage()
			if err != nil {
				if ne, ok := err.(net.Error); ok && ne.Timeout() {
					log.Printf("read deadline exceeded for %s: %v", client.id, err)
				} else if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
					log.Printf("read error for %s: %v", client.id, err)
				}
				break
			}
			if err := client.conn.SetReadDeadline(time.Now().Add(waitDuration)); err != nil {
				log.Printf("failed to extend read deadline for %s: %v", client.id, err)
				break
			}
			b.broadcast(msg)
		}
	}()

	// writer (handles errors + periodic ping)
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer func() {
			ticker.Stop()
			_ = client.conn.Close()
		}()
		for {
			select {
			case msg, ok := <-client.send:
				if !ok {
					_ = client.conn.WriteMessage(websocket.CloseMessage, []byte{})
					return
				}
				if err := client.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
					log.Printf("set write deadline for %s: %v", client.id, err)
					b.deregisterClient(client)
					return
				}
				if err := client.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					log.Printf("write error for %s: %v", client.id, err)
					b.deregisterClient(client)
					return
				}
			case <-ticker.C:
				if err := client.conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(writeWait)); err != nil {
					log.Printf("ping failure for %s: %v", client.id, err)
					b.deregisterClient(client)
					return
				}
			}
		}
	}()
}

func statsHandler(provider statsProvider) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stats := provider.Stats()
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(stats); err != nil {
			log.Printf("encode stats: %v", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
	}
}

// --- main / static viewer resolution ---

func main() {
	allowedOriginsDefault := os.Getenv("BROKER_ALLOWED_ORIGINS")
	allowedOriginsFlag := flag.String("allowed-origins", allowedOriginsDefault, "Comma-separated list of allowed origins for WebSocket connections")
	addr := flag.String("addr", ":8080", "address to listen on")
	pingFlag := flag.Duration("ping-interval", pingInterval, "interval between WebSocket ping frames for connection liveness")
	flag.Parse()

	if *pingFlag <= 0 {
		log.Fatalf("ping interval must be positive, got %v", *pingFlag)
	}
	pingInterval = *pingFlag

	allowlist := parseAllowedOrigins(*allowedOriginsFlag)
	upgrader.CheckOrigin = buildOriginChecker(allowlist)
	if len(allowlist) > 0 {
		log.Printf("allowing WebSocket origins: %s", strings.Join(allowlist, ", "))
	} else {
		log.Println("no allowed origins configured; permitting only local development origins")
	}

	b := NewBroker()
	http.HandleFunc("/ws", b.serveWS)
	http.HandleFunc("/api/stats", statsHandler(b))
	registerControlDocEndpoints()

	// serve viewer static files (resolve relative to this source file)
	viewerDir, err := resolveViewerDir()
	if err != nil {
		log.Fatalf("resolve viewer directory: %v", err)
	}
	fs := http.FileServer(http.Dir(viewerDir))
	http.Handle("/viewer/", http.StripPrefix("/viewer/", fs))

	fmt.Println("Broker listening on", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}

func resolveViewerDir() (string, error) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("unable to determine current file path")
	}
	viewerDir := filepath.Join(filepath.Dir(currentFile), "..", "viewer")
	viewerDir, err := filepath.Abs(viewerDir)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(viewerDir); err != nil {
		return "", err
	}
	return viewerDir, nil
}
