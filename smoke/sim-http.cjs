// http 工具仿真：mock subprocess 模拟 runNode 子进程（解析 env.HTTP_REQ 返回罐装响应）。
// 核心断言：响应本体不进 state（轻量化重构）；res-tab/copy-res/rerun 闭包链路完整。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const BIG_BODY = JSON.stringify({ hello: 'world', pad: 'x'.repeat(100 * 1024) }) // ~100KB 响应体
const subprocess = {
  spawn({ argv, env }) {
    const spec = JSON.parse((env && env.HTTP_REQ) || '{}')
    const payload = JSON.stringify({
      ok: true, status: 200, statusText: 'OK',
      headers: { 'content-type': 'application/json', 'x-req-url': spec.url || '' },
      body: BIG_BODY, bytes: BIG_BODY.length, truncated: false, ms: 12,
    })
    return {
      done: Promise.resolve({ exitCode: 0 }),
      collected: { stdout: { readFrom: () => ({ text: payload }) }, stderr: { readFrom: () => ({ text: '' }) } },
    }
  },
}

const handlers = {}
const ctx = {
  get(name) {
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
  const src = read('shared/host.js') + '\n' + read('plugins/http/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.http
  if (!h) { console.log('FAIL | http 未注册'); process.exit(1) }

  // 打开
  let r = await h({ action: '', fields: {}, state: null, root: ROOT, session: null })
  check('打开 → 面板渲染', r.ok && r.html.indexOf('data-action="send"') >= 0)

  // 发送（URL 经 fields 回传）
  r = await h({ action: 'send', fields: { url: 'https://api.local/test' }, state: r.state, root: ROOT, session: null })
  check('发送 → 200 状态 pill', r.html.indexOf('200 OK') >= 0)
  check('发送 → 响应体 JSON 美化渲染', r.html.indexOf('hello') >= 0)
  const stateStr = JSON.stringify(r.state)
  check('state 不含响应本体（< 5KB，响应 ~100KB）', stateStr.length < 5 * 1024, 'state=' + stateStr.length + 'B')
  check('state 无 result 字段', !('result' in r.state))

  // 切换响应头 Tab（闭包取数，不重发请求）
  r = await h({ action: 'res-tab', fields: { __el: { v: 'headers' }, url: 'https://api.local/test' }, state: r.state, root: ROOT, session: null })
  check('res-tab headers → 渲染闭包里的响应头', r.html.indexOf('x-req-url') >= 0 && r.html.indexOf('https://api.local/test') >= 0)

  // 复制响应体
  r = await h({ action: 'copy-res', fields: { url: 'https://api.local/test' }, state: r.state, root: ROOT, session: null })
  check('copy-res → copy 为完整响应体', typeof r.copy === 'string' && r.copy.length === BIG_BODY.length, 'copy=' + (r.copy || '').length + 'B')

  // 历史与重发
  check('历史入账（url 入列）', r.state.history.length === 1 && r.state.history[0].u === 'https://api.local/test')
  r = await h({ action: 'rerun', fields: { __el: { i: '0' } }, state: r.state, root: ROOT, session: null })
  check('rerun → 重发成功且 state 仍轻量', r.ok && JSON.stringify(r.state).length < 5 * 1024 && r.state.history.length === 2)

  // 旧 state 迁移：塞进 result 大字段应被删除
  const legacy = { method: 'GET', url: '', params: [], headers: [], form: [], tab: 'params', resTab: 'body', result: { ok: true, body: BIG_BODY }, history: [], notice: null }
  r = await h({ action: '', fields: {}, state: legacy, root: ROOT, session: null })
  check('旧 state 的 result 字段被迁移删除', !('result' in r.state) && JSON.stringify(r.state).length < 5 * 1024)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
