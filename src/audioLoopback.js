// ================= 系统声音采集（WASAPI 回环） =================
// Chromium 的桌面音频回环在部分设备上启动不了（实测默认设备为 8 声道时报 Could not start audio source），
// 改用 native/wasapi-loopback.cs：直接调用 Windows 的 WASAPI 回环接口，把原始 PCM 写到 stdout，
// 再由 ffmpeg 实时混成立体声并编码为 AAC（ADTS 流式格式，中途崩溃也不丢已录部分）。
// 小程序用 Windows 自带的 .NET Framework csc 编译（Win10/11 都有），按源码哈希缓存到 userData/bin。
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

let electronMod = null;
try { electronMod = require('electron'); } catch (e) { electronMod = null; }

const SRC = path.join(__dirname, '..', 'native', 'wasapi-loopback.cs');

function cscPath() {
  const win = process.env.WINDIR || 'C:\\Windows';
  const cands = [
    path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ];
  return cands.find((p) => fs.existsSync(p)) || null;
}

function binDir() {
  try { return path.join(electronMod.app.getPath('userData'), 'bin'); } catch (e) { return path.join(os.tmpdir(), 'ba-log-assistant-bin'); }
}

let helperPromise = null;
function ensureHelper() {
  if (helperPromise) return helperPromise;
  helperPromise = new Promise((resolve, reject) => {
    // 打包后源码在 app.asar 里，外部的 csc 读不到：先经 Electron 的 fs 读出来写到临时文件
    const source = fs.readFileSync(SRC, 'utf8');
    const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 12);
    const dir = binDir();
    const exe = path.join(dir, 'wasapi-loopback-' + hash + '.exe');
    if (fs.existsSync(exe)) return resolve(exe);
    const csc = cscPath();
    if (!csc) return reject(new Error('找不到 .NET Framework 编译器（csc.exe）'));
    fs.mkdirSync(dir, { recursive: true });
    const tmpSrc = path.join(os.tmpdir(), 'wasapi-loopback-' + hash + '.cs');
    fs.writeFileSync(tmpSrc, source);
    execFile(csc, ['-nologo', '-optimize+', '-target:exe', '-out:' + exe, tmpSrc], { windowsHide: true, timeout: 60000 }, (err, stdout) => {
      try { fs.unlinkSync(tmpSrc); } catch (e) {}
      if (err || !fs.existsSync(exe)) return reject(new Error('编译声音采集程序失败: ' + String(stdout || (err && err.message) || '').trim().slice(0, 300)));
      resolve(exe);
    });
  });
  helperPromise.catch(() => { helperPromise = null; }); // 失败了下次再试
  return helperPromise;
}

const PCM_FORMATS = { f32: 'f32le', i16: 's16le', i24: 's24le', i32: 's32le' };

// 开始采集，写到 outFile（.aac）。返回 { startWall, stop(), kill() }；startWall 为音频第 0 秒对应的系统时间
async function startLoopback(outFile, ffmpegBin, log) {
  const exe = await ensureHelper();
  const helper = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const info = await new Promise((resolve, reject) => {
    const got = {};
    let buf = '';
    const timer = setTimeout(() => { try { helper.kill(); } catch (e) {} reject(new Error('声音采集程序 5 秒内没有启动')); }, 5000);
    helper.stderr.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        let m;
        if ((m = line.match(/^FORMAT (\d+) (\d+) (\d+) ([fi])$/))) Object.assign(got, { rate: Number(m[1]), channels: Number(m[2]), bits: Number(m[3]), float: m[4] === 'f' });
        else if ((m = line.match(/^START (\d+)$/))) { got.startWall = Number(m[1]); clearTimeout(timer); resolve(got); }
        else if (line.startsWith('ERROR')) { clearTimeout(timer); reject(new Error(line.slice(6))); }
        else if (line && log) log('声音采集: ' + line);
      }
    });
    helper.on('exit', (code) => { clearTimeout(timer); reject(new Error('声音采集程序退出 code=' + code)); });
  });
  const pcm = PCM_FORMATS[(info.float ? 'f' : 'i') + info.bits];
  if (!pcm) { try { helper.kill(); } catch (e) {} throw new Error('不支持的声音格式: ' + info.bits + 'bit ' + (info.float ? 'float' : 'int')); }
  const enc = spawn(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-f', pcm, '-ar', String(info.rate), '-ac', String(info.channels), '-i', 'pipe:0',
    '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-f', 'adts', '-y', outFile], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let encErr = '';
  enc.stderr.on('data', (d) => { encErr = (encErr + d.toString()).slice(-1000); });
  helper.stdout.pipe(enc.stdin);
  enc.stdin.on('error', () => {}); // ffmpeg 先退出时忽略 EPIPE
  const encDone = new Promise((r) => enc.on('exit', r));
  if (log) log('声音采集: ' + info.rate + 'Hz ' + info.channels + '声道 ' + info.bits + 'bit' + (info.float ? ' float' : '') + ' → AAC 立体声');
  return {
    startWall: info.startWall,
    // 关掉采集程序的 stdin 让它自行退出 → 它的 stdout 关闭 → ffmpeg 读到结尾写完文件
    async stop() {
      try { helper.stdin.end(); } catch (e) {}
      const killer = setTimeout(() => { try { helper.kill(); } catch (e) {} try { enc.kill(); } catch (e) {} }, 8000);
      const code = await encDone;
      clearTimeout(killer);
      if (code !== 0 && log) log('声音编码 exit=' + code + ' ' + encErr.trim());
    },
    kill() { try { helper.kill(); } catch (e) {} try { enc.kill(); } catch (e) {} }
  };
}

module.exports = { startLoopback, ensureHelper };
