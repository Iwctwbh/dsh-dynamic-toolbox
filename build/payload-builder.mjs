// ===== build/payload-builder.mjs：动态桩 / 编译完整 payload 的公共生成器 =====
// 动态模式：生成「磁盘加载桩」payload（运行时经 loader.js 实时读盘，改实现无需重新 define）。
// 编译模式：生成「自包含完整 payload」（TOOLBOX_RUNTIME_OVERRIDES + shared/runtime.js + 实现源码
// 直接拼接固化，不含任何运行时磁盘查找代码）。
// 两种模式共用同一份插件实现源码（plugins/<key>/…）与 catalog（build/plugin-catalog.mjs）。

const SHARED_HOST = 'shared/host.js' // 工具自动拼接的共享辅助（esc/fmtSize/tryRegisterTool/store/logReader/b64）
const RUNTIME = 'shared/runtime.js' // 两种模式共同的运行配置与命名辅助
const REGISTRY = 'shared/registry.js' // 工具注册表共享实现（仅 toolbox 框架与编译 Bootstrap 使用）

// ---- Host 桩模板（v5 瘦身）：桩只探测根并调用磁盘 loader.js ----
const hostStub = (name, inject, implFiles, rootPrefix) => `// ===== 二级加载桩（v5）：找到 loader.js 并委托，实现逻辑全在磁盘 =====
const TOOL_FILES = ${JSON.stringify(implFiles)}
return {
  name: ${JSON.stringify(name)},
  inject: ${JSON.stringify(inject)},
  async apply(ctx) {
    const fs = ctx.get('fs')
    if (!fs) throw new Error('stub: fs 服务不可用')
    const roots = []
    const sp = ctx.get('sandboxPolicy')
    if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot) roots.push(sp.workspaceRoot)
    const ss = ctx.get('sessions')
    if (ss) { try { for (const s of ss.list()) { const c = s && s.header && s.header.cwd; if (typeof c === 'string' && c && roots.indexOf(c) < 0) roots.push(c) } } catch (e) {} }
    const tried = []
    // 根解析：直下命中 loader.js 优先；否则扫一级子目录（本仓库 clone 为别的项目的子目录场景，
    // 此时 workspaceRoot 是宿主项目根，loader.js 在 <宿主根>/<本仓库子目录>/ 下）
    const hit = await (async () => {
      for (const root of roots) {
        try {
          const t = await fs.resolve(${JSON.stringify(rootPrefix)} + 'loader.js', { cwd: root })
          if (await fs.stat(t)) return { t, root }
          tried.push(root + ': loader.js 不存在')
        } catch (e) { tried.push(root + ': ' + String((e && e.message) || e)) }
      }
      for (const root of roots) {
        try {
          const dt = await fs.resolve('.', { cwd: root })
          const entries = await fs.listDir(dt)
          for (const ent of entries || []) {
            if (!ent || ent.type !== 'directory' || !ent.name) continue
            if (ent.name.charAt(0) === '.' || ent.name === 'node_modules') continue
            try {
              const sub = root.replace(/[\\\\/]+$/, '') + '/' + ent.name
              const t = await fs.resolve(${JSON.stringify(rootPrefix)} + 'loader.js', { cwd: sub })
              if (await fs.stat(t)) return { t, root: sub }
            } catch (e2) {}
          }
          tried.push(root + ': 一级子目录未见 loader.js')
        } catch (e) { tried.push(root + ' 扫描: ' + String((e && e.message) || e)) }
      }
      return null
    })()
    if (hit) {
      const root = hit.root
      try {
        const fn = new Function('ctx', 'harness', 'console', 'IMPL_FILES', 'usedRoot', 'return (async () => {\\n' + await fs.readText(hit.t) + '\\n})()')
        return await fn(ctx, typeof harness === 'undefined' ? undefined : harness, console, TOOL_FILES, root)
      } catch (e) { tried.push(root + ': ' + String((e && e.message) || e)) }
    }
    throw new Error('stub: 无法加载 ${rootPrefix}loader.js（尝试根: ' + (roots.join(', ') || '(无)') + (tried.length ? '；明细: ' + tried.join(' | ') : '') + '）')
  },
}
`

// ---- 带 client-impl RPC 的 Host 桩：委托前注册 <rpc>，Client 半经它实时拉磁盘 client.js ----
// 返回内容 = shared/runtime.js + client.js（§6.3：动态与编译两条路径最终求值同一份 Client 主体）
const hostStubWithClientRpc = (name, inject, implFiles, rpc, clientRel, rootPrefix) => hostStub(name, inject, implFiles, rootPrefix)
  .replace(
    "        const fn = new Function(",
    `        ctx.effect(() => harness.handle('${rpc}', async () => {
          try {
            const parts = []
            for (const rel of ${JSON.stringify([RUNTIME])}.concat([${JSON.stringify(clientRel)}])) {
              const target = await fs.resolve(rel, { cwd: root })
              parts.push(await fs.readText(target))
            }
            return { ok: true, code: parts.join('\\n') }
          } catch (e) {
            return { ok: false, error: String((e && e.message) || e) }
          }
        }))
        const fn = new Function(`,
  )

// ---- Client 加载桩：经 Host 半 <rpc> 实时拉磁盘 client.js 求值 ----
// （嵌套 new Function 帧不吃外层形参——ctx/React/host/styles/console 显式下传）。
// 改 plugins/<key>/client.js 后 cordis_run 重跑对应插件即生效，无需重新 define/批准。
// Timer 生命周期：第二层函数不再从浏览器全局读 setTimeout/setInterval（那会绕过 Dynamic
// Client Guard 的闭包 trap，也绕过 Fiber 清理）——改由桩在 apply 内用 Cordis timer 服务
// 建浏览器兼容适配器（数字句柄 ↔ disposer 映射），作为显式形参下传；ctx.effect 的 teardown
// 在 Package 停止/重跑时清掉全部未决回调，连续重跑不累积 interval。
const clientLoaderStub = (rpc, key) => `// ===== ${key} Client 加载桩：实现实时从磁盘拉取（经 Host 半 ${rpc} RPC）=====
return {
  name: '${key}-client-loader',
  inject: ['timer'],
  async apply(ctx) {
    const timer = ctx.get('timer')
    if (!timer) throw new Error('${key} client: timer 服务不可用')

    let nextTimerId = 0
    const pendingTimers = new Map()

    const setTimeoutCompat = (callback, delay) => {
      const id = ++nextTimerId
      const dispose = timer.timeout(() => {
        pendingTimers.delete(id)
        callback()
      }, delay)
      pendingTimers.set(id, dispose)
      return id
    }

    const setIntervalCompat = (callback, delay) => {
      const id = ++nextTimerId
      pendingTimers.set(id, timer.interval(callback, delay))
      return id
    }

    const clearTimerCompat = (id) => {
      const dispose = pendingTimers.get(id)
      pendingTimers.delete(id)
      if (dispose) dispose()
    }

    ctx.effect(() => () => {
      for (const dispose of pendingTimers.values()) dispose()
      pendingTimers.clear()
    })

    const res = await host.call('${rpc}')
    if (!res || !res.ok) throw new Error('${rpc} 拉取失败: ' + String((res && res.error) || '(无响应)'))
    const fn = new Function(
      'ctx', 'React', 'host', 'styles', 'console',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'return (async () => {\\n' + res.code + '\\n})()',
    )
    const impl = await fn(ctx, React, host, styles, console, setTimeoutCompat, setIntervalCompat, clearTimerCompat, clearTimerCompat)
    if (!impl || typeof impl.apply !== 'function') throw new Error('${key} client.js 未返回插件对象')
    return impl.apply(ctx)
  },
}
`

// ---- 插件的 Host 实现文件清单（runtime + [registry] + [shared/host] + hostFiles，保持拼接顺序）----
// shared/runtime.js 永远第一：业务实现只读 TOOLBOX_RUNTIME，动态模式取默认值（与历史行为一致）
export const hostImplFiles = (entry) =>
  [RUNTIME]
    .concat(entry.sharedRegistry ? [REGISTRY] : [])
    .concat(entry.sharedHost === false ? [] : [SHARED_HOST])
    .concat(entry.hostFiles || [])

// ---- 动态模式 payload（写 plugins/<key>/payload.json 的内容）----
// readSource：按根相对路径读源码（client-only 条目的 Client 源需要原样内联，无 Host 半可拉取）
export const buildDynamicPayload = (entry, { rootPrefix = '', readSource } = {}) => {
  const code = {}
  if (entry.hostFiles && entry.hostFiles.length) {
    const implFiles = hostImplFiles(entry)
    code.host = entry.clientRpc
      ? hostStubWithClientRpc(entry.name, entry.inject, implFiles, entry.clientRpc, rootPrefix + entry.clientFile, rootPrefix)
      : hostStub(entry.name, entry.inject, implFiles, rootPrefix)
  }
  if (entry.clientFile) {
    code.client = entry.clientRpc
      ? clientLoaderStub(entry.clientRpc, entry.key)
      : readSource(RUNTIME) + '\n' + readSource(entry.clientFile)
  }
  return { plugin: { kind: 'new', idPrefix: entry.idPrefix }, name: entry.name, purpose: entry.purpose, code }
}

export const SHARED_HOST_PATH = SHARED_HOST
