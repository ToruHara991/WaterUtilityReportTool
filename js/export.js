/* ═══════════════════════════════════════════════════════════
 * js/export.js — 匯出:圖片(html2canvas)與 PDF(jsPDF + autoTable)
 * loadFonts(字型,支援離線版內嵌)、exportPDF(平常/災害模式)、exportImage、匯出選單與下載確認卡。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

// ══════════════════════════════════════
// html2canvas 匯出引擎
// （直接截取 HTML 表格，排版與畫面完全一致）
// ══════════════════════════════════════

function setProgress(pct, txt){
  document.getElementById('expProgressBar').style.width = pct+'%';
  if(txt) document.getElementById('expSubText').textContent = txt;
}
function tick(){ return new Promise(r=>setTimeout(r,16)); }

/* ── 下載確認卡 ── */
function showDlConfirm(dataUrl, filename){
  // 隱藏進度條，顯示確認卡
  document.getElementById('expProgressArea').style.display = 'none';
  document.querySelector('#dlConfirm .dlc-title').textContent = '🖼️ 圖片已產生';
  document.getElementById('dlConfirmBtn').textContent = '⬇ 下載圖片';
  document.getElementById('dlConfirmBtn').style.display = '';
  document.getElementById('dlConfirmBtn2').style.display = 'none';
  document.getElementById('dlConfirmSub').textContent = filename;
  const card = document.getElementById('dlConfirm');
  card.classList.add('show');
  // 綁定下載按鈕
  const btn = document.getElementById('dlConfirmBtn');
  btn.onclick = () => {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = filename; a.click();
    closeDlConfirm();
  };
}
function closeDlConfirm(){
  document.getElementById('exportOverlay').classList.remove('show');
  document.getElementById('dlConfirm').classList.remove('show');
  document.getElementById('dlConfirmBtn2').style.display = 'none';
  document.getElementById('expProgressArea').style.display = 'flex';
  setProgress(0,'');
  document.getElementById('expTitle').textContent = '🖼️ 正在產生圖片…';
}

function showExportMenu(){
  const menu = document.getElementById('exportMenu');
  const btn  = document.getElementById('screenshotBtn');
  if(menu.style.display === 'none'){
    const r = btn.getBoundingClientRect();
    menu.style.display = 'block';
    menu.style.position = 'fixed';
    menu.style.top  = (r.bottom + 4) + 'px';
    menu.style.left = Math.max(4, r.left) + 'px';
    menu.style.right = 'auto';
    // 手機窄螢幕:選單不可超出右邊界
    const over = menu.getBoundingClientRect().right - (window.innerWidth - 4);
    if(over > 0) menu.style.left = Math.max(4, r.left - over) + 'px';
    setTimeout(()=>document.addEventListener('click', closeExportMenu, {once:true}), 10);
  } else {
    menu.style.display = 'none';
  }
}
function closeExportMenu(){ document.getElementById('exportMenu').style.display='none'; }

// 字型快取（只 fetch 一次）
let _fontRegular = null, _fontBold = null;

async function loadFonts(){
  if(_fontRegular && _fontBold) return;
  // 用頁面所在目錄當基準，子目錄部署（如 GitHub Pages）也能正確找到字型
  const base = window.location.href.replace(/\/[^/]*$/, '/');
  const toBase64 = async (filename) => {
    // 離線單檔版(tools/build_offline.js 產生)會把 base64 字型放在 window.__EMBEDDED_FONTS,
    // 有的話直接用,免 fetch,可在 file:// 雙擊開啟時使用。專案版沒有此變數,照舊 fetch。
    const embedded = (window.__EMBEDDED_FONTS || {})[filename];
    if(embedded) return embedded;
    const url = base + filename;
    const res = await fetch(url);
    if(!res.ok) throw new Error(`字型載入失敗：${url}（${res.status}）`);
    const buf = await res.arrayBuffer();
    // 用 FileReader 處理大型二進位，避免 btoa 字串長度限制
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(new Blob([buf]));
    });
  };
  [_fontRegular, _fontBold] = await Promise.all([
    toBase64('NotoSansTC-Regular.ttf'),
    toBase64('NotoSansTC-Bold.ttf'),
  ]);
}

/* ── PDF 確認卡：只提供「下載」（檔案含個資，不提供系統分享面板，避免誤傳）──
   以 octet-stream 觸發下載，避免 Safari 開 blob 預覽頁 */
function showPdfConfirm(blob, filename){ showFileConfirm(blob, filename, '📑 PDF 已產生', '⬇ 下載 PDF'); }

// 檔案(PDF/Excel)通用的下載確認卡
function showFileConfirm(blob, filename, title, btnText){
  document.getElementById('expProgressArea').style.display = 'none';
  document.querySelector('#dlConfirm .dlc-title').textContent = title;
  document.getElementById('dlConfirmSub').textContent = filename;
  document.getElementById('dlConfirm').classList.add('show');

  // 隱藏第一顆按鈕（圖片用），PDF 只使用「下載 PDF」
  document.getElementById('dlConfirmBtn').style.display = 'none';

  const dlBtn = document.getElementById('dlConfirmBtn2');
  dlBtn.textContent = btnText;
  dlBtn.style.display = '';
  dlBtn.onclick = () => {
    // 用 octet-stream 而非 application/pdf，Safari 才不會把 blob 當 PDF 開成預覽頁
    const dlBlob = new Blob([blob], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(dlBlob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    // 確認卡保持開啟，若下載沒反應可再按一次；完成後按「取消」關閉
  };
}

async function exportPDF(){
  document.getElementById('exportMenu').style.display='none';
  if(!filteredRows.length){ alert('目前沒有資料，請先上傳並整理後再匯出。'); return; }
  if(!totalChunks.length){ alert('請先確認分頁設定。'); return; }

  const ov = document.getElementById('exportOverlay');
  document.getElementById('expTitle').textContent = '📑 正在產生 PDF…';
  ov.classList.add('show');
  setProgress(5, '載入字型中…');
  await tick();

  try {
    await loadFonts();
  } catch(err) {
    ov.classList.remove('show');
    setProgress(0,'');
    document.getElementById('expTitle').textContent = '🖼️ 正在產生圖片…';
    alert('字型載入失敗，請確認 NotoSansTC-Regular.ttf / NotoSansTC-Bold.ttf 與 HTML 放在同一目錄。\n' + err.message);
    return;
  }

  const snap = document.getElementById('snapWrap');
  const now = new Date();
  const dateStr = `${now.getMonth()+1}/${now.getDate()}`;
  const total = totalChunks.length;

  const { jsPDF } = window.jspdf;

  // 服務類別文字色(RGB):與網頁/圖片共用 SVC_STYLES 的同一個 hex
  const svcRgb = svc => hexToRgb((svcStyle(svc) || {}).color || SVC_DEFAULT_COLOR);

  try {
    // A4 直式
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });

    // 注入中文字型
    doc.addFileToVFS('NotoSansTC-Regular.ttf', _fontRegular);
    doc.addFont('NotoSansTC-Regular.ttf', 'NotoSansTC', 'normal');
    doc.addFileToVFS('NotoSansTC-Bold.ttf', _fontBold);
    doc.addFont('NotoSansTC-Bold.ttf', 'NotoSansTC', 'bold');
    doc.setFont('NotoSansTC');

    // 表頭與欄寬(mm,A4 直式可用寬約 198mm、margin 各 6mm)來自 COLUMNS
    const A4_W = doc.internal.pageSize.width;

    // 共用的 autoTable 設定工廠:styles / headStyles / columnStyles(含特調欄寬)
    // 平常模式與災害模式完全共用,只有 body、染色規則、startY、頂部留白與頁首重繪不同。
    function makeTableOpts(rows, fillFor){
      const columnStyles = {};
      COLUMNS.forEach((c, i) => {
        columnStyles[i] = c.align === 'center' ? { cellWidth:c.pdfW, halign:'center' } : { cellWidth:c.pdfW };
      });
      return {
        head: [COLUMNS.map(c => c.hdr)],
        body: rows.map(r => COLUMNS.map(c => c.split4 ? split4Pdf(c.val(r)) : c.val(r))),
        styles: {
          font: 'NotoSansTC', fontStyle: 'normal', fontSize: 7, cellPadding: 1.5,
          valign: 'top', overflow: 'linebreak',
          lineColor: [200,214,229], lineWidth: 0.2, textColor: [26,42,58],
        },
        headStyles: {
          fillColor: [26,58,92], textColor: [255,255,255], fontSize: 7,
          font: 'NotoSansTC', fontStyle: 'bold', halign: 'center', cellPadding: 2,
        },
        columnStyles,
        didParseCell(data){
          if(data.section === 'body'){
            const r = rows[data.row.index];
            if(!r) return;
            // fillFor:傳回該列底色 hex(或 null)。平常模式=廠所,災害模式=行政區(見 rowFill)。
            const hex = fillFor ? fillFor(r) : null;
            if(hex) data.cell.styles.fillColor = hexToRgb(hex);
            if(COLUMNS[data.column.index].svc){
              data.cell.styles.textColor = svcRgb(r.svc);
              data.cell.styles.fontStyle = 'bold';
            }
          }
        },
      };
    }

    // ══════════ 災害模式:每廠所一組、各自從新頁開始、行政區染色 ══════════
    if(disasterMode){
      const allRows = getShiftFilteredRows(filteredRows);
      // 依 FIXED_UNITS 順序分組,其餘廠所排後面
      const groups = new Map();           // unit -> rows[]
      for(const r of allRows){
        const u = r.unit || '（未分類）';
        if(!groups.has(u)) groups.set(u, []);
        groups.get(u).push(r);
      }
      const orderedUnits = orderUnits(groups.keys());
      const gtotal = orderedUnits.length;

      for(let gi=0; gi<gtotal; gi++){
        const unit = orderedUnits[gi];
        const rows = groups.get(unit);
        setProgress(Math.round(15 + (gi/gtotal)*75), `產生 ${unit}（${gi+1}/${gtotal} 個廠所）…`);
        await tick();

        if(gi > 0) doc.addPage();

        // 該廠所內出現的行政區(依出現順序),放進頁首帶狀列當小提示
        const distsHere = [];
        const seen = new Set();
        for(const r of rows){ const k=distKey(r); if(!seen.has(k)){seen.add(k);distsHere.push(k);} }

        // 頁首帶狀列的繪製:封裝起來,讓續表(同廠所跨頁)時也能在每頁頂端重印
        const drawUnitBand = () => {
          doc.setFillColor(26,58,92);
          doc.rect(6, 6, A4_W-12, 7, 'F');
          doc.setFont('NotoSansTC','bold');
          doc.setFontSize(8);
          doc.setTextColor(255,255,255);
          doc.text(`🚨 ${unit}　${rows.length} 件`, 9, 11.5);
          doc.setFont('NotoSansTC','normal');
          doc.setFontSize(7);
          doc.setTextColor(200,220,255);
          doc.text(`行政區 ${distsHere.length} 區　${dateStr}`, A4_W-9, 11.5, {align:'right'});
        };

        const opts = makeTableOpts(rows, rowFill);
        opts.startY = 15;
        opts.margin = { left:6, right:6, top:15 };   // top:15 讓續表頁也在帶狀列下方開始
        opts.didDrawPage = drawUnitBand;             // 每一頁(含續表)頂端重印廠所帶狀列
        opts.rowPageBreak = 'avoid';                 // 整列不跨頁:一件案件的資料不會被分頁線切成兩半
        doc.autoTable(opts);
      }

      // 跳過下方平常模式的 totalChunks 迴圈
      setProgress(95, '產生檔案…');
      await tick();
      const pdfName = `災害模式_案件明細_${now.getMonth()+1}${now.getDate()}_${allRows.length}筆.pdf`;
      const pdfBlob = doc.output('blob');
      setProgress(100, '完成！');
      await tick();
      showPdfConfirm(pdfBlob, pdfName);
      return;
    }
    // ══════════ 平常模式(原行為不變) ══════════

    for(let ci = 0; ci < total; ci++){
      const chunk = totalChunks[ci];
      const pct = Math.round(15 + (ci / total) * 75);
      setProgress(pct, `產生第 ${ci+1} / ${total} 頁…`);
      await tick();

      if(ci > 0) doc.addPage();

      // 頁面標題列（A4_W 已於 try 區塊頂端宣告）
      doc.setFillColor(26,58,92);
      doc.rect(6, 6, A4_W-12, 7, 'F');
      doc.setFont('NotoSansTC','bold');
      doc.setFontSize(8);
      doc.setTextColor(255,255,255);
      doc.text(`第 ${ci+1} 頁 / 共 ${total} 頁`, 9, 11.5);
      doc.setFont('NotoSansTC','normal');
      doc.setFontSize(7);
      doc.setTextColor(200,220,255);
      doc.text(`${chunk.length} 列　${dateStr}`, A4_W-9, 11.5, {align:'right'});

      const opts = makeTableOpts(chunk, rowFill);   // 與災害模式共用同一份表格設定
      opts.startY = 15;
      opts.margin = { left:6, right:6 };
      doc.autoTable(opts);
    }

    setProgress(95, '產生檔案…');
    await tick();

    // 不再呼叫 doc.save()：它在 iOS 會以 blob: 網址下載，檔案帶著來源網址，
    // 傳到 LINE 時會多出一則 blob 連結。改為產生 Blob，由使用者按鈕後分享。
    const pdfName = `案件明細_PDF_${now.getMonth()+1}${now.getDate()}_${filteredRows.length}筆.pdf`;
    const pdfBlob = doc.output('blob');
    setProgress(100, '完成！');
    await tick();
    showPdfConfirm(pdfBlob, pdfName);   // 確認卡留在畫面上，等使用者按「分享 / 儲存」

  } catch(err){
    snap.style.visibility = 'hidden';
    snap.innerHTML = '';
    ov.classList.remove('show');
    setProgress(0,'');
    document.getElementById('expTitle').textContent = '🖼️ 正在產生圖片…';
    alert('PDF 匯出失敗：' + err.message);
    console.error(err);
  }
}

async function exportImage(scope){
  document.getElementById('exportMenu').style.display='none';
  if(!filteredRows.length){ alert('目前沒有資料，請先上傳並整理後再匯出。'); return; }

  const targetRows = (scope === 'page')
    ? (totalChunks[curPage] || getShiftFilteredRows(filteredRows))
    : getShiftFilteredRows(filteredRows);

  const ov = document.getElementById('exportOverlay');
  ov.classList.add('show');
  setProgress(10, '建立表格中…');
  await tick();

  const pagerBar = document.getElementById('pagerBar');
  const snap = document.getElementById('snapWrap');

  try {
    // ── 0. 截圖前隱藏分頁提示列 ──
    pagerBar.style.visibility = 'hidden';

    // 欄寬與表頭來自 COLUMNS;後4碼換行規則為共用的 split4Html(內部已 e() 逸出)
    const COL_WIDTHS = COLUMNS.map(c=>c.imgW);
    const HDRS = COLUMNS.map(c=>c.hdr);

    // 分頁標題
    const pageTag = scope === 'page'
      ? `第 ${curPage+1} 頁 / 共 ${totalChunks.length} 頁`
      : `全部資料`;
    const now = new Date();
    const dateStr = `${now.getMonth()+1}/${now.getDate()}`;

    // 用 inline style 確保 html2canvas 能正確套用（不依賴外部 CSS class）
    const colgroup = COL_WIDTHS.map(w=>`<col style="width:${w}px">`).join('');

    const thead = `<thead><tr style="background:#1a3a5c">${
      HDRS.map(h=>`<th style="
        background:#1a3a5c;color:#fff;padding:5px 3px;text-align:center;
        vertical-align:middle;line-height:1.3;word-break:break-all;white-space:pre-wrap;
        border:1px solid rgba(255,255,255,.18);font-size:11px;font-weight:700;
        box-sizing:border-box;
      ">${h.replace(/\n/g,'<br>')}</th>`).join('')
    }</tr></thead>`;

    const tbody = targetRows.map((r, ri)=>{
      const { bg } = getRowMeta(r);
      const zebra = (!sorted && ri%2===1) ? 'filter:brightness(0.97)' : '';
      // 所有欄位值在插入 innerHTML 前都先經過 e() 逸出，避免 Excel 來源資料
      // 中夾帶的 HTML/腳本片段（例如問題描述、地址欄）在截圖容器中被執行。
      // split4Html() 內部已自行呼叫 e()，故不重複逸出。
      const cells = COLUMNS.map(col=>{
        const c = { v: col.split4 ? split4Html(col.val(r)) : e(col.val(r)), align: col.align };
        const st = col.svc ? svcStyle(r.svc) : null;   // 服務類別欄的文字色/粗細
        const color = st ? st.color : SVC_DEFAULT_COLOR;
        const fontWeight = st ? st.weight : 'normal';
        // split4 欄位已含 <br>，直接插入；其餘依 imgClamp 限制行數(問題描述 4 行、廠所/姓名 2 行)
        const innerStyle = col.split4
          ? 'line-height:1.3;'
          : (col.imgClamp
              ? `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${col.imgClamp};overflow:hidden;`
              : '');
        return `<td style="
          padding:2px 3px;vertical-align:top;
          border:1px solid #c8d6e5;word-break:break-all;line-height:1.3;
          overflow:hidden;text-align:${c.align};
          color:${color};font-weight:${fontWeight};
          box-sizing:border-box;font-size:12px;
        "><div style="${innerStyle}max-height:4em;overflow:hidden;">${c.v}</div></td>`;  // 輸出圖片高度
      }).join('');
      return `<tr style="background:${bg};${zebra}">${cells}</tr>`;
    }).join('');

    // 分頁標題（含廠所、案件統計）— units 來自 Excel 廠所欄位，同樣需要逸出
    const units = [...new Set(targetRows.map(r=>r.unit).filter(Boolean))].map(u=>e(u)).join('・');
    const pillsHtml = svcPillsHtml(targetRows, '9px', 700);

    const caption = `<div style="
      background:#1a3a5c;color:#fff;font-size:10px;padding:3px 8px;
      display:flex;justify-content:space-between;align-items:center;font-weight:700;
    ">
      <span>${pageTag}<span style="opacity:.6;font-weight:400;margin-left:8px;font-size:9px">${units}</span></span>
      <span style="display:flex;align-items:center;gap:5px">${pillsHtml}<span style="opacity:.55;font-weight:400;font-size:9px">${targetRows.length} 列 ｜ ${dateStr}</span></span>
    </div>`;

    snap.innerHTML = caption + `<table style="
      border-collapse:collapse;table-layout:fixed;width:760px;
      font-size:11px;font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif;
    "><colgroup>${colgroup}</colgroup>${thead}<tbody>${tbody}</tbody></table>`;

    snap.style.visibility = 'visible';

    setProgress(40, '渲染表格中…');
    await tick();
    await tick(); // 讓瀏覽器完成 layout

    // ── 2. html2canvas 截圖 ──
    setProgress(60, '截圖中…');
    await tick();

    const canvas = await html2canvas(snap, {
      scale: 2,              // 2x 高解析度
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      width:  snap.scrollWidth,
      height: snap.scrollHeight,
      windowWidth: 800,
    });

    setProgress(90, '產生圖片…');
    await tick();

    const dataUrl = canvas.toDataURL('image/jpeg');

    const fScope = scope === 'page' ? `_第${curPage+1}頁` : '_全部';
    const filename = `水務案件${fScope}_${now.getMonth()+1}${now.getDate()}_${targetRows.length}筆.jpeg`;

    setProgress(100, '完成！');
    await tick();

    // 進度條原地變成確認卡
    showDlConfirm(dataUrl, filename);

  } catch(err){
    closeDlConfirm();
    alert('匯出失敗：' + err.message);
    console.error(err);
  } finally {
    // 不論成功或失敗都一定執行：避免任一步驟拋例外時，pagerBar 永遠隱藏
    // 或 snapWrap 殘留內容（原版的清理程式碼分散在成功路徑與 catch 兩處，
    // 任一處提早出錯都可能導致另一處清理被跳過）。
    snap.style.visibility = 'hidden';
    snap.innerHTML = '';
    pagerBar.style.visibility = '';
  }
}
