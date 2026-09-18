// 龙区分建模数据采集（BATrace 运营方已同意使用其 API）
// 所有响应缓存在 backtest-data/（不入库），已有的文件不会重复请求。
// 请求间隔 2 秒（GAP_MS 可调）；超时/5xx 停 30 秒重试 1 次，遇到人机验证或连续失败立即停止。
//
// 用法：
//   node scripts/collect-dragon-data.js units                      单位库（1 次）
//   node scripts/collect-dragon-data.js players <ids 文件> [上限]   玩家分析 /api/analysis/player（每人 1 次）
//   node scripts/collect-dragon-data.js matches <ids 文件> [上限]   单局原始数据 /api/match（每局 1 次）
//   node scripts/collect-dragon-data.js pages   <ids 文件> [上限]   最近对局 2 页 /api/players/matches（每人 2 次）
// ids 文件：每行一个 ID。上限 = 本次最多发多少个真实请求（默认 100）。
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'backtest-data');
fs.mkdirSync(DIR, { recursive: true });
const BASE = 'https://app.batrace.top';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sent = 0;
let cap = 100;
let last = 0;

async function cached(file, url) {
  const f = path.join(DIR, file);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  if (sent >= cap) return undefined; // 本次额度用完
  // 超时或服务器错误（5xx）：停 30 秒重试 1 次，再失败就停止整个采集（别给对方服务器添压力）
  for (let attempt = 0; ; attempt++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    sent++;
    let r, err = null;
    try {
      r = await fetch(BASE + url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (r.status >= 500) err = new Error('服务器错误 HTTP ' + r.status + ' ' + url);
      else if (!/json/.test(r.headers.get('content-type') || '')) throw new Error('非 JSON 响应（可能触发了人机验证或限流）HTTP ' + r.status + ' ' + url);
    } catch (e) {
      if (/人机验证/.test(e.message)) throw e;
      err = e;
    }
    if (!err) {
      const j = await r.json();
      fs.writeFileSync(f, JSON.stringify(j));
      return j;
    }
    if (attempt >= 1) throw err;
    console.log('  ' + err.message + '，30 秒后重试一次');
    await sleep(30000);
  }
}
// 请求间隔（毫秒）；/api/analysis/player 在服务器端较重，保守一点
const GAP_MS = Number(process.env.GAP_MS) || 2000;

const readIds = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

(async () => {
  const [cmd, idsFile, max] = process.argv.slice(2);
  cap = Number(max) || 100;
  const t0 = Date.now();
  let done = 0, skipped = 0;
  const each = async (ids, fn) => {
    for (const id of ids) {
      const before = sent;
      const r = await fn(id);
      if (r === undefined) { skipped = ids.length - done; break; }
      done++;
      if (sent !== before && sent % 25 === 0) console.log('  已请求 ' + sent + ' 次');
    }
  };
  if (cmd === 'units') {
    await cached('units.json', '/api/units');
    done = 1;
  } else if (cmd === 'players') {
    await each(readIds(idsFile), (id) => cached('ap-' + id + '.json', '/api/analysis/player?stbid=' + encodeURIComponent(id)));
  } else if (cmd === 'matches') {
    await each(readIds(idsFile), (id) => cached('m-' + id + '.json', '/api/match?matchid=' + encodeURIComponent(id)));
  } else if (cmd === 'pages') {
    await each(readIds(idsFile), async (id) => {
      const a = await cached('pm-' + id + '-o0.json', '/api/players/matches?stbid=' + encodeURIComponent(id) + '&limit=20&offset=0');
      if (a === undefined) return undefined;
      return cached('pm-' + id + '-o20.json', '/api/players/matches?stbid=' + encodeURIComponent(id) + '&limit=20&offset=20');
    });
  } else {
    console.error('用法见文件头注释'); process.exit(1);
  }
  console.log(cmd + '：完成 ' + done + (skipped ? '，额度用完剩 ' + skipped + ' 个' : '') + '；本次真实请求 ' + sent + ' 次，用时 ' + Math.round((Date.now() - t0) / 1000) + ' 秒');
})().catch((e) => { console.error('停止：' + e.message + '（本次已请求 ' + sent + ' 次）'); process.exit(1); });
