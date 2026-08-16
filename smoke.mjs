// ===== smoke.mjs：面板/工具契约冒烟套件 =====
// 跑 smoke/sim-*.cjs 全部用例（各套件以 mock ctx/服务真实求值插件 impl，断言行与 state 契约）。
// 用法：node smoke.mjs（exit 0 全绿 / 1 有失败）。改 shared/host.js、framework、任一 tool.js 后建议跑一遍。
// 实现注意：沙箱禁命名管道，spawnSync 不能用 pipe 捕获——一律临时文件重定向 stdout/stderr 再读回。
import { readdirSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const suites = readdirSync(join(here, 'smoke')).filter((f) => /^sim-.*\.cjs$/.test(f)).sort()
if (!suites.length) { console.error('smoke/ 下没有 sim-*.cjs'); process.exit(1) }

let failedSuites = 0
for (const f of suites) {
  const outF = join(tmpdir(), 'smoke-' + process.pid + '-' + f + '.out')
  const errF = outF + '.err'
  const outFd = openSync(outF, 'w')
  const errFd = openSync(errF, 'w')
  const r = spawnSync(process.execPath, [join(here, 'smoke', f)], { stdio: ['ignore', outFd, errFd] })
  try { closeSync(outFd); closeSync(errFd) } catch (e) {}
  const out = (() => { try { return readFileSync(outF, 'utf8') } catch (e) { return '' } })() +
    (() => { try { return readFileSync(errF, 'utf8') } catch (e) { return '' } })()
  try { rmSync(outF); rmSync(errF) } catch (e) {}
  const pass = r.status === 0
  const passCount = (out.match(/^PASS/gm) || []).length
  const failCount = (out.match(/^FAIL/gm) || []).length
  console.log((pass ? '✓' : '✗') + ' ' + f + '（' + passCount + ' 过' + (failCount ? ' / ' + failCount + ' 败' : '') + '）')
  if (!pass) {
    failedSuites++
    console.log(out.split('\n').filter((l) => /FAIL|异常/.test(l)).map((l) => '    ' + l).join('\n'))
  }
}
console.log(failedSuites ? ('>>> ' + failedSuites + ' 个套件失败') : '>>> ' + suites.length + ' 个套件全部通过')
process.exit(failedSuites ? 1 : 0)
