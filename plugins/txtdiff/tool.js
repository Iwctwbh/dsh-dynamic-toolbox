// ===== txtdiff-tool.js：文本对比（Host-only，纯 JS 行级 LCS diff）=====
// 粘贴左右文本 → 统一视图：双列行号 + 新增/删除/相同行；长相同段折叠（点击展开）；
// 选项：忽略行首尾空白。单边超 20000 行 / 2MB 截断；中段超 1500×1500 时 LCS 降级为整块增删。
// diff 行留闭包（行数多时不进 state——state 每次动作来回传输）。
// 状态：{ a, b, trimWs }

return {
  name: 'txtdiff-tool',
  inject: ['timer'],
  apply(ctx) {
    let lastRows = null // [{ t:' '|'+'|'-', la, lb, text }]（闭包持有）
    let lastStats = null // { add, del, same, coarse }
    const expanded = {} // 折叠段 key → true

    const MAX_LINES = 20000
    const MAX_CHARS = 2 * 1024 * 1024
    const LCS_CAP = 1500 // 中段 LCS 矩阵上限（1500×1500）

    const norm = (s, trimWs) => (trimWs ? String(s).replace(/^\s+|\s+$/g, '') : String(s))

    // 行级 LCS diff：先削公共前后缀，中段 DP 求 LCS 后回溯
    const diffLines = (a, b, trimWs) => {
      let la = String(a || '').split('\n').map((s) => s.replace(/\r$/, ''))
      let lb = String(b || '').split('\n').map((s) => s.replace(/\r$/, ''))
      let truncA = false
      let truncB = false
      if (la.length > MAX_LINES) { la = la.slice(0, MAX_LINES); truncA = true }
      if (lb.length > MAX_LINES) { lb = lb.slice(0, MAX_LINES); truncB = true }
      const ka = la.map((s) => norm(s, trimWs))
      const kb = lb.map((s) => norm(s, trimWs))
      let pre = 0
      while (pre < ka.length && pre < kb.length && ka[pre] === kb[pre]) pre++
      let suf = 0
      while (suf < ka.length - pre && suf < kb.length - pre && ka[ka.length - 1 - suf] === kb[kb.length - 1 - suf]) suf++
      const rows = []
      for (let i = 0; i < pre; i++) rows.push({ t: ' ', la: i + 1, lb: i + 1, text: la[i] })
      const n = ka.length - pre - suf
      const m = kb.length - pre - suf
      let coarse = false
      if (n * m > LCS_CAP * LCS_CAP) {
        coarse = true // 过大不做 LCS：整块删 + 整块增
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
      let add = 0
      let del = 0
      let same = 0
      for (const r of rows) { if (r.t === '+') add++; else if (r.t === '-') del++; else same++ }
      return { rows, stats: { add, del, same, coarse, truncA, truncB } }
    }

    // 折叠长相同段（>9 行：头 3 + 折叠钮 + 尾 3），折叠段可点击展开
    const buildDisplay = (rows) => {
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

    const ROW_STYLE = {
      ' ': '',
      '+': 'background:var(--tb-done-bg,rgba(76,175,80,.09))',
      '-': 'background:var(--tb-danger-bg,rgba(217,95,95,.09))',
    }
    const TXT_CLS = { ' ': '', '+': 'tb-tx-done', '-': 'tb-tx-danger' }

    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">左（原文）</span>' +
        '<textarea class="tb-textarea tb-mono" data-field="a" placeholder="粘贴原文" style="min-height:90px">' + esc(st.a || '') + '</textarea></div>')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">右（新文）</span>' +
        '<textarea class="tb-textarea tb-mono" data-field="b" placeholder="粘贴新文" style="min-height:90px">' + esc(st.b || '') + '</textarea></div>')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="compare">对比</button>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="swap" title="交换左右">⇄ 交换</button>' +
        '<button type="button" class="tb-chip' + (st.trimWs ? ' tb-chip-on' : '') + '" data-action="trim-ws" title="比较时忽略每行首尾空白">忽略首尾空白</button>' +
        (st.a || st.b ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空</button>' : '') +
      '</div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      parts.push('</div>')

      parts.push('<div class="tb-pane-body tb-pane-col">')
      if (lastRows && lastStats) {
        const s = lastStats
        parts.push('<div class="tb-row">' +
          '<span class="tb-pill tb-pill-done">+' + s.add + '</span>' +
          '<span class="tb-pill tb-pill-other">−' + s.del + '</span>' +
          '<span class="tb-pill tb-pill-plain">相同 ' + s.same + '</span>' +
          (s.coarse ? '<span class="tb-note">差异段过大，已按整块增删展示（未做行级对齐）</span>' : '') +
          (s.truncA || s.truncB ? '<span class="tb-note">超出 20000 行上限，已截断' + (s.truncA && s.truncB ? '（双侧）' : s.truncA ? '（左）' : '（右）') + '</span>' : '') +
        '</div>')
        if (s.add === 0 && s.del === 0) {
          parts.push('<div class="tb-notice">两侧文本完全一致' + (st.trimWs ? '（忽略首尾空白口径）' : '') + '</div>')
        }
        const disp = buildDisplay(lastRows)
        parts.push('<div class="tb-list">' + disp.map((d) => {
          if (d.collapse) {
            return '<div class="tb-line" data-action="expand" data-k="' + d.collapse + '" title="点击展开" style="cursor:pointer;justify-content:center">' +
              '<span class="tb-note">⋯ ' + d.count + ' 行相同，点击展开 ⋯</span></div>'
          }
          const r = d.row
          return '<div class="tb-line" style="' + (ROW_STYLE[r.t] || '') + ';font-family:ui-monospace,Consolas,monospace">' +
            '<span class="tb-note" style="min-width:38px;text-align:right;flex:none">' + (r.la == null ? '' : r.la) + '</span>' +
            '<span class="tb-note" style="min-width:38px;text-align:right;flex:none">' + (r.lb == null ? '' : r.lb) + '</span>' +
            '<span class="' + (TXT_CLS[r.t] || '') + '" style="flex:none;width:14px">' + (r.t === ' ' ? '' : r.t) + '</span>' +
            '<span class="tb-line-path" style="white-space:pre-wrap;word-break:break-all">' + esc(r.text) + '</span>' +
          '</div>'
        }).join('') + '</div>')
      } else {
        parts.push('<div class="tb-notice">填入左右文本后点「对比」；结果在这里以统一视图展示（长相同段自动折叠）</div>')
      }
      parts.push('</div></div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state }) => {
      const st = (state && typeof state === 'object' && state) ? state : { a: '', b: '', trimWs: false, notice: null }
      if (typeof fields.a === 'string') st.a = fields.a
      if (typeof fields.b === 'string') st.b = fields.b
      const el = fields && fields.__el ? fields.__el : {}
      st.notice = null

      if (action === 'compare') {
        for (const k of Object.keys(expanded)) delete expanded[k]
        if (st.a.length > MAX_CHARS) { st.a = st.a.slice(0, MAX_CHARS); st.notice = '左侧文本超 2MB，已截断' }
        if (st.b.length > MAX_CHARS) { st.b = st.b.slice(0, MAX_CHARS); st.notice = (st.notice ? st.notice + '；' : '') + '右侧文本超 2MB，已截断' }
        const r = diffLines(st.a, st.b, st.trimWs)
        lastRows = r.rows
        lastStats = r.stats
      } else if (action === 'swap') {
        const t = st.a; st.a = st.b; st.b = t
        if (lastRows) { // 已有结果：立即按交换后重算，观感与输入一致
          const r = diffLines(st.a, st.b, st.trimWs)
          lastRows = r.rows
          lastStats = r.stats
        }
      } else if (action === 'trim-ws') {
        st.trimWs = !st.trimWs
        if (lastRows) {
          for (const k of Object.keys(expanded)) delete expanded[k]
          const r = diffLines(st.a, st.b, st.trimWs)
          lastRows = r.rows
          lastStats = r.stats
        }
      } else if (action === 'expand' && el.k) {
        expanded[String(el.k)] = true
      } else if (action === 'clear') {
        st.a = ''; st.b = ''
        lastRows = null; lastStats = null
        for (const k of Object.keys(expanded)) delete expanded[k]
      }
      return { ok: true, html: render(st), state: st }
    }

    tryRegisterTool(ctx, { id: 'txtdiff', label: '文本对比', order: 22 }, handler)
  },
}
