package main

import (
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"os"
	"strings"

	configpkg "driftpursuit/broker/internal/config"
	"driftpursuit/broker/internal/logging"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const sharedSecretMetadataKey = "x-broker-shared-secret"

func configureGRPCSecurity(cfg *configpkg.Config, logger *logging.Logger) ([]grpc.ServerOption, func(), error) {
	if cfg == nil {
		return nil, func() {}, fmt.Errorf("grpc config required")
	}
	if logger == nil {
		logger = logging.L()
	}
	var opts []grpc.ServerOption
	cleanup := func() {}

	switch cfg.GRPCAuthMode {
	case configpkg.GRPCAuthModeMTLS:
		creds, err := loadMTLSCredentials(cfg.GRPCServerCertPath, cfg.GRPCServerKeyPath, cfg.GRPCClientCAPath)
		if err != nil {
			return nil, cleanup, err
		}
		opts = append(opts, grpc.Creds(creds))
		if logger != nil {
			logger.Info("gRPC mTLS enabled")
		}
	case configpkg.GRPCAuthModeSharedSecret:
		interceptor := newSharedSecretStreamInterceptor(cfg.GRPCSharedSecret)
		opts = append(opts, grpc.ChainStreamInterceptor(interceptor))
		if logger != nil {
			logger.Info("gRPC shared-secret authentication enabled")
		}
	default:
		return nil, cleanup, fmt.Errorf("unsupported grpc auth mode %q", cfg.GRPCAuthMode)
	}

	return opts, cleanup, nil
}

func newSharedSecretStreamInterceptor(secret string) grpc.StreamServerInterceptor {
	normalized := strings.TrimSpace(secret)
	return func(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if normalized == "" {
			return status.Error(codes.Unauthenticated, "shared secret not configured")
		}
		md, ok := metadata.FromIncomingContext(ss.Context())
		if !ok {
			return status.Error(codes.Unauthenticated, "missing metadata")
		}
		candidate := extractSharedSecret(md)
		if candidate == "" {
			return status.Error(codes.Unauthenticated, "missing shared secret")
		}
		if subtle.ConstantTimeCompare([]byte(candidate), []byte(normalized)) != 1 {
			return status.Error(codes.Unauthenticated, "invalid shared secret")
		}
		return handler(srv, ss)
	}
}

func extractSharedSecret(md metadata.MD) string {
	if md == nil {
		return ""
	}
	for _, value := range md.Get(sharedSecretMetadataKey) {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	for _, value := range md.Get("authorization") {
		if strings.HasPrefix(strings.ToLower(value), "bearer ") {
			token := strings.TrimSpace(value[7:])
			if token != "" {
				return token
			}
		}
	}
	return ""
}

func loadMTLSCredentials(certPath, keyPath, caPath string) (credentials.TransportCredentials, error) {
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, fmt.Errorf("load server keypair: %w", err)
	}
	caFile, err := os.Open(caPath)
	if err != nil {
		return nil, fmt.Errorf("open client ca: %w", err)
	}
	defer caFile.Close()
	caBytes, err := io.ReadAll(caFile)
	if err != nil {
		return nil, fmt.Errorf("read client ca: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caBytes) {
		return nil, fmt.Errorf("failed to parse client ca bundle")
	}
	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
		MinVersion:   tls.VersionTLS12,
	}
	return credentials.NewTLS(tlsConfig), nil
}
