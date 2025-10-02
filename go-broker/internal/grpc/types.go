package grpc

import "context"

// DiffEvent transports a world diff payload alongside its authoritative tick.
type DiffEvent struct {
	Tick    uint64
	Payload []byte
}

// DiffSource exposes subscription semantics for authoritative diff fan-out.
type DiffSource interface {
	SubscribeStateDiffs(ctx context.Context) (<-chan DiffEvent, func(), error)
}

// IntentSubmission carries the decoded intent payload into the broker pipeline.
type IntentSubmission struct {
	ClientID string
	Payload  []byte
}

// IntentResult summarises how an intent submission was handled by the broker.
type IntentResult struct {
	Accepted   bool
	Disconnect bool
	Err        error
}

// IntentSink ingests intent submissions into the broker's validation pipeline.
type IntentSink interface {
	ProcessIntent(ctx context.Context, submission *IntentSubmission) IntentResult
}

// BrokerBridge aggregates the dependencies required by the gRPC service.
type BrokerBridge interface {
	DiffSource
	IntentSink
}
