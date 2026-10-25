/* ═══════════════════════════════════════════════════════════
 * js/actions.js — 主要動作:排序＋篩選＋染色、還原、災害模式切換
 * applyAll()(依 disasterMode 分流排序與配色)、resetRaw()、toggleDisaster()。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

// ══════════════════════════════════════
// Actions
// ══════════════════════════════════════
function applyAll(){
  // 先做服務類別篩選+排序 → 存入 dispRows
  dispRows=rawRows.filter(r=>KEEP_SVCS.has(r.svc));
  if(disasterMode){
    // 災害模式:廠所 → 行政區 → 服務類別 → 時間
    dispRows.sort((a,b)=>{
      const oa=(UNIT_ORDER_MAP[a.unit]??99), ob=(UNIT_ORDER_MAP[b.unit]??99);
      if(oa!==ob) return oa-ob;
      const da=distKey(a), db=distKey(b);
      if(da!==db) return da.localeCompare(db,'zh-Hant');
      const sv_=(SVC_ORDER[a.svc]||9)-(SVC_ORDER[b.svc]||9); if(sv_)return sv_;
      return a.timeVal-b.timeVal;
    });
    // 依「出現順序」指派行政區底色,排序後同區相鄰、顏色成塊
    distColors={}; distPi_=0;
    for(const r of dispRows){
      const k=distKey(r);
      if(!(k in distColors)) distColors[k]=DIST_PALETTE[distPi_++%DIST_PALETTE.length];
    }
  } else {
    // 平常模式(原行為不變):廠所 → 服務類別 → 時間
    dispRows.sort((a,b)=>{
      // 廠所依 FIXED_UNITS 順序，不在其中的排後面
      const oa=(UNIT_ORDER_MAP[a.unit]??99), ob=(UNIT_ORDER_MAP[b.unit]??99);
      if(oa!==ob) return oa-ob;
      const sv_=(SVC_ORDER[a.svc]||9)-(SVC_ORDER[b.svc]||9); if(sv_)return sv_;
      return a.timeVal-b.timeVal;
    });
  }
  sorted=true;
  // 重設篩選（全選）
  document.querySelectorAll('#unitChecks input,#svcChecks input').forEach(cb=>cb.checked=true);
  filteredRows=[...dispRows];
  renderFiltered();
  setSt(`篩選後 ${dispRows.length} / ${rawRows.length} 筆`);
  renderLegend();
  buildShiftOptions();
  buildMsg();
  document.getElementById('reportWrap').classList.add('show');
}

function resetRaw(){
  sorted=false;
  dispRows=[...rawRows];
  document.querySelectorAll('#unitChecks input,#svcChecks input').forEach(cb=>cb.checked=true);
  filteredRows=[...rawRows];
  // 重設時段篩選勾選
  const chk=document.getElementById('chkShiftFilter');
  if(chk){ chk.checked=false; }
  document.getElementById('shiftFilterLabel')?.classList.remove('active');
  document.getElementById('shiftFilterHint').style.display='none';
  renderFiltered();
  setSt(`共 ${rawRows.length} 筆`);
  document.getElementById('legend').classList.remove('show');
  document.getElementById('legend').innerHTML='';
  document.getElementById('reportWrap').classList.remove('show');
}

function toggleDisaster(){
  disasterMode=!disasterMode;
  const btn=document.getElementById('disasterBtn');
  btn.classList.toggle('active', disasterMode);
  btn.textContent = disasterMode ? '🚨 災害模式：開' : '🚨 災害模式：關';
  // 若使用者已按過「排序＋篩選＋染色」,立即用新模式重算一次,
  // 讓畫面的排序、染色與圖例即時反映模式切換;尚未整理則不動作。
  if(sorted) applyAll();
}
