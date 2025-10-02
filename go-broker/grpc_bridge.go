package main

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"

	grpcstream "driftpursuit/broker/internal/grpc"
	"driftpursuit/broker/internal/logging"
)

// SubscribeStateDiffs allows gRPC services to observe world diffs via fan-out channels.
func (b *Broker) SubscribeStateDiffs(ctx context.Context) (<-chan grpcstream.DiffEvent, func(), error) {
	if b == nil {
		return nil, func() {}, errors.New("broker is nil")
	}
	//1.- Allocate a buffered channel so slow consumers drop gracefully.
	ch := make(chan grpcstream.DiffEvent, 16)
	id := atomic.AddUint64(&b.nextDiffID, 1)

	//2.- Register the subscriber under lock for concurrent safety.
	b.diffMu.Lock()
	b.diffSubscribers[id] = ch
	b.diffMu.Unlock()

	var once sync.Once
	cancel := func() {
		//3.- Ensure unsubscribe and close only happens once.
		once.Do(func() {
			b.diffMu.Lock()
			if sub, ok := b.diffSubscribers[id]; ok {
				delete(b.diffSubscribers, id)
				close(sub)
			}
			b.diffMu.Unlock()
		})
	}

	if ctx != nil {
		//4.- Propagate context cancellation to the subscription lifecycle.
		go func() {
			<-ctx.Done()
			cancel()
		}()
	}

	return ch, cancel, nil
}

// ProcessIntent decodes JSON payloads and feeds them through the broker validation pipeline.
func (b *Broker) ProcessIntent(ctx context.Context, submission *grpcstream.IntentSubmission) grpcstream.IntentResult {
	if b == nil {
		return grpcstream.IntentResult{Err: errors.New("broker is nil")}
	}
	if submission == nil {
		return grpcstream.IntentResult{Err: errors.New("intent submission is nil")}
	}
	//1.- Decode the JSON payload and fall back to the stream client ID when needed.
	payload, err := decodeIntentPayload(submission.Payload)
	if err != nil {
		return grpcstream.IntentResult{Err: err}
	}
	if payload.ControllerID == "" {
		payload.ControllerID = submission.ClientID
	}
	if err := validateIntentPayload(payload); err != nil {
		return grpcstream.IntentResult{Err: err}
	}
	//2.- Augment the logger so downstream helpers include consistent metadata.
	logger := b.log
	if logger != nil {
		logger = logger.With(
			logging.String("component", "grpc_intent"),
			logging.String("client_id", submission.ClientID),
			logging.String("controller_id", payload.ControllerID),
		)
	}
	//3.- Reuse the websocket processing path to apply gating and persistence.
	disconnect, procErr := b.processIntent(submission.ClientID, payload, logger)
	if procErr != nil {
		return grpcstream.IntentResult{Err: procErr, Disconnect: disconnect}
	}
	return grpcstream.IntentResult{Accepted: true}
}

var _ grpcstream.BrokerBridge = (*Broker)(nil)
