# 动态工具箱（dsh-dynamic-toolbox）

由 dsh-flowglass 构建的 **DSH 原生静态 Host/Client 插件**。

- bundleId: `dynamic-toolbox`
- 版本: 0.1.0
- 动态批准: **不需要**（不使用 dynamicCordisRunner，不产生 dyn/*）
- 功能:
  - `jira` — Jira 需求读取与归档工具 (Host-only)
  - `git` — Git 历史工具 (Host-only)
  - `files` — 工作区文件工具 (Host-only)
  - `flow` — 实时流镜 (Host-only)
  - `flowedit` — 工作流编辑器 (Host-only)
  - `theme-teal` — 工具箱主题 · 青绿（演示）
  - `trace` — 会话轨迹工具 (Host-only)
  - `http` — HTTP 接口调试工具 (Host-only)
  - `ports` — 端口进程查看工具 (Host-only)
  - `calc` — 计算台（编解码/正则/Cron/文本对比/生成器 5 合一）
  - `usage` — 会话 Token 用量分析 (Host-only)
  - `prompt` — 系统提示词装配查看 (Host-only)
  - `context` — 当前上下文窗口查看 (Host-only)
  - `aiassist` — AI 助手（问答/翻译/优化/评审/提交信息/摘要/对比 7 合一）
  - `tools` — 可用工具清单 (Host-only)
  - `search` — 会话全文搜索 (Host-only)
  - `lineage` — 会话血缘树 (Host-only)
  - `aiusage` — AI 旁路调用台账 (Host-only)
  - `quota` — API 配额查询 (Host-only)

## 安装 / 升级 / 卸载

```powershell
npm pack
dsh plugin --profile web add <tgz>
# 或已发布于 npm registry 时直接在线安装：
dsh plugin --profile web add dsh-dynamic-toolbox
# 重启 DSH 后由原生 Loader 直接挂载 Host 与 Client
dsh plugin --profile web remove dsh-dynamic-toolbox
```

升级时提高版本、重新构建发布，然后对新版本再执行 add 并重启 DSH。

## 运行结构

- `lib/index.js`：原生 Host 插件；
- `lib/client.js`：通过 package.json 的 `dsh.client` 和 `exports["./client"]` 原生加载；
- `lib/remote.js`：Host/Client Remote 描述；
- 不读取源码仓库的 loader.js / plugins.json / payload.json；
- 不调用 dynamicCordisRunner；
- 业务数据仍按工具约定写当前工作区的 `.dsh-dynamic-toolbox/`。
