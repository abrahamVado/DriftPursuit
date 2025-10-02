package grpc

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
)

// Compressor applies symmetric compression to payload byte slices.
type Compressor interface {
	//1.- Name returns the codec identifier advertised in RPC payloads.
	Name() string
	//2.- Compress encodes the provided payload into a compressed representation.
	Compress(data []byte) ([]byte, error)
	//3.- Decompress restores the original payload from its compressed form.
	Decompress(data []byte) ([]byte, error)
}

// gzipCompressor wraps the standard library gzip implementation.
type gzipCompressor struct{}

// NewGZIPCompressor constructs a Compressor backed by gzip.
func NewGZIPCompressor() Compressor {
	return gzipCompressor{}
}

// Name reports the identifier used for gzip encoded payloads.
func (gzipCompressor) Name() string { return "gzip" }

// Compress encodes data using the gzip format.
func (gzipCompressor) Compress(data []byte) ([]byte, error) {
	//1.- Allocate a buffer so we can reuse the compressed bytes without copying.
	var buf bytes.Buffer
	writer := gzip.NewWriter(&buf)
	if _, err := writer.Write(data); err != nil {
		writer.Close()
		return nil, fmt.Errorf("gzip write: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("gzip close: %w", err)
	}
	return buf.Bytes(), nil
}

// Decompress decodes gzip-encoded data and returns the raw payload.
func (gzipCompressor) Decompress(data []byte) ([]byte, error) {
	//1.- Guard against nil payloads to simplify caller logic.
	if len(data) == 0 {
		return nil, fmt.Errorf("gzip decompress: empty payload")
	}
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("gzip reader: %w", err)
	}
	defer reader.Close()
	//2.- Copy the uncompressed bytes into a buffer for the caller.
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, reader); err != nil {
		return nil, fmt.Errorf("gzip copy: %w", err)
	}
	return buf.Bytes(), nil
}
