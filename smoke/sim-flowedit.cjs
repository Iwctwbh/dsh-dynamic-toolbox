// flowedit 工具仿真：mock fs（内存盘 flows 目录）+ subprocess（mkdir/rm）。
// 断言：Markdown 解析（标题/步骤/门/分支）、流程图渲染（节点/箭头/git 树分支）、
// 新建模板、保存落盘、打开回读、删除两步确认、视图切换、脏标记。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 内存文件系统：key = 绝对路径
const mem = {}
const fsSvc = {
  async resolve(rel, opts) { return (opts && opts.cwd ? opts.cwd : ROOT) + '/' + rel },
  processPath(t) { return t },
  async stat(t) {
    if (Object.prototype.hasOwnProperty.call(mem, t)) return { isDir: false }
    const prefix = t.replace(/\/+$/, '') + '/'
    if (Object.keys(mem).some((k) => k.indexOf(prefix) === 0)) return { isDir: true }
    return undefined
  },
  async readText(t) { return mem[t] },
  async listDir(dir) {
    const prefix = dir.replace(/\/+$/, '') + '/'
    return Object.keys(mem).filter((k) => k.indexOf(prefix) === 0).map((k) => ({ name: k.slice(prefix.length) }))
  },
  async writeText(t, content) { mem[t] = String(content) },
}
const subprocess = {
  spawn({ argv, cwd }) {
    const target = argv[3] && !/^[A-Za-z]:[\\/]|^\//.test(argv[3]) ? (cwd || ROOT) + '/' + argv[3] : argv[3]
    if (argv[2] && argv[2].indexOf('rmSync') >= 0) { delete mem[target] }
    else if (argv[2] && argv[2].indexOf('mkdirSync') >= 0) { /* 目录隐式存在 */ }
    return { done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } } }
  },
}

const handlers = {}
const ctx = {
  get(name) {
    if (name === 'fs') return fsSvc
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

const MD = '# 测试流程\n\n## 01 输入\n收集需求\n\n### gate:ifElse 质量达标？\n- 是 → 03 输出\n- 否 → 02 研究\n\n## 02 研究\n深入分析\n\n## 03 输出\n产出结果\n'

;(async () => {
  const src = read('shared/host.js') + '\n' + read('plugins/flowedit/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.flowedit
  if (!h) { console.log('FAIL | flowedit 未注册'); process.exit(1) }

  // 打开：空状态提示
  let r = await h({ action: '', fields: {}, state: null, root: ROOT, session: 's1' })
  check('打开 → 无文件时提示', r.html.indexOf('新建或打开') >= 0)

  // 新建：模板 + 脏标记
  r = await h({ action: 'new', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('新建 → 模板载入 + 脏标记', r.state.dirty === true && r.state.md.indexOf('gate:ifElse') >= 0 && r.html.indexOf('未保存') >= 0)
  check('新建 → 流程图含步骤与门', r.html.indexOf('步骤') >= 0 && r.html.indexOf('IF/ELSE') >= 0)

  // 保存落盘
  r = await h({ action: 'save', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('保存 → 落盘 + 清脏标记', r.state.dirty === false && r.html.indexOf('已保存') >= 0)
  const fileKey = ROOT + '/.dsh-dynamic-toolbox/data/flows/' + r.state.name + '.md'
  check('保存 → 文件在 data/flows', !!mem[fileKey], fileKey)
  check('保存 → 文件列表出现', (r.state.files || []).indexOf(r.state.name) >= 0)

  // 编辑 Markdown → 重新解析（加一步骤）
  const md2 = r.state.md + '\n## 04 复盘\n总结经验\n'
  r = await h({ action: 'edit-not-real', fields: { md: md2 }, state: r.state, root: ROOT, session: 's1' })
  check('编辑 md → 脏标记 + 图里多一个节点', r.state.dirty === true && r.html.indexOf('04 复盘') >= 0)

  // 打开回读
  r = await h({ action: 'save', fields: {}, state: r.state, root: ROOT, session: 's1' })
  const nm = r.state.name
  r = await h({ action: '', fields: {}, state: null, root: ROOT, session: 's1' })
  r = await h({ action: 'open', fields: { pick: nm }, state: r.state, root: ROOT, session: 's1' })
  check('打开 → 回读内容一致', r.state.md === md2 && r.state.dirty === false)

  // 视图切换
  r = await h({ action: 'view', fields: { __el: { v: 'graph' } }, state: r.state, root: ROOT, session: 's1' })
  check('仅流程图视图 → 无 textarea 有图', r.html.indexOf('data-field="md"') < 0 && r.html.indexOf('流程图') >= 0)
  r = await h({ action: 'view', fields: { __el: { v: 'edit' } }, state: r.state, root: ROOT, session: 's1' })
  check('仅编辑视图 → 有 textarea 无图', r.html.indexOf('data-field="md"') >= 0 && r.html.indexOf('流程图（') < 0)

  // 删除两步确认
  r = await h({ action: 'view', fields: { __el: { v: 'split' } }, state: r.state, root: ROOT, session: 's1' })
  r = await h({ action: 'del', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('删除第一步 → 要求确认', r.state.confirmDel === true && r.html.indexOf('再点一次') >= 0)
  r = await h({ action: 'del', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('删除第二步 → 文件移除 + 回空态', !mem[fileKey] && r.state.name === '' && r.html.indexOf('新建或打开') >= 0)

  // 门分支渲染（git 树）
  const r2 = await h({ action: 'new', fields: {}, state: null, root: ROOT, session: 's1' })
  check('门分支 → ├─/╰─ 与 是/否 标签', r2.html.indexOf('├─') >= 0 && r2.html.indexOf('╰─') >= 0 && r2.html.indexOf('是') >= 0 && r2.html.indexOf('否') >= 0)
  check('门分支 → 目标步骤名', r2.html.indexOf('→ 03 输出') >= 0 || r2.html.indexOf('03 输出') >= 0)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })