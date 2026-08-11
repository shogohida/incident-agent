// incident-agent browser demo. No build step, no framework — plain ES
// modules, same spirit as the sibling sqllab/schemalab/routelab demo pages.
//
// There is no backend here: the three incident scenarios below are static
// fixtures shaped exactly like the real tool's internal/alert.Alert and
// internal/sources types (same JSON field names), and the system prompt +
// user-message formatting in this file are a line-for-line port of
// internal/agent/prompt.go. The only thing swapped out for the public demo
// is the reasoning step itself: the real tool calls the Claude API (or a
// local Ollama model); this page loads a small model via WebLLM/WebGPU and
// runs it entirely in your browser, so the public demo never calls a
// metered API. Report quality is correspondingly lower than the
// Claude-backed version — see the README's Ollama section for the same
// caveat.

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
omitting the field.`;

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
  return JSON.parse(text);
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

let scenarios = buildScenarios(new Date());
let activeScenario = scenarios[0];
let contextGathered = false;
let webllmEngine = null;

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
  fireBtn.disabled = true;
  const s = activeScenario;
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
  investigateBtn.disabled = !webllmEngine;
  log('ok', 'context gathered — ready to investigate');
});

if (!navigator.gpu) {
  loadModelBtn.disabled = true;
  loadModelBtn.title = 'Requires a WebGPU-capable browser (e.g. desktop Chrome or Edge).';
  aiStatus.textContent = 'Your browser does not support WebGPU, so the in-browser AI model can\'t run here.';
}

const PREFERRED_MODELS = ['Qwen2.5-1.5B-Instruct', 'Llama-3.2-3B-Instruct', 'Qwen2.5-0.5B-Instruct'];
function pickModel(modelList) {
  for (const name of PREFERRED_MODELS) {
    const found = modelList.find(m => m.model_id.includes(name));
    if (found) return found.model_id;
  }
  return modelList[0]?.model_id;
}

loadModelBtn.addEventListener('click', async () => {
  loadModelBtn.disabled = true;
  aiStatus.textContent = 'Loading WebLLM…';
  try {
    const webllm = await import('https://esm.run/@mlc-ai/web-llm');
    const modelId = pickModel(webllm.prebuiltAppConfig.model_list);
    aiStatus.textContent = `Loading ${modelId}…`;

    webllmEngine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => { aiStatus.textContent = report.text; },
    });

    aiStatus.textContent = `Ready (${modelId}), running locally in your browser.`;
    investigateBtn.disabled = !contextGathered;
  } catch (e) {
    aiStatus.textContent = `Could not load the AI model: ${e.message}`;
    loadModelBtn.disabled = false;
  }
});

investigateBtn.addEventListener('click', async () => {
  if (!webllmEngine || !contextGathered) return;
  investigateBtn.disabled = true;
  reportBox.innerHTML = '';
  aiStatus.textContent = 'Investigating…';
  const s = activeScenario;
  const userMessage = buildUserMessage(s.alert, s.logs, s.deploys, s.metrics, s.sourceErrors);
  const started = performance.now();
  log('ok', 'asking the model to investigate (same system prompt as internal/agent/prompt.go)...');
  try {
    const completion = await webllmEngine.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 900,
    });
    const raw = completion.choices[0].message.content;
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    let report;
    try {
      report = parseModelResponse(raw);
    } catch (e) {
      reportBox.innerHTML = `<div class="hint">Model response could not be parsed as JSON (this happens more often with small in-browser models than with Claude). Raw output:</div><pre class="raw">${escapeHtml(raw)}</pre>`;
      aiStatus.textContent = `Parse failed after ${elapsed}s — see raw output below.`;
      log('err', `could not parse model response as JSON`);
      investigateBtn.disabled = false;
      return;
    }
    renderReport(report);
    aiStatus.textContent = `Report generated in ${elapsed}s.`;
    log('ok', `investigation complete in ${elapsed}s`);
  } catch (e) {
    aiStatus.textContent = `Investigation failed: ${e.message}`;
    log('err', `investigation failed: ${e.message}`);
  } finally {
    investigateBtn.disabled = false;
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
    <ul>${actions || '<li class="hint">(none)</li>'}</ul>
    <h3>Suspicious deploys</h3>
    <ul>${deploys}</ul>
  `;
}

// --- init ---
renderScenarios();
renderAlert(activeScenario);
