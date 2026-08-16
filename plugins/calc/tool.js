// ===== calc-tool.js：计算台（Host-only）— codec/regex/cron/txtdiff/gen 5 合一 =====
// 纯计算/纯 JS 小工具合并为单插件单 Tab「计算」，内部子模式芯片切换；
// 每个子模式独立状态命名空间（st.codec / st.regex / st.cron / st.txtdiff / st.gen），互不干扰。
// 大本体（txtdiff diff 行 / gen 随机串上限）沿用原实现的闭包或直接进子状态（有界）。
// 状态：{ sub, codec{...}, regex{...}, cron{...}, txtdiff{...}, gen{...} }

return {
  name: 'calc-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')

    // ================= 子模式 codec：编解码 =================
    const CODEC_MODES = [
      ['b64e', 'Base64 编码'], ['b64d', 'Base64 解码'],
      ['urle', 'URL 编码'], ['urld', 'URL 解码'],
      ['jp', 'JSON 美化'], ['jm', 'JSON 压缩'],
      ['tsd', '时间戳 → 日期'], ['dts', '日期 → 时间戳'],
    ]
    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtLocal = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    const codecConvert = (mode, input) => {
      const s = String(input == null ? '' : input)
      switch (mode) {
        case 'b64e': return { out: b64encode(s) }
        case 'b64d': return { out: b64decode(s.trim()) }
        case 'urle': return { out: encodeURIComponent(s) }
        case 'urld': return { out: decodeURIComponent(s) }
        case 'jp': return { out: JSON.stringify(JSON.parse(s), null, 2) }
        case 'jm': return { out: JSON.stringify(JSON.parse(s)) }
        case 'tsd': {
          let n = Number(s.trim())
          if (!isFinite(n)) return { error: '请输入数字时间戳（秒或毫秒）' }
          if (Math.abs(n) < 1e12) n = n * 1000
          const d = new Date(n)
          if (isNaN(d.getTime())) return { error: '时间戳超出有效范围' }
          return { out: '本地时间  ' + fmtLocal(d) + '\nISO       ' + d.toISOString() + '\n毫秒      ' + n }
        }
        case 'dts': {
          const t = Date.parse(s.trim())
          if (isNaN(t)) return { error: '无法解析日期，示例：2026-08-16 12:30:00 或 2026-08-16T04:30:00Z' }
          return { out: '毫秒时间戳  ' + t + '\n秒时间戳    ' + Math.floor(t / 1000) + '\nISO         ' + new Date(t).toISOString() }
        }
        default: return { error: '未知模式' }
      }
    }

    // ================= 子模式 regex：正则 =================
    const REGEX_FLAGS = [['g', '全局'], ['i', '忽略大小写'], ['m', '多行'], ['s', '点跨行'], ['u', 'Unicode']]
    const REGEX_CAP = 200
    const REGEX_PRESETS = [
      ['邮箱', '[\\w.-]+@[\\w-]+(\\.[\\w-]+)+', '联系 a.b-c@example.com 或 x@sub.domain.org'],
      ['手机号', '1[3-9]\\d{9}', '拨打 13812345678 或 19900001111'],
      ['URL', 'https?://[^\\s"\'<>]+', '见 https://example.com/a?b=1 和 http://x.org'],
      ['日期', '\\d{4}-\\d{2}-\\d{2}', '从 2026-08-16 到 2026-09-01'],
      ['UUID', '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', 'id: 2b9fbdc9-397f-43e4-921a-a46097560876'],
      ['中文段', '[\\u4e00-\\u9fa5]+', '混合 English 与 中文连续 段落'],
      ['IPv4', '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', '127.0.0.1 与 10.0.0.256'],
    ]
    const regexRun = (pattern, flags, text) => {
      if (!pattern) return { matches: [], error: null, truncated: false }
      let re
      try { re = new RegExp(pattern, flags.join('')) } catch (e) { return { matches: [], error: String(e.message || e), truncated: false } }
      const matches = []
      let truncated = false
      if (re.global) {
        let m
        while ((m = re.exec(text)) !== null) {
          if (matches.length >= REGEX_CAP) { truncated = true; break }
          matches.push({ i: m.index, text: m[0], groups: m.slice(1) })
          if (m[0] === '') re.lastIndex++
        }
      } else {
        const m = re.exec(text)
        if (m) matches.push({ i: m.index, text: m[0], groups: m.slice(1) })
      }
      return { matches, error: null, truncated }
    }
    const regexReplace = (pattern, flags, text, replacement) => {
      if (!pattern) return { out: '', count: 0, error: null }
      let re
      try { re = new RegExp(pattern, flags.join('')) } catch (e) { return { out: '', count: 0, error: String(e.message || e) } }
      let count = 0
      if (re.global) {
        try {
          const cnt = new RegExp(pattern, flags.join(''))
          let m
          while ((m = cnt.exec(text)) !== null) {
            count++
            if (m[0] === '') cnt.lastIndex++
            if (count >= 100000) break
          }
        } catch (e) {}
      } else {
        count = re.test(text) ? 1 : 0
      }
      let out = ''
      try { out = text.replace(re, replacement) } catch (e) { return { out: '', count, error: String(e.message || e) } }
      return { out, count, error: null }
    }

    // ================= 子模式 cron：Cron 表达式 =================
    // 派生结果（字段明细含 Set / 未来时刻数组）留闭包——Set 不可 JSON 序列化，
    // 进 state 跨 RPC 会变空对象（原独立插件同样如此：每次动作现算，state 只留 expr）。
    let lastCronParsed = null
    let lastCronRuns = null
    const CRON_FIELDS = [
      { key: 'minute', label: '分', min: 0, max: 59 },
      { key: 'hour', label: '时', min: 0, max: 23 },
      { key: 'dom', label: '日', min: 1, max: 31 },
      { key: 'month', label: '月', min: 1, max: 12, names: { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 } },
      { key: 'dow', label: '周', min: 0, max: 7, names: { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 } },
    ]
    const cronParseField = (text, def) => {
      const raw = String(text == null ? '' : text).trim()
      if (!raw) return { error: '不能为空' }
      const vals = new Set()
      let any = false
      const nameOf = (s) => {
        const up = s.toUpperCase()
        if (def.names && Object.prototype.hasOwnProperty.call(def.names, up)) return def.names[up]
        if (!/^\d+$/.test(s)) return null
        return Number(s)
      }
      for (const part0 of raw.split(',')) {
        const part = part0.trim()
        if (!part) return { error: '存在空项（多余逗号）' }
        const slash = part.split('/')
        if (slash.length > 2 || (slash[1] !== undefined && (!/^\d+$/.test(slash[1]) || Number(slash[1]) < 1))) return { error: '非法步长: ' + part }
        const step = slash[1] !== undefined ? Number(slash[1]) : 1
        let lo
        let hi
        const base = slash[0]
        if (base === '*' || base === '') {
          lo = def.min; hi = def.max
          if (base === '*' && step === 1) any = true
        } else if (base.indexOf('-') >= 0) {
          const pair = base.split('-')
          if (pair.length !== 2) return { error: '非法范围: ' + part }
          lo = nameOf(pair[0]); hi = nameOf(pair[1])
          if (lo == null || hi == null) return { error: '非法范围端点: ' + part }
          if (lo > hi) return { error: '范围起点大于终点: ' + part }
        } else {
          const v = nameOf(base)
          if (v == null) return { error: '非法值: ' + base }
          lo = v
          hi = slash[1] !== undefined ? def.max : v
        }
        if (lo < def.min || hi > def.max) return { error: '超出范围(' + def.min + '-' + def.max + '): ' + part }
        for (let v = lo; v <= hi; v += step) vals.add(def.key === 'dow' && v === 7 ? 0 : v)
      }
      return { set: vals, any }
    }
    const cronParse = (expr) => {
      const segs = String(expr || '').trim().split(/\s+/)
      if (segs.length !== 5) return { error: '需要 5 段（分 时 日 月 周），当前 ' + segs.length + ' 段' }
      const fields = []
      for (let i = 0; i < 5; i++) {
        const r = cronParseField(segs[i], CRON_FIELDS[i])
        if (r.error) return { error: '第 ' + (i + 1) + ' 段（' + CRON_FIELDS[i].label + '）' + r.error }
        fields.push(r)
      }
      return { fields }
    }
    const cronMatchDay = (dom, dow, y, mo, d) => {
      const dt = new Date(y, mo, d)
      const domHit = dom.set.has(d)
      const dowHit = dow.set.has(dt.getDay())
      if (!dom.any && !dow.any) return domHit || dowHit
      return domHit && dowHit
    }
    const cronNextRuns = (fields, count) => {
      const [minute, hour, dom, month, dow] = fields
      const out = []
      const t = new Date()
      t.setSeconds(0, 0)
      t.setMinutes(t.getMinutes() + 1)
      const limit = new Date(t.getTime())
      limit.setFullYear(limit.getFullYear() + 4)
      let cur = t
      while (out.length < count && cur < limit) {
        if (!month.set.has(cur.getMonth() + 1)) { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 0, 0); continue }
        if (!cronMatchDay(dom, dow, cur.getFullYear(), cur.getMonth(), cur.getDate())) {
          cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 0, 0)
          continue
        }
        if (!hour.set.has(cur.getHours())) { cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), cur.getHours() + 1, 0); continue }
        if (!minute.set.has(cur.getMinutes())) { cur = new Date(cur.getTime() + 60000); continue }
        out.push(new Date(cur))
        cur = new Date(cur.getTime() + 60000)
      }
      return out
    }
    const CRON_WEEK = ['日', '一', '二', '三', '四', '五', '六']
    const cronFmtRun = (d) =>
      d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' 周' + CRON_WEEK[d.getDay()]
    const cronFmtIn = (d) => {
      const mins = Math.max(0, Math.round((d.getTime() - Date.now()) / 60000))
      if (mins < 60) return mins + ' 分钟后'
      if (mins < 1440) return Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分后'
      return Math.floor(mins / 1440) + ' 天 ' + Math.floor((mins % 1440) / 60) + ' 时后'
    }
    const cronSummarize = (set, min, max, any) => {
      if (any) return '每个'
      const arr = [...set].sort((a, b) => a - b)
      if (arr.length > 12) return arr.slice(0, 12).join(',') + ' …（共 ' + arr.length + ' 个）'
      return arr.join(',')
    }
    const CRON_PRESETS = [
      ['* * * * *', '每分钟'],
      ['0 * * * *', '每小时整点'],
      ['0 0 * * *', '每天 00:00'],
      ['0 9 * * 1-5', '工作日 09:00'],
      ['30 2 * * *', '每天 02:30'],
      ['0 0 * * 1', '每周一 00:00'],
      ['0 0 1 * *', '每月 1 号'],
      ['*/5 * * * *', '每 5 分钟'],
    ]

    // ================= 子模式 txtdiff：文本对比 =================
    let lastRows = null
    let lastStats = null
    const expanded = {}
    const TD_MAX_LINES = 20000
    const TD_MAX_CHARS = 2 * 1024 * 1024
    const TD_LCS_CAP = 1500
    const tdNorm = (s, trimWs) => (trimWs ? String(s).replace(/^\s+|\s+$/g, '') : String(s))
    const tdDiff = (a, b, trimWs) => {
      let la = String(a || '').split('\n').map((s) => s.replace(/\r$/, ''))
      let lb = String(b || '').split('\n').map((s) => s.replace(/\r$/, ''))
      let truncA = false
      let truncB = false
      if (la.length > TD_MAX_LINES) { la = la.slice(0, TD_MAX_LINES); truncA = true }
      if (lb.length > TD_MAX_LINES) { lb = lb.slice(0, TD_MAX_LINES); truncB = true }
      const ka = la.map((s) => tdNorm(s, trimWs))
      const kb = lb.map((s) => tdNorm(s, trimWs))
      let pre = 0
      while (pre < ka.length && pre < kb.length && ka[pre] === kb[pre]) pre++
      let suf = 0
      while (suf < ka.length - pre && suf < kb.length - pre && ka[ka.length - 1 - suf] === kb[kb.length - 1 - suf]) suf++
      const rows = []
      for (let i = 0; i < pre; i++) rows.push({ t: ' ', la: i + 1, lb: i + 1, text: la[i] })
      const n = ka.length - pre - suf
      const m = kb.length - pre - suf
      let coarse = false
      if (n * m > TD_LCS_CAP * TD_LCS_CAP) {
        coarse = true
        for (let i = 0; i < n; i++) rows.push({ t: '-', la: pre + i + 1, lb: null, text: la[pre + i] })
        for (let j = 0; j < m; j++) rows.push({ t: '+', la: null, lb: pre + j + 1, text: lb[pre + j] })
      } else if (n > 0 && m > 0) {
        const W = m + 1
        const dp = new Uint32Array((n + 1) * W)
        for (let i = n - 1; i >= 0; i--) {
          const ra = ka[pre + i]
          const rowOff = i * W
          const nextOff = (i + 1) * W
          for (let j = m - 1; j >= 0; j--) {
            dp[rowOff + j] = ra === kb[pre + j] ? dp[nextOff + j + 1] + 1 : Math.max(dp[nextOff + j], dp[rowOff + j + 1])
          }
        }
        let i = 0
        let j = 0
        while (i < n && j < m) {
          if (ka[pre + i] === kb[pre + j]) { rows.push({ t: ' ', la: pre + i + 1, lb: pre + j + 1, text: la[pre + i] }); i++; j++ }
          else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { rows.push({ t: '-', la: pre + i + 1, lb: null, text: la[pre + i] }); i++ }
          else { rows.push({ t: '+', la: null, lb: pre + j + 1, text: lb[pre + j] }); j++ }
        }
        while (i < n) { rows.push({ t: '-', la: pre + i + 1, lb: null, text: la[pre + i] }); i++ }
        while (j < m) { rows.push({ t: '+', la: null, lb: pre + j + 1, text: lb[pre + j] }); j++ }
      } else {
        for (let i = 0; i < n; i++) rows.push({ t: '-', la: pre + i + 1, lb: null, text: la[pre + i] })
        for (let j = 0; j < m; j++) rows.push({ t: '+', la: null, lb: pre + j + 1, text: lb[pre + j] })
      }
      const baseA = pre + n
      const baseB = pre + m
      for (let s = 0; s < suf; s++) rows.push({ t: ' ', la: baseA + s + 1, lb: baseB + s + 1, text: la[baseA + s] })
      let add = 0, del = 0, same = 0
      for (const r of rows) { if (r.t === '+') add++; else if (r.t === '-') del++; else same++ }
      return { rows, stats: { add, del, same, coarse, truncA, truncB } }
    }
    const tdDisplay = (rows) => {
      const out = []
      let i = 0
      let seg = 0
      while (i < rows.length) {
        if (rows[i].t !== ' ') { out.push({ row: rows[i] }); i++; continue }
        let j = i
        while (j < rows.length && rows[j].t === ' ') j++
        const len = j - i
        const key = 'seg' + (seg++)
        if (len > 9 && !expanded[key]) {
          for (let k = 0; k < 3; k++) out.push({ row: rows[i + k] })
          out.push({ collapse: key, count: len - 6 })
          for (let k = j - 3; k < j; k++) out.push({ row: rows[k] })
        } else {
          for (let k = i; k < j; k++) out.push({ row: rows[k] })
        }
        i = j
      }
      return out
    }
    const TD_ROW_STYLE = { ' ': '', '+': 'background:var(--tb-done-bg,rgba(76,175,80,.09))', '-': 'background:var(--tb-danger-bg,rgba(217,95,95,.09))' }
    const TD_TXT_CLS = { ' ': '', '+': 'tb-tx-done', '-': 'tb-tx-danger' }

    // ================= 子模式 gen：生成器 =================
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
    const GEN_CHARSETS = [['alnum', '字母数字'], ['hex', 'hex'], ['b64url', 'base64url'], ['num', '纯数字'], ['easy', '易读（无 0O1lI）']]
    const GEN_ALGOS = [['md5', 'MD5'], ['sha1', 'SHA-1'], ['sha256', 'SHA-256'], ['sha512', 'SHA-512']]
    const GEN_NS = [1, 5, 10, 50]
    const GEN_KIND_LABEL = { uuid: 'UUID v4', rand: '随机串', hash: '哈希' }

    // ================= 主渲染：子模式芯片 + 各子面板 =================
    const SUBS = [
      ['codec', '编解码'], ['regex', '正则'], ['cron', 'Cron'],
      ['txtdiff', '文本对比'], ['gen', '生成器'],
    ]

    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-chips">' + SUBS.map(([v, label]) =>
        '<button type="button" class="tb-chip' + (st.sub === v ? ' tb-chip-on' : '') + '" data-action="sub" data-v="' + v + '">' + label + '</button>'
      ).join('') + '</div>')
      parts.push(renderSub(st) + '</div>')
      return parts.join('')
    }

    const renderSub = (st) => {
      if (st.sub === 'codec') return renderCodec(st.codec)
      if (st.sub === 'regex') return renderRegex(st.regex)
      if (st.sub === 'cron') return renderCron(st.cron)
      if (st.sub === 'txtdiff') return renderTxtdiff(st.txtdiff)
      if (st.sub === 'gen') return renderGen(st.gen)
      return '<div class="tb-notice">未知子模式</div>'
    }

    const renderCodec = (c) => {
      const parts = []
      parts.push('<div class="tb-chips">' + CODEC_MODES.map(([v, label]) =>
        '<button type="button" class="tb-chip' + (c.mode === v ? ' tb-chip-on' : '') + '" data-action="mode" data-m="' + v + '">' + label + '</button>'
      ).join('') + '</div>')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">输入</span>' +
        '<textarea class="tb-textarea" data-field="input" placeholder="在此输入待转换内容">' + esc(c.input || '') + '</textarea></div>')
      parts.push('<div class="tb-row"><button type="button" class="tb-btn tb-btn-primary" data-action="run">转换</button>' +
        (c.output ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy">复制输出</button><span class="tb-note">输出 ' + fmtSize(c.output.length) + '</span>' : '') + '</div>')
      if (c.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(c.error) + '</div>')
      if (c.output) parts.push('<pre class="tb-code">' + esc(c.output) + '</pre>')
      return parts.join('')
    }

    const renderRegex = (r) => {
      const mode = r.mode === 'replace' ? 'replace' : 'match'
      const m = mode === 'match' ? regexRun(r.pattern, r.flags || ['g'], r.text || '') : null
      const rp = mode === 'replace' ? regexReplace(r.pattern, r.flags || ['g'], r.text || '', r.replacement || '') : null
      const parts = []
      parts.push('<div class="tb-chips">' +
        '<button type="button" class="tb-chip' + (mode === 'match' ? ' tb-chip-on' : '') + '" data-action="mode" data-v="match">匹配</button>' +
        '<button type="button" class="tb-chip' + (mode === 'replace' ? ' tb-chip-on' : '') + '" data-action="mode" data-v="replace">替换</button>' +
      '</div>')
      parts.push('<div class="tb-query">' +
        '<input class="tb-input tb-mono" data-field="pattern" placeholder="正则表达式，如 (\\w+)@(\\w+\\.com)" value="' + esc(r.pattern || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="test">测试</button>' +
      '</div>')
      parts.push('<div class="tb-chips"><span class="tb-note">预设：</span>' + REGEX_PRESETS.map(([label, p]) =>
        '<button type="button" class="tb-chip" data-action="preset" data-p="' + esc(p) + '" title="' + esc(p) + '">' + esc(label) + '</button>'
      ).join('') + '</div>')
      parts.push('<div class="tb-chips">' + REGEX_FLAGS.map(([f, label]) =>
        '<button type="button" class="tb-chip' + ((r.flags || []).indexOf(f) >= 0 ? ' tb-chip-on' : '') + '" data-action="flag" data-f="' + f + '" title="' + label + '">' + f + '</button>'
      ).join('') + '<span class="tb-note">' + esc(REGEX_FLAGS.filter(([f]) => (r.flags || []).indexOf(f) >= 0).map(([, l]) => l).join(' · ')) + '</span></div>')
      if (mode === 'replace') {
        parts.push('<div class="tb-sec"><span class="tb-sec-label">替换为（支持 $1 分组 / $&amp; 全匹配 / $&lt;name&gt; 命名组）</span>' +
          '<input class="tb-input tb-mono" data-field="replacement" placeholder="如 [$2]$1 或 <空删除>" value="' + esc(r.replacement || '') + '" /></div>')
      }
      parts.push('<div class="tb-sec"><span class="tb-sec-label">测试文本</span>' +
        '<textarea class="tb-textarea" data-field="text" placeholder="在此粘贴待匹配的文本">' + esc(r.text || '') + '</textarea></div>')
      const err = m ? m.error : (rp ? rp.error : null)
      if (err) {
        parts.push('<div class="tb-banner tb-banner-error">正则无效：' + esc(err) + '</div>')
      } else if (r.pattern && mode === 'match' && m) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">匹配结果<span class="tb-count">' + m.matches.length + '</span></span>' +
          (m.truncated ? '<span class="tb-note">仅显示前 ' + REGEX_CAP + ' 条</span>' : '') + '</div>')
        if (m.matches.length === 0) {
          parts.push('<div class="tb-notice">无匹配</div>')
        } else {
          parts.push('<div class="tb-list">' + m.matches.map((mt, idx) => {
            const groups = (mt.groups || []).map((g, gi) =>
              '<div class="tb-line"><span class="tb-line-status">$' + (gi + 1) + '</span><span class="tb-line-path">' + esc(g == null ? '（未参与）' : g) + '</span></div>'
            ).join('')
            return '<div class="tb-card">' +
              '<div class="tb-card-head"><span class="tb-pill tb-pill-active">#' + (idx + 1) + '</span>' +
              '<span class="tb-note">位置 ' + mt.i + ' · 长度 ' + mt.text.length + '</span></div>' +
              '<pre class="tb-code">' + esc(mt.text || '（空匹配）') + '</pre>' +
              (groups ? '<div class="tb-sec"><span class="tb-sec-label">捕获分组</span>' + groups + '</div>' : '') +
            '</div>'
          }).join('') + '</div>')
        }
      } else if (r.pattern && mode === 'replace' && rp) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">替换结果<span class="tb-count">' + rp.count + ' 处</span></span>' +
          (rp.out ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-out">复制结果</button>' : '') + '</div>')
        parts.push('<pre class="tb-code" style="max-height:480px">' + esc(rp.out.length > 20000 ? rp.out.slice(0, 20000) + '\n…（仅显示前 20000 字符，共 ' + rp.out.length + '）' : rp.out) + '</pre>')
      }
      return parts.join('')
    }

    const renderCron = (c) => {
      const parsed = lastCronParsed
      const runs = lastCronRuns
      const parts = []
      parts.push('<div class="tb-sec"><span class="tb-sec-label">Cron 表达式（分 时 日 月 周）</span>' +
        '<input class="tb-input tb-mono" data-field="expr" placeholder="如 0 9 * * 1-5" value="' + esc(c.expr || '') + '" /></div>')
      parts.push('<div class="tb-chips">' + CRON_PRESETS.map((p) =>
        '<button type="button" class="tb-chip" data-action="preset" data-v="' + esc(p[0]) + '" title="点击填入">' + esc(p[1]) + '</button>'
      ).join('') + '</div>')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="calc">解析</button>' +
        '<span class="tb-note">标准 5 段；日/周同时受限时任一命中即运行（OR 语义）</span></div>')
      if (parsed && parsed.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(parsed.error) + '</div>')
      if (parsed && !parsed.error && runs) {
        parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">字段明细</span>' +
          parsed.fields.map((f, i) =>
            '<div class="tb-line"><span class="tb-line-status tb-tx-muted" style="width:auto;min-width:28px">' + esc(CRON_FIELDS[i].label) + '</span>' +
            '<span class="tb-line-path tb-mono">' + esc(cronSummarize(f.set, CRON_FIELDS[i].min, CRON_FIELDS[i].max, f.any)) + '</span></div>'
          ).join('') + '</div></div>')
        if (runs.length) {
          parts.push('<div class="tb-list-head"><span class="tb-list-title">未来 ' + runs.length + ' 次运行（本地时区）</span></div>')
          parts.push('<div class="tb-list">' + runs.map((d) =>
            '<div class="tb-rec"><div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-rec-key tb-mono">' + esc(cronFmtRun(d)) + '</span></div>' +
              '<div class="tb-rec-sub"><span>' + esc(cronFmtIn(d)) + '</span></div>' +
            '</div></div>'
          ).join('') + '</div>')
        } else {
          parts.push('<div class="tb-notice">未来 4 年内无运行时刻（检查日/月/周组合是否过窄）</div>')
        }
      }
      if (!parsed) parts.push('<div class="tb-notice">输入表达式或点预设芯片，解析后显示字段明细与未来运行时刻</div>')
      return parts.join('')
    }

    const renderTxtdiff = (t) => {
      const parts = []
      parts.push('<div class="tb-sec"><span class="tb-sec-label">左（原文）</span>' +
        '<textarea class="tb-textarea tb-mono" data-field="a" placeholder="粘贴原文" style="min-height:90px">' + esc(t.a || '') + '</textarea></div>')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">右（新文）</span>' +
        '<textarea class="tb-textarea tb-mono" data-field="b" placeholder="粘贴新文" style="min-height:90px">' + esc(t.b || '') + '</textarea></div>')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="compare">对比</button>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="swap" title="交换左右">⇄ 交换</button>' +
        '<button type="button" class="tb-chip' + (t.trimWs ? ' tb-chip-on' : '') + '" data-action="trim-ws" title="比较时忽略每行首尾空白">忽略首尾空白</button>' +
        (t.a || t.b ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空</button>' : '') +
      '</div>')
      if (t.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(t.notice) + '</div>')
      if (lastRows && lastStats) {
        const s = lastStats
        parts.push('<div class="tb-row">' +
          '<span class="tb-pill tb-pill-done">+' + s.add + '</span>' +
          '<span class="tb-pill tb-pill-other">−' + s.del + '</span>' +
          '<span class="tb-pill tb-pill-plain">相同 ' + s.same + '</span>' +
          (s.coarse ? '<span class="tb-note">差异段过大，已按整块增删展示（未做行级对齐）</span>' : '') +
          (s.truncA || s.truncB ? '<span class="tb-note">超出 20000 行上限，已截断' + (s.truncA && s.truncB ? '（双侧）' : s.truncA ? '（左）' : '（右）') + '</span>' : '') +
        '</div>')
        if (s.add === 0 && s.del === 0) parts.push('<div class="tb-notice">两侧文本完全一致' + (t.trimWs ? '（忽略首尾空白口径）' : '') + '</div>')
        const disp = tdDisplay(lastRows)
        parts.push('<div class="tb-list">' + disp.map((d) => {
          if (d.collapse) {
            return '<div class="tb-line" data-action="expand" data-k="' + d.collapse + '" title="点击展开" style="cursor:pointer;justify-content:center">' +
              '<span class="tb-note">⋯ ' + d.count + ' 行相同，点击展开 ⋯</span></div>'
          }
          const row = d.row
          return '<div class="tb-line" style="' + (TD_ROW_STYLE[row.t] || '') + ';font-family:ui-monospace,Consolas,monospace">' +
            '<span class="tb-note" style="min-width:38px;text-align:right;flex:none">' + (row.la == null ? '' : row.la) + '</span>' +
            '<span class="tb-note" style="min-width:38px;text-align:right;flex:none">' + (row.lb == null ? '' : row.lb) + '</span>' +
            '<span class="' + (TD_TXT_CLS[row.t] || '') + '" style="flex:none;width:14px">' + (row.t === ' ' ? '' : row.t) + '</span>' +
            '<span class="tb-line-path" style="white-space:pre-wrap;word-break:break-all">' + esc(row.text) + '</span>' +
          '</div>'
        }).join('') + '</div>')
      } else {
        parts.push('<div class="tb-notice">填入左右文本后点「对比」；结果在这里以统一视图展示（长相同段自动折叠）</div>')
      }
      return parts.join('')
    }

    const renderGen = (g) => {
      const parts = []
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">UUID v4</span>' +
        '<div class="tb-row">' + GEN_NS.map((n) =>
          '<button type="button" class="tb-chip' + (g.n === n ? ' tb-chip-on' : '') + '" data-action="uuid-n" data-v="' + n + '">' + n + ' 个</button>'
        ).join('') +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="uuid">生成</button></div></div></div>')
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">随机串（CSPRNG）</span>' +
        '<div class="tb-chips" style="margin-bottom:6px">' + GEN_CHARSETS.map(([v, label]) =>
          '<button type="button" class="tb-chip' + (g.charset === v ? ' tb-chip-on' : '') + '" data-action="charset" data-v="' + v + '">' + label + '</button>'
        ).join('') + '</div>' +
        '<div class="tb-row"><span class="tb-note">长度</span>' +
        '<input class="tb-input tb-mono" style="max-width:80px;height:24px" data-field="len" value="' + esc(g.len || '') + '" />' +
        '<span class="tb-note">条数</span>' +
        '<input class="tb-input tb-mono" style="max-width:64px;height:24px" data-field="randN" value="' + esc(g.randN || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="rand">生成</button></div></div></div>')
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">哈希摘要</span>' +
        '<div class="tb-chips" style="margin-bottom:6px">' + GEN_ALGOS.map(([v, label]) =>
          '<button type="button" class="tb-chip' + (g.algo === v ? ' tb-chip-on' : '') + '" data-action="algo" data-v="' + v + '">' + label + '</button>'
        ).join('') + '</div>' +
        '<textarea class="tb-textarea" data-field="text" placeholder="待计算哈希的文本" style="min-height:56px">' + esc(g.text || '') + '</textarea>' +
        '<div class="tb-row" style="margin-top:6px"><button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="hash">计算</button></div></div></div>')
      if (g.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(g.notice) + '</div>')
      const items = g.items || []
      if (items.length) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">' + esc(GEN_KIND_LABEL[g.itemsKind] || '结果') + '<span class="tb-count">' + items.length + '</span></span>' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-all">复制全部</button></div>')
        parts.push('<div class="tb-list">' + items.map((it, i) =>
          '<div class="tb-rec" data-action="copy-one" data-i="' + i + '" title="点击复制">' +
            '<div class="tb-rec-main"><div class="tb-rec-top"><span class="tb-rec-summary tb-mono" style="word-break:break-all">' + esc(it) + '</span></div></div>' +
          '</div>'
        ).join('') + '</div>')
      } else {
        parts.push('<div class="tb-notice">生成结果在这里，点条目复制单项</div>')
      }
      return parts.join('')
    }

    // ================= 主 handler：按 st.sub 分派到子状态，动作名保持原工具语义 =================
    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const el = fields && fields.__el ? fields.__el : {}
      const init = {
        sub: 'codec',
        codec: { mode: 'b64e', input: '', output: '', error: null },
        regex: { pattern: '', flags: ['g'], text: '', mode: 'match', replacement: '' },
        cron: { expr: '' },
        txtdiff: { a: '', b: '', trimWs: false, notice: null },
        gen: { n: 5, charset: 'alnum', len: '16', randN: '3', algo: 'sha256', text: '', items: [], itemsKind: '', notice: null },
      }
      const st = (state && typeof state === 'object' && state) ? state : init
      if (!st.codec || typeof st.codec !== 'object') st.codec = Object.assign({}, init.codec)
      if (!st.regex || typeof st.regex !== 'object') st.regex = Object.assign({}, init.regex)
      if (!st.cron || typeof st.cron !== 'object') st.cron = Object.assign({}, init.cron)
      if (!st.txtdiff || typeof st.txtdiff !== 'object') st.txtdiff = Object.assign({}, init.txtdiff)
      if (!st.gen || typeof st.gen !== 'object') st.gen = Object.assign({}, init.gen)

      // 子模式切换（动作名 sub）
      if (action === 'sub' && el.v && SUBS.some(([v]) => v === el.v)) {
        st.sub = String(el.v)
        return { ok: true, html: render(st), state: st }
      }

      // ---- 各子模式字段同步 + 动作 ----
      let copy = null
      if (st.sub === 'codec') {
        const c = st.codec
        if (typeof fields.input === 'string') c.input = fields.input
        if (action === 'mode' && el.m) c.mode = String(el.m)
        if ((action === 'run' || action === 'mode') && c.input) {
          try {
            const r = codecConvert(c.mode, c.input)
            c.output = r.out || ''
            c.error = r.error || null
          } catch (e) { c.output = ''; c.error = String((e && e.message) || e) }
        }
        if (action === 'copy' && c.output) copy = c.output
      } else if (st.sub === 'regex') {
        const r = st.regex
        if (typeof fields.pattern === 'string') r.pattern = fields.pattern
        if (typeof fields.text === 'string') r.text = fields.text
        if (typeof fields.replacement === 'string') r.replacement = fields.replacement
        if (action === 'mode' && el.v) r.mode = el.v === 'replace' ? 'replace' : 'match'
        else if (action === 'flag' && el.f) {
          const f = String(el.f)
          const cur = Array.isArray(r.flags) ? r.flags.slice() : ['g']
          const i = cur.indexOf(f)
          if (i >= 0) cur.splice(i, 1); else cur.push(f)
          r.flags = cur
        } else if (action === 'preset' && el.p) {
          r.pattern = String(el.p)
          const preset = REGEX_PRESETS.find(([, p]) => p === el.p)
          if (!r.text && preset && preset[2]) r.text = preset[2]
        }
        if (action === 'copy-out') {
          const rp = regexReplace(r.pattern, r.flags || ['g'], r.text || '', r.replacement || '')
          if (!rp.error) copy = rp.out
        }
      } else if (st.sub === 'cron') {
        const c = st.cron
        if (typeof fields.expr === 'string') c.expr = fields.expr
        if (action === 'preset' && el.v) c.expr = String(el.v)
        if (action === 'calc' || action === 'preset' || (action === '' && c.expr)) {
          if (!c.expr.trim()) {
            lastCronParsed = { error: '请输入 cron 表达式' }
            lastCronRuns = null
          } else {
            lastCronParsed = cronParse(c.expr)
            if (!lastCronParsed.error) lastCronRuns = cronNextRuns(lastCronParsed.fields, 8)
            else lastCronRuns = null
          }
        }
      } else if (st.sub === 'txtdiff') {
        const t = st.txtdiff
        if (typeof fields.a === 'string') t.a = fields.a
        if (typeof fields.b === 'string') t.b = fields.b
        t.notice = null
        if (action === 'compare') {
          for (const k of Object.keys(expanded)) delete expanded[k]
          if (t.a.length > TD_MAX_CHARS) { t.a = t.a.slice(0, TD_MAX_CHARS); t.notice = '左侧文本超 2MB，已截断' }
          if (t.b.length > TD_MAX_CHARS) { t.b = t.b.slice(0, TD_MAX_CHARS); t.notice = (t.notice ? t.notice + '；' : '') + '右侧文本超 2MB，已截断' }
          const r = tdDiff(t.a, t.b, t.trimWs)
          lastRows = r.rows
          lastStats = r.stats
        } else if (action === 'swap') {
          const tmp = t.a; t.a = t.b; t.b = tmp
          if (lastRows) { const r = tdDiff(t.a, t.b, t.trimWs); lastRows = r.rows; lastStats = r.stats }
        } else if (action === 'trim-ws') {
          t.trimWs = !t.trimWs
          if (lastRows) {
            for (const k of Object.keys(expanded)) delete expanded[k]
            const r = tdDiff(t.a, t.b, t.trimWs)
            lastRows = r.rows
            lastStats = r.stats
          }
        } else if (action === 'expand' && el.k) {
          expanded[String(el.k)] = true
        } else if (action === 'clear') {
          t.a = ''; t.b = ''
          lastRows = null; lastStats = null
          for (const k of Object.keys(expanded)) delete expanded[k]
        }
      } else if (st.sub === 'gen') {
        const g = st.gen
        if (!Array.isArray(g.items)) g.items = []
        if (typeof fields.len === 'string') g.len = fields.len
        if (typeof fields.randN === 'string') g.randN = fields.randN
        if (typeof fields.text === 'string') g.text = fields.text
        g.notice = null
        const doGen = async (spec, kind) => {
          const r = await runGen(spec, ws.root)
          if (!r || r.ok === false) { g.notice = '生成失败: ' + ((r && r.error) || '(无响应)'); return }
          g.items = r.items || []
          g.itemsKind = kind
        }
        if (action === 'uuid-n' && el.v) g.n = Number(el.v) || 5
        else if (action === 'charset' && el.v) g.charset = String(el.v)
        else if (action === 'algo' && el.v) g.algo = String(el.v)
        else if (action === 'uuid') await doGen({ kind: 'uuid', n: g.n }, 'uuid')
        else if (action === 'rand') await doGen({ kind: 'rand', charset: g.charset, len: g.len, n: g.randN }, 'rand')
        else if (action === 'hash') await doGen({ kind: 'hash', algo: g.algo, text: g.text }, 'hash')
        if (action === 'copy-one' && el.i != null) {
          const it = g.items[Number(el.i)]
          if (typeof it === 'string') copy = it
        } else if (action === 'copy-all' && g.items.length) {
          copy = g.items.join('\n')
        }
      }

      const out = { ok: true, html: render(st), state: st }
      if (copy != null) out.copy = copy
      return out
    }

    tryRegisterTool(ctx, { id: 'calc', label: '计算', order: 8 }, handler)
  },
}