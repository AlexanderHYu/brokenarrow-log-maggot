// 阵营（俄 / 美）对胜负的影响（不发请求）
// 只用随机抽的对局号（random-ids-*.txt）里、截止日期之后的 5v5 排位；两边同阵营的局不算。
// 两种口径：
//   1. 原始胜率：按「玩家个人赛前 ELO」分段，看俄方玩家和美方玩家各自的胜率（和 BA Arsenal 这类站点的口径一致）
//   2. 扣除分差：在 Elo 预期胜率里加一个「俄方按多几分算」的修正 f，找最合适的 f（全局 + 按全场平均分分段）
// 置信区间按对局重抽（同一局 10 个人的胜负是绑在一起的，不能当 10 个独立样本）。
// 用法：node scripts/analyze-faction.js [截止日期=2026-09-02] [样本=random|all]
const fs = require('fs');
const path = require('path');
const DS = require('../src/dragonScore');
const MT = require('../src/matchTitles');
const DIR = path.join(__dirname, '..', 'backtest-data');
const cutoff = Date.parse((process.argv[2] || '2026-09-02') + 'T00:00:00+08:00') / 1000;
const useAll = process.argv[3] === 'all';
const model = DS.MODEL || {};
const scale = (model.expect && model.expect.scale) || 400;
const afkPenalty = (model.expect && model.expect.afkPenalty) || 500;

const units = JSON.parse(fs.readFileSync(path.join(DIR, 'units.json'), 'utf8')).units;
const country = Object.fromEntries(units.map((u) => [u.id, u.country_id])); // 1 俄 2 美
const randomIds = new Set(fs.readdirSync(DIR).filter((f) => /^random-ids-\d+\.txt$/.test(f)).flatMap((f) => fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/).filter(Boolean)));
const files = fs.readdirSync(DIR).filter((f) => /^m-\d+\.json$/.test(f)).filter((f) => useAll || randomIds.has(f.slice(2, -5)));

const matches = [];
let mirror = 0, other = 0;
for (const f of files) {
  const mi = (JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) || {}).matchInfo;
  if (!mi || !mi.Data || (mi.EndTime || 0) < cutoff) continue;
  const all = Object.values(mi.Data).filter((p) => DS.teamOf(p) === 0 || DS.teamOf(p) === 1);
  if (all.length !== 10 || all.filter((p) => DS.teamOf(p) === 0).length !== 5 || !all.every(DS.isRated)) { other++; continue; }
  const cnt = [{ 1: 0, 2: 0 }, { 1: 0, 2: 0 }];
  for (const p of all) for (const u of Object.values(p.UnitData || {})) { const c = country[u.Id]; if (c === 1 || c === 2) cnt[DS.teamOf(p)][c]++; }
  const fac = cnt.map((c) => (c[1] + c[2] === 0 ? null : c[1] > c[2] ? 'RU' : 'US'));
  if (!fac[0] || !fac[1]) { other++; continue; }
  if (fac[0] === fac[1]) { mirror++; continue; }
  const ru = fac[0] === 'RU' ? 0 : 1;
  const r0 = all[0];
  const winner = r0.NewRating > r0.OldRating ? DS.teamOf(r0) : 1 - DS.teamOf(r0);
  const ms = MT.titleMetrics(mi);
  const gone = new Map(ms.filter(MT.isGone).map((m) => [m.id, MT.absenceOf(m)]));
  const side = (t) => {
    const team = all.filter((p) => DS.teamOf(p) === t);
    const on = team.filter((p) => !gone.has(String(p.Id)));
    const avg = (on.length ? on : team).reduce((s, p) => s + p.OldRating, 0) / (on.length || team.length);
    const miss = team.reduce((s, p) => s + (gone.get(String(p.Id)) || 0), 0);
    return avg - afkPenalty * miss;
  };
  matches.push({
    ruWin: winner === ru ? 1 : 0,
    d: side(ru) - side(1 - ru), // 俄方 − 美方（已扣缺人）
    lobby: all.reduce((s, p) => s + p.OldRating, 0) / 10,
    players: all.map((p) => ({ elo: p.OldRating, ru: DS.teamOf(p) === ru, won: DS.teamOf(p) === winner }))
  });
}
if (!matches.length) { console.log('没有可用的对局'); process.exit(0); }

let seed = 99;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const resample = (a) => a.map(() => a[Math.floor(rnd() * a.length)]);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const pctStr = (x) => (x * 100).toFixed(0) + '%';
const E = (d) => 1 / (1 + Math.pow(10, -d / scale));
// 最合适的阵营修正 f（Elo 分）：让「俄方按多 f 分算」的预期胜率最贴合实际（对数似然最大）
function bestF(ms) {
  let best = 0, bestLL = -Infinity;
  for (let f = -300; f <= 300; f += 5) {
    let ll = 0;
    for (const m of ms) { const p = Math.min(1 - 1e-9, Math.max(1e-9, E(m.d + f))); ll += m.ruWin ? Math.log(p) : Math.log(1 - p); }
    if (ll > bestLL) { bestLL = ll; best = f; }
  }
  return best;
}
function fWithCI(ms) {
  const f = bestF(ms);
  const bs = []; for (let b = 0; b < 300; b++) bs.push(bestF(resample(ms)));
  return { f, lo: q(bs, 0.025), hi: q(bs, 0.975), n: ms.length };
}

console.log('俄 vs 美 ' + matches.length + ' 局（同阵营对打 ' + mirror + ' 局、其他 ' + other + ' 局不算）；截止日期之后、' + (useAll ? '全部已下载' : '随机抽号') + '的对局');

// 口径 1：按玩家个人 ELO 分段的原始胜率
const PBANDS = [0, 1600, 1800, 2000, 2200, 2400, Infinity];
const pb = (e) => PBANDS.findIndex((b, i) => e >= b && e < PBANDS[i + 1]);
console.log('\n① 原始胜率，按玩家个人赛前 ELO 分段（俄方玩家 vs 美方玩家；区间按对局重抽）');
for (let b = 0; b < PBANDS.length - 1; b++) {
  const stat = (ms) => {
    let rw = 0, rn = 0, uw = 0, un = 0;
    for (const m of ms) for (const p of m.players) if (pb(p.elo) === b) { if (p.ru) { rn++; rw += p.won; } else { un++; uw += p.won; } }
    return { ru: rn ? rw / rn : NaN, us: un ? uw / un : NaN, rn, un };
  };
  const s = stat(matches);
  if (s.rn + s.un < 20) continue;
  const diffs = []; for (let i = 0; i < 300; i++) { const t = stat(resample(matches)); if (t.rn && t.un) diffs.push(t.ru - t.us); }
  const name = (PBANDS[b] === 0 ? '<' + PBANDS[b + 1] : PBANDS[b] + (PBANDS[b + 1] === Infinity ? '+' : '~' + PBANDS[b + 1])).padEnd(10);
  console.log('  ' + name + ' 俄 ' + pctStr(s.ru) + '（' + s.rn + ' 人次）  美 ' + pctStr(s.us) + '（' + s.un + ' 人次）  俄 − 美 = ' + ((s.ru - s.us) * 100).toFixed(0) + ' 个百分点，95% 区间 [' + (q(diffs, 0.025) * 100).toFixed(0) + ', ' + (q(diffs, 0.975) * 100).toFixed(0) + ']');
}

// 口径 2：扣除双方分差后的阵营修正
console.log('\n② 扣除分差后：俄方相当于多几分（Elo 分，负数 = 美方占优；按全场平均分分段）');
const all = fWithCI(matches);
console.log('  全部          ' + String(all.f).padStart(4) + ' 分，95% 区间 [' + all.lo + ', ' + all.hi + ']  n=' + all.n + '  （俄方实际胜率 ' + pctStr(matches.reduce((s, m) => s + m.ruWin, 0) / matches.length) + '，不修正时预期 ' + pctStr(matches.reduce((s, m) => s + E(m.d), 0) / matches.length) + '）');
const LBANDS = [0, 1800, 2000, 2200, Infinity];
for (let b = 0; b < LBANDS.length - 1; b++) {
  const ms = matches.filter((m) => m.lobby >= LBANDS[b] && m.lobby < LBANDS[b + 1]);
  if (ms.length < 20) continue;
  const r = fWithCI(ms);
  const name = (LBANDS[b] === 0 ? '<' + LBANDS[b + 1] : LBANDS[b] + (LBANDS[b + 1] === Infinity ? '+' : '~' + LBANDS[b + 1])).padEnd(12);
  console.log('  ' + name + '  ' + String(r.f).padStart(4) + ' 分，95% 区间 [' + r.lo + ', ' + r.hi + ']  n=' + r.n);
}
console.log('\n（阵营修正的区间不包含 0 才算有证据；每 100 分约等于势均力敌时胜率差 14 个百分点）');
