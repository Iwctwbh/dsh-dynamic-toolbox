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
  ctx.on('agent/session-start', (payload) => {
    const agent = payload && payload.agent
    bootstrap(ctx, agent).catch((e) =>
      console.warn('[toolbox-bootstrap] ' + String((e && e.message) || e)))
  })
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

  // 幂等：本会话已定义同名框架插件（含被停掉的）→ 跳过，启停交给抽屉/Cordis 面板
  let payload
  try {
    payload = JSON.parse(await fs.readText(await fs.resolve(PAYLOAD, { cwd: root })))
  } catch (e) { return }
  for (const row of runner.inventory()) {
    if (row.agentId !== sid) continue
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
    sessionId: sid,
    plugin: payload.plugin,
    name: payload.name,
    purpose: payload.purpose,
    code: payload.code,
  })
  const res = await runner.run(agent, rec.pluginId, rec.packageId, 'run')
  if (res && res.ok) {
    console.log('[toolbox-bootstrap] toolbox ' +
      (res.status === 'awaiting-approval' ? '等待批准（点一次允许即完成重建）' : '已启动') +
      ' · session ' + sid)
  } else {
    console.warn('[toolbox-bootstrap] run 失败: ' + String((res && (res.message || res.reason)) || 'unknown'))
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
