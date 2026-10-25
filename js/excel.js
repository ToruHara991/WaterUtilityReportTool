/* ═══════════════════════════════════════════════════════════
 * js/excel.js — 匯出 Excel(每個廠所一個分頁)
 * 選填項(匯出選單內,預設不勾):加「處理情形／完成時間」空白欄、加「統計摘要」分頁。
 * 資料來源與 PDF/圖片相同(getShiftFilteredRows(filteredRows)),欄位來自 COLUMNS。
 * 註:SheetJS 社群版不支援儲存格樣式,故無底色/粗體;僅設定欄寬與篩選。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

const XL_REPLY = [{ hdr: '處理情形', w: 28 }, { hdr: '完成時間', w: 14 }];   // 選填:給各所回填

// 選填項記憶(localStorage 可能不可用,一律 try/catch)
function xlOptLoad(){
  try {
    document.getElementById('chkXlReply').checked   = localStorage.getItem('wurt.xlReply') === '1';
    document.getElementById('chkXlSummary').checked = localStorage.getItem('wurt.xlSummary') === '1';
  } catch(_) {}
  const save = (id, key) => document.getElementById(id).addEventListener('change', ev => {
    try { localStorage.setItem(key, ev.target.checked ? '1' : '0'); } catch(_) {}
  });
  save('chkXlReply', 'wurt.xlReply'); save('chkXlSummary', 'wurt.xlSummary');
}
xlOptLoad();

// 分頁名稱:去除 Excel 禁用字元、限 31 字、重複時加序號
function xlSheetName(name, used){
  let base = String(name || '').replace(/[\[\]:*?\/\\]/g, '').trim().slice(0, 28) || '未分類';
  let n = base, i = 2;
  while(used.has(n.toLowerCase())) n = base + '_' + (i++);
  used.add(n.toLowerCase());
  return n;
}

// 統計摘要分頁的二維陣列(完整清單,不受畫面「前 8 名」限制)
function xlSummaryAoa(rows){
  const S = computeSummary(rows);
  const cols = SVC_STYLES.map(s => ({ key: s.key, label: s.label }));
  if(S.hasOther) cols.push({ key: 'other', label: '其他' });
  const now = new Date();
  const aoa = [
    ['案件統計摘要'],
    ['資料筆數', S.total, '產製日期', `${now.getMonth() + 1}/${now.getDate()}`],
    S.peak ? ['案件高峰時段', S.peak.label, '件數', S.peak.n] : ['案件高峰時段', '—'],
    [],
    ['各廠所 × 案件類別'],
    ['廠所', ...cols.map(c => c.label), '合計'],
    ...S.unitRows.map(r => [r.unit, ...cols.map(c => r.counts[c.key]), r.total]),
    ['合計', ...cols.map(c => S.svcTotals[c.key]), S.total],
    [],
    ['行政區排行'],
    ['行政區', '件數', '佔比(%)', '廠所'],
    ...S.dists.map(d => [d.label, d.n, Math.round(d.n * 1000 / S.total) / 10, d.units.join('、')]),
    [],
    ['路段排行(同一路段 2 件以上)'],
    ['路段', '件數'],
    ...(S.roads.length ? S.roads.map(r => [r.label, r.n]) : [['（無）', '']]),
  ];
  if(S.roadUnknown) aoa.push([`另有 ${S.roadUnknown} 件地址無法判讀路段,未計入路段排行`]);
  return aoa;
}

// opts: { reply:boolean, summary:boolean };回傳 SheetJS workbook
function buildExcelWorkbook(rows, opts){
  const wb = XLSX.utils.book_new();
  const used = new Set();
  if(opts.summary){
    const ws = XLSX.utils.aoa_to_sheet(xlSummaryAoa(rows));
    ws['!cols'] = [{ wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 24 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, xlSheetName('統計摘要', used));
  }
  const extra = opts.reply ? XL_REPLY : [];
  const hdr = [...COLUMNS.map(c => c.hdr.replace(/\n/g, '')), ...extra.map(x => x.hdr)];
  const wch = [...COLUMNS.map(c => ({ wch: c.xlW })), ...extra.map(x => ({ wch: x.w }))];

  const groups = new Map();
  for(const r of rows){
    const u = r.unit || '（未分類）';
    if(!groups.has(u)) groups.set(u, []);
    groups.get(u).push(r);
  }
  for(const unit of orderUnits(groups.keys())){
    // 值一律為原始字串(不做後4碼換行),電話/編號的開頭 0 才不會被吃掉
    const aoa = [hdr, ...groups.get(unit).map(r => [...COLUMNS.map(c => c.val(r)), ...extra.map(() => '')])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = wch;
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: hdr.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, xlSheetName(unit, used));
  }
  return wb;
}

function exportExcel(){
  document.getElementById('exportMenu').style.display = 'none';
  const rows = getShiftFilteredRows(filteredRows);
  if(!rows.length){ alert('目前沒有資料，請先上傳並整理後再匯出。'); return; }
  const opts = { reply: document.getElementById('chkXlReply').checked, summary: document.getElementById('chkXlSummary').checked };
  try {
    const arr = XLSX.write(buildExcelWorkbook(rows, opts), { type: 'array', bookType: 'xlsx' });
    const now = new Date();
    const name = `${disasterMode ? '災害模式_' : ''}案件明細_Excel_${now.getMonth() + 1}${now.getDate()}_${rows.length}筆.xlsx`;
    document.getElementById('exportOverlay').classList.add('show');
    // octet-stream:避免部分瀏覽器把 blob 當文件開啟(與 PDF 相同做法)
    showFileConfirm(new Blob([arr], { type: 'application/octet-stream' }), name, '📗 Excel 已產生', '⬇ 下載 Excel');
  } catch(err){
    alert('Excel 匯出失敗：' + err.message);
    console.error(err);
  }
}
