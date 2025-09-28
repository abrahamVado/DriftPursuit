module driftpursuit/broker

go 1.20

require (
	github.com/gorilla/websocket v1.5.0
	github.com/gorilla/websocket/websockettest v0.0.0
)

replace github.com/gorilla/websocket/websockettest => ./internal/websockettest
