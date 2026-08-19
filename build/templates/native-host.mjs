// ===== build/templates/native-host.mjs：原生 DSH Host 插件入口 =====
// 不使用 dynamicCordisRunner；所选 feature 源码在构建期包进普通函数，由静态 Loader 直接挂载。

export const renderNativeHost = ({
  packageName, profile, runtimeSource, sharedHostSource, hostFeatures, inject,
}) => {
  const factories = hostFeatures.map(({ key, source }) => {
    const id = key.replace(/[^A-Za-z0-9_$]/g, '_')
    return `const create_${id} = () => {\n${source}\n}`
  }).join('\n\n')
  const factoryCalls = hostFeatures.map(({ key }) => 'create_' + key.replace(/[^A-Za-z0-9_$]/g, '_') + '()').join(', ')

  return `// ===== ${profile.displayName} · DSH 原生静态 Host（构建生成，勿手改） =====
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'

export const name = ${JSON.stringify(packageName)}
export const inject = ${JSON.stringify(inject)}

const TOOLBOX_RUNTIME_OVERRIDES = ${JSON.stringify(profile, null, 2)}
${runtimeSource}

// 静态注册表：feature 只挂载一次，handler 每次调用接收当前 root/session，适用于任意工作区。
const makeStaticRegistry = () => {
  const entries = new Map()
  return {
    register(desc, handler) {
      if (!desc || typeof desc.id !== 'string' || !desc.id || typeof handler !== 'function') return () => {}
      const entry = { id: desc.id, label: desc.label || desc.id, order: typeof desc.order === 'number' ? desc.order : 0, icon: desc.icon || null, handler }
      entries.set(desc.id, entry)
      return () => { if (entries.get(desc.id) === entry) entries.delete(desc.id) }
    },
    tools() {
      return [...entries.values()].sort((a, b) => a.order - b.order).map((x) => ({ id: x.id, label: x.label, order: x.order, icon: x.icon || null }))
    },
    async panel(root, call) {
      const toolId = call && typeof call.tool === 'string' ? call.tool : ''
      const entry = entries.get(toolId)
      if (!entry) return { ok: false, error: '工具未注册: ' + (toolId || '(空)') }
      try {
        const res = await entry.handler({
          action: call && typeof call.action === 'string' ? call.action : '',
          fields: call && call.fields && typeof call.fields === 'object' ? call.fields : {},
          state: call && call.state || null,
          root: typeof root === 'string' && root ? root : undefined,
          session: call && typeof call.session === 'string' && call.session ? call.session : undefined,
        })
        if (!res || typeof res.html !== 'string') return { ok: false, error: '工具返回了无效面板内容' }
        const out = { ok: true, html: res.html, state: res.state == null ? null : res.state }
        if (typeof res.copy === 'string' && res.copy) out.copy = res.copy
        return out
      } catch (error) { return { ok: false, error: String(error && error.message || error) } }
    },
  }
}

${sharedHostSource}

${factories}

// Remote 使用标准装饰器的运行时标记；生成代码是普通 JS，因此显式执行 decorator initializer。
const exposeRemote = (klass, method, exportName) => {
  const initializers = []
  Remote(exportName || method)(klass.prototype[method], {
    private: false, static: false, name: method,
    addInitializer(fn) { initializers.push(fn) },
  })
  const marker = Object.create(klass.prototype)
  for (const init of initializers) init.call(marker)
}

class NativeToolboxRemote extends TypertRemoteService {
  constructor(ctx, registry) {
    super(ctx, ${JSON.stringify(profile.remoteService)}, { namespace: ${JSON.stringify(profile.remoteNamespace)} })
    this.registry = registry
  }
  tools(request) {
    const root = request && typeof request.root === 'string' ? request.root : undefined
    return { ok: true, root: root || null, tools: this.registry.tools() }
  }
  panel(request) {
    const root = request && typeof request.root === 'string' ? request.root : undefined
    return this.registry.panel(root, request || {})
  }
  plugins(request) {
    void request
    return { ok: true, plugins: [], capabilities: TOOLBOX_RUNTIME.capabilities }
  }
  async sessionInfo(request) {
    const sid = request && typeof request.session === 'string' ? request.session : ''
    if (!sid) return { ok: false, error: '缺少会话 id' }
    const sessions = this.ctx.get('sessions')
    if (sessions && typeof sessions.get === 'function') {
      try {
        const session = sessions.get(sid)
        const cwd = session && session.header && session.header.cwd
        if (typeof cwd === 'string' && cwd) return { ok: true, cwd }
      } catch (error) {}
    }
    const query = this.ctx.get('sessionQuery')
    if (query && typeof query.listSessions === 'function') {
      try {
        const rows = await query.listSessions()
        const hit = (rows || []).find((row) => row && row.id === sid)
        const cwd = hit && hit.header && hit.header.cwd
        if (typeof cwd === 'string' && cwd) return { ok: true, cwd }
      } catch (error) {}
    }
    return { ok: false, error: '会话不存在或不可读: ' + sid }
  }
}
for (const method of ['tools', 'panel', 'plugins', 'sessionInfo']) exposeRemote(NativeToolboxRemote, method)

export async function apply(ctx) {
  const registry = makeStaticRegistry()
  ctx.provide(TOOLBOX_RUNTIME.registryService, registry)
  const features = [${factoryCalls}]
  for (const feature of features) {
    if (!feature || typeof feature.apply !== 'function') throw new Error('静态 feature 未返回有效插件对象')
    const disposer = await feature.apply(ctx)
    if (typeof disposer === 'function') ctx.effect(() => disposer)
  }
  new NativeToolboxRemote(ctx, registry)
  console.log(TOOLBOX_RUNTIME.logTag() + ' 原生静态 Host 已加载（功能: ' + registry.tools().map((x) => x.id).join(', ') + '）')
}
`
}
