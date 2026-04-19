const Jimp = require('jimp');

// -----------------------------------------------------------------------
// テキスト正規化
// -----------------------------------------------------------------------

/**
 * テキストを正規化して比較用の文字列を返す。
 * - 全角スペース・連続空白を半角スペース1つに
 * - 大文字→小文字
 * - 前後の空白を除去
 */
function normalize(text) {
  return text
    .replace(/[　\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

// -----------------------------------------------------------------------
// テキスト差分の計算
// -----------------------------------------------------------------------

/**
 * 2ページのテキストブロックを比較して差分ブロックを返す。
 *
 * @param {Array<{text,x,y,w,h}>} existingBlocks - 既存LPのテキストブロック
 * @param {Array<{text,x,y,w,h}>} modifiedBlocks - 変更後LPのテキストブロック
 * @returns {{
 *   changedInExisting: Array<{text,x,y,w,h}>,  // 既存LPにあって変更後にない（変更・削除）
 *   changedInModified: Array<{text,x,y,w,h}>,  // 変更後LPにあって既存にない（追加・変更）
 * }}
 */
function computeTextDiff(existingBlocks, modifiedBlocks) {
  const modifiedSet = new Set(modifiedBlocks.map((b) => normalize(b.text)));
  const existingSet = new Set(existingBlocks.map((b) => normalize(b.text)));

  const changedInExisting = existingBlocks.filter(
    (b) => !modifiedSet.has(normalize(b.text))
  );
  const changedInModified = modifiedBlocks.filter(
    (b) => !existingSet.has(normalize(b.text))
  );

  return { changedInExisting, changedInModified };
}

// -----------------------------------------------------------------------
// Jimp で赤枠を描画
// -----------------------------------------------------------------------

/**
 * 画像ファイルに赤枠ボックスを描画して保存する。
 *
 * @param {string} imagePath   - 入力画像パス
 * @param {Array<{x,y,w,h}>} boxes - 描画するボックス
 * @param {string} outputPath  - 出力画像パス
 * @param {number} color       - Jimp カラー (RGBA 32bit)
 */
async function drawBoxes(imagePath, boxes, outputPath, color = 0xff0000ff) {
  if (boxes.length === 0) {
    // 差分なし → 元画像をそのままコピー
    const img = await Jimp.read(imagePath);
    await img.writeAsync(outputPath);
    return;
  }

  const image = await Jimp.read(imagePath);
  const imgW  = image.getWidth();
  const imgH  = image.getHeight();
  const THICKNESS = 3;

  for (const box of boxes) {
    // ボックスに少しパディングを加えて視認しやすくする
    const PAD = 4;
    const bx = Math.max(0, box.x - PAD);
    const by = Math.max(0, box.y - PAD);
    const bw = Math.min(imgW - bx, box.w + PAD * 2);
    const bh = Math.min(imgH - by, box.h + PAD * 2);

    for (let t = 0; t < THICKNESS; t++) {
      // 上辺
      for (let x = bx; x < bx + bw && x < imgW; x++) {
        if (by + t < imgH) image.setPixelColor(color, x, by + t);
      }
      // 下辺
      for (let x = bx; x < bx + bw && x < imgW; x++) {
        const row = by + bh - 1 - t;
        if (row >= 0 && row < imgH) image.setPixelColor(color, x, row);
      }
      // 左辺
      for (let y = by; y < by + bh && y < imgH; y++) {
        if (bx + t < imgW) image.setPixelColor(color, bx + t, y);
      }
      // 右辺
      for (let y = by; y < by + bh && y < imgH; y++) {
        const col = bx + bw - 1 - t;
        if (col >= 0 && col < imgW) image.setPixelColor(color, col, y);
      }
    }
  }

  await image.writeAsync(outputPath);
}

// -----------------------------------------------------------------------
// メイン処理
// -----------------------------------------------------------------------

/**
 * テキストブロックを比較して差分を既存LP画像に赤枠で描画する。
 *
 * @param {string} existingImagePath - 既存LPのスクリーンショット
 * @param {string} modifiedImagePath - 変更後LPのスクリーンショット（表示用）
 * @param {string} diffOutputPath   - 差分画像の出力先
 * @param {Array}  existingBlocks   - 既存LPのテキストブロック
 * @param {Array}  modifiedBlocks   - 変更後LPのテキストブロック
 * @returns {{ diffCount: number, boxCount: number }}
 */
async function runDiff(
  existingImagePath,
  modifiedImagePath,
  diffOutputPath,
  existingBlocks,
  modifiedBlocks
) {
  const { changedInExisting, changedInModified } = computeTextDiff(
    existingBlocks,
    modifiedBlocks
  );

  // 差分テキスト一覧をコンソールに出力（デバッグ用）
  if (changedInExisting.length > 0) {
    console.log('[DIFF] 既存LPにあって変更後にないテキスト:');
    changedInExisting.forEach((b) => console.log('  -', b.text));
  }
  if (changedInModified.length > 0) {
    console.log('[DIFF] 変更後LPにあって既存にないテキスト:');
    changedInModified.forEach((b) => console.log('  +', b.text));
  }

  // 既存LP画像に赤枠（変更・削除された箇所）を描画
  await drawBoxes(existingImagePath, changedInExisting, diffOutputPath, 0xff0000ff);

  return {
    diffCount: changedInExisting.length + changedInModified.length,
    boxCount:  changedInExisting.length,
  };
}

// -----------------------------------------------------------------------
// 3枚合成画像の生成
// -----------------------------------------------------------------------

const PANEL_WIDTH   = 600;  // 各パネルの統一幅（縮小後）
const HEADER_HEIGHT = 12;   // 色帯の高さ（テキストなし・font依存なし）
const GAP           = 12;   // パネル間の余白
const BG_COLOR      = 0xf0f0f0ff;

// 上部の色帯: 青=既存LP / 緑=変更後LP / 赤=差分
const HEADER_COLORS = [0x4a90d9ff, 0x27ae60ff, 0xe74c3cff];

/**
 * 3枚のスクリーンショットを横並びに合成して1枚の画像を生成する。
 * font依存を持たせないよう、ラベルは色帯のみで表現する。
 *
 * @param {string} existingPath
 * @param {string} modifiedPath
 * @param {string} diffPath
 * @param {string} outputPath
 */
async function createCombinedImage(existingPath, modifiedPath, diffPath, outputPath) {
  const paths  = [existingPath, modifiedPath, diffPath];
  const images = await Promise.all(paths.map((p) => Jimp.read(p)));

  // 各パネルを PANEL_WIDTH に縮小（アスペクト比維持）
  const panels = images.map((img) => {
    const scale = PANEL_WIDTH / img.getWidth();
    return img.clone().resize(PANEL_WIDTH, Math.round(img.getHeight() * scale));
  });

  const maxPanelH = Math.max(...panels.map((p) => p.getHeight()));
  const totalW = GAP + (PANEL_WIDTH + GAP) * 3;
  const totalH = GAP + (HEADER_HEIGHT + GAP + maxPanelH + GAP);

  const canvas = new Jimp(totalW, totalH, BG_COLOR);

  for (let i = 0; i < 3; i++) {
    const panelX = GAP + i * (PANEL_WIDTH + GAP);

    // 色帯ヘッダー（フォント不使用）
    const header = new Jimp(PANEL_WIDTH, HEADER_HEIGHT, HEADER_COLORS[i]);
    canvas.composite(header, panelX, GAP);

    // パネル本体
    canvas.composite(panels[i], panelX, GAP + HEADER_HEIGHT + GAP);
  }

  await canvas.writeAsync(outputPath);
}

module.exports = { runDiff, createCombinedImage };
