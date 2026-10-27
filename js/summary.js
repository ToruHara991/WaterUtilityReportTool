/* ═══════════════════════════════════════════════════════════
 * js/summary.js — 統計摘要(選填、預設收合)與熱點分析
 * computeSummary(rows) 為純計算(Excel 匯出共用);summaryHtml/refreshSummary 負責畫面。
 * 摘要放在「業務課報告文字」上方的 <details id="summaryBox">,預設收合;只有展開時才計算。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

// 從「縣市+行政區之後」的地址(r.addr)取出路段:「中山路二段123號」→「中山路二段」。
// 支援:路/街/大道/道、可接「X段」、可略過開頭的「○○里(○鄰)」。判讀不出回傳 null。
const ROAD_RE = /^(?:[^\d路街道]{1,4}[里村](?:\d+鄰)?)?([^\d路街道\s]{1,8}(?:大道|路|街|道)(?:[一二三四五六七八九十\d]{1,2}段)?)/;
function roadOf(addr){
  const m = String(addr || '').replace(/\s+/g, '').match(ROAD_RE);
  return m ? m[1] : null;
}

// 統計:回傳 { total, unitRows, svcTotals, hasOther, dists, roads, roadUnknown, peak, multiCity }
//  unitRows : [{ unit, total, counts:{repair,supply,water,construct,other} }](依 orderUnits 排序)
//  dists    : [{ label, n, units:[廠所] }] 依件數由多到少(同數依名稱)
//  roads    : [{ label, n }] 同一(縣市+行政區+路段)有 2 件以上者,由多到少
//  peak     : { label, n } 單一小時內案件最多者(無時間資料則 null)
//  trend    : { unit:'hour'|'day', step, items:[{label,name,n}] } 依時間排序、補零的案件湧入趨勢(超過 36 個小時改用「日」);無時間資料則 null
//  latest   : 資料中最晚的申報時間字串(如「5/30 14:05」),無則 ''
function computeSummary(rows, opts){
  const keys = SVC_STYLES.map(s => s.key);
  const zero = () => Object.fromEntries([...keys, 'other'].map(k => [k, 0]));
  const byUnit = new Map(), svcTotals = zero();
  const distMap = new Map(), roadMap = new Map(), hourMap = new Map();
  const multiCity = new Set(rows.map(r => r.city).filter(Boolean)).size > 1;
  let roadUnknown = 0, latestV = 0, latest = '';
  const hourV = new Map();   // 小時鍵 → 該小時起點的 [月,日,時],供趨勢排序補零

  for(const r of rows){
    const k = (svcStyle(r.svc) || { key: 'other' }).key;
    const u = r.unit || '（未分類）';
    if(!byUnit.has(u)) byUnit.set(u, { unit: u, total: 0, counts: zero() });
    const row = byUnit.get(u); row.counts[k]++; row.total++; svcTotals[k]++;

    const dLabel = (multiCity ? (r.city || '') : '') + distKey(r);
    const dKey = (r.city || '') + '|' + distKey(r);
    if(!distMap.has(dKey)) distMap.set(dKey, { label: dLabel, n: 0, units: new Set() });
    const d = distMap.get(dKey); d.n++; d.units.add(u);

    const road = roadOf(r.addr);
    if(road){
      const rKey = dKey + '|' + road;
      if(!roadMap.has(rKey)) roadMap.set(rKey, { label: dLabel + ' ' + road, n: 0 });
      roadMap.get(rKey).n++;
    } else roadUnknown++;

    const tm = String(r.time || '').match(/^(\d+\/\d+)\s+(\d+):/);   // fmtTime 輸出「5/30 08:23」
    if(tm){
      const hk = tm[1] + ' ' + pad(+tm[2]);
      hourMap.set(hk, (hourMap.get(hk) || 0) + 1);
      hourV.set(hk, [+tm[1].split('/')[0], +tm[1].split('/')[1], +tm[2]]);
    }
    if(r.timeVal > latestV){ latestV = r.timeVal; latest = r.time; }
  }

  const byN = (a, b) => b.n - a.n || a.label.localeCompare(b.label, 'zh-Hant');
  const unitRows = orderUnits(byUnit.keys()).map(u => byUnit.get(u));
  const dists = [...distMap.values()].map(d => ({ label: d.label, n: d.n, units: orderUnits(d.units) })).sort(byN);
  const roads = [...roadMap.values()].filter(x => x.n >= 2).sort(byN);
  let peak = null;
  for(const [hk, n] of hourMap){
    if(!peak || n > peak.n) peak = { label: `${hk}:00–${hk.split(' ')[1]}:59`, n };
  }
  return { total: rows.length, unitRows, svcTotals, hasOther: svcTotals.other > 0,
           dists, roads, roadUnknown, peak, multiCity, trend: buildTrend(hourMap, hourV, opts && opts.step), latest };
}

// 趨勢:以 step 小時為一個時段(1/2/4;24=整天),補零。年份只用來換算日曆(不影響標籤)。
//  step 省略 = PDF/摘要的舊規則(跨度 ≤36 小時用 1 小時,否則用天);step 'auto' = 依跨度挑最細且時段數 ≤24 的(1→2→4→天)。
//  items: [{ label:時段起點('5/30 08' 或 '5/30'), name:顯示用('5/30 08–10時'), t:起點(UTC 毫秒,年份固定 2000), n }]
function buildTrend(hourMap, hourV, step){
  if(!hourMap.size) return null;
  const Th = hk => { const [m, d, h] = hourV.get(hk); return Date.UTC(2000, m - 1, d, h); };
  const keys = [...hourMap.keys()], ts = keys.map(Th), lo = Math.min(...ts), hi = Math.max(...ts);
  const hours = Math.round((hi - lo) / 3600000) + 1;
  if(step === undefined) step = hours <= 36 ? 1 : 24;
  else if(step === 'auto') step = [1, 2, 4].find(x => Math.ceil(hours / x) + 1 <= 24) || 24;
  // 時段起點:整天=當日 0 時;其餘對齊 step 的倍數(0、4、8…)
  const floorT = t => { const d = new Date(t), h = step === 24 ? 0 : d.getUTCHours() - d.getUTCHours() % step; return Date.UTC(2000, d.getUTCMonth(), d.getUTCDate(), h); };
  const byT = new Map();
  keys.forEach(k => { const f = floorT(Th(k)); byT.set(f, (byT.get(f) || 0) + hourMap.get(k)); });
  const items = [], ms = step * 3600000;
  for(let t = floorT(lo), end = floorT(hi); t <= end; t += ms){
    const d = new Date(t), md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, h = d.getUTCHours();
    items.push(step === 24 ? { label: md, name: md, t, n: byT.get(t) || 0 }
      : { label: `${md} ${pad(h)}`, name: step === 1 ? `${md} ${pad(h)}時` : `${md} ${pad(h)}–${pad(h + step)}時`, t, n: byT.get(t) || 0 });
  }
  return { unit: step === 24 ? 'day' : 'hour', step, items };
}

// ── 畫面 ──
const SUMMARY_TOP = 8;   // 行政區/路段排行各顯示前幾名

function smList(items, total){
  const max = items.length ? items[0].n : 1;
  return items.map(it => {
    const pct = total ? Math.round(it.n * 100 / total) : 0;
    const sub = it.units && it.units.length ? `<small>${e(it.units.join('、'))}</small>` : '';
    return `<div class="sm-item"><div class="sm-row"><span class="sm-lbl">${e(it.label)}${sub}</span>` +
           `<span class="sm-n"><b>${it.n}</b> 件${total ? `<small>${pct}%</small>` : ''}</span></div>` +
           `<div class="sm-bar"><i style="width:${Math.max(4, Math.round(it.n * 100 / max))}%"></i></div></div>`;
  }).join('');
}

function summaryHtml(S){
  if(!S.total) return '<div class="sm-empty">目前沒有資料</div>';
  const cols = SVC_STYLES.map(s => ({ key: s.key, label: s.label }));
  if(S.hasOther) cols.push({ key: 'other', label: '其他' });
  const cell = n => n ? n : '<span class="sm-zero">·</span>';
  const head = `<tr><th>廠所</th>${cols.map(c => `<th>${c.label}</th>`).join('')}<th>合計</th></tr>`;
  const body = S.unitRows.map(r =>
    `<tr><td class="sm-u">${e(r.unit)}</td>${cols.map(c => `<td>${cell(r.counts[c.key])}</td>`).join('')}<td><b>${r.total}</b></td></tr>`).join('');
  const foot = `<tr class="sm-sum"><td class="sm-u">合計</td>${cols.map(c => `<td>${cell(S.svcTotals[c.key])}</td>`).join('')}<td><b>${S.total}</b></td></tr>`;

  const dists = S.dists.slice(0, SUMMARY_TOP);
  const roads = S.roads.slice(0, SUMMARY_TOP);
  const more = (arr, what) => arr.length > SUMMARY_TOP ? `<div class="sm-note">另有 ${arr.length - SUMMARY_TOP} 個${what}未列出</div>` : '';
  const roadNote = S.roadUnknown ? `<div class="sm-note">另有 ${S.roadUnknown} 件地址無法判讀路段,未計入路段排行</div>` : '';

  return `<div class="sm-over">共 <b>${S.total}</b> 件・${S.unitRows.length} 個廠所・${S.dists.length} 個行政區` +
         (S.peak ? `・高峰 ${e(S.peak.label)}(${S.peak.n} 件)` : '') + `</div>` +
    `<div class="sm-sec"><div class="sm-h">各廠所 × 案件類別</div><div class="sm-scroll"><table class="sm-tbl">${head}${body}${foot}</table></div></div>` +
    `<div class="sm-sec"><div class="sm-h">行政區排行</div>${smList(dists, S.total)}${more(S.dists, '行政區')}</div>` +
    `<div class="sm-sec"><div class="sm-h">路段排行<small>同一路段 2 件以上</small></div>` +
      (roads.length ? smList(roads, 0) + more(S.roads, '路段') : '<div class="sm-note">目前沒有出現 2 件以上的同一路段</div>') + roadNote + `</div>`;
}

// 展開時才計算;由 renderFiltered() 在資料/篩選改變時呼叫,收合狀態下零成本
function refreshSummary(rows){
  const box = document.getElementById('summaryBox');
  if(!box || !box.open) return;
  document.getElementById('summaryBody').innerHTML = summaryHtml(computeSummary(rows));
}

document.getElementById('summaryBox').addEventListener('toggle', () => {
  refreshSummary(getShiftFilteredRows(filteredRows));
});
