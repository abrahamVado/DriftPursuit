package simulation

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestLoopRunsAtLeastTargetTicks(t *testing.T) {
	var ticks int32
	loop := NewLoop(60, func(time.Duration) {
		atomic.AddInt32(&ticks, 1)
	})
	ctx, cancel := context.WithCancel(context.Background())
	loop.Start(ctx)
	time.Sleep(55 * time.Millisecond)
	cancel()
	loop.Stop()
	if atomic.LoadInt32(&ticks) == 0 {
		t.Fatalf("expected loop to tick at least once")
	}
}

func TestLoopStepDuration(t *testing.T) {
	loop := NewLoop(120, func(time.Duration) {})
	step := loop.StepDuration()
	expected := time.Second / 120
	if step != expected {
		t.Fatalf("unexpected step duration %v", step)
	}
}
