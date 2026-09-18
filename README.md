# 🐛 断箭蛆工具 byZola（Broken Arrow Log Assistant）

[中文](#中文) · [English](#english) · [日本語](#日本語) · [Русский](#русский)

---

## 中文

基于游戏官方 GameLogs 日志 + [BATrace](https://app.batrace.top/) 公开数据的本地复盘辅助工具。
只读公开日志与公开接口：不碰内存、不注入进程、不影响反作弊。

### 功能
- **日志实时监听**：自动识别当前对局、房间内玩家名单（开战前即可查看）
- **自动粗查**：对局玩家 ELO / 胜率 / 偏好兵种 / 最爱单位，每局约 10 次调用，内置 24h 配额保护
- **龙区分**（取代蛆指数）：在同分段、同角色构成的玩家里排第几（5.5 = 中位数，越高越龙）。K/D、摧毁贡献和胜负预期逐场打分（占点不计入），卡尔曼滤波汇总，附可能范围；角色细分为装甲/步兵/侦察/炮兵/防空/直升机/固定翼。所有参数用 BATrace 真实数据拟合
- **龙区复盘 + 称号**：上一局和对局档案里给每个人标**龙 / 区 / 泯**，再按这一局的实际作用发称号——大腿、背锅侠、掉线狗、带不动、孤勇者、收割机、举重冠军、刮痧师傅、落地成盒、运输大队长……（悬停看原因）
- **对局录像（行车记录仪）**：每局自动录制游戏所在屏幕，存为 **MP4**（进度条随意拖动）。FFmpeg 采集 + 显卡硬件编码（NVENC / AMF / QuickSync），CPU 占用极低；支持 HDR 显示器（自动色调映射，不再过曝）；录系统声音并与画面对齐；纯本地保存
- **卡组工具**：备份 / 恢复游戏卡组，支持一键备份全部
- **玩家追踪（仿 VRCX）**：本地数据库持续记录见过的玩家；右键「调查」查看相遇次数、同队/敌对胜负、改名历史、是否被封
- **封禁监控**：每小时检查 BATrace 封禁名单，发现新被封玩家弹窗提醒
- **上一局**：当前房间卡片可一键查看上一局名单并自动粗查
- **四主题 + 四语言**：黑 / 白 / 青 / 橙 主题；中文 / English / 日本語 / Русский 界面切换

### 下载

最新版本见 **[Releases](https://github.com/AlexanderHYu/brokenarrow-log-maggot/releases)**，推荐下载普通版（免安装）。

### 快速开始
1. 安装后打开软件，点右上角「设置」
2. 选择断箭的日志目录（`...\broken_arrow\GameLogs`），可点「自动检测 Steam 目录」
3. 进入对局即自动粗查玩家；搜索玩家后点「🐉 查龙区分」看龙区分；打完点「🕘 上一局」看龙区复盘

> ⚠️ 粗查数据来自 BATrace 历史数据，存在数天延迟，并非实时对战数据。

### 致谢
玩家数据由 [BATrace 查询站](https://app.batrace.top/) 提供；最初的蛆指数算法来自 [断箭蛆指数网站](https://github.com/Zawinzala/Broken-Arrow-Maggot)，现已改用龙区分（设计见 [docs/rating-design.md](docs/rating-design.md)）。

本仓库 fork 自 [Zawinzala/brokenarrow-log-maggot](https://github.com/Zawinzala/brokenarrow-log-maggot)（作者 Zola），去掉了所有连接原作者服务器的功能（心跳统计、房间工具用户、版本推送），并重写了录像模块。录像使用 [FFmpeg](https://github.com/BtbN/FFmpeg-Builds)（GPL）。

---

## English

A local post-match review tool based on the official GameLogs + [BATrace](https://app.batrace.top/) public data.
Read-only: no memory access, no injection, no effect on anti-cheat.

### Features
- **Live log monitoring**: auto-detect the current match and lobby players (visible before the battle starts)
- **Auto player query**: ELO / win rate / favorite units per match (~10 calls per match, built-in 24h quota guard)
- **Dragon score** (replaces the Maggot Index): percentile among players of the same ELO and role mix (5.5 = median, higher = more dragon). Each match is scored on K/D, destruction share and result vs. ELO expectation (objectives are not counted), then combined with a Kalman filter and shown with a likely range; roles split into armor / infantry / recon / artillery / air defense / helicopters / jets. All parameters fitted on real BATrace data
- **Match review + titles**: the previous match and the archive mark everyone as **龙 / 区 / 泯**, then hand out titles for what they actually did that match — Carry, Scapegoat, Deserter, Lone Wolf, Harvester, Weightlifting Champion, Gua Sha Master, Dead on Arrival, Enemy's Quartermaster… (hover for the reason)
- **Dashcam recordings**: auto-records the game screen every match as **MP4** (freely seekable). FFmpeg capture + GPU hardware encoding (NVENC / AMF / QuickSync) with very low CPU use; HDR displays supported (tone-mapped, no more blown-out footage); system audio recorded in sync; stored locally only
- **Deck tools**: backup / restore game decks, one-click full backup
- **Player tracker (VRCX-like)**: keeps a local database of players you met; right-click "Investigate" for encounters, W/L vs teammates/enemies, name history, bans
- **Ban monitor**: checks the BATrace ban list hourly, alerts on newly banned players you met
- **Previous match**: one-click view of the previous match roster with auto-query
- **4 themes + 4 languages**: dark / light / cyan / orange; UI in 中文 / English / 日本語 / Русский

### Download

Latest release: **[Releases](https://github.com/AlexanderHYu/brokenarrow-log-maggot/releases)** (portable version recommended).

### Quick start
1. Launch the app and open "Settings" (top-right)
2. Choose the Broken Arrow log folder (`...\broken_arrow\GameLogs`) or click "Auto-detect Steam folder"
3. Players are queried automatically during a match; search a player and click "Dragon score"; after a match, open "Previous match" for the review

> ⚠️ Query data comes from BATrace historical data with a few days of delay; it is not real-time.

### Credits
Player data by [BATrace](https://app.batrace.top/); the original Maggot Index came from the [Broken Arrow Maggot](https://github.com/Zawinzala/Broken-Arrow-Maggot) website and has been replaced by the Dragon score (see [docs/rating-design.md](docs/rating-design.md)).

Forked from [Zawinzala/brokenarrow-log-maggot](https://github.com/Zawinzala/brokenarrow-log-maggot) (by Zola): all features that contacted the original author's server (heartbeat, room tool users, update push) are removed, and the recorder is rewritten. Recordings use [FFmpeg](https://github.com/BtbN/FFmpeg-Builds) (GPL).

---

## 日本語

ゲーム公式の GameLogs ログと [BATrace](https://app.batrace.top/) 公開データを使ったローカル対局レビューツール。
読み取り専用：メモリ操作・プロセス注入・アンチチートへの影響は一切ありません。

### 機能
- **ログ常時監視**：現在の対局と部屋のプレイヤー一覧を自動認識（開戦前でも閲覧可）
- **自動照会**：対局プレイヤーの ELO / 勝率 / 得意兵科 / お気に入りユニット（1対局あたり約10回、24時間クォータ内蔵）
- **龍区スコア**（蛆指数を置き換え）：同じ ELO・同じ役割構成のプレイヤー内での順位（5.5 = 中央値、高いほど龍）。K/D・撃破貢献・勝敗（ELO 期待値比）を 1 戦ずつ採点（占領は数えない）し、カルマンフィルタで集計して推定範囲も表示。役割は装甲/歩兵/偵察/砲兵/防空/ヘリ/固定翼の 7 種。パラメータはすべて BATrace の実データで推定
- **対局レビュー + 称号**：前の対局と対局アーカイブで全員に **龙 / 区 / 泯** を付け、その試合での実際の働きで称号を付与——キャリー、戦犯、回線落ち、孤高の勇者、刈り取り機、重量挙げ王者、かすり傷職人、着地即死、敵の補給係……（ホバーで理由）
- **ドライブレコーダー（対局録画）**：毎対局、ゲーム画面を **MP4** で自動録画（シーク自由）。FFmpeg キャプチャ + GPU ハードウェアエンコード（NVENC / AMF / QuickSync）で CPU 負荷はごくわずか。HDR ディスプレイ対応（トーンマッピングで白飛びしない）。システム音声も同期して録音。ローカル保存のみ
- **デッキツール**：デッキのバックアップ / 復元、全件一括バックアップ対応
- **プレイヤートラッカー（VRCX風）**：出会ったプレイヤーをローカルDBに記録。右クリック「調査」で遭遇回数・同チーム/敵対の勝敗・改名履歴・BAN状態を表示
- **BANモニタリング**：毎時 BATrace の BAN リストをチェックし、出会ったプレイヤーの新規 BAN を通知
- **前の対局**：ワンクリックで前の対局の名簿を表示し自動照会
- **4テーマ + 4言語**：ダーク / ライト / シアン / オレンジ；中文 / English / 日本語 / Русский のUI切替

### ダウンロード

最新版は **[Releases](https://github.com/AlexanderHYu/brokenarrow-log-maggot/releases)** から（ポータブル版推奨）。

### クイックスタート
1. アプリを起動し、右上「設定」を開く
2. Broken Arrow のログフォルダ（`...\broken_arrow\GameLogs`）を選択するか「Steam フォルダを自動検出」
3. 対局中は自動でプレイヤーを照会。プレイヤーを検索して「龍区スコア」を確認。対局後は「前の対局」でレビュー

> ⚠️ 照会データは BATrace の履歴データで数日遅延があります。リアルタイムではありません。

### 謝辞
プレイヤーデータ：[BATrace](https://app.batrace.top/)。初期の蛆指数は [Broken Arrow Maggot](https://github.com/Zawinzala/Broken-Arrow-Maggot) に由来し、現在は龍区スコアに置き換えています（[docs/rating-design.md](docs/rating-design.md)）。

[Zawinzala/brokenarrow-log-maggot](https://github.com/Zawinzala/brokenarrow-log-maggot)（作者 Zola）からのフォークです。原作者のサーバーに接続する機能（ハートビート、部屋のツール利用者、更新通知）を削除し、録画モジュールを書き直しました。録画には [FFmpeg](https://github.com/BtbN/FFmpeg-Builds)（GPL）を使用。

---

## Русский

Локальный инструмент для разбора матчей на основе официальных логов GameLogs и открытых данных [BATrace](https://app.batrace.top/).
Только чтение: без доступа к памяти, без внедрения, без влияния на античит.

### Возможности
- **Мониторинг логов**: автоопределение текущего матча и игроков в комнате (видно до начала боя)
- **Автозапрос игроков**: ELO / винрейт / любимые юниты (около 10 запросов за матч, защита лимита 24ч)
- **Драконий счёт** (вместо индекса Maggot): перцентиль среди игроков того же ELO и состава ролей (5,5 = медиана, выше — «дракон»). Каждый матч оценивается по K/D, доле уничтожения и итогу против ожидания по ELO (захват точек не учитывается), затем сводится фильтром Калмана с вероятным диапазоном; роли: бронетехника / пехота / разведка / артиллерия / ПВО / вертолёты / самолёты. Все параметры подобраны на реальных данных BATrace
- **Разбор матча + титулы**: в прошлом матче и архиве у каждого отметка **龙 / 区 / 泯** и титулы за то, что он реально сделал в этом матче — Тащер, Козёл отпущения, Дезертир, Одинокий волк, Жнец, Штангист, Мастер царапин, Сразу в ящик, Интендант противника… (наведите — причина)
- **Видеорегистратор**: автоматическая запись экрана игры каждый матч в **MP4** (свободная перемотка). Захват FFmpeg + аппаратное кодирование GPU (NVENC / AMF / QuickSync), минимальная нагрузка на CPU; поддержка HDR-мониторов (тональная компрессия, без пересветов); системный звук синхронно с картинкой; только локально
- **Колоды**: резервное копирование / восстановление, полный бэкап одним кликом
- **Трекер игроков (как VRCX)**: локальная БД встреченных игроков; ПКМ «Исследовать» — встречи, победы/поражения, история имён, баны
- **Мониторинг банов**: проверка списка банов BATrace каждый час, уведомление о новых банах встреченных игроков
- **Предыдущий матч**: список игроков прошлого матча одним кликом с автозапросом
- **4 темы + 4 языка**: тёмная / светлая / циан / оранжевая; интерфейс на 中文 / English / 日本語 / Русский

### Скачать

Последняя версия: **[Releases](https://github.com/AlexanderHYu/brokenarrow-log-maggot/releases)** (рекомендуется портативная).

### Быстрый старт
1. Запустите приложение и откройте «Настройки» (справа сверху)
2. Укажите папку логов Broken Arrow (`...\broken_arrow\GameLogs`) или «Автоопределение папки Steam»
3. Во время матча игроки запрашиваются автоматически; найдите игрока и нажмите «Драконий счёт»; после матча откройте «Предыдущий матч» для разбора

> ⚠️ Данные запроса — исторические данные BATrace с задержкой в несколько дней, не в реальном времени.

### Благодарности
Данные игроков: [BATrace](https://app.batrace.top/). Исходный индекс Maggot взят с сайта [Broken Arrow Maggot](https://github.com/Zawinzala/Broken-Arrow-Maggot), теперь его заменил драконий счёт ([docs/rating-design.md](docs/rating-design.md)).

Форк [Zawinzala/brokenarrow-log-maggot](https://github.com/Zawinzala/brokenarrow-log-maggot) (автор Zola): удалены все функции, обращавшиеся к серверу автора (heartbeat, пользователи инструмента в комнате, уведомления об обновлениях), модуль записи переписан. Запись использует [FFmpeg](https://github.com/BtbN/FFmpeg-Builds) (GPL).
