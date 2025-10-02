package timesync

import (
	"time"

	pb "driftpursuit/broker/internal/proto/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Service exposes gRPC access to the broker's periodic time synchronisation stream.
type Service struct {
	pb.UnimplementedTimeSyncServiceServer
	broker   clockProvider
	interval time.Duration
}

// clockProvider captures the broker methods required for time sync measurements.
type clockProvider interface {
	LogTimeDrift(channel, target string, offsetMs int64)
	TimeSyncSnapshot() (serverMs, simulatedMs, offsetMs int64)
}

// NewService wires the broker into the gRPC time sync transport.
func NewService(b clockProvider, interval time.Duration) *Service {
	if interval <= 0 {
		interval = time.Second
	}
	return &Service{broker: b, interval: interval}
}

// StreamTimeSync pushes periodic drift samples to connected gRPC clients.
func (s *Service) StreamTimeSync(req *pb.TimeSyncRequest, stream grpc.ServerStreamingServer[pb.TimeSyncUpdate]) error {
	if s == nil || s.broker == nil {
		return status.Error(codes.Unavailable, "time sync service unavailable")
	}
	clientID := "grpc-client"
	if req != nil && req.GetClientId() != "" {
		clientID = req.GetClientId()
	}

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	//1.- Emit an initial sample immediately to minimise startup skew.
	if err := s.sendSample(stream, clientID); err != nil {
		return err
	}

	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case <-ticker.C:
			//2.- Stream successive updates at the configured cadence.
			if err := s.sendSample(stream, clientID); err != nil {
				return err
			}
		}
	}
}

func (s *Service) sendSample(stream grpc.ServerStreamingServer[pb.TimeSyncUpdate], clientID string) error {
	if s == nil || s.broker == nil {
		return status.Error(codes.Unavailable, "time sync service unavailable")
	}
	serverMs, simulatedMs, offsetMs := s.broker.TimeSyncSnapshot()
	update := &pb.TimeSyncUpdate{
		ServerTimestampMs:    serverMs,
		SimulatedTimestampMs: simulatedMs,
		RecommendedOffsetMs:  offsetMs,
	}
	if err := stream.Send(update); err != nil {
		return err
	}
	s.broker.LogTimeDrift("grpc", clientID, offsetMs)
	return nil
}

var _ pb.TimeSyncServiceServer = (*Service)(nil)
