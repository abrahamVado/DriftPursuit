package bots

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// HTTPLauncher implements the Launcher interface against an HTTP bot runner service.
type HTTPLauncher struct {
	client   *http.Client
	endpoint string
}

// NewHTTPLauncher wires an HTTP client to the remote bot runner endpoint.
func NewHTTPLauncher(endpoint string, client *http.Client) (*HTTPLauncher, error) {
	if endpoint == "" {
		return nil, errors.New("endpoint must not be empty")
	}
	//1.- Reuse the provided client when available so callers can inject transport tweaks.
	if client == nil {
		client = http.DefaultClient
	}
	launcher := &HTTPLauncher{endpoint: endpoint, client: client}
	return launcher, nil
}

// Scale relays the requested bot population to the remote launcher service.
func (l *HTTPLauncher) Scale(ctx context.Context, target int) (int, error) {
	if l == nil {
		return 0, errors.New("launcher is nil")
	}
	if target < 0 {
		return 0, errors.New("target must be non-negative")
	}
	payload := map[string]int{"target": target}
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("marshal request: %w", err)
	}
	//1.- Build the POST request inline so contexts propagate cancellation semantics downstream.
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, l.endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := l.client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("send scale request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("launcher responded with status %s", resp.Status)
	}
	var decoded struct {
		Running int `json:"running"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return 0, fmt.Errorf("decode response: %w", err)
	}
	//2.- Honour the remote count when provided so metrics reflect the external truth.
	if decoded.Running >= 0 {
		return decoded.Running, nil
	}
	return target, nil
}
