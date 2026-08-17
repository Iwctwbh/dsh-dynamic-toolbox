# 工具箱 — 重建指南（v6 文件夹结构 + v5 二级加载 + 框架自举）

> **前置分阶段**：**首次自举**（define+run 框架）须处于「创造模式」（cordis preset，GUI 顶部模式选择器）——只有它挂载 `cordis_define` / `cordis_run` 模型工具；**框架已在跑之后**，本页的重建/补齐/重跑/启停在**任何模式**都能进行——抽屉管理按钮与 Cordis 面板直驱进程级全局 `dynamicCordisRunner`，不经过模型工具（动态插件运行时 cordis-host/client-runner 与 ui-cordis 均在 Host composition 全局挂载，与 preset 无关；插件归属 session 级）。
> **最快重建 = define+run 框架一个插件（2 次调用 + 1 次 GUI 批准），零点击。** 框架启动时自动补齐（`doRebuild`，幂等按插件 name 跳过本会话已定义的，含被开关停掉的）：读磁盘 `plugins.json` + `payload.json` 经 `dynamicCordisRunner` **并行** define+run，只补缺失（**实测全量冷重建 22 插件 ≈ 0.3s**，含耗时字段 `ms` 于自动补齐报告）；启动与否遵循**启停记忆**（见下）。sid 发现：`agents.currentInitiator()` 优先，兜底按 toolbox 条目 name 在 inventory 里匹配（多会话同名框架时跳过，不误补别的会话）。抽屉齿轮「从 plugins.json 重建/补齐」按钮仍可手动触发同一逻辑。
> **启停记忆（配置文件）**：`<工作区>/.dsh-dynamic-toolbox/toolbox-plugins.json`（`{ plugins: { <条目id>: { enabled, at } } }`）。齿轮开关每次真停/真启自动落盘；重建时有记录且 `enabled=false` 的条目**只 define 不启动**（恢复上次记录），无记录条目按 `plugins.json` 的 `autoStart` 默认。可手改该文件预设下次重建的默认启停。
> 无框架时的手动路径：读 `plugins.json` → 按 order 逐个取条目 `payload.json`（即完整 define 参数）→ `cordis_define` → autoStart 的 `cordis_run`。
> 写新工具插件 → 见 `PLUGIN-DEV.md`。

## 目录结构（文件夹即插件）

```
plugins.json            重建总清单（只留决策元数据：id/name/payload/order/autoStart/approval；define 参数读条目 payload.json）
make-payloads.mjs       单一事实源：PLUGINS 表 → 生成 plugin.json/payload.json/总清单 + 语法检查
smoke.mjs               契约冒烟入口：node smoke.mjs 跑 smoke/sim-*.cjs 全部套件（exit 0 全绿）
smoke/                  仿真用例：mock ctx/服务真实求值插件 impl（面板协议/联动竞态/持久化/state 轻量化/主题生命周期）
loader.js               磁盘级加载器（桩固定入口，改它不用重新 define）
shared/host.js          共享辅助（esc/注册重试/持久化/日志缓存/base64）
plugins/<key>/          每插件一个文件夹：plugin.json（元数据）+ payload.json（生成）+ impl
  toolbox/                框架：host.js（注册表+RPC+启停记忆+并行自举+重启确定性重挂）+ client.js（抽屉壳+tb- 设计系统+面板自动刷新）
  theme-teal/             主题：client.js（payload 由它内联生成）
  theme-amber/            主题：client.js（暖橙；与青绿互斥按需激活）
  aiassist/               AI 助手 7 合一（tool.js，PRESETS 表：问答/翻译/优化/评审/提交信息/摘要/对比，共享 makeLlmHelper）
  calc/                   计算台 5 合一（tool.js，子模式：编解码/正则/Cron/文本对比/生成器）
  flow/                   实时流程图（tool.js，主干箭头 + 子代理 git 树分支 + 平行调用右分支；data-autorefresh 驱动 2s 静默轮询）
  quota/                  API 配额查询（tool.js，Kimi for Coding 余量：周额度/滑动窗口/并发；Node 子进程 https）
  jira/ git/ files/ trace/ http/ ports/                     各含 tool.js
  usage/ prompt/ context/ tools/ search/ lineage/           会话透视类，各含 tool.js
  aiusage/                        AI 旁路调用台账（tool.js，读 makeLlmHelper 落的 toolbox-ai-usage.json）
  selfview/                       界面自查：tool.js（Tab + pull 命令队列 + ui_* 模型工具）+ client.js（getDisplayMedia 截屏/语义快照/DOM 操作/面板按钮条/粘贴进聊天框）
```

AI 助手（Tab「AI 助手」）：preset 芯片切换 问答/翻译/优化/评审/提交信息/摘要/对比，全部经共享 makeLlmHelper 路由（provider/model 下拉）；历史按 preset 沿用原 `toolbox-{ask,translate,promptopt,review,commitmsg,aisummary,compare}.json` 落盘文件与台账 tool 键（历史与用量无缝连续）；大本体（git diff/日志采样/对比结果）留闭包不进 state。台账查看 = Tab「AI 用量」（读 `.dsh-dynamic-toolbox/toolbox-ai-usage.json`，总计/按工具聚合/明细/两步清空）。

计算台（Tab「计算」）：子模式芯片切换 编解码/正则/Cron/文本对比/生成器；各子模式状态独立命名空间（`st.codec/regex/cron/txtdiff/gen`）；派生大结果（cron 字段 Set、diff 行、生成列表）留闭包不进 state。

加载链路：`payload 桩（~0.9KB，只探测根目录）` → `loader.js` → `shared/host.js + plugins/<key>/tool.js`。桩与 loader 的 new Function 帧显式下传 ctx/harness/console。框架 Client 半同样是加载桩：经 Host 半 `toolbox/client-impl` RPC 实时拉磁盘 `plugins/toolbox/client.js` 求值（ctx/React/host/styles/console 显式下传），改 UI 重跑 tbx 即生效、无需重新 define/批准。

## 重建（define + run，按 `plugins.json` 清单）

| 顺序 | 插件 | 平台 | 批准 | 自动启用 |
| --- | --- | --- | --- | --- |
| 1 | toolbox | Host+Client | ✅ WebUI 批一次 | 是 |
| 2-5 | jira / git / files / flow | Host-only | 免批 | 是 |
| 6、7 | theme-teal / theme-amber | Client-only | ✅ 批一次 | **否**（按需手动激活，互斥） |
| 8-13 | trace / http / ports / calc / usage / prompt | Host-only | 免批 | 是 |
| 14-17 | context / aiassist / tools / search | Host-only | 免批 | 是 |
| 18、24、25 | lineage / aiusage / quota | Host-only | 免批 | 是 |
| 29 | selfview（界面自查） | Host+Client | ✅ 批一次 | **自动发起**（autoStart 条目重建时 runner.run 非阻塞发起 → 批准卡自动弹出，点一次允许即启动；授权不跨进程，Client 半插件每进程至少批一次是安全闸门） |

最终启动集合 = 上表默认 **∩** `.dsh-dynamic-toolbox/toolbox-plugins.json` 启停记忆（记录为关的不启动）。

顺序不敏感：工具注册带 500ms 重试，框架后启动也会自动挂上。

## 改代码（日常迭代）

编辑 `plugins/<key>/tool.js`（或 framework 的 host/client、shared/host.js、loader.js）→ 抽屉齿轮管理视图点该行的「**重跑**」按钮即生效（桩重读磁盘；也可 `cordis_run(mode: run)` 重跑对应插件），**不用重新 define、不用重新批准**。批量改完点「**全部重跑**」一键重启所有运行中的 Host-only 插件（停着的不动；含 Client 半的仍需 Cordis 面板）。重跑类操作后客户端会等注册表 500ms 重试落定再自动刷新工具列表与当前面板（不再把 active Tab 挤走）。改完先 `node make-payloads.mjs` 语法检查，再 `node smoke.mjs` 跑契约冒烟（改动 shared/host.js / framework / 面板协议时必跑）。

## 元数据变化

插件增减/改 inject/改文件名 → 编辑 `make-payloads.mjs` 的 PLUGINS 表 → `node make-payloads.mjs` 重新生成全部 `plugin.json` / `payload.json` / `plugins.json` → 新插件 cordis_define + run，已有插件不用动。

## 数据与凭据

- **存储归属仓库根（clone 部署安全）**：所有数据/产物落「仓库根/`toolbox.config.json` 的 `dataDir`（默认 `.dsh-dynamic-toolbox`）」，**不再跟随会话 cwd**。本仓库 clone 到别的项目当子目录时，桩/findManifest/store 先直下再找一级子目录定位本仓库（`plugins.json` 为标记），数据仍落本仓库、不污染宿主项目根；多会话 cwd 不同也不再散数据。改 `dataDir` 可整体换目录名（重启工具生效）。
- 数据（重建不丢，均在 `<仓库根>/<dataDir>/`）：`jira-watch.json`（Jira 查询记录）、`toolbox-http.json`（HTTP 历史）、`toolbox-search.json`（搜索历史）、`toolbox-plugins.json`（**启停记忆配置**：重建时默认恢复上次开关状态）、各 AI preset 历史 `toolbox-{ask,translate,promptopt,review,commitmsg,aisummary,compare}.json`
- 内容产物（重建不丢，`<仓库根>/<dataDir>/data/<插件key>/`，共享约定 `pluginDataDir(key)` + `resolveDataPath`/`dataPathAbs` 解析）：`jira/<KEY>/`（Jira 归档：issue.md + issue.json + 附件；查询即自动归档、点记录零 API 读本地）、`flows/<name>.md`（工作流文档）——与内部 JSON 状态分家，.gitignore 只需一行 `<dataDir>/data/`
- 自动补齐报告：框架每次启动自调一次 doRebuild，分阶段结果落盘 `<仓库根>/<dataDir>/toolbox-autorebuild.json`（subprocess 直写，绕过 fs 沙箱策略；文件停在哪一阶段，问题就在哪阶段之后）
- 插件启停：抽屉右上角齿轮进管理视图，开关直连 `dynamicCordisRunner` 服务真停/真启（与 Cordis 面板同一注册表、状态同步；含 Client 半的插件仍需到 Cordis 面板操作）
- 约定：含记录/历史的工具必须落盘仓库根（共享助手 `readJsonStore`/`writeJsonStore`/`resolveDataPath`/`dataPathAbs` 见 `shared/host.js`——内部经 `findRepoRoot` 定位仓库、`repoDataDir` 读 `toolbox.config.json` 的 dataDir），面板 state 只是镜像；持久化失败要在面板出警告，不许静默
- Jira 凭据四选一（推荐第一种）：**Jira 面板「凭据设置」直接填写**（写入 Harness 凭据存储，与设置里的 API Key 同机制同存储，describe 只显状态不泄密，立即生效）；环境变量 `JIRA_BASE_URL`/`JIRA_EMAIL`/`JIRA_TOKEN`；`~/.dsh/.credentials.yaml`；项目 `.env`
