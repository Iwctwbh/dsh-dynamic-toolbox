# 插件编写指南（工具箱架构 v6）

> 配套阅读：`REBUILD.md`（目录结构/重建/迭代流程）。本文只讲**怎么写一个新工具插件**和**必踩的坑**。

## 架构一句话

`tbx` 框架插件（Host 注册表 + Client 面板壳）+ N 个 Host-only 工具插件。工具经 `ctx.get('toolboxRegistry').register(...)` 挂进框架，Tab 自动出现；插件停止时 Tab 级联消失。

## shared/host.js 可用助手（自动拼接到每个 Host-only 工具包开头）

- 基础：`esc` / `fmtSize` / `tryRegisterTool`（500ms 快重试幂等注册，注册成功后降 2s 慢心跳，框架重启自动重挂）/ `b64encode` / `b64decode`
- 会话日志：`makeSessionLogReader(ctx, sessionQuery)`（缓存，count 不变即命中）
- 持久化：`readJsonStore` / `writeJsonStore`（`<工作区>/.dsh-dynamic-toolbox/<file>`，持久化失败要出警告）
- 内容产物：`pluginDataDir(key)` → `<工作区>/.dsh-dynamic-toolbox/data/<key>/`（人会直接打开的产物——附件/导出件——放这里，与 .dsh-dynamic-toolbox 内部状态分家；根目录不散落插件文件夹，.gitignore 一行 `.dsh-dynamic-toolbox/data/` 收工）
- 工作区：`resolveWorkspace(ctx, root, session)` → `{ root, session }`
- **AI 工具**：`makeLlmHelper(ctx)` → `{ available, resolveRoute(st), chat(st, system, user, timeoutMs?, track?), rollup(root, tool), routeRow(st, route, note?) }`。
  `chat` 返回 `{ a, ms, out, route }` 或 `{ err, ms, route }`（120s 超时守卫；system 并入首条 user 消息，最稳）；
  `track = { root, session, tool }` 让每次调用结果异步追加进用量台账 `.dsh-dynamic-toolbox/toolbox-ai-usage.json`（cap 100，不阻塞响应），`rollup(root, tool)` 取该工具累计 `{ calls, out }` 展示在路由行；
  模型清单缓存监听 `llm/adapters-updated` 自动失效（provider 拓扑变化不陈旧）；
  `routeRow` 渲染 provider/model 双下拉（provider 切换走 `data-action-onchange="route"`，工具 handler 里把 `st.model` 清空即可）。
  参考实现：`plugins/aiassist/tool.js`（AI 助手 7 合一：PRESETS 表驱动 问答/翻译/优化/评审/提交信息/摘要/对比，
  preset = { id, label, mode:'single'|'multi', input:'text'|'fileOrText'|'gitsource'|'sessionlog', params, sys(st), store, cap }——
  新增 AI 用途只需在 PRESETS 加一行；大本体进闭包；台账 tool 键 = preset id）。
  多合一计算类参考：`plugins/calc/tool.js`（子模式命名空间 `st.<sub>` + 子模式芯片切换）。

## 新工具三步

1. 建文件夹 `plugins/<key>/`，写 `tool.js`（plain JS，禁 import/require/TS，文件末尾 `return` 插件对象）；
2. `make-payloads.mjs` 的 PLUGINS 表加一行（key/idPrefix/order/name/purpose/inject；idPrefix 限 3-6 小写字母）；
3. `node make-payloads.mjs`（生成 plugin.json + payload.json + 总清单）→ `cordis_define` ← `plugins/<key>/payload.json` → `cordis_run(mode: run)`。Host-only 免批准。

**建议同步写一个 `smoke/sim-<key>.cjs`**（mock ctx/服务求值 impl，断言面板协议与 state 契约；参考 sim-calc 的零服务纯逻辑形态、sim-jira 的 mock credentials+subprocess 形态）。`node smoke.mjs` 一键全量回归。注意沙箱禁命名管道：子进程 stdout/stderr 用临时文件重定向，别用 pipe。

## impl 骨架

```js
return {
  name: 'xxx-tool',
  inject: ['fs', 'subprocess', 'timer'],   // 硬依赖才进 inject
  apply(ctx) {
    const render = (st, busy) => '<div class="jr-tabpanel tb-root">…（tb- 共享类）…</div>'
    const handler = async ({ action, fields, state, root }) => {
      const st = state || { /* 初始状态，纯 JSON */ }
      // if (action === 'xxx') { … }
      return { ok: true, html: render(st, false), state: st }
    }
    tryRegisterTool(ctx, { id: 'xxx', label: 'XXX', order: 10 }, handler)  // shared/host.js 提供，500ms 重试幂等注册
  },
}
```

## 面板契约（Host ↔ Client 壳）

| 方向 | 约定 |
| --- | --- |
| Host → Client | `{ ok, html, state }`；html 经 `dangerouslySetInnerHTML` 渲染；可附带 `copy` 字符串 → Client 壳写剪贴板并提示（复制提交信息/译文等） |
| Client → Host | 点击 `[data-action]` 元素触发；元素自身 `data-*`（如 `data-key`）经 `fields.__el` 回传 |
| 表单 | input/textarea/select 加 `data-field="name"`，任何动作提交时全部收集进 `fields`；回车自动触发 `data-action="query"` |
| 下拉联动 | select 加 `data-action-onchange="xxx"`：change 即自动触发该动作（无需切换按钮）；provider→模型列表联动就用它。联动请求在途时面板内 select 自动锁定（失败自动恢复）；Client 壳按工具发请求序号，过期响应直接丢弃——handler 无需关心并发乱序。**注意：面板是 innerHTML 裸 DOM，React 合成 onChange 对它永不派发，壳用的是抽屉根节点上的原生 change 监听——新事件类型别想当然走 React onXxx** |
| 分类归属 | 导航是「搜索 / 分类 / 工具」三行：工具经 `DEFAULT_CAT`（toolbox/client.js）归入 AI/开发/会话/系统，**新工具默认落「开发」**，要归别的类就改 DEFAULT_CAT；终端用户可在管理树（齿轮）里把节点拖到别的分类（覆盖存 localStorage `dsh.toolbox.cats`，优先级高于 DEFAULT_CAT） |
| 环境 | 每次动作透传 `root`（当前工作区路径）与 `session`（当前会话 ID，轨迹类工具用） |
| state | 纯 JSON，宿主侧按工具持有，每次动作原样回传 |

## 必踩的坑（实战血泪）

1. **样式用框架共享设计系统（`tb-` 类），不要自己内嵌 `<style>`。** 共享层在 `toolbox-client.js` 注入一次：按钮/输入/横幅/pill/卡片/列表/文件行/树/空状态全有（组件类见源码注释块）。面板根节点用 `<div class="jr-tabpanel tb-root">`；按钮样式要 `!important` 压宿主全局样式。颜色只消费 `--tb-*` 变量（带 `--dsw-alias-*` 兜底）——框架**永不声明**这些变量，主题插件在 `:root` 声明即可整体换肤（多个主题插件，按需激活一个）。
2. **模板字符串里的子进程脚本：`\n` 写 `'\\n'`。** 外层模板求值时 `\n` 已变真实换行，子脚本出现未终止字符串 → `SyntaxError: Unterminated string constant`。更稳的做法是**数组 join**（`'\\n'` 拼接）或干脆不写字面换行（见 plugins/http/tool.js）。改完用「eval 模板 + `new Function(child)`」验证子脚本能编译（见下）。
   **pwsh 子进程同理还有第二坑：`pwsh -Command -` 从 stdin 读脚本是按行执行**，多行块（`@(...ForEach-Object {` 跨行）直接解析失败且静默无输出。`-EncodedCommand` 又要 base64 而插件求值器没有 Buffer——**首选 node 子进程**（`node -` 整脚本 stdin，netstat/tasklist 用 spawnSync 解析，见 plugins/ports/tool.js）。另外 `Get-NetTCPConnection` 在受限环境会「拒绝访问」，列端口用 `netstat -ano` 解析。
3. **`ctx.xxx` 直接访问必须先声明 `inject: ['xxx']`**；可选服务用 `ctx.get('xxx')` + `undefined` 判断。`timer` 也是服务，用 `ctx.interval/ctx.timeout`，禁原生 `setTimeout`。
4. **副作用全部挂生命周期**：`ctx.effect()` / `ctx.on()` / 服务返回的 disposer，保证 stop/update 后清理干净。
5. **不传活数据**：跨 RPC 和 state 只放可序列化 JSON 叶子字段，别 JSON.stringify 服务对象。

## 主题插件（按需激活一个）

框架只以 `var(--tb-*, 兜底)` 消费变量、从不声明 —— 主题插件只需 Client 半在 `:root` 声明覆盖（参考 `plugins/theme-teal` 青绿、`plugins/theme-amber` 暖橙）：

```js
return {
  name: 'tb-theme-xxx',
  apply(ctx) {
    const dispose = styles.insert(':root{--tb-accent:#0d9488;--tb-accent-text:#5eead4;--tb-accent-bg:rgba(20,184,166,.14);--tb-accent-border:rgba(20,184,166,.45);--tb-accent-ring:rgba(20,184,166,.16);--tb-accent-hover:#14b8a6;--tb-active:#14b8a6;--tb-active-text:#5eead4;--tb-active-border:rgba(20,184,166,.4)}')
    ctx.effect(() => dispose)   // styles.insert 返回 disposer，停止即回默认主题
  },
}
```

可覆盖变量全清单看 `toolbox-client.js` 共享层注释；多主题并存时后插入者胜出，按需只激活一个。

## 子进程脚本模板验证

```js
const m = src.match(/const XXX_SCRIPT = `([\s\S]*?)`/)
new Function(eval('`' + m[1] + '`'))   // 与宿主同语义求值后编译，抛错即有转义 bug
```

## 日常迭代

改 impl 文件 → 抽屉齿轮「重跑」该行（或 `cordis_run(mode: run)` 重跑对应插件）即生效（桩每次 apply 重读磁盘），**不用重新 define、不用重新批准**。`node --check xxx-tool.js` 做语法检查。

## 数据位置（重建/重跑不丢）

- `.dsh-dynamic-toolbox/jira-watch.json`：Jira 查询记录
- `.dsh-dynamic-toolbox/data/jira/<KEY>/`：Jira 归档（issue.md + issue.json + 附件；查询自动归档、点记录零 API 读本地）
- Jira 凭据四选一（推荐第一种）：Jira 面板「凭据设置」直接填写（写入 Harness 凭据存储，立即生效）/ 环境变量 `JIRA_BASE_URL`/`JIRA_EMAIL`/`JIRA_TOKEN` / `~/.dsh/.credentials.yaml` / 项目 `.env`

## 从别的仓库挂进工具箱（进阶）

工具插件与框架的耦合面只有两条：运行时 `ctx.get('toolboxRegistry').register({ id, label, order }, handler)` + 上文的面板契约。外部仓库的动态插件不需要本仓的 loader/shared 拼接——在自己的 `apply(ctx)` 里调同一接口即可挂入（同样建议 500ms 重试等待框架，停止时注册随 fiber 级联清理）。

注意：面板协议（`tb-` 类、`data-*` 约定、`fields.__el`、state 形状）目前没有版本协商，随本仓框架原子演进——跨仓挂接请自行跟随本仓的协议变化，或先把协议钉在某个 commit 上。
