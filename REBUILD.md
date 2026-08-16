# 工具箱 — 重建指南（v6 文件夹结构 + v5 二级加载 + 框架自举）

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
  toolbox/                框架：host.js（注册表+RPC+启停记忆+并行自举）+ client.js（抽屉壳+tb- 设计系统）
  theme-teal/             主题：client.js（payload 由它内联生成）
  theme-amber/            主题：client.js（暖橙；与青绿互斥按需激活）
  jira/ git/ files/ trace/ http/ ports/ regex/ codec/
  usage/ prompt/ context/ ask/ tools/ search/ lineage/ compare/   各含 tool.js
  translate/ promptopt/ commitmsg/ review/ aisummary/             AI 工具（各含 tool.js，共享 makeLlmHelper）
  aiusage/                        AI 旁路调用台账（tool.js，读 makeLlmHelper 落的 toolbox-ai-usage.json）
  txtdiff/                        文本对比（tool.js，纯 JS 行级 LCS diff，统一视图 + 相同段折叠）
  cron/                           Cron 表达式（tool.js，5 段解析 + 未来运行时刻 + 预设；日/周 OR 语义）
  gen/                            生成器（tool.js，UUID v4/随机串/哈希，node 子进程真 crypto）
  selfview/                       界面自查：tool.js（Tab + pull 命令队列 + ui_* 模型工具）+ client.js（getDisplayMedia 截屏/语义快照/DOM 操作/面板按钮条/粘贴进聊天框）
```

AI 工具 Tab 顺序 16-20：翻译 / 提示优化 / 提交信息 / 评审 / 摘要；均 Host-only 免批准、消耗真实 API 额度、记录落盘 `.dsh-dynamic-toolbox/toolbox-<key>.json`。台账查看 = Tab 21「AI 用量」（读 `.dsh-dynamic-toolbox/toolbox-ai-usage.json`，总计/按工具聚合/明细/两步清空）。

加载链路：`payload 桩（~0.9KB，只探测根目录）` → `loader.js` → `shared/host.js + plugins/<key>/tool.js`。桩与 loader 的 new Function 帧显式下传 ctx/harness/console。框架 Client 半同样是加载桩：经 Host 半 `toolbox/client-impl` RPC 实时拉磁盘 `plugins/toolbox/client.js` 求值（ctx/React/host/styles/console 显式下传），改 UI 重跑 tbx 即生效、无需重新 define/批准。

## 重建（define + run，按 `plugins.json` 清单）

| 顺序 | 插件 | 平台 | 批准 | 自动启用 |
| --- | --- | --- | --- | --- |
| 1 | toolbox | Host+Client | ✅ WebUI 批一次 | 是 |
| 2-4 | jira / git / files | Host-only | 免批 | 是 |
| 5、27 | theme-teal / theme-amber | Client-only | ✅ 批一次 | **否**（按需手动激活，互斥） |
| 6-18 | trace / http / ports / regex / codec / usage / prompt / context / ask / tools / search / lineage / compare | Host-only | 免批 | 是 |
| 19-23 | translate / promptopt / commitmsg / review / aisummary | Host-only | 免批 | 是 |
| 24 | aiusage | Host-only | 免批 | 是 |
| 25 | txtdiff | Host-only | 免批 | 是 |
| 26 | cron | Host-only | 免批 | 是 |
| 28 | gen | Host-only | 免批 | 是 |
| 29 | selfview（界面自查） | Host+Client | ✅ 批一次 | **自动发起**（autoStart 条目重建时 runner.run 非阻塞发起 → 批准卡自动弹出，点一次允许即启动；授权不跨进程，Client 半插件每进程至少批一次是安全闸门） |

最终启动集合 = 上表默认 **∩** `.dsh-dynamic-toolbox/toolbox-plugins.json` 启停记忆（记录为关的不启动）。

顺序不敏感：工具注册带 500ms 重试，框架后启动也会自动挂上。

## 改代码（日常迭代）

编辑 `plugins/<key>/tool.js`（或 framework 的 host/client、shared/host.js、loader.js）→ 抽屉齿轮管理视图点该行的「**重跑**」按钮即生效（桩重读磁盘；也可 `cordis_run(mode: run)` 重跑对应插件），**不用重新 define、不用重新批准**。批量改完点「**全部重跑**」一键重启所有运行中的 Host-only 插件（停着的不动；含 Client 半的仍需 Cordis 面板）。重跑类操作后客户端会等注册表 500ms 重试落定再自动刷新工具列表与当前面板（不再把 active Tab 挤走）。改完先 `node make-payloads.mjs` 语法检查，再 `node smoke.mjs` 跑契约冒烟（改动 shared/host.js / framework / 面板协议时必跑）。

## 元数据变化

插件增减/改 inject/改文件名 → 编辑 `make-payloads.mjs` 的 PLUGINS 表 → `node make-payloads.mjs` 重新生成全部 `plugin.json` / `payload.json` / `plugins.json` → 新插件 cordis_define + run，已有插件不用动。

## 数据与凭据

- 数据（重建不丢，均在 `<工作区>/.dsh-dynamic-toolbox/`）：`jira-watch.json`（Jira 查询记录）、`toolbox-http.json`（HTTP 历史）、`toolbox-ask.json`（问答历史）、`toolbox-compare.json`（对比记录）、`toolbox-translate.json` / `toolbox-promptopt.json` / `toolbox-commitmsg.json` / `toolbox-review.json` / `toolbox-aisummary.json`（AI 工具记录）、`toolbox-plugins.json`（**启停记忆配置**：重建时默认恢复上次开关状态）
- 内容产物（重建不丢，`<工作区>/.dsh-dynamic-toolbox/data/<插件key>/`，共享约定 `pluginDataDir(key)`）：`jira/<KEY>/`（Jira 归档：issue.md + issue.json + 附件；查询即自动归档、点记录零 API 读本地）——与 .dsh-dynamic-toolbox 的内部 JSON 状态分家，.gitignore 只需一行 `.dsh-dynamic-toolbox/data/`
- 自动补齐报告：框架每次启动自调一次 doRebuild，分阶段结果落盘 `<工作区>/.dsh-dynamic-toolbox/toolbox-autorebuild.json`（subprocess 直写，绕过 fs 沙箱策略；文件停在哪一阶段，问题就在哪阶段之后）
- 插件启停：抽屉右上角齿轮进管理视图，开关直连 `dynamicCordisRunner` 服务真停/真启（与 Cordis 面板同一注册表、状态同步；含 Client 半的插件仍需到 Cordis 面板操作）
- 约定：含记录/历史的工具必须落盘工作区（共享助手 `readJsonStore`/`writeJsonStore` 见 `shared/host.js`），面板 state 只是镜像；持久化失败要在面板出警告，不许静默
- Jira 凭据四选一（推荐第一种）：**Jira 面板「凭据设置」直接填写**（写入 Harness 凭据存储，与设置里的 API Key 同机制同存储，describe 只显状态不泄密，立即生效）；环境变量 `JIRA_BASE_URL`/`JIRA_EMAIL`/`JIRA_TOKEN`；`~/.dsh/.credentials.yaml`；项目 `.env`
