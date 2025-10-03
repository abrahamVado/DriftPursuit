package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	configpkg "driftpursuit/broker/internal/config"
	"driftpursuit/broker/internal/logging"
	"driftpursuit/broker/internal/networking"
	pb "driftpursuit/broker/internal/proto/pb"
	"driftpursuit/broker/internal/replay"
)

func TestBrokerLargeScaleSimulationMonitorsBandwidthAndTicks(t *testing.T) {
	logger := logging.NewTestLogger()
	base := time.Date(2024, 8, 1, 12, 0, 0, 0, time.UTC)

	now := time.Unix(0, 0)
	clock := func() time.Time { return now }
	regulator := networking.NewBandwidthRegulator(1<<20, clock)

	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, base, logger, WithBandwidthRegulator(regulator))

	for i := 0; i < 48; i++ {
		id := fmt.Sprintf("actor-%02d", i)
		broker.world.Vehicles.Upsert(&pb.VehicleState{
			SchemaVersion:       "2024-test",
			VehicleId:           id,
			Position:            &pb.Vector3{X: float64(i), Y: float64(i % 4), Z: 0},
			Velocity:            &pb.Vector3{X: 1, Y: 0, Z: 0},
			FlightAssistEnabled: true,
			UpdatedAtMs:         base.UnixMilli(),
		})
	}

	step := 16 * time.Millisecond
	for frame := 0; frame < 120; frame++ {
		broker.advanceSimulation(step)
		for i := 0; i < 48; i++ {
			clientID := fmt.Sprintf("client-%02d", i)
			if !broker.bandwidth.Allow(clientID, 2048) {
				t.Fatalf("unexpected throttle for %s", clientID)
			}
		}
		now = now.Add(step)
	}
	now = now.Add(200 * time.Millisecond)

	if broker.tickCounter == 0 {
		t.Fatalf("expected simulation to advance ticks")
	}

	metrics := broker.TickMetrics()
	if metrics.Samples < 120 {
		t.Fatalf("expected at least 120 samples, got %d", metrics.Samples)
	}
	if metrics.Average <= 0 {
		t.Fatalf("expected average tick duration > 0")
	}
	if metrics.AverageFPS() < 55 {
		t.Fatalf("expected average FPS >= 55, got %.2f", metrics.AverageFPS())
	}

	usage := broker.bandwidth.SnapshotUsage()
	if len(usage) != 48 {
		t.Fatalf("expected bandwidth stats for 48 clients, got %d", len(usage))
	}
	for id, sample := range usage {
		if sample.BytesPerSecond <= 0 {
			t.Fatalf("expected throughput sample for %s", id)
		}
	}
}

func TestDumpReplayProducesLoadableReplay(t *testing.T) {
	tmp := t.TempDir()
	base := time.Date(2024, 7, 15, 16, 0, 0, 0, time.UTC)

	recorder, err := replay.NewRecorder(tmp, nil)
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}

	logger := logging.NewTestLogger()
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, base, logger,
		WithReplayRecorder(recorder),
		WithMatchMetadata("seed-load", replay.TerrainParameters{"roughness": 0.4}),
	)

	broker.replayRecorder.RecordTick(1, 0, []byte(`{"tick":1}`))
	broker.replayRecorder.RecordWorldFrame(1, 16, []byte(`{"world":true}`))
	broker.replayRecorder.RecordEvent(1, 32, []byte(`{"event":"goal"}`))

	path, err := broker.DumpReplay(context.Background())
	if err != nil {
		t.Fatalf("DumpReplay: %v", err)
	}

	loader, err := replay.Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	entries := loader.Entries()
	if len(entries) < 3 {
		t.Fatalf("expected at least 3 replay entries, got %d", len(entries))
	}

	kinds := map[string]bool{}
	for _, entry := range entries {
		kinds[entry.Type] = true
	}
	for _, expected := range []string{"diff", "world", "event"} {
		if !kinds[expected] {
			t.Fatalf("missing replay entry type %q", expected)
		}
	}

	count := 0
	if err := loader.Replay(func(replay.TimelineEntry) error {
		// //1.- Count entries to verify deterministic iteration succeeds.
		count++
		return nil
	}); err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if count != len(entries) {
		t.Fatalf("expected to visit %d entries, visited %d", len(entries), count)
	}
}
