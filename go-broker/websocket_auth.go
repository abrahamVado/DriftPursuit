package main

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"driftpursuit/broker/internal/auth"
)

type websocketAuthenticator interface {
	Authenticate(r *http.Request) (string, error)
}

type allowAllAuthenticator struct{}

func (allowAllAuthenticator) Authenticate(*http.Request) (string, error) {
	return "", nil
}

type hmacWebsocketAuthenticator struct {
	verifier *auth.HMACTokenVerifier
}

func newHMACWebsocketAuthenticator(secret string) (websocketAuthenticator, error) {
	verifier, err := auth.NewHMACTokenVerifier(secret, 2*time.Second)
	if err != nil {
		return nil, err
	}
	return &hmacWebsocketAuthenticator{verifier: verifier}, nil
}

// Authenticate validates the incoming token and returns the logical client identifier.
func (a *hmacWebsocketAuthenticator) Authenticate(r *http.Request) (string, error) {
	if a == nil || a.verifier == nil {
		return "", errors.New("verifier not configured")
	}
	token := strings.TrimSpace(r.URL.Query().Get("auth_token"))
	if token == "" {
		token = strings.TrimSpace(r.Header.Get("X-Auth-Token"))
	}
	if token == "" {
		return "", errors.New("missing auth token")
	}
	claims, err := a.verifier.Verify(token)
	if err != nil {
		return "", err
	}
	return claims.Subject, nil
}

// WithWebsocketAuthenticator wires a custom authenticator into the broker.
func WithWebsocketAuthenticator(authenticator websocketAuthenticator) BrokerOption {
	return func(b *Broker) {
		if b == nil || authenticator == nil {
			return
		}
		b.wsAuthenticator = authenticator
	}
}
