module driftpursuit/broker

go 1.21

toolchain go1.24.3

require github.com/gorilla/websocket v1.5.0

require google.golang.org/protobuf v1.36.0

replace github.com/gorilla/websocket/websockettest => ./internal/websockettest
