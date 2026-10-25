/* ═══════════════════════════════════════════════════════════
 * js/config.js — 常數、固定廠所清單、配色、全域狀態
 * 改廠所清單/縮寫(FIXED_UNITS、UNIT_SHORT)、配色(PALETTE、DIST_PALETTE)、新增全域狀態時看這裡。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

// ══════════════════════════════════════
// Config
// ══════════════════════════════════════
const KEEP_SVCS = new Set(['修漏案件','供水量問題','供水量案件','水質案件','施工案件']);
const SVC_ORDER = {'修漏案件':1,'供水量問題':2,'供水量案件':2,'水質案件':3,'施工案件':4};

// 固定9個廠所，順序固定
const FIXED_UNITS = ['基隆所','淡水所','瑞芳所','汐止所','萬金所','文山所','貢雙所','新山廠','一區處'];

// 報告用廠所順序 & 縮寫對應
const UNIT_ORDER_MAP = {};
FIXED_UNITS.forEach((u,i)=>UNIT_ORDER_MAP[u]=i);

const PALETTE = [
  '#EFF6FF','#F0FDF4','#FEFCE8','#FDF4FF',
  '#F5F3FF','#FFF7ED','#F0F9FF','#ECFDF5',
  '#FFF1F2','#FFFBEB','#F8FAFC','#F0FDF4',
  '#FAF5FF','#FAFAFA','#FFFDE7','#F1F8F0'
];

// 災害模式專用:行政區底色。16 色互不重複,且依色相錯開排列(連續編號的顏色色相差大),
// 讓同一廠所內相鄰的行政區一眼就能分辨。(平常模式的 PALETTE 是給 9 個廠所用的淡色,不適合拿來區分十幾個行政區)
const DIST_PALETTE = [
  '#F6CBCB','#CBF6D7','#E4CBF6','#F6F0CB','#CBEFF6','#F6CBE2','#D6F6CB','#CDCBF6',
  '#F6D9CB','#CBF6E6','#F2CBF6','#EDF6CB','#CBE0F6','#F6CBD4','#CBF6CF','#DBCBF6'
];

// 廠所別 → 縮寫
const UNIT_SHORT = {
  '基隆服務所':'基隆所','基隆營運所':'基隆所',
  '淡水營運所':'淡水所',
  '瑞芳營運所':'瑞芳所',
  '汐止營運所':'汐止所',
  '萬里金山營運所':'萬金所','萬里營運所':'萬里所','金山營運所':'金山所',
  '文山營運所':'文山所',
  '貢寮雙溪營運所':'貢雙所','貢寮營運所':'貢寮所','雙溪營運所':'雙溪所',
  '新山給水廠':'新山廠',
  '新店營運所':'新店所','板橋營運所':'板橋所','三重營運所':'三重所',
  '中和營運所':'中和所','永和營運所':'永和所','土城營運所':'土城所',
  '樹林營運所':'樹林所','三峽營運所':'三峽所','鶯歌營運所':'鶯歌所',
  '新莊營運所':'新莊所','蘆洲營運所':'蘆洲所','泰山營運所':'泰山所',
  '林口營運所':'林口所','五股營運所':'五股所','三芝石門營運所':'三石所',
};

function shortUnit(u){
  if(!u) return '';
  if(UNIT_SHORT[u]) return UNIT_SHORT[u];
  const m = u.match(/(.{2,4})(給水廠|營運所|服務所)/);
  if(m) return m[1] + (m[2].includes('廠') ? '廠' : '所');
  return u;
}

// State
let rawRows=[], dispRows=[], filteredRows=[], unitColors={}, sorted=false, pi_=0;
let curPage=0, totalChunks=[];

// ── 災害模式 ──
// disasterMode 為 true 時:排序改為 廠所→行政區→服務類別→時間,
// 染色依據由「廠所」改為「行政區(dist)」,PDF 匯出時每個廠所從新頁開始。
// 既有(平常)模式的所有行為完全不受影響。
let disasterMode=false;
let distColors={};        // 行政區(dist) → 底色,災害模式專用
let distPi_=0;            // distColors 配色指標
// 行政區的顯示鍵:目前依使用者設定採用 dist(地址第4~6字)。
// 若日後要改成 city+dist 或獨立欄位,只需改這一個函式即可。
function distKey(r){ return r.dist || '（未分類）'; }
