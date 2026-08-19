// ===== scripts/build-toolbox-bundle.mjs：编译合集 CLI（薄壳）=====
// 从同一插件目录按功能选择，构建 DSH 原生静态 Host/Client Bundle（用法见 --help）。
// 构建管线在 build/build-bundle.mjs（纯计算，可重复构建）；本文件只负责参数解析与写盘。
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, relative, isAbsolute, join, sep } from 'node:path'
import { PLUGINS } from '../build/plugin-catalog.mjs'
import { makeSourceLoader } from '../build/source-loader.mjs'
import { BUNDLE_ID_RE } from '../build/profile.mjs'
import { buildBundle } from '../build/build-bundle.mjs'

const rootUrl = new URL('../', import.meta.url)
const loader = makeSourceLoader(rootUrl)

// ---- 参数解析 ----
const argv = process.argv.slice(2)
const aliases = new Map()
for (const p of PLUGINS) {
  const b = p.bundle || {}
  if (!b.selectable) continue
  aliases.set(p.key, p.key)
  for (const a of b.aliases || []) aliases.set(a, p.key)
}
const opts = { features: [], clean: false, dryRun: false, json: false }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--help' || a === '-h') { opts.help = true }
  else if (a === '--features') { opts.features.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)) }
  else if (a === '--id') opts.id = argv[++i]
  else if (a === '--name') opts.name = argv[++i]
  else if (a === '--label') opts.label = argv[++i]
  else if (a === '--version') opts.version = argv[++i]
  else if (a === '--out') opts.out = argv[++i]
  else if (a === '--clean') opts.clean = true
  else if (a === '--dry-run') opts.dryRun = true
  else if (a === '--json') opts.json = true
  else if (a.startsWith('--') && aliases.has(a.slice(2))) opts.features.push(aliases.get(a.slice(2)))
  else { console.error('未知参数: ' + a + '（--help 查看用法）'); process.exit(2) }
}

if (opts.help) {
  console.log(`用法: node scripts/build-toolbox-bundle.mjs --features a,b [选项]
  --features a,b   标准选择接口（按 catalog order 规范化，与输入顺序无关）
  --flow / --jira…  各功能别名快捷参数（可选: ${[...aliases.keys()].join(', ')}）
  --id <id>        bundleId（默认按选择 key 字典序以 - 连接；${BUNDLE_ID_RE}）
  --name <pkg>     npm package name（默认 dsh-<id>-toolbox；发布必须显式提供）
  --label <文本>   侧栏/抽屉显示名称（单功能默认功能 label，多功能默认「A + B 工具箱」）
  --version <ver>  semver（默认 0.0.0-dev；发布必须显式提供合法 semver）
  --out <dir>      输出目录（默认 dist/toolbox-bundles/<id>）
  --clean          构建前清理解析后的精确输出目录
  --dry-run        只打印解析后的 profile、文件清单与验证结果，不写文件
  --json           输出机器可读构建摘要（供 CI）`)
  process.exit(0)
}

const result = buildBundle(loader, opts)
if (!result.ok) {
  console.error('✗ 构建失败:\n  ' + result.errors.join('\n  '))
  process.exit(1)
}
const { files, summary } = result
const outRel = opts.out || ('dist/toolbox-bundles/' + summary.bundleId)
const repoRoot = fileURLToPath(rootUrl)
const allowedOutRoot = resolve(repoRoot, 'dist', 'toolbox-bundles')
const outPath = resolve(repoRoot, outRel)
const fromAllowedRoot = relative(allowedOutRoot, outPath)
// --clean 会递归删除目标目录：输出必须是 dist/toolbox-bundles 的严格子目录，
// 不能用 .. / 绝对路径逃逸，也不能把输出根自身作为目标。
if (!fromAllowedRoot || fromAllowedRoot === '..' || fromAllowedRoot.startsWith('..' + sep) || isAbsolute(fromAllowedRoot)) {
  console.error('✗ 输出目录不安全: ' + outRel + '（必须位于 dist/toolbox-bundles/<bundle> 下）')
  process.exit(2)
}

// ---- 摘要 ----
if (opts.json) {
  console.log(JSON.stringify(Object.assign({ out: outRel }, summary), null, 2))
} else {
  console.log('bundle: ' + summary.bundleId + '（' + summary.packageName + '@' + summary.version + '）→ ' + outRel)
  console.log('功能: 显式选择 [' + summary.features.explicit.join(', ') + ']'
    + (summary.features.dependencyAdded.length ? '；依赖加入 [' + summary.features.dependencyAdded.join(', ') + ']' : '')
    + '；toolbox 框架隐式加入')
  console.log('显示名: ' + summary.label + '；fingerprint: ' + summary.fingerprint)
  console.log('加载模式: DSH 原生静态 Host/Client；动态批准次数: 0')
  for (const f of summary.files) console.log('  ' + f.path + '  ' + f.bytes + ' B')
}

if (opts.dryRun) { if (!opts.json) console.log('（dry-run：未写文件）'); process.exit(0) }

// ---- 写盘（--clean 只清理解析后的精确输出目录）----
if (opts.clean && existsSync(outPath)) rmSync(outPath, { recursive: true, force: true })
mkdirSync(join(outPath, 'lib'), { recursive: true })
for (const [rel, content] of files) writeFileSync(join(outPath, ...rel.split('/')), content)
console.log('>>> 构建完成: ' + outRel + '（' + files.size + ' 个文件）')
console.log('下一步: cd ' + outRel + ' && npm pack，然后 dsh plugin --profile web add <tgz>')
