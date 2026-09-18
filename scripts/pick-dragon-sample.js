// 从已缓存的对局里按 ELO 分层挑建模样本（不发请求）
// 输出 backtest-data/sample-players.txt（玩家分析 + 2 页最近对局）和 sample-matches.txt（单局原始数据）
// 用法：node scripts/pick-dragon-sample.js [每档玩家数=30] [每档对局数=45]
// 加采：把数字调大再跑一次，已经下载过的玩家/对局会先算进去，只补差额
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'backtest-data');
const perBandP = Number(process.argv[2]) || 30;
const perBandM = Number(process.argv[3]) || 45;
const BANDS = [0, 1600, 1900, 2100, 2300, 2500, Infinity];
const band = (e) => BANDS.findIndex((b, i) => e >= b && e < BANDS[i + 1]);
const T = (p) => (p.TeamId == null ? 0 : p.TeamId);

// 固定种子的洗牌，保证可复现
let seed = 20260918;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const matches = new Map();
const pmOwners = new Set();
for (const f of fs.readdirSync(DIR)) {
  const m = /^pm-(\d+)-o0\.json$/.exec(f);
  if (m) pmOwners.add(m[1]);
  if (!f.startsWith('pm-')) continue;
  for (const x of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).matches || []) matches.set(String(x.matchId), x);
}
// 每个玩家：最新一次出现时的 ELO、出现次数
const players = new Map();
const matchList = [];
for (const [id, x] of matches) {
  const d = x.data || {};
  const all = Object.values(d.Data || {});
  const rated = all.filter((p) => typeof p.OldRating === 'number' && typeof p.NewRating === 'number' && Math.abs(p.NewRating - p.OldRating) > 0.01);
  if (rated.length !== 10 || all.filter((p) => T(p) === 0).length !== 5) continue;
  const avg = rated.reduce((a, p) => a + p.OldRating, 0) / 10;
  matchList.push({ id, avg, end: d.EndTime || 0 });
  for (const p of rated) {
    const k = String(p.Id);
    const o = players.get(k) || { n: 0, end: 0, elo: 0 };
    o.n++;
    if ((d.EndTime || 0) >= o.end) { o.end = d.EndTime || 0; o.elo = p.NewRating; }
    players.set(k, o);
  }
}
// 玩家：已有 2 页最近对局的全部入选（只需补玩家分析）；其余每档随机挑，优先出现 ≥2 次的（更可能是常玩的人）
const pick = [...pmOwners];
const byBand = BANDS.slice(0, -1).map(() => []);
for (const [id, o] of players) if (!pmOwners.has(id)) byBand[band(o.elo)].push(id);
const bandInfo = [];
byBand.forEach((ids, b) => {
  const freq = shuffle(ids.filter((id) => players.get(id).n >= 2));
  const rest = shuffle(ids.filter((id) => players.get(id).n < 2));
  const have = pick.filter((id) => players.has(id) && band(players.get(id).elo) === b).length;
  const take = freq.concat(rest).slice(0, Math.max(0, perBandP - have));
  pick.push(...take);
  bandInfo.push(BANDS[b] + '~' + BANDS[b + 1] + ': 池 ' + ids.length + ' 人，已有 ' + have + '，新挑 ' + take.length);
});
// 对局：按全场平均 ELO 分档；已经下载过单局数据的先算上，再随机补足到每档 perBandM 局（加采时不浪费已有数据）
const mPick = [];
const haveM = (id) => fs.existsSync(path.join(DIR, 'm-' + id + '.json'));
BANDS.slice(0, -1).forEach((_, b) => {
  const inBand = matchList.filter((m) => band(m.avg) === b);
  const old = inBand.filter((m) => haveM(m.id));
  const add = shuffle(inBand.filter((m) => !haveM(m.id))).slice(0, Math.max(0, perBandM - old.length));
  mPick.push(...old.concat(add).map((m) => m.id));
});
fs.writeFileSync(path.join(DIR, 'sample-players.txt'), pick.join('\n'));
fs.writeFileSync(path.join(DIR, 'sample-matches.txt'), mPick.join('\n'));
console.log(bandInfo.join('\n'));
console.log('对局各档：' + BANDS.slice(0, -1).map((_, b) => matchList.filter((m) => band(m.avg) === b).length).join(' / ') + '（可选），入选 ' + mPick.length);
const need = (f, pre) => fs.existsSync(path.join(DIR, pre(f))) ? 0 : 1;
const pReq = pick.reduce((a, id) => a + need(id, (x) => 'ap-' + x + '.json') + need(id, (x) => 'pm-' + x + '-o0.json') + need(id, (x) => 'pm-' + x + '-o20.json'), 0);
const mReq = mPick.reduce((a, id) => a + need(id, (x) => 'm-' + x + '.json'), 0);
console.log('玩家 ' + pick.length + ' 人，需请求 ' + pReq + ' 次；对局 ' + mPick.length + ' 局，需请求 ' + mReq + ' 次；合计 ' + (pReq + mReq));
