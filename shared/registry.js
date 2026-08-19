// ===== shared/registry.js：工具注册表共享实现（唯一事实源）=====
// 同一源码三处使用：
//   1. 动态模式：拼接进 toolbox 框架 Host payload（IMPL_FILES，见 build/payload-builder.mjs）；
//   2. 编译模式：静态 Bootstrap 经编译器内嵌同一源码 provide namespaced registry Service；
//   3. host-bootstrap/index.js 保留一份同步副本（静态插件无法读本仓库文件，改契约须两边同步）。
// 契约：attach/detach/register/runInBuild/tools/panel/has/roots/clear。
// 状态挂在返回对象闭包上（跨 fiber 共享）：root → 工具表。
// 工具注册归「当前 build root」；build 用锁式 runInBuild(root, fn) —— 整个异步段持锁，
// 段内（工具插件 apply 的 register）buildRoot 稳定，多仓库/多 bundle 并行冷启绝不串表。
const makeToolboxRegistry = () => {
  const tables = new Map() // root -> Map<id, entry>
  let buildRoot = null
  let lastRoot = null
  let lock = Promise.resolve()
  const tableOf = (root) => {
    if (!root) return null
    let t = tables.get(root)
    if (!t) { t = new Map(); tables.set(root, t) }
    return t
  }
  const register = (desc, handler) => {
    if (!desc || typeof desc.id !== 'string' || !desc.id || typeof handler !== 'function') return () => {}
    const t = tableOf(buildRoot || lastRoot)
    if (!t) return () => {}
    const entry = { id: desc.id, label: desc.label || desc.id, order: typeof desc.order === 'number' ? desc.order : 0, handler }
    t.set(desc.id, entry)
    // disposer 只删除自己注册的 entry：同 ID 后注册替换前注册时，旧 disposer 不能误删新 entry
    return () => { if (t.get(desc.id) === entry) t.delete(desc.id) }
  }
  return {
    attach(root) { if (!root) return; lastRoot = root; tableOf(root) },
    detach(root) { if (root) tables.delete(root) },
    register,
    // 互斥 build 段：await 前一个段结束 → buildRoot=root → 执行 fn（段内任何 register 都归
    // root）→ finally 清 buildRoot 并释放锁。锁在服务对象上，覆盖所有 root。
    async runInBuild(root, fn) {
      const prev = lock
      let r
      lock = new Promise((res) => { r = res })
      await prev
      buildRoot = root || null
      try { return await fn() } finally { buildRoot = null; r() }
    },
    tools(root) {
      const t = tables.get(root || lastRoot) || new Map()
      return [...t.values()].sort((a, b) => a.order - b.order)
        .map((x) => ({ id: x.id, label: x.label, order: x.order }))
    },
    async panel(root, call) {
      const t = tables.get(root || lastRoot)
      const toolId = call && typeof call.tool === 'string' ? call.tool : ''
      const entry = t && t.get(toolId)
      if (!entry || !entry.handler) return { ok: false, error: '工具未注册或已停止: ' + (toolId || '(空)') }
      try {
        const res = await entry.handler({
          action: call && typeof call.action === 'string' ? call.action : '',
          fields: (call && call.fields && typeof call.fields === 'object') ? call.fields : {},
          state: (call && call.state) || null,
          root: (typeof root === 'string' && root) ? root : undefined,
          session: (call && typeof call.session === 'string' && call.session) ? call.session : undefined,
        })
        // panel 永远校验 handler 返回 html 字符串
        if (!res || typeof res.html !== 'string') return { ok: false, error: '工具返回了无效的面板内容' }
        const out = { ok: true, html: res.html, state: res.state == null ? null : res.state }
        if (typeof res.copy === 'string' && res.copy) out.copy = res.copy
        return out
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    },
    has(root) { return root ? tables.has(root) : false },
    roots() { return [...tables.keys()] },
    clear() { tables.clear(); buildRoot = null; lastRoot = null },
  }
}
