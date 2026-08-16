// gen 工具仿真：mock subprocess 但用本进程真 crypto 复刻子进程语义（契约级忠实）。
// 断言：UUID 批量格式与数量/随机串字符集与长度/哈希已知向量/复制契约/参数钳制。
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const subprocess = {
  spawn({ env }) {
    const spec = JSON.parse((env && env.GEN_REQ) || '{}')
    const out = { ok: true, items: [] }
    if (spec.kind === 'uuid') {
      const n = Math.max(1, Math.min(Number(spec.n) || 1, 200))
      for (let i = 0; i < n; i++) out.items.push(crypto.randomUUID())
    } else if (spec.kind === 'rand') {
      const sets = { hex: '0123456789abcdef', b64url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', alnum: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', num: '0123456789', easy: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789' }
      const cs = sets[spec.charset] || sets.alnum
      const len = Math.max(1, Math.min(Number(spec.len) || 16, 4096))
      const n = Math.max(1, Math.min(Number(spec.n) || 1, 50))
      for (let k = 0; k < n; k++) { let s = ''; for (let i = 0; i < len; i++) s += cs[crypto.randomInt(0, cs.length)]; out.items.push(s) }
    } else if (spec.kind === 'hash') {
      const algo = ['md5', 'sha1', 'sha256', 'sha512'].indexOf(spec.algo) >= 0 ? spec.algo : 'sha256'
      out.items.push(crypto.createHash(algo).update(String(spec.text == null ? '' : spec.text), 'utf8').digest('hex'))
    } else { out.ok = false; out.error = 'unknown kind' }
    return {
      done: Promise.resolve({ exitCode: 0 }),
      collected: { stdout: { readFrom: () => ({ text: JSON.stringify(out) }) }, stderr: { readFrom: () => ({ text: '' }) } },
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

;(async () => {
  const src = read('shared/host.js') + '\n' + read('plugins/gen/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.gen
  if (!h) { console.log('FAIL | gen 未注册'); process.exit(1) }

  // UUID：默认 5 个、格式 v4
  let r = await h({ action: 'uuid', fields: {}, state: null, root: ROOT })
  check('uuid → 5 个 v4 格式', r.state.items.length === 5 && r.state.items.every((x) => UUID_RE.test(x)))
  // 改数量 50
  r = await h({ action: 'uuid-n', fields: { __el: { v: '50' } }, state: r.state, root: ROOT })
  r = await h({ action: 'uuid', fields: {}, state: r.state, root: ROOT })
  check('uuid-n 50 → 50 个且互不相同', r.state.items.length === 50 && new Set(r.state.items).size === 50)

  // 随机串：hex 32 长度
  r = await h({ action: 'rand', fields: { len: '32', randN: '2' }, state: { ...r.state, charset: 'hex' }, root: ROOT })
  check('rand hex 32×2', r.state.items.length === 2 && r.state.items.every((x) => x.length === 32 && /^[0-9a-f]+$/.test(x)))
  // 钳制：长度 99999 → 4096
  r = await h({ action: 'rand', fields: { len: '99999', randN: '1' }, state: { ...r.state, charset: 'num' }, root: ROOT })
  check('rand 长度钳制 4096 + 纯数字', r.state.items[0].length === 4096 && /^\d+$/.test(r.state.items[0]))

  // 哈希：已知向量
  r = await h({ action: 'hash', fields: { text: 'abc' }, state: { ...r.state, algo: 'md5' }, root: ROOT })
  check('md5("abc") 已知向量', r.state.items[0] === '900150983cd24fb0d6963f7d28e17f72', r.state.items[0])
  r = await h({ action: 'hash', fields: { text: 'abc' }, state: { ...r.state, algo: 'sha256' }, root: ROOT })
  check('sha256("abc") 已知向量', r.state.items[0] === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  // 中文 UTF-8
  r = await h({ action: 'hash', fields: { text: '中文' }, state: { ...r.state, algo: 'md5' }, root: ROOT })
  check('md5("中文") UTF-8 口径', r.state.items[0] === crypto.createHash('md5').update('中文', 'utf8').digest('hex'))

  // 复制契约
  r = await h({ action: 'copy-one', fields: { __el: { i: '0' } }, state: r.state, root: ROOT })
  check('copy-one → 单项', r.copy === r.state.items[0])
  r = await h({ action: 'copy-all', fields: {}, state: r.state, root: ROOT })
  check('copy-all → 换行拼接', r.copy === r.state.items.join('\n'))

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })
