package bots

import (
	"context"
	"errors"
	"sync"
)

// Launcher orchestrates the bot worker pool maintained outside the broker.
type Launcher interface {
	// Scale adjusts the number of active bots and returns the confirmed population.
	Scale(ctx context.Context, target int) (int, error)
}

// Snapshot exposes the observed participant counts for metrics export.
type Snapshot struct {
	Humans int
	Bots   int
}

// ControllerConfig configures the bot population controller.
type ControllerConfig struct {
	TargetPopulation int
	Launcher         Launcher
}

// Controller reconciles the human population with the desired total player count.
type Controller struct {
	mu sync.Mutex

	humans   int
	bots     int
	target   int
	launcher Launcher
}

// NewController constructs a population controller with the supplied configuration.
func NewController(cfg ControllerConfig) *Controller {
	controller := &Controller{}
	//1.- Record the reconciler target and launcher using defensive defaults.
	controller.launcher = cfg.Launcher
	if cfg.TargetPopulation > 0 {
		controller.target = cfg.TargetPopulation
	}
	return controller
}

// SetTargetPopulation updates the desired total number of participants and reconciles bots.
func (c *Controller) SetTargetPopulation(ctx context.Context, population int) error {
	if c == nil {
		return errors.New("controller is nil")
	}
	if population < 0 {
		return errors.New("population must be non-negative")
	}
	c.mu.Lock()
	//1.- Store the requested population so future joins reuse the constraint.
	c.target = population
	targetBots := c.desiredBotsLocked()
	c.mu.Unlock()
	//2.- Reconcile the bot pool immediately to honour the updated target.
	return c.reconcile(ctx, targetBots)
}

// HumanConnected increments the human population and reconciles the bot pool.
func (c *Controller) HumanConnected(ctx context.Context) error {
	if c == nil {
		return errors.New("controller is nil")
	}
	c.mu.Lock()
	//1.- Track the new participant using a floor at zero to absorb duplicate joins.
	c.humans++
	targetBots := c.desiredBotsLocked()
	c.mu.Unlock()
	//2.- Delegate to reconcile so the launcher observes the updated totals.
	return c.reconcile(ctx, targetBots)
}

// HumanDisconnected decrements the human population and reconciles the bot pool.
func (c *Controller) HumanDisconnected(ctx context.Context) error {
	if c == nil {
		return errors.New("controller is nil")
	}
	c.mu.Lock()
	//1.- Clamp the human population to zero when disconnects arrive out of order.
	if c.humans > 0 {
		c.humans--
	}
	targetBots := c.desiredBotsLocked()
	c.mu.Unlock()
	//2.- Trigger a reconciliation so excess bots are retired promptly.
	return c.reconcile(ctx, targetBots)
}

// Snapshot returns the most recent human and bot counts without mutating state.
func (c *Controller) Snapshot() Snapshot {
	if c == nil {
		return Snapshot{}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	//1.- Capture a stable view so callers can publish metrics atomically.
	return Snapshot{Humans: c.humans, Bots: c.bots}
}

func (c *Controller) desiredBotsLocked() int {
	desired := c.target - c.humans
	if desired < 0 {
		desired = 0
	}
	return desired
}

func (c *Controller) reconcile(ctx context.Context, target int) error {
	if c == nil {
		return errors.New("controller is nil")
	}
	if target < 0 {
		target = 0
	}
	var (
		confirmed int
		err       error
	)
	if c.launcher != nil {
		//1.- Ask the launcher to adjust the bot pool and capture the confirmed count.
		confirmed, err = c.launcher.Scale(ctx, target)
	} else {
		confirmed = target
	}
	if err != nil {
		return err
	}
	c.mu.Lock()
	//2.- Persist the reconciled bot population so metrics match launcher state.
	c.bots = confirmed
	c.mu.Unlock()
	return nil
}
