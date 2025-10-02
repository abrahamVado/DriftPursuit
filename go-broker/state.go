package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	"driftpursuit/broker/internal/logging"
)

type snapshotOption func(*StateSnapshotter)

// WithSnapshotClock overrides the snapshot time source; primarily used in tests.
func WithSnapshotClock(clock func() time.Time) snapshotOption {
	return func(s *StateSnapshotter) {
		if clock != nil {
			s.now = clock
		}
	}
}

// WithSnapshotLoadDelay injects an artificial delay before snapshot load completes.
func WithSnapshotLoadDelay(delay time.Duration) snapshotOption {
	return func(s *StateSnapshotter) {
		s.loadDelay = delay
	}
}

// WithSnapshotReplayDelay injects a delay the first time snapshots are replayed.
func WithSnapshotReplayDelay(delay time.Duration) snapshotOption {
	return func(s *StateSnapshotter) {
		s.replayDelay = delay
	}
}

// StateSnapshotter persists the latest payloads for stateful message types so that
// they may be replayed to clients after a broker restart.
type StateSnapshotter struct {
	mu       sync.RWMutex
	path     string
	interval time.Duration
	log      *logging.Logger
	now      func() time.Time

	state map[string]json.RawMessage
	order []string
	dirty bool

	flushCh chan struct{}
	stopCh  chan struct{}
	doneCh  chan struct{}

	loadDelay   time.Duration
	replayDelay time.Duration
	replayOnce  sync.Once
}

type snapshotFile struct {
	SavedAt  time.Time        `json:"saved_at"`
	Messages []snapshotRecord `json:"messages"`
}

type snapshotRecord struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// NewStateSnapshotter constructs a snapshotter backed by the provided file path.
func NewStateSnapshotter(path string, interval time.Duration, logger *logging.Logger, opts ...snapshotOption) (*StateSnapshotter, error) {
	if path == "" || interval <= 0 {
		return nil, nil
	}
	if logger == nil {
		logger = logging.L()
	}
	snapshot := &StateSnapshotter{
		path:     path,
		interval: interval,
		log:      logger,
		now:      time.Now,
		state:    make(map[string]json.RawMessage),
		flushCh:  make(chan struct{}, 1),
		stopCh:   make(chan struct{}),
		doneCh:   make(chan struct{}),
	}
	for _, opt := range opts {
		if opt != nil {
			opt(snapshot)
		}
	}
	if err := snapshot.load(); err != nil {
		return nil, err
	}
	go snapshot.loop()
	return snapshot, nil
}

func (s *StateSnapshotter) load() error {
	if s == nil {
		return nil
	}
	if s.loadDelay > 0 {
		time.Sleep(s.loadDelay)
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	var file snapshotFile
	if err := json.Unmarshal(data, &file); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, record := range file.Messages {
		if record.Type == "" || len(record.Payload) == 0 {
			continue
		}
		s.state[record.Type] = append([]byte(nil), record.Payload...)
		if !containsType(s.order, record.Type) {
			s.order = append(s.order, record.Type)
		}
	}
	return nil
}

func containsType(order []string, typ string) bool {
	for _, existing := range order {
		if existing == typ {
			return true
		}
	}
	return false
}

func (s *StateSnapshotter) loop() {
	if s == nil {
		return
	}
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	defer close(s.doneCh)
	for {
		select {
		case <-ticker.C:
			s.flush()
		case <-s.flushCh:
			s.flush()
		case <-s.stopCh:
			s.flush()
			return
		}
	}
}

// Record stores the payload as the most recent snapshot for the message type.
func (s *StateSnapshotter) Record(messageType string, payload []byte) {
	if s == nil || messageType == "" || len(payload) == 0 {
		return
	}
	clone := append([]byte(nil), payload...)
	s.mu.Lock()
	s.state[messageType] = clone
	if !containsType(s.order, messageType) {
		s.order = append(s.order, messageType)
	}
	s.dirty = true
	s.mu.Unlock()
	select {
	case s.flushCh <- struct{}{}:
	default:
	}
}

// StateMessages returns the currently stored snapshot payloads ordered by the
// sequence they were first observed. A copy of the payloads is returned to avoid
// exposing internal slices.
func (s *StateSnapshotter) StateMessages() [][]byte {
	if s == nil {
		return nil
	}
	if s.replayDelay > 0 {
		s.replayOnce.Do(func() {
			time.Sleep(s.replayDelay)
		})
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.order) == 0 {
		return nil
	}
	messages := make([][]byte, 0, len(s.order))
	for _, messageType := range s.order {
		payload := s.state[messageType]
		if len(payload) == 0 {
			continue
		}
		messages = append(messages, append([]byte(nil), payload...))
	}
	return messages
}

// Flush immediately persists the current snapshot state to disk.
func (s *StateSnapshotter) Flush() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.dirty {
		return nil
	}
	file := snapshotFile{SavedAt: s.now().UTC()}
	file.Messages = make([]snapshotRecord, 0, len(s.order))
	for _, messageType := range s.order {
		payload := s.state[messageType]
		if len(payload) == 0 {
			continue
		}
		file.Messages = append(file.Messages, snapshotRecord{Type: messageType, Payload: payload})
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil && !errors.Is(err, fs.ErrExist) {
		return err
	}
	if err := os.WriteFile(s.path, data, 0o644); err != nil {
		return err
	}
	s.dirty = false
	return nil
}

func (s *StateSnapshotter) flush() {
	if err := s.Flush(); err != nil {
		s.log.Error("failed to persist state snapshot", logging.Error(err))
	}
}

// Close stops the persistence goroutine and flushes any pending state to disk.
func (s *StateSnapshotter) Close() error {
	if s == nil {
		return nil
	}
	close(s.stopCh)
	<-s.doneCh
	return nil
}
