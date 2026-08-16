// jira 工具仿真：mock credentials + subprocess（fetch/附件下载/归档/本地预览）+ fs（内存记录）。
// 核心断言：工单本体与预览图（base64）不进 state；记录持久化；下载/预览/关闭链路完整；
// 查询自动归档（issue.md/issue.json 规范见 prompt/Jira.md）；点记录 = 本地归档零 API。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const BIG_DESC = '需求描述正文。' + '详'.repeat(50000) // ~100+KB 描述
const B64 = 'iVBORw0KGgoAAAANSUhEUg' + 'A'.repeat(300 * 1024) // ~300KB base64 预览图
const ISSUE = {
  key: 'TEST-1', summary: '样例需求', status: 'In Progress', priority: 'High', issuetype: 'Story',
  assignee: '张三', reporter: '李四', created: '2026-01-01T00:00:00.000Z', updated: '2026-08-01T00:00:00.000Z',
  description: BIG_DESC,
  attachments: [{ filename: 'a.png', content: 'https://x.local/a.png', size: 1234, author: '张三' }],
}
const ARCHIVE_RES = {
  ok: true, dir: '.dsh-dynamic-toolbox/data/jira/TEST-1', archivedAt: '2026-08-16T00:00:00.000Z',
  files: [{ filename: 'a.png', size: 1234, author: '张三', content: 'https://x.local/a.png', path: 'TEST-1/a.png', downloaded: true, error: null }],
  errors: [],
}
// 本地归档种子（view-record 零 API 测试用）
const ARCHIVED_ISSUE = Object.assign({}, ISSUE, {
  key: 'TEST-2', summary: '本地样例', archivedAt: '2026-08-15T12:00:00.000Z',
  attachments: [{ filename: 'b.png', size: 10, author: '王五', content: 'https://x.local/b.png', path: 'TEST-2/b.png', downloaded: true, error: null }],
})

let fetchCalls = 0
const subprocess = {
  spawn({ argv, env }) {
    let stdout = ''
    if (env && env.JIRA_ATTACH_URL) {
      stdout = 'OK|.dsh-dynamic-toolbox/Jira-Issue/TEST-1/a.png\nLEN|1234\nB64|' + B64 + '\n'
    } else if (env && env.JIRA_ISSUE_FILE) {
      stdout = JSON.stringify(ARCHIVE_RES)
    } else if (env && env.JIRA_LOCAL_FILE) {
      stdout = 'B64|' + B64 + '\n'
    } else if (env && env.JIRA_ISSUE_KEY) {
      fetchCalls++
      stdout = JSON.stringify({ ok: true, issue: ISSUE, error: null })
    }
    return {
      done: Promise.resolve({ exitCode: 0 }),
      collected: { stdout: { readFrom: () => ({ text: stdout }) }, stderr: { readFrom: () => ({ text: '' }) } },
    }
  },
}
const credentials = {
  async resolve(ref) { return { value: 'mock-' + ref } },
  async describe(ref) { return { configured: true, source: 'test', writable: true } },
  async set() {}, async unset() {},
}
const memStore = {}
const fsSvc = {
  async resolve(rel, opts) { return ((opts && opts.cwd ? opts.cwd : ROOT) + '/' + rel).replace(/\\/g, '/') },
  async stat(t) { return Object.prototype.hasOwnProperty.call(memStore, t) },
  async readText(t) { return memStore[t] },
  async writeText(t, content) { memStore[t] = String(content) },
}

const handlers = {}
const ctx = {
  credentials,
  get(name) {
    if (name === 'subprocess') return subprocess
    if (name === 'credentials') return credentials
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
  const src = read('shared/host.js') + '\n' + read('plugins/jira/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.jira
  if (!h) { console.log('FAIL | jira 未注册'); process.exit(1) }

  // 查询（回车触发 query；input 经 fields.key? 实际契约是 fields.input？看实现用 st.input/fields.key）
  let r = await h({ action: 'query', fields: { key: 'TEST-1' }, state: null, root: ROOT, session: 's1' })
  if (!r.ok) { console.log('FAIL | query 失败: ' + r.error); process.exit(1) }
  check('query → 工单渲染（标题/描述）', r.html.indexOf('样例需求') >= 0 && r.html.indexOf('需求描述正文') >= 0)
  check('query → state 无 issue/preview 字段', !('issue' in r.state) && !('preview' in r.state))
  check('query → state 轻量（描述 ~100KB 不进 state）', JSON.stringify(r.state).length < 3000, 'state=' + JSON.stringify(r.state).length + 'B')
  check('query → 记录落盘 jira-watch.json', (memStore[(ROOT + '/.dsh-dynamic-toolbox/jira-watch.json').replace(/\\/g, '/')] || '').indexOf('TEST-1') >= 0)
  check('query → 自动归档（提示 + 本地归档徽标）', r.html.indexOf('已归档 → .dsh-dynamic-toolbox/data/jira/TEST-1/') >= 0 && r.html.indexOf('本地归档') >= 0)

  // 下载附件（图片 → 预览）
  r = await h({ action: 'download', fields: { __el: { url: 'https://x.local/a.png', filename: 'a.png' } }, state: r.state, root: ROOT, session: 's1' })
  check('download → 预览图渲染（base64 img）', r.html.indexOf('tb-preview-img') >= 0 && r.html.indexOf(B64.slice(0, 60)) >= 0)
  check('download → state 仍轻量（预览图 ~300KB 不进 state）', JSON.stringify(r.state).length < 3000, 'state=' + JSON.stringify(r.state).length + 'B')

  // 本地归档查看：预置 issue.json → view-record 零 API（fetchCalls 不涨）
  memStore[(ROOT + '/.dsh-dynamic-toolbox/data/jira/TEST-2/issue.json').replace(/\\/g, '/')] = JSON.stringify(ARCHIVED_ISSUE)
  const beforeFetch = fetchCalls
  r = await h({ action: 'view-record', fields: { __el: { key: 'TEST-2' } }, state: r.state, root: ROOT, session: 's1' })
  check('view-record → 本地归档渲染（零 API）', r.html.indexOf('本地样例') >= 0 && fetchCalls === beforeFetch, 'fetchCalls=' + fetchCalls)
  check('view-record → 归档徽标 + 未访问 API 提示', r.html.indexOf('本地归档') >= 0 && r.html.indexOf('未访问 API') >= 0)

  // 归档附件本地预览（零 API）
  r = await h({ action: 'preview-local', fields: { __el: { path: 'TEST-2/b.png' } }, state: r.state, root: ROOT, session: 's1' })
  check('preview-local → 本地预览渲染（base64 img）', r.html.indexOf('tb-preview-img') >= 0 && r.html.indexOf(B64.slice(0, 60)) >= 0 && fetchCalls === beforeFetch)

  // 任意其他动作（切换凭据面板）后预览仍在（闭包持有）
  r = await h({ action: 'toggle-cred', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('toggle-cred → 预览区仍在（闭包）', r.html.indexOf('tb-preview-img') >= 0)

  // 关闭预览
  r = await h({ action: 'close-preview', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('close-preview → 预览消失', r.html.indexOf('tb-preview-img') < 0)

  // 关闭详情卡：卡片消失、记录仍在列表
  r = await h({ action: 'close-issue', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('close-issue → 详情卡关闭且记录保留', r.html.indexOf('本地样例') < 0 && r.html.indexOf('TEST-1') >= 0)

  // 删除当前记录 → 工单卡片消失
  r = await h({ action: 'remove', fields: { __el: { key: 'TEST-1' } }, state: r.state, root: ROOT, session: 's1' })
  check('remove → 记录清空且工单卡片消失', r.html.indexOf('暂无查询记录') >= 0 && r.html.indexOf('样例需求') < 0)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
