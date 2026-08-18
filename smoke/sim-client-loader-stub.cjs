// Client 加载桩仿真（rc.7 改造 16.3）：Timer 进入 Cordis 生命周期——
// 以 plugins/toolbox/payload.json 的 code.client（真实生成的加载桩）为被测对象：
// ①第二层函数显式收到 setTimeout/setInterval/clearTimeout/clearInterval 四个适配器（不读全局）；
// ②setTimeout 返回数字句柄（不是 disposer），回调经 timer.timeout 挂上 Fiber 生命周期；
// ③clearTimeout/clearInterval 取消未决回调；interval 持续触发直到 clear；
// ④ctx.effect teardown 一次性清掉全部未决 timer（Package 停止/重跑不残留、不累积）；
// ⑤timer 服务缺失时 apply 抛明确错误。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

const makeTimerMock = () => {
  const pending = new Set()
  return {
    pending,
    // timeout 触发即自动出未决表（与真实 ClientTimerService 语义一致）
    timeout(cb, ms) {
      const rec = { kind: 'timeout', ms, cancelled: false }
      rec.cb = () => { pending.delete(rec); cb() }
      pending.add(rec)
      return () => { rec.cancelled = true; pending.delete(rec) }
    },
    interval(cb, ms) {
      const rec = { kind: 'interval', cb, ms, cancelled: false }
      pending.add(rec)
      return () => { rec.cancelled = true; pending.delete(rec) }
    },
  }
}

const makeCtx = (timer) => {
  const teardowns = []
  return {
    teardowns,
    cap: {}, // 第二层实现可写（mock 无 guard）——观测通道
    get(name) { return name === 'timer' ? timer : undefined },
    effect(fn) { const dis = fn(); if (typeof dis === 'function') teardowns.push(dis); return () => {} },
  }
}

// 被测实现：记录第二层收到的四个形参并真实使用它们（经 ctx.cap 回传观测）
const TEST_IMPL = `
ctx.cap.fns = {
  setTimeout: typeof setTimeout,
  setInterval: typeof setInterval,
  clearTimeout: typeof clearTimeout,
  clearInterval: typeof clearInterval,
}
ctx.cap.timeoutId = setTimeout(() => { ctx.cap.timeoutFired = (ctx.cap.timeoutFired || 0) + 1 }, 40)
ctx.cap.clearedId = setTimeout(() => { ctx.cap.clearedFired = true }, 40)
clearTimeout(ctx.cap.clearedId)
ctx.cap.intervalId = setInterval(() => { ctx.cap.ticks = (ctx.cap.ticks || 0) + 1 }, 250)
ctx.cap.interval2Id = setInterval(() => {}, 250)
clearInterval(ctx.cap.interval2Id)
return { name: 'stub-test-impl', apply() { ctx.cap.implApplied = true } }
`

const evalStub = async (stubCode, ctx, hostMock) => {
  const fn = new Function('ctx', 'React', 'host', 'styles', 'console', 'return (async () => {\n' + stubCode + '\n})()')
  return fn(ctx, {}, hostMock, { insert() { return () => {} } }, console)
}

const makeHostMock = () => ({
  calls: [],
  async call(method) {
    this.calls.push(method)
    if (method === 'toolbox/client-impl') return { ok: true, code: TEST_IMPL }
    return { ok: false, error: 'unexpected ' + method }
  },
})

;(async () => {
  const payload = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/toolbox/payload.json'), 'utf8'))
  const stubCode = payload.code.client
  check('payload 含 Client 加载桩', typeof stubCode === 'string' && stubCode.length > 0)

  // 静态断言：第二层 new Function 显式声明四个 timer 形参，且桩经 ctx.get('timer') 取服务
  check('桩声明第二层 timer 形参',
    /new Function\([\s\S]*'setTimeout'[\s\S]*'setInterval'[\s\S]*'clearTimeout'[\s\S]*'clearInterval'/.test(stubCode))
  check('桩经 ctx.get(\'timer\') 取服务', stubCode.indexOf("ctx.get('timer')") >= 0)
  check('桩注册 teardown（ctx.effect）', stubCode.indexOf('ctx.effect') >= 0)

  // —— 正常路径 ——
  const timer = makeTimerMock()
  const ctx = makeCtx(timer)
  const hostMock = makeHostMock()
  const plugin = await evalStub(stubCode, ctx, hostMock)
  check('桩求值返回插件对象', plugin && typeof plugin.apply === 'function')
  await plugin.apply(ctx) // 真实装载由 Cordis loader 调 apply——此处模拟同一路径
  const cap = ctx.cap
  check('apply 拉实现并委托（impl.apply 被调用）', cap.implApplied === true)
  check('第二层四个 timer 形参均为函数（显式下传）',
    cap.fns && cap.fns.setTimeout === 'function' && cap.fns.setInterval === 'function' && cap.fns.clearTimeout === 'function' && cap.fns.clearInterval === 'function',
    JSON.stringify(cap.fns))
  check('经 RPC 拉实现', hostMock.calls.indexOf('toolbox/client-impl') >= 0)

  check('setTimeout 返回数字句柄（非 disposer）', typeof cap.timeoutId === 'number' && typeof cap.clearedId === 'number')
  const timeouts = [...timer.pending].filter((r) => r.kind === 'timeout')
  const intervals = [...timer.pending].filter((r) => r.kind === 'interval')
  check('未决 timeout 挂在 timer 服务上（被 clear 的已撤销）', timeouts.length === 1 && timeouts[0].ms === 40, 'pending=' + timer.pending.size)
  check('clearInterval 生效：interval 只剩 1 个（不累积）', intervals.length === 1 && intervals[0].ms === 250)

  timeouts[0].cb() // 拨包装回调 → 内部删句柄并执行原回调
  check('timeout 触发一次', cap.timeoutFired === 1)
  intervals[0].cb(); intervals[0].cb()
  check('interval 持续触发', cap.ticks === 2)
  check('cleared 回调未触发', cap.clearedFired === undefined)

  // —— teardown：Package 停止/重跑时未决 timer 全清 ——
  check('teardown 已登记', ctx.teardowns.length >= 1)
  for (const dis of ctx.teardowns) dis()
  check('teardown 后未决 timer 全清（无残留回调）', timer.pending.size === 0, 'pending=' + timer.pending.size)

  // —— 重跑隔离：新实例从零开始，旧实例状态不渗透 ——
  const timer2 = makeTimerMock()
  const ctx2 = makeCtx(timer2)
  const plugin2 = await evalStub(stubCode, ctx2, makeHostMock())
  await plugin2.apply(ctx2)
  check('重跑实例独立计时（新 timer 服务只有本实例的 2 个未决）', timer2.pending.size === 2 && timer.pending.size === 0)
  for (const dis of ctx2.teardowns) dis()
  check('重跑实例 teardown 同样清零', timer2.pending.size === 0)

  // —— timer 缺失：明确错误 ——
  const ctxNoTimer = makeCtx(undefined)
  let err = null
  try {
    const p2 = await evalStub(stubCode, ctxNoTimer, makeHostMock())
    if (p2 && typeof p2.apply === 'function') await p2.apply(ctxNoTimer)
  } catch (e) { err = e }
  check('timer 服务缺失时抛明确错误', Boolean(err) && /timer 服务不可用/.test(String(err && err.message)), err ? err.message : '(未抛错)')

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
