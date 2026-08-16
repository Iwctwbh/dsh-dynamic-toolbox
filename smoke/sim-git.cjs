// git 工具仿真：mock subprocess 直连真实 node child_process，对本仓库执行真实 git 命令。
// 覆盖：status 载入 / 未暂存 diff / 未跟踪新文件 diff / 暂存区 diff / back-diff 返回 list。
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const os = require('os')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 沙箱禁命名管道 → stdio 用临时文件重定向（等价于插件内 subprocess 服务的采集行为）
let tmpSeq = 0
const subprocess = {
  spawn({ argv, cwd }) {
    const base = path.join(os.tmpdir(), 'sim-git-' + process.pid + '-' + (tmpSeq++))
    const outF = base + '.out', errF = base + '.err'
    const outFd = fs.openSync(outF, 'w'), errFd = fs.openSync(errF, 'w')
    const p = spawn(argv[0], argv.slice(1), { cwd, stdio: ['ignore', outFd, errFd] })
    const done = new Promise((res, rej) => {
      p.on('error', rej)
      p.on('close', (code) => {
        try { fs.closeSync(outFd); fs.closeSync(errFd) } catch (e) {}
        res({ exitCode: code })
      })
    })
    const readF = (f) => () => ({ text: (() => { try { return fs.readFileSync(f, 'utf8') } catch (e) { return '' } })() })
    return { done, collected: { stdout: { readFrom: readF(outF) }, stderr: { readFrom: readF(errF) } } }
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
  const src = read('shared/host.js') + '\n' + read('plugins/git/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.git
  if (!h) { console.log('FAIL | git 未注册'); process.exit(1) }

  // 1. 打开 → status + history
  let r = await h({ action: '', fields: {}, state: null, root: ROOT })
  if (!r.ok) { console.log('FAIL | 打开失败: ' + r.error); process.exit(1) }
  const st = r.state
  check('打开 → 当前分支显示', !!st.branch, 'branch=' + st.branch)
  check('变更清单非空（本仓库有改动）', (st.files || []).length > 0, 'files=' + (st.files || []).length)
  check('变更行带 data-action="wdiff"', r.html.indexOf('data-action="wdiff"') >= 0)
  check('提交历史非空', (st.commits || []).length > 0, 'commits=' + (st.commits || []).length)

  // 分类挑样本：未跟踪（??）/ 含未暂存（xy[1]∈MD）/ 纯暂存（xy[0]∈MAD 且 xy[1] 空）
  const untracked = st.files.find((f) => f.xy === '??')
  const workMod = st.files.find((f) => f.xy && f.xy[1] === 'M')
  const stagedOnly = st.files.find((f) => f.xy && f.xy[0] !== ' ' && f.xy[0] !== '?' && (f.xy[1] === ' ' || !f.xy[1]))

  // 2. 未暂存修改 → 工作区 diff
  if (workMod) {
    r = await h({ action: 'wdiff', fields: { __el: { path: workMod.path, xy: workMod.xy } }, state: st, root: ROOT })
    check('wdiff(未暂存) → diff 视图 + 工作区标头', r.state.view === 'diff' && r.html.indexOf('工作区（未暂存）变更') >= 0 && r.html.indexOf('diff --git') >= 0, workMod.path + ' xy=' + workMod.xy)
    check('wdiff → state 不含 diff 本体（轻量）', !('diff' in r.state) && JSON.stringify(r.state).length < 20 * 1024, 'state=' + JSON.stringify(r.state).length + 'B')
    // 返回 → list
    r = await h({ action: 'back-diff', fields: {}, state: r.state, root: ROOT })
    check('back-diff → 回到 list', r.state.view === 'list')
  } else check('存在未暂存样本', false, '无 xy[1]=M 文件')

  // 3. 未跟踪新文件 → no-index 全文 diff
  if (untracked) {
    r = await h({ action: 'wdiff', fields: { __el: { path: untracked.path, xy: untracked.xy } }, state: st, root: ROOT })
    const hasDiff = r.html.indexOf('新文件（未跟踪）') >= 0 && r.html.indexOf('diff --git') >= 0
    check('wdiff(未跟踪) → 全文新增 diff', r.state.view === 'diff' && hasDiff, untracked.path)
  } else check('存在未跟踪样本', false, '无 ?? 文件')

  // 4. 纯暂存样本（若当前仓库有）→ --cached diff
  if (stagedOnly) {
    r = await h({ action: 'wdiff', fields: { __el: { path: stagedOnly.path, xy: stagedOnly.xy } }, state: st, root: ROOT })
    check('wdiff(纯暂存) → --cached diff', r.state.view === 'diff' && r.html.indexOf('已暂存变更') >= 0, stagedOnly.path)
  } else {
    console.log('SKIP | 当前无纯暂存文件样本（跳过 --cached 分支实测）')
  }

  // 5. 提交详情 → 文件 diff → 返回 detail（回归既有链路）
  const c0 = st.commits[0]
  r = await h({ action: 'open', fields: { __el: { hash: c0.hash } }, state: st, root: ROOT })
  check('open → detail 视图', r.state.view === 'detail' && !!r.state.detail)
  const cf = (r.state.detail.files || [])[0]
  if (cf) {
    r = await h({ action: 'diff', fields: { __el: { path: cf.path } }, state: r.state, root: ROOT })
    check('提交文件 diff → diff 视图（来源 detail）', r.state.view === 'diff' && r.state.diffFrom === 'detail')
    r = await h({ action: 'back-diff', fields: {}, state: r.state, root: ROOT })
    check('back-diff → 回到 detail', r.state.view === 'detail')
  }

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
