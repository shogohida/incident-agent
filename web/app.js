// incident-agent browser demo. No build step, no framework — plain ES
// modules, same spirit as the sibling sqllab/schemalab/routelab demo pages.
//
// The three incident scenarios below are static fixtures shaped exactly
// like the real tool's internal/alert.Alert and internal/sources types
// (same JSON field names), and the system prompt + user-message formatting
// in this file are a line-for-line port of internal/agent/prompt.go. The
// reasoning step is pluggable between three backends the user picks in the
// UI:
//   - 'free'   - this same server's POST /api/investigate, which runs the
//                real internal/agent pipeline against a key the operator
//                pays for, rate-limited server-side (cmd/server) so no
//                visitor needs their own key. Default.
//   - 'claude' - the real Claude API called directly from the browser with
//                a visitor-supplied key (see runClaudeApi).
//   - 'webllm' - a small model loaded via WebLLM/WebGPU and run entirely in
//                the browser - free and needs no server, but a small model
//                makes more mistakes and can run out of GPU memory on
//                constrained devices (see runWebLLM).

// --- scenario fixtures -----------------------------------------------

function minutesAgo(now, m) { return new Date(now.getTime() - m * 60000); }
function secondsAgo(now, s) { return new Date(now.getTime() - s * 1000); }

function buildScenarios(now) {
  return [
    {
      id: 'checkout-bad-deploy',
      title: 'Checkout: 5xx spike right after a deploy',
      description: 'A deploy 4 minutes before the alert swapped in a new pricing-engine client. Clear correlation once you line up the timestamps.',
      alert: {
        id: 'alert-8841', source: 'datadog', service: 'checkout',
        title: 'High 5xx error rate',
        message: 'Error rate exceeded 5% for 3 minutes',
        severity: 'critical',
        labels: { env: 'production', region: 'us-east-1' },
        fired_at: minutesAgo(now, 2), received_at: minutesAgo(now, 2),
      },
      logs: [
        { timestamp: secondsAgo(now, 40), level: 'error', service: 'checkout', message: 'panic recovered: pricing-engine client: nil pointer dereference in ApplyDiscount' },
        { timestamp: secondsAgo(now, 55), level: 'error', service: 'checkout', message: 'panic recovered: pricing-engine client: nil pointer dereference in ApplyDiscount' },
        { timestamp: secondsAgo(now, 70), level: 'error', service: 'checkout', message: 'checkout failed: 500 Internal Server Error (request_id=b291c)' },
        { timestamp: secondsAgo(now, 90), level: 'error', service: 'checkout', message: 'panic recovered: pricing-engine client: nil pointer dereference in ApplyDiscount' },
        { timestamp: minutesAgo(now, 2), level: 'error', service: 'checkout', message: 'checkout failed: 500 Internal Server Error (request_id=a10f2)' },
        { timestamp: minutesAgo(now, 3), level: 'warn', service: 'checkout', message: 'pricing-engine client: response missing expected field "tier", falling back' },
        { timestamp: minutesAgo(now, 3), level: 'info', service: 'checkout', message: 'deployed revision 9f3a1c2 (pricing-engine client v2)' },
        { timestamp: minutesAgo(now, 8), level: 'info', service: 'checkout', message: 'checkout succeeded (request_id=91aa0)' },
        { timestamp: minutesAgo(now, 9), level: 'info', service: 'checkout', message: 'checkout succeeded (request_id=88b31)' },
      ],
      deploys: [
        { sha: '9f3a1c27b8e4d5f60123456789abcdef0123456', author: 'priya', message: 'checkout: switch discount calc to new pricing-engine client', timestamp: minutesAgo(now, 4), url: 'https://github.com/example/checkout/commit/9f3a1c2' },
        { sha: '4b7710adf2c19e0a5566778899aabbccddeeff0', author: 'jordan', message: 'checkout: bump logging verbosity for pricing-engine calls', timestamp: minutesAgo(now, 55), url: 'https://github.com/example/checkout/commit/4b7710a' },
      ],
      metrics: [
        { name: 'error_rate_5xx', unit: 'percent', points: pointSeries(now, 6, 1, [0.4, 0.5, 0.6, 4.1, 5.9, 6.8, 6.5]) },
        { name: 'latency_p99_ms', unit: 'ms', points: pointSeries(now, 6, 1, [180, 190, 175, 240, 310, 340, 355]) },
      ],
      sourceErrors: [],
    },
    {
      id: 'db-pool-exhaustion',
      title: 'Orders API: DB connection pool exhaustion',
      description: 'No recent deploy anywhere near the alert — the culprit is a slow leak in connection pool usage, not a code change.',
      alert: {
        id: 'alert-8842', source: 'datadog', service: 'orders-api',
        title: 'Elevated request latency',
        message: 'p99 latency exceeded 2000ms for 5 minutes',
        severity: 'critical',
        labels: { env: 'production', region: 'us-east-1' },
        fired_at: minutesAgo(now, 1), received_at: minutesAgo(now, 1),
      },
      logs: [
        { timestamp: secondsAgo(now, 20), level: 'error', service: 'orders-api', message: 'could not acquire connection from pool: timeout after 5s' },
        { timestamp: secondsAgo(now, 35), level: 'error', service: 'orders-api', message: 'could not acquire connection from pool: timeout after 5s' },
        { timestamp: secondsAgo(now, 50), level: 'error', service: 'orders-api', message: 'could not acquire connection from pool: timeout after 5s' },
        { timestamp: minutesAgo(now, 2), level: 'warn', service: 'orders-api', message: 'db pool utilization at 92% (46/50 connections in use)' },
        { timestamp: minutesAgo(now, 5), level: 'warn', service: 'orders-api', message: 'db pool utilization at 81% (40/50 connections in use)' },
        { timestamp: minutesAgo(now, 8), level: 'warn', service: 'orders-api', message: 'db pool utilization at 68% (34/50 connections in use)' },
        { timestamp: minutesAgo(now, 12), level: 'info', service: 'orders-api', message: 'db pool utilization at 40% (20/50 connections in use)' },
        { timestamp: minutesAgo(now, 20), level: 'info', service: 'orders-api', message: 'orders-api healthy, all checks passing' },
      ],
      deploys: [
        { sha: 'c2d8e91f0a1b2c3d4e5f60718293a4b5c6d7e8f', author: 'sam', message: 'docs: fix broken link in on-call runbook', timestamp: minutesAgo(now, 14 * 60), url: 'https://github.com/example/orders-api/commit/c2d8e91' },
      ],
      metrics: [
        { name: 'db_pool_active_connections', unit: 'connections', points: pointSeries(now, 12, 2, [20, 27, 34, 40, 46, 49, 50]) },
        { name: 'db_query_p99_ms', unit: 'ms', points: pointSeries(now, 12, 2, [45, 60, 95, 340, 1200, 2100, 2400]) },
      ],
      sourceErrors: [],
    },
    {
      id: 'noisy-false-alarm',
      title: 'Search: single latency blip, no errors',
      description: 'One data point crossed the alert threshold and recovered on its own. Watch whether the model appropriately lowers its confidence instead of inventing a root cause.',
      alert: {
        id: 'alert-8843', source: 'datadog', service: 'search',
        title: 'Latency threshold breach',
        message: 'p95 latency exceeded 800ms',
        severity: 'warning',
        labels: { env: 'production', region: 'eu-west-1' },
        fired_at: secondsAgo(now, 30), received_at: secondsAgo(now, 30),
      },
      logs: [
        { timestamp: secondsAgo(now, 25), level: 'warn', service: 'search', message: 'request took 812ms (threshold 800ms), request_id=f0a91' },
        { timestamp: secondsAgo(now, 40), level: 'info', service: 'search', message: 'request completed in 190ms' },
        { timestamp: secondsAgo(now, 55), level: 'info', service: 'search', message: 'request completed in 210ms' },
        { timestamp: minutesAgo(now, 2), level: 'info', service: 'search', message: 'request completed in 175ms' },
        { timestamp: minutesAgo(now, 3), level: 'info', service: 'search', message: 'request completed in 200ms' },
      ],
      deploys: [],
      metrics: [
        { name: 'latency_p95_ms', unit: 'ms', points: pointSeries(now, 5, 1, [215, 220, 210, 305, 218, 212]) },
      ],
      sourceErrors: ['metric "error_rate" unavailable: source returned only 1 data point for the lookback window'],
    },
  ];
}

function pointSeries(now, spanMinutes, stepMinutes, values) {
  const n = values.length;
  const points = [];
  for (let i = 0; i < n; i++) {
    const minutesBack = spanMinutes - i * stepMinutes;
    points.push({ timestamp: minutesAgo(now, Math.max(minutesBack, 0)), value: values[i] });
  }
  return points;
}

// --- prompt construction (ported line-for-line from internal/agent/prompt.go) ---

const SYSTEM_PROMPT = `You are an experienced Site Reliability Engineer performing a first-pass
investigation of a production incident. You will be given the alert that
fired, plus whatever recent logs, deploy history, and metrics were
available to gather automatically.

Ground every hypothesis in the specific evidence provided. If the evidence
is thin or inconclusive, say so explicitly and lower your confidence rather
than guessing. Never invent log lines, commit SHAs, or metric values that
were not given to you.

You are producing an investigative report for a human on-call engineer, not
taking any action yourself - do not suggest running destructive commands
without a human confirming first, and do not claim to have "fixed" or
"rolled back" anything.

Respond with ONLY a single JSON object (no markdown fences, no commentary
before or after) matching exactly this shape:
{
  "summary": "one or two sentence plain-language summary of what's likely happening",
  "assessed_severity": "critical" | "warning" | "info",
  "confidence": 0.0-1.0,
  "root_cause_hypotheses": [
    {"description": "...", "confidence": 0.0-1.0, "evidence": ["...", "..."]}
  ],
  "recommended_actions": ["...", "..."],
  "suspicious_deploys": ["<sha or short description>", "..."]
}
List root_cause_hypotheses from most to least likely. If no deploys look
suspicious, return an empty array for suspicious_deploys rather than
omitting the field. recommended_actions must always contain at least one
concrete next step, even if it is only to gather more evidence.`;

// Shared schema object. WebLLM's response_format.schema wants a JSON
// string, so it forces the model to emit valid JSON matching this shape via
// grammar-constrained decoding (XGrammar) instead of relying on
// prompt-following alone (small models often ignore "respond with ONLY
// JSON" and wander into prose). The Claude API's output_config.format wants
// the object itself and gets the same guarantee from structured outputs.
const REPORT_JSON_SCHEMA_OBJ = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    assessed_severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
    confidence: { type: 'number' },
    root_cause_hypotheses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          confidence: { type: 'number' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['description', 'confidence', 'evidence'],
        additionalProperties: false,
      },
    },
    recommended_actions: { type: 'array', items: { type: 'string' }, minItems: 1 },
    suspicious_deploys: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'assessed_severity', 'confidence', 'root_cause_hypotheses', 'recommended_actions', 'suspicious_deploys'],
  additionalProperties: false,
};
const REPORT_JSON_SCHEMA = JSON.stringify(REPORT_JSON_SCHEMA_OBJ);

function hhmmss(d) {
  return d.toISOString().slice(11, 19);
}

function shortSha(sha) {
  return sha.length > 8 ? sha.slice(0, 8) : sha;
}

function buildUserMessage(alert, logs, deploys, metrics, sourceErrors) {
  let b = '';
  b += '## Alert\n';
  b += `- Service: ${alert.service}\n`;
  b += `- Title: ${alert.title}\n`;
  b += `- Message: ${alert.message}\n`;
  b += `- Reported severity: ${alert.severity}\n`;
  b += `- Fired at: ${alert.fired_at.toISOString().replace('T', ' ').slice(0, 19)} UTC\n`;
  if (alert.labels && Object.keys(alert.labels).length > 0) {
    b += `- Labels: ${JSON.stringify(alert.labels)}\n`;
  }

  b += `\n## Recent logs (${logs.length} entries, most recent first)\n`;
  if (logs.length === 0) b += '(none available)\n';
  for (const l of logs) {
    b += `[${hhmmss(l.timestamp)}] ${l.level.toUpperCase()} ${l.service}: ${l.message}\n`;
  }

  b += `\n## Recent deploys/commits (${deploys.length})\n`;
  if (deploys.length === 0) b += '(none available)\n';
  for (const d of deploys) {
    b += `- ${shortSha(d.sha)} by ${d.author} at ${hhmmss(d.timestamp)}: ${d.message}\n`;
  }

  if (metrics.length > 0) {
    b += '\n## Metrics\n';
    for (const m of metrics) {
      b += `- ${m.name} (${m.unit}), ${m.points.length} points:`;
      for (const p of m.points) b += ` [${hhmmss(p.timestamp)}=${p.value.toFixed(2)}]`;
      b += '\n';
    }
  }

  if (sourceErrors.length > 0) {
    b += '\n## Context gathering issues (be more conservative in your confidence given these gaps)\n';
    for (const e of sourceErrors) b += `- ${e}\n`;
  }

  return b;
}

function parseModelResponse(raw) {
  let text = raw.trim();
  text = text.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    // Fallback for models/backends where grammar-constrained decoding isn't
    // honored: pull out the first balanced-looking {...} block and retry.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw e;
    return JSON.parse(text.slice(start, end + 1));
  }
}

// --- DOM wiring ---------------------------------------------------------

const scenarioListEl = document.getElementById('scenarioList');
const alertBox = document.getElementById('alertBox');
const contextBox = document.getElementById('contextBox');
const fireBtn = document.getElementById('fireBtn');
const loadModelBtn = document.getElementById('loadModelBtn');
const investigateBtn = document.getElementById('investigateBtn');
const aiStatus = document.getElementById('aiStatus');
const reportBox = document.getElementById('reportBox');
const logEl = document.getElementById('log');
const backendFreeBtn = document.getElementById('backendFreeBtn');
const backendClaudeBtn = document.getElementById('backendClaudeBtn');
const backendWebllmBtn = document.getElementById('backendWebllmBtn');
const freePanel = document.getElementById('freePanel');
const claudePanel = document.getElementById('claudePanel');
const webllmPanel = document.getElementById('webllmPanel');
const claudeApiKeyInput = document.getElementById('claudeApiKey');
const saveKeyBtn = document.getElementById('saveKeyBtn');

const CUSTOM_SCENARIO = {
  id: 'custom', custom: true,
  title: 'Paste your own data',
  description: 'Bring your own alert, logs, deploys, and metrics as JSON — same field names as internal/alert.Alert and internal/sources.',
  alert: null, logs: [], deploys: [], metrics: [], sourceErrors: [],
};

function buildCustomTemplate(now) {
  const example = {
    alert: {
      service: 'checkout',
      title: 'High 5xx error rate',
      message: 'Error rate exceeded 5% for 3 minutes',
      severity: 'critical',
      fired_at: minutesAgo(now, 1).toISOString(),
      labels: { env: 'production' },
    },
    logs: [
      { timestamp: secondsAgo(now, 30).toISOString(), level: 'error', service: 'checkout', message: 'checkout failed: 500 Internal Server Error' },
      { timestamp: minutesAgo(now, 4).toISOString(), level: 'info', service: 'checkout', message: 'deployed revision abc1234' },
    ],
    deploys: [
      { sha: 'abc1234', author: 'you', message: 'describe the change here', timestamp: minutesAgo(now, 4).toISOString(), url: '' },
    ],
    metrics: [
      { name: 'error_rate_5xx', unit: 'percent', points: [
        { timestamp: minutesAgo(now, 5).toISOString(), value: 0.5 },
        { timestamp: now.toISOString(), value: 6.2 },
      ] },
    ],
    sourceErrors: [],
  };
  return JSON.stringify(example, null, 2);
}

// Returns a Date for a given value, or null if v is missing/unparseable —
// callers fall back to a default rather than rejecting the whole payload
// over one bad or absent timestamp.
function parseDateLenient(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function asObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function firstDefined(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

// Best-effort epoch guess: 13-digit numbers are epoch milliseconds, but
// most structured loggers (and the sample payload this was written
// against) emit 10-digit epoch *seconds* - naively feeding those into
// `new Date()` lands in 1970. Anything under 1e12 is assumed to be seconds.
function parseTimestampGuess(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return isNaN(d.getTime()) ? null : d;
  }
  return parseDateLenient(v);
}

const LOG_LEVEL_TO_SEVERITY = {
  error: 'critical', fatal: 'critical', critical: 'critical', panic: 'critical',
  warn: 'warning', warning: 'warning',
  info: 'info', debug: 'info', trace: 'info',
};
const KNOWN_TOP_LEVEL_KEYS = ['alert', 'logs', 'deploys', 'metrics', 'sourceErrors'];
const MAX_WRAPPED_MESSAGE_CHARS = 4000;

// Most structured loggers (Datadog forwarders, CloudWatch, etc.) emit one
// flat JSON object per log line - not wrapped in {alert, logs, ...}. If the
// pasted JSON has none of our known top-level keys, treat it as exactly
// that: one raw log line. Guess a timestamp/level/service/message from the
// field names loggers commonly use, and carry the entire object into the
// log message (JSON.stringify) so nothing not recognized is silently
// dropped - the LLM still sees it as evidence even if we can't label it.
function wrapAsSingleLogEntry(data) {
  const level = String(firstDefined(data, ['level', 'severity', 'log_level', 'logLevel']) || 'info').toLowerCase();
  const service = firstDefined(data, ['service', 'service_name', 'serviceName', 'app', 'application', 'host', 'component']);
  const messageField = firstDefined(data, ['message', 'msg', 'error_message', 'errorMessage', 'description', 'text']);
  const timestamp = (parseTimestampGuess(firstDefined(data, ['timestamp', 'ts', 'time', 'date', 'datetime'])) || new Date()).toISOString();

  let raw = JSON.stringify(data);
  if (raw.length > MAX_WRAPPED_MESSAGE_CHARS) raw = raw.slice(0, MAX_WRAPPED_MESSAGE_CHARS) + '…(truncated)';
  const message = messageField ? `${messageField} — ${raw}` : raw;

  return {
    alert: {
      service, title: messageField ? String(messageField).slice(0, 140) : undefined,
      message, severity: LOG_LEVEL_TO_SEVERITY[level] || 'warning', fired_at: timestamp,
    },
    logs: [{ timestamp, level, service, message }],
    deploys: [], metrics: [], sourceErrors: [],
  };
}

// Parses the pasted JSON into the same shape buildScenarios() produces, so
// the rest of the app (renderContext, buildUserMessage, ...) needs no
// custom-vs-fixture branching beyond this function. Every field is
// optional and falls back to a sensible default instead of rejecting the
// input — the point of "paste your own data" is to try whatever JSON is on
// hand, not to force it into an exact schema. The only hard requirements
// are that it's valid JSON and the top level is an object.
function parseCustomData(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Top-level value must be a JSON object.');
  }
  if (!KNOWN_TOP_LEVEL_KEYS.some(k => k in data)) {
    data = wrapAsSingleLogEntry(data);
  }

  const a = asObject(data.alert);
  const firedAt = parseDateLenient(a.fired_at) || new Date();
  const receivedAt = parseDateLenient(a.received_at) || firedAt;
  const severity = ['critical', 'warning', 'info'].includes(a.severity) ? a.severity : 'warning';

  const logs = Array.isArray(data.logs) ? data.logs.map(l => {
    l = asObject(l);
    return {
      timestamp: parseDateLenient(l.timestamp) || new Date(),
      level: String(l.level || 'info'),
      service: String(l.service || a.service || 'unknown'),
      message: String(l.message || ''),
    };
  }) : [];

  const deploys = Array.isArray(data.deploys) ? data.deploys.map(d => {
    d = asObject(d);
    return {
      sha: String(d.sha || ''),
      author: String(d.author || ''),
      message: String(d.message || ''),
      timestamp: parseDateLenient(d.timestamp) || new Date(),
      url: String(d.url || ''),
    };
  }) : [];

  const metrics = Array.isArray(data.metrics) ? data.metrics.map((m, i) => {
    m = asObject(m);
    return {
      name: String(m.name || `metric_${i}`),
      unit: String(m.unit || ''),
      points: Array.isArray(m.points) ? m.points.map(p => {
        p = asObject(p);
        return { timestamp: parseDateLenient(p.timestamp) || new Date(), value: Number(p.value) || 0 };
      }) : [],
    };
  }) : [];

  const sourceErrors = Array.isArray(data.sourceErrors) ? data.sourceErrors.map(String) : [];

  return {
    alert: {
      id: 'custom-alert', source: a.source ? String(a.source) : 'custom',
      service: a.service ? String(a.service) : 'unknown',
      title: a.title ? String(a.title) : '(untitled alert)',
      message: a.message ? String(a.message) : '',
      severity,
      labels: asObject(a.labels),
      fired_at: firedAt, received_at: receivedAt,
    },
    logs, deploys, metrics, sourceErrors,
  };
}

const initNow = new Date();
let scenarios = [...buildScenarios(initNow), CUSTOM_SCENARIO];
let customInputValue = buildCustomTemplate(initNow);
let activeScenario = scenarios[0];
let contextGathered = false;
let webllmEngine = null;
let webllmModule = null;
let modelTierIndex = 0;

// Which backend answers "Investigate": 'free' (this server's own
// rate-limited Claude proxy, no key needed), 'claude' (the real Anthropic
// API called directly with a user-supplied key), or 'webllm' (a small
// model run entirely in the browser).
const CLAUDE_KEY_STORAGE = 'incident-agent-claude-api-key';
let backend = 'free';
let claudeApiKey = localStorage.getItem(CLAUDE_KEY_STORAGE) || '';

function log(kind, msg) {
  const div = document.createElement('div');
  div.className = `log-entry ${kind}`;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = new Date().toLocaleTimeString();
  div.appendChild(meta);
  div.appendChild(document.createTextNode(msg));
  logEl.prepend(div);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function severityBadge(sev) {
  const cls = sev === 'critical' ? 'bad' : sev === 'warning' ? 'warn' : 'muted';
  return `<span class="badge ${cls}">${sev}</span>`;
}

function renderScenarios() {
  scenarioListEl.innerHTML = '';
  scenarios.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'scenario' + (s === activeScenario ? ' active' : '');
    btn.innerHTML = `${s.title}<span class="desc">${s.description}</span>`;
    btn.addEventListener('click', () => selectScenario(s));
    scenarioListEl.appendChild(btn);
  });
}

function selectScenario(s) {
  activeScenario = s;
  contextGathered = false;
  investigateBtn.disabled = true;
  contextBox.innerHTML = '';
  reportBox.innerHTML = '';
  renderScenarios();
  renderAlert(s);
}

function renderAlert(s) {
  if (s.custom) {
    alertBox.innerHTML = `
      <p class="hint">Paste any JSON object — every field is optional and missing/malformed ones just fall back to a default, so partial or off-shape data still works. For the richest report, use <code>alert</code>, <code>logs</code>, <code>deploys</code>, <code>metrics</code>, and <code>sourceErrors</code> — same field names as <code>internal/alert.Alert</code> and <code>internal/sources</code>. If none of those keys are present at all (e.g. you pasted one raw structured-logger line), it's treated as a single log entry and its timestamp/level/service/message are guessed from common field names. Timestamps are any string <code>Date</code> can parse (ISO 8601 recommended).</p>
      <textarea id="customDataInput" class="custom-input" rows="16" spellcheck="false"></textarea>
      <div id="customDataStatus" class="hint"></div>
    `;
    const ta = document.getElementById('customDataInput');
    ta.value = customInputValue;
    ta.addEventListener('input', () => { customInputValue = ta.value; });
    return;
  }
  const a = s.alert;
  alertBox.innerHTML = `
    <div class="alert-line">${severityBadge(a.severity)} <b>${a.title}</b></div>
    <div class="hint">${a.service} · ${a.message}</div>
    <div class="hint">source: ${a.source} · fired_at: ${a.fired_at.toLocaleTimeString()}</div>
  `;
}

function renderContext(s) {
  const parts = [];
  parts.push(`<h3>Logs (${s.logs.length})</h3><div class="log mini">${s.logs.map(l =>
    `<div class="log-entry ${l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : 'ok'}"><span class="meta">[${hhmmss(l.timestamp)}] ${l.level.toUpperCase()}</span>${l.message}</div>`
  ).join('')}</div>`);
  parts.push(`<h3>Deploys (${s.deploys.length})</h3>` + (s.deploys.length
    ? s.deploys.map(d => `<div class="deploy-line"><code>${shortSha(d.sha)}</code> ${d.author}: ${d.message} <span class="hint">(${d.timestamp.toLocaleTimeString()})</span></div>`).join('')
    : '<div class="hint">(none in window)</div>'));
  parts.push(`<h3>Metrics</h3>` + s.metrics.map(m =>
    `<div class="metric-line"><b>${m.name}</b> (${m.unit}): ${m.points.map(p => p.value.toFixed(1)).join(' → ')}</div>`
  ).join(''));
  if (s.sourceErrors.length) {
    parts.push(`<h3>Gathering issues</h3>` + s.sourceErrors.map(e => `<div class="hint">${e}</div>`).join(''));
  }
  contextBox.innerHTML = parts.join('');
}

fireBtn.addEventListener('click', async () => {
  const s = activeScenario;
  if (s.custom) {
    const statusEl = document.getElementById('customDataStatus');
    try {
      Object.assign(s, parseCustomData(customInputValue));
    } catch (e) {
      if (statusEl) { statusEl.textContent = e.message; statusEl.classList.add('error-text'); }
      log('err', `custom data error: ${e.message}`);
      return;
    }
    if (statusEl) {
      statusEl.classList.remove('error-text');
      statusEl.textContent = `Parsed OK: ${s.alert.service} — ${s.alert.title}`;
    }
  }
  fireBtn.disabled = true;
  log('warn', `alert fired: ${s.alert.service} — ${s.alert.title}`);
  await sleep(250);
  log('ok', `gathering logs... ${s.logs.length} entries`);
  await sleep(300);
  log('ok', `gathering recent deploys/commits... ${s.deploys.length} found`);
  await sleep(300);
  log('ok', `gathering metrics... ${s.metrics.length} series`);
  await sleep(200);
  if (s.sourceErrors.length) log('err', `${s.sourceErrors.length} source(s) reported gaps`);
  renderContext(s);
  contextGathered = true;
  fireBtn.disabled = false;
  updateInvestigateEnabled();
  log('ok', 'context gathered — ready to investigate');
});

// --- backend selection (server free tier / bring-your-own-key / WebLLM) -

function updateInvestigateEnabled() {
  if (!contextGathered) { investigateBtn.disabled = true; return; }
  investigateBtn.disabled = backend === 'claude' ? !claudeApiKey : backend === 'webllm' ? !webllmEngine : false;
}

function setBackend(next) {
  backend = next;
  backendFreeBtn.classList.toggle('active', backend === 'free');
  backendClaudeBtn.classList.toggle('active', backend === 'claude');
  backendWebllmBtn.classList.toggle('active', backend === 'webllm');
  freePanel.style.display = backend === 'free' ? '' : 'none';
  claudePanel.style.display = backend === 'claude' ? '' : 'none';
  webllmPanel.style.display = backend === 'webllm' ? '' : 'none';
  updateInvestigateEnabled();
}

backendFreeBtn.addEventListener('click', () => setBackend('free'));
backendClaudeBtn.addEventListener('click', () => setBackend('claude'));
backendWebllmBtn.addEventListener('click', () => setBackend('webllm'));

claudeApiKeyInput.value = claudeApiKey;
saveKeyBtn.addEventListener('click', () => {
  const val = claudeApiKeyInput.value.trim();
  claudeApiKey = val;
  if (val) {
    localStorage.setItem(CLAUDE_KEY_STORAGE, val);
    aiStatus.textContent = 'Claude API key saved in this browser (sent only to api.anthropic.com, never to us).';
    log('ok', 'Claude API key saved locally');
  } else {
    localStorage.removeItem(CLAUDE_KEY_STORAGE);
    aiStatus.textContent = 'Claude API key cleared.';
    log('warn', 'Claude API key cleared');
  }
  updateInvestigateEnabled();
});

if (!navigator.gpu) {
  loadModelBtn.disabled = true;
  loadModelBtn.title = 'Requires a WebGPU-capable browser (e.g. desktop Chrome or Edge).';
}
setBackend('free');

// Start with the lightest model so the demo works on constrained GPUs
// without needing a device-lost fallback in the common case.
const PREFERRED_MODELS = ['Qwen2.5-0.5B-Instruct'];
function pickModel(modelList, startTier = 0) {
  for (let i = startTier; i < PREFERRED_MODELS.length; i++) {
    const found = modelList.find(m => m.model_id.includes(PREFERRED_MODELS[i]));
    if (found) return { modelId: found.model_id, tier: i };
  }
  return { modelId: modelList[0]?.model_id, tier: PREFERRED_MODELS.length };
}

function isDeviceLostError(e) {
  const msg = String((e && e.message) || e || '');
  return /device was lost|gpudevicelostinfo|external instance reference/i.test(msg);
}

async function loadModel(tier) {
  const webllm = webllmModule || (webllmModule = await import('https://esm.run/@mlc-ai/web-llm'));
  const { modelId, tier: resolvedTier } = pickModel(webllm.prebuiltAppConfig.model_list, tier);
  modelTierIndex = resolvedTier;
  aiStatus.textContent = `Loading ${modelId}…`;
  webllmEngine = await webllm.CreateMLCEngine(modelId, {
    initProgressCallback: (report) => { aiStatus.textContent = report.text; },
  });
  aiStatus.textContent = `Ready (${modelId}), running locally in your browser.`;
  return modelId;
}

// A device-lost error usually means insufficient GPU memory — retry with a lighter model
// until we run out of lighter options.
async function loadModelWithFallback(startTier) {
  let tier = startTier;
  while (true) {
    try {
      return await loadModel(tier);
    } catch (e) {
      if (isDeviceLostError(e) && tier + 1 < PREFERRED_MODELS.length) {
        log('err', `GPU device was lost while loading ${PREFERRED_MODELS[tier]} (likely insufficient memory). Switching to a lighter model…`);
        tier += 1;
        continue;
      }
      throw e;
    }
  }
}

loadModelBtn.addEventListener('click', async () => {
  loadModelBtn.disabled = true;
  aiStatus.textContent = 'Loading WebLLM…';
  try {
    await loadModelWithFallback(0);
    updateInvestigateEnabled();
  } catch (e) {
    aiStatus.textContent = isDeviceLostError(e)
      ? 'Could not load the AI model due to insufficient GPU memory. Try closing other tabs/apps or reloading the browser, then try again.'
      : `Could not load the AI model: ${e.message}`;
    loadModelBtn.disabled = false;
  }
});

async function runWebLLM(userMessage) {
  const completion = await webllmEngine.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 900,
    response_format: { type: 'json_object', schema: REPORT_JSON_SCHEMA },
  });
  return completion.choices[0].message.content;
}

// Calls the real Anthropic Messages API directly from the browser using the
// user's own key. anthropic-dangerous-direct-browser-access is required —
// without it Anthropic's CORS policy rejects browser-origin requests. The
// key is only ever sent to api.anthropic.com, straight from this browser.
async function runClaudeApi(userMessage) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      output_config: { format: { type: 'json_schema', schema: REPORT_JSON_SCHEMA_OBJ } },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
  }
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

// Calls this same server's own POST /api/investigate (cmd/server) - no key
// needed, since the server holds one and rate-limits per IP + globally per
// day. It runs the exact internal/agent pipeline and returns an
// already-parsed report (see internal/agent.Report), not raw model text -
// there is no JSON-parsing step for this backend, unlike the other two.
async function runFreeApi(s) {
  const res = await fetch('/api/investigate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      alert: s.alert, logs: s.logs, deploys: s.deploys, metrics: s.metrics, sourceErrors: s.sourceErrors,
    }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* body wasn't JSON (e.g. a 404 HTML page) */ }
  if (!res.ok) {
    throw new Error((data && data.error) || `HTTP ${res.status}`);
  }
  return data;
}

investigateBtn.addEventListener('click', async () => {
  if (!contextGathered) return;
  if (backend === 'webllm' && !webllmEngine) return;
  if (backend === 'claude' && !claudeApiKey) return;
  investigateBtn.disabled = true;
  reportBox.innerHTML = '';
  aiStatus.textContent = 'Investigating…';
  const s = activeScenario;
  const started = performance.now();
  log('ok', backend === 'free'
    ? 'asking Claude (free tier, via this server) to investigate...'
    : backend === 'claude'
      ? 'asking Claude (claude-haiku-4-5) to investigate (same system prompt as internal/agent/prompt.go)...'
      : 'asking the model to investigate (same system prompt as internal/agent/prompt.go)...');
  try {
    let report;
    if (backend === 'free') {
      report = await runFreeApi(s);
    } else {
      const userMessage = buildUserMessage(s.alert, s.logs, s.deploys, s.metrics, s.sourceErrors);
      const raw = backend === 'claude' ? await runClaudeApi(userMessage) : await runWebLLM(userMessage);
      try {
        report = parseModelResponse(raw);
      } catch (e) {
        const elapsed = ((performance.now() - started) / 1000).toFixed(1);
        reportBox.innerHTML = `<div class="hint">Model response could not be parsed as JSON. Raw output:</div><pre class="raw">${escapeHtml(raw)}</pre>`;
        aiStatus.textContent = `Parse failed after ${elapsed}s — see raw output below.`;
        log('err', `could not parse model response as JSON`);
        updateInvestigateEnabled();
        return;
      }
    }
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    renderReport(report);
    aiStatus.textContent = `Report generated in ${elapsed}s.`;
    log('ok', `investigation complete in ${elapsed}s`);
  } catch (e) {
    if (backend === 'webllm' && isDeviceLostError(e)) {
      if (modelTierIndex + 1 < PREFERRED_MODELS.length) {
        log('err', 'GPU device was lost (likely insufficient memory). Switching to a lighter model and retrying…');
        aiStatus.textContent = 'GPU ran out of memory — switching to a lighter model…';
        try {
          const modelId = await loadModelWithFallback(modelTierIndex + 1);
          log('ok', `${modelId} is ready. Click "Investigate" again.`);
        } catch (reloadErr) {
          aiStatus.textContent = `Could not switch to a lighter model either: ${reloadErr.message}`;
          log('err', `reload failed: ${reloadErr.message}`);
          webllmEngine = null;
          loadModelBtn.disabled = false;
        }
      } else {
        aiStatus.textContent = 'Investigation failed due to insufficient GPU memory. Close other tabs/apps and reload the browser, then try again.';
        log('err', 'GPU device lost (no lighter model left to fall back to)');
        webllmEngine = null;
        loadModelBtn.disabled = false;
      }
    } else {
      aiStatus.textContent = `Investigation failed: ${e.message}`;
      log('err', `investigation failed: ${e.message}`);
    }
  } finally {
    updateInvestigateEnabled();
  }
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderReport(r) {
  const hyps = (r.root_cause_hypotheses || []).map(h => `
    <div class="hypothesis">
      <div><b>${escapeHtml(h.description || '')}</b> <span class="hint">(${Math.round((h.confidence || 0) * 100)}% confidence)</span></div>
      <ul>${(h.evidence || []).map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
    </div>`).join('');
  const actions = (r.recommended_actions || []).map(a => `<li>${escapeHtml(a)}</li>`).join('');
  const deploys = (r.suspicious_deploys || []).length
    ? (r.suspicious_deploys || []).map(d => `<li><code>${escapeHtml(d)}</code></li>`).join('')
    : '<li class="hint">none flagged</li>';

  reportBox.innerHTML = `
    <div class="report-summary">${severityBadge(r.assessed_severity || 'info')} <span class="hint">(${Math.round((r.confidence || 0) * 100)}% overall confidence)</span></div>
    <p>${escapeHtml(r.summary || '')}</p>
    <h3>Root cause hypotheses</h3>
    ${hyps || '<div class="hint">(none)</div>'}
    <h3>Recommended actions</h3>
    <ul>${actions || '<li class="hint">The model did not suggest any concrete next steps — treat the hypotheses above as a starting point and investigate manually.</li>'}</ul>
    <h3>Suspicious deploys</h3>
    <ul>${deploys}</ul>
  `;
}

// --- init ---
renderScenarios();
renderAlert(activeScenario);
