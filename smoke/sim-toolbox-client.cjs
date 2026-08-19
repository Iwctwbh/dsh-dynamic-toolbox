// toolbox client.js 仿真（rc.7 改造 16.2 + 用户决策回导航区 + v6.6 Cordis 面板隐藏联动）：
// ①有 DOM 环境：导航区 DOM 注入（新会话下方、插件族块末尾），不注册 sidebar.footer.action；
//   body 级 MutationObserver watcher 自愈；teardown 断开 watcher 并移除条目；
// ②无 DOM 环境（headless）：退回官方 footer Slot 注册（sidebar.footer.action + shell.overlay）；
// ③Entry（Slot 兜底用）宽栏渲染「工具箱」、折叠 rail 渲染「箱」，点击切换开合；
// ④注入 CSS 同时含导航条目选择器（[data-dsh-toolbox-entry]）与抽屉/入口样式；
// ⑤「隐藏无界面」联动：Host-only 行打 data-tb-hide 隐藏（待审批行不隐藏）、计数 span 用
//   面板 DOM「可见且 running」行覆盖（不信任单仓库 toolbox/plugins 清单）；开关关闭后恢复。
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

// ---- 最小假 DOM：支持 client.js 用到的属性读写 + 后代查询（querySelector/querySelectorAll）。
// 选择器匹配只实现实际用到的简单形态（tag、[attr]、tag[attr]、[attr="v"]、逗号列表）；
// *= / 后代组合等不支持的语法按「不匹配」处理，绝不抛错。侧边栏 root 不可发现（tryPlace no-op）。
const selMatch = (el, sel) => {
  sel = String(sel || '').trim()
  if (!sel) return false
  if (sel.indexOf(',') >= 0) return sel.split(',').some((s) => selMatch(el, s))
  if (/[*^$~|]=/.test(sel) || /\s/.test(sel)) return false
  const attrs = []
  let rest = sel
  const re = /\[([a-zA-Z-]+)(?:="([^"]*)")?\]/g
  let m
  while ((m = re.exec(sel))) {
    attrs.push([m[1], m[2]])
    rest = rest.split(m[0]).join('')
  }
  const tag = rest.trim()
  if (tag && el.tagName !== tag.toUpperCase()) return false
  for (const [k, v] of attrs) {
    if (!el.hasAttribute(k)) return false
    if (v != null && el.attrs[k] !== v) return false
  }
  return Boolean(tag) || attrs.length > 0
}
const collect = (root, sel, out) => {
  for (const c of root.children || []) {
    if (selMatch(c, sel)) out.push(c)
    collect(c, sel, out)
  }
  return out
}
const makeFakeDom = () => {
  const observers = []
  class MutationObserver {
    constructor(cb) { this.cb = cb; observers.push(this); this.observing = false }
    observe() { this.observing = true }
    disconnect() { this.observing = false }
  }
  const makeEl = (tag) => ({
    tagName: (tag || 'div').toUpperCase(),
    attrs: {}, children: [], listeners: {}, textContent: '',
    setAttribute(k, v) { this.attrs[k] = String(v) },
    removeAttribute(k) { delete this.attrs[k] },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) },
    getAttribute(k) { return this.hasAttribute(k) ? this.attrs[k] : null },
    addEventListener(t, fn) { this.listeners[t] = fn },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c },
    remove() { this.removed = true },
    querySelector(sel) { return collect(this, sel, [])[0] || null },
    querySelectorAll(sel) { return collect(this, sel, []) },
    matches(sel) { return selMatch(this, sel) },
    contains() { return false },
    parentElement: null,
    isConnected: false,
    innerHTML: '',
    type: '',
  })
  const body = makeEl('body')
  return {
    observers,
    MutationObserver,
    body,
    document: {
      body,
      createElement: (t) => makeEl(t),
      querySelector: (sel) => collect(body, sel, [])[0] || null,
      querySelectorAll: (sel) => collect(body, sel, []),
    },
  }
}

const makeLocalStorage = (init) => {
  const store = new Map(Object.entries(init || {}))
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  }
}

const evalClient = (src, extra) => {
  const fn = new Function('ctx', 'React', 'host', 'styles', 'console', 'document', 'MutationObserver', 'localStorage',
    'return (async () => {\n' + src + '\n})()')
  return fn(extra.ctx, React, extra.host || { call: async () => ({ ok: false }) }, extra.styles, console,
    extra.document, extra.MutationObserver, extra.localStorage)
}

const tick = () => new Promise((r) => setTimeout(r, 15))

;(async () => {
  const src = read('shared/runtime.js') + '\n' + read('plugins/toolbox/client.js')

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
    check('B: panel-hide watcher 与 body 级自愈 watcher 启动（root 级待放置后启动）',
      dom.observers.length === 3 && dom.observers[0].observing === true && dom.observers[1].observing === true && dom.observers[2].observing === false,
      'observers=' + dom.observers.length)
    check('B: 页面互斥标记已置位', dom.document.body.hasAttribute('data-dsh-toolbox-mounted'))
    check('B: teardown 已登记（mutex + panel-hide + DOM entry）', ctx.teardowns.length >= 3, 'count=' + ctx.teardowns.length)
    for (const dis of ctx.teardowns) dis()
    check('B: 停止后 watcher 全断开', dom.observers.every((o) => !o.observing))
    check('B: 停止后互斥标记清除', !dom.document.body.hasAttribute('data-dsh-toolbox-mounted'))
  }

  // —— 路径 C：「隐藏无界面」联动官方 Cordis 面板 ——
  {
    const dom = makeFakeDom()
    // 官方面板 DOM：panel section + 4 行（Host-only running / 含界面 running / Host-only idle / Host-only 待审批）
    const makeRow = (id, status, extra) => {
      const li = dom.document.createElement('li')
      li.setAttribute('data-cordis-row', id)
      if (status) li.setAttribute('data-cordis-status', status)
      if (extra) for (const k of Object.keys(extra)) li.setAttribute(k, extra[k])
      return li
    }
    const panel = dom.document.createElement('section')
    panel.setAttribute('data-cordis-panel', '')
    const ul = dom.document.createElement('ul')
    const rowA = makeRow('plugin-a', 'running') // Host-only，running → 隐藏
    const rowB = makeRow('plugin-b', 'running') // 含 Client 半，running → 可见
    const rowC = makeRow('plugin-c', 'idle') // Host-only，停止 → 隐藏
    const rowD = makeRow('plugin-d', 'running', { 'data-cordis-awaiting': '' }) // 待审批 → 不隐藏
    for (const r of [rowA, rowB, rowC, rowD]) ul.appendChild(r)
    panel.appendChild(ul)
    dom.body.appendChild(panel)
    // 触发按钮 + 官方计数文本（官方口径 = 全进程动态插件，此处 3 running）
    const badge = dom.document.createElement('button')
    badge.setAttribute('data-cordis-badge', '4')
    const spLabel = dom.document.createElement('span'); spLabel.textContent = '插件'
    const spCount = dom.document.createElement('span'); spCount.textContent = '3 running'
    badge.appendChild(spLabel)
    badge.appendChild(spCount)
    dom.body.appendChild(badge)

    // toolbox/plugins 只回当前仓库清单（刻意与面板行同集，验证计数不走它）
    const plugins = [
      { pluginId: 'plugin-a', hasClientHalf: false, running: true },
      { pluginId: 'plugin-b', hasClientHalf: true, running: true },
      { pluginId: 'plugin-c', hasClientHalf: false, running: false },
      { pluginId: 'plugin-d', hasClientHalf: false, running: true },
    ]
    const host = { call: async (m) => (m === 'toolbox/plugins' ? { ok: true, plugins } : { ok: false }) }
    const localStorage = makeLocalStorage({})

    const slots = makeSlots()
    const ctx = makeCtx(); ctx.slotsFor = slots
    const impl = await evalClient(src, {
      ctx, styles: { insert() { return () => {} } }, document: dom.document, MutationObserver: dom.MutationObserver,
      host, localStorage,
    })
    impl.apply(ctx)
    await tick() // 等 refreshPanelHide 的 host.call 落定

    check('C: Host-only 行被隐藏', rowA.hasAttribute('data-tb-hide') && rowC.hasAttribute('data-tb-hide'))
    check('C: 含界面行与待审批行不隐藏', !rowB.hasAttribute('data-tb-hide') && !rowD.hasAttribute('data-tb-hide'))
    check('C: running 计数按面板 DOM 可见行覆盖（2 而非单仓库含界面口径的 1）',
      spCount.getAttribute('data-tb-count') === '2 running', 'got=' + spCount.getAttribute('data-tb-count'))
    check('C: 非计数 span 不被覆盖', !spLabel.hasAttribute('data-tb-count'))
    for (const dis of ctx.teardowns) dis()

    // 恢复：开关关闭（localStorage '0'）→ 隐藏行恢复、计数覆盖移除（回官方全局口径）
    localStorage.setItem('tbx-hide-host-only', '0')
    const slots2 = makeSlots()
    const ctx2 = makeCtx(); ctx2.slotsFor = slots2
    const impl2 = await evalClient(src, {
      ctx: ctx2, styles: { insert() { return () => {} } }, document: dom.document, MutationObserver: dom.MutationObserver,
      host, localStorage,
    })
    impl2.apply(ctx2)
    await tick()
    check('C: 开关关闭后隐藏行恢复', !rowA.hasAttribute('data-tb-hide') && !rowC.hasAttribute('data-tb-hide'))
    check('C: 开关关闭后计数覆盖移除', !spCount.hasAttribute('data-tb-count'))
    for (const dis of ctx2.teardowns) dis()
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
    check('CSS 含隐藏行与计数覆盖规则', css.indexOf('li[data-cordis-row][data-tb-hide~="1"]{display:none!important}') >= 0
      && css.indexOf('button[data-cordis-badge] span[data-tb-count]::after') >= 0)
  }

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
