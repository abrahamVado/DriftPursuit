package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestHMACTokenVerifierValidToken(t *testing.T) {
	verifier, err := NewHMACTokenVerifier("secret", time.Second)
	if err != nil {
		t.Fatalf("NewHMACTokenVerifier: %v", err)
	}
	fixedNow := time.Unix(1700000000, 0)
	verifier.WithClock(func() time.Time { return fixedNow })
	token := makeToken(t, "secret", "pilot-7", fixedNow.Add(30*time.Second))

	claims, err := verifier.Verify(token)
	if err != nil {
		t.Fatalf("Verify returned error: %v", err)
	}
	if claims.Subject != "pilot-7" {
		t.Fatalf("unexpected subject: %q", claims.Subject)
	}
	if claims.ExpiresAt.Before(fixedNow) {
		t.Fatal("expected expiry in the future")
	}
}

func TestHMACTokenVerifierRejectsExpiredToken(t *testing.T) {
	verifier, err := NewHMACTokenVerifier("secret", 0)
	if err != nil {
		t.Fatalf("NewHMACTokenVerifier: %v", err)
	}
	now := time.Unix(1700000000, 0)
	verifier.WithClock(func() time.Time { return now })
	token := makeToken(t, "secret", "pilot-7", now.Add(-time.Second))

	if _, err := verifier.Verify(token); !errors.Is(err, ErrExpiredToken) {
		t.Fatalf("expected ErrExpiredToken, got %v", err)
	}
}

func TestHMACTokenVerifierRejectsInvalidSignature(t *testing.T) {
	verifier, err := NewHMACTokenVerifier("secret", time.Second)
	if err != nil {
		t.Fatalf("NewHMACTokenVerifier: %v", err)
	}
	now := time.Unix(1700000000, 0)
	verifier.WithClock(func() time.Time { return now })
	token := makeToken(t, "other-secret", "pilot-7", now.Add(time.Minute))

	if _, err := verifier.Verify(token); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("expected ErrInvalidToken, got %v", err)
	}
}

func makeToken(t *testing.T, secret, subject string, expires time.Time) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload := fmt.Sprintf(`{"sub":"%s","exp":%d,"iat":%d}`, subject, expires.Unix(), expires.Add(-time.Minute).Unix())
	encodedPayload := base64.RawURLEncoding.EncodeToString([]byte(payload))
	signingInput := header + "." + encodedPayload
	mac := hmac.New(sha256.New, []byte(secret))
	if _, err := mac.Write([]byte(signingInput)); err != nil {
		t.Fatalf("mac write: %v", err)
	}
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + signature
}
