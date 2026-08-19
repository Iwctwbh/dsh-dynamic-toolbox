window.__ModuleLoader__.load({
  id: "dsh-flowglass",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const name = "dsh-flowglass/client"
    const inject = ['slots', 'remote', 'timer']

    const TOOLBOX_RUNTIME_OVERRIDES = {
  "mode": "static-bundle",
  "bundleId": "flow",
  "displayName": "流镜",
  "registryService": "toolboxRegistryFlow",
  "artifactService": "toolboxArtifactsFlow",
  "remoteService": "toolboxNativeFlow",
  "remoteNamespace": "toolboxNativeFlow",
  "rpcPrefix": "toolbox.flow",
  "storagePrefix": "dsh.toolbox.flow",
  "eventPrefix": "tb-flow",
  "slotPrefix": "toolbox-flow",
  "domId": "flow",
  "hostIdPrefix": "toolbox-host-flow",
  "dataDir": ".dsh-dynamic-toolbox",
  "capabilities": {
    "diskReload": false,
    "rebuildFromDisk": false,
    "pluginDefaults": false,
    "pluginRestart": false,
    "aiUsage": false,
    "managePlugins": false
  }
}
// ===== shared/runtime.js：两种模式共同的运行配置与命名辅助 =====
// 纯 JS：不访问 Node API、不依赖 Host/Client 专属全局，可拼接到 Host 与 Client payload。
// 动态模式：只拼接本文件（无 TOOLBOX_RUNTIME_OVERRIDES）→ 全部动态默认值，与历史行为一致。
  // 原生静态模式：构建器在本文件之前拼接 `const TOOLBOX_RUNTIME_OVERRIDES = {...}` JSON 字面量。
// 配置不走 globalThis/window/process.env（多 bundle 同进程会互相覆盖、批准包必须可审计、
// 全局变量会让 payload 内容哈希不能代表真实行为）——业务实现只读本文件定义的 TOOLBOX_RUNTIME。
const TOOLBOX_RUNTIME = (() => {
  const o = (typeof TOOLBOX_RUNTIME_OVERRIDES !== 'undefined' && TOOLBOX_RUNTIME_OVERRIDES) || {}
  const mode = o.mode || 'dynamic-dev'
  const bundleId = o.bundleId || 'dynamic'
  const rpcPrefix = o.rpcPrefix || 'toolbox'
  const storagePrefix = o.storagePrefix || 'dsh.toolbox'
  const eventPrefix = o.eventPrefix || 'tb'
  const slotPrefix = o.slotPrefix || 'toolbox'
  return Object.freeze({
    mode, // 'dynamic-dev' | 'static-bundle'
    bundleId, // 动态模式恒为 'dynamic'；静态安装包为 bundleId（如 'flow-plus'）
    displayName: o.displayName || '工具箱',
    registryService: o.registryService || 'toolboxRegistry',
    artifactService: o.artifactService || null,
    remoteService: o.remoteService || null,
    remoteNamespace: o.remoteNamespace || null,
    rpcPrefix, // 动态 'toolbox'；编译 'toolbox.<bundleId>' → rpc('tools') = '<prefix>/tools'
    storagePrefix, // 动态 'dsh.toolbox'；编译 'dsh.toolbox.<bundleId>'
    eventPrefix, // 动态 'tb'；编译 'tb-<bundleId>' → event('session-changed')
    slotPrefix, // 动态 'toolbox'；编译 'toolbox-<bundleId>' → slot('entry') / slot('drawer')
    domId: o.domId || 'dynamic', // DOM marker 命名值；动态恒 'dynamic'
    hostIdPrefix: o.hostIdPrefix || 'toolbox-host',
    dataDir: o.dataDir || '.dsh-dynamic-toolbox',
    capabilities: Object.freeze(Object.assign({
      diskReload: mode === 'dynamic-dev',
      rebuildFromDisk: mode === 'dynamic-dev',
      pluginDefaults: true,
      pluginRestart: true,
      aiUsage: true,
      managePlugins: true,
    }, o.capabilities || {})),
    // ---- 命名辅助（前缀已由构建器归一化，拼接即得最终名）----
    rpc: (suffix) => rpcPrefix + '/' + suffix,
    storageKey: (suffix) => storagePrefix + '.' + suffix,
    event: (suffix) => eventPrefix + '-' + suffix,
    slot: (name) => slotPrefix + '-' + name,
    // DOM 标记值：动态默认保持历史值（mounted="1"、entry=""），编译模式用 bundleId 区分多 bundle
    domValue: () => (bundleId === 'dynamic' ? '' : bundleId),
    domMountedValue: () => (bundleId === 'dynamic' ? '1' : bundleId),
    logTag: () => (bundleId === 'dynamic' ? '[toolbox]' : '[toolbox:' + bundleId + ']'),
  })
})()


    const json = Object.freeze({ parse(value) { return value } })
    const descriptor = (method) => ({
      id: "dsh-flowglass/remote#toolboxNativeFlow/" + method,
      service: "toolboxNativeFlow",
      namespace: "toolboxNativeFlow",
      method,
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request', wire: 'request', source: 'json',
        codec: { mode: 'strict', typeSymbol: "dsh-flowglass#JsonRequest", schema: json },
      }],
      result: { mode: 'strict', typeSymbol: "dsh-flowglass#JsonResult", schema: json },
    })
    const remoteContribution = Object.freeze({
      package: "dsh-flowglass",
      descriptors: Object.freeze(['tools', 'panel', 'plugins', 'sessionInfo'].map(descriptor)),
    })

    const styleDisposers = new Set()
    const styles = {
      insert(css) {
        if (typeof document === 'undefined') return () => {}
        const node = document.createElement('style')
        node.setAttribute('data-dsh-toolbox-style', TOOLBOX_RUNTIME.bundleId)
        node.textContent = String(css || '')
        ;(document.head || document.body || document.documentElement).appendChild(node)
        let active = true
        const dispose = () => { if (active) { active = false; styleDisposers.delete(dispose); node.remove() } }
        styleDisposers.add(dispose)
        return dispose
      },
    }
    const unwrap = async (promise) => {
      const answered = await promise
      if (!answered || answered.ok !== true) {
        const error = answered && answered.error
        throw new Error(error ? String(error.code || 'remote') + ': ' + String(error.message || error) : 'Remote 调用失败')
      }
      return answered.value
    }
    // toolbox/client.js 工厂在模块层创建，其 React effects 晚于 apply 执行；
    // Host facade 必须位于同一词法闭包，apply 只负责在 Remote 挂载后赋值。
    let host = null

    const createToolboxClient = () => {
// ===== toolbox-client.js：工具箱框架 Client 半 — 抽屉 + Tab 栏 + 通用 HTML 面板壳 =====
// 工具列表经 host.call(RT.rpc('tools')) 轮询（1.5s，抽屉打开时）；
// 面板内容经 host.call(RT.rpc('panel')) 获取 HTML 片段 + 状态回传；
// 面板内交互：点击 [data-action]，表单输入收集 [data-field] 一并回传。

return {
  name: 'toolbox',
  inject: ['timer'],
  apply(ctx) {
    // ===== 命名空间（TOOLBOX_RUNTIME 由拼接的 shared/runtime.js 提供；动态默认=历史名称）=====
    const RT = TOOLBOX_RUNTIME
    // 进程级单例（bundle 级）：页面已有本 bundle 主实例的抽屉时，本会话 Client 半空转——避免重复注册
    // sidebar.footer.action / shell.overlay 造成双抽屉。marker 值为空格分隔的 bundleId 列表
    // （多 bundle 同进程各挂各的抽屉，互不抢占）；标记随 fiber 卸载只移除自己那一份。
    const myDomId = RT.domMountedValue()
    if (typeof document !== 'undefined' && document.body) {
      const cur = (document.body.getAttribute('data-dsh-toolbox-mounted') || '').split(/\s+/).filter(Boolean)
      if (cur.indexOf(myDomId) >= 0) {
        console.log('toolbox: 页面已存在本工具箱抽屉（另一会话的主实例），本会话 Client 半跳过')
        return
      }
      document.body.setAttribute('data-dsh-toolbox-mounted', cur.concat([myDomId]).join(' '))
      ctx.effect(() => () => {
        try {
          if (!document.body) return
          const rest = (document.body.getAttribute('data-dsh-toolbox-mounted') || '').split(/\s+/).filter((v) => v && v !== myDomId)
          if (rest.length) document.body.setAttribute('data-dsh-toolbox-mounted', rest.join(' '))
          else document.body.removeAttribute('data-dsh-toolbox-mounted')
        } catch (e) {}
      })
    }
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const themeSvc = ctx.get('theme')

    // ===== localStorage 变化事件桥（v6.5）=====
    // app-shell 每次切会话都会写 localStorage['dsh.sessions.current']（浏览器全局权威）。
    // 抽屉主实例挂在宿主会话下，useSessions 不响应 UI 切会话——本桥 patch Storage.setItem，
    // 写入该 key 的瞬间 dispatch 自定义事件，抽屉监听后立即读取（零延迟），替代轮询主路径。
    // 多 bundle 共享同一个 patch（__tbPatched 守卫 + __tbEvents 订阅集）：每个 bundle 只 dispatch
    // 自己的事件名；disposer 按订阅移除，最后一个退订时才恢复原始 setItem（引用计数恢复）。
    const SESSION_EVENT = RT.event('session-changed')
    try {
      if (typeof localStorage !== 'undefined' && typeof window !== 'undefined') {
        const proto = Object.getPrototypeOf(localStorage)
        let orig = proto && proto.setItem
        if (orig && orig.__tbPatched && orig.__tbEvents) {
          // 已有其他 bundle 的 patch：只订阅自己的事件名
          orig.__tbEvents.add(SESSION_EVENT)
          const shared = orig
          ctx.effect(() => () => {
            try {
              shared.__tbEvents.delete(SESSION_EVENT)
              if (!shared.__tbEvents.size && proto.setItem === shared && shared.__tbOrig) proto.setItem = shared.__tbOrig
            } catch (e) {}
          })
        } else if (orig && !orig.__tbPatched) {
          const events = new Set([SESSION_EVENT])
          const wrapped = function (k, v) {
            const r = orig.apply(this, arguments)
            try { if (k === 'dsh.sessions.current') { for (const ev of events) window.dispatchEvent(new CustomEvent(ev, { detail: v })) } } catch (e) {}
            return r
          }
          wrapped.__tbPatched = true
          wrapped.__tbEvents = events
          wrapped.__tbOrig = orig
          proto.setItem = wrapped
          ctx.effect(() => () => {
            try {
              events.delete(SESSION_EVENT)
              if (!events.size && proto.setItem === wrapped) proto.setItem = orig
            } catch (e) {}
          })
        }
      }
    } catch (e) {}

    // ===== Cordis 面板「隐藏无界面」联动（v6.6）=====
    // 管理视图「隐藏无界面」开关同时隐藏左下角官方 Cordis 面板里的 Host-only 行并修正
    // 触发按钮的 running 计数：官方行带 data-cordis-row=<pluginId> / data-cordis-awaiting 稳定钩子，
    // 触发按钮带 data-cordis-badge。host-only 集合经 toolbox/plugins 计算（Host 半已有 inventory），
    // MutationObserver 幂等打标隐藏（跳过待审批行）；计数 span 用 data-tb-count + CSS ::after
    // 覆盖——不与 React 文本节点打架。running 计数直接统计面板 DOM 里「可见且 running」的行：
    // 官方 badge 统计整个进程的动态插件，toolbox/plugins 只有当前工具箱的单仓库清单，
    // 用它计算会偏小；面板未打开时行不渲染，官方文本本就是正确的全局值，不覆盖。
    // 开关与管理视图共用、localStorage 持久化，默认开。动态模式保留历史 key；编译 bundle 按 bundleId 隔离。
    const PANEL_HIDE_KEY = RT.bundleId === 'dynamic' ? 'tbx-hide-host-only' : 'tbx-hide-host-only-' + RT.bundleId
    const PANEL_HIDE_TOKEN = RT.domMountedValue()
    const tokenList = (el, attr) => (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean)
    const setOwnToken = (el, attr, on) => {
      const next = tokenList(el, attr).filter((v) => v !== PANEL_HIDE_TOKEN)
      if (on) next.push(PANEL_HIDE_TOKEN)
      if (next.length) el.setAttribute(attr, next.join(' '))
      else el.removeAttribute(attr)
    }
    const panelHide = {
      on: (() => { try { return localStorage.getItem(PANEL_HIDE_KEY) !== '0' } catch (e) { return true } })(),
      headless: new Set(),
    }
    styles.insert([
      'li[data-cordis-row][data-tb-hide~="' + PANEL_HIDE_TOKEN + '"]{display:none!important}',
      '[data-cordis-panel] section[data-tb-hide~="' + PANEL_HIDE_TOKEN + '"]{display:none!important}',
      'button[data-cordis-badge] span[data-tb-count]{font-size:0!important}',
      'button[data-cordis-badge] span[data-tb-count]::after{content:attr(data-tb-count);font-size:12px;line-height:16px}',
    ].join(''))
    function applyPanelHide() {
      if (typeof document === 'undefined' || !document.body) return
      const rows = document.querySelectorAll('li[data-cordis-row]')
      for (const li of rows) {
        const hide = panelHide.on && panelHide.headless.has(li.getAttribute('data-cordis-row')) && !li.hasAttribute('data-cordis-awaiting')
        setOwnToken(li, 'data-tb-hide', hide)
      }
      const panel = document.querySelector('[data-cordis-panel]')
      if (panel) for (const sec of panel.querySelectorAll('section')) {
        const lis = sec.querySelectorAll('li[data-cordis-row]')
        let vis = 0
        for (const li of lis) if (!li.hasAttribute('data-tb-hide')) vis++
        setOwnToken(sec, 'data-tb-hide', lis.length > 0 && vis === 0)
      }
      const badge = document.querySelector('button[data-cordis-badge]')
      if (!badge) return
      // running 计数直接统计面板 DOM 里「可见且 running」的行（官方 badge 是全进程口径，
      // toolbox/plugins 只有单仓库清单，用它计算会偏小）；面板未打开时行不渲染 → 不覆盖，
      // 保持官方全局计数
      let visibleRunning = null
      if (rows.length) {
        visibleRunning = 0
        for (const li of rows) {
          if (!li.hasAttribute('data-tb-hide') && li.getAttribute('data-cordis-status') === 'running') visibleRunning++
        }
      }
      for (const sp of badge.querySelectorAll('span')) {
        if (!/^\s*\d+\s+running\s*$/.test(sp.textContent || '') && !sp.hasAttribute('data-tb-count')) continue
        if (panelHide.on && visibleRunning !== null) {
          const txt = visibleRunning + ' running'
          if (sp.getAttribute('data-tb-count') !== txt) sp.setAttribute('data-tb-count', txt)
        } else if (sp.hasAttribute('data-tb-count')) sp.removeAttribute('data-tb-count')
      }
    }
    let panelHideRaf = 0
    function schedulePanelHide() {
      if (panelHideRaf) return
      panelHideRaf = requestAnimationFrame(() => { panelHideRaf = 0; applyPanelHide() })
    }
    async function refreshPanelHide() {
      try {
        const r = await host.call(RT.rpc('plugins'), {})
        if (!r || !r.ok || !Array.isArray(r.plugins)) return
        panelHide.headless = new Set(r.plugins.filter((p) => !p.hasClientHalf).map((p) => p.pluginId))
        applyPanelHide()
      } catch (e) {}
    }
    function setPanelHideOn(v) {
      panelHide.on = v
      try { localStorage.setItem(PANEL_HIDE_KEY, v ? '1' : '0') } catch (e) {}
      if (v) refreshPanelHide()
      applyPanelHide()
    }
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
      const mo = new MutationObserver(schedulePanelHide)
      mo.observe(document.body, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['data-cordis-awaiting', 'data-cordis-row', 'data-cordis-badge'],
      })
      ctx.effect(() => () => mo.disconnect())
      const phIv = setInterval(() => { if (panelHide.on) refreshPanelHide() }, 4000)
      ctx.effect(() => () => clearInterval(phIv))
      refreshPanelHide()
      applyPanelHide()
    }

    const toolboxCss = [
      '.tb-entry{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;margin:0 4px 0 0;border:1px solid var(--dsw-alias-border-l2,#4a4b55);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#26272e);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12px;font-weight:600;line-height:1;cursor:pointer;white-space:nowrap;appearance:none;box-sizing:border-box;font-family:inherit}',
      '.tb-entry:hover{background:var(--dsw-alias-bg-layer-2,#30313a)}',
      '.tb-entry-active{color:var(--dsw-alias-brand-primary,#3b82f6);border-color:var(--dsw-alias-brand-primary,#3b82f6)}',
      // ---- 侧边栏导航条目（DOM 注入，样式对齐任务看板/SSH 导航行；无 DOM 环境走 Slot 兜底） ----
      '[data-dsh-toolbox-entry]{width:100%;height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:0 12px;font-size:13px;display:flex;font-family:inherit;box-sizing:border-box}',
      '[data-dsh-toolbox-entry]:hover{background:var(--dsw-specific-sidebar-nav-item-hover,var(--dsw-alias-bg-layer-2,#31323b));color:var(--dsw-alias-label-primary)}',
      '[data-dsh-toolbox-entry][data-active]{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-bg-layer-2,#31323b));color:var(--dsw-alias-label-primary);font-weight:600}',
      '.tb-nav-icon{flex:none;display:inline-flex;justify-content:center;align-items:center}',
      '.tb-nav-label{overflow:hidden;text-overflow:ellipsis}',
      '[data-dsh-frame][data-sidebar-collapsed] [data-dsh-toolbox-entry]{justify-content:center;width:100%;padding:0}',
      '[data-dsh-frame][data-sidebar-collapsed] .tb-nav-label{display:none}',
      '.jr-drawer{position:fixed;right:24px;top:64px;z-index:1300;width:520px;max-width:94vw;max-height:calc(100vh - 96px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#17181d);border:1px solid var(--dsw-alias-border-l1,#3a3b44);border-radius:10px;color:var(--dsw-alias-label-primary,#e8e8ea);font-size:13px;pointer-events:auto;box-shadow:-14px 0 44px rgba(0,0,0,.24);animation:jrDrawerIn .16s ease-out;overflow:hidden}',
      '.jr-docked{right:0;top:0;bottom:0;max-height:none;border-radius:0;border-top:none;border-right:none;border-bottom:none;border-left:1px solid var(--dsw-alias-border-l1,#3a3b44);box-shadow:-8px 0 24px rgba(0,0,0,.16)}',
      '.jr-docked .jr-drawer-body{flex:1;min-height:0}',
      // 全占右侧：左侧贴侧边栏右缘（left 由渲染时实测侧边栏给出），上下占满，替代主内容区视图
      // 挤压三栏停靠：抽屉 fixed 右栏（宽度内联给），主内容列 margin-right 让位（见 Drawer 内 effect），左中右并列互不遮挡
      '.jr-docked-full{right:0;top:0;bottom:0;max-height:none;max-width:none;width:auto;border-radius:0;border:none;border-left:1px solid var(--dsw-alias-border-l1,#3a3b44);box-shadow:none;animation:jrDrawerIn .16s ease-out}',
      '.jr-docked-full .jr-drawer-body{flex:1;min-height:0}',
      '@keyframes jrDrawerIn{from{transform:translateX(28px);opacity:.3}to{transform:translateX(0);opacity:1}}',
      '.jr-drawer-header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3b44);background:var(--dsw-alias-bg-base,#17181d);cursor:move;user-select:none}',
      '.jr-drawer-title{font-weight:600;flex:1;font-size:14px}',
      '.jr-overlay-close{width:30px;height:30px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9aa5);cursor:pointer;border-radius:6px;padding:0}',
      '.jr-overlay-close:hover{color:var(--dsw-alias-label-primary,#e8e8ea);background:var(--dsw-alias-bg-layer-2,#30313a)}',
      '.jr-drawer-body{padding:14px;overflow:auto;display:flex;flex-direction:column;gap:12px}',
      // ---- 抽屉内滚动条统一接管：轨道透明（融入面板背景），thumb 用边框色；Webkit + Firefox 双写 ----
      '.jr-drawer *{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#454650) transparent}',
      '.jr-drawer ::-webkit-scrollbar{width:9px;height:9px}',
      '.jr-drawer ::-webkit-scrollbar-track{background:transparent}',
      '.jr-drawer ::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#454650);border-radius:5px;border:2px solid transparent;background-clip:padding-box}',
      '.jr-drawer ::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-tertiary,#6f707c);border:2px solid transparent;background-clip:padding-box}',
      '.jr-drawer ::-webkit-scrollbar-corner{background:transparent}',
      '.jr-tabpanel{display:flex;flex-direction:column;gap:12px}',
      // ---- 三段式导航条（搜索整行 / 分类行 / 分类下工具行；分类与工具行横向滚动 + 滚轮横移见 HRow） ----
      '.tb-nav{display:flex;flex-direction:column;gap:8px;padding:10px 14px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3b44);flex:none}',
      '.tb-nav-search{flex:none;width:100%}',
      '.tb-hrow{display:flex;gap:6px;overflow-x:auto;scrollbar-width:thin}',
      '.tb-cats{padding-bottom:2px}',
      '.tb-tools{padding-bottom:9px}',
      '.tb-hrow-empty{flex:none;color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:11.5px;padding:2px 2px 10px}',
      '.tb-tab{flex:none;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;appearance:none;font-family:inherit}',
      // ---- 管理页树（分类节点 → 插件节点；分类头可折叠、可接拖放） ----
      '.tb-tree-cat{display:flex;align-items:center;gap:7px;height:26px;padding:0 6px;border-radius:6px;cursor:pointer;user-select:none;border:1px dashed transparent;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-tree-cat:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b))}',
      '.tb-tree-cat-drop{border-color:var(--tb-accent-border,rgba(91,141,239,.5));background:var(--tb-accent-bg,rgba(91,141,239,.08))}',
      '.tb-tree-chev{width:12px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));transition:transform .12s}',
      '.tb-tree-cat-open>.tb-tree-chev{transform:rotate(90deg)}',
      '.tb-tree-cat-label{font-size:12px;font-weight:700;letter-spacing:.3px}',
      '.tb-tree-kids{display:flex;flex-direction:column;gap:6px;padding:2px 0 6px 19px}',
      '.tb-drag{flex:none;cursor:grab;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:11px;letter-spacing:1px;line-height:1}',
      '.tb-tab:hover{background:var(--dsw-alias-bg-layer-2,#30313a);color:var(--dsw-alias-label-primary,#e8e8ea)}',
      '.tb-tab-active{color:var(--dsw-alias-brand-primary,#3b82f6);border-color:var(--dsw-alias-border-l2,#4a4b55);background:var(--dsw-alias-bg-layer-1,#26272e)}',
      // ---- Tab 忙碌转圈（替代面板内「处理中…」横幅，操作期间面板内容保持不动） ----
      '.tb-tab-spin{display:inline-block;width:10px;height:10px;border:1.5px solid var(--tb-accent-border,rgba(91,141,239,.35));border-top-color:var(--tb-accent,#3f6fd9);border-radius:50%;animation:tbSpin .7s linear infinite}',
      // ---- Tab 角标（工具经 data-tab-badge 声明；如流程图节点数 / 配额余量） ----
      '.tb-tab-badge{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 4px;border-radius:999px;font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums;background:var(--tb-accent-bg,rgba(91,141,239,.16));color:var(--tb-accent-text,#7fa7f0);border:1px solid var(--tb-accent-border,rgba(91,141,239,.35))}',
      '@keyframes tbSpin{to{transform:rotate(360deg)}}',
      '.tb-empty{color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:12px;text-align:center;padding:26px 0;line-height:1.7}',
      '.jr-snap-indicator{position:fixed;right:0;top:0;bottom:0;width:4px;background:var(--dsw-alias-brand-primary,#3b82f6);opacity:.65;z-index:1299;pointer-events:none}',
      '.jr-resize-left{position:absolute;left:0;top:0;bottom:0;width:6px;cursor:col-resize;z-index:6;touch-action:none}',
      '.jr-resize-left:hover{background:rgba(59,130,246,.28)}',
      '.jr-resize-right{position:absolute;top:0;right:0;bottom:0;width:6px;cursor:ew-resize;z-index:6;touch-action:none}',
      '.jr-resize-right:hover{background:rgba(59,130,246,.28)}',
      '.jr-resize-bottom{position:absolute;left:0;right:0;bottom:0;height:6px;cursor:ns-resize;z-index:6;touch-action:none}',
      '.jr-resize-bottom:hover{background:rgba(59,130,246,.28)}',
      '.jr-resize-corner{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:6;touch-action:none}',
      '.jr-resize-corner:hover{background:rgba(59,130,246,.22);border-radius:0 0 10px 0}',
      '.jr-resize-badge{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);padding:5px 12px;border:1px solid var(--dsw-alias-border-l2,#4a4b55);border-radius:6px;background:var(--dsw-alias-bg-overlay,#1e1f24);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12px;font-variant-numeric:tabular-nums;z-index:1310;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.3)}',
      '.tb-frame{position:relative;display:flex;flex-direction:column;gap:10px;min-height:0}',
      // ---- 画中画（Document PiP）：主抽屉 DOM 的实时镜像窗口（脱离 WebUI 框体） ----
      '.jr-pip-root{display:flex;flex-direction:column;height:100vh;background:var(--dsw-alias-bg-base,#17181d);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:13px;overflow:hidden;font-family:inherit}',
      '.jr-pip-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3b44);background:var(--dsw-alias-bg-layer-1,#26272e)}',
      '.jr-pip-bar-title{flex:1;min-width:0;font-size:11.5px;color:var(--dsw-alias-label-secondary,#9a9aa5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.jr-pip-bar-btn{flex:none;height:24px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#454650);background:transparent;color:var(--dsw-alias-label-primary,#e8e8ea);font-size:11.5px;cursor:pointer;font-family:inherit}',
      '.jr-pip-bar-btn:hover{background:var(--dsw-alias-bg-layer-2,#30313a)}',
      // 镜像容器：抽屉克隆充满窗口；拖拽把手/吸附指示/尺寸徽章在 pip 里无意义隐藏
      '.jr-pip-mirror{flex:1;min-height:0;overflow:hidden;position:relative}',
      '.jr-pip-mirror .jr-drawer{display:flex}',
      '.jr-pip-mirror .jr-resize-left,.jr-pip-mirror .jr-resize-right,.jr-pip-mirror .jr-resize-bottom,.jr-pip-mirror .jr-resize-corner,.jr-pip-mirror .jr-snap-indicator,.jr-pip-mirror .jr-resize-badge{display:none}',
      '.jr-pip-root *{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#454650) transparent}',
      '.jr-pip-root ::-webkit-scrollbar{width:9px;height:9px}',
      '.jr-pip-root ::-webkit-scrollbar-track{background:transparent}',
      '.jr-pip-root ::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#454650);border-radius:5px;border:2px solid transparent;background-clip:padding-box}',
      '.tb-notice{color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:12px;text-align:center;padding:8px 0}',
      '.tb-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;white-space:pre-wrap;word-break:break-word;border:1px solid var(--dsw-alias-border-l1,#3a3b44);border-radius:6px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1,#26272e)}',
      // ===== 共享设计系统（tb-）：工具面板 HTML 直接使用；颜色只消费 --tb-* 变量（带兜底），主题插件在 :root 声明即可覆盖 =====
      '.tb-root{font-size:12.5px;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-root *{box-sizing:border-box}',
      // ---- 按钮（!important 压宿主全局按钮样式） ----
      '.tb-btn{display:inline-flex;align-items:center;justify-content:center;height:var(--tb-ctl-h-sm,26px);padding:0 11px;border-radius:6px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650))!important;background:transparent!important;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))!important;font-size:12px;font-weight:500;font-family:inherit;line-height:1;cursor:pointer;white-space:nowrap;appearance:none;-webkit-appearance:none;outline:none;margin:0;box-shadow:none;text-shadow:none;transition:background .12s,border-color .12s,color .12s}',
      '.tb-btn:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b))!important}',
      '.tb-btn:active{transform:translateY(1px)}',
      '.tb-btn:disabled{opacity:.4;cursor:default;transform:none}',
      '.tb-btn-primary{background:var(--tb-accent,#3f6fd9)!important;border-color:var(--tb-accent,#3f6fd9)!important;color:#fff!important}',
      '.tb-btn-primary:hover{background:var(--tb-accent-hover,#4c7ceb)!important;border-color:var(--tb-accent-hover,#4c7ceb)!important}',
      '.tb-btn-ghost{border-color:transparent!important;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))!important}',
      '.tb-btn-ghost:hover{color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))!important}',
      '.tb-btn-danger-ghost{border-color:transparent!important;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))!important}',
      '.tb-btn-danger-ghost:hover{background:var(--tb-danger-bg,rgba(239,83,80,.1))!important;color:var(--tb-danger-text,#f28b82)!important}',
      '.tb-btn-sm{height:23px;padding:0 8px;font-size:11.5px}',
      // ---- 输入（控件高度统一走 token：--tb-ctl-h 标准高 / --tb-ctl-h-sm 紧凑高，主题可覆盖） ----
      // flex:1 1 auto —— 曾经 flex:1（basis 0%）在纵向 flex（.tb-sec）里把 height 压成内容高（Cron/评审/提交信息/正则的输入框变矮），auto 基准则行列两相宜
      '.tb-query{display:flex;gap:8px;align-items:center}',
      '.tb-query .tb-btn{height:var(--tb-ctl-h,30px)}',
      '.tb-input{flex:1 1 auto;min-width:0;height:var(--tb-ctl-h,30px);padding:0 11px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:12.5px;outline:none;font-family:inherit;caret-color:var(--tb-accent,#3f6fd9);transition:border-color .12s,box-shadow .12s}',
      '.tb-input:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      '.tb-input:focus{border-color:var(--tb-accent,#3f6fd9);box-shadow:0 0 0 3px var(--tb-accent-ring,rgba(91,141,239,.16))}',
      '.tb-input::placeholder{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      // ---- 多行输入 ----
      '.tb-textarea{width:100%;min-height:62px;padding:8px 11px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:12px;font-family:ui-monospace,Consolas,monospace;line-height:1.55;outline:none;resize:vertical;box-sizing:border-box;caret-color:var(--tb-accent,#3f6fd9)}',
      '.tb-textarea:focus{border-color:var(--tb-accent,#3f6fd9);box-shadow:0 0 0 3px var(--tb-accent-ring,rgba(91,141,239,.16))}',
      '.tb-textarea::placeholder{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      // ---- 下拉 ----
      '.tb-select{height:var(--tb-ctl-h-sm,26px);padding:0 8px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:12px;font-family:inherit;outline:none;cursor:pointer}',
      // ---- 芯片组（单选/开关） ----
      '.tb-chips{display:flex;gap:5px;flex-wrap:wrap}',
      '.tb-chip{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;font-family:inherit;transition:border-color .12s,color .12s,background .12s}',
      '.tb-chip:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-chip-on{background:var(--tb-accent-bg,rgba(91,141,239,.14));border-color:var(--tb-accent-border,rgba(91,141,239,.45));color:var(--tb-accent-text,#7fa7f0)}',
      // ---- 统计行 ----
      '.tb-stats{display:flex;gap:8px;flex-wrap:wrap}',
      '.tb-stat{flex:1;min-width:70px;display:flex;flex-direction:column;gap:2px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;padding:7px 10px}',
      '.tb-stat-num{font-size:15px;font-weight:700;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-variant-numeric:tabular-nums}',
      '.tb-stat-label{font-size:10.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      // ---- 分栏面板（固定头 + 时间线独立滚动）----
      // :has() 作用域化：只有含 .tb-pane 的 tab 启用高度链，其他工具保持整页滚动不变；
      // .tb-pane-body 用 column-reverse —— DOM 最新在前 ⇒ 视觉越往下越新，且滚动条默认停在底部
      '.jr-drawer-body:has(.tb-pane){overflow:hidden}',
      '.tb-frame:has(.tb-pane){flex:1;min-height:0;overflow:hidden}',
      '.tb-frame:has(.tb-pane)>div{flex:1;min-height:0;display:flex;flex-direction:column}',
      '.tb-pane{position:relative;display:flex;flex-direction:column;flex:1;min-height:0;gap:10px;overflow:hidden}',
      '.tb-pane-head{flex:none;display:flex;flex-direction:column;gap:10px}',
      '.tb-pane-body{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column-reverse;gap:4px;padding-right:4px}',
      // 正常方向变体（默认 column-reverse 是给轨迹的「最新在底、滚动条默认底部」；其他分栏工具用 tb-pane-col）
      '.tb-pane-col{flex-direction:column}',
      // ---- 横幅 ----
      '.tb-banner{padding:7px 11px;border-radius:6px;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;border:1px solid}',
      '.tb-banner-error{color:var(--tb-danger-text,#f2b8b5);background:var(--tb-danger-bg,rgba(239,83,80,.07));border-color:var(--tb-danger-border,rgba(239,83,80,.25))}',
      '.tb-banner-info{color:var(--tb-ok-text,#a5d6a7);background:var(--tb-ok-bg,rgba(102,187,106,.07));border-color:var(--tb-ok-border,rgba(102,187,106,.25))}',
      // ---- 状态点 + pill ----
      '.tb-dot{flex:none;width:6px;height:6px;border-radius:50%}',
      '.tb-dot-done{background:var(--tb-done,#66bb6a)}',
      '.tb-dot-active{background:var(--tb-active,#5b8def)}',
      '.tb-dot-todo{background:var(--tb-muted,#8a8b96)}',
      '.tb-dot-other{background:var(--tb-warn,#d4a72c)}',
      '.tb-pill{display:inline-flex;align-items:center;gap:5px;height:19px;padding:0 8px;border-radius:999px;font-size:11px;border:1px solid;white-space:nowrap}',
      '.tb-pill-done{color:var(--tb-done-text,#81c784);border-color:var(--tb-done-border,rgba(102,187,106,.35))}',
      '.tb-pill-active{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-active-border,rgba(91,141,239,.4))}',
      '.tb-pill-todo{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));border-color:var(--tb-muted-border,rgba(138,139,150,.35))}',
      '.tb-pill-other{color:var(--tb-warn-text,#d4b95c);border-color:var(--tb-warn-border,rgba(212,167,44,.4))}',
      '.tb-pill-warn{color:var(--tb-warn-text,#d4b95c);border-color:var(--tb-warn-border,rgba(212,167,44,.4))}', // 语义同 other（警示黄）；轨迹「命令」类等需要语义名的场景用
      '.tb-pill-plain{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));border-color:var(--tb-border-2,var(--dsw-alias-border-l2,#454650))}',
      // 可点 pill（管理视图「重启后」默认启停）：幽灵虚线弱化存在感，悬停/开启才上 accent，与展示型 pill 拉开层级
      '.tb-pill-btn{display:inline-flex;align-items:center;gap:5px;height:19px;padding:0 8px;border-radius:999px;font-size:11px;white-space:nowrap;font-family:inherit;line-height:1;background:transparent;border:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650));color:var(--tb-text-3,#8b8c96);cursor:pointer}',
      '.tb-pill-btn:hover{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-active-border,rgba(91,141,239,.4))}',
      '.tb-pill-btn.on{color:var(--tb-active-text,#7fa7f0);border:1px solid var(--tb-active-border,rgba(91,141,239,.4));background:var(--tb-active-bg,rgba(91,141,239,.08))}',
      // ---- 文本色调 / 通用工具 ----
      '.tb-tx-done{color:var(--tb-done-text,#81c784)}',
      '.tb-tx-active{color:var(--tb-active-text,#7fa7f0)}',
      '.tb-tx-warn{color:var(--tb-warn-text,#d4b95c)}',
      '.tb-tx-danger{color:var(--tb-danger-text,#f28b82)}',
      '.tb-tx-muted{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-mono{font-family:ui-monospace,Consolas,monospace}',
      '.tb-num{font-variant-numeric:tabular-nums;font-size:11px;flex:none}',
      '.tb-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.tb-hr{height:1px;background:var(--tb-border,var(--dsw-alias-border-l1,#35363e))}',
      '.tb-note{font-size:11.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      // ---- 卡片 ----
      '.tb-card{display:flex;flex-direction:column;gap:12px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:10px;padding:13px 14px}',
      '.tb-card-head{display:flex;align-items:flex-start;gap:9px}',
      '.tb-key{flex:none;display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:5px;background:var(--tb-accent-bg,rgba(91,141,239,.12));color:var(--tb-accent-text,#7fa7f0);font-family:ui-monospace,Consolas,monospace;font-size:11px;font-weight:600;letter-spacing:.3px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tb-title{flex:1;min-width:0;font-size:13.5px;font-weight:600;line-height:1.5;word-break:break-word}',
      '.tb-pills{display:flex;flex-wrap:wrap;gap:6px}',
      '.tb-meta{display:grid;grid-template-columns:1fr 1fr;gap:7px 14px}',
      '.tb-meta-item{display:flex;flex-direction:column;gap:1px;min-width:0}',
      '.tb-meta-label{font-size:10.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-meta-value{font-size:12px;word-break:break-word}',
      '.tb-sec{display:flex;flex-direction:column;gap:6px}',
      '.tb-sec-label{font-size:10.5px;font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));letter-spacing:.5px}',
      '.tb-desc{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.7;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:6px;padding:9px 11px;max-height:220px;overflow:auto}',
      '.tb-code{white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.5;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:6px;padding:9px 11px;max-height:420px;overflow:auto;margin:0;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      // ---- 行（状态字母 + 路径） ----
      '.tb-line{display:flex;gap:8px;align-items:baseline;padding:1px 0;font-size:12px}',
      '.tb-line-status{width:14px;text-align:center;font-weight:600;flex:none;font-family:ui-monospace,Consolas,monospace}',
      '.tb-line-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace}',
      // ---- 文件/附件行 ----
      '.tb-files{display:flex;flex-direction:column}',
      '.tb-file{display:flex;align-items:center;gap:9px;padding:6px 7px;margin:0 -7px;border-radius:6px;cursor:pointer;transition:background .12s}',
      '.tb-file:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33))}',
      '.tb-ext{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:18px;padding:0 5px;border-radius:4px;font-size:9.5px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;font-family:ui-monospace,Consolas,monospace;border:1px solid}',
      '.tb-ext-img{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-active-border,rgba(91,141,239,.4));background:var(--tb-accent-bg,rgba(91,141,239,.1))}',
      '.tb-ext-doc{color:var(--tb-done-text,#81c784);border-color:var(--tb-done-border,rgba(102,187,106,.35));background:var(--tb-ok-bg,rgba(102,187,106,.08))}',
      '.tb-ext-zip{color:var(--tb-warn-text,#d4b95c);border-color:var(--tb-warn-border,rgba(212,167,44,.35));background:rgba(212,167,44,.08)}',
      '.tb-ext-gen{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));border-color:var(--tb-muted-border,rgba(138,139,150,.3))}',
      '.tb-file-name{flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tb-file:hover .tb-file-name{color:var(--tb-accent-text,#7fa7f0)}',
      '.tb-file-meta{flex:none;font-size:11px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-file-act{flex:none;font-size:11px;color:var(--tb-accent,#3f6fd9);opacity:0;transition:opacity .12s}',
      '.tb-file:hover .tb-file-act{opacity:1}',
      // ---- 预览 ----
      '.tb-preview{display:flex;flex-direction:column;gap:8px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;padding:10px}',
      '.tb-preview-head{display:flex;align-items:center;gap:8px}',
      '.tb-preview-name{flex:1;min-width:0;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tb-preview-img{display:block;max-width:100%;max-height:320px;border-radius:6px;margin:0 auto}',
      // ---- 记录/提交列表 ----
      '.tb-list-head{display:flex;align-items:center;gap:4px}',
      '.tb-list-title{flex:1;display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));letter-spacing:.4px}',
      '.tb-count{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:15px;padding:0 4px;border-radius:999px;background:var(--tb-accent-bg,rgba(91,141,239,.14));color:var(--tb-accent-text,#7fa7f0);font-size:10px;font-weight:700;font-variant-numeric:tabular-nums}',
      '.tb-list{display:flex;flex-direction:column;gap:4px}',
      '.tb-rec{display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;cursor:pointer;transition:background .12s,border-color .12s}',
      '.tb-rec:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33))}',
      '.tb-rec-active{border-color:var(--tb-accent-border,rgba(91,141,239,.5))}',
      '.tb-rec-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.tb-rec-top{display:flex;align-items:center;gap:8px;min-width:0}',
      '.tb-rec-key{flex:none;font-family:ui-monospace,Consolas,monospace;font-size:11px;font-weight:700;color:var(--tb-accent-text,#7fa7f0);letter-spacing:.3px}',
      '.tb-rec-summary{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tb-rec-sub{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-variant-numeric:tabular-nums;flex-wrap:wrap}',
      '.tb-rec-status{display:inline-flex;align-items:center;gap:5px}',
      '.tb-rec-acts{flex:none;display:flex;gap:2px;opacity:0;transition:opacity .12s}',
      '.tb-rec:hover .tb-rec-acts,.tb-rec-active .tb-rec-acts{opacity:1}',
      // ---- 文件树（chevron 旋转 + 文件夹/文件图标 + 展开态高亮） ----
      '.tb-tree{display:flex;flex-direction:column;gap:1px;font-size:12.5px}',
      '.tb-tree-row{display:flex;align-items:center;gap:6px;height:24px;padding:0 8px 0 2px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:background .1s;user-select:none}',
      '.tb-tree-row:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33))}',
      '.tb-tree-dir{color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-tree-dir .tb-tree-name{font-weight:600}',
      '.tb-tree-open>.tb-tree-chevron svg{transform:rotate(90deg)}',
      '.tb-tree-open>.tb-tree-ic{color:var(--tb-accent-text,#7fa7f0)}',
      '.tb-tree-file{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));cursor:default}',
      '.tb-tree-chevron{width:12px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-tree-chevron svg{transition:transform .12s}',
      '.tb-tree-ic{width:15px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-tree-dir>.tb-tree-ic{color:var(--tb-accent-text,#7fa7f0);opacity:.85}',
      '.tb-tree-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.tb-tree-size{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:11px;min-width:56px;text-align:right;flex:none;font-variant-numeric:tabular-nums}',
      // ---- 空状态 ----
      '.tb-empty{display:flex;flex-direction:column;align-items:center;gap:5px;padding:26px 14px;border:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:8px;text-align:center}',
      '.tb-empty-glyph{width:30px;height:30px;border-radius:8px;border:1px solid var(--tb-accent-border,rgba(91,141,239,.3));display:flex;align-items:center;justify-content:center;margin-bottom:3px}',
      '.tb-empty-glyph svg{stroke:var(--tb-accent,#3f6fd9)}',
      '.tb-empty-title{font-size:12px;font-weight:600;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))}',
      '.tb-empty-sub{font-size:11px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      // ---- 管理视图（Tab 显示开关） ----
      '.tb-manage-list{display:flex;flex-direction:column;gap:6px}',
      '.tb-manage-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px}',
      '.tb-manage-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.tb-manage-label{font-size:12.5px;font-weight:600;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-manage-id{font-size:10.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-family:ui-monospace,Consolas,monospace}',
      '.tb-switch{position:relative;width:34px;height:19px;flex:none;border-radius:999px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));cursor:pointer;padding:0;appearance:none;outline:none;transition:background .15s,border-color .15s}',
      '.tb-switch::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));transition:transform .15s,background .15s}',
      '.tb-switch-on{background:var(--tb-accent,#3f6fd9);border-color:var(--tb-accent,#3f6fd9)}',
      '.tb-switch-on::after{transform:translateX(15px);background:#fff}',
      // ===== 流程图（flow 工具；fl- 前缀）=====
      // 主干：自上而下节点 + 向下箭头；子代理：git 树分支（├─ │ ╰─）；普通工具组：向右分支（├▶ ╰▶）
      // 卡片自适应宽度（不占满，凸显左右分支结构）；入/出两行展示调用的传入与返回
      '.fl-row{display:flex;min-width:0}',
      '.fl-node{max-width:520px;min-width:0;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-left-width:2px;border-radius:8px;padding:7px 10px;display:flex;flex-direction:column;gap:3px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));box-shadow:0 2px 8px rgba(0,0,0,.18)}',
      // 消息卡可点开详情（与工具卡同一交互）：手势 + 选中高亮
      '.fl-node[data-action]{cursor:pointer;transition:border-color .12s}',
      '.fl-node[data-action]:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      // 选中高亮：tint 叠在实色底上（直接用半透明 accent 底会被身后主干线穿透）
      '.fl-node.fl-on{border-color:var(--tb-accent-border,rgba(91,141,239,.6));background:linear-gradient(var(--tb-accent-bg,rgba(91,141,239,.08)),var(--tb-accent-bg,rgba(91,141,239,.08))),var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e))}',
      '.fl-model{flex:none;font-size:10px;font-family:ui-monospace,Consolas,monospace;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));background:var(--dsw-alias-bg-base,#17181d);border-radius:3px;padding:1px 5px}',
      '.fl-glyph{flex:none;font-size:9px;line-height:1;opacity:.9}',
      '.fl-node-head{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      '.fl-tag{flex:none;display:inline-flex;align-items:center;height:17px;padding:0 6px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.3px}',
      '.fl-time{flex:none;font-size:10.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-variant-numeric:tabular-nums}',
      '.fl-preview{font-size:12px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));max-width:500px}',
      // ▼ 箭头自带画布底色块：主干竖线从下方穿过时字形不被线划过
      // （不用整体 opacity——色块必须 100% 不透明才盖得住线；字形色与线同 token，箭头实一点正好突出）
      '.fl-arrow{flex:none;align-self:center;line-height:1;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:10px;background:var(--dsw-alias-bg-base,#17181d);padding:0 3px;border-radius:3px}',
      // 泳道内连接符：上=弹性空隙（::before 主干线透出，长短随行高自适应）+ ▼ 贴内容顶；下=对称弹性空间保持卡片居中
      '.fl-conn{flex:1;min-height:16px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-width:0}',
      '.fl-conn-gap{flex:1;min-height:4px}',
      // 流程图画布：bg-base 实色 + blueprint 网格线（中性灰蓝极低透明，明暗两主题均隐约可见；实色底防透明皮肤重影）
      '.jr-drawer [data-flow] .tb-pane-body{background:var(--dsw-alias-bg-base,#17181d);border-radius:8px;background-image:linear-gradient(rgba(128,138,150,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(128,138,150,.055) 1px,transparent 1px);background-size:22px 22px}',
      '.fl-par{flex:1;display:flex;flex-direction:column;gap:10px;min-width:0}',
      '.fl-name{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;font-weight:700;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fl-args{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // ---- 三列泳道（手绘参考图 2：左=子代理分支区 / 中=主干用户·助手 / 右=工具调用卡） ----
      '.fl-lane{display:grid;grid-template-columns:minmax(96px,140px) minmax(0,1fr) minmax(0,1.25fr);gap:0 10px;min-width:0;align-items:stretch}',
      '.fl-lane-main{min-width:0;display:flex;flex-direction:column;justify-content:center;position:relative}',
      // 主干竖线贯通：每行中列全高画线，且向下多延 4px 盖住容器行间距（gap:4px），行间首尾相接成一条连续线；
      // 卡片不透明底自然盖线、只在空隙露出；线色与 ▼ 箭头一致（text-3 + .7 透明度），2.5px
      '.fl-lane-main::before{content:"";position:absolute;left:calc(50% - 1.25px);top:0;bottom:-4px;width:2.5px;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));opacity:.7;z-index:0}',
      '.fl-lane-main>*{position:relative;z-index:1}',
      '.fl-lane-main .fl-node{max-width:none}',
      '.fl-lane-side{min-width:0;display:grid;grid-template-columns:84px minmax(0,1fr);gap:6px 8px;align-items:center}',
      // 并行调用组外框：同一步骤 >1 个调用时虚线框圈成一组，右上「并行 ×N」角标（底色盖边框）
      '.fl-lane-side.fl-grp{position:relative;border:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:10px;padding:10px 10px;margin:4px 0}',
      '.fl-grp-tag{position:absolute;top:-7px;right:10px;padding:0 5px;font-size:9px;line-height:13px;font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));background:var(--dsw-alias-bg-base,#17181d);border-radius:3px;letter-spacing:.3px}',
      '.fl-lane-line{width:2.5px;align-self:center;flex:1;min-height:26px;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));opacity:.7}',
      // 子代理分支块（左列）：height:0+min-height:100% 经典技巧——分支不参与行高计算（行高由中列主干决定），
      // 自身拉伸进行高：入口贴顶、支线步骤中间限高滚动、出口贴底（= 中列最后一张卡下缘，对齐语义）；卡片右缘伸横线向主干
      '.fl-subcol{display:flex;flex-direction:column;gap:5px;min-width:0;height:0;min-height:100%}',
      // 分支行保底高度：中列只有一根竖线时（孤立分支行）分支不被压没
      '.fl-lane:has(> .fl-subcol){min-height:120px}',
      '.fl-sub-card{position:relative;flex:none;border:1px solid var(--tb-accent-border,rgba(91,141,239,.45));border-radius:8px;padding:5px 8px;background:var(--tb-accent-bg,rgba(91,141,239,.08));display:flex;flex-direction:column;gap:3px;min-width:0;cursor:pointer}',
      '.fl-sub-card::after{content:"";position:absolute;right:-11px;top:50%;width:10px;height:1px;background:var(--tb-accent-border,rgba(91,141,239,.45))}',
      '.fl-sub-steps{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:3px 4px 3px 8px;margin-left:6px;border-left:1px dashed var(--tb-accent-border,rgba(91,141,239,.4))}',
      // 出口卡贴底（支线步骤区 flex 填充把出口压到底部，与返回后的主干卡对齐）
      '.fl-sub-close{margin-top:auto}',
      '.fl-sub-meta{display:flex;align-items:center;gap:6px}',
      '.fl-sub-step{display:flex;align-items:center;gap:4px;min-width:0;font-size:10.5px}',
      '.fl-sub-io{display:flex;align-items:baseline;gap:5px;font-family:ui-monospace,Consolas,monospace;font-size:10.5px;min-width:0}',
      '.fl-wp{display:flex;flex-direction:column;justify-content:center;gap:10px;min-width:0}',
      '.fl-wl{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.fl-wl-txt{font-family:ui-monospace,Consolas,monospace;font-size:9px;line-height:1.2;color:var(--tb-accent-text,#7fa7f0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fl-wl-row{position:relative;display:flex;align-items:center;gap:3px;height:8px}',
      '.fl-wl-line{flex:1;height:1px;min-width:8px;background:var(--tb-accent-border,rgba(91,141,239,.45))}',
      '.fl-wl-arr{flex:none;font-size:7px;line-height:1;color:var(--tb-accent-border,rgba(91,141,239,.6))}',
      '.fl-wl-b .fl-wl-txt{color:var(--tb-done-text,#81c784)}',
      '.fl-wl-b .fl-wl-line{background:rgba(102,187,106,.45)}',
      '.fl-wl-b .fl-wl-arr{color:rgba(102,187,106,.6)}',
      '.fl-wl-err .fl-wl-txt{color:var(--tb-danger-text,#f28b82)}',
      '.fl-wl-err .fl-wl-line{background:rgba(239,83,80,.5)}',
      '.fl-wl-err .fl-wl-arr{color:rgba(239,83,80,.6)}',
      '.fl-wl-wait .fl-wl-txt{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-wl-wait .fl-wl-line{background:transparent;border-top:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650))}',
      '.fl-callside{min-width:0;display:flex;flex-direction:column;gap:4px;justify-content:center}',
      '.fl-iocard{width:auto;max-width:none;min-width:0;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:9px;padding:6px 10px;display:flex;flex-direction:column;gap:3px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.18);transition:border-color .12s,box-shadow .12s}',
      '.fl-iocard:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      '.fl-iocard.fl-on{border-color:var(--tb-accent-border,rgba(91,141,239,.6));background:var(--tb-accent-bg,rgba(91,141,239,.08))}',
      '.fl-iocard.fl-err{border-color:var(--tb-danger-border,rgba(239,83,80,.5))}',
      '.fl-live{border-color:var(--tb-accent-border,rgba(91,141,239,.65))!important;animation:flPulse 1.6s ease-in-out infinite}',
      // 右侧调用组：输入光点 .5s → 卡片至少流光一圈 1s；输出光点等真实完成态才触发 .5s。
      // 快速调用也先走完输入+一圈流光，慢调用则由 fl-live 接续流光等待结果。
      // 输入能量点沿蓝线左→右；输出能量点沿绿线右→左，不再让整条线同时闪烁。
      '.fl-min-anim>.fl-wl:not(.fl-wl-b)>.fl-wl-row::after{content:"";position:absolute;top:50%;left:0;width:6px;height:3px;border-radius:999px;pointer-events:none;background:var(--tb-accent-text,#7fa7f0);box-shadow:0 0 3px var(--tb-accent-text,#7fa7f0),0 0 7px var(--tb-accent-text,#7fa7f0);animation:flWireTravelRight .5s linear var(--fl-min-delay,0ms) 1 both}',
      '.fl-output-anim>.fl-wl.fl-wl-b>.fl-wl-row::after{content:"";position:absolute;top:50%;right:0;width:6px;height:3px;border-radius:999px;pointer-events:none;background:var(--tb-done-text,#81c784);box-shadow:0 0 3px var(--tb-done-text,#81c784),0 0 7px var(--tb-done-text,#81c784);animation:flWireTravelLeft .5s linear var(--fl-output-delay,0ms) 1 both}',
      '.fl-min-anim .fl-iocard{position:relative;border-color:var(--tb-accent-border,rgba(91,141,239,.65))!important}',
      // 固定序列期间压住原有的卡片/状态点循环脉冲，避免它与输入、流光、输出三个阶段并发。
      '.fl-min-anim .fl-live{animation:none}',
      '.fl-min-anim .fl-live .fl-iohead::before{animation:none;opacity:0}',
      // 主线用户/助手卡：新出现时固定流光一圈；助手仍在进行时，固定圈结束后由 fl-live 接续持续流光。
      '.fl-main-min-anim{position:relative;border-color:var(--tb-accent-border,rgba(91,141,239,.65))!important}',
      // 运行中卡片：渐变流光贴边转圈（conic-gradient 环形遮罩 + 角度动画）。
      // @property 驱动角度 → 亮段沿边框流动；mask-composite 裁出 1.5px 描边环，内容不被遮。
      // 不支持 mask-composite / @property 的环境走 @supports 整体降级为原有脉冲。
      '.fl-live{position:relative}',
      '@supports (mask-composite: exclude) or (-webkit-mask-composite: xor){' +
        '.fl-live::before,.fl-min-anim .fl-iocard::before,.fl-main-min-anim::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1.5px;' +
        'background:conic-gradient(from var(--fl-sweep,0deg),transparent 0deg,rgba(127,167,240,.9) 55deg,transparent 135deg);' +
        '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;' +
        'mask-composite:exclude;pointer-events:none}' +
        '.fl-live::before{animation:flSweep 1s linear infinite}' +
        '.fl-min-anim .fl-iocard::before{opacity:0;animation:flMinSweep 1s linear calc(500ms + var(--fl-min-delay,0ms)) 1 both}' +
        '.fl-main-min-anim::before{animation:flSweep 1s linear var(--fl-main-delay,0ms) 1 both}' +
        // 日模式（浅色）下加深加宽亮段，流光同样明显
        'body:not([data-ds-dark-theme]) .fl-live::before,body:not([data-ds-dark-theme]) .fl-min-anim .fl-iocard::before,body:not([data-ds-dark-theme]) .fl-main-min-anim::before{' +
        'background:conic-gradient(from var(--fl-sweep,0deg),transparent 0deg,rgba(43,102,240,.95) 80deg,transparent 165deg)}' +
      '}',
      '@property --fl-sweep{syntax:"<angle>";initial-value:0deg;inherits:false}',
      '@keyframes flSweep{to{--fl-sweep:360deg}}',
      '@keyframes flMinSweep{0%{opacity:0;--fl-sweep:0deg}.1%{opacity:1;--fl-sweep:0deg}99.9%{opacity:1;--fl-sweep:360deg}100%{opacity:0;--fl-sweep:360deg}}',
      '@keyframes flWireTravelRight{0%{opacity:0;left:0;transform:translateY(-50%) scale(.7)}10%{opacity:1}90%{opacity:1}100%{opacity:0;left:calc(100% - 6px);transform:translateY(-50%) scale(1)}}',
      '@keyframes flWireTravelLeft{0%{opacity:0;right:0;transform:translateY(-50%) scale(.7)}10%{opacity:1}90%{opacity:1}100%{opacity:0;right:calc(100% - 6px);transform:translateY(-50%) scale(1)}}',
      // LIVE 脉冲点（进行中调用卡头部，蓝图风）
      '.fl-live .fl-iohead::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--tb-done-text,#81c784);animation:flBlink 1.1s ease-in-out infinite}',
      // 助手卡进行中同款流光 + 脉冲点（与工具卡视觉一致）
      '.fl-live .fl-node-head::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--tb-done-text,#81c784);animation:flBlink 1.1s ease-in-out infinite}',
      '@keyframes flBlink{0%,100%{opacity:1}50%{opacity:.25}}',
      '@keyframes flPulse{0%,100%{box-shadow:0 0 0 1.5px var(--tb-accent-ring,rgba(91,141,239,.16))}50%{box-shadow:0 0 0 4px var(--tb-accent-ring,rgba(91,141,239,.16))}}',
      '.fl-iohead{display:flex;align-items:center;gap:6px;min-width:0}',
      '.fl-io-tag{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:3px;font-size:9px;font-weight:700}',
      // 卡片点击展开的完整详情（入=完整传入 JSON / 出=完整返回文本）
      '.fl-detail{display:flex;flex-direction:column;gap:6px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;padding:8px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));max-width:460px;margin-top:2px}',
      '.fl-sec{display:flex;flex-direction:column;gap:3px}',
      '.fl-sec-label{font-size:10px;font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));letter-spacing:.4px}',
      '.fl-pre{white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:10.5px;line-height:1.5;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:6px;padding:6px 8px;max-height:220px;overflow:auto;margin:0;background:var(--dsw-alias-bg-base,#17181d);color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-spin{flex:none;display:inline-block;width:10px;height:10px;border:1.5px solid var(--tb-accent-border,rgba(91,141,239,.35));border-top-color:var(--tb-accent,#3f6fd9);border-radius:50%;animation:tbSpin .7s linear infinite}',
      // ---- 调用详情右侧浮层（不插入流程流撑高内容——展开/收起零跳跃，关闭回原来位置）----
      '.fl-rail{position:absolute;right:0;top:0;bottom:0;width:min(320px,58%);display:flex;flex-direction:column;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));border-left:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));box-shadow:-8px 0 18px rgba(0,0,0,.24);z-index:4;border-radius:0 8px 8px 0}',
      // 动画只在展开动作那次渲染带（轮询重渲染不重播，防详情浮层闪烁）
      '.fl-rail-anim{animation:jrDrawerIn .16s ease-out}',
      '.fl-rail-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));font-size:11px;font-weight:600;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-rail-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace}',
      '.fl-rail-x{flex:none;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));cursor:pointer;border-radius:5px;padding:0;font-size:11px;font-family:inherit}',
      '.fl-rail-x:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-rail-body{flex:1;min-height:0;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px}',
      '.fl-branch-pill{flex:none;font-size:9.5px;padding:0 5px;border-radius:3px;background:rgba(91,141,239,.12);color:var(--tb-active-text,#7fa7f0);font-weight:600}',
      '.fl-branch-txt{flex:1;min-width:0;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fl-branch-ai{font-style:italic}',
    ].join('\n')
    // 编译 bundle 的主 UI 样式以独立 scope 包裹，避免不同 bundle/版本的 .tb-*、.jr-* 互相覆盖。
    // 动态模式保持历史全局样式；导航按钮位于 scope 外，编译模式另补值级选择器。
    styles.insert(RT.bundleId === 'dynamic'
      ? toolboxCss
      : '@scope ([data-dsh-toolbox-scope="' + RT.domValue() + '"]) {\n' + toolboxCss + '\n}')
    if (RT.bundleId !== 'dynamic') {
      const nav = '[data-dsh-toolbox-entry="' + RT.domValue() + '"]'
      styles.insert([
        nav + '{width:100%;height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:0 12px;font-size:13px;display:flex;font-family:inherit;box-sizing:border-box}',
        nav + ':hover{background:var(--dsw-specific-sidebar-nav-item-hover,var(--dsw-alias-bg-layer-2,#31323b));color:var(--dsw-alias-label-primary)}',
        nav + '[data-active]{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-bg-layer-2,#31323b));color:var(--dsw-alias-label-primary);font-weight:600}',
        '[data-dsh-frame][data-sidebar-collapsed] ' + nav + '{justify-content:center;width:100%;padding:0}',
        '[data-dsh-frame][data-sidebar-collapsed] ' + nav + ' .tb-nav-label{display:none}',
      ].join('\n'))
    }

    let open = false
    const listeners = new Set()
    function emit() { listeners.forEach((fn) => { try { fn() } catch (e) {} }) }
    const store = {
      isOpen() { return open },
      toggle() { open = !open; emit() },
      close() { open = false; emit() },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    }

    function useOpenState() {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((t) => t + 1)), [])
      return store.isOpen()
    }

    function Entry(props) {
      const isOpen = useOpenState()
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'tb-entry' + (isOpen ? ' tb-entry-active' : ''),
          title: RT.displayName + '（工具集）',
          onClick: () => store.toggle(),
        },
        props.wide ? RT.displayName : '箱',
      )
    }

    // ===== 侧边栏导航入口（DOM 注入） =====
    // 侧边栏导航区（新会话 / 任务看板 / SSH 那一列）rc.7 仍无官方 Slot（footer 的
    // sidebar.footer.action 位置太差，用户决策回导航区），任务看板与 dsh-ssh 同样走
    // DOM 注入 + MutationObserver 自愈。条目插在「新会话」行之后的插件族块
    // （taskboard/ssh/toolbox）末尾——即 SSH 之后、工作区之前；族块相对定位保证多个
    // 自愈插件重插后顺序稳定。纯 DOM（不进 React 树），不会干扰宿主 reconciliation。
    // 无 DOM 环境（headless）退回官方 Slot 兜底。
    const NAV_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="12" height="8.5" rx="1.5"/><path d="M5.5 5V3.8A1.3 1.3 0 0 1 6.8 2.5h2.4A1.3 1.3 0 0 1 10.5 3.8V5"/><path d="M2 8.2h12"/></svg>'
    const NAV_FAMILY_SEL = '[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-toolbox-entry]'
    // 侧边栏入口图标引用（mountSidebarEntry 注入后绑定；无 DOM 环境走 Slot 兜底无图标，保持 null）。
    // Drawer 在只剩一个工具时经 replaceSidebarIcon 把工具箱图标临时换成该工具的图标。
    // desiredSidebarIcon 记录「最近希望显示的图标」：入口绑定晚于 Drawer effect 时，绑定后补刷一次，
    // 顺序无关（先想显示后绑定 / 先绑定后想显示都收敛到同一结果）。
    let sidebarIconEl = null
    let desiredSidebarIcon = NAV_ICON
    const applySidebarIcon = () => { if (sidebarIconEl) { try { sidebarIconEl.innerHTML = desiredSidebarIcon } catch (e) {} } }
    const replaceSidebarIcon = (html) => { desiredSidebarIcon = html || NAV_ICON; applySidebarIcon() }

    function mountSidebarEntry() {
      function sidebarRoot() {
        const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
        if (!column) return undefined
        const logoRow = column.querySelector('[class*="logoRow"]')
        return (logoRow && logoRow.parentElement) || column.firstElementChild || undefined
      }
      function newSessionButton(root) {
        const nested = root.querySelector('button[class*="newSession"]')
        if (nested) return nested
        for (const child of root.children) {
          if (child.tagName === 'BUTTON') return child
        }
        return undefined
      }
      function placeEntry(root, entry) {
        const button = newSessionButton(root)
        if (!button) return false
        if (entry.parentElement !== root) {
          const row = button.closest('[class*="logoRow"]')
          const base = (row && row.parentElement === root) ? row : button
          const family = Array.prototype.filter.call(root.children, (el) => el.matches && el.matches(NAV_FAMILY_SEL))
          const anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling
          root.insertBefore(entry, anchor)
        }
        return true
      }

      const entry = document.createElement('button')
      entry.type = 'button'
      entry.setAttribute('data-dsh-toolbox-entry', RT.domValue())
      entry.setAttribute('aria-label', RT.displayName)
      entry.setAttribute('title', RT.displayName)
      const safeLabel = String(RT.displayName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      entry.innerHTML = '<span class="tb-nav-icon">' + NAV_ICON + '</span><span class="tb-nav-label">' + safeLabel + '</span>'
      const iconEl = entry.querySelector('.tb-nav-icon') // 单工具时替换此图标为工具图标
      sidebarIconEl = iconEl
      applySidebarIcon() // 补刷：Drawer 可能已在图标绑定前记录过单工具意图
      entry.addEventListener('click', () => store.toggle())

      let root
      let placed = false
      function tryPlace() {
        if (root && !root.isConnected) { rootObserver.disconnect(); root = undefined; placed = false }
        if (placed) {
          if (document.body.contains(entry)) return
          rootObserver.disconnect(); root = undefined; placed = false
        }
        if (!root) root = sidebarRoot()
        if (!root) return
        placed = placeEntry(root, entry)
        if (placed) rootObserver.observe(root, { childList: true, subtree: true })
      }

      // body 级 watcher：整棵侧边栏重建时兜底发现新 root
      const waitObserver = new MutationObserver(() => { tryPlace() })
      waitObserver.observe(document.body, { childList: true, subtree: true })
      // root 级 watcher：React 重渲染挤掉条目时同帧重插（微任务先于绘制，无闪烁）
      const rootObserver = new MutationObserver(() => {
        if (!root || !root.isConnected) { placed = false; tryPlace(); return }
        if (!root.contains(entry)) placed = placeEntry(root, entry)
      })

      const syncActive = () => {
        if (store.isOpen()) entry.setAttribute('data-active', 'true')
        else entry.removeAttribute('data-active')
      }
      const unsubscribe = store.subscribe(syncActive)
      syncActive()
      tryPlace()

      return () => {
        waitObserver.disconnect()
        rootObserver.disconnect()
        unsubscribe()
        if (sidebarIconEl === iconEl) sidebarIconEl = null
        entry.remove()
      }
    }

    const MIN_W = 360
    const MIN_H = 240
    const SNAP_THRESHOLD = 120
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

    const fetchTools = (root) => host.call(RT.rpc('tools'), { root: root || undefined })
      .then((r) => (r && r.ok && Array.isArray(r.tools) ? r.tools : []))
      .catch(() => [])

    // ---- 抽屉几何与激活 Tab 本地记忆（localStorage；无 localStorage 的环境静默跳过）----
    const LS_KEY = RT.storageKey('drawer')
    const lsRead = () => {
      try {
        if (typeof localStorage === 'undefined') return null
        const raw = localStorage.getItem(LS_KEY)
        if (!raw) return null
        const p = JSON.parse(raw)
        return p && typeof p === 'object' ? p : null
      } catch (e) { return null }
    }
    const lsWrite = (patch) => {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(lsRead() || {}, patch)))
      } catch (e) {}
    }

    // ---- 工具分类（导航第二行 + 管理树共用）：默认表 + 用户覆盖（localStorage 持久化；键 = 工具/清单条目 id） ----
    const TOOL_CATS = [
      { id: 'ai', label: 'AI' },
      { id: 'dev', label: '开发' },
      { id: 'session', label: '会话' },
      { id: 'system', label: '系统' },
    ]
    const DEFAULT_CAT = {
      aiassist: 'ai', aiusage: 'ai', quota: 'ai',
      jira: 'dev', git: 'dev', files: 'dev', http: 'dev', ports: 'dev', calc: 'dev',
      trace: 'session', usage: 'session', prompt: 'session', context: 'session', search: 'session', lineage: 'session', tools: 'session', flow: 'session', flowedit: 'session',
      toolbox: 'system', 'theme-teal': 'system', 'theme-amber': 'system', selfview: 'system',
    }
    const CATS_LS_KEY = RT.storageKey('cats')
    // 抽屉导航临时记忆（客户端重载即清）：上次离开的 分类+工具；null = 重载后还没打开过抽屉
    let lastNav = null
    const catsRead = () => {
      try {
        if (typeof localStorage === 'undefined') return null
        const raw = localStorage.getItem(CATS_LS_KEY)
        if (!raw) return null
        const p = JSON.parse(raw)
        return p && typeof p === 'object' ? p : null
      } catch (e) { return null }
    }
    const catsWrite = (patch) => {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(CATS_LS_KEY, JSON.stringify(Object.assign(catsRead() || {}, patch)))
      } catch (e) {}
    }

    // 横向滚动行：滚轮纵转横。React 根节点的 wheel 监听是 passive（preventDefault 会告警且无效），故挂原生非 passive
    function HRow(props) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const node = ref.current
        if (!node) return undefined
        const onWheel = (e) => {
          if (!e.deltaY || e.deltaX) return
          node.scrollLeft += e.deltaY
          e.preventDefault()
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => { try { node.removeEventListener('wheel', onWheel) } catch (e) {} }
      }, [])
      return React.createElement('div', { className: props.className, ref }, props.children)
    }

    function Drawer(props) {
      const isOpen = useOpenState()
      // 三态停靠：right 右侧栏 / full 全占右侧（贴侧边栏右缘起占满）/ float 浮动
      // 兼容旧版 docked 布尔（docked:false → float；docked:true/无 → right）与已移除的 bottom → right
      const [dockMode, setDockMode] = React.useState(() => {
        const s = lsRead()
        if (s && (s.dockMode === 'right' || s.dockMode === 'full' || s.dockMode === 'float')) return s.dockMode
        return (s && s.docked === false) ? 'float' : 'right'
      })
      const docked = dockMode !== 'float' // 右/底都算停靠（不用浮动 pos）
      const setDocked = (v) => setDockMode(v ? 'right' : 'float') // 旧调用点兼容（吸附右边缘）
      const [pos, setPos] = React.useState(() => { const s = lsRead(); return s && s.pos && typeof s.pos.x === 'number' && typeof s.pos.y === 'number' ? s.pos : null })
      const [drag, setDrag] = React.useState(null)
      const [width, setWidth] = React.useState(() => { const s = lsRead(); return s && typeof s.width === 'number' ? s.width : null })
      const [height, setHeight] = React.useState(() => { const s = lsRead(); return s && typeof s.height === 'number' ? s.height : null })
      const [snapHint, setSnapHint] = React.useState(false)
      const [resize, setResize] = React.useState(null)
      const [tools, setTools] = React.useState([])
      const toolsRef = React.useRef([]) // 最新工具列表（延迟回调里判断 active 是否仍有效）
      toolsRef.current = tools
      const [active, setActive] = React.useState(() => { const s = lsRead(); return s && typeof s.active === 'string' ? s.active : null })
      const [autoMs, setAutoMs] = React.useState({}) // toolId -> 自动刷新毫秒（面板 HTML 声明 data-autorefresh 驱动）
      const [tabBadges, setTabBadges] = React.useState({}) // toolId -> Tab 角标文本（面板 HTML 声明 data-tab-badge 驱动；借鉴 better-sidebar tab 角标）
      const [html, setHtml] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [copied, setCopied] = React.useState(null)
      const [busyTool, setBusyTool] = React.useState(null)
      const [managing, setManaging] = React.useState(false)
      const [plugins, setPlugins] = React.useState([])
      const [pluginCaps, setPluginCaps] = React.useState(null) // Host 半 capabilities（编译模式降级 UI 依据；null=未加载，按全能力渲染）
      const canRebuildFromDisk = !pluginCaps || pluginCaps.rebuildFromDisk !== false
      const canAiUsage = !pluginCaps || pluginCaps.aiUsage !== false
      const [rebuilding, setRebuilding] = React.useState(false)
      const [rebuildLines, setRebuildLines] = React.useState(null)
      const [rebuildHistory, setRebuildHistory] = React.useState([])
      const [aiUsage, setAiUsage] = React.useState(null)
      const [pluginFilter, setPluginFilter] = React.useState('')
      const [hideHostOnly, setHideHostOnly] = React.useState(panelHide.on) // 「隐藏无界面」开关（管理页 + 左下角 Cordis 面板联动，localStorage 持久化）
      const [tabFilter, setTabFilter] = React.useState('') // 工具搜索（整行长条；仅会话内存）
      const [cat, setCat] = React.useState(() => { const s = lsRead(); return s && typeof s.cat === 'string' ? s.cat : 'ai' }) // 激活分类（localStorage 记忆）
      const [activeByCat, setActiveByCat] = React.useState(() => { const s = lsRead(); return (s && s.activeByCat && typeof s.activeByCat === 'object') ? s.activeByCat : {} }) // 各分类最近选中的工具（切分类时恢复）
      const [catOverrides, setCatOverrides] = React.useState(() => { const s = catsRead(); return (s && s.overrides && typeof s.overrides === 'object') ? s.overrides : {} }) // 管理树拖拽改归属的结果
      // refreshTools 在抽屉关闭的首帧 effect 中也可能立即拿到静态工具清单；必须在任何 early return 前初始化。
      const catOf = (id) => catOverrides[id] || DEFAULT_CAT[id] || 'dev'
      const [collapsedCats, setCollapsedCats] = React.useState(() => { const s = catsRead(); return (s && s.collapsed && typeof s.collapsed === 'object') ? s.collapsed : {} })
      const [dragId, setDragId] = React.useState(null) // 管理树正在拖拽的条目 id（entryId）
      // 明暗主题：theme 服务持有偏好；ThemeSnapshot 无顶层 colorScheme，生效明暗在 snapshot.active.colorScheme
      const schemeOf = (snap) => {
        const c = snap && snap.active && snap.active.colorScheme
        if (c === 'dark' || c === 'light') return c
        const top = snap && snap.colorScheme
        return (top === 'dark' || top === 'light') ? top : null
      }
      const [themeScheme, setThemeScheme] = React.useState(() => {
        try { return (themeSvc && schemeOf(themeSvc.getTheme())) || 'dark' } catch (e) { return 'dark' }
      })
      React.useEffect(() => {
        if (!themeSvc) return undefined
        const off = ctx.on('theme/change', (snap) => {
          try { const c = schemeOf(snap); if (c) setThemeScheme(c) } catch (e) {}
        })
        return typeof off === 'function' ? off : undefined
      }, [])
      const toggleTheme = () => {
        if (!themeSvc) return
        try {
          const cur = schemeOf(themeSvc.getTheme()) || themeScheme
          themeSvc.setTheme(cur === 'dark' ? 'light' : 'dark')
        } catch (e) {}
      }

      // ---- 画中画（Document PiP）：主抽屉 DOM 的实时镜像（不是独立实现） ----
      // 原则：主抽屉 React 树是唯一事实源；pip 窗口显示其 DOM 克隆（MutationObserver debounce 同步），
      // 交互事件按索引路径代理回主 DOM 触发——两种模式显示与行为完全一致；
      // 主抽屉全程照常运行（轮询/状态不受影响）；pip 未开启时零开销、零影响。
      // ⚠️ 整体禁用开关：所有情况下都不渲染画中画按钮、不开启 PiP 窗口（当前为 false，
      // 已按需求把所有情况下的画中画都关掉）；恢复时改回 true 即可，其余逻辑无需变动。
      const PIP_ENABLED = false
      const pipRef = React.useRef(null) // { win, mo, syncTimer, themeOff, enlarged, baseW, baseH } | null
      const [pipOn, setPipOn] = React.useState(false)
      const [mainHidden, setMainHidden] = React.useState(false) // pip 期间主抽屉可视觉隐藏（DOM 存活：镜像源与轮询不断）
      const pipSupported = PIP_ENABLED && typeof window !== 'undefined' && Boolean(window.documentPictureInPicture)
      const closePip = () => {
        const cur = pipRef.current
        pipRef.current = null
        setPipOn(false)
        setMainHidden(false)
        if (!cur) return
        try { if (cur.mo) cur.mo.disconnect() } catch (e) {}
        try { if (cur.syncTimer) clearTimeout(cur.syncTimer) } catch (e) {}
        try { if (typeof cur.themeOff === 'function') cur.themeOff() } catch (e) {}
        try { cur.win.close() } catch (e) {}
      }
      // 侧边栏重新点开抽屉 → 取消视觉隐藏；抽屉被真正关闭 → 联动关 pip（镜像源消失）
      React.useEffect(() => {
        if (isOpen && mainHidden) setMainHidden(false)
        if (!isOpen && pipRef.current) closePip()
      }, [isOpen])
      // 组件卸载/插件重跑 → 必关 pip（防孤儿窗）
      React.useEffect(() => () => {
        const cur = pipRef.current
        pipRef.current = null
        if (!cur) return
        try { if (cur.mo) cur.mo.disconnect() } catch (e) {}
        try { if (cur.syncTimer) clearTimeout(cur.syncTimer) } catch (e) {}
        try { cur.win.close() } catch (e) {}
      }, [])

      // 索引路径：镜像内元素 ↔ 主抽屉元素（cloneNode 同构，children 索引一一对应）
      const pathOf = (el, root) => {
        const p = []
        let n = el
        while (n && n !== root) {
          const parent = n.parentElement
          if (!parent) return null
          p.unshift(Array.prototype.indexOf.call(parent.children, n))
          n = parent
        }
        return n === root ? p : null
      }
      const byPath = (root, path) => {
        let n = root
        for (const i of path) {
          if (!n || !n.children || i >= n.children.length) return null
          n = n.children[i]
        }
        return n
      }

      const openPip = async () => {
        if (pipRef.current) { closePip(); return }
        if (!pipSupported) return
        const src0 = drawerRef.current
        if (!src0) return
        try {
          const win = await window.documentPictureInPicture.requestWindow({ width: Math.max(560, width || 520), height: Math.round((window.screen ? window.screen.availHeight : 900) * 0.8) })
          // 1. 克隆样式表（link 克隆 / style 标签深克隆；tb- 设计系统与宿主 dsw- 变量一并带走）
          for (const sheet of document.styleSheets) {
            try {
              if (sheet.href) { const l = win.document.createElement('link'); l.rel = 'stylesheet'; l.href = sheet.href; win.document.head.appendChild(l) }
              else if (sheet.ownerNode) win.document.head.appendChild(sheet.ownerNode.cloneNode(true))
            } catch (e) {}
          }
          // 2. 主题同步（body[data-ds-dark-theme] + colorScheme；theme/change 跟随）
          const syncTheme = () => {
            try {
              const dark = document.body.hasAttribute('data-ds-dark-theme')
              win.document.body.toggleAttribute('data-ds-dark-theme', dark)
              win.document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
            } catch (e) {}
          }
          syncTheme()
          win.document.title = RT.displayName + ' · 画中画'
          win.document.body.style.margin = '0'
          // 3. 结构：顶部工具条（pip 原生，非镜像）+ 镜像容器
          const rootEl = win.document.createElement('div')
          rootEl.className = 'jr-pip-root'
          // PiP 克隆保留 bundle root attribute（主题变量/CSS scope 挂在 bundle root 上）
          rootEl.setAttribute('data-dsh-toolbox-root', RT.bundleId)
          const barEl = win.document.createElement('div')
          barEl.className = 'jr-pip-bar'
          const barTitle = win.document.createElement('span')
          barTitle.className = 'jr-pip-bar-title'
          barTitle.textContent = RT.displayName + ' · 画中画（内容与主窗口一致，操作实时同步）'
          const btnMax = win.document.createElement('button')
          btnMax.className = 'jr-pip-bar-btn'
          btnMax.textContent = '⤢ 放大'
          btnMax.title = '放大到屏幕 72%×88%（再点还原）'
          const btnBack = win.document.createElement('button')
          btnBack.className = 'jr-pip-bar-btn'
          btnBack.textContent = '✕ 回主窗口'
          btnBack.title = '关闭画中画，回主窗口抽屉'
          barEl.appendChild(barTitle)
          barEl.appendChild(btnMax)
          barEl.appendChild(btnBack)
          const mirrorEl = win.document.createElement('div')
          mirrorEl.className = 'jr-pip-mirror'
          rootEl.appendChild(barEl)
          rootEl.appendChild(mirrorEl)
          win.document.body.appendChild(rootEl)
          const entry = { win, mo: null, syncTimer: null, themeOff: null, enlarged: false, baseW: 0, baseH: 0 }
          pipRef.current = entry
          setPipOn(true)
          // 4. 镜像同步（整体重克隆 + 滚动/焦点恢复；MutationObserver debounce 合并突变批次）
          const resync = () => {
            if (pipRef.current !== entry) return
            const src = drawerRef.current
            if (!src) return
            const scrolls = []
            try {
              const ss = mirrorEl.querySelectorAll('.tb-pane-body, .tb-code, .fl-pre, .tb-desc, .jr-drawer-body, .tb-hrow')
              for (const s of ss) {
                const p = pathOf(s, mirrorEl)
                if (p) scrolls.push([p, s.scrollTop, s.scrollLeft])
              }
            } catch (e) {}
            let focusPath = null, selStart = null, selEnd = null
            try {
              const ae = win.document.activeElement
              if (ae && mirrorEl.contains(ae)) {
                focusPath = pathOf(ae, mirrorEl)
                if (typeof ae.selectionStart === 'number') { selStart = ae.selectionStart; selEnd = ae.selectionEnd }
              }
            } catch (e) {}
            const clone = src.cloneNode(true)
            // 脱离 fixed 外壳语义（充满 pip 窗口）；主抽屉被视觉隐藏时镜像保持可见
            clone.style.position = 'static'
            clone.style.left = 'auto'; clone.style.right = 'auto'; clone.style.top = 'auto'; clone.style.bottom = 'auto'
            clone.style.width = '100%'; clone.style.height = '100%'
            clone.style.maxWidth = 'none'; clone.style.maxHeight = 'none'
            clone.style.animation = 'none'; clone.style.boxShadow = 'none'; clone.style.borderRadius = '0'; clone.style.border = 'none'
            clone.style.visibility = 'visible'; clone.style.pointerEvents = 'auto'
            mirrorEl.innerHTML = ''
            mirrorEl.appendChild(clone)
            try { for (const [p, st, sl] of scrolls) { const el = byPath(mirrorEl, p); if (el) { el.scrollTop = st; el.scrollLeft = sl } } } catch (e) {}
            if (focusPath) {
              try {
                const el = byPath(mirrorEl, focusPath)
                if (el && typeof el.focus === 'function') {
                  el.focus()
                  if (selStart != null && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(selStart, selEnd) } catch (e2) {} }
                }
              } catch (e) {}
            }
          }
          resync()
          entry.mo = new MutationObserver(() => {
            if (entry.syncTimer) clearTimeout(entry.syncTimer)
            entry.syncTimer = setTimeout(() => { entry.syncTimer = null; resync() }, 40)
          })
          entry.mo.observe(src0, { subtree: true, childList: true, attributes: true, characterData: true })
          // 5. 事件代理（镜像 → 主 DOM）：click/input/change/keydown 按索引路径回放，
          //    React 合成事件在主端 root 正常触发；pip 端 preventDefault 防双重状态
          const relay = (e) => {
            const t = e.target
            if (!t || !mirrorEl.contains(t)) return
            const p = pathOf(t, mirrorEl)
            const src = drawerRef.current
            if (!p || !src) return
            const main = byPath(src, p)
            if (!main) return
            if (e.type === 'click') {
              e.preventDefault()
              main.click()
            } else if (e.type === 'input') {
              try {
                const proto = main.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
                const desc = Object.getOwnPropertyDescriptor(proto, 'value')
                if (desc && desc.set) desc.set.call(main, t.value)
                else main.value = t.value
                main.dispatchEvent(new Event('input', { bubbles: true }))
              } catch (err) {}
            } else if (e.type === 'change') {
              try {
                if (main.tagName === 'SELECT') {
                  main.value = t.value
                  main.dispatchEvent(new Event('change', { bubbles: true }))
                } else if (main.type === 'checkbox' || main.type === 'radio') {
                  main.click()
                } else {
                  main.value = t.value
                  main.dispatchEvent(new Event('change', { bubbles: true }))
                }
              } catch (err) {}
            } else if (e.type === 'keydown') {
              try { main.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true })) } catch (err) {}
            }
          }
          for (const type of ['click', 'input', 'change', 'keydown']) mirrorEl.addEventListener(type, relay)
          // 6. 工具条：放大/还原（resizeTo + moveTo 居中）；回主窗口
          btnBack.onclick = () => closePip()
          btnMax.onclick = () => {
            try {
              if (!entry.enlarged) {
                entry.baseW = win.outerWidth; entry.baseH = win.outerHeight
                const sw = window.screen ? window.screen.availWidth : 1600
                const sh = window.screen ? window.screen.availHeight : 900
                const w = Math.round(sw * 0.72), h = Math.round(sh * 0.88)
                win.resizeTo(w, h)
                win.moveTo(Math.round((sw - w) / 2), Math.round((sh - h) / 2))
                entry.enlarged = true
                btnMax.textContent = '⤡ 还原'
              } else {
                win.resizeTo(entry.baseW || 560, entry.baseH || 620)
                entry.enlarged = false
                btnMax.textContent = '⤢ 放大'
              }
            } catch (err) {}
          }
          // 7. 主题跟随 + pip 窗口被关（系统 X）→ 释放
          if (themeSvc) entry.themeOff = ctx.on('theme/change', () => syncTheme())
          win.addEventListener('pagehide', () => {
            if (pipRef.current === entry) { pipRef.current = null; setPipOn(false); setMainHidden(false) }
            if (entry.syncTimer) { try { clearTimeout(entry.syncTimer) } catch (e) {} }
            if (entry.mo) { try { entry.mo.disconnect() } catch (e) {} }
            if (typeof entry.themeOff === 'function') { try { entry.themeOff() } catch (e) {} }
          })
          // 并存模型：不关主抽屉（它是镜像事实源，轮询照跑）；用户可点主抽屉 X 仅视觉隐藏（mainHidden）
        } catch (e) {}
      }
      const drawerRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const stateRef = React.useRef({})
      const htmlRef = React.useRef({})
      const htmlScrollRef = React.useRef(null) // 静默刷新前记录的滚动位置（effect 里恢复，防自动刷新打断阅读）
      const seqRef = React.useRef({}) // toolId -> 最新请求序号：丢弃过期响应，防 provider/模型联动竞态
      // 流程右侧调用卡的最短动画跨 innerHTML 轮询续播：scope 隔离主/子会话，key 对应调用 seq。
      const flowAnimRef = React.useRef({ scope: null, seen: new Set(), expires: new Map(), introEnds: new Map(), statuses: new Map(), outputStarts: new Map(), outputExpires: new Map(), timers: new Map() })
      const managingRef = React.useRef(false)
      managingRef.current = managing
      const activeRef = React.useRef(null) // 延迟回调里取最新 active（重启落定后的面板刷新）
      activeRef.current = active
      const retryCountRef = React.useRef({}) // toolId -> 面板加载失败重试次数（一次性重试，非轮询；成功清零）
      const attemptedRef = React.useRef({}) // toolId -> 面板请求已发起（首开死锁兜底用：tools 补齐后补打一次，之后不再重复）

      // 停靠模式/激活 Tab/分类工具记忆变化即落盘（宽/高/浮动位置在手势结束时单独落盘，避免每帧写）
      React.useEffect(() => { lsWrite({ dockMode, active, activeByCat }) }, [dockMode, active, activeByCat])

      // 挤压三栏：full 模式给主内容列（DSH grid 的 centerCol）加 margin-right 让出抽屉宽度，
      // 聊天区收缩而非被覆盖（grid 项 margin 在轨道内生效，不影响侧边栏轨道）；
      // 关闭抽屉/切模式还原，拖拽调宽实时跟随；React 不管该列内联 style，不会被覆盖
      React.useEffect(() => {
        if (!isOpen || dockMode !== 'full') return undefined
        const col = typeof document !== 'undefined' ? document.querySelector('[class*="centerCol"]') : null
        if (!col) return undefined
        const w = width || 560
        const prev = col.style.marginRight
        col.style.marginRight = w + 'px'
        return () => { col.style.marginRight = prev }
      }, [isOpen, dockMode, width])

      // 静默刷新后恢复滚动位置（loadPanel 在 setHtml 前把各滚动容器 scrollTop 记进 htmlScrollRef）
      React.useEffect(() => {
        if (!panelRef.current) return
        // 明确声明默认到底部的正常方向面板（当前为「上下文」）优先于旧 Tab 的滚动位置恢复。
        const defaultBottom = panelRef.current.querySelector('[data-scroll-default="bottom"]')
        if (defaultBottom) {
          try { defaultBottom.scrollTop = defaultBottom.scrollHeight } catch (e) {}
          htmlScrollRef.current = null
          return
        }
        const saved = htmlScrollRef.current
        htmlScrollRef.current = null
        if (saved && saved.tool === activeRef.current) {
          try {
            const scrollers = panelRef.current.querySelectorAll('.tb-pane-body, .tb-code, .fl-pre, .tb-desc')
            scrollers.forEach((s, i) => { if (i < saved.scrolls.length) s.scrollTop = saved.scrolls[i] })
          } catch (e) {}
          return
        }
        // 切工具/新面板不恢复旧位置：正常方向（tb-pane-col）容器默认滚到最底查看
        // （上下文/提示词/搜索/Jira/谱系等；column-reverse 面板天然贴底，无需处理）
        try {
          panelRef.current.querySelectorAll('.tb-pane-body.tb-pane-col').forEach((s) => { s.scrollTop = s.scrollHeight })
        } catch (e) {}
      }, [html])

      // 新调用固定先走完 1.5s（输入 .5s + 流光 1s）；返回动画由 pending → 完成/失败的真实状态触发。
      // dangerouslySetInnerHTML 会整块替换卡片 DOM，因此用调用 key 保存截止时间，并在每次替换后把类续挂到新节点。
      React.useEffect(() => {
        const box = panelRef.current
        const flow = box && box.querySelector('[data-flow][data-flow-scope]')
        const store = flowAnimRef.current
        const clearStore = () => {
          for (const timer of store.timers.values()) { try { clearTimeout(timer) } catch (e) {} }
          store.timers.clear()
          store.expires.clear()
          store.introEnds.clear()
          store.statuses.clear()
          store.outputStarts.clear()
          store.outputExpires.clear()
          store.seen.clear()
        }
        if (active !== 'flow' || !flow) {
          if (store.scope != null) clearStore()
          store.scope = null
          return
        }
        const scope = flow.getAttribute('data-flow-scope') || ''
        const cards = [...flow.querySelectorAll('.fl-wp[data-flow-card]')]
        const mainSelector = '.fl-node[data-flow-main-card][data-flow-role="user"],.fl-node[data-flow-main-card][data-flow-role="ai"]'
        const mainCards = [...flow.querySelectorAll(mainSelector)]
        if (store.scope !== scope) {
          clearStore()
          store.scope = scope
          // 首次打开建立历史基线，但最新用户卡不能被吞掉：它通常就是触发本轮流程的当前消息。
          // DOM 因 column-reverse 不是时间顺序，按 seq 数值找最新用户卡。
          for (const card of cards) {
            const key = card.getAttribute('data-flow-card') || ''
            store.seen.add(key)
            if (key) store.statuses.set(key, card.getAttribute('data-flow-status') || 'pending')
          }
          let latestUserKey = ''
          let latestUserSeq = -Infinity
          for (const card of mainCards) {
            const rawKey = card.getAttribute('data-flow-main-card') || ''
            const seq = Number(rawKey)
            if (card.getAttribute('data-flow-role') === 'user' && Number.isFinite(seq) && seq > latestUserSeq) {
              latestUserSeq = seq
              latestUserKey = rawKey
            }
          }
          for (const card of mainCards) {
            const rawKey = card.getAttribute('data-flow-main-card') || ''
            if (rawKey !== latestUserKey) store.seen.add('main:' + rawKey)
          }
        }
        const now = Date.now()
        for (const card of cards) {
          const key = card.getAttribute('data-flow-card') || ''
          if (!key) continue
          const status = card.getAttribute('data-flow-status') || 'pending'
          const isNew = !store.seen.has(key)
          const previousStatus = store.statuses.get(key)
          if (isNew) {
            store.seen.add(key)
            store.introEnds.set(key, now + 1500)
          }
          const introEnd = store.introEnds.get(key) || 0
          // 首次看到时已经完成，或后续由 pending 变为完成/失败：输出从“至少一圈流光结束”和“真实结束”两者较晚者开始。
          if ((isNew && status !== 'pending') || (previousStatus === 'pending' && status !== 'pending')) {
            const outputStart = Math.max(now, introEnd)
            store.outputStarts.set(key, outputStart)
            store.outputExpires.set(key, outputStart + 500)
          }
          store.statuses.set(key, status)

          if (introEnd > now) {
            // DOM 被轮询替换时用负 delay 从原进度续播，不从 0 重新开始。
            card.style.setProperty('--fl-min-delay', '-' + Math.max(0, 1500 - (introEnd - now)) + 'ms')
            card.classList.add('fl-min-anim')
          }
          const introTimerKey = 'intro:' + key
          if (introEnd > now && !store.timers.has(introTimerKey)) {
            const timer = setTimeout(() => {
              store.timers.delete(introTimerKey)
              store.introEnds.delete(key)
              const currentFlow = panelRef.current && panelRef.current.querySelector('[data-flow][data-flow-scope]')
              if (!currentFlow || (currentFlow.getAttribute('data-flow-scope') || '') !== scope) return
              for (const current of currentFlow.querySelectorAll('.fl-wp[data-flow-card]')) {
                if ((current.getAttribute('data-flow-card') || '') === key) {
                  current.classList.remove('fl-min-anim')
                  current.style.removeProperty('--fl-min-delay')
                }
              }
            }, Math.max(0, introEnd - now))
            store.timers.set(introTimerKey, timer)
          }

          const outputStart = store.outputStarts.get(key) || 0
          const outputEnd = store.outputExpires.get(key) || 0
          if (outputEnd > now) {
            const outputDelay = outputStart > now ? outputStart - now : -(now - outputStart)
            card.style.setProperty('--fl-output-delay', outputDelay + 'ms')
            card.classList.add('fl-output-anim')
          }
          const outputTimerKey = 'output:' + key
          if (outputEnd > now && !store.timers.has(outputTimerKey)) {
            const timer = setTimeout(() => {
              store.timers.delete(outputTimerKey)
              store.outputStarts.delete(key)
              store.outputExpires.delete(key)
              const currentFlow = panelRef.current && panelRef.current.querySelector('[data-flow][data-flow-scope]')
              if (!currentFlow || (currentFlow.getAttribute('data-flow-scope') || '') !== scope) return
              for (const current of currentFlow.querySelectorAll('.fl-wp[data-flow-card]')) {
                if ((current.getAttribute('data-flow-card') || '') === key) {
                  current.classList.remove('fl-output-anim')
                  current.style.removeProperty('--fl-output-delay')
                }
              }
            }, Math.max(0, outputEnd - now))
            store.timers.set(outputTimerKey, timer)
          }
        }
        for (const card of mainCards) {
          const rawKey = card.getAttribute('data-flow-main-card') || ''
          if (!rawKey) continue
          const key = 'main:' + rawKey
          if (!store.seen.has(key)) {
            store.seen.add(key)
            store.expires.set(key, now + 1000)
          }
          const expires = store.expires.get(key) || 0
          if (expires <= now) continue
          card.style.setProperty('--fl-main-delay', '-' + Math.max(0, 1000 - (expires - now)) + 'ms')
          card.classList.add('fl-main-min-anim')
          if (!store.timers.has(key)) {
            const timer = setTimeout(() => {
              store.timers.delete(key)
              store.expires.delete(key)
              const currentFlow = panelRef.current && panelRef.current.querySelector('[data-flow][data-flow-scope]')
              if (!currentFlow || (currentFlow.getAttribute('data-flow-scope') || '') !== scope) return
              for (const current of currentFlow.querySelectorAll(mainSelector)) {
                if ((current.getAttribute('data-flow-main-card') || '') === rawKey) {
                  current.classList.remove('fl-main-min-anim')
                  current.style.removeProperty('--fl-main-delay')
                }
              }
            }, Math.max(0, expires - now))
            store.timers.set(key, timer)
          }
        }
      }, [active, html])

      React.useEffect(() => () => {
        const store = flowAnimRef.current
        for (const timer of store.timers.values()) { try { clearTimeout(timer) } catch (e) {} }
        store.timers.clear()
      }, [])

      // 工具与流式助手的运行耗时不依赖 2s 面板轮询：Client 每 250ms 就地更新一次。
      React.useEffect(() => {
        if (!isOpen || active !== 'flow') return undefined
        const updateTimers = () => {
          const root = panelRef.current
          if (!root) return
          const now = Date.now()
          for (const el of root.querySelectorAll('[data-flow-timer]')) {
            const started = Number(el.getAttribute('data-flow-timer'))
            if (!Number.isFinite(started)) continue
            const ms = Math.max(0, now - started)
            const shown = ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's'
            el.textContent = (el.getAttribute('data-flow-timer-prefix') || '') + shown
          }
        }
        updateTimers()
        const timer = setInterval(updateTimers, 250)
        return () => { try { clearInterval(timer) } catch (e) {} }
      }, [isOpen, active, html])

      // —— 当前会话/工作区解析（v6.5）——
      // 抽屉主实例挂在宿主会话（toolbox-host-*）下，其 useSessions 不响应浏览器 UI 切会话；
      // app-shell 会把当前会话写入 localStorage['dsh.sessions.current']（浏览器全局权威）。
      // 来源：localStorage 事件桥（SESSION_EVENT，切会话零延迟，主路径）
      // + useSessions hook（响应式兜底）+ useState 初始化读取（无轮询）。
      const readLsSession = () => {
        try {
          if (typeof localStorage === 'undefined') return undefined
          const raw = localStorage.getItem('dsh.sessions.current')
          if (!raw) return undefined
          const p = JSON.parse(raw)
          return p && typeof p.sessionId === 'string' && p.sessionId ? p.sessionId : undefined
        } catch (e) { return undefined }
      }
      const [lsSession, setLsSession] = React.useState(readLsSession)
      // 事件桥响应（v6.5）：app-shell 写 localStorage['dsh.sessions.current'] 的瞬间
      // 触发 SESSION_EVENT（见 apply 层 patch），立即刷新——零延迟，替代轮询主路径。
      React.useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onChanged = () => setLsSession(readLsSession())
        window.addEventListener(SESSION_EVENT, onChanged)
        return () => { try { window.removeEventListener(SESSION_EVENT, onChanged) } catch (e) {} }
      }, [])
      const hookSession = props.useSessions((s) => (s && s.current ? String(s.current) : undefined))
      const currentSessionId = (hookSession || lsSession) || undefined
      // cwd：按 currentSessionId 经 Host RPC 查询（宿主视角 byId 记录不可靠）；hook 按自身 current 查作兜底
      const [sessionCwd, setSessionCwd] = React.useState(undefined)
      React.useEffect(() => {
        let alive = true
        if (!currentSessionId) { setSessionCwd(undefined); return undefined }
        host.call(RT.rpc('session-info'), { session: currentSessionId })
          .then((r) => { if (alive && r && r.ok && typeof r.cwd === 'string') setSessionCwd(r.cwd) })
          .catch(() => {})
        return () => { alive = false }
      }, [currentSessionId])
      const hookCwd = props.useSessions((s) => {
        if (!s || !s.current) return undefined
        const row = s.byId && s.byId[s.current]
        return row && typeof row.cwd === 'string' && row.cwd ? row.cwd : undefined
      })
      const currentCwd = sessionCwd || hookCwd
      // cwd 用 ref 固定：1.5s 轮询 interval 持有旧闭包，读取 ref 才能跟随「切工作区」拿到最新激活 cwd
      const cwdRef = React.useRef(currentCwd)
      cwdRef.current = currentCwd
      // 会话上下文检测：记录「上次已处理过」的 cwd 与 session id（只在 effect 内更新，
      // 不随渲染赋值——否则 effect 里比较恒等永远不会触发）
      const handledCwdRef = React.useRef(currentCwd || '')
      const handledSessionRef = React.useRef(currentSessionId || '')

      function collectFields() {
        const fields = {}
        const box = panelRef.current
        if (!box) return fields
        const nodes = box.querySelectorAll('[data-field]')
        for (const el of nodes) {
          const name = el.getAttribute('data-field')
          if (name) fields[name] = el.value == null ? '' : String(el.value)
        }
        return fields
      }

      async function loadPanel(toolId, action, el, opts) {
        if (!toolId) { setHtml(null); return }
        attemptedRef.current[toolId] = true // 标记已发起请求（refreshTools 兜底据此判定是否补打）
        const silent = Boolean(opts && opts.silent) // 静默刷新（自动轮询）：不转圈、不清错误
        const seq = (seqRef.current[toolId] || 0) + 1
        seqRef.current[toolId] = seq
        if (!silent) setBusyTool(toolId)
        if (!silent) setError(null)
        // 联动切换在途锁定：禁用面板内 select，避免在陈旧 DOM 上继续操作（成功响应会整体重渲染解锁）
        let locked = null
        const unlock = () => { if (locked) for (const s of locked) { try { s.disabled = false } catch (e) {} } }
        try {
          let fields = collectFields()
          if (el) {
            // 点击元素自身的 data-* 属性随请求带回（data-key / data-hash / data-path 等）
            const ds = el.dataset || {}
            const d = {}
            for (const k of Object.keys(ds)) d[k] = ds[k]
            fields = { ...fields, __el: d }
          }
          if (opts && opts.lockSelects) {
            const box = panelRef.current
            if (box) {
              locked = [...box.querySelectorAll('select:not([disabled])')]
              for (const s of locked) s.disabled = true
            }
          }
          // 超时保护（v6.5.3）：首次打开 RPC 通道未就绪时 host.call 可能永久 pending——
          // 5s 无响应即视为失败，走下方一次性重试，避免面板永久停在「加载面板…」
          const callP = host.call(RT.rpc('panel'), {
            tool: toolId,
            action: action || '',
            fields,
            state: stateRef.current[toolId] || null,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
          })
          const timeoutP = new Promise((_, reject) => {
            try { ctx.timeout(() => reject(new Error('面板请求超时（5s）')), 5000) } catch (e) {}
          })
          const res = await Promise.race([callP, timeoutP])
          if (seqRef.current[toolId] !== seq) return // 已有更新的请求发出：过期响应直接丢弃（联动切换竞态修复）；DOM 由新请求的响应接管
          if (res && res.ok) {
            retryCountRef.current[toolId] = 0 // 成功：清零一次性重试计数
            stateRef.current[toolId] = res.state
            htmlRef.current[toolId] = res.html
            // 任何动作都保存滚动位置（自动轮询/展开详情/提交等）：全量 innerHTML 重渲染会丢滚动/选择，
            // 先记录各可滚动子容器 scrollTop 与所属工具，setHtml 后经 effect 恢复（切工具不恢复）
            if (panelRef.current) {
              try {
                const scrolls = []
                const scrollers = panelRef.current.querySelectorAll('.tb-pane-body, .tb-code, .fl-pre, .tb-desc')
                for (const s of scrollers) scrolls.push(s.scrollTop)
                htmlScrollRef.current = { tool: toolId, scrolls }
              } catch (e) {}
            }
            setHtml(res.html)
            // 自动刷新约定：工具 HTML 带 data-autorefresh="ms" → 抽屉静默定时重拉（静默 = 不转圈）
            const am = /data-autorefresh="(\d+)"/.exec(res.html)
            setAutoMs((cur) => {
              const has = Object.prototype.hasOwnProperty.call(cur, toolId)
              if (am) {
                const ms = Math.max(1500, parseInt(am[1], 10) || 2000)
                if (has && cur[toolId] === ms) return cur
                return { ...cur, [toolId]: ms }
              }
              if (!has) return cur
              const next = { ...cur }
              delete next[toolId]
              return next
            })
            // Tab 角标约定：工具 HTML 带 data-tab-badge="文本" → 该工具 Tab 显示角标（空字符串=清除）
            const bm = /data-tab-badge="([^"]{0,12})"/.exec(res.html)
            setTabBadges((cur) => {
              const has = Object.prototype.hasOwnProperty.call(cur, toolId)
              const val = bm ? bm[1] : null
              if (val) {
                if (has && cur[toolId] === val) return cur
                return { ...cur, [toolId]: val }
              }
              if (!has) return cur
              const next = { ...cur }
              delete next[toolId]
              return next
            })
            // copy 契约：Host 附带 copy 字符串 → 写剪贴板并短暂提示
            if (typeof res.copy === 'string' && res.copy) {
              try {
                if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                  await navigator.clipboard.writeText(res.copy)
                  setCopied('已复制 ' + res.copy.length + ' 字符')
                } else {
                  setCopied('当前环境无剪贴板 API')
                }
              } catch (e) {
                setCopied('复制失败: ' + String((e && e.message) || e))
              }
            } else {
              setCopied(null)
            }
          } else {
            unlock() // 失败未重渲染：恢复 select 可用
            setError((res && res.error) || '面板加载失败')
            retryOnce(toolId)
          }
        } catch (e) {
          if (seqRef.current[toolId] === seq) {
            unlock() // 异常未重渲染：恢复 select 可用
            setError('面板请求异常: ' + String((e && e.message) || e))
            retryOnce(toolId)
          }
        } finally {
          if (seqRef.current[toolId] === seq) setBusyTool((cur) => (cur === toolId ? null : cur))
        }
      }
      // 一次性失败重试（v6.5.3，非轮询）：瞬时失败（首次打开通道未就绪/超时）时延迟重试，
      // 最长 2 次、间隔 1.2s；仅当抽屉仍打开且 active 未变才重试。成功清零（见 loadPanel 成功分支）。
      function retryOnce(toolId) {
        if ((retryCountRef.current[toolId] || 0) >= 2) return
        retryCountRef.current[toolId] = (retryCountRef.current[toolId] || 0) + 1
        try {
          ctx.timeout(() => {
            const cur = activeRef.current
            if (cur === toolId && store.isOpen() && typeof loadPanelRef.current === 'function') {
              loadPanelRef.current(toolId, '', null)
            }
          }, 1200)
        } catch (e) {}
      }
      // loadPanel 的最新引用：原生 change 监听只挂一次，经 ref 调用避免闭包捕获过期渲染帧
      const loadPanelRef = React.useRef(null)
      loadPanelRef.current = loadPanel

      // 关键修复：面板是 dangerouslySetInnerHTML 注入的裸 DOM，其中的 <select> 没有 React fiber；
      // React 18 ChangeEventPlugin 只在「目标是 React 受管的 select/input」时派发合成 onChange
      // （裸 DOM select 取到最近祖先纤维 = 容器 div，shouldUseChangeEvent(div)=false ⇒ 永不派发），
      // 所以容器上的 onChange 属性对面板内 select 永远不触发（点击/键盘事件无此目标类型检查，不受影响）。
      // 原生 change 事件正常冒泡——改在抽屉根节点挂原生监听（随抽屉关闭卸载、重开重挂）。
      React.useEffect(() => {
        if (!isOpen) return undefined
        const root = drawerRef.current
        if (!root) return undefined
        const onNativeChange = (e) => {
          const t = e.target
          const el = t && t.closest ? t.closest('[data-action-onchange]') : null
          if (!el) return
          const box = panelRef.current
          if (!box || !box.contains(el)) return // 仅面板内控件（排除壳自身的 React 表单输入）
          const tool = activeRef.current
          if (!tool || typeof loadPanelRef.current !== 'function') return
          // 联动切换在途锁定面板内 select（lockSelects），避免在陈旧 DOM 上连续操作
          loadPanelRef.current(tool, el.getAttribute('data-action-onchange') || '', el, { lockSelects: true })
        }
        root.addEventListener('change', onNativeChange)
        return () => { try { root.removeEventListener('change', onNativeChange) } catch (err) {} }
      }, [isOpen])

      async function refreshTools() {
        const list = await fetchTools(cwdRef.current)
        setTools(list)
        // 空列表 = 框架启动期工具未注册/暂缺，不是「真的没有工具」：不纠正 active、清成 null。
        // 否则抽屉打开前的挂载刷新会把 active 清掉并落盘，打开后出现无 tab 激活的假死态
        if (!list.length) return
        // 无有效记忆时的默认 Tab：会话「流程」（用户指定）；没有 flow 才退到列表第一个。
        // 分类芯片必须同步切到目标工具的分类（flow 在「会话」），否则面板与 Tab 栏错位
        const cur = activeRef.current
        if (cur && list.some((t) => t.id === cur)) return
        const flow = list.find((t) => t.id === 'flow')
        const target = flow ? flow.id : (list.length ? list[0].id : null)
        if (target && catOf(target) !== cat) setCat(catOf(target))
        setActive(target)
      }

      // ===== 插件生命周期开关（齿轮管理视图）：直连 Host 半 toolbox/plugins + toolbox/plugin-toggle =====
      async function refreshPlugins() {
        try {
          const r = await host.call(RT.rpc('plugins'), { session: currentSessionId || undefined })
          setPlugins(r && r.ok && Array.isArray(r.plugins) ? r.plugins : [])
          if (r && r.ok && r.capabilities && typeof r.capabilities === 'object') setPluginCaps(r.capabilities)
        } catch (e) {}
      }

      async function togglePlugin(p) {
        if (p.hasClientHalf) return
        if (p.running && p.canStop === false) return
        setError(null)
        try {
          const r = await host.call(RT.rpc('plugin-toggle'), {
            pluginId: p.pluginId,
            enable: !p.running,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
          })
          if (r && !r.ok) setError(r.error || '插件操作失败')
        } catch (e) {
          setError('插件操作异常: ' + String((e && e.message) || e))
        }
        refreshPlugins()
        refreshTools() // 停止 → 注册表级联移除 Tab；启动 → 500ms 重试注册后自动回来
      }

      // 重跑类操作后的落定刷新：等注册表 500ms 重试周期过后再拉工具列表并重载当前面板——
      // 立即刷新会撞上「工具暂缺」窗口（registry 已清空、心跳未重挂），把 active Tab 挤走或报未注册
      function settleAfterRestart() {
        ctx.timeout(() => {
          refreshTools()
          const t = activeRef.current
          if (t) loadPanel(t, '', null)
        }, 700)
      }

      // 重跑单个插件：桩重读磁盘 impl，改完代码点这个即生效
      async function restartPlugin(p) {
        if (p.hasClientHalf) return
        setError(null)
        try {
          const r = await host.call(RT.rpc('plugin-restart'), {
            pluginId: p.pluginId,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
          })
          if (r && !r.ok) setError(r.error || '插件重跑失败')
        } catch (e) {
          setError('插件重跑异常: ' + String((e && e.message) || e))
        }
        refreshPlugins()
        settleAfterRestart()
      }

      // 批量启停：Host-only 插件一次全停/全启，启停记忆统一落盘
      async function toggleAll(enable) {
        setError(null)
        try {
          const r = await host.call(RT.rpc('plugin-toggle-all'), { enable, root: currentCwd || undefined, session: currentSessionId || undefined })
          const lines = []
          if (!r) lines.push('批量操作无响应')
          else {
            if (r.error) lines.push('✗ ' + r.error)
            if (Array.isArray(r.done) && r.done.length) lines.push((enable ? '已启动: ' : '已停止: ') + r.done.join('、'))
            if (Array.isArray(r.skippedClient) && r.skippedClient.length) lines.push('跳过（含 Client 半，需到 Cordis 面板）: ' + r.skippedClient.join('、'))
            if (Array.isArray(r.failed) && r.failed.length) lines.push('失败: ' + r.failed.join('；'))
            if (lines.length === 0) lines.push('没有可操作的插件')
          }
          setRebuildLines(lines)
        } catch (e) {
          setRebuildLines(['批量操作异常: ' + String((e && e.message) || e)])
        }
        refreshPlugins()
        refreshTools()
      }

      // 「重启后」pill 点击：只改启停记忆（下次重建的默认启停），不动当前运行态
      async function setDefaultPlugin(p) {
        if (p.defaultStart == null) return // 不在 plugins.json 清单内，无条目可记
        setError(null)
        try {
          const r = await host.call(RT.rpc('plugin-set-default'), {
            pluginId: p.pluginId,
            enabled: !p.defaultStart,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
          })
          if (r && !r.ok) setError(r.error || '默认启停设置失败')
        } catch (e) {
          setError('默认启停设置异常: ' + String((e && e.message) || e))
        }
        refreshPlugins()
      }

      // 批量重跑：运行中的 Host-only 插件全部重启（桩重读磁盘 impl）——改完多个工具一键生效
      async function restartAll() {
        setError(null)
        try {
          const r = await host.call(RT.rpc('plugin-restart-all'), { root: currentCwd || undefined, session: currentSessionId || undefined })
          const lines = []
          if (!r) lines.push('批量重跑无响应')
          else {
            if (r.error) lines.push('✗ ' + r.error)
            if (Array.isArray(r.done) && r.done.length) lines.push('已重跑: ' + r.done.join('、') + '（面板大本体如预览/diff 已随闭包重置）')
            if (Array.isArray(r.skippedClient) && r.skippedClient.length) lines.push('跳过（含 Client 半，需到 Cordis 面板）: ' + r.skippedClient.join('、'))
            if (Array.isArray(r.failed) && r.failed.length) lines.push('失败: ' + r.failed.join('；'))
            if (lines.length === 0) lines.push('没有运行中的 Host-only 插件')
          }
          setRebuildLines(lines)
        } catch (e) {
          setRebuildLines(['批量重跑异常: ' + String((e && e.message) || e)])
        }
        refreshPlugins()
        settleAfterRestart()
      }

      // 重建耗时历史（迷你柱状图；仅动态模式有磁盘重建语义）
      async function loadRebuildHistory() {
        if (pluginCaps && pluginCaps.rebuildFromDisk === false) { setRebuildHistory([]); return }
        try {
          const r = await host.call(RT.rpc('rebuild-history'))
          setRebuildHistory(r && r.ok && Array.isArray(r.history) ? r.history : [])
        } catch (e) {}
      }

      // AI 用量台账聚合（管理视图总行；bundle 未含 AI 工具时不请求不展示）
      async function loadAiUsage() {
        if (pluginCaps && pluginCaps.aiUsage === false) { setAiUsage(null); return }
        try {
          const r = await host.call(RT.rpc('ai-usage'))
          setAiUsage(r && r.ok ? r : null)
        } catch (e) {}
      }

      // 自举重建：框架读磁盘 payload.json 批量 define+run（幂等，已定义的跳过）
      async function runRebuild() {
        setRebuilding(true)
        setError(null)
        try {
          const r = await host.call(RT.rpc('rebuild'), { root: currentCwd || undefined, session: currentSessionId || undefined })
          const lines = []
          if (!r) lines.push('重建请求无响应')
          else {
            if (r.error) lines.push('✗ ' + r.error)
            if (Array.isArray(r.defined) && r.defined.length) lines.push('新定义: ' + r.defined.join('、'))
            if (Array.isArray(r.started) && r.started.length) lines.push('已启动: ' + r.started.join('、'))
            if (Array.isArray(r.skipped) && r.skipped.length) lines.push('跳过（已定义/框架自身）: ' + r.skipped.join('、'))
            if (Array.isArray(r.suppressed) && r.suppressed.length) lines.push('保持关闭（启停记忆）: ' + r.suppressed.join('、'))
            if (Array.isArray(r.failed) && r.failed.length) lines.push('失败: ' + r.failed.join('；'))
            if (typeof r.ms === 'number') lines.push('耗时: ' + r.ms + 'ms（payload 读盘 + define + run 串行）')
            if (lines.length === 0) lines.push('plugins.json 内插件均已存在，无需重建')
          }
          setRebuildLines(lines)
        } catch (e) {
          setRebuildLines(['重建异常: ' + String((e && e.message) || e)])
        } finally {
          setRebuilding(false)
        }
        loadRebuildHistory()
        refreshPlugins()
        refreshTools()
      }

      React.useEffect(() => {
        // 轮询减负：plugins 清单只有管理视图需要——普通模式只刷 tools（RPC  chatter 减半）
        const disp = ctx.interval(() => { if (store.isOpen()) { refreshTools(); if (managingRef.current) refreshPlugins() } }, 1500)
        // 抽屉打开时的导航恢复（用户指定）：重载后「第一次」打开 → 默认 会话+流程；之后打开 →
        // 恢复上次离开的 分类+工具（lastNav 临时记录）。两路都同步分类芯片与工具 Tab，防面板/Tab 栏错位。
        const offOpen = store.subscribe(() => {
          if (!store.isOpen()) return
          const remembered = lastNav && lastNav.active
          // 有记忆恢复记忆（工具已停则由 refreshTools 兜底回默认并同步分类）；无记忆默认 会话+流程
          if (remembered) { setCat(catOf(remembered)); setActive(remembered) }
          else { setCat(catOf('flow')); setActive('flow') }
          refreshTools(); refreshPlugins()
        })
        refreshTools()
        refreshPlugins()
        return () => { try { disp() } catch (e) {} offOpen() }
      }, [])

      // 会话/工作区切换跟随：当前会话的 cwd 或 session id 任一变化 = 切会话或切工作区。
      // 两个仓库工具 id 同名时 refreshTools 的「active 保持」分支不会重载面板，且 loadPanel
      // 只在 active 变化时触发——切会话（同工作区或跨工作区）active 不变，面板仍显示旧会话
      // 内容（如 flow 流程图）。这里清掉缓存并强制重拉当前面板（带新 session 参数）。
      React.useEffect(() => {
        const cwd = currentCwd || ''
        const sid = currentSessionId || ''
        if (!sid) return
        if (handledCwdRef.current === cwd && handledSessionRef.current === sid) return
        const cwdChanged = handledCwdRef.current !== cwd
        const sidChanged = handledSessionRef.current !== sid
        handledCwdRef.current = cwd
        handledSessionRef.current = sid
        // 清会话级缓存（cwd 或 sid 任一变化）：工具的 st.sid 是会话级 state（flow/trace 等
        // 优先 st.sid 渲染），切会话不清理会沿用旧会话 id——必须清空让工具从新会话重算。
        // 工具列表只在跨工作区（cwd 变）时重拉（工具按仓库根分组）。
        if (cwdChanged || sidChanged) {
          htmlRef.current = {}
          stateRef.current = {}
          seqRef.current = {}
        }
        if (cwdChanged) {
          // 同时清上一工作区的在屏 HTML 与逐工具请求标记：经过无工具箱的工作区后延迟重载
          // 会因旧空列表跳过，新工具列表到达时 attemptedRef 又挡住补发，面板将一直残留
          // 上一工作区的缓存 HTML（retryCount 一并重置，失败重试额度不被旧工作区消耗）
          attemptedRef.current = {}
          retryCountRef.current = {}
          setHtml(null)
          refreshTools()
        }
        // 面板重载延后一拍：等 refreshTools 的 setTools/active 纠正落地（新仓库无同名工具时
        // active 已被兜底切到新列表第一个），用最新 activeRef 加载，避免对不存在工具发请求。
        ctx.timeout(() => {
          const t = activeRef.current
          const list = toolsRef.current
          if (t && (!list || list.some((x) => x.id === t)) && typeof loadPanelRef.current === 'function') {
            loadPanelRef.current(t, '', null)
          }
        }, 0)
        refreshPlugins()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [currentCwd, currentSessionId])

      // 单工具图标替换：只剩一个非工具箱工具时，侧边栏入口的「工具箱」图标换成该工具的图标；
      // 多工具 / 管理视图恢复工具箱图标。（图标随注册表下发，此项只消费 tools 的 icon 字段，平日不显示）
      React.useEffect(() => {
        const solo = !managing && tools.length === 1 && tools[0] && tools[0].icon
          ? tools[0].icon : null
        replaceSidebarIcon(solo || NAV_ICON)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [tools, managing])

      // 面板自动刷新：当前工具的 HTML 声明了 data-autorefresh="ms" 时，静默轮询（不转圈、不抢滚动——silent 路径）
      const curAutoMs = active ? autoMs[active] : undefined
      React.useEffect(() => {
        if (!isOpen || !active || !curAutoMs) return undefined
        const disp = ctx.interval(() => {
          if (managingRef.current) return
          if (typeof loadPanelRef.current === 'function') loadPanelRef.current(active, '__refresh', null, { silent: true })
        }, curAutoMs)
        return () => { try { disp() } catch (e) {} }
      }, [isOpen, active, curAutoMs])

      // 激活 Tab 变化 → 切回该工具上次的面板并刷新。
      // isOpen 守卫：抽屉关闭时不预加载面板（页面加载早期 RPC 通道未就绪，
      // 提前 loadPanel 会永久卡住 → 首次打开显示「加载面板…」；打开抽屉时
      // isOpen 变化重新触发本 effect 正常加载）
      React.useEffect(() => {
        if (!isOpen) return
        if (!active) { setHtml(null); return }
        // localStorage 记忆可能指向已停止的工具：tools 已加载且不含它时等 refreshTools 纠正，不闪错误
        if (tools.length && !tools.some((t) => t.id === active)) return
        setHtml(htmlRef.current[active] || null)
        loadPanel(active, '', null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [active, isOpen])

      // 初次加载不变量（v6.5.4）：上面的激活 effect 只响应 [active, isOpen]，框架启动窗口里
      // tools 暂缺/暂空会让它 return 跳过，之后 active 不再变化就永远没人补加载（表现为
      // 无 tab 激活 + 面板永久「加载面板…」，手动切 tab 才好）。这里按 tools 强制不变量：
      // 抽屉开着且列表非空时，active 无效 → 兜底 flow/第一个（交给激活 effect 接管加载）；
      // active 有效但从未发起过面板请求 → 补发一次（attemptedRef 去重，不循环）
      React.useEffect(() => {
        if (!isOpen || !tools.length) return
        if (!active || !tools.some((t) => t.id === active)) {
          const flow = tools.find((t) => t.id === 'flow')
          const target = flow ? flow.id : tools[0].id
          setCat(catOf(target))
          setActive(target)
          return
        }
        if (!attemptedRef.current[active] && typeof loadPanelRef.current === 'function') {
          loadPanelRef.current(active, '', null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [tools, isOpen])

      function onPanelClick(e) {
        if (!active) return
        const t = e.target
        const el = t && t.closest ? t.closest('[data-action]') : null
        if (!el) return
        e.preventDefault()
        const act = el.getAttribute('data-action') || ''
        loadPanel(active, act, el)
      }

      function onPanelKeyDown(e) {
        if (!active || e.key !== 'Enter') return
        const t = e.target
        if (!(t && t.matches && t.matches('[data-field]'))) return
        e.preventDefault()
        const box = panelRef.current
        const btn = box && box.querySelector('[data-action="query"], [data-action="query-record"]')
        if (btn) loadPanel(active, btn.getAttribute('data-action') || '', btn)
      }

      // 面板契约扩展：select 等控件加 data-action-onchange="xxx"，change 即触发该动作（无需手动按钮）。
      // 派发走抽屉根节点的原生 change 监听（见 loadPanelRef 旁的修复注释），不要用 React onChange 属性。

      function onHeaderDown(e) {
        if (e.button !== 0) return
        e.preventDefault()
        let rect = null
        try { rect = e.currentTarget.parentElement.getBoundingClientRect() } catch (err) {}
        const baseX = rect ? rect.left : 0
        const baseY = rect ? rect.top : 0
        setPos({ x: baseX, y: baseY })
        setDockMode('float')
        setDrag({ startX: e.clientX, startY: e.clientY, baseX, baseY })
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
      }
      function onHeaderMove(e) {
        if (!drag) return
        const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
        let x = drag.baseX + e.clientX - drag.startX
        const near = vw - (x + curW()) < SNAP_THRESHOLD
        if (near) x = vw - curW()
        setSnapHint(near)
        setPos({ x, y: drag.baseY + e.clientY - drag.startY })
      }
      function onHeaderUp(e) {
        if (!drag) return
        const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
        const x = drag.baseX + e.clientX - drag.startX
        const near = vw - (x + curW()) < SNAP_THRESHOLD
        setDrag(null)
        setSnapHint(false)
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) {}
        if (near) { setDockMode('right'); lsWrite({ dockMode: 'right' }) }
        else if (e.type === 'pointerup') lsWrite({ dockMode: 'float', pos: { x, y: drag.baseY + e.clientY - drag.startY } })
      }

      function onResizeStart(e, mode) {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        let rect = null
        try { rect = drawerRef.current.getBoundingClientRect() } catch (err) {}
        setResize({
          mode,
          startX: e.clientX,
          startY: e.clientY,
          baseW: rect ? rect.width : curW(),
          baseH: rect ? rect.height : (height || 560),
        })
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
      }
      function onResizeMove(e) {
        if (!resize) return
        const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
        const vh = e.currentTarget.ownerDocument.defaultView.innerHeight
        const maxW = Math.min(1400, vw - 24)
        const maxH = vh - 96
        if (resize.mode === 'left') {
          setWidth(clamp(resize.baseW + (resize.startX - e.clientX), MIN_W, maxW))
        } else if (resize.mode === 'right') {
          setWidth(clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW))
        } else if (resize.mode === 'bottom') {
          setHeight(clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH))
        } else if (resize.mode === 'corner') {
          setWidth(clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW))
          setHeight(clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH))
        }
      }
      function onResizeEnd(e) {
        // 手势结束才落盘几何（move 每帧触发，直接写 localStorage 会卡）；cancel 事件的坐标不可信，不写
        if (resize && e.type === 'pointerup') {
          try {
            const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
            const vh = e.currentTarget.ownerDocument.defaultView.innerHeight
            const maxW = Math.min(1400, vw - 24)
            const maxH = vh - 96
            const patch = {}
            if (resize.mode === 'left') patch.width = clamp(resize.baseW + (resize.startX - e.clientX), MIN_W, maxW)
            else if (resize.mode === 'right') patch.width = clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW)
            else if (resize.mode === 'bottom') patch.height = clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH)
            else if (resize.mode === 'corner') {
              patch.width = clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW)
              patch.height = clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH)
            }
            lsWrite(patch)
          } catch (err) {}
        }
        setResize(null)
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) {}
      }

      if (!isOpen) return null

      const curW = () => width || 520

      // 主题切换按钮：暗色下显示太阳（点击切亮），亮色下显示月亮（点击切暗）；theme 服务缺失时不渲染
      const themeButton = !themeSvc ? null : React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: themeScheme === 'dark' ? '切换到亮色主题' : '切换到暗色主题',
        'aria-label': '切换明暗主题',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); toggleTheme() },
      },
        themeScheme === 'dark'
          ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' },
              React.createElement('circle', { cx: 7, cy: 7, r: 2.6 }),
              React.createElement('path', { d: 'M7 1.2v1.4M7 11.4v1.4M1.2 7h1.4M11.4 7h1.4M2.9 2.9l1 1M10.1 10.1l1 1M11.1 2.9l-1 1M3.9 10.1l-1 1' }),
            )
          : React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' },
              React.createElement('path', { d: 'M12.2 8.7A5.2 5.2 0 1 1 5.3 1.8a4.4 4.4 0 0 0 6.9 6.9z' }),
            ),
      )

      // 画中画按钮：浏览器支持 Document PiP 才渲染（Chrome/Edge 116+，localhost 安全上下文）
      const pipButton = !pipSupported ? null : React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: '画中画：把工具箱放到独立小窗（脱离主窗口，可拖到任意位置）',
        'aria-label': '画中画',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); openPip() },
      },
        React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 },
          React.createElement('rect', { x: 1.5, y: 3, width: 11, height: 8, rx: 1 }),
          React.createElement('rect', { x: 7.5, y: 7, width: 3.6, height: 2.8, rx: 0.5, fill: 'currentColor', stroke: 'none' }),
        ),
      )

      const gearButton = RT.capabilities.managePlugins === false ? null : React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: managing ? '返回工具面板' : '管理插件（停止/启动）',
        'aria-label': '管理插件',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); const next = !managing; setManaging(next); if (next) { refreshPlugins(); loadRebuildHistory(); loadAiUsage() } },
      },
        // sliders 图标（横线+滑块）：明确表示「管理/调节」，与明暗切换的太阳/月亮区分开
        React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' },
          React.createElement('path', { d: 'M1.8 4.2h10.4M1.8 9.8h10.4' }),
          React.createElement('circle', { cx: 9.2, cy: 4.2, r: 1.6 }),
          React.createElement('circle', { cx: 4.8, cy: 9.8, r: 1.6 }),
        ),
      )

      const dockButton = React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: dockMode === 'right' ? '切换到三栏停靠（挤压聊天区，左中右并列）' : dockMode === 'full' ? '切换为浮动' : '停靠到右侧',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); setDockMode(dockMode === 'right' ? 'full' : dockMode === 'full' ? 'float' : 'right') },
      },
        dockMode === 'right'
          ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'currentColor' },
              React.createElement('rect', { x: 2.5, y: 2.5, width: 8, height: 8, rx: 1 }),
              React.createElement('rect', { x: 5.5, y: 5.5, width: 6, height: 6, rx: 1, opacity: 0.55 }),
            )
          : dockMode === 'full'
            ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'currentColor' },
                React.createElement('rect', { x: 1.5, y: 2, width: 2.6, height: 10, rx: 0.8, opacity: 0.35 }),
                React.createElement('rect', { x: 5.1, y: 2, width: 5, height: 10, rx: 0.8, opacity: 0.55 }),
                React.createElement('rect', { x: 11.1, y: 2, width: 1.6, height: 10, rx: 0.5 }),
              )
            : React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'currentColor' },
                React.createElement('rect', { x: 2, y: 2, width: 7, height: 10, rx: 1 }),
                React.createElement('rect', { x: 10.5, y: 5, width: 2.5, height: 7, rx: 0.5, opacity: 0.55 }),
              ),
      )

      const closeButton = React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: '关闭',
        'aria-label': '关闭',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); if (pipOn) setMainHidden(true); else store.close() },
      },
        React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' },
          React.createElement('path', { d: 'M2 2l10 10M12 2L2 12' }),
        ),
      )

      const handles = []
      if (dockMode === 'right' || dockMode === 'full') {
        handles.push(React.createElement('div', {
          key: 'resize-left',
          className: 'jr-resize-left',
          title: '拖拽调整宽度',
          onPointerDown: (e) => onResizeStart(e, 'left'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
      } else if (dockMode === 'float') {
        handles.push(React.createElement('div', {
          key: 'resize-right',
          className: 'jr-resize-right',
          title: '拖拽调整宽度',
          onPointerDown: (e) => onResizeStart(e, 'right'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
        handles.push(React.createElement('div', {
          key: 'resize-bottom',
          className: 'jr-resize-bottom',
          title: '拖拽调整高度',
          onPointerDown: (e) => onResizeStart(e, 'bottom'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
        handles.push(React.createElement('div', {
          key: 'resize-corner',
          className: 'jr-resize-corner',
          title: '拖拽调整大小',
          onPointerDown: (e) => onResizeStart(e, 'corner'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
      }

      const style = {}
      if ((dockMode === 'right' || dockMode === 'full') && width) style.width = width + 'px' // 停靠宽度可调（左缘拖拽）
      if (dockMode === 'full' && !width) style.width = '560px' // 三栏停靠默认宽
      // pip 画中画期间主抽屉可视觉隐藏（DOM 与轮询存活——它是镜像事实源）
      if (mainHidden) { style.visibility = 'hidden'; style.pointerEvents = 'none' }
      if (dockMode === 'float') {
        if (height) style.height = height + 'px'
        if (pos) {
          style.left = pos.x + 'px'
          style.top = pos.y + 'px'
        }
      }

      // ---- 分类归属与迁移（导航行与管理树共用同一 catOf 数据源） ----
      const pickCat = (id) => {
        if (id === cat) return
        // 记住旧分类当前选择；切到新分类后恢复其上次选中的工具，无记录（或已停）则选该分类第一个
        const next = Object.assign({}, activeByCat)
        if (active) next[cat] = active
        setActiveByCat(next)
        setCat(id)
        lsWrite({ cat: id, activeByCat: next })
        const inCat = tools.filter((t) => catOf(t.id) === id)
        const remembered = next[id]
        const target = remembered && inCat.some((t) => t.id === remembered) ? remembered : (inCat.length ? inCat[0].id : null)
        setActive(target)
        lastNav = { cat: id, active: target }
      }
      const moveNode = (id, toCat) => {
        if (!id || !toCat) return
        if (catOf(id) === toCat) return
        const next = Object.assign({}, catOverrides)
        next[id] = toCat
        setCatOverrides(next)
        catsWrite({ overrides: next })
      }
      const toggleCat = (id) => {
        const next = Object.assign({}, collapsedCats)
        next[id] = !next[id]
        setCollapsedCats(next)
        catsWrite({ collapsed: next })
      }

      // ---- 三段式导航：搜索整行（全局匹配）/ 分类行 / 当前分类下的工具行 ----
      const tabFilterLc = tabFilter.trim().toLowerCase()
      const searching = tabFilterLc.length > 0
      const catCounts = {}
      for (const t of tools) { const c = catOf(t.id); catCounts[c] = (catCounts[c] || 0) + 1 }
      const visibleCats = TOOL_CATS.filter((c) => (catCounts[c.id] || 0) > 0)
      // 激活分类已空（工具全停）时回退到第一个非空分类，不闪空行
      const effCat = (catCounts[cat] || 0) > 0 ? cat : (visibleCats.length ? visibleCats[0].id : cat)
      const shownTools = searching
        ? tools.filter((t) => (String(t.label) + ' ' + String(t.id)).toLowerCase().indexOf(tabFilterLc) >= 0)
        : tools.filter((t) => catOf(t.id) === effCat)
      const toolButton = (t) => React.createElement('button', {
        key: t.id,
        type: 'button',
        className: 'tb-tab' + (t.id === active ? ' tb-tab-active' : ''),
        title: t.label + '（' + (TOOL_CATS.find((c) => c.id === catOf(t.id)) || {}).label + '）',
        onClick: () => { setActive(t.id); lastNav = { cat: catOf(t.id), active: t.id } },
      }, t.label,
        tabBadges[t.id] ? React.createElement('span', { className: 'tb-tab-badge' }, tabBadges[t.id]) : null,
        t.id === busyTool ? React.createElement('span', { className: 'tb-tab-spin' }) : null)

      let body = null
      if (managing) {
        // 与工具面板同款的「固定头 + 列表独立滚动」：tb-pane → tb-pane-head + tb-pane-body
        body = React.createElement('div', { className: 'tb-frame' },
          React.createElement('div', { className: 'tb-pane' },
            React.createElement('div', { className: 'tb-pane-head' },
              error ? React.createElement('div', { className: 'tb-error' }, String(error)) : null,
              copied ? React.createElement('div', { className: 'tb-banner tb-banner-info' }, String(copied)) : null,
              React.createElement('div', { className: 'tb-row' },
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn tb-btn-primary',
                  disabled: rebuilding,
                  title: canRebuildFromDisk ? undefined : '编译合集：从固化的功能清单恢复 define/run（不读磁盘）',
                  onClick: runRebuild,
                }, rebuilding ? '重建中…' : (canRebuildFromDisk ? '从 plugins.json 重建/补齐' : '恢复编译清单')),
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn',
                  onClick: () => toggleAll(true),
                }, '全部启动'),
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn',
                  title: '重跑全部运行中的 Host-only 插件（改完多个工具代码一键生效；停着的不动）',
                  onClick: restartAll,
                }, '全部重跑'),
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn tb-btn-ghost',
                  title: '隐藏全部无界面（Host-only）工具，只显示含界面的插件；再次点击恢复',
                  onClick: () => toggleAll(false),
                }, '全部停止'),
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-chip' + (hideHostOnly ? ' tb-chip-on' : ''),
                  title: '隐藏左下角 Cordis 面板里的无界面（Host-only）插件（管理页清单不受影响）；亮起为隐藏中，再次点击恢复',
                  onClick: () => { const nv = !hideHostOnly; setHideHostOnly(nv); setPanelHideOn(nv) },
                }, '隐藏CordisPlugin'),
                React.createElement('input', {
                  className: 'tb-input',
                  style: { flex: '1', minWidth: '120px' },
                  placeholder: '按名称 / ID 过滤插件',
                  value: pluginFilter,
                  onChange: (e) => setPluginFilter(e.target.value),
                }),
              ),
              rebuildLines
                ? React.createElement('div', { className: 'tb-note' }, rebuildLines.map((l, i) => React.createElement('div', { key: i }, l)))
                : null,
              rebuildHistory.length && canRebuildFromDisk
                ? (() => {
                    const max = Math.max.apply(null, rebuildHistory.map((h) => h.ms || 0).concat([1]))
                    return React.createElement('div', { className: 'tb-note' },
                      '重建耗时（最近 ' + rebuildHistory.length + ' 次，悬停看详情；红 = 有失败）',
                      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: '36px', marginTop: '6px' } },
                        rebuildHistory.map((h, i) => React.createElement('div', {
                          key: i,
                          title: (h.at || '') + ' · ' + (h.ms == null ? '—' : h.ms + 'ms') + ' · 定义 ' + h.defined + ' / 启动 ' + h.started + ' / 关闭 ' + h.suppressed + ' / 失败 ' + h.failed,
                          style: {
                            width: '10px',
                            height: Math.max(2, Math.round(((h.ms || 0) / max) * 32)) + 'px',
                            borderRadius: '2px',
                            background: h.failed > 0 ? 'var(--tb-danger,#d94f4f)' : 'var(--tb-accent,#3f6fd9)',
                            opacity: 0.85,
                          },
                        }))))
                  })()
                : null,
              aiUsage && canAiUsage && aiUsage.totals && aiUsage.totals.calls
                ? React.createElement('div', { className: 'tb-note' },
                    'AI 用量（台账最近 100 条）：共 ' + aiUsage.totals.calls + ' 次 · 输出 ' + aiUsage.totals.out + ' tok' + (aiUsage.totals.errors ? ' · 失败 ' + aiUsage.totals.errors + ' 次' : '') + (aiUsage.totals.todayCalls ? '；今日 ' + aiUsage.totals.todayCalls + ' 次 / ' + aiUsage.totals.todayOut + ' tok' : ''),
                    React.createElement('div', { className: 'tb-pills', style: { marginTop: '4px' } },
                      aiUsage.tools.map((t) => React.createElement('span', {
                        key: t.tool,
                        className: 'tb-pill tb-pill-plain',
                        title: t.tool + '：成功 ' + t.calls + ' 次 · 输出 ' + t.out + ' tok' + (t.errors ? ' · 失败 ' + t.errors + ' 次' : ''),
                      }, t.tool + ' ' + t.calls + '/' + (t.out >= 10000 ? (t.out / 1000).toFixed(1) + 'k' : t.out) + ' tok')),
                      React.createElement('button', {
                        type: 'button',
                        className: 'tb-btn tb-btn-sm tb-btn-ghost',
                        title: '复制台账汇总 CSV（tool,calls,output_tokens,errors）',
                        onClick: async () => {
                          if (!aiUsage || !Array.isArray(aiUsage.tools)) return
                          const csv = ['tool,calls,output_tokens,errors']
                            .concat(aiUsage.tools.map((t) => [t.tool, t.calls, t.out, t.errors].join(',')))
                            .join('\n')
                          try {
                            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                              await navigator.clipboard.writeText(csv)
                              setCopied('台账 CSV 已复制（' + aiUsage.tools.length + ' 个工具）')
                            } else setCopied('当前环境无剪贴板 API')
                          } catch (e) { setCopied('复制失败: ' + String((e && e.message) || e)) }
                        },
                      }, '复制 CSV')))
                : null,
              React.createElement('div', { className: 'tb-note' }, canRebuildFromDisk
                ? '开关 = 真停 / 真启插件（等同 Cordis 面板的停止/运行，两处状态同步），同时写入启停记忆 .dsh-dynamic-toolbox/toolbox-plugins.json；「重启后」pill = 下次重建的默认启停，点击切换、只改记忆不动当前状态。停止后 Tab 级联消失，启动后约 0.5s 自动挂回。含 Client 半的插件（框架/主题）请到 Cordis 面板操作。'
                : '开关 = 真停 / 真启插件（等同 Cordis 面板的停止/运行，两处状态同步），同时写入本合集的启停记忆；「重启后」pill = 下次启动的默认启停，点击切换、只改记忆不动当前状态。停止后 Tab 级联消失，启动后约 0.5s 自动挂回。含 Client 半的插件请到 Cordis 面板操作。'),
            ),
            React.createElement('div', { className: 'tb-pane-body tb-pane-col' },
              (() => {
                // 管理页永远全量清单；「隐藏无界面」开关只作用于左下角 Cordis 面板
                const visiblePlugins = plugins
                if (visiblePlugins.length === 0) {
                  return React.createElement('div', { className: 'tb-notice' }, '暂无动态插件')
                }
                // 单个插件节点（行 key 用 pluginId，跨分类移动时稳定；条目 id 追加在副行便于辨认归属键）
                const manageRow = (p) =>
                      React.createElement('div', {
                        key: p.pluginId,
                        className: 'tb-manage-row',
                        draggable: Boolean(p.entryId),
                        onDragStart: (e) => {
                          if (!p.entryId) return
                          setDragId(p.entryId)
                          try { if (e.dataTransfer) e.dataTransfer.setData('text/plain', p.entryId) } catch (err) {}
                        },
                        onDragEnd: () => setDragId(null),
                      },
                        p.entryId ? React.createElement('span', { className: 'tb-drag', title: '拖拽到分类标题上调整归属' }, '⋮⋮') : null,
                        React.createElement('div', { className: 'tb-manage-main' },
                          React.createElement('span', { className: 'tb-manage-label' }, p.name),
                          React.createElement('span', { className: 'tb-manage-id' }, p.pluginId + (p.currentPackageId ? ' · ' + p.currentPackageId : '') + (p.entryId ? ' · ' + p.entryId : '')),
                        ),
                        React.createElement('span', { className: 'tb-pill ' + (p.running ? 'tb-pill-done' : 'tb-pill-todo') }, p.running ? '运行中' : '已停止'),
                        p.defaultStart != null
                          ? React.createElement('button', {
                            type: 'button',
                            className: 'tb-pill-btn' + (p.defaultStart ? ' on' : ''),
                            title: '下次重建的默认启停（启停记忆）——点击切换；只改记忆，不动当前运行状态',
                            onClick: () => setDefaultPlugin(p),
                          }, p.defaultStart ? '重启后启动' : '重启后关闭')
                          : null,
                        React.createElement('button', {
                          type: 'button',
                          className: 'tb-btn tb-btn-sm tb-btn-ghost',
                          title: p.hasClientHalf ? '含 Client 半，请到 Cordis 面板操作' : '重跑（重新从磁盘加载实现，改完代码点这个）',
                          disabled: Boolean(p.hasClientHalf),
                          style: p.hasClientHalf ? { opacity: 0.4, cursor: 'default' } : null,
                          onClick: () => restartPlugin(p),
                        }, '重跑'),
                        React.createElement('button', {
                          type: 'button',
                          className: 'tb-switch' + (p.running ? ' tb-switch-on' : ''),
                          // canStop=false：宿主缺少 stopFromPanel（停止降级）——运行中的插件开关禁用，停止的仍可启动
                          title: p.hasClientHalf ? '含 Client 半，请到 Cordis 面板操作'
                            : p.running ? (p.canStop === false ? '当前 DSH 缺少停止接口（stopFromPanel），无法停止' : '停止该插件')
                            : '启动该插件',
                          disabled: Boolean(p.hasClientHalf) || (p.running && p.canStop === false),
                          style: (p.hasClientHalf || (p.running && p.canStop === false)) ? { opacity: 0.4, cursor: 'default' } : null,
                          onClick: () => togglePlugin(p),
                        }),
                      )
                    // 过滤模式：平铺（原行为）；否则按分类树展示
                    const fq = pluginFilter.trim().toLowerCase()
                    if (fq) {
                      return React.createElement('div', { className: 'tb-manage-list' }, visiblePlugins
                        .filter((p) => (p.name || '').toLowerCase().indexOf(fq) >= 0 || (p.pluginId || '').toLowerCase().indexOf(fq) >= 0)
                        .map(manageRow))
                    }
                    const byCat = {}
                    for (const p of visiblePlugins) {
                      const cid = p.entryId ? catOf(p.entryId) : 'system' // 清单外插件归「系统」且不可拖（无稳定归属键）
                      if (!byCat[cid]) byCat[cid] = []
                      byCat[cid].push(p)
                    }
                    const chevron = React.createElement('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'currentColor' },
                      React.createElement('path', { d: 'M3 1.5 L7.5 5 L3 8.5 Z' }))
                    return React.createElement('div', null, TOOL_CATS
                      .filter((c) => byCat[c.id] && byCat[c.id].length)
                      .map((c) => {
                        const list = byCat[c.id]
                        const open = !collapsedCats[c.id]
                        const running = list.filter((p) => p.running).length
                        return React.createElement('div', { key: 'cat-' + c.id },
                          React.createElement('div', {
                            className: 'tb-tree-cat' + (open ? ' tb-tree-cat-open' : '') + (dragId && catOf(dragId) !== c.id ? ' tb-tree-cat-drop' : ''),
                            title: '点击折叠/展开；拖节点到此标题上即改分类（与导航行联动）',
                            onClick: () => toggleCat(c.id),
                            onDragOver: (e) => { if (dragId) e.preventDefault() },
                            onDrop: (e) => { e.preventDefault(); if (dragId) moveNode(dragId, c.id); setDragId(null) },
                          },
                            React.createElement('span', { className: 'tb-tree-chev' }, chevron),
                            React.createElement('span', { className: 'tb-tree-cat-label' }, c.label),
                            React.createElement('span', { className: 'tb-note' }, list.length + ' 个 · ' + running + ' 运行'),
                          ),
                          open ? React.createElement('div', { className: 'tb-tree-kids' }, list.map(manageRow)) : null,
                        )
                      }))
                  })()),
          ),
        )
      } else if (tools.length === 0) {
        body = currentCwd
          ? React.createElement('div', { className: 'tb-empty' },
              canRebuildFromDisk
                ? '当前工作区未检测到 dsh-dynamic-toolbox\n切换到一个包含工具箱的工作区后自动加载；本工作区下不显示工具'
                : '当前工作区暂未挂载本工具箱合集\n切换到一个有效工作区后自动加载；本工作区下不显示工具',
            )
          : React.createElement('div', { className: 'tb-empty' },
              '暂无工具\n运行工具插件（如 Jira）后自动出现在这里；已停止的插件可在右上角管理按钮里重新启动',
            )
      } else {
        body = React.createElement('div', { className: 'tb-frame', ref: panelRef, onClick: onPanelClick, onKeyDown: onPanelKeyDown },
          error ? React.createElement('div', { className: 'tb-error' }, String(error)) : null,
          copied ? React.createElement('div', { className: 'tb-banner tb-banner-info' }, String(copied)) : null,
          html
            ? React.createElement('div', { dangerouslySetInnerHTML: { __html: html } })
            : React.createElement('div', { className: 'tb-notice' }, '加载面板…'),
        )
      }

      const drawerEl = React.createElement('div', {
        ref: drawerRef,
        className: 'jr-drawer' + (dockMode === 'right' ? ' jr-docked' : dockMode === 'full' ? ' jr-docked-full' : ''),
        // bundle root：CSS scope / 主题变量挂载点（多 bundle 共存隔离；PiP 克隆随 DOM 属性一并镜像）
        'data-dsh-toolbox-root': RT.bundleId,
        style,
      },
        React.createElement('div', {
          className: 'jr-drawer-header',
          onPointerDown: onHeaderDown,
          onPointerMove: onHeaderMove,
          onPointerUp: onHeaderUp,
          onPointerCancel: onHeaderUp,
        },
          React.createElement('span', { className: 'jr-drawer-title' }, managing ? RT.displayName + ' · 管理' : RT.displayName),
          themeButton,
          pipButton,
          gearButton,
          dockButton,
          closeButton,
        ),
        // 只有一个工具时整条导航无意义：隐藏搜索工具栏/分类行/Tab 栏，抽屉退化为纯面板；
        // 对所有停靠形态（浮动/右停靠/全占/PiP 镜像）都走同一 Drawer 渲染，天然全部生效。
        managing || tools.length === 1 ? null : React.createElement('div', { className: 'tb-nav' },
          React.createElement('input', {
            className: 'tb-input tb-nav-search',
            placeholder: '搜索工具（共 ' + tools.length + ' 个，匹配名称 / ID）',
            value: tabFilter,
            onChange: (e) => setTabFilter(e.target.value),
          }),
          React.createElement(HRow, { className: 'tb-hrow tb-cats' },
            visibleCats.map((c) => React.createElement('button', {
              key: c.id,
              type: 'button',
              className: 'tb-chip' + (!searching && c.id === effCat ? ' tb-chip-on' : ''),
              title: '分类「' + c.label + '」；管理页（右上角管理按钮）可把节点拖到别的分类',
              onClick: () => pickCat(c.id),
            }, c.label + ' · ' + catCounts[c.id]))),
          React.createElement(HRow, { className: 'tb-hrow tb-tools' },
            shownTools.length
              ? shownTools.map(toolButton)
              : React.createElement('span', { className: 'tb-hrow-empty' }, searching ? '无匹配工具' : '该分类暂无运行中的工具')),
        ),
        React.createElement('div', { className: 'jr-drawer-body' }, body),
        handles,
      )

      const overlay = React.createElement(React.Fragment, null,
        drawerEl,
        snapHint ? React.createElement('div', { className: 'jr-snap-indicator' }) : null,
        resize ? React.createElement('div', { className: 'jr-resize-badge' },
          Math.round(width || 520) + ' × ' + (height ? Math.round(height) : '自动'),
        ) : null,
      )
      return RT.bundleId === 'dynamic' ? overlay : React.createElement('div', {
        'data-dsh-toolbox-scope': RT.domValue(),
        style: { display: 'contents' },
      }, overlay)
    }

    if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
      // 侧边栏导航区无官方 Slot：DOM 注入导航条目（新会话下方、SSH 之后），disposer 随插件停止清理
      ctx.effect(() => mountSidebarEntry())
    } else {
      // 无 DOM 环境兜底：官方 footer Slot（rc.7 root-scoped list Slot，owner 只传 { wide }）
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: RT.slot('entry'), order: -1000, label: RT.displayName },
        (props) => React.createElement(Entry, { wide: Boolean(props.wide) }),
      ))
    }

    slots.inject('shell.overlay', () => slots.register(
      {
        name: 'shell.overlay',
        id: RT.slot('drawer'),
        order: 120,
        label: RT.displayName + '抽屉',
      },
      (props) => React.createElement(Drawer, props),
    ))
  },
}

    }



    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(remoteContribution)
      ctx.effect(() => () => { void disposeRemote() })
      ctx.effect(() => () => { for (const dispose of [...styleDisposers]) dispose() })
      const remote = ctx.get('remote.' + "toolboxNativeFlow")
      if (!remote) throw new Error('静态工具箱 Remote namespace 未挂载: ' + "toolboxNativeFlow")
      const methods = {
        [TOOLBOX_RUNTIME.rpc('tools')]: (args) => remote.tools(args || {}),
        [TOOLBOX_RUNTIME.rpc('panel')]: (args) => remote.panel(args || {}),
        [TOOLBOX_RUNTIME.rpc('plugins')]: (args) => remote.plugins(args || {}),
        [TOOLBOX_RUNTIME.rpc('session-info')]: (args) => remote.sessionInfo(args || {}),
      }
      host = {
        call(methodName, args) {
          const method = methods[methodName]
          if (!method) return Promise.resolve({ ok: false, error: '原生静态合集不支持管理动作: ' + methodName })
          return unwrap(method(args))
        },
      }
      const plugins = [createToolboxClient(), ].filter(Boolean)
      for (const plugin of plugins) {
        if (!plugin || typeof plugin.apply !== 'function') throw new Error('静态 Client feature 未返回有效插件对象')
        const disposer = await plugin.apply(ctx)
        if (typeof disposer === 'function') ctx.effect(() => disposer)
      }
      console.log(TOOLBOX_RUNTIME.logTag() + ' 原生静态 Client 已加载（无动态批准）')
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
