package main

import (
	"fmt"
	"net"
	"strings"
)

// listenerURL returns a human-friendly URL for the broker listener address.
// 1.- Decide whether the broker should advertise an HTTP or HTTPS scheme based on TLS configuration.
// 2.- Normalise the configured address so the message always shows a reachable host:port pair.
func listenerURL(address string, tlsEnabled bool) string {
	scheme := "http"
	if tlsEnabled {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, normaliseHostPort(address))
}

func normaliseHostPort(address string) string {
	trimmed := strings.TrimSpace(address)
	if trimmed == "" {
		return "localhost"
	}
	host, port, err := net.SplitHostPort(trimmed)
	if err != nil {
		if strings.HasPrefix(trimmed, ":") {
			return "localhost" + trimmed
		}
		return trimmed
	}
	host = strings.TrimSpace(host)
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		host = "localhost"
	}
	return net.JoinHostPort(host, port)
}
