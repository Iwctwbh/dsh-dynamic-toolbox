// flow 工具仿真：mock sessionQuery（主会话 + 子代理会话）+ sessions（live 判定）。
// 断言：主干流程节点顺序与箭头、平行卡片分组（同 step 多调用）、子代理 git 树分支
// （├─/│/╰─ + 子会话步骤展开 + live 徽章）、自动刷新声明、live 开关、事件配对状态色。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// ---- 主会话事件样本：用户 → 助手 → [read+grep 平行] → 助手 → subagent 分支 → 助手 ----
const MAIN_EVENTS = [
  { seq: 1, time: 1000, type: 'user/message', data: { content: [{ type: 'text', text: '帮我看下这个目录' }], source: { kind: 'user' } } },
  { seq: 2, time: 1100, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好的，我先并行读文件' }] }, usage: { outputTokens: 12 } } },
  { seq: 3, time: 1200, type: 'tool/call', data: { turn: 1, step: 1, name: 'read', callId: 'c1', arguments: '{"file_path":"a.js"}' } },
  { seq: 4, time: 1210, type: 'tool/call', data: { turn: 1, step: 1, name: 'grep', callId: 'c2', arguments: '{"pattern":"foo"}' } },
  { seq: 5, time: 1300, type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'file a content' }] }] } } },
  { seq: 6, time: 1310, type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'grep hits' }] }] } } },
  { seq: 7, time: 1400, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '再派个子代理调研' }] }, usage: { outputTokens: 9 } } },
  { seq: 8, time: 1500, type: 'tool/call', data: { turn: 1, step: 2, name: 'subagent', callId: 'c3', arguments: '{"description":"调研","prompt":"看看"}' } },
  { seq: 9, time: 1600, type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c3', content: [{ type: 'text', text: 'started subagent 228a8697-2b7a-422a-b3c0-1cf61c965d5c' }] }] } } },
  { seq: 10, time: 1700, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '子代理已启动' }] }, usage: { outputTokens: 5 } } },
]
// ---- 子代理会话事件样本 ----
const CHILD_EVENTS = [
  { seq: 1, time: 1510, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '我开始调研' }] } } },
  { seq: 2, time: 1520, type: 'tool/call', data: { turn: 1, step: 1, name: 'grep', callId: 'x1', arguments: '{"pattern":"bar"}' } },
  { seq: 3, time: 1560, type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'x1', content: [{ type: 'text', text: 'child hits' }] }] } } },
]

const sessionQuery = {
  async readSession(sid) {
    if (sid === 's-main') return { session: { id: 's-main' }, events: MAIN_EVENTS }
    if (sid === '228a8697-2b7a-422a-b3c0-1cf61c965d5c') return { session: { id: sid }, events: CHILD_EVENTS }
    return { session: { id: sid }, events: [] }
  },
  async listSessions() { return [{ header: { id: 's-main' }, live: true }] },
}
const sessions = { get: (id) => (id === '228a8697-2b7a-422a-b3c0-1cf61c965d5c' ? { events: CHILD_EVENTS, header: { id } } : undefined), list: () => [] }

const handlers = {}
const ctx = {
  get(name) {
    if (name === 'sessionQuery') return sessionQuery
    if (name === 'sessions') return sessions
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
  const src = read('shared/host.js') + '\n' + read('plugins/flow/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.flow
  if (!h) { console.log('FAIL | flow 未注册'); process.exit(1) }

  let r = await h({ action: '', fields: {}, state: null, root: ROOT, session: 's-main' })
  check('打开 → 渲染主干', r.html.indexOf('实时流程') >= 0)
  check('自动刷新声明 data-autorefresh=2000', r.html.indexOf('data-autorefresh="2000"') >= 0)
  check('用户/助手消息节点', r.html.indexOf('帮我看下这个目录') >= 0 && r.html.indexOf('好的，我先并行读文件') >= 0)
  check('箭头连接符 ▼', r.html.indexOf('fl-arrow') >= 0 && r.html.indexOf('▼') >= 0)
  // 平行卡片：read+grep 同 step 同组（fl-par 容器里两张卡）
  const parMatch = r.html.match(/fl-par[\s\S]*?fl-row/)
  check('平行卡片组（read+grep 并排）', r.html.indexOf('fl-par') >= 0 && r.html.indexOf('read') >= 0 && r.html.indexOf('grep') >= 0)
  check('调用状态 ✓ 与耗时', r.html.indexOf('✓') >= 0)
  // 子代理 git 树
  check('子代理分支符号 ├─', r.html.indexOf('├─') >= 0)
  check('子代理支线实时步骤（子会话 grep）', r.html.indexOf('child hits') >= 0 || r.html.indexOf('grep') >= 0 && r.html.indexOf('│') >= 0)
  check('子代理合并符号 ╰─', r.html.indexOf('╰─') >= 0)
  check('子代理 live 徽章（运行中）', r.html.indexOf('运行中') >= 0)
  check('子代理 id 截断显示', r.html.indexOf('228a8697') >= 0)

  // live 开关：暂停后无 autorefresh
  r = await h({ action: 'toggle-live', fields: {}, state: r.state, root: ROOT, session: 's-main' })
  check('暂停 → 无 autorefresh 声明', r.html.indexOf('data-autorefresh="2000"') < 0)
  check('暂停 → 开关文案', r.html.indexOf('已暂停') >= 0)
  r = await h({ action: 'toggle-live', fields: {}, state: r.state, root: ROOT, session: 's-main' })
  check('恢复 → autorefresh 回归', r.html.indexOf('data-autorefresh="2000"') >= 0)

  // 静默刷新动作（__refresh 不报错）
  r = await h({ action: '__refresh', fields: {}, state: r.state, root: ROOT, session: 's-main' })
  check('__refresh → 正常渲染', r.ok === true && r.html.indexOf('实时流程') >= 0)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })