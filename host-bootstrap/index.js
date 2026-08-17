// dsh-toolbox-bootstrap（host 面静态插件）：会话启动时自动 define+run 工具箱框架。
// 只消费进程级全局服务（dynamicCordisRunner/fs/agents/userQuestions/timer），不发布任何服务；
// 动态插件的会话归属不变——define 的 sessionId 就是当前会话，与模型工具路径完全同构。
//
// 效果：在含本仓库的工作区打开会话（任何模式）→ 首次弹出询问（记住/仅本次/别再问）→
// 之后按偏好自动 define+run → 批准卡点一次允许 → 框架 doRebuild 并行补齐其余插件。
// 问不了（无 UI provider / 超时无人答）时默认自举；只有用户主动取消询问才跳过本轮。
// 全程 0 模型调用、1 次批准点击（Client 半每进程至少批一次是浏览器代码执行的安全闸门，不可免除）。
//
// 挂载方式见 REBUILD.md「零模型调用自举」：host-bootstrap/install.ps1 一键安装。

const MARKER = 'plugins.json' // 仓库标记（与桩/findManifest 同约定）
const PAYLOAD = 'plugins/toolbox/payload.json' // 框架 define 参数（完整 JSON）
const MEMORY = '.dsh-dynamic-toolbox/toolbox-plugins.json' // 启停记忆
const PREF = '.dsh-dynamic-toolbox/toolbox-bootstrap.json' // 自举偏好（首次询问后落盘）
const ASK_TIMEOUT_MS = 120000 // 询问挂起上限（无页面接入的会话不阻塞自举）

const OPT_ALWAYS = '自动重建（记住，以后免问）'
const OPT_ONCE = '仅本次重建'
const OPT_NEVER = '不重建，以后别再问'

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
    has(root) { return root ? tables.has(root) : false },
    roots() { return [...tables.keys()] },
  }
}

async function bootstrap(ctx, agent) {
  const runner = ctx.get('dynamicCordisRunner')
  const fs = ctx.get('fs')
  if (!runner || !fs || !agent) return
  // 只服务根会话：子代理/工作流子会话不挂工具箱（否则每个 subagent 都弹卡）
  // （userQuestions 也只允许 runtime root 提问，owned child 会阻塞/被拒）
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

  // 首次询问：无偏好记录时先问用户（always 直达；never 跳过；仅本次不留痕、下次再问）。
  // 问不了（无 UI provider / 超时无人答）→ 默认自举；仅「主动取消询问」跳过本轮。
  const pref = await readPref(fs, root)
  if (pref && pref.auto === 'never') return
  if (!pref || pref.auto !== 'always') {
    const uq = ctx.get('userQuestions')
    if (!uq || typeof uq.ask !== 'function') {
      console.log('[toolbox-bootstrap] 无 UI provider 无法询问，默认自举（要关闭写 ' + PREF + ' → {"auto":"never"}）')
    } else {
      const pick = await askUser(ctx, uq, agent, root)
      if (pick === '__CANCELLED__') return // 用户主动取消：尊重，本轮不重建，下次再问
      if (pick === OPT_NEVER) { await writePref(fs, root, 'never'); return }
      if (pick === OPT_ALWAYS) await writePref(fs, root, 'always')
      // OPT_ONCE / 超时 / 自定义回答：按「仅本次」处理，继续自举
    }
  }

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

// 宿主垫片 agent：注册进 agents 服务（不产生真实会话/不触发 agent/session-start）。
// 只实现 runner/网关会碰到的面：id、session.header、steer/inject（no-op，通知静默丢弃）。
async function ensureHostAgent(ctx, hostId, root) {
  const agents = ctx.get('agents')
  if (!agents) return null
  if (typeof agents.get === 'function') {
    const existing = agents.get(hostId)
    if (existing) return existing
  }
  const stub = {
    id: hostId,
    session: { header: { id: hostId, cwd: root } },
    steer() {},
    inject() {},
  }
  if (typeof agents.register !== 'function') return null
  try {
    agents.register(stub)
    return stub
  } catch (e) {
    console.warn('[toolbox-bootstrap] 宿主垫片注册失败: ' + String((e && e.message) || e))
    return null
  }
}

// 返回选中的 label；'__CANCELLED__'=用户主动取消；''=超时（按默认自举处理）
async function askUser(ctx, uq, agent, root) {
  const req = {
    agent,
    questions: [{
      id: 'toolbox-bootstrap',
      header: '工具箱自举',
      question: '当前工作区包含 dsh-dynamic-toolbox（' + root + '）。要自动重建工具箱吗？',
      detail: '重建 = define+run 框架插件（含 Client 半，随后还有 1 次浏览器批准点击），框架启动后自动补齐其余插件。',
      options: [
        { label: OPT_ALWAYS, description: '写入偏好文件，今后本仓库任何会话启动即自动重建' },
        { label: OPT_ONCE, description: '只重建这一次，下次打开会话再问' },
        { label: OPT_NEVER, description: '写入偏好文件，不再自动重建（删偏好文件可恢复询问）' },
      ],
    }],
  }
  try {
    // 超时兜底：无页面接入的会话里问题无人回答，不能永远挂住本 fiber
    const timer = ctx.get('timer')
    const ans = (timer && typeof timer.timeout === 'function')
      ? await Promise.race([uq.ask(req), timer.timeout(ASK_TIMEOUT_MS).then(() => null)])
      : await uq.ask(req)
    if (!ans) { console.warn('[toolbox-bootstrap] 询问超时未回答，默认自举'); return '' }
    const item = Array.isArray(ans.answers) && ans.answers.find((a) => a && a.id === 'toolbox-bootstrap')
    return (item && item.selected && item.selected[0]) || ''
  } catch (e) {
    console.warn('[toolbox-bootstrap] 询问被取消，本轮跳过: ' + String((e && e.message) || e))
    return '__CANCELLED__'
  }
}

async function readPref(fs, root) {
  try {
    const t = await fs.resolve(PREF, { cwd: root })
    if (await fs.stat(t)) return JSON.parse(await fs.readText(t))
  } catch (e) {}
  return null
}

async function writePref(fs, root, auto) {
  try {
    const t = await fs.resolve(PREF, { cwd: root })
    await fs.writeText(t, JSON.stringify({ auto, at: new Date().toISOString() }, null, 2) + '\n')
    console.log('[toolbox-bootstrap] 偏好已落盘 ' + PREF + ' → auto=' + auto)
  } catch (e) {
    console.warn('[toolbox-bootstrap] 偏好落盘失败（下次开会话会再询问）: ' + String((e && e.message) || e))
  }
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
