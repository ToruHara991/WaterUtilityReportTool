/* ═══════════════════════════════════════════════════════════
 * js/dashboard.js — 災情看板(外掛):全螢幕互動式視覺化,可另開視窗投影
 * 入口:openDashboard()(工具列「📊 災情看板」);資料來源與匯出相同(getShiftFilteredRows(filteredRows))。
 * 互動核心 = 交叉篩選:點 KPI/廠所/行政區/路段、拖曳時間軸、點熱力圖格子、搜尋,所有圖表與清單同步。
 *   每張圖用「排除自己這一維的其他篩選」計數(rowsFor),所以被選取的項目旁邊仍看得到其他項目的量。
 * 純 DOM/CSS 自繪(無外部函式庫);樣式在 css/dashboard.css(.dash 範圍內);不顯示姓名/電話。
 * 外掛性質:只讀取全域資料,唯一的耦合是 renderFiltered() 內一行 refreshDashboard(rows)。
 * (classic script:所有檔案共用全域作用域,載入順序見 index.html;符號索引:node tools/symbols.js)
 * ═══════════════════════════════════════════════════════════ */

const DASH = { open: false, win: null, root: null, X: [], S: null, trend: null, F: null, playing: false, timer: 0,
               listN: 30, last: {}, first: true, theme: 'dark', drag: null, qTimer: 0, tap: null, lastScroll: -1e9 };
const DASH_KINDS = [...SVC_STYLES.map(s => ({ key: s.key, label: s.label })), { key: 'other', label: '其他' }];
const dashFresh = () => ({ unit: new Set(), svc: new Set(), dk: new Set(), rk: new Set(), t: null, q: '' });
const dashWin = () => DASH.win || window;

// ── 資料:把每列預先算好維度鍵(廠所/類別/行政區/路段/時間桶/搜尋字串) ──
function dashBuild(rows){
  const S = computeSummary(rows), trend = S.trend;
  const idx = new Map(trend ? trend.items.map((it, i) => [it.label, i]) : []);
  DASH.S = S; DASH.trend = trend;
  DASH.X = rows.map(r => {
    const dk = (r.city || '') + '|' + distKey(r), dl = (S.multiCity ? (r.city || '') : '') + distKey(r);
    const road = roadOf(r.addr), m = String(r.time || '').match(/^(\d+\/\d+)\s+(\d+):/);
    let b = -1;
    if(m && trend){ const v = idx.get(trend.unit === 'hour' ? m[1] + ' ' + pad(+m[2]) : m[1]); if(v !== undefined) b = v; }
    return { r, k: (svcStyle(r.svc) || { key: 'other' }).key, unit: r.unit || '（未分類）', dk, dl, b,
             rk: road ? dk + '|' + road : null, rl: road ? dl + ' ' + road : null,
             q: [r.rec, r.addr, r.desc, r.dist, r.unit, r.svc, r.detail].join(' ').toLowerCase() };
  });
  // 資料更新後,丟掉已不存在的篩選值
  const F = DASH.F, has = f => new Set(DASH.X.map(x => x[f]));
  for(const [f, field] of [['unit', 'unit'], ['dk', 'dk'], ['rk', 'rk']]){ const h = has(field); F[f].forEach(v => { if(!h.has(v)) F[f].delete(v); }); }
  if(F.t && (!trend || F.t[1] >= trend.items.length)) F.t = null;
}

// 套用篩選;sk = 這張圖要「排除」的維度
function rowsFor(...sk){
  const F = DASH.F, on = n => !sk.includes(n);
  return DASH.X.filter(x =>
    (!F.unit.size || !on('unit') || F.unit.has(x.unit)) &&
    (!F.svc.size  || !on('svc')  || F.svc.has(x.k)) &&
    (!F.dk.size   || !on('dk')   || F.dk.has(x.dk)) &&
    (!F.rk.size   || !on('rk')   || (x.rk && F.rk.has(x.rk))) &&
    (!F.t         || !on('t')    || (x.b >= F.t[0] && x.b <= F.t[1])) &&
    (!F.q         || !on('q')    || x.q.includes(F.q)));
}
function tally(xs, keyOf, labelOf){
  const m = new Map();
  for(const x of xs){
    const k = keyOf(x); if(k === null) continue;
    if(!m.has(k)) m.set(k, { key: k, label: labelOf(x), n: 0, by: {} });
    const o = m.get(k); o.n++; o.by[x.k] = (o.by[x.k] || 0) + 1;
  }
  return [...m.values()];
}
const dSegs = by => DASH_KINDS.filter(k => by[k.key]).map(k => `<b style="flex:${by[k.key]};background:var(--c-${k.key})"></b>`).join('');
// 座標軸標籤密度:窄螢幕少標幾個,避免互相重疊
const dStep = n => Math.ceil(n / (dashWin().innerWidth < 700 ? 4 : 8));
const dSel = (f, v) => DASH.F[f].has(v);
const dDim = (f, v) => DASH.F[f].size && !DASH.F[f].has(v) ? ' dim' : '';

// ── 各區塊 ──
function dKpiHtml(){
  const all = rowsFor(), bySvc = rowsFor('svc'), tl = rowsFor('t'), S = DASH.S;
  const cnt = {}; bySvc.forEach(x => cnt[x.k] = (cnt[x.k] || 0) + 1);
  const cards = [`<div class="kpi kpi-total"><span class="kn" data-k="total" data-to="${all.length}">${DASH.last.total || 0}</span><label>目前顯示件數</label></div>`];
  for(const k of DASH_KINDS){
    if(k.key === 'other' && !S.hasOther) continue;
    cards.push(`<button class="kpi kpi-svc${dSel('svc', k.key) ? ' sel' : ''}${dDim('svc', k.key)}" data-f="svc" data-v="${k.key}" style="--kc:var(--c-${k.key})">` +
      `<span class="kn" data-k="${k.key}" data-to="${cnt[k.key] || 0}">${DASH.last[k.key] || 0}</span><label>${k.label}</label></button>`);
  }
  const ti = DASH.trend ? DASH.trend.items : [];
  if(ti.length >= 2){
    const c = ti.map((_, i) => tl.filter(x => x.b === i).length), a = c[c.length - 1], p = c[c.length - 2];
    const mood = a > p ? 'up' : a < p ? 'down' : 'flat', arrow = a > p ? '▲' : a < p ? '▼' : '＝';
    const u = DASH.trend.unit === 'hour' ? '小時' : '天';
    cards.push(`<div class="kpi kpi-trend ${mood}"><span class="kn2">${arrow} ${a}<small>件</small></span><label>最新一${u}（${e(ti[ti.length - 1].label)}${u === '小時' ? '時' : ''}）・前一${u} ${p}</label></div>`);
  }
  const top = tally(rowsFor('dk'), x => x.dk, x => x.dl).sort((x, y) => y.n - x.n)[0];
  if(top) cards.push(`<div class="kpi kpi-hot"><span class="kn2 hotn">${e(top.label)}</span><label>最集中行政區・${top.n} 件</label></div>`);
  return cards.join('');
}

function dTimeHtml(){
  const ti = DASH.trend ? DASH.trend.items : [];
  if(!ti.length) return '<div class="d-empty">資料沒有可判讀的申報時間</div>';
  const xs = rowsFor('t'), n = ti.length, F = DASH.F;
  const per = ti.map(() => ({ n: 0, by: {} }));
  xs.forEach(x => { if(x.b >= 0){ const o = per[x.b]; o.n++; o.by[x.k] = (o.by[x.k] || 0) + 1; } });
  const max = Math.max(...per.map(o => o.n), 1), step = dStep(n), u = DASH.trend.unit === 'hour' ? '時' : '';
  const cols = per.map((o, i) => {
    const off = F.t && (i < F.t[0] || i > F.t[1]);
    return `<div class="tc${off ? ' off' : ''}${o.n === max && o.n ? ' peak' : ''}" data-i="${i}" title="${e(ti[i].label)}${u}：${o.n} 件">` +
           `<div class="tcs" style="height:${o.n / max * 100}%">${dSegs(o.by)}</div></div>`;
  }).join('');
  const axis = ti.map((it, i) => `<span>${i % step === 0 ? e(it.label) + u : ''}</span>`).join('');
  return `<div class="tl" style="--n:${n}">${cols}</div><div class="tax" style="--n:${n}">${axis}</div>`;
}
function dTimeLabel(a, b){
  const ti = DASH.trend.items, u = DASH.trend.unit === 'hour' ? '時' : '';
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return lo === hi ? ti[lo].label + u : `${ti[lo].label}${u} – ${ti[hi].label}${u}`;
}

function dBars(list, f, max, fmt){
  if(!list.length) return '<div class="d-empty">無資料</div>';
  return list.map(o => `<div class="hb${dSel(f, o.key) ? ' sel' : ''}${dDim(f, o.key)}" data-f="${f}" data-v="${e(o.key)}" title="${e(o.label)}：${o.n} 件">` +
    `<span class="hb-l">${e(fmt ? fmt(o) : o.label)}</span><span class="hb-t"><i style="width:${Math.max(3, o.n / max * 100)}%">${dSegs(o.by)}</i></span><span class="hb-n">${o.n}</span></div>`).join('');
}
function dUnitHtml(){
  const t = tally(rowsFor('unit'), x => x.unit, x => x.unit), by = new Map(t.map(o => [o.key, o]));
  const list = orderUnits(by.keys()).map(u => by.get(u));
  return dBars(list, 'unit', Math.max(...list.map(o => o.n), 1));
}
function dDistHtml(){
  const t = tally(rowsFor('dk'), x => x.dk, x => x.dl).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'zh-Hant'));
  const keep = new Set(t.slice(0, 10).map(o => o.key)); DASH.F.dk.forEach(k => keep.add(k));
  const list = t.filter(o => keep.has(o.key));
  return dBars(list, 'dk', Math.max(...list.map(o => o.n), 1)) + (t.length > list.length ? `<div class="d-note">另有 ${t.length - list.length} 個行政區未列出</div>` : '');
}
function dRoadHtml(){
  const t = tally(rowsFor('rk'), x => x.rk, x => x.rl).filter(o => o.n >= 2 || DASH.F.rk.has(o.key)).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'zh-Hant'));
  const list = t.slice(0, 8);
  return list.length ? dBars(list, 'rk', list[0].n) : '<div class="d-empty">目前沒有出現 2 件以上的同一路段</div>';
}

// 行政區 × 時間 熱力圖:排除行政區與時間篩選,才看得到「災情怎麼擴散」
function dHeatHtml(){
  const ti = DASH.trend ? DASH.trend.items : [];
  if(!ti.length) return '<div class="d-empty">資料沒有可判讀的申報時間</div>';
  const xs = rowsFor('dk', 't'), t = tally(xs, x => x.dk, x => x.dl).sort((a, b) => b.n - a.n).slice(0, 8), n = ti.length;
  const cell = new Map(); let max = 1;
  xs.forEach(x => { if(x.b < 0) return; const k = x.dk + '#' + x.b, v = (cell.get(k) || 0) + 1; cell.set(k, v); if(v > max) max = v; });
  const step = dStep(n), F = DASH.F, showN = n <= 14;
  let h = `<div class="hm" style="--n:${n}"><span></span>${ti.map((it, i) => `<span class="hm-x">${i % step === 0 ? e(it.label) : ''}</span>`).join('')}`;
  for(const o of t){
    h += `<span class="hm-y${dSel('dk', o.key) ? ' sel' : ''}" data-f="dk" data-v="${e(o.key)}">${e(o.label)}</span>`;
    for(let i = 0; i < n; i++){
      const v = cell.get(o.key + '#' + i) || 0;
      const on = (!F.dk.size || F.dk.has(o.key)) && (!F.t || (i >= F.t[0] && i <= F.t[1]));
      h += `<i class="hm-c${v ? '' : ' z'}${on ? '' : ' off'}" data-heat="${e(o.key)}|${i}" style="--a:${v ? (0.18 + 0.82 * v / max).toFixed(2) : 0}" title="${e(o.label)} ${e(ti[i].label)}：${v} 件">${showN && v ? v : ''}</i>`;
    }
  }
  return h + '</div>';
}

function dListHtml(){
  const xs = rowsFor().slice().sort((a, b) => b.r.timeVal - a.r.timeVal);
  if(!xs.length) return '<div class="d-empty">沒有符合條件的案件</div>';
  const kl = Object.fromEntries(DASH_KINDS.map(k => [k.key, k.label]));
  const rows = xs.slice(0, DASH.listN).map(x => `<div class="li" style="--kc:var(--c-${x.k})"><div class="li-a"><b>${e(x.r.time)}</b><span class="li-k">${e(kl[x.k])}${x.r.detail ? '・' + e(x.r.detail) : ''}</span>` +
    `<span class="li-u">${e(x.unit)}</span></div><div class="li-b">${e(x.dl)}${e(x.r.addr)}</div>${x.r.desc ? `<div class="li-c">${e(x.r.desc)}</div>` : ''}<div class="li-r">${e(x.r.rec)}</div></div>`).join('');
  const more = xs.length > DASH.listN ? `<button class="d-more" data-act="more">再顯示 30 筆（還有 ${xs.length - DASH.listN} 筆）</button>` : '';
  return `<div class="d-count">共 ${xs.length} 筆，依申報時間新到舊</div>${rows}${more}`;
}

function dChipsHtml(){
  const F = DASH.F, ch = [], kl = Object.fromEntries(DASH_KINDS.map(k => [k.key, k.label]));
  const name = (f, v) => { const x = DASH.X.find(y => y[f] === v); return x ? (f === 'dk' ? x.dl : f === 'rk' ? x.rl : v) : v; };
  F.unit.forEach(v => ch.push(['unit', v, v])); F.svc.forEach(v => ch.push(['svc', v, kl[v]]));
  F.dk.forEach(v => ch.push(['dk', v, name('dk', v)])); F.rk.forEach(v => ch.push(['rk', v, name('rk', v)]));
  if(F.t) ch.push(['t', '', dTimeLabel(F.t[0], F.t[1])]);
  if(F.q) ch.push(['q', '', '搜尋：' + F.q]);
  if(!ch.length) return '<span class="d-hint">點任何圖表可篩選；拖曳時間軸可選取時段</span>';
  return ch.map(c => `<button class="chip" data-x="${c[0]}" data-v="${e(c[1])}">${e(c[2])} ✕</button>`).join('') + '<button class="chip chip-clear" data-act="clear">清除全部</button>';
}

// ── 繪製 ──
function dashRender(){
  const R = DASH.root; if(!R) return;
  const set = (id, html) => { R.querySelector(id).innerHTML = html; };
  set('#dChips', dChipsHtml()); set('#dKpi', dKpiHtml()); set('#dTime', dTimeHtml());
  set('#dUnit', dUnitHtml()); set('#dDist', dDistHtml()); set('#dRoad', dRoadHtml()); set('#dHeat', dHeatHtml()); set('#dList', dListHtml());
  const F = DASH.F, S = DASH.S;
  R.querySelector('#dSub').textContent = `資料 ${S.total} 件${S.latest ? '・最新 ' + S.latest : ''}・${disasterMode ? '災害模式' : '平常模式'}`;
  R.querySelector('#dSel').textContent = F.t ? dTimeLabel(F.t[0], F.t[1]) : '全部時段';
  R.querySelector('#dPlay').textContent = DASH.playing ? '⏸ 暫停' : '▶ 播放';
  R.classList.toggle('first', DASH.first); DASH.first = false;
  dashCountUp();
}
// KPI 數字跳動:從上次的值滾到新值
function dashCountUp(){
  const w = dashWin(), calm = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  DASH.root.querySelectorAll('.kn').forEach(el => {
    const k = el.dataset.k, to = +el.dataset.to, from = DASH.last[k] || 0;
    DASH.last[k] = to;
    if(calm || from === to){ el.textContent = to; return; }
    const t0 = w.performance.now(), dur = 520;
    const tick = now => { const p = Math.min(1, (now - t0) / dur); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))); if(p < 1) w.requestAnimationFrame(tick); };
    w.requestAnimationFrame(tick);
  });
}

// ── 互動 ──
function dashToggle(f, v){
  const s = DASH.F[f]; if(s.has(v)) s.delete(v); else s.add(v);
  dashRender();
}
function dashStop(){ if(DASH.timer){ dashWin().clearInterval(DASH.timer); DASH.timer = 0; } DASH.playing = false; }
function dashPlay(){
  if(DASH.playing){ dashStop(); dashRender(); return; }
  const n = DASH.trend ? DASH.trend.items.length : 0; if(n < 2) return;
  let i = 0; DASH.F.t = [0, 0]; DASH.playing = true; dashRender();
  DASH.timer = dashWin().setInterval(() => {
    i++;
    if(i >= n){ dashStop(); DASH.F.t = null; dashRender(); return; }   // 播完回到「全部時段」
    DASH.F.t = [0, i]; dashRender();
  }, Math.max(140, Math.min(700, 12000 / n)));
}
function dashClear(){ DASH.F = dashFresh(); DASH.root.querySelector('#dQ').value = ''; dashStop(); DASH.listN = 30; dashRender(); }

// 觸控防誤點:捲動(含慣性捲動中點一下止滑)、手指移動超過 8px,都不算「點選」。
function dashTapOk(ev){
  const d = DASH.tap; if(!d) return true;
  const moved = Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 8;
  return !(d.rolling || moved || Math.abs(DASH.root.scrollTop - d.st) > 2);
}

function dashClick(ev){
  const ok = dashTapOk(ev); DASH.tap = null;
  if(!ok) return;
  const t = ev.target.closest('[data-f],[data-heat],[data-x],[data-act]'); if(!t) return;
  if(t.dataset.f){ DASH.listN = 30; dashToggle(t.dataset.f, t.dataset.v); return; }
  if(t.dataset.heat){
    const [dk, b] = [t.dataset.heat.split('|').slice(0, -1).join('|'), +t.dataset.heat.split('|').pop()];
    dashStop(); DASH.F.dk = new Set([dk]); DASH.F.t = [b, b]; DASH.listN = 30; dashRender(); return;
  }
  if(t.dataset.x){
    const x = t.dataset.x; dashStop();
    if(x === 't') DASH.F.t = null; else if(x === 'q'){ DASH.F.q = ''; DASH.root.querySelector('#dQ').value = ''; } else DASH.F[x].delete(t.dataset.v);
    dashRender(); return;
  }
  const a = t.dataset.act;
  if(a === 'clear') dashClear();
  else if(a === 'more'){ DASH.listN += 30; DASH.root.querySelector('#dList').innerHTML = dListHtml(); }
  else if(a === 'play') dashPlay();
  else if(a === 'theme') dashTheme();
  else if(a === 'pop') dashPopOut();
  else if(a === 'dock') dashDock();
  else if(a === 'close') dashClose();
}

// 時間軸拖曳選取(pointer events:滑鼠與觸控共用);拖曳中只改外觀,放開才套用篩選
function dashPointer(ev){
  DASH.tap = { x: ev.clientX, y: ev.clientY, st: DASH.root.scrollTop, rolling: ev.pointerType === 'touch' && dashWin().performance.now() - DASH.lastScroll < 160 };   // 只有觸控才有「慣性捲動中點一下止滑」
  const tl = ev.target.closest('.tl'); if(!tl || !DASH.trend) return;
  const n = DASH.trend.items.length, rect = tl.getBoundingClientRect();
  const at = e2 => Math.max(0, Math.min(n - 1, Math.floor((e2.clientX - rect.left) / rect.width * n)));
  dashStop();
  const a = at(ev); DASH.drag = { a, b: a, moved: false };
  try { tl.setPointerCapture(ev.pointerId); } catch(_) {}
  const paint = () => { const lo = Math.min(DASH.drag.a, DASH.drag.b), hi = Math.max(DASH.drag.a, DASH.drag.b);
    tl.querySelectorAll('.tc').forEach((c, i) => c.classList.toggle('off', i < lo || i > hi));
    DASH.root.querySelector('#dSel').textContent = dTimeLabel(lo, hi); };
  const move = e2 => { const b = at(e2); if(b !== DASH.drag.b){ DASH.drag.b = b; DASH.drag.moved = true; paint(); } };
  const end = () => { tl.removeEventListener('pointermove', move); tl.removeEventListener('pointerup', up); tl.removeEventListener('pointercancel', cancel); };
  // 瀏覽器接手垂直捲動(pointercancel)=使用者只是在滑頁面:放棄選取、恢復原狀,不套用篩選
  const cancel = () => { end(); DASH.drag = null; dashRender(); };
  const up = () => {
    end();
    const d = DASH.drag; DASH.drag = null; if(!d) return;
    if(DASH.tap && DASH.tap.rolling && !d.moved){ dashRender(); return; }   // 止住慣性捲動的那一下不算點選
    const lo = Math.min(d.a, d.b), hi = Math.max(d.a, d.b), cur = DASH.F.t;
    DASH.F.t = (!d.moved && cur && cur[0] === lo && cur[1] === hi) ? null : [lo, hi];   // 單點同一格再點一次=取消
    DASH.listN = 30; dashRender();
  };
  tl.addEventListener('pointermove', move); tl.addEventListener('pointerup', up); tl.addEventListener('pointercancel', cancel);
  paint();
}

function dashTheme(){
  DASH.theme = DASH.theme === 'dark' ? 'light' : 'dark';
  DASH.root.classList.toggle('light', DASH.theme === 'light');
  try { localStorage.setItem('wurt.dashTheme', DASH.theme); } catch(_) {}
}

// ── 開關與另開視窗 ──
const DASH_SKELETON = `
<header class="d-head">
  <div class="d-title"><h2>📊 災情看板</h2><span id="dSub"></span></div>
  <div class="d-tools">
    <button data-act="theme" title="切換深色／淺色">🌗</button>
    <button data-act="pop" class="d-pop">⧉ 另開視窗</button><button data-act="dock" class="d-dock">↩ 收回</button>
    <button data-act="close" title="關閉（Esc）">✕ 關閉</button>
  </div>
</header>
<div class="d-chips" id="dChips"></div>
<main class="d-body">
  <section id="dKpi" class="kpis"></section>
  <section class="card wide"><h3>案件湧入趨勢<small>拖曳選取時段，或點單一時段</small><span class="sp"></span><span class="d-sel" id="dSel"></span><button data-act="play" id="dPlay" class="d-btn">▶ 播放</button></h3><div id="dTime"></div></section>
  <section class="card"><h3>廠所</h3><div id="dUnit"></div></section>
  <section class="card"><h3>行政區</h3><div id="dDist"></div></section>
  <section class="card"><h3>熱點路段<small>同路段 2 件以上</small></h3><div id="dRoad"></div></section>
  <section class="card wide"><h3>行政區 × 時間<small>顏色越深案件越多；點格子可聚焦</small></h3><div id="dHeat"></div></section>
  <section class="card wide"><h3>案件清單<span class="sp"></span><input id="dQ" type="search" placeholder="搜尋地址、描述、受理編號…" autocomplete="off"></h3><div id="dList"></div></section>
</main>`;

function openDashboard(){
  document.getElementById('exportMenu').style.display = 'none';
  if(DASH.open){ if(DASH.win) DASH.win.focus(); return; }
  const rows = getShiftFilteredRows(filteredRows);
  if(!rows.length){ alert('目前沒有資料，請先上傳並整理後再開啟災情看板。'); return; }
  try { DASH.theme = localStorage.getItem('wurt.dashTheme') === 'light' ? 'light' : 'dark'; } catch(_) {}
  DASH.F = dashFresh(); DASH.last = {}; DASH.listN = 30; DASH.first = true;
  const R = DASH.root = document.createElement('div');
  R.className = 'dash' + (DASH.theme === 'light' ? ' light' : ''); R.tabIndex = -1; R.innerHTML = DASH_SKELETON;
  R.addEventListener('scroll', () => { DASH.lastScroll = dashWin().performance.now(); }, { passive: true });
  R.addEventListener('click', dashClick);
  R.addEventListener('pointerdown', dashPointer);
  R.addEventListener('keydown', ev => { if(ev.key === 'Escape'){ ev.stopPropagation(); dashClose(); } });
  R.querySelector('#dQ').addEventListener('input', ev => {
    const w = dashWin(); w.clearTimeout(DASH.qTimer);
    DASH.qTimer = w.setTimeout(() => { DASH.F.q = ev.target.value.trim().toLowerCase(); DASH.listN = 30; dashRender(); }, 150);
  });
  dashBuild(rows);
  document.body.appendChild(R); document.body.style.overflow = 'hidden';
  DASH.open = true; dashRender(); R.focus();
}

function dashClose(){
  if(!DASH.open) return;
  dashStop(); const w = DASH.win; DASH.win = null; DASH.open = false;
  if(DASH.root.parentNode) DASH.root.parentNode.removeChild(DASH.root);
  DASH.root = null; document.body.style.overflow = '';
  if(w && !w.closed) w.close();
}

function dashPopOut(){
  const w = window.open('', 'wurt_dash', 'width=1360,height=860');
  if(!w){ alert('瀏覽器擋住了彈出視窗，請允許本頁的彈出視窗後再試一次。'); return; }
  const d = w.document;
  d.open(); d.write('<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>災情看板</title></head><body></body></html>'); d.close();
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => { const c = el.cloneNode(true); if(el.tagName === 'LINK') c.href = el.href; d.head.appendChild(c); });
  dashStop(); d.body.appendChild(DASH.root);
  DASH.win = w; DASH.root.classList.add('popped'); document.body.style.overflow = '';
  w.addEventListener('pagehide', () => { if(DASH.win === w){ DASH.win = null; dashClose(); } });
  DASH.root.focus(); dashRender();
}
function dashDock(){
  const w = DASH.win; if(!w) return;
  DASH.win = null; dashStop();
  document.body.appendChild(DASH.root); DASH.root.classList.remove('popped'); document.body.style.overflow = 'hidden';
  if(!w.closed) w.close();
  DASH.root.focus(); dashRender();
}

// 主畫面資料/篩選改變時由 renderFiltered() 呼叫:看板開著就即時更新
function refreshDashboard(rows){
  if(!DASH.open) return;
  if(!rows.length){ dashClose(); return; }
  dashBuild(rows); dashRender();
}
