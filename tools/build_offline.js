// 產生「真正的單一檔案」離線版:node tools/build_offline.js [輸出路徑]
// 把 index.html 引用的 CSS、4 個函式庫、js/*.js 全部內嵌,再內嵌 NotoSansTC 兩個字型(base64)。
// 產出的 HTML 不依賴任何外部檔案,可獨立放在任何地方、雙擊(file://)使用。
// index.html 與其他原始檔不會被修改。
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(DIR, 'index_offline.html'));
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');

let html = read('index.html');

// 內嵌 JS 時避免提早結束 <script>,並移除 sourceMappingURL(離線版沒有 .map 檔)
const safeJs = code => code.replace(/<\/script/gi, '<\\/script').replace(/^\/\/# sourceMappingURL=.*$/gm, '');

let nScript = 0, nCss = 0;
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  nScript++;
  return `<script>/* ${src} */\n${safeJs(read(src))}\n</script>`;
});
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
  nCss++;
  return `<style>/* ${href} */\n${read(href)}\n</style>`;
});
if (!nScript || !nCss) { console.error('index.html 結構異常:找不到要內嵌的 <script src> 或 <link>'); process.exit(1); }

// 字型(base64)——需在 js/export.js 之前定義;放在第一個 <script> 之前
const b64 = f => fs.readFileSync(path.join(DIR, f)).toString('base64');
const fonts =
  '<script>\n' +
  '/* 離線版內嵌字型(Noto Sans TC base64),供 PDF 匯出嵌字。本檔由 tools/build_offline.js 產生,請勿手動修改。 */\n' +
  'window.__EMBEDDED_FONTS = {\n' +
  '  "NotoSansTC-Regular.ttf": "' + b64('NotoSansTC-Regular.ttf') + '",\n' +
  '  "NotoSansTC-Bold.ttf": "' + b64('NotoSansTC-Bold.ttf') + '"\n' +
  '};\n</script>\n';
const firstScript = html.indexOf('<script>');
html = html.slice(0, firstScript) + fonts + html.slice(firstScript);

// 保險:不應再有任何外部引用。只檢查「內嵌程式碼以外」的標籤
// (函式庫的程式碼內容本身可能含 '<script src=' 字串,例如 xlsx 用來產生 HTML,不是真的引用)
const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
const leftover = markup.match(/<(?:script|link)[^>]+(?:src|href)="(?!data:|#)[^"]+"/g);
if (leftover) { console.error('仍有外部引用:', leftover); process.exit(1); }

fs.writeFileSync(out, html);
console.log('已產生 %s(%d MB;內嵌 %d 個 script、%d 個 css、2 個字型)', out, (fs.statSync(out).size / 1048576).toFixed(1), nScript, nCss);
