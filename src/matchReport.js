// ================= 单局复盘页 =================
// 把 /api/match 的单局原始数据（每个玩家的战绩 + 每个单位的出生/阵亡/伤害/击杀）整理成复盘页要的东西：
//   总览（双方对比、阵营、预期胜率）、玩家明细、单位使用率/死亡率/效率、兵力时间线、本局要点。
// 纯函数、无 I/O；龙/区/泯和称号由 dragonScore.analyzeMatch 算好后传进来。
// 单位价格：单位库只有基础价格（不含配装），所以每个玩家按他自己的官方总数等比例缩放——
// 出兵花费对齐「出兵分 − 退款分」，损失对齐「损失分」。队伍总数和官方一致，单个单位的花费仍是估算。
// 单位的击杀分：数据里每个单位只有击杀数、没有击杀分，所以把这个人的总击杀分按各单位击杀数分下去
// （单位击杀数之和和玩家击杀数九成以上完全相等），也是估算。
const DS = require('./dragonScore');
const MT = require('./matchTitles');

const num = (v) => Number(v) || 0;
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const ROLE_NAME = { armor: '装甲', inf: '步兵', recon: '侦察', arty: '炮兵', aa: '防空', heli: '直升机', jet: '固定翼', null: '运输' };

/**
 * @param {object} mi       /api/match 的 matchInfo
 * @param {object} opts
 * @param {string} opts.fid
 * @param {object} [opts.review]   dragonScore.analyzeMatch 的结果（龙/区/泯、称号）
 * @param {Array}  [opts.localIds] 本机账号 ID（高亮「我」）
 * @param {Function} [opts.mapName] 地图 ID → 名称
 */
function buildMatchReport(mi, opts = {}) {
  const um = (DS.MODEL && DS.MODEL.units) || {};
  const start = num(mi.StartTime), dur = num(mi.TotalPlayTimeInSec) || Math.max(0, num(mi.EndTime) - start);
  const minutes = Math.max(1, Math.ceil(dur / 60));
  const all = Object.values(mi.Data || {}).filter((p) => DS.teamOf(p) === 0 || DS.teamOf(p) === 1);
  const review = opts.review || { players: [] };
  const revById = Object.fromEntries((review.players || []).map((p) => [p.id, p]));
  const localIds = new Set((opts.localIds || []).map(String));
  const metrics = Object.fromEntries(MT.titleMetrics(mi).map((m) => [m.id, m]));
  const winner = review.winnerTeam != null ? review.winnerTeam : null;

  // ---------- 玩家 ----------
  const unitAgg = new Map(); // `${team}:${unitId}` → 聚合
  const timeline = [0, 1].map(() => ({ spawn: new Array(minutes).fill(0), loss: new Array(minutes).fill(0), deathsN: new Array(minutes).fill(0) }));
  const minuteOf = (t) => Math.max(0, Math.min(minutes - 1, Math.floor((num(t) - start) / 60)));
  const players = all.map((p) => {
    const id = String(p.Id), team = DS.teamOf(p);
    const rv = revById[id] || {};
    const m = metrics[id] || {};
    const units = Object.values(p.UnitData || {});
    // 缩放系数：官方出兵/损失总数 ÷ 按基础价格算的总数
    let baseDeployed = 0, baseLost = 0;
    for (const u of units) { const c = (um[u.Id] || [])[1] || 0; if (!u.WasRefunded) baseDeployed += c; if (u.DeathTime) baseLost += c; }
    const kSpawn = baseDeployed > 0 && num(p.TotalSpawnedUnitScore) > 0 ? Math.max(0.5, (num(p.TotalSpawnedUnitScore) - num(p.TotalRefundedUnitScore)) / baseDeployed) : 1;
    const kLoss = baseLost > 0 && num(p.LossesScore) > 0 ? num(p.LossesScore) / baseLost : kSpawn;
    // 这个人平均每次击杀值多少击杀分（分配单位击杀分用）
    const unitKills = units.reduce((s, u) => s + num(u.KilledCount), 0);
    const dPerKill = unitKills > 0 ? num(p.DestructionScore) / unitKills : 0;
    let spent = 0, refundN = 0, deadN = 0, deployedN = 0, lostValue = 0;
    const lives = [];
    const mine = new Map();
    for (const u of units) {
      const e = um[u.Id] || [null, 0, '单位#' + u.Id, 0, -1];
      const cost = (e[1] || 0) * kSpawn; // 估算的实际价格（含配装）
      const lossCost = (e[1] || 0) * kLoss;
      const refunded = !!u.WasRefunded;
      const dead = !!u.DeathTime;
      const life = dead && u.SpawnTime ? Math.max(0, num(u.DeathTime) - num(u.SpawnTime)) : null;
      if (refunded) refundN++;
      else {
        deployedN++;
        spent += cost;
        if (u.SpawnTime) timeline[team].spawn[minuteOf(u.SpawnTime)] += cost;
      }
      if (dead) {
        deadN++; lostValue += lossCost;
        if (life != null) lives.push(life);
        timeline[team].loss[minuteOf(u.DeathTime)] += lossCost;
        timeline[team].deathsN[minuteOf(u.DeathTime)]++;
      }
      // 按单位型号聚合（玩家内 / 队伍内）
      for (const [map, key] of [[mine, u.Id], [unitAgg, team + ':' + u.Id]]) {
        const a = map.get(key) || { id: u.Id, name: e[2], role: e[0], country: e[3], team, count: 0, refunded: 0, dead: 0, dmg: 0, kills: 0, lives: [], users: new Set(), spent: 0, lost: 0, destr: 0 };
        a.count++;
        if (!refunded) a.spent += cost;
        if (dead) a.lost += lossCost;
        if (refunded) a.refunded++;
        if (dead) a.dead++;
        a.dmg += num(u.TotalDamageDealt);
        a.kills += num(u.KilledCount);
        a.destr += num(u.KilledCount) * dPerKill;
        if (life != null) a.lives.push(life);
        a.users.add(p.Name || id);
        map.set(key, a);
      }
    }
    const roles = DS.rolesFromUnits(p);
    const D = num(p.DestructionScore), L = num(p.LossesScore);
    const unitList = [...mine.values()].map(finishUnit).sort((a, b) => b.spent - a.spent);
    return {
      id, name: p.Name || id, team, me: localIds.has(id),
      eloBefore: DS.hasRating(p) ? r2(p.OldRating) : null,
      eloAfter: DS.hasRating(p) ? r2(p.NewRating) : null,
      score: rv.score ?? null, mark: rv.mark || null, titles: rv.titles || [], afk: !!rv.afk, parts: rv.parts || null,
      roles: roles ? Object.fromEntries(DS.ROLE_KEYS.map((k) => [k, Math.round(roles[k] * 100)])) : null,
      D, L, net: D - L, kd: L > 0 ? r2(D / L) : null,
      kills: num(p.Destruction), deaths: num(p.Losses),
      dmg: num(p.DamageDealt), dmgTaken: num(p.DamageReceived),
      obj: num(p.ObjectivesCaptured),
      spent: Math.round(spent), spawnScore: num(p.TotalSpawnedUnitScore), refundScore: num(p.TotalRefundedUnitScore), lostValue: Math.round(lostValue),
      unitsDeployed: deployedN, unitsRefunded: refundN, unitsDead: deadN,
      survival: deployedN ? Math.round(((deployedN - deadN) / deployedN) * 100) : null,
      lifeMedian: lives.length ? Math.round(median(lives)) : null,
      dmgPerCost: spent ? r2(num(p.DamageDealt) / spent) : null,
      dPerCost: spent ? r2(num(p.DestructionScore) / spent) : null, // 每 1 点花费打出的击杀分（玩家级是精确值）
      supply: num(p.SupplyPointsConsumed), supplyFromAllies: num(p.SupplyPointsConsumedFromAllies), supplyByAllies: num(p.SupplyPointsConsumedByAllies),
      supplyCaptured: num(p.SupplyCaptured), supplyLostToEnemy: num(p.SupplyCapturedByEnemy), airdrop: num(p.SupplyAirdropped),
      ffDestroyed: num(p.DestructionFriendlyFireCost), ffLost: num(p.LossesByFriendlyFireScore),
      buildings: m.buildings || 0, exp: num(p.TotalExp), medals: Array.isArray(p.Medals) ? p.Medals.length : 0,
      deserter: !!p.Deserter, leftAtMin: rv.afk && m.lastSpawnFrac != null ? Math.round(m.lastSpawnFrac * dur / 60) : null,
      units: unitList
    };
  });

  // ---------- 队伍 ----------
  const sum = (list, k) => list.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const teams = [0, 1].map((t) => {
    const ps = players.filter((p) => p.team === t);
    const us = [...unitAgg.values()].filter((u) => u.team === t);
    let ru = 0, us2 = 0; for (const u of us) { if (u.country === 1) ru += u.count; else if (u.country === 2) us2 += u.count; }
    const roleCost = Object.fromEntries(DS.ROLE_KEYS.map((k) => [k, 0]));
    for (const u of us) if (u.role && roleCost[u.role] != null) roleCost[u.role] += u.spent;
    const rc = Object.values(roleCost).reduce((a, b) => a + b, 0) || 1;
    const rated = ps.filter((p) => p.eloBefore != null);
    return {
      team: t, won: winner == null ? null : winner === t,
      faction: ru + us2 === 0 ? null : ru > us2 ? 'RU' : 'US',
      players: ps.length, gone: ps.filter((p) => p.afk).map((p) => p.name),
      avgElo: rated.length ? Math.round(sum(rated, 'eloBefore') / rated.length) : null,
      eloDelta: rated.length ? r1(rated.reduce((s, p) => s + (p.eloAfter - p.eloBefore), 0) / rated.length) : null,
      D: sum(ps, 'D'), L: sum(ps, 'L'), kills: sum(ps, 'kills'), deaths: sum(ps, 'deaths'), dmg: sum(ps, 'dmg'), dmgTaken: sum(ps, 'dmgTaken'),
      obj: sum(ps, 'obj'), spent: sum(ps, 'spent'), lostValue: sum(ps, 'lostValue'), supply: sum(ps, 'supply'),
      supplyCaptured: sum(ps, 'supplyCaptured'), unitsDeployed: sum(ps, 'unitsDeployed'), unitsDead: sum(ps, 'unitsDead'),
      roles: Object.fromEntries(DS.ROLE_KEYS.map((k) => [k, Math.round((roleCost[k] / rc) * 100)]))
    };
  });
  // 赛前预期胜率（两队在线队员平均分，缺人按模型扣分）：用胜方一名在线玩家的特征取
  let expected = null;
  const anyRated = all.find((p) => DS.isRated(p) && DS.teamOf(p) === 0);
  if (anyRated) {
    const gone = new Map(MT.titleMetrics(mi).filter(MT.isGone).map((m) => [m.id, MT.absenceOf(m)]));
    const f = DS.matchFeatures({ matchId: opts.fid, data: mi }, anyRated.Id, { inactive: new Set(gone.keys()), absence: gone });
    if (f) expected = [r2(f.E), r2(1 - f.E)];
  }
  teams[0].expected = expected ? expected[0] : null;
  teams[1].expected = expected ? expected[1] : null;

  // ---------- 单位 ----------
  const units = [...unitAgg.values()].map(finishUnit).sort((a, b) => b.spent - a.spent);

  // ---------- 时间线：场上兵力 = 累计出兵 − 累计损失（估算） ----------
  const field = timeline.map((tl) => { let acc = 0; return tl.spawn.map((s, i) => (acc += s - tl.loss[i])); });
  const events = [];
  for (const p of players) if (p.afk && p.leftAtMin != null) events.push({ min: p.leftAtMin, team: p.team, type: 'leave', text: p.name + ' 掉线/挂机' });
  for (const t of [0, 1]) {
    // 损失最惨的一分钟（至少是全场每分钟平均损失的 2.5 倍才算）
    const loss = timeline[t].loss; const avg = loss.reduce((a, b) => a + b, 0) / minutes;
    let mx = -1, at = -1; loss.forEach((v, i) => { if (v > mx) { mx = v; at = i; } });
    if (at >= 0 && mx > avg * 2.5 && mx >= 800) events.push({ min: at, team: t, type: 'spike', text: '一分钟内损失 ' + Math.round(mx) });
  }
  events.sort((a, b) => a.min - b.min);

  const report = {
    fid: String(opts.fid || ''), map: opts.mapName ? opts.mapName(mi.MapId) : String(mi.MapId ?? ''),
    startTime: start * 1000, durationSec: dur, endReason: mi.EndMatchReason ?? null, victoryLevel: mi.VictoryLevel ?? null,
    objectiveZones: mi.TotalObjectiveZonesCount ?? null,
    winnerTeam: winner, rated: !!review.rated, teams, players, units,
    timeline: { minutes, spawn: timeline.map((t) => t.spawn), loss: timeline.map((t) => t.loss), field, events }
  };
  report.insights = insights(report);
  return report;
}

function finishUnit(a) {
  const deployed = a.count - a.refunded;
  const spent = a.spent;
  return {
    id: a.id, name: a.name, role: a.role, roleName: ROLE_NAME[a.role] || ROLE_NAME.null, team: a.team,
    cost: deployed ? Math.round(spent / deployed) : null,
    count: a.count, deployed, refunded: a.refunded, dead: a.dead, spent: Math.round(spent), lost: Math.round(a.lost),
    deathRate: deployed ? Math.round((a.dead / deployed) * 100) : null,
    lifeMedian: a.lives.length ? Math.round(median(a.lives)) : null,
    dmg: Math.round(a.dmg), kills: a.kills,
    dmgPerCost: spent ? r2(a.dmg / spent) : null,
    destr: Math.round(a.destr), // 击杀分（估算）
    destrPerCost: spent ? r2(a.destr / spent) : null,
    killsPer1k: spent ? r1((a.kills / spent) * 1000) : null,
    users: [...a.users]
  };
}

// 本局要点：挑几条明显的事实，给复盘一个开头
function insights(r) {
  const out = [];
  const [A, B] = r.teams;
  const tn = (t) => (t === 0 ? 'A 队' : 'B 队');
  const fac = (t) => (r.teams[t].faction === 'RU' ? '（俄）' : r.teams[t].faction === 'US' ? '（美）' : '');
  if (r.winnerTeam != null && A.expected != null) {
    const w = r.teams[r.winnerTeam];
    if (w.expected < 0.35) out.push({ kind: 'good', text: tn(r.winnerTeam) + fac(r.winnerTeam) + '以弱胜强：赛前预期胜率只有 ' + Math.round(w.expected * 100) + '%' });
    else if (w.expected > 0.75) out.push({ kind: 'neutral', text: tn(r.winnerTeam) + fac(r.winnerTeam) + '赢得不意外：赛前预期胜率 ' + Math.round(w.expected * 100) + '%' });
  }
  // 交换比
  if (A.L && B.L) {
    const better = A.D - A.L >= B.D - B.L ? 0 : 1, o = r.teams[better], x = r.teams[1 - better];
    const ratio = x.D ? o.D / Math.max(1, x.D) : null;
    if (ratio && ratio >= 1.3) out.push({ kind: better === r.winnerTeam ? 'neutral' : 'bad', text: tn(better) + '摧毁是对面的 ' + r2(ratio) + ' 倍' + (r.winnerTeam != null && better !== r.winnerTeam ? '，却输了' : '') });
  }
  for (const t of [0, 1]) {
    const T = r.teams[t];
    if (T.gone.length) out.push({ kind: 'bad', text: tn(t) + '有人掉线/挂机：' + T.gone.join('、') });
    // 空军损失占比
    const air = r.units.filter((u) => u.team === t && (u.role === 'heli' || u.role === 'jet')).reduce((s, u) => s + u.lost, 0);
    if (T.lostValue && air / T.lostValue >= 0.35 && air >= 1500) out.push({ kind: 'bad', text: tn(t) + '损失里 ' + Math.round((air / T.lostValue) * 100) + '% 是飞机（' + Math.round(air) + '）' });
  }
  // 最赚、最亏的单位（出了至少 2 个；运输单位本来就不打伤害，不参与）
  const pool = r.units.filter((u) => u.role && u.deployed >= 2 && u.spent >= 300);
  const best = [...pool].sort((a, b) => b.destrPerCost - a.destrPerCost)[0];
  const worst = [...pool].filter((u) => u.deathRate >= 80).sort((a, b) => a.destrPerCost - b.destrPerCost)[0];
  if (best) out.push({ kind: 'good', text: '最赚的单位：' + tn(best.team) + '的 ' + best.name + '（出了 ' + best.deployed + ' 个，每 1 点花费打出 ' + best.destrPerCost + ' 击杀分，估算）' });
  if (worst) out.push({ kind: 'bad', text: '最亏的单位：' + tn(worst.team) + '的 ' + worst.name + '（出了 ' + worst.deployed + ' 个、死了 ' + worst.dead + ' 个，每 1 点花费只打出 ' + worst.destrPerCost + ' 击杀分，估算）' });
  for (const ev of r.timeline.events) if (ev.type === 'spike') out.push({ kind: 'neutral', text: '第 ' + (ev.min + 1) + ' 分钟 ' + tn(ev.team) + ev.text });
  return out;
}

module.exports = { buildMatchReport, ROLE_NAME };
