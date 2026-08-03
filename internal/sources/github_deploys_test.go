package sources

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"context"
)

func TestGitHubDeploySourceParsesCommits(t *testing.T) {
	var gotPath, gotAuthHeader string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuthHeader = r.Header.Get("Authorization")
		commits := []ghCommit{
			{
				SHA: "abc123",
				Commit: struct {
					Message string `json:"message"`
					Author  struct {
						Name string    `json:"name"`
						Date time.Time `json:"date"`
					} `json:"author"`
				}{
					Message: "fix: handle nil pointer in checkout\n\nlonger body here",
					Author: struct {
						Name string    `json:"name"`
						Date time.Time `json:"date"`
					}{Name: "shogo", Date: time.Now().Add(-5 * time.Minute)},
				},
				HTMLURL: "https://github.com/example/repo/commit/abc123",
			},
		}
		json.NewEncoder(w).Encode(commits)
	}))
	defer srv.Close()

	src := NewGitHubDeploySource("example", "repo", "test-token")
	src.BaseURL = srv.URL
	src.HTTP = srv.Client()

	deploys, err := src.FetchRecentDeploys(context.Background(), "checkout", time.Hour)
	if err != nil {
		t.Fatalf("FetchRecentDeploys failed: %v", err)
	}
	if len(deploys) != 1 {
		t.Fatalf("got %d deploys, want 1", len(deploys))
	}
	d := deploys[0]
	if d.SHA != "abc123" {
		t.Fatalf("sha = %q", d.SHA)
	}
	if d.Message != "fix: handle nil pointer in checkout" {
		t.Fatalf("message should be first line only, got %q", d.Message)
	}
	if !strings.Contains(gotPath, "/repos/example/repo/commits") {
		t.Fatalf("unexpected request path: %q", gotPath)
	}
	if gotAuthHeader != "Bearer test-token" {
		t.Fatalf("expected Authorization header to be set, got %q", gotAuthHeader)
	}
}

func TestGitHubDeploySourceRequiresOwnerRepo(t *testing.T) {
	src := NewGitHubDeploySource("", "", "")
	_, err := src.FetchRecentDeploys(context.Background(), "svc", time.Hour)
	if err == nil {
		t.Fatalf("expected an error when owner/repo are unset")
	}
}

func TestGitHubDeploySourceHandlesHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden) // e.g. rate limited
	}))
	defer srv.Close()

	src := NewGitHubDeploySource("example", "repo", "")
	src.BaseURL = srv.URL
	src.HTTP = srv.Client()

	_, err := src.FetchRecentDeploys(context.Background(), "svc", time.Hour)
	if err == nil {
		t.Fatalf("expected an error on non-200 status")
	}
}
