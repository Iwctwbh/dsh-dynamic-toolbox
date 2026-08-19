// ===== build/source-loader.mjs：安全读取、拼接、语法检查、哈希 =====
// 构建期公共模块（Node 构建脚本专用，不进入任何运行时 payload）。
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

// rootUrl：仓库根的 file URL（如 new URL('../', import.meta.url)）；rel 一律为根相对 POSIX 路径
export const makeSourceLoader = (rootUrl) => {
  const resolveUrl = (rel) => new URL('./' + rel, rootUrl)
  return Object.freeze({
    exists: (rel) => existsSync(resolveUrl(rel)),
    read: (rel) => readFileSync(resolveUrl(rel), 'utf8'),
    readExisting: (rels) => rels.filter((r) => existsSync(resolveUrl(r))).map((r) => readFileSync(resolveUrl(r), 'utf8')),
  })
}

// 语法检查（只编译不执行）；返回 null 表示通过，否则返回错误描述
export const syntaxCheck = (label, code) => {
  try {
    new Function('return (async () => {\n' + code + '\n})()')
    return null
  } catch (e) {
    return label + ': ' + ((e && e.message) || String(e))
  }
}

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

// Host 半 timer 动词检查（DSH 新版沙箱 ctx 门禁）：用了 ctx.interval/timeout 等但
// inject 未声明 'timer' 会在运行时被拒（"sandbox ctx does not expose ..."）——提前构建期拦截。
export const TIMER_VERBS = ['ctx.interval', 'ctx.timeout', 'ctx.throttle', 'ctx.debounce', 'ctx.setTimeout', 'ctx.setInterval', 'ctx.get(\'timer\')']

// 返回错误描述或 null
export const checkTimerInject = (entry, implSrc) => {
  if (!entry.hostFiles || entry.platform === 'client-only') return null
  const usesTimer = TIMER_VERBS.some((v) => implSrc.includes(v))
  if (usesTimer && !(entry.inject || []).includes('timer')) {
    return 'timer-inject FAIL: ' + entry.key + ' 的 impl 用了 timer 动词但 inject 缺 \'timer\'（DSH 新版动态 Host 必须显式注入）'
  }
  return null
}
