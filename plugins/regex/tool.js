// ===== regex-tool.js：正则表达式测试工具（Host-only，纯 JS即时匹配）=====
// 匹配模式：pattern + flags 芯片 + 测试文本 → 匹配列表（位置/匹配文本/捕获分组）。
// 替换模式：replacement 输入（$1/$&/$<name> 全语义）→ 替换结果 + 计数 + 一键复制。
// 状态：{ pattern, flags[], text, mode, replacement }（匹配/替换结果每次重算，不进 state）

return {
  name: 'regex-tool',
  inject: ['fs', 'timer'],
  apply(ctx) {
    const FLAGS = [['g', '全局'], ['i', '忽略大小写'], ['m', '多行'], ['s', '点跨行'], ['u', 'Unicode']]
    const CAP = 200
    // 常用预设：点芯片填入 pattern（测试文本为空时顺带填示例）
    const PRESETS = [
      ['邮箱', '[\\w.-]+@[\\w-]+(\\.[\\w-]+)+', '联系 a.b-c@example.com 或 x@sub.domain.org'],
      ['手机号', '1[3-9]\\d{9}', '拨打 13812345678 或 19900001111'],
      ['URL', 'https?://[^\\s"\'<>]+', '见 https://example.com/a?b=1 和 http://x.org'],
      ['日期', '\\d{4}-\\d{2}-\\d{2}', '从 2026-08-16 到 2026-09-01'],
      ['UUID', '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', 'id: 2b9fbdc9-397f-43e4-921a-a46097560876'],
      ['中文段', '[\\u4e00-\\u9fa5]+', '混合 English 与 中文连续 段落'],
      ['IPv4', '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', '127.0.0.1 与 10.0.0.256'],
    ]

    const runRegex = (pattern, flags, text) => {
      if (!pattern) return { matches: [], error: null, truncated: false }
      let re
      try {
        re = new RegExp(pattern, flags.join(''))
      } catch (e) {
        return { matches: [], error: String(e.message || e), truncated: false }
      }
      const matches = []
      let truncated = false
      if (re.global) {
        let m
        while ((m = re.exec(text)) !== null) {
          if (matches.length >= CAP) { truncated = true; break }
          matches.push({ i: m.index, text: m[0], groups: m.slice(1) })
          if (m[0] === '') re.lastIndex++
        }
      } else {
        const m = re.exec(text)
        if (m) matches.push({ i: m.index, text: m[0], groups: m.slice(1) })
      }
      return { matches, error: null, truncated }
    }

    // 替换：完全遵循 JS replace 语义（$1 分组 / $& 全匹配 / $<name> 命名组）；计数单独算（100000 上限防爆）
    const runReplace = (pattern, flags, text, replacement) => {
      if (!pattern) return { out: '', count: 0, error: null }
      let re
      try {
        re = new RegExp(pattern, flags.join(''))
      } catch (e) {
        return { out: '', count: 0, error: String(e.message || e) }
      }
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
        count = re.test(text) ? 1 : 0 // 无 g 时 replace 只换第一处，计数口径保持一致
      }
      let out = ''
      try { out = text.replace(re, replacement) } catch (e) { return { out: '', count, error: String(e.message || e) } }
      return { out, count, error: null }
    }

    const render = (st) => {
      const mode = st.mode === 'replace' ? 'replace' : 'match'
      const r = mode === 'match' ? runRegex(st.pattern, st.flags || ['g'], st.text || '') : null
      const rp = mode === 'replace' ? runReplace(st.pattern, st.flags || ['g'], st.text || '', st.replacement || '') : null
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-chips">' +
        '<button type="button" class="tb-chip' + (mode === 'match' ? ' tb-chip-on' : '') + '" data-action="mode" data-v="match">匹配</button>' +
        '<button type="button" class="tb-chip' + (mode === 'replace' ? ' tb-chip-on' : '') + '" data-action="mode" data-v="replace">替换</button>' +
      '</div>')
      parts.push('<div class="tb-query">' +
        '<input class="tb-input tb-mono" data-field="pattern" placeholder="正则表达式，如 (\\w+)@(\\w+\\.com)" value="' + esc(st.pattern || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="test">测试</button>' +
      '</div>')
      parts.push('<div class="tb-chips"><span class="tb-note">预设：</span>' + PRESETS.map(([label, p]) =>
        '<button type="button" class="tb-chip" data-action="preset" data-p="' + esc(p) + '" title="' + esc(p) + '">' + esc(label) + '</button>'
      ).join('') + '</div>')
      parts.push('<div class="tb-chips">' + FLAGS.map(([f, label]) =>
        '<button type="button" class="tb-chip' + ((st.flags || []).indexOf(f) >= 0 ? ' tb-chip-on' : '') + '" data-action="flag" data-f="' + f + '" title="' + label + '">' + f + '</button>'
      ).join('') + '<span class="tb-note">' + esc(FLAGS.filter(([f]) => (st.flags || []).indexOf(f) >= 0).map(([, l]) => l).join(' · ')) + '</span></div>')
      if (mode === 'replace') {
        parts.push('<div class="tb-sec"><span class="tb-sec-label">替换为（支持 $1 分组 / $&amp; 全匹配 / $&lt;name&gt; 命名组）</span>' +
          '<input class="tb-input tb-mono" data-field="replacement" placeholder="如 [$2]$1 或 <空删除>" value="' + esc(st.replacement || '') + '" /></div>')
      }
      parts.push('<div class="tb-sec"><span class="tb-sec-label">测试文本</span>' +
        '<textarea class="tb-textarea" data-field="text" placeholder="在此粘贴待匹配的文本">' + esc(st.text || '') + '</textarea></div>')
      const err = r ? r.error : rp.error
      if (err) {
        parts.push('<div class="tb-banner tb-banner-error">正则无效：' + esc(err) + '</div>')
      } else if (st.pattern && mode === 'match' && r) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">匹配结果<span class="tb-count">' + r.matches.length + '</span></span>' +
          (r.truncated ? '<span class="tb-note">仅显示前 ' + CAP + ' 条</span>' : '') + '</div>')
        if (r.matches.length === 0) {
          parts.push('<div class="tb-notice">无匹配</div>')
        } else {
          parts.push('<div class="tb-list">' + r.matches.map((m, idx) => {
            const groups = (m.groups || []).map((g, gi) =>
              '<div class="tb-line"><span class="tb-line-status">$' + (gi + 1) + '</span><span class="tb-line-path">' + esc(g == null ? '（未参与）' : g) + '</span></div>'
            ).join('')
            return '<div class="tb-card">' +
              '<div class="tb-card-head"><span class="tb-pill tb-pill-active">#' + (idx + 1) + '</span>' +
              '<span class="tb-note">位置 ' + m.i + ' · 长度 ' + m.text.length + '</span></div>' +
              '<pre class="tb-code">' + esc(m.text || '（空匹配）') + '</pre>' +
              (groups ? '<div class="tb-sec"><span class="tb-sec-label">捕获分组</span>' + groups + '</div>' : '') +
            '</div>'
          }).join('') + '</div>')
        }
      } else if (st.pattern && mode === 'replace' && rp) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">替换结果<span class="tb-count">' + rp.count + ' 处</span></span>' +
          (rp.out ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-out">复制结果</button>' : '') + '</div>')
        parts.push('<pre class="tb-code" style="max-height:480px">' + esc(rp.out.length > 20000 ? rp.out.slice(0, 20000) + '\n…（仅显示前 20000 字符，共 ' + rp.out.length + '）' : rp.out) + '</pre>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state }) => {
      const st = (state && typeof state === 'object' && state) ? state : { pattern: '', flags: ['g'], text: '', mode: 'match', replacement: '' }
      const el = fields && fields.__el ? fields.__el : {}
      if (typeof fields.pattern === 'string') st.pattern = fields.pattern
      if (typeof fields.text === 'string') st.text = fields.text
      if (typeof fields.replacement === 'string') st.replacement = fields.replacement
      if (action === 'mode' && el.v) st.mode = el.v === 'replace' ? 'replace' : 'match'
      else if (action === 'flag' && el.f) {
        const f = String(el.f)
        const cur = Array.isArray(st.flags) ? st.flags.slice() : ['g']
        const i = cur.indexOf(f)
        if (i >= 0) cur.splice(i, 1); else cur.push(f)
        st.flags = cur
      } else if (action === 'preset' && el.p) {
        st.pattern = String(el.p)
        const preset = PRESETS.find(([, p]) => p === el.p)
        if (!st.text && preset && preset[2]) st.text = preset[2]
      }
      const out = { ok: true, html: render(st), state: st }
      if (action === 'copy-out') {
        const rp = runReplace(st.pattern, st.flags || ['g'], st.text || '', st.replacement || '')
        if (!rp.error) out.copy = rp.out
      }
      return out
    }

    tryRegisterTool(ctx, { id: 'regex', label: '正则', order: 6 }, handler)
  },
}
