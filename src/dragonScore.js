// ================= 龙区分（取代蛆指数） =================
// 越高越像龙，越低越像区。设计见 docs/rating-design.md。
// 两种用法：
//   computeDragonScore —— 玩家的龙区分：最近 20 场排位局逐场打分，卡尔曼滤波汇总成 1~10（玩家报告里显示）
//   analyzeMatch       —— 单局复盘：一局里每个人的龙/区/泯（和同分段同角色比）+ 称号（src/matchTitles.js，只看本局实际作用）
// 所有参数（各角色的「普通水平」、分项权重、汇总速度、分档）都来自真实数据拟合，存在 src/dragonModel.json，
// 由 scripts/fit-dragon-model.js 生成；这里只有公式，没有拍脑袋的数字。
// 纯函数、无 I/O，便于回测。
//
// 每场三个表现指标 + 一个胜负项：
//   K/D    —— log2(摧毁分 ÷ 损失分)
//   贡献   —— log2(本人摧毁分 ÷ 本队在线队员人均摧毁分)
//   占点   —— log2(本人占点 ÷ 本队在线队员人均占点)（照算但权重为 0：和地图、选位强相关，不计入）
//   胜负   —— 实际结果 − Elo 预期胜率（按两队在线队员的赛前平均 ELO；缺人的一方按弱若干分算）
// 表现指标先按「同角色构成、同 ELO、同分差的玩家通常打成什么样」标准化，再换算成百分位：
// 这样空军/炮兵的 K/D 天然偏高、占点天然偏低这些差异，都由数据决定，不再靠手写曲线。
let MODEL = null;
try { MODEL = require('./dragonModel.json'); } catch (e) { MODEL = null; }
const { awardTitles } = require('./matchTitles');

// 角色（按单位库的类别 + 用途）：运输/后勤不计入
const ROLE_KEYS = ['armor', 'inf', 'recon', 'arty', 'aa', 'heli', 'jet'];
const FRONT = ['armor', 'inf', 'recon'];
// 单位库 category_type：0 侦察 1 步兵 2 载具 3 支援 4 后勤 5 直升机 6 固定翼
function roleKeyOf(categoryType, role) {
  switch (Number(categoryType)) {
    case 0: return 'recon';
    case 1: return Number(role) === 34 ? 'aa' : 'inf'; // 34 = 单兵防空
    case 2: return 'armor';
    case 3: { const r = Number(role); if (r === 14) return null; if (r === 15 || r === 16) return 'aa'; return 'arty'; } // 14 = 卡车
    case 5: { const r = Number(role); return r === 71 || r === 72 ? null : 'heli'; } // 71/72 = 运输直升机
    case 6: return Number(role) === 163 ? null : 'jet'; // 163 = 运输机
    default: return null;
  }
}
// 单位库（/api/units 的 units）→ { 单位ID: [角色, 基础价格, 名称, 国家(1 俄 / 2 美), 类别] }；
// 模型文件里已存一份，运行时不用请求单位库（名称、国家给对局复盘页用）
function buildUnitMap(units) {
  const m = {};
  for (const u of Array.isArray(units) ? units : []) m[u.id] = [roleKeyOf(u.category_type, u.role), Number(u.cost) || 0, u.hud_name || u.name || '', Number(u.country_id) || 0, Number(u.category_type)];
  return m;
}
const unitMapOf = (um) => um || (MODEL && MODEL.units) || {};
// 花费类别 → 角色的默认拆分（模型里有按全体数据统计的版本）
const DEFAULT_SPLIT = {
  recon: { recon: 1 }, infantry: { inf: 0.9, aa: 0.1 }, vehicles: { armor: 1 },
  support: { arty: 0.45, aa: 0.55 }, logistic: {}, helicopters: { heli: 1 }, aircrafts: { jet: 1 }
};
const CAT_KEYS = ['recon', 'infantry', 'vehicles', 'support', 'logistic', 'helicopters', 'aircrafts'];
const emptyRoles = () => Object.fromEntries(ROLE_KEYS.map((k) => [k, 0]));
function normRoles(acc) {
  const sum = ROLE_KEYS.reduce((s, k) => s + acc[k], 0);
  if (!(sum > 0)) return null;
  const r = {}; for (const k of ROLE_KEYS) r[k] = acc[k] / sum;
  r.known = true;
  return r;
}
function defaultRoles() {
  const r = (MODEL && MODEL.avgRoles) ? { ...MODEL.avgRoles } : { armor: 0.3, inf: 0.25, recon: 0.15, arty: 0.08, aa: 0.1, heli: 0.04, jet: 0.08 };
  r.known = false;
  return r;
}

// 本局实际出的单位 → 角色占比（按单位价格加权；/api/match 才有 UnitData）
function rolesFromUnits(player, unitMap) {
  const um = unitMapOf(unitMap);
  const acc = emptyRoles();
  for (const u of Object.values((player && player.UnitData) || {})) {
    const e = um[u.Id];
    if (e && e[0]) acc[e[0]] += e[1] || 1;
  }
  return normRoles(acc);
}
// 生涯花费（/api/analysis/player 的 categoryPreferences）→ 角色占比；
// 同一类别里再用最常用的 15 个单位（highlightUnits）拆分，例如「支援」拆成炮兵和防空
function rolesFromCareer(categoryPreferences, highlightUnits, unitMap, catSplit) {
  const um = unitMapOf(unitMap);
  const split = catSplit || (MODEL && MODEL.catSplit) || DEFAULT_SPLIT;
  const hl = {};
  for (const u of Array.isArray(highlightUnits) ? highlightUnits : []) {
    const e = um[u.unitId]; const cat = CAT_KEYS[Number(u.categoryType)];
    if (!cat) continue;
    hl[cat] = hl[cat] || { total: 0 };
    hl[cat].total += Number(u.totalCost) || 0;
    const role = e ? e[0] : null;
    hl[cat][role || '_none'] = (hl[cat][role || '_none'] || 0) + (Number(u.totalCost) || 0);
  }
  const acc = emptyRoles();
  for (const c of Array.isArray(categoryPreferences) ? categoryPreferences : []) {
    const spend = Number(c.totalCost) || 0;
    const def = split[c.categoryKey] || {};
    const h = hl[c.categoryKey];
    // 最常用单位的花费当观测、默认拆分当先验（相当于该类别 30% 花费的分量）
    const prior = 0.3 * spend;
    const denom = (h ? h.total : 0) + prior;
    for (const k of ROLE_KEYS) {
      const share = denom > 0 ? (((h && h[k]) || 0) + prior * (def[k] || 0)) / denom : (def[k] || 0);
      acc[k] += spend * share;
    }
  }
  return normRoles(acc);
}

// 接口是 protobuf 转 JSON，值为 0 的字段会被省略 —— TeamId 缺失 = 队伍 A(0)，WinnerTeam 缺失 = A 队胜，
// 摧毁分/损失分/占点缺失 = 0。
const teamOf = (p) => (p.TeamId == null ? 0 : p.TeamId);
const hasRating = (p) => typeof p.OldRating === 'number' && typeof p.NewRating === 'number';
const isRated = (p) => hasRating(p) && Math.abs(p.NewRating - p.OldRating) >= 0.01;

// 掉线/挂机：本局既没摧毁也没损失；或（有单位数据时）最后一次出兵早于对局前 40% 且摧毁分不到本队在线人均的 15%
const AFK = { lastSpawnFrac: 0.4, contribFrac: 0.15 };
function detectInactive(mi) {
  const all = Object.values((mi && mi.Data) || {});
  const out = new Set();
  const start = Number(mi && mi.StartTime) || 0;
  const dur = Number(mi && mi.TotalPlayTimeInSec) || 0;
  for (const t of [0, 1]) {
    const team = all.filter((p) => teamOf(p) === t);
    const avgD = team.reduce((a, p) => a + (Number(p.DestructionScore) || 0), 0) / (team.length || 1);
    for (const p of team) {
      const D = Number(p.DestructionScore) || 0, L = Number(p.LossesScore) || 0;
      if (D + L === 0) { out.add(String(p.Id)); continue; }
      const spawns = Object.values(p.UnitData || {}).map((u) => Number(u.SpawnTime) || 0).filter(Boolean);
      if (!spawns.length || !start || !dur) continue;
      const lastSpawnFrac = (Math.max(...spawns) - start) / dur;
      if (lastSpawnFrac < AFK.lastSpawnFrac && D < AFK.contribFrac * avgD) out.add(String(p.Id));
    }
  }
  return out;
}

const C_SCORE = 200; // 摧毁/损失分的平滑量（避免 0 分时 log 爆掉）
const expectCfg = () => (MODEL && MODEL.expect) || { scale: 400, afkPenalty: 400 };
const eloExpect = (own, opp, scale) => 1 / (1 + Math.pow(10, (opp - own) / scale));

/**
 * 一场（/api/players/matches 的一项，或把 /api/match 的 matchInfo 包成 { matchId, data }）→ 某玩家这一场的特征
 * @param {object} [opts]
 * @param {boolean} [opts.allowUnrated] 允许自定义局（单局复盘用；预期胜率按 0.5）
 * @param {number}  [opts.winnerTeam]   已知胜方（0/1），非排位局判胜负用
 * @param {Set}     [opts.inactive]     掉线/挂机玩家 ID（不传则按「无摧毁无损失」自动识别）
 * @param {Map}     [opts.absence]      { 玩家ID → 缺席比例 0~1 }（单局数据：按逃兵最后一次出兵的时间折算；不传按整局缺席）
 * @param {object}  [opts.expect]       { scale, afkPenalty }（拟合时用；默认取模型）
 * @returns 特征；观战、数据不全、（未允许时）非排位局返回 null
 */
function matchFeatures(raw, stbid, opts = {}) {
  const d = (raw && raw.data) || {};
  const all = Object.values(d.Data || {});
  const me = all.find((p) => String(p.Id) === String(stbid));
  if (!me || (teamOf(me) !== 0 && teamOf(me) !== 1)) return null;
  const rated = isRated(me);
  if (!rated && !opts.allowUnrated) return null; // 自定义局 / 未计分
  const team = all.filter((p) => teamOf(p) === teamOf(me));
  const opp = all.filter((p) => teamOf(p) === 1 - teamOf(me));
  if (!opp.length) return null;
  const inactiveAll = opts.inactive || detectInactive(d);
  const afk = inactiveAll.has(String(stbid));
  // 缺人修正只剔除别人：本人挂机不给自己「以少打多」的减免
  const inactive = new Set([...inactiveAll].filter((id) => String(id) !== String(stbid)));
  const active = (list) => list.filter((p) => !inactive.has(String(p.Id)));
  const avgElo = (list) => { const r = list.filter(hasRating); return r.length ? r.reduce((a, p) => a + p.OldRating, 0) / r.length : null; };
  const absent = (p) => (opts.absence && opts.absence.has(String(p.Id)) ? opts.absence.get(String(p.Id)) : 1);
  const missing = (list) => list.filter((p) => inactive.has(String(p.Id))).reduce((s, p) => s + absent(p), 0);
  const teamElo = avgElo(active(team)), oppElo = avgElo(active(opp)), matchElo = avgElo(team.concat(opp));
  // 本队人均只算在线的人：掉线/挂机的队友不拉低人均
  const onTeam = active(team).length ? active(team) : team;
  const sum = (list, k) => list.reduce((a, p) => a + (Number(p[k]) || 0), 0);
  const D = Number(me.DestructionScore) || 0, L = Number(me.LossesScore) || 0, O = Number(me.ObjectivesCaptured) || 0;
  const avgD = sum(onTeam, 'DestructionScore') / onTeam.length, avgO = sum(onTeam, 'ObjectivesCaptured') / onTeam.length;
  const minutes = (Number(d.TotalPlayTimeInSec) || 0) / 60;
  let won = null;
  if (rated) won = me.NewRating > me.OldRating; // 排位局：赢必涨、输必跌
  else if (opts.winnerTeam === 0 || opts.winnerTeam === 1) won = opts.winnerTeam === teamOf(me);
  const ex = opts.expect || expectCfg();
  let E = 0.5;
  if (rated && teamElo != null && oppElo != null) E = eloExpect(teamElo - ex.afkPenalty * missing(team), oppElo - ex.afkPenalty * missing(opp), ex.scale);
  const elo = hasRating(me) ? me.OldRating : null;
  return {
    fid: String(raw.matchId != null ? raw.matchId : ''),
    mapId: d.MapId != null ? d.MapId : null,
    endTime: d.EndTime ? d.EndTime * 1000 : null,
    minutes,
    rated,
    team: teamOf(me),
    teamSize: team.length,
    oppSize: opp.length,
    outnumbered: active(team).length < active(opp).length,
    afk,
    won,
    S: won == null ? null : won ? 1 : 0,
    E,
    expected: E,
    eloBefore: elo,
    eloDelta: hasRating(me) ? me.NewRating - me.OldRating : null,
    teamElo, oppElo, matchElo,
    eloN: elo != null && rated ? (elo - 2100) / 400 : 0,
    gapN: elo != null && rated && matchElo != null ? (elo - matchElo) / 400 : 0,
    // 显示用的原始倍数
    kd: L > 0 ? D / L : (D > 0 ? 10 : 1),
    contrib: avgD > 0 ? D / avgD : null,
    obj: avgO > 0 ? O / avgO : null,
    destruction: D, losses: L, objectives: O,
    conscript: rated && matchElo != null && elo < matchElo - 200,
    // 模型用的 log 指标
    x: {
      kd: Math.log2((D + C_SCORE) / (L + C_SCORE)),
      con: Math.log2((D + C_SCORE) / (avgD + C_SCORE)),
      obj: Math.log2((O + 1) / (avgO + 1)),
      dpm: Math.log2((D + C_SCORE) / Math.max(minutes, 5))
    }
  };
}

// 按「同角色构成、同 ELO、同分差的人通常打成什么样」标准化
function zScores(f, roles, norm) {
  const z = {};
  for (const k of ['kd', 'con', 'obj']) {
    const n = norm[k];
    let mu = n.elo * f.eloN + n.gap * f.gapN, v = 0;
    for (const q of ROLE_KEYS) { mu += (roles[q] || 0) * n.mu[q]; v += (roles[q] || 0) * n.sigma[q] * n.sigma[q]; }
    z[k] = (f.x[k] - mu) / Math.sqrt(v || 1);
  }
  return z;
}
// 标准正态分布函数（没有分布表时的兜底）
function phi(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
// 在分位表 q（101 个点，从小到大）里查百分位 0~1
function pctOf(v, q) {
  if (!Array.isArray(q) || q.length < 2) return phi(v);
  const n = q.length - 1;
  if (v <= q[0]) return 0;
  if (v >= q[n]) return 1;
  let lo = 0, hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (q[mid] <= v) lo = mid; else hi = mid; }
  const span = q[hi] - q[lo];
  return (lo + (span > 0 ? (v - q[lo]) / span : 0.5)) / n;
}
// 占点的权重按角色打折：前线（装甲/步兵/侦察）才负责占点
const objFactor = (roles) => FRONT.reduce((s, k) => s + (roles[k] || 0), 0) + 0.2 * ROLE_KEYS.filter((k) => !FRONT.includes(k)).reduce((s, k) => s + (roles[k] || 0), 0);

// 单场综合分（标准分尺度）+ 各分项百分位
function scoreMatch(f, roles, kind) {
  const m = MODEL || {};
  const norm = (m.norm && m.norm[kind]) || null;
  const w = m.weights || { kd: 0.4, con: 0.4, obj: 0.2, out: 0.5 };
  const outSd = m.outSd || 0.45;
  const parts = { kd: null, contrib: null, obj: null, outcome: null };
  let stat = 0;
  if (norm) {
    const z = zScores(f, roles, norm);
    const of = objFactor(roles);
    stat = (w.kd * z.kd + w.con * z.con + w.obj * of * z.obj) / (w.kd + w.con + w.obj * of);
    parts.kd = pctOf(z.kd, norm.kd.q);
    parts.contrib = pctOf(z.con, norm.con.q);
    parts.obj = pctOf(z.obj, norm.obj.q);
  }
  const out = f.S == null ? 0 : (f.S - f.E) / outSd;
  if (f.S != null) parts.outcome = phi(out);
  const c = stat + w.out * out;
  const pct = pctOf(c, m.matchPct && m.matchPct[kind]);
  return { c, pct, parts };
}

const to10 = (p) => Math.round((1 + 9 * p) * 10) / 10;
// 按显示出来的分数判断（和界面上的数字一致，边界上不会出现「2.8 却标泯」）：前 20% 龙、后 20% 区
function markOf(pct) {
  const mk = (MODEL && MODEL.marks) || { dragon: 0.8, qu: 0.2 };
  const v = to10(pct);
  return v >= to10(mk.dragon) ? 'dragon' : v <= to10(mk.qu) ? 'qu' : 'min';
}
function tierOf(pct) {
  const t = (MODEL && MODEL.tiers) || [[0.9, 'dragon'], [0.7, 'solid'], [0.3, 'average'], [0.1, 'weak'], [0, 'qu']];
  const v = to10(pct); // 同样按显示分数判断
  return (t.find(([p]) => v >= to10(p)) || t[t.length - 1])[1];
}

// 卡尔曼滤波：玩家水平每场缓慢漂移，每场表现是带噪声的观测；短局噪声更大
function kalman(scores, minutesList) {
  const k = (MODEL && MODEL.kalman) || { P0: 0.1, q: 0.002, r: 0.9, shortMin: 12 };
  let m = 0, P = k.P0;
  for (let i = 0; i < scores.length; i++) {
    P += k.q;
    const R = k.r / Math.min(1, Math.max(0.3, (minutesList[i] || 0) / k.shortMin));
    const K = P / (P + R);
    m += K * (scores[i] - m);
    P *= (1 - K);
  }
  return { m, P, P0: k.P0 };
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

/**
 * 玩家的龙区分
 * @param {object} input
 * @param {string|number} input.stbid
 * @param {Array} input.matches  /api/players/matches 的 matches（最新在前）
 * @param {Array} [input.categoryPreferences] /api/analysis/player 的兵种花费
 * @param {Array} [input.highlightUnits]      /api/analysis/player 的最常用单位
 * @returns 结果对象；有效排位局为 0 时返回 { error: 'noRated' }
 */
function computeDragonScore({ stbid, matches, categoryPreferences, highlightUnits }) {
  const roles = rolesFromCareer(categoryPreferences, highlightUnits) || defaultRoles();
  const feats = (Array.isArray(matches) ? matches : []).map((m) => matchFeatures(m, stbid)).filter(Boolean).slice(0, 20);
  if (!feats.length) return { error: 'noRated', stbid: String(stbid) };

  const rows = feats.map((f) => {
    const s = scoreMatch(f, roles, 'career');
    return { ...f, x: undefined, c: s.c, parts: s.parts, score: to10(s.pct), mark: markOf(s.pct) };
  });
  // 卡尔曼从旧到新
  const chron = [...rows].reverse();
  const k = kalman(chron.map((r) => r.c), chron.map((r) => r.minutes));
  const playerQ = MODEL && MODEL.playerPct;
  const pct = pctOf(k.m, playerQ);
  const sdM = Math.sqrt(k.P);
  const range = [to10(pctOf(k.m - sdM, playerQ)), to10(pctOf(k.m + sdM, playerQ))];
  const value = to10(pct);
  const tier = tierOf(pct);
  const parts = {};
  for (const key of ['kd', 'contrib', 'obj', 'outcome']) {
    const v = rows.map((r) => r.parts[key]).filter((x) => x != null);
    parts[key] = v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
  }

  // 解释：挑出偏离普通最明显的几项（分项是同条件玩家里的百分位，0.5 = 普通）
  const kdMed = median(feats.map((f) => f.kd));
  const contribMed = median(feats.map((f) => f.contrib).filter((x) => x != null));
  const objMed = median(feats.map((f) => f.obj).filter((x) => x != null));
  const avgExp = feats.reduce((a, f) => a + f.E, 0) / feats.length;
  const winRate = feats.filter((f) => f.won).length / feats.length;
  const frontShare = FRONT.reduce((s, q) => s + roles[q], 0);
  const reasons = [];
  const push = (key, weight, params) => reasons.push({ key, weight: Math.round(weight * 100) / 100, params });
  const dev = (p) => (p == null ? 0 : p - 0.5);
  if (dev(parts.kd) <= -0.12) push(frontShare >= 0.5 ? 'kdLowFront' : 'kdLowSupport', dev(parts.kd) * 4, { kd: kdMed.toFixed(2), p: Math.round(parts.kd * 100) });
  else if (dev(parts.kd) >= 0.12) push('kdHigh', dev(parts.kd) * 4, { kd: kdMed.toFixed(2), p: Math.round(parts.kd * 100) });
  if (Math.abs(dev(parts.contrib)) >= 0.12) push(parts.contrib > 0.5 ? 'contribHigh' : 'contribLow', dev(parts.contrib) * 4, { x: contribMed != null ? contribMed.toFixed(2) : '-' });
  const over = winRate - avgExp;
  if (Math.abs(over) >= 0.1) push(over > 0 ? 'overperform' : 'underperform', over * 3, { win: Math.round(winRate * 100), exp: Math.round(avgExp * 100) });
  if (avgExp <= 0.42) push('underdog', 0, { exp: Math.round(avgExp * 100) });
  const nConscript = feats.filter((f) => f.conscript).length;
  if (nConscript) push('conscript', 0, { n: nConscript });
  const nAfk = feats.filter((f) => f.afk).length;
  if (nAfk) push('afkGames', -0.3 * nAfk, { n: nAfk });
  const nShort = feats.filter((f) => f.minutes < 10).length;
  if (nShort >= 3) push('shortGames', 0, { n: nShort });
  if (!roles.known) push('roleUnknown', 0, {});
  if (feats.length < 8) push('fewMatches', 0, { n: feats.length });
  reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  const roleOut = { known: roles.known };
  for (const q of ROLE_KEYS) roleOut[q] = Math.round(roles[q] * 100);
  return {
    stbid: String(stbid),
    value,
    range,
    tier,
    confidence: Math.round((1 - k.P / (k.P0 + ((MODEL && MODEL.kalman && MODEL.kalman.q) || 0) * feats.length)) * 100) / 100,
    matchCount: feats.length,
    roles: roleOut,
    parts,
    summary: { kdMedian: kdMed, contribMedian: contribMed, objMedian: objMed, avgExpected: Math.round(avgExp * 100) / 100, winRate: Math.round(winRate * 100) / 100 },
    reasons,
    rows: rows.map(({ c, x, S, E, eloN, gapN, ...r }) => r)
  };
}

/**
 * 单局复盘：每个人的龙/区/泯（和同分段、同角色比）+ 称号（只看本局实际作用：大腿、背锅侠、掉线狗……）
 * @param {object} mi          /api/match 的 matchInfo（含 UnitData，按本局实际出的单位判断角色）
 * @param {string} fid         对局 ID
 * @param {object} [opts]
 * @param {number} [opts.winnerTeam]  已知胜方（非排位局用；排位局按 ELO 涨跌自行判断）
 * @param {object} [opts.rolesById]   { [玩家ID]: { categoryPreferences, highlightUnits } }（没有单位数据时的后备）
 */
function analyzeMatch(mi, fid, opts = {}) {
  const raw = { matchId: fid, data: mi };
  // 胜方：排位局看 ELO 涨跌（赢必涨），否则用传入的胜方
  let winnerTeam = null;
  const ratedP = Object.values(mi.Data || {}).find((p) => isRated(p) && (teamOf(p) === 0 || teamOf(p) === 1));
  if (ratedP) winnerTeam = ratedP.NewRating > ratedP.OldRating ? teamOf(ratedP) : 1 - teamOf(ratedP);
  else if (opts.winnerTeam === 0 || opts.winnerTeam === 1) winnerTeam = opts.winnerTeam;
  // 称号（含功劳最大 / 背锅 / 掉线）：只看这一局对战局的实际作用，不看 ELO
  const aw = awardTitles(mi, { winnerTeam });
  const inactive = new Set(Object.keys(aw).filter((id) => aw[id].gone));
  const absence = new Map(Object.entries(aw).filter(([, v]) => v.gone).map(([id, v]) => [id, v.absence]));
  const players = [];
  for (const p of Object.values(mi.Data || {})) {
    const tid = teamOf(p);
    if (tid !== 0 && tid !== 1) continue; // 观战
    const f = matchFeatures(raw, p.Id, { allowUnrated: true, winnerTeam, inactive, absence });
    if (!f) continue;
    const career = (opts.rolesById || {})[String(p.Id)];
    const roles = rolesFromUnits(p) || (career && rolesFromCareer(career.categoryPreferences, career.highlightUnits)) || defaultRoles();
    // 龙/区/泯：和同角色构成、同分段的玩家比（这里才考虑 ELO）
    const s = scoreMatch(f, roles, 'match');
    const a = aw[String(p.Id)] || { titles: [] };
    players.push({
      id: String(p.Id), name: p.Name || '', teamId: tid, score: to10(s.pct), mark: markOf(s.pct),
      titles: a.titles, mvp: !!a.mvp, blame: !!a.blame, afk: !!a.gone, impact: a.impact,
      outnumbered: f.outnumbered, conscript: f.conscript, won: f.won, rated: f.rated,
      roleKnown: roles.known, roles: Object.fromEntries(ROLE_KEYS.map((q) => [q, Math.round((roles[q] || 0) * 100)])),
      parts: s.parts, kd: f.kd, contrib: f.contrib, obj: f.obj
    });
  }
  return { fid: String(fid), winnerTeam, rated: players.some((p) => p.rated), players };
}

module.exports = {
  computeDragonScore, analyzeMatch, matchFeatures, detectInactive, scoreMatch, zScores, pctOf, phi, objFactor, kalman,
  rolesFromUnits, rolesFromCareer, defaultRoles, roleKeyOf, buildUnitMap, teamOf, isRated, hasRating, markOf, tierOf,
  ROLE_KEYS, FRONT, CAT_KEYS, DEFAULT_SPLIT, AFK, get MODEL() { return MODEL; }
};
