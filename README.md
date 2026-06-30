# GTM Diff Tool

GTMコンテナの差分比較・設置指示書（スプレッドシート）との照合・重複タグ検出を行うブラウザツールです。エンジニア不要で、GTMのJSONファイルとスプレッドシートのURLを渡すだけで使えます。

## できること

- **GTM差分比較**：2つのGTMコンテナJSON（エクスポートファイル）を比較し、タグ・トリガー・変数・組み込み変数の追加/削除/変更を一覧表示
- **指示書照合**：設置指示書（Googleスプレッドシート）の「タグ新規設定」「タグ修正」シートと差分を照合し、実装漏れ・想定外の変更を検出
- **重複チェック**：新規追加タグのID・ラベル・イベント名が既存タグと重複していないかをClaude APIで自動判定（Google／Meta／Yahoo（YDA・YSS）／TikTok／LINE／logicad対応）

## 構成

```
.
├── index.html       # ブラウザツール本体（GitHub Pagesで公開）
└── gas/
    └── main.gs       # スプレッドシート埋め込み用 Google Apps Script
```

データの流れはこうなっています。

```
スプレッドシート（GASボタン）
  → 機密列（ログインID・パスワード・コンテナID）を除外してタグ情報を抽出
  → ブラウザツール（index.html）にトークン付きURLで連携
       → GTM JSON 2ファイルをユーザーがアップロード
       → 差分比較・指示書照合
       → 重複チェック時のみ GAS Webアプリ経由で Claude API を呼び出し
            （APIキーはGAS側のスクリプトプロパティに保存、ブラウザには露出しない）
```

## セットアップ

### 1. ブラウザツールをGitHub Pagesで公開

```bash
git clone https://github.com/AzuWatsan/gtm-diff-tool.git
cd gtm-diff-tool
git push -u origin main
```

GitHubリポジトリの **Settings → Pages → Source: `main` / `root`** を選択して有効化してください。公開後のURLは次の形式になります。

```
https://AzuWatsan.github.io/gtm-diff-tool/
```

### 2. Google Apps Scriptをスプレッドシートに設定

1. 対象のスプレッドシートを開く
2. **拡張機能 → Apps Script**
3. `gas/main.gs` の中身を全てコピーしてエディタに貼り付け、保存
4. **プロジェクトの設定 → スクリプトプロパティ** に以下を追加

   | プロパティ名 | 値 |
   |---|---|
   | `ANTHROPIC_API_KEY` | Anthropicで発行したAPIキー |
   | `TOOL_URL` | 手順1で公開したGitHub PagesのURL |

5. **デプロイ → 新しいデプロイ → 種類: Webアプリ**
   - 実行するユーザー：自分
   - アクセスできるユーザー：組織内全員（社外公開する場合は「全員」）
6. デプロイ後に発行されるWebアプリURLは、手順4で設定した `TOOL_URL` と紐付いて自動的にツールへ渡されるため、別途控える必要はありません

7. スプレッドシートをリロードすると、メニューに **「🔍 GTM照合ツール」** が表示されます

## 使い方

1. スプレッドシートのメニュー **「🔍 GTM照合ツール」→「照合ツールを開く」**
2. 対象シート（タグ新規設定／タグ修正／両方）を選択
3. ブラウザツールが新しいタブで開き、指示書データが読み込まれた状態になる
4. GTMの2つのコンテナJSON（比較元・比較対象）をドラッグ&ドロップ
   - GTM管理画面 → 管理 → コンテナをエクスポート で取得できます
5. 列の対応（タグ名称・発火条件・タグ記述）を確認
6. **「照合する」** をクリック

### 結果の見方

| 表示 | 意味 |
|---|---|
| 🔴 実装漏れ | 指示書にあるがGTM差分に存在しない |
| 🟡 想定外の変更 | GTM差分にあるが指示書に記載がない |
| 🔁 重複疑い | 新規追加タグのID/ラベルが既存タグと一致 |
| 🟢 照合OK | 指示書とGTM差分の両方に存在 |

## セキュリティについて

- スプレッドシートの**ログインID・パスワード・コンテナID等の機密列は自動的に除外**され、ツールには渡りません（除外対象は `gas/main.gs` 内の `EXCLUDE_KEYWORDS` で調整可能）
- Claude APIキーは**GAS側のスクリプトプロパティにのみ保存**され、ブラウザ（HTMLのソースコード）には一切含まれません
- GTM JSONファイルの内容はブラウザ内処理のみで、外部には送信されません（重複チェック時に該当タグのHTML記述のみGAS経由でClaude APIに送られます）

## 対応媒体（重複チェック）

| 媒体 | 判定キー |
|---|---|
| Google | `send_to`, `event` |
| Meta | `pixel_id`, `event` |
| Yahoo (YDA) | `yahoo_retargeting_id` / `yahoo_ydn_conv_label` |
| Yahoo (YSS) | `yahoo_conversion_id` + `yahoo_conversion_label` / `yahoo_ss_retargeting_id` |
| TikTok | `pixelID` |
| LINE | `tagId`, `type` |
| logicad | `smnAdvertiserId` |

## ライセンス

社内利用を想定したツールです。
