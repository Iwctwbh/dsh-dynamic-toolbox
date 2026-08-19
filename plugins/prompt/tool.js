// ===== prompt-tool.js：系统提示词装配查看（Host-only）=====
// systemPrompt.assemble({}) 全局装配（无会话上下文）：sections / contexts / tools /
// variables 四块，点击任意条目展开完整文本。
// 状态：{ open }（open 形如 'sec:0' / 'ctx:0' / 'vars'；文本每次重取，不进 state）

return {
  name: 'prompt-tool',
  inject: ['fs', 'systemPrompt', 'timer'],
  apply(ctx) {
    const sp = ctx.get('systemPrompt')

    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const CAP = 60000

    // 装配结果 TTL 缓存：连续展开/收起点击（1.5s 窗口内）不再重复全量 assemble；
    // 点「刷新」强制重取。装配是全局无会话的，无需按会话分键。
    let asmCache = null // { at, asm }
    const getAsm = async (force) => {
      const now = Date.now()
      if (!force && asmCache && now - asmCache.at < 1500) return asmCache.asm
      const asm = await sp.assemble({})
      asmCache = { at: now, asm }
      return asm
    }

    const renderList = (title, items, prefix, open) => {
      if (!items.length) return ''
      return '<div class="tb-list-head"><span class="tb-list-title">' + title + '<span class="tb-count">' + items.length + '</span></span></div>' +
        '<div class="tb-list">' + items.map((it, i) => {
          const key = prefix + ':' + i
          return '<div class="tb-rec' + (open === key ? ' tb-rec-active' : '') + '" data-action="open" data-k="' + key + '">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-rec-key">' + esc(it.name) + '</span>' +
              '<span class="tb-rec-summary">' + esc(oneLine(it.text, 80)) + '</span></div>' +
              '<div class="tb-rec-sub"><span>' + fmtSize((it.text || '').length) + '</span></div>' +
            '</div>' +
          '</div>'
        }).join('') + '</div>'
    }

    const handler = async ({ action, fields, state }) => {
      if (!sp) return { ok: false, error: 'systemPrompt 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { open: null }
      const el = fields && fields.__el ? fields.__el : {}
      if (action === 'open' && el.k) st.open = st.open === String(el.k) ? null : String(el.k)
      else if (action === 'close') st.open = null

      try {
        const asm = await getAsm(action === 'refresh')
        const sections = asm.sections || []
        const contexts = asm.contexts || []
        const tools = asm.tools || []
        const variables = asm.variables || {}
        const totalChars = sections.concat(contexts).reduce((n, s) => n + ((s.text || '').length), 0)

        const parts = []
        parts.push('<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">')
        parts.push('<div class="tb-banner tb-banner-info">全局装配（无会话上下文）：会话级 section / 变量可能不在其中；结果缓存 1.5s，点「刷新」强制重取 ' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="refresh">刷新</button></div>')
        parts.push('<div class="tb-stats">' +
          '<div class="tb-stat"><span class="tb-stat-num">' + sections.length + '</span><span class="tb-stat-label">提示词节</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + contexts.length + '</span><span class="tb-stat-label">上下文块</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + tools.length + '</span><span class="tb-stat-label">工具 schema</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + fmtSize(totalChars) + '</span><span class="tb-stat-label">总字符</span></div>' +
        '</div>')

        // 体积占比：最大的 6 个 section/context 各占总量多少（找提示词臃肿点）
        const sized = sections.map((s) => ({ name: s.name, size: (s.text || '').length }))
          .concat(contexts.map((c) => ({ name: c.name + '（ctx）', size: (c.text || '').length })))
          .sort((a, b) => b.size - a.size)
          .slice(0, 6)
        if (totalChars > 0 && sized.length > 1) {
          parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">体积占比 Top ' + sized.length + '</span>' +
            sized.map((s) => {
              const pct = Math.round((s.size / totalChars) * 100)
              return '<div class="tb-row" style="flex-wrap:nowrap" title="' + esc(s.name) + ' · ' + fmtSize(s.size) + '（' + pct + '%）">' +
                '<span class="tb-num" style="min-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name) + '</span>' +
                '<div style="flex:1;height:8px;border-radius:4px;background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33));overflow:hidden">' +
                  '<div style="height:100%;width:' + Math.max(2, pct) + '%;background:var(--tb-accent,#3f6fd9);border-radius:4px"></div>' +
                '</div>' +
                '<span class="tb-num" style="min-width:76px;text-align:right">' + fmtSize(s.size) + ' · ' + pct + '%</span>' +
              '</div>'
            }).join('') + '</div></div>')
        }

        // 详情卡
        if (st.open) {
          const m = /^(\w+):(\d+)$/.exec(st.open)
          let text = null, title = ''
          if (m && m[1] === 'sec' && sections[Number(m[2])]) { text = sections[Number(m[2])].text; title = sections[Number(m[2])].name }
          if (m && m[1] === 'ctx' && contexts[Number(m[2])]) { text = contexts[Number(m[2])].text; title = contexts[Number(m[2])].name }
          if (st.open === 'vars') {
            title = 'variables'
            text = Object.keys(variables).map((k) => k + ' = ' + (variables[k] == null ? '（未设置）' : variables[k])).join('\n')
          }
          if (text != null) {
            parts.push('<div class="tb-preview"><div class="tb-preview-head">' +
              '<span class="tb-preview-name">' + esc(title) + '</span>' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close">关闭</button></div>' +
              '<pre class="tb-code">' + esc(text.length > CAP ? text.slice(0, CAP) + '\n…（截断，共 ' + text.length + ' 字符）' : text) + '</pre></div>')
          }
        }

        parts.push('</div>') // .tb-pane-head 结束
        parts.push('<div class="tb-pane-body tb-pane-col">')
        parts.push(renderList('提示词节（sections）', sections, 'sec', st.open))
        parts.push(renderList('上下文块（contexts）', contexts, 'ctx', st.open))
        const varCount = Object.keys(variables).length
        if (varCount) {
          parts.push('<div class="tb-list-head"><span class="tb-list-title">变量（variables）<span class="tb-count">' + varCount + '</span></span></div>' +
            '<div class="tb-list"><div class="tb-rec' + (st.open === 'vars' ? ' tb-rec-active' : '') + '" data-action="open" data-k="vars">' +
            '<div class="tb-rec-main"><div class="tb-rec-top"><span class="tb-rec-key">variables</span>' +
            '<span class="tb-rec-summary">' + esc(oneLine(Object.keys(variables).join(', '), 80)) + '</span></div></div></div></div>')
        }
        parts.push('<div class="tb-note">工具 schema 清单见「工具」Tab</div>')
        parts.push('</div></div>') // .tb-pane-body + .tb-pane 结束
        return { ok: true, html: parts.join(''), state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'prompt', label: '提示词', order: 9, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 6.5h6M5 9h4"/></svg>' }, handler)
  },
}
