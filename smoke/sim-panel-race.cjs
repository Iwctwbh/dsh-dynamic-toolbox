// 面板联动竞态固化用例（两段式）：
// 阶段 A（无序号防护，模拟修复前行为）→ 竞态必须复现（后到的慢响应覆盖新选择），作为回归护栏；
// 阶段 B（有防护，与 client.js loadPanel 现行逻辑一致）→ 必须全部通过。
// 保真要点：state 跨 RPC 是 JSON 深拷贝；llm.listModels 冷缓存有真实 I/O 时延。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const MODELS = {
  deepseek: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
  moonshot: [{ id: 'kimi-k2' }, { id: 'kimi-latest' }],
}
let modelDelay = { deepseek: 0, moonshot: 0 }
const llm = {
  async listProviders() { return [{ id: 'deepseek', name: 'DeepSeek' }, { id: 'moonshot', name: 'Moonshot' }] },
  async listModels(p) {
    const d = modelDelay[p] || 0
    if (d) await new Promise((r) => setTimeout(r, d))
    return MODELS[p] || []
  },
  async *stream(opts) {
    yield { type: 'text-delta', text: 'ANS' }
    yield { type: 'usage', usage: { outputTokens: 1 } }
  },
}
const agentDefaultModel = { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }

const baseCtx = {
  get(name) {
    if (name === 'llm') return llm
    if (name === 'agentDefaultModel') return agentDefaultModel
    if (name === 'sandboxPolicy') return { workspaceRoot: ROOT }
    return undefined
  },
  on() {}, effect() {},
  timeout(fn, ms) { const t = setTimeout(fn, ms); t.unref && t.unref(); return () => clearTimeout(t) },
  interval(fn) { try { fn() } catch (e) {} return () => {} },
}

const src = read('shared/runtime.js') + '\n' + read('shared/host.js') + '\n' + read('plugins/aiassist/tool.js')
async function evalPlugin() {
  const hs = {}
  const reg = { register(d, h) { hs[d.id] = h; return () => {} } }
  const c = Object.create(baseCtx)
  c.get = (name) => (name === 'toolboxRegistry' ? reg : baseCtx.get(name))
  const f = new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')
  const plugin = await f(c, undefined, console)
  await plugin.apply(c)
  return hs.aiassist
}

// client loadPanel 等价物（guard 开关模拟修复前后）
function makeClient(handler, useGuard) {
  const stateRef = {}
  const htmlRef = {}
  const seqRef = {}
  async function loadPanel(toolId, action, fields) {
    const seq = (seqRef[toolId] || 0) + 1
    seqRef[toolId] = seq
    const stateCopy = stateRef[toolId] ? JSON.parse(JSON.stringify(stateRef[toolId])) : null
    const res = await handler({ action: action || '', fields: fields || {}, state: stateCopy, root: ROOT, session: 's1' })
    if (useGuard && seqRef[toolId] !== seq) return null
    if (res && res.ok) { stateRef[toolId] = JSON.parse(JSON.stringify(res.state)); htmlRef[toolId] = res.html }
    return res
  }
  return { stateRef, htmlRef, loadPanel }
}

function selectedOf(html, field) {
  const re = new RegExp('<select[^>]*data-field="' + field + '"[^>]*>([\\s\\S]*?)</select>')
  const m = html.match(re)
  if (!m) return null
  const opts = [...m[1].matchAll(/<option value="([^"]*)"( selected)?>/g)].map((x) => ({ v: x[1], sel: !!x[2] }))
  return { options: opts.map((o) => o.v), selected: (opts.find((o) => o.sel) || {}).v || null }
}

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

async function race(useGuard) {
  const h = await evalPlugin() // 全新实例 = 冷 modelsCache
  const c = makeClient(h, useGuard)
  await c.loadPanel('aiassist', '', {})
  modelDelay = { deepseek: 0, moonshot: 120 } // moonshot 慢适配器
  const p1 = c.loadPanel('aiassist', 'route', { provider: 'moonshot', model: 'deepseek-chat', q: '' }) // 先发后到
  const p2 = c.loadPanel('aiassist', 'route', { provider: 'deepseek', model: 'deepseek-chat', q: '' }) // 后发先到
  await Promise.all([p1, p2])
  modelDelay = { deepseek: 0, moonshot: 0 }
  return { ui: selectedOf(c.htmlRef.aiassist, 'provider').selected, state: (c.stateRef.aiassist || {}).provider }
}

;(async () => {
  // 阶段 A：无防护 → 必须复现乱序覆盖（用户最后选 deepseek，却停在 moonshot）
  const a = await race(false)
  check('A 无防护复现竞态（UI 错停 moonshot）', a.ui === 'moonshot' && a.state === 'moonshot', 'ui=' + a.ui)

  // 阶段 B：有防护 → 最终必须落在用户最后选择 deepseek
  const b = await race(true)
  check('B 有防护竞态修复（UI=state=deepseek）', b.ui === 'deepseek' && b.state === 'deepseek', 'ui=' + b.ui)

  // 串行联动回归（防护开启）
  const h = await evalPlugin()
  const c = makeClient(h, true)
  let r = await c.loadPanel('aiassist', '', {})
  check('串行：打开默认会话路由', selectedOf(r.html, 'provider').selected === 'deepseek' && selectedOf(r.html, 'model').selected === 'deepseek-chat')
  r = await c.loadPanel('aiassist', 'route', { provider: 'moonshot', model: 'deepseek-chat', q: '' })
  check('串行：切换 provider 换模型列表', selectedOf(r.html, 'provider').selected === 'moonshot' && selectedOf(r.html, 'model').selected === 'kimi-k2')
  r = await c.loadPanel('aiassist', 'send', { provider: 'moonshot', model: 'kimi-latest', q: 'hi' })
  check('串行：按所选路由调用', ((r.state.history || [])[0] || {}).route === 'moonshot/kimi-latest')

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
