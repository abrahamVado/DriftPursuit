package grpc

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	brokerpb "driftpursuit/broker/internal/proto/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type bridgeStub struct {
	events   []DiffEvent
	results  []IntentResult
	payloads []*IntentSubmission
	err      error
}

func (b *bridgeStub) SubscribeStateDiffs(ctx context.Context) (<-chan DiffEvent, func(), error) {
	if b.err != nil {
		return nil, func() {}, b.err
	}
	ch := make(chan DiffEvent, len(b.events))
	go func(events []DiffEvent) {
		for _, event := range events {
			ch <- event
		}
		close(ch)
	}(append([]DiffEvent(nil), b.events...))
	return ch, func() {}, nil
}

func (b *bridgeStub) ProcessIntent(ctx context.Context, submission *IntentSubmission) IntentResult {
	b.payloads = append(b.payloads, submission)
	if len(b.results) == 0 {
		return IntentResult{Accepted: true}
	}
	result := b.results[0]
	b.results = b.results[1:]
	return result
}

type diffStreamStub struct {
	ctx    context.Context
	frames []*brokerpb.StateDiffFrame
}

func (s *diffStreamStub) Send(frame *brokerpb.StateDiffFrame) error {
	s.frames = append(s.frames, frame)
	return nil
}

func (s *diffStreamStub) SetHeader(metadata.MD) error  { return nil }
func (s *diffStreamStub) SendHeader(metadata.MD) error { return nil }
func (s *diffStreamStub) SetTrailer(metadata.MD)       {}
func (s *diffStreamStub) Context() context.Context     { return s.ctx }
func (s *diffStreamStub) SendMsg(m interface{}) error  { return s.Send(m.(*brokerpb.StateDiffFrame)) }
func (s *diffStreamStub) RecvMsg(interface{}) error    { return nil }

var _ grpc.ServerStreamingServer[brokerpb.StateDiffFrame] = (*diffStreamStub)(nil)

type intentStreamStub struct {
	ctx    context.Context
	frames []*brokerpb.IntentFrame
	index  int
	ack    *brokerpb.IntentStreamAck
}

func (s *intentStreamStub) SendAndClose(ack *brokerpb.IntentStreamAck) error {
	s.ack = ack
	return nil
}

func (s *intentStreamStub) Recv() (*brokerpb.IntentFrame, error) {
	if s.index >= len(s.frames) {
		return nil, io.EOF
	}
	frame := s.frames[s.index]
	s.index++
	return frame, nil
}

func (s *intentStreamStub) SetHeader(metadata.MD) error  { return nil }
func (s *intentStreamStub) SendHeader(metadata.MD) error { return nil }
func (s *intentStreamStub) SetTrailer(metadata.MD)       {}
func (s *intentStreamStub) Context() context.Context     { return s.ctx }
func (s *intentStreamStub) SendMsg(interface{}) error    { return nil }
func (s *intentStreamStub) RecvMsg(interface{}) error    { return nil }

var _ grpc.ClientStreamingServer[brokerpb.IntentFrame, brokerpb.IntentStreamAck] = (*intentStreamStub)(nil)

type manualDiffBridge struct {
	ch <-chan DiffEvent
}

func (m *manualDiffBridge) SubscribeStateDiffs(context.Context) (<-chan DiffEvent, func(), error) {
	return m.ch, func() {}, nil
}

func (m *manualDiffBridge) ProcessIntent(context.Context, *IntentSubmission) IntentResult {
	return IntentResult{Accepted: true}
}

var _ BrokerBridge = (*manualDiffBridge)(nil)

func TestServiceStreamStateDiffs(t *testing.T) {
	compressor := NewGZIPCompressor()
	payload := []byte("diff-json")
	diffCh := make(chan DiffEvent, 1)
	diffCh <- DiffEvent{Tick: 42, Payload: payload}
	close(diffCh)

	tickCh := make(chan time.Time, 2)
	service := NewService(&manualDiffBridge{ch: diffCh}, WithTickerFactory(func(time.Duration) (<-chan time.Time, func()) {
		return tickCh, func() {}
	}))

	stream := &diffStreamStub{ctx: context.Background()}
	done := make(chan error, 1)
	go func() {
		done <- service.StreamStateDiffs(&brokerpb.StreamStateDiffsRequest{ClientId: "bot-a"}, stream)
	}()

	go func() {
		time.Sleep(2 * time.Millisecond)
		tickCh <- time.Now()
		time.Sleep(2 * time.Millisecond)
		tickCh <- time.Now()
	}()

	if err := <-done; err != nil {
		t.Fatalf("stream state diffs: %v", err)
	}
	if len(stream.frames) != 1 {
		t.Fatalf("expected 1 frame, got %d", len(stream.frames))
	}
	frame := stream.frames[0]
	if frame.Tick != 42 {
		t.Fatalf("unexpected tick %d", frame.Tick)
	}
	if frame.Encoding != compressor.Name() {
		t.Fatalf("unexpected encoding %q", frame.Encoding)
	}
	decoded, err := compressor.Decompress(frame.Payload)
	if err != nil {
		t.Fatalf("decompress: %v", err)
	}
	if string(decoded) != string(payload) {
		t.Fatalf("payload mismatch: got %q want %q", decoded, payload)
	}
}

func TestServiceStreamStateDiffsError(t *testing.T) {
	bridge := &bridgeStub{err: errors.New("subscribe failed")}
	service := NewService(bridge)
	stream := &diffStreamStub{ctx: context.Background()}
	err := service.StreamStateDiffs(&brokerpb.StreamStateDiffsRequest{}, stream)
	if status.Code(err) != codes.Internal {
		t.Fatalf("expected internal error, got %v", err)
	}
}

func TestServiceStreamStateDiffsOrdering(t *testing.T) {
	compressor := NewGZIPCompressor()
	diffCh := make(chan DiffEvent, 3)
	ticks := []uint64{1, 2, 3}
	tickCh := make(chan time.Time, len(ticks)+1)
	service := NewService(&manualDiffBridge{ch: diffCh}, WithTickerFactory(func(time.Duration) (<-chan time.Time, func()) {
		return tickCh, func() {}
	}))

	stream := &diffStreamStub{ctx: context.Background()}
	payload := []byte("ordered")

	done := make(chan error, 1)
	go func() {
		done <- service.StreamStateDiffs(&brokerpb.StreamStateDiffsRequest{ClientId: "bot-a"}, stream)
	}()

	go func() {
		for range ticks {
			time.Sleep(2 * time.Millisecond)
			tickCh <- time.Now()
		}
		time.Sleep(2 * time.Millisecond)
		tickCh <- time.Now()
	}()

	for _, tick := range ticks {
		diffCh <- DiffEvent{Tick: tick, Payload: payload}
	}
	close(diffCh)

	if err := <-done; err != nil {
		t.Fatalf("stream state diffs: %v", err)
	}
	if len(stream.frames) != len(ticks) {
		t.Fatalf("expected %d frames, got %d", len(ticks), len(stream.frames))
	}
	for i, frame := range stream.frames {
		if frame.Tick != ticks[i] {
			t.Fatalf("frame %d tick mismatch: got %d want %d", i, frame.Tick, ticks[i])
		}
		decoded, err := compressor.Decompress(frame.Payload)
		if err != nil {
			t.Fatalf("frame %d decompress: %v", i, err)
		}
		if string(decoded) != string(payload) {
			t.Fatalf("frame %d payload mismatch", i)
		}
	}
}

func TestServicePublishIntents(t *testing.T) {
	compressor := NewGZIPCompressor()
	frames := []*brokerpb.IntentFrame{
		{
			ClientId: "bot-a",
			Encoding: compressor.Name(),
			Payload:  mustCompress(t, compressor, []byte("intent-one")),
		},
		{
			ClientId: "bot-a",
			Encoding: compressor.Name(),
			Payload:  mustCompress(t, compressor, []byte("intent-two")),
		},
	}
	bridge := &bridgeStub{results: []IntentResult{{Accepted: true}, {Err: errors.New("rejected")}}}
	service := NewService(bridge)
	stream := &intentStreamStub{ctx: context.Background(), frames: frames}

	if err := service.PublishIntents(stream); err != nil {
		t.Fatalf("publish intents: %v", err)
	}
	if stream.ack == nil {
		t.Fatal("missing ack")
	}
	if stream.ack.Accepted != 1 || stream.ack.Rejected != 1 {
		t.Fatalf("unexpected ack: %+v", stream.ack)
	}
	if len(bridge.payloads) != len(frames) {
		t.Fatalf("unexpected payload count: %d", len(bridge.payloads))
	}
	for i, submission := range bridge.payloads {
		decoded, err := compressor.Decompress(frames[i].Payload)
		if err != nil {
			t.Fatalf("decompress frame %d: %v", i, err)
		}
		if string(submission.Payload) != string(decoded) {
			t.Fatalf("submission mismatch: got %q want %q", submission.Payload, decoded)
		}
	}
}

func TestServicePublishIntentsDisconnect(t *testing.T) {
	compressor := NewGZIPCompressor()
	frames := []*brokerpb.IntentFrame{
		{
			ClientId: "bot-a",
			Encoding: compressor.Name(),
			Payload:  mustCompress(t, compressor, []byte("intent")),
		},
	}
	bridge := &bridgeStub{results: []IntentResult{{Err: errors.New("fatal"), Disconnect: true}}}
	service := NewService(bridge)
	stream := &intentStreamStub{ctx: context.Background(), frames: frames}

	err := service.PublishIntents(stream)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected permission denied, got %v", err)
	}
}

func TestServicePublishIntentsUnsupportedEncoding(t *testing.T) {
	frames := []*brokerpb.IntentFrame{{ClientId: "bot-a", Encoding: "zstd", Payload: []byte("raw")}}
	bridge := &bridgeStub{}
	service := NewService(bridge)
	stream := &intentStreamStub{ctx: context.Background(), frames: frames}
	err := service.PublishIntents(stream)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func mustCompress(t *testing.T, compressor Compressor, payload []byte) []byte {
	t.Helper()
	data, err := compressor.Compress(payload)
	if err != nil {
		t.Fatalf("compress: %v", err)
	}
	return data
}
