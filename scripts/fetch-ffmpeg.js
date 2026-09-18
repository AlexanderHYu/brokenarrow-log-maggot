// 下载录像用的 FFmpeg（BtbN 的 Windows GPL 构建，ffmpeg.org 官方下载页推荐）到 vendor/ffmpeg/
// 用法：npm run fetch-ffmpeg（已存在则跳过；加 --force 重新下载）
// 校验：同一个 release 里的 checksums.sha256，对不上直接失败
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ASSET = 'ffmpeg-n8.1-latest-win64-gpl-8.1.zip';
const BASE = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/';
const OUT_DIR = path.join(__dirname, '..', 'vendor', 'ffmpeg');
const force = process.argv.includes('--force');

function get(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'fetch-ffmpeg' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(new URL(res.headers.location, url).toString(), dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      if (!dest) {
        let s = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { s += d; });
        res.on('end', () => resolve(s));
        return;
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    }).on('error', reject);
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

(async () => {
  const exe = path.join(OUT_DIR, 'ffmpeg.exe');
  if (fs.existsSync(exe) && !force) { console.log('已存在，跳过：' + exe); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-ffmpeg-'));
  try {
    console.log('读取校验值…');
    const sums = await get(BASE + 'checksums.sha256');
    const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(ASSET));
    if (!line) throw new Error('checksums.sha256 里没有 ' + ASSET);
    const expected = line.trim().split(/\s+/)[0].toLowerCase();
    console.log('下载 ' + ASSET + '（约 180MB）…');
    const zip = await get(BASE + ASSET, path.join(tmp, ASSET));
    const actual = await sha256(zip);
    if (actual !== expected) throw new Error('SHA256 不匹配：期望 ' + expected + '，实际 ' + actual);
    console.log('校验通过，解压…');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath $env:FF_ZIP -DestinationPath $env:FF_DIR -Force'],
      { stdio: 'inherit', env: { ...process.env, FF_ZIP: zip, FF_DIR: path.join(tmp, 'x') } });
    const root = fs.readdirSync(path.join(tmp, 'x')).map((d) => path.join(tmp, 'x', d)).find((d) => fs.existsSync(path.join(d, 'bin', 'ffmpeg.exe')));
    if (!root) throw new Error('压缩包里没有 bin/ffmpeg.exe');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.copyFileSync(path.join(root, 'bin', 'ffmpeg.exe'), exe);
    fs.copyFileSync(path.join(root, 'LICENSE.txt'), path.join(OUT_DIR, 'LICENSE.txt'));
    console.log('完成：' + exe);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
})().catch((e) => { console.error('fetch-ffmpeg 失败：' + e.message); process.exit(1); });
