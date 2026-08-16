// toolbox host.js 仿真：mock dynamicCordisRunner/agents/harness，验证「全部重跑」RPC 的
// 过滤语义（停着跳过/含 Client 半跳过/别会话跳过/失败收集）与 toggle-all 回归。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const rpc = {}
const harness = { handle(name, fn) { rpc[name] = fn } }

const calls = []
const runner = {
  inventory() {
    return [
      { pluginId: 'p1', agentId: 's1', activeRun: { pluginRunId: 'r1' }, packages: [{ packageId: 'k1', name: 'A', hasClientHalf: false }], currentPackageId: 'k1' },
      { pluginId: 'p2', agentId: 's1', activeRun: null, packages: [{ packageId: 'k2', name: 'B', hasClientHalf: false }], currentPackageId: 'k2' }, // 停着
      { pluginId: 'p3', agentId: 's1', activeRun: { pluginRunId: 'r3' }, packages: [{ packageId: 'k3', name: 'C', hasClientHalf: true }], currentPackageId: 'k3' }, // 含 Client 半
      { pluginId: 'p4', agentId: 'other', activeRun: { pluginRunId: 'r4' }, packages: [{ packageId: 'k4', name: 'D', hasClientHalf: false }], currentPackageId: 'k4' }, // 别会话
      { pluginId: 'p5', agentId: 's1', activeRun: { pluginRunId: 'r5' }, packages: [{ packageId: 'k5', name: 'E', hasClientHalf: false }], currentPackageId: 'k5' }, // run 失败
      { pluginId: 'p6', agentId: 's1', activeRun: null, packages: [{ packageId: 'k6', name: 'F', hasClientHalf: false }], currentPackageId: 'k6' }, // 停着且 run 失败
    ]
  },
  async run(agent, pluginId, pkg, mode) {
    calls.push(['run', pluginId, pkg, mode])
    if (pluginId === 'p5' || pluginId === 'p6') return { ok: false, message: 'boom' }
    return { ok: true }
  },
  async stopFromPanel(agent, pluginId) { calls.push(['stop', pluginId]); return { ok: true } },
  define() { throw new Error('sim 不应走到 define') },
}
const agents = { get: (id) => (id === 's1' ? { id: 's1' } : undefined), currentInitiator: () => undefined }

const ctx = {
  get(name) {
    if (name === 'dynamicCordisRunner') return runner
    if (name === 'agents') return agents
    return undefined // fs/sessions/sandboxPolicy/subprocess 一律缺席（走降级分支）
  },
  provide() {}, on() {},
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
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + read('plugins/toolbox/host.js') + '\n})()')(ctx, harness, console)
  await plugin.apply(ctx)
  await new Promise((r) => setTimeout(r, 50)) // 让启动自举 IIFE 走完降级路径

  check('plugin-restart-all RPC 已注册', typeof rpc['toolbox/plugin-restart-all'] === 'function')

  const r = await rpc['toolbox/plugin-restart-all']({ session: 's1' })
  check('只重跑 p1（运行中+Host-only+本会话）', JSON.stringify(r.done) === JSON.stringify(['p1']), JSON.stringify(r.done))
  check('p5 失败被收集', r.failed.length === 1 && r.failed[0].indexOf('p5') >= 0 && r.failed[0].indexOf('boom') >= 0, JSON.stringify(r.failed))
  check('p3 含 Client 半被跳过', JSON.stringify(r.skippedClient) === JSON.stringify(['p3']))
  check('ok=false（有失败）', r.ok === false)
  check('p2(停)/p4(别会话) 未被 touch', !calls.some((c) => c[1] === 'p2' || c[1] === 'p4'))

  // toggle-all(enable=true) 回归：p1/p5 已在运行、p2 启动、p6 启动失败、p3 跳过、p4 不动
  calls.length = 0
  const r2 = await rpc['toolbox/plugin-toggle-all']({ session: 's1', enable: true })
  check('toggle-all：p1 已在运行、p2 启动、p5 已在运行', r2.done.some((x) => x.indexOf('p1') >= 0) && r2.done.indexOf('p2') >= 0 && r2.done.some((x) => x.indexOf('p5') >= 0), JSON.stringify(r2.done))
  check('toggle-all：p6 启动失败被收集、别会话 p4 不动', r2.failed.length === 1 && r2.failed[0].indexOf('p6') >= 0 && !calls.some((c) => c[1] === 'p4'), JSON.stringify(r2.failed))

  // 无会话 → 明确报错
  const r3 = await rpc['toolbox/plugin-restart-all']({ session: 'nope' })
  check('无效会话 → 明确报错', r3.ok === false && /找不到当前会话/.test(r3.error))

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
