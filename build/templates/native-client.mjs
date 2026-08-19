// ===== build/templates/native-client.mjs：DSH script-loader Client bundle =====
// DSH 原生 Client 文件不是浏览器 ESM；必须预注册到 window.__ModuleLoader__。
export const renderNativeClient = ({
  packageName, profile, runtimeSource, toolboxClientSource, clientFeatures,
}) => {
  const factories = clientFeatures.map(({ key, source }) => {
    const id = key.replace(/[^A-Za-z0-9_$]/g, '_')
    return `const create_${id} = () => {\n${source}\n}`
  }).join('\n\n')
  const calls = clientFeatures.map(({ key }) => 'create_' + key.replace(/[^A-Za-z0-9_$]/g, '_') + '()').join(', ')
  const descriptorId = packageName + '/remote#' + profile.remoteNamespace + '/'
  return `window.__ModuleLoader__.load({
  id: ${JSON.stringify(packageName)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const name = ${JSON.stringify(packageName + '/client')}
    const inject = ['slots', 'remote', 'timer']

    const TOOLBOX_RUNTIME_OVERRIDES = ${JSON.stringify(profile, null, 2)}
${runtimeSource}

    const json = Object.freeze({ parse(value) { return value } })
    const descriptor = (method) => ({
      id: ${JSON.stringify(descriptorId)} + method,
      service: ${JSON.stringify(profile.remoteService)},
      namespace: ${JSON.stringify(profile.remoteNamespace)},
      method,
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request', wire: 'request', source: 'json',
        codec: { mode: 'strict', typeSymbol: ${JSON.stringify(packageName + '#JsonRequest')}, schema: json },
      }],
      result: { mode: 'strict', typeSymbol: ${JSON.stringify(packageName + '#JsonResult')}, schema: json },
    })
    const remoteContribution = Object.freeze({
      package: ${JSON.stringify(packageName)},
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
${toolboxClientSource}
    }

${factories}

    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(remoteContribution)
      ctx.effect(() => () => { void disposeRemote() })
      ctx.effect(() => () => { for (const dispose of [...styleDisposers]) dispose() })
      const remote = ctx.get('remote.' + ${JSON.stringify(profile.remoteNamespace)})
      if (!remote) throw new Error('静态工具箱 Remote namespace 未挂载: ' + ${JSON.stringify(profile.remoteNamespace)})
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
      const plugins = [createToolboxClient(), ${calls}].filter(Boolean)
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
`
}
