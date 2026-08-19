// ===== make-payloads.mjs（v6 文件夹结构）=====
// 单一事实源：build/plugin-catalog.mjs 的 PLUGINS 表 → 生成 plugins/<key>/plugin.json + plugins/<key>/payload.json + 根 plugins.json，
// 并语法检查全部 impl（含 loader.js）。生成逻辑在 build/generate-dynamic.mjs（与 scripts/verify-generated.mjs 共用）。
//
// 新插件三步：plugins/<key>/tool.js + build/plugin-catalog.mjs 加一行 + node make-payloads.mjs。
// 日常改 impl 无需重跑本脚本（桩实时从磁盘读）；仅元数据/文件名变化时重跑。
//
// 用法: node make-payloads.mjs

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { buildDynamicArtifacts } from './build/generate-dynamic.mjs'

const { files, errors } = buildDynamicArtifacts(new URL('./', import.meta.url), (m) => console.log(m))

for (const [rel, content] of files) {
  const target = new URL('./' + rel, import.meta.url)
  const dirUrl = new URL('./' + rel.split('/').slice(0, -1).join('/') + '/', import.meta.url)
  if (rel.includes('/') && !existsSync(dirUrl)) mkdirSync(dirUrl, { recursive: true })
  writeFileSync(target, content)
}
console.log('written: plugins.json + ' + (files.size - 1) + ' 个条目文件')

if (errors.length) {
  console.error('>>> 存在错误，请先修复')
  process.exit(1)
}
console.log('>>> v6 payloads + plugin.json + plugins.json generated, all syntax OK')
