package grpc

import (
	"context"
	"errors"
	"io"
	"time"

	brokerpb "driftpursuit/broker/internal/proto/pb"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const intentProcessTimeout = 40 * time.Millisecond

// Option customises the behaviour of the gRPC streaming service.
type Option func(*Service)

// tickerFactory constructs cancellable tick channels for throttled streaming.
type tickerFactory func(time.Duration) (<-chan time.Time, func())

const diffStreamRateHz = 20

// WithCompressor overrides the default payload compressor.
func WithCompressor(compressor Compressor) Option {
	return func(s *Service) {
		if compressor != nil {
			s.compressor = compressor
		}
	}
}

// Service implements brokerpb.BrokerStreamServiceServer using internal queues.
type Service struct {
	broker     BrokerBridge
	compressor Compressor
	newTicker  tickerFactory
	brokerpb.UnimplementedBrokerStreamServiceServer
}

// NewService wires the gRPC service to the broker bridge and optional settings.
func NewService(broker BrokerBridge, opts ...Option) *Service {
	service := &Service{broker: broker, compressor: NewGZIPCompressor(), newTicker: defaultTickerFactory}
	for _, opt := range opts {
		if opt != nil {
			opt(service)
		}
	}
	return service
}

// WithTickerFactory overrides the throttling ticker factory (used in tests).
func WithTickerFactory(factory tickerFactory) Option {
	return func(s *Service) {
		if factory != nil {
			s.newTicker = factory
		}
	}
}

func defaultTickerFactory(interval time.Duration) (<-chan time.Time, func()) {
	ticker := time.NewTicker(interval)
	stop := func() {
		ticker.Stop()
	}
	return ticker.C, stop
}

// StreamStateDiffs relays authoritative world diffs to connected bots.
func (s *Service) StreamStateDiffs(req *brokerpb.StreamStateDiffsRequest, stream brokerpb.BrokerStreamService_StreamStateDiffsServer) error {
	if s == nil || s.broker == nil {
		return status.Error(codes.FailedPrecondition, "streaming unavailable")
	}
	ctx := stream.Context()
	//1.- Subscribe to the broker diff fan-out so we receive future updates.
	diffCh, cancel, err := s.broker.SubscribeStateDiffs(ctx)
	if err != nil {
		return status.Errorf(codes.Internal, "subscribe diffs: %v", err)
	}
	defer cancel()

	compressor := s.compressor
	if compressor == nil {
		compressor = NewGZIPCompressor()
	}

	interval := time.Second / diffStreamRateHz
	if interval <= 0 {
		interval = time.Second / diffStreamRateHz
	}
	tickCh, stop := s.newTicker(interval)
	defer stop()

	var (
		pending    []DiffEvent
		diffClosed bool
	)

	for {
		select {
		case <-ctx.Done():
			//2.- Surface context cancellation so clients can retry.
			if errors.Is(ctx.Err(), context.Canceled) {
				return status.Error(codes.Canceled, "stream cancelled")
			}
			return status.Error(codes.DeadlineExceeded, "stream deadline exceeded")
		case event, ok := <-diffCh:
			if !ok {
				//3.- Note the closed channel so the loop terminates after draining.
				diffClosed = true
				diffCh = nil
				if len(pending) == 0 {
					return nil
				}
				continue
			}
			//4.- Buffer incoming diffs so they can be flushed at the throttled cadence.
			pending = append(pending, event)
		case <-tickCh:
			if len(pending) == 0 {
				//5.- Exit once all buffered diffs are drained and the source closed.
				if diffClosed {
					return nil
				}
				continue
			}
			//6.- Pop the oldest buffered diff to preserve deterministic ordering.
			event := pending[0]
			pending = pending[1:]
			compressed, err := compressor.Compress(event.Payload)
			if err != nil {
				return status.Errorf(codes.Internal, "compress diff: %v", err)
			}
			frame := &brokerpb.StateDiffFrame{
				Tick:     event.Tick,
				Encoding: compressor.Name(),
				Payload:  compressed,
			}
			if err := stream.Send(frame); err != nil {
				return err
			}
		}
	}
}

// PublishIntents ingests compressed bot intents and forwards them to the broker.
func (s *Service) PublishIntents(stream brokerpb.BrokerStreamService_PublishIntentsServer) error {
	if s == nil || s.broker == nil {
		return status.Error(codes.FailedPrecondition, "streaming unavailable")
	}
	compressor := s.compressor
	if compressor == nil {
		compressor = NewGZIPCompressor()
	}
	ctx := stream.Context()
	var summary brokerpb.IntentStreamAck

	for {
		frame, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			//1.- Return the aggregated acknowledgement once the client closes the stream.
			return stream.SendAndClose(&summary)
		}
		if err != nil {
			return err
		}
		if frame == nil {
			continue
		}
		if frame.GetEncoding() != compressor.Name() {
			return status.Errorf(codes.InvalidArgument, "unsupported encoding %q", frame.GetEncoding())
		}
		payload, err := compressor.Decompress(frame.GetPayload())
		if err != nil {
			summary.Rejected++
			continue
		}
		//4.- Guard the broker call so bots receive feedback within the SLA.
		intentCtx, cancel := context.WithTimeout(ctx, intentProcessTimeout)
		result := s.broker.ProcessIntent(intentCtx, &IntentSubmission{ClientID: frame.GetClientId(), Payload: payload})
		cancel()
		if errors.Is(intentCtx.Err(), context.DeadlineExceeded) {
			summary.Rejected++
			continue
		}
		if result.Err != nil {
			summary.Rejected++
			if result.Disconnect {
				return status.Error(codes.PermissionDenied, result.Err.Error())
			}
			continue
		}
		if result.Accepted {
			summary.Accepted++
		} else {
			summary.Rejected++
		}
	}
}

var _ brokerpb.BrokerStreamServiceServer = (*Service)(nil)
