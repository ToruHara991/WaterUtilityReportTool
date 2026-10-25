// 測試用的合成資料(固定、可重現,不含任何真實個資)
// 產生一份「Excel 的二維陣列」:前 9 列雜訊 + 第 10 列表頭 + 資料列。
// 時間以 'YYYY-MM-DDTHH:mm' 字串表示,由頁面內轉成本地時間 Date。

const HEADER = ['受理編號','申報時間','服務類別','細項','問題描述','姓名','聯絡電話','報修地址','後送否','修漏案號'];

// [原始「後送否」廠所全名, 行政區清單]
const UNITS = [
  ['基隆營運所',     ['仁愛區','信義區','中正區']],
  ['淡水營運所',     ['淡水區','三芝區']],
  ['瑞芳營運所',     ['瑞芳區']],
  ['萬里金山營運所', ['萬里區','金山區']],
  ['一區處',         ['板橋區','中和區','永和區','三重區']],
  ['新山給水廠',     ['七堵區']],
  ['某某營運所',     ['東區']],          // 不在 FIXED_UNITS 內的廠所(縮寫「某某所」)
];
const SVCS = ['修漏案件','供水量問題','水質案件','施工案件','供水量案件'];  // 供水量案件=別名

function buildRows(){
  let seed = 12345;
  // LCG 的低位元週期很短,取值要用高位元,否則 rnd(2) 之類會呈固定規律
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 12) % n; };
  const rows = [];
  const N = 64;
  for(let i = 0; i < N; i++){
    const [uf, ds] = UNITS[rnd(UNITS.length)];
    const dist = ds[rnd(ds.length)];
    const svc = SVCS[rnd(SVCS.length)];
    const day = 30 + rnd(2);                        // 5/30 或 5/31
    const hh = String(rnd(24)).padStart(2, '0');
    const mm = String(rnd(60)).padStart(2, '0');
    const month = 5;
    rows.push({
      rec: 'AB' + (100000 + i),
      time: `2026-0${month}-${day}T${hh}:${mm}`,
      svc,
      detail: '細項' + (i % 3),
      desc: '前置十二個字描述' + '用戶問題描述第' + i + '號' + (i % 7 === 0 ? '，內容很長'.repeat(8) : ''),
      name: '王' + i,
      phone: '09' + (10000000 + i),
      addr: '新北市' + dist + '測試路' + i + '號',
      unit: uf,
      caseNo: svc === '修漏案件' ? 'R' + (50000 + i) : '',
    });
  }
  // 特殊列:
  rows.push({ rec:'XSS1001', time:'2026-05-31T10:00', svc:'修漏案件', detail:'<i>細項</i>',
              desc:'前置十二個字描述<b>x</b>&"\'', name:'<script>', phone:'0912-345 678', addr:'新北市板橋區<br>路1號',
              unit:'一區處', caseNo:'修漏 案號含中文' });                 // HTML 逸出 + 非標準格式(不做後4碼換行)
  rows.push({ rec:'OTHER01', time:'2026-05-31T11:00', svc:'其他案件', detail:'x', desc:'前置十二個字描述其他',
              name:'李', phone:'0900000000', addr:'新北市板橋區某路', unit:'一區處', caseNo:'' }); // 不在 KEEP_SVCS,排序後應被濾掉
  rows.push({ rec:'A1', time:'2026-05-31T12:00', svc:'修漏案件', detail:'x', desc:'前置十二個字描述短編號',
              name:'短', phone:'0900000001', addr:'新北市板橋區某路', unit:'一區處', caseNo:'' });   // 受理編號<5字,解析時應略過
  return rows;
}

// 單一廠所案件很多(130 件、5 個行政區、描述含多行),用來測「跨頁續表」
function buildOverflowRows(){
  const dists = ['板橋區','中和區','永和區','三重區','新莊區'];
  const out = [];
  for(let i = 0; i < 130; i++){
    out.push({
      rec: 'OV' + (200000 + i), time: `2026-05-30T${String(8 + (i % 10)).padStart(2,'0')}:${String((i * 7) % 60).padStart(2,'0')}`,
      svc: SVCS[i % 4], detail: '細項' + (i % 3),
      desc: '前置十二個字描述' + '漏水嚴重請儘速派員處理第' + i + '號案件說明文字較長會換行'.repeat(i % 3 + 1),
      name: '陳' + i, phone: '09' + (30000000 + i), addr: '新北市' + dists[i % 5] + '長路' + i + '號',
      unit: '一區處', caseNo: i % 4 === 0 ? 'R' + (70000 + i) : '',
    });
  }
  return out;
}

const EXPECT = { rawCount: 64 + 2, skipped: 1 };   // XSS1001 與 OTHER01 保留,A1 略過

function toAoa(rows, opts = {}){
  const header = opts.header || HEADER;
  const aoa = [];
  for(let i = 0; i < 9; i++) aoa.push(['報表標題雜訊' + i]);
  aoa.push(header);
  for(const r of rows){
    aoa.push([r.rec, r.time, r.svc, r.detail, r.desc, r.name, r.phone, r.addr, r.unit, r.caseNo]);
  }
  return aoa;
}

module.exports = { HEADER, buildRows, buildOverflowRows, toAoa, EXPECT };
