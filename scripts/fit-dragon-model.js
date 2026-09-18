// 龙区分建模：用 backtest-data/ 里的真实数据估计 src/dragonModel.json 里的全部参数
// 用法：node scripts/fit-dragon-model.js [--write]     不带 --write 只打印诊断
// 不发任何请求；数据由 scripts/collect-dragon-data.js 采集。
const fs = require('fs');
const path = require('path');
const DS = require('../src/dragonScore');
const MT = require('../src/matchTitles');

const DIR = path.join(__dirname, '..', 'backtest-data');
const WRITE = process.argv.includes('--write');
// 对照实验：NOGAP=1 时不按「本人比这局平均高/低多少分」调整预期
const NOGAP = process.env.NOGAP === '1';
const log = (...a) => console.log(...a);
const J = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const files = fs.readdirSync(DIR);

// ---------- 小工具 ----------
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const quantiles = (a, n = 101) => { const s = [...a].sort((x, y) => x - y); return Array.from({ length: n }, (_, i) => s[Math.round((i / (n - 1)) * (s.length - 1))]); };
function pearson(x, y) { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return b && c ? a / Math.sqrt(b * c) : 0; }
// 加权最小二乘 / 岭回归：X 行向量，y，w 权重，lambda 岭系数（不惩罚 noPen 里的列）
function wls(X, y, w, lambda = 0, noPen = []) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    const wi = w ? w[i] : 1;
    for (let p = 0; p < k; p++) { b[p] += wi * X[i][p] * y[i]; for (let q = 0; q < k; q++) A[p][q] += wi * X[i][p] * X[i][q]; }
  }
  for (let p = 0; p < k; p++) if (!noPen.includes(p)) A[p][p] += lambda;
  // 高斯消元
  const M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < k; c++) {
    let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) { M[c][c] = 1e-12; }
    for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let q = c; q <= k; q++) M[r][q] -= f * M[c][q]; }
  }
  return M.map((r, i) => r[k] / r[i]);
}
// 逻辑回归（牛顿法，带小岭项）
function logistic(X, y, lambda = 1e-3) {
  const k = X[0].length; let beta = new Array(k).fill(0);
  for (let it = 0; it < 50; it++) {
    const H = Array.from({ length: k }, () => new Array(k).fill(0)); const g = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((s, x, j) => s + x * beta[j], 0); const p = 1 / (1 + Math.exp(-z));
      for (let a = 0; a < k; a++) { g[a] += (y[i] - p) * X[i][a]; for (let b2 = 0; b2 < k; b2++) H[a][b2] += p * (1 - p) * X[i][a] * X[i][b2]; }
    }
    for (let a = 0; a < k; a++) { g[a] -= lambda * beta[a]; H[a][a] += lambda; }
    const step = wls(H.map((r) => r), g, null, 0); // 解 H·step = g
    // wls 以 X=H、y=g 求最小二乘，等价于 H^T H step = H^T g；H 对称正定时与 H step = g 同解
    beta = beta.map((b2, j) => b2 + step[j]);
    if (step.reduce((s, x) => s + Math.abs(x), 0) < 1e-8) break;
  }
  return beta;
}

// ---------- 数据 ----------
const unitLib = J('units.json').units;
const unitMap = DS.buildUnitMap(unitLib);
const unitCat = Object.fromEntries(unitLib.map((u) => [u.id, u.category_type]));
const pmById = new Map();
for (const f of files) if (/^pm-\d+-o\d+\.json$/.test(f)) for (const x of J(f).matches || []) pmById.set(String(x.matchId), x);
const apById = new Map();
for (const f of files) { const m = /^ap-(\d+)\.json$/.exec(f); if (m) { const a = J(f); apById.set(m[1], a.data || a); } }
const mById = new Map();
for (const f of files) { const m = /^m-(\d+)\.json$/.exec(f); if (m) { const a = J(f); const mi = a.matchInfo || (a.data && a.data.matchInfo) || a; if (mi && mi.Data) mById.set(m[1], mi); } }
log('数据：最近对局 ' + pmById.size + ' 局；玩家分析 ' + apById.size + ' 人；单局原始数据 ' + mById.size + ' 局');

// ---------- 0. 花费类别 → 角色的拆分比例、全体平均角色构成（单局单位数据） ----------
const catSplit = {};
const roleTot = Object.fromEntries(DS.ROLE_KEYS.map((k) => [k, 0]));
{
  const acc = {};
  for (const mi of mById.values()) for (const p of Object.values(mi.Data || {})) for (const u of Object.values(p.UnitData || {})) {
    const e = unitMap[u.Id]; if (!e) continue;
    const cat = DS.CAT_KEYS[unitCat[u.Id]]; if (!cat) continue;
    acc[cat] = acc[cat] || {};
    const k = e[0] || '_none';
    acc[cat][k] = (acc[cat][k] || 0) + (e[1] || 1);
    if (e[0]) roleTot[e[0]] += e[1] || 1;
  }
  for (const cat of DS.CAT_KEYS) {
    const a = acc[cat] || {}; const tot = Object.values(a).reduce((s, v) => s + v, 0);
    catSplit[cat] = {};
    // 拆分比例里保留「运输」这一份（不计入任何角色），所以各角色比例之和可以小于 1
    for (const k of DS.ROLE_KEYS) if (a[k]) catSplit[cat][k] = Math.round((a[k] / tot) * 1000) / 1000;
  }
  const s = Object.values(roleTot).reduce((x, y) => x + y, 0);
  for (const k of DS.ROLE_KEYS) roleTot[k] = s ? Math.round((roleTot[k] / s) * 1000) / 1000 : 0;
  log('  类别拆分（单局单位数据）：' + DS.CAT_KEYS.map((c) => c + ' ' + JSON.stringify(catSplit[c])).join('  '));
  log('  全体平均角色构成：' + JSON.stringify(roleTot));
}

// ---------- 1. 胜负预期：Elo 尺度与缺人惩罚 ----------
const teamRows = [];
for (const x of pmById.values()) {
  const d = x.data || {};
  const all = Object.values(d.Data || {});
  if (!all.every(DS.isRated) || all.length < 6) continue;
  const inact = DS.detectInactive(d);
  const t = (id) => all.filter((p) => DS.teamOf(p) === id);
  const a = t(0), b = t(1);
  if (a.length !== b.length || a.length < 3) continue;
  const act = (l) => l.filter((p) => !inact.has(String(p.Id)));
  const avg = (l) => mean(l.map((p) => p.OldRating));
  teamRows.push({ w: a[0].NewRating > a[0].OldRating ? 1 : 0, d: avg(act(a).length ? act(a) : a) - avg(act(b).length ? act(b) : b), miss: (a.length - act(a).length) - (b.length - act(b).length) });
}
function eloLL(scale, pen) { let s = 0; for (const r of teamRows) { const p = Math.min(1 - 1e-6, Math.max(1e-6, 1 / (1 + Math.pow(10, -(r.d - pen * r.miss) / scale)))); s -= r.w ? Math.log(p) : Math.log(1 - p); } return s / teamRows.length; }
let bestElo = null;
for (let scale = 250; scale <= 600; scale += 25) for (let pen = 0; pen <= 1200; pen += 50) { const v = eloLL(scale, pen); if (!bestElo || v < bestElo.v) bestElo = { scale, pen, v }; }
const afkMatches = teamRows.filter((r) => r.miss !== 0);
log('\n[胜负预期] 对局 ' + teamRows.length + '，其中单边缺人 ' + afkMatches.length + '；缺人一方赢了 ' + afkMatches.filter((r) => (r.miss > 0) === (r.w === 1)).length + ' 局');
log('  最优 Elo 尺度 ' + bestElo.scale + '，每缺 1 人按弱 ' + bestElo.pen + ' 分；log loss ' + bestElo.v.toFixed(4) + '（尺度 400 且不罚缺人：' + eloLL(400, 0).toFixed(4) + '）');
const expectCfg = { scale: bestElo.scale, afkPenalty: Math.min(bestElo.pen, 800) };

// ---------- 2. 行数据：单局（本局角色） + 最近对局（生涯角色） ----------
function rowsFromMatch(raw, ids, rolesFor, kind) {
  const d = raw.data || {};
  let inact = DS.detectInactive(d), absence;
  if (kind === 'match') {
    const ms = MT.titleMetrics(d, unitMap);
    inact = new Set(ms.filter(MT.isGone).map((m) => m.id));
    absence = new Map(ms.filter(MT.isGone).map((m) => [m.id, MT.absenceOf(m)]));
  }
  const out = [];
  for (const id of ids) {
    const f = DS.matchFeatures(raw, id, { inactive: inact, absence, expect: expectCfg });
    if (!f || !f.rated || f.afk) continue;
    const roles = rolesFor(id);
    if (!roles) continue;
    out.push({ ...f, roles, kind, pid: String(id), gapN: NOGAP ? 0 : f.gapN });
  }
  return out;
}
const matchRows = [];
for (const [fid, mi] of mById) {
  const raw = { matchId: fid, data: mi };
  const ids = Object.values(mi.Data || {}).map((p) => String(p.Id));
  matchRows.push(...rowsFromMatch(raw, ids, (id) => { const p = Object.values(mi.Data).find((q) => String(q.Id) === id); return DS.rolesFromUnits(p, unitMap); }, 'match'));
}
const careerRoles = new Map();
// 生涯角色用「数据里的类别拆分」做先验
for (const [id, a] of apById) careerRoles.set(id, DS.rolesFromCareer(a.categoryPreferences, a.highlightUnits, unitMap, catSplit));
const careerRows = [];
const seqs = new Map(); // 玩家 → 按时间从旧到新的行（回测与卡尔曼用）
for (const [id] of apById) {
  const own = [];
  for (const off of [0, 20]) {
    const f = 'pm-' + id + '-o' + off + '.json';
    if (!files.includes(f)) continue;
    for (const x of J(f).matches || []) own.push(x);
  }
  const rows = [];
  for (const x of own) rows.push(...rowsFromMatch(x, [id], () => careerRoles.get(id), 'career'));
  rows.sort((p, q) => (p.endTime || 0) - (q.endTime || 0));
  careerRows.push(...rows);
  if (rows.length) seqs.set(id, rows);
}
log('\n[行数据] 本局角色 ' + matchRows.length + ' 行；生涯角色 ' + careerRows.length + ' 行（' + seqs.size + ' 人）');
const roleAvg = (rows) => DS.ROLE_KEYS.map((r) => r + ' ' + (mean(rows.map((x) => x.roles[r])) * 100).toFixed(0) + '%').join('  ');
log('  本局角色平均构成：' + roleAvg(matchRows));
log('  生涯角色平均构成：' + roleAvg(careerRows));

// ---------- 3. 分布：每个指标 ~ 共同均值 + 各角色偏离（岭回归收缩）+ 本人 ELO + 本人与全场的分差 ----------
// 大家都是混编，单一角色很少超过一半，直接回归会把「纯直升机」这种没人这么打的情况外推得很离谱；
// 所以角色只估「相对共同均值的偏离」，并往 0 收缩，收缩强度用 5 折交叉验证选。
// 按玩家分折：生涯角色是每人一个固定值，按对局分折会让同一个人同时出现在训练和验证里，挑出几乎不收缩的过拟合结果。
const FEATS = ['kd', 'con', 'obj'];
const NR = DS.ROLE_KEYS.length;
const designRow = (r) => [1].concat(DS.ROLE_KEYS.map((q) => r.roles[q]), [r.eloN, r.gapN]);
const NOPEN = [0, NR + 1, NR + 2];
const foldOf = (r) => { let h = 0; for (const ch of String(r.pid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 5; };
function ridgeCV(rows, yOf, Xof, noPen, lambdas) {
  const X = rows.map(Xof), y = rows.map(yOf), folds = rows.map(foldOf);
  let best = null;
  for (const lam of lambdas) {
    let se = 0;
    for (let f = 0; f < 5; f++) {
      const tr = rows.map((_, i) => i).filter((i) => folds[i] !== f);
      const b = wls(tr.map((i) => X[i]), tr.map((i) => y[i]), null, lam, noPen);
      rows.forEach((_, i) => { if (folds[i] === f) se += (y[i] - X[i].reduce((s, v, j) => s + v * b[j], 0)) ** 2; });
    }
    if (!best || se < best.se) best = { lam, se };
  }
  return { beta: wls(X, y, null, best.lam, noPen), lam: best.lam, X, y };
}
const LAMBDAS = [0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000];
function fitNorm(rows, label, feats = FEATS, quiet = false) {
  const norm = {};
  for (const k of feats) {
    const m = ridgeCV(rows, (r) => r.x[k], designRow, NOPEN, LAMBDAS);
    const res = m.y.map((v, i) => v - m.X[i].reduce((s, x, j) => s + x * m.beta[j], 0));
    const pooled = mean(res.map((e) => e * e));
    // 离散度：残差平方 ~ 共同值 + 各角色偏离（同样收缩）
    const vfit = ridgeCV(rows.map((r, i) => ({ ...r, _e2: res[i] * res[i] })), (r) => r._e2, (r) => [1].concat(DS.ROLE_KEYS.map((q) => r.roles[q])), [0], LAMBDAS);
    const mu = {}, sigma = {};
    DS.ROLE_KEYS.forEach((q, j) => {
      mu[q] = m.beta[0] + m.beta[1 + j];
      sigma[q] = Math.sqrt(Math.max(0.3 * pooled, vfit.beta[0] + vfit.beta[1 + j]));
    });
    norm[k] = { mu, elo: m.beta[NR + 1], gap: m.beta[NR + 2], sigma, lambda: m.lam };
  }
  const zs = {}; for (const k of feats) zs[k] = [];
  for (const r of rows) { const z = zOf(r, r.roles, norm, feats); for (const k of feats) zs[k].push(z[k]); }
  for (const k of feats) norm[k].q = quantiles(zs[k], 101).map((v) => Math.round(v * 1000) / 1000);
  if (!quiet) {
    log('\n[分布 · ' + label + '] ' + rows.length + ' 行');
    for (const k of feats) {
      const n = norm[k];
      log('  ' + k.padEnd(4) + ' 均值(log2) ' + DS.ROLE_KEYS.map((q) => q + ' ' + n.mu[q].toFixed(2)).join(' ') + ' | ELO ' + n.elo.toFixed(2) + ' 分差 ' + n.gap.toFixed(2) + ' | 收缩 λ=' + n.lambda);
      log('       离散度      ' + DS.ROLE_KEYS.map((q) => q + ' ' + n.sigma[q].toFixed(2)).join(' '));
    }
  }
  return norm;
}
// 任意指标集合的标准分（zScores 固定三项，这里通用一点）
function zOf(f, roles, norm, feats) {
  const z = {};
  for (const k of feats) {
    const n = norm[k]; let mu = n.elo * f.eloN + n.gap * f.gapN, v = 0;
    for (const q of DS.ROLE_KEYS) { mu += (roles[q] || 0) * n.mu[q]; v += (roles[q] || 0) * n.sigma[q] ** 2; }
    z[k] = (f.x[k] - mu) / Math.sqrt(v || 1);
  }
  return z;
}
const normMatch = fitNorm(matchRows, '本局角色');
const normCareer = fitNorm(careerRows, '生涯角色');
// 直观对照：以某角色为主（60%，其余 40% 按全体平均构成）时，K/D 0.5 / 1 / 2 分别是多少百分位
{
  const avg = roleTot;
  const tbl = (norm) => DS.ROLE_KEYS.map((q) => {
    const roles = Object.fromEntries(DS.ROLE_KEYS.map((r) => [r, 0.4 * (avg[r] || 0) + (r === q ? 0.6 : 0)]));
    return q + ' ' + [0.5, 1, 2].map((kd) => Math.round(DS.pctOf(zOf({ x: { kd: Math.log2(kd) }, eloN: 0, gapN: 0 }, roles, norm, ['kd']).kd, norm.kd.q) * 100)).join('/');
  }).join('  ');
  log('\n  以某角色为主（60%）时，分值 K/D 0.5/1/2 的百分位：');
  log('    本局角色：' + tbl(normMatch));
  log('    生涯角色：' + tbl(normCareer));
}

// ---------- 4. 分项权重：哪些指标和赢球关系最大 ----------
// 队伍层面：两队「角色调整后的 K/D、每分钟摧毁、占点」均值之差 → 胜负
// （贡献是队内相对值，两队都平均为 1，队伍层面没有信息，所以用每分钟摧毁代表它）
function attrWeights(rowsAll, norm, label) {
  const dmNorm = fitNorm(rowsAll.map((r) => ({ ...r, x: { dpm: r.x.dpm } })), '', ['dpm'], true);
  const byMatch = new Map();
  for (const r of rowsAll) { if (!byMatch.has(r.fid)) byMatch.set(r.fid, []); byMatch.get(r.fid).push(r); }
  const X = [], y = [];
  for (const [, rs] of byMatch) {
    const a = rs.filter((r) => r.team === 0), b = rs.filter((r) => r.team === 1);
    if (a.length < 3 || b.length < 3) continue;
    const agg = (l) => {
      const z = l.map((r) => DS.zScores(r, r.roles, norm));
      const zd = l.map((r) => zOf({ ...r, x: { dpm: r.x.dpm } }, r.roles, dmNorm, ['dpm']).dpm);
      return [mean(z.map((q) => q.kd)), mean(zd), mean(z.map((q) => q.obj))];
    };
    const A = agg(a), B = agg(b);
    X.push(A.map((v, i) => v - B[i]).concat([(a[0].teamElo - a[0].oppElo) / 400]));
    y.push(a[0].won ? 1 : 0);
  }
  const beta = logistic(X, y, 0.5);
  log('\n[分项权重 · ' + label + '] ' + X.length + ' 局；两队差值对胜负的逻辑回归系数：K/D ' + beta[0].toFixed(2) + '，每分钟摧毁 ' + beta[1].toFixed(2) + '，占点 ' + beta[2].toFixed(2) + '，ELO ' + beta[3].toFixed(2));
  return { kd: Math.max(beta[0], 0), con: Math.max(beta[1], 0), obj: Math.max(beta[2], 0), n: X.length };
}
const wAttr = attrWeights(matchRows, normMatch, '本局角色');
const wsum = wAttr.kd + wAttr.con + wAttr.obj;
let statW = { kd: wAttr.kd / wsum, con: wAttr.con / wsum, obj: wAttr.obj / wsum };
log('  归一化后的分项权重：K/D ' + statW.kd.toFixed(2) + '  贡献 ' + statW.con.toFixed(2) + '  占点 ' + statW.obj.toFixed(2));

// ---------- 5. 汇总：卡尔曼滤波参数 + 胜负项权重（按预测未来的能力选） ----------
// 单场综合分 c = Σ 权重 × z + wOut × 胜负残差/σ；玩家水平每场漂移 q，观测噪声 r（短局放大）
function seqScores(rows, wOut, outSd, sw = statW) {
  return rows.map((r) => {
    const z = DS.zScores(r, r.roles, normCareer);
    const objF = DS.objFactor(r.roles);
    const stat = (sw.kd * z.kd + sw.con * z.con + sw.obj * objF * z.obj) / (sw.kd + sw.con + sw.obj * objF);
    return { c: stat + wOut * (r.S - r.E) / outSd, minutes: r.minutes, resid: r.S - r.E, r };
  });
}
const outSd = sd(careerRows.map((r) => r.S - r.E));
function kalmanNLL(seqsArr, P0, q, rN, shortMin) {
  let nll = 0, n = 0;
  for (const s of seqsArr) {
    let m = 0, P = P0;
    for (const o of s) {
      P += q;
      const R = rN / Math.min(1, Math.max(0.3, o.minutes / shortMin));
      const S = P + R; const e = o.c - m;
      nll += 0.5 * (Math.log(2 * Math.PI * S) + (e * e) / S); n++;
      const K = P / S; m += K * e; P *= (1 - K);
    }
  }
  return nll / n;
}
// 一步预测似然最大化：P0 = 玩家之间真实水平的方差，q = 每场漂移，r = 单场噪声
function fitKalman(seqsArr) {
  let best = null;
  const allC = seqsArr.flat().map((o) => o.c); const v = sd(allC) ** 2;
  for (const P0f of [0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.2, 0.3]) for (const qf of [0, 0.0001, 0.0003, 0.001, 0.003]) for (const shortMin of [6, 9, 12, 16]) {
    const P0 = P0f * v, q = qf * v, rN = v * (1 - P0f);
    const nll = kalmanNLL(seqsArr, P0, q, rN, shortMin);
    if (!best || nll < best.nll) best = { P0, q, r: rN, shortMin, nll, P0f, qf };
  }
  return best;
}
function kalmanRun(s, k) {
  let m = 0, P = k.P0;
  for (const o of s) { P += k.q; const R = k.r / Math.min(1, Math.max(0.3, o.minutes / k.shortMin)); const K = P / (P + R); m += K * (o.c - m); P *= (1 - K); }
  return { m, P };
}
// 回测：每人较早的 20 场算分，之后的（至少 10 场）作检验：
//   rRes = 预测「之后实际胜负 − ELO 预期」的相关系数（真正想要的：这人在队里是不是让队伍多赢）
//   rC   = 预测之后单场综合分的相关系数（稳定性）
const BT_PAST = 20, BT_MIN_FUT = 10;
const btPlayers = [...seqs.values()].filter((rows) => rows.length >= BT_PAST + BT_MIN_FUT);
function backtest(wOut, k, sw = statW) {
  const xs = [], yRes = [], yC = [];
  for (const rows of btPlayers) {
    const sc = seqScores(rows, wOut, outSd, sw);
    const past = sc.slice(0, BT_PAST), fut = sc.slice(BT_PAST);
    xs.push(kalmanRun(past, k).m);
    yRes.push(mean(fut.map((o) => o.resid)));
    yC.push(mean(fut.map((o) => o.c)));
  }
  return { n: xs.length, rRes: pearson(xs, yRes), rC: pearson(xs, yC), xs, yRes };
}
log('\n[汇总] 胜负残差标准差 ' + outSd.toFixed(3) + '；回测 ' + btPlayers.length + ' 人（较早 20 场算分，之后 ' + Math.min(...btPlayers.map((r) => r.length - BT_PAST)) + '~' + Math.max(...btPlayers.map((r) => r.length - BT_PAST)) + ' 场检验，大致显著需 |r| ≥ ' + (1.96 / Math.sqrt(btPlayers.length - 1)).toFixed(2) + '）');
// 分项权重：占点不计入（和地图、选位强相关，不代表玩家水平 —— 设计决定）。
// 回测里 K/D + 摧毁贡献等权（r 0.345）和三项等权（0.355）几乎一样；按「两队差值对胜负」回归的权重（几乎全给 K/D）明显更差，列出来对照
const SCHEMES = {
  C: { kd: 0.5, con: 0.5, obj: 0 },
  A: { kd: statW.kd / (statW.kd + statW.con || 1), con: statW.con / (statW.kd + statW.con || 1), obj: 0 }
};
const aggRuns = [];
for (const [scheme, sw] of Object.entries(SCHEMES)) {
  const runs = [];
  for (const wOut of [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3]) {
    const sArr = [...seqs.values()].map((rows) => seqScores(rows, wOut, outSd, sw));
    const k = fitKalman(sArr);
    const bt = backtest(wOut, k, sw);
    runs.push({ scheme, sw, wOut, k, bt });
    log('  方案 ' + scheme + ' 胜负项 ' + wOut.toFixed(2).padStart(4) + '：卡尔曼 P0=' + String(k.P0f).padEnd(5) + '·v q=' + String(k.qf).padEnd(6) + '·v 短局=' + String(k.shortMin).padStart(2) + '分钟 | 预测未来胜负残差 r=' + bt.rRes.toFixed(3) + '，预测未来单场分 r=' + bt.rC.toFixed(3));
  }
  // 相邻三档平滑，避免被单点噪声带偏
  runs.forEach((a, i) => { a.smooth = mean(runs.slice(Math.max(0, i - 1), i + 2).map((b) => b.bt.rRes)); });
  aggRuns.push(...runs);
}
const bestAgg = aggRuns.filter((a) => a.scheme === 'C').reduce((a, b) => (b.smooth > a.smooth ? b : a)); // 固定用等权，只挑胜负项权重
statW = bestAgg.sw;
log('  选用方案 ' + bestAgg.scheme + '（K/D ' + statW.kd.toFixed(2) + ' 贡献 ' + statW.con.toFixed(2) + ' 占点 ' + statW.obj.toFixed(2) + '），胜负项权重 ' + bestAgg.wOut + '（按预测未来胜负残差，相邻档平滑后）');
// 对照：只看过去的胜负残差、只看过去胜率
{
  const pastRes = btPlayers.map((rows) => mean(rows.slice(0, BT_PAST).map((r) => r.S - r.E)));
  const pastWin = btPlayers.map((rows) => mean(rows.slice(0, BT_PAST).map((r) => r.S)));
  const futRes = btPlayers.map((rows) => mean(rows.slice(BT_PAST).map((r) => r.S - r.E)));
  log('  对照：过去胜负残差 r=' + pearson(pastRes, futRes).toFixed(3) + '，过去胜率 r=' + pearson(pastWin, futRes).toFixed(3));
}

// ---------- 6. 百分位表：单场综合分、玩家龙区分 ----------
const W = { ...statW, out: bestAgg.wOut };
function compositeOf(r, norm) {
  const z = DS.zScores(r, r.roles, norm);
  const of = DS.objFactor(r.roles);
  const stat = (W.kd * z.kd + W.con * z.con + W.obj * of * z.obj) / (W.kd + W.con + W.obj * of);
  return stat + W.out * (r.S - r.E) / outSd;
}
const matchPct = {
  match: quantiles(matchRows.map((r) => compositeOf(r, normMatch))).map((v) => Math.round(v * 1000) / 1000),
  career: quantiles(careerRows.map((r) => compositeOf(r, normCareer))).map((v) => Math.round(v * 1000) / 1000)
};
// 玩家龙区分的分布：每人取最近 20 场跑卡尔曼；样本按 ELO 分层等量抽取，这里按对局池里各档人数加权还原
const BANDS = [0, 1600, 1900, 2100, 2300, 2500, Infinity];
const bandOf = (e) => BANDS.findIndex((b, i) => e >= b && e < BANDS[i + 1]);
const poolCount = new Array(6).fill(0);
{ const last = new Map(); for (const x of pmById.values()) for (const p of Object.values((x.data || {}).Data || {})) if (DS.isRated(p)) { const t = (x.data.EndTime || 0); const o = last.get(String(p.Id)); if (!o || t > o.t) last.set(String(p.Id), { t, e: p.NewRating }); } for (const o of last.values()) poolCount[bandOf(o.e)]++; }
const players = [];
for (const [id, rows] of seqs) {
  const last20 = rows.slice(-20);
  if (last20.length < 5) continue;
  const k = bestAgg.k;
  let m = 0, P = k.P0;
  for (const r of last20) { P += k.q; const R = k.r / Math.min(1, Math.max(0.3, r.minutes / k.shortMin)); const K = P / (P + R); m += K * (compositeOf(r, normCareer) - m); P *= (1 - K); }
  const elo = last20[last20.length - 1].eloBefore;
  players.push({ id, m, band: bandOf(elo) });
}
const sampleCount = new Array(6).fill(0); for (const p of players) sampleCount[p.band]++;
function wquantiles(items, n = 101) {
  const s = [...items].sort((a, b) => a.v - b.v); const tot = s.reduce((a, x) => a + x.w, 0);
  const out = []; let acc = 0, i = 0;
  for (let j = 0; j < n; j++) { const target = (j / (n - 1)) * tot; while (i < s.length - 1 && acc + s[i].w < target) { acc += s[i].w; i++; } out.push(s[i].v); }
  return out;
}
const playerPct = wquantiles(players.map((p) => ({ v: p.m, w: sampleCount[p.band] ? poolCount[p.band] / sampleCount[p.band] : 0 }))).map((v) => Math.round(v * 10000) / 10000);
log('\n[玩家分布] ' + players.length + ' 人（各 ELO 档样本 ' + sampleCount.join('/') + '，对局池 ' + poolCount.join('/') + '）');

// ---------- 7. 称号：占 1 个点值多少分、各「突出表现」称号的阈值 ----------
// 占点值多少分：看「过去 20 场的净贡献（队内相对）」用哪个折算值最能预测之后的「实际胜负 − ELO 预期」。
// 不用「两队占点差 → 这局胜负」回归：赢的一方本来就会占更多点，会把占点的价值高估（第一版得出 2215，就是这个偏差）。
let objValue = 1000;
{
  const players = [];
  for (const [id, rows] of seqs) {
    if (rows.length < BT_PAST + BT_MIN_FUT) continue;
    const ev = rows.map((r) => {
      const x = pmById.get(r.fid); const all = Object.values(((x && x.data) || {}).Data || {});
      const me = all.find((q) => String(q.Id) === id); if (!me) return null;
      const team = all.filter((q) => DS.teamOf(q) === DS.teamOf(me) && ((Number(q.DestructionScore) || 0) + (Number(q.LossesScore) || 0)) > 0);
      const net = (q) => (Number(q.DestructionScore) || 0) - (Number(q.LossesScore) || 0);
      return { net: net(me) - mean(team.map(net)), obj: (Number(me.ObjectivesCaptured) || 0) - mean(team.map((q) => Number(q.ObjectivesCaptured) || 0)), res: r.S - r.E };
    });
    if (ev.some((e) => !e)) continue;
    players.push(ev);
  }
  const fut = players.map((ev) => mean(ev.slice(BT_PAST).map((e) => e.res)));
  const grid = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2500, 3000];
  const rs = grid.map((v) => pearson(players.map((ev) => mean(ev.slice(0, BT_PAST).map((e) => e.net + v * e.obj))), fut));
  const sm = rs.map((_, i) => mean(rs.slice(Math.max(0, i - 1), i + 2))); // 相邻档平滑
  // 只作诊断：设计上占点不计入功劳（和地图、选位强相关）
  objValue = 0;
  log('\n[称号] 占 1 个点折算多少分（按预测未来胜负残差，' + players.length + ' 人）：' + grid.map((v, i) => v + '→' + rs[i].toFixed(3)).join(' ') + '；按设计不计入（0）');
}
const cal = MT.calibrateTitles([...mById.values()], unitMap);
const titleTh = cal.th;
titleTh.objValue = objValue;
log('  突出表现阈值：' + JSON.stringify(titleTh));
// 固定称号（大腿/背锅侠/带不动/躺赢狗/孤勇者）在多少比例的对局里出现：按原始条件统计
const titleFreq = {};
{
  const c = { carry: 0, blame: 0, tryhard: 0, passenger: 0, lonewolf: 0 };
  for (const [, mi] of mById) {
    const r0 = Object.values(mi.Data || {}).find(DS.isRated);
    const W = r0 ? (r0.NewRating > r0.OldRating ? DS.teamOf(r0) : 1 - DS.teamOf(r0)) : null;
    const aw = MT.awardTitles(mi, { winnerTeam: W, unitMap, thresholds: titleTh });
    for (const v of Object.values(aw)) for (const t of v.candidates) if (t in c) c[t]++;
  }
  for (const k of Object.keys(c)) titleFreq[k] = Math.round((c[k] / mById.size) * 1000) / 1000;
  log('  固定称号出现频率（每局）：' + JSON.stringify(titleFreq));
}
{
  const cnt = {}; let n = 0, tot = 0;
  for (const [, mi] of mById) {
    const r0 = Object.values(mi.Data || {}).find(DS.isRated);
    const W = r0 ? (r0.NewRating > r0.OldRating ? DS.teamOf(r0) : 1 - DS.teamOf(r0)) : null;
    const aw = MT.awardTitles(mi, { winnerTeam: W, unitMap, thresholds: titleTh }); n++;
    for (const v of Object.values(aw)) for (const t of v.titles) { cnt[t.id] = (cnt[t.id] || 0) + 1; tot++; }
  }
  log('  每局平均 ' + (tot / n).toFixed(1) + ' 个称号（每人一个）；显示比例：' + Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + Math.round((v / n) * 100) + '%').join(' '));
}

const model = {
  version: 2,
  fittedAt: new Date().toISOString().slice(0, 10),
  sample: { pmMatches: pmById.size, players: apById.size, rawMatches: mById.size, matchRows: matchRows.length, careerRows: careerRows.length, backtestPlayers: bestAgg.bt.n },
  expect: expectCfg,
  units: unitMap,
  catSplit,
  avgRoles: roleTot,
  norm: { match: normMatch, career: normCareer },
  weights: { kd: +W.kd.toFixed(3), con: +W.con.toFixed(3), obj: +W.obj.toFixed(3), out: W.out },
  outSd: +outSd.toFixed(4),
  kalman: { P0: +bestAgg.k.P0.toFixed(5), q: +bestAgg.k.q.toFixed(6), r: +bestAgg.k.r.toFixed(5), shortMin: bestAgg.k.shortMin },
  matchPct,
  playerPct,
  marks: { dragon: 0.8, qu: 0.2 },
  tiers: [[0.9, 'dragon'], [0.7, 'solid'], [0.3, 'average'], [0.1, 'weak'], [0, 'qu']],
  titles: titleTh,
  titleDist: cal.dist,
  titleFreq,
  backtest: { n: bestAgg.bt.n, rRes: bestAgg.bt.rRes, rC: bestAgg.bt.rC, scheme: bestAgg.scheme }
};
// 数字统一保留 4 位，模型文件小一些
const round = (o) => (typeof o === 'number' ? Math.round(o * 10000) / 10000 : Array.isArray(o) ? o.map(round) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)])) : o);
if (WRITE) {
  const out = path.join(__dirname, '..', 'src', 'dragonModel.json');
  fs.writeFileSync(out, JSON.stringify(round(model)));
  log('\n已写入 ' + out + '（' + Math.round(fs.statSync(out).size / 1024) + ' KB）');
}
module.exports = { model, players, compositeOf, btPlayers, seqScores, kalmanRun, bestAgg, outSd, normCareer, statW, careerRows, matchRows };
