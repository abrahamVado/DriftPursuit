package logging

import (
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"driftpursuit/broker/internal/config"
)

// TraceIDHeader is the canonical HTTP header for propagating trace IDs between services.
const TraceIDHeader = "X-Trace-ID"

// TraceIDField is the canonical structured logging field for trace identifiers.
const TraceIDField = "trace_id"

type contextKey string

var (
	loggerContextKey = contextKey("broker-logger")
	traceContextKey  = contextKey("broker-trace-id")

	globalMu     sync.RWMutex
	globalLogger = newNopLogger()
)

// Level represents log verbosity ordering.
type Level int

const (
	DebugLevel Level = iota
	InfoLevel
	WarnLevel
	ErrorLevel
	FatalLevel
)

func (l Level) String() string {
	switch l {
	case DebugLevel:
		return "debug"
	case InfoLevel:
		return "info"
	case WarnLevel:
		return "warn"
	case ErrorLevel:
		return "error"
	case FatalLevel:
		return "fatal"
	default:
		return "info"
	}
}

func parseLevel(raw string) (Level, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return DebugLevel, nil
	case "info", "":
		return InfoLevel, nil
	case "warn", "warning":
		return WarnLevel, nil
	case "error":
		return ErrorLevel, nil
	case "fatal":
		return FatalLevel, nil
	default:
		return InfoLevel, fmt.Errorf("unknown log level %q", raw)
	}
}

// Field represents a structured logging attribute.
type Field struct {
	Key   string
	Value any
}

// String returns a string field.
func String(key, value string) Field { return Field{Key: key, Value: value} }

// Strings returns a string slice field.
func Strings(key string, values []string) Field { return Field{Key: key, Value: values} }

// Int returns an int field.
func Int(key string, value int) Field { return Field{Key: key, Value: value} }

// Int64 returns an int64 field.
func Int64(key string, value int64) Field { return Field{Key: key, Value: value} }

// Bool returns a bool field.
func Bool(key string, value bool) Field { return Field{Key: key, Value: value} }

// Error returns an error field.
func Error(err error) Field { return Field{Key: "error", Value: err} }

// Logger emits JSON-formatted structured logs with optional contextual fields.
type Logger struct {
	mu     sync.Mutex
	level  Level
	writer syncWriter
	fields map[string]any
}

// syncWriter describes a writer that can flush to durable storage.
type syncWriter interface {
	io.Writer
	Sync() error
}

// multiWriter writes to multiple sync writers.
type multiWriter struct {
	writers []syncWriter
}

func (m *multiWriter) Write(p []byte) (int, error) {
	for _, w := range m.writers {
		if _, err := w.Write(p); err != nil {
			return 0, err
		}
	}
	return len(p), nil
}

func (m *multiWriter) Sync() error {
	var firstErr error
	for _, w := range m.writers {
		if err := w.Sync(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// New constructs a JSON logger configured with on-disk rotation and stdout mirroring.
func New(cfg config.LoggingConfig) (*Logger, error) {
	if strings.TrimSpace(cfg.Path) == "" {
		return nil, errors.New("logging path must be specified")
	}
	level, err := parseLevel(cfg.Level)
	if err != nil {
		return nil, err
	}
	writer, err := newRotatingWriter(cfg)
	if err != nil {
		return nil, err
	}
	combined := &multiWriter{writers: []syncWriter{writer}}
	if os.Stdout != nil {
		combined.writers = append(combined.writers, os.Stdout)
	}
	logger := &Logger{
		level:  level,
		writer: combined,
		fields: map[string]any{"service": "broker"},
	}
	ReplaceGlobals(logger)
	return logger, nil
}

// NewTestLogger returns a logger that discards output, suitable for tests.
func NewTestLogger() *Logger {
	return newNopLogger()
}

func newNopLogger() *Logger {
	return &Logger{
		level:  DebugLevel,
		writer: discardSyncWriter{},
		fields: make(map[string]any),
	}
}

// ReplaceGlobals swaps the fallback logger used when no context logger is present.
func ReplaceGlobals(logger *Logger) {
	if logger == nil {
		return
	}
	globalMu.Lock()
	globalLogger = logger
	globalMu.Unlock()
}

// L returns the current global logger.
func L() *Logger {
	globalMu.RLock()
	defer globalMu.RUnlock()
	return globalLogger
}

// With augments the logger with additional structured fields.
func (l *Logger) With(fields ...Field) *Logger {
	if l == nil {
		return L().With(fields...)
	}
	clone := &Logger{
		level:  l.level,
		writer: l.writer,
		fields: make(map[string]any, len(l.fields)+len(fields)),
	}
	for k, v := range l.fields {
		clone.fields[k] = v
	}
	for _, field := range fields {
		clone.fields[field.Key] = field.Value
	}
	return clone
}

// Sync flushes buffered output to durable storage.
func (l *Logger) Sync() error {
	if l == nil || l.writer == nil {
		return nil
	}
	return l.writer.Sync()
}

// Debug logs a debug message.
func (l *Logger) Debug(message string, fields ...Field) { l.log(DebugLevel, message, fields...) }

// Info logs an informational message.
func (l *Logger) Info(message string, fields ...Field) { l.log(InfoLevel, message, fields...) }

// Warn logs a warning message.
func (l *Logger) Warn(message string, fields ...Field) { l.log(WarnLevel, message, fields...) }

// Error logs an error message.
func (l *Logger) Error(message string, fields ...Field) { l.log(ErrorLevel, message, fields...) }

// Fatal logs a fatal message and exits the process.
func (l *Logger) Fatal(message string, fields ...Field) { l.log(FatalLevel, message, fields...) }

func (l *Logger) log(level Level, message string, fields ...Field) {
	if l == nil {
		L().log(level, message, fields...)
		return
	}
	if level < l.level {
		return
	}
	payload := make(map[string]any, len(l.fields)+len(fields)+3)
	for k, v := range l.fields {
		payload[k] = v
	}
	payload["timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)
	payload["level"] = level.String()
	payload["message"] = message
	for _, field := range fields {
		payload[field.Key] = field.Value
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	_, _ = l.writer.Write(append(data, '\n'))
	if level == FatalLevel {
		_ = l.writer.Sync()
		os.Exit(1)
	}
}

// ContextWithLogger stores a logger in the provided context.
func ContextWithLogger(ctx context.Context, logger *Logger) context.Context {
	if logger == nil {
		return ctx
	}
	return context.WithValue(ctx, loggerContextKey, logger)
}

// LoggerFromContext retrieves a logger from context or falls back to the global logger.
func LoggerFromContext(ctx context.Context) *Logger {
	if ctx == nil {
		return L()
	}
	if logger, ok := ctx.Value(loggerContextKey).(*Logger); ok && logger != nil {
		return logger
	}
	return L()
}

// ContextWithTraceID stores a trace identifier in context.
func ContextWithTraceID(ctx context.Context, traceID string) context.Context {
	if traceID == "" {
		return ctx
	}
	return context.WithValue(ctx, traceContextKey, traceID)
}

// TraceIDFromContext extracts a trace identifier from context.
func TraceIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if traceID, ok := ctx.Value(traceContextKey).(string); ok {
		return traceID
	}
	return ""
}

// GenerateTraceID creates a random 16-byte trace identifier represented as hex.
func GenerateTraceID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err == nil {
		return hex.EncodeToString(buf[:])
	}
	return fmt.Sprintf("%x", time.Now().UnixNano())
}

// WithTrace enriches the context with a trace ID and returns the derived logger.
func WithTrace(ctx context.Context, base *Logger, traceID string) (context.Context, *Logger, string) {
	tid := strings.TrimSpace(traceID)
	if tid == "" {
		tid = GenerateTraceID()
	}
	if base == nil {
		base = L()
	}
	derived := base.With(Field{Key: TraceIDField, Value: tid})
	ctx = ContextWithTraceID(ctx, tid)
	ctx = ContextWithLogger(ctx, derived)
	return ctx, derived, tid
}

// HTTPTraceMiddleware ensures every request has a trace identifier propagated through context and headers.
func HTTPTraceMiddleware(base *Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			incoming := strings.TrimSpace(r.Header.Get(TraceIDHeader))
			ctx, logger, traceID := WithTrace(r.Context(), base, incoming)
			r = r.WithContext(ctx)
			w.Header().Set(TraceIDHeader, traceID)
			logger.Debug("request received", String("method", r.Method), String("path", r.URL.Path))
			next.ServeHTTP(w, r)
		})
	}
}

// rotatingWriter writes to a single log file and rotates based on size/age policies.
type rotatingWriter struct {
	mu         sync.Mutex
	path       string
	maxSize    int64
	maxBackups int
	maxAge     time.Duration
	compress   bool
	file       *os.File
	size       int64
}

func newRotatingWriter(cfg config.LoggingConfig) (*rotatingWriter, error) {
	if cfg.MaxSizeMB <= 0 {
		return nil, errors.New("BROKER_LOG_MAX_SIZE_MB must be positive")
	}
	if cfg.MaxBackups < 0 {
		return nil, errors.New("BROKER_LOG_MAX_BACKUPS must be non-negative")
	}
	if cfg.MaxAgeDays < 0 {
		return nil, errors.New("BROKER_LOG_MAX_AGE_DAYS must be non-negative")
	}
	dir := filepath.Dir(cfg.Path)
	if dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	file, err := os.OpenFile(cfg.Path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	writer := &rotatingWriter{
		path:       cfg.Path,
		maxSize:    int64(cfg.MaxSizeMB) * 1024 * 1024,
		maxBackups: cfg.MaxBackups,
		maxAge:     time.Duration(cfg.MaxAgeDays) * 24 * time.Hour,
		compress:   cfg.Compress,
		file:       file,
		size:       info.Size(),
	}
	return writer, nil
}

func (w *rotatingWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.size+int64(len(p)) > w.maxSize {
		if err := w.rotateLocked(); err != nil {
			return 0, err
		}
	}
	n, err := w.file.Write(p)
	w.size += int64(n)
	return n, err
}

func (w *rotatingWriter) Sync() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	return w.file.Sync()
}

func (w *rotatingWriter) rotateLocked() error {
	if w.file == nil {
		return errors.New("log file not initialized")
	}
	if err := w.file.Close(); err != nil {
		return err
	}
	timestamp := time.Now().UTC().Format("20060102T150405")
	rotated := fmt.Sprintf("%s.%s", w.path, timestamp)
	if err := os.Rename(w.path, rotated); err != nil {
		return err
	}
	if w.compress {
		if err := compressFile(rotated, rotated+".gz"); err == nil {
			_ = os.Remove(rotated)
			rotated += ".gz"
		}
	}
	if err := w.cleanupLocked(); err != nil {
		return err
	}
	file, err := os.OpenFile(w.path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	w.file = file
	w.size = 0
	return nil
}

func (w *rotatingWriter) cleanupLocked() error {
	dir := filepath.Dir(w.path)
	base := filepath.Base(w.path)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	type rotatedFile struct {
		name string
		mod  time.Time
	}
	files := make([]rotatedFile, 0)
	prefix := base + "."
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, rotatedFile{name: filepath.Join(dir, name), mod: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.After(files[j].mod) })
	if w.maxBackups > 0 && len(files) > w.maxBackups {
		for _, file := range files[w.maxBackups:] {
			_ = os.Remove(file.name)
		}
		files = files[:min(len(files), w.maxBackups)]
	}
	if w.maxAge > 0 {
		cutoff := time.Now().Add(-w.maxAge)
		for _, file := range files {
			if file.mod.Before(cutoff) {
				_ = os.Remove(file.name)
			}
		}
	}
	return nil
}

func compressFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	gz := gzip.NewWriter(out)
	if _, err := io.Copy(gz, in); err != nil {
		gz.Close()
		return err
	}
	return gz.Close()
}

type discardSyncWriter struct{}

func (discardSyncWriter) Write(p []byte) (int, error) { return len(p), nil }

func (discardSyncWriter) Sync() error { return nil }

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
