// ================= 玩家分析引擎 =================
// 核心数据源：GET /api/analysis/player?stbid=xxx（一次返回 ELO 趋势/胜负/最爱单位/偏好/地图表现/打法）
// 龙区分（取代原来的蛆指数）：算法在 src/dragonScore.js，这里负责取数与拼装（buildDragonReport / buildMatchReview）。
const path = require('path');
const { parseDataString } = require('./tracker');
const { computeDragonScore, analyzeMatch } = require('./dragonScore');

// 地图名注册表：从 analysis 响应的 mapPerformance 免费收集真实地图名
const MAP_NAMES = { 3: 'Baltiisk', 4: 'Coast', 6: 'River', 7: 'Dam', 9: 'Airport', 10: 'Frontiers', 11: 'Central Village', 12: 'Oil refinery', 13: 'Suwalki', 16: 'Klaipeda', 17: 'Ruda', 20: 'Parnu', 21: 'Chernyakhovsk', 22: 'Ignalina Powerplant' };
function registerMapNames(mapPerformance) {
  if (!Array.isArray(mapPerformance)) return;
  let added = false;
  for (const m of mapPerformance) {
    if (m && m.mapId != null && m.mapName && MAP_NAMES[m.mapId] !== m.mapName) {
      MAP_NAMES[m.mapId] = m.mapName;
      added = true;
    }
  }
  if (added) _mapNameIndex = null; // 新地图名注册后重建反查索引
}
function mapName(id) {
  return MAP_NAMES[id] || `地图#${id}`;
}

// 地图名 → 地图ID（MAP_NAMES 反查，用于本地录像文件名编码；注册新名时重建索引）
let _mapNameIndex = null;
function mapIdFromName(name) {
  if (name == null) return null;
  const n = String(name).trim().toLowerCase();
  if (!n) return null;
  if (!_mapNameIndex) {
    _mapNameIndex = {};
    for (const id of Object.keys(MAP_NAMES)) {
      const nm = String(MAP_NAMES[id] || '').toLowerCase();
      if (nm) _mapNameIndex[nm] = Number(id);
    }
  }
  return _mapNameIndex[n] != null ? _mapNameIndex[n] : null;
}

class Analyzer {
  constructor(client) {
    this.client = client;
  }

  /**
   * 生成玩家粗查报告（只发 1 次 API 调用，不含蛆指数）
   * @param {string|number} stbid
   */
  async buildReport(stbid) {
    const sid = String(stbid);
    let a = null;
    try {
      a = await this.client.analysisPlayer(sid);
    } catch (e) {
      // analysis 404/失败 → 用 info 接口兜底（有档案但没排位分析的玩家）
      return this._fallbackInfo(sid);
    }
    if (!a || typeof a !== 'object' || (a.matchCount == null && !Array.isArray(a.trend))) {
      return this._fallbackInfo(sid);
    }

    registerMapNames(a.mapPerformance);

    const points = Array.isArray(a.trend?.points) ? a.trend.points : [];
    const latest = points[points.length - 1] || {};
    const wins = points.filter((p) => p.won).length;

    return {
      stbid: sid,
      matchCount: a.matchCount || points.length,
      elo: latest.ratingAfter != null ? Math.round(latest.ratingAfter * 100) / 100 : null,
      kd: latest.kdRatio != null ? Math.round(latest.kdRatio * 100) / 100 : null,
      dmr: latest.dmr != null ? Math.round(latest.dmr * 100) / 100 : null,
      winRate: points.length ? Math.round((wins / points.length) * 100) : 0,
      wins,
      losses: points.length - wins,
      recentMatches: points.slice(-12).reverse().map((p) => ({
        matchId: p.matchId,
        win: p.won,
        eloDelta: p.ratingAfter != null && p.ratingBefore != null ? Math.round((p.ratingAfter - p.ratingBefore) * 10) / 10 : null,
        kd: p.kdRatio,
        dmr: p.dmr,
        destruction: p.destructionScore,
        losses: p.lossesScore,
        objectives: p.objectivesCaptured,
        endTime: p.endTime
      })),
      favUnits: (a.highlightUnits || []).slice(0, 3).map((u) => ({
        name: u.unitName || `单位#${u.unitId}`,
        val: Math.round(u.totalDamage || 0),
        spawn: u.spawnCount || 0,
        roi: u.avgRoi != null ? Math.round(u.avgRoi * 100) / 100 : null
      })),
      categories: (a.categoryPreferences || []).slice(0, 3).map((c) => ({
        key: c.categoryKey,
        pct: c.percentage
      })),
      mapStats: (a.mapPerformance || []).slice(0, 5).map((m) => ({
        mapId: m.mapId,
        name: m.mapName || mapName(m.mapId),
        matchCount: m.matchCount,
        winRate: m.winRate
      })),
      playStyle: a.playStyle || null
    };
  }

  /**
   * 玩家的龙区分：最近 20 场排位局（1 次请求，1 小时缓存）+ 兵种花费和最常用单位判断角色（玩家分析，通常已缓存）
   * @param {string|number} stbid
   */
  async buildDragonReport(stbid) {
    const sid = String(stbid);
    let analysis = null;
    try { analysis = await this.client.analysisPlayer(sid); } catch (e) { /* 没有分析数据时按正面角色算 */ }
    if (analysis) registerMapNames(analysis.mapPerformance);
    let res;
    try {
      res = await this.client.playerMatchesPage(sid, 20);
    } catch (e) {
      return { error: 'fetch', message: String((e && e.message) || e), stbid: sid };
    }
    const r = computeDragonScore({ stbid: sid, matches: (res && res.matches) || [], categoryPreferences: analysis && analysis.categoryPreferences, highlightUnits: analysis && analysis.highlightUnits });
    if (!r.error) for (const row of r.rows) row.map = row.mapId != null ? mapName(row.mapId) : '';
    return r;
  }

  /**
   * 单局复盘：/api/match（1 次请求，24 小时缓存）→ 每个人的单场龙区分、龙/区/泯、功劳最大/锅最大、掉线检测
   * 角色按本局实际出的单位判断（单位数据就在这一次请求里）；个别没有单位数据的人用已缓存的玩家分析
   * @param {string} fid
   * @param {number} [winnerTeam] 已知胜方（非排位局判胜负用）
   */
  async buildMatchReview(fid, winnerTeam) {
    let res;
    try {
      res = await this.client.matchById(fid);
    } catch (e) {
      return { error: 'fetch', message: String((e && e.message) || e), fid: String(fid) };
    }
    const mi = res && res.matchInfo;
    if (!mi || !mi.Data || !Object.keys(mi.Data).length) return { error: 'notYet', fid: String(fid) };
    const rolesById = {};
    for (const p of Object.values(mi.Data)) {
      const a = this.client.peek('analysis:' + p.Id, 6 * 3600 * 1000);
      if (a && a.categoryPreferences) rolesById[String(p.Id)] = { categoryPreferences: a.categoryPreferences, highlightUnits: a.highlightUnits };
    }
    return analyzeMatch(mi, fid, { winnerTeam, rolesById });
  }

  // analysis 404 时的兜底：用 /api/players/info 的基础档案
  async _fallbackInfo(sid) {
    try {
      const info = await this.client.playerInfo(sid);
      const i = info && info.info;
      if (!i || !i.name) return { error: '未找到该玩家（可能未收录或无排位数据）', stbid: sid };
      const st = info.statInfo || {};
      const wins = st.winCountRt || 0, losses = st.lossCountRt || 0;
      return {
        stbid: sid,
        name: i.name,
        level: i.level,
        elo: i.rating != null ? Math.round(i.rating * 100) / 100 : null,
        matchCount: st.fightsCountRt || (wins + losses),
        wins,
        losses,
        winRate: (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : null,
        kd: null, dmr: null,
        recentMatches: [], favUnits: [], categories: [], mapStats: [], playStyle: null,
        fallback: true
      };
    } catch (e2) {
      return { error: '未找到该玩家（可能未收录或无排位数据）', stbid: sid };
    }
  }

  // 当前对局玩家卡片的“轻量情报”（也从同一次 analysis 调用里取，免费附带）
  extractMini(a) {
    if (!a || typeof a !== 'object' || (a.matchCount == null && !Array.isArray(a.trend))) return null;
    const points = Array.isArray(a?.trend?.points) ? a.trend.points : [];
    const latest = points[points.length - 1] || {};
    const wins = points.filter((p) => p.won).length;
    return {
      elo: latest.ratingAfter != null ? Math.round(latest.ratingAfter) : null,
      kd: latest.kdRatio != null ? Math.round(latest.kdRatio * 100) / 100 : null,
      matchCount: a.matchCount || points.length,
      winRate: points.length ? Math.round((wins / points.length) * 100) : null,
      topUnits: (a.highlightUnits || []).slice(0, 3).map((u) => u.unitName).filter(Boolean).join('、'),
      category: (a.categoryPreferences || [])[0]?.categoryKey || null
    };
  }
}

// 把 /api/players/matches 的 matches 数组解析成「最近对局」列表（Data 为对象或字符串都支持）
// 每项: { fid, map, endTime, eloDelta, won, teamId, custom, newRating }；teamId 只在有真实 TeamId 时给出，缺失=null（不猜队伍）
function recentMatchesFromApi(matches, id, mapNameFn) {
  const out = [];
  const list = Array.isArray(matches) ? matches : [];
  const mapName = typeof mapNameFn === 'function' ? mapNameFn : ((x) => (x != null ? String(x) : ''));
  for (const raw of list) {
    const d = (raw && raw.data) || {};
    const data = (d.Data && typeof d.Data === 'object') ? d.Data : parseDataString(d.Data);
    const me = data[String(id)] || Object.values(data).find((x) => x && String(x.Id) === String(id));
    if (!me) continue;
    const oldR = typeof me.OldRating === 'number' ? me.OldRating : null;
    const newR = typeof me.NewRating === 'number' ? me.NewRating : null;
    const hasRating = oldR != null && newR != null;
    let won = null;
    if (hasRating) { if (newR > oldR) won = true; else if (newR < oldR) won = false; }
    const meTid = (me.TeamId === 1 || me.TeamId === 0 || me.TeamId === 100) ? me.TeamId : null;
    if (won == null && d.WinnerTeam != null && meTid != null) won = (meTid === d.WinnerTeam);
    const mapId = d.MapId != null ? d.MapId : null;
    out.push({
      fid: String(raw.matchId != null ? raw.matchId : ''),
      map: mapId != null ? mapName(mapId) : '',
      endTime: d.EndTime ? d.EndTime * 1000 : null,
      eloDelta: hasRating ? Math.round((newR - oldR) * 10) / 10 : null,
      won,
      teamId: meTid,
      custom: !hasRating,
      newRating: newR
    });
  }
  return out;
}

module.exports = { Analyzer, mapName, mapIdFromName, registerMapNames, MAP_NAMES, recentMatchesFromApi };
