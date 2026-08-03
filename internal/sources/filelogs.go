package sources

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"time"
)

// FileLogSource reads newline-delimited JSON log records from a file. It's
// meant as (a) a genuinely useful adapter for services that already ship
// structured logs to a file/volume, and (b) a fixture-friendly source for
// local development and demos without needing real CloudWatch/Datadog
// credentials. Each line must decode into rawLogLine.
type FileLogSource struct {
	Path string
}

type rawLogLine struct {
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"`
	Service   string    `json:"service"`
	Message   string    `json:"message"`
}

func NewFileLogSource(path string) *FileLogSource {
	return &FileLogSource{Path: path}
}

func (s *FileLogSource) FetchRecentLogs(ctx context.Context, service string, since time.Duration, limit int) ([]LogEntry, error) {
	f, err := os.Open(s.Path)
	if err != nil {
		return nil, fmt.Errorf("filelogs: open %s: %w", s.Path, err)
	}
	defer f.Close()

	cutoff := time.Now().Add(-since)
	var matched []LogEntry

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var raw rawLogLine
		if err := json.Unmarshal(line, &raw); err != nil {
			continue // skip malformed lines rather than failing the whole fetch
		}
		if service != "" && raw.Service != service {
			continue
		}
		if raw.Timestamp.Before(cutoff) {
			continue
		}
		matched = append(matched, LogEntry{
			Timestamp: raw.Timestamp,
			Level:     raw.Level,
			Service:   raw.Service,
			Message:   raw.Message,
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("filelogs: scan %s: %w", s.Path, err)
	}

	// Most-recent-first, since that's what an investigator wants to see.
	sort.Slice(matched, func(i, j int) bool { return matched[i].Timestamp.After(matched[j].Timestamp) })

	if limit > 0 && len(matched) > limit {
		matched = matched[:limit]
	}
	return matched, nil
}
