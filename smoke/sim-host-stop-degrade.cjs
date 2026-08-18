// toolbox host.js 停止降级仿真（rc.7 改造 16.4）：runner 缺 stopFromPanel 时——
// ① toolbox/plugins 仍可用且行携带 canStop=false；
// ② 停止路径（plugin-toggle 停 / plugin-toggle-all 停）返回明确错误而非 "is not a function"；
// ③ 启动路径（plugin-toggle 启）不受影响；
// ④ 工具浏览与普通面板（toolbox/tools、toolbox/panel）不受影响。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

const rpc = {}
const harness = { handle(name, fn) { rpc[name] = fn; return () => {} } }

const MANIFEST = JSON.stringify({
  plugins: [
    { id: 'toolbox', name: '工具箱框架 (Host 注册表 + Client 面板壳)', autoStart: true },
    { id: 'a', name: 'A', autoStart: true },
    { id: 'b', name: 'B', autoStart: true },
  ],
})
const REPO_FILES = new Set(['W/plugins.json'])
const fsStub = {
  resolve: (p, opts) => (opts && (opts.cwd || opts.cwd === '') ? opts.cwd : 'W') + '/' + p,
  stat: async (t) => (REPO_FILES.has(String(t)) ? {} : undefined),
  listDir: async () => [],
  readText: async () => MANIFEST,
}
const calls = []
// 关键：runner 没有 stopFromPanel（模拟未来版本删除/改名）
const runner = {
  inventory() {
    return [
      { pluginId: 'p1', agentId: 's1', activeRun: { pluginRunId: 'r1' }, packages: [{ packageId: 'k1', name: 'A', hasClientHalf: false }], currentPackageId: 'k1' },
      { pluginId: 'p2', agentId: 's1', activeRun: null, packages: [{ packageId: 'k2', name: 'B', hasClientHalf: false }], currentPackageId: 'k2' },
    ]
  },
  async run(agent, pluginId, pkg, mode) { calls.push(['run', pluginId, pkg, mode]); return { ok: true } },
  define() { throw new Error('sim 不应走到 define') },
}
const agents = { get: (id) => (id === 's1' ? { id: 's1' } : undefined), currentInitiator: () => undefined }
const provided = {}
const ctx = {
  get(name) {
    if (name === 'toolboxRegistry') return provided.toolboxRegistry
    if (name === 'dynamicCordisRunner') return runner
    if (name === 'agents') return agents
    if (name === 'fs') return fsStub
    if (name === 'sandboxPolicy') return { workspaceRoot: 'W' }
    if (name === 'sessions') return { get: (id) => (id === 's1' ? { header: { id: 's1', cwd: 'W' } } : undefined), list: () => [{ header: { cwd: 'W' } }] }
    return undefined
  },
  provide(name, value) { provided[name] = value },
  on() {},
  effect(fn) { try { fn() } catch (e) {} return () => {} },
  timeout(fn, ms) { const t = setTimeout(fn, ms); t.unref && t.unref(); return () => clearTimeout(t) },
  interval() { return () => {} },
}

;(async () => {
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + read('plugins/toolbox/host.js') + '\n})()')(ctx, harness, console)
  await plugin.apply(ctx)
  await new Promise((r) => setTimeout(r, 50)) // 启动自举 IIFE 走完（无发起者 → 安静退出）

  const reg = provided.toolboxRegistry
  reg.register({ id: 'demo', label: '演示', order: 1 }, async () => ({ html: '<b>D</b>' }))

  // ④ 工具/面板不受影响
  const toolsRes = await rpc['toolbox/tools']({ cwd: 'W' })
  check('toolbox/tools 仍可用', toolsRes.ok === true && toolsRes.tools.some((t) => t.id === 'demo'), JSON.stringify(toolsRes.tools))
  const panelRes = await rpc['toolbox/panel']({ cwd: 'W', tool: 'demo', action: '' })
  check('toolbox/panel 仍可用', panelRes.ok === true && panelRes.html === '<b>D</b>')

  // ① 清单仍可用且行携带 canStop=false
  const pl = await rpc['toolbox/plugins']({ cwd: 'W', session: 's1' })
  check('toolbox/plugins 仍可用', pl.ok === true && Array.isArray(pl.plugins) && pl.plugins.length === 2, pl.ok ? ('count=' + pl.plugins.length) : pl.error)
  check('清单行 canStop=false（能力标记降级）', pl.plugins.every((r) => r.canStop === false))

  // ② 停止路径：明确错误（不是 is not a function）
  const stopOne = await rpc['toolbox/plugin-toggle']({ cwd: 'W', session: 's1', pluginId: 'p1', enable: false })
  check('单停返回明确能力错误', stopOne.ok === false && /stopFromPanel/.test(stopOne.error), stopOne.error)
  const stopAll = await rpc['toolbox/plugin-toggle-all']({ cwd: 'W', session: 's1', enable: false })
  check('批停返回明确能力错误', stopAll.ok === false && /stopFromPanel/.test(stopAll.error), stopAll.error)

  // ③ 启动路径不受影响
  calls.length = 0
  const startOne = await rpc['toolbox/plugin-toggle']({ cwd: 'W', session: 's1', pluginId: 'p2', enable: true })
  check('启动路径不受降级影响', startOne.ok === true && calls.length === 1 && calls[0][0] === 'run' && calls[0][1] === 'p2', JSON.stringify(startOne))

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
