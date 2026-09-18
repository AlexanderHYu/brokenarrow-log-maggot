// 从随机对局里抽随机玩家（不发请求）：先随机抽对局号（scripts/random-matches.js），
// 再在这些对局的「玩家出场」里随机抽人 —— 常玩的人被抽中的机会更大，正好对应「你在对局里会遇到的人」。
// 只用截止日期之后的 5v5 排位局。
// 用法：node scripts/pick-random-players.js <人数> [截止日期=2026-09-02]
// 输出 backtest-data/sample-random-players.txt；之后用 collect-dragon-data.js players / pages 采集
const fs = require('fs');
const path = require('path');
const DS = require('../src/dragonScore');
const DIR = path.join(__dirname, '..', 'backtest-data');
const N = Number(process.argv[2]) || 250;
const cutoff = Date.parse((process.argv[3] || '2026-09-02') + 'T00:00:00+08:00') / 1000;

let seed = 20260919;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// 随机对局号清单里、已下载、截止日期之后、5v5 排位的局
const ids = new Set();
for (const f of fs.readdirSync(DIR).filter((f) => /^random-ids-\d+\.txt$/.test(f))) {
  for (const id of fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/).filter(Boolean)) ids.add(id);
}
const appearances = [];
let usable = 0;
for (const id of ids) {
  const f = path.join(DIR, 'm-' + id + '.json');
  if (!fs.existsSync(f)) continue;
  const mi = (JSON.parse(fs.readFileSync(f, 'utf8')) || {}).matchInfo;
  if (!mi || !mi.Data || (mi.EndTime || 0) < cutoff) continue;
  const all = Object.values(mi.Data).filter((p) => DS.teamOf(p) === 0 || DS.teamOf(p) === 1);
  if (all.length !== 10 || all.filter((p) => DS.teamOf(p) === 0).length !== 5 || !all.every(DS.isRated)) continue;
  usable++;
  for (const p of all) appearances.push(String(p.Id));
}
// 随机打乱出场记录，按出现顺序去重
for (let i = appearances.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [appearances[i], appearances[j]] = [appearances[j], appearances[i]]; }
const pick = [];
for (const id of appearances) { if (!pick.includes(id)) pick.push(id); if (pick.length >= N) break; }
fs.writeFileSync(path.join(DIR, 'sample-random-players.txt'), pick.join('\n'));
const has = (f) => fs.existsSync(path.join(DIR, f));
const req = pick.reduce((a, id) => a + !has('ap-' + id + '.json') + !has('pm-' + id + '-o0.json') + !has('pm-' + id + '-o20.json'), 0);
console.log('随机排位对局 ' + usable + ' 局（' + appearances.length + ' 次出场）→ 抽 ' + pick.length + ' 人，需请求 ' + req + ' 次');
