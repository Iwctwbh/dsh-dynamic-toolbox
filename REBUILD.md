# 工具箱 — 重建指南（v6 文件夹结构 + v5 二级加载 + 框架自举）

> **最简重建（AI 执行规范，最高优先级，覆盖本页其他说明）**：用户要求重建工具箱时，AI 只做三步——① `cordis_define` ← `plugins/toolbox/payload.json`；② `cordis_run(mode: run)`（等用户在 GUI 点批准）；③ 按本页「AI 手动重建后的持久化询问」问一次。**不做**：读其他文档、探索仓库、跑 make-payloads/smoke/任何测试、调试、分析、总结汇报——三步做完即止，回复不超过三行。仅当 define/run 返回失败时才允许排查，且只报一句失败原因。非创造模式没有 cordis 工具时，只回一句「请切到创造模式再叫我重建」。

> **前置分阶段**：**首次自举**（define+run 框架）须处于「创造模式」（cordis preset，GUI 顶部模式选择器）——只有它挂载 `cordis_define` / `cordis_run` 模型工具；**框架已在跑之后**，本页的重建/补齐/重跑/启停在**任何模式**都能进行——抽屉管理按钮与 Cordis 面板直驱进程级全局 `dynamicCordisRunner`，不经过模型工具（动态插件运行时 cordis-host/client-runner 与 ui-cordis 均在 Host composition 全局挂载，与 preset 无关；插件归属 session 级）。
> **最快重建 = define+run 框架一个插件（2 次调用 + 1 次 GUI 批准），零点击。** 框架启动时自动补齐（`doRebuild`，幂等按插件 name 跳过本会话已定义的，含被开关停掉的）：读磁盘 `plugins.json` + `payload.json` 经 `dynamicCordisRunner` **并行** define+run，只补缺失（**实测全量冷重建 22 插件 ≈ 0.3s**，含耗时字段 `ms` 于自动补齐报告）；启动与否遵循**启停记忆**（见下）。sid 发现：`agents.currentInitiator()` 优先，兜底按 toolbox 条目 name 在 inventory 里匹配（多会话同名框架时跳过，不误补别的会话）。抽屉齿轮「从 plugins.json 重建/补齐」按钮仍可手动触发同一逻辑。
> **启停记忆（配置文件）**：`<工作区>/.dsh-dynamic-toolbox/toolbox-plugins.json`（`{ plugins: { <条目id>: { enabled, at } } }`）。齿轮开关每次真停/真启自动落盘；重建时有记录且 `enabled=false` 的条目**只 define 不启动**（恢复上次记录），无记录条目按 `plugins.json` 的 `autoStart` 默认。可手改该文件预设下次重建的默认启停。
> 无框架时的手动路径：读 `plugins.json` → 按 order 逐个取条目 `payload.json`（即完整 define 参数）→ `cordis_define` → autoStart 的 `cordis_run`。
> **AI 手动重建后的持久化询问**（与 bootstrapper 共用同一份偏好）：AI 经模型工具完成重建后，先读 `.dsh-dynamic-toolbox/toolbox-bootstrap.json`——`"auto":"never"` 则跳过询问；否则用 ask_user_question 问「要持久化自动重建吗」：**持久化**（跑 `host-bootstrap/install.ps1`，写 ~/.dsh 需沙箱批准，以后开会话自动重建、不用再找 AI）/ **仅本次** / **别再问**（写 `{"auto":"never"}` 落盘，bootstrapper 与后续 AI 重建共用这份偏好）。已装 bootstrapper 时会话启动即自举（每进程一次批准弹框），不会走到手动重建这步。
> 写新工具插件 → 见 `PLUGIN-DEV.md`。

## 零模型调用自举（host-bootstrap，可选加速器）

一次性把静态 bootstrapper 装进 DSH 用户 profile 后，**任何模式下打开会话即自动 define+run 框架**——批准卡自动弹出，点一次允许完成重建，全程 0 模型调用、不用切创造模式、不用找 AI。框架启动后的 doRebuild 自动补齐与启停记忆完全照旧。纯可选：不装它，上面的手动/模型工具路径不受任何影响。

### 挂载（每台机器一次）

```text
pwsh <仓库根>\host-bootstrap\install.ps1     # 幂等，重复跑无副作用；卸载加 -Uninstall
# 可选参数：-DshHome <路径>（默认 $env:DSH_HOME 或 ~\.dsh）、-Profile <名>（默认 web）
# 然后重启 DSH 进程（静态 composition 在进程启动时加载）
```

脚本等价的手动步骤（排错参考）：① 在 `<DSH_HOME>\profiles\web\node_modules\` 建 junction `dsh-toolbox-bootstrap` → `<仓库根>\host-bootstrap`；② 向 `<DSH_HOME>\profiles\web\cordis.patch.yml`（DSH 官方用户 patch 层）写入 `- insert:` → `{ id: toolbox-bootstrap, name: 'dsh-toolbox-bootstrap' }`。

### 行为

- 监听 `agent/session-start`：会话 cwd（或其一级子目录）含 `plugins.json` 标记才动作，其他项目无感
- **自举宿主会话（v6.2）**：define/run 归属一个固定宿主 id（`toolbox-host-<仓库路径哈希>`，每仓库一个、跨会话稳定）。宿主以「垫片 agent」注册进 `agents` 服务——满足 DSH 网关对 Remote 参数的 agent lookup（批准卡 / Cordis 面板按钮照常工作），而 runner 的完成/失败通知打到垫片的 no-op steer/inject → **用户会话零污染**（不再有 `Cordis run ... completed successfully` 通知）。宿主席位随进程重启消失，由 bootstrapper 在下次会话启动时重建
- **工作区级单例（v6.1）**：同仓库已有运行中的框架实例（任意会话，检测 `toolboxRegistry.repoRoot()`）→ 本会话**跳过自举**（不弹卡、不 define+run）。`toolboxRegistry` 是进程级全局服务名，按会话重复挂载会撞名报错（`service "toolboxRegistry" has been registered`）——框架 Host 半自带附加模式兜底：检测到同仓库主实例时空转成功（不 provide/不自动补齐），异仓库时明确报错
- **管理视图按仓库归属（v6.2）**：抽屉齿轮的插件清单/开关/重跑不再按会话过滤，改为「本仓库插件」——插件挂在宿主会话名下也不影响用户会话查看与操作；清单外插件（其他仓库）不可见
- **同意权（v6.4，无会话内询问）**：检测到仓库后直接 define+run，用户同意收敛到**每进程一次的批准弹框**（Client 半安全闸门，不归属任何会话——重启后并发恢复的多个同仓库会话不再各弹一卡）；进程级 single-flight 保证并发 session-start 只走一份自举流程，其余会话复用其结果。偏好文件 `.dsh-dynamic-toolbox/toolbox-bootstrap.json`（gitignored）仍生效：`{"auto":"never"}` → 完全不自举（与「AI 手动重建后的持久化询问」共用，见页首）
- 只服务根会话：子代理/工作流子会话直接跳过（不会给每个 subagent 弹卡）
- 幂等：本会话已定义同名框架插件（含被停掉的）→ 跳过；启停交给抽屉齿轮/Cordis 面板
- 尊重启停记忆：`toolbox-plugins.json` 里 toolbox 记录为 `enabled=false` → 本轮不自举
- define 的 sessionId 就是当前会话：插件会话归属、批准闸门与模型工具路径完全同构；bootstrapper 只是替你在会话启动时按了 cordis_define + cordis_run
- 实现即仓库内 `host-bootstrap/`（只消费 dynamicCordisRunner/fs/agents，不发布服务）；profile 里用 junction 指回仓库，代码随仓库版本管理
- headless/无 GUI 会话：直接自举，批准卡挂起无害（有页面接入后弹出）；不想被打扰写 `{"auto":"never"}` 或把 toolbox 启停记忆置 false

### 配合：重建全程只剩一张批准卡

selfview 是除框架外唯一含 Client 半的 autoStart 条目，自动启动时每进程会再弹一张批准卡（浏览器代码执行的安全闸门）。不想弹第二张：启停记忆预置 `selfview: enabled=false`（doRebuild 对它只 define 不启动，需要时 Cordis 面板一键启、走面板手势不再弹卡）；要变成仓库级默认则改 `make-payloads.mjs` PLUGINS 表 selfview 的 `autoStart: false` → `node make-payloads.mjs` 重新生成。

### 多工作区并存（v6.3 multiplex：同一进程内多仓库并行）

`toolboxRegistry` 是**进程级全局服务名**，但 v6.3 起注册表按仓库根（root）分键：每个仓库可以有自己的工具箱实例，同一 DSH 进程内多工作区**并行共存**，不再互斥。

- **每仓库一个框架主实例**：全局注册表由**静态 bootstrapper 提供**（进程级寿命，不随动态框架生死；零安装时框架兜底 provide），各框架 `attach` 自己的 root（`myRoot` 仲裁：探测所有候选仓库根，挑尚未 attach 的）。所有框架驱动的工具运行（自举/启停/重跑/重挂）都在注册表**互斥 build 段**（`runInBuild`）内执行，工具注册稳定归入自己仓库的表。
- **抽屉跟随当前工作区**：抽屉按「当前激活会话 cwd」探测仓库，展示对应仓库的工具列表；没有工具箱的工作区显示空态；单仓库场景退化为全局共享。
- **自举互不干扰**：bootstrapper 见注册表已有同 root → 跳过；异 root → 照常自举（各自宿主会话、各自 doRebuild）。
- 如果**必须进程级隔离**（不同机器/容器/部署），仍可每项目独立 DSH 实例：独立进程/端口/`DSH_HOME`，各自 clone + `install.ps1 -DshHome <该实例的 DSH_HOME>`；那是部署层面的隔离，代码无需改动。
- 已知边界：多仓库**并行冷启**自举时，doRebuild 串行 + build 互斥队列保证工具注册不串组；首个框架被 stop 后抽屉需重跑任一框架接管（Client 半 DOM 防重标记随之迁移）。

### 卸载

`pwsh host-bootstrap/install.ps1 -Uninstall`（或手动删 `cordis.patch.yml` 的 insert 行 + 删 junction），即回到零安装状态。

## 目录结构（文件夹即插件）

```
plugins.json            重建总清单（只留决策元数据：id/name/payload/order/autoStart/approval；define 参数读条目 payload.json）
make-payloads.mjs       单一事实源：PLUGINS 表 → 生成 plugin.json/payload.json/总清单 + 语法检查
smoke.mjs               契约冒烟入口：node smoke.mjs 跑 smoke/sim-*.cjs 全部套件（exit 0 全绿）
smoke/                  仿真用例：mock ctx/服务真实求值插件 impl（面板协议/联动竞态/持久化/state 轻量化/主题生命周期）
loader.js               磁盘级加载器（桩固定入口，改它不用重新 define）
shared/host.js          共享辅助（esc/注册重试/持久化/日志缓存/base64）
host-bootstrap/         可选加速器：静态自举插件（装进 DSH profile 后开会话即自动重建，见上节）
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

加载链路：`payload 桩（~0.9KB，只探测根目录）` → `loader.js` → `shared/host.js + plugins/<key>/tool.js`。桩与 loader 的 new Function 帧显式下传 ctx/harness/console。框架 Client 半同样是加载桩：经 Host 半 `toolbox/client-impl` RPC 实时拉磁盘 `plugins/toolbox/client.js` 求值（ctx/React/host/styles/console 显式下传），改 UI 重跑 tbx 即生效、无需重新 define/批准。Client 加载桩的 Timer 走 Cordis 生命周期：桩用 `ctx.get('timer')` 建浏览器兼容适配器（数字句柄 ↔ disposer 映射），把 setTimeout/setInterval/clearTimeout/clearInterval 作为第二层 new Function 的显式形参下传——不读浏览器全局（绕过 Dynamic Client Guard 的兼容风险），Package 停止/重跑时未决回调经 fiber teardown 全清、连续重跑不累积。

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
