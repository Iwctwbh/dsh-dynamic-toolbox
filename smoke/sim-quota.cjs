// quota 工具仿真：mock subprocess 复刻 Node https 查询脚本的输出契约。
// 断言：余量摘要渲染（主额度/窗口/并发 pill 与 bar）、无 key 错误、网络错误、HTTP 错误、刷新契约。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const USAGES_OK = {
  user: { userId: 'u1', region: 'REGION_CN', membership: { level: 'LEVEL_ADVANCED' } },
  usage: { limit: '100', used: '19', remaining: '81', resetTime: '2026-08-21T06:53:22Z' },
  limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '3', remaining: '97', resetTime: '2026-08-16T21:53:22Z' } }],
  parallel: { limit: '30', details: ['a', 'b'] },
  boosterWallet: { status: 'STATUS_DISABLED' },
}

let mode = 'ok'
const subprocess = {
  spawn({ argv }) {
    // 复刻 quota tool 的 QUOTA_SCRIPT 输出契约（脚本真实求值会读 key/发请求，这里直接给等价输出）
    let text
    if (mode === 'ok') {
      const j = USAGES_OK
      const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0 }
      text = JSON.stringify({ ok: true, data: {
        level: j.user.membership.level, region: j.user.region,
        main: { limit: num(j.usage.limit), used: num(j.usage.used), remaining: num(j.usage.remaining), resetTime: j.usage.resetTime },
        window: { limit: num(j.limits[0].detail.limit), used: num(j.limits[0].detail.used), remaining: num(j.limits[0].detail.remaining), resetTime: j.limits[0].detail.resetTime, durationMin: num(j.limits[0].window.duration) },
        parallel: num(j.parallel.limit), parallelActive: j.parallel.details.length, booster: j.boosterWallet.status,
      } })
    } else if (mode === 'nokey') {
      text = JSON.stringify({ ok: false, error: '未找到 KIMI_CODING_API_KEY（环境变量或 ~/.dsh/.credentials.yaml）' })
    } else if (mode === 'http') {
      text = JSON.stringify({ ok: false, error: 'HTTP 401: invalid authentication' })
    } else {
      text = JSON.stringify({ ok: false, error: '网络错误: connect ETIMEDOUT' })
    }
    return {
      done: Promise.resolve({ exitCode: 0 }),
      collected: { stdout: { readFrom: () => ({ text }) }, stderr: { readFrom: () => ({ text: '' }) } },
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
  const src = read('shared/host.js') + '\n' + read('plugins/quota/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.quota
  if (!h) { console.log('FAIL | quota 未注册'); process.exit(1) }

  // 打开自动查询（首次无数据时 action '' 自动 query）
  mode = 'ok'
  let r = await h({ action: '', fields: {}, state: null, root: ROOT })
  check('打开 → 自动查询成功', r.state.data && r.state.data.main.remaining === 81)
  check('主额度渲染（剩 81 / 100 + 进度条）', r.html.indexOf('剩 81') >= 0 && r.html.indexOf('已用 19 / 100') >= 0 && r.html.indexOf('主额度') >= 0)
  check('窗口渲染（300 分钟滑动，剩 97）', r.html.indexOf('300 分钟滑动') >= 0 && r.html.indexOf('剩 97') >= 0)
  check('套餐/并发 pill（高级版 + 并发 2/30）', r.html.indexOf('高级版') >= 0 && r.html.indexOf('并发 2 / 30') >= 0)
  check('重置时间本地化', r.html.indexOf('重置：') >= 0 && r.html.indexOf('2026-08-21') >= 0)
  check('加量包状态', r.html.indexOf('加量包未启用') >= 0)

  // 手动刷新
  r = await h({ action: 'query', fields: {}, state: r.state, root: ROOT })
  check('刷新 → 保持数据', r.state.data && r.state.data.window.remaining === 97)

  // 无 key
  mode = 'nokey'
  r = await h({ action: 'query', fields: {}, state: null, root: ROOT })
  check('无 key → 错误 banner 提示凭据链', r.html.indexOf('KIMI_CODING_API_KEY') >= 0 && r.html.indexOf('tb-banner-error') >= 0)

  // HTTP 错误
  mode = 'http'
  r = await h({ action: 'query', fields: {}, state: null, root: ROOT })
  check('HTTP 401 → 错误透传', r.html.indexOf('HTTP 401') >= 0)

  // 网络错误
  mode = 'neterr'
  r = await h({ action: 'query', fields: {}, state: null, root: ROOT })
  check('网络错误 → 错误透传', r.html.indexOf('网络错误') >= 0 || r.html.indexOf('ETIMEDOUT') >= 0)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })