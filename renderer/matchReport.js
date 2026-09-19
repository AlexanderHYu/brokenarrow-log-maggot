// ================= 单局复盘页（总览 / 玩家 / 单位 / 时间线） =================
// 数据由主进程 match:report 算好（src/matchReport.js），这里只负责画。
// 依赖 app.js 里的全局小工具：$、esc、fmtTime、fmtDuration、dragonMarkHtml、dragonTagsHtml、PLAYER_URL。
let mrData = null;
let mrTab = 'overview';
const mrSort = { players: { key: 'score', dir: -1 }, units: { key: 'spent', dir: -1 } };
let mrUnitTeam = 'all';
let mrOpenPlayer = null;

const MR_ROLE = { armor: '装甲', inf: '步兵', recon: '侦察', arty: '炮兵', aa: '防空', heli: '直升机', jet: '固定翼' };
const MR_ROLE_COLOR = { armor: '#7aa2f7', inf: '#9ece6a', recon: '#e0af68', arty: '#f7768e', aa: '#bb9af7', heli: '#2ac3de', jet: '#ff9e64' };
const mrTeamName = (t) => (t === 0 ? 'A 队' : 'B 队');
const mrFac = (f) => (f === 'RU' ? '俄' : f === 'US' ? '美' : '');
const mrNum = (v) => (v == null ? '-' : Number(v).toLocaleString('zh-CN'));
const mrPct = (v) => (v == null ? '-' : Math.round(v * 100) + '%');
// 兵种构成条：条里只写百分比，窄到放不下的段悬停看；图例单独一行
function mrRoleBar(roles, small) {
  return `<div class="mr-rolebar${small ? ' small' : ''}">${Object.entries(roles).filter(([k, v]) => MR_ROLE[k] && v > 0).map(([k, v]) => `<i style="width:${v}%;background:${MR_ROLE_COLOR[k]}" title="${MR_ROLE[k]} ${v}%">${v >= 4 ? v + '%' : ''}</i>`).join('')}</div>`;
}
function mrRoleLegend() {
  return '<div class="mr-legend">' + Object.keys(MR_ROLE).map((k) => `<span><i style="background:${MR_ROLE_COLOR[k]}"></i>${MR_ROLE[k]}</span>`).join('') + '</div>';
}
const mrSec = (s) => (s == null ? '-' : s >= 60 ? Math.floor(s / 60) + '′' + String(s % 60).padStart(2, '0') + '″' : s + '″');

async function openMatchReport(fid) {
  if (!fid || !/^\d+$/.test(String(fid))) return;
  mrData = null; mrTab = 'overview'; mrUnitTeam = 'all'; mrOpenPlayer = null;
  $('reportModal').classList.remove('hidden');
  $('mrTitle').textContent = '对局复盘';
  $('mrMeta').textContent = '对局 ' + fid;
  $('mrBody').innerHTML = '<div class="dim">正在读取对局数据…</div>';
  try {
    const r = await BA.matchReport(String(fid));
    if (!r || r.error) {
      $('mrBody').innerHTML = '<div class="loss">' + esc(r && r.error === 'notYet' ? 'BATrace 还没收录这一局，过一会儿再看' : '读取失败：' + ((r && (r.message || r.error)) || '未知错误')) + '</div>';
      return;
    }
    mrData = r;
    renderMatchReport();
  } catch (e) {
    $('mrBody').innerHTML = '<div class="loss">' + esc('读取失败：' + e.message) + '</div>';
  }
}

function renderMatchReport() {
  const r = mrData;
  if (!r) return;
  const endTxt = r.endReason === 2 ? '打满时间' : '';
  $('mrTitle').textContent = (r.map || '未知地图') + ' · 对局复盘';
  $('mrMeta').textContent = ['对局 ' + r.fid, fmtTime(r.startTime), fmtDuration(r.durationSec), endTxt, r.rated ? '排位' : '非排位'].filter(Boolean).join(' · ');
  const teamBox = (T) => `
    <div class="mr-team t${T.team}${T.won ? ' won' : ''}">
      <div class="mr-team-name">${mrTeamName(T.team)}${T.faction ? '<span class="mr-fac">' + mrFac(T.faction) + '</span>' : ''}${T.won == null ? '' : T.won ? '<span class="win">胜</span>' : '<span class="loss">负</span>'}</div>
      <div class="mr-team-stats">
        <span>平均 ELO <b>${T.avgElo ?? '-'}</b></span>
        <span>赛前预期 <b>${mrPct(T.expected)}</b></span>
        <span>ELO 变化 <b class="${T.eloDelta > 0 ? 'win' : T.eloDelta < 0 ? 'loss' : ''}">${T.eloDelta == null ? '-' : (T.eloDelta > 0 ? '+' : '') + T.eloDelta}</b></span>
        ${T.gone.length ? '<span class="loss">掉线 ' + esc(T.gone.join('、')) + '</span>' : ''}
      </div>
    </div>`;
  const tabs = [['overview', '总览'], ['players', '玩家'], ['units', '单位'], ['timeline', '时间线']];
  $('mrBody').innerHTML = `
    <div class="mr-teams">${teamBox(r.teams[0])}<div class="mr-vs">VS</div>${teamBox(r.teams[1])}</div>
    <div class="mr-tabs">${tabs.map(([k, n]) => `<button type="button" class="mr-tab${mrTab === k ? ' active' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
    <div id="mrTabBody"></div>`;
  $('mrBody').querySelectorAll('.mr-tab').forEach((b) => b.addEventListener('click', () => { mrTab = b.dataset.tab; renderMatchReport(); }));
  const body = $('mrTabBody');
  if (mrTab === 'overview') body.innerHTML = mrOverview(r);
  else if (mrTab === 'players') { body.innerHTML = mrPlayers(r); mrBindPlayers(); }
  else if (mrTab === 'units') { body.innerHTML = mrUnits(r); mrBindUnits(); }
  else body.innerHTML = mrTimeline(r);
}

// ---------- 总览 ----------
function mrOverview(r) {
  const [A, B] = r.teams;
  const ins = (r.insights || []).map((i) => `<li class="${i.kind === 'good' ? 'win' : i.kind === 'bad' ? 'loss' : ''}">${esc(i.text)}</li>`).join('');
  const rows = [
    ['摧毁分', 'D'], ['损失分', 'L'], ['击杀（单位数）', 'kills'], ['阵亡（单位数）', 'deaths'], ['造成伤害', 'dmg'], ['承受伤害', 'dmgTaken'],
    ['出兵花费', 'spent'], ['出兵数量', 'unitsDeployed'], ['补给消耗', 'supply'], ['占点', 'obj'], ['缴获敌方补给', 'supplyCaptured']
  ];
  const bar = (label, a, b) => {
    const tot = (a || 0) + (b || 0) || 1;
    return `<div class="mr-cmp"><span class="mr-cmp-a">${mrNum(a)}</span>
      <div class="mr-cmp-bar"><i class="a" style="width:${((a || 0) / tot) * 100}%"></i><i class="b" style="width:${((b || 0) / tot) * 100}%"></i><em>${label}</em></div>
      <span class="mr-cmp-b">${mrNum(b)}</span></div>`;
  };
  const surv = (T) => (T.unitsDeployed ? Math.round(((T.unitsDeployed - T.unitsDead) / T.unitsDeployed) * 100) : null);
  const best = (key, fmt, lowIsBest) => {
    const ps = r.players.filter((p) => !p.afk && p[key] != null);
    const p = [...ps].sort((x, y) => (lowIsBest ? x[key] - y[key] : y[key] - x[key]))[0];
    return p ? `<span class="t${p.team}">${esc(p.name)}</span> <b>${fmt(p[key])}</b>` : '-';
  };
  return `
    ${ins ? '<div class="mr-sec"><h4>本局要点</h4><ul class="mr-insights">' + ins + '</ul></div>' : ''}
    <div class="mr-sec"><h4>双方对比 <span class="dim">（左 ${mrTeamName(0)}，右 ${mrTeamName(1)}；花费按官方出兵分折算）</span></h4>
      ${rows.map(([l, k]) => bar(l, A[k], B[k])).join('')}
      ${bar('单位存活率（%）', surv(A), surv(B))}
    </div>
    <div class="mr-sec"><h4>兵种构成（按出兵花费）</h4>
      <div class="mr-roles"><span class="t0">${mrTeamName(0)}</span>${mrRoleBar(A.roles)}</div>
      <div class="mr-roles"><span class="t1">${mrTeamName(1)}</span>${mrRoleBar(B.roles)}</div>
      <div class="mr-roles"><span></span>${mrRoleLegend()}</div>
    </div>
    <div class="mr-sec"><h4>全场之最</h4>
      <div class="mr-bests">
        <div>净交换最高：${best('net', mrNum)}</div>
        <div>K/D 最高：${best('kd', (v) => v)}</div>
        <div>伤害最高：${best('dmg', mrNum)}</div>
        <div>出兵最多：${best('unitsDeployed', (v) => v + ' 个')}</div>
        <div>单位存活率最高：${best('survival', (v) => v + '%')}</div>
        <div>每点花费击杀分最高：${best('dPerCost', (v) => v)}</div>
        <div>补给消耗最多：${best('supply', mrNum)}</div>
        <div>占点最多：${best('obj', (v) => v)}</div>
      </div>
    </div>`;
}

// ---------- 玩家 ----------
const MR_PCOLS = [
  ['score', '龙区', (p) => (p.mark ? dragonMarkHtml(p.mark, false, p.score) + ' ' + p.score : '-')],
  ['name', '玩家', (p) => `<b>${esc(p.name)}</b>${p.me ? ' <span class="mr-me">我</span>' : ''}<div class="mr-titles">${dragonTagsHtml(p)}</div>`],
  ['eloAfter', 'ELO', (p) => (p.eloBefore == null ? '-' : Math.round(p.eloAfter) + ' <span class="' + (p.eloAfter >= p.eloBefore ? 'win' : 'loss') + '">' + (p.eloAfter >= p.eloBefore ? '+' : '') + (Math.round((p.eloAfter - p.eloBefore) * 10) / 10) + '</span>')],
  ['net', '净交换', (p) => `<span class="${p.net >= 0 ? 'win' : 'loss'}">${p.net >= 0 ? '+' : ''}${mrNum(p.net)}</span>`],
  ['D', '摧毁 / 损失', (p) => mrNum(p.D) + ' / ' + mrNum(p.L)],
  ['kd', 'K/D', (p) => p.kd ?? '-'],
  ['kills', '击杀 / 阵亡', (p) => p.kills + ' / ' + p.deaths],
  ['dmg', '伤害 / 承伤', (p) => mrNum(p.dmg) + ' / ' + mrNum(p.dmgTaken)],
  ['spent', '出兵', (p) => p.unitsDeployed + ' 个 · ' + mrNum(p.spent)],
  ['survival', '存活率', (p) => (p.survival == null ? '-' : p.survival + '%')],
  ['lifeMedian', '阵亡存活·中位', (p) => mrSec(p.lifeMedian), '已阵亡单位从出兵到阵亡的时间，取中位数（活到结束的和返航回收的不算）'],
  ['dPerCost', '击杀分/花费', (p) => p.dPerCost ?? '-'],
  ['supply', '补给', (p) => mrNum(p.supply)],
  ['obj', '占点', (p) => p.obj]
];
function mrSortList(list, s) {
  return [...list].sort((a, b) => {
    const x = a[s.key], y = b[s.key];
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return typeof x === 'string' ? s.dir * x.localeCompare(y) : s.dir * (x - y);
  });
}
function mrPlayers(r) {
  const s = mrSort.players;
  const head = MR_PCOLS.map(([k, n, , tip]) => `<th data-sort="${k}" class="${s.key === k ? 'sorted' : ''}"${tip ? ' title="' + tip + '"' : ''}>${n}${s.key === k ? (s.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('');
  const table = (t) => {
    const T = r.teams[t];
    const rows = mrSortList(r.players.filter((p) => p.team === t), s).map((p) => `
      <tr class="mr-prow${p.me ? ' me' : ''}${mrOpenPlayer === p.id ? ' open' : ''}" data-pid="${esc(p.id)}" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-link="${PLAYER_URL(p.id)}">${MR_PCOLS.map(([, , f]) => `<td>${f(p)}</td>`).join('')}</tr>
      ${mrOpenPlayer === p.id ? '<tr class="mr-pdetail"><td colspan="' + MR_PCOLS.length + '">' + mrPlayerDetail(p) + '</td></tr>' : ''}`).join('');
    return `<h4 class="t${t}">${mrTeamName(t)}${T.faction ? '（' + mrFac(T.faction) + '）' : ''}${T.won == null ? '' : T.won ? ' · 胜' : ' · 负'}</h4>
      <div class="mr-scroll"><table class="mr-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  };
  return `<div class="dim mr-hint">点表头排序，点一行展开这个人的单位明细；右键玩家可以调查羁绊</div>${table(r.winnerTeam === 1 ? 1 : 0)}${table(r.winnerTeam === 1 ? 0 : 1)}`;
}
function mrPlayerDetail(p) {
  const roleBar = p.roles ? mrRoleBar(p.roles, true) + mrRoleLegend() : '';
  const parts = p.parts ? `<div class="mr-parts">
      <span>K/D 在同角色同分段里 <b>第 ${Math.round((p.parts.kd || 0) * 100)} 百分位</b></span>
      <span>摧毁贡献 <b>第 ${Math.round((p.parts.contrib || 0) * 100)} 百分位</b></span>
      ${p.parts.outcome != null ? `<span>胜负项 <b>第 ${Math.round(p.parts.outcome * 100)} 百分位</b></span>` : ''}
    </div>` : '';
  const extra = [
    p.supplyByAllies ? '队友吃了他 ' + mrNum(p.supplyByAllies) + ' 补给' : '',
    p.supplyFromAllies ? '他吃了队友 ' + mrNum(p.supplyFromAllies) + ' 补给' : '',
    p.supplyCaptured ? '缴获敌方补给 ' + mrNum(p.supplyCaptured) : '',
    p.supplyLostToEnemy ? '补给被缴获 ' + mrNum(p.supplyLostToEnemy) : '',
    p.airdrop ? '空投 ' + mrNum(p.airdrop) : '',
    p.buildings ? '拆建筑 ' + p.buildings + ' 栋' : '',
    p.ffDestroyed ? '误伤友军 ' + mrNum(p.ffDestroyed) : '',
    p.ffLost ? '被友军误伤 ' + mrNum(p.ffLost) : '',
    p.unitsRefunded ? '返航/回收 ' + p.unitsRefunded + ' 次（退回 ' + mrNum(p.refundScore) + '）' : '',
    p.leftAtMin != null ? '第 ' + p.leftAtMin + ' 分钟离开' : '',
    p.exp ? '经验 ' + mrNum(p.exp) : ''
  ].filter(Boolean).map((t) => '<span>' + esc(t) + '</span>').join('');
  const units = (p.units || []).map((u) => `<tr><td>${esc(u.name)}</td><td class="dim">${u.roleName}</td><td>${u.deployed}${u.refunded ? '<span class="dim">（回收 ' + u.refunded + '）</span>' : ''}</td><td>${u.dead}</td><td>${u.deathRate == null ? '-' : u.deathRate + '%'}</td><td>${mrSec(u.lifeMedian)}</td><td>${mrNum(u.dmg)}</td><td>${u.kills}</td><td>${mrNum(u.destr)}</td><td>${mrNum(u.spent)}</td></tr>`).join('');
  return `${roleBar}${parts}<div class="mr-extra">${extra}</div>
    <table class="mr-table mini"><thead><tr><th>单位</th><th>兵种</th><th title="出动次数，飞机按架次算；括号里是其中返航/回收的">出兵</th><th>阵亡</th><th>死亡率</th><th title="已阵亡单位从出兵到阵亡的时间，取中位数（活到结束的和返航回收的不算）">阵亡存活·中位</th><th>伤害</th><th>击杀</th><th>击杀分（估）</th><th>花费</th></tr></thead><tbody>${units}</tbody></table>`;
}
function mrBindPlayers() {
  const body = $('mrTabBody');
  body.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const s = mrSort.players; if (s.key === th.dataset.sort) s.dir = -s.dir; else { s.key = th.dataset.sort; s.dir = th.dataset.sort === 'name' ? 1 : -1; }
    renderMatchReport();
  }));
  body.querySelectorAll('tr.mr-prow').forEach((tr) => tr.addEventListener('click', () => { mrOpenPlayer = mrOpenPlayer === tr.dataset.pid ? null : tr.dataset.pid; renderMatchReport(); }));
}

// ---------- 单位 ----------
const MR_UCOLS = [
  ['name', '单位', (u) => `<b>${esc(u.name)}</b>`],
  ['roleName', '兵种', (u) => u.roleName],
  ['team', '队伍', (u) => `<span class="t${u.team}">${mrTeamName(u.team)}</span>`],
  ['usage', '使用率', (u) => (u.usage == null ? '-' : `<span class="mr-usage"><i style="width:${Math.min(100, u.usage * 3)}%"></i>${u.usage}%</span>`)],
  ['deployed', '出兵', (u) => u.deployed + (u.refunded ? '<span class="dim">（回收 ' + u.refunded + '）</span>' : ''), '出动次数，飞机按架次算；括号里是其中返航/回收的（回收 = 飞机返航、卡车开回、开局卖掉，官方全额退款，不算花费）'],
  ['cost', '单价', (u) => mrNum(u.cost)],
  ['deathRate', '死亡率', (u) => (u.deathRate == null ? '-' : `<span class="${u.deathRate >= 80 ? 'loss' : u.deathRate <= 30 ? 'win' : ''}">${u.deathRate}%</span>`)],
  ['lifeMedian', '阵亡存活·中位', (u) => mrSec(u.lifeMedian), '已阵亡单位从出兵到阵亡的时间，取中位数（活到结束的和返航回收的不算）'],
  ['dmg', '伤害', (u) => mrNum(u.dmg)],
  ['kills', '击杀', (u) => u.kills],
  ['destr', '击杀分（估）', (u) => mrNum(u.destr)],
  ['destrPerCost', '击杀分/花费', (u) => u.destrPerCost ?? '-'],
  ['users', '使用者', (u) => `<span class="dim">${esc(u.users.join('、'))}</span>`]
];
function mrUnits(r) {
  const teamValue = [0, 1].map((t) => r.units.filter((u) => u.team === t).reduce((s, u) => s + (u.value || 0), 0) || 1);
  const list = r.units.filter((u) => mrUnitTeam === 'all' || String(u.team) === mrUnitTeam)
    .map((u) => ({ ...u, usage: Math.round(((u.value || 0) / teamValue[u.team]) * 1000) / 10 }));
  const s = mrSort.units;
  const head = MR_UCOLS.map(([k, n, , tip]) => `<th data-sort="${k}" class="${s.key === k ? 'sorted' : ''}"${tip ? ' title="' + tip + '"' : ''}>${n}${s.key === k ? (s.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('');
  const rows = mrSortList(list, s).map((u) => `<tr>${MR_UCOLS.map(([, , f]) => `<td>${f(u)}</td>`).join('')}</tr>`).join('');
  const filt = [['all', '全部'], ['0', 'A 队'], ['1', 'B 队']].map(([k, n]) => `<button type="button" class="mr-tab small${mrUnitTeam === k ? ' active' : ''}" data-uteam="${k}">${n}</button>`).join('');
  return `<div class="mr-filter">${filt}<span class="dim mr-hint">出兵 = 出动次数，飞机按架次算，返航后再出算两次；使用率 = 出动价值（出兵 × 单价）占本队的比例；死亡率 = 阵亡 ÷ 出兵；回收 = 飞机返航、卡车开回、开局卖掉，官方全额退款，不算花费；击杀分/花费越高越赚；单位的击杀分是把这个人的总击杀分按各单位击杀数分下去的估算</span></div>
    <div class="mr-scroll"><table class="mr-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function mrBindUnits() {
  const body = $('mrTabBody');
  body.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const s = mrSort.units; if (s.key === th.dataset.sort) s.dir = -s.dir; else { s.key = th.dataset.sort; s.dir = ['name', 'roleName'].includes(th.dataset.sort) ? 1 : -1; }
    renderMatchReport();
  }));
  body.querySelectorAll('[data-uteam]').forEach((b) => b.addEventListener('click', () => { mrUnitTeam = b.dataset.uteam; renderMatchReport(); }));
}

// ---------- 时间线（内联 SVG） ----------
function mrTimeline(r) {
  const tl = r.timeline;
  const n = tl.minutes;
  const W = 860, H = 220, P = { l: 52, r: 12, t: 14, b: 26 };
  const x = (i) => P.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - P.l - P.r));
  const maxF = Math.max(1, ...tl.field[0], ...tl.field[1]);
  const y = (v) => P.t + (1 - v / maxF) * (H - P.t - P.b);
  const line = (arr) => arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(Math.max(0, v)).toFixed(1)).join(' ');
  const xTicks = []; for (let i = 0; i < n; i += Math.max(1, Math.round(n / 9))) xTicks.push(i);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxF * f));
  const evMarks = (tl.events || []).map((e) => `<g><line x1="${x(e.min)}" x2="${x(e.min)}" y1="${P.t}" y2="${H - P.b}" class="mr-ev t${e.team}"/><title>第 ${e.min + 1} 分钟 · ${mrTeamName(e.team)} · ${esc(e.text)}</title></g>`).join('');
  const field = `<svg viewBox="0 0 ${W} ${H}" class="mr-chart">
    ${yTicks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="mr-grid"/><text x="${P.l - 6}" y="${y(v) + 4}" class="mr-ax" text-anchor="end">${mrNum(v)}</text>`).join('')}
    ${xTicks.map((i) => `<text x="${x(i)}" y="${H - 8}" class="mr-ax" text-anchor="middle">${i + 1}′</text>`).join('')}
    ${evMarks}
    <path d="${line(tl.field[0])}" class="mr-line t0"/><path d="${line(tl.field[1])}" class="mr-line t1"/>
  </svg>`;
  // 每分钟损失：A 队向上、B 队向下
  const H2 = 200, mid = H2 / 2;
  const maxL = Math.max(1, ...tl.loss[0], ...tl.loss[1]);
  const bw = Math.max(2, (W - P.l - P.r) / n - 2);
  const bars = [0, 1].map((t) => tl.loss[t].map((v, i) => {
    const h = (v / maxL) * (mid - 14);
    return `<rect x="${x(i) - bw / 2}" y="${t === 0 ? mid - h : mid}" width="${bw}" height="${h}" class="mr-bar t${t}"><title>第 ${i + 1} 分钟 · ${mrTeamName(t)}损失 ${mrNum(Math.round(v))}</title></rect>`;
  }).join('')).join('');
  const loss = `<svg viewBox="0 0 ${W} ${H2}" class="mr-chart">
    <line x1="${P.l}" x2="${W - P.r}" y1="${mid}" y2="${mid}" class="mr-grid"/>
    <text x="${P.l - 6}" y="16" class="mr-ax t0" text-anchor="end">A 队</text><text x="${P.l - 6}" y="${H2 - 6}" class="mr-ax t1" text-anchor="end">B 队</text>
    ${bars}
  </svg>`;
  const evList = (tl.events || []).map((e) => `<li><span class="t${e.team}">第 ${e.min + 1} 分钟 · ${mrTeamName(e.team)}</span> ${esc(e.text)}</li>`).join('');
  return `
    <div class="mr-sec"><h4>场上兵力 <span class="dim">（累计出兵 − 累计损失，按官方出兵分折算；<span class="t0">蓝 = A 队</span>，<span class="t1">红 = B 队</span>）</span></h4>${field}</div>
    <div class="mr-sec"><h4>每分钟损失 <span class="dim">（悬停看数值）</span></h4>${loss}</div>
    ${evList ? '<div class="mr-sec"><h4>关键时刻</h4><ul class="mr-insights">' + evList + '</ul></div>' : ''}`;
}

// 入口：弹窗关闭
(function bindMatchReport() {
  const close = () => $('reportModal').classList.add('hidden');
  const btn = $('btnMrClose'); if (btn) btn.addEventListener('click', close);
  const m = $('reportModal'); if (m) m.addEventListener('click', (e) => { if (e.target === m) close(); });
})();
