const formPanel     = document.getElementById('form-panel');
const progressPanel = document.getElementById('progress-panel');
const progressMsg   = document.getElementById('progress-msg');
const errorPanel    = document.getElementById('error-panel');
const errorMsg      = document.getElementById('error-msg');
const resultsPanel  = document.getElementById('results-panel');
const diffSummary   = document.getElementById('diff-summary');

const urlInput  = document.getElementById('url-input');
const zipInput  = document.getElementById('zip-input');
const compareBtn = document.getElementById('compare-btn');
const retryBtn   = document.getElementById('retry-btn');
const resetBtn   = document.getElementById('reset-btn');

const imgExisting = document.getElementById('img-existing');
const imgModified = document.getElementById('img-modified');
const imgDiff     = document.getElementById('img-diff');
const linkExisting      = document.getElementById('link-existing');
const linkModified      = document.getElementById('link-modified');
const linkDiff          = document.getElementById('link-diff');
const downloadCombined = document.getElementById('download-combined');

// ダウンロードボタン: fetch→blob→ObjectURL で確実に保存させる
// (<a download> をJS経由で href 書き換えするとブラウザが拒否する場合があるため)
downloadCombined.addEventListener('click', async (e) => {
  e.preventDefault();
  const href = downloadCombined.dataset.src;
  if (!href) return;
  try {
    downloadCombined.textContent = '⏳ 準備中...';
    const res = await fetch(href);
    if (!res.ok) throw new Error('ファイルの取得に失敗しました');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'lp-diff-combined.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('ダウンロードエラー: ' + err.message);
  } finally {
    downloadCombined.textContent = '⬇ 3枚まとめて保存';
  }
});

// 進捗をポーリングで取得
let statusPoller = null;
function startPolling() {
  statusPoller = setInterval(async () => {
    try {
      const res = await fetch('/api/status');
      const { status } = await res.json();
      if (status && status !== 'idle') {
        progressMsg.textContent = status;
      }
    } catch (_) {}
  }, 800);
}
function stopPolling() {
  if (statusPoller) { clearInterval(statusPoller); statusPoller = null; }
}

// 比較実行
compareBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  const file = zipInput.files[0];

  if (!url) { alert('既存LPのURLを入力してください'); return; }
  if (!file) { alert('変更後LPのZIPファイルを選択してください'); return; }

  showProgress();
  startPolling();

  // SP/PC ラジオボタンの値を取得
  const existingMobile = document.querySelector('input[name="existingViewport"]:checked').value === 'sp';

  try {
    const formData = new FormData();
    formData.append('url', url);
    formData.append('zip', file);
    formData.append('existingMobile', existingMobile);

    const res = await fetch('/api/compare', { method: 'POST', body: formData });
    const data = await res.json();

    stopPolling();

    if (!res.ok) {
      showError(data.error || '不明なエラーが発生しました');
      return;
    }

    showResults(data);
  } catch (err) {
    stopPolling();
    showError('通信エラー: ' + err.message);
  }
});

retryBtn.addEventListener('click', showForm);
resetBtn.addEventListener('click', showForm);

function showForm() {
  formPanel.classList.remove('hidden');
  progressPanel.classList.add('hidden');
  errorPanel.classList.add('hidden');
  resultsPanel.classList.add('hidden');
}

function showProgress() {
  formPanel.classList.add('hidden');
  progressPanel.classList.remove('hidden');
  errorPanel.classList.add('hidden');
  resultsPanel.classList.add('hidden');
  progressMsg.textContent = '処理を開始中...';
}

function showError(msg) {
  formPanel.classList.add('hidden');
  progressPanel.classList.add('hidden');
  errorPanel.classList.remove('hidden');
  resultsPanel.classList.add('hidden');
  errorMsg.textContent = msg;
}

function showResults(data) {
  formPanel.classList.add('hidden');
  progressPanel.classList.add('hidden');
  errorPanel.classList.add('hidden');
  resultsPanel.classList.remove('hidden');

  // キャッシュバスト
  const t = '?t=' + Date.now();
  const setSrc = (img, link, src) => {
    img.src = src + t;
    link.href = src + t;
  };

  setSrc(imgExisting, linkExisting, data.existing);
  setSrc(imgModified, linkModified, data.modified);
  setSrc(imgDiff,     linkDiff,     data.diff);
  downloadCombined.dataset.src = data.combined + t;

  if (data.diffCount === 0) {
    diffSummary.textContent = '差分なし — テキスト内容は同一です';
    diffSummary.style.color = '#007700';
  } else {
    diffSummary.textContent =
      `テキスト差分: ${data.boxCount} 箇所（既存LP側に赤枠で表示）`;
    diffSummary.style.color = '#cc0000';
  }
}
