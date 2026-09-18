// ================= 单局称号 =================
// 和龙区分开算：龙区看「在他的分段、他的角色里算不算强」（按 ELO 和角色标准化）；
// 称号只看「这一局对战局的实际作用」，不考虑 ELO —— 高分老哥带低分队友，功劳就是功劳。
// 功劳最大 / 背锅也做成称号（大腿 / 背锅侠 / 掉线狗），外加各种突出表现（好的坏的都有）。
// 数据：/api/match 的 matchInfo（每个玩家的战绩 + 每个单位的出生/阵亡/伤害/击杀）。
// 「突出表现」的阈值来自真实数据：按每局最突出者的分布，让每种称号只在少数对局里出现
// （src/dragonModel.json 的 titles，由 scripts/fit-dragon-model.js 生成）。
let MODEL = null;
try { MODEL = require('./dragonModel.json'); } catch (e) { MODEL = null; }

const teamOf = (p) => (p.TeamId == null ? 0 : p.TeamId);
const num = (v) => Number(v) || 0;
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (x) => Math.round(x * 100);

// 称号 → 好/坏/中性；显示名和说明在 i18n（title.<id> / title.<id>.tip）
const TITLES = {
  carry: 'good', blame: 'bad', deserter: 'bad', tryhard: 'good', passenger: 'bad', lonewolf: 'good',
  reaper: 'good', untouched: 'good', landlord: 'good', artygod: 'good', bandit: 'good', canteen: 'good',
  weightlifter: 'neutral', killsteal: 'neutral', demolition: 'neutral', courier: 'neutral', refund: 'neutral', backstabbed: 'neutral',
  atm: 'bad', scraper: 'bad', boxed: 'bad', camper: 'bad', convoy: 'bad', freeloader: 'bad', spender: 'bad', traitor: 'bad', crash: 'bad'
};
// 每人每局只给一个称号：符合多个时选「最罕见」的那个 ——
// 估计一个随机玩家在一局里拿到这个称号（而且至少这么夸张）的概率，概率越小越突出。
//   突出表现：按真实数据里「每局最突出者」的分布算（model.titleDist）
//   大腿/背锅侠/带不动/躺赢狗/孤勇者：按它们在真实数据里的出现频率（model.titleFreq；大腿每局都有，约 1/10）
//   掉线狗：最优先 —— 挂机的人数据再好看也只显示掉线狗
const PLAYERS_PER_MATCH = 10;
const DEFAULT_FREQ = { carry: 1, blame: 0.72, tryhard: 0.16, passenger: 0.1, lonewolf: 0.16 };
const freqOf = (id) => (((MODEL && MODEL.titleFreq) || DEFAULT_FREQ)[id] ?? DEFAULT_FREQ[id] ?? 0.1) / PLAYERS_PER_MATCH;
// 突出表现的罕见程度：真实数据里有多少比例的对局，最突出者至少这么夸张
function rarityOf(s, v, th) {
  const d = MODEL && MODEL.titleDist && MODEL.titleDist[s.id];
  if (d && d.n) {
    const k = d.top.filter((x) => s.dir * (x - v) >= 0).length;
    return Math.max(k, 0.5) / d.n / PLAYERS_PER_MATCH;
  }
  // 没有分布时：按超出阈值的倍数粗估
  const ratio = s.dir > 0 ? (th > 0 ? v / th : 3) : (v > 0 ? th / v : 3);
  return s.target / Math.max(ratio, 1) / PLAYERS_PER_MATCH;
}

// 「突出表现」称号：key = 比较的指标，dir = 1 越大越突出 / -1 越小越突出，filter = 前提条件，
// target = 希望出现在多少比例的对局里（校准阈值用），min = 阈值下限（再少就不值一提）
const SPECS = [
  { id: 'reaper', key: (m) => m.dShare, dir: 1, target: 0.08, min: 0.15, params: (m) => ({ p: pct(m.dShare) }) },
  { id: 'untouched', key: (m) => m.lTeamShare, dir: -1, filter: (m) => m.dTeamRatio >= 1, target: 0.06, params: (m) => ({ p: pct(m.lTeamShare), x: r2(m.dTeamRatio) }) },
  { id: 'weightlifter', key: (m) => Math.min(m.killShare, m.deathShare), dir: 1, filter: (m) => m.kd >= 0.75 && m.kd <= 1.33, target: 0.06, min: 0.1, params: (m) => ({ k: m.kills, d: m.deaths, kd: r2(m.kd) }) },
  { id: 'atm', key: (m) => m.lShare, dir: 1, filter: (m) => m.kd < 0.5, target: 0.07, min: 0.1, params: (m) => ({ p: pct(m.lShare), kd: r2(m.kd) }) },
  { id: 'scraper', key: (m) => m.dmgShare, dir: 1, filter: (m) => m.dTeamRatio < 0.8, target: 0.05, min: 0.1, params: (m) => ({ p: pct(m.dmgShare), x: r2(m.dTeamRatio) }) },
  { id: 'killsteal', key: (m) => m.ksEff, dir: 1, filter: (m) => m.dTeamRatio >= 1 && m.dmg > 0, target: 0.04, params: (m) => ({ x: Math.round(m.ksEff) }) },
  { id: 'boxed', key: (m) => m.lifeMed, dir: -1, filter: (m) => m.lifeMed != null && m.deaths >= 10, target: 0.06, params: (m) => ({ s: Math.round(m.lifeMed) }) },
  { id: 'camper', key: (m) => m.lTeamShare, dir: -1, filter: (m) => m.dTeamRatio <= 0.5 && m.minutes >= 10, target: 0.05, params: (m) => ({ p: pct(m.lTeamShare), x: r2(m.dTeamRatio) }) },
  // 占点份额经常正好是 1/2、1/3，加上占点数的一点点打破并列，免得一堆人卡在同一个阈值上
  { id: 'landlord', key: (m) => m.oTeamShare + m.O / 1000, dir: 1, filter: (m) => m.O >= 3, target: 0.07, min: 0.3, params: (m) => ({ n: m.O, p: pct(m.oTeamShare) }) },
  { id: 'demolition', key: (m) => m.buildings + m.D / 1e7, dir: 1, target: 0.04, min: 3, params: (m) => ({ n: m.buildings }) },
  { id: 'convoy', key: (m) => m.convoy, dir: 1, pool: 'all', target: 0.05, min: 100, params: (m) => ({ n: Math.round(m.convoy) }) },
  { id: 'bandit', key: (m) => m.bandit, dir: 1, target: 0.05, min: 100, params: (m) => ({ n: Math.round(m.bandit) }) },
  { id: 'canteen', key: (m) => m.canteen, dir: 1, target: 0.05, min: 500, params: (m) => ({ n: Math.round(m.canteen) }) },
  { id: 'freeloader', key: (m) => m.freeloader, dir: 1, target: 0.05, min: 500, params: (m) => ({ n: Math.round(m.freeloader) }) },
  { id: 'courier', key: (m) => m.airdrop, dir: 1, target: 0.04, min: 500, params: (m) => ({ n: Math.round(m.airdrop) }) },
  { id: 'refund', key: (m) => m.refundRatio, dir: 1, target: 0.04, min: 0.1, params: (m) => ({ p: pct(m.refundRatio) }) },
  { id: 'spender', key: (m) => m.spawnShare, dir: 1, filter: (m) => m.dTeamRatio < 0.7, target: 0.05, min: 0.12, params: (m) => ({ p: pct(m.spawnShare), x: r2(m.dTeamRatio) }) },
  { id: 'traitor', key: (m) => m.ffDestroyCost, dir: 1, pool: 'all', target: 0.04, min: 100, params: (m) => ({ n: Math.round(m.ffDestroyCost) }) },
  { id: 'backstabbed', key: (m) => m.ffLossScore, dir: 1, pool: 'all', target: 0.03, min: 100, params: (m) => ({ n: Math.round(m.ffLossScore) }) },
  { id: 'crash', key: (m) => m.airLoss, dir: 1, target: 0.05, min: 300, params: (m) => ({ n: Math.round(m.airLoss) }) },
  { id: 'artygod', key: (m) => m.dShare, dir: 1, filter: (m) => m.artyShare >= 0.3, target: 0.04, min: 0.12, params: (m) => ({ p: pct(m.dShare), a: pct(m.artyShare) }) }
];
// 模型缺失时的保守默认阈值
const DEFAULT_T = {
  objValue: 0, reaper: 0.2, untouched: 0.05, weightlifter: 0.16, atm: 0.18, scraper: 0.17, killsteal: 12, boxed: 45, camper: 0.05,
  landlord: 0.5, demolition: 8, convoy: 1500, bandit: 1500, canteen: 8000, freeloader: 8000, courier: 3000, refund: 0.35,
  spender: 0.16, traitor: 400, backstabbed: 400, crash: 3000, artygod: 0.2
};
const T = () => Object.assign({}, DEFAULT_T, (MODEL && MODEL.titles) || {});

/**
 * 每个玩家这一局的原始指标（发称号和拟合阈值共用）
 * @param {object} mi        /api/match 的 matchInfo
 * @param {object} [unitMap] { 单位ID: [角色, 价格] }（默认取模型里的单位表）
 */
function titleMetrics(mi, unitMap) {
  const um = unitMap || (MODEL && MODEL.units) || {};
  const all = Object.values((mi && mi.Data) || {}).filter((p) => teamOf(p) === 0 || teamOf(p) === 1);
  const start = num(mi && mi.StartTime), dur = num(mi && mi.TotalPlayTimeInSec);
  const sumAll = (k) => all.reduce((s, p) => s + num(p[k]), 0);
  const tot = { D: sumAll('DestructionScore'), K: sumAll('Destruction'), Dth: sumAll('Losses'), L: sumAll('LossesScore'), dmg: sumAll('DamageDealt'), spawned: sumAll('TotalSpawnedUnitScore') };
  const teamTot = {};
  for (const t of [0, 1]) {
    const team = all.filter((p) => teamOf(p) === t);
    teamTot[t] = { n: team.length || 1, D: team.reduce((s, p) => s + num(p.DestructionScore), 0), L: team.reduce((s, p) => s + num(p.LossesScore), 0), O: team.reduce((s, p) => s + num(p.ObjectivesCaptured), 0) };
  }
  return all.map((p) => {
    const units = Object.values(p.UnitData || {});
    const spawns = units.map((u) => num(u.SpawnTime)).filter(Boolean);
    const lastSpawnFrac = spawns.length && start && dur ? Math.max(0, Math.min(1, (Math.max(...spawns) - start) / dur)) : null;
    const lives = units.filter((u) => u.DeathTime && u.SpawnTime).map((u) => num(u.DeathTime) - num(u.SpawnTime)).filter((x) => x >= 0);
    let airLoss = 0, artyCost = 0, cost = 0, buildings = 0;
    for (const u of units) {
      buildings += num(u.BuildingDestroyedCount);
      const e = um[u.Id];
      if (!e || !e[0]) continue;
      cost += e[1];
      if (e[0] === 'arty') artyCost += e[1];
      if ((e[0] === 'heli' || e[0] === 'jet') && u.DeathTime) airLoss += e[1];
    }
    const tt = teamTot[teamOf(p)];
    const D = num(p.DestructionScore), L = num(p.LossesScore), O = num(p.ObjectivesCaptured);
    return {
      id: String(p.Id), name: p.Name || '', team: teamOf(p), minutes: dur / 60,
      D, L, O, kills: num(p.Destruction), deaths: num(p.Losses), dmg: num(p.DamageDealt),
      kd: L > 0 ? D / L : (D > 0 ? 10 : 1),
      dShare: tot.D ? D / tot.D : 0,
      lShare: tot.L ? L / tot.L : 0,
      lTeamShare: tt.L ? L / tt.L : 0,
      dTeamRatio: tt.D ? D / (tt.D / tt.n) : 0,
      oTeamShare: tt.O ? O / tt.O : 0,
      killShare: tot.K ? num(p.Destruction) / tot.K : 0,
      deathShare: tot.Dth ? num(p.Losses) / tot.Dth : 0,
      dmgShare: tot.dmg ? num(p.DamageDealt) / tot.dmg : 0,
      ksEff: num(p.DamageDealt) > 0 ? D / num(p.DamageDealt) : 0,
      lifeMed: lives.length >= 8 ? median(lives) : null,
      spawnShare: tot.spawned ? num(p.TotalSpawnedUnitScore) / tot.spawned : 0,
      refundRatio: num(p.TotalSpawnedUnitScore) > 0 ? num(p.TotalRefundedUnitScore) / num(p.TotalSpawnedUnitScore) : 0,
      convoy: num(p.SupplyCapturedByEnemy), bandit: num(p.SupplyCaptured),
      canteen: num(p.SupplyPointsConsumedByAllies), freeloader: num(p.SupplyPointsConsumedFromAllies),
      airdrop: num(p.SupplyAirdropped),
      ffDestroyCost: num(p.DestructionFriendlyFireCost), ffLossScore: num(p.LossesByFriendlyFireScore),
      airLoss, buildings,
      artyShare: cost ? artyCost / cost : 0,
      deserter: !!p.Deserter,
      lastSpawnFrac,
      silent: D + L === 0
    };
  });
}

// 掉线/挂机：游戏的逃兵标记（打到 85% 以后才走的不算）；或全场零战果；或很早就不再出兵且几乎没战果
const isGone = (m) => m.silent || (m.deserter && (m.lastSpawnFrac == null || m.lastSpawnFrac < 0.85)) || (m.lastSpawnFrac != null && m.lastSpawnFrac < 0.4 && m.dTeamRatio < 0.15);
// 缺席比例（算「以少打多」用）：按最后一次出兵的时间折算；没有单位数据时按整局缺席
const absenceOf = (m) => (m.silent ? 1 : m.lastSpawnFrac != null ? 1 - m.lastSpawnFrac : 1);
const livePool = (ms) => ms.filter((x) => !x.gone && x.minutes >= 8);
function poolFor(ms, s) { return (s.pool === 'all' ? ms : livePool(ms)).filter((x) => !s.filter || s.filter(x)); }
function bestOf(pool, s) {
  let best = null;
  for (const m of pool) { const v = s.key(m); if (v == null) continue; if (!best || s.dir * (v - s.key(best)) > 0) best = m; }
  return best;
}

/**
 * 发称号
 * @param {object} mi
 * @param {object} opts
 * @param {number|null} opts.winnerTeam  胜方（0/1），未知时不发大腿/背锅类
 * @param {object} [opts.unitMap]
 * @returns { [玩家ID]: { titles: [{ id, kind, params }], mvp, blame, gone, absence, impact } }
 */
function awardTitles(mi, opts = {}) {
  const t = Object.assign(T(), opts.thresholds || {});
  const ms = titleMetrics(mi, opts.unitMap);
  const out = {};
  if (!ms.length) return out;
  const cand = [];
  const give = (m, title, p, params) => cand.push({ pid: m.id, title, p, params: params || {} }); // p 越小越突出
  // 这一局的功劳：净交换（摧毁分 − 损失分）；不看 ELO、不看角色、不看占点
  // 占点不计入（和地图、选位强相关），objValue 固定为 0，保留参数只为将来对照
  for (const m of ms) { m.gone = isGone(m); m.impact = m.D - m.L + (t.objValue || 0) * m.O; }
  const netParams = (m) => ({ d: Math.round(m.D), l: Math.round(m.L), net: Math.round(m.impact) });
  const byImpact = [...ms].sort((a, b) => b.impact - a.impact);
  const rankOf = (m) => byImpact.indexOf(m) + 1;

  for (const m of ms) if (m.gone) give(m, 'deserter', -1, m.silent || m.lastSpawnFrac == null ? { silent: true } : { min: Math.round(m.lastSpawnFrac * m.minutes) });

  const W = opts.winnerTeam;
  if (W === 0 || W === 1) {
    const win = ms.filter((m) => m.team === W && !m.gone), lose = ms.filter((m) => m.team !== W);
    const best = [...win].sort((a, b) => b.impact - a.impact)[0];
    if (best) { best.mvp = true; give(best, 'carry', freqOf('carry'), netParams(best)); }
    // 背锅：输方有人掉线，锅就是他的（掉线狗称号本身就说明了）；否则给净贡献最低的人
    const loseGone = lose.filter((m) => m.gone);
    if (loseGone.length) for (const m of loseGone) m.blame = true;
    else { const worst = [...lose].sort((a, b) => a.impact - b.impact)[0]; if (worst) { worst.blame = true; give(worst, 'blame', freqOf('blame'), netParams(worst)); } }
    // 带不动：输方贡献最大，而且是全场第一
    const loseBest = [...lose.filter((m) => !m.gone)].sort((a, b) => b.impact - a.impact)[0];
    if (loseBest && rankOf(loseBest) === 1) give(loseBest, 'tryhard', freqOf('tryhard'), {});
    // 躺赢：赢方最低、净贡献为负，而且在全场（不算掉线的人）垫底
    const winWorst = [...win].sort((a, b) => a.impact - b.impact)[0];
    const lastLive = byImpact.filter((m) => !m.gone).pop();
    if (winWorst && winWorst !== best && winWorst.impact < 0 && winWorst === lastLive) give(winWorst, 'passenger', freqOf('passenger'), netParams(winWorst));
  }
  // 孤勇者：本队有人掉线（缺人），他是本队贡献最大、且放在全场也排前 3
  for (const team of [0, 1]) {
    const mates = ms.filter((m) => m.team === team);
    const goneN = mates.filter((m) => m.gone).length;
    if (!goneN) continue;
    const top = mates.filter((m) => !m.gone).sort((a, b) => b.impact - a.impact)[0];
    if (top && rankOf(top) <= 3) give(top, 'lonewolf', freqOf('lonewolf'), { n: goneN });
  }
  // 突出表现：每种称号一局只给最突出的那个人
  for (const s of SPECS) {
    const th = t[s.id];
    if (th == null) continue;
    const best = bestOf(poolFor(ms, s), s);
    if (!best) continue;
    const v = s.key(best);
    if (s.dir > 0 ? v < th : v > th) continue;
    give(best, s.id, rarityOf(s, v, th), s.params(best));
  }

  const byPlayer = {};
  for (const c of cand) (byPlayer[c.pid] = byPlayer[c.pid] || []).push(c);
  for (const m of ms) {
    const list = (byPlayer[m.id] || []).sort((a, b) => a.p - b.p).slice(0, 1);
    out[m.id] = {
      titles: list.map((c) => ({ id: c.title, kind: TITLES[c.title], params: c.params })),
      candidates: (byPlayer[m.id] || []).map((c) => c.title), // 符合条件的全部称号（统计用）
      mvp: !!m.mvp, blame: !!m.blame, gone: m.gone, absence: m.gone ? absenceOf(m) : 0, impact: Math.round(m.impact)
    };
  }
  return out;
}

/**
 * 按真实对局校准「突出表现」：阈值取「每局最突出者」数值分布的 (1 − target) 分位；
 * 同时记下超过阈值的那些数值（算罕见程度用）
 * @param {Array} mis  matchInfo 列表
 * @returns {{ th: { [称号]: 阈值 }, dist: { [称号]: { n, top } } }}
 */
function calibrateTitles(mis, unitMap) {
  const th = {}, dist = {};
  const per = mis.map((mi) => { const ms = titleMetrics(mi, unitMap); for (const m of ms) m.gone = isGone(m); return ms; });
  const r4 = (x) => Math.round(x * 10000) / 10000;
  for (const s of SPECS) {
    const vals = per.map((ms) => { const b = bestOf(poolFor(ms, s), s); return b ? s.key(b) : null; });
    const have = vals.filter((v) => v != null).sort((a, b) => s.dir * (b - a)); // 从最突出到最不突出
    const k = Math.max(0, Math.round(s.target * mis.length) - 1);
    let v = have.length ? have[Math.min(k, have.length - 1)] : null;
    if (v == null) continue;
    if (s.min != null && s.dir > 0) v = Math.max(v, s.min);
    th[s.id] = r4(v);
    dist[s.id] = { n: mis.length, top: have.filter((x) => s.dir * (x - v) >= 0).map(r4) };
  }
  return { th, dist };
}

module.exports = { awardTitles, titleMetrics, calibrateTitles, isGone, absenceOf, TITLES, SPECS, DEFAULT_T };
