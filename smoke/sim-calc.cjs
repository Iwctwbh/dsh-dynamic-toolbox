// calc（计算台 5 合一）仿真：mock subprocess（真 crypto 复刻生成器子进程语义）。
// 覆盖：codec 编解码/JSON/时间戳、regex 匹配/替换、cron 解析与未来时刻、
// txtdiff 行级 diff 与折叠、gen UUID/随机串/哈希、子模式切换状态隔离、copy 契约。
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
  const src = read('shared/host.js') + '\n' + read('plugins/calc/tool.js')
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(ctx, undefined, console)
  await plugin.apply(ctx)
  const h = handlers.calc
  if (!h) { console.log('FAIL | calc 未注册'); process.exit(1) }

  // ---- 打开：默认 codec 子模式，8 个转换芯片 ----
  let r = await h({ action: '', fields: {}, state: null, root: ROOT })
  check('打开 → 默认子模式 codec', r.state.sub === 'codec' && r.html.indexOf('Base64 编码') >= 0)
  check('打开 → 5 个子模式芯片', (r.html.match(/data-action="sub"/g) || []).length === 5)

  // ---- codec：Base64 编码/解码、JSON 美化、时间戳 ----
  r = await h({ action: 'run', fields: { input: 'hello 世界' }, state: r.state, root: ROOT })
  const b64 = r.state.codec.output
  check('codec b64e → 可解码还原', b64 === Buffer.from('hello 世界').toString('base64'), b64)
  r = await h({ action: 'mode', fields: { __el: { m: 'b64d' } }, state: r.state, root: ROOT })
  r = await h({ action: 'run', fields: { input: b64 }, state: r.state, root: ROOT })
  check('codec b64d → 还原', r.state.codec.output === 'hello 世界')
  r = await h({ action: 'mode', fields: { __el: { m: 'jp' } }, state: r.state, root: ROOT })
  r = await h({ action: 'run', fields: { input: '{"a":1}' }, state: r.state, root: ROOT })
  check('codec jp → JSON 美化', r.state.codec.output === '{\n  "a": 1\n}')
  r = await h({ action: 'mode', fields: { __el: { m: 'tsd' } }, state: r.state, root: ROOT })
  r = await h({ action: 'run', fields: { input: '0' }, state: r.state, root: ROOT })
  check('codec tsd → 时间戳转本地', r.state.codec.output.indexOf('1970-01-01') >= 0)
  r = await h({ action: 'copy', fields: {}, state: r.state, root: ROOT })
  check('codec copy → 复制输出', r.copy === r.state.codec.output)

  // ---- regex：匹配/替换/预设 ----
  let rr = await h({ action: 'sub', fields: { __el: { v: 'regex' } }, state: r.state, root: ROOT })
  check('切 regex → 匹配芯片', rr.state.sub === 'regex' && rr.html.indexOf('匹配') >= 0)
  rr = await h({ action: 'test', fields: { pattern: '(\\w+)@(\\w+\\.com)', text: 'mail a@b.com twice a@b.com' }, state: rr.state, root: ROOT })
  check('regex 匹配 → 2 条 + 分组', (rr.html.match(/tb-pill-active/g) || []).length === 2 && rr.html.indexOf('$1') >= 0)
  rr = await h({ action: 'mode', fields: { __el: { v: 'replace' } }, state: rr.state, root: ROOT })
  rr = await h({ action: 'test', fields: { pattern: 'a@b\\.com', replacement: '[$&]', text: 'a@b.com' }, state: rr.state, root: ROOT })
  check('regex 替换 → 计数 1', rr.html.indexOf('替换结果') >= 0 && rr.html.indexOf('count">1 处') >= 0)
  rr = await h({ action: 'copy-out', fields: {}, state: rr.state, root: ROOT })
  check('regex copy-out → 复制结果（$& 全匹配）', rr.copy === '[a@b.com]', String(rr.copy))

  // ---- cron：解析 + 未来时刻 ----
  let rc = await h({ action: 'sub', fields: { __el: { v: 'cron' } }, state: rr.state, root: ROOT })
  check('切 cron → 表达式输入', rc.state.sub === 'cron' && rc.html.indexOf('data-field="expr"') >= 0)
  rc = await h({ action: 'calc', fields: { expr: '0 9 * * 1-5' }, state: rc.state, root: ROOT })
  check('cron 解析 → 字段明细 + 未来 8 次运行', rc.html.indexOf('字段明细') >= 0 && rc.html.indexOf('未来 8 次运行') >= 0)
  rc = await h({ action: 'preset', fields: { __el: { v: '* * * * *' } }, state: rc.state, root: ROOT })
  check('cron 预设 → 自动解析', rc.state.cron.expr === '* * * * *' && rc.html.indexOf('未来 8 次') >= 0)
  rc = await h({ action: 'calc', fields: { expr: 'bad cron' }, state: rc.state, root: ROOT })
  check('cron 非法 → 错误 banner', rc.html.indexOf('tb-banner-error') >= 0)

  // ---- txtdiff：diff 行/统计/折叠、交换 ----
  let rt = await h({ action: 'sub', fields: { __el: { v: 'txtdiff' } }, state: rc.state, root: ROOT })
  check('切 txtdiff → 双输入框', rt.state.sub === 'txtdiff' && rt.html.indexOf('data-field="a"') >= 0 && rt.html.indexOf('data-field="b"') >= 0)
  rt = await h({ action: 'compare', fields: { a: 'a\nb\nc', b: 'a\nx\nc' }, state: rt.state, root: ROOT })
  check('txtdiff 对比 → +1/−1/相同 2', rt.html.indexOf('>+1<') >= 0 && rt.html.indexOf('>−1<') >= 0 && rt.html.indexOf('相同 2') >= 0)
  rt = await h({ action: 'swap', fields: {}, state: rt.state, root: ROOT })
  check('txtdiff 交换 → a/b 互换', rt.state.txtdiff.a === 'a\nx\nc' && rt.state.txtdiff.b === 'a\nb\nc')
  // 长相同段折叠（11 行相同 + 1 行差异）
  const same11 = Array(11).fill('same').join('\n')
  rt = await h({ action: 'compare', fields: { a: same11 + '\ndiff', b: same11 + '\nother' }, state: rt.state, root: ROOT })
  check('txtdiff 折叠 → 折叠提示出现', rt.html.indexOf('行相同，点击展开') >= 0)
  rt = await h({ action: 'expand', fields: { __el: { k: 'seg0' } }, state: rt.state, root: ROOT })
  check('txtdiff 展开 → 折叠提示消失', rt.html.indexOf('行相同，点击展开') < 0)

  // ---- gen：UUID / 随机串 / 哈希（复用原 sim-gen 契约）----
  let rg = await h({ action: 'sub', fields: { __el: { v: 'gen' } }, state: rt.state, root: ROOT })
  check('切 gen → UUID 区', rg.state.sub === 'gen' && rg.html.indexOf('UUID v4') >= 0)
  rg = await h({ action: 'uuid', fields: {}, state: rg.state, root: ROOT })
  check('gen uuid → 5 个 v4 格式', rg.state.gen.items.length === 5 && rg.state.gen.items.every((x) => UUID_RE.test(x)))
  rg = await h({ action: 'rand', fields: { len: '32', randN: '2' }, state: { ...rg.state, gen: { ...rg.state.gen, charset: 'hex' } }, root: ROOT })
  check('gen rand hex 32×2', rg.state.gen.items.length === 2 && rg.state.gen.items.every((x) => x.length === 32 && /^[0-9a-f]+$/.test(x)))
  rg = await h({ action: 'hash', fields: { text: 'abc' }, state: { ...rg.state, gen: { ...rg.state.gen, algo: 'md5' } }, root: ROOT })
  check('gen md5("abc") 已知向量', rg.state.gen.items[0] === '900150983cd24fb0d6963f7d28e17f72', rg.state.gen.items[0])
  rg = await h({ action: 'copy-one', fields: { __el: { i: '0' } }, state: rg.state, root: ROOT })
  check('gen copy-one → 单项复制', rg.copy === rg.state.gen.items[0])
  rg = await h({ action: 'copy-all', fields: {}, state: rg.state, root: ROOT })
  check('gen copy-all → 换行拼接', rg.copy === rg.state.gen.items.join('\n'))

  // ---- 子模式状态隔离：切回 codec 时 gen 子状态仍在 ----
  const iso = await h({ action: 'sub', fields: { __el: { v: 'codec' } }, state: rg.state, root: ROOT })
  check('状态隔离：codec 状态保留 + gen 子状态不丢', iso.state.codec.mode === 'tsd' && iso.state.gen.items.length > 0)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })