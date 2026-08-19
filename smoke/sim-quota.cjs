// quota 工具仿真：mock subprocess 复刻 Node https 查询脚本的输出契约（归一化模型）。
// 断言：多提供商切换（kimi/deepseek/qwen）、窗口/余额渲染、无 key 错误、网络错误、HTTP 错误、刷新契约。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let mode = 'ok'
const subprocess = {
  spawn({ argv }) {
    // 复刻 quota tool 的 scriptFor 输出契约（脚本真实求值会读 key/发请求，这里直接给等价输出）
    // argv[2] 是脚本文本，内含 const PID = "<provider>"，据此判断当前查询的提供商
    const script = String((argv && argv[2]) || '')
    const m = /PID = "([a-z]+)"/.exec(script)
    const pid = m ? m[1] : 'kimi'
    let text
    if (mode === 'ok') {
      if (pid === 'kimi') {
        text = JSON.stringify({ ok: true, data: {
          plan: 'LEVEL_ADVANCED',
          windows: [
            { label: '主额度（每周重置）', used: 19, total: 100, resetTime: '2026-08-21T06:53:22Z' },
            { label: '限流窗口（300 分钟滑动）', used: 3, total: 100, resetTime: '2026-08-16T21:53:22Z' },
          ],
          extra: '并发 2 / 30',
        } })
      } else if (pid === 'deepseek') {
        text = JSON.stringify({ ok: true, data: {
          available: true,
          balances: [{ currency: 'CNY', total: 48.5, granted: 8.5, toppedUp: 40 }],
        } })
      } else {
        text = JSON.stringify({ ok: true, data: {
          plan: 'Token Plan 标准版',
          windows: [
            { label: '5 小时窗口', used: 1000, total: 90000, resetTime: 1787000000000 },
            { label: '每周额度', used: 20000, total: 900000, resetTime: 1787500000000 },
            { label: '每月额度', used: 30000, total: 3600000, resetTime: 1788500000000 },
          ],
        } })
      }
    } else if (mode === 'nokey') {
      text = JSON.stringify({ ok: false, error: '未找到 KIMI_CODING_API_KEY（环境变量或 ~/.dsh/.credentials.yaml）' })
    } else if (mode === 'qwen-nocookie') {
      text = JSON.stringify({ ok: false, error: 'Qwen Plan 套餐用量阿里云未开放 API key 查询接口（实测 ConsoleNeedLogin），仅支持控制台会话：登录百炼控制台后复制 Cookie 写入凭据键 QWEN_TOKEN_PLAN_CN_COOKIE' })
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
  const src = read('shared/runtime.js') + '\n' + read('shared/host.js') + '\n' + read('plugins/quota/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.quota
  if (!h) { console.log('FAIL | quota 未注册'); process.exit(1) }

  // 打开自动查询（首次无数据时 action '' 自动 query，默认 kimi）
  mode = 'ok'
  let r = await h({ action: '', fields: {}, state: null, root: ROOT })
  check('打开 → 默认提供商 kimi 自动查询成功', r.state.provider === 'kimi' && r.state.data && Array.isArray(r.state.data.windows))
  check('提供商芯片行（三家）', r.html.indexOf('Kimi Coding') >= 0 && r.html.indexOf('DeepSeek') >= 0 && r.html.indexOf('Qwen Plan') >= 0)
  check('主额度渲染（剩 81 / 100 + 进度条）', r.html.indexOf('剩 81') >= 0 && r.html.indexOf('已用 19 / 100') >= 0 && r.html.indexOf('主额度（每周重置）') >= 0)
  check('窗口渲染（300 分钟滑动，剩 97）', r.html.indexOf('300 分钟滑动') >= 0 && r.html.indexOf('剩 97') >= 0)
  check('套餐/并发（高级版 + 并发 2/30）', r.html.indexOf('高级版') >= 0 && r.html.indexOf('并发 2 / 30') >= 0)
  check('重置时间本地化', r.html.indexOf('重置：') >= 0 && r.html.indexOf('2026-08-21') >= 0)

  // 切换 DeepSeek：立即查询并渲染余额
  r = await h({ action: 'pick', fields: { __el: { v: 'deepseek' } }, state: r.state, root: ROOT })
  check('切换 DeepSeek → state.provider 变更', r.state.provider === 'deepseek')
  check('DeepSeek 余额渲染（总额/赠送/充值/币种）', r.html.indexOf('总 48.5') >= 0 && r.html.indexOf('赠送 8.5') >= 0 && r.html.indexOf('充值 40') >= 0 && r.html.indexOf('CNY') >= 0)
  check('DeepSeek 账户状态（可用）', r.html.indexOf('账户状态：可用') >= 0)

  // 切换 Qwen Plan：三层窗口
  r = await h({ action: 'pick', fields: { __el: { v: 'qwen' } }, state: r.state, root: ROOT })
  check('切换 Qwen → state.provider 变更', r.state.provider === 'qwen')
  check('Qwen 套餐名渲染', r.html.indexOf('Token Plan 标准版') >= 0)
  check('Qwen 三层窗口（5h/每周/每月）', r.html.indexOf('5 小时窗口') >= 0 && r.html.indexOf('每周额度') >= 0 && r.html.indexOf('每月额度') >= 0)
  check('Qwen 窗口余量（5h 剩 89k）', r.html.indexOf('剩 89.0k') >= 0)

  // qwen 无控制台 Cookie → 明确引导（阿里云未开放 API key 接口）
  mode = 'qwen-nocookie'
  r = await h({ action: 'pick', fields: { __el: { v: 'qwen' } }, state: null, root: ROOT })
  check('Qwen 无 Cookie → 引导复制控制台 Cookie', r.html.indexOf('QWEN_TOKEN_PLAN_CN_COOKIE') >= 0 && r.html.indexOf('ConsoleNeedLogin') >= 0)
  mode = 'ok'

  // 手动刷新（保持提供商与数据）
  r = await h({ action: 'query', fields: {}, state: r.state, root: ROOT })
  check('刷新 → 保持提供商与数据', r.state.provider === 'qwen' && r.state.data.windows.length === 3)

  // 无 key（回 kimi 查询）
  mode = 'nokey'
  r = await h({ action: 'pick', fields: { __el: { v: 'kimi' } }, state: null, root: ROOT })
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
