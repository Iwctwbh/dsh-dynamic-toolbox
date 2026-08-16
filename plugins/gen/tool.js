// ===== gen-tool.js：生成器（Host-only）=====
// UUID v4 批量 / 随机串（hex/base64url/字母数字/纯数字/易读集，crypto.randomInt 无偏）/ 哈希摘要（MD5/SHA-1/SHA-256/SHA-512）。
// 一律 node 子进程跑真 crypto（求值器无 Buffer/process，Math.random 非 CSPRNG）；spec 经环境变量传入。
// 结果有界（≤200 个 UUID / ≤4096 字符随机串 / 单条哈希），直接进 state 可回放。
// 状态：{ n, charset, len, algo, text, items[], itemsKind, notice }

return {
  name: 'gen-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')

    // 子进程脚本：数组 join 无内嵌 \n 字面量（规避双层求值转义坑）
    const GEN_SCRIPT = [
      "const spec = JSON.parse(process.env.GEN_REQ || '{}')",
      "const c = require('crypto')",
      "const out = { ok: true, items: [] }",
      "try {",
      "  if (spec.kind === 'uuid') {",
      "    const n = Math.max(1, Math.min(Number(spec.n) || 1, 200))",
      "    for (let i = 0; i < n; i++) out.items.push(c.randomUUID())",
      "  } else if (spec.kind === 'rand') {",
      "    const sets = { hex: '0123456789abcdef', b64url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', alnum: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', num: '0123456789', easy: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789' }",
      "    const cs = sets[spec.charset] || sets.alnum",
      "    const len = Math.max(1, Math.min(Number(spec.len) || 16, 4096))",
      "    const n = Math.max(1, Math.min(Number(spec.n) || 1, 50))",
      "    for (let k = 0; k < n; k++) { let s = ''; for (let i = 0; i < len; i++) s += cs[c.randomInt(0, cs.length)]; out.items.push(s) }",
      "  } else if (spec.kind === 'hash') {",
      "    const algo = ['md5', 'sha1', 'sha256', 'sha512'].indexOf(spec.algo) >= 0 ? spec.algo : 'sha256'",
      "    out.items.push(c.createHash(algo).update(String(spec.text == null ? '' : spec.text), 'utf8').digest('hex'))",
      "  } else { out.ok = false; out.error = 'unknown kind: ' + spec.kind }",
      "} catch (e) { out.ok = false; out.error = String((e && e.message) || e) }",
      "process.stdout.write(JSON.stringify(out))",
    ].join('\n')

    const runGen = async (spec, wsRoot) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const handle = subprocess.spawn({
          argv: ['node', '-'],
          cwd: wsRoot,
          stdio: { stdin: { data: GEN_SCRIPT }, stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
          graceMs: 30000,
          env: { GEN_REQ: JSON.stringify(spec) },
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout.readFrom(0).text
        if (outcome.exitCode !== 0) return { ok: false, error: handle.collected.stderr.readFrom(0).text.slice(0, 300) || '子进程失败' }
        return JSON.parse(stdout)
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    }

    const CHARSETS = [['alnum', '字母数字'], ['hex', 'hex'], ['b64url', 'base64url'], ['num', '纯数字'], ['easy', '易读（无 0O1lI）']]
    const ALGOS = [['md5', 'MD5'], ['sha1', 'SHA-1'], ['sha256', 'SHA-256'], ['sha512', 'SHA-512']]
    const NS = [1, 5, 10, 50]

    const KIND_LABEL = { uuid: 'UUID v4', rand: '随机串', hash: '哈希' }

    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">')
      // UUID 区
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">UUID v4</span>' +
        '<div class="tb-row">' + NS.map((n) =>
          '<button type="button" class="tb-chip' + (st.n === n ? ' tb-chip-on' : '') + '" data-action="uuid-n" data-v="' + n + '">' + n + ' 个</button>'
        ).join('') +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="uuid">生成</button></div></div></div>')
      // 随机串区
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">随机串（CSPRNG）</span>' +
        '<div class="tb-chips" style="margin-bottom:6px">' + CHARSETS.map(([v, label]) =>
          '<button type="button" class="tb-chip' + (st.charset === v ? ' tb-chip-on' : '') + '" data-action="charset" data-v="' + v + '">' + label + '</button>'
        ).join('') + '</div>' +
        '<div class="tb-row"><span class="tb-note">长度</span>' +
        '<input class="tb-input tb-mono" style="max-width:80px;height:24px" data-field="len" value="' + esc(st.len || '') + '" />' +
        '<span class="tb-note">条数</span>' +
        '<input class="tb-input tb-mono" style="max-width:64px;height:24px" data-field="randN" value="' + esc(st.randN || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="rand">生成</button></div></div></div>')
      // 哈希区
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">哈希摘要</span>' +
        '<div class="tb-chips" style="margin-bottom:6px">' + ALGOS.map(([v, label]) =>
          '<button type="button" class="tb-chip' + (st.algo === v ? ' tb-chip-on' : '') + '" data-action="algo" data-v="' + v + '">' + label + '</button>'
        ).join('') + '</div>' +
        '<textarea class="tb-textarea" data-field="text" placeholder="待计算哈希的文本" style="min-height:56px">' + esc(st.text || '') + '</textarea>' +
        '<div class="tb-row" style="margin-top:6px"><button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="hash">计算</button></div></div></div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      parts.push('</div>')
      // 结果区
      parts.push('<div class="tb-pane-body tb-pane-col">')
      const items = st.items || []
      if (items.length) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">' + esc(KIND_LABEL[st.itemsKind] || '结果') + '<span class="tb-count">' + items.length + '</span></span>' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-all">复制全部</button></div>')
        parts.push('<div class="tb-list">' + items.map((it, i) =>
          '<div class="tb-rec" data-action="copy-one" data-i="' + i + '" title="点击复制">' +
            '<div class="tb-rec-main"><div class="tb-rec-top"><span class="tb-rec-summary tb-mono" style="word-break:break-all">' + esc(it) + '</span></div></div>' +
          '</div>'
        ).join('') + '</div>')
      } else {
        parts.push('<div class="tb-notice">生成结果在这里，点条目复制单项</div>')
      }
      parts.push('</div></div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : {
        n: 5, charset: 'alnum', len: '16', randN: '3', algo: 'sha256', text: '', items: [], itemsKind: '', notice: null,
      }
      if (!Array.isArray(st.items)) st.items = []
      const el = fields && fields.__el ? fields.__el : {}
      if (typeof fields.len === 'string') st.len = fields.len
      if (typeof fields.randN === 'string') st.randN = fields.randN
      if (typeof fields.text === 'string') st.text = fields.text
      st.notice = null

      const doGen = async (spec, kind) => {
        const r = await runGen(spec, ws.root)
        if (!r || r.ok === false) { st.notice = '生成失败: ' + ((r && r.error) || '(无响应)'); return }
        st.items = r.items || []
        st.itemsKind = kind
      }

      if (action === 'uuid-n' && el.v) st.n = Number(el.v) || 5
      else if (action === 'charset' && el.v) st.charset = String(el.v)
      else if (action === 'algo' && el.v) st.algo = String(el.v)
      else if (action === 'uuid') await doGen({ kind: 'uuid', n: st.n }, 'uuid')
      else if (action === 'rand') await doGen({ kind: 'rand', charset: st.charset, len: st.len, n: st.randN }, 'rand')
      else if (action === 'hash') await doGen({ kind: 'hash', algo: st.algo, text: st.text }, 'hash')

      const out = { ok: true, html: render(st), state: st }
      if (action === 'copy-one' && el.i != null) {
        const it = st.items[Number(el.i)]
        if (typeof it === 'string') out.copy = it
      } else if (action === 'copy-all' && st.items.length) {
        out.copy = st.items.join('\n')
      }
      return out
    }

    tryRegisterTool(ctx, { id: 'gen', label: '生成', order: 24 }, handler)
  },
}
