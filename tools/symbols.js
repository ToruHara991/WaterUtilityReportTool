// 符號索引:node tools/symbols.js [關鍵字]
// 列出每個 js/*.js 的頂層函式與常數(含行號),讓人/Claude 不必讀完整檔就知道東西在哪。
// 帶關鍵字時只顯示名稱含該字的符號,例如:node tools/symbols.js pdf
const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, '..', 'js');
const kw = (process.argv[2] || '').toLowerCase();
const order = ['config', 'shared', 'parse', 'filter', 'actions', 'report', 'summary', 'render', 'export', 'excel'];  // 同 index.html 載入順序
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort((a, b) => {
  const ia = order.indexOf(a.replace('.js', '')), ib = order.indexOf(b.replace('.js', ''));
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});
for (const f of files) {
  const syms = [];
  fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
    const m = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/) || line.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (m && (!kw || m[1].toLowerCase().includes(kw))) syms.push(`${m[1]}:${i + 1}`);
  });
  if (syms.length) console.log(`js/${f}  ${syms.join(' ')}`);
}
