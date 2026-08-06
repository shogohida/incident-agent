// Package ollama is a minimal, dependency-free client for a local Ollama
// server's chat API (https://github.com/ollama/ollama/blob/main/docs/api.md).
// It implements the same narrow interface as internal/claude.Client so it can
// be used as a drop-in, zero-cost replacement for the Anthropic API when no
// ANTHROPIC_API_KEY is available - everything runs on the caller's own
// machine against a locally pulled model, with no per-request billing.
package ollama

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

const defaultBaseURL = "http://localhost:11434"

type Client struct {
	Model   string
	BaseURL string
	HTTP    *http.Client

	MaxRetries int
}

// NewClient creates a client against a local (or remote) Ollama server.
// baseURL may be empty, in which case it defaults to
// http://localhost:11434 - the standard `ollama serve` address. model must
// already be pulled on that server (e.g. `ollama pull llama3.1`).
func NewClient(baseURL, model string) *Client {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	return &Client{
		Model:      model,
		BaseURL:    baseURL,
		HTTP:       &http.Client{Timeout: 120 * time.Second},
		MaxRetries: 3,
	}
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatOptions struct {
	NumPredict int `json:"num_predict,omitempty"`
}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
	Options  chatOptions   `json:"options,omitempty"`
}

type chatResponse struct {
	Message chatMessage `json:"message"`
	Done    bool        `json:"done"`
	Error   string      `json:"error,omitempty"`
}

// Complete sends a single-turn request (optional system prompt + one user
// message) to the local Ollama server and returns the assistant's reply
// text. Its signature matches internal/claude.Client.Complete so either can
// satisfy internal/agent.ClaudeClient.
func (c *Client) Complete(ctx context.Context, systemPrompt, userMessage string, maxTokens int) (string, error) {
	var messages []chatMessage
	if systemPrompt != "" {
		messages = append(messages, chatMessage{Role: "system", Content: systemPrompt})
	}
	messages = append(messages, chatMessage{Role: "user", Content: userMessage})

	reqBody := chatRequest{
		Model:    c.Model,
		Messages: messages,
		Stream:   false,
		Options:  chatOptions{NumPredict: maxTokens},
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("ollama: marshal request: %w", err)
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
		backoff := time.Duration(attempt) * 500 * time.Millisecond
		jitter := time.Duration(rand.Intn(200)) * time.Millisecond
		select {
		case <-time.After(backoff + jitter):
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}

	return "", lastErr
}

// doOnce performs a single HTTP round trip. The bool return indicates
// whether the error (if any) is worth retrying - connection failures and
// 5xx responses are (the model may still be loading into memory on first
// use); a 4xx (e.g. unknown model) is not.
func (c *Client) doOnce(ctx context.Context, payload []byte) (string, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/chat", bytes.NewReader(payload))
	if err != nil {
		return "", false, fmt.Errorf("ollama: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", true, fmt.Errorf("ollama: request failed (is `ollama serve` running at %s?): %w", c.BaseURL, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", true, fmt.Errorf("ollama: read response: %w", err)
	}

	if resp.StatusCode >= 500 {
		return "", true, fmt.Errorf("ollama: server error %d: %s", resp.StatusCode, body)
	}
	if resp.StatusCode != http.StatusOK {
		return "", false, fmt.Errorf("ollama: status %d: %s", resp.StatusCode, body)
	}

	var parsed chatResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", false, fmt.Errorf("ollama: parse response: %w", err)
	}
	if parsed.Error != "" {
		return "", false, fmt.Errorf("ollama: api error: %s", parsed.Error)
	}

	return parsed.Message.Content, false, nil
}
