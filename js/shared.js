/* ═══════════════════════════════════════════════════════════
 * js/shared.js — 網頁/圖片/PDF 三種輸出共用的「單一來源」定義與純函式
 * 欄位表 COLUMNS(表頭/欄寬/取值)、服務類別樣式 SVC_STYLES、後4碼換行 split4*、底色規則 rowFill、
 * 廠所排序 orderUnits、sv/fmtTime/timeVal/e 等基礎函式。要加欄位或改顏色,改這裡一處即可。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

// ══════════════════════════════════════
// 單一來源定義(網頁表格 / 圖片匯出 / PDF 三種輸出共用)
// 要加欄位、改標題、改顏色,只改這一區即可,三種輸出會一起變。
// ══════════════════════════════════════

// 欄位表。順序即欄位順序。
//  hdr   : 表頭文字(\n 為換行)
//  webCol: 網頁表格用的 <col> class,寬度定義在上方 CSS(col.cA~cL)
//  imgW  : 圖片匯出的欄寬(px)    ← 以下三種寬度皆為特調值,請勿隨意更動
//  pdfW  : PDF 的欄寬(mm)
//  xlW   : Excel 匯出的欄寬(字元數)
//  align : 'center' | 'left'
//  val   : 取值函式(原始字串,未逸出)
//  split4: 後4碼換行(僅純英數字且長度>4)
//  tdCls : 網頁 <td> 的額外 class
//  imgClamp: 圖片匯出時,該格最多顯示幾行
const COLUMNS = [
  { hdr:'廠所別', xlW:9,       webCol:'cA', imgW:44,  pdfW:11, align:'center', val:r=>r.unit,   tdCls:'td-narrow', imgClamp:2 },
  { hdr:'受理編號', xlW:13,     webCol:'cB', imgW:58,  pdfW:16, align:'center', val:r=>r.rec,    split4:true },
  { hdr:'申報時間', xlW:11,     webCol:'cC', imgW:68,  pdfW:14, align:'center', val:r=>r.time },
  { hdr:'服務類別', xlW:11,     webCol:'cD', imgW:48,  pdfW:15, align:'center', val:r=>r.svc,    svc:true },
  { hdr:'細項', xlW:10,         webCol:'cE', imgW:46,  pdfW:14, align:'left',   val:r=>r.detail },
  { hdr:'用戶問題描述', xlW:40, webCol:'cF', imgW:188, pdfW:42, align:'left',   val:r=>r.desc,   tdCls:'td-desc', imgClamp:4 },
  { hdr:'縣市', xlW:7,         webCol:'cG', imgW:25,  pdfW:8,  align:'center', val:r=>r.city },
  { hdr:'區域', xlW:7,         webCol:'cH', imgW:25,  pdfW:8,  align:'center', val:r=>r.dist },
  { hdr:'報修地址', xlW:30,     webCol:'cI', imgW:116, pdfW:28, align:'left',   val:r=>r.addr },
  { hdr:'姓名', xlW:8,         webCol:'cJ', imgW:36,  pdfW:9,  align:'center', val:r=>r.name,   tdCls:'td-narrow', imgClamp:2 },
  { hdr:'電話', xlW:13,         webCol:'cK', imgW:52,  pdfW:14, align:'center', val:r=>r.phone,  split4:true },
  { hdr:'修漏\n案號', xlW:13,   webCol:'cL', imgW:54,  pdfW:14, align:'center', val:r=>r.caseNo, split4:true },
];

// 服務類別樣式:文字色(網頁 class / 圖片 / PDF 共用同一個 hex)與統計小標籤色。
// 判斷順序即優先順序;「修漏案件」須完全相符,其餘用關鍵字包含(含「供水量案件」別名)。
const SVC_STYLES = [
  { key:'repair',    test:s=>s==='修漏案件',     cls:'svc-repair',    color:'#991B1B', weight:'800', label:'修漏', pillBg:'rgba(220,38,38,.35)', pillFg:'#fca5a5' },
  { key:'supply',    test:s=>s.includes('供水'), cls:'svc-supply',    color:'#1e40af', weight:'700', label:'供水', pillBg:'rgba(37,99,235,.35)', pillFg:'#93c5fd' },
  { key:'water',     test:s=>s.includes('水質'), cls:'svc-water',     color:'#065f46', weight:'700', label:'水質', pillBg:'rgba(5,150,105,.35)', pillFg:'#6ee7b7' },
  { key:'construct', test:s=>s.includes('施工'), cls:'svc-construct', color:'#92400e', weight:'700', label:'施工', pillBg:'rgba(146,64,14,.35)', pillFg:'#fcd34d' },
];
const SVC_DEFAULT_COLOR = '#1a2a3a';
function svcStyle(svc){ const s = svc || ''; return SVC_STYLES.find(x=>x.test(s)) || null; }
// 網頁用的 .svc-* class 由 SVC_STYLES 產生,避免顏色在 CSS 與 JS 各寫一份
(function(){
  const st = document.createElement('style');
  st.textContent = SVC_STYLES.map(s=>`.${s.cls}{color:${s.color};font-weight:${s.weight}}`).join('\n');
  document.head.appendChild(st);
})();

function hexToRgb(hex){
  const h = hex.replace('#','');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

// 後4碼換行:僅對「純英數字且長度>4」的標準格式拆成 [前段, 後4碼];
// 含中文、空格等非標準內容原樣顯示。三種輸出共用此規則。
function split4Parts(v){
  if(!v) return [''];
  const s = String(v).trim();
  if(!/^[A-Za-z0-9]+$/.test(s) || s.length <= 4) return [s];
  return [s.slice(0,-4), s.slice(-4)];
}
const split4Pdf  = v => split4Parts(v).join('\n');
const split4Html = v => split4Parts(v).map(e).join('<br>');   // e() 逸出

// 一列資料的底色(hex);無底色回傳 null。
// 災害模式依行政區,平常模式依廠所;尚未「排序＋篩選＋染色」時一律無底色。
function rowFill(r){
  if(!sorted) return null;
  return (disasterMode ? distColors[distKey(r)] : unitColors[r.unit]) || null;
}

// 依 FIXED_UNITS 順序排列廠所,不在其中的接在後面(維持原出現順序)
function orderUnits(units){
  const set = new Set(units);
  return [...FIXED_UNITS.filter(u=>set.has(u)), ...[...set].filter(u=>!FIXED_UNITS.includes(u))];
}

// 各服務類別件數的小標籤列(網頁頁首與圖片頁首共用,僅字級/粗細不同)
function svcPillsHtml(rows, fontSize, fontWeight){
  return SVC_STYLES.map(s=>{
    const n = rows.filter(r=>svcStyle(r.svc) === s).length;
    return n ? `<span style="font-size:${fontSize};padding:1px 6px;border-radius:20px;background:${s.pillBg};color:${s.pillFg};font-weight:${fontWeight}">${s.label} ${n}</span>` : '';
  }).filter(Boolean).join(' ');
}

// ══════════════════════════════════════
// Helpers
// ══════════════════════════════════════
function sv(v){return(v===null||v===undefined)?'':String(v).trim();}

function fmtTime(v){
  if(!v)return'';
  if(v instanceof Date){
    const mo=v.getMonth()+1,d=v.getDate();
    return `${mo}/${d} ${pad(v.getHours())}:${pad(v.getMinutes())}`;
  }
  if(typeof v==='number'){
    const d=new Date(Math.round((v-25569)*86400000));
    return `${d.getUTCMonth()+1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  const dt=new Date(String(v).replace(/\//g,'-'));
  if(!isNaN(dt)) return `${dt.getMonth()+1}/${dt.getDate()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  return sv(v);
}
function pad(n){return String(n).padStart(2,'0');}
function timeVal(v){
  const f=fmtTime(v);if(!f)return 0;
  const m=f.match(/(\d+)\/(\d+)\s+(\d+):(\d+)/);
  return m?+m[1]*1e6 + +m[2]*1e4 + +m[3]*1e2 + +m[4]:0;
}

function e(v){
  if(!v)return'';
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}
