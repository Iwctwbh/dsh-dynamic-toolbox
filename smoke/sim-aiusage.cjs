// aiusage 工具仿真：mock fs（内存 JSON 台账）驱动 handler，验证渲染与清空两步确认。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 内存台账：key = 解析后的绝对路径
const memStore = {}
const fsSvc = {
  async resolve(rel, opts) { return (opts && opts.cwd ? opts.cwd : ROOT) + '/' + rel },
  async stat(t) { return Object.prototype.hasOwnProperty.call(memStore, t) },
  async readText(t) { return memStore[t] },
  async writeText(t, content) { memStore[t] = String(content) },
}

const handlers = {}
const toolboxRegistry = { register(d, h) { handlers[d.id] = h; return () => {} } }
const ctx = {
  get(name) {
    if (name === 'toolboxRegistry') return toolboxRegistry
    if (name === 'fs') return fsSvc
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
  const src = read('shared/host.js') + '\n' + read('plugins/aiusage/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.aiusage
  if (!h) { console.log('FAIL | aiusage 未注册'); process.exit(1) }

  // 空台账 → 空状态提示
  let r = await h({ action: '', fields: {}, state: null, root: ROOT, session: 's1' })
  check('空台账 → 空状态提示', r.ok && r.html.indexOf('暂无旁路调用记录') >= 0)

  // 造 3 条记录（2 成功 1 失败，含今日）
  const now = Date.now()
  memStore[ROOT + '/.dsh-dynamic-toolbox/toolbox-ai-usage.json'] = JSON.stringify([
    { t: now, tool: 'ask', out: 120, ms: 800, ok: true },
    { t: now, tool: 'ask', out: 60, ms: 500, ok: true },
    { t: now - 86400000, tool: 'translate', out: null, ms: 300, ok: false },
  ])
  r = await h({ action: 'reload', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('总计：2 成功 + 1 失败', r.html.indexOf('>2</span><span class="tb-stat-label">总调用') >= 0 && r.html.indexOf('>1</span><span class="tb-stat-label">失败') >= 0)
  check('按工具聚合：ask 2 次 / 输出 180', r.html.indexOf('ask') >= 0 && r.html.indexOf('>2 次</span>') >= 0 && r.html.indexOf('>180</span>') >= 0)
  check('今日调用 2（昨日失败不计）', r.html.indexOf('>2</span><span class="tb-stat-label">今日调用') >= 0)
  check('明细含 ✗ 失败行', r.html.indexOf('✗ 失败') >= 0)

  // 两步确认清空
  r = await h({ action: 'clear', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('clear → 出现确认按钮', r.html.indexOf('确认清空？') >= 0 && r.state.confirmClear === true)
  r = await h({ action: 'clear-confirm', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('clear-confirm → 台账落盘为空数组', memStore[ROOT + '/.dsh-dynamic-toolbox/toolbox-ai-usage.json'] === '[]')
  check('clear-confirm → 提示已清空', r.html.indexOf('台账已清空') >= 0)
  r = await h({ action: '', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('清空后 → 回到空状态提示', r.html.indexOf('暂无旁路调用记录') >= 0)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
