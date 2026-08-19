// ===== scripts/verify-bundle.mjs：原生静态 Bundle 结构/契约检查 =====
// 用法: node scripts/verify-bundle.mjs <bundleDir> [--pack]
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const dir = (process.argv[2] || '').replace(/\\/g, '/').replace(/\/+$/, '')
const withPack = process.argv.includes('--pack')
if (!dir) { console.error('用法: node scripts/verify-bundle.mjs <bundleDir> [--pack]'); process.exit(2) }

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}
const read = (rel) => { try { return readFileSync(dir + '/' + rel, 'utf8') } catch (error) { return null } }
const required = ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/remote.js', 'manifest.json', 'BUILDINFO.json', 'README.md', 'LICENSE']
for (const file of required) check('存在 ' + file, existsSync(dir + '/' + file))

const pkg = JSON.parse(read('package.json') || '{}')
check('Host main/exports 指向 lib/index.js', pkg.type === 'module' && pkg.main === './lib/index.js' && pkg.exports && pkg.exports['.'] === './lib/index.js')
check('导出原生 ./client 与 ./remote', pkg.exports && pkg.exports['./client'] === './lib/client.js' && pkg.exports['./remote'] === './lib/remote.js')
check('声明 dsh.bundle.patch', pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml')
check('声明原生 dsh.client web 入口', pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web')
check('Client 依赖原生 runtime/api-remotes', pkg.dsh && pkg.dsh.client && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime') && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'))
check('不依赖动态 Host/Client runner', JSON.stringify(pkg).indexOf('cordis-host-runner') < 0 && JSON.stringify(pkg).indexOf('cordis-client-runner') < 0)

const info = JSON.parse(read('BUILDINFO.json') || '{}')
const manifest = JSON.parse(read('manifest.json') || '{}')
check('BUILDINFO 标记 native-static / 零批准', info.mode === 'native-static' && info.dynamicApprovalRequired === false)
check('manifest 标记 native-static', manifest.mode === 'native-static')
check('fingerprint 存在', typeof info.fingerprint === 'string' && info.fingerprint.length >= 12)
const patch = read('cordis.patch.yml') || ''
check('patch 行 id/name 正确', patch.includes('toolbox-bundle-' + info.bundleId) && patch.includes("name: '" + pkg.name + "'"))

const host = read('lib/index.js') || ''
const client = read('lib/client.js') || ''
const remote = read('lib/remote.js') || ''
const combined = host + '\n' + client + '\n' + remote
check('Host 是原生 Typert Remote Service', host.includes('TypertRemoteService') && host.includes('export async function apply(ctx)'))
check('Client 预注册到 __ModuleLoader__', client.includes('window.__ModuleLoader__.load({') && client.includes('id: ' + JSON.stringify(pkg.name)))
check('Client 原生挂载 Remote contribution', client.includes('ctx.remote.$mount(remoteContribution)'))
check('Client bundle 导出 apply/inject', client.includes('exports.inject = inject') && client.includes('exports.apply = apply'))
check('零 dynamicCordisRunner / runner.define / dyn 路径', !/dynamicCordisRunner|runner\.define|runner\.run|dyn\//.test(combined))
check('零动态 payload/loader 桩', !/payloads\.js|TOOL_FILES|无法加载 loader\.js/.test(combined))
check('Remote 描述含 tools/panel/sessionInfo', remote.includes("descriptor('tools')") && remote.includes("descriptor('panel')") && remote.includes("descriptor('sessionInfo')"))

for (const file of ['lib/index.js', 'lib/client.js', 'lib/remote.js']) {
  const result = spawnSync(process.execPath, ['--check', dir + '/' + file], { encoding: 'utf8' })
  check(file + ' 语法检查', result.status === 0, result.status === 0 ? '' : (result.stderr || result.stdout || '').slice(0, 240))
}

if (withPack) {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: dir, shell: true, encoding: 'utf8' })
  check('npm pack --dry-run 成功', result.status === 0, result.status === 0 ? '' : (result.stderr || '').slice(0, 240))
  if (result.status === 0) {
    const names = (JSON.parse(result.stdout)[0].files || []).map((file) => file.path.replace(/\\/g, '/'))
    for (const wanted of required) check('tarball 含 ' + wanted, names.includes(wanted))
    const banned = names.filter((name) => /(^|\/)(payloads\.js|runtime-profile\.js|loader\.js|payload\.json)$/.test(name))
    check('tarball 不含动态 payload/loader 产物', banned.length === 0, banned[0] || '')
  }
}

console.log(failures ? ('>>> ' + failures + ' 项失败') : '>>> verify-bundle 全部通过（原生静态）')
process.exit(failures ? 1 : 0)
