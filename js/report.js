/* ═══════════════════════════════════════════════════════════
 * js/report.js — 時段篩選與「業務課報告文字」
 * parseShiftRange/timeInShift/getShiftFilteredRows(時段判斷,含跨年)、buildShiftOptions、buildMsg、copyMsg。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

// ══════════════════════════════════════
// 時段篩選輔助函數
// ══════════════════════════════════════

/**
 * 解析 shiftSel 的 value 字串，回傳時段區間物件。
 * 支援兩種格式：
 *   跨日：「5/30(17:00)－5/31(08:00)」
 *   同日：「5/31(08:00－12:00)」
 */
function parseShiftRange(val){
  if(!val) return null;
  // 跨日型：mo/d(HH:MM)－mo/d(HH:MM)
  const cross=val.match(/(\d+)\/(\d+)\((\d+):(\d+)\)[－\-]+(\d+)\/(\d+)\((\d+):(\d+)\)/);
  if(cross){
    return {sMo:+cross[1],sD:+cross[2],sH:+cross[3],sMin:+cross[4],
            eMo:+cross[5],eD:+cross[6],eH:+cross[7],eMin:+cross[8]};
  }
  // 同日型：mo/d(HH:MM－HH:MM)
  const same=val.match(/(\d+)\/(\d+)\((\d+):(\d+)[－\-]+(\d+):(\d+)\)/);
  if(same){
    return {sMo:+same[1],sD:+same[2],sH:+same[3],sMin:+same[4],
            eMo:+same[1],eD:+same[2],eH:+same[5],eMin:+same[6]};
  }
  return null;
}

/**
 * 判斷一筆資料的 time 字串是否落在 range 區間內（含頭含尾）。
 * time 格式為 fmtTime() 輸出：「5/31 08:23」
 */
function timeInShift(timeStr, range){
  if(!timeStr||!range) return false;
  // 支援 fmtTime 正常輸出 (M/D HH:MM) 與 fallback 原始字串 (YYYY/M/D HH:MM:SS AM/PM)
  let mo,d,h,min;
  const mShort=timeStr.match(/^(\d+)\/(\d+)\s+(\d+):(\d+)/);
  if(mShort){
    mo=+mShort[1];d=+mShort[2];h=+mShort[3];min=+mShort[4];
  } else {
    // fallback：原始字串含年份，例如 2026/5/9 03:28:56 AM
    const mFull=timeStr.match(/\d+\/(\d+)\/(\d+)\s+(\d+):(\d+)/);
    if(!mFull) return false;
    mo=+mFull[1];d=+mFull[2];h=+mFull[3];min=+mFull[4];
    // AM/PM 轉換
    if(/PM/i.test(timeStr)&&h!==12) h+=12;
    if(/AM/i.test(timeStr)&&h===12) h=0;
  }

  // 改用真實 Date 比較取代純數值串接（mo*1e6+d*1e4+...），並正確處理跨年班別
  // （例如「12/31(17:00)－1/1(08:00)」）。純數值比較在這種情況下會把 1/1 的數值
  // 判定為遠小於 12/31，導致跨年的資料被誤判為區間外。
  const REF_YEAR=2000; // 任意基準年份，僅用於相對先後比較，不影響月日時分判斷
  const isWrap = (range.eMo < range.sMo) ||
                 (range.eMo === range.sMo && range.eD < range.sD);

  const sTs = new Date(REF_YEAR,               range.sMo-1, range.sD, range.sH, range.sMin).getTime();
  const eTs = new Date(REF_YEAR+(isWrap?1:0),  range.eMo-1, range.eD, range.eH, range.eMin).getTime();

  // 資料時間若落在跨年區間「結束端」那一側（即月日早於起始月日），歸入次年再比較
  const dataAfterWrap = isWrap && (mo < range.sMo || (mo === range.sMo && d < range.sD));
  const tTs = new Date(REF_YEAR+(dataAfterWrap?1:0), mo-1, d, h, min).getTime();

  return tTs>=sTs && tTs<=eTs;
}

/**
 * 若 chkShiftFilter 已勾選，從 rows 中過濾出符合目前時段的資料；
 * 否則直接回傳原本的 rows（不影響任何狀態）。
 */
function getShiftFilteredRows(rows){
  const chk=document.getElementById('chkShiftFilter');
  if(!chk||!chk.checked) return rows;
  const val=document.getElementById('shiftSel').value;
  const range=parseShiftRange(val);
  if(!range) return rows;
  return rows.filter(r=>timeInShift(r.time,range));
}

/** shiftSel 切換時：更新報告文字，若有勾選也更新表格 */
function onShiftSelChange(){
  buildMsg();
  if(document.getElementById('chkShiftFilter')?.checked){
    renderFiltered();
    _updateShiftHint();
    setSt(`時段篩選：${getShiftFilteredRows(filteredRows).length} / ${filteredRows.length} 筆`);
  }
}

/** chkShiftFilter 勾選/取消時 */
function onShiftFilterChange(){
  const chk=document.getElementById('chkShiftFilter');
  const label=document.getElementById('shiftFilterLabel');
  const hint=document.getElementById('shiftFilterHint');
  if(chk.checked){
    label.classList.add('active');
    renderFiltered();
    _updateShiftHint();
    buildMsg();
    setSt(`時段篩選：${getShiftFilteredRows(filteredRows).length} / ${filteredRows.length} 筆`);
  } else {
    label.classList.remove('active');
    hint.style.display='none';
    renderFiltered();
    buildMsg();
    setSt(`顯示 ${filteredRows.length} / ${rawRows.length} 筆`);
  }
}

/** 更新提示文字 */
function _updateShiftHint(){
  const hint=document.getElementById('shiftFilterHint');
  const val=document.getElementById('shiftSel').value;
  const range=parseShiftRange(val);
  if(!range){ hint.style.display='none'; return; }
  const toShow=getShiftFilteredRows(filteredRows);
  hint.textContent=`⏱ 時段篩選中：${val}，共 ${toShow.length} 筆`;
  hint.style.display='block';
}

// ══════════════════════════════════════
// Shift options & Report message
// ══════════════════════════════════════

function buildShiftOptions(){
  const sel=document.getElementById('shiftSel');
  sel.innerHTML='';
  const now=new Date();
  const mo=now.getMonth()+1, d=now.getDate();
  const prev=new Date(now); prev.setDate(d-1);
  const pmo=prev.getMonth()+1, pd=prev.getDate();

  const opts=[
    {label:`第一日-上午班：${pmo}/${pd}(17:00)－${mo}/${d}(08:00)`,
     text:`${pmo}/${pd}(17:00)－${mo}/${d}(08:00)`},
    {label:`第一日-下午班：${mo}/${d}(08:00－12:00)`,
     text:`${mo}/${d}(08:00－12:00)`},
    {label:`第二日後-上午班：${pmo}/${pd}(12:00)－${mo}/${d}(08:00)`,
     text:`${pmo}/${pd}(12:00)－${mo}/${d}(08:00)`},
    {label:`第二日後-下午班：${mo}/${d}(08:00－12:00)`,
     text:`${mo}/${d}(08:00－12:00)`},
  ];
  opts.forEach(o=>{
    const op=document.createElement('option');
    op.value=o.text; op.textContent=o.label;
    sel.appendChild(op);
  });
}

function buildMsg(){
  const shift=document.getElementById('shiftSel').value||'';

  // 以 filteredRows 為基礎（若尚未排序則用 dispRows），再套時段篩選
  const base = sorted ? filteredRows : dispRows;
  const baseRows = getShiftFilteredRows(base);

  // 按廠所統計（只計 FIXED_UNITS 中的，其他忽略或也計）
  // 廠所順序依 FIXED_UNITS
  const unitSvcMap = {}; // unit -> {修漏:n, 供水量:n, 水質:n, 施工:n}

  for(const r of baseRows){
    const u = r.unit;
    if(!u) continue;
    if(!unitSvcMap[u]) unitSvcMap[u]={修漏:0,供水量:0,水質:0,施工:0};
    if(r.svc==='修漏案件') unitSvcMap[u].修漏++;
    else if(r.svc==='供水量案件'||r.svc==='供水量問題') unitSvcMap[u].供水量++;
    else if(r.svc==='水質案件') unitSvcMap[u].水質++;
    else if(r.svc==='施工案件') unitSvcMap[u].施工++;
  }

  // 廠所排序：先 FIXED_UNITS 順序，再其他
  const orderedUnits=orderUnits(Object.keys(unitSvcMap));

  // 建立各廠所行
  const lines=[];
  for(const u of orderedUnits){
    const c=unitSvcMap[u];
    const parts=[];
    if(c.修漏>0)  parts.push(`修漏${c.修漏}件`);
    if(c.供水量>0) parts.push(`供水量${c.供水量}件`);
    if(c.水質>0)  parts.push(`水質${c.水質}件`);
    if(c.施工>0)  parts.push(`施工${c.施工}件`);
    if(parts.length) lines.push(`🔹${u}: ${parts.join('、')}`);
  }

  const msg=`業務課報告：\n檢送【${shift}】客服後送案:\n${lines.join('\n')}\n請協助處理及回覆，謝謝您！`;
  document.getElementById('msgOut').value=msg;
  const btn=document.getElementById('btnCopy');
  btn.textContent='📋 複製';
  btn.classList.remove('copied');
}

function copyMsg(){
  const ta=document.getElementById('msgOut');
  ta.select();
  ta.setSelectionRange(0,99999);
  try{
    navigator.clipboard.writeText(ta.value).then(()=>flashCopy()).catch(()=>legacyCopy());
  }catch{legacyCopy();}
}
function legacyCopy(){document.execCommand('copy');flashCopy();}
function flashCopy(){
  const btn=document.getElementById('btnCopy');
  btn.textContent='✅ 已複製！';
  btn.classList.add('copied');
  setTimeout(()=>{btn.textContent='📋 複製';btn.classList.remove('copied');},2000);
}
