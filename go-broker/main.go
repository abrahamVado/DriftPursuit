package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{}

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
}

func NewBroker() *Broker {
	return &Broker{clients: make(map[*Client]bool)}
}

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
			return false
		}

		originURL, err := url.Parse(originHeader)
		if err != nil || originURL.Host == "" {
			log.Printf("rejecting request with invalid origin %q: %v", originHeader, err)
			return false
		}

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

func (b *Broker) broadcast(msg []byte) {
	b.lock.Lock()
	defer b.lock.Unlock()
	for c := range b.clients {
		select {
		case c.send <- msg:
		default:
			close(c.send)
			delete(b.clients, c)
		}
	}
}

func (b *Broker) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}
	client := &Client{conn: conn, send: make(chan []byte, 256), id: r.RemoteAddr}
	b.lock.Lock()
	b.clients[client] = true
	b.lock.Unlock()

	// reader
	go func() {
		defer func() {
			b.lock.Lock()
			delete(b.clients, client)
			b.lock.Unlock()
			client.conn.Close()
		}()
		for {
			_, msg, err := client.conn.ReadMessage()
			if err != nil {
				log.Println("read error:", err)
				break
			}
			// relay to all clients
			b.broadcast(msg)
		}
	}()

	// writer
	go func() {
		ticker := time.NewTicker(time.Second * 30)
		defer func() {
			ticker.Stop()
			client.conn.Close()
		}()
		for {
			select {
			case msg, ok := <-client.send:
				if !ok {
					_ = client.conn.WriteMessage(websocket.CloseMessage, []byte{})
					return
				}
				_ = client.conn.WriteMessage(websocket.TextMessage, msg)
			case <-ticker.C:
				_ = client.conn.WriteMessage(websocket.PingMessage, []byte{})
			}
		}
	}()
}

func main() {
	allowedOriginsDefault := os.Getenv("BROKER_ALLOWED_ORIGINS")
	allowedOriginsFlag := flag.String("allowed-origins", allowedOriginsDefault, "Comma-separated list of allowed origins for WebSocket connections")
	addr := flag.String("addr", ":8080", "address to listen on")
	flag.Parse()

	allowlist := parseAllowedOrigins(*allowedOriginsFlag)
	upgrader.CheckOrigin = buildOriginChecker(allowlist)
	if len(allowlist) > 0 {
		log.Printf("allowing WebSocket origins: %s", strings.Join(allowlist, ", "))
	} else {
		log.Println("no allowed origins configured; permitting only local development origins")
	}

	b := NewBroker()
	http.HandleFunc("/ws", b.serveWS)
	// serve viewer static files
	fs := http.FileServer(http.Dir("./viewer"))
	http.Handle("/viewer/", http.StripPrefix("/viewer/", fs))

	fmt.Println("Broker listening on", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
