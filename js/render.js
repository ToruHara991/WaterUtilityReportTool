/* ═══════════════════════════════════════════════════════════
 * js/render.js — 畫面繪製:分頁、網頁表格、圖例、狀態列
 * renderFiltered/renderPage/goPg(分頁畫面)、getRowMeta/buildTable(網頁表格)、renderLegend、setSt/showOv。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

// ══════════════════════════════════════
// Render
// ══════════════════════════════════════
function render(){
  // 注意：先前版本在此處會用 filteredRows=[...dispRows] 覆蓋目前的篩選結果，
  // 導致使用者切換「分頁」勾選框或「每頁列數」時，已套用的廠所／服務類別篩選
  // 會被靜默重置。render() 只負責「依目前 filteredRows 重新繪製」，
  // filteredRows 的內容一律交由 applyAll()/resetRaw()/applyFilter() 維護。
  renderFiltered();
}

function renderFiltered(){
  const pg=document.getElementById('pages');
  // 統一在此套用「依時段篩選」（若已勾選），確保畫面顯示與所有匯出
  // （PDF／單頁圖片／全部資料圖片）共用同一份 totalChunks 來源，
  // 不再用「暫時覆寫 filteredRows 再還原」的方式各自為政。
  const rows = getShiftFilteredRows(filteredRows);
  refreshSummary(rows);   // 統計摘要(收合時不計算)
  if(!rows.length){
    pg.innerHTML='<div style="text-align:center;padding:40px;color:#888">無資料</div>';
    document.getElementById('pagerBar').classList.remove('show');
    totalChunks=[];
    return;
  }

  const split=document.getElementById('chkSplit').checked;
  const rpp=Math.max(3,parseInt(document.getElementById('rpPage').value)||15);

  if(split){
    totalChunks=[];
    for(let i=0;i<rows.length;i+=rpp) totalChunks.push(rows.slice(i,i+rpp));
  } else {
    totalChunks=[rows];
  }

  if(curPage>=totalChunks.length) curPage=0;
  renderPage(curPage);
}

function renderPage(idx){
  curPage=idx;
  const pg=document.getElementById('pages');
  const split=document.getElementById('chkSplit').checked;
  const total=totalChunks.length;
  const chunk=totalChunks[idx];

  pg.innerHTML='';
  const blk=document.createElement('div');
  blk.className='page-block';

  if(split && total>1){
    // 廠所名來自 Excel,插入 innerHTML 前須逸出(與圖片匯出的頁首一致)
    const units=[...new Set(chunk.map(r=>r.unit).filter(Boolean))].map(u=>e(u)).join('・');
    const pills = svcPillsHtml(chunk, '.62rem', 600);   // 目前頁各案件類別件數
    blk.innerHTML=`<div class="page-cap">
      <span>第 ${idx+1} 頁 / 共 ${total} 頁<span style="opacity:.6;font-weight:400;margin-left:8px;font-size:.62rem">${units}</span></span>
      <span style="display:flex;align-items:center;gap:5px">${pills}<span style="opacity:.55;font-weight:400;font-size:.62rem">${chunk.length} 列</span></span>
    </div>`;
  }
  const wrap=document.createElement('div');
  wrap.className='t-wrap';
  wrap.innerHTML=buildTable(chunk);
  blk.appendChild(wrap);
  pg.appendChild(blk);

  const pagerBar=document.getElementById('pagerBar');
  if(split && total>1){
    pagerBar.classList.add('show');
    document.getElementById('pgInfo').textContent=`第 ${idx+1} 頁 / 共 ${total} 頁`;
    document.getElementById('btnPrev').disabled=(idx===0);
    document.getElementById('btnNext').disabled=(idx===total-1);
    document.getElementById('pgInput').value=idx+1;
    document.getElementById('pgInput').max=total;

    const btnsDiv=document.getElementById('pgBtns');
    btnsDiv.innerHTML='';
    const showPgs=pageRange(idx,total);
    let last=-1;
    showPgs.forEach(p=>{
      if(last>=0 && p>last+1){
        const sp=document.createElement('span');
        sp.textContent='…'; sp.style.cssText='font-size:.72rem;color:var(--sub);padding:0 2px;';
        btnsDiv.appendChild(sp);
      }
      const b=document.createElement('button');
      b.className='pnav-btn'+(p===idx?' cur':'');
      b.textContent=p+1;
      b.onclick=()=>goPg(p);
      btnsDiv.appendChild(b);
      last=p;
    });
  } else {
    pagerBar.classList.remove('show');
  }

  window.scrollTo({top:0,behavior:'instant'});
}

function pageRange(cur,total){
  const set=new Set([0,total-1]);
  for(let i=Math.max(0,cur-1);i<=Math.min(total-1,cur+1);i++) set.add(i);
  return [...set].sort((a,b)=>a-b);
}

function goPg(idx){
  if(idx<0||idx>=totalChunks.length) return;
  renderPage(idx);
}

// 單一來源：判斷一列資料的顯示屬性（背景色、服務類別樣式），
// 供 buildTable()（網頁表格）與 exportImage()（截圖匯出）共用，
// 避免同一條「排序後依廠所染色」規則散落在兩個函式中各維護一份。
function getRowMeta(r){
  // 底色規則見 rowFill()(災害模式=行政區、平常模式=廠所);服務類別 class 見 SVC_STYLES
  const st = svcStyle(r.svc);
  return { bg: rowFill(r) || '#fff', svcCls: st ? st.cls : '' };
}

function buildTable(rows){
  // 欄位順序/表頭/col class 皆來自 COLUMNS(欄寬數值在上方 CSS col.cA~cL)
  let h=`<table><colgroup>${COLUMNS.map(c=>`<col class="${c.webCol}">`).join('')}</colgroup>`;
  h+=`<thead><tr>${COLUMNS.map(c=>`<th>${e(c.hdr)}</th>`).join('')}</tr></thead><tbody>`;
  for(const r of rows){
    const {bg, svcCls:sc} = getRowMeta(r);
    const tds = COLUMNS.map(c=>{
      const inner = c.split4 ? split4Html(c.val(r)) : e(c.val(r));
      const tdAttr = c.tdCls ? ` class="${c.tdCls}"` : '';
      const clip = c.svc ? `clip ${sc}` : 'clip';
      return `<td${tdAttr}><div class="${clip}">${inner}</div></td>`;
    });
    h+=`<tr style="background:${bg}">\n      ${tds.join('\n      ')}\n    </tr>`;
  }
  return h+'</tbody></table>';
}

function renderLegend(){
  const lg=document.getElementById('legend');
  if(disasterMode){
    // 災害模式:圖例顯示行政區色,依 dispRows 出現順序
    const dists=[];
    const seen=new Set();
    for(const r of dispRows){ const k=distKey(r); if(!seen.has(k)){seen.add(k);dists.push(k);} }
    if(!dists.length){lg.classList.remove('show');return;}
    lg.innerHTML='<span style="font-size:.72rem;color:var(--sub);margin-right:4px">行政區色：</span>'+
      dists.map(d=>`<span class="leg-item"><span class="leg-swatch" style="background:${distColors[d]||'#fff'}"></span>${e(d)}</span>`).join('');
    lg.classList.add('show');
    return;
  }
  const units=[...new Set(dispRows.map(r=>r.unit).filter(Boolean))];
  if(!units.length){lg.classList.remove('show');return;}
  lg.innerHTML='<span style="font-size:.72rem;color:var(--sub);margin-right:4px">廠所色：</span>'+
    units.map(u=>`<span class="leg-item"><span class="leg-swatch" style="background:${unitColors[u]||'#fff'}"></span>${e(u)}</span>`).join('');
  lg.classList.add('show');
}

function setSt(m){document.getElementById('st').textContent=m;}
function showOv(s){document.getElementById('overlay').classList.toggle('show',s);}
