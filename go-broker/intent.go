package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"driftpursuit/broker/internal/input"
	"driftpursuit/broker/internal/logging"
)

var (
	errIntentEmptyPayload   = errors.New("empty intent payload")
	errIntentMissingID      = errors.New("intent missing controller id")
	errIntentMissingVersion = errors.New("intent missing schema version")
	errIntentSequence       = errors.New("intent sequence out of order")
)

// intentPayload mirrors the JSON layout of driftpursuit.broker.v0.Intent messages.
type intentPayload struct {
	SchemaVersion string  `json:"schema_version"`
	ControllerID  string  `json:"controller_id"`
	SequenceID    uint64  `json:"sequence_id"`
	Throttle      float64 `json:"throttle"`
	Brake         float64 `json:"brake"`
	Steer         float64 `json:"steer"`
	Handbrake     bool    `json:"handbrake"`
	Gear          int32   `json:"gear"`
	Boost         bool    `json:"boost"`
	SentAtMs      int64   `json:"sent_at_ms,omitempty"`
}

// decodeIntentPayload parses a websocket frame into a structured payload.
func decodeIntentPayload(raw []byte) (*intentPayload, error) {
	//2.- Ensure we have data to decode before hitting JSON parsing.
	if len(raw) == 0 {
		return nil, errIntentEmptyPayload
	}
	var payload intentPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

// validateIntentPayload enforces range limits and required metadata on the payload.
func validateIntentPayload(payload *intentPayload) error {
	//3.- Guard against nil pointers coming from earlier processing steps.
	if payload == nil {
		return errors.New("intent payload is nil")
	}
	if payload.SchemaVersion == "" {
		return errIntentMissingVersion
	}
	if payload.SequenceID == 0 {
		return fmt.Errorf("intent sequence id must be positive: %d", payload.SequenceID)
	}
	return nil
}

// SentAt converts the optional capture timestamp into a time.Time instance.
func (payload *intentPayload) SentAt() time.Time {
	//1.- Treat missing or zero timestamps as unset so freshness derives from arrival time.
	if payload == nil || payload.SentAtMs == 0 {
		return time.Time{}
	}
	return time.UnixMilli(payload.SentAtMs)
}

// storeIntentPayload caches the most recent intent and enforces monotonic sequence ids.
func (b *Broker) storeIntentPayload(payload *intentPayload) error {
	//4.- Validate broker pointer and required controller identity.
	if b == nil {
		return errors.New("broker is nil")
	}
	if payload == nil {
		return errors.New("intent payload is nil")
	}
	if payload.ControllerID == "" {
		return errIntentMissingID
	}
	b.intentMu.Lock()
	defer b.intentMu.Unlock()
	lastSeq := b.lastIntentSeqs[payload.ControllerID]
	if payload.SequenceID <= lastSeq {
		return fmt.Errorf("%w: got %d, last %d", errIntentSequence, payload.SequenceID, lastSeq)
	}
	clone := *payload
	b.intentStates[payload.ControllerID] = &clone
	b.lastIntentSeqs[payload.ControllerID] = payload.SequenceID
	return nil
}

// intentForController returns a copy of the latest intent payload for tests and diagnostics.
func (b *Broker) intentForController(controllerID string) *intentPayload {
	//5.- Share the stored payload safely without exposing internal references.
	if b == nil || controllerID == "" {
		return nil
	}
	b.intentMu.RLock()
	defer b.intentMu.RUnlock()
	payload, ok := b.intentStates[controllerID]
	if !ok {
		return nil
	}
	clone := *payload
	return &clone
}

// processIntent enforces gating, validation, and persistence for incoming intents.
func (b *Broker) processIntent(clientID string, payload *intentPayload, logger *logging.Logger) (bool, error) {
	if b == nil {
		return false, errors.New("broker is nil")
	}
	if payload == nil {
		return false, errors.New("intent payload is nil")
	}

	controls := input.Controls{Throttle: payload.Throttle, Brake: payload.Brake, Steer: payload.Steer, Gear: payload.Gear}

	if validator := b.intentValidator; validator != nil {
		//1.- Apply range, delta, and cooldown checks before mutating broker state.
		decision := validator.Validate(clientID, payload.ControllerID, controls)
		if !decision.Accepted {
			if logger != nil {
				fields := []logging.Field{
					logging.String("reason", string(decision.Reason)),
					logging.Field{Key: "client_id", Value: clientID},
					logging.Field{Key: "controller_id", Value: payload.ControllerID},
				}
				if decision.Cooldown > 0 {
					fields = append(fields, logging.Field{Key: "cooldown_ms", Value: decision.Cooldown.Milliseconds()})
				}
				if decision.Warn {
					logger.Warn("intent validation warning", fields...)
				} else {
					logger.Debug("dropping intent due to validation", fields...)
				}
			}
			return decision.Disconnect, fmt.Errorf("intent validation rejected: %s", decision.Reason)
		}
	}

	if gate := b.intentGate; gate != nil {
		//2.- Evaluate sequencing and freshness guards before storing the frame.
		frame := input.Frame{ClientID: clientID, SequenceID: payload.SequenceID}
		if ts := payload.SentAt(); !ts.IsZero() {
			frame.SentAt = ts
		}
		decision := gate.Evaluate(frame)
		if !decision.Accepted {
			if logger != nil {
				fields := []logging.Field{
					logging.String("reason", decision.Reason.String()),
					logging.Field{Key: "client_id", Value: clientID},
					logging.Field{Key: "controller_id", Value: payload.ControllerID},
					logging.Field{Key: "sequence_id", Value: payload.SequenceID},
				}
				if decision.Delay > 0 {
					fields = append(fields, logging.Field{Key: "delay_ms", Value: decision.Delay.Milliseconds()})
				}
				logger.Debug("dropping intent frame", fields...)
			}
			return false, fmt.Errorf("intent gate rejected: %s", decision.Reason)
		}
	}

	if err := b.storeIntentPayload(payload); err != nil {
		if logger != nil {
			logger.Debug("dropping intent", logging.Error(err))
		}
		return false, err
	}

	if validator := b.intentValidator; validator != nil {
		//3.- Persist accepted controls to drive delta-based validation.
		validator.Commit(clientID, payload.ControllerID, controls)
	}
	return false, nil
}
