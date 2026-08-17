# dsh-dynamic-toolbox

> A session toolbox for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness): 1 framework + 21 tool plugins as dynamic Cordis plugins · MIT License
>
> 中文文档见下方 [中文 section](#中文文档)。

![工具箱抽屉 · 实时流程 Tab](docs/screenshot.png)

Every plugin is mounted through a **disk-loading stub**: the payload is a ~0.9KB stub, the implementation lives on disk, so code edits take effect by simply re-running the plugin — no re-define, no re-approval.

## Features

- **Framework plugin (tbx)**: Host-side tool registry + RPC, Client-side drawer / tab bar / shared HTML panel shell (tb- design system)
- **Live flow (流程)**: the drawer's default tab — real-time session flowgraph with subagent branches, parallel-call groups and drill-down (see spotlight below)
- **Project tools**: Jira (query/archive), Git (history/diff), workspace file tree
- **Utilities**: trace, HTTP client, ports, calc 5-in-1 (codec / regex / cron / text diff / generator), quota (API usage across providers), flowedit (workflow docs)
- **Session insight**: token usage, system-prompt assembly, context window, tool list, full-text search, lineage tree
- **AI tools**: aiassist 7-in-1 (ask / translate / prompt-optimize / review / commit message / summary / compare) + usage ledger — all routed through a shared `makeLlmHelper`
- **Self-inspection**: selfview (screenshot / semantic snapshot / ui_* model tools)
- **Bootstrap rebuild**: the framework auto-defines and starts all missing plugins from `plugins.json` on startup (idempotent, ~0.3s for all 22), honoring per-plugin enable memory
- **Zero-model-call autoboot** (optional): `host-bootstrap/` auto-starts the framework on session open — 0 model calls, 1 approval click, any mode
- **Contract smoke tests**: `node smoke.mjs` runs 14 simulation suites against real plugin impls with mocked ctx/services

## Why dynamic (framework advantages)

- **Session-owned, not process-global** — each session gets its own plugin set; stop or break one without touching the others (a static plugin is one process-wide instance)
- **Hot reload** — the implementation lives on disk behind a ~0.9KB stub: re-run to apply edits, no re-define, no re-approval, no process restart
- **Approval gate kept** — browser code still asks once per process; nothing becomes unconditionally trusted at install time
- **Immutable versions** — packages coexist; update flips a pointer, rollback is one call, a failed update never loses the working version
- **Self-bootstrap rebuild** — dynamic plugins don't survive restarts, so the framework re-defines everything missing from `plugins.json` in ~0.3s; the optional `host-bootstrap/` trigger reduces that to "open a session, one click"
- **AI-native** — `cordis_define` / `cordis_run` are model tools: an agent can build and mount a tool for itself at runtime

## Develop your own tool

Coupling is deliberately narrow: a tool plugin only needs `ctx.get('toolboxRegistry').register(desc, handler)` plus the HTML panel protocol — three steps, a ~15-line skeleton, no client code for Host-only tools. Full guide: [`PLUGIN-DEV.md`](PLUGIN-DEV.md).

## Spotlight: Live Flow (流程)

The drawer's default tab turns the **current session into a living flowgraph**, silently auto-refreshing every 2s (pausable via the live toggle):

- **Three-lane layout** — the center trunk walks user/assistant steps top-down; each tool call branches right with its input card ▶ and returns left with its output card ◀ (green on success, red on error, dashed while in flight)
- **Subagent branches** — a spawned child session grows its own left-column branch (entry / steps / exit) on the same row as the trunk card that started it, with steps sampled from the child's own session log
- **Drill-down** — click 「进入 →」on a subagent branch to open that child session's own flowgraph; breadcrumbs walk back level by level, nesting unlimited
- **Parallel groups** — simultaneous tool calls in one step are wrapped in a dashed 「并行 ×N」 frame; the running call pulses with a highlight so you always see exactly which step the agent is on
- **Zero-jump details** — click a tool card for its full arguments/result, click a message card for full content with model + token metadata; details open in a side overlay instead of inflating the flow, so expand/collapse never moves your scroll position

## Quick start (as a user)

Prerequisites: DeepSeek Harness running with dynamic-plugin (Cordis) support; a workspace directory (repo root = workspace root, or the repo cloned as a subdirectory of it).

**Path A · autoboot (your own machine, install once — recommended)**

```text
1. pwsh host-bootstrap/install.ps1     # idempotent; uninstall with -Uninstall
2. Restart DSH
3. Open any session in any mode → first-time ask card → approve once
   → the framework auto-bootstraps all 22 plugins (selfview asks for one more approval)
```

**Path B · zero-install (AI-driven, nothing persisted in DSH)**

```text
1. Switch the session to 「创造模式」(Creative mode — the only preset mounting cordis_define/cordis_run)
2. In the session: cordis_define ← plugins/toolbox/payload.json
3. cordis_run and approve once → the framework auto-bootstraps the rest
```

Either way: daily rebuild/rerun/toggle afterwards works in **any mode** — the drawer manage view and the Cordis panel drive the process-global runner directly. Credentials (e.g. Jira) live in the Harness credential store or environment variables — never in this repo. Full guide: [`REBUILD.md`](REBUILD.md), plugin authoring: [`PLUGIN-DEV.md`](PLUGIN-DEV.md).

## License

[MIT](LICENSE) © 2026 Iwctwbh

---

# 中文文档

> DSH 工具箱（动态 Cordis 插件集）· MIT License

> 运行在 DeepSeek Harness 上的会话级工具箱：1 个框架插件 + 21 个工具插件，
> 全部以「磁盘加载桩」方式挂载——payload 是 ~0.9KB 的桩，实现全在磁盘，改代码重跑即生效。

## 使用（把本仓库装进你的 DSH）

前置：已安装并运行 DeepSeek Harness（支持动态 Cordis 插件）；仓库根作为工作区打开（或 clone 为工作区的一级子目录）。

**方式 A · 自动自举（自己的机器，装一次——推荐）**

```text
1. pwsh host-bootstrap/install.ps1     # 幂等；卸载加 -Uninstall
2. 重启 DSH
3. 任何模式开新会话 → 首次弹「工具箱自举」询问卡（记住/仅本次/别再问）→ 批准卡点允许
   → 框架自动补齐全部 22 个插件（selfview 会再弹一张批准卡）
```

**方式 B · 零安装（AI 驱动，DSH 里不留任何东西）**

```text
1. 会话切到「创造模式」（唯一挂载 cordis_define/cordis_run 的 preset）
2. 会话中：cordis_define  ←  plugins/toolbox/payload.json
3. cordis_run，批准一次 → 框架自动补齐其余插件
```

两条路互不冲突、随时互切：bootstrapper 幂等跳过已定义，框架 doRebuild 幂等补齐缺失。跑起来之后，日常补齐/重跑/启停在**任何模式**都能进行——抽屉管理视图与 Cordis 面板直驱进程级全局 runner，不经过模型工具。

- 启动集合遵循启停记忆 `<工作区>/.dsh-dynamic-toolbox/toolbox-plugins.json`
- 主题插件（青绿/暖橙）只 define 不启动，互斥按需激活
- 凭据（Jira 等）走 Harness 凭据存储或环境变量，**不写入本仓库任何文件**
- 手动逐条路径、启停记忆、headless 注意事项等完整细节见 [`REBUILD.md`](REBUILD.md)

## 框架优势（为什么全动态）

- **会话级归属**：每个会话独立一份插件集，改砸/停掉互不影响（静态插件是进程全局单份）
- **桩热重载**：实现全在磁盘、payload 仅 ~0.9KB 桩；点「重跑」即生效，不重启进程、不重新批准
- **批准闸门保留**：浏览器代码每进程仍过一次手，不存在"安装即永久信任"
- **不可变多版本**：Package 并存，update 切指针、失败不丢旧版、回滚一条命令
- **自举重建**：动态插件不跨进程——框架启动自动补齐缺失（~0.3s）；配 host-bootstrap 则开会话即重建
- **AI 原生**：`cordis_define` / `cordis_run` 是模型工具，智能体能在运行时自己造工具装上用

## 扩展：开发自己的工具插件

耦合面只有两条——`ctx.get('toolboxRegistry').register(desc, handler)` 和 HTML 面板协议。新插件三步：建 `plugins/<key>/tool.js` → `make-payloads.mjs` 的 PLUGINS 表加一行 → `node make-payloads.mjs` 后 define+run；骨架约 15 行，Host-only 不用写 Client 代码。完整指南（面板契约/踩坑/主题/冒烟）：[`PLUGIN-DEV.md`](PLUGIN-DEV.md)。

## 插件清单（22）

| 分组 | 插件 |
| --- | --- |
| 框架 | toolbox（Host 注册表 + Client 抽屉/Tab/面板壳） |
| 项目工具 | jira（查询/归档）、git（历史/diff）、files（文件树） |
| 主题 | theme-teal / theme-amber（互斥，按需激活） |
| 实用工具 | trace、http、ports、calc 5 合一（编解码/正则/Cron/文本对比/生成器）、quota（API 配额）、flowedit（工作流文档） |
| 会话洞察 | flow（实时流程图）、usage、prompt、context、tools、search、lineage |
| AI 工具 | aiassist 7 合一（问答/翻译/优化/评审/提交信息/摘要/对比）、aiusage（台账） |
| 界面自查 | selfview（截屏/语义快照/ui_* 模型工具） |

## 亮点：实时流程（流程 Tab）

抽屉默认 Tab，把**当前会话实时画成流程图**，每 2s 静默自刷（live 开关可暂停）：

- **三列泳道**：中列主干自上而下走「用户/助手」步骤；工具调用右出输入卡 ▶、左回输出卡 ◀（成功绿色、错误红色、进行中虚线）
- **子代理分支**：子会话在左列长出独立支线（入口/支线/出口），与触发它的主干卡同行不留空白，支线步骤取自子会话自己的日志
- **钻取**：点分支上的「进入 →」打开该子会话自己的流程图，「← 返回」逐级退回，嵌套不限层数
- **并行分组**：同一步的多个并行调用用虚线框 +「并行 ×N」角标圈成一组；进行中的调用高亮脉冲，一眼看到智能体正跑到哪一步
- **零跳跃详情**：点工具卡看完整传入/返回，点消息卡看完整内容（含模型/tokens 元信息）；详情挂右侧浮层、不撑高流程内容，展开收起滚动位置不动

## 日常迭代

```text
改 plugins/<key>/tool.js（或 framework、shared、loader）
  → 抽屉齿轮「重跑」该行即生效（不用重新 define/批准）
  → 批量改完点「全部重跑」
插件增减/改 inject → 编辑 make-payloads.mjs 的 PLUGINS 表
  → node make-payloads.mjs 重新生成 + 语法检查
改 shared/framework/面板协议 → 必跑 node smoke.mjs
```

## 数据与隐私约定

以下内容**不入库**（见 `.gitignore`）：

| 路径 | 内容 |
| --- | --- |
| `.dsh-dynamic-toolbox/` | 运行状态与历史：Jira 查询记录、AI 台账、启停记忆、自举偏好、自动补齐报告 |
| `.dsh-dynamic-toolbox/data/` | 内容产物：Jira 工单归档（issue.md/json + 附件） |
| `.scratch/` | 开发草稿/一次性脚本 |

## 文档索引

- [`REBUILD.md`](REBUILD.md) — 目录结构、重建（含零模型调用自举）、迭代、数据与凭据
- [`PLUGIN-DEV.md`](PLUGIN-DEV.md) — 新插件三步、impl 骨架、面板契约
- [`插件.md`](插件.md) — 心智模型与真实坑清单

## License

[MIT](LICENSE) © 2026 Iwctwbh
