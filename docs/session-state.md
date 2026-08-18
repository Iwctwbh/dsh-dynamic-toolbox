# 会话状态存档

## 最新会话状态

- 时间：2026-02-14 01:10
- 当前阶段：验收
- 当前目标：按 `DYNAMIC_CORDIS_OPTIMIZATION_PLAN.md` 第 16 节清单完成 dsh-dynamic-toolbox 的 rc.7 改造
- 现状摘要：
  - 16.2（P0）**按用户实测决策调整**：footer Slot 位置太差（设置上方一行），入口**回导航区 DOM 注入**（新会话下方插件族块末尾 + MutationObserver 自愈），`sidebar.footer.action` 仅作无 DOM 环境兜底；抽屉仍挂 `shell.overlay`。与计划 16.2 原文的偏差已记录并经用户确认。
  - 16.3（P0）完成：Client 加载桩用 `ctx.get('timer')` 建浏览器 Timer 兼容适配器（数字句柄 ↔ disposer），四个 timer 函数作为第二层 `new Function` 显式形参下传；`ctx.effect` teardown 全清未决回调；toolbox/selfview 两个 payload 已重新生成。
  - 16.4（P1）完成：host-bootstrap 在 inventory 扫描前做 define/run/inventory 能力检查（缺失 → 明确版本/能力错误）；host.js 对 stopFromPanel 单独降级（`canStop` 标记经 toolbox/plugins 下发，前端禁用停止开关，启动/清单/工具/面板不受影响）。
  - 16.5（P1）完成（Host 侧）：新增真实 rc.7 组合冒烟——真实 cordis 内核 + DynamicCordisRunnerService + TimerService，走 define（vm 预检）→ run（awaiting-approval 状态机）→ runHostHalf（批准手势）→ 自动补齐全量 define+run（18 工具注册）→ invoke（Remote JSON codec：tools/plugins/panel）→ stopFromPanel teardown（handler/provide/timer 全撤）。Client 半无法在 Node 内装载（依赖 window.__ModuleLoader__ 与页面远端），以「安装产物核对」（sidebar/layout 包真实声明两个 Slot）替代，已在测试头注释如实说明。
  - 16.6（P2）按计划暂缓（current-session 权威、页面互斥标记、synthetic Agent 契约、画中画 adapter）。
  - 回归：19 个 smoke 套件全绿（原 14 + 新增 5：sim-toolbox-client / sim-client-loader-stub / sim-bootstrap-cap / sim-host-stop-degrade / sim-rc7-composition）；make-payloads 全量语法检查通过；host-bootstrap ESM 语法通过。
  - 文档同步：REBUILD.md（加载链路 Timer 说明）、插件.md（坑 9：入口回导航区 DOM 注入 + footer Slot 兜底；Client 半 timer 适配器）、docs/session-state.md（本文件）。
- 当前方案：无未验证项。
- 已做：全部实现与验收；改动清单——plugins/toolbox/client.js、plugins/toolbox/host.js、make-payloads.mjs、host-bootstrap/index.js、plugins/{toolbox,selfview,theme-teal,theme-amber}/payload.json、REBUILD.md、插件.md、smoke/ 新增 5 套件、docs/session-state.md。
- 下一步：用户侧生效操作——重跑工具箱框架（Cordis 面板，含 Client 半）使 client.js/host.js 生效；host-bootstrap 为静态插件，改动需重启 DSH 生效。
- 未解决分歧：无。
- 当前阻塞：无。（环境备注：本会话沙箱对 D:\Code\gitlab\ic\.git 的可见性间歇性失败，git 命令时灵时不灵；不影响交付，未深究。）
- 影响范围：工具箱框架 Client/Host 半、两个含 Client 半插件的加载桩、自举静态插件、smoke 套件。

## 历史状态（按时间追加）

- 2026-02-13 23:10 | 调查 | 通读计划第 16 节与工具箱现状；确认 P0=Slot 入口+Timer 生命周期，P1=能力检查+真实冒烟；16.6 暂缓。
- 2026-02-13 23:35 | 调查 | 核对 rc.7 安装包契约：Slot/timer/guard/runner 均与计划假设一致；确认 sim-* 套件结构与 make-payloads 生成链路。
- 2026-02-13 23:40 | 实现 | 16.2 Slot 入口改造 + 16.3 Timer 适配器 + 16.4 能力检查落地；payload 重新生成，14 个旧 smoke 保持全绿。
- 2026-02-14 00:10 | 实现 | 新增 3 个 smoke（Slot 契约/加载桩 timer/真实组合）；真实组合冒烟经两轮断言修正后 24 项全过。
- 2026-02-14 00:25 | 验收 | 补齐 sim-bootstrap-cap 与 sim-host-stop-degrade（16.4 验收面）；19 套件全绿；同步 REBUILD.md/插件.md。
- 2026-02-14 01:00 | 验收 | 用户重启后实测：footer Slot 入口位置差（截图标注）。给出三向选择，用户决策「回导航区（DOM 注入）」。
- 2026-02-14 01:10 | 实现 | 恢复导航区 DOM 注入主路径 + footer Slot 无 DOM 兜底；sim-toolbox-client 改双路径契约（18 项）；19 套件复绿；插件.md 坑 9 同步。
- 2026-02-14 09:30 | 修复 | 重启后管理页开关全报 "no dynamic plugin … lost on DSH restart"：runner.owned() 按定义会话校验所有权，自举插件挂 toolbox-host-* 垫片会话，而管理 RPC 用调用方会话 agent。改为按行归属会话取 agent（plugin-toggle/restart/toggle-all/restart-all/reattach）；sim-toolbox-host 断言同步；sim-rc7-composition 掩掉 .dsh-dynamic-toolbox 用户状态（hermetic——用户真实记忆里 jira/aiassist 本就为关，重建尊重记忆属正确行为）。19 套件复绿。
- 2026-02-14 10:00 | 修复 | ①被抑制插件（只 define 未 run）开关启动报「没有可运行的 Package」：current/nextPackageId 皆空 → 新增 pkgOf() 回退行内最新 Package（toggle/restart/toggle-all/restart-all）。②「重启后」pill 点击无反应：manifestMap 按 root 缓存 defaultStart 无失效 → writeConfig 落盘成功后 manifestCacheByRoot.delete(root)。sim-toolbox-host 增状态化落盘仿真（subprocess argv 截获）+ 实时性断言。19 套件复绿。
