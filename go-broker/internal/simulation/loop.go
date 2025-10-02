package simulation

import (
	"context"
	"time"
)

// StepFunc advances the simulation by a fixed timestep and may emit side effects.
type StepFunc func(step time.Duration)

// Loop drives a fixed timestep simulation at the configured target frequency.
type Loop struct {
	step     time.Duration
	stepFunc StepFunc
	ticker   *time.Ticker
	done     chan struct{}
}

// NewLoop configures a loop that targets the provided frames per second.
func NewLoop(targetHz float64, step StepFunc) *Loop {
	if targetHz <= 0 {
		targetHz = 60
	}
	if step == nil {
		step = func(time.Duration) {}
	}
	interval := time.Duration(float64(time.Second) / targetHz)
	if interval <= 0 {
		interval = time.Second / 60
	}
	return &Loop{
		step:     interval,
		stepFunc: step,
	}
}

// Start begins ticking until the context is cancelled or Stop is invoked.
func (l *Loop) Start(ctx context.Context) {
	if l == nil || l.stepFunc == nil {
		return
	}

	l.ticker = time.NewTicker(l.step)
	l.done = make(chan struct{})
	go func() {
		defer close(l.done)
		defer l.ticker.Stop()
		last := time.Now()
		accumulator := time.Duration(0)
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-l.ticker.C:
				//1.- Accumulate elapsed time and run fixed steps while catching up.
				accumulator += now.Sub(last)
				last = now
				for accumulator >= l.step {
					l.stepFunc(l.step)
					accumulator -= l.step
				}
			}
		}
	}()
}

// Stop cancels the loop and waits for the goroutine to exit.
func (l *Loop) Stop() {
	if l == nil {
		return
	}
	if l.ticker != nil {
		l.ticker.Stop()
	}
	if l.done != nil {
		<-l.done
		l.done = nil
	}
}

// StepDuration exposes the configured timestep for testing.
func (l *Loop) StepDuration() time.Duration {
	if l == nil {
		return 0
	}
	return l.step
}
