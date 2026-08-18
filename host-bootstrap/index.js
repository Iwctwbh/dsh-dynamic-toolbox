// dsh-toolbox-bootstrap（host 面静态插件）：会话启动时自动 define+run 工具箱框架。
// 只消费进程级全局服务（dynamicCordisRunner/fs/agents），不发布任何服务；
// 动态插件的会话归属不变——define 的 sessionId 就是当前会话，与模型工具路径完全同构。
//
// 效果：在含本仓库的工作区打开会话（任何模式）→ 直接 define+run → 批准卡点一次允许 →
// 框架 doRebuild 并行补齐其余插件。同意权收敛到每进程一次的批准弹框（不归属任何会话）；
// 重启后同仓库多会话并发启动由进程级 single-flight 去重，不再每会话弹卡（v6.4 移除会话内询问）。
// 全程 0 模型调用、1 次批准点击（Client 半每进程至少批一次是浏览器代码执行的安全闸门，不可免除）。
//
// 挂载方式见 REBUILD.md「零模型调用自举」：host-bootstrap/install.ps1 一键安装。

const MARKER = 'plugins.json' // 仓库标记（与桩/findManifest 同约定）
const PAYLOAD = 'plugins/toolbox/payload.json' // 框架 define 参数（完整 JSON）
const MEMORY = '.dsh-dynamic-toolbox/toolbox-plugins.json' // 启停记忆
const PREF = '.dsh-dynamic-toolbox/toolbox-bootstrap.json' // 自举偏好（never=完全不自举；AI 手动重建询问也会写它）

export const name = 'dsh-toolbox-bootstrap'

export function apply(ctx) {
  // 全局 multiplex 注册表（v6.3）：由静态插件提供 → 进程级寿命，不随任何动态框架生死。
  // 零安装（未装本插件）时框架兜底 provide（见 plugins/toolbox/host.js 的 makeRegistry 分支）。
  if (!ctx.get('toolboxRegistry')) {
    try { ctx.provide('toolboxRegistry', makeRegistry()) } catch (e) {
      console.warn('[toolbox-bootstrap] 全局注册表提供失败: ' + String((e && e.message) || e))
    }
  }
  ctx.on('agent/session-start', (payload) => {
    const agent = payload && payload.agent
    bootstrap(ctx, agent).catch((e) =>
      console.warn('[toolbox-bootstrap] ' + String((e && e.message) || e)))
  })
}

// 与 plugins/toolbox/host.js 的 makeRegistry 保持同一契约（host.js 保留兜底分支）；
// root → 工具表；build 用锁式 runInBuild(root, fn)：整个异步段持锁，段内 register 归 root。
const makeRegistry = () => {
  const tables = new Map() // root -> Map<id, entry>
  let buildRoot = null
  let lastRoot = null
  let lock = Promise.resolve()
  const tableOf = (root) => {
    if (!root) return null
    let t = tables.get(root)
    if (!t) { t = new Map(); tables.set(root, t) }
    return t
  }
  const register = (desc, handler) => {
    if (!desc || typeof desc.id !== 'string' || !desc.id || typeof handler !== 'function') return () => {}
    const t = tableOf(buildRoot || lastRoot)
    if (!t) return () => {}
    const entry = { id: desc.id, label: desc.label || desc.id, order: typeof desc.order === 'number' ? desc.order : 0, handler }
    t.set(desc.id, entry)
    return () => { if (t.get(desc.id) === entry) t.delete(desc.id) }
  }
  return {
    attach(root) { if (!root) return; lastRoot = root; tableOf(root) },
    register,
    async runInBuild(root, fn) {
      const prev = lock
      let r
      lock = new Promise((res) => { r = res })
      await prev
      buildRoot = root || null
      try { return await fn() } finally { buildRoot = null; r() }
    },
    tools(root) {
      const t = tables.get(root || lastRoot) || new Map()
      return [...t.values()].sort((a, b) => a.order - b.order)
        .map((x) => ({ id: x.id, label: x.label, order: x.order }))
    },
    // 与 plugins/toolbox/host.js 的 makeRegistry 保持同一契约：全局 multiplex 注册表在
    // bootstrapper 首份 provide，框架复用——panel 缺失会让框架的 toolbox/panel RPC 报
    // "registry.panel is not a function"（v6.3 引全局注册表时漏抄的方法）。
    async panel(root, call) {
      const t = tables.get(root || lastRoot)
      const toolId = call && typeof call.tool === 'string' ? call.tool : ''
      const entry = t && t.get(toolId)
      if (!entry || !entry.handler) return { ok: false, error: '工具未注册或已停止: ' + (toolId || '(空)') }
      try {
        const res = await entry.handler({
          action: call && typeof call.action === 'string' ? call.action : '',
          fields: (call && call.fields && typeof call.fields === 'object') ? call.fields : {},
          state: (call && call.state) || null,
          root: (typeof root === 'string' && root) ? root : undefined,
          session: (call && typeof call.session === 'string' && call.session) ? call.session : undefined,
        })
        if (!res || typeof res.html !== 'string') return { ok: false, error: '工具返回了无效的面板内容' }
        const out = { ok: true, html: res.html, state: res.state == null ? null : res.state }
        if (typeof res.copy === 'string' && res.copy) out.copy = res.copy
        return out
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    },
    has(root) { return root ? tables.has(root) : false },
    roots() { return [...tables.keys()] },
  }
}

// 进程级 single-flight（v6.4）：DSH 重启后 GUI 常并发恢复同仓库多个根会话，每个都触发
// session-start；整个自举流程（含批准请求）每 root 只跑一份，并发会话复用其结果，
// 避免重复 define / 重复批准弹框。流程结束后清表，之后的会话启动走常规幂等检查（静默跳过）。
const inflight = new Map() // root -> Promise

async function bootstrap(ctx, agent) {
  const runner = ctx.get('dynamicCordisRunner')
  const fs = ctx.get('fs')
  if (!runner || !fs || !agent) return
  // 显式能力检查：进程内 Service 方法不是 wire-level 稳定协议，后续版本若删除/改名，
  // 在自举中途以 "is not a function" 失败前，先给出一条明确的版本/能力错误。
  const requiredRunnerMethods = ['define', 'run', 'inventory']
  const missingRunnerMethods = requiredRunnerMethods.filter(
    (method) => typeof runner[method] !== 'function',
  )
  if (missingRunnerMethods.length) {
    throw new Error(
      '工具箱需要 DSH rc.7 动态运行接口，缺少：' + missingRunnerMethods.join(', '),
    )
  }
  // 只服务根会话：子代理/工作流子会话不挂工具箱（否则每个 subagent 都弹卡）
  const agents = ctx.get('agents')
  if (agents && typeof agents.roots === 'function') {
    try { if (agents.roots().indexOf(agent) < 0) return } catch (e) {}
  }
  const sid = agent.id
  if (typeof sid !== 'string' || !sid) return
  const cwd = agent.session && agent.session.header && agent.session.header.cwd
  if (typeof cwd !== 'string' || !cwd) return

  // 定位仓库：直下命中 plugins.json 优先，否则扫一级子目录（仓库 clone 为子目录的场景）
  const root = await findRepo(fs, cwd)
  if (!root) return

  const pending = inflight.get(root)
  if (pending) {
    console.log('[toolbox-bootstrap] 同仓库自举进行中，本会话复用其结果（' + root + '）')
    return pending
  }
  const run = bootstrapOnce(ctx, agent, runner, fs, root)
  run.then(() => inflight.delete(root), () => inflight.delete(root))
  inflight.set(root, run)
  return run
}

async function bootstrapOnce(ctx, agent, runner, fs, root) {
  // 启停记忆：用户上次把框架停掉 → 尊重，本轮不自举
  try {
    const mt = await fs.resolve(MEMORY, { cwd: root })
    if (await fs.stat(mt)) {
      const mem = JSON.parse(await fs.readText(mt))
      const rec = mem && mem.plugins && mem.plugins.toolbox
      if (rec && rec.enabled === false) return
    }
  } catch (e) {}

  // 注册表级幂等（v6.3 multiplex）：toolboxRegistry 是进程级全局服务（第一份 provide），
  // 但注册表按 root 分键——同仓库已有框架实例 → 跳过本会话自举（复用）；异仓库 → 照常自举
  // （各仓库各挂一份，互不冲突）。根未知时跳过更安全。
  const reg = ctx.get('toolboxRegistry')
  if (reg) {
    let sameRoot = false
    try { sameRoot = typeof reg.has === 'function' ? reg.has(root) : Boolean(reg.roots && reg.roots().indexOf(root) >= 0) } catch (e) {}
    if (sameRoot) {
      console.log('[toolbox-bootstrap] 检测到已运行的工具箱框架（' + root + '），本会话跳过自举（同仓库复用）')
      return
    }
  }

  // 幂等：本仓库（宿主）已定义同名框架插件（含被停掉的）→ 跳过，启停交给抽屉/Cordis 面板
  let payload
  try {
    payload = JSON.parse(await fs.readText(await fs.resolve(PAYLOAD, { cwd: root })))
  } catch (e) { return }

  // 自举宿主会话：define/run 归属一个固定宿主 id（每仓库一个，稳定跨会话；进程重启后随 agents/Dynamic
  // 插件一起消失，由本插件在下一次会话启动时重建）。宿主以「垫片 agent」注册进 agents 服务——
  // 满足 DSH 网关对 Remote 参数的 agent lookup（批准卡 runHostHalf / Cordis 面板操作都能解析到），
  // 而 runner 的完成/失败通知（agent.steer / agent.inject）打到垫片的 no-op 方法 → 用户会话零污染。
  const hostId = hostIdOf(root)
  const hostAgent = await ensureHostAgent(ctx, hostId, root)
  if (!hostAgent) { console.warn('[toolbox-bootstrap] 宿主垫片创建失败，跳过自举'); return }
  // 幂等只判本仓库宿主会话（评审阻断 1 修复）：两仓库框架同名时，第二仓库不得被第一仓库的行误判已定义
  for (const row of runner.inventory()) {
    if (row.agentId !== hostId) continue
    if (row.packages.some((p) => p && p.name === payload.name)) return
  }

  // 同意权（v6.4）：不在任何会话里弹询问卡（重启并发恢复多会话时会重复污染会话）；
  // 直接 define+run，用户同意收敛到每进程一次的批准弹框（Client 半安全闸门，不归属任何会话）。
  // 偏好文件仍生效：{"auto":"never"} → 完全不自举。
  const pref = await readPref(fs, root)
  if (pref && pref.auto === 'never') return

  const rec = runner.define({
    sessionId: hostId,
    plugin: payload.plugin,
    name: payload.name,
    purpose: payload.purpose,
    code: payload.code,
  })
  const res = await runner.run(hostAgent, rec.pluginId, rec.packageId, 'run')
  if (res && res.ok) {
    console.log('[toolbox-bootstrap] toolbox ' +
      (res.status === 'awaiting-approval' ? '等待批准（点一次允许即完成重建）' : '已启动') +
      ' · 宿主 ' + hostId)
  } else {
    console.warn('[toolbox-bootstrap] run 失败: ' + String((res && (res.message || res.reason)) || 'unknown'))
  }
}

// 每仓库一个稳定宿主会话 id（进程内唯一；仅字母数字与连字符，避免非 ASCII/分隔符问题）
function hostIdOf(root) {
  return 'toolbox-host-' + String(root).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 48)
}

// 宿主垫片 agent：进入 agents 服务（不产生真实会话/不触发 agent/session-start）。
// 用 agents.enter 而非 agents.register：DSH 新版的 register 会把 stub 作为 root agent
// announce（emit agent/created），agent-presets / schedule 等监听器访问 stub 缺失的
// agent.ctx 会同步抛错，打断注册→自举；enter 只插入 store、不 announce，正是垫片语义。
// 垫片对象仍需满足新契约 agent.id === agent.session.id（顶层 session.id，缺一不可）。
async function ensureHostAgent(ctx, hostId, root) {
  const agents = ctx.get('agents')
  if (!agents) return null
  if (typeof agents.get === 'function') {
    const existing = agents.get(hostId)
    if (existing) return existing
  }
  const stub = {
    id: hostId,
    session: { id: hostId, header: { id: hostId, cwd: root } },
    steer() {},
    inject() {},
  }
  // enter(agent, owner)：owner=undefined → 进程级 root（与"不产生真实会话"的垫片语义一致）。
  // 返回的 detach 不调用——stub 生命周期跟随本静态插件（进程）-级，进程退出即清空。
  if (typeof agents.enter === 'function') {
    try {
      agents.enter(stub, undefined)
      return stub
    } catch (e) {
      console.warn('[toolbox-bootstrap] 宿主垫片进入失败: ' + String((e && e.message) || e))
      return null
    }
  }
  // 旧 DSH 兜底（无 enter 时退回 register；旧版无 announce 同步抛错问题）
  if (typeof agents.register !== 'function') return null
  try {
    agents.register(stub)
    return stub
  } catch (e) {
    console.warn('[toolbox-bootstrap] 宿主垫片注册失败: ' + String((e && e.message) || e))
    return null
  }
}

async function readPref(fs, root) {
  try {
    const t = await fs.resolve(PREF, { cwd: root })
    if (await fs.stat(t)) return JSON.parse(await fs.readText(t))
  } catch (e) {}
  return null
}

async function findRepo(fs, cwd) {
  try {
    const t = await fs.resolve(MARKER, { cwd })
    if (await fs.stat(t)) return cwd
  } catch (e) {}
  try {
    const dt = await fs.resolve('.', { cwd })
    const entries = await fs.listDir(dt)
    for (const ent of entries || []) {
      if (!ent || ent.type !== 'directory' || !ent.name) continue
      if (ent.name.charAt(0) === '.' || ent.name === 'node_modules') continue
      const sub = cwd.replace(/[\\/]+$/, '') + '/' + ent.name
      try {
        const t = await fs.resolve(MARKER, { cwd: sub })
        if (await fs.stat(t)) return sub
      } catch (e) {}
    }
  } catch (e) {}
  return null
}
