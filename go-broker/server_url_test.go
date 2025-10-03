package main

import "testing"

func TestListenerURL(t *testing.T) {
	t.Parallel()

	tests := map[string]struct {
		address string
		tls     bool
		want    string
	}{
		"default_port_only":    {address: ":43127", want: "http://localhost:43127"},
		"explicit_localhost":   {address: "localhost:8000", want: "http://localhost:8000"},
		"explicit_ipv4_any":    {address: "0.0.0.0:9000", want: "http://localhost:9000"},
		"explicit_ipv4_local":  {address: "127.0.0.1:43127", want: "http://127.0.0.1:43127"},
		"explicit_ipv6_any":    {address: "[::]:43127", want: "http://localhost:43127"},
		"explicit_ipv6_custom": {address: "[2001:db8::1]:43127", want: "http://[2001:db8::1]:43127"},
		"tls_enabled":          {address: ":43127", tls: true, want: "https://localhost:43127"},
	}

	for name, tc := range tests {
		tc := tc
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			got := listenerURL(tc.address, tc.tls)
			if got != tc.want {
				t.Fatalf("listenerURL(%q, %t) = %q, want %q", tc.address, tc.tls, got, tc.want)
			}
		})
	}
}

func TestNormaliseHostPortNoPort(t *testing.T) {
	t.Parallel()

	got := normaliseHostPort("")
	if got != "localhost" {
		t.Fatalf("expected localhost for empty address, got %q", got)
	}
}
