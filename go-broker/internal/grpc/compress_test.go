package grpc

import "testing"

func TestGZIPRoundTrip(t *testing.T) {
	compressor := NewGZIPCompressor()
	payload := []byte("hello world")

	compressed, err := compressor.Compress(payload)
	if err != nil {
		t.Fatalf("compress: %v", err)
	}
	if len(compressed) == 0 {
		t.Fatal("compressed payload empty")
	}
	decompressed, err := compressor.Decompress(compressed)
	if err != nil {
		t.Fatalf("decompress: %v", err)
	}
	if string(decompressed) != string(payload) {
		t.Fatalf("round trip mismatch: got %q want %q", decompressed, payload)
	}
}

func TestGZIPDecompressEmpty(t *testing.T) {
	compressor := NewGZIPCompressor()
	if _, err := compressor.Decompress(nil); err == nil {
		t.Fatal("expected error for empty payload")
	}
}
