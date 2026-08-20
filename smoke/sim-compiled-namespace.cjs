// 双原生静态 bundle 命名空间共存仿真：同一 mock DOM 中加载 flow 与 flow-jira profile。
// 断言：registry Service / RPC / DOM marker / Slot / storage / session 事件 patch 全部隔离；
// 停一个 bundle 只清理自己；session change patch 共享同一原始方法、按引用计数恢复；
// 真实编译 payload 通过 §9.3 硬编码扫描。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

const runtimeSrc = read('shared/runtime.js')
const overridesSrc = (o) => 'const TOOLBOX_RUNTIME_OVERRIDES = ' + JSON.stringify(o)
const profileOf = (bundleId, label) => ({
  mode: 'static-bundle', bundleId, displayName: label,
  registryService: 'toolboxRegistry' + bundleId.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(''),
  rpcPrefix: 'toolbox.' + bundleId, storagePrefix: 'dsh.toolbox.' + bundleId,
  eventPrefix: 'tb-' + bundleId, slotPrefix: 'toolbox-' + bundleId,
  domId: bundleId, hostIdPrefix: 'toolbox-host-' + bundleId,
})
const PA = profileOf('flow', '流镜')
const PB = profileOf('flow-jira', '流镜 + Jira 工具箱')

// ---------- Host 侧：两份 toolbox host.js 同进程 ----------
const runHost = async (overrides, env) => {
  const src = overridesSrc(overrides) + '\n' + runtimeSrc + '\n' + read('shared/registry.js') + '\n' + read('plugins/toolbox/host.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(env.ctx, env.harness, console)
  await plugin.apply(env.ctx)
}

;(async () => {
  // ======== Host：双 bundle registry/RPC 隔离 ========
  const services = {}
  const handlersA = {}
  const handlersB = {}
  const mkCtx = () => ({
    get(name) { return services[name] },
    provide(name, svc) { services[name] = svc },
    effect(fn) { fn() }, on() {},
  })
  const mkHarness = (handlers) => ({ handle(name, fn) { handlers[name] = fn } })
  await runHost(PA, { ctx: mkCtx(), harness: mkHarness(handlersA) })
  await runHost(PB, { ctx: mkCtx(), harness: mkHarness(handlersB) })

  check('两个 bundle registry Service 不同实例', services[PA.registryService] && services[PB.registryService] && services[PA.registryService] !== services[PB.registryService])
  check('动态默认名未被 compiled bundle 占用', !services.toolboxRegistry)
  check('RPC 集合不重叠', Object.keys(handlersA).every((k) => k.indexOf('toolbox.flow/') === 0) && Object.keys(handlersB).every((k) => k.indexOf('toolbox.flow-jira/') === 0))
  check('双 bundle 各有 tools/panel RPC', Boolean(handlersA['toolbox.flow/tools']) && Boolean(handlersB['toolbox.flow-jira/panel']))

  // registry 隔离：A 注册工具 → A 可见、B 不可见
  const regA = services[PA.registryService]
  regA.attach('r1')
  regA.register({ id: 'flow', label: '流镜', order: 1 }, async () => ({ html: '<b>A</b>' }))
  check('A registry 注册后 tools 可见', regA.tools('r1').length === 1)
  check('B registry 看不到 A 的工具', services[PB.registryService].tools('r1').length === 0)
  const panA = await handlersA['toolbox.flow/panel']({ tool: 'flow' })
  const panB = await handlersB['toolbox.flow-jira/panel']({ tool: 'flow' })
  check('A panel RPC 命中本 bundle 工具', panA && panA.ok === true && panA.html === '<b>A</b>')
  check('B panel RPC 不误命中 A 工具', panB && panB.ok === false)

  // ======== Client：双 bundle DOM/storage/事件隔离 ========
  const clientSrcA = overridesSrc(PA) + '\n' + runtimeSrc + '\n' + read('plugins/toolbox/client.js')
  const clientSrcB = overridesSrc(PB) + '\n' + runtimeSrc + '\n' + read('plugins/toolbox/client.js')

  // 共享 mock 环境（同一页面）：document + localStorage（带原型，模拟 Storage）+ window 事件捕获
  const listeners = {}
  const mockWindow = {
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn) },
    removeEventListener(t, fn) { const l = listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1) },
    dispatchEvent(ev) { for (const fn of (listeners[ev.type] || []).slice()) fn(ev); return true },
  }
  const lsProto = { getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) } }
  const mockLs = Object.create(lsProto); mockLs._m = new Map()
  const body = {
    attrs: {},
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null },
    setAttribute(k, v) { this.attrs[k] = String(v) },
    removeAttribute(k) { delete this.attrs[k] },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) },
    contains() { return false },
  }
  const mkEl = () => ({
    attrs: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = String(v) },
    removeAttribute(k) { delete this.attrs[k] },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) },
    getAttribute(k) { return this.hasAttribute(k) ? this.attrs[k] : null },
    addEventListener() {}, removeEventListener() {},
    remove() {}, insertBefore() {}, closest() { return null }, matches() { return false },
    querySelector() { return null }, querySelectorAll() { return [] }, contains() { return false },
    parentElement: null, isConnected: false,
  })
  const mockDocument = { body, querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl() }
  const MockMO = class { observe() {} disconnect() {} }

  const sidebarRegistrations = []
  const betterSidebar = {
    features: [],
    isTabEnabled() { return true },
    registerTab(descriptor) {
      sidebarRegistrations.push(descriptor)
      return () => {
        const at = sidebarRegistrations.indexOf(descriptor)
        if (at >= 0) sidebarRegistrations.splice(at, 1)
      }
    },
  }
  const mkClientCtx = () => {
    const teardowns = []
    const ctx = {
      teardowns,
      slotsFor: null,
      get(name) {
        if (name === 'slots') return ctx.slotsFor
        if (name === 'betterSidebar') return betterSidebar
        return undefined
      },
      effect(fn) { const d = fn(); if (typeof d === 'function') teardowns.push(d) },
      timeout() { return () => {} },
      inject(deps, callback) {
        if (deps.indexOf('betterSidebar') >= 0) callback(ctx)
      },
    }
    return ctx
  }
  const sharedSlots = { registrations: [], inject(name, f) { f() }, register(entry, comp) { this.registrations.push(entry); return () => {} } }
  const React = { Fragment: 'F', createElement: (t, p, ...c) => ({ t, p, c }), useState: (i) => [typeof i === 'function' ? i() : i, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) }
  const evalClient = async (src, ctx, cssOut) => {
    const fn = new Function('ctx', 'React', 'host', 'styles', 'console', 'document', 'MutationObserver', 'localStorage', 'window',
      'return (async () => {\n' + src + '\n})()')
    const impl = await fn(ctx, React, { call: async () => ({ ok: false }) }, { insert: (css) => { cssOut.push(css); return () => {} } }, console, mockDocument, MockMO, mockLs, mockWindow)
    await impl.apply(ctx)
  }

  const ctxA = mkClientCtx(); ctxA.slotsFor = sharedSlots
  const ctxB = mkClientCtx(); ctxB.slotsFor = sharedSlots
  const cssA = []; const cssB = []
  await evalClient(clientSrcA, ctxA, cssA)
  await evalClient(clientSrcB, ctxB, cssB)
  check('只有 flow bundle 注册 better-sidebar Tab',
    sidebarRegistrations.length === 1 && sidebarRegistrations[0].id === 'dsh-flowglass:flow',
    sidebarRegistrations.map((row) => row.id).join(','))

  const marker = () => (body.getAttribute('data-dsh-toolbox-mounted') || '')
  check('两个 bundle 均挂载（marker 列表语义）', marker().split(/\s+/).indexOf('flow') >= 0 && marker().split(/\s+/).indexOf('flow-jira') >= 0, marker())
  check('Slot drawer ID 隔离', sharedSlots.registrations.some((r) => r.id === 'toolbox-flow-drawer') && sharedSlots.registrations.some((r) => r.id === 'toolbox-flow-jira-drawer'))
  check('主 UI CSS 按 bundle @scope 隔离', cssA.some((s) => s.indexOf('@scope ([data-dsh-toolbox-scope="flow"])') >= 0)
    && cssB.some((s) => s.indexOf('@scope ([data-dsh-toolbox-scope="flow-jira"])') >= 0))
  check('导航 CSS 使用 bundle 值级选择器', cssA.some((s) => s.indexOf('[data-dsh-toolbox-entry="flow"]') >= 0)
    && cssB.some((s) => s.indexOf('[data-dsh-toolbox-entry="flow-jira"]') >= 0))
  const themeCss = []
  const themeImpl = await new Function('ctx', 'styles', 'console', 'return (async () => {\n'
    + overridesSrc(PA) + '\n' + runtimeSrc + '\n' + read('plugins/theme-teal/client.js') + '\n})()')(
      { effect() {} }, { insert: (css) => { themeCss.push(css); return () => {} } }, console,
    )
  themeImpl.apply({ effect() {} })
  check('编译主题变量只挂本 bundle scope', themeCss.some((s) => s.indexOf('[data-dsh-toolbox-scope="flow"]{') >= 0)
    && themeCss.every((s) => s.indexOf(':root{') < 0))
  check('setItem 只 patch 一次（共享原始方法）', lsProto.setItem.__tbPatched === true && lsProto.setItem.__tbEvents.size === 2)

  // 切会话：两个 bundle 各自收到自己的事件
  let gotA = 0; let gotB = 0
  mockWindow.addEventListener('tb-flow-session-changed', () => gotA++)
  mockWindow.addEventListener('tb-flow-jira-session-changed', () => gotB++)
  lsProto.setItem.call(mockLs, 'dsh.sessions.current', '{"sessionId":"s1"}')
  check('切会话两个 bundle 各收各的事件', gotA === 1 && gotB === 1, gotA + '/' + gotB)

  // storage 前缀隔离（drawer 几何 key 不同）
  check('storage key 隔离', PA.storagePrefix !== PB.storagePrefix && PA.storagePrefix === 'dsh.toolbox.flow')

  // 停止 bundle A：只清理自己的 marker / 事件订阅；B 不受影响
  for (const d of ctxA.teardowns) d()
  check('停 A 后 marker 只剩 B', marker() === 'flow-jira', marker())
  lsProto.setItem.call(mockLs, 'dsh.sessions.current', '{"sessionId":"s2"}')
  check('停 A 后 A 不再收事件、B 正常收', gotA === 1 && gotB === 2, gotA + '/' + gotB)
  check('停 A 后 patch 仍在（B 仍订阅）', lsProto.setItem.__tbPatched === true)

  // 停止 bundle B：最后一个退订 → 恢复原始 setItem，marker 移除
  const origSetItem = lsProto.setItem.__tbOrig
  for (const d of ctxB.teardowns) d()
  check('停 B 后 marker 属性移除', body.hasAttribute('data-dsh-toolbox-mounted') === false)
  check('停 B 后恢复原始 setItem（引用计数归零）', lsProto.setItem === origSetItem && !lsProto.setItem.__tbPatched)

  // ======== 真实静态构建产物零动态 runner/payload ========
  const { buildBundle } = await import('../build/build-bundle.mjs')
  const { makeSourceLoader } = await import('../build/source-loader.mjs')
  const loader = makeSourceLoader(pathToFileURL(ROOT + path.sep))
  const native = buildBundle(loader, { features: ['flow', 'jira'] })
  const nativeText = native.ok ? ['lib/index.js', 'lib/client.js', 'lib/remote.js'].map((file) => native.files.get(file)).join('\n') : ''
  check('flow+jira 原生静态构建成功', native.ok, native.errors && native.errors[0])
  check('flow+jira 产物零动态 runner/payload', native.ok && !/dynamicCordisRunner|runner\.define|dyn\//.test(nativeText)
    && native.files.has('lib/client.js') && !native.files.has('lib/payloads.js'))

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
