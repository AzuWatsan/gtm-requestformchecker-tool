/**
 * GTM差分×指示書照合ツール - Google Apps Script v2
 * WebアプリURL経由でブラウザツールにデータを渡します
 * 機密情報（ログインID・パスワード・コンテナID）は自動除外
 * Claude APIキーはGASのスクリプトプロパティに保存（ブラウザに露出しない）
 *
 * ========================================
 * ★ 初期設定手順
 * ========================================
 * 1. Apps Script エディタ → プロジェクトの設定 → スクリプトプロパティに以下を追加:
 *      ANTHROPIC_API_KEY : sk-ant-xxxxxxxxxxxx
 *      TOOL_URL          : https://YOUR_NAME.github.io/gtm-diff-tool/
 *
 * 2. デプロイ → 新しいデプロイ → 種類: Webアプリ
 *      実行ユーザー        : 自分
 *      アクセス可能ユーザー : 組織内全員（または全員）
 *
 * 3. 発行されたWebアプリURLをHTMLの WEBAPP_URL に設定
 *
 * ⚠️ CORS について
 * GASはカスタムCORSヘッダーを付与できません。
 * 「アクセス可能ユーザー: 全員」設定でGitHub PagesからのGETは通りますが、
 * POSTのプリフライト（OPTIONS）が通らない場合があります。
 * その場合はPOSTをGETに変更するか、tokenをURLパラメータで渡す方式を使います。
 * ========================================
 */

// ========================================
// 設定（スクリプトプロパティから取得）
// ========================================
function getProps() {
  const props = PropertiesService.getScriptProperties();
  return {
    apiKey : props.getProperty('ANTHROPIC_API_KEY') || '',
    toolUrl: props.getProperty('TOOL_URL') || '',
  };
}

// ========================================
// 除外する機密列のキーワード
// ========================================
const EXCLUDE_KEYWORDS = [
  'ログインID', 'パスワード', 'コンテナID', 'ワークスペース名',
  'テク推管理者', 'Filter', 'Request URL', 'GTM内タグ名', 'GTM内トリガー名'
];

// ========================================
// スプレッドシートを開いた時にメニュー追加
// ========================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔍 GTM照合ツール')
    .addItem('照合ツールを開く', 'showSheetSelector')
    .addToUi();
}

// ========================================
// シート選択ダイアログを表示
// ========================================
function showSheetSelector() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allSheets = ss.getSheets().map(s => s.getName());
  const priority = ['タグ新規設定', 'タグ修正'];
  const sorted = [...priority.filter(n => allSheets.includes(n)), ...allSheets.filter(n => !priority.includes(n))];

  const html = HtmlService.createHtmlOutput(`
    <!DOCTYPE html>
    <html>
    <head>
      <base target="_top">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Helvetica Neue', sans-serif; padding: 20px; font-size: 14px; color: #1a1a1a; background: #fafaf8; }
        h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
        .sub { font-size: 12px; color: #888; margin-bottom: 16px; }
        label { display: block; font-size: 12px; color: #666; font-weight: 500; margin-bottom: 5px; }
        select { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; background: #fff; margin-bottom: 14px; }
        .check-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 13px; color: #444; }
        .btn { width: 100%; padding: 10px; background: #1D9E75; color: #fff; border: none; border-radius: 7px; font-size: 14px; font-weight: 600; cursor: pointer; }
        .btn:hover { background: #168a63; }
        .btn:disabled { opacity: .5; cursor: not-allowed; }
        .note { font-size: 11px; color: #aaa; margin-top: 12px; line-height: 1.6; }
        .loading { display: none; text-align: center; color: #888; font-size: 13px; margin-top: 8px; }
      </style>
    </head>
    <body>
      <h3>🔍 GTM照合ツール</h3>
      <p class="sub">照合するシートを選んでツールを開きます</p>

      <label>対象シート</label>
      <select id="sheet">
        ${sorted.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>

      <div class="check-row">
        <input type="checkbox" id="merge">
        <label for="merge" style="margin:0">「タグ修正」シートも合わせて照合する</label>
      </div>

      <button class="btn" id="btn" onclick="run()">照合ツールを開く →</button>
      <div class="loading" id="loading">⏳ データを準備中...</div>
      <p class="note">
        ※ 機密情報（ログインID・パスワード・コンテナID）は<br>
        　 自動的に除外されてツールに渡されます
      </p>

      <script>
        function run() {
          document.getElementById('btn').disabled = true;
          document.getElementById('loading').style.display = 'block';
          const sheet = document.getElementById('sheet').value;
          const merge = document.getElementById('merge').checked;
          google.script.run
            .withSuccessHandler(result => {
              window.open(result.url, '_blank');
              google.script.host.close();
            })
            .withFailureHandler(err => {
              alert('エラー: ' + err.message);
              document.getElementById('btn').disabled = false;
              document.getElementById('loading').style.display = 'none';
            })
            .prepareAndGetUrl(sheet, merge);
        }
      </script>
    </body>
    </html>
  `).setWidth(380).setHeight(300).setTitle('GTM照合ツール');

  SpreadsheetApp.getUi().showModalDialog(html, 'GTM照合ツール');
}

// ========================================
// タグデータを抽出してトークン保存 → ツールURLを返す
// ========================================
function prepareAndGetUrl(sheetName, merge) {
  const { toolUrl } = getProps();
  if (!toolUrl) throw new Error('スクリプトプロパティ TOOL_URL が未設定です');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let data = extractSafeData(ss, sheetName);

  if (merge && sheetName !== 'タグ修正') {
    try {
      const mergeData = extractSafeData(ss, 'タグ修正');
      data.rows = [...data.rows, ...mergeData.rows];
    } catch(e) { /* タグ修正シートがなければスキップ */ }
  }

  // トークン生成してスクリプトプロパティに一時保存
  const token = Utilities.getUuid();
  const payload = JSON.stringify({ ...data, createdAt: Date.now(), sheet: sheetName });
  PropertiesService.getScriptProperties().setProperty('token_' + token, payload);

  // ツールURL（GASのWebアプリURLもHTMLに渡す）
  const gasUrl = ScriptApp.getService().getUrl();
  const url = toolUrl + '?token=' + token + '&api=' + encodeURIComponent(gasUrl);
  return { url, rowCount: data.rows.length };
}

// ========================================
// 機密列を除外してデータ抽出
// ========================================
function extractSafeData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('シート「' + sheetName + '」が見つかりません');

  const all = sheet.getDataRange().getValues();

  // ヘッダー行を検索（「媒体名」を含む行）
  let headerIdx = -1;
  for (let i = 0; i < Math.min(all.length, 20); i++) {
    if (all[i].some(c => String(c).includes('媒体名'))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('「' + sheetName + '」でヘッダー行が見つかりません');

  const headers = all[headerIdx].map(h => String(h).replace(/^\*/, '').trim());

  // 除外列インデックスを特定
  const excludeSet = new Set();
  headers.forEach((h, i) => {
    if (EXCLUDE_KEYWORDS.some(kw => h.includes(kw))) excludeSet.add(i);
  });

  const safeHeaders = headers.filter((_, i) => !excludeSet.has(i));
  const nameIdx = headers.findIndex(h => h.includes('タグ名称'));

  const rows = [];
  for (let i = headerIdx + 1; i < all.length; i++) {
    const row = all[i];
    if (nameIdx >= 0 && !String(row[nameIdx]).trim()) continue;
    const safeRow = row.filter((_, idx) => !excludeSet.has(idx)).map(v => String(v).trim());
    if (safeRow.some(v => v)) rows.push(safeRow);
  }

  return { headers: safeHeaders, rows };
}

// ========================================
// WebアプリのGET：
//   ?token=xxx        → スプレッドシートデータを返す
//   ?action=dupcheck  → 重複チェック（Claude API呼び出し）
// ========================================
function doGet(e) {
  const action = e.parameter.action;

  // ── 重複チェック ──────────────────────────
  if (action === 'dupcheck') {
    return handleDupCheck(e.parameter.html || '');
  }

  // ── スプレッドシートデータ取得 ────────────
  const token = e.parameter.token;
  if (!token) return jsonOut({ error: 'token required' });

  const raw = PropertiesService.getScriptProperties().getProperty('token_' + token);
  if (!raw) return jsonOut({ error: 'token not found or expired' });

  PropertiesService.getScriptProperties().deleteProperty('token_' + token);
  return jsonOut(JSON.parse(raw));
}

// ========================================
// 重複チェック：Claude APIをGAS側で呼び出す
// ブラウザにAPIキーを渡さない
// ========================================
function handleDupCheck(tagHtml) {
  const { apiKey } = getProps();
  if (!apiKey) return jsonOut({ error: 'ANTHROPIC_API_KEY が未設定です' });
  if (!tagHtml.trim()) return jsonOut({ error: 'タグHTMLが空です' });

  const prompt = `以下のタグHTMLから媒体・種別を判定し重複チェック用のキー情報を抽出してください。JSONのみ返してください:
{"media":"媒体名","tag_type":"タグ種別","keys":{"キー名":"値"}}

【Yahoo Ads判定ルール】
ytagのtypeフィールドで種別を判定:
- type="yjad_retargeting" → {"media":"Yahoo_YDA","tag_type":"RTG","keys":{"yahoo_retargeting_id":"値"}}
- type="yjad_conversion"  → {"media":"Yahoo_YDA","tag_type":"CV","keys":{"yahoo_ydn_conv_label":"値"}}
- type="yss_conversion"   → {"media":"Yahoo_YSS","tag_type":"CV","keys":{"yahoo_conversion_id":"値","yahoo_conversion_label":"値"}}
- type="yss_retargeting"  → {"media":"Yahoo_YSS","tag_type":"RTG","keys":{"yahoo_ss_retargeting_id":"値"}}
- type="ycl_cookie"       → {"media":"Yahoo_YSS","tag_type":"SiteGeneral","keys":{}}

【その他媒体】
- Google CVタグ  → {"media":"Google","tag_type":"CV","keys":{"send_to":"AW-xxx/yyy","event":"conversion"}}
- Google Base    → {"media":"Google","tag_type":"Base","keys":{"config":"AW-xxx"}}
- Meta Base      → {"media":"Meta","tag_type":"Base","keys":{"pixel_id":"数値"}}
- Meta CV        → {"media":"Meta","tag_type":"CV","keys":{"pixel_id":"数値","event":"Purchase等"}}
- LINE Base      → {"media":"LINE","tag_type":"Base","keys":{"tagId":"uuid"}}
- LINE CV        → {"media":"LINE","tag_type":"CV","keys":{"tagId":"uuid","type":"Conversion等"}}
- TikTok         → {"media":"TikTok","tag_type":"Base","keys":{"pixelID":"値"}}
- logicad        → {"media":"logicad","tag_type":"CV","keys":{"smnAdvertiserId":"値"}}

タグHTML:
${tagHtml.substring(0, 2000)}`;

  try {
    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // 軽量・高速・安価
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true,
    });

    const data = JSON.parse(res.getContentText());
    if (data.error) return jsonOut({ error: data.error.message });

    const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);
    return jsonOut({ ok: true, result: parsed });

  } catch(e) {
    return jsonOut({ error: e.message });
  }
}

// ========================================
// ヘルパー：JSON出力
// ========================================
function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// OPTIONSプリフライト対応
// ========================================
function doOptions(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
