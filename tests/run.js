// 回歸測試:node tests/run.js            (比對 tests/golden.json)
//           node tests/run.js --update   (以目前輸出重建基準,只在「確定輸出該變」時用)
//           node tests/run.js --dump     (失敗時把實際輸出寫到 tests/out/ 方便 diff)
// 需要 playwright:cd tests && npm install && npx playwright install chromium
// (若 playwright 裝在別處,可設 NODE_PATH 指向它的 node_modules)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { buildRows, buildOverflowRows, toAoa, EXPECT, HEADER } = require('./fixture');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN_FILE = path.join(__dirname, 'golden.json');
const OUT_DIR = path.join(__dirname, 'out');
const UPDATE = process.argv.includes('--update');
const DUMP = process.argv.includes('--dump');
const golden = fs.existsSync(GOLDEN_FILE) ? JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) : {};
const newGolden = {};

let pass = 0; const failures = [];
function check(name, cond, detail){
  if(cond){ pass++; } else { failures.push(name + (detail ? '  →  ' + detail : '')); }
}
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
function snap(name, value){
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  const h = md5(text);
  newGolden[name] = h;
  if(UPDATE) return;
  if(!(name in golden)){ failures.push(`[快照] ${name}:尚無基準(請先 --update)`); return; }
  if(golden[name] === h){ pass++; return; }
  failures.push(`[快照] ${name}:輸出與基準不同`);
  if(DUMP){ fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(path.join(OUT_DIR, name + '.txt'), text); }
}

// ── 靜態伺服器:服務專案目錄;/__offline.html 對應暫時產生的離線版 ──
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.ttf':'font/ttf' };
let offlineFile = null;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p === '/') p = '/index.html';
  const fp = p === '/__offline.html' ? offlineFile : path.join(ROOT, p);
  if(!fp || (p !== '/__offline.html' && !fp.startsWith(ROOT)) || !fs.existsSync(fp)){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

// ══════════ 頁面內的輔助(會被 page.evaluate 注入) ══════════
function pageHelpers(){
  window.__loadAoa = async (aoa) => {
    const conv = aoa.map(row => row.map(v => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v)) ? new Date(v) : v));
    const ws = XLSX.utils.aoa_to_sheet(conv, { cellDates: true });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '明細');
    const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const dt = new DataTransfer(); dt.items.add(new File([arr], 't.xlsx'));
    const fi = document.getElementById('fileIn'); fi.files = dt.files; fi.dispatchEvent(new Event('change'));
    await new Promise(res => {
      const t = setInterval(() => { if(!document.getElementById('overlay').classList.contains('show')){ clearInterval(t); res(); } }, 30);
      setTimeout(() => { clearInterval(t); res(); }, 8000);
    });
  };
  // 逐頁取得網頁表格 HTML
  window.__webPages = () => {
    const out = [];
    if(!totalChunks.length) return [document.getElementById('pages').innerHTML];   // 無資料時的畫面
    for(let i = 0; i < totalChunks.length; i++){ renderPage(i); out.push(document.getElementById('pages').innerHTML); }
    renderPage(0);
    return out;
  };
  // 圖片匯出:攔截 html2canvas,取得截圖前的 DOM
  window.__imageSnap = async (scope) => {
    let captured = null, fname = null;
    const oh = window.html2canvas, od = window.showDlConfirm;
    window.html2canvas = async (el, opts) => { captured = el.innerHTML; return document.createElement('canvas'); };
    window.showDlConfirm = (u, f) => { fname = f; };
    await exportImage(scope);
    window.html2canvas = oh; window.showDlConfirm = od;
    document.getElementById('exportOverlay').classList.remove('show');
    return { html: captured, fname };
  };
  // Excel 匯出:攔截下載確認卡取得檔案,再用 SheetJS 讀回來檢查
  window.__excelRun = async (reply, summary) => {
    document.getElementById('chkXlReply').checked = reply; document.getElementById('chkXlSummary').checked = summary;
    let cap = null; const o = window.showFileConfirm;
    window.showFileConfirm = (b, n, t, bt) => { cap = { b, n, t, bt }; };
    exportExcel();
    window.showFileConfirm = o;
    document.getElementById('exportOverlay').classList.remove('show');
    if(!cap) return { error: 'no file' };
    const wb = XLSX.read(await cap.b.arrayBuffer(), { type: 'array' });
    return { name: cap.n, title: cap.t, btn: cap.bt,
      sheets: wb.SheetNames.map(n => ({ name: n, aoa: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) })) };
  };
  // PDF 匯出:包裝 jsPDF,記錄 autoTable 與頁首文字,並取得 PDF 位元組
  window.__pdfRun = async () => {
    const Orig = window.jspdf.jsPDF;
    const log = { texts: [], tables: [], rows: [] };
    let inTable = false;
    let splitRows = 0;         // 被分頁線切開的列數(autoTable 會替「後半截」建立沒經過 didParseCell 的新列片段)
    function Wrapped(...args){
      const doc = new Orig(...args);
      const t = doc.text.bind(doc);
      const pg = () => doc.internal.getCurrentPageInfo().pageNumber;
      doc.text = function(txt, ...rest){
        if(!inTable) log.texts.push({ pg: pg(), t: Array.isArray(txt) ? txt.join('|') : String(txt) });
        return t(txt, ...rest);
      };
      const at = doc.autoTable.bind(doc);
      doc.autoTable = function(opts){
        const tIdx = log.tables.length;
        log.tables.push({ rows: opts.body.length, startY: opts.startY, margin: opts.margin, head: opts.head,
          colW: Object.keys(opts.columnStyles).map(k => opts.columnStyles[k].cellWidth),
          colAlign: Object.keys(opts.columnStyles).map(k => opts.columnStyles[k].halign || ''),
          styles: opts.styles, headStyles: opts.headStyles });
        const rowRec = {};
        const parse = opts.didParseCell, draw = opts.didDrawPage;
        opts.didParseCell = d => {
          parse && parse(d);
          if(d.section !== 'body') return;
          const k = tIdx + ':' + d.row.index;
          const r = rowRec[k] || (rowRec[k] = { tbl: tIdx, i: d.row.index, cells: [], fill: null, svcColor: null, svcStyle: null });
          if(d.column.index === 0) r.fill = d.cell.styles.fillColor === undefined ? null : d.cell.styles.fillColor;
          if(d.column.index === 3){ r.svcColor = d.cell.styles.textColor; r.svcStyle = d.cell.styles.fontStyle; }
          r.cells[d.column.index] = d.cell.text.join('\n');
        };
        opts.didDrawCell = d => {
          if(d.section === 'body' && d.column.index === 0){
            const rr = rowRec[tIdx + ':' + d.row.index];
            if(rr) rr.pg = pg(); else splitRows++;   // 沒登記過 = 被切開後的續列片段
          }
        };
        opts.didDrawPage = d => { inTable = false; draw && draw(d); inTable = true; };
        inTable = true;
        try { at(opts); } finally { inTable = false; }
        Object.values(rowRec).forEach(r => log.rows.push(r));
        return doc;
      };
      return doc;
    }
    Wrapped.prototype = Orig.prototype;
    window.jspdf.jsPDF = Wrapped;
    let cap = null; const os_ = window.showPdfConfirm;
    window.showPdfConfirm = (b, n) => { cap = { b, n }; };
    let err = null;
    try { await exportPDF(); } catch(e){ err = String(e); }
    window.showPdfConfirm = os_; window.jspdf.jsPDF = Orig;
    document.getElementById('exportOverlay').classList.remove('show');
    if(!cap) return { error: err || 'no pdf', log };
    const u8 = new Uint8Array(await cap.b.arrayBuffer());
    let s = ''; for(let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return { name: cap.n, bytes: u8.length, pages: (s.match(/\/Type\s*\/Page[^s]/g) || []).length, header: s.slice(0, 8), splitRows, log };
  };
}

const sel = (page, f, ...a) => page.evaluate(f, ...a);

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();

  async function openPage(url = base + '/', { blockExternal = false, mobile = false } = {}){
    const ctx = await browser.newContext({ timezoneId: 'Asia/Taipei', locale: 'zh-TW',
      ...(mobile ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1200, height: 900 } }) });
    const page = await ctx.newPage();
    const dialogs = []; const errors = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', e => errors.push(e.message));
    // blockExternal:除了頁面本身,任何請求(js/css/ttf…)一律中止,用來證明離線版是真正的單一檔案
    if(blockExternal) await page.route('**/*', r => r.request().url() === url ? r.continue() : r.abort());
    await page.clock.setFixedTime(new Date('2026-05-31T09:00:00+08:00'));
    await page.goto(url);
    await page.waitForFunction(() => typeof XLSX !== 'undefined' && typeof window.jspdf !== 'undefined' && typeof exportPDF === 'function');
    // 保險:樣式表必須真的生效(曾因伺服器沒設 .css 的 MIME,樣式被瀏覽器拒絕,版面類測試形同虛設)
    if(!blockExternal){
      const cssOk = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pri').trim() === '#1a3a5c');
      if(!cssOk) throw new Error('樣式表(css/app.css)未生效,測試環境有問題');
    }
    await page.evaluate(pageHelpers);
    return { page, dialogs, errors, ctx };
  }

  const rows = buildRows();
  const aoa = toAoa(rows);

  // ═════ 1. 純函式 ═════
  {
    const { page, errors, ctx } = await openPage();
    const r = await sel(page, () => ({
      shortA: shortUnit('萬里金山營運所'), shortB: shortUnit('某某營運所'), shortC: shortUnit(''), shortD: shortUnit('不認得'),
      range: parseShiftRange('5/30(17:00)－5/31(08:00)'),
      rangeSame: parseShiftRange('5/31(08:00－12:00)'),
      rangeBad: parseShiftRange('亂寫'),
      cross1: timeInShift('12/31 23:00', parseShiftRange('12/31(17:00)－1/1(08:00)')),
      cross2: timeInShift('1/1 07:59', parseShiftRange('12/31(17:00)－1/1(08:00)')),
      cross3: timeInShift('1/1 08:01', parseShiftRange('12/31(17:00)－1/1(08:00)')),
      cross4: timeInShift('12/31 16:59', parseShiftRange('12/31(17:00)－1/1(08:00)')),
      same1: timeInShift('5/31 08:00', parseShiftRange('5/31(08:00－12:00)')),
      same2: timeInShift('5/31 12:01', parseShiftRange('5/31(08:00－12:00)')),
      esc: e('<a href="x">&\n</a>'),
      fmt: fmtTime(new Date(2026, 4, 30, 8, 5)),
      fmtNum: fmtTime(46172.5),
      tv: timeVal(new Date(2026, 4, 30, 8, 5)),
      dk1: distKey({ dist: '板橋區' }), dk2: distKey({ dist: '' }),
    }));
    check('shortUnit 萬里金山', r.shortA === '萬金所', r.shortA);
    check('shortUnit 泛用規則', r.shortB === '某某所', r.shortB);
    check('shortUnit 空字串', r.shortC === '');
    check('shortUnit 不認得則原樣', r.shortD === '不認得');
    check('parseShiftRange 跨日', r.range && r.range.sMo === 5 && r.range.sD === 30 && r.range.sH === 17 && r.range.eD === 31 && r.range.eH === 8);
    check('parseShiftRange 同日', r.rangeSame && r.rangeSame.sH === 8 && r.rangeSame.eH === 12 && r.rangeSame.eD === 31);
    check('parseShiftRange 無效回 null', r.rangeBad === null);
    check('跨年班別:12/31 23:00 在區間內', r.cross1 === true);
    check('跨年班別:1/1 07:59 在區間內', r.cross2 === true);
    check('跨年班別:1/1 08:01 在區間外', r.cross3 === false);
    check('跨年班別:12/31 16:59 在區間外', r.cross4 === false);
    check('同日班別含頭', r.same1 === true);
    check('同日班別過尾', r.same2 === false);
    check('e() 逸出', r.esc === '&lt;a href=&quot;x&quot;&gt;&amp;<br>&lt;/a&gt;', r.esc);
    check('fmtTime Date', r.fmt === '5/30 08:05', r.fmt);
    snap('fn.fmtTimeNumber', String(r.fmtNum));
    check('timeVal', r.tv === 5300805, String(r.tv));
    check('distKey', r.dk1 === '板橋區' && r.dk2 === '（未分類）');
    check('純函式階段無頁面錯誤', errors.length === 0, errors.join(';'));
    await ctx.close();
  }

  // ═════ 2. 解析:錯誤處理 ═════
  {
    const { page, dialogs, ctx } = await openPage();
    await sel(page, a => __loadAoa(a), toAoa(rows, { header: HEADER.filter(h => h !== '服務類別') }));
    check('缺必要欄位會明確提示', dialogs.some(m => m.includes('找不到必要欄位') && m.includes('服務類別')), dialogs.join('|'));
    check('缺欄位時不進入結果畫面', await sel(page, () => rawRows.length === 0));
    dialogs.length = 0;
    await sel(page, a => __loadAoa(a), toAoa(rows, { header: HEADER.map(h => h === '受理編號' ? '編號' : h) }));
    check('找不到受理編號會提示', dialogs.some(m => m.includes('找不到「受理編號」')), dialogs.join('|'));
    await ctx.close();
  }

  // ═════ 3. 主流程 ═════
  const { page, dialogs, errors, ctx } = await openPage();
  await sel(page, a => __loadAoa(a), aoa);
  const parsed = await sel(page, () => ({
    n: rawRows.length, units: [...new Set(rawRows.map(r => r.unit))],
    alias: rawRows.some(r => r.svc === '供水量案件'),
    hasShort: rawRows.some(r => r.rec === 'A1'),
    svcs: [...new Set(rawRows.map(r => r.svc))].sort(),
    xss: rawRows.find(r => r.rec === 'XSS1001'),
  }));
  check('解析筆數(略過受理編號過短)', parsed.n === EXPECT.rawCount, `${parsed.n} vs ${EXPECT.rawCount}`);
  check('「供水量案件」已正規化為「供水量問題」', parsed.alias === false);
  check('受理編號<5字的列被略過', parsed.hasShort === false);
  check('廠所縮寫', ['基隆所','淡水所','瑞芳所','萬金所','一區處','新山廠','某某所'].every(u => parsed.units.includes(u)), parsed.units.join(','));
  snap('parse.raw', parsed);

  // 3a. 平常模式(未排序)
  snap('normal.unsorted.web', await sel(page, () => __webPages()));
  check('XSS:網頁表格不含未逸出的 <script>', !(await sel(page, () => __webPages().join('')).then(h => h.includes('<script>'))));

  // 3b. 平常模式(排序)
  await sel(page, () => applyAll());
  const normalState = await sel(page, () => ({
    order: filteredRows.map(r => [r.unit, r.svc, r.timeVal, r.rec].join('|')),
    legend: document.getElementById('legend').textContent,
    msg: document.getElementById('msgOut').value,
    shiftOpts: [...document.getElementById('shiftSel').options].map(o => o.textContent),
    status: document.getElementById('st').textContent,
    colors: unitColors,
  }));
  check('排序後濾掉非 KEEP_SVCS', !normalState.order.some(s => s.includes('OTHER01')) && normalState.order.length === EXPECT.rawCount - 1);
  {
    const FU = ['基隆所','淡水所','瑞芳所','汐止所','萬金所','文山所','貢雙所','新山廠','一區處'];
    const idx = u => { const i = FU.indexOf(u); return i < 0 ? 99 : i; };
    let ok = true;
    for(let i = 1; i < normalState.order.length; i++){
      const a = normalState.order[i-1].split('|'), b = normalState.order[i].split('|');
      if(idx(a[0]) > idx(b[0])) ok = false;
    }
    check('平常模式依 FIXED_UNITS 排序', ok);
  }
  check('平常模式圖例為廠所色', normalState.legend.startsWith('廠所色'), normalState.legend.slice(0, 20));
  snap('normal.sorted.state', normalState);
  const normalSortedWeb = await sel(page, () => __webPages());
  snap('normal.sorted.web', normalSortedWeb);

  // 3c. 篩選
  await sel(page, () => {
    const cb = [...document.querySelectorAll('#unitChecks input')].find(c => c.value === '淡水所');
    cb.checked = false; cb.dispatchEvent(new Event('change'));
  });
  const filt = await sel(page, () => ({ n: filteredRows.length, has: filteredRows.some(r => r.unit === '淡水所') }));
  check('取消廠所勾選後該廠所不在結果內', filt.has === false && filt.n < normalState.order.length, JSON.stringify(filt));
  await sel(page, () => {
    const cb = [...document.querySelectorAll('#svcChecks input')].find(c => c.value === '施工案件');
    cb.checked = false; cb.dispatchEvent(new Event('change'));
  });
  check('取消案件類別勾選後該類別不在結果內', await sel(page, () => !filteredRows.some(r => r.svc === '施工案件')));
  snap('normal.filtered.web', await sel(page, () => __webPages()));
  // 還原勾選
  await sel(page, () => { document.querySelectorAll('#unitChecks input,#svcChecks input').forEach(c => c.checked = true); applyFilter(); });

  // 3d. 時段篩選
  await sel(page, () => {
    const c = document.getElementById('chkShiftFilter'); c.checked = true; onShiftFilterChange();
  });
  const shift = await sel(page, () => {
    const range = parseShiftRange(document.getElementById('shiftSel').value);
    const shown = getShiftFilteredRows(filteredRows);
    return { val: document.getElementById('shiftSel').value, n: shown.length, total: filteredRows.length,
      allIn: shown.every(r => timeInShift(r.time, range)),
      noneMissed: filteredRows.filter(r => timeInShift(r.time, range)).length === shown.length,
      msg: document.getElementById('msgOut').value, web: __webPages() };
  });
  check('時段篩選:顯示的列都在時段內', shift.allIn && shift.noneMissed && shift.n > 0 && shift.n < shift.total, JSON.stringify({ n: shift.n, total: shift.total }));
  snap('normal.shift', { val: shift.val, n: shift.n, msg: shift.msg });
  snap('normal.shift.web', shift.web);
  // 時段篩選下的各匯出同源(圖片全部 = 時段篩選後的列數)
  {
    const im = await sel(page, () => __imageSnap('all'));
    const rowCount = (im.html.split('<tbody>')[1].match(/<tr /g) || []).length;   // 只算 tbody,不含表頭列
    check('時段篩選下圖片匯出列數一致', rowCount === shift.n, `${rowCount} vs ${shift.n}`);
  }
  await sel(page, () => { const c = document.getElementById('chkShiftFilter'); c.checked = false; onShiftFilterChange(); });

  // 3e. 平常模式匯出
  const imgAll = await sel(page, () => __imageSnap('all'));
  const imgPage = await sel(page, () => { goPg(1); return __imageSnap('page'); });
  await sel(page, () => goPg(0));
  check('圖片匯出有內容', imgAll.html && imgAll.html.includes('<table') && imgPage.html.includes('<table'));
  check('圖片匯出 XSS 逸出', !imgAll.html.includes('<script>') && !imgAll.html.includes('<b>x</b>'));
  snap('normal.image.all', imgAll);
  snap('normal.image.page2', imgPage);

  const pdfN = await sel(page, () => __pdfRun());
  check('平常模式 PDF 產出', !pdfN.error && pdfN.header.startsWith('%PDF'), pdfN.error);
  const chunks = await sel(page, () => totalChunks.length);
  check('平常模式 PDF 頁數 = 分頁數', pdfN.pages === chunks, `${pdfN.pages} vs ${chunks}`);
  check('平常模式 PDF 檔名', /^案件明細_PDF_\d+_\d+筆\.pdf$/.test(pdfN.name), pdfN.name);
  snap('normal.pdf', { name: pdfN.name, pages: pdfN.pages, log: pdfN.log });

  // 3f. 切換到災害模式(已排序 → 立即重算)
  await sel(page, () => toggleDisaster());
  const dis = await sel(page, () => ({
    mode: disasterMode,
    order: filteredRows.map(r => [r.unit, r.dist, r.svc, r.timeVal, r.rec].join('|')),
    legend: document.getElementById('legend').textContent,
    btn: document.getElementById('disasterBtn').textContent,
    colors: distColors, web: __webPages(),
  }));
  check('災害模式:按鈕狀態', dis.mode && dis.btn.includes('開'));
  check('災害模式:圖例為行政區色', dis.legend.startsWith('行政區色'), dis.legend.slice(0, 20));
  {
    const FU = ['基隆所','淡水所','瑞芳所','汐止所','萬金所','文山所','貢雙所','新山廠','一區處'];
    const idx = u => { const i = FU.indexOf(u); return i < 0 ? 99 : i; };
    const SO = { '修漏案件':1, '供水量問題':2, '水質案件':3, '施工案件':4 };
    let ok = true, why = '';
    for(let i = 1; i < dis.order.length; i++){
      const [ua, da, sa, ta] = dis.order[i-1].split('|'), [ub, db, sb, tb] = dis.order[i].split('|');
      if(idx(ua) !== idx(ub)){ if(idx(ua) > idx(ub)){ ok = false; why = '廠所順序'; } continue; }
      if(da !== db){ if(da.localeCompare(db, 'zh-Hant') > 0){ ok = false; why = '行政區順序'; } continue; }
      if(sa !== sb){ if(SO[sa] > SO[sb]){ ok = false; why = '服務類別順序'; } continue; }
      if(+ta > +tb){ ok = false; why = '時間順序'; }
    }
    check('災害模式排序:廠所→行政區→服務類別→時間', ok, why);
  }
  {
    // 同一廠所內「相鄰」的兩個不同行政區,底色必須不同(否則看不出分界)
    let adjOk = true, adjWhy = '';
    for(let i = 1; i < dis.order.length; i++){
      const [ua, da] = dis.order[i-1].split('|'), [ub, db] = dis.order[i].split('|');
      if(ua === ub && da !== db && dis.colors[da] === dis.colors[db]){ adjOk = false; adjWhy = `${ua}:${da}/${db} 同色`; break; }
    }
    check('災害模式:同廠所內相鄰的不同行政區顏色不同', adjOk, adjWhy);
    const nd = Object.keys(dis.colors).length, nc = new Set(Object.values(dis.colors)).size;
    check('災害模式:各行政區顏色互不相同', nc === nd, `${nd} 個行政區只有 ${nc} 種顏色`);
  }
  snap('disaster.state', { order: dis.order, legend: dis.legend, colors: dis.colors });
  snap('disaster.web', dis.web);
  const imgD = await sel(page, () => __imageSnap('all'));
  snap('disaster.image.all', imgD);

  const pdfD = await sel(page, () => __pdfRun());
  check('災害模式 PDF 產出', !pdfD.error && pdfD.header.startsWith('%PDF'), pdfD.error);
  check('災害模式 PDF 檔名含「災害模式」', /^災害模式_案件明細_\d+_\d+筆\.pdf$/.test(pdfD.name), pdfD.name);
  {
    const L = pdfD.log;
    const unitsInOrder = [...new Set(dis.order.map(s => s.split('|')[0]))];
    check('災害模式 PDF:每個廠所一個 table', L.tables.length === unitsInOrder.length, `${L.tables.length} vs ${unitsInOrder.length}`);
    // 每頁只有一個廠所
    const byPage = {};
    for(const r of L.rows){ (byPage[r.pg] = byPage[r.pg] || new Set()).add(r.cells[0]); }
    check('災害模式 PDF:任何一頁只含單一廠所', Object.values(byPage).every(s => s.size === 1), JSON.stringify(Object.fromEntries(Object.entries(byPage).map(([k, v]) => [k, [...v]]))));
    // 每個廠所的第一列都在新頁
    const firstPg = {}; const lastPgOfPrev = {};
    for(const r of L.rows){ const u = r.cells[0]; if(!(u in firstPg) || r.pg < firstPg[u]) firstPg[u] = r.pg; }
    const pgs = unitsInOrder.map(u => firstPg[u]);
    check('災害模式 PDF:各廠所起始頁遞增(各自從新頁開始)', pgs.every((p, i) => i === 0 || p > pgs[i-1]), pgs.join(','));
    // 每一頁都有帶狀列(廠所名)
    const bandPages = new Set(L.texts.filter(t => /🚨/.test(t.t) || unitsInOrder.some(u => t.t.includes(u) && t.t.includes('件'))).map(t => t.pg));
    check('災害模式 PDF:每頁頂端都有廠所帶狀列', Object.keys(byPage).every(p => bandPages.has(+p)), [...bandPages].join(','));
    // 顏色:同行政區同色、換行政區換色
    const seq = L.rows.slice().sort((a, b) => a.tbl - b.tbl || a.i - b.i);
    let colorOk = true, colorWhy = '';
    const map = {};
    for(const r of seq){
      const dkey = r.cells[7], f = JSON.stringify(r.fill);
      if(f === 'null'){ colorOk = false; colorWhy = '有列沒有底色'; break; }
      if(map[dkey] === undefined) map[dkey] = f; else if(map[dkey] !== f){ colorOk = false; colorWhy = '同行政區顏色不一致:' + dkey; break; }
    }
    check('災害模式 PDF:同行政區同色', colorOk, colorWhy);
    check('災害模式 PDF:欄寬與平常模式完全相同', JSON.stringify(L.tables[0].colW) === JSON.stringify(pdfN.log.tables[0].colW) && JSON.stringify(L.tables[0].colW) === JSON.stringify([11,16,14,15,14,42,8,8,28,9,14,14]));
    snap('disaster.pdf', { name: pdfD.name, pages: pdfD.pages, log: L });
  }

  // 3g. 切回平常模式:狀態可還原
  await sel(page, () => toggleDisaster());
  const back = await sel(page, () => ({
    order: filteredRows.map(r => [r.unit, r.svc, r.timeVal, r.rec].join('|')),
    legend: document.getElementById('legend').textContent, web: __webPages(),
  }));
  check('災害模式切回平常:排序還原', JSON.stringify(back.order) === JSON.stringify(normalState.order));
  check('災害模式切回平常:圖例還原', back.legend === normalState.legend);
  check('災害模式切回平常:網頁表格還原', JSON.stringify(back.web) === JSON.stringify(normalSortedWeb));

  // 3h. 還原 / 重新上傳
  await sel(page, () => resetRaw());
  check('還原後回到未排序', await sel(page, () => sorted === false && filteredRows.length === rawRows.length));
  await sel(page, () => reUpload());
  check('重新上傳清空資料', await sel(page, () => rawRows.length === 0 && Object.keys(distColors).length === 0));

  check('主流程無對話框', dialogs.length === 0, dialogs.join('|'));
  check('主流程無頁面錯誤', errors.length === 0, errors.join(';'));
  await ctx.close();

  // ═════ 3.5 單一廠所案件很多:跨頁續表 ═════
  {
    const o = await openPage();
    await sel(o.page, a => __loadAoa(a), toAoa(buildOverflowRows().concat(rows.filter(r => r.unit === '基隆營運所'))));
    await sel(o.page, () => { toggleDisaster(); applyAll(); });
    const r = await sel(o.page, () => __pdfRun());
    check('跨頁續表:PDF 產出', !r.error && r.header.startsWith('%PDF'), r.error);
    const tbl = r.log.tables;
    const big = tbl.find(t => t.rows >= 130);
    check('跨頁續表:一區處 130 件在同一個 table', !!big);
    const pgsOf = {};
    for(const x of r.log.rows){ (pgsOf[x.cells[0]] = pgsOf[x.cells[0]] || new Set()).add(x.pg); }
    check('跨頁續表:一區處佔多頁', pgsOf['一區處'] && pgsOf['一區處'].size >= 3, pgsOf['一區處'] && [...pgsOf['一區處']].join(','));
    check('跨頁續表:基隆所不與一區處同頁', !!pgsOf['基隆所'] && !!pgsOf['一區處'] && ![...pgsOf['基隆所']].some(p => pgsOf['一區處'].has(p)));
    check('跨頁續表:沒有任何一列被分頁線切成兩半', r.splitRows === 0, `${r.splitRows} 列被切開`);
    const bandPgs = new Set(r.log.texts.filter(t => t.t.includes('一區處') && t.t.includes('件')).map(t => t.pg));
    check('跨頁續表:一區處每一頁頂端都有帶狀列', !!pgsOf['一區處'] && [...pgsOf['一區處']].every(p => bandPgs.has(p)));
    check('跨頁續表:無對話框/錯誤', o.dialogs.length === 0 && o.errors.length === 0, o.dialogs.concat(o.errors).join('|'));
    await o.ctx.close();
  }

  // ═════ 3.6 統計摘要與 Excel ═════
  {
    const o = await openPage();
    await sel(o.page, a => __loadAoa(a), aoa);
    await sel(o.page, () => applyAll());

    // 路段判讀
    const roads = await sel(o.page, () => ['中山路二段123號','民族街45巷3號','新興里中正路12號','大里路5號','中華大道100號','忠孝東路3段1號','台北車站','','光復路一段三樓','文化一路 8號'].map(roadOf));
    check('roadOf 路段判讀', JSON.stringify(roads) === JSON.stringify(['中山路二段','民族街','中正路','大里路','中華大道','忠孝東路3段',null,null,'光復路一段','文化一路']), JSON.stringify(roads));

    // 統計計算(手算答案)
    const S = await sel(o.page, () => computeSummary([
      { unit:'一區處', svc:'修漏案件',   city:'新北市', dist:'板橋區', addr:'中山路二段1號', time:'5/30 08:10' },
      { unit:'一區處', svc:'修漏案件',   city:'新北市', dist:'板橋區', addr:'中山路二段9號', time:'5/30 08:50' },
      { unit:'一區處', svc:'水質案件',   city:'新北市', dist:'中和區', addr:'景平路10號',    time:'5/30 09:05' },
      { unit:'基隆所', svc:'供水量問題', city:'基隆市', dist:'仁愛區', addr:'仁一路3號',     time:'5/30 08:20' },
      { unit:'基隆所', svc:'施工案件',   city:'基隆市', dist:'仁愛區', addr:'大樓內5樓',     time:'5/31 08:00' },
    ]));
    check('統計:總數與廠所順序', S.total === 5 && S.unitRows.map(r => r.unit).join() === '基隆所,一區處', S.unitRows.map(r => r.unit).join());
    check('統計:廠所×類別', S.unitRows[0].counts.supply === 1 && S.unitRows[0].counts.construct === 1 && S.unitRows[0].total === 2 &&
      S.unitRows[1].counts.repair === 2 && S.unitRows[1].counts.water === 1 && S.unitRows[1].total === 3, JSON.stringify(S.unitRows));
    check('統計:合計與無其他類別', S.svcTotals.repair === 2 && S.svcTotals.supply === 1 && S.svcTotals.water === 1 && S.svcTotals.construct === 1 && S.hasOther === false);
    const dmap = Object.fromEntries(S.dists.map(d => [d.label, d.n]));
    check('統計:行政區(跨縣市時帶縣市名)', S.multiCity && dmap['新北市板橋區'] === 2 && dmap['基隆市仁愛區'] === 2 && dmap['新北市中和區'] === 1 && S.dists.length === 3, JSON.stringify(dmap));
    check('統計:路段只列 2 件以上、無法判讀者另計', S.roads.length === 1 && S.roads[0].label === '新北市板橋區 中山路二段' && S.roads[0].n === 2 && S.roadUnknown === 1, JSON.stringify(S.roads) + S.roadUnknown);
    check('統計:高峰時段', S.peak && S.peak.label === '5/30 08:00–08:59' && S.peak.n === 3, JSON.stringify(S.peak));
    check('統計:空資料不出錯', await sel(o.page, () => computeSummary([]).total === 0 && summaryHtml(computeSummary([])).includes('沒有資料')));

    // 畫面:預設收合、展開才計算、篩選後同步
    const ui0 = await sel(o.page, () => ({ open: document.getElementById('summaryBox').open, body: document.getElementById('summaryBody').innerHTML,
      before: !!(document.getElementById('summaryBox').compareDocumentPosition(document.getElementById('reportBox')) & Node.DOCUMENT_POSITION_FOLLOWING) }));
    check('摘要預設收合且未計算', ui0.open === false && ui0.body === '');
    check('摘要位於業務課報告文字上方', ui0.before === true);
    await o.page.click('#summaryBox > summary'); await o.page.waitForTimeout(150);
    const ui1 = await sel(o.page, () => ({ open: document.getElementById('summaryBox').open, total: +document.querySelector('.sm-over b').textContent,
      n: filteredRows.length, h: document.getElementById('summaryBody').textContent }));
    check('展開後顯示摘要且總數與畫面一致', ui1.open && ui1.total === ui1.n && ui1.h.includes('各廠所 × 案件類別') && ui1.h.includes('行政區排行') && ui1.h.includes('路段排行'), JSON.stringify({ t: ui1.total, n: ui1.n }));
    await sel(o.page, () => { const cb = [...document.querySelectorAll('#unitChecks input')].find(c => c.value === '淡水所'); cb.checked = false; cb.dispatchEvent(new Event('change')); });
    const ui2 = await sel(o.page, () => ({ total: +document.querySelector('.sm-over b').textContent, n: filteredRows.length, has: document.getElementById('summaryBody').textContent.includes('淡水所') }));
    check('篩選後摘要即時同步', ui2.total === ui2.n && ui2.has === false, JSON.stringify(ui2));
    await sel(o.page, () => { document.querySelectorAll('#unitChecks input').forEach(c => c.checked = true); applyFilter(); });
    snap('summary.normal', await sel(o.page, () => summaryHtml(computeSummary(getShiftFilteredRows(filteredRows)))));
    await sel(o.page, () => toggleDisaster());
    snap('summary.disaster', await sel(o.page, () => summaryHtml(computeSummary(getShiftFilteredRows(filteredRows)))));

    // Excel(災害模式)
    const rowsNow = await sel(o.page, () => filteredRows.map(r => ({ unit: r.unit, rec: r.rec, phone: r.phone })));
    const unitsNow = await sel(o.page, () => orderUnits([...new Set(filteredRows.map(r => r.unit))]));
    const HD = ['廠所別','受理編號','申報時間','服務類別','細項','用戶問題描述','縣市','區域','報修地址','姓名','電話','修漏案號'];
    const x0 = await sel(o.page, () => __excelRun(false, false));
    check('Excel:檔名(災害模式)', /^災害模式_案件明細_Excel_\d+_\d+筆\.xlsx$/.test(x0.name), x0.name);
    check('Excel:各廠所一個分頁,順序同廠所排序', JSON.stringify(x0.sheets.map(s => s.name)) === JSON.stringify(unitsNow), x0.sheets.map(s => s.name).join());
    check('Excel:表頭與欄數(預設不含選填欄)', x0.sheets.every(s => JSON.stringify(s.aoa[0]) === JSON.stringify(HD)));
    check('Excel:資料列數 = 畫面筆數', x0.sheets.reduce((a, s) => a + s.aoa.length - 1, 0) === rowsNow.length);
    check('Excel:預設不含統計摘要分頁', !x0.sheets.some(s => s.name === '統計摘要'));
    check('Excel:各分頁只含該廠所、順序與畫面一致', x0.sheets.every(s => {
      const want = rowsNow.filter(r => r.unit === s.name).map(r => r.rec);
      return JSON.stringify(s.aoa.slice(1).map(a => a[1])) === JSON.stringify(want);
    }));
    check('Excel:電話保留開頭 0(字串)', x0.sheets.every(s => s.aoa.slice(1).every(a => typeof a[10] === 'string' && a[10].startsWith('09'))));
    check('Excel:下載確認卡文案', x0.title.includes('Excel') && x0.btn.includes('Excel'));
    const x1 = await sel(o.page, () => __excelRun(true, true));
    check('Excel:選填欄「處理情形/完成時間」', x1.sheets.filter(s => s.name !== '統計摘要').every(s => s.aoa[0].length === 14 && s.aoa[0][12] === '處理情形' && s.aoa[0][13] === '完成時間' && s.aoa.slice(1).every(a => a[12] === '' && a[13] === '')));
    check('Excel:選填「統計摘要」分頁為第一頁', x1.sheets[0].name === '統計摘要');
    {
      const sm = x1.sheets[0].aoa;
      const hi = sm.findIndex(r => r[0] === '廠所' && r[5] === '合計');
      const tot = sm.find(r => r[0] === '合計');
      check('Excel 摘要:合計 = 畫面筆數', hi > 0 && tot && tot[5] === rowsNow.length, JSON.stringify(tot));
      check('Excel 摘要:含行政區與路段排行', sm.some(r => r[0] === '行政區排行') && sm.some(r => String(r[0]).startsWith('路段排行')));
    }
    snap('excel.disaster.full', { name: x1.name.replace(/\d+_\d+筆/, 'N'), sheets: x1.sheets });
    // 時段篩選下的 Excel
    await sel(o.page, () => { const c = document.getElementById('chkShiftFilter'); c.checked = true; onShiftFilterChange(); });
    const nShift = await sel(o.page, () => getShiftFilteredRows(filteredRows).length);
    const x2 = await sel(o.page, () => __excelRun(false, false));
    check('Excel:套用時段篩選', x2.sheets.reduce((a, s) => a + s.aoa.length - 1, 0) === nShift && nShift < rowsNow.length, `${nShift}`);
    await sel(o.page, () => { const c = document.getElementById('chkShiftFilter'); c.checked = false; onShiftFilterChange(); });
    // 平常模式檔名
    await sel(o.page, () => toggleDisaster());
    const x3 = await sel(o.page, () => __excelRun(false, false));
    check('Excel:檔名(平常模式)', /^案件明細_Excel_\d+_\d+筆\.xlsx$/.test(x3.name), x3.name);
    // 分頁名稱
    const sn = await sel(o.page, () => { const u = new Set(); return [xlSheetName('a:b/c[d]', u), xlSheetName('abcd', u), xlSheetName('abcd', u), xlSheetName('', u), xlSheetName('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四', u).length]; });
    check('Excel:分頁名稱處理(禁用字元/重複/空白/過長)', JSON.stringify(sn) === JSON.stringify(['abcd', 'abcd_2', 'abcd_3', '未分類', 28]), JSON.stringify(sn));
    check('摘要/Excel:無對話框與頁面錯誤', o.dialogs.length === 0 && o.errors.length === 0, o.dialogs.concat(o.errors).join('|'));
    await o.ctx.close();
  }

  // ═════ 3.7 手機寬度(375px) ═════
  {
    const o = await openPage(base + '/', { mobile: true });
    await sel(o.page, a => __loadAoa(a), aoa);
    await sel(o.page, () => { toggleDisaster(); applyAll(); });
    await o.page.click('#summaryBox > summary'); await o.page.waitForTimeout(150);
    const m1 = await sel(o.page, () => ({ sw: document.documentElement.scrollWidth, iw: innerWidth,
      boxR: document.getElementById('summaryBox').getBoundingClientRect().right,
      overflow: [...document.querySelectorAll('#summaryBody *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).length }));
    check('手機:摘要展開後無橫向捲動', m1.sw <= m1.iw && m1.overflow === 0, JSON.stringify(m1));
    await o.page.click('#screenshotBtn'); await o.page.waitForTimeout(100);
    const m2 = await sel(o.page, () => { const r = document.getElementById('exportMenu').getBoundingClientRect();
      return { l: r.left, r: r.right, iw: innerWidth, vis: r.width > 0, reply: document.getElementById('chkXlReply').checked, sum: document.getElementById('chkXlSummary').checked }; });
    check('手機:匯出選單不超出螢幕', m2.vis && m2.l >= 0 && m2.r <= m2.iw, JSON.stringify(m2));
    check('手機:Excel 選填項預設不勾', m2.reply === false && m2.sum === false);
    await o.page.click('#chkXlReply');
    check('手機:點選填項不會關閉選單', await sel(o.page, () => document.getElementById('exportMenu').style.display !== 'none'));
    check('手機:無對話框與頁面錯誤', o.dialogs.length === 0 && o.errors.length === 0, o.dialogs.concat(o.errors).join('|'));
    await o.ctx.close();
  }

  // ═════ 3.7 PDF 戰情摘要首頁(選填) ═════
  {
    const o = await openPage();
    await sel(o.page, a => __loadAoa(a), aoa);
    await sel(o.page, () => applyAll());

    // 趨勢與結論句(手算)
    const T = await sel(o.page, () => {
      const mk = (t, svc='修漏案件', dist='板橋區', addr='中山路二段1號') => ({ unit:'一區處', svc, city:'新北市', dist, addr, time:t, timeVal: timeVal(t) });
      const S = computeSummary([mk('5/30 08:10'), mk('5/30 08:50'), mk('5/30 10:05'), mk('5/30 10:20'), mk('5/30 10:40', '水質案件')]);
      const wide = computeSummary([mk('5/30 08:10'), mk('6/1 09:00')]);
      return { S: { trend: S.trend, latest: S.latest }, lead: leadSentence(computeSummary([mk('5/30 08:10'), mk('5/30 08:50'), mk('5/30 10:05')])), note: trendNote(S),
               wide: wide.trend.unit + ':' + wide.trend.items.map(i => i.label + '=' + i.n).join(','), empty: leadSentence(computeSummary([])) };
    });
    check('趨勢:每小時、補零(09 時為 0)', T.S.trend.unit === 'hour' && T.S.trend.items.map(i => i.label + '=' + i.n).join() === '5/30 08=2,5/30 09=0,5/30 10=3', JSON.stringify(T.S.trend));
    check('趨勢:最晚時間', T.S.latest === '5/30 10:40', T.S.latest);
    check('趨勢:文字(最新一小時 3 件、前一小時 0 件、增加)', T.note === '最新一小時（5/30 10時）3 件，前一小時 0 件，增加', T.note);
    check('趨勢:跨度超過 36 小時改以「天」並補零', T.wide === 'day:5/30=1,5/31=0,6/1=1', T.wide);
    check('結論句內容', T.lead.includes('共 3 件') && T.lead.includes('以修漏為主（100%）') && T.lead.includes('最集中在板橋區（3 件）') && T.lead.includes('熱點路段為板橋區 中山路二段（3 件）'), T.lead);
    check('結論句:空資料', T.empty === '目前沒有案件資料。', T.empty);

    // 預設不勾;記憶選擇
    check('PDF 摘要選項預設不勾', await sel(o.page, () => document.getElementById('chkPdfSummary').checked === false));
    await o.page.evaluate(() => { const c = document.getElementById('chkPdfSummary'); c.checked = true; c.dispatchEvent(new Event('change')); });
    check('PDF 摘要選項會記住', await sel(o.page, () => localStorage.getItem('wurt.pdfSummary') === '1'));

    for(const dis of [false, true]){
      const tag = dis ? '災害模式' : '平常模式';
      if(dis) await sel(o.page, () => toggleDisaster());
      const r = await sel(o.page, () => __pdfRun());
      const base0 = await sel(o.page, () => { const c = document.getElementById('chkPdfSummary'); c.checked = false; return 0; });
      const r0 = await sel(o.page, () => __pdfRun());
      await sel(o.page, () => { document.getElementById('chkPdfSummary').checked = true; });
      check(`${tag}+摘要:PDF 產出`, !r.error && r.header.startsWith('%PDF'), r.error);
      check(`${tag}+摘要:恰多一頁`, r.pages === r0.pages + 1, `${r.pages} vs ${r0.pages}`);
      const t1 = r.log.texts.filter(t => t.pg === 1).map(t => t.t).join('\n');
      check(`${tag}+摘要:第 1 頁是戰情摘要且含結論句`, t1.includes('戰情摘要') && t1.includes('以') && t1.includes('為主') && t1.includes('最集中在'), t1.slice(0, 80));
      check(`${tag}+摘要:第 1 頁大數字總件數正確`, t1.split('\n').includes(String(await sel(o.page, () => getShiftFilteredRows(filteredRows).length))));
      check(`${tag}+摘要:摘要表在明細表之前(廠所表、行政區表、路段表)`, r.log.tables[0].head[0][0] === '廠所' && r.log.tables[1].head[0][0] === '行政區 前 5' && r.log.tables[2].head[0][0].startsWith('路段 前 5'));
      const detail = r.log.tables.filter(t => t.head[0][0] === '廠所別');
      check(`${tag}+摘要:明細欄寬一字不動`, detail.length >= 1 && detail.every(t => JSON.stringify(t.colW) === JSON.stringify([11,16,14,15,14,42,8,8,28,9,14,14])), JSON.stringify(detail[0] && detail[0].colW));
      const dRows = r.log.rows.filter(x => x.tbl >= 3);   // 前 3 個 table 是摘要頁的表
      check(`${tag}+摘要:明細列數與不勾選時相同`, dRows.length === r0.log.rows.length, `${dRows.length} vs ${r0.log.rows.length}`);
      check(`${tag}+摘要:明細全部在第 2 頁之後`, dRows.every(x => x.pg >= 2));
      if(dis){
        const subs = r.log.texts.filter(t => /^\d+ 件｜.*最多：/.test(t.t));
        const units = await sel(o.page, () => { const m = new Map(); for(const x of getShiftFilteredRows(filteredRows)) m.set(x.unit, (m.get(x.unit) || 0) + 1); return [...m.values()].sort((a, b) => a - b).join(); });
        check('災害+摘要:每個廠所頁首都有小計行(件數與廠所一致)', subs.length >= 1 && subs.map(t => parseInt(t.t)).sort((a, b) => a - b).join() === units, subs.map(t => t.t).join(' / '));
        check('災害+摘要:不勾選時沒有小計行', !r0.log.texts.some(t => /件｜.*最多：/.test(t.t)));
      }
    }
    check('PDF 摘要:無對話框/錯誤', o.dialogs.length === 0 && o.errors.length === 0, o.dialogs.concat(o.errors).join('|'));
    await o.ctx.close();
  }

  // ═════ 3.8 災情看板(外掛) ═════
  {
    const o = await openPage();
    await sel(o.page, a => __loadAoa(a), aoa);
    await sel(o.page, () => { toggleDisaster(); applyAll(); });
    const st = () => sel(o.page, () => ({ open: DASH.open, total: +document.querySelector('#dKpi .kn[data-k=total]').dataset.to, n: rowsFor().length,
      list: document.querySelectorAll('#dList .li').length, F: { unit: [...DASH.F.unit], svc: [...DASH.F.svc], dk: [...DASH.F.dk], t: DASH.F.t, q: DASH.F.q } }));

    // 開啟前:主畫面不受影響
    check('看板:未開啟前不佔畫面', await sel(o.page, () => !document.querySelector('.dash') && getComputedStyle(document.body).overflow !== 'hidden'));
    await o.page.click('#dashBtn'); await o.page.waitForTimeout(250);
    const s0 = await st();
    const expectN = await sel(o.page, () => getShiftFilteredRows(filteredRows).length);
    check('看板:開啟,件數與主畫面一致', s0.open && s0.total === expectN && s0.n === expectN, JSON.stringify(s0));
    check('看板:全螢幕且鎖住背景捲動', await sel(o.page, () => { const r = document.querySelector('.dash').getBoundingClientRect(); return r.width === innerWidth && r.height === innerHeight && document.body.style.overflow === 'hidden'; }));
    check('看板:預設深色主題', await sel(o.page, () => !document.querySelector('.dash').classList.contains('light')));
    const priv = await sel(o.page, () => document.querySelector('.dash').textContent);
    check('看板:不顯示姓名/電話', !/王\d|0910000|09\d{8}/.test(priv.replace(/AB\d+/g, '')), '');
    check('看板:KPI 各類別加總等於總數', await sel(o.page, () => [...document.querySelectorAll('#dKpi .kpi-svc .kn')].reduce((a, b) => a + (+b.dataset.to), 0) === rowsFor().length));

    // 交叉篩選:點廠所
    const unit0 = await sel(o.page, () => document.querySelector('.hb[data-f=unit]').dataset.v);
    const unitN = await sel(o.page, u => DASH.X.filter(x => x.unit === u).length, unit0);
    await o.page.click('.hb[data-f=unit] >> nth=0'); await o.page.waitForTimeout(100);
    const s1 = await st();
    check('看板:點廠所 → 件數 = 該廠所件數', s1.total === unitN && s1.F.unit[0] === unit0, `${s1.total} vs ${unitN}`);
    check('看板:點廠所 → 出現篩選標籤與「清除全部」', await sel(o.page, () => document.querySelectorAll('#dChips .chip').length === 2));
    const distShown = await sel(o.page, u => [...document.querySelectorAll('#dDist .hb')].every(h => DASH.X.some(x => x.dk === h.dataset.v && x.unit === u)), unit0);
    check('看板:點廠所 → 行政區圖只剩該廠所的行政區', distShown);
    // 交叉篩選的關鍵:廠所圖本身排除自己的篩選,仍顯示所有廠所
    check('看板:廠所圖保留其他廠所(未被選取者淡化)', await sel(o.page, () => document.querySelectorAll('#dUnit .hb').length === new Set(DASH.X.map(x => x.unit)).size && document.querySelectorAll('#dUnit .hb.dim').length === document.querySelectorAll('#dUnit .hb').length - 1));
    // 再點類別
    await o.page.click('.kpi-svc[data-v=repair]'); await o.page.waitForTimeout(100);
    const s2 = await st(), exp2 = await sel(o.page, u => DASH.X.filter(x => x.unit === u && x.k === 'repair').length, unit0);
    check('看板:廠所 + 類別 同時篩選', s2.total === exp2 && s2.list === Math.min(30, exp2), `${s2.total} vs ${exp2}`);
    // 取消
    await o.page.click('.chip[data-x=svc]'); await o.page.click('.chip[data-x=unit]'); await o.page.waitForTimeout(100);
    check('看板:點標籤可取消篩選', (await st()).total === expectN);

    // 時間軸拖曳
    const nb = await sel(o.page, () => DASH.trend.items.length);
    check('看板:時間軸每個時段一欄', await sel(o.page, () => document.querySelectorAll('.tl .tc').length === DASH.trend.items.length) && nb >= 2);
    const tl = await o.page.locator('.tl').boundingBox();
    await o.page.mouse.move(tl.x + 2, tl.y + 40); await o.page.mouse.down();
    await o.page.mouse.move(tl.x + tl.width * 0.2, tl.y + 40, { steps: 5 }); await o.page.mouse.up(); await o.page.waitForTimeout(100);
    const s3 = await st();
    const exp3 = await sel(o.page, () => DASH.X.filter(x => x.b >= DASH.F.t[0] && x.b <= DASH.F.t[1]).length);
    check('看板:拖曳時間軸 → 只剩所選時段的案件', !!s3.F.t && s3.F.t[0] === 0 && s3.F.t[1] < nb - 1 && s3.total === exp3 && s3.total < expectN, JSON.stringify(s3.F.t) + ' ' + s3.total + '/' + exp3);
    // 點熱力圖格子 = 行政區 + 時段
    await o.page.click('[data-act=clear]'); await o.page.waitForTimeout(80);
    check('看板:清除全部', (await st()).total === expectN);
    await o.page.click('.hm-c:not(.z) >> nth=0'); await o.page.waitForTimeout(100);
    const s4 = await st();
    check('看板:點熱力圖格子 → 同時套用行政區與時段', s4.F.dk.length === 1 && !!s4.F.t && s4.F.t[0] === s4.F.t[1] && s4.total >= 1 && s4.total < expectN, JSON.stringify(s4.F));
    await o.page.click('[data-act=clear]');

    // 搜尋
    const q = await sel(o.page, () => DASH.X[0].r.rec);
    await o.page.fill('#dQ', q); await o.page.waitForTimeout(350);
    const s5 = await st();
    check('看板:搜尋受理編號 → 只剩 1 筆', s5.total === 1 && s5.list === 1 && s5.F.q === q.toLowerCase(), JSON.stringify(s5));
    await o.page.fill('#dQ', '不存在的字串'); await o.page.waitForTimeout(350);
    check('看板:搜尋無結果有提示', await sel(o.page, () => document.querySelector('#dList').textContent.includes('沒有符合條件的案件')));
    await o.page.click('[data-act=clear]');
    check('看板:清除後搜尋框清空', await sel(o.page, () => document.getElementById('dQ').value === ''));

    // 清單分頁
    const bigN = await sel(o.page, () => rowsFor().length);
    if(bigN > 30){
      await o.page.click('[data-act=more]');
      check('看板:清單「再顯示 30 筆」', (await st()).list === Math.min(60, bigN));
    }

    // 播放:結束後回到全部時段
    await sel(o.page, () => { window.__origIv = window.setInterval; });
    await o.page.click('#dPlay'); await o.page.waitForTimeout(150);
    check('看板:播放中按鈕變暫停且時段從頭累計', await sel(o.page, () => DASH.playing && document.getElementById('dPlay').textContent.includes('暫停') && DASH.F.t && DASH.F.t[0] === 0));
    await o.page.click('#dPlay'); await o.page.waitForTimeout(50);
    check('看板:可暫停', await sel(o.page, () => !DASH.playing));
    await sel(o.page, () => dashClear());

    // 主題與記憶
    await o.page.click('[data-act=theme]');
    check('看板:切換淺色並記住', await sel(o.page, () => document.querySelector('.dash').classList.contains('light') && localStorage.getItem('wurt.dashTheme') === 'light'));
    await o.page.click('[data-act=theme]');

    // 主畫面變動時同步(例如在主畫面改篩選)
    await sel(o.page, () => { const cb = [...document.querySelectorAll('#unitChecks input')][0]; cb.checked = false; cb.dispatchEvent(new Event('change')); });
    const live = await st();
    check('看板:主畫面篩選改變 → 看板即時同步', live.total === (await sel(o.page, () => getShiftFilteredRows(filteredRows).length)) && live.total < expectN, JSON.stringify(live));
    await sel(o.page, () => { document.querySelectorAll('#unitChecks input').forEach(c => c.checked = true); applyFilter(); });

    // Esc 關閉並還原
    await o.page.keyboard.press('Escape'); await o.page.waitForTimeout(100);
    check('看板:Esc 關閉,背景捲動還原', await sel(o.page, () => !DASH.open && !document.querySelector('.dash') && document.body.style.overflow === ''));
    // 再次開啟:篩選已重置
    await o.page.click('#dashBtn'); await o.page.waitForTimeout(150);
    check('看板:重新開啟為乾淨狀態', (await st()).total === (await sel(o.page, () => getShiftFilteredRows(filteredRows).length)));
    await o.page.click('[data-act=close]');

    // 空資料
    await sel(o.page, () => { filteredRows = []; });
    await sel(o.page, () => openDashboard());
    check('看板:沒有資料時不開啟並提示', o.dialogs.some(d => d.includes('沒有資料')) && (await sel(o.page, () => !DASH.open)));
    check('看板:無頁面錯誤', o.errors.length === 0, o.errors.join('|'));
    await o.ctx.close();
  }

  // 另開視窗:看板整個搬到新視窗(樣式一起帶過去),主畫面可同步;收回/關閉視窗都能還原
  {
    const o = await openPage();
    await sel(o.page, a => __loadAoa(a), aoa);
    await sel(o.page, () => { toggleDisaster(); applyAll(); openDashboard(); });
    const [pop] = await Promise.all([o.ctx.waitForEvent('page'), o.page.click('[data-act=pop]')]);
    await pop.waitForSelector('.dash.popped .tc');
    const p1 = await pop.evaluate(() => ({ bg: getComputedStyle(document.querySelector('.dash')).backgroundColor, tc: document.querySelectorAll('.tc').length }));
    check('另開視窗:看板搬到新視窗且樣式套用', p1.bg === 'rgb(10, 18, 32)' && p1.tc >= 2, JSON.stringify(p1));
    check('另開視窗:主畫面不再有看板、狀態仍為開啟', await sel(o.page, () => !document.querySelector('.dash') && DASH.open));
    await pop.click('.hb[data-f=unit] >> nth=0');
    check('另開視窗:在新視窗內可互動篩選', await sel(o.page, () => DASH.F.unit.size === 1) && await pop.evaluate(() => document.querySelectorAll('#dChips .chip').length === 2));
    await sel(o.page, () => { const cb = [...document.querySelectorAll('#unitChecks input')][1]; cb.checked = false; cb.dispatchEvent(new Event('change')); });
    const shown = await pop.evaluate(() => +document.querySelector('.kn[data-k=total]').dataset.to);   // 新視窗內沒有主畫面的全域函式,只讀畫面上的數字
    check('另開視窗:主畫面改篩選 → 新視窗同步(總件數一致)', shown === await sel(o.page, () => rowsFor().length) && await sel(o.page, () => DASH.X.length === getShiftFilteredRows(filteredRows).length));
    await pop.click('[data-act=dock]'); await o.page.waitForTimeout(150);
    check('收回:回到主畫面全螢幕、視窗關閉', await sel(o.page, () => !!document.querySelector('.dash') && !document.querySelector('.dash.popped') && document.body.style.overflow === 'hidden') && pop.isClosed());
    const [pop2] = await Promise.all([o.ctx.waitForEvent('page'), o.page.click('[data-act=pop]')]);
    await pop2.waitForSelector('.dash.popped');
    await pop2.close(); await o.page.waitForTimeout(200);
    check('直接關掉新視窗:看板關閉且主畫面還原', await sel(o.page, () => !DASH.open && document.body.style.overflow === ''));
    check('另開視窗:無對話框/錯誤', o.dialogs.length === 0 && o.errors.length === 0, o.dialogs.concat(o.errors).join('|'));
    await o.ctx.close();
  }

  // 手機寬度:看板不得橫向溢出
  {
    const o = await openPage(base + '/', { mobile: true });
    await sel(o.page, a => __loadAoa(a), aoa);
    await sel(o.page, () => { toggleDisaster(); applyAll(); openDashboard(); });
    await o.page.waitForTimeout(250);
    const m = await sel(o.page, () => { const d = document.querySelector('.dash'); return { sw: d.scrollWidth, cw: d.clientWidth, doc: document.documentElement.scrollWidth, iw: innerWidth,
      over: [...d.querySelectorAll('.card,.kpi,.hb,.li,.hm')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).length }; });
    check('手機:看板無橫向捲動、無元件超出螢幕', m.sw <= m.cw && m.doc <= m.iw && m.over === 0, JSON.stringify(m));
    check('手機:看板無錯誤', o.errors.length === 0 && o.dialogs.length === 0, o.errors.concat(o.dialogs).join('|'));
    await o.ctx.close();
  }

  // ═════ 4. 離線版(字型被封鎖仍須能匯 PDF) ═════
  {
    offlineFile = path.join(os.tmpdir(), 'wurt_offline_test.html');
    execFileSync('node', [path.join(ROOT, 'tools', 'build_offline.js'), offlineFile], { stdio: 'pipe' });
    const o = await openPage(base + '/__offline.html', { blockExternal: true });
    await sel(o.page, a => __loadAoa(a), aoa);
    await sel(o.page, () => { toggleDisaster(); applyAll(); });
    const r = await sel(o.page, () => __pdfRun());
    check('離線版:封鎖所有外部檔案(單一檔案)時仍可匯出 PDF', !r.error && r.header.startsWith('%PDF') && r.pages >= 1, r.error);
    check('離線版:無對話框', o.dialogs.length === 0, o.dialogs.join('|'));
    check('離線版:輸出與專案版一致(災害模式)', JSON.stringify(r.log.rows) === JSON.stringify(pdfD.log.rows));
    await o.ctx.close();
    fs.unlinkSync(offlineFile);
  }

  await browser.close(); server.close();

  if(UPDATE){
    fs.writeFileSync(GOLDEN_FILE, JSON.stringify(newGolden, null, 1) + '\n');
    console.log(`已更新基準:${Object.keys(newGolden).length} 筆快照 → tests/golden.json(其餘 ${pass} 項斷言${failures.length ? ',但有 ' + failures.length + ' 項失敗' : '通過'})`);
  } else {
    // 基準裡有、這次卻沒產生的快照,視為失敗(避免測試被悄悄跳過)
    for(const k of Object.keys(golden)) if(!(k in newGolden)) failures.push(`[快照] ${k}:基準存在但本次未執行`);
  }
  console.log(`\n通過 ${pass} 項` + (failures.length ? `,失敗 ${failures.length} 項:` : ',全部通過'));
  failures.forEach(f => console.log('  ✗ ' + f));
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('測試程式本身出錯:', e); process.exit(2); });
