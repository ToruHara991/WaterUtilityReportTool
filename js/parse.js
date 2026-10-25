/* ═══════════════════════════════════════════════════════════
 * js/parse.js — Excel 上傳與解析
 * 上傳區事件、load()、parse()(找表頭、欄位對應、建立 rawRows/unitColors)、reUpload()。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

// ══════════════════════════════════════
// Upload wiring
// ══════════════════════════════════════
const dz = document.getElementById('dropZone');
const fi = document.getElementById('fileIn');
dz.onclick = ()=>fi.click();
dz.ondragover = e=>{e.preventDefault();dz.classList.add('over')};
dz.ondragleave = ()=>dz.classList.remove('over');
dz.ondrop = e=>{e.preventDefault();dz.classList.remove('over');if(e.dataTransfer.files[0])load(e.dataTransfer.files[0])};
fi.onchange = ()=>{if(fi.files[0])load(fi.files[0])};

function reUpload(){
  rawRows=[]; dispRows=[]; filteredRows=[]; unitColors={}; sorted=false; pi_=0;
  distColors={}; distPi_=0;
  document.getElementById('uploadWrap').style.display='';
  document.getElementById('toolbar').classList.remove('show');
  document.getElementById('filterBar').classList.remove('show');
  document.getElementById('filterBtn').classList.remove('active');
  document.getElementById('legend').classList.remove('show');
  document.getElementById('legend').innerHTML='';
  document.getElementById('reportWrap').classList.remove('show');
  document.getElementById('pages').innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--sub)">請上傳 Excel 明細表</div>';
  setSt('');
  fi.value='';
}

function load(f){
  showOv(true);
  const r=new FileReader();
  r.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
      parse(wb);
    }catch(err){alert('解析失敗：'+err.message);showOv(false);}
  };
  r.readAsArrayBuffer(f);
}

// ══════════════════════════════════════
// Parse
// ══════════════════════════════════════
function parse(wb){
  let ws=null,hdr=-1;
  for(const sn of wb.SheetNames){
    const s=wb.Sheets[sn];
    const rows=XLSX.utils.sheet_to_json(s,{header:1,raw:false});
    for(let i=0;i<Math.min(18,rows.length);i++){
      if(rows[i]&&rows[i].some(c=>typeof c==='string'&&c.includes('受理編號'))){
        ws=s;hdr=i;break;
      }
    }
    if(ws)break;
  }
  if(!ws){alert('找不到「受理編號」欄位，請確認格式。');showOv(false);return;}

  const all=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,cellDates:true});
  const H=all[hdr];

  const ci=name=>{
    const hits=[];
    for(let i=0;i<H.length;i++) if(H[i]&&String(H[i]).includes(name)) hits.push(i);
    if(hits.length>1) console.warn(`欄位「${name}」有多個符合的標題，已採用第一個：`, hits.map(i=>H[i]));
    return hits.length?hits[0]:-1;
  };
  const iA=ci('受理編號'),iC=ci('申報時間'),iE=ci('服務類別');
  const iG=ci('細項'),iH=ci('問題描述'),iL=ci('姓名');
  const iN=ci('聯絡電話'),iP=ci('報修地址');
  const iS = ci('後送否') !== -1 ? ci('後送否') : ci('後送廠所');
  const iT=ci('修漏案號');

  // 必要欄位驗證：缺少任一欄位會導致後續資料解析全部靜默失敗（例如全部列被
  // rec.length<5 排除），因此提早中止並明確告知，而非讓使用者得到空白結果。
  const REQUIRED_COLS={'受理編號':iA,'申報時間':iC,'服務類別':iE};
  const missingCols=Object.entries(REQUIRED_COLS).filter(([,idx])=>idx===-1).map(([name])=>name);
  if(missingCols.length){
    alert(`找不到必要欄位：${missingCols.join('、')}，請確認 Excel 表頭格式。`);
    showOv(false);
    return;
  }

  rawRows=[];unitColors={};pi_=0;

  for(let i=hdr+1;i<all.length;i++){
    const r=all[i];
    if(!r)continue;
    const rec=sv(r[iA]);
    if(!rec||rec.length<5)continue;
    const addr=sv(r[iP]);
    const descFull=sv(r[iH]);
    const desc=descFull.length>12?descFull.slice(12):descFull;
    const unitFull=sv(r[iS]);
    const unit=shortUnit(unitFull)||unitFull;
    // 服務類別別名正規化：「供水量案件」與「供水量問題」在 KEEP_SVCS / SVC_ORDER / SVC_STYLES
    // 中皆視為同義詞，但篩選 checkbox 只有「供水量問題」一個選項。若不在此處統一，
    // 會導致 applyFilter() 永久濾掉「供水量案件」的資料（見 P1 修正說明）。
    const svcRaw = sv(r[iE]);
    const svc = svcRaw === '供水量案件' ? '供水量問題' : svcRaw;
    rawRows.push({
      unit, unitFull, rec,
      time:fmtTime(r[iC]),timeVal:timeVal(r[iC]),
      svc,detail:sv(r[iG]),desc,
      city:addr.slice(0,3),dist:addr.slice(3,6),addr:addr.slice(6),
      name:sv(r[iL]),phone:sv(r[iN]),caseNo:sv(r[iT])
    });
  }

  for(const r of rawRows){
    if(r.unit&&!(r.unit in unitColors)){
      unitColors[r.unit]=PALETTE[pi_++%PALETTE.length];
    }
  }

  sorted=false;
  dispRows=[...rawRows];
  filteredRows=[...rawRows];
  document.getElementById('uploadWrap').style.display='none';
  document.getElementById('toolbar').classList.add('show');
  document.getElementById('chkSplit').checked=true;
  document.getElementById('rpPage').value=15;
  buildUnitCheckboxes();
  render();
  setSt(`共 ${rawRows.length} 筆`);
  showOv(false);
}
