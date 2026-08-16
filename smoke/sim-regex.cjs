// regex 工具仿真：匹配模式回归 + 替换模式（$1 分组/计数/复制/无 g 单次/非法正则/空匹配防死循环）。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const handlers = {}
const ctx = {
  get(name) {
    if (name === 'toolboxRegistry') return { register(d, h) { handlers[d.id] = h; return () => {} } }
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
  const src = read('shared/host.js') + '\n' + read('plugins/regex/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.regex
  if (!h) { console.log('FAIL | regex 未注册'); process.exit(1) }

  // 匹配模式回归
  let r = await h({ action: 'test', fields: { pattern: '(\\w+)@(\\w+\\.com)', text: 'a@x.com b@y.com' }, state: null })
  check('匹配：2 处 + 捕获分组渲染', r.html.indexOf('tb-count">2<') >= 0 && r.html.indexOf('$1') >= 0 && r.html.indexOf('>a<') >= 0)

  // 替换模式：$2/$1 调换
  r = await h({ action: 'mode', fields: { __el: { v: 'replace' }, pattern: '(\\w+)@(\\w+\\.com)', text: 'a@x.com b@y.com', replacement: '[$2]$1' }, state: r.state })
  check('替换：模式切换渲染替换输入', r.state.mode === 'replace' && r.html.indexOf('data-field="replacement"') >= 0)
  check('替换：$2$1 结果正确 + 计数 2', r.html.indexOf('[x.com]a') >= 0 && r.html.indexOf('[y.com]b') >= 0 && r.html.indexOf('2 处') >= 0)

  // 复制结果
  r = await h({ action: 'copy-out', fields: { pattern: '(\\w+)@(\\w+\\.com)', text: 'a@x.com b@y.com', replacement: '[$2]$1' }, state: r.state })
  check('复制结果：copy 契约返回替换后全文', r.copy === '[x.com]a [y.com]b')

  // 无 g 标志 → 只换第一处
  r = await h({ action: 'test', fields: { pattern: 'o', text: 'foo boo', replacement: '0' }, state: { pattern: 'o', flags: [], text: 'foo boo', mode: 'replace', replacement: '0' } })
  check('无 g → 只替换第一处且计数 1', r.html.indexOf('f0o boo') >= 0 && r.html.indexOf('1 处') >= 0)

  // 非法正则 → 错误横幅
  r = await h({ action: 'test', fields: { pattern: '([', text: 'x', replacement: '' }, state: { pattern: '([', flags: ['g'], text: 'x', mode: 'replace', replacement: '' } })
  check('非法正则 → 错误横幅', r.html.indexOf('正则无效') >= 0)

  // 空匹配模式防死循环（如 ^）
  r = await h({ action: 'test', fields: { pattern: '^', text: 'ab', replacement: '>' }, state: { pattern: '^', flags: ['g'], text: 'ab', mode: 'replace', replacement: '>' } })
  check('空匹配模式不死循环且有输出', r.html.indexOf('正则无效') < 0 && r.html.indexOf('tb-code') >= 0)

  // 命名分组 $<name>（只替换匹配段，剩余文本保留）
  r = await h({ action: 'copy-out', fields: {}, state: { pattern: '(?<y>\\d{4})-(?<m>\\d{2})', flags: ['g'], text: '2026-08-16', mode: 'replace', replacement: '$<m>/$<y>' } })
  check('命名组替换', r.copy === '08/2026-16')

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
