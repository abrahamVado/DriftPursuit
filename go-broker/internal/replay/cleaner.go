package replay

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"driftpursuit/broker/internal/logging"
)

// RetentionPolicy defines how many replay artefacts are retained on disk.
type RetentionPolicy struct {
	MaxMatches int
	MaxAge     time.Duration
}

// StorageStats summarises the disk footprint of persisted replays.
type StorageStats struct {
	Matches   int
	Headers   int
	Bytes     int64
	LastSweep time.Time
}

// Cleaner periodically prunes replay artefacts according to a retention policy.
type Cleaner struct {
	mu     sync.RWMutex
	dir    string
	policy RetentionPolicy
	log    *logging.Logger
	now    func() time.Time
	stats  StorageStats
}

// NewCleaner constructs a cleaner for the provided replay directory.
func NewCleaner(dir string, policy RetentionPolicy, logger *logging.Logger) *Cleaner {
	if logger == nil {
		logger = logging.L()
	}
	return &Cleaner{dir: dir, policy: policy, log: logger, now: time.Now}
}

// Run executes retention sweeps until the context is cancelled.
func (c *Cleaner) Run(ctx context.Context, interval time.Duration) {
	if c == nil || ctx == nil {
		return
	}
	if interval <= 0 {
		interval = time.Hour
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	//1.- Perform an eager sweep so retention applies immediately on startup.
	c.sweep()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			//2.- Trigger periodic sweeps while the context remains active.
			c.sweep()
		}
	}
}

// RunOnce performs a single retention sweep, primarily used for tests.
func (c *Cleaner) RunOnce() {
	if c == nil {
		return
	}
	//1.- Delegate to sweep so tests exercise identical logic as the background loop.
	c.sweep()
}

// Stats returns the last recorded storage statistics.
func (c *Cleaner) Stats() StorageStats {
	if c == nil {
		return StorageStats{}
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	//1.- Return a copy so callers cannot mutate internal state.
	return c.stats
}

type artefact struct {
	name    string
	paths   []string
	headers []string
	size    int64
	modTime time.Time
	isDir   bool
}

func (c *Cleaner) sweep() {
	if c == nil || strings.TrimSpace(c.dir) == "" {
		return
	}
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		c.log.Warn("replay retention scan failed", logging.Error(err), logging.String("directory", c.dir))
		return
	}
	//1.- Collapse the directory contents into logical matches before sorting.
	artefacts := c.collect(entries)
	now := c.now()
	kept := 0
	stats := StorageStats{LastSweep: now}
	for _, art := range artefacts {
		shouldRemove, reasons := c.shouldRemove(art, now, kept)
		if shouldRemove {
			if err := c.remove(art); err != nil {
				c.log.Warn("replay retention removal failed", logging.Error(err), logging.String("match", art.name))
				stats.Matches++
				stats.Headers += len(art.headers)
				stats.Bytes += art.size
				kept++
			} else {
				c.log.Info("replay retention removed artefact", logging.String("match", art.name), logging.String("reason", reasons))
			}
			continue
		}
		kept++
		stats.Matches++
		stats.Headers += len(art.headers)
		stats.Bytes += art.size
	}
	c.mu.Lock()
	//2.- Publish the refreshed statistics so metrics handlers can report storage usage.
	c.stats = stats
	c.mu.Unlock()
}

func (c *Cleaner) collect(entries []os.DirEntry) []*artefact {
	artefacts := make(map[string]*artefact, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		base := name
		isHeader := false
		if strings.HasSuffix(name, ".header.json") {
			base = strings.TrimSuffix(name, ".header.json")
			isHeader = true
		}
		path := filepath.Join(c.dir, name)
		info, err := entry.Info()
		if err != nil {
			c.log.Warn("replay retention stat failed", logging.Error(err), logging.String("path", path))
			continue
		}
		art := artefacts[base]
		if art == nil {
			art = &artefact{name: base, modTime: info.ModTime(), isDir: entry.IsDir()}
			artefacts[base] = art
		}
		if info.ModTime().After(art.modTime) {
			art.modTime = info.ModTime()
		}
		if entry.IsDir() {
			size, err := directorySize(path)
			if err != nil {
				c.log.Warn("replay retention size failed", logging.Error(err), logging.String("path", path))
				continue
			}
			//1.- Treat directories as single artefacts so nested files move together.
			art.paths = append(art.paths, path)
			art.size += size
			continue
		}
		if isHeader {
			art.headers = append(art.headers, path)
		} else {
			//2.- Track primary artefact files separately from companion headers.
			art.paths = append(art.paths, path)
		}
		art.size += info.Size()
	}
	list := make([]*artefact, 0, len(artefacts))
	for _, art := range artefacts {
		list = append(list, art)
	}
	//3.- Sort newest-first so retention limits favour recent matches.
	sort.Slice(list, func(i, j int) bool { return list[i].modTime.After(list[j].modTime) })
	return list
}

func (c *Cleaner) shouldRemove(art *artefact, now time.Time, kept int) (bool, string) {
	reasons := make([]string, 0, 2)
	if c.policy.MaxAge > 0 && now.Sub(art.modTime) > c.policy.MaxAge {
		//1.- Flag artefacts that exceeded the configured age budget.
		reasons = append(reasons, fmt.Sprintf("age>%s", c.policy.MaxAge))
	}
	if c.policy.MaxMatches > 0 && kept >= c.policy.MaxMatches {
		//2.- Enforce the maximum retained match count after accounting for age removals.
		reasons = append(reasons, fmt.Sprintf(">=%d matches", c.policy.MaxMatches))
	}
	return len(reasons) > 0, strings.Join(reasons, ", ")
}

func (c *Cleaner) remove(art *artefact) error {
	var errs error
	for _, path := range art.paths {
		if art.isDir {
			//1.- Remove directories recursively so manifests and frames disappear together.
			if err := os.RemoveAll(path); err != nil {
				errs = errors.Join(errs, err)
			}
			continue
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			//2.- Ignore already-missing artefacts so repeated sweeps stay idempotent.
			errs = errors.Join(errs, err)
		}
	}
	for _, path := range art.headers {
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			errs = errors.Join(errs, err)
		}
	}
	return errs
}

func directorySize(root string) (int64, error) {
	var total int64
	walkErr := filepath.WalkDir(root, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		//1.- Accumulate file sizes to compute the directory footprint for metrics.
		total += info.Size()
		return nil
	})
	return total, walkErr
}
