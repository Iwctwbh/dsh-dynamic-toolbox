// txtdiff 工具仿真：纯 JS，无需 mock 服务。覆盖：LCS 正确性/折叠展开/交换/忽略空白/清空/降级。
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
  const src = read('shared/host.js') + '\n' + read('plugins/txtdiff/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.txtdiff
  if (!h) { console.log('FAIL | txtdiff 未注册'); process.exit(1) }

  // 基础 diff：1 删 1 增 3 同
  const A = 'alpha\nbeta\ngamma\ndelta\n'
  const B = 'alpha\nbeta\ngamma-X\ndelta\n'
  let r = await h({ action: 'compare', fields: { a: A, b: B }, state: null })
  check('compare → +1 −1 统计', r.html.indexOf('>+1</span>') >= 0 && r.html.indexOf('>−1</span>') >= 0, '')
  check('compare → 增删行内容正确', r.html.indexOf('gamma-X') >= 0 && r.html.indexOf('>gamma<') >= 0)
  check('compare → state 只含输入（无结果行）', !('rows' in r.state) && JSON.stringify(r.state).length < 2000)

  // 完全一致
  r = await h({ action: 'compare', fields: { a: 'x\ny\n', b: 'x\ny\n' }, state: null })
  check('完全一致 → 提示文案', r.html.indexOf('完全一致') >= 0)

  // 忽略首尾空白
  r = await h({ action: 'compare', fields: { a: '  pad  \n', b: 'pad\n' }, state: null })
  check('默认口径 → 有差异（+1 −1）', r.html.indexOf('>+1</span>') >= 0)
  r = await h({ action: 'trim-ws', fields: { a: '  pad  \n', b: 'pad\n' }, state: r.state })
  check('开忽略空白 → 立即重算为一致', r.html.indexOf('完全一致') >= 0 && r.state.trimWs === true)

  // 长相同段折叠 + 展开
  const same15 = Array.from({ length: 15 }, (_, i) => 'same-' + i).join('\n')
  r = await h({ action: 'compare', fields: { a: same15 + '\nold-end', b: same15 + '\nnew-end' }, state: null })
  check('长相同段折叠（>9 行）', r.html.indexOf('行相同，点击展开') >= 0)
  const bodyOnly = r.html.slice(r.html.indexOf('tb-pane-body')) // 输入回显在 textarea 里，断言只看结果区
  check('折叠时首尾 3 行可见、中段隐藏', bodyOnly.indexOf('same-0') >= 0 && bodyOnly.indexOf('same-14') >= 0 && bodyOnly.indexOf('same-7') < 0)
  r = await h({ action: 'expand', fields: { __el: { k: 'seg0' }, a: same15 + '\nold-end', b: same15 + '\nnew-end' }, state: r.state })
  check('展开后中段可见', r.html.slice(r.html.indexOf('tb-pane-body')).indexOf('same-7') >= 0)

  // 交换左右：立即重算且增删互换
  r = await h({ action: 'compare', fields: { a: 'one\ntwo\n', b: 'one\nTWO\n' }, state: null })
  r = await h({ action: 'swap', fields: { a: 'one\ntwo\n', b: 'one\nTWO\n' }, state: r.state })
  check('swap → state 左右互换且结果重算', r.state.a === 'one\nTWO\n' && r.state.b === 'one\ntwo\n' && r.html.indexOf('>two<') >= 0)

  // 清空
  r = await h({ action: 'clear', fields: {}, state: r.state })
  check('clear → 输入与结果都清空', r.state.a === '' && r.html.indexOf('填入左右文本') >= 0)

  // 超大降级：中段 1600×1600 全不同 → coarse
  const big1 = Array.from({ length: 1602 }, (_, i) => 'L' + i).join('\n')
  const big2 = Array.from({ length: 1602 }, (_, i) => 'R' + i).join('\n')
  const t0 = Date.now()
  r = await h({ action: 'compare', fields: { a: big1, b: big2 }, state: null })
  const ms = Date.now() - t0
  check('超大输入 → coarse 降级提示', r.html.indexOf('整块增删') >= 0, '耗时 ' + ms + 'ms')

  // 典型规模性能：1500 行内随机改动
  const c1 = Array.from({ length: 1500 }, (_, i) => 'line-' + i + (i % 7 === 0 ? '-a' : '')).join('\n')
  const c2 = Array.from({ length: 1500 }, (_, i) => 'line-' + i + (i % 5 === 0 ? '-b' : '')).join('\n')
  const t1 = Date.now()
  r = await h({ action: 'compare', fields: { a: c1, b: c2 }, state: null })
  const ms2 = Date.now() - t1
  check('1500 行混合 diff 正常', r.html.indexOf('>+') >= 0 && ms2 < 3000, '耗时 ' + ms2 + 'ms')

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
