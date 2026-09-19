// ================= 预加载脚本（渲染进程安全桥接） =================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  selectDir: () => ipcRenderer.invoke('config:selectDir'),
  detectDir: () => ipcRenderer.invoke('config:detectDir'),
  validateDir: (dir) => ipcRenderer.invoke('config:validateDir', dir),

  // 日志/会话
  getWatcherStatus: () => ipcRenderer.invoke('watcher:status'),
  getSession: () => ipcRenderer.invoke('session:get'),
  onSession: (cb) => ipcRenderer.on('session', (e, d) => cb(d)),
  onWatcher: (cb) => ipcRenderer.on('watcher', (e, d) => cb(d)),

  // 当前对局查询
  queryCurrentMatch: () => ipcRenderer.invoke('match:queryCurrent'),
  queryRoster: (players) => ipcRenderer.invoke('match:queryRoster', players),
  onMatchQuerying: (cb) => ipcRenderer.on('match:querying', (e, d) => cb(d)),
  onMatchPlayer: (cb) => ipcRenderer.on('match:player', (e, d) => cb(d)),
  onMatchDone: (cb) => ipcRenderer.on('match:done', (e, d) => cb(d)),
  onBatraceGate: (cb) => ipcRenderer.on('batrace:gate', (e, d) => cb(d)),

  // 查询
  searchPlayers: (q) => ipcRenderer.invoke('search:players', q),
  playerReport: (stbid) => ipcRenderer.invoke('report:player', stbid),
  dragonReport: (stbid) => ipcRenderer.invoke('report:dragon', stbid),
  matchReview: (fid) => ipcRenderer.invoke('match:review', fid),
  matchReport: (fid) => ipcRenderer.invoke('match:report', fid),

  // 版本
  getVersion: () => ipcRenderer.invoke('app:version'),
  getUpdateInfo: () => ipcRenderer.invoke('update:get'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (e, d) => cb(d)),

  // BATrace 稳定性
  getApiHealth: () => ipcRenderer.invoke('api:health'),
  onApiHealth: (cb) => ipcRenderer.on('api:health', (e, d) => cb(d)),

  // 档案
  getArchive: () => ipcRenderer.invoke('archive:list'),
  clearArchive: () => ipcRenderer.invoke('archive:clear'),
  onArchiveChanged: (cb) => ipcRenderer.on('archive:changed', (e, d) => cb(d)),

  // 玩家追踪
  getPlayerProfile: (id) => ipcRenderer.invoke('tracker:profile', id),
  getBans: () => ipcRenderer.invoke('tracker:getBans'),
  syncBans: () => ipcRenderer.invoke('tracker:syncBans'),
  syncMyMatchesNow: () => ipcRenderer.invoke('match:syncNow'),
  getTrackerMatches: () => ipcRenderer.invoke('tracker:matches'),
  getMatchDetail: (fid) => ipcRenderer.invoke('tracker:matchDetail', fid),
  refreshMatch: (fid) => ipcRenderer.invoke('tracker:refreshMatch', fid),
  addMatchByFid: (fid) => ipcRenderer.invoke('tracker:addMatch', fid),
  deleteMatch: (fid) => ipcRenderer.invoke('tracker:deleteMatch', fid),
  onBansChanged: (cb) => ipcRenderer.on('bans:changed', (e, d) => cb(d)),
  onBanAlert: (cb) => ipcRenderer.on('bans:alert', (e, d) => cb(d)),
  getCheaters: () => ipcRenderer.invoke('tracker:cheaters'),
  listAccounts: () => ipcRenderer.invoke('tracker:listAccounts'),
  deleteAccount: (id) => ipcRenderer.invoke('tracker:deleteAccount', id),
  onMatchesChanged: (cb) => ipcRenderer.on('matches:changed', (e, d) => cb(d)),

  // 对局录像（本地）
  getReplayStatus: () => ipcRenderer.invoke('replay:status'),
  listLocalReplays: () => ipcRenderer.invoke('replay:localList'),
  deleteLocalReplay: (key) => ipcRenderer.invoke('replay:localDelete', key),
  cleanLocalReplays: (days) => ipcRenderer.invoke('replay:localClean', days),
  prepareReplay: (key) => ipcRenderer.invoke('replay:prepare', key),
  openReplayExternal: (key) => ipcRenderer.invoke('replay:openExternal', key),
  replayPreviewCapture: (opts) => ipcRenderer.invoke('replay:previewCapture', opts),
  replayPreviewRender: (exposure) => ipcRenderer.invoke('replay:previewRender', exposure),
  openLocalReplayFolder: () => ipcRenderer.invoke('replay:openLocalFolder'),
  getReplayDirInfo: () => ipcRenderer.invoke('replay:dirInfo'),
  listDisplays: () => ipcRenderer.invoke('replay:displays'),
  setReplayDisplay: (id) => ipcRenderer.invoke('replay:setDisplay', id),
  selectReplaySaveDir: () => ipcRenderer.invoke('replay:selectSaveDir'),
  setReplaySaveDir: (dir) => ipcRenderer.invoke('replay:setSaveDir', dir),
  moveReplays: (from, to) => ipcRenderer.invoke('replay:moveReplays', { from, to }),
  getScreenThumbnail: (displayId) => ipcRenderer.invoke('replay:screenThumbnail', displayId),
  onReplayRecording: (cb) => ipcRenderer.on('replay:recording', (e, d) => cb(d)),
  onReplayPreview: (cb) => ipcRenderer.on('replay:preview', (e, d) => cb(d)),
  onReplayProgress: (cb) => ipcRenderer.on('replay:progress', (e, d) => cb(d)),
  onReplayChanged: (cb) => ipcRenderer.on('replay:changed', (e, d) => cb(d)),

  // 外部链接
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),

  // 卡组工具
  getDeckPaths: () => ipcRenderer.invoke('deck:paths'),
  listDecks: () => ipcRenderer.invoke('deck:list'),
  backupDecks: (names, packageName) => ipcRenderer.invoke('deck:backup', { names, packageName }),
  deployDecks: (packageName) => ipcRenderer.invoke('deck:deploy', packageName),
  deleteDecks: (kind, names) => ipcRenderer.invoke('deck:delete', { kind, names }),
  syncRestore: () => ipcRenderer.invoke('deck:syncRestore'),
  syncIgnore: () => ipcRenderer.invoke('deck:syncIgnore'),
  syncDismiss: () => ipcRenderer.invoke('deck:syncDismiss'),
  openDeckFolder: (kind) => ipcRenderer.invoke('deck:openFolder', kind),
  onDeckChanged: (cb) => ipcRenderer.on('deck:changed', (e, d) => cb(d)),
  onDeckSyncAlert: (cb) => ipcRenderer.on('deck:syncAlert', (e, d) => cb(d))
});

