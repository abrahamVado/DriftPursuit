package input

import (
	"sync"
	"testing"
	"time"

	"driftpursuit/broker/internal/logging"
)

type validatorClock struct {
	mu  sync.Mutex
	now time.Time
}

// 1.- Now returns the synthetic time used to drive cooldown calculations deterministically.
func (c *validatorClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

// 2.- Advance moves the synthetic clock forward so tests can simulate elapsed time.
func (c *validatorClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

func TestValidatorAcceptsWithinConstraints(t *testing.T) {
	clock := &validatorClock{now: time.UnixMilli(0)}
	validator := NewValidator(DefaultControlConstraints, logging.NewTestLogger(), WithValidatorClock(clock))

	controls := Controls{Throttle: 0.3, Brake: 0.2, Steer: -0.1, Gear: 2}
	decision := validator.Validate("client-A", "controller-A", controls)
	if !decision.Accepted {
		t.Fatalf("expected acceptance, got %+v", decision)
	}

	validator.Commit("client-A", "controller-A", controls)

	controls2 := Controls{Throttle: 0.4, Brake: 0.3, Steer: -0.2, Gear: 3}
	decision = validator.Validate("client-A", "controller-A", controls2)
	if !decision.Accepted {
		t.Fatalf("expected acceptance on second frame, got %+v", decision)
	}
}

func TestValidatorRejectsOutOfRange(t *testing.T) {
	clock := &validatorClock{now: time.UnixMilli(0)}
	validator := NewValidator(DefaultControlConstraints, logging.NewTestLogger(), WithValidatorClock(clock))

	controls := Controls{Throttle: 1.5, Brake: 0.2, Steer: 0.1, Gear: 2}
	decision := validator.Validate("client-B", "controller-B", controls)
	if decision.Accepted {
		t.Fatalf("expected rejection for throttle overflow")
	}
	if decision.Reason != ValidationReasonThrottleRange {
		t.Fatalf("unexpected reason %s", decision.Reason)
	}
}

func TestValidatorRejectsDeltaSpike(t *testing.T) {
	clock := &validatorClock{now: time.UnixMilli(0)}
	validator := NewValidator(DefaultControlConstraints, logging.NewTestLogger(), WithValidatorClock(clock))

	baseline := Controls{Throttle: 0.0, Brake: 0.0, Steer: 0.0, Gear: 1}
	if decision := validator.Validate("client-C", "controller-C", baseline); !decision.Accepted {
		t.Fatalf("baseline rejected: %+v", decision)
	}
	validator.Commit("client-C", "controller-C", baseline)

	spike := Controls{Throttle: 0.9, Brake: 0.0, Steer: 0.0, Gear: 1}
	decision := validator.Validate("client-C", "controller-C", spike)
	if decision.Accepted {
		t.Fatalf("expected rejection for throttle delta")
	}
	if decision.Reason != ValidationReasonThrottleDelta {
		t.Fatalf("unexpected reason %s", decision.Reason)
	}
}

func TestValidatorAppliesCooldownAfterBurst(t *testing.T) {
	clock := &validatorClock{now: time.UnixMilli(0)}
	cfg := DefaultControlConstraints
	cfg.InvalidBurstLimit = 3
	cfg.CooldownDuration = 300 * time.Millisecond
	validator := NewValidator(cfg, logging.NewTestLogger(), WithValidatorClock(clock))

	bad := Controls{Throttle: 2.0, Brake: 0.0, Steer: 0.0, Gear: 1}
	var lastDecision ValidationDecision
	for i := 0; i < cfg.InvalidBurstLimit; i++ {
		decision := validator.Validate("client-D", "controller-D", bad)
		if decision.Accepted {
			t.Fatalf("expected rejection at iteration %d", i)
		}
		lastDecision = decision
	}
	if lastDecision.Cooldown != cfg.CooldownDuration {
		t.Fatalf("expected cooldown duration %s, got %s", cfg.CooldownDuration, lastDecision.Cooldown)
	}

	decision := validator.Validate("client-D", "controller-D", Controls{Throttle: 0.0, Brake: 0.0, Steer: 0.0, Gear: 1})
	if decision.Accepted {
		t.Fatalf("expected cooldown to reject valid frame")
	}
	if decision.Reason != ValidationReasonCooldownActive {
		t.Fatalf("expected cooldown active reason, got %s", decision.Reason)
	}

	clock.Advance(cfg.CooldownDuration)
	decision = validator.Validate("client-D", "controller-D", Controls{Throttle: 0.0, Brake: 0.0, Steer: 0.0, Gear: 1})
	if !decision.Accepted {
		t.Fatalf("expected acceptance after cooldown, got %+v", decision)
	}
}
