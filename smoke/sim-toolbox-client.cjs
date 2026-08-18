// toolbox client.js 仿真（rc.7 改造 16.2 + 用户决策回导航区）：入口双路径契约——
// ①有 DOM 环境：导航区 DOM 注入（新会话下方、插件族块末尾），不注册 sidebar.footer.action；
//   body 级 MutationObserver watcher 自愈；teardown 断开 watcher 并移除条目；
// ②无 DOM 环境（headless）：退回官方 footer Slot 注册（sidebar.footer.action + shell.overlay）；
// ③Entry（Slot 兜底用）宽栏渲染「工具箱」、折叠 rail 渲染「箱」，点击切换开合；
// ④注入 CSS 同时含导航条目选择器（[data-dsh-toolbox-entry]）与抽屉/入口样式。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

// ---- mock React：createElement 返回纯节点；hooks 单组件顺序槽位版 ----
let hookCells = []
let hookIdx = 0
const React = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) { return { type, props: props || {}, children } },
  useState(init) {
    const i = hookIdx++
    if (!(i in hookCells)) hookCells[i] = typeof init === 'function' ? init() : init
    return [hookCells[i], (v) => { hookCells[i] = typeof v === 'function' ? v(hookCells[i]) : v }]
  },
  useEffect(fn) { const dis = fn(); if (typeof dis === 'function') dis() },
}
const renderHooked = (component, props) => { hookIdx = 0; return component(props) }

const makeSlots = () => ({
  injected: {},
  registrations: [],
  inject(name, factory) { this.injected[name] = factory },
  register(entry, component) { this.registrations.push({ entry, component }); return () => {} },
  activateAll() { for (const name of Object.keys(this.injected)) this.injected[name]() },
})

const makeCtx = () => {
  const teardowns = []
  return {
    teardowns,
    slotsFor: null,
    get(name) { if (name === 'slots') return this.slotsFor; return undefined },
    effect(fn) { const dis = fn(); if (typeof dis === 'function') teardowns.push(dis); return () => {} },
    timeout(fn) { return () => {} },
  }
}

// ---- 最小假 DOM：侧边栏 root 不可发现（tryPlace no-op），只验证创建/自愈 watcher/清理 ----
const makeFakeDom = () => {
  const observers = []
  class MutationObserver {
    constructor(cb) { this.cb = cb; observers.push(this); this.observing = false }
    observe() { this.observing = true }
    disconnect() { this.observing = false }
  }
  const makeEl = (tag) => ({
    tagName: (tag || 'div').toUpperCase(),
    attrs: {}, children: [], listeners: {},
    setAttribute(k, v) { this.attrs[k] = v },
    removeAttribute(k) { delete this.attrs[k] },
    hasAttribute(k) { return k in this.attrs },
    addEventListener(t, fn) { this.listeners[t] = fn },
    remove() { this.removed = true },
    querySelector() { return null },
    matches() { return false },
    contains() { return false },
    get parentElement() { return null },
    isConnected: false,
    innerHTML: '',
    type: '',
  })
  return {
    observers,
    MutationObserver,
    document: { body: makeEl('body'), createElement: (t) => makeEl(t), querySelector: () => null },
  }
}

const evalClient = (src, extra) => {
  const fn = new Function('ctx', 'React', 'host', 'styles', 'console', 'document', 'MutationObserver',
    'return (async () => {\n' + src + '\n})()')
  return fn(extra.ctx, React, { call: async () => ({ ok: false }) }, extra.styles, console, extra.document, extra.MutationObserver)
}

;(async () => {
  const src = read('plugins/toolbox/client.js')

  // 静态断言：双路径都在（DOM 主 + Slot 兜底）
  check('源码含导航区 DOM 注入主路径', src.indexOf('function mountSidebarEntry()') >= 0 && src.indexOf('data-dsh-toolbox-entry') >= 0)
  check('源码含无 DOM 兜底 Slot 分支', src.indexOf("slots.inject('sidebar.footer.action'") >= 0 && src.indexOf("typeof MutationObserver !== 'undefined'") >= 0)

  // —— 路径 A：无 DOM → Slot 兜底 ——
  {
    const slots = makeSlots()
    const ctx = makeCtx(); ctx.slotsFor = slots
    const inserted = []
    const impl = await evalClient(src, { ctx, styles: { insert(css) { inserted.push(css); return () => {} } } })
    check('A: 返回插件对象', impl && typeof impl.apply === 'function')
    impl.apply(ctx)
    check('A: 无 DOM 时注册 sidebar.footer.action 与 shell.overlay',
      Boolean(slots.injected['sidebar.footer.action']) && Boolean(slots.injected['shell.overlay']),
      Object.keys(slots.injected).join(','))
    slots.activateAll()
    const sidebarReg = slots.registrations.find((r) => r.entry && r.entry.name === 'sidebar.footer.action')
    check('A: footer 条目契约（id/order/label）',
      sidebarReg && sidebarReg.entry.id === 'toolbox-entry' && sidebarReg.entry.order === -1000 && sidebarReg.entry.label === '工具箱',
      sidebarReg ? JSON.stringify(sidebarReg.entry) : '(未注册)')

    const entryEl = sidebarReg.component({ wide: true })
    let rendered = renderHooked(entryEl.type, { wide: true })
    check('A: 宽栏显示「工具箱」', rendered.children.indexOf('工具箱') >= 0, JSON.stringify(rendered.children))
    rendered = renderHooked(entryEl.type, { wide: false })
    check('A: 折叠 rail 显示「箱」', rendered.children.indexOf('箱') >= 0)
    rendered.props.onClick()
    rendered = renderHooked(entryEl.type, { wide: true })
    check('A: 点击后 active 态', String(rendered.props.className).indexOf('tb-entry-active') >= 0)
    for (const dis of ctx.teardowns) dis()
  }

  // —— 路径 B：有 DOM → 导航区注入，不注册 sidebar.footer.action ——
  {
    const dom = makeFakeDom()
    const slots = makeSlots()
    const ctx = makeCtx(); ctx.slotsFor = slots
    const impl = await evalClient(src, { ctx, styles: { insert() { return () => {} } }, document: dom.document, MutationObserver: dom.MutationObserver })
    impl.apply(ctx)
    check('B: 有 DOM 时不注册 sidebar.footer.action（走 DOM 注入）', slots.injected['sidebar.footer.action'] === undefined, Object.keys(slots.injected).join(','))
    check('B: shell.overlay 仍注册', Boolean(slots.injected['shell.overlay']))
    check('B: body 级自愈 watcher 启动（root 级待放置后启动）',
      dom.observers.length === 2 && dom.observers[0].observing === true && dom.observers[1].observing === false)
    check('B: 页面互斥标记已置位', dom.document.body.hasAttribute('data-dsh-toolbox-mounted'))
    check('B: teardown 已登记（mutex + DOM entry）', ctx.teardowns.length >= 2, 'count=' + ctx.teardowns.length)
    for (const dis of ctx.teardowns) dis()
    check('B: 停止后 watcher 全断开', dom.observers.every((o) => !o.observing))
    check('B: 停止后互斥标记清除', !dom.document.body.hasAttribute('data-dsh-toolbox-mounted'))
  }

  // —— CSS：导航条目与抽屉样式齐备 ——
  {
    const slots = makeSlots()
    const ctx = makeCtx(); ctx.slotsFor = slots
    const inserted = []
    const impl = await evalClient(src, { ctx, styles: { insert(css) { inserted.push(css); return () => {} } } })
    impl.apply(ctx)
    const css = inserted.join('\n')
    check('CSS 含导航条目选择器', css.indexOf('[data-dsh-toolbox-entry]{') >= 0 && css.indexOf('.tb-nav-icon') >= 0)
    check('CSS 含折叠 rail 变体', css.indexOf('[data-dsh-frame][data-sidebar-collapsed] [data-dsh-toolbox-entry]') >= 0)
    check('CSS 含 .tb-entry 与 .jr-drawer', css.indexOf('.tb-entry{') >= 0 && css.indexOf('.jr-drawer{') >= 0)
  }

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
