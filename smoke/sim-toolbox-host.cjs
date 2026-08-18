// toolbox host.js 仿真（v6.3 multiplex）：mock dynamicCordisRunner/agents/fs/harness，验证：
// ①两次 apply（两个仓库框架）→ 第一份 provide 全局注册表，第二份复用；myRoot 仲裁各占一个仓库；
// ②tools/panel 按 root 路由（不同 root 各自表，跨 root 调未注册工具报错）；
// ③管理 RPC 按仓库归属过滤（isRepoRow 清单命中 + owner 校验）且按 cwd/root 解析目标仓库；
// ④build 上下文（beginBuild/endBuild）把注册归入指定 root；agentFor 兜底非 live 会话；
// ⑤双仓库同 Package name 隔离（W3 = W 的另一份 clone）：清单同名也不串行，跨仓库操作被拒，
//   启停记忆各写各的仓库。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// hostIdOf 同算法（plugins/toolbox/host.js 与 host-bootstrap/index.js 同源）：
// 仿真里为 fixture 行生成真实的 bootstrap 宿主 owner id
const pathHash = (s) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}
const canonicalRoot = (root) => {
  let s = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[a-zA-Z]:/.test(s) || s.indexOf('//') === 0) s = s.toLowerCase()
  return s
}
const hostIdOf = (root) => {
  const canon = canonicalRoot(root)
  const norm = canon.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  const prefix = norm.slice(-24)
  return 'toolbox-host-' + (prefix ? prefix + '-' : '') + pathHash(canon)
}
const HOST_W2 = hostIdOf('W2')
const HOST_W3 = hostIdOf('W3')

const rpc = {}
const harness = { handle(name, fn) { rpc[name] = fn } }

const calls = []
// 两个仓库的 plugins.json（真实结构：顶层 { plugins: [...] }，含 id:'toolbox' 强标记）
const MANIFEST_W = JSON.stringify({
  plugins: [
    { id: 'toolbox', name: '工具箱框架 (Host 注册表 + Client 面板壳)', autoStart: true },
    { id: 'a', name: 'A', autoStart: true },
    { id: 'b', name: 'B', autoStart: true },
    { id: 'e', name: 'E', autoStart: true },
    { id: 'f', name: 'F', autoStart: true },
  ],
})
const MANIFEST_W2 = JSON.stringify({
  plugins: [
    { id: 'toolbox', name: '工具箱框架 (Host 注册表 + Client 面板壳)', autoStart: true },
    { id: 'g2', name: 'G2', autoStart: true },
  ],
})
const manifestOf = (root) => (root === 'W2' ? MANIFEST_W2 : MANIFEST_W) // W3 是 W 的另一份 clone：清单与 W 完全同名
// 真实形态：W 根无 plugins.json（仓库在子目录 W/repo，clone 部署）；W2 根即仓库；W3 = W 的 clone
const REPO_FILES = new Set(['W/repo/plugins.json', 'W2/plugins.json', 'W3/plugins.json'])
// 状态化落盘：writeConfig 经 subprocess `node -e` 写文件 → 这里截获 argv，readText/stat 可见
const writtenFiles = new Map()
const fsStub = {
  resolve: (p, opts) => (opts && (opts.cwd || opts.cwd === '') ? opts.cwd : 'W') + '/' + p,
  stat: async (t) => (REPO_FILES.has(String(t)) || writtenFiles.has(String(t)) ? {} : undefined),
  listDir: async (t) => {
    const base = String(t).replace(/\/\.$/, '')
    return base === 'W' ? [{ name: 'repo', type: 'directory' }] : []
  },
  readText: async (t) => writtenFiles.has(String(t)) ? writtenFiles.get(String(t)) : manifestOf(String(t).replace(/\/plugins\.json$/, '')),
}
const subprocessStub = {
  spawn(spec) {
    // argv: [node, -e, <script>, <path>, <content>]
    const argv = (spec && spec.argv) || []
    if (argv[1] === '-e' && argv.length >= 5) writtenFiles.set(argv[3], argv[4])
    return { done: Promise.resolve({ exitCode: 0 }) }
  },
}
const runner = {
  inventory() {
    return [
      { pluginId: 'p1', agentId: 's1', activeRun: { pluginRunId: 'r1' }, packages: [{ packageId: 'k1', name: 'A', hasClientHalf: false }], currentPackageId: 'k1' },
      { pluginId: 'p2', agentId: 's1', activeRun: null, packages: [{ packageId: 'k2', name: 'B', hasClientHalf: false }], currentPackageId: 'k2' },
      { pluginId: 'p3', agentId: 's1', activeRun: { pluginRunId: 'r3' }, packages: [{ packageId: 'k3', name: 'C', hasClientHalf: true }], currentPackageId: 'k3' }, // 不在清单（其他仓库）
      { pluginId: 'p4', agentId: HOST_W2, activeRun: { pluginRunId: 'r4' }, packages: [{ packageId: 'k4', name: 'G2', hasClientHalf: false }], currentPackageId: 'k4' }, // 仓库 W2（bootstrap 宿主行）
      { pluginId: 'p5', agentId: 's1', activeRun: { pluginRunId: 'r5' }, packages: [{ packageId: 'k5', name: 'E', hasClientHalf: false }], currentPackageId: 'k5' }, // run 失败
      { pluginId: 'p6', agentId: 's1', activeRun: null, packages: [{ packageId: 'k6', name: 'F', hasClientHalf: false }] }, // 被抑制：只 define 未 run，指针皆空
      { pluginId: 'p7', agentId: HOST_W3, activeRun: { pluginRunId: 'r7' }, packages: [{ packageId: 'k7', name: 'A', hasClientHalf: false }], currentPackageId: 'k7' }, // 仓库 W3（与 W 的 A 同名）
      { pluginId: 'p8', agentId: HOST_W3, activeRun: null, packages: [{ packageId: 'k8', name: 'B', hasClientHalf: false }], currentPackageId: 'k8' }, // 仓库 W3（与 W 的 B 同名）
    ]
  },
  async run(agent, pluginId, pkg, mode) {
    calls.push(['run', agent.id, pluginId, pkg, mode])
    if (pluginId === 'p5') return { ok: false, message: 'boom' }
    return { ok: true }
  },
  async stopFromPanel(agent, pluginId) { calls.push(['stop', agent.id, pluginId]); return { ok: true } },
  define() { throw new Error('sim 不应走到 define') },
}
const hostStub = { id: 'toolbox-host-abc', steer() {}, inject() {} }
const agents = {
  get: (id) => (id === 's1' ? { id: 's1' } : id === 'toolbox-host-abc' ? hostStub : undefined),
  currentInitiator: () => undefined,
}

// ctx：提供动态注册表跨 apply 共享（第一次 provide 存起来，第二次 get 到同一实例）
const provided = {}
const sessionsStub = {
  get: (id) => (id === 's1' ? { header: { id: 's1', cwd: 'W' } } : undefined),
  list: () => [
    { header: { cwd: 'W' } },
    { header: { cwd: 'W2' } },
  ],
}
const ctx = {
  get(name) {
    if (name === 'toolboxRegistry') return provided['toolboxRegistry']
    if (name === 'dynamicCordisRunner') return runner
    if (name === 'agents') return agents
    if (name === 'fs') return fsStub
    if (name === 'sandboxPolicy') return { workspaceRoot: 'W' }
    if (name === 'sessions') return sessionsStub
    if (name === 'subprocess') return subprocessStub // 状态化落盘（启停记忆可写可读）
    return undefined
  },
  provide(name, value) { provided[name] = value },
  on() {},
  effect(fn) { try { fn() } catch (e) {} return () => {} },
  timeout(fn, ms) { const t = setTimeout(fn, ms); t.unref && t.unref(); return () => clearTimeout(t) },
  interval(fn) { return () => {} },
}

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

;(async () => {
  const load = async () => {
    const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + read('plugins/toolbox/host.js') + '\n})()')(ctx, harness, console)
    await plugin.apply(ctx)
  }
  await load() // 框架 1：提供全局注册表 + attach W
  await load() // 框架 2：复用注册表 + attach W2（W 已被占 → 仲裁取 W2）

  await new Promise((r) => setTimeout(r, 50)) // 让启动自举 IIFE 走完（无发起者 → 安静退出）

  const reg = provided['toolboxRegistry']
  check('全局注册表已提供', reg && typeof reg.register === 'function' && typeof reg.tools === 'function')
  // W 仓库的真实 root 是子目录 W/repo（clone 部署形态）；W2 根即仓库
  check('两个仓库都已 attach（各占其一）', reg.has('W/repo') && reg.has('W2'), JSON.stringify(reg.roots()))

  // 模拟工具注册（lastRoot 归向）：
  reg.register({ id: 'jira', label: 'Jira', order: 0 }, async () => ({ html: '<b>J</b>' })) // → lastRoot（W/repo，框架2后attach）
  await reg.runInBuild('W', async () => { reg.register({ id: 'git', label: 'Git', order: 1 }, async () => ({ html: '<b>G</b>' })) }) // → build root（W）
  reg.register({ id: 'usage', label: '用量', order: 2 }, async () => ({ html: '<u>U</u>' })) // → lastRoot（W/repo）

  const toolsW = reg.tools('W')
  const toolsW1 = reg.tools('W/repo')
  const toolsW2 = reg.tools('W2')
  check('tools(W) 含 git（build 上下文归 W）', JSON.stringify(toolsW.map((t) => t.id)) === JSON.stringify(['git']), JSON.stringify(toolsW))
  check('tools(W/repo) 含 jira/usage（lastRoot 归 W/repo）', toolsW1.map((t) => t.id).sort().join(',') === 'jira,usage', JSON.stringify(toolsW1))
  check('tools(W2) 无工具（未注册）', toolsW2.length === 0, JSON.stringify(toolsW2))

  const pW = await reg.panel('W', { tool: 'git', action: '' })
  const pW1 = await reg.panel('W/repo', { tool: 'jira', action: '' })
  const pCross = await reg.panel('W2', { tool: 'git', action: '' })
  check('panel 按 root 路由命中', pW.ok && pW.html === '<b>G</b>' && pW1.ok && pW1.html === '<b>J</b>')
  check('跨 root 调未注册工具 → 明确错误', pCross.ok === false && /未注册/.test(pCross.error), pCross.error)

  // —— build 互斥（评审 H2/H3 回归）：runInBuild 整个异步段持锁——段内 register 稳定归本 root，
  // 第二个 build 排队等第一个完全结束；锁外注册落 lastRoot ——
  await reg.runInBuild('W', async () => {
    reg.register({ id: 'm1', label: 'M1' }, async () => ({ html: 'm' }))
    await new Promise((r) => setTimeout(r, 5)) // 模拟异步段：锁内注册仍归 W
    reg.register({ id: 'm1b', label: 'M1b' }, async () => ({ html: 'm' }))
  })
  const pBuildW2 = reg.runInBuild('W2', async () => { reg.register({ id: 'm2', label: 'M2' }, async () => ({ html: 'm' })) }) // 排队
  reg.register({ id: 'm3', label: 'M3' }, async () => ({ html: 'm' })) // 锁外 → lastRoot
  await pBuildW2
  const tW = reg.tools('W').map((t) => t.id)
  const tW1 = reg.tools('W/repo').map((t) => t.id)
  const tW2 = reg.tools('W2').map((t) => t.id)
  check('build 互斥：锁内归 W、锁外归 lastRoot、排队段归 W2，不串表',
    tW.indexOf('m1') >= 0 && tW.indexOf('m1b') >= 0 && tW.indexOf('m2') < 0 && tW.indexOf('m3') < 0 &&
    tW1.indexOf('m3') >= 0 && tW1.indexOf('m2') < 0 &&
    tW2.indexOf('m2') >= 0 && tW2.indexOf('m1') < 0 && tW2.indexOf('m3') < 0,
    JSON.stringify({ W: tW, 'W/repo': tW1, W2: tW2 }))

  // —— 管理 RPC：toolbox/plugins 按 cwd 解析 root → 对应仓库的清单行 ——
  const plW = await rpc['toolbox/plugins']({ cwd: 'W' })
  check('plugins(cwd=W) 列 W 仓库行（p1/p2/p5/p6），不含 W2 行与 W3 同名行', plW.ok === true && JSON.stringify(plW.plugins.map((x) => x.pluginId)) === JSON.stringify(['p1', 'p2', 'p5', 'p6']), JSON.stringify(plW.plugins.map((x) => x.pluginId)))
  const plW2 = await rpc['toolbox/plugins']({ cwd: 'W2' })
  check('plugins(cwd=W2) 列 W2 仓库行（p4）', plW2.ok === true && JSON.stringify(plW2.plugins.map((x) => x.pluginId)) === JSON.stringify(['p4']), JSON.stringify(plW2.plugins.map((x) => x.pluginId)))

  // —— 管理操作的 agent 取「行归属会话」（runner.owned 按定义会话校验所有权）：
  // 调用方是 ghost/宿主垫片都不影响，run 的 agent 恒为行 agentId（p1 挂 s1）——
  calls.length = 0
  const rGhost = await rpc['toolbox/plugin-restart-all']({ cwd: 'W', session: 'ghost' })
  check('restart-all(cwd=W) 只重跑 p1（A 在清单，运行中），ghost 不报错', rGhost.ok === false && JSON.stringify(rGhost.done) === JSON.stringify(['p1']), JSON.stringify(rGhost.done))
  check('run 用行归属会话 agent（p1 → s1，非调用方 ghost）', calls.length > 0 && calls[0][1] === 's1', JSON.stringify(calls[0]))

  calls.length = 0
  await rpc['toolbox/plugin-restart-all']({ cwd: 'W', session: 'toolbox-host-abc' })
  check('调用方为宿主会话时 run 仍用行归属 agent（s1）', calls.length > 0 && calls[0][1] === 's1', JSON.stringify(calls[0]))

  // —— 被抑制插件（只 define 未 run，指针皆空）：toggle 启动回退行内最新 Package ——
  calls.length = 0
  const rSup = await rpc['toolbox/plugin-toggle']({ cwd: 'W', session: 's1', pluginId: 'p6', enable: true })
  check('被抑制插件 toggle 启动成功', rSup.ok === true && rSup.running === true, JSON.stringify(rSup))
  check('启动用行内最新 Package（k6）', calls.length === 1 && calls[0][3] === 'k6', JSON.stringify(calls[0]))

  // —— 启停记忆实时性：写盘后 defaultStart 立即变化（清单映射缓存必须失效）——
  const findRow = (pl, id) => pl.plugins.find((x) => x.pluginId === id)
  const pl0 = await rpc['toolbox/plugins']({ cwd: 'W', session: 's1' })
  check('defaultStart 初始取 autoStart（B=true）', findRow(pl0, 'p2').defaultStart === true, JSON.stringify(findRow(pl0, 'p2')))
  const rStop = await rpc['toolbox/plugin-toggle']({ cwd: 'W', session: 's1', pluginId: 'p2', enable: false })
  check('真停成功', rStop.ok === true, JSON.stringify(rStop))
  const pl1 = await rpc['toolbox/plugins']({ cwd: 'W', session: 's1' })
  check('真停后 defaultStart 随记忆变 false（缓存已失效）', findRow(pl1, 'p2').defaultStart === false, JSON.stringify(findRow(pl1, 'p2')))
  const rSet = await rpc['toolbox/plugin-set-default']({ cwd: 'W', session: 's1', pluginId: 'p1', enabled: false })
  check('plugin-set-default 写盘成功', rSet.ok === true, JSON.stringify(rSet))
  const pl2 = await rpc['toolbox/plugins']({ cwd: 'W', session: 's1' })
  check('set-default 后「重启后」pill 值立即翻转（A=false）', findRow(pl2, 'p1').defaultStart === false, JSON.stringify(findRow(pl2, 'p1')))

  // —— 双仓库同 Package name 隔离（评审回归）：W3 = W 的另一份 clone，清单名完全相同 ——
  const plW3 = await rpc['toolbox/plugins']({ cwd: 'W3' })
  check('plugins(cwd=W3) 只列 W3 行（p7/p8），不串入 W 的同名行',
    plW3.ok === true && JSON.stringify(plW3.plugins.map((x) => x.pluginId)) === JSON.stringify(['p7', 'p8']), JSON.stringify(plW3.plugins.map((x) => x.pluginId)))
  check('plugins(cwd=W) 排除异仓库同名行（owner 校验生效）',
    !plW.plugins.some((x) => x.pluginId === 'p7' || x.pluginId === 'p8'))

  const rCrossRepo = await rpc['toolbox/plugin-toggle']({ cwd: 'W', session: 's1', pluginId: 'p7', enable: false })
  check('跨仓库操作被拒（W 的管理动不了 W3 的 p7）', rCrossRepo.ok === false && /不属于当前仓库/.test(rCrossRepo.error), rCrossRepo.error)

  calls.length = 0
  const rAllW = await rpc['toolbox/plugin-toggle-all']({ cwd: 'W', session: 's1', enable: false })
  check('toggle-all(cwd=W) 不触碰 W3 同名行（p7/p8）', rAllW.ok === true && !calls.some((c) => c[2] === 'p7' || c[2] === 'p8'), JSON.stringify(calls))

  calls.length = 0
  const rT8 = await rpc['toolbox/plugin-toggle']({ cwd: 'W3', session: 's1', pluginId: 'p8', enable: true })
  check('W3 行 toggle 启动成功', rT8.ok === true && rT8.running === true, JSON.stringify(rT8))
  check('W3 行操作用其 owner 会话 agent', calls.some((c) => c[0] === 'run' && c[1] === HOST_W3 && c[2] === 'p8'), JSON.stringify(calls))
  check('启停记忆写入 W3 而非 W', writtenFiles.has('W3/.dsh-dynamic-toolbox/toolbox-plugins.json'), [...writtenFiles.keys()].join(' | '))

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })