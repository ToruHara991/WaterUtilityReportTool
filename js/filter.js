/* ═══════════════════════════════════════════════════════════
 * js/filter.js — 篩選列(廠所/案件類別勾選)與字級
 * toggleFilter、buildUnitCheckboxes、applyFilter、setSize 等。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

// ══════════════════════════════════════
// Filter bar
// ══════════════════════════════════════
function toggleFilter(){
  const fb=document.getElementById('filterBar');
  const btn=document.getElementById('filterBtn');
  const open=fb.classList.toggle('show');
  btn.classList.toggle('active', open);
  btn.textContent = open ? '▲ 篩選' : '▼ 篩選';
}

function buildUnitCheckboxes(){
  // 固定顯示 FIXED_UNITS 全部9個，資料中有其他廠所則附後
  const inData=new Set(rawRows.map(r=>r.unit).filter(Boolean));
  const extras=[];
  for(const u of inData){ if(!FIXED_UNITS.includes(u)) extras.push(u); }
  const ordered=[...FIXED_UNITS, ...extras];

  const wrap=document.getElementById('unitChecks');
  wrap.innerHTML='';
  for(const u of ordered){
    const lbl=document.createElement('label');
    const cb=document.createElement('input');
    cb.type='checkbox'; cb.value=u; cb.checked=true;
    cb.onchange=()=>{applyFilter();syncToggleBtn('unitChecks','unitResetBtn');};
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' '+u));
    wrap.appendChild(lbl);
  }
  // 初始全選，所以顯示「全取消」
  document.getElementById('unitResetBtn').textContent='全取消';
}

function resetUnitFilter(){
  const cbs=[...document.querySelectorAll('#unitChecks input')];
  const allChecked=cbs.every(cb=>cb.checked);
  cbs.forEach(cb=>cb.checked=!allChecked);
  document.getElementById('unitResetBtn').textContent=allChecked?'全選':'全取消';
  applyFilter();
}

function resetSvcFilter(){
  const cbs=[...document.querySelectorAll('#svcChecks input')];
  const allChecked=cbs.every(cb=>cb.checked);
  cbs.forEach(cb=>cb.checked=!allChecked);
  document.getElementById('svcResetBtn').textContent=allChecked?'全選':'全取消';
  applyFilter();
}

function syncToggleBtn(groupId, btnId){
  const cbs=[...document.querySelectorAll(`#${groupId} input`)];
  const allChecked=cbs.every(cb=>cb.checked);
  document.getElementById(btnId).textContent=allChecked?'全取消':'全選';
}

function getCheckedUnits(){
  return new Set([...document.querySelectorAll('#unitChecks input:checked')].map(cb=>cb.value));
}

function getCheckedSvcs(){
  return new Set([...document.querySelectorAll('#svcChecks input:checked')].map(cb=>cb.value));
}

function applyFilter(){
  const units=getCheckedUnits();
  const svcs=getCheckedSvcs();
  // 篩選基底：若已排序則從 dispRows（已排序已篩選服務類別）過來，否則從 rawRows
  const base = sorted ? dispRows : rawRows;
  filteredRows=base.filter(r=>
    (!r.unit || units.has(r.unit)) &&
    (!r.svc  || svcs.has(r.svc))
  );
  renderFiltered();
  setSt(`顯示 ${filteredRows.length} / ${rawRows.length} 筆`);
}

// ══════════════════════════════════════
// Font size
// ══════════════════════════════════════
function setSize(s, el){
  const map={sm:'.62rem',md:'.72rem',lg:'.84rem'};
  document.documentElement.style.setProperty('--tbl-fs', map[s]);
  document.querySelectorAll('.sz-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}
