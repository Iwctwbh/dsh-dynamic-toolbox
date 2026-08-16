// cron 工具仿真：断言解析正确性、OR 语义、名称/步长/周日归一、预设、错误路径。
// 注意：未来时刻依赖当前时间，断言用「相对性质」（字段命中/顺序递增/数量）而非绝对值。
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

// 从 html 提取「未来 N 次」时刻 → 毫秒时间戳（" 周X" 后缀不可直接喂 Date，手工解析）
const runsOf = (html) => [...html.matchAll(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) 周([日一二三四五六])/g)]
  .map((m) => ({ t: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime(), min: +m[5], week: m[6], day: +m[3], text: m[0] }))

;(async () => {
  const src = read('shared/host.js') + '\n' + read('plugins/cron/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.cron
  if (!h) { console.log('FAIL | cron 未注册'); process.exit(1) }

  // 每分钟 → 8 次、逐分钟递增
  let r = await h({ action: 'calc', fields: { expr: '* * * * *' }, state: null })
  let runs = runsOf(r.html)
  check('* * * * * → 8 次且逐分钟连续', runs.length === 8 && runs.every((x, i) => i === 0 || x.t - runs[i - 1].t === 60000), (runs[0] || {}).text + ' / ' + (runs[1] || {}).text)

  // 每小时整点 → 分钟恒 00，间隔 1h
  r = await h({ action: 'calc', fields: { expr: '0 * * * *' }, state: null })
  runs = runsOf(r.html)
  check('0 * * * * → 整点且间隔 1h', runs.length === 8 && runs.every((x) => x.min === 0) && runs[1].t - runs[0].t === 3600000)

  // 步长 */15 → 分钟 ∈ {0,15,30,45}
  r = await h({ action: 'calc', fields: { expr: '*/15 * * * *' }, state: null })
  runs = runsOf(r.html)
  check('*/15 → 分钟 ∈ {0,15,30,45}', runs.every((x) => [0, 15, 30, 45].indexOf(x.min) >= 0), (runs[0] || {}).text)

  // 名称 + 周日归一：0 9 * * MON-FRI 与 0 9 * * 1-5 等价；周日 7 == 0
  r = await h({ action: 'calc', fields: { expr: '0 9 * * MON-FRI' }, state: null })
  runs = runsOf(r.html)
  check('MON-FRI 名称 → 都在 9:00 且为工作日', runs.every((x) => x.text.slice(11, 16) === '09:00' && '一二三四五'.indexOf(x.week) >= 0), (runs[0] || {}).text)
  r = await h({ action: 'calc', fields: { expr: '0 0 * * 7' }, state: null })
  runs = runsOf(r.html)
  check('周日 7 归一 → 全部周日', runs.every((x) => x.week === '日'), (runs[0] || {}).text)

  // 日/周 OR 语义：1 号或周一 0 点（两种日子都出现）
  r = await h({ action: 'calc', fields: { expr: '0 0 1 * MON' }, state: null })
  runs = runsOf(r.html)
  const hasFirst = runs.some((x) => x.day === 1)
  const hasMon = runs.some((x) => x.week === '一')
  check('日/周 OR 语义 → 1 号与周一都出现', hasFirst && hasMon, runs.slice(0, 3).map((x) => x.text).join(' / '))

  // 2 月 30 日 → 4 年内无运行
  r = await h({ action: 'calc', fields: { expr: '0 0 30 2 *' }, state: null })
  check('2 月 30 日 → 无运行时刻提示', r.html.indexOf('无运行时刻') >= 0)

  // 错误路径
  r = await h({ action: 'calc', fields: { expr: '0 9 * *' }, state: null })
  check('4 段 → 报错', r.html.indexOf('需要 5 段') >= 0)
  r = await h({ action: 'calc', fields: { expr: '61 * * * *' }, state: null })
  check('分超界 → 报错', r.html.indexOf('超出范围') >= 0)
  r = await h({ action: 'calc', fields: { expr: '0 9 * * FOO' }, state: null })
  check('非法名称 → 报错', r.html.indexOf('非法') >= 0)

  // 预设芯片
  r = await h({ action: 'preset', fields: { __el: { v: '0 9 * * 1-5' } }, state: null })
  check('预设 → 表达式填入并直接出结果', r.state.expr === '0 9 * * 1-5' && runsOf(r.html).length === 8)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
