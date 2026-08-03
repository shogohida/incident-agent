package claude

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) (*Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(handler)
	c := NewClient("test-key", "claude-sonnet-4-6")
	c.BaseURL = srv.URL
	c.HTTP = srv.Client()
	c.MaxRetries = 3
	return c, srv
}

func TestCompleteSuccess(t *testing.T) {
	var gotAuth, gotVersion string
	c, srv := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("x-api-key")
		gotVersion = r.Header.Get("anthropic-version")
		var req messagesRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Model != "claude-sonnet-4-6" {
			t.Errorf("unexpected model in request: %q", req.Model)
		}
		resp := messagesResponse{Content: []contentBlock{{Type: "text", Text: "hello from claude"}}}
		json.NewEncoder(w).Encode(resp)
	})
	defer srv.Close()

	text, err := c.Complete(context.Background(), "you are helpful", "say hi", 100)
	if err != nil {
		t.Fatalf("Complete failed: %v", err)
	}
	if text != "hello from claude" {
		t.Fatalf("got %q, want %q", text, "hello from claude")
	}
	if gotAuth != "test-key" {
		t.Fatalf("api key header = %q", gotAuth)
	}
	if gotVersion != apiVersion {
		t.Fatalf("version header = %q, want %q", gotVersion, apiVersion)
	}
}

func TestCompleteRetriesOn5xxThenSucceeds(t *testing.T) {
	var calls int32
	c, srv := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":{"type":"overloaded_error","message":"try again"}}`))
			return
		}
		json.NewEncoder(w).Encode(messagesResponse{Content: []contentBlock{{Type: "text", Text: "ok"}}})
	})
	defer srv.Close()

	text, err := c.Complete(context.Background(), "", "hi", 10)
	if err != nil {
		t.Fatalf("expected eventual success, got %v", err)
	}
	if text != "ok" {
		t.Fatalf("got %q", text)
	}
	if calls != 3 {
		t.Fatalf("expected 3 attempts, got %d", calls)
	}
}

func TestCompleteRateLimitedReturnsTypedError(t *testing.T) {
	c, srv := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"error":{"type":"rate_limit_error","message":"slow down"}}`))
	})
	defer srv.Close()
	c.MaxRetries = 2 // keep the test fast

	_, err := c.Complete(context.Background(), "", "hi", 10)
	if err == nil {
		t.Fatalf("expected an error")
	}
	if _, ok := err.(*ErrRateLimited); !ok {
		t.Fatalf("expected *ErrRateLimited, got %T: %v", err, err)
	}
}

func TestCompleteNonRetryableErrorFailsFast(t *testing.T) {
	var calls int32
	c, srv := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"bad input"}}`))
	})
	defer srv.Close()

	_, err := c.Complete(context.Background(), "", "hi", 10)
	if err == nil {
		t.Fatalf("expected an error")
	}
	if calls != 1 {
		t.Fatalf("expected exactly 1 call for a non-retryable error, got %d", calls)
	}
}

func TestCompleteRespectsContextCancellation(t *testing.T) {
	c, srv := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		json.NewEncoder(w).Encode(messagesResponse{Content: []contentBlock{{Type: "text", Text: "too late"}}})
	})
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	_, err := c.Complete(ctx, "", "hi", 10)
	if err == nil {
		t.Fatalf("expected a context deadline error")
	}
}
