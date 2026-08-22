// 原生静态 Bundle 仿真：构建 Flow-only 包，执行生成 Host（mock Cordis/Remote），
// 断言 feature 直接注册、Remote tools/panel 可用，且产物不含任何动态 runner/payload。
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

;(async () => {
  const { buildBundle } = await import('../build/build-bundle.mjs')
  const { makeSourceLoader } = await import('../build/source-loader.mjs')
  const loader = makeSourceLoader(pathToFileURL(ROOT + path.sep))
  const built = buildBundle(loader, { features: ['flow'], version: '0.1.0' })
  check('Flow 原生静态构建成功', built.ok, built.errors && built.errors.join('；'))
  if (!built.ok) process.exit(2)
  const files = built.files
  check('产物为 Host/Client/Remote 三入口', files.has('lib/index.js') && files.has('lib/client.js') && files.has('lib/remote.js'))
  check('不生成 payloads/runtime-profile', !files.has('lib/payloads.js') && !files.has('lib/runtime-profile.js'))
  const combined = ['lib/index.js', 'lib/client.js', 'lib/remote.js'].map((file) => files.get(file)).join('\n')
  check('零 dynamicCordisRunner/runner.define/dyn 路径', !/dynamicCordisRunner|runner\.define|runner\.run|dyn\//.test(combined))
  const pkg = JSON.parse(files.get('package.json'))
  check('默认 Flow 构建产出 dsh-flowglass', pkg.name === 'dsh-flowglass', pkg.name)
  check('package 声明原生 dsh.client', pkg.dsh.client.platform === 'web' && pkg.exports['./client'] === './lib/client.js')
  check('Flow 包声明 optional better-sidebar peer',
    pkg.peerDependencies['dsh-better-sidebar'] === '>=0.4.0'
      && pkg.peerDependenciesMeta['dsh-better-sidebar'].optional === true)
  const client = files.get('lib/client.js')
  check('Flow Client 含 Sidebar Tab 与嵌入布局适配',
    client.includes("FLOW_TAB_ID = 'dsh-flowglass:flow'")
      && client.includes("ctx.inject(['betterSidebar']")
      && client.includes('jr-drawer-embedded')
      && !client.includes('if (embedded) return drawerEl')
      && client.includes('props.visible !== false'))
  check('动态批准明确为 false', JSON.parse(files.get('BUILDINFO.json')).dynamicApprovalRequired === false)

  const defaultBuilt = buildBundle(loader, { version: '0.1.0' })
  check('空功能选择默认构建 Flowglass', defaultBuilt.ok
    && JSON.parse(defaultBuilt.files.get('package.json')).name === 'dsh-flowglass'
    && JSON.parse(defaultBuilt.files.get('BUILDINFO.json')).bundleId === 'flow')

  // 去掉 ESM import/export 后，在 mock Cordis 环境真实执行生成 Host。
  let hostSource = files.get('lib/index.js')
    .replace(/^import .*$/gm, '')
    .replace('export const name =', 'const name =')
    .replace('export const inject =', 'const inject =')
    .replace('export async function apply(ctx)', 'async function apply(ctx)')
  hostSource += '\nreturn { name, inject, apply }'
  class MockRemoteService {
    constructor(ctx, service, options) { this.ctx = ctx; this.name = service; this.namespace = options && options.namespace; ctx.provide(service, this) }
  }
  const Remote = () => (_method, context) => { context.addInitializer(() => {}) }
  const services = {}
  const effects = []
  const intervals = []
  const session = { id: 's1', header: { id: 's1', cwd: 'D:/work/native' }, events: [] }
  const ctx = {
    get(name) {
      if (name === 'sessionQuery') return {
        async readSession() { return { session: session.header, events: [] } },
        async listSessions() { return [{ id: 's1', header: session.header }] },
      }
      if (name === 'sessions') return { get: (id) => id === 's1' ? session : undefined }
      return services[name]
    },
    provide(name, value) { services[name] = value },
    interval(fn) { intervals.push(fn); return () => {} }, timeout() { return () => {} },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose) },
    on() {},
  }
  const module = await new Function('TypertRemoteService', 'Remote', 'console', 'return (async () => {\n' + hostSource + '\n})()')(MockRemoteService, Remote, console)
  await module.apply(ctx)
  for (const fn of intervals.splice(0)) fn()
  const info = JSON.parse(files.get('BUILDINFO.json'))
  const remote = services[info.profile.remoteService]
  check('原生 Remote Service 已提供', remote && typeof remote.tools === 'function' && typeof remote.panel === 'function')
  const tools = remote.tools({ root: 'D:/work/native' })
  check('Flow 由静态 Host 直接注册', tools.ok && tools.tools.some((tool) => tool.id === 'flow'), JSON.stringify(tools))
  const panel = await remote.panel({ root: 'D:/work/native', session: 's1', tool: 'flow', action: '', fields: {}, state: null })
  check('原生 Remote panel 可渲染 Flow', panel && panel.ok === true && typeof panel.html === 'string' && panel.html.includes('data-flow'), JSON.stringify(panel).slice(0, 300))
  const sessionInfo = await remote.sessionInfo({ session: 's1' })
  check('原生 Remote sessionInfo 可解析 cwd', sessionInfo.ok && sessionInfo.cwd === 'D:/work/native')

  // selfview 共享同一份功能源码，但静态包必须改走原生 Remote 与 tools service。
  const selfviewBuilt = buildBundle(loader, { features: ['selfview'], version: '0.1.0' })
  const selfviewHost = selfviewBuilt.ok ? selfviewBuilt.files.get('lib/index.js') : ''
  const selfviewClient = selfviewBuilt.ok ? selfviewBuilt.files.get('lib/client.js') : ''
  const selfviewRemote = selfviewBuilt.ok ? selfviewBuilt.files.get('lib/remote.js') : ''
  const selfviewPkg = selfviewBuilt.ok ? JSON.parse(selfviewBuilt.files.get('package.json')) : {}
  check('selfview 可编译为原生静态功能', selfviewBuilt.ok, selfviewBuilt.errors && selfviewBuilt.errors.join('；'))
  check('selfview 静态桥接含三条 Remote',
    selfviewHost.includes('selfviewPull(request)')
      && selfviewClient.includes('["selfview/pull"]')
      && selfviewRemote.includes('descriptor("selfviewPush")'))
  check('selfview 模型工具改走原生 tools service',
    selfviewHost.includes("from '@deepseek-ai/dsh-tools'")
      && selfviewHost.includes("ctx.get('tools')")
      && selfviewPkg.peerDependencies['@deepseek-ai/dsh-tools'] === '^0.1.0-rc.8')

  const largeBuilt = buildBundle(loader, {
    features: ['jira', 'git', 'files', 'flow', 'flowedit', 'trace', 'http', 'ports', 'calc', 'usage', 'prompt', 'context', 'aiassist', 'tools', 'search', 'lineage', 'aiusage', 'quota', 'selfview'],
    version: '0.1.0',
  })
  const largeId = largeBuilt.ok ? JSON.parse(largeBuilt.files.get('BUILDINFO.json')).bundleId : ''
  check('大功能组合自动生成合法短 bundleId', largeBuilt.ok && /^bundle-\d+-[a-f0-9]{12}$/.test(largeId) && largeId.length <= 40, largeId || (largeBuilt.errors || []).join('；'))

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((error) => { console.error('仿真异常:', error); process.exit(2) })
