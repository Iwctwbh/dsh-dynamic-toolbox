// aiassist（AI 助手 7 合一）仿真：mock llm + fs（内存盘）+ sessionQuery + subprocess（git scan）。
// 覆盖：默认 preset/打开历史、preset 切换与参数记忆、translate 落盘、compare 多模型并发
// （state 轻量、闭包持有、rounds 磁盘恢复）、commitmsg git scan→生成、review 文件读取、
// aisummary 会话日志→单对象落盘、llm 缺失降级、copy 契约、台账 tool 键 = preset id。
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
    yield { type: 'text-delta', text: 'ANSWER<' + opts.model + '>' }
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
// 预置 review 目标文件
memStore[ROOT + '/sample.js'] = 'const x = 1\nfunction f() { return x }\n'

// sessionQuery：供 aisummary 的 makeSessionLogReader 缓存读（sessions 服务缺失 → 走 readSession 全量）
const sessionQuery = {
  async readSession(sid) {
    return {
      session: { id: sid },
      events: [
        { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '帮我优化这个插件项目' }] } },
        { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好的，我先看目录结构' }] } } },
        { seq: 3, type: 'user/message', data: { content: [{ type: 'text', text: '重点是合并 AI 工具' }] } },
        { seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已合并为 aiassist' }] } } },
      ],
    }
  },
}

// subprocess（commitmsg 的 git scan）：status --porcelain + diff
const gitOut = {
  'status': ' M sample.js\n?? newfile.js\n',
  'diff-staged': '',
  'diff-unstaged': 'diff --git a/sample.js b/sample.js\nindex 111..222 100644\n--- a/sample.js\n+++ b/sample.js\n@@ -1 +1 @@\n-const x = 1\n+const x = 2\n',
}
const subprocess = {
  spawn({ argv }) {
    const isStaged = argv[2] === '--staged'
    const text = argv[1] === 'status' ? gitOut.status : (isStaged ? gitOut['diff-staged'] : gitOut['diff-unstaged'])
    return {
      done: Promise.resolve({ exitCode: 0 }),
      collected: { stdout: { readFrom: () => ({ text }) }, stderr: { readFrom: () => ({ text: '' }) } },
    }
  },
}

const handlers = {}
const ctx = {
  get(name) {
    if (name === 'llm') return llm
    if (name === 'agentDefaultModel') return agentDefaultModel
    if (name === 'fs') return fsSvc
    if (name === 'sessionQuery') return sessionQuery
    if (name === 'subprocess') return subprocess
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
  const src = read('shared/runtime.js') + '\n' + read('shared/host.js') + '\n' + read('plugins/aiassist/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.aiassist
  if (!h) { console.log('FAIL | aiassist 未注册'); process.exit(1) }

  // ---- 打开：默认 preset ask，路由渲染，历史从磁盘读（空）----
  let r = await h({ action: '', fields: {}, state: null, root: ROOT, session: 's1' })
  check('打开 → 默认 preset ask（芯片高亮）', /data-p="ask"[^>]*tb-chip-on/.test(r.html) || r.html.indexOf('data-action="preset" data-p="ask"') >= 0)
  check('打开 → provider/model 下拉渲染', r.html.indexOf('data-field="provider"') >= 0 && r.html.indexOf('data-field="model"') >= 0)
  check('打开 → 空历史提示', r.html.indexOf('结果显示在这里') >= 0)
  check('打开 → 7 个 preset 芯片', (r.html.match(/data-action="preset"/g) || []).length === 7, '' + (r.html.match(/data-action="preset"/g) || []).length)

  // ---- ask send：落盘 toolbox-ask.json，台账 tool=ask ----
  r = await h({ action: 'send', fields: { q: '今天天气？' }, state: r.state, root: ROOT, session: 's1' })
  check('ask send → 回答渲染（HTML 转义）', r.html.indexOf('ANSWER&lt;') >= 0)
  const askStore = JSON.parse(memStore[ROOT + '/.dsh-dynamic-toolbox/toolbox-ask.json'])
  check('ask send → 历史落盘', Array.isArray(askStore) && askStore[0].q === '今天天气？', JSON.stringify((askStore || [])[0] || {}))
  const usage = JSON.parse(memStore[ROOT + '/.dsh-dynamic-toolbox/toolbox-ai-usage.json'])
  check('台账 tool 键 = preset id（ask）', usage.some((u) => u.tool === 'ask' && u.ok), JSON.stringify(usage))
  r = await h({ action: 'copy', fields: { __el: { i: '0' } }, state: r.state, root: ROOT, session: 's1' })
  check('ask copy → 复制回答', typeof r.copy === 'string' && r.copy.indexOf('ANSWER<') >= 0)

  // ---- preset 切换 → translate：参数区（target 下拉）+ 翻译落盘 ----
  r = await h({ action: 'preset', fields: { __el: { p: 'translate' } }, state: r.state, root: ROOT, session: 's1' })
  check('切 translate → 目标语言下拉', r.html.indexOf('data-field="target"') >= 0 && r.html.indexOf('简体中文') >= 0)
  r = await h({ action: 'send', fields: { q: 'hello world', target: 'English' }, state: r.state, root: ROOT, session: 's1' })
  const trStore = JSON.parse(memStore[ROOT + '/.dsh-dynamic-toolbox/toolbox-translate.json'])
  check('translate send → 原文/译文/目标语言落盘', trStore[0].src === 'hello world' && trStore[0].target === 'English' && trStore[0].dst.indexOf('ANSWER<') >= 0)
  r = await h({ action: 'copy', fields: { __el: { i: '0' } }, state: r.state, root: ROOT, session: 's1' })
  check('translate copy → 复制 dst', r.copy === trStore[0].dst)

  // ---- compare：多模型并发、state 轻量、rounds 落盘与重开恢复 ----
  r = await h({ action: 'preset', fields: { __el: { p: 'compare' } }, state: r.state, root: ROOT, session: 's1' })
  check('切 compare → 模型芯片区', r.html.indexOf('data-action="pick"') >= 0)
  // 默认选中会话路由（打开 preset 时会填充）
  check('切 compare → 默认已选 1 个', (r.state.picked || []).length >= 1, JSON.stringify(r.state.picked))
  r = await h({ action: 'pick', fields: { __el: { r: 'deepseek/deepseek-reasoner' } }, state: r.state, root: ROOT, session: 's1' })
  check('pick → 已选 2 个', (r.state.picked || []).length === 2)
  r = await h({ action: 'send', fields: { q: 'hello' }, state: r.state, root: ROOT, session: 's1' })
  check('compare send → 两路结果渲染', r.html.indexOf('deepseek/deepseek-chat') >= 0 && r.html.indexOf('deepseek/deepseek-reasoner') >= 0)
  check('compare send → state 轻量无大结果', JSON.stringify(r.state).length < 2048, 'state=' + JSON.stringify(r.state).length + 'B')
  const cmpStore = memStore[ROOT + '/.dsh-dynamic-toolbox/toolbox-compare.json']
  check('compare send → rounds 落盘', !!cmpStore && JSON.parse(cmpStore)[0].items.length === 2)
  // 重开（新实例闭包空）：磁盘恢复最近一轮
  const h2 = await (async () => {
    const hs = {}
    const c2 = Object.create(ctx)
    c2.get = (name) => (name === 'toolboxRegistry' ? { register(d, hh) { hs[d.id] = hh; return () => {} } } : ctx.get(name))
    const src2 = read('shared/runtime.js') + '\n' + read('shared/host.js') + '\n' + read('plugins/aiassist/tool.js')
    const p2 = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src2 + '\n})()')(c2, undefined, console)
    await p2.apply(c2)
    return hs.aiassist
  })()
  let r2 = await h2({ action: '', fields: {}, state: null, root: ROOT, session: 's1' })
  // 打开默认是 ask，先切 compare
  r2 = await h2({ action: 'preset', fields: { __el: { p: 'compare' } }, state: r2.state, root: ROOT, session: 's1' })
  check('compare 重开 → 磁盘恢复最近一轮', r2.html.indexOf('deepseek/deepseek-chat') >= 0)

  // ---- commitmsg：scan git → 生成，落盘 ----
  let r3 = await h({ action: 'preset', fields: { __el: { p: 'commitmsg' } }, state: r.state, root: ROOT, session: 's1' })
  r3 = await h({ action: 'scan', fields: {}, state: r3.state, root: ROOT, session: 's1' })
  check('commitmsg scan → diff 摘要 banner', r3.html.indexOf('暂存 0') >= 0 && r3.html.indexOf('未暂存 1') >= 0 && r3.html.indexOf('工作区') >= 0, '')
  r3 = await h({ action: 'send', fields: {}, state: r3.state, root: ROOT, session: 's1' })
  const cmStore = JSON.parse(memStore[ROOT + '/.dsh-dynamic-toolbox/toolbox-commitmsg.json'])
  check('commitmsg send → 落盘（工作区 diff）', cmStore[0].msg.indexOf('ANSWER<') >= 0 && cmStore[0].scope === 'unstaged')

  // ---- review：文件路径读取 ----
  r3 = await h({ action: 'preset', fields: { __el: { p: 'review' } }, state: r3.state, root: ROOT, session: 's1' })
  r3 = await h({ action: 'send', fields: { path: 'sample.js' }, state: r3.state, root: ROOT, session: 's1' })
  check('review send → 文件读取并评审', r3.html.indexOf('ANSWER&lt;') >= 0)
  const rvStore = JSON.parse(memStore[ROOT + '/.dsh-dynamic-toolbox/toolbox-review.json'])
  check('review 落盘 target=文件', rvStore[0].target === 'sample.js')

  // ---- aisummary：会话日志 → 单对象落盘 ----
  r3 = await h({ action: 'preset', fields: { __el: { p: 'aisummary' } }, state: r3.state, root: ROOT, session: 's1' })
  r3 = await h({ action: 'send', fields: {}, state: r3.state, root: ROOT, session: 's1' })
  check('aisummary send → 摘要渲染', r3.html.indexOf('ANSWER&lt;') >= 0)
  const asStoreRaw = memStore[ROOT + '/.dsh-dynamic-toolbox/toolbox-aisummary.json']
  const asStore = JSON.parse(asStoreRaw)
  check('aisummary 落盘为单对象（非数组，兼容旧结构）', !Array.isArray(asStore) && typeof asStore.summary === 'string' && asStore.summary.indexOf('ANSWER<') >= 0, asStoreRaw)

  // ---- llm 缺失降级：可开、preset 可切、发送禁用提示 ----
  const ctxNoLlm = Object.create(ctx)
  ctxNoLlm.get = (name) => (name === 'llm' ? undefined : ctx.get(name))
  const hsN = {}
  ctxNoLlm.get = (name) => {
    if (name === 'llm') return undefined
    if (name === 'toolboxRegistry') return { register(d, hh) { hsN[d.id] = hh; return () => {} } }
    return ctx.get(name)
  }
  const srcNo = read('shared/runtime.js') + '\n' + read('shared/host.js') + '\n' + read('plugins/aiassist/tool.js')
  const pNo = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + srcNo + '\n})()')(ctxNoLlm, undefined, console)
  await pNo.apply(ctxNoLlm)
  const hN = hsN.aiassist
  let rn = await hN({ action: '', fields: {}, state: null, root: ROOT, session: 's1' })
  check('llm 缺失 → 打开不崩', rn.ok === true)
  rn = await hN({ action: 'send', fields: { q: 'x' }, state: rn.state, root: ROOT, session: 's1' })
  check('llm 缺失 → 发送提示服务不可用', rn.html.indexOf('llm 服务不可用') >= 0 || (rn.state.notice || '').indexOf('不可用') >= 0)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })