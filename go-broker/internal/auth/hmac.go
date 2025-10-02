package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	// ErrInvalidToken indicates the token failed signature checks or had malformed structure.
	ErrInvalidToken = errors.New("invalid token")
	// ErrExpiredToken signals that the token's expiry is in the past.
	ErrExpiredToken = errors.New("token expired")
)

// TokenClaims captures the minimal JWT payload used by the broker for WebSocket auth.
type TokenClaims struct {
	Subject   string
	ExpiresAt time.Time
	IssuedAt  time.Time
	Audience  string
}

// HMACTokenVerifier validates compact JWT-style tokens signed with HS256.
type HMACTokenVerifier struct {
	secret []byte
	now    func() time.Time
	leeway time.Duration
}

// NewHMACTokenVerifier constructs a verifier for the supplied shared secret and clock skew allowance.
func NewHMACTokenVerifier(secret string, leeway time.Duration) (*HMACTokenVerifier, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, errors.New("hmac secret must not be empty")
	}
	if leeway < 0 {
		leeway = 0
	}
	return &HMACTokenVerifier{secret: []byte(secret), now: time.Now, leeway: leeway}, nil
}

// Verify parses the token and validates the signature and expiry, returning the embedded claims.
func (v *HMACTokenVerifier) Verify(token string) (*TokenClaims, error) {
	if v == nil || len(v.secret) == 0 {
		return nil, errors.New("verifier not initialised")
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrInvalidToken
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, ErrInvalidToken
	}
	headerPayload := strings.Join(parts[:2], ".")
	signaturePart := parts[2]

	headerBytes, err := decodeSegment(parts[0])
	if err != nil {
		return nil, ErrInvalidToken
	}
	var header struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, ErrInvalidToken
	}
	if header.Algorithm != "HS256" {
		return nil, fmt.Errorf("%w: unexpected algorithm %q", ErrInvalidToken, header.Algorithm)
	}

	expectedSig, err := v.sign([]byte(headerPayload))
	if err != nil {
		return nil, err
	}
	signatureBytes, err := decodeSegment(signaturePart)
	if err != nil {
		return nil, ErrInvalidToken
	}
	if !hmac.Equal(signatureBytes, expectedSig) {
		return nil, ErrInvalidToken
	}

	payloadBytes, err := decodeSegment(parts[1])
	if err != nil {
		return nil, ErrInvalidToken
	}
	var payload struct {
		Subject  string `json:"sub"`
		Expires  int64  `json:"exp"`
		Issued   int64  `json:"iat"`
		Audience string `json:"aud"`
	}
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, ErrInvalidToken
	}
	if strings.TrimSpace(payload.Subject) == "" {
		return nil, ErrInvalidToken
	}
	if payload.Expires <= 0 {
		return nil, ErrInvalidToken
	}
	now := v.now()
	expiresAt := time.Unix(payload.Expires, 0)
	if expiresAt.Add(v.leeway).Before(now) {
		return nil, ErrExpiredToken
	}

	issuedAt := time.Unix(payload.Issued, 0)
	claims := &TokenClaims{
		Subject:   payload.Subject,
		ExpiresAt: expiresAt,
		IssuedAt:  issuedAt,
		Audience:  payload.Audience,
	}
	return claims, nil
}

func (v *HMACTokenVerifier) sign(payload []byte) ([]byte, error) {
	mac := hmac.New(sha256.New, v.secret)
	if _, err := mac.Write(payload); err != nil {
		return nil, err
	}
	return mac.Sum(nil), nil
}

func decodeSegment(segment string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(segment)
}

// WithClock overrides the verifier clock, enabling deterministic unit tests.
func (v *HMACTokenVerifier) WithClock(clock func() time.Time) {
	if clock == nil {
		return
	}
	v.now = clock
}
