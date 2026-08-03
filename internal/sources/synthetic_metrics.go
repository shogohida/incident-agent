package sources

import (
	"context"
	"fmt"
	"time"
)

// StaticMetricSource serves pre-loaded metric series. It exists so the
// agent and demos can exercise the "here's what latency/error-rate looked
// like around the alert" path without wiring up a real APM backend. A
// production deployment swaps this for a Datadog/CloudWatch/Prometheus
// client implementing the same MetricSource interface - the agent code
// never needs to change.
type StaticMetricSource struct {
	series map[string]MetricSeries // key: service+"/"+metricName
}

func NewStaticMetricSource() *StaticMetricSource {
	return &StaticMetricSource{series: make(map[string]MetricSeries)}
}

func (s *StaticMetricSource) Seed(service, metricName string, series MetricSeries) {
	s.series[service+"/"+metricName] = series
}

func (s *StaticMetricSource) FetchMetric(ctx context.Context, service, metricName string, since time.Duration) (MetricSeries, error) {
	series, ok := s.series[service+"/"+metricName]
	if !ok {
		return MetricSeries{}, fmt.Errorf("static metrics: no data seeded for %s/%s", service, metricName)
	}

	cutoff := time.Now().Add(-since)
	filtered := MetricSeries{Name: series.Name, Unit: series.Unit}
	for _, p := range series.Points {
		if !p.Timestamp.Before(cutoff) {
			filtered.Points = append(filtered.Points, p)
		}
	}
	return filtered, nil
}
