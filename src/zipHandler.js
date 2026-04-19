const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

/**
 * ZIPファイルを targetDir に展開する。
 * ZIPが単一フォルダを含む場合（例: my-lp/index.html）はフラット化して
 * targetDir/index.html になるよう正規化する。
 */
function extractZip(zipFilePath, targetDir) {
  // 前回の展開を削除
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const zip = new AdmZip(zipFilePath);
  zip.extractAllTo(targetDir, true);

  // 単一フォルダ構成をフラット化
  const entries = fs.readdirSync(targetDir);
  if (entries.length === 1) {
    const single = path.join(targetDir, entries[0]);
    if (fs.statSync(single).isDirectory()) {
      const inner = fs.readdirSync(single);
      for (const f of inner) {
        fs.renameSync(path.join(single, f), path.join(targetDir, f));
      }
      fs.rmdirSync(single);
    }
  }

  // index.html の存在確認
  const indexPath = path.join(targetDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      'ZIPにindex.htmlが見つかりません。ZIPの構成を確認してください。\n' +
      '期待する構成: index.html / css/ / js/ / img/ / fonts/'
    );
  }
}

module.exports = { extractZip };
