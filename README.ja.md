# incident-agent

LLMを活用したインシデント調査エージェント。アラートが発火すると、直近のログ・
デプロイ履歴・メトリクスを収集し、それらをClaudeに渡して、オンコール担当者向け
の構造化された根本原因レポートを — 人間がダッシュボードを開くよりも早く、数秒
で — 生成する。

これは、私がZeroboard Inc.で構築・運用していたシステム(Claudeによる自動バグ
調査・アラート分析で、診断までの平均時間を約50%削減)を一般化したもので、
外部依存のないスタンドアロンのOSSツールとしてゼロから書き直したものである。

**[ライブデモ](https://incident-agent-demo.onrender.com/ja)** — 用意された
インシデントを発火させ、ブラウザ内で調査が進む様子を見ることができる
（無料のブラウザ内小型モデル、または自分のAPIキーで本物のClaude APIのどちらか
を選択可能）。
(English: <https://incident-agent-demo.onrender.com/>)

```
incident-agent/
├── internal/claude    最小限のAnthropic Messages APIクライアント(SDK不使用)
├── internal/ollama    ローカルOllama chat APIクライアント(無料・APIキー不要)
├── internal/alert     正規化されたアラート形式(ソースに依存しない)
├── internal/sources   差し替え可能なログ / デプロイ / メトリクスプロバイダ
├── internal/agent     オーケストレーション: コンテキスト収集 → プロンプト → レポート解析
├── internal/notify    Slack Webhook / コンソールへのレポート配信
└── cmd/investigator   CLI: 単発実行の `investigate` + Webhookの `serve` モード
```

## クイックスタート

```bash
go build -o investigator ./cmd/investigator
export ANTHROPIC_API_KEY=sk-ant-...

# 単発実行: 今すぐ特定のインシデントを調査する
./investigator investigate \
  -service checkout -title "High 5xx error rate" \
  -message "Error rate exceeded 5% for 3 minutes" -severity critical \
  -logs ./testdata/sample.log \
  -github-owner myorg -github-repo myrepo

# サーバーモード: 監視ツールのWebhookを /alert に向ける
./investigator serve -addr :8080 \
  -logs /var/log/app/checkout.ndjson \
  -github-owner myorg -github-repo myrepo \
  -slack-webhook https://hooks.slack.com/services/...
```

### Ollamaで無料実行する(APIキー不要・課金なし)

Anthropic APIは従量課金制であり、これ自体を本プロジェクト側で無料にすること
はできない(Anthropicの有料サービスであるため)。ただし `-provider ollama`
を指定すると、推論部分を[Ollama](https://ollama.com)で動かすローカルモデル
に切り替えられ、ツール全体を無料で実行できる。

```bash
brew install ollama        # または https://ollama.com/download を参照
ollama serve &              # :11434 でローカルサーバーが起動する
ollama pull llama3.1        # 好きなローカルモデルでよい(大きいほど精度は上がる)

go build -o investigator ./cmd/investigator
./investigator investigate -provider ollama -model llama3.1 \
  -service checkout -title "High 5xx error rate" \
  -message "Error rate exceeded 5% for 3 minutes" -severity critical \
  -logs ./testdata/sample.log \
  -github-owner myorg -github-repo myrepo
```

このモードでは `ANTHROPIC_API_KEY` は不要。`ANTHROPIC_API_KEY` が未設定の
場合、`-provider` は自動的に `ollama` にフォールバックする。`-model` でロー
カルにpull済みのモデルを指定でき(デフォルトは `llama3.1`)、サーバーアドレ
スがデフォルトの `http://localhost:11434` と異なる場合は `OLLAMA_HOST` で
上書きできる。レポートの品質はローカルモデルの推論能力に依存し、この種の構
造化分析タスクでは一般にClaudeより弱くなる(特に小さいモデルサイズでは顕
著)。

このプロジェクトの他の部分 — GitHubのデプロイ相関、Slack Webhook通知、ファ
イルベースのログソース — は元々課金されるAPI呼び出しを行っていない。課金対
象だったのはLLM呼び出しのみである。

Webhookを発火できるアラートシステム(Datadog、Alertmanager、SNS→Lambda経由の
CloudWatch Alarms、PagerDutyなど)であれば、`internal/alert.Alert` に一致する
JSONボディを `POST /alert` に送るだけで連携できる。ペイロード形式が異なる場合
は、10行程度のアダプタを書けばよい(`cmd/investigator/main.go` 参照)。

## テストの実行

```bash
go test ./... -v
go test ./... -race
```

すべてのパッケージは、実際のネットワークアクセスやAPIキーなしでテストされる。
`internal/claude` と `internal/sources/github_deploys.go` は `httptest` の
モックサーバーに対してテストされ、`internal/agent` はフェイクの
`ClaudeClient` とフェイクのソースを使ってテストされる。これにより、プロンプト
の組み立てや部分的な失敗のハンドリングが決定的に検証される。

## 設計上の判断

**コンテキスト収集は部分的な失敗を許容する。** ログソースがタイムアウトしたり
GitHubがレート制限をかけたりしても、調査は続行される — 欠落はモデルに明示的に
伝えられ(「これらの欠落を踏まえて確信度をより控えめにすること」)、ツール全体
がレポート生成を拒否することはない。実際のインシデント対応中は、一つの依存先
の不調によって永遠に届かない完璧なレポートよりも、即座に届く劣化したレポート
の方がはるかに有用である。

**エージェントは調査するのみで、行動はしない。** モデルの出力から実際の復旧
操作(自動ロールバック、自動スケーリング、自動再起動など)が実行されるコード
パスは存在しない。システムプロンプトは、何かを修正・ロールバックしたと主張し
ないようモデルに明示的に指示している。これは機能の欠落ではなく、意図的なスコ
ープの境界線である。LLM自身の根本原因の推測に基づいて本番環境への直接的な書き
込み権限を与えることは、このプロジェクトとは全く別の(そしてはるかにリスクの
高い)システムになる。あらゆる操作において人間が介在し続ける。

**構造化されたJSON出力を厳密にパースする。** システムプロンプトは正確なJSON
形式を指定しており、`parseModelResponse` はその周りにMarkdownのコードフェンス
が付くというよくある逸脱には対応するが、それ以外の不正な形式のレスポンスは
(生のテキストを添えて)エラーとして表面化させる。無言で推測することはしない。
形式が誤った「insight」がSlackフォーマッタで誤表示されたりクラッシュしたりす
るくらいなら、目に見えるパース失敗の方がましである。

**デプロイの相関づけは、デプロイツール連携ではなくGitHubコミットによる。**
マージ時にデプロイを行うトランクベース開発を行うチーム — 著者自身のチームの
モデルでもある — にとって、`main` への直近のコミットは「このアラートが発火す
る直前に何が変わったか」を示す、真に有用で強力なプロキシであり、パブリックリ
ポジトリに対しては認証情報を一切必要としない。`DeploySource` はインターフェー
スなので、実際のデプロイパイプラインを持つチーム(例えばZeroboardはパブリック
リポジトリではないため、Datadog Deployment Tracking、Argo CD、Spinnakerなど)
は、エージェント側に手を加えることなく同じインターフェースを実装できる。

**サーバーモードでは、アラートは非同期に調査される。** Webhookハンドラはミリ
秒単位でACKを返し、(数秒かかりネットワークに依存する)調査処理はgoroutine内
で実行される。これにより、アラートシステム側のWebhookタイムアウトによる再送信
を回避できる — 再送信は同一アラートに対する重複調査を引き起こしてしまう。

**依存関係ゼロ。** 姉妹プロジェクトである `raftkv` と同様、Goの標準ライブラリ
のみを使用している — Anthropic SDKもSlack SDKも使わない。このくらいの規模の
プロジェクトであれば、他所に隠れたリトライ/認証/パース処理を持つ依存パッケー
ジよりも、150行程度の自前HTTPクライアントの方が端から端まで監査しやすい。

## 既知の制限 / ロードマップ

- **読み取りはキャッシュされない** — 同一インシデントに対する重複アラートが
  連発すると、それぞれ別個の調査がトリガーされる。`(service, alert title)`
  をキーとした重複排除ウィンドウが自然な次の一手となる。
- **フィードバックループがない** — エンジニアがレポートを「正しい」「誤り」
  とマークする仕組みが未実装であり、確信度スコアを長期的に額面通り信頼できる
  ようにする前に必要な機能である。
- **メトリクスソースは静的/シード可能なスタブ** — 実際のDatadog/CloudWatch/
  Prometheusクライアントは `MetricSource` を実装するだけで差し替え可能だが、
  クラウドの認証情報なしでもOSSプロジェクトとして動作させられるよう、本リポ
  ジトリには含めていない。
- **調査間の会話メモリがない** — 各アラートは独立して調査される。「今週3件目
  のcheckoutインシデントである」といった相関づけは未実装。
