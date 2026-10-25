/* ═══════════════════════════════════════════════════════════
 * js/pdfsummary.js — PDF「戰情摘要首頁」與災害模式各所頁首小計(選填,預設不勾)
 * 設計目標:長官 5 秒內看懂。由上而下:一句話結論 → 四個大數字 → 案件湧入趨勢 → 廠所×類別 → 行政區/路段前 5。
 * 統計一律來自 summary.js 的 computeSummary()(與畫面摘要、Excel 同一份),本檔只負責畫到 jsPDF。
 * 勾選項在匯出選單(#chkPdfSummary),由 exportPDF() 讀取;未勾選時 PDF 與原本完全相同。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

// 勾選項記憶(localStorage 可能不可用,一律 try/catch)
(function(){
  const box = document.getElementById('chkPdfSummary');
  if(!box) return;
  try { box.checked = localStorage.getItem('wurt.pdfSummary') === '1'; } catch(_) {}
  box.addEventListener('change', ev => { try { localStorage.setItem('wurt.pdfSummary', ev.target.checked ? '1' : '0'); } catch(_) {} });
})();

// 趨勢文字:「最新一小時(5/30 14時)9 件,前一小時 6 件,增加」;資料不足回傳 ''
function trendNote(S){
  const it = S.trend && S.trend.items;
  if(!it || it.length < 2) return '';
  const a = it[it.length - 1], b = it[it.length - 2];
  const u = S.trend.unit === 'hour' ? '小時' : '天';
  const mood = a.n > b.n ? '增加' : a.n < b.n ? '減少' : '持平';
  return `最新一${u}（${a.label}${S.trend.unit === 'hour' ? '時' : ''}）${a.n} 件，前一${u} ${b.n} 件，${mood}`;
}

// 一句話結論(自動產生)
function leadSentence(S){
  if(!S.total) return '目前沒有案件資料。';
  const kinds = [...SVC_STYLES.map(s => ({ label: s.label, n: S.svcTotals[s.key] })), { label: '其他', n: S.svcTotals.other }];
  const top = kinds.reduce((a, b) => b.n > a.n ? b : a);
  const parts = [`${S.latest ? '截至 ' + S.latest + ' ' : ''}共 ${S.total} 件，以${top.label}為主（${Math.round(top.n * 100 / S.total)}%）`];
  if(S.dists.length) parts.push(`最集中在${S.dists[0].label}（${S.dists[0].n} 件）`);
  if(S.roads.length) parts.push(`熱點路段為${S.roads[0].label}（${S.roads[0].n} 件）`);
  const tn = trendNote(S);
  return parts.join('；') + '。' + (tn ? tn + '。' : '');
}

// 災害模式各廠所頁首小計:「32 件｜修漏 20・供水 8・水質 4｜最多:汐止區　大同路二段 7 件」
function unitSubtotalLine(rows){
  const S = computeSummary(rows);
  const kinds = SVC_STYLES.map(s => ({ label: s.label, n: S.svcTotals[s.key] })).concat([{ label: '其他', n: S.svcTotals.other }]).filter(k => k.n);
  let t = `${S.total} 件｜${kinds.map(k => `${k.label} ${k.n}`).join('・')}`;
  if(S.dists.length) t += `｜最多：${S.dists[0].label} ${S.dists[0].n} 件`;
  if(S.roads.length) t += `；${S.roads[0].label} ${S.roads[0].n} 件`;
  return t;
}

// 畫一頁戰情摘要(呼叫前 doc 應在要畫的那一頁;用到 autoTable 與已註冊的 NotoSansTC)
function drawPdfSummary(doc, S, dateStr, modeLabel){
  const W = doc.internal.pageSize.width, L = 6, CW = W - 12;
  const font = (style, size, rgb) => { doc.setFont('NotoSansTC', style); doc.setFontSize(size); doc.setTextColor(...rgb); };

  // 標題帶
  doc.setFillColor(26, 58, 92); doc.rect(L, 6, CW, 9, 'F');
  font('bold', 10, [255, 255, 255]); doc.text('戰情摘要', L + 3, 12);
  font('normal', 7, [200, 220, 255]); doc.text(`${modeLabel}　${dateStr}`, W - L - 3, 12, { align: 'right' });

  // 一句話結論
  font('bold', 10.5, [26, 42, 58]);   // 先設字型再量寬,換行才準
  const lines = doc.splitTextToSize(leadSentence(S), CW - 8);
  const boxH = 6 + lines.length * 5.6;
  doc.setFillColor(254, 249, 231); doc.setDrawColor(245, 158, 11); doc.setLineWidth(0.4);
  doc.rect(L, 19, CW, boxH, 'FD');
  font('bold', 10.5, [26, 42, 58]); doc.text(lines, L + 4, 25.5);
  let y = 19 + boxH + 4;

  // 四個大數字:總件數 + 各類別(類別不足四個時留空,有「其他」時併入第四格說明)
  const cards = [{ label: '總件數', n: S.total, rgb: [26, 58, 92] }]
    .concat(SVC_STYLES.map(s => ({ label: s.label, n: S.svcTotals[s.key], rgb: hexToRgb(s.color) })));
  if(S.hasOther) cards.push({ label: '其他', n: S.svcTotals.other, rgb: [90, 100, 110] });
  const cw = (CW - 3 * (cards.length - 1)) / cards.length;
  cards.forEach((c, i) => {
    const x = L + i * (cw + 3);
    doc.setFillColor(244, 247, 251); doc.setDrawColor(200, 214, 229); doc.setLineWidth(0.2);
    doc.rect(x, y, cw, 19, 'FD');
    font('bold', 20, c.rgb); doc.text(String(c.n), x + cw / 2, y + 11.5, { align: 'center' });
    font('normal', 7.5, [90, 100, 110]); doc.text(c.label, x + cw / 2, y + 16.5, { align: 'center' });
  });
  y += 19 + 5;

  // 案件湧入趨勢(長條圖):最高的一根以紅色標示
  if(S.trend){
    const items = S.trend.items, max = Math.max(...items.map(i => i.n), 1);
    font('bold', 8.5, [26, 58, 92]);
    doc.text(`案件湧入趨勢（每${S.trend.unit === 'hour' ? '小時' : '天'}）`, L, y + 3);
    font('normal', 7, [90, 100, 110]);
    const tn = trendNote(S);
    if(tn) doc.text(tn, W - L, y + 3, { align: 'right' });
    const cx = L + 6, cy = y + 7, cwid = CW - 6, ch = 36;
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.15);
    doc.line(cx, cy + ch, cx + cwid, cy + ch);
    font('normal', 5.5, [120, 130, 140]);
    doc.text(String(max), cx - 1.5, cy + 2, { align: 'right' });
    doc.text('0', cx - 1.5, cy + ch, { align: 'right' });
    const slot = cwid / items.length, bw = Math.min(slot * 0.7, 9);
    const step = Math.ceil(items.length / 14);   // 標籤太密時隔幾根標一次
    items.forEach((it, i) => {
      const h = it.n ? Math.max(0.6, ch * it.n / max) : 0;
      const x = cx + i * slot + (slot - bw) / 2;
      const hot = it.n === max && max > 0;
      doc.setFillColor(...(hot ? [220, 38, 38] : [37, 99, 235]));
      if(h) doc.rect(x, cy + ch - h, bw, h, 'F');
      if(it.n && (items.length <= 24 || hot)){ font('bold', 5.5, hot ? [220, 38, 38] : [60, 70, 85]); doc.text(String(it.n), x + bw / 2, cy + ch - h - 0.8, { align: 'center' }); }
      if(i % step === 0 || i === items.length - 1){ font('normal', 5.5, [90, 100, 110]); doc.text(it.label, x + bw / 2, cy + ch + 3.5, { align: 'center' }); }
    });
    y = cy + ch + 8;
  }

  // 廠所 × 案件類別
  const cols = SVC_STYLES.map(s => ({ key: s.key, label: s.label }));
  if(S.hasOther) cols.push({ key: 'other', label: '其他' });
  const cell = n => n ? String(n) : '·';
  const tbl = {
    styles: { font: 'NotoSansTC', fontStyle: 'normal', fontSize: 7.5, cellPadding: 1.3, lineColor: [200, 214, 229], lineWidth: 0.2, textColor: [26, 42, 58] },
    headStyles: { fillColor: [26, 58, 92], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    theme: 'grid',
  };
  doc.autoTable(Object.assign({}, tbl, {
    startY: y, margin: { left: L, right: L },
    head: [['廠所', ...cols.map(c => c.label), '合計']],
    body: [...S.unitRows.map(r => [r.unit, ...cols.map(c => cell(r.counts[c.key])), String(r.total)]),
           ['合計', ...cols.map(c => cell(S.svcTotals[c.key])), String(S.total)]],
    columnStyles: Object.fromEntries([...cols.map((_, i) => [i + 1, { halign: 'center' }]), [cols.length + 1, { halign: 'center', fontStyle: 'bold' }]]),
    didParseCell(d){ if(d.section === 'body' && d.row.index === S.unitRows.length){ d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [232, 240, 250]; } },
  }));
  y = doc.lastAutoTable.finalY + 5;

  // 行政區前 5 / 路段前 5(左右並排)
  const half = (CW - 4) / 2;
  const pct = n => Math.round(n * 100 / S.total) + '%';
  doc.autoTable(Object.assign({}, tbl, {
    startY: y, margin: { left: L, right: W - L - half },
    head: [['行政區 前 5', '件數', '佔比']],
    body: S.dists.slice(0, 5).map(d => [d.label, String(d.n), pct(d.n)]),
    columnStyles: { 1: { halign: 'center', cellWidth: 14 }, 2: { halign: 'center', cellWidth: 14 } },
  }));
  const yA = doc.lastAutoTable.finalY;
  doc.autoTable(Object.assign({}, tbl, {
    startY: y, margin: { left: L + half + 4, right: L },
    head: [['路段 前 5（同路段 2 件以上）', '件數']],
    body: S.roads.length ? S.roads.slice(0, 5).map(r => [r.label, String(r.n)]) : [['（無）', '']],
    columnStyles: { 1: { halign: 'center', cellWidth: 14 } },
  }));
  const yB = doc.lastAutoTable.finalY;
  font('normal', 6.5, [120, 130, 140]);
  doc.text('統計依本次匯出範圍計算；路段由地址判讀，無法判讀者不列入。明細自下一頁起。', L, Math.max(yA, yB) + 5);
}
