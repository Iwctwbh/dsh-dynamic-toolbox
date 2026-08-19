// ===== tools-tool.js：当前可用工具清单（Host-only）=====
// 模型视角的「可调用方式」：tools.schemas() 注册表 → 空则退回 systemPrompt.assemble().tools。
// 搜索过滤；点击条目展开完整 description + parameters JSON schema。
// 状态：{ q, open }（schema 每次重取，不进 state）

return {
  name: 'tools-tool',
  inject: ['fs', 'tools', 'systemPrompt', 'timer'],
  apply(ctx) {
    const toolsSvc = ctx.get('tools')
    const sp = ctx.get('systemPrompt')

    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const CAP = 20000

    const gather = async () => {
      if (toolsSvc) {
        try {
          const list = toolsSvc.schemas()
          if (list && list.length) return { list, source: '工具注册表（tools.schemas）' }
        } catch (e) {}
      }
      if (sp) {
        const asm = await sp.assemble({})
        if (asm && asm.tools && asm.tools.length) return { list: asm.tools, source: '提示词装配（systemPrompt.assemble）' }
      }
      return { list: [], source: '' }
    }

    const handler = async ({ action, fields, state }) => {
      const st = (state && typeof state === 'object' && state) ? state : { q: '', open: null }
      const el = fields && fields.__el ? fields.__el : {}
      if (typeof fields.q === 'string') st.q = fields.q
      if (action === 'open' && el.name) st.open = st.open === String(el.name) ? null : String(el.name)
      else if (action === 'close') st.open = null

      try {
        const { list, source } = await gather()
        const q = (st.q || '').trim().toLowerCase()
        const shown = q ? list.filter((t) => (t.name || '').toLowerCase().indexOf(q) >= 0 || String(t.description || '').toLowerCase().indexOf(q) >= 0) : list

        const parts = []
        parts.push('<div class="jr-tabpanel tb-root">')
        parts.push('<div class="tb-query">' +
          '<input class="tb-input" data-field="q" placeholder="按名称 / 描述过滤" value="' + esc(st.q || '') + '" />' +
          '<button type="button" class="tb-btn tb-btn-primary" data-action="search">搜索</button>' +
        '</div>')
        parts.push('<div class="tb-list-head"><span class="tb-list-title">可用工具<span class="tb-count">' + shown.length + '</span></span>' +
          (source ? '<span class="tb-note">来源：' + esc(source) + '</span>' : '') + '</div>')
        if (!list.length) {
          parts.push('<div class="tb-notice">未取到工具 schema（注册表与装配均为空）</div>')
        } else {
          // 展开详情
          if (st.open) {
            const t = list.find((x) => x.name === st.open)
            if (t) {
              let params = ''
              try { params = JSON.stringify(t.parameters || {}, null, 2) } catch (e) { params = String(t.parameters) }
              parts.push('<div class="tb-preview"><div class="tb-preview-head">' +
                '<span class="tb-preview-name">' + esc(t.name) + '</span>' +
                '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close">关闭</button></div>' +
                '<div class="tb-sec"><span class="tb-sec-label">描述</span><div style="font-size:12px;white-space:pre-wrap;word-break:break-word">' + esc(t.description || '（无）') + '</div></div>' +
                '<div class="tb-sec"><span class="tb-sec-label">参数 schema</span><pre class="tb-code">' +
                esc(params.length > CAP ? params.slice(0, CAP) + '\n…（截断）' : params) + '</pre></div></div>')
            }
          }
          parts.push('<div class="tb-list">' + shown.map((t) =>
            '<div class="tb-rec' + (st.open === t.name ? ' tb-rec-active' : '') + '" data-action="open" data-name="' + esc(t.name) + '">' +
              '<div class="tb-rec-main">' +
                '<div class="tb-rec-top"><span class="tb-rec-key">' + esc(t.name) + '</span>' +
                '<span class="tb-rec-summary">' + esc(oneLine(t.description, 90)) + '</span></div>' +
              '</div>' +
            '</div>'
          ).join('') + '</div>')
        }
        parts.push('</div>')
        return { ok: true, html: parts.join(''), state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'tools', label: '工具', order: 12, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>' }, handler)
  },
}
