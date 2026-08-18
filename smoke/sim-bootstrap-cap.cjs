// host-bootstrap 能力检查仿真（rc.7 改造 16.4）：
// ① apply 提供全局 toolboxRegistry（含 panel 方法，v6.3 契约）；
// ② runner 缺 define/run/inventory 之一 → 会话启动时得到一次明确的版本/能力错误（warn）；
// ③ runner 完整 + inventory 已有同名框架 → 幂等跳过（不重复 define）；
// ④ runner 完整 + 空 inventory → define+run 走宿主垫片（宿主 id = toolbox-host-<root>）；
// ⑤ hostIdOf 防碰撞：短前缀 + 全路径哈希（同前缀长路径 / a-b 与 a/b 不同 id）。
// 每个用例重新 import 模块（?case=n 绕 ESM 缓存）：inflight/监听器是模块级状态。
const fs = require('fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

const fsStub = {
  resolve: async (p, opts) => path.resolve((opts && opts.cwd) || ROOT, p),
  // .dsh-dynamic-toolbox 下记忆/偏好文件视为不存在（hermetic：不读仓库真实启停记忆）
  stat: async (t) => {
    if (String(t).includes('.dsh-dynamic-toolbox')) return undefined
    try { return fs.statSync(t) } catch (e) { return undefined }
  },
  readText: async (t) => fs.readFileSync(t, 'utf8'),
  listDir: async (t) => {
    try {
      return fs.readdirSync(t, { withFileTypes: true })
        .map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file' }))
    } catch (e) { return [] }
  },
}

const makeCtx = (runner) => {
  const provided = {}
  let listener = null
  return {
    provided,
    get(name) {
      if (name === 'dynamicCordisRunner') return runner
      if (name === 'fs') return fsStub
      if (name === 'toolboxRegistry') return provided.toolboxRegistry
      if (name === 'agents') return {
        roots: () => [AGENT],
        get: (id) => (id === AGENT.id ? AGENT : undefined),
        enter: (stub) => { provided.__entered = stub; return () => {} },
      }
      return undefined
    },
    provide(name, value) { provided[name] = value; return () => {} },
    on(name, fn) { if (name === 'agent/session-start') listener = fn },
    fireSessionStart() { if (listener) listener({ agent: AGENT }) },
  }
}

const AGENT = { id: 's1', session: { id: 's1', header: { id: 's1', cwd: ROOT } }, steer() {}, inject() {} }

const importFresh = async (caseId) =>
  import(pathToFileURL(path.join(ROOT, 'host-bootstrap', 'index.js')).href + '?case=' + caseId)

const captureWarns = async (fn) => {
  const warns = []
  const orig = console.warn
  console.warn = (...a) => warns.push(a.join(' '))
  try { await fn() } finally { console.warn = orig }
  return warns
}

const settle = () => new Promise((r) => setTimeout(r, 80))

;(async () => {
  const PAYLOAD = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/toolbox/payload.json'), 'utf8'))

  // ① apply 提供全局注册表
  {
    const mod = await importFresh('registry')
    const ctx = makeCtx(undefined)
    mod.apply(ctx)
    const reg = ctx.provided.toolboxRegistry
    check('apply 提供 toolboxRegistry（register/tools/panel 契约）',
      Boolean(reg && typeof reg.register === 'function' && typeof reg.tools === 'function' && typeof reg.panel === 'function'))
    check('模块名 dsh-toolbox-bootstrap', mod.name === 'dsh-toolbox-bootstrap')
  }

  // ② 缺 run → 明确能力错误（不进入 findRepo/define）
  {
    const mod = await importFresh('missing-run')
    const calls = []
    const runner = {
      define() { calls.push('define') },
      inventory() { calls.push('inventory'); return [] },
      // 无 run
    }
    const ctx = makeCtx(runner)
    mod.apply(ctx)
    const warns = await captureWarns(async () => { ctx.fireSessionStart(); await settle() })
    check('缺 run 时报明确能力错误', warns.some((w) => w.indexOf('工具箱需要 DSH rc.7 动态运行接口，缺少：run') >= 0), warns.join(' | '))
    check('能力错误发生在 inventory/define 之前', calls.length === 0, calls.join(','))
  }

  // ②' 缺多个 → 一次列全
  {
    const mod = await importFresh('missing-multi')
    const runner = { run() {} } // 缺 define/inventory
    const ctx = makeCtx(runner)
    mod.apply(ctx)
    const warns = await captureWarns(async () => { ctx.fireSessionStart(); await settle() })
    check('缺 define/inventory 一次列全', warns.some((w) => w.indexOf('缺少：define, inventory') >= 0), warns.join(' | '))
  }

  // ③ 完整 runner + 已有同名框架行 → 幂等跳过
  {
    const mod = await importFresh('idempotent')
    const calls = []
    // 幂等按「本仓库宿主会话 id」匹配（直接用模块导出的 hostIdOf，与实现同源）
    const hostId = mod.hostIdOf(ROOT)
    const runner = {
      define() { calls.push('define') },
      async run() { calls.push('run'); return { ok: true } },
      inventory() {
        return [{ pluginId: 'tbx-9', agentId: hostId, packages: [{ name: PAYLOAD.name }], activeRun: { pluginRunId: 'r' } }]
      },
    }
    const ctx = makeCtx(runner)
    mod.apply(ctx)
    const warns = await captureWarns(async () => { ctx.fireSessionStart(); await settle() })
    check('已定义同名框架 → 不重复 define', calls.indexOf('define') < 0, calls.join(',') || '(无调用)')
    check('幂等跳过无错误告警', warns.length === 0, warns.join(' | '))
  }

  // ④ 完整 runner + 空 inventory → define+run 走宿主垫片
  {
    const mod = await importFresh('happy')
    const calls = []
    const runner = {
      define(req) { calls.push(['define', req && req.name]); return { pluginId: 'tbx-new', packageId: 'pkg-new' } },
      async run(agent, pluginId, packageId, mode) { calls.push(['run', pluginId, packageId, mode]); return { ok: true, status: 'awaiting-approval' } },
      inventory() { return [] },
    }
    const ctx = makeCtx(runner)
    mod.apply(ctx)
    const warns = await captureWarns(async () => { ctx.fireSessionStart(); await settle() })
    check('define 使用磁盘 payload.json 参数', calls.some((c) => c[0] === 'define' && c[1] === PAYLOAD.name), JSON.stringify(calls))
    check('define 归属宿主会话 id（toolbox-host- 前缀）',
      Boolean(ctx.provided.__entered) && /^toolbox-host-/.test(ctx.provided.__entered.id), ctx.provided.__entered ? ctx.provided.__entered.id : '(未 enter)')
    check('run 以 mode=run 发起', calls.some((c) => c[0] === 'run' && c[3] === 'run'))
    check('awaiting-approval 路径无告警', warns.length === 0, warns.join(' | '))
  }

  // ⑤ hostIdOf：短前缀 + 稳定路径哈希——同前缀长路径 / a-b 与 a/b 不再碰撞出同一宿主 id
  {
    const mod = await importFresh('hostid')
    const org = 'D:/repos/very-long-organization-name'
    const a = mod.hostIdOf(org + '/project-alpha')
    const b = mod.hostIdOf(org + '/project-beta')
    const c = mod.hostIdOf('D:/work/a-b')
    const d = mod.hostIdOf('D:/work/a/b')
    check('长共同前缀的不同项目宿主 id 不同', a !== b, a + ' vs ' + b)
    check('a-b 与 a/b 宿主 id 不同', c !== d, c + ' vs ' + d)
    check('同路径宿主 id 稳定', mod.hostIdOf(org + '/project-alpha') === a)
    check('同一目录不同写法宿主 id 相同（分隔符/尾分隔符/大小写）',
      mod.hostIdOf('D:/work/repo') === mod.hostIdOf('D:\\work\\repo\\')
      && mod.hostIdOf('D:/work/repo') === mod.hostIdOf('d:/work/repo'),
      mod.hostIdOf('D:/work/repo') + ' vs ' + mod.hostIdOf('D:\\work\\repo\\') + ' vs ' + mod.hostIdOf('d:/work/repo'))
    check('Linux 路径大小写敏感（不折叠）', mod.hostIdOf('/srv/Repo') !== mod.hostIdOf('/srv/repo'))
    check('宿主 id 仅字母数字与连字符', /^[a-z0-9-]+$/.test(a) && /^[a-z0-9-]+$/.test(c))
    check('宿主 id 保留 toolbox-host- 前缀与可读短前缀', a.indexOf('toolbox-host-') === 0 && a.indexOf('project-alpha') > 0, a)
  }

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
