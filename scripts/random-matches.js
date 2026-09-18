// 随机抽对局：在对局 ID 区间里均匀随机取号（对局 ID 是全服连续编号），不依赖任何玩家圈子
// 用法：node scripts/random-matches.js <起始ID> <结束ID> <抽多少个号> [种子]
// 输出 backtest-data/random-ids-<种子>.txt；之后用 collect-dragon-data.js matches 采集
const fs = require('fs');
const path = require('path');
const [lo, hi, n, seedArg] = process.argv.slice(2).map(Number);
if (!(lo < hi) || !n) { console.error('用法：node scripts/random-matches.js <起始ID> <结束ID> <数量> [种子]'); process.exit(1); }
let seed = seedArg || 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const DIR = path.join(__dirname, '..', 'backtest-data');
const ids = new Set();
while (ids.size < n) ids.add(lo + Math.floor(rnd() * (hi - lo + 1)));
const file = path.join(DIR, 'random-ids-' + (seedArg || 1) + '.txt');
fs.writeFileSync(file, [...ids].join('\n'));
console.log('写入 ' + file + '：' + ids.size + ' 个对局号（' + lo + ' ~ ' + hi + '）');
