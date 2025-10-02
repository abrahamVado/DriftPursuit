package timesync

import (
	"context"
	"testing"
	"time"

	pb "driftpursuit/broker/internal/proto/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

type clockStub struct {
	snapshots int
	logged    []struct {
		channel string
		target  string
		offset  int64
	}
}

func (c *clockStub) TimeSyncSnapshot() (int64, int64, int64) {
	c.snapshots++
	return 10, 20, 5
}

func (c *clockStub) LogTimeDrift(channel, target string, offsetMs int64) {
	c.logged = append(c.logged, struct {
		channel string
		target  string
		offset  int64
	}{channel: channel, target: target, offset: offsetMs})
}

type streamStub struct {
	ctx     context.Context
	updates []*pb.TimeSyncUpdate
}

func (s *streamStub) Send(update *pb.TimeSyncUpdate) error {
	s.updates = append(s.updates, update)
	return nil
}

func (s *streamStub) SetHeader(metadata.MD) error  { return nil }
func (s *streamStub) SendHeader(metadata.MD) error { return nil }
func (s *streamStub) SetTrailer(metadata.MD)       {}
func (s *streamStub) Context() context.Context     { return s.ctx }
func (s *streamStub) SendMsg(m interface{}) error  { return s.Send(m.(*pb.TimeSyncUpdate)) }
func (s *streamStub) RecvMsg(interface{}) error    { return nil }

var _ grpc.ServerStreamingServer[pb.TimeSyncUpdate] = (*streamStub)(nil)

func TestServiceStreamTimeSync(t *testing.T) {
	stub := &clockStub{}
	service := NewService(stub, 5*time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	stream := &streamStub{ctx: ctx}

	go func() {
		time.Sleep(15 * time.Millisecond)
		cancel()
	}()

	err := service.StreamTimeSync(&pb.TimeSyncRequest{ClientId: "observer"}, stream)
	if err != context.Canceled {
		t.Fatalf("expected context cancellation, got %v", err)
	}

	if len(stream.updates) < 2 {
		t.Fatalf("expected at least two updates, got %d", len(stream.updates))
	}
	if stub.snapshots < len(stream.updates) {
		t.Fatalf("expected snapshot per update, got %d snapshots %d updates", stub.snapshots, len(stream.updates))
	}
	if len(stub.logged) != len(stream.updates) {
		t.Fatalf("expected drift logs per update, got %d", len(stub.logged))
	}
	for _, entry := range stub.logged {
		if entry.channel != "grpc" || entry.target != "observer" {
			t.Fatalf("unexpected log entry %#v", entry)
		}
	}
}
