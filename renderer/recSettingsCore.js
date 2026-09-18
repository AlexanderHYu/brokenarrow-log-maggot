// ================= 录像设置纯函数（浏览器与单测共用） =================
// 浏览器：window.recCore；Node 单测：require('./renderer/recSettingsCore')
(function (root) {
  // 分辨率档位：0 = 原生（不缩放，编码器与采集同卡时帧全程留在显存）
  const QUALITIES = [0, 720, 1080, 1440];
  const core = {
    QUALITIES,
    normQuality(q) {
      const n = Number(q);
      if (QUALITIES.includes(n)) return n;
      return n > 0 && n < 1080 ? 720 : 1080; // 旧版的 240~720 档收敛到 720
    },
    normFps(f) { const n = Number(f); return Number.isFinite(n) ? Math.min(60, Math.max(30, Math.round(n))) : 30; },
    normBitrate(b) { const n = Number(b); return Number.isFinite(n) ? Math.min(40, Math.max(3, Math.round(n))) : 8; },
    normAudio(a) { return a === 'off' ? 'off' : 'default'; },
    normExposure(e) { const n = Number(e); return Number.isFinite(n) ? Math.max(-2, Math.min(2, Math.round(n * 4) / 4)) : 0; },
    fmtExposure(e) { const n = core.normExposure(e); return (n > 0 ? '+' : '') + n.toFixed(2).replace(/\.?0+$/, '') + ' EV'; },
    // 预计 45 分钟（2700s）文件大小：VBR 以码率为目标，按上限估算；声音 AAC 128kbps ≈ 43MB
    estSize45(fps, bitrateMbps, audioOn) {
      const bps = core.normBitrate(bitrateMbps);
      const mb = bps / 8 * 2700;
      const audioMb = audioOn ? Math.round((128 / 8 * 2700) / 1000) : 0;
      return { mb: Math.round(mb), audioMb, bps };
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.recCore = core;
})(typeof window !== 'undefined' ? window : globalThis);
