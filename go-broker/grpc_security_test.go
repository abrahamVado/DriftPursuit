package main

import (
	"context"
	"os"
	"testing"

	configpkg "driftpursuit/broker/internal/config"
	"driftpursuit/broker/internal/logging"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type stubServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *stubServerStream) Context() context.Context {
	return s.ctx
}

func TestSharedSecretInterceptorAcceptsValidSecret(t *testing.T) {
	interceptor := newSharedSecretStreamInterceptor("hunter2")
	md := metadata.New(map[string]string{sharedSecretMetadataKey: "hunter2"})
	stream := &stubServerStream{ctx: metadata.NewIncomingContext(context.Background(), md)}
	called := false
	handler := func(interface{}, grpc.ServerStream) error {
		called = true
		return nil
	}
	if err := interceptor(nil, stream, &grpc.StreamServerInfo{}, handler); err != nil {
		t.Fatalf("interceptor returned error: %v", err)
	}
	if !called {
		t.Fatal("expected handler to be invoked for valid secret")
	}
}

func TestSharedSecretInterceptorRejectsMissingSecret(t *testing.T) {
	interceptor := newSharedSecretStreamInterceptor("hunter2")
	stream := &stubServerStream{ctx: context.Background()}
	handler := func(interface{}, grpc.ServerStream) error { return nil }
	err := interceptor(nil, stream, &grpc.StreamServerInfo{}, handler)
	if err == nil {
		t.Fatal("expected error for missing secret")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("expected unauthenticated code, got %v", st.Code())
	}
}

func TestLoadMTLSCredentialsFailsWithBadPaths(t *testing.T) {
	if _, err := loadMTLSCredentials("missing-cert", "missing-key", "missing-ca"); err == nil {
		t.Fatal("expected error for missing files")
	}
}

func TestConfigureGRPCSecurityMTLS(t *testing.T) {
	certFile, keyFile := generateSelfSignedCert(t)
	defer os.Remove(certFile)
	defer os.Remove(keyFile)
	caFile := certFile

	cfg := &configpkg.Config{GRPCAuthMode: configpkg.GRPCAuthModeMTLS, GRPCServerCertPath: certFile, GRPCServerKeyPath: keyFile, GRPCClientCAPath: caFile}
	opts, _, err := configureGRPCSecurity(cfg, logging.NewTestLogger())
	if err != nil {
		t.Fatalf("configureGRPCSecurity: %v", err)
	}
	if len(opts) == 0 {
		t.Fatal("expected grpc options for mtls configuration")
	}
}

func TestConfigureGRPCSecuritySharedSecret(t *testing.T) {
	cfg := &configpkg.Config{GRPCAuthMode: configpkg.GRPCAuthModeSharedSecret, GRPCSharedSecret: "hunter2"}
	opts, _, err := configureGRPCSecurity(cfg, logging.NewTestLogger())
	if err != nil {
		t.Fatalf("configureGRPCSecurity: %v", err)
	}
	if len(opts) == 0 {
		t.Fatal("expected grpc options for shared secret configuration")
	}
}
