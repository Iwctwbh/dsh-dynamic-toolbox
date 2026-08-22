// ===== 动态工具箱 · DSH 原生静态 Host（构建生成，勿手改） =====
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = "dsh-dynamic-toolbox"
export const inject = ["fs","credentials","subprocess","timer","sessionQuery","systemPrompt","tokenMeter","llm","agentDefaultModel","tools"]

const TOOLBOX_RUNTIME_OVERRIDES = {
  "mode": "static-bundle",
  "bundleId": "dynamic-toolbox",
  "displayName": "动态工具箱",
  "registryService": "toolboxRegistryDynamicToolbox",
  "artifactService": "toolboxArtifactsDynamicToolbox",
  "remoteService": "toolboxNativeDynamicToolbox",
  "remoteNamespace": "toolboxNativeDynamicToolbox",
  "rpcPrefix": "toolbox.dynamic-toolbox",
  "storagePrefix": "dsh.toolbox.dynamic-toolbox",
  "eventPrefix": "tb-dynamic-toolbox",
  "slotPrefix": "toolbox-dynamic-toolbox",
  "domId": "dynamic-toolbox",
  "hostIdPrefix": "toolbox-host-dynamic-toolbox",
  "dataDir": ".dsh-dynamic-toolbox",
  "capabilities": {
    "diskReload": false,
    "rebuildFromDisk": false,
    "pluginDefaults": false,
    "pluginRestart": false,
    "aiUsage": false,
    "managePlugins": false
  }
}
// ===== shared/runtime.js：两种模式共同的运行配置与命名辅助 =====
// 纯 JS：不访问 Node API、不依赖 Host/Client 专属全局，可拼接到 Host 与 Client payload。
// 动态模式：只拼接本文件（无 TOOLBOX_RUNTIME_OVERRIDES）→ 全部动态默认值，与历史行为一致。
  // 原生静态模式：构建器在本文件之前拼接 `const TOOLBOX_RUNTIME_OVERRIDES = {...}` JSON 字面量。
// 配置不走 globalThis/window/process.env（多 bundle 同进程会互相覆盖、批准包必须可审计、
// 全局变量会让 payload 内容哈希不能代表真实行为）——业务实现只读本文件定义的 TOOLBOX_RUNTIME。
const TOOLBOX_RUNTIME = (() => {
  const o = (typeof TOOLBOX_RUNTIME_OVERRIDES !== 'undefined' && TOOLBOX_RUNTIME_OVERRIDES) || {}
  const mode = o.mode || 'dynamic-dev'
  const bundleId = o.bundleId || 'dynamic'
  const rpcPrefix = o.rpcPrefix || 'toolbox'
  const storagePrefix = o.storagePrefix || 'dsh.toolbox'
  const eventPrefix = o.eventPrefix || 'tb'
  const slotPrefix = o.slotPrefix || 'toolbox'
  return Object.freeze({
    mode, // 'dynamic-dev' | 'static-bundle'
    bundleId, // 动态模式恒为 'dynamic'；静态安装包为 bundleId（如 'flow-plus'）
    displayName: o.displayName || '工具箱',
    registryService: o.registryService || 'toolboxRegistry',
    artifactService: o.artifactService || null,
    remoteService: o.remoteService || null,
    remoteNamespace: o.remoteNamespace || null,
    rpcPrefix, // 动态 'toolbox'；编译 'toolbox.<bundleId>' → rpc('tools') = '<prefix>/tools'
    storagePrefix, // 动态 'dsh.toolbox'；编译 'dsh.toolbox.<bundleId>'
    eventPrefix, // 动态 'tb'；编译 'tb-<bundleId>' → event('session-changed')
    slotPrefix, // 动态 'toolbox'；编译 'toolbox-<bundleId>' → slot('entry') / slot('drawer')
    domId: o.domId || 'dynamic', // DOM marker 命名值；动态恒 'dynamic'
    hostIdPrefix: o.hostIdPrefix || 'toolbox-host',
    dataDir: o.dataDir || '.dsh-dynamic-toolbox',
    capabilities: Object.freeze(Object.assign({
      diskReload: mode === 'dynamic-dev',
      rebuildFromDisk: mode === 'dynamic-dev',
      pluginDefaults: true,
      pluginRestart: true,
      aiUsage: true,
      managePlugins: true,
    }, o.capabilities || {})),
    // ---- 命名辅助（前缀已由构建器归一化，拼接即得最终名）----
    rpc: (suffix) => rpcPrefix + '/' + suffix,
    storageKey: (suffix) => storagePrefix + '.' + suffix,
    event: (suffix) => eventPrefix + '-' + suffix,
    slot: (name) => slotPrefix + '-' + name,
    // DOM 标记值：动态默认保持历史值（mounted="1"、entry=""），编译模式用 bundleId 区分多 bundle
    domValue: () => (bundleId === 'dynamic' ? '' : bundleId),
    domMountedValue: () => (bundleId === 'dynamic' ? '1' : bundleId),
    logTag: () => (bundleId === 'dynamic' ? '[toolbox]' : '[toolbox:' + bundleId + ']'),
  })
})()


// 静态注册表：feature 只挂载一次，handler 每次调用接收当前 root/session，适用于任意工作区。
const makeStaticRegistry = () => {
  const entries = new Map()
  return {
    register(desc, handler) {
      if (!desc || typeof desc.id !== 'string' || !desc.id || typeof handler !== 'function') return () => {}
      const entry = { id: desc.id, label: desc.label || desc.id, order: typeof desc.order === 'number' ? desc.order : 0, icon: desc.icon || null, handler }
      entries.set(desc.id, entry)
      return () => { if (entries.get(desc.id) === entry) entries.delete(desc.id) }
    },
    tools() {
      return [...entries.values()].sort((a, b) => a.order - b.order).map((x) => ({ id: x.id, label: x.label, order: x.order, icon: x.icon || null }))
    },
    async panel(root, call) {
      const toolId = call && typeof call.tool === 'string' ? call.tool : ''
      const entry = entries.get(toolId)
      if (!entry) return { ok: false, error: '工具未注册: ' + (toolId || '(空)') }
      try {
        const res = await entry.handler({
          action: call && typeof call.action === 'string' ? call.action : '',
          fields: call && call.fields && typeof call.fields === 'object' ? call.fields : {},
          state: call && call.state || null,
          root: typeof root === 'string' && root ? root : undefined,
          session: call && typeof call.session === 'string' && call.session ? call.session : undefined,
        })
        if (!res || typeof res.html !== 'string') return { ok: false, error: '工具返回了无效面板内容' }
        const out = { ok: true, html: res.html, state: res.state == null ? null : res.state }
        if (typeof res.copy === 'string' && res.copy) out.copy = res.copy
        return out
      } catch (error) { return { ok: false, error: String(error && error.message || error) } }
    },
  }
}

// ===== shared-host.js：注入到每个 Host-only 工具包开头的公共辅助（make-payloads.mjs 自动拼接）=====
// HTML 转义（面板内容来自 Host 拼接，转义用户数据防止破坏结构）
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const fmtSize = (n) => {
  if (n == null) return ''
  const b = Number(n)
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / (1024 * 1024)).toFixed(1) + ' MB'
}

// 幂等注册到工具箱框架：框架未启动时每 500ms 快重试；注册成功后降为 2000ms 慢心跳
// （注册表实例更换——工具箱插件重启/更新——时自动重注册）；插件停止时自动从注册表移除（Tab 级联消失）
const tryRegisterTool = (ctx, desc, handler) => {
  let off = null
  let regSeen = null
  const once = () => {
    // ctx.get 在服务重 provide 的窗口期可能 throw（isolate key 变化）——必须捕获，
    // 否则一次异常就让 interval 心跳中断，注册再也无法自愈
    let reg
    try { reg = ctx.get(TOOLBOX_RUNTIME.registryService) } catch (e) { return }
    if (!reg || typeof reg.register !== 'function') return
    if (reg === regSeen && off) return
    if (off) { try { off() } catch (e) {} off = null }
    try {
      const d = reg.register({ id: desc.id, label: desc.label, order: desc.order, icon: desc.icon || null }, handler)
      off = () => { try { d() } catch (e) {} }
      regSeen = reg
    } catch (e) {}
  }
  let ivSlow = null
  const ivFast = ctx.interval(() => {
    const had = off
    once()
    if (!had && off && !ivSlow) {
      // 刚注册成功：停快重试，改慢心跳（框架重启导致注册表实例更换时仍能自动挂上）
      try { ivFast() } catch (e) {}
      ivSlow = ctx.interval(once, 2000)
      ctx.effect(() => { if (ivSlow) ivSlow() })
    }
  }, 500)
  ctx.effect(() => ivFast)
  ctx.effect(() => () => { if (off) off() })
}
// ===== end shared-host.js =====

// ===== UTF-8 安全 Base64（纯 JS）=====
// 注意：动态 Host 求值器遮蔽 Node 特有全局（Buffer/process 不可用），base64 必须自带实现。
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const b64encode = (str) => {
  const s = String(str == null ? '' : str)
  const bytes = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const cp = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00)
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2]
    out += B64_CHARS[a >> 2] + B64_CHARS[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)]
    out += b === undefined ? '=' : B64_CHARS[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)]
    out += c === undefined ? '=' : B64_CHARS[c & 63]
  }
  return out
}
const b64decode = (input) => {
  const s = String(input == null ? '' : input).replace(/[^A-Za-z0-9+/=]/g, '')
  const bytes = []
  for (let i = 0; i < s.length; i += 4) {
    const n0 = B64_CHARS.indexOf(s[i]), n1 = B64_CHARS.indexOf(s[i + 1])
    const n2 = s[i + 2] === '=' || s[i + 2] === undefined ? 0 : B64_CHARS.indexOf(s[i + 2])
    const n3 = s[i + 3] === '=' || s[i + 3] === undefined ? 0 : B64_CHARS.indexOf(s[i + 3])
    const v = (n0 << 18) | (n1 << 12) | (n2 << 6) | n3
    bytes.push((v >> 16) & 255)
    if (s[i + 2] !== '=' && s[i + 2] !== undefined) bytes.push((v >> 8) & 255)
    if (s[i + 3] !== '=' && s[i + 3] !== undefined) bytes.push(v & 255)
  }
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]
    if (b < 0x80) { out += String.fromCharCode(b); i += 1 }
    else if (b < 0xe0) { out += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2 }
    else if (b < 0xf0) { out += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3 }
    else {
      const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63)
      const u = cp - 0x10000
      out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 1023)); i += 4
    }
  }
  return out
}

// ===== 会话日志读取（带缓存；日志只追加 ⇒ count 不变即命中）=====
// 活会话读内存快照（零 IO）；持久化会话增量 readFrom，失败回退全量 readSession。
// 返回 { events, header, count, changed }；changed=false 时上层可复用已构建的模型。
// 用法：const readLog = makeSessionLogReader(ctx, ctx.get('sessionQuery'))
const makeSessionLogReader = (ctx, sq) => {
  let cache = null // { sid, count, events, header }
  return async (sid) => {
    const sessionsSvc = ctx.get('sessions')
    if (sessionsSvc) {
      try {
        const live = sessionsSvc.get(sid)
        if (live && live.events && typeof live.events.length === 'number') {
          const hit = cache && cache.sid === sid && cache.count === live.events.length
          if (!hit) cache = { sid, count: live.events.length, events: live.events, header: live.header }
          return { events: cache.events, header: cache.header, count: cache.count, changed: !hit }
        }
      } catch (e) {}
    }
    const sp2 = ctx.get('sessionPersistence')
    if (sp2 && cache && cache.sid === sid && cache.events) {
      try {
        const inc = await sp2.readFrom(sid, cache.count)
        const add = (inc && inc.events) || []
        if (add.length === 0) return { events: cache.events, header: cache.header, count: cache.count, changed: false }
        cache = { sid, count: cache.count + add.length, events: cache.events.concat(add), header: (inc && inc.meta) || cache.header }
        return { events: cache.events, header: cache.header, count: cache.count, changed: true }
      } catch (e) {}
    }
    const snap = await sq.readSession(sid)
    const events = (snap && snap.events) || []
    const header = (snap && snap.session) || null
    const hit = cache && cache.sid === sid && cache.count === events.length
    if (!hit) cache = { sid, count: events.length, events, header }
    return { events: cache.events, header: cache.header, count: cache.count, changed: !hit }
  }
}

// ===== 仓库根发现（clone 部署关键）：工具箱数据/产物一律归属「本仓库根」，而非会话 cwd =====
// 场景：本仓库被 clone 到别的项目根目录下当子目录（如 D:\\other\\dsh-dynamic-toolbox\\），
// DSH 在宿主项目根运行——会话 cwd / workspaceRoot 都是宿主项目，若按会话 cwd 落盘会污染宿主。
// 这里先直下找 plugins.json，找不到再扫一级子目录（plugins.json 在子目录里即为本仓库）。
// 数据目录名由仓库根的 toolbox.config.json 配置（dataDir，默认 .dsh-dynamic-toolbox）。
let _repoCache = null // 进程内缓存（仓库位置运行期不变）
const findRepoRoot = async (ctx) => {
  // 原生安装包适用于任意工作区，不把源码仓库 plugins.json 当部署标记。
  if (typeof TOOLBOX_RUNTIME !== 'undefined' && TOOLBOX_RUNTIME.mode === 'static-bundle') return null
  if (_repoCache) return _repoCache
  const fsService = ctx.get('fs')
  if (!fsService) return null
  const roots = []
  const sp = ctx.get('sandboxPolicy')
  if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot) roots.push(sp.workspaceRoot)
  const ss = ctx.get('sessions')
  if (ss) { try { for (const s of ss.list()) { const c = s && s.header && s.header.cwd; if (typeof c === 'string' && c && roots.indexOf(c) < 0) roots.push(c) } } catch (e) {} }
  // 命中校验（MiMo M1）：光「存在 plugins.json」不够（无关项目/无关 clone 子目录也可能有），
  // 必须解析出清单且含 id:'toolbox' 条目——这是本仓库的强标记，杜绝误判锁定错误仓库根。
  const hasManifest = async (dir) => {
    try {
      const t = await fsService.resolve('plugins.json', { cwd: dir })
      if (!await fsService.stat(t)) return null
      const parsed = JSON.parse(await fsService.readText(t))
      if (!parsed || !Array.isArray(parsed.plugins)) return null
      if (!parsed.plugins.some((e) => e && e.id === 'toolbox')) return null
      return dir.replace(/[\\/]+$/, '')
    } catch (e) { return null }
  }
  for (const root of roots) {
    const hit = await hasManifest(root)
    if (hit) { _repoCache = hit; return hit }
  }
  for (const root of roots) {
    try {
      const dt = await fsService.resolve('.', { cwd: root })
      const entries = await fsService.listDir(dt)
      for (const ent of entries || []) {
        if (!ent || ent.type !== 'directory' || !ent.name) continue
        if (ent.name.charAt(0) === '.' || ent.name === 'node_modules') continue
        const sub = root.replace(/[\\/]+$/, '') + '/' + ent.name
        const hit = await hasManifest(sub)
        if (hit) { _repoCache = hit; return hit }
      }
    } catch (e) {}
  }
  return null
}
// 数据目录名：读仓库根 toolbox.config.json 的 dataDir（默认 .dsh-dynamic-toolbox）
let _dataDirCache = null
const repoDataDir = async (ctx) => {
  if (_dataDirCache) return _dataDirCache
  let dir = '.dsh-dynamic-toolbox'
  const fsService = ctx.get('fs')
  const repoRoot = await findRepoRoot(ctx)
  if (fsService && repoRoot) {
    try {
      const cf = await fsService.resolve('toolbox.config.json', { cwd: repoRoot })
      if (await fsService.stat(cf)) {
        const cfg = JSON.parse(await fsService.readText(cf))
        if (cfg && typeof cfg.dataDir === 'string' && /^[A-Za-z0-9._-]+$/.test(cfg.dataDir)) dir = cfg.dataDir
      }
    } catch (e) {}
  }
  _dataDirCache = dir
  return dir
}

// ===== 工作区记录持久化（<仓库根>/<dataDir>/<file>，纯 JSON）=====
// 约定：凡持有「记录/历史」的工具一律落盘仓库根（clone 部署时也不污染宿主项目），面板 state 只做镜像。
// 写策略：有会话按会话 resolve（cwd 即可写边界）；无会话显式 workspace-write@仓库根 ——
// 绝不回落部署默认策略（其可写根是宿主进程 cwd，写工作区会被 FS_SANDBOX_DENIED 拒绝）。
const storePolicy = (ctx, wsRoot, session) => {
  const sp = ctx.get('sandboxPolicy')
  if (sp && session) return sp.resolve({ session })
  return { mode: 'workspace-write', workspaceRoot: wsRoot }
}
const ensureStoreDir = async (ctx, wsRoot) => {
  const subprocess = ctx.get('subprocess')
  if (!subprocess || !wsRoot) return
  try {
    const handle = subprocess.spawn({
      argv: ['node', '-e', "require('fs').mkdirSync(process.argv[1], { recursive: true })", await repoDataDir(ctx)],
      cwd: wsRoot,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
      graceMs: 15000,
    })
    await handle.done
  } catch (e) {}
}
// 数据落盘根：优先仓库根（findRepoRoot），其次调用方给的 wsRoot（向后兼容/兜底）
const storeBase = async (ctx, wsRoot) => {
  const repo = await findRepoRoot(ctx)
  return repo || wsRoot
}
// 数据目录名映射：rel 里的 .dsh-dynamic-toolbox 前缀换成配置的 dataDir（支持自定义目录名）
const mapDataRel = async (ctx, rel) => {
  const dir = await repoDataDir(ctx)
  if (dir === '.dsh-dynamic-toolbox') return rel
  return String(rel).replace(/^\.dsh-dynamic-toolbox/, dir)
}
const readJsonStore = async (ctx, rel, wsRoot, fallback) => {
  const fsService = ctx.get('fs')
  const base = await storeBase(ctx, wsRoot)
  if (!fsService || !base) return fallback
  try {
    const target = await fsService.resolve(await mapDataRel(ctx, rel), { cwd: base })
    if (!await fsService.stat(target)) return fallback
    const parsed = JSON.parse(await fsService.readText(target))
    return parsed == null ? fallback : parsed
  } catch (e) { return fallback }
}
const writeJsonStore = async (ctx, rel, data, wsRoot, session) => {
  const fsService = ctx.get('fs')
  const base = await storeBase(ctx, wsRoot)
  if (!fsService || !base) return false
  try {
    await ensureStoreDir(ctx, base)
    const target = await fsService.resolve(await mapDataRel(ctx, rel), { cwd: base })
    await fsService.writeText(target, JSON.stringify(data, null, 2), undefined, undefined, storePolicy(ctx, base, session))
    return true
  } catch (e) {
    console.error('store 持久化失败 (' + rel + '):', String((e && e.message) || e))
    return false
  }
}

// ===== 工作区解析（AI 类工具共享；等价于各工具曾各自实现的 resolveWs）=====
// 优先按会话 cwd，其次动作透传的 root，最后沙箱工作区根；返回 { root, session }
const resolveWorkspace = (ctx, rootArg, sessionId) => {
  const sessionsSvc = ctx.get('sessions')
  if (sessionId && sessionsSvc) {
    try {
      const s = sessionsSvc.get(sessionId)
      const cwd = s && s.header && s.header.cwd
      if (s && typeof cwd === 'string' && cwd) return { root: cwd.replace(/[\\/]+$/, ''), session: s }
    } catch (e) {}
  }
  if (rootArg && /^([A-Za-z]:[\\/]|\/)/.test(rootArg)) return { root: rootArg.replace(/[\\/]+$/, ''), session: null }
  const sp = ctx.get('sandboxPolicy')
  const root = sp && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot.replace(/[\\/]+$/, '') : ''
  return { root, session: null }
}

// ===== LLM 路由与调用（AI 类工具共享；llm/agentDefaultModel 缺失时优雅降级）=====
// const ai = makeLlmHelper(ctx)
//   await ai.resolveRoute(st)          // 规范化 st.provider/st.model，返回 { providers, models }（模型按 provider 缓存）
//   await ai.chat(st, system, user, timeoutMs?, track?)  // { a, ms, out, route } | { err, ms, route }；120s 超时守卫
//     track = { root, session, tool }：调用结果异步追加进用量台账 .dsh-dynamic-toolbox/toolbox-ai-usage.json（cap 100，不阻塞响应）
//   await ai.rollup(root, tool)        // 台账中该工具的累计 { calls, out }（仅统计成功调用）
//   ai.routeRow(st, route, note)       // provider/model 双下拉 HTML（provider 切换走 data-action-onchange="route"）
// 注意：system 并入首条 user 消息文本（GenerateOptions 的 system 角色 source 契约未公开，此形态与 ask 一致、最稳）。
const AI_USAGE_REL = '.dsh-dynamic-toolbox/toolbox-ai-usage.json'
const makeLlmHelper = (ctx) => {
  const llm = ctx.get('llm')
  const adm = ctx.get('agentDefaultModel')
  const modelsCache = {} // provider -> LlmModelInfo[]
  // provider 拓扑变化（适配器注册/注销）时清空缓存，避免模型清单陈旧（ctx.on 随插件停止自动清理）
  try { ctx.on('llm/adapters-updated', () => { for (const k of Object.keys(modelsCache)) delete modelsCache[k] }) } catch (e) {}

  const listProviders = async () => {
    if (!llm) return []
    try { return (await llm.listProviders()) || [] } catch (e) { return [] }
  }
  const listModels = async (provider) => {
    if (!llm || !provider) return []
    if (modelsCache[provider]) return modelsCache[provider]
    let list = []
    try { list = (await llm.listModels(provider)) || [] } catch (e) {}
    modelsCache[provider] = list
    return list
  }
  // 路由解析：state 选择 → 当前会话默认 → 第一个 provider 的第一个模型；
  // provider 与 model 不匹配时（切换了 provider）回退该 provider 的首个模型
  const resolveRoute = async (st) => {
    const providers = await listProviders()
    if (!providers.length) return { providers: [], models: [] }
    let def = null
    if (adm) {
      try {
        const s = adm.currentSelection && adm.currentSelection()
        if (s && s.provider && s.model) def = s
      } catch (e) {}
    }
    if (!st.provider || !providers.some((p) => p.id === st.provider)) {
      st.provider = def && providers.some((p) => p.id === def.provider) ? def.provider : providers[0].id
      st.model = ''
    }
    const models = await listModels(st.provider)
    if (!st.model || !models.some((m) => m.id === st.model)) {
      st.model = def && def.provider === st.provider && models.some((m) => m.id === def.model)
        ? def.model
        : (models.length ? models[0].id : '')
    }
    return { providers, models }
  }
  const chat = async (st, system, user, timeoutMs, track) => {
    if (!llm) return { err: 'llm 服务不可用' }
    if (!st.provider || !st.model) return { err: '未选择模型路由' }
    const Ctrl = typeof AbortController !== 'undefined' ? AbortController : null
    const ctrl = Ctrl ? new Ctrl() : null
    const cancel = ctrl ? ctx.timeout(() => ctrl.abort(), timeoutMs || 120000) : null
    const t0 = Date.now()
    let text = ''
    let usage = null
    let result
    try {
      const stream = llm.stream({
        provider: st.provider,
        model: st.model,
        messages: [{
          id: 'ai-' + t0,
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: (system ? String(system) + '\n\n' : '') + String(user == null ? '' : user) }],
        }],
        signal: ctrl ? ctrl.signal : undefined,
      })
      for await (const ch of stream) {
        if (!ch) continue
        if (ch.type === 'text-delta') text += ch.text
        else if (ch.type === 'usage') usage = ch.usage
      }
      result = { a: text, ms: Date.now() - t0, out: usage ? usage.outputTokens : null, route: st.provider + '/' + st.model }
    } catch (e) {
      result = { err: String((e && e.message) || e), ms: Date.now() - t0, route: st.provider + '/' + st.model }
    } finally {
      if (cancel) { try { cancel() } catch (e) {} }
    }
    // 用量台账：异步落盘（ensureStoreDir 会起子进程，绝不能阻塞响应）
    if (track && track.root) {
      const rec = { t: t0, tool: String(track.tool || '?'), out: result.out != null ? result.out : null, ms: result.ms || 0, ok: !result.err }
      ;(async () => {
        try {
          const cur = await readJsonStore(ctx, AI_USAGE_REL, track.root, [])
          await writeJsonStore(ctx, AI_USAGE_REL, (Array.isArray(cur) ? cur : []).concat([rec]).slice(-100), track.root, track.session)
        } catch (e) {}
      })()
    }
    return result
  }
  const rollup = async (root, tool) => {
    if (!root) return null
    const cur = await readJsonStore(ctx, AI_USAGE_REL, root, [])
    if (!Array.isArray(cur)) return null
    let calls = 0
    let out = 0
    for (const r of cur) {
      if (r && r.tool === tool && r.ok) { calls++; if (typeof r.out === 'number') out += r.out }
    }
    return { calls, out }
  }
  const routeRow = (st, route, note) =>
    '<div class="tb-row">' +
      '<select class="tb-select" data-field="provider" data-action-onchange="route" title="Provider（切换后自动刷新模型列表）">' +
        route.providers.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === st.provider ? ' selected' : '') + '>' + esc(p.name || p.id) + '</option>').join('') +
      '</select>' +
      '<select class="tb-select tb-mono" data-field="model" title="模型" style="max-width:220px">' +
        route.models.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === st.model ? ' selected' : '') + '>' + esc(m.name || m.id) + '</option>').join('') +
      '</select>' +
      (note ? '<span class="tb-note">' + esc(note) + '</span>' : '') +
    '</div>'
  return { available: Boolean(llm), listProviders, listModels, resolveRoute, chat, rollup, routeRow }
}

// ===== 内容产物目录约定：<仓库根>/<dataDir>/data/<插件key>/ =====
// 与 <dataDir>（工具内部 JSON 状态）分家：这里放人会直接打开的内容产物（Jira 附件、导出件等）。
// 点号目录与仓库 .git 同族、不污染根目录观感；所有插件产物收一处，.gitignore 只需一行 <dataDir>/data/。
// 注：目录名随 toolbox.config.json 的 dataDir；调用方用 resolveDataPath(ctx, rel, wsRoot) 解析绝对路径。
const TOOLBOX_DATA_DIR = '.dsh-dynamic-toolbox/data'
const pluginDataDir = (key) => TOOLBOX_DATA_DIR + '/' + key
// 数据/产物相对路径 → 绝对路径：走仓库根 + 配置的 dataDir（clone 部署归属本仓库，不污染宿主）
const resolveDataPath = async (ctx, rel, wsRoot) => {
  const fsService = ctx.get('fs')
  const base = await storeBase(ctx, wsRoot)
  if (!fsService || !base) return null
  return fsService.resolve(await mapDataRel(ctx, rel), { cwd: base })
}
// 同上的纯字符串绝对路径版（供子进程 argv/env 使用，它们拿不到 FsTarget）
const dataPathAbs = async (ctx, rel, wsRoot) => {
  const base = await storeBase(ctx, wsRoot)
  if (!base) return ''
  return base.replace(/[\\/]+$/, '') + '/' + (await mapDataRel(ctx, rel))
}

// ===== 清单查找（plugins.json，仓库根）：根探测与桩一致（直下 + 一级子目录扫描）=====
// 返回 { manifest, root } 或 null。供需要读清单元数据的工具用（如轨迹工具按条目 modelTools
// 把插件注册的模型工具归「插件」——沙箱内 ctx.tools.get 被刻意降级为 schema 视图，清单是事实源）。
const findManifest = async (ctx) => {
  const fs = ctx.get('fs')
  if (!fs) return null
  const root = await findRepoRoot(ctx)
  if (!root) return null
  try {
    const t = await fs.resolve('plugins.json', { cwd: root })
    if (await fs.stat(t)) return { manifest: JSON.parse(await fs.readText(t)), root }
  } catch (e) {}
  return null
}


// Compatibility seam for features shared with dynamic mode. In a static
// bundle harness.handle is backed by native Remote methods, while model tools
// are registered directly against DSH's tools service.
const nativeBridgeHandlers = new Map()
const callNativeBridge = async (name, request) => {
  const handler = nativeBridgeHandlers.get(name)
  if (!handler) return { ok: false, error: '原生 RPC 未注册: ' + name }
  return await handler(request)
}
const harness = {
  handle(name, handler) {
    if (typeof name !== 'string' || !name || typeof handler !== 'function') return () => {}
    nativeBridgeHandlers.set(name, handler)
    return () => { if (nativeBridgeHandlers.get(name) === handler) nativeBridgeHandlers.delete(name) }
  },
  defineTool,
  registerTool(ctx, tool) {
    const service = ctx.get('tools')
    if (!service || typeof service.register !== 'function') throw new Error('tools 服务不可用')
    const dispose = service.register(tool)
    if (typeof dispose === 'function') ctx.effect(() => dispose)
    return dispose
  },
}

const create_jira = () => {
// ===== jira-tool.js：Jira 工具（Host-only，HTML 面板经工具箱 RPC 渲染）=====
// 复用 host.js 的凭据/子进程/记录持久化逻辑；交互语义同原 client.js
// 归档规范（参考 prompt/Jira.md）：查询成功即自动归档 → .dsh-dynamic-toolbox/data/jira/{key}/ 下写 issue.md
// （人类可读：字段表+描述+附件清单）+ issue.json（面板离线查看的机读副本）+ 下载全部附件；
// 点击记录 = 读本地归档（零 API），行尾「刷新」才重新打 API 并覆盖归档。
// 工单本体（description/附件清单）与预览图（base64，可 MB 级）留闭包 lastIssue/lastPreview——
// 不进 state（state 每次动作来回传输，必须轻量）；重跑后面板按重新查询降级。
// 状态：{ input, records, error, info }

const FETCH_SCRIPT = `
const base = (process.env.JIRA_BASE_URL || '').replace(/\\/+$/, '');
const email = process.env.JIRA_EMAIL || '';
const token = process.env.JIRA_TOKEN || '';
const auth = 'Basic ' + Buffer.from(email + ':' + token).toString('base64');
const FIELDS = 'summary,description,status,priority,issuetype,key,created,updated,attachment,assignee,reporter';
function adfText(node) {
  if (!node) return '';
  if (node.type === 'hardBreak') return '\\n';
  let text = node.text || '';
  if (Array.isArray(node.content)) for (const c of node.content) text += adfText(c);
  if (['paragraph','heading','codeBlock','listItem'].includes(node.type)) text += '\\n';
  return text;
}
(async () => {
  const out = { ok: false, issue: null, error: null };
  try {
    if (!email || !token) { out.error = 'JIRA_EMAIL or JIRA_TOKEN is not configured'; console.log(JSON.stringify(out)); return; }
    const key = process.env.JIRA_ISSUE_KEY || '';
    if (!key) { out.error = 'missing issue key'; console.log(JSON.stringify(out)); return; }
    const url = base + '/rest/api/3/issue/' + encodeURIComponent(key) + '?fields=' + encodeURIComponent(FIELDS);
    const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) { out.error = 'Jira API ' + res.status; console.log(JSON.stringify(out)); return; }
    const data = await res.json();
    const f = data.fields || {};
    const person = (p) => (p && p.displayName) || null;
    out.issue = {
      key: data.key, id: data.id,
      summary: f.summary || null,
      status: f.status && f.status.name || null,
      priority: f.priority && f.priority.name || null,
      issuetype: f.issuetype && f.issuetype.name || null,
      assignee: person(f.assignee), reporter: person(f.reporter),
      created: f.created || null, updated: f.updated || null,
      description: (adfText(f.description) || '').trim(),
      attachments: (f.attachment || []).slice(0, 100).map((a) => ({
        filename: a.filename, size: a.size, author: person(a.author), content: a.content,
      })),
    };
    out.ok = true;
  } catch (e) { out.error = String((e && e.message) || e); }
  console.log(JSON.stringify(out));
})()
`

const ATTACH_SCRIPT = `
const fs = require('fs');
const path = require('path');
const base = (process.env.JIRA_BASE_URL || '').replace(/\\/+$/, '');
const email = process.env.JIRA_EMAIL || '';
const token = process.env.JIRA_TOKEN || '';
const auth = 'Basic ' + Buffer.from(email + ':' + token).toString('base64');
(async () => {
  try {
    const url = process.env.JIRA_ATTACH_URL || '';
    const key = process.env.JIRA_ISSUE_KEY || '';
    const fname = process.env.JIRA_ATTACH_NAME || 'attachment';
    const root = process.env.JIRA_ARCHIVE_ROOT || '.dsh-dynamic-toolbox/data/jira';
    if (!email || !token) { console.log('ERR|JIRA_EMAIL or JIRA_TOKEN is not configured'); return; }
    if (!url.startsWith(base)) { console.log('ERR|attachment url not allowed'); return; }
    const safe = String(fname).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'attachment';
    const dir = path.join(root, key);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, safe);
    const res = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(120000) });
    if (!res.ok) { console.log('ERR|HTTP ' + res.status); return; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) { console.log('ERR|attachment too large'); return; }
    fs.writeFileSync(out, buf);
    console.log('OK|' + out);
    console.log('LEN|' + buf.length);
    if (buf.length <= 5 * 1024 * 1024) console.log('B64|' + buf.toString('base64'));
  } catch (e) { console.log('ERR|' + String((e && e.message) || e)); }
})()
`

// 一键归档脚本：读 .dsh-dynamic-toolbox/jira-issue-in.json（fetchAndArchive 先落盘，规避 Windows 环境变量长度限制），
// 创建 Jira-Issue/{key}/ → 下载全部附件（覆盖同名）→ 写 issue.md（模板参考 prompt/Jira.md）→ 写 issue.json 机读副本
const ARCHIVE_SCRIPT = `
const fs = require('fs');
const path = require('path');
const base = (process.env.JIRA_BASE_URL || '').replace(/\\/+$/, '');
const email = process.env.JIRA_EMAIL || '';
const token = process.env.JIRA_TOKEN || '';
const auth = 'Basic ' + Buffer.from(email + ':' + token).toString('base64');
const cell = (v) => String(v == null || v === '' ? '—' : v).split('|').join('｜').split('\\r\\n').join(' ').split('\\n').join(' ');
const fmtSz = (n) => (n == null || isNaN(Number(n)) ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
(async () => {
  const out = { ok: false, dir: '', archivedAt: '', files: [], errors: [] };
  try {
    const inFile = process.env.JIRA_ISSUE_FILE || '';
    const issue = JSON.parse(fs.readFileSync(inFile, 'utf8'));
    try { fs.unlinkSync(inFile) } catch (e) {}
    const key = String(issue.key || '');
    if (!key) { out.error = 'missing issue key'; console.log(JSON.stringify(out)); return; }
    const root = process.env.JIRA_ARCHIVE_ROOT || '.dsh-dynamic-toolbox/data/jira';
    const dir = path.join(root, key);
    fs.mkdirSync(dir, { recursive: true });
    const atts = Array.isArray(issue.attachments) ? issue.attachments : [];
    for (const a of atts) {
      const fname = String(a.filename || 'attachment').replace(/[\\\\/:*?"<>|]/g, '_').trim() || 'attachment';
      const rec = { filename: a.filename || fname, size: a.size != null ? a.size : null, author: a.author || null, content: a.content || null, path: key + '/' + fname, downloaded: false, error: null };
      try {
        const url = String(a.content || '');
        if (!url.startsWith(base)) throw new Error('附件地址不被允许');
        const res = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(120000) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 20 * 1024 * 1024) throw new Error('附件超过 20MB 上限');
        fs.writeFileSync(path.join(dir, fname), buf);
        rec.size = buf.length;
        rec.downloaded = true;
      } catch (e) { rec.error = String((e && e.message) || e); out.errors.push((a.filename || fname) + ': ' + rec.error); }
      out.files.push(rec);
    }
    out.archivedAt = new Date().toISOString();
    const L = [];
    L.push('# ' + key + ': ' + (issue.summary || '(无标题)'));
    L.push('');
    L.push('| 字段 | 值 |');
    L.push('|------|-----|');
    L.push('| Key | ' + cell(issue.key) + ' |');
    L.push('| ID | ' + cell(issue.id) + ' |');
    L.push('| Type | ' + cell(issue.issuetype) + ' |');
    L.push('| Status | ' + cell(issue.status) + ' |');
    L.push('| Priority | ' + cell(issue.priority) + ' |');
    L.push('| Assignee | ' + cell(issue.assignee) + ' |');
    L.push('| Reporter | ' + cell(issue.reporter) + ' |');
    L.push('| Created | ' + cell(issue.created) + ' |');
    L.push('| Updated | ' + cell(issue.updated) + ' |');
    L.push('');
    L.push('## 描述');
    L.push('');
    L.push(issue.description ? String(issue.description) : '（无描述）');
    L.push('');
    L.push('## 附件清单');
    L.push('');
    if (out.files.length) {
      L.push('| 文件名 | 大小 | 上传者 | 下载路径 |');
      L.push('|--------|------|--------|----------|');
      for (const f of out.files) L.push('| ' + cell(f.filename) + ' | ' + fmtSz(f.size) + ' | ' + cell(f.author) + ' | ./' + cell(f.path.split('/').pop()) + ' |');
    } else {
      L.push('（无附件）');
    }
    L.push('');
    L.push('> 归档时间：' + out.archivedAt + (out.errors.length ? '；部分附件失败：' + out.errors.join('；') : ''));
    fs.writeFileSync(path.join(dir, 'issue.md'), L.join('\\n'));
    fs.writeFileSync(path.join(dir, 'issue.json'), JSON.stringify(Object.assign({}, issue, { archivedAt: out.archivedAt, attachments: out.files }), null, 2));
    out.dir = (root + '/' + key).split('\\\\').join('/');
    out.ok = true;
  } catch (e) { out.error = String((e && e.message) || e); }
  console.log(JSON.stringify(out));
})()
`

// 本地附件预览：只允许读 <cwd>/Jira-Issue/ 下的文件（防路径逃逸），≤5MB 转 base64
const LOCAL_B64_SCRIPT = `
const fs = require('fs');
const path = require('path');
(async () => {
  try {
    const root = path.resolve(process.env.JIRA_ARCHIVE_ROOT || '.dsh-dynamic-toolbox/data/jira');
    const target = path.resolve(root, String(process.env.JIRA_LOCAL_FILE || ''));
    if (target.indexOf(root + path.sep) !== 0) { console.log('ERR|非法路径'); return; }
    const buf = fs.readFileSync(target);
    if (buf.length > 5 * 1024 * 1024) { console.log('ERR|文件较大，暂不支持网页预览'); return; }
    console.log('B64|' + buf.toString('base64'));
  } catch (e) { console.log('ERR|' + String((e && e.message) || e)); }
})()
`

const REL_DATA_DIR = '.dsh-dynamic-toolbox'
const REL_WATCH_FILE = '.dsh-dynamic-toolbox\\jira-watch.json'
const REL_ARCHIVE_DIR = pluginDataDir('jira') // .dsh-dynamic-toolbox/data/jira（shared 约定：内容产物目录）

return {
  name: 'jira-tool',
  inject: ['credentials', 'subprocess', 'timer'],
  apply(ctx) {
    const fsService = ctx.get('fs')
    const subprocess = ctx.get('subprocess')
    let lastIssue = null // 工单本体（闭包持有，不进 state）
    let lastPreview = null // 预览图 { name, data(base64) }（闭包持有，不进 state）

    // sessionId 优先：拿到当前会话 → root 与 session 同时确定（写入策略需要 session 才能按会话 cwd 授权）
    const resolveWs = (rootArg, sessionId) => {
      const sessionsSvc = ctx.get('sessions')
      if (sessionId && sessionsSvc) {
        try {
          const s = sessionsSvc.get(sessionId)
          const cwd = s && s.header && s.header.cwd
          if (s && typeof cwd === 'string' && cwd) return { root: cwd.replace(/[\\/]+$/, ''), session: s }
        } catch (e) {}
      }
      if (rootArg && /^([A-Za-z]:[\\/]|\/)/.test(rootArg)) {
        return { root: rootArg.replace(/[\\/]+$/, ''), session: null }
      }
      if (sessionsSvc) {
        try {
          let hit = null
          for (const s of sessionsSvc.list()) {
            const cwd = s && s.header && s.header.cwd
            if (typeof cwd === 'string' && cwd) hit = s
          }
          if (hit) return { root: hit.header.cwd.replace(/[\\/]+$/, ''), session: hit }
        } catch (e) {}
      }
      const sp = ctx.get('sandboxPolicy')
      const root = sp && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot.replace(/[\\/]+$/, '') : ''
      return { root, session: null }
    }

    const resolveCred = async (ref) => {
      const r = await ctx.credentials.resolve(ref)
      return r ? r.value : undefined
    }
    // ===== 凭据设置（面板内配置，写入 credentials 服务的可写层 —— 与 Harness 设置的 API Key 同机制同存储）=====
    // 三键：JIRA_BASE_URL / JIRA_EMAIL / JIRA_TOKEN。describe 只暴露配置状态与来源、不暴露值；
    // set 拒绝空值（清空走 unset），被只读来源（真实环境变量）遮蔽时 set/unset 会拒绝。
    // 安全约定：输入框永远渲染空值、密文绝不进 state / HTML，每次动作后由 describe 刷新状态。
    const CRED_ROWS = [
      ['JIRA_BASE_URL', 'Base URL', 'credUrl', 'text', '如 https://your-team.atlassian.net'],
      ['JIRA_EMAIL', '邮箱', 'credEmail', 'text', '如 you@example.com'],
      ['JIRA_TOKEN', 'API Token', 'credToken', 'password', 'Atlassian API Token'],
    ]
    const describeCred = async (ref) => {
      try {
        const info = await ctx.credentials.describe(ref)
        if (!info || typeof info !== 'object') return null
        const src = info.source
        return {
          configured: Boolean(info.configured),
          source: typeof src === 'string' ? src : (src && (src.id || src.kind || src.label)) || '',
          writable: info.writable !== false,
        }
      } catch (e) { return null }
    }
    const describeAllCreds = async () => {
      const out = {}
      for (const row of CRED_ROWS) out[row[0]] = await describeCred(row[0])
      return out
    }
    const renderCredSettings = (st) => {
      if (!st.credOpen) return ''
      const info = st.credInfo || {}
      const rows = CRED_ROWS.map(([ref, label, field, type, ph]) => {
        const d = info[ref]
        const pill = d == null
          ? '<span class="tb-pill tb-pill-plain">状态未知</span>'
          : d.configured
            ? '<span class="tb-pill tb-pill-done">已配置' + (d.source ? ' · ' + esc(d.source) : '') + '</span>'
            : '<span class="tb-pill tb-pill-todo">未配置</span>'
        const roHint = d && d.configured && d.writable === false
          ? '<span class="tb-note">被只读来源（环境变量）遮蔽，需在系统环境中修改</span>' : ''
        return '<div class="tb-sec"><span class="tb-sec-label">' + esc(label) + '（' + esc(ref) + '）' + pill + '</span>' +
          '<input class="tb-input tb-mono" type="' + type + '" data-field="' + field + '" value="" placeholder="' + esc(ph) + '（留空保持不变）" autocomplete="off">' +
          roHint + '</div>'
      })
      return '<div class="tb-card">' +
        '<div class="tb-sec-label">Jira 凭据 · 保存到 Harness 凭据存储（与设置的 API Key 同机制，立即生效）</div>' +
        rows.join('') +
        '<div class="tb-row">' +
          '<button type="button" class="tb-btn tb-btn-primary" data-action="save-cred">保存凭据</button>' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-danger-ghost" data-action="clear-cred">清除全部</button>' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="toggle-cred">收起</button>' +
        '</div></div>'
    }
    const baseEnv = async () => {
      const [base, email, token] = await Promise.all([
        resolveCred('JIRA_BASE_URL'),
        resolveCred('JIRA_EMAIL'),
        resolveCred('JIRA_TOKEN'),
      ])
      return {
        JIRA_BASE_URL: base || 'https://your-team.atlassian.net',
        JIRA_EMAIL: email || '',
        JIRA_TOKEN: token || '',
      }
    }
    const runNode = async (script, env, wsRoot) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      const handle = subprocess.spawn({
        argv: ['node', '-'],
        cwd: wsRoot,
        stdio: {
          stdin: { data: script },
          stdout: { maxBytes: 8 * 1024 * 1024 },
          stderr: { maxBytes: 256 * 1024 },
        },
        graceMs: 120000,
        env,
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout.readFrom(0).text
      const stderr = handle.collected.stderr.readFrom(0).text
      if (outcome.exitCode !== 0) return { ok: false, error: (stderr || stdout).slice(0, 500) }
      return { ok: true, stdout }
    }

    const ensureDirPromises = {}
    const ensureDataDir = (wsRoot) => {
      const existing = ensureDirPromises[wsRoot]
      if (existing) return existing
      const p = (async () => {
        if (!subprocess) return
        try {
          const abs = await dataPathAbs(ctx, '.dsh-dynamic-toolbox', wsRoot) // 仓库根的数据目录（随配置的 dataDir）
          const handle = subprocess.spawn({
            argv: ['node', '-e', "require('fs').mkdirSync(process.argv[1], { recursive: true })", abs],
            cwd: wsRoot,
            stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
            graceMs: 30000,
          })
          await handle.done
        } catch (e) {}
      })()
      ensureDirPromises[wsRoot] = p
      return p
    }

    const readJsonFile = async (rel, wsRoot) => {
      if (!fsService) return []
      try {
        const target = await resolveDataPath(ctx, rel, wsRoot)
        if (!target) return []
        const info = await fsService.stat(target)
        if (!info) return []
        const parsed = JSON.parse(await fsService.readText(target))
        return Array.isArray(parsed) ? parsed : []
      } catch (e) { return [] }
    }
    const writeJsonFile = async (rel, data, ws) => {
      if (!fsService) return false
      try {
        await ensureDataDir(ws.root)
        const target = await resolveDataPath(ctx, rel, ws.root)
        if (!target) return false
        // 有会话 → 按会话策略（cwd 即工作区边界）；无会话 → 显式以仓库根为可写根
        // （缺省会回落到部署默认策略，其 root 是宿主进程 cwd，写不进仓库会被 FS_SANDBOX_DENIED 静默吞掉）
        const sp = ctx.get('sandboxPolicy')
        const base = await storeBase(ctx, ws.root)
        const policy = sp && ws.session ? sp.resolve({ session: ws.session }) : { mode: 'workspace-write', workspaceRoot: base }
        await fsService.writeText(target, JSON.stringify(data, null, 2), undefined, undefined, policy)
        return true
      } catch (e) {
        console.error('jira/records 持久化失败:', String((e && e.message) || e))
        return false
      }
    }


    const fmtDate = (iso) => {
      if (!iso) return '—'
      const d = new Date(iso)
      if (isNaN(d.getTime())) return esc(iso)
      return esc(d.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }))
    }
    const getTimeAgo = (iso) => {
      if (!iso) return '未知时间'
      const d = new Date(iso)
      if (isNaN(d.getTime())) return '未知时间'
      const now = new Date()
      const diffMs = now - d
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)
      if (diffMins < 1) return '刚刚'
      if (diffMins < 60) return diffMins + ' 分钟前'
      if (diffHours < 24) return diffHours + ' 小时前'
      if (diffDays < 30) return diffDays + ' 天前'
      return fmtDate(iso)
    }
    const mimeFor = (name) => {
      const n = String(name || '').toLowerCase()
      if (n.indexOf('.png') > -1) return 'image/png'
      if (n.indexOf('.jpg') > -1 || n.indexOf('.jpeg') > -1) return 'image/jpeg'
      if (n.indexOf('.gif') > -1) return 'image/gif'
      if (n.indexOf('.webp') > -1) return 'image/webp'
      if (n.indexOf('.bmp') > -1) return 'image/bmp'
      return 'image/png'
    }
    // 状态 → pill 色调：进行中=蓝、完成=绿、待办=灰、其他=黄
    const statusTone = (s) => {
      const v = String(s || '').toLowerCase()
      if (/完成|已完成|done|closed|resolved|解决|关闭/.test(v)) return 'done'
      if (/进行|progress|开发|处理中|review|评审|测试/.test(v)) return 'active'
      if (/待办|todo|to do|open|新建|未开始|backlog/.test(v)) return 'todo'
      return 'other'
    }

    const fetchIssue = async (key, ws) => {
      const env = await baseEnv()
      env.JIRA_ISSUE_KEY = key
      const res = await runNode(FETCH_SCRIPT, env, ws.root)
      if (!res.ok) return { ok: false, error: res.error }
      return JSON.parse(res.stdout)
    }
    const downloadAttachment = async (url, key, filename, ws) => {
      const env = await baseEnv()
      env.JIRA_ATTACH_URL = url
      env.JIRA_ISSUE_KEY = key
      env.JIRA_ATTACH_NAME = filename
      env.JIRA_ARCHIVE_ROOT = await dataPathAbs(ctx, pluginDataDir('jira'), ws.root) // 绝对路径：归档落仓库根
      const res = await runNode(ATTACH_SCRIPT, env, ws.root)
      if (!res.ok) return res
      let path = ''
      let len = 0
      let b64 = ''
      for (const line of res.stdout.split(/\r?\n/)) {
        if (line.indexOf('OK|') === 0) path = line.slice(3).trim()
        else if (line.indexOf('LEN|') === 0) len = Number(line.slice(4)) || 0
        else if (line.indexOf('B64|') === 0) b64 = line.slice(4)
        else if (line.indexOf('ERR|') === 0) return { ok: false, error: line.slice(4) }
      }
      if (!path) return { ok: false, error: '附件归档失败' }
      if (!/^[A-Za-z]:[\\/]/.test(path) && path.charAt(0) !== '/') path = ws.root + '\\' + path
      return { ok: true, path, len, previewable: b64.length > 0, data: b64 || null }
    }

    // ---- 归档（prompt/Jira.md 规范）：Jira-Issue/{key}/ = issue.md + issue.json + 全部附件 ----
    // issue.json 是面板离线查看的机读副本；issue.md 是人类可读摘要（字段表+描述+附件清单）
    const archiveIssue = async (issue, ws) => {
      const inRel = '.dsh-dynamic-toolbox\\jira-issue-in.json'
      if (!await writeJsonFile(inRel, issue, ws)) return { ok: false, error: '临时文件写入失败' }
      const env = await baseEnv()
      env.JIRA_ISSUE_FILE = await dataPathAbs(ctx, inRel, ws.root)
      env.JIRA_ARCHIVE_ROOT = await dataPathAbs(ctx, pluginDataDir('jira'), ws.root) // 绝对路径：归档落仓库根
      const res = await runNode(ARCHIVE_SCRIPT, env, ws.root)
      if (!res.ok) return { ok: false, error: res.error }
      try { return JSON.parse(res.stdout) } catch (e) { return { ok: false, error: '归档结果解析失败' } }
    }
    // 读本地归档（零 API）；无归档返回 null
    const loadArchive = async (key, ws) => {
      if (!fsService) return null
      try {
        const target = await resolveDataPath(ctx, pluginDataDir('jira') + '/' + key + '/issue.json', ws.root)
        if (!target || !await fsService.stat(target)) return null
        const data = JSON.parse(await fsService.readText(target))
        if (!data || typeof data !== 'object' || !data.key) return null
        return data
      } catch (e) { return null }
    }
    // 归档模式下补下载成功的附件 → 回写 issue.json 对应条目
    const updateArchiveEntry = async (key, filename, size, ws) => {
      const data = await loadArchive(key, ws)
      if (!data || !Array.isArray(data.attachments)) return
      for (const a of data.attachments) {
        if (a && a.filename === filename) { a.downloaded = true; a.error = null; if (size) a.size = size }
      }
      await writeJsonFile(REL_ARCHIVE_DIR + '/' + key + '/issue.json', data, ws)
    }
    // 本地附件预览（base64，≤5MB；LOCAL_B64_SCRIPT 限定 Jira-Issue/ 内）
    const previewLocalFile = async (relPath, ws) => {
      const res = await runNode(LOCAL_B64_SCRIPT, { JIRA_ARCHIVE_ROOT: await dataPathAbs(ctx, pluginDataDir('jira'), ws.root), JIRA_LOCAL_FILE: relPath }, ws.root)
      if (!res.ok) return { ok: false, error: res.error }
      for (const line of res.stdout.split(/\r?\n/)) {
        if (line.indexOf('B64|') === 0) return { ok: true, data: line.slice(4) }
        if (line.indexOf('ERR|') === 0) return { ok: false, error: line.slice(4) }
      }
      return { ok: false, error: '预览读取失败' }
    }
    // 查询 + 自动归档 + 记录落盘（query / view-record 兜底 / refresh-record / refresh-all 共用）
    const fetchAndArchive = async (k, st, ws, opts) => {
      const setView = !opts || opts.setView !== false
      const res = await fetchIssue(k, ws)
      if (!res.ok) return { ok: false, error: res.error }
      const ar = await archiveIssue(res.issue, ws)
      const old = (st.records || []).find((x) => x && x.key === res.issue.key)
      const rec = {
        key: res.issue.key, summary: res.issue.summary, status: res.issue.status, updated: res.issue.updated,
        fetchedAt: new Date().toISOString(),
        archivedAt: (ar.ok && ar.archivedAt) || (old && old.archivedAt) || null,
      }
      const r2 = await runRecords('upsert', rec, ws)
      if (r2.ok) {
        st.records = r2.records
        if (r2.persisted === false) st.info = '⚠ 记录未能写入 .dsh-dynamic-toolbox/jira-watch.json，仅保存在面板内存中'
      }
      if (setView) {
        lastIssue = ar.ok
          ? Object.assign({}, res.issue, { __archived: true, archivedAt: ar.archivedAt, attachments: ar.files })
          : res.issue
        if (ar.ok) {
          const fails = (ar.files || []).filter((f) => !f.downloaded)
          st.info = '已归档 → ' + REL_ARCHIVE_DIR + '/' + res.issue.key + '/（附件 ' + ((ar.files || []).length - fails.length) + '/' + (ar.files || []).length + '）' +
            (fails.length ? '；失败：' + fails.map((f) => f.filename).join('、') : '')
        } else {
          st.info = '⚠ 查询成功但归档失败：' + (ar.error || '未知原因') + '（仅本次内存展示）'
        }
      }
      return { ok: true, archived: Boolean(ar.ok) }
    }

    const render = (st, busy) => {
      const parts = []
      parts.push('<div class="tb-query">' +
        '<input class="tb-input" data-field="key" placeholder="输入 Jira ID，如 PROJ-123" value="' + esc(st.input || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="query"' + (busy ? ' disabled' : '') + '>' + (busy ? '查询中…' : '查询') + '</button>' +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="toggle-cred">' + (st.credOpen ? '收起设置' : '凭据设置') + '</button>' +
      '</div>')
      parts.push(renderCredSettings(st))
      if (st.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(st.error) + '</div>')
      if (st.info) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.info) + '</div>')
      if (lastIssue) {
        const i = lastIssue
        const it = []
        it.push('<div class="tb-card-head">' +
          '<span class="tb-key">' + esc(i.key) + '</span>' +
          '<div class="tb-title">' + esc(i.summary || '(无标题)') + '</div>' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close-issue" title="关闭详情（记录保留在列表中）" style="margin-left:auto">关闭</button>' +
        '</div>')
        const pills = []
        if (i.status) pills.push('<span class="tb-pill tb-pill-' + statusTone(i.status) + '"><span class="tb-dot tb-dot-' + statusTone(i.status) + '"></span>' + esc(i.status) + '</span>')
        if (i.priority) pills.push('<span class="tb-pill tb-pill-plain">优先级 ' + esc(i.priority) + '</span>')
        if (i.issuetype) pills.push('<span class="tb-pill tb-pill-plain">' + esc(i.issuetype) + '</span>')
        if (i.__archived) pills.push('<span class="tb-pill tb-pill-done" title="归档时间 ' + esc(i.archivedAt || '') + '；查看未访问 API">本地归档 · ' + esc(getTimeAgo(i.archivedAt)) + '</span>')
        if (pills.length) it.push('<div class="tb-pills">' + pills.join('') + '</div>')
        it.push('<div class="tb-meta">' + [['经办人', i.assignee], ['报告人', i.reporter], ['创建时间', fmtDate(i.created)], ['更新时间', fmtDate(i.updated)]].map((row) =>
          '<div class="tb-meta-item"><span class="tb-meta-label">' + esc(row[0]) + '</span><span class="tb-meta-value">' + (row[1] == null || row[1] === '' ? '—' : esc(String(row[1]))) + '</span></div>'
        ).join('') + '</div>')
        if (i.description) {
          it.push('<div class="tb-sec"><div class="tb-sec-label">描述</div><div class="tb-desc">' + esc(i.description) + '</div></div>')
        }
        if (i.attachments && i.attachments.length) {
          const isArc = Boolean(i.__archived)
          const failCount = isArc ? i.attachments.filter((a) => !a.downloaded).length : 0
          it.push('<div class="tb-sec"><div class="tb-sec-label">附件 · ' + i.attachments.length +
            (isArc
              ? ' <span class="tb-note">已归档到 ' + esc(REL_ARCHIVE_DIR + '/' + i.key + '/') + (failCount ? '；' + failCount + ' 个失败（行尾「刷新」重试）' : '') + '</span>'
              : ' <button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="download-all"' + (busy ? ' disabled' : '') + '>全部归档</button>') +
            '</div><div class="tb-files">' +
            i.attachments.map((a) => {
              const ext = String((a.filename || '').split('.').pop() || '').toLowerCase()
              const extClass = /^(png|jpe?g|gif|webp|bmp|svg)$/.test(ext) ? 'tb-ext-img'
                : /^(zip|rar|7z|tar|gz)$/.test(ext) ? 'tb-ext-zip'
                : /^(pdf|docx?|xlsx?|pptx?|txt|md|csv|log)$/.test(ext) ? 'tb-ext-doc' : 'tb-ext-gen'
              const extLabel = ext ? ext.slice(0, 4) : 'file'
              if (isArc) {
                if (!a.downloaded) {
                  return '<div class="tb-file" title="归档失败：' + esc(a.error || '') + '（行尾「刷新」重试）">' +
                    '<span class="tb-ext ' + extClass + '">' + esc(extLabel) + '</span>' +
                    '<span class="tb-file-name">' + esc(a.filename || '(未命名)') + '</span>' +
                    '<span class="tb-file-meta">归档失败</span>' +
                    '<span class="tb-file-act">—</span>' +
                  '</div>'
                }
                return '<div class="tb-file" data-action="preview-local" data-path="' + esc(a.path || '') + '" title="本地预览（零 API）">' +
                  '<span class="tb-ext ' + extClass + '">' + esc(extLabel) + '</span>' +
                  '<span class="tb-file-name">' + esc(a.filename || '(未命名)') + '</span>' +
                  '<span class="tb-file-meta">' + esc((a.size != null ? fmtSize(a.size) : '') + (a.author ? ' · ' + a.author : '')) + '</span>' +
                  '<span class="tb-file-act">' + (busy ? '读取中…' : '预览') + '</span>' +
                '</div>'
              }
              return '<div class="tb-file" data-action="download" data-url="' + esc(a.content || '') + '" data-filename="' + esc(a.filename || '') + '" title="点击预览 / 归档">' +
                '<span class="tb-ext ' + extClass + '">' + esc(extLabel) + '</span>' +
                '<span class="tb-file-name">' + esc(a.filename || '(未命名)') + '</span>' +
                '<span class="tb-file-meta">' + esc((a.size != null ? fmtSize(a.size) : '') + (a.author ? ' · ' + a.author : '')) + '</span>' +
                '<span class="tb-file-act">' + (busy ? '下载中…' : '预览') + '</span>' +
              '</div>'
            }).join('') + '</div></div>')
        }
        if (lastPreview && lastPreview.data) {
          it.push('<div class="tb-preview">' +
            '<div class="tb-preview-head"><span class="tb-preview-name">' + esc(lastPreview.name || '预览') + '</span>' +
            '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close-preview">关闭</button></div>' +
            '<img class="tb-preview-img" src="data:' + mimeFor(lastPreview.name) + ';base64,' + lastPreview.data + '" alt="' + esc(lastPreview.name || 'preview') + '" />' +
          '</div>')
        }
        parts.push('<div class="tb-card">' + it.join('') + '</div>')
      }
      const records = st.records || []
      let body = ''
      parts.push('<div class="tb-list-head">' +
        '<span class="tb-list-title">已查询记录<span class="tb-count">' + records.length + '</span></span>' +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="refresh-all"' + (busy || records.length === 0 ? ' disabled' : '') + '>全部刷新</button>' +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-danger-ghost" data-action="clear"' + (records.length === 0 ? ' disabled' : '') + '>清空</button>' +
      '</div>')
      if (records.length === 0) {
        body = '<div class="tb-empty">' +
          '<div class="tb-empty-glyph"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg></div>' +
          '<div class="tb-empty-title">暂无查询记录</div>' +
          '<div class="tb-empty-sub">输入 Jira ID 查询后将自动保存</div>' +
        '</div>'
      } else {
        body = '<div class="tb-list">' + records.map((r) => {
          const tone = statusTone(r.status)
          return '<div class="tb-rec' + (lastIssue && lastIssue.key === r.key ? ' tb-rec-active' : '') + '" data-action="view-record" data-key="' + esc(r.key) + '" title="点击查看本地归档（零 API）">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top">' +
                '<span class="tb-rec-key">' + esc(r.key) + '</span>' +
                (r.summary ? '<span class="tb-rec-summary">' + esc(String(r.summary)) + '</span>' : '') +
              '</div>' +
              '<div class="tb-rec-sub">' +
                (r.status ? '<span class="tb-rec-status"><span class="tb-dot tb-dot-' + tone + '"></span>' + esc(r.status) + '</span>' : '') +
                '<span class="tb-rec-time">' + esc(getTimeAgo(r.updated)) + '</span>' +
                (r.archivedAt
                  ? '<span title="归档时间 ' + esc(r.archivedAt) + '">已归档 · ' + esc(getTimeAgo(r.archivedAt)) + '</span>'
                  : '<span>未归档（点击查看时自动归档）</span>') +
              '</div>' +
            '</div>' +
            '<div class="tb-rec-acts">' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="refresh-record" data-key="' + esc(r.key) + '" title="从 Jira 重新获取并覆盖归档"' + (busy ? ' disabled' : '') + '>刷新</button>' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-danger-ghost" data-action="remove" data-key="' + esc(r.key) + '"' + (busy ? ' disabled' : '') + '>删除</button>' +
            '</div>' +
          '</div>'
        }).join('') + '</div>'
      }
      return '<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">' + parts.join('') + '</div><div class="tb-pane-body tb-pane-col">' + body + '</div></div>'
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWs(root, session)
      if (!ws.root) return { ok: false, error: '无法确定工作区根', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { input: '', records: [], error: null, info: null, credOpen: false, credInfo: null }
      // state 迁移：issue/preview 本体已挪闭包（旧 state 可能还挂着 description/base64 大字段）
      delete st.issue; delete st.preview
      try {
        if (action === 'toggle-cred') {
          st.credOpen = !st.credOpen
          if (st.credOpen) st.credInfo = await describeAllCreds()
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'save-cred') {
          const saved = []
          const failed = []
          for (const [ref, label, field] of CRED_ROWS) {
            const v = String(fields[field] != null ? fields[field] : '').trim()
            if (!v) continue
            try { await ctx.credentials.set(ref, v); saved.push(label) }
            catch (e) { failed.push(label + ': ' + String((e && e.message) || e)) }
          }
          st.credOpen = true
          st.credInfo = await describeAllCreds()
          if (failed.length) st.error = '凭据保存失败 — ' + failed.join('；')
          else st.error = null
          st.info = saved.length ? '已保存 ' + saved.join('、') + ' 到 Harness 凭据存储，下次查询立即生效' : '没有输入新值（留空保持不变）'
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'clear-cred') {
          const failed = []
          for (const [ref, label] of CRED_ROWS) {
            try { await ctx.credentials.unset(ref) }
            catch (e) { failed.push(label + ': ' + String((e && e.message) || e)) }
          }
          st.credOpen = true
          st.credInfo = await describeAllCreds()
          if (failed.length) { st.error = '凭据清除失败 — ' + failed.join('；'); st.info = null }
          else { st.error = null; st.info = '已清除 Jira 凭据（环境变量来源不受影响）' }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'query' || action === 'refresh-record') {
          // query = 输入框主动查询；refresh-record = 记录行尾「刷新」——两者都打 API 并自动归档
          const elKey = fields.__el && fields.__el.key != null ? fields.__el.key : null
          const k = String(elKey != null ? elKey : (fields.key != null ? fields.key : st.input)).trim()
          if (!k || (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(k) && !/^\d+$/.test(k))) { st.error = '非法的 Jira key: ' + k; if (!/^\d+$/.test(k) && k) st.input = k; return { ok: true, html: render(st, false), state: st } }
          st.input = k
          st.error = null
          st.info = null
          lastPreview = null
          const res = await fetchAndArchive(k, st, ws)
          if (!res.ok) {
            st.error = (res.error || '查询失败')
            if (/not configured/i.test(String(res.error || ''))) st.error += '（点「凭据设置」直接配置，立即生效）'
            lastIssue = null
          }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'view-record' || action === 'query-record') {
          // 点击记录 = 读本地归档（零 API）；本地无归档才回退 API + 自动归档
          const elKey = fields.__el && fields.__el.key != null ? fields.__el.key : null
          const k = String(elKey != null ? elKey : (fields.key != null ? fields.key : '')).trim()
          if (!k) { st.error = '缺少 Jira key'; return { ok: true, html: render(st, false), state: st } }
          st.input = k
          st.error = null
          st.info = null
          lastPreview = null
          const arc = await loadArchive(k, ws)
          if (arc) {
            lastIssue = Object.assign({}, arc, { __archived: true })
            st.info = '本地归档（' + getTimeAgo(arc.archivedAt) + '归档）· 未访问 API；点行尾「刷新」可从 Jira 重新获取并覆盖归档'
          } else {
            const res = await fetchAndArchive(k, st, ws)
            if (!res.ok) {
              st.error = '本地无归档，联网获取失败：' + (res.error || '')
              if (/not configured/i.test(String(res.error || ''))) st.error += '（点「凭据设置」直接配置，立即生效）'
              lastIssue = null
            } else if (st.info == null || st.info === '') {
              st.info = '本地无归档，已从 Jira 获取并自动归档'
            }
          }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'download') {
          const el = fields.__el || {}
          const url = String(el.url != null ? el.url : fields.url || '').trim()
          const key = lastIssue && lastIssue.key ? lastIssue.key : ''
          const filename = String(el.filename != null ? el.filename : fields.filename || 'attachment')
          if (!/^https?:\/\//i.test(url)) { st.error = '非法的附件地址'; return { ok: true, html: render(st, false), state: st } }
          st.error = null
          st.info = null
          const res = await downloadAttachment(url, key, filename, ws)
          if (!res.ok) { st.error = res.error || '附件下载失败' }
          else {
            if (lastIssue && lastIssue.__archived) await updateArchiveEntry(key, filename, res.len, ws)
            const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(filename)
            if (res.previewable && isImage) lastPreview = { name: filename, data: res.data }
            else {
              lastPreview = null
              st.info = '已归档：' + res.path + (res.previewable ? '（该类型暂不支持网页预览）' : '（文件较大，暂不支持网页预览）')
            }
          }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'preview-local') {
          // 归档附件的本地预览（零 API）
          const el = fields.__el || {}
          const rel = String(el.path != null ? el.path : fields.path || '')
          const filename = rel.split('/').pop() || 'attachment'
          st.error = null
          st.info = null
          const res = await previewLocalFile(rel, ws)
          if (!res.ok) { st.error = res.error || '预览读取失败' }
          else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(filename)) lastPreview = { name: filename, data: res.data }
          else { lastPreview = null; st.info = '该类型暂不支持网页预览：' + filename + '（文件已在本地归档，可直接打开）' }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'download-all') {
          const list = (lastIssue && Array.isArray(lastIssue.attachments)) ? lastIssue.attachments : []
          const key = lastIssue && lastIssue.key ? lastIssue.key : ''
          if (!list.length) { st.info = '当前工单没有附件'; return { ok: true, html: render(st, false), state: st } }
          st.error = null
          lastPreview = null
          const okNames = []
          const failNames = []
          for (const a of list) {
            const url = String(a.content || '')
            const fname = String(a.filename || 'attachment')
            if (!/^https?:\/\//i.test(url)) { failNames.push(fname + '（非法地址）'); continue }
            const res = await downloadAttachment(url, key, fname, ws)
            if (res.ok) okNames.push(fname)
            else failNames.push(fname + '（' + (res.error || '失败') + '）')
          }
          st.info = '批量归档完成：成功 ' + okNames.length + ' / 共 ' + list.length + ' → ' + REL_ARCHIVE_DIR + '/' + key + '/' +
            (failNames.length ? '；失败：' + failNames.join('、') : '')
          if (!okNames.length && failNames.length) { st.error = '批量归档全部失败：' + failNames.join('、'); st.info = null }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'close-preview') {
          lastPreview = null
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'close-issue') {
          // 关闭详情卡（记录保留在列表中，再点行可重新查看本地归档）
          lastIssue = null
          lastPreview = null
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'remove') {
          const elKey = fields.__el && fields.__el.key != null ? fields.__el.key : fields.key
          const r2 = await runRecords('remove', null, ws, String(elKey || ''))
          if (r2.ok) {
            st.records = r2.records
            if (lastIssue && lastIssue.key === elKey) lastIssue = null
          }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'clear') {
          const r2 = await runRecords('clear', null, ws)
          if (r2.ok) { st.records = []; lastIssue = null; lastPreview = null }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'refresh-all') {
          st.error = null
          st.info = null
          const list = (st.records || []).slice()
          for (const r of list) {
            const res = await fetchAndArchive(r.key, st, ws, { setView: false })
            if (!res.ok) st.error = (res.error || '') + '（' + r.key + '）'
          }
          if (!st.error) st.info = '全部刷新完成（已重新归档 ' + list.length + ' 个工单）'
          return { ok: true, html: render(st, false), state: st }
        }
        // 默认（''）：加载记录列表
        const r0 = await runRecords('list', null, ws)
        if (r0.ok) st.records = r0.records
        return { ok: true, html: render(st, false), state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '' }
      }
    }

    const runRecords = async (action, rec, ws, key) => {
      try {
        if (action === 'list') return { ok: true, records: await readJsonFile(REL_WATCH_FILE, ws.root) }
        if (action === 'upsert') {
          if (!rec || typeof rec.key !== 'string' || !rec.key) return { ok: false, error: 'record.key 必填' }
          const records = await readJsonFile(REL_WATCH_FILE, ws.root)
          const idx = records.findIndex((r) => r && r.key === rec.key)
          if (idx >= 0) records[idx] = rec
          else records.push(rec)
          const persisted = await writeJsonFile(REL_WATCH_FILE, records, ws)
          return { ok: true, records, persisted }
        }
        if (action === 'remove') {
          const records = await readJsonFile(REL_WATCH_FILE, ws.root)
          const next = records.filter((r) => !r || r.key !== key)
          const persisted = await writeJsonFile(REL_WATCH_FILE, next, ws)
          return { ok: true, records: next, persisted }
        }
        if (action === 'clear') {
          const persisted = await writeJsonFile(REL_WATCH_FILE, [], ws)
          return { ok: true, records: [], persisted }
        }
        return { ok: false, error: '未知 action: ' + String(action) }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }

    tryRegisterTool(ctx, { id: 'jira', label: 'Jira', order: 0, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 6.5h6M5 9.5h4"/></svg>' }, handler)
  },
}
}

const create_git = () => {
// ===== git-tool.js：Git 历史工具（Host-only，HTML 面板经工具箱 RPC 渲染）=====
// 视图状态机：list / detail / diff；动作：refresh、more、open(hash)、diff(path)、wdiff(path)、back
// 变更清单点击文件 → 工作区/暂存区 diff（未暂存优先；未跟踪新文件走 git diff --no-index /dev/null）
// diff 本体留闭包 lastDiff（可能很大，不进 state——state 每次动作来回传输，必须轻量）
// 状态：{ view, branch, staged, unstaged, untracked, ahead, behind, files, commits, hasMore, offset, detail, diffFrom }

return {
  name: 'git-tool',
  inject: ['subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    let lastDiff = null // { text, name, note } diff 本体（闭包持有，不进 state；重跑即清空回列表/详情）

    const resolveWs = (rootArg) => {
      if (rootArg && /^([A-Za-z]:[\\/]|\/)/.test(rootArg)) {
        return rootArg.replace(/[\\/]+$/, '')
      }
      const sessionsSvc = ctx.get('sessions')
      if (sessionsSvc) {
        try {
          for (const s of sessionsSvc.list()) {
            const cwd = s && s.header && s.header.cwd
            if (typeof cwd === 'string' && cwd && cwd) return cwd.replace(/[\\/]+$/, '')
          }
        } catch (e) {}
      }
      const sp = ctx.get('sandboxPolicy')
      return sp && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot.replace(/[\\/]+$/, '') : ''
    }

    const runGit = async (args, root) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const handle = subprocess.spawn({
          argv: ['git', ...args],
          cwd: root,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 16 * 1024 * 1024 }, stderr: { maxBytes: 256 * 1024 } },
          graceMs: 60000,
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout.readFrom(0).text
        const stderr = handle.collected.stderr.readFrom(0).text
        return { ok: outcome.exitCode === 0, code: outcome.exitCode, out: stdout, err: stderr }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
    const firstLine = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 3).join(' | ')

    // 仓库顶层目录（porcelain/numstat 路径都相对它）：工作区是子目录时 diff pathspec 仍能对上
    const topCache = {}
    const repoTop = async (root) => {
      if (topCache[root] !== undefined) return topCache[root]
      const r = await runGit(['rev-parse', '--show-toplevel'], root)
      topCache[root] = r.ok && String(r.out || '').trim() ? String(r.out).trim() : null
      return topCache[root]
    }

    const loadStatus = async (root) => {
      const br = await runGit(['symbolic-ref', '--short', 'HEAD'], root)
      if (!br.ok) {
        const rp = await runGit(['rev-parse', '--short', 'HEAD'], root)
        if (!rp.ok) return { error: firstLine(br.err) || firstLine(rp.err) || 'not a git repository' }
        return { branch: '(detached ' + (rp.out || '').trim() + ')', staged: 0, unstaged: 0, untracked: 0, ahead: null, behind: null, files: [] }
      }
      const branch = (br.out || '').trim() || 'HEAD'
      // -z：路径零转义零引用（中文名可读、可直接当 diff pathspec）；R/C 条目下一条记录是源路径（跳过）
      const st = await runGit(['status', '--porcelain', '-z'], root)
      let staged = 0
      let unstaged = 0
      let untracked = 0
      const files = []
      const recs = (st.out || '').split('\0')
      for (let i = 0; i < recs.length; i++) {
        const line = recs[i]
        if (!line) continue
        const xy = line.slice(0, 2)
        const filePath = line.substring(3)
        if (xy[0] === 'R' || xy[0] === 'C') i++ // 跳过重命名/复制的源路径记录
        let display = ' '
        if (xy === '??') { display = 'U'; untracked++ }
        else {
          if (xy[0] !== ' ' && xy[0] !== '?') { display = xy[0]; staged++ }
          if (xy[1] !== ' ' && xy[1] !== '?') { unstaged++ }
          if (display === ' ' && xy[1] !== ' ' && xy[1] !== '?') display = xy[1]
        }
        files.push({ path: filePath, status: display, xy })
      }
      let ahead = null
      let behind = null
      const up = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root)
      if (up.ok) {
        const a = await runGit(['rev-list', '--count', '@{upstream}..HEAD'], root)
        const b = await runGit(['rev-list', '--count', 'HEAD..@{upstream}'], root)
        ahead = a.ok ? (parseInt((a.out || '0').trim(), 10) || 0) : null
        behind = b.ok ? (parseInt((b.out || '0').trim(), 10) || 0) : null
      }
      return { branch, staged, unstaged, untracked, ahead, behind, files }
    }

    const loadHistory = async (root, skip, limit) => {
      const r = await runGit(['log', '--skip=' + skip, '-n', String(limit + 1), '--pretty=format:%x1e%H%x1f%an%x1f%aI%x1f%s'], root)
      if (!r.ok) {
        if (/does not have any commits yet|ambiguous argument/i.test(r.err)) return { commits: [], hasMore: false, error: null }
        return { commits: [], hasMore: false, error: firstLine(r.err) || 'git log failed' }
      }
      const commits = []
      for (const block of (r.out || '').split('\x1e')) {
        if (!block) continue
        const parts = block.split('\x1f')
        const hash = parts[0] || ''
        if (!hash) continue
        commits.push({ hash, short: hash.slice(0, 7), author: parts[1] || '', date: parts[2] || '', subject: parts.slice(3).join('\x1f') || '' })
      }
      return { commits: commits.slice(0, limit), hasMore: commits.length > limit, error: null }
    }

    const loadCommit = async (root, hash) => {
      if (!/^[0-9a-fA-F]{7,40}$/.test(hash)) return { error: '非法的 commit hash' }
      const r = await runGit(['show', '--numstat', '--format=%x1e%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e', hash], root)
      if (!r.ok) return { error: firstLine(r.err) || 'git show failed' }
      const parts = (r.out || '').split('\x1e')
      const head = parts[1] || ''
      const body = (parts[2] || '').replace(/^\s+/, '')
      const files = []
      for (const line of body.split(/\r?\n/)) {
        if (!line) continue
        const m = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/)
        if (!m) continue
        files.push({ path: m[3], additions: m[1] === '-' ? null : Number(m[1]), deletions: m[2] === '-' ? null : Number(m[2]) })
      }
      const hp = head.split('\x1f')
      return { commit: { hash: hp[0] || '', short: (hp[0] || '').slice(0, 7), author: hp[1] || '', date: hp[2] || '', subject: hp[3] || '', message: hp.slice(4).join('\x1f').trim(), files } }
    }

    const loadDiff = async (root, hash, path) => {
      if (!/^[0-9a-fA-F]{7,40}$/.test(hash)) return { error: '非法的 commit hash' }
      if (!path || path.length > 1000 || path.indexOf('\x00') >= 0) return { error: '非法的文件路径' }
      const r = await runGit(['show', '--format=', '--no-color', hash, '--', path], root)
      if (!r.ok) return { error: firstLine(r.err) || 'git diff failed' }
      return { diff: r.out || '' }
    }

    // 工作区/暂存区变更 diff（变更清单点击）：xy 为 porcelain 两位状态。
    // 未暂存（xy[1]）优先；其次已暂存（xy[0]）；未跟踪新文件走 --no-index /dev/null（有差异时 exit 1 属正常）
    const loadWorkDiff = async (root, path, xy) => {
      if (!path || path.length > 1000 || path.indexOf('\x00') >= 0) return { error: '非法的文件路径' }
      if (xy === '??') {
        const r = await runGit(['diff', '--no-index', '--no-color', '--', '/dev/null', path], root)
        if (!r.ok && r.code !== 1) return { error: firstLine(r.err) || '读取新文件失败' }
        return { diff: r.out || '', note: '新文件（未跟踪）· 全文即新增' }
      }
      if (xy && xy[1] && xy[1] !== ' ' && xy[1] !== '?') {
        const r = await runGit(['diff', '--no-color', '--', path], root)
        if (!r.ok) return { error: firstLine(r.err) || 'git diff failed' }
        return { diff: r.out || '', note: '工作区（未暂存）变更' }
      }
      const r = await runGit(['diff', '--cached', '--no-color', '--', path], root)
      if (!r.ok) return { error: firstLine(r.err) || 'git diff --cached failed' }
      return { diff: r.out || '', note: '已暂存变更' }
    }

    const fmtDate = (iso) => {
      if (!iso) return ''
      const d = new Date(iso)
      if (isNaN(d.getTime())) return esc(iso)
      return esc(d.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }))
    }
    const STATUS_CLS = { M: 'tb-tx-warn', A: 'tb-tx-done', D: 'tb-tx-danger', R: 'tb-tx-active', C: 'tb-tx-done', U: 'tb-tx-muted' }

    const renderList = (st) => {
      const parts = []
      parts.push('<div class="tb-row">')
      if (st.branch) parts.push('<span class="tb-key" title="当前分支">⎇ ' + esc(st.branch) + '</span>')
      if (st.staged > 0) parts.push('<span class="tb-pill tb-pill-done" title="已暂存变更">已暂存 ' + st.staged + '</span>')
      if (st.unstaged > 0) parts.push('<span class="tb-pill tb-pill-other" title="未暂存变更">修改 ' + st.unstaged + '</span>')
      if (st.untracked > 0) parts.push('<span class="tb-pill tb-pill-todo" title="未跟踪文件">未跟踪 ' + st.untracked + '</span>')
      if (st.ahead != null && st.ahead > 0) parts.push('<span class="tb-pill tb-pill-done" title="领先上游提交数">↑' + st.ahead + '</span>')
      if (st.behind != null && st.behind > 0) parts.push('<span class="tb-pill tb-pill-other" title="落后上游提交数">↓' + st.behind + '</span>')
      parts.push('<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button>')
      parts.push('</div>')
      if ((st.files || []).length > 0) {
        parts.push('<div class="tb-sec"><div class="tb-sec-label">变更 · ' + st.files.length + '（点击查看 diff）</div><div>' + st.files.slice(0, 120).map((f) =>
          '<div class="tb-line" data-action="wdiff" data-path="' + esc(f.path) + '" data-xy="' + esc(f.xy || '') + '" title="点击查看变更 diff" style="cursor:pointer"><span class="tb-line-status ' + (STATUS_CLS[f.status] || 'tb-tx-muted') + '">' + esc(f.status) + '</span><span class="tb-line-path" title="' + esc(f.path) + '">' + esc(f.path) + '</span></div>'
        ).join('') + '</div></div>')
        if (st.files.length > 120) parts.push('<div class="tb-note" style="padding-top:4px">…及更多 ' + (st.files.length - 120) + ' 项</div>')
        parts.push('<div class="tb-hr"></div>')
      }
      const commits = st.commits || []
      if (commits.length === 0) {
        parts.push('<div class="tb-note" style="text-align:center;padding:14px 0">暂无提交历史</div>')
      } else {
        parts.push('<div class="tb-list">' + commits.map((c) =>
          '<div class="tb-rec" data-action="open" data-hash="' + esc(c.hash) + '" title="点击查看提交详情">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-rec-key">' + esc(c.short) + '</span><span class="tb-rec-summary">' + esc(c.subject || '(无标题)') + '</span></div>' +
              '<div class="tb-rec-sub"><span>' + esc(c.author || '') + '</span><span>' + fmtDate(c.date) + '</span></div>' +
            '</div>' +
          '</div>'
        ).join('') + '</div>')
        if (st.hasMore) parts.push('<button type="button" class="tb-btn" data-action="more">加载更多</button>')
      }
      return '<div class="jr-tabpanel tb-root">' + parts.join('') + '</div>'
    }

    const renderDetail = (st) => {
      const d = st.detail
      const parts = []
      parts.push('<div class="tb-row"><button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="back">‹ 返回</button></div>')
      parts.push('<div class="tb-card">' +
        '<div class="tb-card-head"><span class="tb-key">' + esc(d.short) + '</span><div class="tb-title">' + esc(d.subject || '(无标题)') + '</div></div>' +
        '<div class="tb-rec-sub"><span>' + esc(d.author || '') + '</span><span>' + fmtDate(d.date) + '</span></div>' +
        (d.message ? '<div class="tb-desc">' + esc(d.message) + '</div>' : '') +
      '</div>')
      const files = d.files || []
      parts.push('<div class="tb-sec"><div class="tb-sec-label">文件变更 · ' + files.length + '</div>' +
        (files.length
          ? '<div class="tb-files">' + files.map((f) =>
              '<div class="tb-file" data-action="diff" data-path="' + esc(f.path) + '" title="点击查看 diff">' +
                '<span class="tb-file-name tb-mono">' + esc(f.path) + '</span>' +
                (f.additions != null ? '<span class="tb-num tb-tx-done">+' + f.additions + '</span>' : '') +
                (f.deletions != null ? '<span class="tb-num tb-tx-danger">-' + f.deletions + '</span>' : '') +
              '</div>'
            ).join('') + '</div>'
          : '<div class="tb-note">无文件变更</div>') +
      '</div>')
      return '<div class="jr-tabpanel tb-root">' + parts.join('') + '</div>'
    }

    const renderDiff = (st) => {
      const d = lastDiff || { text: '', name: '', note: '' }
      return '<div class="jr-tabpanel tb-root">' +
        '<div class="tb-row">' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="back-diff">‹ 返回</button>' +
          (d.note ? '<span class="tb-pill tb-pill-other">' + esc(d.note) + '</span>' : '') +
          '<span class="tb-file-name tb-mono" style="flex:1;word-break:break-all;white-space:normal">' + esc(d.name || '') + '</span>' +
        '</div>' +
        (d.text
          ? '<pre class="tb-code">' + esc(d.text) + '</pre>'
          : '<div class="tb-notice">（无文本差异）</div>') +
      '</div>'
    }

    const handler = async ({ action, fields, state, root }) => {
      const wsRoot = resolveWs(root)
      if (!wsRoot) return { ok: false, error: '无法确定工作区根', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : {
        view: 'list', branch: null, staged: 0, unstaged: 0, untracked: 0,
        ahead: null, behind: null, files: [], commits: [], hasMore: false, offset: 0,
        detail: null, diffFrom: null, error: null,
      }
      try {
        const elHash = fields.__el && fields.__el.hash ? fields.__el.hash : fields.hash
        const elPath = fields.__el && fields.__el.path ? fields.__el.path : fields.path
        const elXy = fields.__el && typeof fields.__el.xy === 'string' ? fields.__el.xy : ''
        // state 迁移：diff 本体已挪闭包（旧 state 可能还挂着 diff/diffName/diffNote 大字段）
        delete st.diff; delete st.diffName; delete st.diffNote
        if (action === 'open' && elHash) {
          const res = await loadCommit(wsRoot, String(elHash))
          if (res.error) { st.error = res.error }
          else { st.detail = res.commit; st.view = 'detail'; lastDiff = null }
        } else if (action === 'diff' && elPath && st.detail) {
          const gr = (await repoTop(wsRoot)) || wsRoot // numstat 路径相对仓库顶层
          const res = await loadDiff(gr, st.detail.hash, String(elPath))
          if (res.error) st.error = res.error
          else { lastDiff = { text: res.diff, name: String(elPath), note: '' }; st.view = 'diff'; st.diffFrom = 'detail' }
        } else if (action === 'wdiff' && elPath) {
          const gr = (await repoTop(wsRoot)) || wsRoot // porcelain 路径相对仓库顶层
          const res = await loadWorkDiff(gr, String(elPath), elXy)
          if (res.error) st.error = res.error
          else { lastDiff = { text: res.diff, name: String(elPath), note: res.note || '' }; st.view = 'diff'; st.diffFrom = 'list' }
        } else if (action === 'back') {
          st.view = 'list'; st.detail = null; lastDiff = null
        } else if (action === 'back-diff') {
          st.view = st.diffFrom === 'list' ? 'list' : 'detail'
          lastDiff = null
          if (st.view === 'detail' && !st.detail) st.view = 'list'
        } else if (action === 'more') {
          const res = await loadHistory(wsRoot, st.offset, 30)
          if (res.error) st.error = res.error
          else { st.commits = (st.commits || []).concat(res.commits || []); st.offset += res.commits.length; st.hasMore = res.hasMore }
        } else if (action === 'refresh' || action === '' || action === undefined) {
          const s = await loadStatus(wsRoot)
          if (s.error) { st.error = s.error }
          else { st.branch = s.branch; st.staged = s.staged; st.unstaged = s.unstaged; st.untracked = s.untracked; st.ahead = s.ahead; st.behind = s.behind; st.files = s.files }
          if (action !== 'refresh' || st.commits.length === 0) {
            const h = await loadHistory(wsRoot, 0, 30)
            if (!h.error) { st.commits = h.commits; st.offset = h.commits.length; st.hasMore = h.hasMore }
            else st.error = h.error
          }
          st.view = 'list'
          lastDiff = null
        }
        const html = (st.error ? '<div class="tb-banner tb-banner-error">' + esc(st.error) + '</div>' : '') +
          (st.view === 'diff' && lastDiff ? renderDiff(st) : (st.view === 'detail' && st.detail ? renderDetail(st) : renderList(st)))
        const next = { ...st }
        delete next.error
        return { ok: true, html, state: next }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '' }
      }
    }

    tryRegisterTool(ctx, { id: 'git', label: 'Git 历史', order: 1, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="4" cy="4" r="1.7"/><circle cx="12" cy="4" r="1.7"/><circle cx="12" cy="12" r="1.7"/><path d="M5.7 4H10.3"/><path d="M12 5.7V10.3"/></svg>' }, handler)
  },
}
}

const create_files = () => {
// ===== files-tool.js：工作区文件工具（Host-only，HTML 面板经工具箱 RPC 渲染）=====
// 状态：{ dirs: {路径: 条目[]}, expanded: {路径: bool} }，由客户端回传（无损 JSON）

return {
  name: 'files-tool',
  inject: ['fs', 'timer'],
  apply(ctx) {
    const fsService = ctx.get('fs')

    const resolveWs = (rootArg) => {
      if (rootArg && /^([A-Za-z]:[\\/]|\/)/.test(rootArg)) {
        return { root: rootArg.replace(/[\\/]+$/, ''), session: null }
      }
      const sessionsSvc = ctx.get('sessions')
      if (sessionsSvc) {
        try {
          let hit = null
          for (const s of sessionsSvc.list()) {
            const cwd = s && s.header && s.header.cwd
            if (typeof cwd === 'string' && cwd) hit = s
          }
          if (hit) return { root: hit.header.cwd.replace(/[\\/]+$/, ''), session: hit }
        } catch (e) {}
      }
      const sp = ctx.get('sandboxPolicy')
      const root = sp && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot.replace(/[\\/]+$/, '') : ''
      return { root, session: null }
    }

    const sortEntries = (entries) => entries
      .slice()
      .sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return (a.name || '').localeCompare(b.name || '')
      })
      .map((e) => ({ name: e.name, type: e.type, size: typeof e.size === 'number' ? e.size : null }))

    const ensureRoot = async (st, base) => {
      if (st.dirs['/']) return
      const target = await fsService.resolve('.', { cwd: base })
      st.dirs['/'] = sortEntries(await fsService.listDir(target))
    }

    // 树图标（内联 SVG，stroke 跟随 currentColor，颜色由 tb-tree-* 类控制）
    const ICO_CHEV = '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5l4.5 4.5L6 12.5"/></svg>'
    const ICO_FOLDER = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.8v6.7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V6.2a1 1 0 0 0-1-1H8.1L6.9 4a1 1 0 0 0-.7-.3H3.5a1 1 0 0 0-1 1z"/></svg>'
    const ICO_FILE = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5h4.8l3.2 3.2v7.8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/><path d="M8.8 2.5v3.2h3.2"/></svg>'

    const MAX_PER_DIR = 300 // 单文件夹渲染上限（node_modules 级目录防爆 HTML）
    const renderTree = (dirs, expanded) => {
      const rows = []
      const walk = (dirPath, depth) => {
        const key = dirPath || '/'
        const list = dirs[key] || []
        if (!list.length && dirPath) return
        const pad = (depth * 16 + 2) + 'px'
        const shown = list.length > MAX_PER_DIR ? list.slice(0, MAX_PER_DIR) : list
        for (const e of shown) {
          const fullPath = dirPath ? dirPath + '/' + e.name : e.name
          const isDir = e.type === 'directory'
          const isOpen = !!expanded[fullPath]
          if (isDir) {
            rows.push('<div class="tb-tree-row tb-tree-dir' + (isOpen ? ' tb-tree-open' : '') + '" style="padding-left:' + pad + '" data-action="expand" data-path="' + esc(fullPath) + '" title="' + esc(fullPath) + '">' +
              '<span class="tb-tree-chevron">' + ICO_CHEV + '</span>' +
              '<span class="tb-tree-ic">' + ICO_FOLDER + '</span>' +
              '<span class="tb-tree-name">' + esc(e.name) + '</span></div>')
            if (isOpen) walk(fullPath, depth + 1)
          } else {
            rows.push('<div class="tb-tree-row tb-tree-file" style="padding-left:' + pad + '" title="' + esc(fullPath) + '" data-action="preview" data-path="' + esc(fullPath) + '">' +
              '<span class="tb-tree-chevron"></span>' +
              '<span class="tb-tree-ic">' + ICO_FILE + '</span>' +
              '<span class="tb-tree-name">' + esc(e.name) + '</span>' +
              '<span class="tb-tree-size">' + fmtSize(e.size) + '</span></div>')
          }
        }
        if (list.length > MAX_PER_DIR) {
          rows.push('<div class="tb-tree-row" style="padding-left:' + pad + '"><span class="tb-tree-chevron"></span>' +
            '<span class="tb-note">… 还有 ' + (list.length - MAX_PER_DIR) + ' 个条目未显示（共 ' + list.length + '）</span></div>')
        }
      }
      walk('', 0)
      return rows.join('\n')
    }

    // 文本预览：常见代码/文本扩展名才读；其余（图片/二进制/压缩包）提示不支持
    const PREVIEW_CAP = 16 * 1024
    const TEXT_EXTS = /^(txt|md|markdown|json|jsonc|js|mjs|cjs|ts|tsx|jsx|css|html?|xml|ya?ml|toml|ini|env|sh|ps1|bat|cmd|py|java|go|rs|c|h|cpp|hpp|cs|sql|vue|svelte|log|csv|gitignore|gitattributes|editorconfig|lock|rc)$/
    const previewFile = async (rel, wsRoot) => {
      const ext = String(rel.split('.').pop() || '').toLowerCase()
      if (!TEXT_EXTS.test(ext)) return { error: '该类型（.' + ext + '）暂不支持文本预览' }
      const target = await fsService.resolve(rel, { cwd: wsRoot })
      if (!await fsService.stat(target)) return { error: '文件不存在: ' + rel }
      const text = await fsService.readText(target)
      return { text: text.length > PREVIEW_CAP ? text.slice(0, PREVIEW_CAP) : text, truncated: text.length > PREVIEW_CAP, total: text.length }
    }

    const handler = async ({ action, fields, state, root }) => {
      const ws = resolveWs(root)
      if (!ws.root) return { ok: false, error: '无法确定工作区根', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { dirs: {}, expanded: {}, preview: null, previewError: null }
      try {
        const elPath = fields.__el && fields.__el.path ? fields.__el.path : fields.path
        if (action === 'expand' && elPath) {
          const p = String(elPath)
          const willOpen = !(st.expanded || {})[p]
          st.expanded = { ...(st.expanded || {}), [p]: willOpen }
          st.dirs = st.dirs || {}
          if (willOpen && !st.dirs[p]) {
            const target = await fsService.resolve(p || '.', { cwd: ws.root })
            st.dirs[p] = sortEntries(await fsService.listDir(target))
          }
        } else if (action === 'preview' && elPath) {
          const p = String(elPath)
          // state 只记路径（本体每次动作重读，保持 state 轻量）；再点同一文件 = 收起
          st.preview = st.preview && st.preview.path === p ? null : { path: p }
        } else if (action === 'close-preview') {
          st.preview = null
        } else if (action === 'refresh') {
          st.dirs = {}
          st.expanded = {}
          st.preview = null
        }
        await ensureRoot(st, ws.root)
        const rows = renderTree(st.dirs, st.expanded || {})
        const rootName = ws.root.split(/[\\/]/).filter(Boolean).pop() || '工作区'
        let previewHtml = ''
        if (st.preview && st.preview.path) {
          try {
            const r = await previewFile(st.preview.path, ws.root)
            previewHtml = r.error
              ? '<div class="tb-banner tb-banner-info">' + esc(st.preview.path + '：' + r.error) + '</div>'
              : '<div class="tb-preview"><div class="tb-preview-head">' +
                '<span class="tb-preview-name">' + esc(st.preview.path) + '</span>' +
                '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close-preview">关闭</button></div>' +
                '<pre class="tb-code">' + esc(r.text) + (r.truncated ? '\n…（截断，共 ' + r.total + ' 字符）' : '') + '</pre></div>'
          } catch (e) {
            previewHtml = '<div class="tb-banner tb-banner-error">预览失败: ' + esc(String((e && e.message) || e)) + '</div>'
          }
        }
        const html = '<div class="jr-tabpanel tb-root">' +
            '<div class="tb-row"><span class="tb-key" title="' + esc(ws.root) + '">' + esc(rootName) + '</span>' +
            '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button></div>' +
            previewHtml +
            '<div class="tb-tree">' + rows + '</div>' +
            (rows ? '' : '<div class="tb-notice">空目录</div>') +
          '</div>'
        return { ok: true, html, state: { dirs: st.dirs, expanded: st.expanded, preview: st.preview } }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '' }
      }
    }

    tryRegisterTool(ctx, { id: 'files', label: '文件', order: 2, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5a1.5 1.5 0 0 1 1.5-1.5h3L8.5 6h4A1.5 1.5 0 0 1 14 7.5v3a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 10.5z"/></svg>' }, handler)
  },
}
}

const create_flow = () => {
// ===== flow-tool.js：实时流镜（Host-only，经工具箱 RPC 注册）=====
// 当前 session 在干什么 → 自上而下不断加载的流程图（与「轨迹」工具互补：轨迹是过滤时间线，流程图是形态视图）。
// 形态约定（用户定制）：
//   · 主 session：自上而下箭头串联 用户消息 → 助手 → 工具组 → 助手 …（最新在底部，滚动条贴底跟随）
//   · 子代理（subagent/workflow/ralph）：git 树形式——从主干 ├─ 分出支线，支线内实时展示子会话事件流，╰─ 合并回主干
//   · 插件/技能/MCP/命令/文件 等普通工具调用：同一步骤内的多个调用 → 平行卡片并排（调用并返回成组）
// 实时：面板根带 data-autorefresh="2000"，框架抽屉每 2s 静默重拉（live 开关可暂停）。
// 钻取：点子代理分支「进入 →」切换到该子会话的流程图（当前会话压 crumbs 栈，「← 返回」逐级退回）。
// 数据源：sessionQuery（makeSessionLogReader 缓存；子代理会话按 id 各自缓存读取器）。
// 状态：{ live, sid, home, expanded, crumbs }（轻量标量；事件本体与流程模型每次动作重建，不进 state）

return {
  name: 'flow-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')
    const fs = ctx.get('fs')

    // ---- 会话日志读取缓存（主会话 + 每个子代理会话各一个读取器，避免缓存抖动）----
    const readers = {}
    const growth = {} // sid → 上次渲染的日志条数：本轮条数增长 = 会话活跃（助手卡流光判定用）
    const readLog = async (sid) => {
      if (!sq) return { events: [], count: 0 }
      if (!readers[sid]) readers[sid] = makeSessionLogReader(ctx, sq)
      try { return await readers[sid](sid) } catch (e) { return { events: [], count: 0 } }
    }

    // ---- 工具分类（与 trace 工具同口径：真实清单优先，名字启发式兜底）----
    let manifestTools = null
    const loadManifestTools = async () => {
      if (manifestTools) return
      manifestTools = []
      try {
        const found = await findManifest(ctx)
        const list = found && found.manifest && Array.isArray(found.manifest.plugins) ? found.manifest.plugins : []
        for (const e of list) {
          if (e && Array.isArray(e.modelTools)) {
            for (const n of e.modelTools) if (typeof n === 'string' && n) manifestTools.push(n)
          }
        }
      } catch (e) {}
    }
    const RE_SKILL = /^skill$/
    const RE_MCP = /mcp/i
    const RE_SUBAGENT = /^(subagent|subagent_fork|workflow|ralph)$/
    const RE_SHELL = /^(pwsh|bash|sh|terminal_(open|send|read|close|list|signal)|run_code)$/
    const RE_FILE = /^(read|write|edit|glob|grep|read_image)$/
    const kindOf = (name) => {
      if (/^cordis_/.test(name)) return 'cordis'
      if (/^ssh_/.test(name)) return 'cordis'
      if (manifestTools && manifestTools.indexOf(name) >= 0) return 'cordis'
      if (RE_SKILL.test(name)) return 'skill'
      if (RE_MCP.test(name)) return 'mcp'
      if (RE_SUBAGENT.test(name)) return 'subagent'
      if (RE_SHELL.test(name)) return 'shell'
      if (RE_FILE.test(name)) return 'file'
      return 'builtin'
    }
    const KIND_META = {
      skill: { label: '技能', color: '#7fa7f0', bg: 'rgba(91,141,239,.12)' },
      cordis: { label: '插件', color: '#d4b95c', bg: 'rgba(212,167,44,.10)' },
      mcp: { label: 'MCP', color: '#81c784', bg: 'rgba(102,187,106,.10)' },
      shell: { label: '命令', color: '#d4b95c', bg: 'rgba(212,167,44,.08)' },
      file: { label: '文件', color: '#7fa7f0', bg: 'rgba(91,141,239,.10)' },
      builtin: { label: '内置', color: '#9a9ba6', bg: 'rgba(138,139,150,.10)' },
    }

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => {
      const d = new Date(t)
      if (isNaN(d.getTime())) return '' // 注入类事件可能缺 time 字段，防空值渲染出 NaN:NaN:NaN
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    }
    const fmtDur = (ms) => ms == null ? '' : (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's')
    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && b.type === 'text' ? b.text : '')).filter(Boolean).join('\n')
    }

    // ---- 事件流 → 基础条目（调用与结果按 callId 配对，同 trace）----
    const parseItems = (events) => {
      const items = []
      const byCallId = {}
      const streamingAi = {} // turn:step → 首个 chunk 建立的临时助手卡；最终 message 原位落定，保持卡片 key 稳定
      const stepStarts = {} // turn:step → step/start 时间；助手运行计时从请求步骤开始，而不是首个 token 才开始
      const stepEnds = {} // turn:step → step/end 时间；无最终 message 的草稿据此落定（请求失败/中断）
      const turnEnds = {} // turn → turn/end 时间；step/end 缺失时的兜底落定依据
      let route = '' // 最近 request/header 的 provider/model，贴给后续助手消息卡
      let curTurn = null // 最近 turn/start 的轮次：user/message 不带 turn，用它推算归属
      for (const ev of events) {
        if (!ev || typeof ev.seq !== 'number') continue
        const d = ev.data || {}
        if (ev.type === 'turn/start') { if (typeof d.turn === 'number') curTurn = d.turn; continue }
        if (ev.type === 'step/start') {
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          stepStarts[String(turn) + ':' + step] = ev.time
          continue
        }
        if (ev.type === 'step/end') {
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          stepEnds[String(turn) + ':' + step] = ev.time
          continue
        }
        if (ev.type === 'turn/end') {
          if (typeof d.turn === 'number') turnEnds[d.turn] = ev.time
          continue
        }
        if (ev.type === 'request/header') {
          const cfg = d.header && d.header.config
          if (cfg && cfg.model) route = (cfg.provider ? cfg.provider + '/' : '') + cfg.model
          continue
        }
        if (ev.type === 'tool/call') {
          const it = {
            kind: 'call', seq: ev.seq, time: ev.time, turn: d.turn, step: d.step,
            name: String(d.name || '?'), cat: kindOf(String(d.name || '')),
            argsRaw: typeof d.arguments === 'string' ? d.arguments : '',
            status: 'pending', dur: null, resultText: '', outLen: 0,
          }
          items.push(it)
          if (d.callId != null) byCallId[String(d.callId)] = it
        } else if (ev.type === 'tool/result') {
          const m = d.message || {}
          // 遍历 content 找第一个带 toolCallId 的块（首块非 tool-result 时也能配上对）
          let callId = null
          let text = ''
          if (Array.isArray(m.content)) {
            for (const block of m.content) {
              if (callId == null && block && block.toolCallId != null) callId = String(block.toolCallId)
              if (!text && block) { const t = textOf(block.content); if (t) text = t }
            }
          }
          const failed = !!(d.error || (Array.isArray(m.content) && m.content[0] && m.content[0].isError))
          const it = callId ? byCallId[callId] : null
          if (it) {
            it.status = failed ? 'error' : 'ok'
            it.dur = ev.time - it.time
            it.resultText = text
            it.outLen = text.length
            it.resSeq = ev.seq // 结果事件位置：子代理出口卡对齐「结果之后的第一条消息」用
          }
        } else if (ev.type === 'user/message') {
          const src = d.source && d.source.kind ? String(d.source.kind) : 'user'
          const preview = oneLine(textOf(d.content), 110)
          // 空内容的上下文注入（subagent-settled 占位等）是噪声，不进流程图
          if (src !== 'user' && !preview) continue
          items.push({ kind: 'msg', role: src === 'user' ? 'user' : 'inject', seq: ev.seq, time: ev.time, turn: curTurn, preview, full: textOf(d.content) })
        } else if (ev.type === 'assistant/chunk') {
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          const key = String(turn) + ':' + step
          let it = streamingAi[key]
          if (!it) {
            it = { kind: 'msg', role: 'ai', seq: ev.seq, time: ev.time, turn, step, runStart: stepStarts[key] || ev.time, preview: '正在生成…', full: '', tok: null, route, streaming: true, chunks: [], reasoningChunks: [] }
            streamingAi[key] = it
            items.push(it)
          }
          const chunk = d.chunk || {}
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
            it.chunks.push(chunk.text)
          } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
            it.reasoningChunks.push(chunk.text)
          } else if (/tool-call/i.test(String(chunk.type || ''))) {
            it.hasToolCallChunk = true
          }
        } else if (ev.type === 'assistant/message') {
          const m = d.message || {}
          const u = d.usage || null
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          const key = String(turn) + ':' + step
          const finalText = textOf(m.content)
          const draft = streamingAi[key]
          if (draft) {
            // 保留首 chunk 的 seq，避免轮询时临时卡被当成另一张新卡；内容与完成态原位更新。
            draft.preview = oneLine(finalText, 110) || '（工具调用）'
            draft.full = finalText
            draft.tok = u ? (u.outputTokens || 0) : null
            draft.route = route
            draft.streaming = false
            draft.finalSeq = ev.seq
            draft.runDur = Math.max(0, ev.time - draft.runStart)
            delete draft.chunks
            delete draft.reasoningChunks
            delete draft.hasToolCallChunk
          } else {
            const runStart = stepStarts[key] || ev.time
            items.push({ kind: 'msg', role: 'ai', seq: ev.seq, time: ev.time, turn, step, runStart, runDur: Math.max(0, ev.time - runStart), preview: oneLine(finalText, 110) || '（工具调用）', full: finalText, tok: u ? (u.outputTokens || 0) : null, route, streaming: false })
          }
        }
      }
      // 流式中的助手卡只在整轮扫描结束后合并一次，避免每个 chunk 都重拼全文造成 O(n²) 和面板超时。
      for (const it of Object.values(streamingAi)) {
        if (!it.streaming) continue
        const text = Array.isArray(it.chunks) ? it.chunks.join('') : ''
        const reasoning = Array.isArray(it.reasoningChunks) ? it.reasoningChunks.join('') : ''
        it.full = text || reasoning
        const key = String(it.turn) + ':' + it.step
        const endedAt = stepEnds[key] != null ? stepEnds[key]
          : (it.turn != null && turnEnds[it.turn] != null ? turnEnds[it.turn] : null)
        if (endedAt != null) {
          // 步骤/轮次已终结却始终没有最终 message → 模型请求失败/中断：
          // 落定卡片（停止流光脉冲与耗时计时），标记中断并保留已生成片段
          it.streaming = false
          it.interrupted = true
          it.runDur = Math.max(0, endedAt - it.runStart)
          it.preview = (it.full ? oneLine(it.full, 100) + ' ' : '') + '（生成已中断）'
        } else {
          it.preview = oneLine(it.full, 110) || (it.hasToolCallChunk ? '正在准备工具调用…' : (reasoning ? '思考中…' : '正在生成…'))
        }
        delete it.chunks
        delete it.reasoningChunks
        delete it.hasToolCallChunk
      }
      return items
    }

    // ---- 条目 → 流程节点：消息各成节点；同步骤连续普通调用合成平行卡片组；子代理调用独立成分支节点 ----
    const buildNodes = (items) => {
      const nodes = []
      for (const it of items) {
        if (it.kind === 'msg') { nodes.push({ t: 'msg', it }); continue }
        if (it.cat === 'subagent') { nodes.push({ t: 'sub', call: it }); continue }
        const last = nodes[nodes.length - 1]
        if (last && last.t === 'par' && last.turn === it.turn && last.step === it.step) last.calls.push(it)
        else nodes.push({ t: 'par', turn: it.turn, step: it.step, calls: [it] })
      }
      return nodes
    }

    // ---- 子代理结果文本 → 子会话 id（"started subagent <uuid>" / 完成通知里的 id）----
    const childIdOf = (call) => {
      const m = /subagent\s+([0-9a-f]{8}-[0-9a-f-]{27,})/i.exec(call.resultText || '')
      return m ? m[1] : null
    }
    // 子代理分支：从子会话日志提取紧凑步骤流（限量；读失败/未启动给占位）
    const childRows = async (childId, cap) => {
      const r = await readLog(childId)
      if (!r.events || !r.events.length) return { rows: [], live: false, total: 0 }
      const items = parseItems(r.events)
      const rows = []
      for (const it of items) {
        if (it.kind === 'msg') {
          if (it.role === 'ai') rows.push({ txt: it.preview, cls: 'ai' })
        } else {
          const km = KIND_META[it.cat] || KIND_META.builtin
          rows.push({ txt: it.name + ' ' + oneLine(it.argsRaw, 40), cls: '', pill: km.label, status: it.status, dur: it.dur })
        }
      }
      let live = false
      try {
        const agentsSvc = ctx.get('agents')
        if (agentsSvc) {
          const agent = agentsSvc.get(childId)
          live = !!(agent && agent.status === 'running')
        } else {
          // 旧版 harness/测试环境没有 agents 状态面，只能以仍挂载的 session 作为兼容兜底。
          const sessionsSvc = ctx.get('sessions')
          live = !!(sessionsSvc && sessionsSvc.get(childId))
        }
      } catch (e) {}
      return { rows: rows.slice(-cap), live, total: rows.length }
    }

    // ---- 渲染 ----
    const statusGlyph = (s, dur) => {
      if (s === 'ok') return '<span style="color:var(--tb-done-text,#81c784)">✓ ' + fmtDur(dur) + '</span>'
      if (s === 'error') return '<span style="color:var(--tb-danger-text,#f28b82)">✗ ' + fmtDur(dur) + '</span>'
      return '<span class="fl-spin"></span>'
    }

    // 进出摘要：传入/返回（用户核心诉求——看到传给 skill 什么、skill 返回什么）
    // 传入：从 arguments JSON 提取最有信息量的字段（command/file_path/pattern/prompt…），而非整段 JSON
    const ARG_KEYS = ['command', 'file_path', 'path', 'pattern', 'query', 'q', 'description', 'prompt', 'text', 'content', 'url', 'name', 'key', 'expression', 'expr', 'code', 'script', 'tool', 'method', 'message', 'input', 'old_string', 'new_string']
    const inSummary = (c) => {
      try {
        const a = JSON.parse(c.argsRaw || '{}')
        for (const k of ARG_KEYS) {
          if (typeof a[k] === 'string' && a[k].trim()) return k + ': ' + oneLine(a[k], 72)
          if (typeof a[k] === 'number' || typeof a[k] === 'boolean') return k + ': ' + a[k]
        }
        const ks = Object.keys(a)
        if (ks.length) return ks[0] + ': ' + oneLine(String(a[ks[0]]), 72)
        return '（无参数）'
      } catch (e) { return oneLine(c.argsRaw, 72) || '（无参数）' }
    }
    // 返回：结果首条有意义文本 + 体量 + 状态
    const outSummary = (c) => {
      if (c.status === 'pending') return null
      if (c.status === 'error') {
        const t = (c.resultText || '').trim()
        return { text: t ? oneLine(t, 72) : '（调用失败）', err: true }
      }
      const lines = String(c.resultText || '').split('\n').map((s) => s.trim()).filter(Boolean)
      const first = lines[0] || ''
      return { text: (first ? oneLine(first, 72) : '（空返回）') + (c.outLen > 72 ? ' · ' + fmtSize(c.outLen) : ''), err: false }
    }
    // 调用连线单元（形态约定·手绘参考图：主干卡在左、工具卡在右，中间两条水平连线——
    // 上=输入摘要 + 横线 + ▶ 右出；下=◀ + 横线 + 输出摘要 回左；输出线绿色系、错误红色系、进行中虚线）；
    // 进行中的工具卡高亮脉冲（调用到哪步哪步亮）；点击工具卡展开完整传入/返回（详情挂卡下方）
    const renderCallWire = (c, expandedSeq) => {
      const km = KIND_META[c.cat] || KIND_META.builtin
      const isExp = expandedSeq === c.seq
      const pending = c.status === 'pending'
      const o = outSummary(c)
      return '<div class="fl-wp" data-flow-card="' + c.seq + '" data-flow-status="' + c.status + '">' +
          '<div class="fl-wl"><span class="fl-wl-txt">输入 ' + esc(inSummary(c)) + '</span>' +
            '<span class="fl-wl-row"><span class="fl-wl-line"></span><span class="fl-wl-arr">▶</span></span></div>' +
          (pending
            ? '<div class="fl-wl fl-wl-b fl-wl-wait"><span class="fl-wl-txt">输出 进行中…</span>' +
              '<span class="fl-wl-row"><span class="fl-wl-arr">◀</span><span class="fl-wl-line"></span></span></div>'
            : '<div class="fl-wl fl-wl-b' + (o && o.err ? ' fl-wl-err' : '') + '"><span class="fl-wl-txt">输出 ' + esc(o ? o.text : '') + '</span>' +
              '<span class="fl-wl-row"><span class="fl-wl-arr">◀</span><span class="fl-wl-line"></span></span></div>') +
        '</div>' +
        '<div class="fl-callside">' +
          '<div class="fl-iocard' + (pending ? ' fl-live' : '') + (isExp ? ' fl-on' : '') + (o && o.err ? ' fl-err' : '') + '" data-action="fdetail" data-seq="' + c.seq + '" title="点击在右侧查看完整传入/返回">' +
            '<div class="fl-iohead"><span class="fl-tag" style="color:' + km.color + ';background:' + km.bg + '">' + km.label + '</span>' +
            '<span class="fl-name">' + esc(c.name) + '</span>' +
            (pending ? '<span class="fl-spin"></span><span class="fl-time" data-flow-timer="' + c.time + '" data-flow-timer-prefix="⏱ ">⏱ 0ms</span>' : statusGlyph(c.status, c.dur)) + '</div>' +
          '</div>' +
        '</div>'
    }

    // 同一步骤的多个并行调用（>1）用虚线外框 + 「并行 ×N」角标圈成一组；单调用保持散卡
    const grpSide = (node, units) => {
      const n = node.calls.length
      if (n < 2) return '<div class="fl-lane-side">' + units + '</div>'
      return '<div class="fl-lane-side fl-grp"><span class="fl-grp-tag">并行 ×' + n + '</span>' + units + '</div>'
    }

    // 泳道中列包装：连接符（▼ 上方空隙由 ::before 主干线自适应填满，▼ 贴内容顶）+ 内容 + 对称弹性空间
    // —— 卡片保持垂直居中，▼ 始终落在「上一张卡 → 这一张卡」的空隙底端（先线后箭头）；可视首行不加（顶部不悬空）
    const connMain = (content, withConn) =>
      (withConn ? '<div class="fl-conn"><span class="fl-arrow">▼</span></div>' : '') +
      content +
      (withConn ? '<span class="fl-conn-gap"></span>' : '')

    // 孤立调用组（前无助手消息，如连续工具步）：中列只画主干竖线贯穿——无卡的行不放 ▼ 连接符（线本身即连续性）
    const renderPar = (node, expandedSeq) => {
      const units = node.calls.map((c) => renderCallWire(c, expandedSeq)).join('')
      return '<div class="fl-lane"><div></div>' +
        '<div class="fl-lane-main"><span class="fl-lane-line"></span></div>' +
        grpSide(node, units) +
      '</div>'
    }

    const msgCardInner = (it, expandedSeq, live) => {
      const isUser = it.role === 'user'
      const isAi = it.role === 'ai'
      const aiRunning = isAi && it.streaming
      const color = isUser ? 'var(--tb-done-text,#81c784)' : isAi ? 'var(--tb-active-text,#7fa7f0)' : 'var(--tb-text-3,#777884)'
      const label = isUser ? '用户' : isAi ? '助手' : '注入'
      // 卡片统一面片底色（fl-node），角色色只落在左侧色条 + 几何符号/tag 上，避免整卡彩色半透明的杂乱感
      // 用户/助手/注入卡均可点开右侧详情浮层看完整内容（与工具卡同一交互）；live=进行中 → 与工具卡同款流光脉冲
      return '<div class="fl-node' + (expandedSeq === it.seq ? ' fl-on' : '') + (live ? ' fl-live' : '') + '" style="border-left-color:' + color + '" data-flow-main-card="' + it.seq + '" data-flow-role="' + it.role + '" data-action="fdetail" data-seq="' + it.seq + '" title="点击查看完整消息">' +
        '<div class="fl-node-head"><span class="fl-glyph" style="color:' + color + '">' + (isUser ? '▲' : isAi ? '◆' : '■') + '</span><span class="fl-tag" style="color:' + color + '">' + label + '</span>' +
        (isAi && it.route ? '<span class="fl-model">' + esc(it.route) + '</span>' : '') +
        (fmtTime(it.time) ? '<span class="fl-time">' + fmtTime(it.time) + '</span>' : '') +
        (aiRunning && it.runStart ? '<span class="fl-time" data-flow-timer="' + it.runStart + '" data-flow-timer-prefix="⏱ ">⏱ 0ms</span>' : (isAi && it.runDur != null ? '<span class="fl-time">⏱ ' + fmtDur(it.runDur) + '</span>' : '')) +
        (it.tok ? '<span class="fl-time">+' + it.tok + ' tok</span>' : '') + '</div>' +
        '<div class="fl-preview"' + (it.interrupted ? ' style="color:var(--tb-danger-text,#f28b82)"' : '') + '>' + esc(it.preview || '（空）') + '</div>' +
      '</div>'
    }

    const renderMsg = (it, expandedSeq, withConn, live) => '<div class="fl-lane"><div></div><div class="fl-lane-main">' + connMain(msgCardInner(it, expandedSeq, live), withConn) + '</div><div></div></div>'

    // 完整详情 → 右侧浮层（不插入流程流撑高内容：展开/收起零跳跃，滚动位置不动）：
    // 完整输入参数（美化 JSON）+ 完整返回结果（均截断标注，防大参数撑爆 HTML）；头部 ✕ 或再点卡片关闭
    const detailRail = (c, anim) => {
      let input = c.argsRaw || ''
      try { input = JSON.stringify(JSON.parse(c.argsRaw || '{}'), null, 2) } catch (e) {}
      const cap = 8000
      const inShown = input.length > cap ? input.slice(0, cap) + '\n…（截断，共 ' + input.length + ' 字符）' : input
      const out = c.status === 'pending' ? '（进行中，尚无返回）' : (c.resultText || '（空返回）')
      const outShown = out.length > cap ? out.slice(0, cap) + '\n…（截断，共 ' + out.length + ' 字符）' : out
      // anim=是否新展开（轮询重渲染不重播滑入动画，防闪烁）
      return '<div class="fl-rail' + (anim ? ' fl-rail-anim' : '') + '">' +
        '<div class="fl-rail-head"><span class="fl-rail-title">' + esc(c.name) + ' · 详情</span>' +
        '<button type="button" class="fl-rail-x" data-action="fdetail" data-seq="' + c.seq + '" title="关闭详情">✕</button></div>' +
        '<div class="fl-rail-body">' +
          '<div class="fl-sec"><span class="fl-sec-label">入 · 完整传入' + (input.length > cap ? '（截断）' : '') + '</span><pre class="fl-pre">' + esc(inShown) + '</pre></div>' +
          '<div class="fl-sec"><span class="fl-sec-label">出 · 完整返回' + (c.outLen ? '（' + fmtSize(c.outLen) + '）' : '') + '</span><pre class="fl-pre">' + esc(outShown) + '</pre></div>' +
        '</div>' +
      '</div>'
    }

    // 消息详情浮层（用户/助手/注入卡点击）：角色 + 时间/模型/tokens 元信息 + 完整内容（截断标注）
    const msgRail = (it, anim) => {
      const label = it.role === 'user' ? '用户消息' : it.role === 'ai' ? '助手消息' : '注入消息'
      const cap = 8000
      const full = String(it.full || it.preview || '')
      const shown = full.length > cap ? full.slice(0, cap) + '\n…（截断，共 ' + full.length + ' 字符）' : full
      const meta = []
      if (fmtTime(it.time)) meta.push('时间 ' + fmtTime(it.time))
      if (it.route) meta.push('模型 ' + it.route)
      if (it.tok) meta.push('输出 +' + it.tok + ' tok')
      return '<div class="fl-rail' + (anim ? ' fl-rail-anim' : '') + '">' +
        '<div class="fl-rail-head"><span class="fl-rail-title">' + label + ' · 详情</span>' +
        '<button type="button" class="fl-rail-x" data-action="fdetail" data-seq="' + it.seq + '" title="关闭详情">✕</button></div>' +
        '<div class="fl-rail-body">' +
          (meta.length ? '<div class="fl-sec"><span class="fl-sec-label">' + esc(meta.join(' · ')) + '</span></div>' : '') +
          '<div class="fl-sec"><span class="fl-sec-label">完整内容' + (full.length > cap ? '（截断）' : '') + '</span><pre class="fl-pre">' + esc(shown || '（空）') + '</pre></div>' +
        '</div>' +
      '</div>'
    }

    // 子代理分支内容（左列）：入口卡（可点详情）+ 支线步骤（限高滚动）+ 出口卡
    // 运行中 = 调用在途（pending）或子会话仍 live——任一成立入口卡持续 fl-live（流光/脉冲/转圈）
    const subBranchHtml = async (c) => {
      const cid = childIdOf(c)
      let subLive = c.status === 'pending'
      let sub2 = null
      if (cid) {
        try { sub2 = await childRows(cid, 10); if (sub2.live) subLive = true } catch (e) {}
      }
      let sub = '<div class="fl-sub-card fl-sub-open' + (subLive ? ' fl-live' : '') + '" data-action="fdetail" data-seq="' + c.seq + '" title="点击查看完整任务传入/返回">' +
        '<div class="fl-iohead"><span class="fl-tag" style="color:var(--tb-active-text,#7fa7f0);background:rgba(91,141,239,.12)">子代理</span>' +
        '<span class="fl-name">' + esc(c.name) + '</span>' + statusGlyph(c.status, c.dur) + '</div>' +
        '<div class="fl-sub-io"><span class="fl-io-tag">入</span><span class="fl-branch-txt">' + esc(inSummary(c)) + '</span></div>' +
      '</div>'
      let steps = ''
      if (cid && sub2) {
        steps += '<div class="fl-sub-meta"><span class="fl-time">↳ ' + esc(cid.slice(0, 8)) + '… · ' + sub2.total + ' 步</span>' + (sub2.live ? '<span class="fl-tag" style="color:var(--tb-done-text,#81c784)">运行中</span>' : '') +
          '<button type="button" class="tb-btn tb-btn-sm" data-action="fenter" data-seq="' + c.seq + '" title="进入该子代理的完整流程图（可逐级返回）">进入 →</button></div>'
        for (const r of sub2.rows) {
          steps += '<div class="fl-sub-step">' +
            (r.pill ? '<span class="fl-branch-pill">' + esc(r.pill) + '</span>' : '') +
            '<span class="fl-branch-txt' + (r.pill ? '' : ' fl-branch-ai') + '">' + esc(r.txt) + '</span>' +
            (r.pill ? statusGlyph(r.status, r.dur) : '') +
          '</div>'
        }
        if (sub2.total > sub2.rows.length) steps += '<div class="fl-sub-step"><span class="fl-time">… 更早 ' + (sub2.total - sub2.rows.length) + ' 步未展开</span></div>'
      } else if (c.status === 'pending') {
        steps = '<div class="fl-sub-step"><span class="fl-time">子代理启动中…</span></div>'
      }
      if (steps) sub += '<div class="fl-sub-steps">' + steps + '</div>'
      if (c.status !== 'pending') {
        const o = outSummary(c)
        sub += '<div class="fl-sub-card fl-sub-close" data-action="fdetail" data-seq="' + c.seq + '" title="点击查看完整任务传入/返回">' +
          '<div class="fl-sub-io"><span class="fl-io-tag">出</span>' +
          '<span class="fl-time">' + fmtDur(c.dur) + '</span>' +
          (o ? '<span class="fl-args">' + esc(o.text) + '</span>' : '') + '</div>' +
        '</div>'
      }
      return sub
    }

    const render = async (st, sid) => {
      const r = await readLog(sid)
      // 活跃度：日志条数较上轮渲染增长 = 会话正在工作（用于助手卡流光；静止会话/他人会话不误亮）
      const prevCount = growth[sid]
      const active = prevCount != null && (r.count || 0) > prevCount
      growth[sid] = r.count || 0
      await loadManifestTools()
      const items = parseItems(r.events || [])
      const nodes = buildNodes(items)
      // 会话仍在运行且最新事件是一条助手消息 → 该助手卡持续流光；日志增长作为 sessions 服务缺失时的兜底。
      const lastIt = items.length ? items[items.length - 1] : null
      let sessionLive = false
      let hasAgentStatus = false
      try {
        const agentsSvc = ctx.get('agents')
        if (agentsSvc) {
          hasAgentStatus = true
          const agent = agentsSvc.get(sid)
          sessionLive = !!(agent && agent.status === 'running')
        }
      } catch (e) {}
      // provider/配额等请求错误有时先把 agent 置 idle，step/end / turn/end 尚未进入本次日志快照。
      // agent 状态是权威终态：强制结算残留流式草稿，避免“正在生成”和客户端计时无限增长。
      if (hasAgentStatus && !sessionLive) {
        const tail = r.events && r.events.length ? r.events[r.events.length - 1] : null
        const settledAt = tail && Number.isFinite(Number(tail.time)) ? Number(tail.time) : null
        for (const it of items) {
          if (it.kind !== 'msg' || it.role !== 'ai' || !it.streaming) continue
          it.streaming = false
          it.interrupted = true
          it.runDur = Math.max(0, (settledAt != null ? settledAt : it.runStart) - it.runStart)
          it.preview = (it.full ? oneLine(it.full, 100) + ' ' : '') + '（生成失败或已中断）'
        }
      }
      const liveAiSeq = (hasAgentStatus ? sessionLive : active) && lastIt && lastIt.kind === 'msg' && lastIt.role === 'ai' && !lastIt.interrupted ? lastIt.seq : null
      const CAP = 60
      const shown = nodes.slice(-CAP)
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root tb-pane" data-flow data-flow-scope="' + esc(sid) + '" data-autorefresh="' + (st.live ? '2000' : '') + '" data-tab-badge="' + (st.live ? String(nodes.length) : '') + '">')
      // 固定头
      parts.push('<div class="tb-pane-head">')
      // 钻取态：查看的不是面板所属会话 → 头部给「← 返回」+ 层级标注（crumbs 栈深度）
      const drilled = !!(st.home && sid !== st.home)
      const depth = drilled && Array.isArray(st.crumbs) ? st.crumbs.length : 0
      parts.push('<div class="tb-row">' +
        (drilled ? '<button type="button" class="tb-btn tb-btn-sm" data-action="fback" title="返回上一级流程图">← 返回</button>' : '') +
        '<span class="tb-sec-label">' + (drilled ? '子代理流镜' : '实时流镜') + '</span>' +
        '<span class="tb-note">' + esc(sid.replace(/^session-/, '').slice(0, 8)) + ' · ' + items.length + ' 条事件 · ' + nodes.length + ' 节点' + (drilled ? ' · 第 ' + (depth + 1) + ' 层' : '') + '</span>' +
        '<button type="button" class="tb-chip' + (st.live ? ' tb-chip-on' : '') + '" data-action="toggle-live">' + (st.live ? '● 实时同步中' : '⏸ 已暂停') + '</button>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button>' +
      '</div>')
      parts.push('<div class="tb-note">泳道：中列主干自上而下（用户/助手）；调用右出输入卡 ▶、左回输出卡 ◀，进行中的调用高亮脉冲；子代理分支在左列（入口/支线/出口），与主干卡同行不留空白；点工具卡看完整传入/返回，点消息卡看完整内容；点子代理分支「进入 →」钻取该子会话的完整流程图</div>')
      parts.push('</div>')
      // 流程体：tb-pane-body 为 column-reverse——这里以「视觉最新在底」渲染：DOM 先放最新节点，滚动条默认贴底
      parts.push('<div class="tb-pane-body">')
      if (!shown.length) {
        parts.push('<div class="tb-notice">当前会话还没有事件</div>')
      } else {
        // 子代理分支内容并行预取（串行 await 会让多个子代理分支的 readLog 延迟叠加）
        const subHtmls = {}
        await Promise.all(shown.map(async (n, i) => { if (n.t === 'sub') subHtmls[i] = await subBranchHtml(n.call) }))
        const rows = []
        for (let i = 0; i < shown.length; i++) {
          const n = shown[i]
          const withConn = rows.length > 0 // 可视首行（最老）不画连接符
          let h
          // 助手消息后紧跟的同步骤节点统一归并：普通调用组(par)与子代理(sub)任意顺序/兼有都并进同一行
          // —— 左=分支、中=助手卡、右=工具组（此前 par/sub 只认单一模式，混合步骤会把子代理落单到下一行导致分支错位）
          if (n.t === 'msg' && n.it.role === 'ai' && shown[i + 1] && (shown[i + 1].t === 'par' || shown[i + 1].t === 'sub')) {
            let parN = null, subN = null, subIdx = -1, next = i + 1
            if (shown[next] && shown[next].t === 'par') { parN = shown[next]; next++ }
            if (shown[next] && shown[next].t === 'sub') { subN = shown[next]; subIdx = next; next++ }
            if (!parN && shown[next] && shown[next].t === 'par') { parN = shown[next]; next++ }
            const call = subN ? subN.call : null
            // 进行中判定：工具组有 pending / 子代理还在跑 / 该助手消息正活跃
            const aiLive = (parN && parN.calls.some((c) => c.status === 'pending')) || (call && call.status === 'pending') || n.it.seq === liveAiSeq
            let main = msgCardInner(n.it, st.expanded, aiLive)
            let lastI = next - 1
            if (call && call.resSeq != null) {
              // 已完成：中列从卡A 起 ▼ 串到「结果之后的第一条消息」（出口卡贴底与其对齐）；
              // 合并边界按轮次（turn）——只吞同轮消息，下一轮的用户/助手消息回到独立行（对齐基准）
              for (let j = next; j < shown.length; j++) {
                const m = shown[j]
                if (m.t !== 'msg') break
                if (call.turn != null && m.it.turn != null && m.it.turn !== call.turn) break
                main += '<span class="fl-arrow">▼</span>' + msgCardInner(m.it, st.expanded, m.it.seq === liveAiSeq)
                lastI = j
                if (m.it.seq > call.resSeq) break
              }
            }
            h = '<div class="fl-lane">' +
              (subN ? '<div class="fl-subcol">' + (subHtmls[subIdx] || '') + '</div>' : '<div></div>') +
              '<div class="fl-lane-main">' + connMain(main, withConn) + '</div>' +
              (parN ? grpSide(parN, parN.calls.map((c) => renderCallWire(c, st.expanded)).join('')) : '<div></div>') +
            '</div>'
            i = lastI
          } else if (n.t === 'msg') h = renderMsg(n.it, st.expanded, withConn, n.it.seq === liveAiSeq)
          else if (n.t === 'par') h = renderPar(n, st.expanded)
          else h = '<div class="fl-lane"><div class="fl-subcol">' + (subHtmls[i] || '') + '</div><div class="fl-lane-main"><span class="fl-lane-line"></span></div><div></div></div>'
          rows.push(h)
        }
        if (nodes.length > CAP) rows.push('<div class="tb-notice">仅显示最近 ' + CAP + ' 个节点（更早 ' + (nodes.length - CAP) + ' 个未加载）</div>')
        parts.push(rows.reverse().join(''))
      }
      parts.push('</div>')
      // 详情右侧浮层：展开状态且目标仍在可视事件集内时渲染（工具调用→传入/返回；消息→完整内容）
      if (st.expanded != null) {
        const target = items.find((it) => it.seq === st.expanded && (it.kind === 'call' || it.kind === 'msg'))
        if (target) parts.push(target.kind === 'call' ? detailRail(target, st.freshSeq === target.seq) : msgRail(target, st.freshSeq === target.seq))
      }
      delete st.freshSeq // 一次性动画标记，不残留进 state
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { live: true, sid: null, home: null, expanded: null, crumbs: [] }
      if (typeof st.expanded !== 'number' && st.expanded != null) st.expanded = null
      if (!Array.isArray(st.crumbs)) st.crumbs = []
      const el = fields && fields.__el ? fields.__el : {}
      // home=面板所属会话（钻取不改变归属）；sid=当前查看的会话（默认=home）
      const home = session || st.home || st.sid
      if (!home) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到当前会话</div></div>', state: st }
      st.home = home
      if (!st.sid) st.sid = home
      if (action === 'toggle-live') st.live = !st.live
      else if (action === 'fdetail' && el.seq != null) {
        const seq = Number(el.seq)
        st.expanded = st.expanded === seq ? null : seq
        st.freshSeq = st.expanded // 仅新展开的那次渲染播放滑入动画（null=收起不播；轮询不重播）
      } else if (action === 'fenter' && el.seq != null) {
        // 钻取：解析当前查看会话的日志，找到该子代理调用的子会话 id 后切入（当前会话压栈）
        const seq = Number(el.seq)
        const r = await readLog(st.sid)
        const call = parseItems(r.events || []).find((it) => it.kind === 'call' && it.seq === seq && it.cat === 'subagent')
        const cid = call ? childIdOf(call) : null
        if (cid && cid !== st.sid) {
          st.crumbs.push({ sid: st.sid, label: call.name + ' ' + cid.slice(0, 8) })
          st.sid = cid
          st.expanded = null
        }
      } else if (action === 'fback') {
        const prev = st.crumbs.pop()
        if (prev && prev.sid) { st.sid = prev.sid; st.expanded = null }
      }
      const sid = st.sid
      try {
        const html = await render(st, sid)
        return { ok: true, html, state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'flow', label: '流镜', order: 2, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="5" height="4" rx="1"/><rect x="8.5" y="9.5" width="5" height="4" rx="1"/><path d="M5.5 6.5V8a3 3 0 0 0 3 3h.5"/><path d="M8 11.5l1.5-1L8 9.5"/></svg>' }, handler)
  },
}

}

const create_flowedit = () => {
// ===== flowedit-tool.js：工作流编辑器（Host-only，经工具箱 RPC 注册）=====
// 参考 kanghelyu/dsh-deepseek-flow 的「Markdown 优先 + 流程图可视化」思路，
// 适配工具箱 HTML 面板架构（无 Client 拖拽画布，做合理取舍）：
//   · Markdown 是唯一事实来源（## 步骤 / ### gate:门 / - 是→目标 分支）
//   · 编辑区 ↔ 流程图实时预览双向同步（改 Markdown 即重渲染图）
//   · 逻辑门分支用 git 树样式渲染（├─ 是 / ╰─ 否，复用 fl- 流程图样式族）
//   · 文件落盘 <工作区>/.dsh-dynamic-toolbox/data/flows/<name>.md（pluginDataDir 约定，content 产物）
// 状态：{ files[], name, md, dirty, view, notice, confirmDel }（md 正文在 state，可编辑需要）

return {
  name: 'flowedit-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const fs = ctx.get('fs')
    const subprocess = ctx.get('subprocess')
    const REL_DIR = pluginDataDir('flows') // .dsh-dynamic-toolbox/data/flows

    // ---- 目录/读写（走仓库根 resolveDataPath：clone 部署时数据归属本仓库，不污染宿主项目）----
    // 返回 flows 目录的绝对路径字符串（供 fs cwd 与子进程 argv 共用）
    const flowsDirAbs = async (wsRoot) => {
      if (!fs) return null
      const t = await resolveDataPath(ctx, REL_DIR, wsRoot)
      return t ? fs.processPath(t) : null
    }
    const ensureDir = async (wsRoot) => {
      if (!subprocess) return
      try {
        const abs = await flowsDirAbs(wsRoot)
        if (!abs) return
        const handle = subprocess.spawn({
          argv: ['node', '-e', "require('fs').mkdirSync(process.argv[1], { recursive: true })", abs],
          cwd: wsRoot,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
          graceMs: 15000,
        })
        await handle.done
      } catch (e) {}
    }
    const listFlows = async (wsRoot) => {
      if (!fs) return []
      try {
        const abs = await flowsDirAbs(wsRoot)
        if (!abs) return []
        const dir = await fs.resolve(abs)
        if (!await fs.stat(dir)) return []
        const entries = await fs.listDir(dir)
        return (entries || [])
          .map((e) => String((e && (e.name !== undefined ? e.name : e.targetKey)) || ''))
          .map((n) => n.split(/[\\/]/).pop())
          .filter((n) => /\.md$/i.test(n))
          .map((n) => n.replace(/\.md$/i, ''))
          .sort()
      } catch (e) { return [] }
    }
    const readFlow = async (wsRoot, name) => {
      const abs = await flowsDirAbs(wsRoot)
      if (!abs) return null
      const t = await fs.resolve(name + '.md', { cwd: abs })
      if (!await fs.stat(t)) return null
      return fs.readText(t)
    }
    const saveFlow = async (wsRoot, session, name, content) => {
      await ensureDir(wsRoot)
      const abs = await flowsDirAbs(wsRoot)
      const t = await fs.resolve(name + '.md', { cwd: abs })
      await fs.writeText(t, content, undefined, undefined, storePolicy(ctx, wsRoot, session))
      return true
    }
    const deleteFlow = async (wsRoot, name) => {
      if (!subprocess || !fs) return false
      try {
        const dirAbs = await flowsDirAbs(wsRoot)
        if (!dirAbs) return false
        const t = await fs.resolve(name + '.md', { cwd: dirAbs })
        const abs = typeof fs.processPath === 'function' ? fs.processPath(t) : t
        const handle = subprocess.spawn({
          argv: ['node', '-e', "require('fs').rmSync(process.argv[1], { force: true })", abs],
          cwd: wsRoot,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
          graceMs: 15000,
        })
        await handle.done
        return true
      } catch (e) { return false }
    }

    // ---- 逻辑门元数据 ----
    const GATES = {
      ifelse: { sym: '◇', label: 'IF/ELSE', color: '#d4b95c' },
      and: { sym: '∧', label: 'AND', color: '#7fa7f0' },
      or: { sym: '∨', label: 'OR', color: '#81c784' },
      not: { sym: '¬', label: 'NOT', color: '#f28b82' },
      nand: { sym: '⊼', label: 'NAND', color: '#7fa7f0' },
      nor: { sym: '⊽', label: 'NOR', color: '#81c784' },
      xor: { sym: '⊻', label: 'XOR', color: '#d4b95c' },
      xnor: { sym: '⊙', label: 'XNOR', color: '#d4b95c' },
    }

    // ---- Markdown → 流程模型 ----
    // 约定：# 标题 / ## 步骤 / ### gate:类型 条件名 / - 是 → 目标 / - 否 → 目标 / - 其他=要点 / 段落=描述
    // ``` 代码围栏内的内容不解析（围栏里的 ## / ### gate: 是示例文本，不产生幻影节点）
    const parseFlow = (md) => {
      const lines = String(md || '').split(/\r?\n/)
      let title = ''
      const nodes = []
      let cur = null
      let inFence = false
      for (const ln of lines) {
        if (/^\s*```/.test(ln)) { inFence = !inFence; continue } // 围栏开关
        if (inFence) continue
        const h1 = /^#\s+(.+)/.exec(ln)
        if (h1) { if (!title) title = h1[1].trim(); continue }
        const gate = /^###\s+gate:(\w+)\s*(.*)/.exec(ln)
        if (gate) {
          cur = { kind: 'gate', gate: gate[1].toLowerCase(), label: (gate[2] || '').trim() || gate[1], desc: [], branches: [] }
          nodes.push(cur); continue
        }
        const h2 = /^##\s+(.+)/.exec(ln)
        if (h2) {
          cur = { kind: 'step', label: h2[1].trim(), desc: [], branches: [] }
          nodes.push(cur); continue
        }
        const li = /^[-*]\s+(.+)/.exec(ln)
        if (li && cur) {
          const br = /^(是|否)\s*→\s*(.+)/.exec(li[1].trim())
          if (br) cur.branches.push({ cond: br[1], target: br[2].trim() })
          else cur.desc.push(li[1].trim())
          continue
        }
        if (cur && ln.trim()) cur.desc.push(ln.trim())
      }
      return { title, nodes }
    }

    // ---- 流程模型 → 流程图 HTML（复用 fl- 样式族；自上而下 ▼ 串联，门用 git 树分支）----
    const nodeHtml = (n, idx) => {
      if (n.kind === 'gate') {
        const g = GATES[n.gate] || { sym: '◇', label: String(n.gate || '?').toUpperCase(), color: '#d4b95c' }
        const branchRows = (n.branches || []).map((b, i, arr) => {
          const glyph = i === arr.length - 1 ? '╰─' : '├─'
          const condColor = b.cond === '是' ? 'var(--tb-done-text,#81c784)' : 'var(--tb-danger-text,#f28b82)'
          return '<div class="fl-branch-row"><span class="fl-git">' + glyph + '</span>' +
            '<span class="fl-branch-pill" style="color:' + condColor + '">' + esc(b.cond) + '</span>' +
            '<span class="fl-branch-txt">→ ' + esc(b.target) + '</span></div>'
        }).join('')
        return '<div class="fl-row"><div class="fl-node" style="border-color:' + g.color + '55;background:' + g.color + '0d">' +
          '<div class="fl-node-head"><span class="fl-tag" style="color:' + g.color + ';background:' + g.color + '22">' + g.sym + ' ' + g.label + '</span>' +
          '<span class="fl-name">' + esc(n.label) + '</span></div>' +
          (n.desc.length ? '<div class="fl-args">' + esc(n.desc[0]) + '</div>' : '') +
        '</div></div>' +
        (branchRows ? '<div class="fl-row"><div class="fl-node" style="border-color:' + g.color + '33;background:transparent;padding:2px 8px">' + branchRows + '</div></div>' : '')
      }
      return '<div class="fl-row"><div class="fl-node">' +
        '<div class="fl-node-head"><span class="fl-tag" style="color:var(--tb-active-text,#7fa7f0);background:rgba(91,141,239,.12)">步骤 ' + idx + '</span>' +
        '<span class="fl-name">' + esc(n.label) + '</span></div>' +
        (n.desc.length ? '<div class="fl-args" style="white-space:normal">' + esc(n.desc.slice(0, 3).join(' · ')) + '</div>' : '') +
      '</div></div>'
    }

    const ARROW = '<div class="fl-row"><div class="fl-arrow">▼</div></div>'
    const graphHtml = (flow) => {
      if (!flow.nodes.length) return '<div class="tb-notice">在左侧 Markdown 里用 ## 定义步骤、### gate: 定义逻辑门，右侧实时出图</div>'
      const parts = []
      if (flow.title) {
        parts.push('<div class="fl-row"><div class="fl-node" style="border-color:var(--tb-accent-border,rgba(91,141,239,.5));background:rgba(91,141,239,.1)">' +
          '<div class="fl-node-head"><span class="fl-tag" style="color:var(--tb-accent-text,#7fa7f0);background:rgba(91,141,239,.16)">工作流</span>' +
          '<span class="fl-name">' + esc(flow.title) + '</span></div></div></div>')
        parts.push(ARROW)
      }
      let stepIdx = 0
      flow.nodes.forEach((n, i) => {
        if (n.kind === 'step') stepIdx++
        parts.push(nodeHtml(n, stepIdx))
        if (i < flow.nodes.length - 1) parts.push(ARROW)
      })
      return parts.join('')
    }

    // ---- 新建模板 ----
    const TEMPLATE = '# 我的工作流\n\n## 01 输入\n收集需求与上下文\n\n## 02 研究\n检索资料、分析方案\n\n### gate:ifElse 质量达标？\n- 是 → 03 输出\n- 否 → 02 研究\n\n## 03 输出\n产出结果并复盘\n'

    // ---- 渲染 ----
    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      // 文件行
      parts.push('<div class="tb-row">' +
        '<select class="tb-select" data-field="pick">' +
          '<option value="">（选择工作流）</option>' +
          (st.files || []).map((f) => '<option value="' + esc(f) + '"' + (f === st.name ? ' selected' : '') + '>' + esc(f) + '</option>').join('') +
        '</select>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="open">打开</button>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="new">新建</button>' +
        (st.name ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-danger-ghost" data-action="del">' + (st.confirmDel ? '再点一次确认删除' : '删除') + '</button>' : '') +
      '</div>')
      // 名称 + 保存
      if (st.name) {
        parts.push('<div class="tb-row">' +
          '<input class="tb-input tb-mono" data-field="name" value="' + esc(st.name) + '" title="文件名（不含 .md）" />' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="save">保存</button>' +
          (st.dirty ? '<span class="tb-note tb-tx-warn">● 未保存</span>' : '<span class="tb-note">已保存</span>') +
          '<span class="tb-note">' + esc(REL_DIR + '/' + st.name + '.md') + '</span>' +
        '</div>')
        // 视图切换
        parts.push('<div class="tb-chips">' +
          [['split', '分屏'], ['edit', '仅编辑'], ['graph', '仅流程图']].map(([v, l]) =>
            '<button type="button" class="tb-chip' + (st.view === v ? ' tb-chip-on' : '') + '" data-action="view" data-v="' + v + '">' + l + '</button>'
          ).join('') +
          '<span class="tb-note">## 步骤 · ### gate:门 · - 是→目标</span>' +
        '</div>')
      }
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      // 编辑 + 预览
      if (st.name) {
        const flow = parseFlow(st.md)
        const showEdit = st.view !== 'graph'
        const showGraph = st.view !== 'edit'
        if (showEdit) {
          parts.push('<div class="tb-sec"><span class="tb-sec-label">Markdown（唯一事实来源）</span>' +
            '<textarea class="tb-textarea tb-mono" data-field="md" style="min-height:' + (st.view === 'split' ? '160px' : '320px') + '" placeholder="## 01 步骤名&#10;描述&#10;### gate:ifElse 条件名&#10;- 是 → 目标步骤&#10;- 否 → 目标步骤">' + esc(st.md || '') + '</textarea></div>')
        }
        if (showGraph) {
          parts.push('<div class="tb-sec"><span class="tb-sec-label">流程图（' + flow.nodes.length + ' 节点）</span>' +
            '<div style="display:flex;flex-direction:column;gap:2px;border:1px solid var(--tb-border,#35363e);border-radius:8px;padding:10px;max-height:420px;overflow:auto">' +
            graphHtml(flow) + '</div></div>')
        }
      } else {
        parts.push('<div class="tb-notice">新建或打开一个工作流开始编辑；Markdown 是唯一事实来源，流程图实时预览</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    // ---- handler ----
    // 文件名消毒（state 回传的 name 不可信）：剔除路径分隔符、.. 遍历、前导点、控制字符——
    // 防 save/del/open 把相对路径解析到 flows 目录外（Qwen 评审指出的路径遍历→任意文件删除）
    const sanitizeName = (n) => String(n == null ? '' : n)
      .replace(/\.{2,}/g, '')          // .. 路径遍历
      .replace(/[\\/:*?"<>|]/g, '')     // 路径分隔符与非法字符
      .replace(/^\.+/, '')              // 前导点
      .trim()

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { files: [], name: '', md: '', dirty: false, view: 'split', notice: null, confirmDel: false }
      if (!Array.isArray(st.files)) st.files = []
      const el = fields && fields.__el ? fields.__el : {}
      // state 回传的 name 统一消毒（不可信输入）
      st.name = sanitizeName(st.name)
      // md 体量上限：state 每次动作往返传输，超阈值截断防大包（64KB）
      const MD_CAP = 64 * 1024
      if (typeof st.md === 'string' && st.md.length > MD_CAP) {
        st.md = st.md.slice(0, MD_CAP)
        st.notice = '⚠ 文档超 64KB 已截断（state 每次动作往返，过大影响响应）'
      }
      // 同步表单
      if (typeof fields.md === 'string' && fields.md !== st.md) { st.md = fields.md.length > MD_CAP ? fields.md.slice(0, MD_CAP) : fields.md; st.dirty = true }
      if (typeof fields.name === 'string') {
        const fn = sanitizeName(fields.name)
        if (fn !== st.name) { st.name = fn; st.dirty = true }
      }
      const pick = sanitizeName(typeof fields.pick === 'string' ? fields.pick : '')

      if (action === 'new') {
        st.name = 'workflow-' + String(Date.now()).slice(-5)
        st.md = TEMPLATE
        st.dirty = true
        st.confirmDel = false
        st.notice = '已生成模板，点「保存」落盘到 ' + REL_DIR
      } else if (action === 'open') {
        const target = pick || st.name
        if (!target) {
          st.notice = '先在下拉里选一个工作流'
        } else {
          const content = await readFlow(ws.root, target)
          if (content == null) {
            st.notice = '文件不存在: ' + target + '.md'
          } else {
            st.name = target
            st.md = content
            st.dirty = false
            st.confirmDel = false
            st.notice = null
          }
        }
      } else if (action === 'save') {
        if (!st.name) {
          st.notice = '请填写文件名'
        } else {
          try {
            await saveFlow(ws.root, ws.session, st.name, st.md || '')
            st.dirty = false
            st.notice = '已保存 ' + st.name + '.md'
            st.files = await listFlows(ws.root)
          } catch (e) {
            st.notice = '⚠ 保存失败: ' + String((e && e.message) || e)
          }
        }
      } else if (action === 'del') {
        if (!st.confirmDel) {
          st.confirmDel = true
          st.notice = '⚠ 再点一次「删除」确认移除 ' + st.name + '.md'
        } else {
          await deleteFlow(ws.root, st.name)
          st.notice = '已删除 ' + st.name + '.md'
          st.name = ''
          st.md = ''
          st.dirty = false
          st.confirmDel = false
          st.files = await listFlows(ws.root)
        }
      } else if (action === 'view' && el.v) {
        st.view = ['split', 'edit', 'graph'].indexOf(el.v) >= 0 ? el.v : 'split'
      } else if (action === '') {
        st.files = await listFlows(ws.root)
        st.notice = null
      }
      // 每次动作后刷新文件列表（轻量）
      if (action && action !== '') st.files = await listFlows(ws.root)
      return { ok: true, html: render(st), state: st }
    }

    tryRegisterTool(ctx, { id: 'flowedit', label: '工作流', order: 5, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 2.5l2.5 2.5-7 7H4v-2.5z"/><path d="M3.5 12.5h9"/></svg>' }, handler)
  },
}

}

const create_trace = () => {
// ===== trace-tool.js：会话轨迹工具（Host-only，HTML 面板经工具箱 RPC 渲染）=====
// 数据源：sessionQuery.readSession(当前会话) 完整日志（含 tool/call、tool/result、
// user/message、assistant/message、usage），构建 技能/插件/MCP/子代理/命令/文件/内置工具 调用
// 时间线；点击任意条目查看完整输入（arguments 美化）与输出（result 文本）。
// 状态：{ sid, filter, detail }（均为轻量标量；事件本体每次动作重读，不进 state）

return {
  name: 'trace-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')

    // ---- 性能：事件模型缓存（shared-host 的 readLog 负责事件缓存，这里缓存 build 结果） ----
    const readLog = sq ? makeSessionLogReader(ctx, sq) : null
    let modelCache = null   // { sid, count, model, header }
    let recentCache = []    // 会话下拉选项缓存（refresh/pick/首次 才重取）

    const getModel = async (sid) => {
      const r = await readLog(sid)
      if (!modelCache || modelCache.sid !== sid || modelCache.count !== r.count) {
        await loadManifestTools()
        modelCache = { sid, count: r.count, model: build(r.events), header: r.header }
      }
      return modelCache
    }

    // ---- 工具分类（真实来源优先，名字启发式兜底）----
    // 插件类判定三层：
    //   1. cordis_*：动态插件管理面（内置管理工具，语义上属插件体系）
    //   2. ssh_* 等已知宿主组合插件前缀：宿主组合插件注册工具时注册表不留来源标记，只能按名约定
    //   3. 清单 modelTools：plugins.json 各条目声明的模型工具名（make-payloads.mjs 为事实源）。
    //      沙箱的 ctx.tools.get 被刻意降级成 schema 视图（拿不到 harness.registerTool 的动态标记，
    //      日志事件也无 origin 字段），清单是动态插件工具归类的唯一事实源；随 model 重建刷新。
    let manifestTools = []
    const loadManifestTools = async () => {
      try {
        const found = await findManifest(ctx)
        const list = found && found.manifest && Array.isArray(found.manifest.plugins) ? found.manifest.plugins : []
        const names = []
        for (const e of list) {
          if (e && Array.isArray(e.modelTools)) {
            for (const n of e.modelTools) if (typeof n === 'string' && n) names.push(n)
          }
        }
        manifestTools = names
      } catch (e) {}
    }
    const RE_SKILL = /^skill$/
    const RE_MCP = /mcp/i
    const RE_SUBAGENT = /^(subagent|subagent_fork|send_message|interrupt_agent|list_agents|workflow|ralph)$/
    // 命令执行类（pwsh/bash/终端/run_code）：独立于「内置」兜底——这类调用副作用大、排查时常看
    const RE_SHELL = /^(pwsh|bash|sh|terminal_(open|send|read|close|list|signal)|run_code)$/
    // 文件操作类（read/write/edit/glob/grep/read_image）：从「内置」拆出，排查文件改动时高频
    const RE_FILE = /^(read|write|edit|glob|grep|read_image)$/
    const kindOf = (name) => {
      if (/^cordis_/.test(name)) return 'cordis'
      if (/^ssh_/.test(name)) return 'cordis'
      if (manifestTools.indexOf(name) >= 0) return 'cordis'
      if (RE_SKILL.test(name)) return 'skill'
      if (RE_MCP.test(name)) return 'mcp'
      if (RE_SUBAGENT.test(name)) return 'subagent'
      if (RE_SHELL.test(name)) return 'shell'
      if (RE_FILE.test(name)) return 'file'
      return 'builtin'
    }
    const KIND_META = {
      skill: { label: '技能', pill: 'tb-pill-active' },
      cordis: { label: '插件', pill: 'tb-pill-other' },
      mcp: { label: 'MCP', pill: 'tb-pill-done' },
      subagent: { label: '子代理', pill: 'tb-pill-plain' },
      shell: { label: '命令', pill: 'tb-pill-warn' },
      file: { label: '文件', pill: 'tb-pill-active' },
      builtin: { label: '内置', pill: 'tb-pill-plain' },
      msg: { label: '消息', pill: 'tb-pill-plain' },
      user: { label: '用户', pill: 'tb-pill-done' },
      ai: { label: '助手', pill: 'tb-pill-active' },
    }

    const FILTERS = [
      ['skill', '技能'], ['cordis', '插件'], ['mcp', 'MCP'],
      ['subagent', '子代理'], ['shell', '命令'], ['file', '文件'],
      ['builtin', '内置'], ['msg', '消息'], ['error', '失败'],
    ]
    // 「失败」是状态过滤（只看失败调用，与其他分类为并集），不参与「全部」分类开关
    const ALL_CATS = FILTERS.map(([v]) => v).filter((v) => v !== 'error')
    const DEFAULT_FILTERS = ['skill', 'cordis', 'mcp', 'shell']

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => {
      const d = new Date(t)
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    }
    const fmtDur = (ms) => ms == null ? '' : (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's')
    const fmtTok = (n) => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n)
    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && b.type === 'text' ? b.text : '')).filter(Boolean).join('\n')
    }

    // ---- 日志 → 时间线条目 + 统计 ----
    const build = (events) => {
      const items = []
      const byCallId = {}
      const bySeq = {}
      const stats = { turns: 0, steps: 0, calls: 0, inTok: 0, outTok: 0, errors: 0 }
      for (const ev of events) {
        if (!ev || typeof ev.seq !== 'number') continue
        bySeq[ev.seq] = ev
        const d = ev.data || {}
        if (ev.type === 'turn/start') stats.turns++
        else if (ev.type === 'step/start') stats.steps++
        else if (ev.type === 'tool/call') {
          stats.calls++
          const it = {
            kind: 'call', seq: ev.seq, time: ev.time, turn: d.turn, step: d.step,
            name: String(d.name || '?'), cat: kindOf(String(d.name || '')),
            argsRaw: typeof d.arguments === 'string' ? d.arguments : '',
            status: 'pending', dur: null, outLen: 0, resSeq: null,
          }
          items.push(it)
          if (d.callId != null) byCallId[String(d.callId)] = it
        } else if (ev.type === 'tool/result') {
          const m = d.message || {}
          const block = Array.isArray(m.content) ? m.content[0] : null
          const callId = block && block.toolCallId != null ? String(block.toolCallId) : null
          const text = block ? textOf(block.content) : ''
          const failed = !!(d.error || (block && block.isError))
          if (failed) stats.errors++
          const it = callId ? byCallId[callId] : null
          if (it) {
            it.status = failed ? 'error' : 'ok'
            it.dur = ev.time - it.time
            it.outLen = text.length
            it.resSeq = ev.seq
          }
        } else if (ev.type === 'user/message') {
          const m = d
          const src = m.source && m.source.kind ? String(m.source.kind) : 'user'
          items.push({
            kind: 'msg', role: src === 'user' ? 'user' : 'inject', seq: ev.seq, time: ev.time,
            preview: oneLine(textOf(m.content), 90),
          })
        } else if (ev.type === 'assistant/message') {
          const m = d.message || {}
          const u = d.usage || null
          if (u) {
            stats.inTok += (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
            stats.outTok += (u.outputTokens || 0)
          }
          items.push({
            kind: 'msg', role: 'ai', seq: ev.seq, time: ev.time,
            preview: oneLine(textOf(m.content), 90) || '（工具调用）',
            tok: u ? (u.outputTokens || 0) : null,
          })
        }
      }
      return { items, bySeq, byCallId, stats }
    }

    const matchFilter = (it, filters) => {
      // 失败过滤：只看 status=error 的调用（与分类并集）
      if (filters.indexOf('error') >= 0 && it.kind === 'call' && it.status === 'error') return true
      const cat = it.kind === 'msg' ? 'msg' : it.cat
      return filters.indexOf(cat) >= 0
    }

    const statusHtml = (it) => {
      if (it.status === 'ok') return '<span class="tb-tx-done">✓ ' + fmtDur(it.dur) + '</span>'
      if (it.status === 'error') return '<span class="tb-tx-danger">✗ ' + fmtDur(it.dur) + '</span>'
      return '<span class="tb-tx-warn">… 待结果</span>'
    }

    const renderRow = (it, detailSeq) => {
      const km = it.kind === 'call' ? KIND_META[it.cat] : KIND_META[it.role === 'user' || it.role === 'inject' ? 'user' : 'ai']
      const active = detailSeq === it.seq ? ' tb-rec-active' : ''
      if (it.kind === 'call') {
        return '<div class="tb-rec' + active + '" data-action="detail" data-seq="' + it.seq + '">' +
          '<div class="tb-rec-main">' +
            '<div class="tb-rec-top">' +
              '<span class="tb-pill ' + km.pill + '">' + km.label + '</span>' +
              '<span class="tb-rec-key">' + esc(it.name) + '</span>' +
              '<span class="tb-rec-summary">' + esc(oneLine(it.argsRaw, 80)) + '</span>' +
            '</div>' +
            '<div class="tb-rec-sub">' +
              '<span>T' + it.turn + '·S' + it.step + '</span>' +
              '<span>' + fmtTime(it.time) + '</span>' +
              statusHtml(it) +
              (it.outLen ? '<span>输出 ' + fmtSize(it.outLen) + '</span>' : '') +
              '<span>#' + it.seq + '</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      }
      const tag = it.role === 'inject' ? '注入' : km.label
      return '<div class="tb-rec' + active + '" data-action="detail" data-seq="' + it.seq + '">' +
        '<div class="tb-rec-main">' +
          '<div class="tb-rec-top">' +
            '<span class="tb-pill ' + km.pill + '">' + tag + '</span>' +
            '<span class="tb-rec-summary">' + esc(it.preview) + '</span>' +
          '</div>' +
          '<div class="tb-rec-sub">' +
            '<span>' + fmtTime(it.time) + '</span>' +
            (it.tok ? '<span>+' + fmtTok(it.tok) + ' tok</span>' : '') +
            '<span>#' + it.seq + '</span>' +
          '</div>' +
        '</div>' +
      '</div>'
    }

    // 复制用：取详情某部分的完整原文（不截断，截断只用于展示）
    const copyText = (model, seq, which) => {
      const ev = model.bySeq[seq]
      if (!ev) return null
      const d = ev.data || {}
      if (ev.type === 'tool/call') {
        if (which === 'in') {
          let input = d.arguments || ''
          try { input = JSON.stringify(JSON.parse(d.arguments), null, 2) } catch (e) {}
          return input || null
        }
        const it = model.byCallId[d.callId != null ? String(d.callId) : '']
        if (!it || it.resSeq == null) return null
        const rev = model.bySeq[it.resSeq]
        const rm = rev && rev.data && rev.data.message
        const block = rm && Array.isArray(rm.content) ? rm.content[0] : null
        const text = block ? textOf(block.content) : ''
        return text || null
      }
      const m = ev.type === 'assistant/message' ? (d.message || {}) : d
      return textOf(m.content) || null
    }

    // ---- 详情卡（输入/输出完整内容）----
    const renderDetail = (model, detailSeq) => {
      const ev = model.bySeq[detailSeq]
      if (!ev) return ''
      const d = ev.data || {}
      const isCall = ev.type === 'tool/call'
      const head = '<div class="tb-preview-head">' +
        '<span class="tb-preview-name">详情 #' + detailSeq + '</span>' +
        (isCall
          ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-in">复制输入</button>' +
            '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-out">复制输出</button>'
          : '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-text">复制</button>') +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close-detail">关闭</button></div>'
      if (isCall) {
        let input = d.arguments || ''
        try { input = JSON.stringify(JSON.parse(d.arguments), null, 2) } catch (e) {}
        const it = model.byCallId[d.callId != null ? String(d.callId) : '']
        let out = ''
        if (it && it.resSeq != null) {
          const rev = model.bySeq[it.resSeq]
          const rm = rev && rev.data && rev.data.message
          const block = rm && Array.isArray(rm.content) ? rm.content[0] : null
          const text = block ? textOf(block.content) : ''
          const err = rev && rev.data && rev.data.error
          out = (err ? '[error] ' + esc(err.name || '') + ' ' + esc(err.code || '') + '\n\n' : '') +
            esc(text.length > 12000 ? text.slice(0, 12000) + '\n…（截断，共 ' + text.length + ' 字符）' : text)
        } else {
          out = '（尚无结果事件）'
        }
        return '<div class="tb-preview">' + head +
          '<div class="tb-sec"><span class="tb-sec-label">输入 · ' + esc(String(d.name || '')) + '（T' + d.turn + '·S' + d.step + '）</span>' +
          '<pre class="tb-code">' + esc(input) + '</pre></div>' +
          '<div class="tb-sec"><span class="tb-sec-label">输出</span>' +
          '<pre class="tb-code">' + out + '</pre></div></div>'
      }
      const m = ev.type === 'assistant/message' ? (d.message || {}) : d
      const u = ev.type === 'assistant/message' ? d.usage : null
      const text = textOf(m.content)
      return '<div class="tb-preview">' + head +
        (u ? '<div class="tb-rec-sub"><span>输入 ' + fmtTok((u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)) + ' tok</span><span>输出 ' + fmtTok(u.outputTokens || 0) + ' tok</span>' + (u.cacheReadTokens ? '<span>缓存命中 ' + fmtTok(u.cacheReadTokens) + '</span>' : '') + '</div>' : '') +
        '<pre class="tb-code">' + esc(text.length > 12000 ? text.slice(0, 12000) + '\n…（截断，共 ' + text.length + ' 字符）' : text) + '</pre></div>'
    }

    const handler = async ({ action, fields, state, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { sid: null, filters: DEFAULT_FILTERS.slice(), detail: null }
      // 旧版单选 state 迁移：filter: 'all' → 全选；filter: 'xxx' → [xxx]
      if (!Array.isArray(st.filters)) {
        st.filters = st.filter && st.filter !== 'all' ? [String(st.filter)] : ALL_CATS.slice()
        delete st.filter
      }
      const el = fields && fields.__el ? fields.__el : {}

      if (action === 'filter' && el.v) {
        const v = String(el.v)
        if (v === 'all') {
          // 「全部」只切分类位，保留「失败」位
          const errOn = st.filters.indexOf('error') >= 0
          const allOn = ALL_CATS.every((c) => st.filters.indexOf(c) >= 0)
          st.filters = allOn ? (errOn ? ['error'] : []) : ALL_CATS.concat(errOn ? ['error'] : [])
        } else {
          const i = st.filters.indexOf(v)
          if (i >= 0) st.filters.splice(i, 1); else st.filters.push(v)
        }
        st.detail = null
      }
      else if (action === 'detail' && el.seq) { const n = Number(el.seq); st.detail = st.detail === n ? null : n }
      else if (action === 'close-detail') st.detail = null
      else if (action === 'pick') { st.sid = fields.sid || null; st.detail = null }

      try {
        // 会话解析：state 覆盖 → 当前会话（Client 透传）→ 最新会话
        // 下拉选项只在 首次/刷新/切换 时重取（listSessions 有持久化扫描成本）
        let sid = st.sid || session || null
        if (recentCache.length === 0 || action === '' || action === 'refresh' || action === 'pick') {
          try {
            recentCache = (await sq.listSessions()).slice(0, 20)
          } catch (e) {}
        }
        const recent = recentCache
        if (!sid && recent.length) sid = String((recent[0].header || {}).id || '')
        if (!sid) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到会话</div></div>', state: st }
        st.sid = sid

        const got = await getModel(sid)
        const model = got.model
        const st2 = model.stats
        const shortId = sid.replace(/^session-/, '').slice(0, 8)
        const header = got.header || {}
        const cwdName = String(header.cwd || '').split(/[\\/]/).filter(Boolean).pop() || ''

        const filtered = model.items.filter((it) => matchFilter(it, st.filters))
        const CAP = 400
        const shown = filtered.slice(-CAP).reverse()

        const parts = []
        parts.push('<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">')
        // 统计行
        parts.push('<div class="tb-stats">' +
          '<div class="tb-stat"><span class="tb-stat-num">' + st2.turns + '</span><span class="tb-stat-label">轮次</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + st2.steps + '</span><span class="tb-stat-label">步骤</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + st2.calls + '</span><span class="tb-stat-label">工具调用</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(st2.inTok) + '</span><span class="tb-stat-label">输入 tok</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(st2.outTok) + '</span><span class="tb-stat-label">输出 tok</span></div>' +
        '</div>')
        // 时间线密度条：按分钟分桶（最近 60 分钟窗口内），柱高 = 该分钟事件数——爆发期一眼可见
        const buckets = {}
        let maxB = -Infinity
        let minB = Infinity
        for (const it of model.items) {
          if (typeof it.time !== 'number') continue
          const b = Math.floor(it.time / 60000)
          buckets[b] = (buckets[b] || 0) + 1
          if (b > maxB) maxB = b
          if (b < minB) minB = b
        }
        if (minB <= maxB) {
          const lo = Math.max(minB, maxB - 59)
          const span = maxB - lo + 1
          const maxN = Math.max.apply(null, Object.keys(buckets).map((k) => buckets[k]).concat([1]))
          const bars = []
          for (let b = lo; b <= maxB; b++) {
            const n = buckets[b] || 0
            const d = new Date(b * 60000)
            bars.push('<div style="flex:1;min-width:2px;height:' + Math.max(1, Math.round((n / maxN) * 24)) + 'px;border-radius:1px;background:' +
              (n ? 'var(--tb-accent,#3f6fd9)' : 'var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33))') + ';opacity:.85" title="' +
              pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' · ' + n + ' 条"></div>')
          }
          parts.push('<div class="tb-note">事件密度（' + span + ' 分钟窗，悬停看每分钟计数）</div>' +
            '<div style="display:flex;align-items:flex-end;gap:1px;height:26px;margin:2px 0 6px">' + bars.join('') + '</div>')
        }
        // 会话行
        const opts = recent.map((r) => {
          const id = String((r.header || {}).id || '')
          const lbl = id.replace(/^session-/, '').slice(0, 8) + (r.live ? ' · 在线' : '')
          return '<option value="' + esc(id) + '"' + (id === sid ? ' selected' : '') + '>' + esc(lbl) + '</option>'
        }).join('')
        parts.push('<div class="tb-row">' +
          '<span class="tb-key" title="' + esc(sid) + '">' + esc(shortId) + '</span>' +
          '<span class="tb-note">' + esc(cwdName) + ' · ' + model.items.length + ' 条事件' + (st2.errors ? ' · <span class="tb-tx-danger">' + st2.errors + ' 失败</span>' : '') + '</span>' +
          '<select class="tb-select" data-field="sid">' + opts + '</select>' +
          '<button type="button" class="tb-btn tb-btn-sm" data-action="pick">切换</button>' +
          '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button>' +
        '</div>')
        // 过滤芯片（多选；「全部」= 分类全选/清空开关，不含「失败」状态位）
        const allOn = ALL_CATS.every((v) => st.filters.indexOf(v) >= 0)
        parts.push('<div class="tb-chips">' +
          '<button type="button" class="tb-chip' + (allOn ? ' tb-chip-on' : '') + '" data-action="filter" data-v="all">全部 ' + model.items.length + '</button>' +
          FILTERS.map(([v, label]) => {
            const n = model.items.filter((it) => matchFilter(it, [v])).length
            return '<button type="button" class="tb-chip' + (st.filters.indexOf(v) >= 0 ? ' tb-chip-on' : '') + '" data-action="filter" data-v="' + v + '">' + label + ' ' + n + '</button>'
          }).join('') + '</div>')
        // 详情卡
        if (st.detail != null) {
          const card = renderDetail(model, st.detail)
          if (card) parts.push(card)
        }
        // 时间线标题（固定头末尾）
        parts.push('<div class="tb-list-head"><span class="tb-list-title">调用时间线<span class="tb-count">' + filtered.length + '</span></span></div>')
        parts.push('</div>') // .tb-pane-head 结束
        // 时间线体：独立滚动；column-reverse —— shown 为最新在前（DOM 序），视觉越下越新，滚动条默认底部
        parts.push('<div class="tb-pane-body">' +
          (shown.length === 0
            ? '<div class="tb-notice">该分类下暂无条目</div>'
            : shown.map((it) => renderRow(it, st.detail)).join('') +
              (filtered.length > CAP ? '<div class="tb-notice">仅显示最近 ' + CAP + ' 条（更早的未加载）</div>' : '')) +
        '</div>')
        parts.push('</div>') // .tb-pane 结束
        const out = { ok: true, html: parts.join(''), state: st }
        if ((action === 'copy-in' || action === 'copy-out' || action === 'copy-text') && st.detail != null) {
          const which = action === 'copy-in' ? 'in' : action === 'copy-out' ? 'out' : 'text'
          const txt = copyText(model, st.detail, which)
          if (txt) out.copy = txt
        }
        return out
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'trace', label: '轨迹', order: 3, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.8"/><path d="M8 2.5V8l3.5 2"/></svg>' }, handler)
  },
}

}

const create_http = () => {
// ===== http-tool.js：HTTP 接口调试工具（Host-only，Postman/Apifox 风格）=====
// method 芯片 + URL + Query Params / Headers 键值对编辑器（启用开关/增删行）+
// Body 类型（none/JSON/raw/form）+ 响应区 Body/响应头切换与 JSON 美化 + 历史一键重发。
// 所有输入常驻 DOM（display:none 隐藏），保证任何动作时表单值完整回传进 state。
// 请求 spec 经环境变量传入 node 子进程 fetch，用户输入不进脚本文本。
// 响应本体留闭包 lastResult（可达 256KB，不进 state——state 每次动作来回传输，必须轻量）。
// 状态：{ method, url, params[], headers[], bodyType, body, form[], tab, resTab, history[] }

return {
  name: 'http-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    let lastResult = null // 最近一次响应本体（闭包持有，不进 state；插件重跑即清空，面板提示重发）

    // 子进程脚本：数组 join 无内嵌 \n 字面量（规避双层求值转义坑）
    const FETCH_SCRIPT = [
      "const spec = JSON.parse(process.env.HTTP_REQ || '{}')",
      "const ctrl = new AbortController()",
      "setTimeout(() => ctrl.abort(), 30000)",
      "const t0 = Date.now()",
      "(async () => {",
      "  try {",
      "    const init = { method: spec.method || 'GET', headers: spec.headers || {}, redirect: 'follow', signal: ctrl.signal }",
      "    if (spec.body != null && spec.body !== '' && init.method !== 'GET' && init.method !== 'HEAD') init.body = spec.body",
      "    const res = await fetch(spec.url, init)",
      "    const buf = Buffer.from(await res.arrayBuffer())",
      "    const headers = {}",
      "    res.headers.forEach((v, k) => { headers[k] = v })",
      "    let body = buf.toString('utf8')",
      "    const truncated = body.length > 262144",
      "    if (truncated) body = body.slice(0, 262144)",
      "    process.stdout.write(JSON.stringify({ ok: true, status: res.status, statusText: res.statusText, headers, body, bytes: buf.length, truncated, ms: Date.now() - t0 }))",
      "  } catch (e) {",
      "    process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e), ms: Date.now() - t0 }))",
      "  }",
      "})()",
    ].join('\n')

    const REL_STORE = '.dsh-dynamic-toolbox/toolbox-http.json'

    // sessionId 优先：root 与 session 同时确定（写策略按会话 cwd 授权）
    const resolveWs = (rootArg, sessionId) => {
      const sessionsSvc = ctx.get('sessions')
      if (sessionId && sessionsSvc) {
        try {
          const s = sessionsSvc.get(sessionId)
          const cwd = s && s.header && s.header.cwd
          if (s && typeof cwd === 'string' && cwd) return { root: cwd.replace(/[\\/]+$/, ''), session: s }
        } catch (e) {}
      }
      if (rootArg && /^([A-Za-z]:[\\/]|\/)/.test(rootArg)) return { root: rootArg.replace(/[\\/]+$/, ''), session: null }
      if (sessionsSvc) {
        try {
          let hit = null
          for (const s of sessionsSvc.list()) {
            const cwd = s && s.header && s.header.cwd
            if (typeof cwd === 'string' && cwd) hit = s
          }
          if (hit) return { root: hit.header.cwd.replace(/[\\/]+$/, ''), session: hit }
        } catch (e) {}
      }
      const sp = ctx.get('sandboxPolicy')
      const root = sp && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot.replace(/[\\/]+$/, '') : ''
      return { root, session: null }
    }

    const runNode = async (script, env, cwd) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      const handle = subprocess.spawn({
        argv: ['node', '-'],
        cwd,
        stdio: { stdin: { data: script }, stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 128 * 1024 } },
        graceMs: 45000,
        env,
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout.readFrom(0).text
      const stderr = handle.collected.stderr.readFrom(0).text
      if (outcome.exitCode !== 0) return { ok: false, error: (stderr || stdout).slice(0, 500) }
      return { ok: true, stdout }
    }

    // ---- 键值对（params/headers/form）同步与组装 ----
    const syncKV = (fields, prefix, cur) => {
      const rows = []
      for (let i = 0; ; i++) {
        const k = fields[prefix + '.k.' + i]
        const v = fields[prefix + '.v.' + i]
        if (k === undefined && v === undefined) break
        rows.push({ k: String(k == null ? '' : k), v: String(v == null ? '' : v), on: cur && cur[i] ? cur[i].on !== false : true })
      }
      return rows
    }
    const enabled = (rows) => (rows || []).filter((r) => r.on !== false && r.k)

    const buildRequest = (st) => {
      let url = st.url || ''
      const qp = enabled(st.params)
      if (qp.length) {
        const q = qp.map((r) => encodeURIComponent(r.k) + '=' + encodeURIComponent(r.v)).join('&')
        url += (url.indexOf('?') >= 0 ? '&' : '?') + q
      }
      const headers = {}
      for (const r of enabled(st.headers)) headers[r.k] = r.v
      let body = null
      if (st.bodyType === 'json') {
        body = st.body || ''
        if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'
      } else if (st.bodyType === 'raw') {
        body = st.body || ''
      } else if (st.bodyType === 'form') {
        body = enabled(st.form).map((r) => encodeURIComponent(r.k) + '=' + encodeURIComponent(r.v)).join('&')
        if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
      return { method: st.method, url, headers, body }
    }

    const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
    const BODY_TYPES = [['none', 'none'], ['json', 'JSON'], ['raw', 'raw'], ['form', 'form']]
    const TABS = [['params', 'Params'], ['headers', 'Headers'], ['body', 'Body']]
    const statusPill = (s) => {
      if (s >= 200 && s < 300) return 'tb-pill-done'
      if (s >= 300 && s < 400) return 'tb-pill-active'
      if (s >= 400 && s < 500) return 'tb-pill-other'
      return 'tb-pill-plain'
    }
    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const prettyBody = (body) => {
      const t = String(body || '')
      try { return JSON.stringify(JSON.parse(t), null, 2) } catch (e) { return t }
    }

    // ---- 键值对编辑器（Postman 风格：开关 + key + value + 删除 + 添加行）----
    const renderKV = (list, rows, addLabel) => {
      const rowsHtml = (rows || []).map((r, i) =>
        '<div class="tb-row" style="flex-wrap:nowrap;gap:5px">' +
          '<button type="button" class="tb-chip' + (r.on !== false ? ' tb-chip-on' : '') + '" style="height:20px;padding:0 7px;flex:none" data-action="kv-toggle" data-list="' + list + '" data-i="' + i + '" title="启用/禁用">' + (r.on !== false ? '✓' : '○') + '</button>' +
          '<input class="tb-input tb-mono" style="height:26px;width:36%;flex:none" data-field="' + list + '.k.' + i + '" placeholder="Key" value="' + esc(r.k) + '" />' +
          '<input class="tb-input tb-mono" style="height:26px" data-field="' + list + '.v.' + i + '" placeholder="Value" value="' + esc(r.v) + '" />' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" style="flex:none" data-action="kv-del" data-list="' + list + '" data-i="' + i + '" title="删除">×</button>' +
        '</div>'
      ).join('')
      return rowsHtml + '<div class="tb-row"><button type="button" class="tb-btn tb-btn-sm" data-action="kv-add" data-list="' + list + '">+ ' + addLabel + '</button></div>'
    }

    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      // 方法 + URL + 发送
      parts.push('<div class="tb-chips">' + METHODS.map((m) =>
        '<button type="button" class="tb-chip' + (st.method === m ? ' tb-chip-on' : '') + '" data-action="method" data-v="' + m + '">' + m + '</button>'
      ).join('') + '</div>')
      parts.push('<div class="tb-query">' +
        '<input class="tb-input tb-mono" data-field="url" placeholder="https://api.example.com/path" value="' + esc(st.url || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="send">发送</button>' +
      '</div>')
      // 最终 URL 预览（Params 合并后）
      const req = buildRequest(st)
      if (st.url && req.url !== st.url) {
        parts.push('<div class="tb-note tb-mono" style="word-break:break-all">最终 URL：' + esc(req.url) + '</div>')
      }
      // 分区芯片
      const tab = st.tab || 'params'
      parts.push('<div class="tb-chips">' + TABS.map(([v, label]) => {
        const n = v === 'params' ? enabled(st.params).length : v === 'headers' ? enabled(st.headers).length : (st.bodyType === 'form' ? enabled(st.form).length : (st.bodyType === 'none' ? 0 : 1))
        return '<button type="button" class="tb-chip' + (tab === v ? ' tb-chip-on' : '') + '" data-action="tab" data-v="' + v + '">' + label + (n ? ' ' + n : '') + '</button>'
      }).join('') + '</div>')

      // 三个分区全部渲染，非活跃区 display:none（保证字段随任何动作回传）
      parts.push('<div style="' + (tab === 'params' ? '' : 'display:none') + '">' + renderKV('params', st.params, '参数') + '</div>')
      parts.push('<div style="' + (tab === 'headers' ? '' : 'display:none') + '">' + renderKV('headers', st.headers, '请求头') + '</div>')
      let bodyHtml = '<div class="tb-chips" style="margin-bottom:8px">' + BODY_TYPES.map(([v, label]) =>
        '<button type="button" class="tb-chip' + (st.bodyType === v ? ' tb-chip-on' : '') + '" data-action="body-type" data-v="' + v + '">' + label + '</button>'
      ).join('') + '</div>'
      if (st.bodyType === 'json' || st.bodyType === 'raw') {
        bodyHtml += '<textarea class="tb-textarea" data-field="body" placeholder="' + (st.bodyType === 'json' ? '{ "key": "value" }' : '原始请求体') + '">' + esc(st.body || '') + '</textarea>'
      } else if (st.bodyType === 'form') {
        bodyHtml += renderKV('form', st.form, '表单项')
      } else {
        bodyHtml += '<div class="tb-note">无请求体</div>'
      }
      parts.push('<div style="' + (tab === 'body' ? '' : 'display:none') + '">' + bodyHtml + '</div>')

      // 响应区（本体在闭包 lastResult；state 不带它，切换 Tab/KV 编辑不再来回传大 JSON）
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      const r = lastResult
      if (r) {
        if (!r.ok) {
          parts.push('<div class="tb-banner tb-banner-error">' + esc(r.error || '请求失败') + (r.ms != null ? '（' + r.ms + 'ms）' : '') + '</div>')
        } else {
          const resTab = st.resTab || 'body'
          parts.push('<div class="tb-card">' +
            '<div class="tb-card-head">' +
              '<span class="tb-pill ' + statusPill(r.status) + '">' + r.status + ' ' + esc(r.statusText || '') + '</span>' +
              '<span class="tb-note">' + r.ms + 'ms · ' + fmtSize(r.bytes) + (r.truncated ? ' · 已截断' : '') + '</span>' +
            '</div>' +
            '<div class="tb-chips">' +
              '<button type="button" class="tb-chip' + (resTab === 'body' ? ' tb-chip-on' : '') + '" data-action="res-tab" data-v="body">响应体</button>' +
              '<button type="button" class="tb-chip' + (resTab === 'headers' ? ' tb-chip-on' : '') + '" data-action="res-tab" data-v="headers">响应头 ' + Object.keys(r.headers || {}).length + '</button>' +
              (r.body ? '<button type="button" class="tb-chip" data-action="copy-res">复制响应体</button>' : '') +
            '</div>' +
            (resTab === 'body'
              ? '<pre class="tb-code" style="max-height:480px">' + esc(prettyBody(r.body) || '（空）') + '</pre>'
              : '<div class="tb-sec">' + Object.keys(r.headers || {}).map((k) =>
                  '<div class="tb-line"><span class="tb-line-status tb-tx-muted" style="width:auto;min-width:120px;text-align:left">' + esc(k) + '</span><span class="tb-line-path">' + esc(r.headers[k]) + '</span></div>'
                ).join('') + '</div>') +
          '</div>')
        }
      }

      // 历史
      const h = st.history || []
      if (h.length) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">历史<span class="tb-count">' + h.length + '</span></span>' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear-history">清空</button></div>')
        parts.push('<div class="tb-list">' + h.map((it, i) =>
          '<div class="tb-rec" data-action="rerun" data-i="' + i + '" title="点击重新发送">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-pill tb-pill-plain">' + esc(it.m) + '</span>' +
              '<span class="tb-rec-summary">' + esc(oneLine(it.u, 70)) + '</span></div>' +
              '<div class="tb-rec-sub"><span>' + (it.s ? '<span class="' + (it.s < 400 ? 'tb-tx-done' : 'tb-tx-danger') + '">' + it.s + '</span>' : '<span class="tb-tx-danger">失败</span>') + '</span>' +
              '<span>' + (it.ms != null ? it.ms + 'ms' : '') + '</span><span>' + fmtClock(it.t) + '</span></div>' +
            '</div>' +
          '</div>'
        ).join('') + '</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    const send = async (st, ws) => {
      const spec = buildRequest(st)
      const res = await runNode(FETCH_SCRIPT, { HTTP_REQ: JSON.stringify(spec) }, ws.root)
      if (!res.ok) { lastResult = { ok: false, error: res.error }; return }
      try {
        lastResult = JSON.parse(res.stdout)
      } catch (e) {
        lastResult = { ok: false, error: '响应解析失败: ' + res.stdout.slice(0, 300) }
      }
      const r = lastResult
      st.history = [{
        m: spec.method, u: spec.url,
        params: st.params, headers: st.headers, bodyType: st.bodyType, body: st.body, form: st.form,
        s: r.ok ? r.status : 0, ms: r.ms != null ? r.ms : null, t: Date.now(),
      }].concat(st.history || []).slice(0, 8)
      const persisted = await writeJsonStore(ctx, REL_STORE, st.history, ws.root, ws.session)
      st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWs(root, session)
      const st = (state && typeof state === 'object' && state) ? state : {
        method: 'GET', url: '', params: [], headers: [], bodyType: 'none', body: '', form: [],
        tab: 'params', resTab: 'body', history: [], notice: null,
      }
      if ('result' in st) delete st.result // state 迁移：响应本体已挪闭包（旧 state 里可能还挂着大 JSON）
      if (!Array.isArray(st.params)) st.params = []
      if (!Array.isArray(st.headers)) st.headers = []
      if (!Array.isArray(st.form)) st.form = []
      const el = fields && fields.__el ? fields.__el : {}
      // 全量表单同步（所有输入常驻 DOM，任何动作时值都在 fields 里）
      if (typeof fields.url === 'string') st.url = fields.url
      if (typeof fields.body === 'string') st.body = fields.body
      const p = syncKV(fields, 'params', st.params); if (p.length || st.tab === 'params') st.params = p
      const hh = syncKV(fields, 'headers', st.headers); if (hh.length || st.tab === 'headers') st.headers = hh
      const f = syncKV(fields, 'form', st.form); if (f.length || (st.tab === 'body' && st.bodyType === 'form')) st.form = f

      const LIST_OF = { params: 'params', headers: 'headers', form: 'form' }
      if (action === 'method' && el.v) st.method = String(el.v)
      else if (action === 'tab' && el.v) st.tab = String(el.v)
      else if (action === 'res-tab' && el.v) st.resTab = String(el.v)
      else if (action === 'body-type' && el.v) st.bodyType = String(el.v)
      else if (action === 'kv-add' && LIST_OF[el.list]) st[el.list].push({ k: '', v: '', on: true })
      else if (action === 'kv-del' && LIST_OF[el.list] && el.i != null) st[el.list].splice(Number(el.i), 1)
      else if (action === 'kv-toggle' && LIST_OF[el.list] && el.i != null) {
        const row = st[el.list][Number(el.i)]
        if (row) row.on = row.on === false
      }
      else if (action === 'send') {
        if (!/^https?:\/\//i.test(st.url || '')) {
          lastResult = { ok: false, error: '请输入以 http(s):// 开头的 URL' }
        } else {
          await send(st, ws)
        }
      }
      else if (action === 'rerun' && el.i != null) {
        const it = (st.history || [])[Number(el.i)]
        if (it) {
          st.method = it.m; st.url = it.u
          st.params = it.params || []; st.headers = it.headers || []
          st.bodyType = it.bodyType || 'none'; st.body = it.body || ''; st.form = it.form || []
          await send(st, ws)
        }
      }
      else if (action === 'clear-history') {
        st.history = []
        const persisted = await writeJsonStore(ctx, REL_STORE, [], ws.root, ws.session)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
      }
      else if (action === '') {
        // 打开 Tab：磁盘为准恢复历史（面板 state 只是镜像）
        const saved = await readJsonStore(ctx, REL_STORE, ws.root, null)
        if (Array.isArray(saved)) st.history = saved
        st.notice = null
      }

      const out = { ok: true, html: render(st), state: st }
      if (action === 'copy-res' && lastResult && lastResult.ok && lastResult.body) out.copy = lastResult.body
      return out
    }

    tryRegisterTool(ctx, { id: 'http', label: 'HTTP', order: 4, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h9"/><path d="M8 4.5L11.5 8 8 11.5"/><circle cx="13.5" cy="8" r="1.2"/></svg>' }, handler)
  },
}

}

const create_ports = () => {
// ===== ports-tool.js：端口与进程查看工具（Host-only，HTML 面板经工具箱 RPC 渲染）=====
// pwsh Get-NetTCPConnection 列 LISTEN 端口（地址/端口/PID/进程名），支持过滤、刷新、
// 两步确认结束进程（先「结束」武装 → 再「确认结束」执行 Stop-Process）。
// 状态：{ rows, q, arm, error }（rows 为标量小对象数组，纯 JSON）

return {
  name: 'ports-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')

    // node 子进程：netstat 列 LISTEN + tasklist 取进程名（子进程是真实 node，process/Buffer 可用；
    // 插件求值器里这些全局被遮蔽——脚本只经 stdin 传入，绝不在插件侧拼用户输入）
    // 注意 impl 字符串转义：'\\s' → 子脚本 '\s'，'\\d' → '\d'
    const LIST_SCRIPT = [
      'const { spawnSync } = require("child_process")',
      'const n = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", maxBuffer: 8388608 })',
      'const tl = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", maxBuffer: 8388608 })',
      'const procs = {}',
      'for (const line of String(tl.stdout || "").split(/\\r?\\n/)) {',
      '  const m = /^"([^"]*)","(\\d+)"/.exec(line)',
      '  if (m) procs[m[2]] = m[1]',
      '}',
      'const rows = []',
      'for (const line of String(n.stdout || "").split(/\\r?\\n/)) {',
      '  const t = line.trim().split(/\\s+/)',
      '  if (t.length >= 5 && t[3] === "LISTENING") {',
      '    const lp = t[1]',
      '    const idx = lp.lastIndexOf(":")',
      '    if (idx > 0) {',
      '      const pid = t[4]',
      '      rows.push({ addr: lp.slice(0, idx), port: Number(lp.slice(idx + 1)), pid: Number(pid), proc: procs[pid] || "" })',
      '    }',
      '  }',
      '}',
      'process.stdout.write(JSON.stringify(rows))',
    ].join('\n')

    const runNode = async (script, argv1) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      const spec = {
        argv: argv1 == null ? ['node', '-'] : ['node', '-e', script, String(argv1)],
        stdio: argv1 == null
          ? { stdin: { data: script }, stdout: { maxBytes: 2 * 1024 * 1024 }, stderr: { maxBytes: 128 * 1024 } }
          : { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 64 * 1024 } },
        graceMs: 30000,
      }
      const handle = subprocess.spawn(spec)
      const outcome = await handle.done
      const stdout = handle.collected.stdout.readFrom(0).text
      const stderr = handle.collected.stderr.readFrom(0).text
      if (outcome.exitCode !== 0) return { ok: false, error: (stderr || stdout).slice(0, 500) }
      return { ok: true, stdout }
    }

    const loadRows = async () => {
      const res = await runNode(LIST_SCRIPT)
      if (!res.ok) return { error: res.error, rows: [] }
      try {
        const parsed = JSON.parse(res.stdout.trim() || '[]')
        const rows = Array.isArray(parsed) ? parsed : [parsed]
        return { rows: rows.filter((r) => r && typeof r.port === 'number') }
      } catch (e) {
        return { error: '解析失败: ' + res.stdout.slice(0, 300), rows: [] }
      }
    }

    const render = (st) => {
      const rows = (st.rows || []).filter((r) => {
        const q = (st.q || '').trim().toLowerCase()
        if (!q) return true
        return String(r.port).indexOf(q) >= 0 || String(r.proc || '').toLowerCase().indexOf(q) >= 0 || String(r.pid).indexOf(q) >= 0
      })
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-query">' +
        '<input class="tb-input" data-field="q" placeholder="按端口 / 进程名 / PID 过滤" value="' + esc(st.q || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="refresh">刷新</button>' +
      '</div>')
      if (st.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(st.error) + '</div>')
      if (st.info) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.info) + '</div>')
      parts.push('<div class="tb-list-head"><span class="tb-list-title">监听端口<span class="tb-count">' + rows.length + '</span></span>' +
        '<span class="tb-note">共 ' + (st.rows || []).length + ' 条</span></div>')
      if (rows.length === 0) {
        parts.push('<div class="tb-notice">' + (st.rows ? '无匹配项' : '点击「刷新」加载') + '</div>')
      } else {
        parts.push('<div class="tb-list">' + rows.map((r) => {
          const armed = st.arm === String(r.pid)
          const act = armed
            ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-danger-ghost" data-action="kill-confirm" data-pid="' + r.pid + '">确认结束</button>' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="kill-cancel">取消</button>'
            : '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="kill" data-pid="' + r.pid + '">结束</button>'
          return '<div class="tb-rec' + (armed ? ' tb-rec-active' : '') + '">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-rec-key">:' + r.port + '</span>' +
              '<span class="tb-rec-summary">' + esc(r.proc || '（未知进程）') + '</span>' + act + '</div>' +
              '<div class="tb-rec-sub"><span>' + esc(r.addr || '*') + '</span><span>PID ' + r.pid + '</span></div>' +
            '</div>' +
          '</div>'
        }).join('') + '</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state }) => {
      const st = (state && typeof state === 'object' && state) ? state : { rows: null, q: '', arm: null, error: null, info: null }
      const el = fields && fields.__el ? fields.__el : {}
      if (typeof fields.q === 'string') st.q = fields.q
      st.error = null; st.info = null

      if (action === '' || action === 'refresh') {
        const r = await loadRows()
        st.rows = r.rows; st.error = r.error || null; st.arm = null
      } else if (action === 'kill' && el.pid && /^\d+$/.test(String(el.pid))) {
        st.arm = String(el.pid)
      } else if (action === 'kill-cancel') {
        st.arm = null
      } else if (action === 'kill-confirm' && el.pid && /^\d+$/.test(String(el.pid))) {
        const pid = String(el.pid)
        const res = await runNode('require("child_process").spawnSync("taskkill", ["/PID", process.argv[1], "/F"], { stdio: "inherit" })', pid)
        st.arm = null
        if (res.ok) {
          st.info = '已结束进程 PID ' + pid
          const r = await loadRows()
          st.rows = r.rows; st.error = r.error || null
        } else {
          st.error = '结束失败: ' + res.error
        }
      }
      return { ok: true, html: render(st), state: st }
    }

    tryRegisterTool(ctx, { id: 'ports', label: '端口', order: 5, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 2v3M11 2v3"/><path d="M4.5 5h7v2a3.5 3.5 0 0 1-7 0z"/><path d="M8 10.5V14"/></svg>' }, handler)
  },
}

}

const create_calc = () => {
// ===== calc-tool.js：计算台（Host-only）— codec/regex/cron/txtdiff/gen 5 合一 =====
// 纯计算/纯 JS 小工具合并为单插件单 Tab「计算」，内部子模式芯片切换；
// 每个子模式独立状态命名空间（st.codec / st.regex / st.cron / st.txtdiff / st.gen），互不干扰。
// 大本体（txtdiff diff 行 / gen 随机串上限）沿用原实现的闭包或直接进子状态（有界）。
// 状态：{ sub, codec{...}, regex{...}, cron{...}, txtdiff{...}, gen{...} }

return {
  name: 'calc-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')

    // ================= 子模式 codec：编解码 =================
    const CODEC_MODES = [
      ['b64e', 'Base64 编码'], ['b64d', 'Base64 解码'],
      ['urle', 'URL 编码'], ['urld', 'URL 解码'],
      ['jp', 'JSON 美化'], ['jm', 'JSON 压缩'],
      ['tsd', '时间戳 → 日期'], ['dts', '日期 → 时间戳'],
    ]
    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtLocal = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    const codecConvert = (mode, input) => {
      const s = String(input == null ? '' : input)
      switch (mode) {
        case 'b64e': return { out: b64encode(s) }
        case 'b64d': return { out: b64decode(s.trim()) }
        case 'urle': return { out: encodeURIComponent(s) }
        case 'urld': return { out: decodeURIComponent(s) }
        case 'jp': return { out: JSON.stringify(JSON.parse(s), null, 2) }
        case 'jm': return { out: JSON.stringify(JSON.parse(s)) }
        case 'tsd': {
          let n = Number(s.trim())
          if (!isFinite(n)) return { error: '请输入数字时间戳（秒或毫秒）' }
          if (Math.abs(n) < 1e12) n = n * 1000
          const d = new Date(n)
          if (isNaN(d.getTime())) return { error: '时间戳超出有效范围' }
          return { out: '本地时间  ' + fmtLocal(d) + '\nISO       ' + d.toISOString() + '\n毫秒      ' + n }
        }
        case 'dts': {
          const t = Date.parse(s.trim())
          if (isNaN(t)) return { error: '无法解析日期，示例：2026-08-16 12:30:00 或 2026-08-16T04:30:00Z' }
          return { out: '毫秒时间戳  ' + t + '\n秒时间戳    ' + Math.floor(t / 1000) + '\nISO         ' + new Date(t).toISOString() }
        }
        default: return { error: '未知模式' }
      }
    }

    // ================= 子模式 regex：正则 =================
    const REGEX_FLAGS = [['g', '全局'], ['i', '忽略大小写'], ['m', '多行'], ['s', '点跨行'], ['u', 'Unicode']]
    const REGEX_CAP = 200
    const REGEX_PRESETS = [
      ['邮箱', '[\\w.-]+@[\\w-]+(\\.[\\w-]+)+', '联系 a.b-c@example.com 或 x@sub.domain.org'],
      ['手机号', '1[3-9]\\d{9}', '拨打 13812345678 或 19900001111'],
      ['URL', 'https?://[^\\s"\'<>]+', '见 https://example.com/a?b=1 和 http://x.org'],
      ['日期', '\\d{4}-\\d{2}-\\d{2}', '从 2026-08-16 到 2026-09-01'],
      ['UUID', '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', 'id: 2b9fbdc9-397f-43e4-921a-a46097560876'],
      ['中文段', '[\\u4e00-\\u9fa5]+', '混合 English 与 中文连续 段落'],
      ['IPv4', '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', '127.0.0.1 与 10.0.0.256'],
    ]
    const regexRun = (pattern, flags, text) => {
      if (!pattern) return { matches: [], error: null, truncated: false }
      let re
      try { re = new RegExp(pattern, flags.join('')) } catch (e) { return { matches: [], error: String(e.message || e), truncated: false } }
      const matches = []
      let truncated = false
      if (re.global) {
        let m
        while ((m = re.exec(text)) !== null) {
          if (matches.length >= REGEX_CAP) { truncated = true; break }
          matches.push({ i: m.index, text: m[0], groups: m.slice(1) })
          if (m[0] === '') re.lastIndex++
        }
      } else {
        const m = re.exec(text)
        if (m) matches.push({ i: m.index, text: m[0], groups: m.slice(1) })
      }
      return { matches, error: null, truncated }
    }
    const regexReplace = (pattern, flags, text, replacement) => {
      if (!pattern) return { out: '', count: 0, error: null }
      let re
      try { re = new RegExp(pattern, flags.join('')) } catch (e) { return { out: '', count: 0, error: String(e.message || e) } }
      let count = 0
      if (re.global) {
        try {
          const cnt = new RegExp(pattern, flags.join(''))
          let m
          while ((m = cnt.exec(text)) !== null) {
            count++
            if (m[0] === '') cnt.lastIndex++
            if (count >= 100000) break
          }
        } catch (e) {}
      } else {
        count = re.test(text) ? 1 : 0
      }
      let out = ''
      try { out = text.replace(re, replacement) } catch (e) { return { out: '', count, error: String(e.message || e) } }
      return { out, count, error: null }
    }

    // ================= 子模式 cron：Cron 表达式 =================
    // 派生结果（字段明细含 Set / 未来时刻数组）留闭包——Set 不可 JSON 序列化，
    // 进 state 跨 RPC 会变空对象（原独立插件同样如此：每次动作现算，state 只留 expr）。
    let lastCronParsed = null
    let lastCronRuns = null
    const CRON_FIELDS = [
      { key: 'minute', label: '分', min: 0, max: 59 },
      { key: 'hour', label: '时', min: 0, max: 23 },
      { key: 'dom', label: '日', min: 1, max: 31 },
      { key: 'month', label: '月', min: 1, max: 12, names: { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 } },
      { key: 'dow', label: '周', min: 0, max: 7, names: { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 } },
    ]
    const cronParseField = (text, def) => {
      const raw = String(text == null ? '' : text).trim()
      if (!raw) return { error: '不能为空' }
      const vals = new Set()
      let any = false
      const nameOf = (s) => {
        const up = s.toUpperCase()
        if (def.names && Object.prototype.hasOwnProperty.call(def.names, up)) return def.names[up]
        if (!/^\d+$/.test(s)) return null
        return Number(s)
      }
      for (const part0 of raw.split(',')) {
        const part = part0.trim()
        if (!part) return { error: '存在空项（多余逗号）' }
        const slash = part.split('/')
        if (slash.length > 2 || (slash[1] !== undefined && (!/^\d+$/.test(slash[1]) || Number(slash[1]) < 1))) return { error: '非法步长: ' + part }
        const step = slash[1] !== undefined ? Number(slash[1]) : 1
        let lo
        let hi
        const base = slash[0]
        if (base === '*' || base === '') {
          lo = def.min; hi = def.max
          if (base === '*' && step === 1) any = true
        } else if (base.indexOf('-') >= 0) {
          const pair = base.split('-')
          if (pair.length !== 2) return { error: '非法范围: ' + part }
          lo = nameOf(pair[0]); hi = nameOf(pair[1])
          if (lo == null || hi == null) return { error: '非法范围端点: ' + part }
          if (lo > hi) return { error: '范围起点大于终点: ' + part }
        } else {
          const v = nameOf(base)
          if (v == null) return { error: '非法值: ' + base }
          lo = v
          hi = slash[1] !== undefined ? def.max : v
        }
        if (lo < def.min || hi > def.max) return { error: '超出范围(' + def.min + '-' + def.max + '): ' + part }
        for (let v = lo; v <= hi; v += step) vals.add(def.key === 'dow' && v === 7 ? 0 : v)
      }
      return { set: vals, any }
    }
    const cronParse = (expr) => {
      const segs = String(expr || '').trim().split(/\s+/)
      if (segs.length !== 5) return { error: '需要 5 段（分 时 日 月 周），当前 ' + segs.length + ' 段' }
      const fields = []
      for (let i = 0; i < 5; i++) {
        const r = cronParseField(segs[i], CRON_FIELDS[i])
        if (r.error) return { error: '第 ' + (i + 1) + ' 段（' + CRON_FIELDS[i].label + '）' + r.error }
        fields.push(r)
      }
      return { fields }
    }
    const cronMatchDay = (dom, dow, y, mo, d) => {
      const dt = new Date(y, mo, d)
      const domHit = dom.set.has(d)
      const dowHit = dow.set.has(dt.getDay())
      if (!dom.any && !dow.any) return domHit || dowHit
      return domHit && dowHit
    }
    const cronNextRuns = (fields, count) => {
      const [minute, hour, dom, month, dow] = fields
      const out = []
      const t = new Date()
      t.setSeconds(0, 0)
      t.setMinutes(t.getMinutes() + 1)
      const limit = new Date(t.getTime())
      limit.setFullYear(limit.getFullYear() + 4)
      let cur = t
      while (out.length < count && cur < limit) {
        if (!month.set.has(cur.getMonth() + 1)) { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 0, 0); continue }
        if (!cronMatchDay(dom, dow, cur.getFullYear(), cur.getMonth(), cur.getDate())) {
          cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 0, 0)
          continue
        }
        if (!hour.set.has(cur.getHours())) { cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), cur.getHours() + 1, 0); continue }
        if (!minute.set.has(cur.getMinutes())) { cur = new Date(cur.getTime() + 60000); continue }
        out.push(new Date(cur))
        cur = new Date(cur.getTime() + 60000)
      }
      return out
    }
    const CRON_WEEK = ['日', '一', '二', '三', '四', '五', '六']
    const cronFmtRun = (d) =>
      d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' 周' + CRON_WEEK[d.getDay()]
    const cronFmtIn = (d) => {
      const mins = Math.max(0, Math.round((d.getTime() - Date.now()) / 60000))
      if (mins < 60) return mins + ' 分钟后'
      if (mins < 1440) return Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分后'
      return Math.floor(mins / 1440) + ' 天 ' + Math.floor((mins % 1440) / 60) + ' 时后'
    }
    const cronSummarize = (set, min, max, any) => {
      if (any) return '每个'
      const arr = [...set].sort((a, b) => a - b)
      if (arr.length > 12) return arr.slice(0, 12).join(',') + ' …（共 ' + arr.length + ' 个）'
      return arr.join(',')
    }
    const CRON_PRESETS = [
      ['* * * * *', '每分钟'],
      ['0 * * * *', '每小时整点'],
      ['0 0 * * *', '每天 00:00'],
      ['0 9 * * 1-5', '工作日 09:00'],
      ['30 2 * * *', '每天 02:30'],
      ['0 0 * * 1', '每周一 00:00'],
      ['0 0 1 * *', '每月 1 号'],
      ['*/5 * * * *', '每 5 分钟'],
    ]

    // ================= 子模式 txtdiff：文本对比 =================
    let lastRows = null
    let lastStats = null
    const expanded = {}
    const TD_MAX_LINES = 20000
    const TD_MAX_CHARS = 2 * 1024 * 1024
    const TD_LCS_CAP = 1500
    const tdNorm = (s, trimWs) => (trimWs ? String(s).replace(/^\s+|\s+$/g, '') : String(s))
    const tdDiff = (a, b, trimWs) => {
      let la = String(a || '').split('\n').map((s) => s.replace(/\r$/, ''))
      let lb = String(b || '').split('\n').map((s) => s.replace(/\r$/, ''))
      let truncA = false
      let truncB = false
      if (la.length > TD_MAX_LINES) { la = la.slice(0, TD_MAX_LINES); truncA = true }
      if (lb.length > TD_MAX_LINES) { lb = lb.slice(0, TD_MAX_LINES); truncB = true }
      const ka = la.map((s) => tdNorm(s, trimWs))
      const kb = lb.map((s) => tdNorm(s, trimWs))
      let pre = 0
      while (pre < ka.length && pre < kb.length && ka[pre] === kb[pre]) pre++
      let suf = 0
      while (suf < ka.length - pre && suf < kb.length - pre && ka[ka.length - 1 - suf] === kb[kb.length - 1 - suf]) suf++
      const rows = []
      for (let i = 0; i < pre; i++) rows.push({ t: ' ', la: i + 1, lb: i + 1, text: la[i] })
      const n = ka.length - pre - suf
      const m = kb.length - pre - suf
      let coarse = false
      if (n * m > TD_LCS_CAP * TD_LCS_CAP) {
        coarse = true
        for (let i = 0; i < n; i++) rows.push({ t: '-', la: pre + i + 1, lb: null, text: la[pre + i] })
        for (let j = 0; j < m; j++) rows.push({ t: '+', la: null, lb: pre + j + 1, text: lb[pre + j] })
      } else if (n > 0 && m > 0) {
        const W = m + 1
        const dp = new Uint32Array((n + 1) * W)
        for (let i = n - 1; i >= 0; i--) {
          const ra = ka[pre + i]
          const rowOff = i * W
          const nextOff = (i + 1) * W
          for (let j = m - 1; j >= 0; j--) {
            dp[rowOff + j] = ra === kb[pre + j] ? dp[nextOff + j + 1] + 1 : Math.max(dp[nextOff + j], dp[rowOff + j + 1])
          }
        }
        let i = 0
        let j = 0
        while (i < n && j < m) {
          if (ka[pre + i] === kb[pre + j]) { rows.push({ t: ' ', la: pre + i + 1, lb: pre + j + 1, text: la[pre + i] }); i++; j++ }
          else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { rows.push({ t: '-', la: pre + i + 1, lb: null, text: la[pre + i] }); i++ }
          else { rows.push({ t: '+', la: null, lb: pre + j + 1, text: lb[pre + j] }); j++ }
        }
        while (i < n) { rows.push({ t: '-', la: pre + i + 1, lb: null, text: la[pre + i] }); i++ }
        while (j < m) { rows.push({ t: '+', la: null, lb: pre + j + 1, text: lb[pre + j] }); j++ }
      } else {
        for (let i = 0; i < n; i++) rows.push({ t: '-', la: pre + i + 1, lb: null, text: la[pre + i] })
        for (let j = 0; j < m; j++) rows.push({ t: '+', la: null, lb: pre + j + 1, text: lb[pre + j] })
      }
      const baseA = pre + n
      const baseB = pre + m
      for (let s = 0; s < suf; s++) rows.push({ t: ' ', la: baseA + s + 1, lb: baseB + s + 1, text: la[baseA + s] })
      let add = 0, del = 0, same = 0
      for (const r of rows) { if (r.t === '+') add++; else if (r.t === '-') del++; else same++ }
      return { rows, stats: { add, del, same, coarse, truncA, truncB } }
    }
    const tdDisplay = (rows) => {
      const out = []
      let i = 0
      let seg = 0
      while (i < rows.length) {
        if (rows[i].t !== ' ') { out.push({ row: rows[i] }); i++; continue }
        let j = i
        while (j < rows.length && rows[j].t === ' ') j++
        const len = j - i
        const key = 'seg' + (seg++)
        if (len > 9 && !expanded[key]) {
          for (let k = 0; k < 3; k++) out.push({ row: rows[i + k] })
          out.push({ collapse: key, count: len - 6 })
          for (let k = j - 3; k < j; k++) out.push({ row: rows[k] })
        } else {
          for (let k = i; k < j; k++) out.push({ row: rows[k] })
        }
        i = j
      }
      return out
    }
    const TD_ROW_STYLE = { ' ': '', '+': 'background:var(--tb-done-bg,rgba(76,175,80,.09))', '-': 'background:var(--tb-danger-bg,rgba(217,95,95,.09))' }
    const TD_TXT_CLS = { ' ': '', '+': 'tb-tx-done', '-': 'tb-tx-danger' }

    // ================= 子模式 gen：生成器 =================
    const GEN_SCRIPT = [
      "const spec = JSON.parse(process.env.GEN_REQ || '{}')",
      "const c = require('crypto')",
      "const out = { ok: true, items: [] }",
      "try {",
      "  if (spec.kind === 'uuid') {",
      "    const n = Math.max(1, Math.min(Number(spec.n) || 1, 200))",
      "    for (let i = 0; i < n; i++) out.items.push(c.randomUUID())",
      "  } else if (spec.kind === 'rand') {",
      "    const sets = { hex: '0123456789abcdef', b64url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', alnum: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', num: '0123456789', easy: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789' }",
      "    const cs = sets[spec.charset] || sets.alnum",
      "    const len = Math.max(1, Math.min(Number(spec.len) || 16, 4096))",
      "    const n = Math.max(1, Math.min(Number(spec.n) || 1, 50))",
      "    for (let k = 0; k < n; k++) { let s = ''; for (let i = 0; i < len; i++) s += cs[c.randomInt(0, cs.length)]; out.items.push(s) }",
      "  } else if (spec.kind === 'hash') {",
      "    const algo = ['md5', 'sha1', 'sha256', 'sha512'].indexOf(spec.algo) >= 0 ? spec.algo : 'sha256'",
      "    out.items.push(c.createHash(algo).update(String(spec.text == null ? '' : spec.text), 'utf8').digest('hex'))",
      "  } else { out.ok = false; out.error = 'unknown kind: ' + spec.kind }",
      "} catch (e) { out.ok = false; out.error = String((e && e.message) || e) }",
      "process.stdout.write(JSON.stringify(out))",
    ].join('\n')
    const runGen = async (spec, wsRoot) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const handle = subprocess.spawn({
          argv: ['node', '-'],
          cwd: wsRoot,
          stdio: { stdin: { data: GEN_SCRIPT }, stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
          graceMs: 30000,
          env: { GEN_REQ: JSON.stringify(spec) },
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout.readFrom(0).text
        if (outcome.exitCode !== 0) return { ok: false, error: handle.collected.stderr.readFrom(0).text.slice(0, 300) || '子进程失败' }
        return JSON.parse(stdout)
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    }
    const GEN_CHARSETS = [['alnum', '字母数字'], ['hex', 'hex'], ['b64url', 'base64url'], ['num', '纯数字'], ['easy', '易读（无 0O1lI）']]
    const GEN_ALGOS = [['md5', 'MD5'], ['sha1', 'SHA-1'], ['sha256', 'SHA-256'], ['sha512', 'SHA-512']]
    const GEN_NS = [1, 5, 10, 50]
    const GEN_KIND_LABEL = { uuid: 'UUID v4', rand: '随机串', hash: '哈希' }

    // ================= 主渲染：子模式芯片 + 各子面板 =================
    const SUBS = [
      ['codec', '编解码'], ['regex', '正则'], ['cron', 'Cron'],
      ['txtdiff', '文本对比'], ['gen', '生成器'],
    ]

    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-chips">' + SUBS.map(([v, label]) =>
        '<button type="button" class="tb-chip' + (st.sub === v ? ' tb-chip-on' : '') + '" data-action="sub" data-v="' + v + '">' + label + '</button>'
      ).join('') + '</div>')
      parts.push(renderSub(st) + '</div>')
      return parts.join('')
    }

    const renderSub = (st) => {
      if (st.sub === 'codec') return renderCodec(st.codec)
      if (st.sub === 'regex') return renderRegex(st.regex)
      if (st.sub === 'cron') return renderCron(st.cron)
      if (st.sub === 'txtdiff') return renderTxtdiff(st.txtdiff)
      if (st.sub === 'gen') return renderGen(st.gen)
      return '<div class="tb-notice">未知子模式</div>'
    }

    const renderCodec = (c) => {
      const parts = []
      parts.push('<div class="tb-chips">' + CODEC_MODES.map(([v, label]) =>
        '<button type="button" class="tb-chip' + (c.mode === v ? ' tb-chip-on' : '') + '" data-action="mode" data-m="' + v + '">' + label + '</button>'
      ).join('') + '</div>')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">输入</span>' +
        '<textarea class="tb-textarea" data-field="input" placeholder="在此输入待转换内容">' + esc(c.input || '') + '</textarea></div>')
      parts.push('<div class="tb-row"><button type="button" class="tb-btn tb-btn-primary" data-action="run">转换</button>' +
        (c.output ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy">复制输出</button><span class="tb-note">输出 ' + fmtSize(c.output.length) + '</span>' : '') + '</div>')
      if (c.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(c.error) + '</div>')
      if (c.output) parts.push('<pre class="tb-code">' + esc(c.output) + '</pre>')
      return parts.join('')
    }

    const renderRegex = (r) => {
      const mode = r.mode === 'replace' ? 'replace' : 'match'
      const m = mode === 'match' ? regexRun(r.pattern, r.flags || ['g'], r.text || '') : null
      const rp = mode === 'replace' ? regexReplace(r.pattern, r.flags || ['g'], r.text || '', r.replacement || '') : null
      const parts = []
      parts.push('<div class="tb-chips">' +
        '<button type="button" class="tb-chip' + (mode === 'match' ? ' tb-chip-on' : '') + '" data-action="mode" data-v="match">匹配</button>' +
        '<button type="button" class="tb-chip' + (mode === 'replace' ? ' tb-chip-on' : '') + '" data-action="mode" data-v="replace">替换</button>' +
      '</div>')
      parts.push('<div class="tb-query">' +
        '<input class="tb-input tb-mono" data-field="pattern" placeholder="正则表达式，如 (\\w+)@(\\w+\\.com)" value="' + esc(r.pattern || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="test">测试</button>' +
      '</div>')
      parts.push('<div class="tb-chips"><span class="tb-note">预设：</span>' + REGEX_PRESETS.map(([label, p]) =>
        '<button type="button" class="tb-chip" data-action="preset" data-p="' + esc(p) + '" title="' + esc(p) + '">' + esc(label) + '</button>'
      ).join('') + '</div>')
      parts.push('<div class="tb-chips">' + REGEX_FLAGS.map(([f, label]) =>
        '<button type="button" class="tb-chip' + ((r.flags || []).indexOf(f) >= 0 ? ' tb-chip-on' : '') + '" data-action="flag" data-f="' + f + '" title="' + label + '">' + f + '</button>'
      ).join('') + '<span class="tb-note">' + esc(REGEX_FLAGS.filter(([f]) => (r.flags || []).indexOf(f) >= 0).map(([, l]) => l).join(' · ')) + '</span></div>')
      if (mode === 'replace') {
        parts.push('<div class="tb-sec"><span class="tb-sec-label">替换为（支持 $1 分组 / $&amp; 全匹配 / $&lt;name&gt; 命名组）</span>' +
          '<input class="tb-input tb-mono" data-field="replacement" placeholder="如 [$2]$1 或 <空删除>" value="' + esc(r.replacement || '') + '" /></div>')
      }
      parts.push('<div class="tb-sec"><span class="tb-sec-label">测试文本</span>' +
        '<textarea class="tb-textarea" data-field="text" placeholder="在此粘贴待匹配的文本">' + esc(r.text || '') + '</textarea></div>')
      const err = m ? m.error : (rp ? rp.error : null)
      if (err) {
        parts.push('<div class="tb-banner tb-banner-error">正则无效：' + esc(err) + '</div>')
      } else if (r.pattern && mode === 'match' && m) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">匹配结果<span class="tb-count">' + m.matches.length + '</span></span>' +
          (m.truncated ? '<span class="tb-note">仅显示前 ' + REGEX_CAP + ' 条</span>' : '') + '</div>')
        if (m.matches.length === 0) {
          parts.push('<div class="tb-notice">无匹配</div>')
        } else {
          parts.push('<div class="tb-list">' + m.matches.map((mt, idx) => {
            const groups = (mt.groups || []).map((g, gi) =>
              '<div class="tb-line"><span class="tb-line-status">$' + (gi + 1) + '</span><span class="tb-line-path">' + esc(g == null ? '（未参与）' : g) + '</span></div>'
            ).join('')
            return '<div class="tb-card">' +
              '<div class="tb-card-head"><span class="tb-pill tb-pill-active">#' + (idx + 1) + '</span>' +
              '<span class="tb-note">位置 ' + mt.i + ' · 长度 ' + mt.text.length + '</span></div>' +
              '<pre class="tb-code">' + esc(mt.text || '（空匹配）') + '</pre>' +
              (groups ? '<div class="tb-sec"><span class="tb-sec-label">捕获分组</span>' + groups + '</div>' : '') +
            '</div>'
          }).join('') + '</div>')
        }
      } else if (r.pattern && mode === 'replace' && rp) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">替换结果<span class="tb-count">' + rp.count + ' 处</span></span>' +
          (rp.out ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-out">复制结果</button>' : '') + '</div>')
        parts.push('<pre class="tb-code" style="max-height:480px">' + esc(rp.out.length > 20000 ? rp.out.slice(0, 20000) + '\n…（仅显示前 20000 字符，共 ' + rp.out.length + '）' : rp.out) + '</pre>')
      }
      return parts.join('')
    }

    const renderCron = (c) => {
      const parsed = lastCronParsed
      const runs = lastCronRuns
      const parts = []
      parts.push('<div class="tb-sec"><span class="tb-sec-label">Cron 表达式（分 时 日 月 周）</span>' +
        '<input class="tb-input tb-mono" data-field="expr" placeholder="如 0 9 * * 1-5" value="' + esc(c.expr || '') + '" /></div>')
      parts.push('<div class="tb-chips">' + CRON_PRESETS.map((p) =>
        '<button type="button" class="tb-chip" data-action="preset" data-v="' + esc(p[0]) + '" title="点击填入">' + esc(p[1]) + '</button>'
      ).join('') + '</div>')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="calc">解析</button>' +
        '<span class="tb-note">标准 5 段；日/周同时受限时任一命中即运行（OR 语义）</span></div>')
      if (parsed && parsed.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(parsed.error) + '</div>')
      if (parsed && !parsed.error && runs) {
        parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">字段明细</span>' +
          parsed.fields.map((f, i) =>
            '<div class="tb-line"><span class="tb-line-status tb-tx-muted" style="width:auto;min-width:28px">' + esc(CRON_FIELDS[i].label) + '</span>' +
            '<span class="tb-line-path tb-mono">' + esc(cronSummarize(f.set, CRON_FIELDS[i].min, CRON_FIELDS[i].max, f.any)) + '</span></div>'
          ).join('') + '</div></div>')
        if (runs.length) {
          parts.push('<div class="tb-list-head"><span class="tb-list-title">未来 ' + runs.length + ' 次运行（本地时区）</span></div>')
          parts.push('<div class="tb-list">' + runs.map((d) =>
            '<div class="tb-rec"><div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-rec-key tb-mono">' + esc(cronFmtRun(d)) + '</span></div>' +
              '<div class="tb-rec-sub"><span>' + esc(cronFmtIn(d)) + '</span></div>' +
            '</div></div>'
          ).join('') + '</div>')
        } else {
          parts.push('<div class="tb-notice">未来 4 年内无运行时刻（检查日/月/周组合是否过窄）</div>')
        }
      }
      if (!parsed) parts.push('<div class="tb-notice">输入表达式或点预设芯片，解析后显示字段明细与未来运行时刻</div>')
      return parts.join('')
    }

    const renderTxtdiff = (t) => {
      const parts = []
      parts.push('<div class="tb-sec"><span class="tb-sec-label">左（原文）</span>' +
        '<textarea class="tb-textarea tb-mono" data-field="a" placeholder="粘贴原文" style="min-height:90px">' + esc(t.a || '') + '</textarea></div>')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">右（新文）</span>' +
        '<textarea class="tb-textarea tb-mono" data-field="b" placeholder="粘贴新文" style="min-height:90px">' + esc(t.b || '') + '</textarea></div>')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="compare">对比</button>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="swap" title="交换左右">⇄ 交换</button>' +
        '<button type="button" class="tb-chip' + (t.trimWs ? ' tb-chip-on' : '') + '" data-action="trim-ws" title="比较时忽略每行首尾空白">忽略首尾空白</button>' +
        (t.a || t.b ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空</button>' : '') +
      '</div>')
      if (t.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(t.notice) + '</div>')
      if (lastRows && lastStats) {
        const s = lastStats
        parts.push('<div class="tb-row">' +
          '<span class="tb-pill tb-pill-done">+' + s.add + '</span>' +
          '<span class="tb-pill tb-pill-other">−' + s.del + '</span>' +
          '<span class="tb-pill tb-pill-plain">相同 ' + s.same + '</span>' +
          (s.coarse ? '<span class="tb-note">差异段过大，已按整块增删展示（未做行级对齐）</span>' : '') +
          (s.truncA || s.truncB ? '<span class="tb-note">超出 20000 行上限，已截断' + (s.truncA && s.truncB ? '（双侧）' : s.truncA ? '（左）' : '（右）') + '</span>' : '') +
        '</div>')
        if (s.add === 0 && s.del === 0) parts.push('<div class="tb-notice">两侧文本完全一致' + (t.trimWs ? '（忽略首尾空白口径）' : '') + '</div>')
        const disp = tdDisplay(lastRows)
        parts.push('<div class="tb-list">' + disp.map((d) => {
          if (d.collapse) {
            return '<div class="tb-line" data-action="expand" data-k="' + d.collapse + '" title="点击展开" style="cursor:pointer;justify-content:center">' +
              '<span class="tb-note">⋯ ' + d.count + ' 行相同，点击展开 ⋯</span></div>'
          }
          const row = d.row
          return '<div class="tb-line" style="' + (TD_ROW_STYLE[row.t] || '') + ';font-family:ui-monospace,Consolas,monospace">' +
            '<span class="tb-note" style="min-width:38px;text-align:right;flex:none">' + (row.la == null ? '' : row.la) + '</span>' +
            '<span class="tb-note" style="min-width:38px;text-align:right;flex:none">' + (row.lb == null ? '' : row.lb) + '</span>' +
            '<span class="' + (TD_TXT_CLS[row.t] || '') + '" style="flex:none;width:14px">' + (row.t === ' ' ? '' : row.t) + '</span>' +
            '<span class="tb-line-path" style="white-space:pre-wrap;word-break:break-all">' + esc(row.text) + '</span>' +
          '</div>'
        }).join('') + '</div>')
      } else {
        parts.push('<div class="tb-notice">填入左右文本后点「对比」；结果在这里以统一视图展示（长相同段自动折叠）</div>')
      }
      return parts.join('')
    }

    const renderGen = (g) => {
      const parts = []
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">UUID v4</span>' +
        '<div class="tb-row">' + GEN_NS.map((n) =>
          '<button type="button" class="tb-chip' + (g.n === n ? ' tb-chip-on' : '') + '" data-action="uuid-n" data-v="' + n + '">' + n + ' 个</button>'
        ).join('') +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="uuid">生成</button></div></div></div>')
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">随机串（CSPRNG）</span>' +
        '<div class="tb-chips" style="margin-bottom:6px">' + GEN_CHARSETS.map(([v, label]) =>
          '<button type="button" class="tb-chip' + (g.charset === v ? ' tb-chip-on' : '') + '" data-action="charset" data-v="' + v + '">' + label + '</button>'
        ).join('') + '</div>' +
        '<div class="tb-row"><span class="tb-note">长度</span>' +
        '<input class="tb-input tb-mono" style="max-width:80px;height:24px" data-field="len" value="' + esc(g.len || '') + '" />' +
        '<span class="tb-note">条数</span>' +
        '<input class="tb-input tb-mono" style="max-width:64px;height:24px" data-field="randN" value="' + esc(g.randN || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="rand">生成</button></div></div></div>')
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">哈希摘要</span>' +
        '<div class="tb-chips" style="margin-bottom:6px">' + GEN_ALGOS.map(([v, label]) =>
          '<button type="button" class="tb-chip' + (g.algo === v ? ' tb-chip-on' : '') + '" data-action="algo" data-v="' + v + '">' + label + '</button>'
        ).join('') + '</div>' +
        '<textarea class="tb-textarea" data-field="text" placeholder="待计算哈希的文本" style="min-height:56px">' + esc(g.text || '') + '</textarea>' +
        '<div class="tb-row" style="margin-top:6px"><button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="hash">计算</button></div></div></div>')
      if (g.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(g.notice) + '</div>')
      const items = g.items || []
      if (items.length) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">' + esc(GEN_KIND_LABEL[g.itemsKind] || '结果') + '<span class="tb-count">' + items.length + '</span></span>' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-all">复制全部</button></div>')
        parts.push('<div class="tb-list">' + items.map((it, i) =>
          '<div class="tb-rec" data-action="copy-one" data-i="' + i + '" title="点击复制">' +
            '<div class="tb-rec-main"><div class="tb-rec-top"><span class="tb-rec-summary tb-mono" style="word-break:break-all">' + esc(it) + '</span></div></div>' +
          '</div>'
        ).join('') + '</div>')
      } else {
        parts.push('<div class="tb-notice">生成结果在这里，点条目复制单项</div>')
      }
      return parts.join('')
    }

    // ================= 主 handler：按 st.sub 分派到子状态，动作名保持原工具语义 =================
    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const el = fields && fields.__el ? fields.__el : {}
      const init = {
        sub: 'codec',
        codec: { mode: 'b64e', input: '', output: '', error: null },
        regex: { pattern: '', flags: ['g'], text: '', mode: 'match', replacement: '' },
        cron: { expr: '' },
        txtdiff: { a: '', b: '', trimWs: false, notice: null },
        gen: { n: 5, charset: 'alnum', len: '16', randN: '3', algo: 'sha256', text: '', items: [], itemsKind: '', notice: null },
      }
      const st = (state && typeof state === 'object' && state) ? state : init
      if (!st.codec || typeof st.codec !== 'object') st.codec = Object.assign({}, init.codec)
      if (!st.regex || typeof st.regex !== 'object') st.regex = Object.assign({}, init.regex)
      if (!st.cron || typeof st.cron !== 'object') st.cron = Object.assign({}, init.cron)
      if (!st.txtdiff || typeof st.txtdiff !== 'object') st.txtdiff = Object.assign({}, init.txtdiff)
      if (!st.gen || typeof st.gen !== 'object') st.gen = Object.assign({}, init.gen)

      // 子模式切换（动作名 sub）
      if (action === 'sub' && el.v && SUBS.some(([v]) => v === el.v)) {
        st.sub = String(el.v)
        return { ok: true, html: render(st), state: st }
      }

      // ---- 各子模式字段同步 + 动作 ----
      let copy = null
      if (st.sub === 'codec') {
        const c = st.codec
        if (typeof fields.input === 'string') c.input = fields.input
        if (action === 'mode' && el.m) c.mode = String(el.m)
        if ((action === 'run' || action === 'mode') && c.input) {
          try {
            const r = codecConvert(c.mode, c.input)
            c.output = r.out || ''
            c.error = r.error || null
          } catch (e) { c.output = ''; c.error = String((e && e.message) || e) }
        }
        if (action === 'copy' && c.output) copy = c.output
      } else if (st.sub === 'regex') {
        const r = st.regex
        if (typeof fields.pattern === 'string') r.pattern = fields.pattern
        if (typeof fields.text === 'string') r.text = fields.text
        if (typeof fields.replacement === 'string') r.replacement = fields.replacement
        if (action === 'mode' && el.v) r.mode = el.v === 'replace' ? 'replace' : 'match'
        else if (action === 'flag' && el.f) {
          const f = String(el.f)
          const cur = Array.isArray(r.flags) ? r.flags.slice() : ['g']
          const i = cur.indexOf(f)
          if (i >= 0) cur.splice(i, 1); else cur.push(f)
          r.flags = cur
        } else if (action === 'preset' && el.p) {
          r.pattern = String(el.p)
          const preset = REGEX_PRESETS.find(([, p]) => p === el.p)
          if (!r.text && preset && preset[2]) r.text = preset[2]
        }
        if (action === 'copy-out') {
          const rp = regexReplace(r.pattern, r.flags || ['g'], r.text || '', r.replacement || '')
          if (!rp.error) copy = rp.out
        }
      } else if (st.sub === 'cron') {
        const c = st.cron
        if (typeof fields.expr === 'string') c.expr = fields.expr
        if (action === 'preset' && el.v) c.expr = String(el.v)
        if (action === 'calc' || action === 'preset' || (action === '' && c.expr)) {
          if (!c.expr.trim()) {
            lastCronParsed = { error: '请输入 cron 表达式' }
            lastCronRuns = null
          } else {
            lastCronParsed = cronParse(c.expr)
            if (!lastCronParsed.error) lastCronRuns = cronNextRuns(lastCronParsed.fields, 8)
            else lastCronRuns = null
          }
        }
      } else if (st.sub === 'txtdiff') {
        const t = st.txtdiff
        if (typeof fields.a === 'string') t.a = fields.a
        if (typeof fields.b === 'string') t.b = fields.b
        t.notice = null
        if (action === 'compare') {
          for (const k of Object.keys(expanded)) delete expanded[k]
          if (t.a.length > TD_MAX_CHARS) { t.a = t.a.slice(0, TD_MAX_CHARS); t.notice = '左侧文本超 2MB，已截断' }
          if (t.b.length > TD_MAX_CHARS) { t.b = t.b.slice(0, TD_MAX_CHARS); t.notice = (t.notice ? t.notice + '；' : '') + '右侧文本超 2MB，已截断' }
          const r = tdDiff(t.a, t.b, t.trimWs)
          lastRows = r.rows
          lastStats = r.stats
        } else if (action === 'swap') {
          const tmp = t.a; t.a = t.b; t.b = tmp
          if (lastRows) { const r = tdDiff(t.a, t.b, t.trimWs); lastRows = r.rows; lastStats = r.stats }
        } else if (action === 'trim-ws') {
          t.trimWs = !t.trimWs
          if (lastRows) {
            for (const k of Object.keys(expanded)) delete expanded[k]
            const r = tdDiff(t.a, t.b, t.trimWs)
            lastRows = r.rows
            lastStats = r.stats
          }
        } else if (action === 'expand' && el.k) {
          expanded[String(el.k)] = true
        } else if (action === 'clear') {
          t.a = ''; t.b = ''
          lastRows = null; lastStats = null
          for (const k of Object.keys(expanded)) delete expanded[k]
        }
      } else if (st.sub === 'gen') {
        const g = st.gen
        if (!Array.isArray(g.items)) g.items = []
        if (typeof fields.len === 'string') g.len = fields.len
        if (typeof fields.randN === 'string') g.randN = fields.randN
        if (typeof fields.text === 'string') g.text = fields.text
        g.notice = null
        const doGen = async (spec, kind) => {
          const r = await runGen(spec, ws.root)
          if (!r || r.ok === false) { g.notice = '生成失败: ' + ((r && r.error) || '(无响应)'); return }
          g.items = r.items || []
          g.itemsKind = kind
        }
        if (action === 'uuid-n' && el.v) g.n = Number(el.v) || 5
        else if (action === 'charset' && el.v) g.charset = String(el.v)
        else if (action === 'algo' && el.v) g.algo = String(el.v)
        else if (action === 'uuid') await doGen({ kind: 'uuid', n: g.n }, 'uuid')
        else if (action === 'rand') await doGen({ kind: 'rand', charset: g.charset, len: g.len, n: g.randN }, 'rand')
        else if (action === 'hash') await doGen({ kind: 'hash', algo: g.algo, text: g.text }, 'hash')
        if (action === 'copy-one' && el.i != null) {
          const it = g.items[Number(el.i)]
          if (typeof it === 'string') copy = it
        } else if (action === 'copy-all' && g.items.length) {
          copy = g.items.join('\n')
        }
      }

      const out = { ok: true, html: render(st), state: st }
      if (copy != null) out.copy = copy
      return out
    }

    tryRegisterTool(ctx, { id: 'calc', label: '计算', order: 8, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="2.5" width="10" height="11" rx="1.5"/><path d="M5.5 5.5h5"/><path d="M6 8h.01M8 8h.01M10 8h.01M6 10.5h.01M8 10.5h.01M10 10.5h.01"/></svg>' }, handler)
  },
}
}

const create_usage = () => {
// ===== usage-tool.js：会话 Token 用量分析（Host-only）=====
// 数据源：sessionQuery.readSession(当前会话) 的 assistant/message usage 事件。
// 汇总：总输入/输出/缓存读取/命中率/步数；Top10 步骤横向条形图；最近 20 步明细。
// 状态：{}（数据每次动作重算，不进 state）

return {
  name: 'usage-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')
    const readLog = sq ? makeSessionLogReader(ctx, sq) : null
    let modelCache = null // { sid, count, data }（build 结果缓存；日志不增长不重建）

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
    const fmtTok = (n) => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n)

    const build = (events) => {
      const steps = []
      let inTok = 0, outTok = 0, cacheRead = 0, reasoning = 0
      for (const ev of events) {
        if (!ev || ev.type !== 'assistant/message') continue
        const d = ev.data || {}
        const u = d.usage
        if (!u) continue
        const input = (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
        const output = u.outputTokens || 0
        steps.push({
          seq: ev.seq, turn: d.turn, step: d.step, time: ev.time,
          input, output, cacheRead: u.cacheReadTokens || 0, reasoning: u.reasoningTokens || 0,
          total: input + output,
        })
        inTok += input; outTok += output; cacheRead += u.cacheReadTokens || 0; reasoning += u.reasoningTokens || 0
      }
      return { steps, inTok, outTok, cacheRead, reasoning }
    }

    const render = (m) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      if (m.steps.length === 0) {
        parts.push('<div class="tb-notice">本会话暂无用量的助手消息（usage 由适配器上报）</div></div>')
        return parts.join('')
      }
      const hitRate = m.inTok > 0 ? Math.round((m.cacheRead / m.inTok) * 100) : 0
      const avg = Math.round((m.inTok + m.outTok) / m.steps.length)
      parts.push('<div class="tb-stats">' +
        '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(m.inTok) + '</span><span class="tb-stat-label">总输入</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(m.outTok) + '</span><span class="tb-stat-label">总输出</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + hitRate + '%</span><span class="tb-stat-label">缓存命中率</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(avg) + '</span><span class="tb-stat-label">平均/步</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + m.steps.length + '</span><span class="tb-stat-label">计费步数</span></div>' +
      '</div>')

      const top = m.steps.slice().sort((a, b) => b.total - a.total).slice(0, 10)
      const max = top.length ? top[0].total : 1
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">消耗最高的步骤 Top ' + top.length + '</span>' +
        top.map((s) =>
          '<div class="tb-row" style="flex-wrap:nowrap" title="T' + s.turn + '·S' + s.step + ' 输入 ' + s.input + ' / 输出 ' + s.output + '">' +
            '<span class="tb-num tb-mono" style="min-width:52px">T' + s.turn + '·S' + s.step + '</span>' +
            '<div style="flex:1;height:8px;border-radius:4px;background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33));overflow:hidden">' +
              '<div style="height:100%;width:' + Math.max(2, Math.round((s.total / max) * 100)) + '%;background:var(--tb-accent,#3f6fd9);border-radius:4px"></div>' +
            '</div>' +
            '<span class="tb-num" style="min-width:56px;text-align:right">' + fmtTok(s.total) + '</span>' +
          '</div>'
        ).join('') + '</div></div>')

      // 按轮次聚合趋势（最近 15 轮）：一眼看出哪几轮在烧 token
      const byTurn = {}
      for (const s of m.steps) byTurn[s.turn] = (byTurn[s.turn] || 0) + s.total
      const turnRows = Object.keys(byTurn).map((t) => ({ turn: Number(t), total: byTurn[t] })).sort((a, b) => a.turn - b.turn).slice(-15)
      const maxTurn = turnRows.reduce((mx, r) => Math.max(mx, r.total), 1)
      if (turnRows.length > 1) {
        parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">按轮次趋势（最近 ' + turnRows.length + ' 轮）</span>' +
          turnRows.map((r) =>
            '<div class="tb-row" style="flex-wrap:nowrap" title="轮次 T' + r.turn + ' 合计 ' + r.total + ' tok">' +
              '<span class="tb-num tb-mono" style="min-width:52px">T' + r.turn + '</span>' +
              '<div style="flex:1;height:8px;border-radius:4px;background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33));overflow:hidden">' +
                '<div style="height:100%;width:' + Math.max(2, Math.round((r.total / maxTurn) * 100)) + '%;background:var(--tb-accent,#3f6fd9);border-radius:4px"></div>' +
              '</div>' +
              '<span class="tb-num" style="min-width:56px;text-align:right">' + fmtTok(r.total) + '</span>' +
            '</div>'
          ).join('') + '</div></div>')
      }

      const recent = m.steps.slice(-20).reverse()
      parts.push('<div class="tb-list-head"><span class="tb-list-title">最近 ' + recent.length + ' 步明细<span class="tb-count">' + m.steps.length + '</span></span></div>')
      parts.push('<div class="tb-list">' + recent.map((s) =>
        '<div class="tb-rec"><div class="tb-rec-main">' +
          '<div class="tb-rec-top"><span class="tb-rec-key">T' + s.turn + '·S' + s.step + '</span>' +
          '<span class="tb-rec-summary">输入 ' + fmtTok(s.input) + ' · 输出 ' + fmtTok(s.output) + '</span></div>' +
          '<div class="tb-rec-sub"><span>' + fmtTime(s.time) + '</span>' +
          (s.cacheRead ? '<span class="tb-tx-done">缓存 ' + fmtTok(s.cacheRead) + '</span>' : '') +
          (s.reasoning ? '<span>推理 ' + fmtTok(s.reasoning) + '</span>' : '') +
          '<span>#' + s.seq + '</span></div>' +
        '</div></div>'
      ).join('') + '</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ state, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : {}
      try {
        let sid = session || null
        if (!sid) {
          const recent = await sq.listSessions()
          if (recent.length) sid = String((recent[0].header || {}).id || '')
        }
        if (!sid) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到会话</div></div>', state: st }
        const r = await readLog(sid)
        if (!modelCache || modelCache.sid !== sid || modelCache.count !== r.count) {
          modelCache = { sid, count: r.count, data: build(r.events) }
        }
        return { ok: true, html: render(modelCache.data), state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'usage', label: '用量', order: 8, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 13.5h11"/><path d="M4.5 10v3.5M8 7v6.5M11.5 9v4.5"/></svg>' }, handler)
  },
}

}

const create_prompt = () => {
// ===== prompt-tool.js：系统提示词装配查看（Host-only）=====
// systemPrompt.assemble({}) 全局装配（无会话上下文）：sections / contexts / tools /
// variables 四块，点击任意条目展开完整文本。
// 状态：{ open }（open 形如 'sec:0' / 'ctx:0' / 'vars'；文本每次重取，不进 state）

return {
  name: 'prompt-tool',
  inject: ['fs', 'systemPrompt', 'timer'],
  apply(ctx) {
    const sp = ctx.get('systemPrompt')

    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const CAP = 60000

    // 装配结果 TTL 缓存：连续展开/收起点击（1.5s 窗口内）不再重复全量 assemble；
    // 点「刷新」强制重取。装配是全局无会话的，无需按会话分键。
    let asmCache = null // { at, asm }
    const getAsm = async (force) => {
      const now = Date.now()
      if (!force && asmCache && now - asmCache.at < 1500) return asmCache.asm
      const asm = await sp.assemble({})
      asmCache = { at: now, asm }
      return asm
    }

    const renderList = (title, items, prefix, open) => {
      if (!items.length) return ''
      return '<div class="tb-list-head"><span class="tb-list-title">' + title + '<span class="tb-count">' + items.length + '</span></span></div>' +
        '<div class="tb-list">' + items.map((it, i) => {
          const key = prefix + ':' + i
          return '<div class="tb-rec' + (open === key ? ' tb-rec-active' : '') + '" data-action="open" data-k="' + key + '">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-rec-key">' + esc(it.name) + '</span>' +
              '<span class="tb-rec-summary">' + esc(oneLine(it.text, 80)) + '</span></div>' +
              '<div class="tb-rec-sub"><span>' + fmtSize((it.text || '').length) + '</span></div>' +
            '</div>' +
          '</div>'
        }).join('') + '</div>'
    }

    const handler = async ({ action, fields, state }) => {
      if (!sp) return { ok: false, error: 'systemPrompt 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { open: null }
      const el = fields && fields.__el ? fields.__el : {}
      if (action === 'open' && el.k) st.open = st.open === String(el.k) ? null : String(el.k)
      else if (action === 'close') st.open = null

      try {
        const asm = await getAsm(action === 'refresh')
        const sections = asm.sections || []
        const contexts = asm.contexts || []
        const tools = asm.tools || []
        const variables = asm.variables || {}
        const totalChars = sections.concat(contexts).reduce((n, s) => n + ((s.text || '').length), 0)

        const parts = []
        parts.push('<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">')
        parts.push('<div class="tb-banner tb-banner-info">全局装配（无会话上下文）：会话级 section / 变量可能不在其中；结果缓存 1.5s，点「刷新」强制重取 ' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="refresh">刷新</button></div>')
        parts.push('<div class="tb-stats">' +
          '<div class="tb-stat"><span class="tb-stat-num">' + sections.length + '</span><span class="tb-stat-label">提示词节</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + contexts.length + '</span><span class="tb-stat-label">上下文块</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + tools.length + '</span><span class="tb-stat-label">工具 schema</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + fmtSize(totalChars) + '</span><span class="tb-stat-label">总字符</span></div>' +
        '</div>')

        // 体积占比：最大的 6 个 section/context 各占总量多少（找提示词臃肿点）
        const sized = sections.map((s) => ({ name: s.name, size: (s.text || '').length }))
          .concat(contexts.map((c) => ({ name: c.name + '（ctx）', size: (c.text || '').length })))
          .sort((a, b) => b.size - a.size)
          .slice(0, 6)
        if (totalChars > 0 && sized.length > 1) {
          parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">体积占比 Top ' + sized.length + '</span>' +
            sized.map((s) => {
              const pct = Math.round((s.size / totalChars) * 100)
              return '<div class="tb-row" style="flex-wrap:nowrap" title="' + esc(s.name) + ' · ' + fmtSize(s.size) + '（' + pct + '%）">' +
                '<span class="tb-num" style="min-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name) + '</span>' +
                '<div style="flex:1;height:8px;border-radius:4px;background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33));overflow:hidden">' +
                  '<div style="height:100%;width:' + Math.max(2, pct) + '%;background:var(--tb-accent,#3f6fd9);border-radius:4px"></div>' +
                '</div>' +
                '<span class="tb-num" style="min-width:76px;text-align:right">' + fmtSize(s.size) + ' · ' + pct + '%</span>' +
              '</div>'
            }).join('') + '</div></div>')
        }

        // 详情卡
        if (st.open) {
          const m = /^(\w+):(\d+)$/.exec(st.open)
          let text = null, title = ''
          if (m && m[1] === 'sec' && sections[Number(m[2])]) { text = sections[Number(m[2])].text; title = sections[Number(m[2])].name }
          if (m && m[1] === 'ctx' && contexts[Number(m[2])]) { text = contexts[Number(m[2])].text; title = contexts[Number(m[2])].name }
          if (st.open === 'vars') {
            title = 'variables'
            text = Object.keys(variables).map((k) => k + ' = ' + (variables[k] == null ? '（未设置）' : variables[k])).join('\n')
          }
          if (text != null) {
            parts.push('<div class="tb-preview"><div class="tb-preview-head">' +
              '<span class="tb-preview-name">' + esc(title) + '</span>' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close">关闭</button></div>' +
              '<pre class="tb-code">' + esc(text.length > CAP ? text.slice(0, CAP) + '\n…（截断，共 ' + text.length + ' 字符）' : text) + '</pre></div>')
          }
        }

        parts.push('</div>') // .tb-pane-head 结束
        parts.push('<div class="tb-pane-body tb-pane-col">')
        parts.push(renderList('提示词节（sections）', sections, 'sec', st.open))
        parts.push(renderList('上下文块（contexts）', contexts, 'ctx', st.open))
        const varCount = Object.keys(variables).length
        if (varCount) {
          parts.push('<div class="tb-list-head"><span class="tb-list-title">变量（variables）<span class="tb-count">' + varCount + '</span></span></div>' +
            '<div class="tb-list"><div class="tb-rec' + (st.open === 'vars' ? ' tb-rec-active' : '') + '" data-action="open" data-k="vars">' +
            '<div class="tb-rec-main"><div class="tb-rec-top"><span class="tb-rec-key">variables</span>' +
            '<span class="tb-rec-summary">' + esc(oneLine(Object.keys(variables).join(', '), 80)) + '</span></div></div></div></div>')
        }
        parts.push('<div class="tb-note">工具 schema 清单见「工具」Tab</div>')
        parts.push('</div></div>') // .tb-pane-body + .tb-pane 结束
        return { ok: true, html: parts.join(''), state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'prompt', label: '提示词', order: 9, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 6.5h6M5 9h4"/></svg>' }, handler)
  },
}

}

const create_context = () => {
// ===== context-tool.js：当前上下文窗口查看（Host-only）=====
// sessionQuery.readSurface(当前会话) → 模型当前可见的 surface 消息（压缩后的真实上下文），
// tokenMeter.estimateMessage 逐条估算 token。点击条目展开完整内容。
// 状态：{ open }（open = seq；文本每次重取，不进 state）

return {
  name: 'context-tool',
  inject: ['fs', 'sessionQuery', 'tokenMeter', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')
    const meter = ctx.get('tokenMeter')

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && (b.type === 'text' || b.type === 'reasoning') ? b.text : '')).filter(Boolean).join('\n')
    }
    const fmtTok = (n) => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n)
    const CAP = 12000

    // 面板级缓存：surface 不变（capturedThroughSeq + 条数相同）时不重估 token、不重建行模型
    // （此前每点一次「展开」都会全量 readSurface + 逐条 estimateMessage）
    let modelCache = null // { sid, through, count, rows, totalTok }
    const getModel = async (sid) => {
      const snap = await sq.readSurface(sid)
      const events = snap.events || []
      const through = snap.capturedThroughSeq == null ? 0 : snap.capturedThroughSeq
      if (modelCache && modelCache.sid === sid && modelCache.through === through && modelCache.count === events.length) {
        return modelCache
      }
      const rows = []
      let totalTok = 0
      for (const ev of events) {
        const d = ev.data || {}
        const msg = ev.type === 'user/message' ? d : d.message
        const text = textOf(msg && msg.content)
        let tok = null
        if (meter && msg) { try { tok = meter.estimateMessage(msg) } catch (e) {} }
        if (tok) totalTok += tok
        const role = ev.type === 'user/message' ? (msg.source && msg.source.kind === 'user' ? 'user' : 'inject')
          : ev.type === 'assistant/message' ? 'ai' : 'tool'
        rows.push({ seq: ev.seq, time: ev.time, role, text, tok, name: ev.type === 'tool/result' ? '工具结果' : '' })
      }
      modelCache = { sid, through, count: events.length, rows, totalTok }
      return modelCache
    }

    const handler = async ({ action, fields, state, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { open: null }
      const el = fields && fields.__el ? fields.__el : {}
      if (action === 'open' && el.seq) { const n = Number(el.seq); st.open = st.open === n ? null : n }
      else if (action === 'close') st.open = null

      try {
        let sid = session || null
        if (!sid) {
          const recent = await sq.listSessions()
          if (recent.length) sid = String((recent[0].header || {}).id || '')
        }
        if (!sid) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到会话</div></div>', state: st }

        const model = await getModel(sid)
        const rows = model.rows
        const totalTok = model.totalTok
        const through = model.through
        const maxTok = rows.reduce((m, r) => Math.max(m, r.tok || 0), 1)
        const ROLE_PILL = { user: ['用户', 'tb-pill-done'], inject: ['注入', 'tb-pill-other'], ai: ['助手', 'tb-pill-active'], tool: ['工具结果', 'tb-pill-plain'] }

        const parts = []
        parts.push('<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">')
        parts.push('<div class="tb-stats">' +
          '<div class="tb-stat"><span class="tb-stat-num">' + rows.length + '</span><span class="tb-stat-label">上下文条目</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(totalTok) + '</span><span class="tb-stat-label">估算总 token</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + through + '</span><span class="tb-stat-label">日志序号</span></div>' +
        '</div>')
        parts.push('<div class="tb-banner tb-banner-info">当前模型实际可见的上下文（压缩/修剪后的 surface）；token 为本地估算</div>')

        // 详情
        if (st.open != null) {
          const row = rows.find((r) => r.seq === st.open)
          if (row) {
            parts.push('<div class="tb-preview"><div class="tb-preview-head">' +
              '<span class="tb-preview-name">#' + row.seq + ' ' + ROLE_PILL[row.role][0] + '</span>' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close">关闭</button></div>' +
              '<pre class="tb-code">' + esc(row.text.length > CAP ? row.text.slice(0, CAP) + '\n…（截断，共 ' + row.text.length + ' 字符）' : (row.text || '（无文本内容）')) + '</pre></div>')
          }
        }

        parts.push('</div>') // .tb-pane-head 结束
        parts.push('<div class="tb-pane-body tb-pane-col" data-scroll-default="bottom"><div class="tb-list">' + rows.map((r) => {
          const rp = ROLE_PILL[r.role]
          const pct = r.tok ? Math.max(2, Math.round((r.tok / maxTok) * 100)) : 0
          return '<div class="tb-rec' + (st.open === r.seq ? ' tb-rec-active' : '') + '" data-action="open" data-seq="' + r.seq + '">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-pill ' + rp[1] + '">' + rp[0] + '</span>' +
              '<span class="tb-rec-summary">' + esc(oneLine(r.text, 80) || '（非文本）') + '</span></div>' +
              '<div class="tb-rec-sub" style="flex-wrap:nowrap">' +
                '<span>' + fmtTime(r.time) + '</span>' +
                (r.tok ? '<div style="flex:1;max-width:120px;height:5px;border-radius:3px;background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33));overflow:hidden"><div style="height:100%;width:' + pct + '%;background:var(--tb-accent,#3f6fd9)"></div></div><span>' + fmtTok(r.tok) + ' tok</span>' : '') +
                '<span>#' + r.seq + '</span>' +
              '</div>' +
            '</div>' +
          '</div>'
        }).join('') + '</div></div>')
        parts.push('</div>') // .tb-pane 结束
        return { ok: true, html: parts.join(''), state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'context', label: '上下文', order: 10, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5l6 2.5-6 2.5-6-2.5z"/><path d="M2 8l6 2.5 6-2.5"/><path d="M2 11.5L8 14l6-2.5"/></svg>' }, handler)
  },
}

}

const create_aiassist = () => {
// ===== aiassist-tool.js：AI 助手（Host-only）— 7 个 AI 工具合一 =====
// ask/translate/promptopt/review/commitmsg/aisummary/compare 合并为单插件单 Tab「AI 助手」，
// 一张 PRESETS 表（单一事实源）+ 通用 handler + 分段渲染；通过 preset 芯片切换，
// 每个 preset 定义 { id, label, mode, input, params, sys, store, cap } —— 切换 prompt/system 即切换用途。
// 无缝迁移：沿用原 .dsh-dynamic-toolbox/toolbox-<key>.json 落盘文件与台账 tool 键（历史/用量连续）。
// 大本体（git diff / 会话日志采样 / 对比结果）一律留闭包不进 state（state 每次动作来回传输必须轻量）。
// 状态：{ preset, provider, model, picked[], q, path, code, params{target,style,extra}, info, history[], notice }

return {
  name: 'aiassist-tool',
  inject: ['fs', 'llm', 'agentDefaultModel', 'timer'],
  apply(ctx) {
    const ai = makeLlmHelper(ctx)
    const subprocess = ctx.get('subprocess')
    const fsService = ctx.get('fs')
    const sq = ctx.get('sessionQuery')
    const readLog = sq ? makeSessionLogReader(ctx, sq) : null

    // ===== PRESETS 表（单一事实源；store = 落盘文件名，同时是台账 tool 键）=====
    const TARGETS = ['简体中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español', 'Русский']
    const STYLES = ['通用', '代码', '分析', '创意']
    const DIFF_CAP = 8000
    const CODE_CAP = 20000
    const LOG_CAP = 12000
    const LOG_HEAD = 4000
    const LANGS = { js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TSX', jsx: 'JSX', json: 'JSON', py: 'Python', java: 'Java', go: 'Go', rs: 'Rust', yml: 'YAML', yaml: 'YAML', md: 'Markdown', html: 'HTML', css: 'CSS', ps1: 'PowerShell', sh: 'Shell', sql: 'SQL', vue: 'Vue' }

    const PRESETS = [
      { id: 'ask', label: '问答', mode: 'single', input: 'text', params: [],
        hint: '向所选模型直接提问（不写入会话）', store: 'toolbox-ask.json', cap: 10,
        sys: () => '', row: (it) => aiHistoryCard(it, it.q, it.a, '问', '答') },
      { id: 'translate', label: '翻译', mode: 'single', input: 'text',
        params: [{ key: 'target', label: '目标语言', options: TARGETS }],
        hint: '粘贴或输入要翻译的内容（保留 Markdown / 代码格式）', store: 'toolbox-translate.json', cap: 10,
        sys: (st) => '你是专业翻译引擎。规则：只输出译文本身，不输出任何解释、注音、拼音或多余引号；完整保留原文的换行、Markdown 标记与代码格式。目标语言：' + (st.params && st.params.target || TARGETS[0]),
        row: (it) => aiHistoryCard(it, it.src, it.dst, '原文 → ' + (it.target || ''), '译文'), copyKey: 'dst' },
      { id: 'promptopt', label: '优化', mode: 'single', input: 'text',
        params: [{ key: 'style', label: '风格', options: STYLES }],
        hint: '用大白话描述你想让 AI 做什么，优化器负责补全结构', store: 'toolbox-promptopt.json', cap: 10,
        sys: (st) => '你是提示词工程专家。把用户的粗糙草稿改写为高质量结构化提示词，包含【角色】【任务】【背景】【约束】【输出格式】五个小节（不适用的可省略）；风格倾向：' + (st.params && st.params.style || STYLES[0]) + '；语言跟随草稿（中文草稿用中文，英文草稿用英文）；只输出优化后的提示词本身，不要解释、不要代码块围栏。',
        row: (it) => aiHistoryCard(it, it.draft, it.opt, '草稿（' + (it.style || '通用') + '）', '优化后'), copyKey: 'opt' },
      { id: 'review', label: '评审', mode: 'single', input: 'fileOrText', params: [],
        hint: '工作区相对路径或粘贴代码 → 三级评审 + 评分', store: 'toolbox-review.json', cap: 5,
        sys: () => '你是资深代码评审。输出三部分：🔴 严重问题 / 🟡 改进建议 / 🟢 可选优化，每条含位置（行号或函数名）、问题与具体改法；末尾给总体评分 x/10 与一句总结。中文、精炼、Markdown 列表，不要客套话。',
        row: (it) => aiHistoryCard(it, it.target + (it.chars ? '（' + it.chars + ' 字符' + (it.truncated ? '，已截断' : '') + '）' : ''), it.report, '评审对象', '报告'), copyKey: 'report' },
      { id: 'commitmsg', label: '提交信息', mode: 'single', input: 'gitsource',
        params: [{ key: 'extra', label: '补充说明', type: 'text' }],
        hint: '扫描 git diff → 生成 Conventional Commits 中文提交信息', store: 'toolbox-commitmsg.json', cap: 5,
        sys: () => '你是提交信息撰写助手。依据给定 git diff 生成一条符合 Conventional Commits 的提交信息：首行 “type(scope): 中文主题”（≤50 字，type 从 feat/fix/refactor/docs/chore/test/perf/style 中选，scope 可省略）；改动复杂时空一行，每行以 “- ” 列出要点；只输出提交信息本身，不要代码块围栏、不要解释。',
        row: (it) => aiHistoryCard(it, it.scope === 'staged' ? '暂存区改动' : '工作区改动', it.msg, 'diff 范围', '提交信息'), copyKey: 'msg' },
      { id: 'aisummary', label: '摘要', mode: 'single', input: 'sessionlog', params: [],
        hint: '对当前会话做四节 AI 摘要', store: 'toolbox-aisummary.json', cap: 1,
        sys: () => '你是会话摘要助手。把给定的 用户/助手 对话流水整理为四节中文摘要：🎯 目标（用户想达成什么）/ ✅ 进展（已完成的关键事项）/ 🔑 关键决定（技术选型、约定、踩坑结论）/ 📌 待办（未完成或后续要做的事）。每节 1-4 条要点，精炼，不要复述原文。',
        row: (it) => aiHistoryCard(it, it.meta && it.meta.at ? '会话摘要 · ' + it.meta.at : '会话摘要', it.summary, '', '摘要'), copyKey: 'summary' },
      { id: 'compare', label: '对比', mode: 'multi', input: 'text', params: [],
        hint: '同一问题并发发给所有已选模型', store: 'toolbox-compare.json', cap: 3,
        sys: () => '' },
    ]
    const PRESET_MAP = {}
    for (const p of PRESETS) PRESET_MAP[p.id] = p

    // ===== 历史条目标签文案（保持与原 tools 一致） =====
    const LABELS = { ask: '问答', translate: '翻译', promptopt: '优化', review: '评审', commitmsg: '提交信息', aisummary: '摘要', compare: '对比' }

    // ===== 闭包：大本体不进 state =====
    let lastResults = null   // compare 结果本体（{ q, t, items[] }）
    let lastDiff = null      // commitmsg diff 本体（{ scope, text, truncated }）
    let lastLog = null       // aisummary 日志采样本体（{ text, truncated, omitted, events }）
    const paramMem = {}      // presetId -> params 记忆（切换回来恢复上次参数）

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }

    // ===== 通用历史卡片（AI 类历史统一视觉；原 7 个工具的卡片样式不变）=====
    function aiHistoryCard(it, srcText, dstText, srcLabel, dstLabel) {
      const parts = []
      parts.push('<div class="tb-card">')
      if (srcLabel && srcText) parts.push('<div class="tb-sec"><span class="tb-sec-label">' + esc(srcLabel) + '</span>' +
        '<div style="font-size:12.5px;white-space:pre-wrap;word-break:break-word">' + esc(String(srcText).slice(0, 500)) + '</div></div>')
      parts.push(it.err
        ? '<div class="tb-banner tb-banner-error">' + esc(it.err) + '</div>'
        : '<div class="tb-sec"><span class="tb-sec-label">' + esc(dstLabel || '结果') + '</span><pre class="tb-code">' + esc(it.a != null ? it.a : (dstText || '（空结果）')) + '</pre></div>')
      parts.push('<div class="tb-rec-sub"><span>' + esc(it.route || '') + '</span><span>' + it.ms + 'ms</span>' +
        (it.out != null ? '<span>输出 ' + it.out + ' tok</span>' : '') +
        '<span>' + fmtClock(it.t) + '</span>' +
        (dstText ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy" data-i="' + it.__i + '">复制</button>' : '') +
        '</div></div>')
      return parts.join('')
    }

    // ===== 输入源采集：text / fileOrText / gitsource / sessionlog =====
    const collectInput = async (p, st, ws, sessionId) => {
      if (p.input === 'text') {
        return st.q && st.q.trim() ? { content: st.q.trim() } : { error: '请输入内容' }
      }
      if (p.input === 'fileOrText') {
        if (st.path && st.path.trim()) {
          const target = st.path.trim()
          const m = target.toLowerCase().match(/\.([a-z0-9]+)$/)
          const lang = m && LANGS[m[1]] ? LANGS[m[1]] : (m ? m[1] : '')
          if (!fsService) return { error: 'fs 服务不可用' }
          try {
            const t = await fsService.resolve(target, { cwd: ws.root })
            if (!await fsService.stat(t)) return { error: '文件不存在: ' + target }
            const full = await fsService.readText(t)
            const truncated = full.length > CODE_CAP
            return { content: full.slice(0, CODE_CAP), meta: { target, lang, chars: full.length, truncated } }
          } catch (e) { return { error: '读取失败: ' + String((e && e.message) || e) } }
        }
        if (st.code && st.code.trim()) {
          const c = st.code.trim()
          return { content: c.slice(0, CODE_CAP), meta: { target: '(粘贴代码)', chars: c.length, truncated: c.length > CODE_CAP } }
        }
        return { error: '请填写文件路径或粘贴代码' }
      }
      if (p.input === 'gitsource') {
        const scan = await scanGit(ws.root)
        if (scan.error) return { error: scan.error }
        lastDiff = scan
        return { meta: scan }
      }
      if (p.input === 'sessionlog') {
        if (!readLog) return { error: 'sessionQuery 服务不可用' }
        if (!sessionId) return { error: '未获取到当前会话 ID' }
        const r = await readLog(sessionId)
        const t = transcript(r.events || [])
        if (!t.text.trim()) return { error: '当前会话还没有可摘要的对话内容' }
        lastLog = { text: t.text, truncated: t.truncated, omitted: t.omitted, events: r.count }
        return { meta: { events: r.count, chars: t.text.length, truncated: t.truncated, omitted: t.omitted } }
      }
      return { error: '未知输入类型' }
    }

    // ===== commitmsg：git scan（沿用原实现；diff 本体留闭包）=====
    const runGit = async (args, root) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const handle = subprocess.spawn({
          argv: ['git', ...args],
          cwd: root,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 256 * 1024 } },
          graceMs: 60000,
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout.readFrom(0).text
        const stderr = handle.collected.stderr.readFrom(0).text
        return { ok: outcome.exitCode === 0, code: outcome.exitCode, out: stdout, err: stderr }
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    }
    const firstLine = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 3).join(' | ')
    const scanGit = async (root) => {
      if (!subprocess) return { error: 'subprocess 服务不可用' }
      const st = await runGit(['status', '--porcelain'], root)
      if (!st.ok) return { error: firstLine(st.err) || 'not a git repository' }
      let staged = 0, unstaged = 0, untracked = 0
      for (const line of (st.out || '').split(/\r?\n/)) {
        if (!line) continue
        const xy = line.slice(0, 2)
        if (xy === '??') { untracked++; continue }
        if (xy[0] !== ' ' && xy[0] !== '?') staged++
        if (xy[1] !== ' ' && xy[1] !== '?') unstaged++
      }
      let scope = 'staged'
      let d = await runGit(['diff', '--staged'], root)
      if (!d.ok) return { error: firstLine(d.err) || 'git diff 失败' }
      if (!(d.out || '').trim()) {
        scope = 'unstaged'
        d = await runGit(['diff'], root)
        if (!d.ok) return { error: firstLine(d.err) || 'git diff 失败' }
      }
      const full = (d.out || '').trim()
      return { scope, text: full.slice(0, DIFF_CAP), truncated: full.length > DIFF_CAP, staged, unstaged, untracked, chars: full.length, empty: !full }
    }

    // ===== aisummary：会话日志 → 对话流水（沿用原实现）=====
    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && b.type === 'text' ? b.text : '')).filter(Boolean).join('\n')
    }
    const transcript = (events) => {
      const lines = []
      for (const ev of events) {
        if (!ev || typeof ev.seq !== 'number') continue
        const d = ev.data || {}
        if (ev.type === 'user/message') {
          const t = textOf(d.content)
          if (t) lines.push('用户：' + t)
        } else if (ev.type === 'assistant/message') {
          const t = textOf((d.message || {}).content)
          if (t) lines.push('助手：' + t)
        }
      }
      const full = lines.join('\n\n')
      if (full.length <= LOG_CAP) return { text: full, truncated: false, omitted: 0 }
      const head = full.slice(0, LOG_HEAD)
      const tail = full.slice(-(LOG_CAP - LOG_HEAD))
      return { text: head + '\n\n…（中间省略 ' + (full.length - LOG_CAP) + ' 字符）…\n\n' + tail, truncated: true, omitted: full.length - LOG_CAP }
    }

    // ===== 磁盘历史读写（按 preset 的 store 文件；读取归一化为数组）=====
    const storeRel = (p) => '.dsh-dynamic-toolbox/' + p.store
    const loadHistory = async (p, ws) => {
      const saved = await readJsonStore(ctx, storeRel(p), ws.root, null)
      if (p.id === 'aisummary') {
        // aisummary 磁盘是单对象 { sid, summary, meta }（原实现结构，保持兼容）
        if (saved && typeof saved.summary === 'string' && saved.summary) return [saved]
        return []
      }
      return Array.isArray(saved) ? saved : []
    }
    const persistHistory = async (p, st, ws) => {
      let data = st.history || []
      if (p.id === 'aisummary') {
        const top = data[0]
        if (!top) data = []
        else data = { sid: top.sid, summary: top.summary, meta: top.meta }
      }
      return writeJsonStore(ctx, storeRel(p), data, ws.root, ws.session)
    }

    // ===== 对比默认路由（仅供参考提示；不强制）=====
    const defaultRoute = async () => {
      const tmp = { provider: '', model: '' }
      await ai.resolveRoute(tmp)
      return tmp.provider && tmp.model ? tmp.provider + '/' + tmp.model : ''
    }
    const askOne = async (q, route, ws) => {
      const slash = route.indexOf('/')
      const st = { provider: route.slice(0, slash), model: route.slice(slash + 1) }
      const r = await ai.chat(st, '', q, undefined, { root: ws.root, session: ws.session, tool: 'compare' })
      return { route, a: r.a || '', ms: r.ms || 0, out: r.out != null ? r.out : null, err: r.err || null }
    }

    // ===== 渲染 =====
    const render = (st, route, roll) => {
      const p = PRESET_MAP[st.preset] || PRESETS[0]
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      // preset 芯片行
      parts.push('<div class="tb-chips">' + PRESETS.map((x) =>
        '<button type="button" class="tb-chip' + (x.id === p.id ? ' tb-chip-on' : '') + '" data-action="preset" data-p="' + esc(x.id) + '">' + esc(x.label) + '</button>'
      ).join('') + '</div>')
      // 路由 / 模型选择
      if (p.mode === 'multi') {
        parts.push('<div class="tb-row">' +
          '<select class="tb-select" data-field="provider" data-action-onchange="route" title="Provider（切换后自动加载模型芯片）">' +
            route.providers.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === st.provider ? ' selected' : '') + '>' + esc(x.name || x.id) + '</option>').join('') +
          '</select>' +
          '<span class="tb-note">点芯片加入对比，再点移除' + (roll && roll.calls ? ' · 累计 ' + roll.calls + ' 次 / 输出 ' + roll.out + ' tok' : '') + '</span></div>')
        if (route.models.length) {
          parts.push('<div class="tb-chips">' + route.models.map((m) => {
            const r = st.provider + '/' + m.id
            const on = (st.picked || []).indexOf(r) >= 0
            return '<button type="button" class="tb-chip' + (on ? ' tb-chip-on' : '') + '" data-action="pick" data-r="' + esc(r) + '">' + esc(m.name || m.id) + '</button>'
          }).join('') + '</div>')
        }
        parts.push('<div class="tb-row"><span class="tb-sec-label">已选 ' + (st.picked || []).length + ' 个：</span>' +
          ((st.picked || []).length
            ? st.picked.map((r) => '<button type="button" class="tb-chip tb-chip-on" data-action="pick" data-r="' + esc(r) + '" title="点击移除">' + esc(r) + ' ×</button>').join('')
            : '<span class="tb-note">（至少选 1 个）</span>') +
        '</div>')
      } else {
        const note = '旁路调用 · 不写入会话' + (roll && roll.calls ? ' · 累计 ' + roll.calls + ' 次 / 输出 ' + roll.out + ' tok' : '')
        parts.push(ai.routeRow(st, route, note))
      }
      // 参数区（translate 目标语言 / promptopt 风格 / commitmsg 补充说明）
      for (const param of p.params || []) {
        if (param.options) {
          parts.push('<div class="tb-row"><span class="tb-sec-label">' + esc(param.label) + '</span>' +
            '<select class="tb-select" data-field="' + esc(param.key) + '">' +
              param.options.map((o) => '<option value="' + esc(o) + '"' + (o === (st.params || {})[param.key] ? ' selected' : '') + '>' + esc(o) + '</option>').join('') +
            '</select></div>')
        } else if (param.type === 'text') {
          parts.push('<div class="tb-sec"><span class="tb-sec-label">' + esc(param.label) + '（可选）</span>' +
            '<input class="tb-input" data-field="' + esc(param.key) + '" placeholder="如：这次改动是为了修复重建时主题丢失" value="' + esc((st.params || {})[param.key] || '') + '"></div>')
        }
      }
      // 输入区
      if (p.input === 'text') {
        parts.push('<div class="tb-sec"><span class="tb-sec-label">' + (p.mode === 'multi' ? '问题' : '输入') + '</span>' +
          '<textarea class="tb-textarea" data-field="q" placeholder="' + esc(p.hint || '') + '">' + esc(st.q || '') + '</textarea></div>')
      } else if (p.input === 'fileOrText') {
        parts.push('<div class="tb-sec"><span class="tb-sec-label">文件路径（工作区相对，优先于粘贴）</span>' +
          '<input class="tb-input tb-mono" data-field="path" placeholder="如 shared/host.js" value="' + esc(st.path || '') + '"></div>')
        parts.push('<div class="tb-sec"><span class="tb-sec-label">或直接粘贴代码</span>' +
          '<textarea class="tb-textarea" data-field="code" placeholder="路径留空时评审这里粘贴的代码">' + esc(st.code || '') + '</textarea></div>')
      } else if (p.input === 'gitsource' || p.input === 'sessionlog') {
        if (st.info) {
          if (st.info.error) {
            parts.push('<div class="tb-banner tb-banner-error">' + esc(st.info.error) + '</div>')
          } else if (p.input === 'gitsource') {
            parts.push('<div class="tb-banner tb-banner-info">暂存 ' + st.info.staged + ' · 未暂存 ' + st.info.unstaged + ' · 未跟踪 ' + st.info.untracked +
              (st.info.empty ? ' · 暂存区与工作区 diff 均为空（未跟踪文件不参与 diff）'
                : ' · 取用 ' + (st.info.scope === 'staged' ? '暂存区' : '工作区') + ' diff ' + st.info.chars + ' 字符' + (st.info.truncated ? '（超 ' + DIFF_CAP + ' 已截断）' : '')) +
              '</div>')
          } else if (p.input === 'sessionlog') {
            parts.push('<div class="tb-banner tb-banner-info">事件 ' + st.info.events + ' · 对话 ' + st.info.chars + ' 字符' +
              (st.info.truncated ? '（首尾采样，省略 ' + st.info.omitted + '）' : '') + '</div>')
          }
        }
      }
      // 动作按钮
      const btn = { ask: '发送', translate: '翻译', promptopt: '优化提示词', review: '开始评审', commitmsg: '生成提交信息', aisummary: '生成 / 刷新摘要', compare: '并发对比' }
      const acts = []
      if (p.input === 'gitsource' || p.input === 'sessionlog') {
        acts.push('<button type="button" class="tb-btn" data-action="scan">' + (p.input === 'gitsource' ? '扫描改动' : '读取会话') + '</button>')
      }
      acts.push('<button type="button" class="tb-btn tb-btn-primary" data-action="send">' + (btn[p.id] || '执行') + '</button>')
      if ((st.history || []).length) acts.push('<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空历史</button>')
      if (p.mode === 'multi' && lastResults) acts.push('<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear-results">清除结果</button>')
      parts.push('<div class="tb-row">' + acts.join('') + '</div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      // 结果 / 历史区
      if (p.mode === 'multi') {
        const res = lastResults
        if (res) {
          parts.push('<div class="tb-card" style="gap:6px"><div class="tb-sec"><span class="tb-sec-label">问题 · ' + fmtClock(res.t) + '</span>' +
            '<div style="font-size:12.5px;white-space:pre-wrap;word-break:break-word">' + esc(res.q) + '</div></div></div>')
          for (const it of res.items) {
            parts.push('<div class="tb-card">' +
              '<div class="tb-card-head"><span class="tb-key">' + esc(it.route) + '</span>' +
              '<span class="tb-note">' + it.ms + 'ms' + (it.out != null ? ' · 输出 ' + it.out + ' tok' : '') + '</span></div>' +
              (it.err
                ? '<div class="tb-banner tb-banner-error">' + esc(it.err) + '</div>'
                : '<pre class="tb-code">' + esc(it.a || '（空回复）') + '</pre>') +
            '</div>')
          }
        } else {
          parts.push('<div class="tb-notice">结果区：并发对比后按模型分别展示</div>')
        }
      } else {
        const h = st.history || []
        for (let i = 0; i < h.length; i++) {
          const it = Object.assign({}, h[i], { __i: i })
          parts.push(p.row ? p.row(it) : aiHistoryCard(it, '', it.a, '', '结果'))
        }
        if (!h.length) parts.push('<div class="tb-notice">' + (p.id === 'aisummary' ? '点击「生成 / 刷新摘要」对当前会话做 AI 摘要（最近一次结果落盘保留）' : (p.id === 'compare' ? '' : '结果显示在这里（最近 ' + p.cap + ' 条落盘保留）')) + '</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    // ===== handler（通用动作分派）=====
    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const init = { preset: 'ask', provider: '', model: '', picked: [], q: '', path: '', code: '', params: {}, info: null, history: [], notice: null }
      const st = (state && typeof state === 'object' && state) ? state : init
      if (!Array.isArray(st.history)) st.history = []
      if (!Array.isArray(st.picked)) st.picked = []
      if (!st.params || typeof st.params !== 'object') st.params = {}
      const el = fields && fields.__el ? fields.__el : {}
      const p = PRESET_MAP[st.preset] || PRESETS[0]

      // 同步表单字段
      if (typeof fields.q === 'string') st.q = fields.q
      if (typeof fields.path === 'string') st.path = fields.path
      if (typeof fields.code === 'string') st.code = fields.code
      if (typeof fields.provider === 'string' && fields.provider) st.provider = fields.provider
      if (typeof fields.model === 'string' && fields.model) st.model = fields.model
      for (const param of p.params || []) {
        if (typeof fields[param.key] === 'string') st.params[param.key] = fields[param.key]
      }

      // 动作分派
      if (action === 'preset' && el.p && PRESET_MAP[el.p]) {
        paramMem[st.preset] = st.params
        st.preset = el.p
        st.params = paramMem[el.p] || {}
        st.info = null
        st.notice = null
        const np = PRESET_MAP[st.preset]
        st.history = await loadHistory(np, ws)
        if (np.mode === 'multi' && !st.picked.length) {
          const d = await defaultRoute()
          if (d) st.picked = [d]
        }
      } else if (action === 'route') {
        st.model = ''
        if (p.mode === 'multi') st.picked = [] // provider 换了，旧芯片路由作废（与 compare 原行为一致）
      } else if (action === 'pick' && el.r && p.mode === 'multi') {
        const i = st.picked.indexOf(String(el.r))
        if (i >= 0) st.picked.splice(i, 1); else st.picked.push(String(el.r))
      } else if (action === 'scan') {
        const inp = await collectInput(p, st, ws, session)
        if (inp.error) { st.notice = inp.error; st.info = null }
        else if (inp.meta) st.info = inp.meta
      } else if (action === 'clear') {
        st.history = []
        const persisted = await persistHistory(p, st, ws)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + storeRel(p) + '，仅保存在面板内存中'
      } else if (action === 'send') {
        if (!ai.available) {
          st.notice = 'llm 服务不可用（可切换 preset 浏览历史）'
        } else if (p.mode === 'multi') {
          if (!(st.q || '').trim()) {
            st.notice = '请输入问题'
          } else if (!st.picked.length) {
            st.notice = '请至少选择 1 个模型'
          } else {
            const items = await Promise.all(st.picked.map((r) => askOne(st.q.trim(), r, ws)))
            lastResults = { q: st.q.trim(), t: Date.now(), items }
            const saved = await readJsonStore(ctx, storeRel(p), ws.root, [])
            const rounds = [{
              q: lastResults.q, t: lastResults.t,
              items: items.map((it) => ({ route: it.route, a: String(it.a || '').slice(0, 4000), err: it.err, ms: it.ms, out: it.out })),
            }].concat(Array.isArray(saved) ? saved : []).slice(0, p.cap)
            st.history = rounds
            const persisted = await writeJsonStore(ctx, storeRel(p), rounds, ws.root, ws.session)
            st.notice = persisted ? null : '⚠ 对比记录未能写入 ' + storeRel(p)
          }
        } else {
          const inp = await collectInput(p, st, ws, session)
          if (inp.error) {
            st.notice = inp.error
          } else if (!ai.available) {
            st.notice = 'llm 服务不可用'
          } else {
            await ai.resolveRoute(st)
            let user
            if (p.id === 'commitmsg') {
              user = (st.params.extra && st.params.extra.trim() ? '补充说明：' + st.params.extra.trim() + '\n\n' : '') +
                'git diff（' + (lastDiff.scope === 'staged' ? '暂存区' : '工作区') + (lastDiff.truncated ? '，已截断' : '') + '）：\n' + lastDiff.text
            } else if (p.id === 'review') {
              user = '文件：' + inp.meta.target + (inp.meta.lang ? '（' + inp.meta.lang + '）' : '') + '\n```\n' + inp.content + '\n```' + (inp.meta.truncated ? '\n（内容过长，仅评审前 ' + CODE_CAP + ' 字符）' : '')
            } else if (p.id === 'aisummary') {
              user = lastLog ? lastLog.text : ''
            } else {
              user = inp.content
            }
            const r = await ai.chat(st, p.sys(st), user, undefined, { root: ws.root, session: ws.session, tool: p.id })
            const ts = Date.now()
            if (p.id === 'translate') {
              st.history = [{
                src: inp.content.slice(0, 500), dst: (r.a || '').slice(0, 4000), err: r.err || null,
                target: st.params.target || TARGETS[0], ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: ts,
              }].concat(st.history || []).slice(0, p.cap)
            } else if (p.id === 'promptopt') {
              st.history = [{
                draft: inp.content.slice(0, 300), opt: (r.a || '').slice(0, 6000), err: r.err || null,
                style: st.params.style || STYLES[0], ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: ts,
              }].concat(st.history || []).slice(0, p.cap)
            } else if (p.id === 'review') {
              st.history = [{
                target: inp.meta.target, chars: inp.content.length, truncated: inp.meta.truncated, report: (r.a || '').slice(0, 8000), err: r.err || null,
                ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: ts,
              }].concat(st.history || []).slice(0, p.cap)
            } else if (p.id === 'commitmsg') {
              st.history = [{
                msg: (r.a || '').slice(0, 2000), err: r.err || null, scope: lastDiff.scope,
                ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: ts,
              }].concat(st.history || []).slice(0, p.cap)
            } else if (p.id === 'aisummary') {
              let at = ''
              try { at = new Date().toISOString().slice(0, 19).replace('T', ' ') } catch (e) {}
              st.history = [{
                sid: session, summary: (r.a || '').slice(0, 8000),
                meta: { events: lastLog.events, chars: lastLog.text.length, truncated: lastLog.truncated, omitted: lastLog.omitted, ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', at },
              }]
            } else {
              st.history = [{ q: inp.content, a: r.a || '', err: r.err || null, ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: ts }].concat(st.history || []).slice(0, p.cap)
            }
            const persisted = await persistHistory(p, st, ws)
            st.notice = persisted ? null : '⚠ 历史未能写入 ' + storeRel(p) + '，仅保存在面板内存中'
          }
        }
      } else if (action === 'clear-results') {
        lastResults = null
      } else if (action === '') {
        st.history = await loadHistory(p, ws)
        if (p.id === 'compare') {
          const saved = st.history
          if (Array.isArray(saved) && saved.length && saved[0] && Array.isArray(saved[0].items)) lastResults = saved[0]
          const d = await defaultRoute()
          if (!st.picked.length && d) st.picked = [d]
        }
        st.info = null
        st.notice = null
      }

      // 渲染数据
      const show = st
      const route = await ai.resolveRoute(show)
      const roll = await ai.rollup(ws.root, p.id)
      const out = { ok: true, html: render(show, route, roll), state: show }
      if (action === 'copy' && el.i != null) {
        const it = (st.history || [])[Number(el.i)]
        const copyKey = p.copyKey || 'a'
        if (it && typeof it[copyKey] === 'string' && it[copyKey]) out.copy = it[copyKey]
      }
      return out
    }

    tryRegisterTool(ctx, { id: 'aiassist', label: 'AI 助手', order: 11, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l1.4 2.8 3.1.45-2.25 2.2.5 3.1-2.75-1.45-2.75 1.45.5-3.1-2.25-2.2 3.1-.45z"/><circle cx="13" cy="13" r="1.2"/></svg>' }, handler)
  },
}
}

const create_tools = () => {
// ===== tools-tool.js：当前可用工具清单（Host-only）=====
// 模型视角的「可调用方式」：tools.schemas() 注册表 → 空则退回 systemPrompt.assemble().tools。
// 搜索过滤；点击条目展开完整 description + parameters JSON schema。
// 状态：{ q, open }（schema 每次重取，不进 state）

return {
  name: 'tools-tool',
  inject: ['fs', 'tools', 'systemPrompt', 'timer'],
  apply(ctx) {
    const toolsSvc = ctx.get('tools')
    const sp = ctx.get('systemPrompt')

    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const CAP = 20000

    const gather = async () => {
      if (toolsSvc) {
        try {
          const list = toolsSvc.schemas()
          if (list && list.length) return { list, source: '工具注册表（tools.schemas）' }
        } catch (e) {}
      }
      if (sp) {
        const asm = await sp.assemble({})
        if (asm && asm.tools && asm.tools.length) return { list: asm.tools, source: '提示词装配（systemPrompt.assemble）' }
      }
      return { list: [], source: '' }
    }

    const handler = async ({ action, fields, state }) => {
      const st = (state && typeof state === 'object' && state) ? state : { q: '', open: null }
      const el = fields && fields.__el ? fields.__el : {}
      if (typeof fields.q === 'string') st.q = fields.q
      if (action === 'open' && el.name) st.open = st.open === String(el.name) ? null : String(el.name)
      else if (action === 'close') st.open = null

      try {
        const { list, source } = await gather()
        const q = (st.q || '').trim().toLowerCase()
        const shown = q ? list.filter((t) => (t.name || '').toLowerCase().indexOf(q) >= 0 || String(t.description || '').toLowerCase().indexOf(q) >= 0) : list

        const parts = []
        parts.push('<div class="jr-tabpanel tb-root">')
        parts.push('<div class="tb-query">' +
          '<input class="tb-input" data-field="q" placeholder="按名称 / 描述过滤" value="' + esc(st.q || '') + '" />' +
          '<button type="button" class="tb-btn tb-btn-primary" data-action="search">搜索</button>' +
        '</div>')
        parts.push('<div class="tb-list-head"><span class="tb-list-title">可用工具<span class="tb-count">' + shown.length + '</span></span>' +
          (source ? '<span class="tb-note">来源：' + esc(source) + '</span>' : '') + '</div>')
        if (!list.length) {
          parts.push('<div class="tb-notice">未取到工具 schema（注册表与装配均为空）</div>')
        } else {
          // 展开详情
          if (st.open) {
            const t = list.find((x) => x.name === st.open)
            if (t) {
              let params = ''
              try { params = JSON.stringify(t.parameters || {}, null, 2) } catch (e) { params = String(t.parameters) }
              parts.push('<div class="tb-preview"><div class="tb-preview-head">' +
                '<span class="tb-preview-name">' + esc(t.name) + '</span>' +
                '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close">关闭</button></div>' +
                '<div class="tb-sec"><span class="tb-sec-label">描述</span><div style="font-size:12px;white-space:pre-wrap;word-break:break-word">' + esc(t.description || '（无）') + '</div></div>' +
                '<div class="tb-sec"><span class="tb-sec-label">参数 schema</span><pre class="tb-code">' +
                esc(params.length > CAP ? params.slice(0, CAP) + '\n…（截断）' : params) + '</pre></div></div>')
            }
          }
          parts.push('<div class="tb-list">' + shown.map((t) =>
            '<div class="tb-rec' + (st.open === t.name ? ' tb-rec-active' : '') + '" data-action="open" data-name="' + esc(t.name) + '">' +
              '<div class="tb-rec-main">' +
                '<div class="tb-rec-top"><span class="tb-rec-key">' + esc(t.name) + '</span>' +
                '<span class="tb-rec-summary">' + esc(oneLine(t.description, 90)) + '</span></div>' +
              '</div>' +
            '</div>'
          ).join('') + '</div>')
        }
        parts.push('</div>')
        return { ok: true, html: parts.join(''), state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'tools', label: '工具', order: 12, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>' }, handler)
  },
}

}

const create_search = () => {
// ===== search-tool.js：当前会话全文搜索（Host-only）=====
// sessionQuery.searchEvents 语义扫描（命中带 snippet），点击条目 readEvent 读完整事件。
// 与「轨迹」互补：轨迹是结构化时间线，这里是自由文本检索。
// 状态：{ q, hits, open, searched }（详情原文按需 readEvent，不进 state）

return {
  name: 'search-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && (b.type === 'text' || b.type === 'reasoning') ? b.text : '')).filter(Boolean).join('\n')
    }
    const CAP = 12000

    const TYPE_LABEL = {
      'user/message': '用户', 'assistant/message': '助手', 'tool/call': '调用',
      'tool/result': '结果', 'todo/write': '待办', 'turn/start': '轮次',
    }
    const typePill = (t) => {
      if (t === 'user/message') return 'tb-pill-done'
      if (t === 'assistant/message') return 'tb-pill-active'
      if (t === 'tool/call' || t === 'tool/result') return 'tb-pill-other'
      return 'tb-pill-plain'
    }

    // 完整事件 → 可读文本
    const eventText = (ev) => {
      if (!ev) return ''
      const d = ev.data || {}
      if (ev.type === 'tool/call') {
        let args = d.arguments || ''
        try { args = JSON.stringify(JSON.parse(d.arguments), null, 2) } catch (e) {}
        return '工具：' + (d.name || '?') + '（T' + d.turn + '·S' + d.step + '）\n\n' + args
      }
      if (ev.type === 'tool/result') {
        const m = d.message || {}
        const block = Array.isArray(m.content) ? m.content[0] : null
        return (d.error ? '[error] ' + (d.error.name || '') + ' ' + (d.error.code || '') + '\n\n' : '') + (block ? textOf(block.content) : '')
      }
      if (ev.type === 'assistant/message') return textOf((d.message || {}).content)
      if (ev.type === 'user/message') return textOf(d.content)
      return JSON.stringify(d, null, 2)
    }

    const handler = async ({ action, fields, state, root, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { q: '', hits: [], open: null, searched: false, recent: [] }
      if (!Array.isArray(st.recent)) st.recent = []
      const el = fields && fields.__el ? fields.__el : {}
      if (typeof fields.q === 'string') st.q = fields.q
      const ws = resolveWorkspace(ctx, root, session)
      const REL_STORE = '.dsh-dynamic-toolbox/toolbox-search.json'

      let detailHtml = ''
      try {
        const sid = session || null
        if (!sid) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到当前会话</div></div>', state: st }

        // 查询历史：最近 8 条（去重置顶）落盘工作区，点芯片即重搜
        const remember = async (q) => {
          st.recent = [q].concat(st.recent.filter((x) => x !== q)).slice(0, 8)
          await writeJsonStore(ctx, REL_STORE, st.recent, ws.root, ws.session)
        }
        const runSearch = async () => {
          const page = await sq.searchEvents({ sessionId: sid, query: st.q.trim(), limit: 50 })
          st.hits = ((page && page.items) || []).map((h) => ({
            seq: h.seq, type: String(h.type || ''), time: h.time, snippet: String(h.snippet || ''), surface: String(h.surface || ''),
          }))
          st.open = null
          st.searched = true
          await remember(st.q.trim())
        }

        if (action === 'query' && st.q.trim()) {
          await runSearch()
        } else if (action === 'research' && el.q) {
          st.q = String(el.q)
          await runSearch()
        } else if (action === 'clear-recent') {
          st.recent = []
          await writeJsonStore(ctx, REL_STORE, [], ws.root, ws.session)
        } else if (action === 'open' && el.seq) {
          const n = Number(el.seq)
          st.open = st.open === n ? null : n
        } else if (action === 'close') {
          st.open = null
        } else if (action === '') {
          const saved = await readJsonStore(ctx, REL_STORE, ws.root, null)
          if (Array.isArray(saved)) st.recent = saved.filter((x) => typeof x === 'string').slice(0, 8)
        }

        if (st.open != null) {
          const w = await sq.readEvent({ sessionId: sid, seq: st.open, before: 0, after: 0 })
          const text = eventText(w && w.target)
          detailHtml = '<div class="tb-preview"><div class="tb-preview-head">' +
            '<span class="tb-preview-name">#' + st.open + ' 完整内容</span>' +
            '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close">关闭</button></div>' +
            '<pre class="tb-code">' + esc(text.length > CAP ? text.slice(0, CAP) + '\n…（截断，共 ' + text.length + ' 字符）' : (text || '（无文本）')) + '</pre></div>'
        }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }

      const parts = []
      parts.push('<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">')
      parts.push('<div class="tb-query">' +
        '<input class="tb-input" data-field="q" placeholder="在当前会话里搜索（消息 / 工具调用 / 结果）" value="' + esc(st.q || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="query">搜索</button>' +
      '</div>')
      if (st.recent.length) {
        parts.push('<div class="tb-chips">' +
          st.recent.map((q) => '<button type="button" class="tb-chip" data-action="research" data-q="' + esc(q) + '" title="点击重搜">' + esc(q.length > 20 ? q.slice(0, 19) + '…' : q) + '</button>').join('') +
          '<button type="button" class="tb-chip" data-action="clear-recent" title="清空搜索历史">×</button>' +
        '</div>')
      }
      if (detailHtml) parts.push(detailHtml)
      if (st.searched) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">命中<span class="tb-count">' + st.hits.length + '</span></span>' +
          '<span class="tb-note">上限 50 条</span></div>')
      }
      parts.push('</div>')
      parts.push('<div class="tb-pane-body tb-pane-col">')
      if (!st.searched) {
        parts.push('<div class="tb-notice">输入关键词搜索当前会话的完整日志</div>')
      } else if (st.hits.length === 0) {
        parts.push('<div class="tb-notice">无命中</div>')
      } else {
        parts.push('<div class="tb-list">' + st.hits.map((h) =>
          '<div class="tb-rec' + (st.open === h.seq ? ' tb-rec-active' : '') + '" data-action="open" data-seq="' + h.seq + '">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top">' +
                '<span class="tb-pill ' + typePill(h.type) + '">' + esc(TYPE_LABEL[h.type] || h.type) + '</span>' +
                '<span class="tb-rec-summary">' + esc(h.snippet) + '</span>' +
              '</div>' +
              '<div class="tb-rec-sub"><span>' + fmtTime(h.time) + '</span><span>#' + h.seq + '</span>' +
              (h.surface === 'shadowed' ? '<span class="tb-tx-warn">已被压缩</span>' : '') +
              (h.surface === 'log-only' ? '<span class="tb-tx-muted">仅日志</span>' : '') + '</div>' +
            '</div>' +
          '</div>'
        ).join('') + '</div>')
      }
      parts.push('</div></div>')
      return { ok: true, html: parts.join(''), state: st }
    }

    tryRegisterTool(ctx, { id: 'search', label: '搜索', order: 13, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/></svg>' }, handler)
  },
}

}

const create_lineage = () => {
// ===== lineage-tool.js：会话血缘树（Host-only）=====
// sessionQuery.traceSession(当前会话)：祖先链（直至根）+ 后代子代理树（递归）。
// 纯只读视图，每动作重取（traceSession 是一次性观测，无大负载）。
// 状态：{}

return {
  name: 'lineage-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtDate = (t) => {
      if (!t) return '—'
      const d = new Date(t)
      return (d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
    }
    const shortId = (id) => String(id || '').replace(/^session-/, '').slice(0, 8)
    const cwdName = (cwd) => String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || '（无目录）'

    const badge = (rec) => {
      const b = []
      if (rec.live) b.push('<span class="tb-pill tb-pill-done">在线</span>')
      else if (rec.persisted) b.push('<span class="tb-pill tb-pill-plain">已落盘</span>')
      if (rec.header && rec.header.origin === 'subagent') b.push('<span class="tb-pill tb-pill-other">子代理</span>')
      return b.join('')
    }

    const rowHtml = (rec, depth, isTarget) => {
      const pad = (depth * 18 + 4) + 'px'
      return '<div class="tb-tree-row' + (isTarget ? ' tb-rec-active' : '') + '" style="padding-left:' + pad + ';cursor:default" title="' + esc(String((rec.header || {}).id || '')) + '">' +
        '<span class="tb-tree-ic">' + (isTarget ? '◉' : depth === 0 ? '●' : '○') + '</span>' +
        '<span class="tb-rec-key">' + esc(shortId((rec.header || {}).id)) + '</span>' +
        '<span class="tb-tree-name">' + esc(cwdName((rec.header || {}).cwd)) + '</span>' +
        badge(rec) +
        '<span class="tb-tree-size">' + fmtDate((rec.header || {}).createdAt) + '</span>' +
      '</div>'
    }

    const renderTree = (nodes, depth, out, targetId) => {
      for (const n of nodes || []) {
        const rec = n.session || {}
        out.push(rowHtml(rec, depth, String((rec.header || {}).id) === targetId))
        renderTree(n.descendants, depth + 1, out, targetId)
      }
    }

    const handler = async ({ session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      try {
        const sid = session || null
        if (!sid) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到当前会话</div></div>', state: {} }
        const tr = await sq.traceSession(sid)
        const targetId = String(((tr.target || {}).header || {}).id || sid)

        const head = []
        head.push('<div class="tb-card"><div class="tb-card-head">' +
          '<span class="tb-key">' + esc(shortId(targetId)) + '</span>' +
          '<div class="tb-title">当前会话</div>' + badge(tr.target || {}) + '</div>' +
          '<div class="tb-meta">' + [
            ['工作区', cwdName(((tr.target || {}).header || {}).cwd)],
            ['创建于', fmtDate(((tr.target || {}).header || {}).createdAt)],
            ['祖先链', tr.complete ? '完整（根可达）' : '不完整（有父级不可见）'],
            ['直接子代理', String(((tr.descendants) || []).length)],
          ].map((r) => '<div class="tb-meta-item"><span class="tb-meta-label">' + r[0] + '</span><span class="tb-meta-value">' + esc(r[1]) + '</span></div>').join('') +
          '</div></div>')

        const body = []
        // 祖先链：root → … → parent（traceSession.ancestors 是近父在前，反转为根在前）
        const ancestors = ((tr.ancestors) || []).slice().reverse()
        if (ancestors.length) {
          body.push('<div class="tb-list-head"><span class="tb-list-title">祖先链<span class="tb-count">' + ancestors.length + '</span></span></div>')
          ancestors.forEach((rec, i) => body.push(rowHtml(rec, i, false)))
          body.push(rowHtml(tr.target, ancestors.length, true))
        }
        // 后代树
        const countDesc = (nodes) => (nodes || []).reduce((n, x) => n + 1 + countDesc(x.descendants), 0)
        const descTotal = countDesc(tr.descendants)
        body.push('<div class="tb-list-head"><span class="tb-list-title">后代（子代理）<span class="tb-count">' + descTotal + '</span></span></div>')
        if (descTotal === 0) {
          body.push('<div class="tb-notice">当前会话没有子代理后代</div>')
        } else {
          const rows = []
          renderTree(tr.descendants, 0, rows, targetId)
          body.push('<div class="tb-tree">' + rows.join('') + '</div>')
        }
        if (!tr.complete) {
          body.push('<div class="tb-banner tb-banner-info">祖先链在 ' + esc(shortId(tr.unresolvedParentId)) + ' 处断出可见语料（该父级不在当前逻辑库中）</div>')
        }

        const html = '<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">' + head.join('') + '</div>' +
          '<div class="tb-pane-body tb-pane-col">' + body.join('') + '</div></div>'
        return { ok: true, html, state: {} }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: {} }
      }
    }

    tryRegisterTool(ctx, { id: 'lineage', label: '谱系', order: 14, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="3.5" r="1.6"/><circle cx="3.5" cy="12.5" r="1.6"/><circle cx="12.5" cy="12.5" r="1.6"/><path d="M8 5.1v.9a2 2 0 0 1-2 2H5.4"/><path d="M9.5 6.4h.6a2 2 0 0 1 2 2v1.6"/></svg>' }, handler)
  },
}

}

const create_aiusage = () => {
// ===== aiusage-tool.js：AI 旁路调用台账（Host-only）=====
// 数据源：.dsh-dynamic-toolbox/toolbox-ai-usage.json（makeLlmHelper.chat 的 track 异步追加，cap 100 条）。
// 展示：总计（调用/输出/失败/今日）+ 按工具聚合条形图 + 最近 20 条明细；两步确认清空台账。
// 状态：{ confirmClear, notice }（台账本体每次动作重读磁盘，不进 state）

return {
  name: 'aiusage-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
    const fmtDay = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() }
    const fmtTok = (n) => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n)
    const fmtMs = (ms) => ms >= 10000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'

    const build = (list) => {
      const byTool = {}
      let calls = 0, out = 0, errs = 0, todayCalls = 0, todayOut = 0
      const dayStr = new Date().toDateString() // 本地日界（记录 t 为本地时间戳，同一日界口径）
      for (const r of list) {
        if (!r || typeof r !== 'object') continue
        const k = String(r.tool || '?')
        if (!byTool[k]) byTool[k] = { tool: k, calls: 0, out: 0, errors: 0 }
        if (r.ok) {
          byTool[k].calls++
          calls++
          const o = typeof r.out === 'number' ? r.out : 0
          byTool[k].out += o
          out += o
          if (typeof r.t === 'number' && new Date(r.t).toDateString() === dayStr) { todayCalls++; todayOut += o }
        } else {
          byTool[k].errors++
          errs++
        }
      }
      const tools = Object.keys(byTool).map((k) => byTool[k]).sort((a, b) => b.calls - a.calls)
      const recent = list.slice(-20).reverse()
      return { tools, recent, calls, out, errs, todayCalls, todayOut }
    }

    const render = (st, m) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="reload">刷新</button>' +
        (m.calls + m.errs > 0
          ? (st.confirmClear
            ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="clear-confirm">确认清空？</button>' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear-cancel">取消</button>'
            : '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空台账</button>')
          : '') +
        '<span class="tb-note">台账：.dsh-dynamic-toolbox/toolbox-ai-usage.json（AI 工具旁路调用，上限 100 条）</span></div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      if (m.calls + m.errs === 0) {
        parts.push('<div class="tb-notice">暂无旁路调用记录——用「问答 / 对比 / 翻译 / 提示优化 / 提交信息 / 评审 / 摘要」任一工具调一次模型即入账</div></div>')
        return parts.join('')
      }
      parts.push('<div class="tb-stats">' +
        '<div class="tb-stat"><span class="tb-stat-num">' + m.calls + '</span><span class="tb-stat-label">总调用</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(m.out) + '</span><span class="tb-stat-label">总输出 tok</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + m.errs + '</span><span class="tb-stat-label">失败</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + m.todayCalls + '</span><span class="tb-stat-label">今日调用</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(m.todayOut) + '</span><span class="tb-stat-label">今日输出</span></div>' +
      '</div>')

      const max = m.tools.length ? m.tools[0].calls : 1
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">按工具聚合（' + m.tools.length + '）</span>' +
        m.tools.map((t) =>
          '<div class="tb-row" style="flex-wrap:nowrap" title="' + esc(t.tool) + '：' + t.calls + ' 次 / 输出 ' + t.out + ' tok' + (t.errors ? ' / 失败 ' + t.errors : '') + '">' +
            '<span class="tb-num tb-mono" style="min-width:76px">' + esc(t.tool) + '</span>' +
            '<div style="flex:1;height:8px;border-radius:4px;background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33));overflow:hidden">' +
              '<div style="height:100%;width:' + Math.max(2, Math.round((t.calls / max) * 100)) + '%;background:var(--tb-accent,#3f6fd9);border-radius:4px"></div>' +
            '</div>' +
            '<span class="tb-num" style="min-width:44px;text-align:right">' + t.calls + ' 次</span>' +
            '<span class="tb-num" style="min-width:52px;text-align:right">' + fmtTok(t.out) + '</span>' +
            (t.errors ? '<span class="tb-num" style="min-width:36px;text-align:right;color:var(--tb-error,#d95f5f)">✗' + t.errors + '</span>' : '') +
          '</div>'
        ).join('') + '</div></div>')

      parts.push('<div class="tb-list-head"><span class="tb-list-title">最近 ' + m.recent.length + ' 条明细</span></div>')
      parts.push('<div class="tb-list">' + m.recent.map((r) =>
        '<div class="tb-rec"><div class="tb-rec-main">' +
          '<div class="tb-rec-top"><span class="tb-rec-key">' + esc(String(r.tool || '?')) + '</span>' +
          '<span class="tb-rec-summary">' + (r.ok ? '✓ 成功' : '✗ 失败') + ' · ' + fmtMs(r.ms || 0) + '</span></div>' +
          '<div class="tb-rec-sub"><span>' + fmtDay(r.t) + ' ' + fmtTime(r.t) + '</span>' +
          (r.ok && typeof r.out === 'number' ? '<span>输出 ' + r.out + ' tok</span>' : '') +
          '</div>' +
        '</div></div>'
      ).join('') + '</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { confirmClear: false, notice: null }
      if (action === 'clear') {
        st.confirmClear = true
        st.notice = null
      } else if (action === 'clear-cancel') {
        st.confirmClear = false
        st.notice = null
      } else if (action === 'clear-confirm') {
        st.confirmClear = false
        const persisted = await writeJsonStore(ctx, AI_USAGE_REL, [], ws.root, ws.session)
        st.notice = persisted ? '台账已清空' : '⚠ 未能写入 ' + AI_USAGE_REL + '，清空仅在内存生效'
      } else {
        // '' / reload：重读磁盘（其他 AI 工具可能刚追加了记录）
        st.confirmClear = false
        if (action === '') st.notice = null
      }
      const list = await readJsonStore(ctx, AI_USAGE_REL, ws.root, [])
      const m = build(Array.isArray(list) ? list : [])
      return { ok: true, html: render(st, m), state: st }
    }

    tryRegisterTool(ctx, { id: 'aiusage', label: 'AI 用量', order: 21, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l1.4 2.8 3.1.45-2.25 2.2.5 3.1-2.75-1.45-2.75 1.45.5-3.1-2.25-2.2 3.1-.45z"/></svg>' }, handler)
  },
}

}

const create_quota = () => {
// ===== quota-tool.js：API 配额查询（Host-only，经工具箱 RPC 注册）=====
// 多提供商配额/余额查询（提供商与数据接口分类参考 cc-switch 的用量查询模板）：
//   · Kimi Coding（k3）：GET api.kimi.com/coding/v1/usages（官方 usages：周额度 + 5h 滑动窗口 + 并发）
//   · DeepSeek：GET api.deepseek.com/user/balance（官方余额：总额 / 赠送 / 充值，is_available）
//   · Qwen Token Plan（阿里云百炼）：POST bailian.console.aliyun.com/data/api.json?…queryCodingPlanInstanceInfoV2
//     （端点与 5h/周/月窗口字段参考 CodexBar 文档；部分 CN 账号 API 模式可能要求控制台会话，失败时明示）
// Key 凭据链：环境变量 → ~/.dsh/.credentials.yaml（键名随提供商，Node 子进程读取，沙箱外）。
// 子进程跑 https 查询（插件求值器无 fetch/process；Node 走系统 TUN 代理可直连，curl 走 schannel 会被拒）。
// 状态：{ loading, error, data, at, provider }（data 是脱敏后的余量摘要，key 永不出子进程）
// 注：查询走用户自己的 API Key，产生的是配额查询请求（轻量，不计入模型 token 用量）。

return {
  name: 'quota-tool',
  inject: ['subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')

    // 提供商表：id / 显示名 / 凭据键名（cc-switch 模板分类：Token Plan 套餐配额 + 第三方余额）
    // qwen 特殊：阿里云未开放套餐用量 API key 接口（zeldaEasy 端点实测 ConsoleNeedLogin），
    // 只能走控制台 Cookie 会话（CodexBar baseline 同款）——凭据键为 Cookie 而非 API key
    const PROVIDERS = [
      { id: 'kimi', label: 'Kimi Coding', keyName: 'KIMI_CODING_API_KEY' },
      { id: 'deepseek', label: 'DeepSeek', keyName: 'DEEPSEEK_API_KEY' },
      { id: 'qwen', label: 'Qwen Plan · 百炼', keyName: 'QWEN_TOKEN_PLAN_CN_API_KEY', credName: 'QWEN_TOKEN_PLAN_CN_COOKIE', credNote: '控制台 Cookie（bailian.console.aliyun.com 登录后从浏览器复制）' },
    ]
    const providerOf = (id) => {
      for (const p of PROVIDERS) { if (p.id === id) return p }
      return PROVIDERS[0]
    }

    // 子进程脚本：读凭据 → 按提供商查询 → 输出归一化 JSON（windows[] 配额窗口 / balances[] 余额）。
    // 数组 join 规避模板 \n 转义坑（PLUGIN-DEV.md 血泪）；提供商 id/键名经 JSON.stringify 内联。
    const scriptFor = (pid, keyName, cookieName) => [
      "const https = require('https')",
      "const fs = require('fs')",
      "const os = require('os')",
      "const path = require('path')",
      'const PID = ' + JSON.stringify(pid),
      'const KEY_NAME = ' + JSON.stringify(keyName),
      'const COOKIE_NAME = ' + JSON.stringify(cookieName || ''),
      "function readNamed(n) {",
      "  if (!n) return ''",
      "  if (process.env[n]) return process.env[n]",
      "  try {",
      "    const f = path.join(os.homedir(), '.dsh', '.credentials.yaml')",
      "    const re = new RegExp('^' + n + ':\\\\s*(.+)\\\\s*$', 'm')",
      "    const m = fs.readFileSync(f, 'utf8').match(re)",
      "    if (m) return m[1].trim()",
      "  } catch (e) {}",
      "  return ''",
      "}",
      "const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0) }",
      "const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0 }",
      "const key = readNamed(KEY_NAME)",
      "if (!key && PID !== 'qwen') out({ ok: false, error: '未找到 ' + KEY_NAME + '（环境变量或 ~/.dsh/.credentials.yaml）' })",
      "function req(o) { return new Promise((resolve) => {",
      "  const r = https.request({ host: o.host, port: 443, path: o.path, method: o.method, timeout: 20000, headers: o.headers }, (res) => {",
      "    let body = ''",
      "    res.on('data', (c) => body += c)",
      "    res.on('end', () => {",
      "      let j = null",
      "      try { j = JSON.parse(body) } catch (e) {}",
      "      resolve({ status: res.statusCode, json: j, raw: body })",
      "    })",
      "  })",
      "  r.on('error', (e) => resolve({ status: 0, error: '网络错误: ' + e.message }))",
      "  r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: '请求超时（20s）' }) })",
      "  if (o.body) r.write(o.body)",
      "  r.end()",
      "})}",
      "(async () => {",
      "  try {",
      // ---- Kimi Coding：官方 usages（周额度 + 滑动窗口 + 并发）----
      "    if (PID === 'kimi') {",
      "      const r = await req({ host: 'api.kimi.com', path: '/coding/v1/usages', method: 'GET', headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'KimiCLI/1.5' } })",
      "      if (r.error) out({ ok: false, error: r.error })",
      "      const j = r.json || {}",
      "      if (r.status !== 200) out({ ok: false, error: 'HTTP ' + r.status + ': ' + ((j.error && j.error.message) || (r.raw || '').slice(0, 200)) })",
      "      const usage = j.usage || {}",
      "      const win = (j.limits && j.limits[0] && j.limits[0].detail) || {}",
      "      const winInfo = (j.limits && j.limits[0] && j.limits[0].window) || {}",
      "      out({ ok: true, data: {",
      "        plan: (j.user && j.user.membership && j.user.membership.level) || '',",
      "        windows: [",
      "          { label: '主额度（每周重置）', used: num(usage.used), total: num(usage.limit), resetTime: usage.resetTime || '' },",
      "          { label: '限流窗口（' + (num(winInfo.duration) || 300) + ' 分钟滑动）', used: num(win.used), total: num(win.limit), resetTime: win.resetTime || '' },",
      "        ],",
      "        extra: '并发 ' + ((j.parallel && Array.isArray(j.parallel.details)) ? j.parallel.details.length : 0) + ' / ' + num(j.parallel && j.parallel.limit) + ((j.boosterWallet && j.boosterWallet.status && j.boosterWallet.status !== 'STATUS_DISABLED') ? ' · 加量包已启用' : '')",
      "      } })",
      "    }",
      // ---- DeepSeek：官方余额（is_available + 各币种总额/赠送/充值）----
      "    else if (PID === 'deepseek') {",
      "      const r = await req({ host: 'api.deepseek.com', path: '/user/balance', method: 'GET', headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' } })",
      "      if (r.error) out({ ok: false, error: r.error })",
      "      const j = r.json || {}",
      "      if (r.status !== 200) out({ ok: false, error: 'HTTP ' + r.status + ': ' + ((j.error && j.error.message) || (r.raw || '').slice(0, 200)) })",
      "      const infos = Array.isArray(j.balance_infos) ? j.balance_infos : []",
      "      out({ ok: true, data: {",
      "        available: !!j.is_available,",
      "        balances: infos.map((b) => ({ currency: b.currency || '', total: num(b.total_balance), granted: num(b.granted_balance), toppedUp: num(b.topped_up_balance) }))",
      "      } })",
      "    }",
      // ---- Qwen Token Plan（阿里云百炼 Coding Plan）：控制台 Cookie 会话模式 ----
      // 阿里云未开放套餐用量 API key 接口（zeldaEasy 实测 ConsoleNeedLogin），只能控制台会话（CodexBar baseline 同款）
      "    else if (PID === 'qwen') {",
      "      const cookie = readNamed(COOKIE_NAME)",
      "      if (!cookie) out({ ok: false, error: 'Qwen Plan 套餐用量阿里云未开放 API key 查询接口（实测 ConsoleNeedLogin），仅支持控制台会话：登录百炼控制台 bailian.console.aliyun.com 后，浏览器 F12 → Network → 任意请求 → 复制 Cookie 整行，写入凭据键 ' + COOKIE_NAME + '（环境变量或 ~/.dsh/.credentials.yaml）；或前往控制台「订阅套餐」页直接查看' })",
      "      const qPath = '/data/api.json?action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian&api=queryCodingPlanInstanceInfoV2'",
      "      const r = await req({ host: 'bailian.console.aliyun.com', path: qPath, method: 'POST', body: '{}', headers: { Cookie: cookie, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } })",
      "      if (r.error) out({ ok: false, error: r.error })",
      "      if (r.status !== 200) out({ ok: false, error: 'HTTP ' + r.status + ': ' + (r.raw || '').slice(0, 200) })",
      "      const j = r.json || {}",
      "      if (j.code === 'ConsoleNeedLogin') out({ ok: false, error: '控制台 Cookie 已过期或不完整，请重新登录百炼控制台后复制最新 Cookie 更新到 ' + COOKIE_NAME })",
      "      const datas = j.data || {}",
      "      const infos = Array.isArray(datas.codingPlanInstanceInfos) ? datas.codingPlanInstanceInfos : []",
      "      if (!infos.length) out({ ok: false, error: '未返回套餐信息：' + (r.raw || '').slice(0, 160) })",
      "      const inst = infos[0] || {}",
      "      const q = inst.codingPlanQuotaInfo || datas.codingPlanQuotaInfo || {}",
      "      const wins = []",
      "      if (num(q.per5HourTotalQuota)) wins.push({ label: '5 小时窗口', used: num(q.per5HourUsedQuota), total: num(q.per5HourTotalQuota), resetTime: q.per5HourQuotaNextRefreshTime || '' })",
      "      if (num(q.perWeekTotalQuota)) wins.push({ label: '每周额度', used: num(q.perWeekUsedQuota), total: num(q.perWeekTotalQuota), resetTime: q.perWeekQuotaNextRefreshTime || '' })",
      "      if (num(q.perBillMonthTotalQuota)) wins.push({ label: '每月额度', used: num(q.perBillMonthUsedQuota), total: num(q.perBillMonthTotalQuota), resetTime: q.perBillMonthQuotaNextRefreshTime || '' })",
      "      out({ ok: true, data: { plan: inst.planName || inst.instanceName || inst.packageName || '', windows: wins } })",
      "    }",
      "  } catch (e) { out({ ok: false, error: '查询异常: ' + String((e && e.message) || e) }) }",
      "})()",
    ].join('\n')

    const runQuery = async (wsRoot, pid) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      const p = providerOf(pid)
      try {
        const handle = subprocess.spawn({
          argv: ['node', '-e', scriptFor(p.id, p.keyName, p.credName)],
          cwd: wsRoot,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 16 * 1024 } },
          graceMs: 30000,
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout.readFrom(0).text
        if (outcome.exitCode !== 0) {
          return { ok: false, error: handle.collected.stderr.readFrom(0).text.slice(0, 300) || '子进程失败' }
        }
        return JSON.parse(stdout)
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    }

    // 用量比例 → 状态色（剩余比例越高越绿，低则黄/红）
    const levelOf = (remaining, limit) => {
      if (!limit) return 'plain'
      const r = remaining / limit
      if (r > 0.5) return 'done'
      if (r > 0.2) return 'other'
      return 'warn'
    }
    const fmtTime = (iso) => {
      if (!iso) return '—'
      try {
        // 兼容 ISO 字符串与数字时间戳（秒/毫秒，百炼窗口刷新时间是 epoch）
        let d
        if (typeof iso === 'number' || /^\d{10,}$/.test(String(iso))) {
          let n = Number(iso)
          if (n < 1e12) n *= 1000
          d = new Date(n)
        } else {
          d = new Date(iso)
        }
        if (isNaN(d.getTime())) return String(iso)
        const p2 = (n) => (n < 10 ? '0' : '') + n
        return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
      } catch (e) { return String(iso) }
    }
    const fmtNum = (n) => {
      const v = Number(n)
      if (!isFinite(v)) return String(n)
      return v >= 10000 ? (v / 1000).toFixed(1) + 'k' : String(v)
    }
    const bar = (used, limit) => {
      if (!limit) return ''
      const pct = Math.max(0, Math.min(100, Math.round((used / limit) * 100)))
      return '<div style="flex:1;height:8px;border-radius:999px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:var(--tb-accent,#3f6fd9);transition:width .2s"></div></div>'
    }

    // 配额窗口卡片（统一模型：label + 剩余 pill + 进度条 + 重置时间）
    const windowCard = (w) => {
      const remaining = Math.max(0, (w.total || 0) - (w.used || 0))
      return '<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">' + esc(w.label) + '</span>' +
        '<div class="tb-row"><span class="tb-pill tb-pill-' + levelOf(remaining, w.total) + '">剩 ' + fmtNum(remaining) + '</span>' +
        '<span class="tb-note">已用 ' + fmtNum(w.used) + ' / ' + fmtNum(w.total) + '</span></div>' +
        '<div class="tb-row">' + bar(w.used, w.total) + '</div>' +
        '<div class="tb-note">重置：' + esc(fmtTime(w.resetTime)) + '（本地）</div>' +
      '</div></div>'
    }

    const LEVEL_LABEL = { LEVEL_ADVANCED: '高级版', LEVEL_BASIC: '基础版', LEVEL_FREE: '免费版' }

    const render = (st) => {
      const p = providerOf(st.provider)
      const d = st.data
      // Tab 角标：第一窗口剩余量 / 余额总值
      let badge = ''
      if (d && Array.isArray(d.windows) && d.windows.length) badge = fmtNum(Math.max(0, (d.windows[0].total || 0) - (d.windows[0].used || 0)))
      else if (d && Array.isArray(d.balances) && d.balances.length) badge = fmtNum(d.balances[0].total)
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root" data-tab-badge="' + esc(badge) + '">')
      // 提供商选择芯片 + 刷新
      parts.push('<div class="tb-row">' +
        PROVIDERS.map((pv) => '<button type="button" class="tb-chip' + (pv.id === p.id ? ' tb-chip-on' : '') + '" data-action="pick" data-v="' + pv.id + '">' + esc(pv.label) + '</button>').join('') +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="query"' + (st.loading ? ' disabled' : '') + '>' + (st.loading ? '查询中…' : '刷新') + '</button>' +
      '</div>')
      parts.push('<div class="tb-row"><span class="tb-note">' + (p.credName ? '凭据键 ' + p.credName + '（' + p.credNote + '）' : '凭据键 ' + p.keyName + '（环境变量 / ~/.dsh/.credentials.yaml）') + '</span>' +
        (st.at ? '<span class="tb-note">更新于 ' + esc(st.at) + '</span>' : '') + '</div>')
      if (st.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(st.error) + '</div>')
      if (d) {
        if (d.plan) {
          parts.push('<div class="tb-pills"><span class="tb-pill tb-pill-active">' + esc(LEVEL_LABEL[d.plan] || d.plan) + '</span>' +
            (d.extra ? '<span class="tb-pill tb-pill-plain">' + esc(d.extra) + '</span>' : '') + '</div>')
        }
        if (Array.isArray(d.windows)) for (const w of d.windows) parts.push(windowCard(w))
        if (Array.isArray(d.balances)) {
          for (const b of d.balances) {
            parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">余额（' + esc(b.currency || '币种') + '）</span>' +
              '<div class="tb-row"><span class="tb-pill tb-pill-' + (b.total > 5 ? 'done' : b.total > 1 ? 'other' : 'warn') + '">总 ' + fmtNum(b.total) + '</span>' +
              '<span class="tb-note">赠送 ' + fmtNum(b.granted) + ' · 充值 ' + fmtNum(b.toppedUp) + '</span></div>' +
            '</div></div>')
          }
          parts.push('<div class="tb-note">账户状态：' + (d.available ? '可用' : '不可用（余额不足或已停用）') + '</div>')
        }
        if (!d.windows && !d.balances) parts.push('<div class="tb-notice">该提供商未返回配额窗口</div>')
        if (p.id === 'kimi') parts.push('<div class="tb-note">双层限流：周额度 + 滑动窗口，任一耗尽触发 429。额度查询本身不计模型 token。</div>')
      } else if (!st.error && !st.loading) {
        parts.push('<div class="tb-notice">点「刷新」查询 ' + esc(p.label) + ' 配额/余额</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { loading: false, error: null, data: null, at: null, provider: 'kimi' }
      if (!providerOf(st.provider).id || PROVIDERS.every((p) => p.id !== st.provider)) st.provider = 'kimi'
      const el = fields && fields.__el ? fields.__el : {}

      if (action === 'pick' && el.v) {
        // 切换提供商：清空旧数据并立即查询新提供商
        st.provider = String(el.v)
        st.data = null
        st.error = null
        action = 'query'
      }
      if (action === 'query' || (action === '' && !st.data && !st.error)) {
        st.loading = true
        const r = await runQuery(ws.root, st.provider)
        st.loading = false
        if (r && r.ok) {
          st.data = r.data
          st.error = null
          try { st.at = new Date().toTimeString().slice(0, 8) } catch (e) { st.at = '' }
        } else {
          st.error = (r && r.error) || '查询失败'
        }
      }
      return { ok: true, html: render(st), state: st }
    }

    tryRegisterTool(ctx, { id: 'quota', label: '配额', order: 25, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 11.5a6.5 6.5 0 0 1 11 0"/><path d="M8 6v2.5l2.5 1.5"/></svg>' }, handler)
  },
}

}

const create_selfview = () => {
// ===== selfview-tool.js：界面自查（Host+Client；Host 半）=====
// 给 deepseek-harness 当前 WebGUI 装「眼睛和手」：
//   截屏（getDisplayMedia 一次授权，流复用抓帧）/ 语义 DOM 快照 / 界面操作（点击/填充/滚动/按键）。
// Host 半职责：
//   1. 工具箱 Tab「界面」（状态/缩略图/操作日志/说明；按钮条由 Client 半注入真实按钮——授权与复制要用户激活）；
//   2. 命令队列（Host→Client 无推送通道：Client 长轮询 selfview/pull，挂起 25s 心跳；结果经 selfview/result 按 id 配对）；
//   3. 模型工具 ui_snapshot / ui_capture / ui_click / ui_fill / ui_scroll / ui_press（动态模式走 harness，静态模式适配到原生 tools 服务）。
// 截图 JPEG 落 <工作区>/.dsh-dynamic-toolbox/toolbox-selfview/shot-<ts>.jpg：subprocess stdin 批写二进制
// （求值器无 Buffer、fs.writeText 只 UTF-8、argv 有 32KB 上限——stdin 批写是唯一稳路）。
// state 只放 { notice }；缩略图/日志/最近截图元信息留闭包（state 轻量化，同 http/commitmsg 规矩）。

return {
  name: 'selfview-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }

    // ---- Client 在线状态 / 缩略图 / 日志（闭包） ----
    let clientSeenAt = 0
    let streamOn = false
    let lastThumb = null // { dataUrl, w, h, at }
    let lastShotPath = ''
    const logLines = []
    const log = (line) => { logLines.push(fmtClock(Date.now()) + ' ' + line); if (logLines.length > 40) logLines.shift() }

    // ---- 命令队列 + 结果配对 ----
    let seq = 0
    const queue = []      // 待取命令
    const waiters = []    // 挂起的 pull：[resolve]
    const pending = {}    // id -> resolve（工具调用等结果）

    const pushCmd = (cmd) => {
      if (waiters.length) waiters.shift()(cmd)
      else queue.push(cmd)
    }
    // RPC 返回必须是无损 JSON：剥掉 undefined 字段（如未传的 selector/maxLines），否则 cloneJson 拒收整条命令
    const cleanCmd = (o) => { const r = {}; for (const k of Object.keys(o)) if (o[k] !== undefined) r[k] = o[k]; return r }
    const sendToClient = (cmd, timeoutMs) => new Promise((resolve) => {
      const id = 'c' + (++seq)
      const timer = ctx.timeout(() => {
        if (pending[id]) {
          delete pending[id]
          resolve({ ok: false, error: 'Client 无响应（' + Math.round((timeoutMs || 12000) / 1000) + 's 超时）——界面插件的 Client 半在运行吗？浏览器标签页开着吗？' })
        }
      }, timeoutMs || 12000)
      pending[id] = (res) => { try { timer() } catch (e) {} delete pending[id]; resolve(res) }
      pushCmd(cleanCmd(Object.assign({ id }, cmd)))
    })

    ctx.effect(() => harness.handle('selfview/pull', async () => {
      clientSeenAt = Date.now()
      if (queue.length) return queue.shift()
      return await new Promise((resolve) => {
        const timer = ctx.timeout(() => {
          const i = waiters.indexOf(wrapped)
          if (i >= 0) waiters.splice(i, 1)
          resolve({ cmd: 'none' }) // 25s 心跳空转，Client 立刻重新 pull
        }, 25000)
        const wrapped = (cmd) => { try { timer() } catch (e) {} resolve(cmd) }
        waiters.push(wrapped)
      })
    }))

    ctx.effect(() => harness.handle('selfview/result', async (args) => {
      clientSeenAt = Date.now()
      const id = args && typeof args.id === 'string' ? args.id : ''
      const res = args && args.res && typeof args.res === 'object' ? args.res : { ok: false, error: '空结果' }
      const r = pending[id]
      if (r) r(res)
      // 截图结果顺带更新面板缩略图元信息（全量 b64 不进闭包——结果体可能 MB 级，用完即弃）
      if (res && res.ok && res.thumbB64) {
        lastThumb = { dataUrl: 'data:image/jpeg;base64,' + res.thumbB64, w: res.w || 0, h: res.h || 0, at: Date.now() }
      }
      return { ok: true }
    }))

    // Client 主动推送（状态/日志/缩略图）
    ctx.effect(() => harness.handle('selfview/push', async (args) => {
      clientSeenAt = Date.now()
      if (!args || typeof args !== 'object') return { ok: true }
      if (args.kind === 'state') {
        streamOn = Boolean(args.stream)
        if (typeof args.note === 'string' && args.note) log(args.note)
      } else if (args.kind === 'thumb' && typeof args.thumbB64 === 'string') {
        lastThumb = { dataUrl: 'data:image/jpeg;base64,' + args.thumbB64, w: args.w || 0, h: args.h || 0, at: Date.now() }
      } else if (args.kind === 'log' && typeof args.line === 'string') {
        log(args.line)
      }
      return { ok: true }
    }))

    // 停止时：唤醒全部挂起 pull / 工具等待者，Client 侧长轮询自行退出
    ctx.effect(() => () => {
      while (waiters.length) waiters.shift()({ cmd: 'stop' })
      for (const k of Object.keys(pending)) pending[k]({ ok: false, error: '界面插件已停止' })
      for (const k of Object.keys(pending)) delete pending[k]
    })

    // ---- 截图落盘（stdin 批写二进制） ----
    const saveJpg = async (b64) => {
      // 根目录与全工具箱一致走 findManifest（含 plugins.json 的仓库根，含一级子目录扫描）；
      // 数据目录名随 toolbox.config.json 的 dataDir；clone 部署时截图落本仓库，不污染宿主项目
      const found = await findManifest(ctx)
      const ws = found ? { root: found.root } : resolveWorkspace(ctx, null, null)
      if (!ws.root) return { ok: false, error: '无法确定工作区根目录' }
      const dataDir = await repoDataDir(ctx)
      const file = ws.root + '/' + dataDir + '/toolbox-selfview/shot-' + Date.now() + '.jpg'
      const sub = ctx.get('subprocess')
      if (!sub) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const handle = sub.spawn({
          argv: ['node', '-e', "let d='';process.stdin.on('data',(c)=>d+=c).on('end',()=>{const fs=require('fs');fs.mkdirSync(require('path').dirname(process.argv[1]),{recursive:true});fs.writeFileSync(process.argv[1],Buffer.from(d,'base64'))})", file],
          stdio: { stdin: { data: b64 }, stdout: { maxBytes: 512 }, stderr: { maxBytes: 2048 } },
          graceMs: 20000,
        })
        await handle.done
        lastShotPath = file
        log('截图已保存 ' + file)
        return { ok: true, path: file }
      } catch (e) {
        return { ok: false, error: '写文件失败: ' + String((e && e.message) || e) }
      }
    }

    // ---- 模型工具 ----
    // 动态注册必须经 harness.defineTool 归一化（guard 硬性校验：'dynamic tool registration
    // must use a tool returned by harness.defineTool'）；parameters 是字段描述格式（非裸 JSON Schema）
    const asText = (v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }]
    const objOut = {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (args, value) => asText(value && typeof value.text === 'string' ? value.text : value),
    }
    const reg = (def) => {
      try { return harness.registerTool(ctx, harness.defineTool(def)) } catch (e) { log('注册工具失败 ' + def.name + ': ' + String((e && e.message) || e)); return () => {} }
    }

    reg({
      name: 'ui_snapshot',
      description: '查看当前 deepseek-harness WebGUI 界面的语义结构：返回页面上可见可交互元素（按钮/输入框/链接/标签页等）的缩进大纲，每个元素带 [eN] 引用号。操作界面前先调用它拿引用号，再传给 ui_click/ui_fill 等工具。',
      parameters: {
        selector: { type: 'string', description: '可选 CSS 选择器，只看该子树（默认整个页面）' },
        maxLines: { type: 'number', description: '最大行数（默认 300）' },
      },
      output: objOut,
      timeoutMs: 20000,
      isConcurrencySafe: () => true,
      execute: async (args) => {
        const res = await sendToClient({ cmd: 'snapshot', selector: args && args.selector, maxLines: args && args.maxLines }, 12000)
        if (!res.ok) return { text: '快照失败：' + (res.error || '未知错误') }
        return { text: res.text || '（空页面）' }
      },
    })

    reg({
      name: 'ui_capture',
      description: '截取当前 deepseek-harness WebGUI 标签页的像素截图，保存为工作区文件。前提：用户已在 工具箱→界面 面板点过一次「开启截屏」授权（浏览器 getDisplayMedia 强制用户手势）；未授权时返回错误并提示用户去点。成功后用 read_image 工具查看返回的图片文件。',
      parameters: {},
      output: objOut,
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      execute: async () => {
        const res = await sendToClient({ cmd: 'capture' }, 15000)
        if (!res.ok) {
          if (res.error === 'no-stream') return { text: '截图失败：截屏未开启。请用户在 工具箱 →「界面」Tab 点一次「开启截屏」按钮完成浏览器授权（只需一次，之后流保持复用）。' }
          return { text: '截图失败：' + (res.error || '未知错误') }
        }
        const saved = await saveJpg(res.jpegB64)
        if (!saved.ok) return { text: saved.error }
        return { text: '已截图并保存：' + saved.path + '（' + (res.w || '?') + '×' + (res.h || '?') + '，约 ' + Math.round((res.jpegB64.length * 3 / 4) / 1024) + ' KB）。\n下一步：调用 read_image 读取该文件即可看到界面内容。' }
      },
    })

    const refOrSelector = {
      ref: { type: 'string', description: 'ui_snapshot 返回的引用号（如 "e12"），优先' },
      selector: { type: 'string', description: 'CSS 选择器兜底（无 ref 时用）' },
    }
    reg({
      name: 'ui_click',
      description: '点击当前 WebGUI 界面上的一个元素（按钮/链接/Tab 等）。先用 ui_snapshot 拿 ref。疑似破坏性操作（删除/清空/结束进程等文案）默认拒绝，确需执行传 allowDangerous=true。',
      parameters: Object.assign({}, refOrSelector, {
        allowDangerous: { type: 'boolean', description: '允许点击疑似破坏性按钮（默认 false 拒绝）' },
      }),
      output: objOut,
      timeoutMs: 20000,
      execute: async (args) => {
        const res = await sendToClient({ cmd: 'act', action: 'click', ref: args && args.ref, selector: args && args.selector, allowDangerous: Boolean(args && args.allowDangerous) }, 12000)
        return { text: res.ok ? ('已点击 ' + (res.detail || '')) : ('点击失败：' + (res.error || '未知错误')) }
      },
    })

    reg({
      name: 'ui_fill',
      description: '在当前 WebGUI 界面的输入框/文本域/下拉框中填入文本（React 受控组件安全：原生 setter + input/change 事件）。先用 ui_snapshot 拿 ref。',
      parameters: Object.assign({}, refOrSelector, {
        text: { type: 'string', required: true, description: '要填入的文本' },
      }),
      output: objOut,
      timeoutMs: 20000,
      execute: async (args) => {
        const res = await sendToClient({ cmd: 'act', action: 'fill', ref: args && args.ref, selector: args && args.selector, text: args && args.text }, 12000)
        return { text: res.ok ? ('已填充 ' + (res.detail || '')) : ('填充失败：' + (res.error || '未知错误')) }
      },
    })

    reg({
      name: 'ui_scroll',
      description: '滚动当前 WebGUI 页面或某个可滚动元素。',
      parameters: {
        selector: { type: 'string', description: '可选；不给则滚动整个页面' },
        dx: { type: 'number', description: '横向像素（默认 0）' },
        dy: { type: 'number', description: '纵向像素（默认 600，负值向上）' },
      },
      output: objOut,
      timeoutMs: 20000,
      execute: async (args) => {
        const res = await sendToClient({ cmd: 'act', action: 'scroll', selector: args && args.selector, dx: args && args.dx, dy: args && args.dy }, 12000)
        return { text: res.ok ? ('已滚动 ' + (res.detail || '')) : ('滚动失败：' + (res.error || '未知错误')) }
      },
    })

    reg({
      name: 'ui_press',
      description: '在当前 WebGUI 界面的焦点元素（或指定元素）上按一个键（如 Enter/Escape/Tab/ArrowDown）。',
      parameters: {
        key: { type: 'string', required: true, description: 'KeyboardEvent.key 值，如 "Enter"' },
        selector: { type: 'string', description: '可选目标元素 CSS 选择器（默认当前焦点元素）' },
      },
      output: objOut,
      timeoutMs: 20000,
      execute: async (args) => {
        const res = await sendToClient({ cmd: 'act', action: 'press', key: args && args.key, selector: args && args.selector }, 12000)
        return { text: res.ok ? ('已按键 ' + (res.detail || '')) : ('按键失败：' + (res.error || '未知错误')) }
      },
    })

    // ---- 工具箱 Tab ----
    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">截屏控制（按钮由 Client 半注入——授权/复制必须真实用户点击，面板 HTML 按钮做不到）</span>' +
        '<div data-selfview-mount="1"><span class="tb-note">界面 Client 半未连接或未注入按钮条…（确认 selfview 插件已启动、浏览器标签页在前台）</span></div></div>')
      const clientLive = clientSeenAt && (Date.now() - clientSeenAt < 30000)
      parts.push('<div class="tb-row">' +
        '<span class="tb-pill ' + (clientLive ? 'tb-pill-done' : 'tb-pill-todo') + '">Client ' + (clientLive ? '在线' : '离线') + '</span>' +
        '<span class="tb-pill ' + (streamOn ? 'tb-pill-active' : 'tb-pill-todo') + '">截屏流 ' + (streamOn ? '共享中' : '未开启') + '</span>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button>' +
        (lastShotPath ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="open-dir-note">截图目录</button>' : '') +
        (logLines.length ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear-log">清日志</button>' : '') +
        '</div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      if (lastThumb) {
        parts.push('<div class="tb-preview"><div class="tb-preview-head"><span class="tb-preview-name">最近截图 ' + lastThumb.w + '×' + lastThumb.h + ' · ' + fmtClock(lastThumb.at) + '</span></div>' +
          '<img class="tb-preview-img" src="' + lastThumb.dataUrl + '" alt="最近截图缩略图" /></div>')
      }
      if (logLines.length) {
        parts.push('<div class="tb-sec"><span class="tb-sec-label">操作日志（最近 ' + logLines.length + ' 条）</span><pre class="tb-code">' + esc(logLines.slice().reverse().join('\n')) + '</pre></div>')
      }
      parts.push('<div class="tb-notice">模型工具：ui_snapshot 看界面结构 → ui_click / ui_fill / ui_scroll / ui_press 操作；ui_capture 截像素图（先点「开启截屏」授权一次）。截图存 .dsh-dynamic-toolbox/toolbox-selfview/，模型经 read_image 查看。</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, state }) => {
      const st = (state && typeof state === 'object' && state) ? state : { notice: null }
      if (action === 'clear-log') { logLines.length = 0; st.notice = null }
      else if (action === 'open-dir-note') { st.notice = '截图目录：' + (lastShotPath ? lastShotPath.replace(/[\\/][^\\/]+$/, '') : '(还没有截图)') }
      else if (action === '') { st.notice = null }
      return { ok: true, html: render(st), state: st }
    }

    tryRegisterTool(ctx, { id: 'selfview', label: '界面', order: 24, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z"/><circle cx="8" cy="8" r="1.7"/></svg>' }, handler)
  },
}

}

// Remote 使用标准装饰器的运行时标记；生成代码是普通 JS，因此显式执行 decorator initializer。
const exposeRemote = (klass, method, exportName) => {
  const initializers = []
  Remote(exportName || method)(klass.prototype[method], {
    private: false, static: false, name: method,
    addInitializer(fn) { initializers.push(fn) },
  })
  const marker = Object.create(klass.prototype)
  for (const init of initializers) init.call(marker)
}

class NativeToolboxRemote extends TypertRemoteService {
  constructor(ctx, registry) {
    super(ctx, "toolboxNativeDynamicToolbox", { namespace: "toolboxNativeDynamicToolbox" })
    this.registry = registry
  }
  tools(request) {
    const root = request && typeof request.root === 'string' ? request.root : undefined
    return { ok: true, root: root || null, tools: this.registry.tools() }
  }
  panel(request) {
    const root = request && typeof request.root === 'string' ? request.root : undefined
    return this.registry.panel(root, request || {})
  }
  plugins(request) {
    void request
    return { ok: true, plugins: [], capabilities: TOOLBOX_RUNTIME.capabilities }
  }
  async sessionInfo(request) {
    const sid = request && typeof request.session === 'string' ? request.session : ''
    if (!sid) return { ok: false, error: '缺少会话 id' }
    const sessions = this.ctx.get('sessions')
    if (sessions && typeof sessions.get === 'function') {
      try {
        const session = sessions.get(sid)
        const cwd = session && session.header && session.header.cwd
        if (typeof cwd === 'string' && cwd) return { ok: true, cwd }
      } catch (error) {}
    }
    const query = this.ctx.get('sessionQuery')
    if (query && typeof query.listSessions === 'function') {
      try {
        const rows = await query.listSessions()
        const hit = (rows || []).find((row) => row && row.id === sid)
        const cwd = hit && hit.header && hit.header.cwd
        if (typeof cwd === 'string' && cwd) return { ok: true, cwd }
      } catch (error) {}
    }
    return { ok: false, error: '会话不存在或不可读: ' + sid }
  }
  selfviewPull(request) {
    return callNativeBridge("selfview/pull", request || {})
  }
  selfviewResult(request) {
    return callNativeBridge("selfview/result", request || {})
  }
  selfviewPush(request) {
    return callNativeBridge("selfview/push", request || {})
  }
}
for (const method of ["tools","panel","plugins","sessionInfo","selfviewPull","selfviewResult","selfviewPush"]) exposeRemote(NativeToolboxRemote, method)

export async function apply(ctx) {
  const registry = makeStaticRegistry()
  ctx.provide(TOOLBOX_RUNTIME.registryService, registry)
  const features = [create_jira(), create_git(), create_files(), create_flow(), create_flowedit(), create_trace(), create_http(), create_ports(), create_calc(), create_usage(), create_prompt(), create_context(), create_aiassist(), create_tools(), create_search(), create_lineage(), create_aiusage(), create_quota(), create_selfview()]
  for (const feature of features) {
    if (!feature || typeof feature.apply !== 'function') throw new Error('静态 feature 未返回有效插件对象')
    const disposer = await feature.apply(ctx)
    if (typeof disposer === 'function') ctx.effect(() => disposer)
  }
  new NativeToolboxRemote(ctx, registry)
  console.log(TOOLBOX_RUNTIME.logTag() + ' 原生静态 Host 已加载（功能: ' + registry.tools().map((x) => x.id).join(', ') + '）')
}
