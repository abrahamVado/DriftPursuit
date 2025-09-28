package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const defaultMaxPayloadBytes int64 = 1 << 20 // 1 MiB

// Will be configured in main() after parsing flags/env.
var upgrader = websocket.Upgrader{}

const (
	writeWait          = 10 * time.Second      // write deadline for outgoing frames
	pongWaitMultiplier = 2                      // read deadline = pingInterval * multiplier
)

var pingInterval = 30 * time.Second // can be overridden by --ping-interval

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
	clients         map[*Client]bool
	lock            sync.Mutex
	stats           BrokerStats
	maxPayloadBytes int64
}

func NewBroker(maxPayloadBytes int64) *Broker {
	if maxPayloadBytes <= 0 {
		maxPayloadBytes = defaultMaxPayloadBytes
	}
	return &Broker{clients: make(map[*Client]bool), maxPayloadBytes: maxPayloadBytes}
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

type inboundEnvelope struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

func (b *Broker) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}
	client := &Client{conn: conn, send: make(chan []byte, 256), id: r.RemoteAddr}

	// Enforce payload limit (read side)
	if b.maxPayloadBytes > 0 {
		client.conn.SetReadLimit(b.maxPayloadBytes)
	}

	// Keepalive: read deadline & pong handler
	waitDuration := time.Duration(pongWaitMultiplier) * pingInterval
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
			messageType, msg, err := client.conn.ReadMessage()
			if err != nil {
				// Differentiate a few common cases for logging clarity
				if ne, ok := err.(net.Error); ok && ne.Timeout() {
					log.Printf("read deadline exceeded for %s: %v", client.id, err)
				} else if websocket.IsCloseError(err, websocket.CloseMessageTooBig) || errors.Is(err, websocket.ErrReadLimit) {
					log.Printf("closing connection %s due to oversized payload: %v", client.id, err)
				} else if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
					log.Printf("unexpected close for %s: %v", client.id, err)
				} else {
					log.Printf("read error from %s: %v", client.id, err)
				}
				break
			}

			// Extend read deadline after each successful frame
			if err := client.conn.SetReadDeadline(time.Now().Add(waitDuration)); err != nil {
				log.Printf("failed to extend read deadline for %s: %v", client.id, err)
				break
			}

			if messageType != websocket.TextMessage {
				log.Printf("dropping non-text message from %s", client.id)
				continue
			}

			var envelope inboundEnvelope
			if err := json.Unmarshal(msg, &envelope); err != nil {
				log.Printf("dropping invalid message from %s: %v", client.id, err)
				continue
			}
			if envelope.Type == "" || envelope.ID == "" {
				log.Printf("dropping message from %s with missing type or id", client.id)
				continue
			}

			normalized, err := json.Marshal(envelope)
			if err != nil {
				log.Printf("failed to normalize message from %s: %v", client.id, err)
				continue
			}

			b.broadcast(normalized)
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
				// Send ping periodically; pong handler will extend read deadline
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
	// allowed origins
	allowedOriginsDefault := os.Getenv("BROKER_ALLOWED_ORIGINS")

	// max payload default (env can override)
	maxPayloadDefault := defaultMaxPayloadBytes
	if envMax := os.Getenv("BROKER_MAX_PAYLOAD_BYTES"); envMax != "" {
		if parsed, err := strconv.ParseInt(envMax, 10, 64); err != nil {
			log.Printf("invalid BROKER_MAX_PAYLOAD_BYTES %q: %v", envMax, err)
		} else if parsed <= 0 {
			log.Printf("BROKER_MAX_PAYLOAD_BYTES must be positive, got %d", parsed)
		} else {
			maxPayloadDefault = parsed
		}
	}

	// flags
	allowedOriginsFlag := flag.String("allowed-origins", allowedOriginsDefault, "Comma-separated list of allowed origins for WebSocket connections")
	addr := flag.String("addr", ":43127", "address to listen on") // default to match python client
	tlsCertDefault := os.Getenv("BROKER_TLS_CERT")
	tlsKeyDefault := os.Getenv("BROKER_TLS_KEY")
	tlsCert := flag.String("tls-cert", tlsCertDefault, "Path to the TLS certificate file")
	tlsKey := flag.String("tls-key", tlsKeyDefault, "Path to the TLS private key file")
	maxPayloadFlag := flag.Int64("max-payload-bytes", maxPayloadDefault, "Maximum size in bytes for inbound WebSocket messages")
	pingFlag := flag.Duration("ping-interval", pingInterval, "interval between WebSocket ping frames for connection liveness")
	flag.Parse()

	// validate ping interval and apply
	if *pingFlag <= 0 {
		log.Fatalf("ping interval must be positive, got %v", *pingFlag)
	}
	pingInterval = *pingFlag

	// origin policy
	allowlist := parseAllowedOrigins(*allowedOriginsFlag)
	upgrader.CheckOrigin = buildOriginChecker(allowlist)
	if len(allowlist) > 0 {
		log.Printf("allowing WebSocket origins: %s", strings.Join(allowlist, ", "))
	} else {
		log.Println("no allowed origins configured; permitting only local development origins")
	}

	// payload policy
	maxPayloadBytes := *maxPayloadFlag
	if maxPayloadBytes <= 0 {
		log.Printf("invalid max-payload-bytes value %d; using default %d", maxPayloadBytes, defaultMaxPayloadBytes)
		maxPayloadBytes = defaultMaxPayloadBytes
	}
	log.Printf("maximum WebSocket payload set to %d bytes", maxPayloadBytes)

	// TLS config sanity
	certProvided := strings.TrimSpace(*tlsCert) != ""
	keyProvided := strings.TrimSpace(*tlsKey) != ""
	if certProvided != keyProvided {
		log.Fatalf("TLS configuration error: both --tls-cert and --tls-key (or BROKER_TLS_CERT/BROKER_TLS_KEY) must be provided together")
	}

	// build handler with consistent mux
	handler, err := buildHandler(maxPayloadBytes)
	if err != nil {
		log.Fatalf("failed to build HTTP handler: %v", err)
	}

	server := &http.Server{Addr: *addr, Handler: handler}

	if certProvided {
		fmt.Println("Broker listening with TLS on", *addr)
		log.Fatal(server.ListenAndServeTLS(*tlsCert, *tlsKey))
	}

	fmt.Println("Broker listening on", *addr)
	log.Fatal(server.ListenAndServe())
}

func buildHandler(maxPayloadBytes int64) (http.Handler, error) {
	mux := http.NewServeMux()

	b := NewBroker(maxPayloadBytes)

	// Register everything on the same mux
	mux.HandleFunc("/ws", b.serveWS)
	mux.HandleFunc("/api/stats", statsHandler(b))
	registerControlDocEndpoints(mux) // no-op stub below; replace when adding control endpoints

	// serve viewer static files (resolve relative to this source file)
	viewerDir, err := resolveViewerDir()
	if err != nil {
		return nil, err
	}
	fs := http.FileServer(http.Dir(viewerDir))
	mux.Handle("/viewer/", http.StripPrefix("/viewer/", fs))

	return mux, nil
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

// --- Optional: keep this stub if that function isn't implemented elsewhere.
func registerControlDocEndpoints(mux *http.ServeMux) {
	// no-op for now; add your handlers here later
}
