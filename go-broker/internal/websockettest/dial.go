package websockettest

import (
	"net/http"

	"github.com/gorilla/websocket"
)

// DialIgnoringPongs establishes a WebSocket connection and disables the
// automatic pong responses so that tests can simulate an unresponsive peer.
func DialIgnoringPongs(urlStr string, header http.Header) (*websocket.Conn, *http.Response, error) {
	conn, resp, err := websocket.DefaultDialer.Dial(urlStr, header)
	if err != nil {
		return nil, resp, err
	}
	conn.SetPingHandler(func(string) error { return nil })
	conn.SetPongHandler(func(string) error { return nil })
	return conn, resp, nil
}
