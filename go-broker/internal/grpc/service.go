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
	brokerpb.UnimplementedBrokerStreamServiceServer
}

// NewService wires the gRPC service to the broker bridge and optional settings.
func NewService(broker BrokerBridge, opts ...Option) *Service {
	service := &Service{broker: broker, compressor: NewGZIPCompressor()}
	for _, opt := range opts {
		if opt != nil {
			opt(service)
		}
	}
	return service
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
				//3.- End the stream cleanly when the broker shuts down.
				return nil
			}
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
