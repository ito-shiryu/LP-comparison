const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { extractZip } = require('./src/zipHandler');
const { takeScreenshot } = require('./src/screenshotter');
const { runDiff, createCombinedImage } = require('./src/differ');

const app = express();
const PORT = 3000;

// ディレクトリ確保
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const EXTRACTED_DIR = path.join(__dirname, 'extracted');
const OUTPUT_DIR = path.join(__dirname, 'output');
[UPLOADS_DIR, EXTRACTED_DIR, OUTPUT_DIR].forEach(d =>
  fs.mkdirSync(d, { recursive: true })
);

// 静的ファイル配信
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(OUTPUT_DIR));
app.use('/local-lp', express.static(EXTRACTED_DIR));

// multer 設定
const upload = multer({ dest: UPLOADS_DIR });

// 進捗状態（シングルユーザー想定）
let currentStatus = 'idle';

app.get('/api/status', (req, res) => {
  res.json({ status: currentStatus });
});

app.post('/api/compare', upload.single('zip'), async (req, res) => {
  const setStatus = (s) => { currentStatus = s; };

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URLが指定されていません' });
    if (!req.file) return res.status(400).json({ error: 'ZIPファイルがありません' });

    // Step 1: ZIP展開
    setStatus('ZIPを展開中...');
    extractZip(req.file.path, EXTRACTED_DIR);

    // existingMobile: 既存LPをSPサイズ（390px）で撮影するか
    const existingMobile = req.body.existingMobile === 'true';

    // Step 2: 既存LPスクリーンショット（SP or PC）
    setStatus(existingMobile
      ? '既存LP（SP表示）をスクリーンショット中...'
      : '既存LP（PC表示）をスクリーンショット中...');
    const existingPath = path.join(OUTPUT_DIR, 'existing.png');
    const { textBlocks: existingBlocks } = await takeScreenshot(url, existingPath, { mobile: existingMobile });

    // Step 3: 変更後LPスクリーンショット（常にPC）
    setStatus('変更後LP（PC表示）をスクリーンショット中...');
    const modifiedPath = path.join(OUTPUT_DIR, 'modified.png');
    const { textBlocks: modifiedBlocks } = await takeScreenshot(`http://localhost:${PORT}/local-lp/`, modifiedPath, { mobile: false });

    // Step 4: テキスト差分検出・描画
    setStatus('テキスト差分を検出中...');
    const diffPath = path.join(OUTPUT_DIR, 'diff.png');
    const { diffCount, boxCount } = await runDiff(existingPath, modifiedPath, diffPath, existingBlocks, modifiedBlocks);

    // Step 5: 3枚合成画像を生成
    setStatus('合成画像を生成中...');
    const combinedPath = path.join(OUTPUT_DIR, 'combined.png');
    await createCombinedImage(existingPath, modifiedPath, diffPath, combinedPath);

    setStatus('完了');
    res.json({
      existing: '/output/existing.png',
      modified: '/output/modified.png',
      diff: '/output/diff.png',
      combined: '/output/combined.png',
      diffCount,
      boxCount,
    });
  } catch (err) {
    console.error('[ERROR]', err);
    setStatus('エラー: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ LP Diff Tool 起動: http://localhost:${PORT}`);
});
