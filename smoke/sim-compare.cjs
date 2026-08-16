// compare 工具仿真：mock llm（双 provider）+ mock fs（内存台账）。
// 核心断言：多模型回答本体不进 state；clear-results/磁盘恢复闭包链路完整。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const MODELS = {
  deepseek: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
  moonshot: [{ id: 'kimi-k2' }],
}
const llm = {
  async listProviders() { return [{ id: 'deepseek' }, { id: 'moonshot' }] },
  async listModels(p) { return MODELS[p] || [] },
  async *stream(opts) {
    yield { type: 'text-delta', text: 'ANSWER-' + opts.model + '-' + 'y'.repeat(8000) } // 每路 ~8KB 回答
    yield { type: 'usage', usage: { outputTokens: 42 } }
  },
}
const agentDefaultModel = { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }

const memStore = {}
const fsSvc = {
  async resolve(rel, opts) { return (opts && opts.cwd ? opts.cwd : ROOT) + '/' + rel },
  async stat(t) { return Object.prototype.hasOwnProperty.call(memStore, t) },
  async readText(t) { return memStore[t] },
  async writeText(t, content) { memStore[t] = String(content) },
}

const handlers = {}
const ctx = {
  get(name) {
    if (name === 'llm') return llm
    if (name === 'agentDefaultModel') return agentDefaultModel
    if (name === 'fs') return fsSvc
    if (name === 'toolboxRegistry') return { register(d, h) { handlers[d.id] = h; return () => {} } }
    if (name === 'sandboxPolicy') return { workspaceRoot: ROOT }
    return undefined
  },
  on() {}, effect() {},
  timeout(fn, ms) { const t = setTimeout(fn, ms); t.unref && t.unref(); return () => clearTimeout(t) },
  interval(fn) { try { fn() } catch (e) {} return () => {} },
}

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

;(async () => {
  const src = read('shared/host.js') + '\n' + read('plugins/compare/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.compare
  if (!h) { console.log('FAIL | compare 未注册'); process.exit(1) }

  // 打开 → 默认选中会话模型
  let r = await h({ action: '', fields: {}, state: null, root: ROOT, session: 's1' })
  check('打开 → 默认选中会话默认路由', (r.state.picked || []).join() === 'deepseek/deepseek-chat', JSON.stringify(r.state.picked))

  // 加选第二个模型（芯片）
  r = await h({ action: 'pick', fields: { __el: { r: 'deepseek/deepseek-reasoner' } }, state: r.state, root: ROOT, session: 's1' })
  check('pick → 已选 2 个', (r.state.picked || []).length === 2)

  // 发送
  r = await h({ action: 'send', fields: { q: 'hello' }, state: r.state, root: ROOT, session: 's1' })
  check('send → 两路结果都渲染', r.html.indexOf('deepseek/deepseek-chat') >= 0 && r.html.indexOf('deepseek/deepseek-reasoner') >= 0)
  check('send → state 无 results 字段且轻量（回答 ~16KB）', !('results' in r.state) && JSON.stringify(r.state).length < 2048, 'state=' + JSON.stringify(r.state).length + 'B')
  const savedRaw = memStore[ROOT + '/.dsh-dynamic-toolbox/toolbox-compare.json']
  check('send → 落盘最近轮（回答截 4000）', !!savedRaw && JSON.parse(savedRaw)[0].items[0].a.length === 4000)

  // 切 provider（联动，结果区应保持——闭包未被清）
  r = await h({ action: 'route', fields: { provider: 'moonshot' }, state: r.state, root: ROOT, session: 's1' })
  check('route → 芯片换成 moonshot 模型', r.html.indexOf('kimi-k2') >= 0)
  check('route → 结果区仍在（闭包持有）', r.html.indexOf('deepseek/deepseek-chat') >= 0)
  check('route → state 仍无 results', !('results' in r.state))

  // 清除结果
  r = await h({ action: 'clear-results', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('clear-results → 结果区回占位', r.html.indexOf('结果区') >= 0 && r.html.indexOf('ANSWER-') < 0)

  // 模拟重开 Tab：磁盘恢复上一轮（新插件实例闭包为空 → 直接测 '' 分支从磁盘读）
  r = await h({ action: '', fields: {}, state: null, root: ROOT, session: 's1' })
  check('重开 → 从磁盘恢复最近一轮（截断版）', r.html.indexOf('ANSWER-') >= 0 && r.html.indexOf('deepseek/deepseek-chat') >= 0)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
