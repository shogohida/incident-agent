// Package claude is a minimal, dependency-free client for the Anthropic
// Messages API. It deliberately does not pull in the official SDK - for a
// tool this small, a ~150-line client that only does what we need is easier
// to audit and keeps the dependency graph at zero.
package claude

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"time"
)

const defaultBaseURL = "https://api.anthropic.com"
const apiVersion = "2023-06-01"

type Client struct {
	APIKey  string
	Model   string
	BaseURL string
	HTTP    *http.Client

	MaxRetries int
}

// NewClient creates a client. model can be any valid Claude model string
// (e.g. "claude-haiku-4-5"); apiKey is read by the caller from the
// ANTHROPIC_API_KEY environment variable by convention (see cmd/investigator).
func NewClient(apiKey, model string) *Client {
	return &Client{
		APIKey:     apiKey,
		Model:      model,
		BaseURL:    defaultBaseURL,
		HTTP:       &http.Client{Timeout: 60 * time.Second},
		MaxRetries: 3,
	}
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type messagesRequest struct {
	Model     string    `json:"model"`
	MaxTokens int       `json:"max_tokens"`
	System    string    `json:"system,omitempty"`
	Messages  []Message `json:"messages"`
}

type contentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type messagesResponse struct {
	Content []contentBlock `json:"content"`
	Error   *apiError      `json:"error,omitempty"`
}

type apiError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// ErrRateLimited is returned (after retries are exhausted) when the API
// keeps responding 429/529 so callers can decide how to degrade.
type ErrRateLimited struct{ Attempts int }

func (e *ErrRateLimited) Error() string {
	return fmt.Sprintf("claude: rate limited after %d attempts", e.Attempts)
}

// Complete sends a single-turn request (optional system prompt + one user
// message) and returns the concatenated text of the response.
func (c *Client) Complete(ctx context.Context, systemPrompt, userMessage string, maxTokens int) (string, error) {
	reqBody := messagesRequest{
		Model:     c.Model,
		MaxTokens: maxTokens,
		System:    systemPrompt,
		Messages:  []Message{{Role: "user", Content: userMessage}},
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("claude: marshal request: %w", err)
	}

	var lastErr error
	maxRetries := c.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 1
	}

	for attempt := 1; attempt <= maxRetries; attempt++ {
		text, retryable, err := c.doOnce(ctx, payload)
		if err == nil {
			return text, nil
		}
		lastErr = err
		if !retryable || attempt == maxRetries {
			break
		}
		// Exponential backoff with jitter so a burst of concurrent
		// investigations doesn't hammer the API in lockstep.
		backoff := time.Duration(attempt) * 500 * time.Millisecond
		jitter := time.Duration(rand.Intn(200)) * time.Millisecond
		select {
		case <-time.After(backoff + jitter):
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}

	if isRateLimitErr(lastErr) {
		return "", &ErrRateLimited{Attempts: maxRetries}
	}
	return "", lastErr
}

type rateLimitMarker struct{ inner error }

func (r *rateLimitMarker) Error() string { return r.inner.Error() }
func (r *rateLimitMarker) Unwrap() error { return r.inner }

func isRateLimitErr(err error) bool {
	_, ok := err.(*rateLimitMarker)
	return ok
}

// doOnce performs a single HTTP round trip. The bool return indicates
// whether the error (if any) is worth retrying.
func (c *Client) doOnce(ctx context.Context, payload []byte) (string, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/v1/messages", bytes.NewReader(payload))
	if err != nil {
		return "", false, fmt.Errorf("claude: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.APIKey)
	req.Header.Set("anthropic-version", apiVersion)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", true, fmt.Errorf("claude: request failed: %w", err) // network errors are retryable
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", true, fmt.Errorf("claude: read response: %w", err)
	}

	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == 529 {
		return "", true, &rateLimitMarker{inner: fmt.Errorf("claude: status %d: %s", resp.StatusCode, body)}
	}
	if resp.StatusCode >= 500 {
		return "", true, fmt.Errorf("claude: server error %d: %s", resp.StatusCode, body)
	}
	if resp.StatusCode != http.StatusOK {
		return "", false, fmt.Errorf("claude: status %d: %s", resp.StatusCode, body)
	}

	var parsed messagesResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", false, fmt.Errorf("claude: parse response: %w", err)
	}
	if parsed.Error != nil {
		return "", false, fmt.Errorf("claude: api error (%s): %s", parsed.Error.Type, parsed.Error.Message)
	}

	var text bytes.Buffer
	for _, block := range parsed.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	return text.String(), false, nil
}
