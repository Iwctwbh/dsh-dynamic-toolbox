// ===== make-payloads.mjs（v6 文件夹结构）=====
// 单一事实源：PLUGINS 表 → 生成 plugins/<key>/plugin.json + plugins/<key>/payload.json + 根 plugins.json，
// 并语法检查全部 impl（含 loader.js）。
//
// 新插件三步：plugins/<key>/tool.js + PLUGINS 加一行 + node make-payloads.mjs。
// 日常改 impl 无需重跑本脚本（桩实时从磁盘读）；仅元数据/文件名变化时重跑。
//
// 用法: node make-payloads.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const ROOT_DIR = ''               // 相对工作区根（仓库根 = 工作区根；桩探测 = sandboxPolicy.workspaceRoot → sessions cwd）
const ROOT_PREFIX = ROOT_DIR ? ROOT_DIR + '/' : ''
const SHARED = 'shared/host.js'             // 工具自动拼接的共享辅助（esc/fmtSize/tryRegisterTool/store/logReader/b64）

// ---- 插件总表（顺序 = 重建顺序；tab 顺序见各 tool.js 的 tryRegisterTool order）----
const PLUGINS = [
  {
    key: 'toolbox', idPrefix: 'tbx', order: 1, platform: 'host+client', approval: true, autoStart: true,
    name: '工具箱框架 (Host 注册表 + Client 面板壳)',
    purpose: '工具箱框架：Host 半维护工具注册表并提供 toolbox/tools、toolbox/panel RPC；Client 半提供抽屉 + Tab 栏 + 通用 HTML 面板壳（唯一需要浏览器批准的新架构插件）',
    inject: ['fs'], impl: ['host.js'], client: 'client.js', shared: false, clientRpc: 'toolbox/client-impl',
    note: '框架必须先跑：提供 toolboxRegistry 服务 + 共享设计系统（tb- 类）+ 抽屉壳',
  },
  { key: 'jira', idPrefix: 'jira', order: 2, platform: 'host-only', approval: false, autoStart: true,
    name: 'Jira 需求读取与归档工具 (Host-only)',
    purpose: 'Host-only：Jira 查询/附件归档/记录管理动作机 + HTML 面板渲染，凭据走 credentials 服务、HTTP 走 node 子进程，经工具箱 RPC 注册；记录落盘 .dsh-dynamic-toolbox/jira-watch.json',
    inject: ['fs', 'credentials', 'subprocess', 'timer'], impl: ['tool.js'],
    note: '工单本体与预览图（base64，可 MB 级）留闭包 lastIssue/lastPreview 不进 state——state 轻量化同 http/git/compare' },
  { key: 'git', idPrefix: 'git', order: 3, platform: 'host-only', approval: false, autoStart: true,
    name: 'Git 历史工具 (Host-only)',
    purpose: 'Host-only：subprocess spawn git 的 status/history/commit/diff 动作机 + HTML 面板渲染（list/detail/diff 三视图）；变更清单点击文件看工作区/暂存区 diff（未暂存优先，未跟踪走 --no-index）；status 用 porcelain -z（中文路径零转义），diff 按 rev-parse --show-toplevel 解析（工作区是子目录也对得上），经工具箱 RPC 注册',
    inject: ['fs', 'subprocess', 'timer'], impl: ['tool.js'] },
  { key: 'files', idPrefix: 'files', order: 4, platform: 'host-only', approval: false, autoStart: true,
    name: '工作区文件工具 (Host-only)',
    purpose: 'Host-only：fs 服务列目录 + 文件夹树 HTML 渲染（展开/折叠/刷新），经工具箱 RPC 注册',
    inject: ['fs', 'timer'], impl: ['tool.js'] },
  {
    key: 'theme-teal', idPrefix: 'theme', order: 5, platform: 'client-only', approval: true, autoStart: false,
    name: '工具箱主题 · 青绿（演示）',
    purpose: '工具箱面板主题插件（演示）：在 :root 声明 --tb-* 变量覆盖，把共享设计系统的 accent 从蓝色换成青绿；停止即回默认主题，用于验证"多主题插件按需激活"机制',
    client: 'client.js',
    note: '主题插件：纯 Client（注入 CSS 变量），按需手动激活一个；停止即回默认主题',
  },
  {
    key: 'theme-amber', idPrefix: 'theme', order: 27, platform: 'client-only', approval: true, autoStart: false,
    name: '工具箱主题 · 暖橙',
    purpose: '工具箱面板主题插件：:root 声明 --tb-* 覆盖（accent + active 家族），整体换成暖橙；停止即回默认主题；与青绿演示互斥，按需只激活一个',
    client: 'client.js',
    note: '主题插件：纯 Client（注入 CSS 变量），按需手动激活；停止即回默认主题',
  },
  { key: 'trace', idPrefix: 'trace', order: 6, platform: 'host-only', approval: false, autoStart: true,
    name: '会话轨迹工具 (Host-only)',
    purpose: 'Host-only：sessionQuery 读当前会话日志（makeSessionLogReader 缓存），技能/插件/MCP/子代理/命令(pwsh/bash/终端，默认勾选)/内置 多选过滤时间线 + 点击条目完整输入输出；固定头 + 时间线独立滚动（column-reverse 最新在底）',
    inject: ['fs', 'sessionQuery', 'timer'], impl: ['tool.js'] },
  { key: 'http', idPrefix: 'http', order: 7, platform: 'host-only', approval: false, autoStart: true,
    name: 'HTTP 接口调试工具 (Host-only)',
    purpose: 'Host-only：Postman 风格接口调试——method 芯片 + URL + Params/Headers 键值对编辑（启用/增删）+ Body 类型（none/JSON/raw/form，自动 Content-Type）+ 响应 JSON 美化 + 历史快照重发；落盘 .dsh-dynamic-toolbox/toolbox-http.json',
    inject: ['fs', 'subprocess', 'timer'], impl: ['tool.js'],
    note: '响应本体（可达 256KB）留闭包不进 state——state 每次动作来回传输必须轻量（K3 规矩，与 commitmsg 同构）' },
  { key: 'ports', idPrefix: 'ports', order: 8, platform: 'host-only', approval: false, autoStart: true,
    name: '端口进程查看工具 (Host-only)',
    purpose: 'Host-only：node 子进程 spawnSync netstat/tasklist 列监听端口 + 进程名，过滤/刷新/两步确认 taskkill 结束进程，经工具箱 RPC 注册',
    inject: ['fs', 'subprocess', 'timer'], impl: ['tool.js'],
    note: 'pwsh stdin 按行执行有多行块坑；插件求值器无 Buffer——一律 node 子进程' },
  { key: 'regex', idPrefix: 'regex', order: 9, platform: 'host-only', approval: false, autoStart: true,
    name: '正则测试工具 (Host-only)',
    purpose: 'Host-only：纯 JS 正则匹配测试（flags 芯片开关、匹配位置/捕获分组列表、200 条上限），经工具箱 RPC 注册',
    inject: ['fs', 'timer'], impl: ['tool.js'] },
  { key: 'codec', idPrefix: 'codec', order: 10, platform: 'host-only', approval: false, autoStart: true,
    name: '编解码工具 (Host-only)',
    purpose: 'Host-only：Base64/URL 编解码、JSON 美化/压缩、Unix 时间戳与日期互转，纯 JS（base64 用 shared 自带实现，求值器无 Buffer），经工具箱 RPC 注册',
    inject: ['fs', 'timer'], impl: ['tool.js'] },
  { key: 'usage', idPrefix: 'usage', order: 11, platform: 'host-only', approval: false, autoStart: true,
    name: '会话 Token 用量分析 (Host-only)',
    purpose: 'Host-only：当前会话 assistant/message usage 汇总（总输入/输出/缓存命中率/平均每步）+ Top10 步骤条形图 + 最近 20 步明细；makeSessionLogReader 缓存',
    inject: ['fs', 'sessionQuery', 'timer'], impl: ['tool.js'] },
  { key: 'prompt', idPrefix: 'prompt', order: 12, platform: 'host-only', approval: false, autoStart: true,
    name: '系统提示词装配查看 (Host-only)',
    purpose: 'Host-only：systemPrompt.assemble 全局装配的 sections/contexts/tools/variables 清单，点击展开完整文本；固定头 + 列表独立滚动',
    inject: ['fs', 'systemPrompt', 'timer'], impl: ['tool.js'] },
  { key: 'context', idPrefix: 'contx', order: 13, platform: 'host-only', approval: false, autoStart: true,
    name: '当前上下文窗口查看 (Host-only)',
    purpose: 'Host-only：sessionQuery.readSurface 当前模型可见上下文条目 + tokenMeter 逐条 token 估算，点击展开完整内容；固定头 + 列表独立滚动',
    inject: ['fs', 'sessionQuery', 'tokenMeter', 'timer'], impl: ['tool.js'],
    note: 'idPrefix 限 3-6 小写字母：context 7 个超限 → contx' },
  { key: 'ask', idPrefix: 'ask', order: 14, platform: 'host-only', approval: false, autoStart: true,
    name: '大模型旁路问答 (Host-only)',
    purpose: 'Host-only：llm.stream 直调模型（provider/model 下拉自选，provider 切换经 data-action-onchange 自动刷新模型列表），不写入会话；历史落盘 .dsh-dynamic-toolbox/toolbox-ask.json',
    inject: ['fs', 'llm', 'agentDefaultModel', 'timer'], impl: ['tool.js'],
    note: '消耗真实 API 额度' },
  { key: 'tools', idPrefix: 'tools', order: 15, platform: 'host-only', approval: false, autoStart: true,
    name: '可用工具清单 (Host-only)',
    purpose: 'Host-only：tools.schemas（空则退回 systemPrompt 装配）模型可见工具清单，搜索过滤 + 完整参数 schema 展开',
    inject: ['fs', 'tools', 'systemPrompt', 'timer'], impl: ['tool.js'] },
  { key: 'search', idPrefix: 'search', order: 16, platform: 'host-only', approval: false, autoStart: true,
    name: '会话全文搜索 (Host-only)',
    purpose: 'Host-only：sessionQuery.searchEvents 当前会话全文检索（snippet 命中列表 + readEvent 原文定位），与结构化轨迹互补；回车即搜',
    inject: ['fs', 'sessionQuery', 'timer'], impl: ['tool.js'] },
  { key: 'lineage', idPrefix: 'line', order: 17, platform: 'host-only', approval: false, autoStart: true,
    name: '会话血缘树 (Host-only)',
    purpose: 'Host-only：sessionQuery.traceSession 祖先链 + 子代理后代树（递归缩进），live/persisted/subagent 徽章，断链提示',
    inject: ['fs', 'sessionQuery', 'timer'], impl: ['tool.js'],
    note: 'idPrefix：lineage 7 个字母超限 → line' },
  { key: 'compare', idPrefix: 'cmpr', order: 18, platform: 'host-only', approval: false, autoStart: true,
    name: '多模型一问多答对比 (Host-only)',
    purpose: 'Host-only：同一问题并发 llm.stream 打多个自选模型（provider 下拉自动载模型芯片），并排对比回答/耗时/token；最近 3 轮落盘 .dsh-dynamic-toolbox/toolbox-compare.json',
    inject: ['fs', 'llm', 'agentDefaultModel', 'timer'], impl: ['tool.js'],
    note: 'idPrefix：compare 7 个字母超限 → cmpr；消耗真实 API 额度' },
  { key: 'translate', idPrefix: 'trsl', order: 19, platform: 'host-only', approval: false, autoStart: true,
    name: 'AI 翻译工具 (Host-only)',
    purpose: 'Host-only：llm.stream 旁路翻译（8 种目标语言，保留 Markdown/代码格式），共享 makeLlmHelper 路由；最近 10 条落盘 .dsh-dynamic-toolbox/toolbox-translate.json',
    inject: ['fs', 'llm', 'agentDefaultModel', 'timer'], impl: ['tool.js'],
    note: '消耗真实 API 额度' },
  { key: 'promptopt', idPrefix: 'pmopt', order: 20, platform: 'host-only', approval: false, autoStart: true,
    name: 'AI 提示词优化器 (Host-only)',
    purpose: 'Host-only：粗糙草稿 → llm.stream 改写为结构化提示词（角色/任务/背景/约束/输出格式，4 种风格）；最近 10 条落盘 .dsh-dynamic-toolbox/toolbox-promptopt.json',
    inject: ['fs', 'llm', 'agentDefaultModel', 'timer'], impl: ['tool.js'],
    note: '消耗真实 API 额度' },
  { key: 'commitmsg', idPrefix: 'cmsg', order: 21, platform: 'host-only', approval: false, autoStart: true,
    name: 'AI 提交信息生成 (Host-only)',
    purpose: 'Host-only：git diff（暂存区优先，空则工作区，超 8000 字符截断）→ llm.stream 生成 Conventional Commits 中文提交信息；最近 5 条落盘 .dsh-dynamic-toolbox/toolbox-commitmsg.json',
    inject: ['fs', 'subprocess', 'llm', 'agentDefaultModel', 'timer'], impl: ['tool.js'],
    note: 'git 直 argv spawn；消耗真实 API 额度' },
  { key: 'review', idPrefix: 'revw', order: 22, platform: 'host-only', approval: false, autoStart: true,
    name: 'AI 代码评审 (Host-only)',
    purpose: 'Host-only：工作区相对路径读文件（截断 20000 字符）或粘贴代码 → llm.stream 三级评审（严重/建议/可选）+ 评分；最近 5 条落盘 .dsh-dynamic-toolbox/toolbox-review.json',
    inject: ['fs', 'llm', 'agentDefaultModel', 'timer'], impl: ['tool.js'],
    note: '消耗真实 API 额度' },
  { key: 'aisummary', idPrefix: 'aisum', order: 23, platform: 'host-only', approval: false, autoStart: true,
    name: '会话 AI 摘要 (Host-only)',
    purpose: 'Host-only：makeSessionLogReader 读当前会话 → 用户/助手文本首尾采样压缩（超 12000 取头 4000+尾 8000）→ llm.stream 四节摘要（目标/进展/决定/待办）；最近一次落盘 .dsh-dynamic-toolbox/toolbox-aisummary.json',
    inject: ['fs', 'sessionQuery', 'llm', 'agentDefaultModel', 'timer'], impl: ['tool.js'],
    note: '消耗真实 API 额度' },
  { key: 'aiusage', idPrefix: 'aius', order: 24, platform: 'host-only', approval: false, autoStart: true,
    name: 'AI 旁路调用台账 (Host-only)',
    purpose: 'Host-only：读 .dsh-dynamic-toolbox/toolbox-ai-usage.json（AI 工具旁路调用台账，cap 100）——总计/今日统计 + 按工具聚合条形图 + 最近 20 条明细 + 两步确认清空；与「用量」（会话日志口径）互补',
    inject: ['fs', 'subprocess', 'timer'], impl: ['tool.js'] },
  { key: 'txtdiff', idPrefix: 'tdif', order: 25, platform: 'host-only', approval: false, autoStart: true,
    name: '文本对比工具 (Host-only)',
    purpose: 'Host-only：纯 JS 行级 LCS diff——左右文本统一视图（双列行号/增删行高亮/长相同段折叠展开）、忽略首尾空白开关、交换左右即时重算；结果行留闭包不进 state',
    inject: ['timer'], impl: ['tool.js'] },
  { key: 'cron', idPrefix: 'cron', order: 26, platform: 'host-only', approval: false, autoStart: true,
    name: 'Cron 表达式工具 (Host-only)',
    purpose: 'Host-only：纯 JS 5 段 cron 解析（*/,-/ + JAN-DEC/SUN-SAT 名称、周日 0/7 归一、日周 OR 语义）→ 字段明细 + 未来 8 次运行时刻（本地时区 + 相对倒计时）+ 8 个常用预设；每次动作现算无大状态',
    inject: ['timer'], impl: ['tool.js'] },
  { key: 'gen', idPrefix: 'gen', order: 28, platform: 'host-only', approval: false, autoStart: true,
    name: '生成器 (Host-only)',
    purpose: 'Host-only：UUID v4 批量（≤200）/ CSPRNG 随机串（hex/base64url/字母数字/纯数字/易读集，crypto.randomInt 无偏，≤4096 字符 ×≤50 条）/ 哈希摘要（MD5/SHA-1/SHA-256/SHA-512）；node 子进程真 crypto（求值器无 Buffer、Math.random 非 CSPRNG）；条目点击复制/复制全部',
    inject: ['fs', 'subprocess', 'timer'], impl: ['tool.js'] },
  { key: 'selfview', idPrefix: 'selv', order: 29, platform: 'host+client', approval: true, autoStart: true,
    name: '界面自查（截图/快照/界面操作）',
    purpose: 'Host+Client：查看并操作当前 WebGUI——getDisplayMedia 截屏（一次授权流复用；面板 [data-selfview-mount] 注入真实按钮条，授权/复制享用户激活）、语义 DOM 快照（[eN] ref→元素映射）、DOM 操作（点击/填充走原生 setter 绕 React 值跟踪/滚动/按键）、截图合成 ClipboardEvent 粘贴进聊天框附件区；Host 半注册模型工具 ui_snapshot/ui_capture/ui_click/ui_fill/ui_scroll/ui_press（JPEG 经 subprocess stdin 批写落 .dsh-dynamic-toolbox/toolbox-selfview/，模型随后 read_image 查看），Client 半长轮询 selfview/pull 收命令（25s 心跳）',
    inject: ['fs', 'subprocess', 'timer'], impl: ['tool.js'], client: 'client.js', clientRpc: 'selfview/client-impl',
    modelTools: ['ui_snapshot', 'ui_capture', 'ui_click', 'ui_fill', 'ui_scroll', 'ui_press'],
    note: '含 Client 半需批准一次；autoStart 条目重建时自动发起 run（非阻塞）→ 批准卡弹出点一次即启动；授权不跨进程；modelTools 是该插件注册的模型工具名清单（轨迹工具按它归类「插件」——沙箱内查不到动态标记，只能以清单为事实源）' },
]

// ---- Host 桩模板（v5 瘦身）：桩只探测根并调用磁盘 loader.js ----
const hostStub = (name, inject, implFiles) => `// ===== 二级加载桩（v5）：找到 loader.js 并委托，实现逻辑全在磁盘 =====
const TOOL_FILES = ${JSON.stringify(implFiles)}
return {
  name: ${JSON.stringify(name)},
  inject: ${JSON.stringify(inject)},
  async apply(ctx) {
    const fs = ctx.get('fs')
    if (!fs) throw new Error('stub: fs 服务不可用')
    const roots = []
    const sp = ctx.get('sandboxPolicy')
    if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot) roots.push(sp.workspaceRoot)
    const ss = ctx.get('sessions')
    if (ss) { try { for (const s of ss.list()) { const c = s && s.header && s.header.cwd; if (typeof c === 'string' && c && roots.indexOf(c) < 0) roots.push(c) } } catch (e) {} }
    const tried = []
    for (const root of roots) {
      try {
        const t = await fs.resolve(${JSON.stringify(ROOT_PREFIX)} + 'loader.js', { cwd: root })
        if (!await fs.stat(t)) { tried.push(root + ': loader.js 不存在'); continue }
        const fn = new Function('ctx', 'harness', 'console', 'IMPL_FILES', 'usedRoot', 'return (async () => {\\n' + await fs.readText(t) + '\\n})()')
        return await fn(ctx, typeof harness === 'undefined' ? undefined : harness, console, TOOL_FILES, root)
      } catch (e) { tried.push(root + ': ' + String((e && e.message) || e)) }
    }
    throw new Error('stub: 无法加载 ${ROOT_PREFIX}loader.js（尝试根: ' + (roots.join(', ') || '(无)') + (tried.length ? '；明细: ' + tried.join(' | ') : '') + '）')
  },
}
`

// ---- 带 client-impl RPC 的 Host 桩：委托前注册 <rpc>，Client 半经它实时拉磁盘 client.js ----
const hostStubWithClientRpc = (name, inject, implFiles, rpc, clientRel) => hostStub(name, inject, implFiles)
  .replace(
    "        const fn = new Function(",
    `        ctx.effect(() => harness.handle('${rpc}', async () => {
          try {
            const target = await fs.resolve(${JSON.stringify(clientRel)}, { cwd: root })
            return { ok: true, code: await fs.readText(target) }
          } catch (e) {
            return { ok: false, error: String((e && e.message) || e) }
          }
        }))
        const fn = new Function(`,
  )

// ---- Client 加载桩：经 Host 半 <rpc> 实时拉磁盘 client.js 求值 ----
// （嵌套 new Function 帧不吃外层形参——ctx/React/host/styles/console 显式下传）。
// 改 plugins/<key>/client.js 后 cordis_run 重跑对应插件即生效，无需重新 define/批准。
const clientLoaderStub = (rpc, key) => `// ===== ${key} Client 加载桩：实现实时从磁盘拉取（经 Host 半 ${rpc} RPC）=====
return {
  name: '${key}-client-loader',
  inject: ['timer'],
  async apply(ctx) {
    const res = await host.call('${rpc}')
    if (!res || !res.ok) throw new Error('${rpc} 拉取失败: ' + String((res && res.error) || '(无响应)'))
    const fn = new Function('ctx', 'React', 'host', 'styles', 'console', 'return (async () => {\\n' + res.code + '\\n})()')
    const impl = await fn(ctx, React, host, styles, console)
    if (!impl || typeof impl.apply !== 'function') throw new Error('${key} client.js 未返回插件对象')
    return impl.apply(ctx)
  },
}
`

// ---- 语法检查（编译不执行）----
let failed = false
const check = (label, code) => {
  try {
    new Function('return (async () => {\n' + code + '\n})()') // 仅编译
    console.log('syntax OK: ' + label)
  } catch (e) {
    failed = true
    console.error('syntax FAIL: ' + label + ': ' + e.message)
  }
}
const readLocal = (rel) => readFileSync(new URL('./' + rel, import.meta.url), 'utf8')

check('loader.js [impl]', readLocal('loader.js'))

for (const p of PLUGINS) {
  const dir = 'plugins/' + p.key
  const implFiles = (p.shared === false ? [] : [SHARED]).concat((p.impl || []).map((f) => dir + '/' + f))
  p.implFiles = implFiles

  // impl 存在性与语法
  for (const f of implFiles) {
    if (!existsSync(new URL('./' + f, import.meta.url))) {
      failed = true
      console.error('missing impl: ' + f + ' (' + p.key + ')')
    }
  }
  if (p.impl) check(implFiles.join(' + ') + ' [impl]', implFiles.filter((f) => existsSync(new URL('./' + f, import.meta.url))).map(readLocal).join('\n'))

  // 写 plugin.json（文件夹级元数据）
  const dirUrl = new URL('./' + dir + '/', import.meta.url)
  if (!existsSync(dirUrl)) mkdirSync(dirUrl, { recursive: true })
  writeFileSync(new URL('./' + dir + '/plugin.json', import.meta.url), JSON.stringify({
    key: p.key, idPrefix: p.idPrefix, name: p.name, purpose: p.purpose,
    platform: p.platform, inject: p.inject || [], impl: p.impl || [], client: p.client || null,
    shared: p.shared !== false, order: p.order, autoStart: p.autoStart, approval: p.approval,
  }, null, 2) + '\n')

  // 写 payload.json
  const code = {}
  if (p.impl) code.host = p.clientRpc ? hostStubWithClientRpc(p.name, p.inject, p.implFiles, p.clientRpc, ROOT_PREFIX + dir + '/' + p.client) : hostStub(p.name, p.inject, p.implFiles)
  if (p.client) code.client = p.clientRpc ? clientLoaderStub(p.clientRpc, p.key) : readLocal(dir + '/' + p.client)
  const payload = { plugin: { kind: 'new', idPrefix: p.idPrefix }, name: p.name, purpose: p.purpose, code }
  if (code.host) check('payload ' + p.key + ' [host stub]', code.host)
  if (code.client) check('payload ' + p.key + ' [client]', code.client)
  writeFileSync(new URL('./' + dir + '/payload.json', import.meta.url), JSON.stringify(payload, null, 2) + '\n')
}

// ---- 根 plugins.json（重建总清单：只留决策所需元数据；define 参数一律读条目 payload.json）----
writeFileSync(new URL('./plugins.json', import.meta.url), JSON.stringify({
  version: 2,
  comment: '工具箱插件总清单（v6 文件夹结构，make-payloads.mjs 生成）。最快重建：cordis_define tbx 框架（Host 桩 + Client 加载桩）→ cordis_run → GUI 批准，零点击——框架启动自动补齐（doRebuild：读磁盘 payload.json 经 dynamicCordisRunner 并行 define+run，幂等按名跳过已定义，含被停掉的；启动与否遵循 .dsh-dynamic-toolbox/toolbox-plugins.json 启停记忆）。抽屉齿轮「从 plugins.json 重建/补齐」按钮是同一逻辑的手动触发。无框架时的手动路径：按 order 依次读该条目 payload.json（即完整 define 参数）→ cordis_define → autoStart=true 的再 cordis_run(mode: run)。approval=true 含 Client 半需 GUI 批准。inject/implFiles 等只在 payload.json 维护，本清单不重复。',
  plugins: PLUGINS.slice().sort((a, b) => a.order - b.order).map((p) => ({
    id: p.key,
    name: p.name,
    payload: 'plugins/' + p.key + '/payload.json',
    platform: p.platform,
    approval: p.approval,
    autoStart: p.autoStart,
    order: p.order,
    idPrefix: p.idPrefix,
    purpose: p.purpose,
    ...(p.client ? { client: 'plugins/' + p.key + '/' + p.client } : {}),
    ...(p.modelTools ? { modelTools: p.modelTools } : {}),
    ...(p.note ? { note: p.note } : {}),
  })),
}, null, 2) + '\n')
console.log('written: plugins.json（' + PLUGINS.length + ' 条）')

if (failed) {
  console.error('>>> 存在错误，请先修复')
  process.exit(1)
}
console.log('>>> v6 payloads + plugin.json + plugins.json generated, all syntax OK')
