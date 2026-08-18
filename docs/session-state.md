# 会话状态存档

## 最新会话状态

- 时间：2026-02-14 11:40
- 当前阶段：验收
- 当前目标：按 origin/main..HEAD 评审结论修复 dsh-dynamic-toolbox 的 5 项问题（4×P1 + 1×P2）
- 现状摘要：
  - [P1] hostIdOf 碰撞：仓库路径先统一分隔符、去尾分隔符并在 Windows 路径上折叠大小写，再生成「规范化短前缀（尾 24 字符，可读）+ canonical path 的 FNV-1a 32-bit 哈希（base36）」；`host-bootstrap/index.js`（导出供测试）与 `plugins/toolbox/host.js` 两处保持同算法。旧算法只截断 48 字符，同前缀长路径或 `a-b` 与 `a/b` 归一同形会复用垫片导致第二仓库无法自举。
  - [P1] 多仓库同名行串仓：`isRepoRow` 不再只按 Package name 判归属；bootstrap 行精确匹配 `hostIdOf(root)`，手动定义行按 owner session cwd 与仓库 root 的包含关系判定。管理清单、单项/批量启停、重跑与启停记忆均保持仓库隔离；sim-toolbox-host 新增 W/W3 同清单双 clone 回归。
  - [P1] 流式失败永久「生成中」：flow parseItems 新增 step/end、turn/end 事件跟踪；合并阶段草稿所属步骤/轮次已终结却无最终 message → 落定为中断（streaming=false + interrupted 标记 + runDur 按终结时刻结算 + 预览「…（生成已中断）」红色），卡片流光与耗时计时随之停止；render 的 liveAiSeq 排除 interrupted 卡。已核实 DSH agent-loop 契约：step/end 在 finally 中必发、turn/end 必带 reason（error/aborted/…），崩溃孤儿日志 reload 时 repair 也补 closers。
  - [P1] 跨工作区旧面板残留：cwd 变化时在原清 htmlRef/stateRef/seqRef 之外补清 attemptedRef、retryCountRef 并 setHtml(null)——经过无工具箱工作区后延迟重载被旧空列表跳过、新列表到达又被 attemptedRef 挡住补发的链路斩断。
  - [P2] Cordis running 计数：不再用 toolbox/plugins（单仓库清单、仅 Client-half）覆盖全局 badge，改为直接统计面板 DOM 中未隐藏且 data-cordis-status="running" 的行；面板未打开时行不渲染 → 不覆盖、保持官方全进程口径。panelHide.visibleRunning 字段移除。
  - [P1] smoke 修复：sim-toolbox-client 的 fake DOM 补 querySelectorAll/querySelector/getAttribute/textContent（mini 选择器匹配，不支持的语法按不匹配处理不抛错）；新增路径 C 断言——Host-only 行隐藏、待审批行不隐藏、计数按 DOM 可见行覆盖（2 而非单仓库含界面口径的 1）、开关关闭后行恢复且计数覆盖移除。
  - 回归：19 个 smoke 套件全绿（sim-flow 34、sim-toolbox-client 25、sim-bootstrap-cap 18、sim-toolbox-host 27 项断言）；make-payloads 全量语法检查通过且 payload.json 零变化（桩从磁盘读 impl，改动经重跑生效）。
- 当前方案：无未验证项。
- 已做：改动清单——host-bootstrap/index.js、plugins/toolbox/host.js、plugins/flow/tool.js、plugins/toolbox/client.js、smoke/{sim-toolbox-client,sim-toolbox-host,sim-bootstrap-cap,sim-flow,sim-host-stop-degrade,sim-rc7-composition}.cjs、docs/session-state.md。
- 下一步：用户侧生效操作——重跑工具箱框架插件（client.js/host.js/flow 桩均从磁盘实时读，cordis 面板重跑即可）；host-bootstrap 为静态插件需重启 DSH。注意同进程过渡：框架重跑后 host.js 用新 hostIdOf，而旧 bootstrap 创建的宿主 id 仍是旧格式，自动补齐的宿主行匹配会回退「唯一同名行」兜底（单仓库不受影响）；重启 DSH 后两侧一致。
- 未解决分歧：无。
- 当前阻塞：无。
- 影响范围：自举静态插件、工具箱框架 Host/Client 半、flow 工具、6 个 smoke 套件。

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
