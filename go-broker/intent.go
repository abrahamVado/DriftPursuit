package main

import (
	"encoding/json"
	"errors"
	"fmt"
)

const (
	//1.- Define min/max ranges for analog control channels.
	intentThrottleMin = -1.0
	intentThrottleMax = 1.0
	intentBrakeMin    = 0.0
	intentBrakeMax    = 1.0
	intentSteerMin    = -1.0
	intentSteerMax    = 1.0
	intentGearMin     = -1
	intentGearMax     = 9
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
	if payload.Throttle < intentThrottleMin || payload.Throttle > intentThrottleMax {
		return fmt.Errorf("throttle %.2f out of range", payload.Throttle)
	}
	if payload.Brake < intentBrakeMin || payload.Brake > intentBrakeMax {
		return fmt.Errorf("brake %.2f out of range", payload.Brake)
	}
	if payload.Steer < intentSteerMin || payload.Steer > intentSteerMax {
		return fmt.Errorf("steer %.2f out of range", payload.Steer)
	}
	if payload.Gear < intentGearMin || payload.Gear > intentGearMax {
		return fmt.Errorf("gear %d out of range", payload.Gear)
	}
	return nil
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
