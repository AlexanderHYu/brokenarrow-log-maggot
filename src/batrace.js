// ================= BATrace API 客户端 =================
// 说明：batrace 的接口没有 CORS 头，浏览器页面里无法跨域调用；
// 但 Electron 主进程是 Node 环境，发 HTTP 请求不受 CORS 限制，直接调用即可。
// 本模块负责：限流（排队）、磁盘缓存、错误兜底。
const fs = require('fs');
const path = require('path');

const BASE = 'https://app.batrace.top';

// 注意：不发送自定义 User-Agent。腾讯 EdgeOne 会把「自定义 UA」判为机器人并返回验证页（实测锁定），
// 让 Chromium net.fetch 使用默认 UA 才能通过人机验证。

// 是否为真正的腾讯 EdgeOne 人机验证页：只认验证页标记（普通 5xx/429/维护页等 HTML 不算，避免误弹验证窗）
function isCaptchaHtml(text) {
  if (typeof text !== 'string' || !text) return false;
  return text.indexOf('TencentEOCaptchaWidget') >= 0
    || text.indexOf('EO-Bot-Captcha-Token') >= 0
    || text.indexOf('Security Verification') >= 0
    || text.indexOf('__tst_status') >= 0;
}

class Cache {
  constructor(file) {
    this.file = file;
    this.data = {}; // key -> { t, value }
    try {
      if (fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { this.data = {}; }
  }
  get(key, ttl) {
    const it = this.data[key];
    if (!it) return null;
    if (Date.now() - it.t > ttl) return null;
    return it.value;
  }
  set(key, value) {
    this.data[key] = { t: Date.now(), value };
    this.flush();
  }
  flush() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.data), 'utf8'); } catch (e) {}
  }
}

class BatraceClient {
  constructor(opts = {}) {
    this.base = opts.base || BASE;
    this.delayMs = opts.delayMs || 350;
    this.cache = opts.cache || null; // Cache 实例
    this.extraHeaders = (opts.extraHeaders && typeof opts.extraHeaders === 'object') ? opts.extraHeaders : {}; // 自定义请求头（本地私有，如 bypass 白名单头）
    this.fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : null; // 自定义请求实现（Electron net.fetch，与验证窗口共享 session cookie）
    this.onChallenge = typeof opts.onChallenge === 'function' ? opts.onChallenge : null; // BATrace 人机验证解锁回调（检测到验证页时触发）
    this._queue = Promise.resolve();
  }

  // 串行限流：每次请求之间至少间隔 delayMs
  _throttle() {
    const next = this._queue.then(() => new Promise((r) => setTimeout(r, this.delayMs)));
    this._queue = next.catch(() => {});
    return next;
  }

  async _get(p, { ttl, cacheKey, retries = 2 } = {}) {
    const key = cacheKey || p;
    if (ttl && this.cache) {
      const hit = this.cache.get(key, ttl);
      if (hit) return hit;
    }
    const fetchImpl = this.fetchImpl || ((u, o) => fetch(u, o));
    this.networkCalls = (this.networkCalls || 0) + 1; // 真正打到 batrace 的请求数（缓存命中不计）
    await this._throttle();
    let lastErr = null;
    let challengeTried = false; // 本次调用是否已触发过人机验证
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetchImpl(this.base + p, {
          // 合并自定义头但强制剔除 User-Agent（防止旧 bypassUA/手动 UA 触发 EdgeOne 验证页）
          headers: (() => { const h = Object.assign({ Accept: 'application/json' }, this.extraHeaders); delete h['User-Agent']; return h; })(),
          signal: AbortSignal.timeout(15000)
        });
        // 只把「真正的 EdgeOne 人机验证页」当验证处理（读响应体看标记）；5xx/429/维护页等普通 HTML 一律按错误处理，绝不误弹验证窗
        const ctype = res && res.headers && typeof res.headers.get === 'function' ? String(res.headers.get('content-type') || '') : '';
        if (ctype.toLowerCase().includes('text/html')) {
          const text = await res.text();
          if (isCaptchaHtml(text)) {
            if (!challengeTried && this.onChallenge) {
              challengeTried = true;
              await this.onChallenge();
            }
            throw new Error('BATrace 人机验证未完成，请稍后重试');
          }
          throw new Error(res.ok ? 'BATrace 返回了非 JSON 响应' : `HTTP ${res.status}`);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (ttl && this.cache) this.cache.set(key, json);
        return json;
      } catch (e) {
        // 人机验证被取消/超时/出错/冷却：直接透传，不再无谓重试（下次查询会重新弹窗）
        if (e && (e.code === 'BATRACE_VERIFY_CANCELLED' || e.code === 'BATRACE_VERIFY_TIMEOUT' || e.code === 'BATRACE_VERIFY_ERROR' || e.code === 'BATRACE_VERIFY_COOLDOWN')) throw e;
        lastErr = e;
        if (i < retries) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
      }
    }
    // 失败时尝试返回旧缓存
    if (this.cache) {
      const old = this.cache.data[key];
      if (old) return old.value;
    }
    throw lastErr || new Error('请求失败');
  }

  searchPlayers(q, limit = 20) {
    return this._get(`/api/players/search?q=${encodeURIComponent(q)}&limit=${limit}`, {
      ttl: 10 * 60 * 1000, cacheKey: `search:${q}:${limit}`
    });
  }

  // ★ 核心接口：一次调用返回玩家完整分析（ELO趋势/胜负/最爱单位/偏好/地图表现/打法）
  // 用于当前对局查询与玩家报告，是控制调用次数的主力（带 6 小时磁盘缓存）
  analysisPlayer(stbid) {
    return this._get('/api/analysis/player?stbid=' + encodeURIComponent(stbid), {
      ttl: 6 * 3600 * 1000, cacheKey: 'analysis:' + stbid
    });
  }

  playerInfo(stbid) {
    return this._get(`/api/players/info?stbid=${encodeURIComponent(stbid)}`, {
      ttl: 6 * 3600 * 1000, cacheKey: `info:${stbid}`
    });
  }

  playerMatches(stbid, offset = 0) {
    return this._get(`/api/players/matches?stbid=${encodeURIComponent(stbid)}&offset=${offset}`, {
      ttl: 6 * 3600 * 1000, cacheKey: `pmatches:${stbid}:${offset}`
    });
  }

  // 本机最近对局（后台同步用；TTL 30 分钟保证每小时真拉取）。注意：所有真实请求都计入 24h 配额
  playerMatchesRecent(stbid, limit = 10) {
    return this._get(`/api/players/matches?stbid=${encodeURIComponent(stbid)}&limit=${limit}`, {
      ttl: 30 * 60 * 1000, cacheKey: `myMatches:${stbid}:${limit}`
    });
  }

  // 封禁名单（后台同步用；TTL 1 小时）
  leaderboardBan(limit = 500, offset = 0) {
    return this._get(`/api/leaderboard/ban?limit=${limit}&offset=${offset}`, {
      ttl: 3600 * 1000, cacheKey: `ban:${limit}:${offset}`
    });
  }

  // 龙区分：最近 20 场（接口单次最多返回 20 场）；每场含全部玩家的赛前/赛后 ELO、摧毁分、损失分、占点、队伍、时长
  playerMatchesPage(stbid, limit = 20) {
    return this._get(`/api/players/matches?stbid=${encodeURIComponent(stbid)}&limit=${limit}`, {
      ttl: 3600 * 1000, cacheKey: `pm:${stbid}:${limit}`
    });
  }

  // 只读缓存、不发请求（单局复盘取已缓存的玩家分析判断角色，不为此额外请求）
  peek(cacheKey, ttl) {
    return this.cache ? this.cache.get(cacheKey, ttl) : null;
  }

  // 单局原始数据（游戏后端格式）：每个玩家的 ELO/摧毁/损失/占点/补给/友伤，以及单位级 UnitData
  matchById(matchId) {
    return this._get(`/api/match?matchid=${encodeURIComponent(matchId)}`, {
      ttl: 24 * 3600 * 1000, cacheKey: `match:${matchId}`
    });
  }

  // BATrace 加工过的单局数据：mvpRanking（含 7 个分项）、economy、unitComposition、damageContribution 等
  analysisMatch(matchId) {
    return this._get(`/api/analysis/match?matchid=${encodeURIComponent(matchId)}`, {
      ttl: 24 * 3600 * 1000, cacheKey: `amatch:${matchId}`
    });
  }

  // 单局数据（后台补胜负用，与 analysisMatch 同缓存；历史原因保留的别名）
  analysisMatchNoCount(matchId) {
    return this._get(`/api/analysis/match?matchid=${encodeURIComponent(matchId)}`, {
      ttl: 24 * 3600 * 1000, cacheKey: `amatch:${matchId}`
    });
  }


  // BATrace 人机验证页判断：只认验证页标记（供外部调用方/测试使用）
  _isCaptchaHtml(text) {
    return isCaptchaHtml(text);
  }

  units() {
    return this._get('/api/units', {
      ttl: 7 * 24 * 3600 * 1000, cacheKey: 'units'
    });
  }
}

module.exports = { BatraceClient, Cache, isCaptchaHtml };

