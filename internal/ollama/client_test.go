package ollama

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
	c := NewClient(srv.URL, "llama3.1")
	c.HTTP = srv.Client()
	c.MaxRetries = 3
	return c, srv
}

func TestCompleteSuccess(t *testing.T) {
	var gotPath string
	c, srv := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		var req chatRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Model != "llama3.1" {
			t.Errorf("unexpected model in request: %q", req.Model)
		}
		if req.Stream {
			t.Errorf("expected stream=false")
		}
		if len(req.Messages) != 2 || req.Messages[0].Role != "system" || req.Messages[1].Role != "user" {
			t.Errorf("unexpected messages: %+v", req.Messages)
		}
		resp := chatResponse{Message: chatMessage{Role: "assistant", Content: "hello from ollama"}, Done: true}
		json.NewEncoder(w).Encode(resp)
	})
	defer srv.Close()

	text, err := c.Complete(context.Background(), "you are helpful", "say hi", 100)
	if err != nil {
		t.Fatalf("Complete failed: %v", err)
	}
	if text != "hello from ollama" {
		t.Fatalf("got %q, want %q", text, "hello from ollama")
	}
	if gotPath != "/api/chat" {
		t.Fatalf("path = %q, want /api/chat", gotPath)
	}
}

func TestCompleteOmitsSystemMessageWhenEmpty(t *testing.T) {
	c, srv := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		var req chatRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if len(req.Messages) != 1 || req.Messages[0].Role != "user" {
			t.Errorf("expected only a user message, got %+v", req.Messages)
		}
		json.NewEncoder(w).Encode(chatResponse{Message: chatMessage{Content: "ok"}, Done: true})
	})
	defer srv.Close()

	if _, err := c.Complete(context.Background(), "", "hi", 10); err != nil {
		t.Fatalf("Complete failed: %v", err)
	}
}

func TestCompleteRetriesOn5xxThenSucceeds(t *testing.T) {
	var calls int32
	c, srv := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"model is still loading"}`))
			return
		}
		json.NewEncoder(w).Encode(chatResponse{Message: chatMessage{Content: "ok"}, Done: true})
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

func TestCompleteNonRetryableErrorFailsFast(t *testing.T) {
	var calls int32
	c, srv := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error":"model 'llama3.1' not found, try pulling it first"}`))
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
		json.NewEncoder(w).Encode(chatResponse{Message: chatMessage{Content: "too late"}, Done: true})
	})
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	_, err := c.Complete(ctx, "", "hi", 10)
	if err == nil {
		t.Fatalf("expected a context deadline error")
	}
}
