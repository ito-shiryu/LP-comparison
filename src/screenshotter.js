const { chromium } = require('playwright');
const Jimp = require('jimp');

// CDP の Page.captureScreenshot は ~16,384px を超えるとクラッシュするため上限を設ける
const SAFE_MAX_HEIGHT = 8000;
const SECTION_HEIGHT  = 3000;

/**
 * 指定URLのフルページスクリーンショットを撮影し、テキストブロック情報も返す。
 *
 * @param {string} url
 * @param {string} outputPath
 * @param {{ mobile?: boolean }} options  mobile=true で SP (390px) エミュレーション
 * @returns {{ textBlocks: Array<{text,x,y,w,h}> }}
 */
async function takeScreenshot(url, outputPath, { mobile = false } = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    // --- コンテキスト生成 ---
    // mobile=true のときは iPhone UA + タッチ + 390px 幅
    // deviceScaleFactor は 1 に固定して座標のズレを防ぐ
    const context = await browser.newContext(
      mobile
        ? {
            viewport: { width: 390, height: 844 },
            userAgent:
              'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) ' +
              'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            deviceScaleFactor: 1,
            isMobile: true,
            hasTouch: true,
          }
        : {
            viewport: { width: 1440, height: 900 },
            deviceScaleFactor: 1,
          }
    );

    const page = await context.newPage();

    // --- ページ読み込み ---
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    // --- 遅延ロード画像を全て読み込む ---
    // (1) ゆっくりスクロールして IntersectionObserver を発火させる
    await autoScroll(page);
    // (2) スクロール後に発生したネットワークが落ち着くまで待つ
    await page.waitForLoadState('networkidle').catch(() => {});
    // (3) <img> が全て loaded になるまで待つ
    await waitForImages(page);
    await page.waitForTimeout(800);

    // --- ページ全体の寸法を取得 ---
    const { pageW, pageH } = await page.evaluate(() => ({
      pageW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      pageH: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    }));

    // --- テキストブロック抽出 ---
    // ビューポートをページ全体に合わせてから取得することで
    // getBoundingClientRect が全要素で正しい絶対座標を返す
    const viewportH = Math.min(pageH, SAFE_MAX_HEIGHT);
    await page.setViewportSize({ width: pageW, height: viewportH });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    const textBlocks = await extractTextBlocks(page, pageH);

    // --- スクリーンショット撮影 ---
    if (pageH <= SAFE_MAX_HEIGHT) {
      await page.setViewportSize({ width: pageW, height: pageH });
      await page.waitForTimeout(300);
      await page.screenshot({ path: outputPath });
    } else {
      // ページ高が上限超え → セクション分割してつなぎ合わせ
      await stitchedScreenshot(page, pageW, pageH, outputPath);
    }

    return { textBlocks };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// ヘルパー関数
// ---------------------------------------------------------------------------

/**
 * ページ最下部までゆっくりスクロールして遅延ロード要素を展開し、先頭に戻る
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const STEP     = 400;
      const INTERVAL = 120;
      let scrolled   = 0;

      const getScrollHeight = () =>
        Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        );

      const timer = setInterval(() => {
        window.scrollBy(0, STEP);
        scrolled += STEP;

        if (scrolled >= getScrollHeight()) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, INTERVAL);
    });
  });
}

/**
 * ページ内の全 <img> が読み込み完了するまで待つ
 */
async function waitForImages(page) {
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('img')];
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener('load', resolve);
              img.addEventListener('error', resolve); // 失敗してもブロックしない
            })
      )
    );
  });
}

/**
 * DOM からテキストブロックを抽出して絶対座標付きで返す。
 * ビューポート高 = ページ高 の状態（scrollY=0）で呼ぶ前提。
 *
 * @param {import('playwright').Page} page
 * @param {number} pageH - ページ総高（座標フィルタ用）
 */
async function extractTextBlocks(page, pageH) {
  return await page.evaluate((maxH) => {
    const blocks = [];
    const seen   = new Set();

    // テキストを持ちうる意味のある要素に絞る
    const TAGS = ['h1','h2','h3','h4','h5','h6','p','li','a','span',
                  'td','th','dt','dd','button','label','strong','em','small'];

    for (const tag of TAGS) {
      for (const el of document.querySelectorAll(tag)) {
        // 直接の TextNode のみ結合（子要素のテキストは子要素側で拾う）
        const text = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent.trim())
          .filter(Boolean)
          .join(' ')
          .trim();

        if (text.length < 2) continue;

        // 同じテキスト×座標の重複を除去
        const rect   = el.getBoundingClientRect();
        const scrollX = window.pageXOffset;
        const scrollY = window.pageYOffset;
        const x = Math.round(rect.left + scrollX);
        const y = Math.round(rect.top  + scrollY);
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);

        if (w <= 0 || h <= 0) continue;
        if (y > maxH) continue; // ページ範囲外は除外

        const key = `${text}|${x}|${y}`;
        if (seen.has(key)) continue;
        seen.add(key);

        blocks.push({ text, x, y, w, h });
      }
    }
    return blocks;
  }, pageH);
}

/**
 * ページを SECTION_HEIGHT ごとに分割撮影し Jimp でつなぎ合わせて保存する
 */
async function stitchedScreenshot(page, width, totalHeight, outputPath) {
  // 先に全スクロールで遅延コンテンツを読み込み済みのため、
  // ここでは粛々とセクションを撮影するだけ
  const sections = [];
  let y = 0;

  while (y < totalHeight) {
    const sectionH = Math.min(SECTION_HEIGHT, totalHeight - y);
    await page.setViewportSize({ width, height: sectionH });
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
    await page.waitForTimeout(500); // 各セクションで描画を待つ
    await waitForImages(page);

    const buffer = await page.screenshot({
      clip: { x: 0, y: 0, width, height: sectionH },
    });
    sections.push({ buffer, offsetY: y, height: sectionH });
    y += sectionH;
  }

  // Jimp でつなぎ合わせ
  const canvas = new Jimp(width, totalHeight, 0xffffffff);
  for (const s of sections) {
    const img = await Jimp.read(s.buffer);
    canvas.composite(img, 0, s.offsetY);
  }
  await canvas.writeAsync(outputPath);
}

module.exports = { takeScreenshot };
