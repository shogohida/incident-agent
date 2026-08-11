// incident-agent ブラウザデモ（日本語UI）。ロジックはapp.jsと同一——UI文言と
// シナリオのタイトル/説明のみ翻訳している（ログ行やコミットメッセージなど
// 実運用ログに相当する内容は、実際のシステムでも英語であることが自然なため
// 原文のまま）。システムプロンプトとコンテキスト整形は
// internal/agent/prompt.go と一字一句同じロジックを使用。

function minutesAgo(now, m) { return new Date(now.getTime() - m * 60000); }
function secondsAgo(now, s) { return new Date(now.getTime() - s * 1000); }

const SCENARIO_JA = {
  'checkout-bad-deploy': {
    title: 'Checkout: デプロイ直後の5xx急増',
    description: 'アラート発火の4分前のデプロイが決済計算クライアントを差し替えていた。タイムスタンプを並べれば相関は明白。',
  },
  'db-pool-exhaustion': {
    title: 'Orders API: DBコネクションプール枯渇',
    description: 'アラート付近に直近のデプロイなし。原因はコード変更ではなく、コネクションプール使用量のゆっくりとした漏れ。',
  },
  'noisy-false-alarm': {
    title: 'Search: 単発のレイテンシ変動、エラーなし',
    description: '1つのデータポイントが閾値を超え自然に回復。モデルが根拠のない原因を捏造せず、適切に確信度を下げられるかを見るケース。',
  },
};

function buildScenarios(now) {
  return [
    {
      id: 'checkout-bad-deploy',
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
  ].map(s => Object.assign(s, SCENARIO_JA[s.id]));
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

function hhmmss(d) { return d.toISOString().slice(11, 19); }
function shortSha(sha) { return sha.length > 8 ? sha.slice(0, 8) : sha; }

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

const SEV_JA = { critical: '重大', warning: '警告', info: '情報' };
function severityBadge(sev) {
  const cls = sev === 'critical' ? 'bad' : sev === 'warning' ? 'warn' : 'muted';
  return `<span class="badge ${cls}">${SEV_JA[sev] || sev}</span>`;
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
  parts.push(`<h3>ログ（${s.logs.length}件）</h3><div class="log mini">${s.logs.map(l =>
    `<div class="log-entry ${l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : 'ok'}"><span class="meta">[${hhmmss(l.timestamp)}] ${l.level.toUpperCase()}</span>${l.message}</div>`
  ).join('')}</div>`);
  parts.push(`<h3>デプロイ（${s.deploys.length}件）</h3>` + (s.deploys.length
    ? s.deploys.map(d => `<div class="deploy-line"><code>${shortSha(d.sha)}</code> ${d.author}: ${d.message} <span class="hint">(${d.timestamp.toLocaleTimeString()})</span></div>`).join('')
    : '<div class="hint">（対象期間内になし）</div>'));
  parts.push(`<h3>メトリクス</h3>` + s.metrics.map(m =>
    `<div class="metric-line"><b>${m.name}</b> (${m.unit}): ${m.points.map(p => p.value.toFixed(1)).join(' → ')}</div>`
  ).join(''));
  if (s.sourceErrors.length) {
    parts.push(`<h3>収集時の問題</h3>` + s.sourceErrors.map(e => `<div class="hint">${e}</div>`).join(''));
  }
  contextBox.innerHTML = parts.join('');
}

fireBtn.addEventListener('click', async () => {
  fireBtn.disabled = true;
  const s = activeScenario;
  log('warn', `アラート発火: ${s.alert.service} — ${s.alert.title}`);
  await sleep(250);
  log('ok', `ログ収集中... ${s.logs.length}件`);
  await sleep(300);
  log('ok', `デプロイ/コミット履歴を収集中... ${s.deploys.length}件`);
  await sleep(300);
  log('ok', `メトリクス収集中... ${s.metrics.length}系列`);
  await sleep(200);
  if (s.sourceErrors.length) log('err', `${s.sourceErrors.length}件のソースで取得漏れ`);
  renderContext(s);
  contextGathered = true;
  fireBtn.disabled = false;
  investigateBtn.disabled = !webllmEngine;
  log('ok', 'コンテキスト収集完了 — 調査を開始できます');
});

if (!navigator.gpu) {
  loadModelBtn.disabled = true;
  loadModelBtn.title = 'WebGPU対応ブラウザが必要です（例：デスクトップ版Chrome/Edge）。';
  aiStatus.textContent = 'お使いのブラウザはWebGPUに対応していないため、ブラウザ内AIモデルを実行できません。';
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
  aiStatus.textContent = 'WebLLMを読み込み中…';
  try {
    const webllm = await import('https://esm.run/@mlc-ai/web-llm');
    const modelId = pickModel(webllm.prebuiltAppConfig.model_list);
    aiStatus.textContent = `${modelId} を読み込み中…`;

    webllmEngine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => { aiStatus.textContent = report.text; },
    });

    aiStatus.textContent = `準備完了（${modelId}）。ブラウザ内でローカル実行中。`;
    investigateBtn.disabled = !contextGathered;
  } catch (e) {
    aiStatus.textContent = `AIモデルの読み込みに失敗しました: ${e.message}`;
    loadModelBtn.disabled = false;
  }
});

investigateBtn.addEventListener('click', async () => {
  if (!webllmEngine || !contextGathered) return;
  investigateBtn.disabled = true;
  reportBox.innerHTML = '';
  aiStatus.textContent = '調査中…';
  const s = activeScenario;
  const userMessage = buildUserMessage(s.alert, s.logs, s.deploys, s.metrics, s.sourceErrors);
  const started = performance.now();
  log('ok', 'モデルに調査を依頼中（internal/agent/prompt.goと同一のシステムプロンプト）...');
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
      reportBox.innerHTML = `<div class="hint">モデルの応答をJSONとしてパースできませんでした（Claudeより小型のブラウザ内モデルではこの失敗が起きやすい）。生の出力:</div><pre class="raw">${escapeHtml(raw)}</pre>`;
      aiStatus.textContent = `パース失敗（${elapsed}秒）— 下の生出力を参照してください。`;
      log('err', `モデル応答のJSONパースに失敗`);
      investigateBtn.disabled = false;
      return;
    }
    renderReport(report);
    aiStatus.textContent = `${elapsed}秒でレポートを生成しました。`;
    log('ok', `調査完了（${elapsed}秒）`);
  } catch (e) {
    aiStatus.textContent = `調査に失敗しました: ${e.message}`;
    log('err', `調査に失敗: ${e.message}`);
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
      <div><b>${escapeHtml(h.description || '')}</b> <span class="hint">(確信度 ${Math.round((h.confidence || 0) * 100)}%)</span></div>
      <ul>${(h.evidence || []).map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
    </div>`).join('');
  const actions = (r.recommended_actions || []).map(a => `<li>${escapeHtml(a)}</li>`).join('');
  const deploys = (r.suspicious_deploys || []).length
    ? (r.suspicious_deploys || []).map(d => `<li><code>${escapeHtml(d)}</code></li>`).join('')
    : '<li class="hint">該当なし</li>';

  reportBox.innerHTML = `
    <div class="report-summary">${severityBadge(r.assessed_severity || 'info')} <span class="hint">（総合確信度 ${Math.round((r.confidence || 0) * 100)}%）</span></div>
    <p>${escapeHtml(r.summary || '')}</p>
    <h3>根本原因の仮説</h3>
    ${hyps || '<div class="hint">（なし）</div>'}
    <h3>推奨アクション</h3>
    <ul>${actions || '<li class="hint">（なし）</li>'}</ul>
    <h3>疑わしいデプロイ</h3>
    <ul>${deploys}</ul>
  `;
}

renderScenarios();
renderAlert(activeScenario);
