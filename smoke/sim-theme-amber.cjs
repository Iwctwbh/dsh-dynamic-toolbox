// theme-amber 仿真：mock styles.insert 捕获注入 CSS，断言变量覆盖与 disposer 生命周期。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let inserted = null
const styles = { insert(css) { inserted = css; return () => { inserted = null } } }
const effects = []
const ctx = { get() { return undefined }, on() {}, effect(fn) { effects.push(fn) } }
const logs = []
const console2 = { log: (...a) => logs.push(a.join(' ')) }

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

;(async () => {
  const fn = new Function('ctx', 'React', 'host', 'styles', 'console', 'return (async () => {\n' + read('plugins/theme-amber/client.js') + '\n})()')
  const impl = await fn(ctx, undefined, undefined, styles, console2)
  check('返回插件对象', impl && typeof impl.apply === 'function')
  impl.apply(ctx)
  check('注入 :root 覆盖', typeof inserted === 'string' && inserted.indexOf(':root') >= 0)
  for (const v of ['--tb-accent:#d97706', '--tb-accent-hover:#f59e0b', '--tb-accent-text:#fbbf24', '--tb-active:#f59e0b', '--tb-active-text:#fbbf24', '--tb-accent-ring']) {
    check('含 ' + v, inserted.indexOf(v) >= 0)
  }
  check('disposer 经 ctx.effect 挂生命周期', effects.length === 1 && typeof effects[0] === 'function')
  // 停止 → disposer 生效（CSS 移除）
  const dis = effects[0]()
  if (typeof dis === 'function') dis()
  check('停止后 CSS 移除（回默认主题）', inserted === null)
  check('启动日志输出', logs.some((l) => l.indexOf('tb-theme-amber') >= 0))
  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
