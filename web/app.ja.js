// incident-agent ブラウザデモ（日本語UI）。ロジックはapp.jsと同一——UI文言と
// シナリオのタイトル/説明のみ翻訳している（ログ行やコミットメッセージなど
// 実運用ログに相当する内容は、実際のシステムでも英語であることが自然なため
// 原文のまま）。システムプロンプトとコンテキスト整形は
// internal/agent/prompt.go と一字一句同じロジックを使用。推論バックエンドは
// UIから選択式:
//   - 'free'   - このサーバー自身のPOST /api/investigate。運営者が支払う
//                キーに対して実際のinternal/agentパイプラインを実行し、
//                サーバー側（cmd/server）でレート制限をかけるため、訪問者
//                は自分のキーを用意する必要がない。デフォルト。
//   - 'claude' - ユーザー自身のAPIキーでブラウザから直接Claude APIを呼ぶ
//                （runClaudeApi参照）。
//   - 'webllm' - WebLLM/WebGPUで小型モデルをブラウザ内に完全ローカル実行
//                （無料・サーバー不要だが、小型モデルは間違いが多くGPU
//                メモリ不足になることもある。runWebLLM参照）。

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
omitting the field. recommended_actions must always contain at least one
concrete next step, even if it is only to gather more evidence.

Write every natural-language field (summary, hypothesis descriptions,
evidence descriptions, recommended_actions, and suspicious_deploys
descriptions) in clear, professional Japanese, since the reader is a
Japanese-speaking on-call engineer. Do not translate the JSON field names.
Keep "assessed_severity" exactly as one of the English literals "critical",
"warning", or "info" - do not translate or localize that value. When an
evidence string quotes a specific log line, commit message/SHA, or metric
value verbatim from the context you were given, keep that quoted snippet
in its original form rather than translating it, even though the
surrounding sentence is in Japanese.`;

// スキーマはオブジェクトとして共有する。WebLLMのresponse_format.schemaは
// JSON文字列を要求するので、グラマー制約付きデコーディング（XGrammar）で
// この形に一致する妥当なJSONの生成を強制できる（プロンプトの指示だけに頼ると
// 小型モデルは「JSONのみで応答」を無視して散文を返すことがある）。Claude API
// のoutput_config.formatはオブジェクトそのものを要求し、structured outputs
// によって同じ保証が得られる。
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
  try {
    return JSON.parse(text);
  } catch (e) {
    // グラマー制約付きデコーディングが効かないモデル/バックエンド向けのフォールバック:
    // 最初と最後の波括弧で囲まれた範囲を抜き出して再度パースを試みる。
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw e;
    return JSON.parse(text.slice(start, end + 1));
  }
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
  title: '独自データを貼り付け',
  description: '自分のアラート・ログ・デプロイ・メトリクスをJSONで指定できます（internal/alert.Alert・internal/sourcesと同じフィールド名）。',
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

// 値からDateを返す。値が欠落・パース不能な場合はnullを返す——呼び出し側は
// 1つの不正/欠落タイムスタンプだけでペイロード全体を拒否せず、デフォルトに
// フォールバックする。
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

// エポック値の推定: 13桁の数値はミリ秒だが、構造化ロガーの多く（このコード
// の元になったサンプルも含む）は10桁のエポック秒を出力する。そのまま
// `new Date()`に渡すと1970年になってしまうため、1e12未満は秒とみなす。
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

// 多くの構造化ロガー（Datadog Forwarder、CloudWatchなど）はログ1行につき
// フラットなJSONオブジェクトを1つ出力する——{alert, logs, ...}という形には
// 包まれていない。貼り付けられたJSONに既知のトップレベルキーが1つも
// なければ、それをまさに「ログ1行」として扱う。ロガーがよく使うフィールド
// 名からtimestamp/level/service/messageを推測し、オブジェクト全体を
// JSON.stringifyしてログメッセージに含めることで、認識できなかった内容も
// 黙って捨てずにLLMへの証拠として残す。
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

// 貼り付けられたJSONをbuildScenarios()と同じ形状にパースする。
// これにより以降の処理（renderContext、buildUserMessageなど）は
// カスタムデータかどうかをこの関数の外で意識する必要がない。すべての
// フィールドは任意で、欠落・不正な場合は妥当なデフォルト値にフォール
// バックする（拒否しない）——「独自データを貼り付け」の狙いは手元にある
// JSONをそのまま試せることであり、厳密なスキーマへの適合を強制すること
// ではない。必須なのは有効なJSONであることとトップレベルがオブジェクト
// であることのみ。
function parseCustomData(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`JSONが不正です: ${e.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('トップレベルはJSONオブジェクトである必要があります。');
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
      title: a.title ? String(a.title) : '（タイトルなし）',
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

// 「調査を開始」に応答するバックエンド: 'free'（このサーバー自身のレート
// 制限付きClaudeプロキシ、キー不要）、'claude'（ユーザー自身のキーで本物の
// Anthropic APIを直接呼ぶ）、'webllm'（ブラウザ内で小型モデルを実行）。
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
  if (s.custom) {
    alertBox.innerHTML = `
      <p class="hint">任意のJSONオブジェクトを貼り付けられます — すべてのフィールドは任意で、欠落・不正な値は自動的にデフォルトへフォールバックするため、部分的なデータや形の違うデータでも動作します。最も詳細なレポートを得るには<code>alert</code>、<code>logs</code>、<code>deploys</code>、<code>metrics</code>、<code>sourceErrors</code>（<code>internal/alert.Alert</code>・<code>internal/sources</code>と同じフィールド名）を使ってください。これらのキーが1つも無い場合（構造化ロガーの生ログ1行をそのまま貼り付けた場合など）は、ログ1件として扱い、よくあるフィールド名からtimestamp/level/service/messageを推測します。タイムスタンプは<code>Date</code>でパースできる文字列なら何でも構いません（ISO 8601推奨）。</p>
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
  const s = activeScenario;
  if (s.custom) {
    const statusEl = document.getElementById('customDataStatus');
    try {
      Object.assign(s, parseCustomData(customInputValue));
    } catch (e) {
      if (statusEl) { statusEl.textContent = e.message; statusEl.classList.add('error-text'); }
      log('err', `カスタムデータエラー: ${e.message}`);
      return;
    }
    if (statusEl) {
      statusEl.classList.remove('error-text');
      statusEl.textContent = `パース成功: ${s.alert.service} — ${s.alert.title}`;
    }
  }
  fireBtn.disabled = true;
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
  updateInvestigateEnabled();
  log('ok', 'コンテキスト収集完了 — 調査を開始できます');
});

// --- バックエンド選択（サーバー無料枠 / 自分のキー / ブラウザ内WebLLM） ---

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
    aiStatus.textContent = 'Claude APIキーをこのブラウザに保存しました（api.anthropic.com以外には送信されません）。';
    log('ok', 'Claude APIキーを保存しました');
  } else {
    localStorage.removeItem(CLAUDE_KEY_STORAGE);
    aiStatus.textContent = 'Claude APIキーを削除しました。';
    log('warn', 'Claude APIキーを削除しました');
  }
  updateInvestigateEnabled();
});

if (!navigator.gpu) {
  loadModelBtn.disabled = true;
  loadModelBtn.title = 'WebGPU対応ブラウザが必要です（例：デスクトップ版Chrome/Edge）。';
}
setBackend('free');

// GPU性能が低い環境でも動くよう、最初から最も軽量なモデルを選択する。
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
  aiStatus.textContent = `${modelId} を読み込み中…`;
  webllmEngine = await webllm.CreateMLCEngine(modelId, {
    initProgressCallback: (report) => { aiStatus.textContent = report.text; },
  });
  aiStatus.textContent = `準備完了（${modelId}）。ブラウザ内でローカル実行中。`;
  return modelId;
}

// GPUメモリ不足によるdevice-lostはより軽量なモデルで再試行し、それ以上軽量なものがなければ諦める
async function loadModelWithFallback(startTier) {
  let tier = startTier;
  while (true) {
    try {
      return await loadModel(tier);
    } catch (e) {
      if (isDeviceLostError(e) && tier + 1 < PREFERRED_MODELS.length) {
        log('err', `${PREFERRED_MODELS[tier]}の読み込み中にGPUデバイスがリセットされました（メモリ不足の可能性）。より軽量なモデルに切り替えます…`);
        tier += 1;
        continue;
      }
      throw e;
    }
  }
}

loadModelBtn.addEventListener('click', async () => {
  loadModelBtn.disabled = true;
  aiStatus.textContent = 'WebLLMを読み込み中…';
  try {
    await loadModelWithFallback(0);
    updateInvestigateEnabled();
  } catch (e) {
    aiStatus.textContent = isDeviceLostError(e)
      ? 'GPUメモリ不足のためAIモデルを読み込めませんでした。他のタブ/アプリを閉じるか、ブラウザを再読み込みしてからもう一度お試しください。'
      : `AIモデルの読み込みに失敗しました: ${e.message}`;
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

// 本物のAnthropic Messages APIをユーザー自身のキーでブラウザから直接呼ぶ。
// anthropic-dangerous-direct-browser-accessが必須——これがないとAnthropicの
// CORSポリシーがブラウザからのリクエストを拒否する。キーはこのブラウザから
// api.anthropic.comへ直接送信されるのみ。
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

// このサーバー自身のPOST /api/investigate（cmd/server）を呼ぶ——キー不要。
// サーバーがキーを保持し、IPごと・1日ごとにレート制限する。実際の
// internal/agentパイプラインを実行し、パース済みのレポートを返す（
// internal/agent.Report参照）。他の2バックエンドと違い、この経路には
// JSONパース処理が存在しない。
async function runFreeApi(s) {
  const res = await fetch('/api/investigate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      alert: s.alert, logs: s.logs, deploys: s.deploys, metrics: s.metrics, sourceErrors: s.sourceErrors,
    }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ボディがJSONでなかった（404のHTMLページなど） */ }
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
  aiStatus.textContent = '調査中…';
  const s = activeScenario;
  const started = performance.now();
  log('ok', backend === 'free'
    ? 'Claude（無料枠・このサーバー経由）に調査を依頼中...'
    : backend === 'claude'
      ? 'Claude（claude-haiku-4-5）に調査を依頼中（internal/agent/prompt.goと同一のシステムプロンプト）...'
      : 'モデルに調査を依頼中（internal/agent/prompt.goと同一のシステムプロンプト）...');
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
        reportBox.innerHTML = `<div class="hint">モデルの応答をJSONとしてパースできませんでした。生の出力:</div><pre class="raw">${escapeHtml(raw)}</pre>`;
        aiStatus.textContent = `パース失敗（${elapsed}秒）— 下の生出力を参照してください。`;
        log('err', `モデル応答のJSONパースに失敗`);
        updateInvestigateEnabled();
        return;
      }
    }
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    renderReport(report);
    aiStatus.textContent = `${elapsed}秒でレポートを生成しました。`;
    log('ok', `調査完了（${elapsed}秒）`);
  } catch (e) {
    if (backend === 'webllm' && isDeviceLostError(e)) {
      if (modelTierIndex + 1 < PREFERRED_MODELS.length) {
        log('err', 'GPUデバイスがリセットされました（メモリ不足の可能性）。より軽量なモデルに切り替えて再試行します…');
        aiStatus.textContent = 'GPUメモリ不足のため、より軽量なモデルに切り替えています…';
        try {
          const modelId = await loadModelWithFallback(modelTierIndex + 1);
          log('ok', `${modelId} の準備完了。もう一度「調査を開始」を押してください。`);
        } catch (reloadErr) {
          aiStatus.textContent = `軽量モデルへの切り替えにも失敗しました: ${reloadErr.message}`;
          log('err', `再読み込み失敗: ${reloadErr.message}`);
          webllmEngine = null;
          loadModelBtn.disabled = false;
        }
      } else {
        aiStatus.textContent = 'GPUメモリ不足で調査に失敗しました。他のタブ/アプリを閉じてブラウザを再読み込みしてから、もう一度お試しください。';
        log('err', 'GPUデバイスロスト（これ以上軽量なモデルがありません）');
        webllmEngine = null;
        loadModelBtn.disabled = false;
      }
    } else {
      aiStatus.textContent = `調査に失敗しました: ${e.message}`;
      log('err', `調査に失敗: ${e.message}`);
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
    <ul>${actions || '<li class="hint">モデルは具体的な次のアクションを提案しませんでした — 上記の仮説を出発点として手動で調査してください。</li>'}</ul>
    <h3>疑わしいデプロイ</h3>
    <ul>${deploys}</ul>
  `;
}

renderScenarios();
renderAlert(activeScenario);
