# 🐉 龙区分类器

> ## 🐉 已经搬家：新仓库 [ba-dragon](https://github.com/AlexanderHYu/ba-dragon)
>
> 这个工具已经从零重写，新仓库是 **[AlexanderHYu/ba-dragon](https://github.com/AlexanderHYu/ba-dragon)**，
> 最新版请到 [那边的 Releases](https://github.com/AlexanderHYu/ba-dragon/releases/latest) 下载（推荐安装版）。
>
> **正在用 4.0.x 的朋友请注意**：新版的版本号从 1.0.0 重新起算，比 4.0.3 小，
> 所以你手上这个版本的自动更新**不会**提示你升级 —— 这一次要手动下载安装一遍。
> 新版用的是同一个数据目录，装上直接覆盖，**设置和对局档案都会保留**
> （对局档案、玩家库、ELO 记录会自动迁移过去）。装完之后由新仓库的自动更新接手，以后还是自动的。
>
> 这个仓库不再更新，留档用。

基于断箭官方 GameLogs 日志和 [BATrace](https://app.batrace.top/) 公开数据的本地对局复盘工具：谁是龙、谁是区，一眼看清。
只读日志与公开接口：不碰内存、不注入进程、不影响反作弊。

## 功能

- **日志实时监听**：自动识别当前对局和房间内的玩家名单（开战前就能看）
- **自动粗查**：对局里每个玩家的 ELO、胜率、偏好兵种、最爱单位
- **龙区分**：在同分段、同角色构成的玩家里排第几（5.5 = 中位数，越高越龙）。K/D、摧毁贡献和胜负预期逐场打分（占点不计入），卡尔曼滤波汇总，附可能范围；角色细分为装甲/步兵/侦察/炮兵/防空/直升机/固定翼。所有参数用 BATrace 真实数据拟合
- **龙区复盘 + 称号**：上一局和对局档案里给每个人标 **龙 / 区 / 泯**，再按这一局的实际作用发一个称号——大腿、背锅侠、掉线狗、带不动、孤勇者、收割机、举重冠军、刮痧师傅、落地成盒、曼巴out……（悬停看原因）
- **单局复盘页**：上一局、对局档案里点「📊 详细复盘」——双方阵营/平均分/赛前预期胜率、各项数据对比、兵种构成、本局要点；每个人的龙区分、称号、净交换、存活率、伤害效率，展开看他每个单位的出兵/阵亡/存活时间；全场单位的使用率、死亡率、伤害/花费；双方兵力曲线和每分钟损失
- **自动更新**：安装版在后台下载新版，点「重启更新」即装好；免安装版在页面顶部提示去下载
- **行车记录仪**：每局自动录制游戏所在屏幕，存为可随意拖动的 **MP4**。FFmpeg 采集 + 显卡硬件编码（NVENC / AMF / QuickSync）；支持 HDR 显示器（自动色调映射，不再过曝）和曝光调节；录系统声音并与画面对齐；只存本地
- **卡组工具**：备份 / 部署游戏卡组，换号时提醒同步
- **玩家追踪**：本地记录见过的玩家；右键「调查」看相遇次数、同队/敌对胜负、改名历史、是否被封
- **封禁追踪**（可选）：每小时检查 BATrace 封禁名单，你遇到过的人被封时提醒

## 下载

到 [Releases](https://github.com/AlexanderHYu/brokenarrow-log-maggot/releases/latest) 下载最新版：

| 文件 | 说明 |
|---|---|
| **`DragonClassifier-Setup-x.y.z.exe`** | ⭐ **推荐：安装版**。有新版会在后台自动下载，点一下「重启更新」就装好 |
| `DragonClassifier-Portable-x.y.z.exe` | 免安装版，双击即用；不能自动更新，有新版时只提示去下载 |

两个版本共用同一份设置和对局档案（`%APPDATA%\broken-arrow-log-assistant`），换着用、覆盖安装都不会丢数据。
Windows 可能提示「未知发布者」（没有买代码签名证书），点「更多信息 → 仍要运行」即可。

## 快速开始

1. 打开软件，点右上角「⚙ 设置」
2. 选择断箭的日志目录（`...\broken_arrow\GameLogs`），或点「自动检测 Steam 目录」
3. 进入对局自动粗查玩家；搜索玩家后点「🐉 查龙区分」；打完点「🕘 上一局」看龙区复盘

> ⚠️ 粗查数据来自 BATrace 历史数据，有数天延迟，不是实时对战数据。

## 开发

```bash
npm install
npm run fetch-ffmpeg   # 下载并校验 FFmpeg（录像用）
npm start
npm run dist           # 打包 Windows 安装版和免安装版（推 v* 标签时 GitHub Actions 自动打包发布）
```

**龙区分和称号怎么算**见 [docs/algorithm.md](docs/algorithm.md)（带完整例子）；设计取舍、数据和回测见 [docs/rating-design.md](docs/rating-design.md)；功能详细说明见 [使用说明.md](使用说明.md)。

## 致谢

- 玩家数据由 [BATrace](https://app.batrace.top/) 提供（运营方已同意本工具使用其 API）
- Fork 自 Zola 的 [断箭蛆工具](https://github.com/Zawinzala/brokenarrow-log-maggot)；最初的蛆指数来自 [断箭蛆指数网站](https://github.com/Zawinzala/Broken-Arrow-Maggot)，现已改为龙区分。本 fork 去掉了所有连接原作者服务器的功能，重写了录像模块
- 录像使用 [FFmpeg](https://github.com/BtbN/FFmpeg-Builds)（GPL）
