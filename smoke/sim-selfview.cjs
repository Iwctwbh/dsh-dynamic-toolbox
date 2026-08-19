// selfview Host 半仿真：面板契约 + 命令队列/长轮询结果配对 + 截图落盘（mock subprocess 收 stdin）+ 模型工具注册。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

// ---- mock 环境 ----
const handlers = {} // RPC 名 -> handler
const tools = {}    // 工具名 -> ToolDefinition
const spawns = []   // subprocess spawn spec 记录
const harness = {
  handle(m, h) { handlers[m] = h; return () => {} },
  defineTool(d) { return d }, // 生产端会做参数校验+归一化；仿真用恒等
  registerTool(ctx, def) { tools[def.name] = def; return () => {} },
}
const baseCtx = {
  get(name) {
    if (name === 'sandboxPolicy') return { workspaceRoot: ROOT }
    if (name === 'subprocess') {
      return {
        spawn(spec) { spawns.push(spec); return { done: Promise.resolve({ exitCode: 0 }) } },
      }
    }
    return undefined
  },
  on() {}, effect(d) { if (typeof d === 'function') { try { d() } catch (e) {} } },
  // 时间压缩：所有定时 5ms 内触发（25s pull 心跳 / 12s 工具超时都加速）；不 unref——挂起等待的工具 promise 需要定时器把事件循环撑住
  timeout(fn, ms) { const t = setTimeout(fn, Math.min(ms, 5)); return () => clearTimeout(t) },
  interval(fn) { try { fn() } catch (e) {} return () => {} },
}

const src = read('shared/runtime.js') + '\n' + read('shared/host.js') + '\n' + read('plugins/selfview/tool.js')
async function evalPlugin() {
  const hs = {}
  const reg = { register(d, h) { hs[d.id] = h; return () => {} } }
  const c = Object.create(baseCtx)
  c.get = (name) => (name === 'toolboxRegistry' ? reg : baseCtx.get(name))
  const f = new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')
  const plugin = await f(c, harness, console)
  await plugin.apply(c)
  return hs.selfview
}

;(async () => {
  const panel = await evalPlugin()

  let r = await panel({ action: '', fields: {}, state: null, root: ROOT, session: 's1' })
  check('面板含 Client 按钮条挂载点', r.html.indexOf('data-selfview-mount') >= 0)
  check('面板初始 Client 离线 + 截屏流未开启', r.html.indexOf('Client 离线') >= 0 && r.html.indexOf('截屏流 未开启') >= 0)
  check('注册了 6 个模型工具', ['ui_snapshot', 'ui_capture', 'ui_click', 'ui_fill', 'ui_scroll', 'ui_press'].every((n) => !!tools[n]), Object.keys(tools).join(','))

  // Client push 状态 → 面板在线
  await handlers['selfview/push']({ kind: 'state', stream: true, note: '截屏共享已开启' })
  r = await panel({ action: 'refresh', fields: {}, state: r.state, root: ROOT, session: 's1' })
  check('push 后面板显示在线 + 共享中 + 日志', r.html.indexOf('Client 在线') >= 0 && r.html.indexOf('截屏流 共享中') >= 0 && r.html.indexOf('截屏共享已开启') >= 0)

  // 长轮询配对：ui_snapshot execute → pull 取命令 → result 回结果
  const snapP = tools.ui_snapshot.execute({ maxLines: 50 })
  const cmd1 = await handlers['selfview/pull']({})
  check('pull 取出 snapshot 命令', cmd1 && cmd1.cmd === 'snapshot' && typeof cmd1.id === 'string', JSON.stringify(cmd1))
  await handlers['selfview/result']({ id: cmd1.id, res: { ok: true, text: 'SNAP-TREE' } })
  const snapV = await snapP
  check('ui_snapshot 返回快照文本', snapV && snapV.text === 'SNAP-TREE')
  check('ui_snapshot render 产出 text block', JSON.stringify(tools.ui_snapshot.output.render({}, snapV)) === JSON.stringify([{ type: 'text', text: 'SNAP-TREE' }]))

  // ui_capture 全链路：capture 命令 → jpegB64 → subprocess stdin 批写 → 返回 read_image 提示
  const capP = tools.ui_capture.execute({})
  const cmd2 = await handlers['selfview/pull']({})
  check('pull 取出 capture 命令', cmd2 && cmd2.cmd === 'capture')
  const before = spawns.length
  await handlers['selfview/result']({ id: cmd2.id, res: { ok: true, jpegB64: 'QUJD', thumbB64: 'QUJD', w: 1920, h: 1080 } })
  const capV = await capP
  check('ui_capture 触发一次 stdin 批写（二进制走 {data}）', spawns.length === before + 1 && spawns[before].stdio.stdin && spawns[before].stdio.stdin.data === 'QUJD')
  check('ui_capture 落盘路径 + read_image 提示', /toolbox-selfview[\\/]shot-\d+\.jpg/.test(capV.text) && capV.text.indexOf('read_image') >= 0, capV.text.split('\n')[0])

  // 未授权路径
  const capP2 = tools.ui_capture.execute({})
  const cmd3 = await handlers['selfview/pull']({})
  await handlers['selfview/result']({ id: cmd3.id, res: { ok: false, error: 'no-stream' } })
  const capV2 = await capP2
  check('no-stream → 引导用户点「开启截屏」', capV2.text.indexOf('开启截屏') >= 0)

  // 超时路径（时间压缩到 5ms）：有去无回 → 明确报错
  const clickP = tools.ui_click.execute({ ref: 'e9' })
  const cmd4 = await handlers['selfview/pull']({})
  check('pull 取出 click 命令', cmd4 && cmd4.cmd === 'act' && cmd4.action === 'click' && cmd4.ref === 'e9')
  const clickV = await clickP // 不回 result，等超时
  check('Client 无响应 → 超时错误', clickV.text.indexOf('无响应') >= 0, clickV.text)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
