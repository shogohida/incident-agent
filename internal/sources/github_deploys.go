package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// GitHubDeploySource correlates incidents with recent commits to a repo's
// default branch, using GitHub's public REST API. In a real deployment
// "deploys" and "merges to main" aren't always the same thing, but for
// teams using trunk-based development with deploy-on-merge (common at
// startups, and how the author's own teams operate), recent commits *are* a
// very strong, genuinely useful proxy for "what changed right before this
// alert fired" - and it needs zero credentials for a public repo, which
// keeps this adapter demoable without any cloud account.
type GitHubDeploySource struct {
	Owner   string
	Repo    string
	BaseURL string // overridable for tests; defaults to https://api.github.com
	Token   string // optional: raises the rate limit from 60/hr to 5000/hr
	HTTP    *http.Client
}

func NewGitHubDeploySource(owner, repo, token string) *GitHubDeploySource {
	return &GitHubDeploySource{
		Owner:   owner,
		Repo:    repo,
		BaseURL: "https://api.github.com",
		Token:   token,
		HTTP:    &http.Client{Timeout: 10 * time.Second},
	}
}

type ghCommit struct {
	SHA    string `json:"sha"`
	Commit struct {
		Message string `json:"message"`
		Author  struct {
			Name string    `json:"name"`
			Date time.Time `json:"date"`
		} `json:"author"`
	} `json:"commit"`
	HTMLURL string `json:"html_url"`
}

func (s *GitHubDeploySource) FetchRecentDeploys(ctx context.Context, service string, since time.Duration) ([]Deploy, error) {
	if s.Owner == "" || s.Repo == "" {
		return nil, fmt.Errorf("github deploys: owner/repo not configured")
	}

	q := url.Values{}
	q.Set("since", time.Now().Add(-since).UTC().Format(time.RFC3339))
	q.Set("per_page", "20")
	reqURL := fmt.Sprintf("%s/repos/%s/%s/commits?%s", s.BaseURL, s.Owner, s.Repo, q.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("github deploys: build request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if s.Token != "" {
		req.Header.Set("Authorization", "Bearer "+s.Token)
	}

	client := s.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("github deploys: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github deploys: unexpected status %d", resp.StatusCode)
	}

	var commits []ghCommit
	if err := json.NewDecoder(resp.Body).Decode(&commits); err != nil {
		return nil, fmt.Errorf("github deploys: decode response: %w", err)
	}

	deploys := make([]Deploy, 0, len(commits))
	for _, c := range commits {
		deploys = append(deploys, Deploy{
			SHA:       c.SHA,
			Author:    c.Commit.Author.Name,
			Message:   firstLine(c.Commit.Message),
			Timestamp: c.Commit.Author.Date,
			URL:       c.HTMLURL,
		})
	}
	return deploys, nil
}

func firstLine(s string) string {
	for i, r := range s {
		if r == '\n' {
			return s[:i]
		}
	}
	return s
}
