// ===== scripts/verify-generated.mjs：动态生成物漂移检查 =====
// 重新计算 make-payloads.mjs 应生成的全部内容，与磁盘逐字节对比：
//   - 内容漂移（源码/元数据改了但没重跑 make-payloads.mjs）→ 失败
//   - 磁盘上存在但 catalog 已删除的残留 plugin.json/payload.json → 失败
// 用法: node scripts/verify-generated.mjs（exit 0 无漂移 / 1 有漂移）
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildDynamicArtifacts } from '../build/generate-dynamic.mjs'

const rootUrl = new URL('../', import.meta.url)
const here = fileURLToPath(rootUrl)

const { files, errors } = buildDynamicArtifacts(rootUrl)
let failed = false

if (errors.length) {
  failed = true
  for (const e of errors) console.error('生成错误: ' + e)
}

// 内容漂移
for (const [rel, content] of files) {
  const target = new URL('./' + rel, rootUrl)
  if (!existsSync(target)) {
    failed = true
    console.error('缺失: ' + rel + '（需重跑 node make-payloads.mjs）')
    continue
  }
  const onDisk = readFileSync(target, 'utf8')
  if (onDisk !== content) {
    failed = true
    console.error('漂移: ' + rel + '（需重跑 node make-payloads.mjs）')
  }
}

// 残留文件（catalog 里已没有该 key，磁盘上仍有生成物）
const pluginsDir = new URL('./plugins/', rootUrl)
if (existsSync(pluginsDir)) {
  for (const ent of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    for (const leaf of ['plugin.json', 'payload.json']) {
      const rel = 'plugins/' + ent.name + '/' + leaf
      if (existsSync(new URL('./' + rel, rootUrl)) && !files.has(rel)) {
        failed = true
        console.error('残留: ' + rel + '（catalog 已无 ' + ent.name + ' 条目）')
      }
    }
  }
}

if (failed) {
  console.error('>>> 动态生成物存在漂移')
  process.exit(1)
}
console.log('>>> verify-generated: ' + files.size + ' 个生成物与 catalog/源码一致，无漂移（' + here + '）')
