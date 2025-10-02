package events

import (
	"context"
	"errors"
	"testing"
	"time"

	pb "driftpursuit/broker/internal/proto/pb"
)

func TestStreamDeliverAndAck(t *testing.T) {
	//1.- Arrange a stream and subscribe a test client.
	stream := NewStream(Config{Retain: 8})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub, err := stream.Subscribe(ctx, "alpha", 4)
	if err != nil {
		t.Fatalf("subscribe failed: %v", err)
	}

	//2.- Publish a combat, radar, and respawn event for coverage.
	telemetry := CombatTelemetry{EventID: "evt-1", OccurredAt: time.UnixMilli(42)}
	if _, err := stream.PublishCombat(telemetry); err != nil {
		t.Fatalf("publish combat failed: %v", err)
	}

	radar := &pb.RadarContact{SourceEntityId: "radar", Entries: []*pb.RadarContactEntry{{TargetEntityId: "bogey"}}}
	if _, err := stream.PublishRadar(radar); err != nil {
		t.Fatalf("publish radar failed: %v", err)
	}

	respawn := &pb.GameEvent{EventId: "evt-3", Type: pb.EventType_EVENT_TYPE_SPAWNED}
	if _, err := stream.PublishRespawn(respawn); err != nil {
		t.Fatalf("publish respawn failed: %v", err)
	}

	//3.- Assert sequential delivery and sequential acknowledgement.
	for expected := uint64(1); expected <= 3; expected++ {
		select {
		case env := <-sub.Events():
			if env.Sequence != expected {
				t.Fatalf("expected sequence %d, got %d", expected, env.Sequence)
			}
			if err := sub.Ack(env.Sequence); err != nil {
				t.Fatalf("ack failed: %v", err)
			}
		case <-time.After(time.Second):
			t.Fatalf("timeout waiting for event %d", expected)
		}
	}
}

func TestStreamResendsUnackedEventsOnResubscribe(t *testing.T) {
	//1.- Establish the stream and initial subscription.
	stream := NewStream(Config{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub, err := stream.Subscribe(ctx, "bravo", 2)
	if err != nil {
		t.Fatalf("subscribe failed: %v", err)
	}

	//2.- Publish two lifecycle events and ack only the first.
	first := &pb.GameEvent{EventId: "first", Type: pb.EventType_EVENT_TYPE_DESTROYED}
	second := &pb.GameEvent{EventId: "second", Type: pb.EventType_EVENT_TYPE_DESTROYED}
	if _, err := stream.PublishLifecycle(first); err != nil {
		t.Fatalf("publish first lifecycle failed: %v", err)
	}
	if _, err := stream.PublishLifecycle(second); err != nil {
		t.Fatalf("publish second lifecycle failed: %v", err)
	}

	env := <-sub.Events()
	if env.Game.GetEventId() != "first" {
		t.Fatalf("expected first event, got %q", env.Game.GetEventId())
	}
	if err := sub.Ack(env.Sequence); err != nil {
		t.Fatalf("ack first failed: %v", err)
	}

	//3.- Drop the second event to simulate packet loss and close the subscription.
	<-sub.Events() // intentionally read without acking
	sub.Close()

	//4.- Re-subscribe and ensure the unacked event is replayed.
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()

	replay, err := stream.Subscribe(ctx2, "bravo", 2)
	if err != nil {
		t.Fatalf("resubscribe failed: %v", err)
	}

	select {
	case env := <-replay.Events():
		if env.Game.GetEventId() != "second" {
			t.Fatalf("expected replay of second event, got %q", env.Game.GetEventId())
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for replayed event")
	}
}

func TestStreamRejectsOutOfOrderAck(t *testing.T) {
	//1.- Create the stream and publish a pair of events.
	stream := NewStream(Config{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub, err := stream.Subscribe(ctx, "charlie", 2)
	if err != nil {
		t.Fatalf("subscribe failed: %v", err)
	}

	lifecycle := &pb.GameEvent{EventId: "lifecycle", Type: pb.EventType_EVENT_TYPE_DESTROYED}
	respawn := &pb.GameEvent{EventId: "respawn", Type: pb.EventType_EVENT_TYPE_SPAWNED}
	if _, err := stream.PublishLifecycle(lifecycle); err != nil {
		t.Fatalf("publish lifecycle failed: %v", err)
	}
	if _, err := stream.PublishRespawn(respawn); err != nil {
		t.Fatalf("publish respawn failed: %v", err)
	}

	first := <-sub.Events()
	second := <-sub.Events()

	//2.- Attempt to ack the second sequence before the first and expect an error.
	if err := sub.Ack(second.Sequence); !errors.Is(err, ErrOutOfOrderAck) {
		t.Fatalf("expected out of order error, got %v", err)
	}

	//3.- Ack in the correct order to ensure recovery remains possible.
	if err := sub.Ack(first.Sequence); err != nil {
		t.Fatalf("ack first failed: %v", err)
	}
	if err := sub.Ack(second.Sequence); err != nil {
		t.Fatalf("ack second failed: %v", err)
	}
}
