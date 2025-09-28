package main

import (
    "fmt"
    "log"
    "net/http"
    "sync"
    "time"

    "github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool { return true },
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

func (b *Broker) deregisterClient(client *Client) {
    b.lock.Lock()
    if _, exists := b.clients[client]; exists {
        delete(b.clients, client)
        close(client.send)
    }
    b.lock.Unlock()
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
                if err := client.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
                    log.Println("write error:", err)
                    b.deregisterClient(client)
                    return
                }
            case <-ticker.C:
                if err := client.conn.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
                    log.Println("ping error:", err)
                    b.deregisterClient(client)
                    return
                }
            }
        }
    }()
}

func main() {
    b := NewBroker()
    http.HandleFunc("/ws", b.serveWS)
    // serve viewer static files
    fs := http.FileServer(http.Dir("./viewer"))
    http.Handle("/viewer/", http.StripPrefix("/viewer/", fs))

    addr := ":8080"
    fmt.Println("Broker listening on", addr)
    log.Fatal(http.ListenAndServe(addr, nil))
}
