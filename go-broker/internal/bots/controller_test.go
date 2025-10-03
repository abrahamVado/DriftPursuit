package bots

import (
	"context"
	"errors"
	"testing"
)

type fakeLauncher struct {
	targets []int
	result  int
	err     error
}

func (f *fakeLauncher) Scale(ctx context.Context, target int) (int, error) {
	//1.- Record every requested target so tests can inspect reconciliation behaviour.
	f.targets = append(f.targets, target)
	if f.err != nil {
		return 0, f.err
	}
	if f.result >= 0 {
		return f.result, nil
	}
	return target, nil
}

func TestControllerHumanLifecycle(t *testing.T) {
	launcher := &fakeLauncher{result: -1}
	controller := NewController(ControllerConfig{TargetPopulation: 5, Launcher: launcher})
	ctx := context.Background()

	if err := controller.HumanConnected(ctx); err != nil {
		t.Fatalf("connect human: %v", err)
	}
	if err := controller.HumanConnected(ctx); err != nil {
		t.Fatalf("connect second human: %v", err)
	}
	snap := controller.Snapshot()
	if snap.Humans != 2 {
		t.Fatalf("expected 2 humans, got %d", snap.Humans)
	}
	if snap.Bots != 3 {
		t.Fatalf("expected 3 bots, got %d", snap.Bots)
	}
	if err := controller.HumanDisconnected(ctx); err != nil {
		t.Fatalf("disconnect human: %v", err)
	}
	snap = controller.Snapshot()
	if snap.Humans != 1 || snap.Bots != 4 {
		t.Fatalf("unexpected snapshot after disconnect: %+v", snap)
	}
	want := []int{4, 3, 4}
	if len(launcher.targets) != len(want) {
		t.Fatalf("expected %d reconciliations, got %d", len(want), len(launcher.targets))
	}
	for i, expected := range want {
		if launcher.targets[i] != expected {
			t.Fatalf("reconciliation %d: expected %d, got %d", i, expected, launcher.targets[i])
		}
	}
}

func TestControllerLauncherFailure(t *testing.T) {
	launcher := &fakeLauncher{err: errors.New("boom")}
	controller := NewController(ControllerConfig{TargetPopulation: 3, Launcher: launcher})
	ctx := context.Background()

	err := controller.HumanConnected(ctx)
	if err == nil {
		t.Fatal("expected error from launcher")
	}
	snap := controller.Snapshot()
	if snap.Bots != 0 {
		t.Fatalf("bots should remain unchanged when launcher fails, got %d", snap.Bots)
	}
}

func TestControllerSetTargetPopulation(t *testing.T) {
	launcher := &fakeLauncher{result: -1}
	controller := NewController(ControllerConfig{TargetPopulation: 2, Launcher: launcher})
	ctx := context.Background()

	if err := controller.SetTargetPopulation(ctx, 6); err != nil {
		t.Fatalf("set target: %v", err)
	}
	snap := controller.Snapshot()
	if snap.Bots != 6 {
		t.Fatalf("expected bots to match new target before humans, got %d", snap.Bots)
	}
	if err := controller.HumanConnected(ctx); err != nil {
		t.Fatalf("human join: %v", err)
	}
	snap = controller.Snapshot()
	if snap.Humans != 1 || snap.Bots != 5 {
		t.Fatalf("snapshot mismatch after human join: %+v", snap)
	}
}
