package sources

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeTestLogFile(t *testing.T, lines []string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "app.log")
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create temp log file: %v", err)
	}
	defer f.Close()
	for _, l := range lines {
		if _, err := f.WriteString(l + "\n"); err != nil {
			t.Fatalf("write line: %v", err)
		}
	}
	return path
}

func logLine(ts time.Time, level, service, msg string) string {
	return `{"timestamp":"` + ts.Format(time.RFC3339) + `","level":"` + level + `","service":"` + service + `","message":"` + msg + `"}`
}

func TestFileLogSourceFiltersByServiceAndWindow(t *testing.T) {
	now := time.Now()
	lines := []string{
		logLine(now.Add(-1*time.Minute), "error", "checkout", "payment gateway timeout"),
		logLine(now.Add(-2*time.Minute), "info", "checkout", "order created"),
		logLine(now.Add(-90*time.Minute), "error", "checkout", "too old, outside window"),
		logLine(now.Add(-1*time.Minute), "error", "auth", "different service, should be excluded"),
		"not even json, should be skipped without erroring",
	}
	path := writeTestLogFile(t, lines)

	src := NewFileLogSource(path)
	entries, err := src.FetchRecentLogs(context.Background(), "checkout", 30*time.Minute, 10)
	if err != nil {
		t.Fatalf("FetchRecentLogs failed: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2: %+v", len(entries), entries)
	}
	// most-recent-first ordering
	if entries[0].Message != "payment gateway timeout" {
		t.Fatalf("expected most recent entry first, got %q", entries[0].Message)
	}
	for _, e := range entries {
		if e.Service != "checkout" {
			t.Fatalf("leaked entry from wrong service: %+v", e)
		}
	}
}

func TestFileLogSourceRespectsLimit(t *testing.T) {
	now := time.Now()
	var lines []string
	for i := 0; i < 5; i++ {
		lines = append(lines, logLine(now.Add(-time.Duration(i)*time.Second), "info", "svc", "line"))
	}
	path := writeTestLogFile(t, lines)

	src := NewFileLogSource(path)
	entries, err := src.FetchRecentLogs(context.Background(), "svc", time.Hour, 2)
	if err != nil {
		t.Fatalf("FetchRecentLogs failed: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2 (limit)", len(entries))
	}
}

func TestFileLogSourceMissingFile(t *testing.T) {
	src := NewFileLogSource("/nonexistent/path/app.log")
	_, err := src.FetchRecentLogs(context.Background(), "svc", time.Hour, 10)
	if err == nil {
		t.Fatalf("expected an error for a missing file")
	}
}
