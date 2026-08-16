// ===== context-tool.js：当前上下文窗口查看（Host-only）=====
// sessionQuery.readSurface(当前会话) → 模型当前可见的 surface 消息（压缩后的真实上下文），
// tokenMeter.estimateMessage 逐条估算 token。点击条目展开完整内容。
// 状态：{ open }（open = seq；文本每次重取，不进 state）

return {
  name: 'context-tool',
  inject: ['fs', 'sessionQuery', 'tokenMeter', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')
    const meter = ctx.get('tokenMeter')

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && (b.type === 'text' || b.type === 'reasoning') ? b.text : '')).filter(Boolean).join('\n')
    }
    const fmtTok = (n) => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n)
    const CAP = 12000

    // 面板级缓存：surface 不变（capturedThroughSeq + 条数相同）时不重估 token、不重建行模型
    // （此前每点一次「展开」都会全量 readSurface + 逐条 estimateMessage）
    let modelCache = null // { sid, through, count, rows, totalTok }
    const getModel = async (sid) => {
      const snap = await sq.readSurface(sid)
      const events = snap.events || []
      const through = snap.capturedThroughSeq == null ? 0 : snap.capturedThroughSeq
      if (modelCache && modelCache.sid === sid && modelCache.through === through && modelCache.count === events.length) {
        return modelCache
      }
      const rows = []
      let totalTok = 0
      for (const ev of events) {
        const d = ev.data || {}
        const msg = ev.type === 'user/message' ? d : d.message
        const text = textOf(msg && msg.content)
        let tok = null
        if (meter && msg) { try { tok = meter.estimateMessage(msg) } catch (e) {} }
        if (tok) totalTok += tok
        const role = ev.type === 'user/message' ? (msg.source && msg.source.kind === 'user' ? 'user' : 'inject')
          : ev.type === 'assistant/message' ? 'ai' : 'tool'
        rows.push({ seq: ev.seq, time: ev.time, role, text, tok, name: ev.type === 'tool/result' ? '工具结果' : '' })
      }
      modelCache = { sid, through, count: events.length, rows, totalTok }
      return modelCache
    }

    const handler = async ({ action, fields, state, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { open: null }
      const el = fields && fields.__el ? fields.__el : {}
      if (action === 'open' && el.seq) { const n = Number(el.seq); st.open = st.open === n ? null : n }
      else if (action === 'close') st.open = null

      try {
        let sid = session || null
        if (!sid) {
          const recent = await sq.listSessions()
          if (recent.length) sid = String((recent[0].header || {}).id || '')
        }
        if (!sid) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到会话</div></div>', state: st }

        const model = await getModel(sid)
        const rows = model.rows
        const totalTok = model.totalTok
        const through = model.through
        const maxTok = rows.reduce((m, r) => Math.max(m, r.tok || 0), 1)
        const ROLE_PILL = { user: ['用户', 'tb-pill-done'], inject: ['注入', 'tb-pill-other'], ai: ['助手', 'tb-pill-active'], tool: ['工具结果', 'tb-pill-plain'] }

        const parts = []
        parts.push('<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">')
        parts.push('<div class="tb-stats">' +
          '<div class="tb-stat"><span class="tb-stat-num">' + rows.length + '</span><span class="tb-stat-label">上下文条目</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(totalTok) + '</span><span class="tb-stat-label">估算总 token</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + through + '</span><span class="tb-stat-label">日志序号</span></div>' +
        '</div>')
        parts.push('<div class="tb-banner tb-banner-info">当前模型实际可见的上下文（压缩/修剪后的 surface）；token 为本地估算</div>')

        // 详情
        if (st.open != null) {
          const row = rows.find((r) => r.seq === st.open)
          if (row) {
            parts.push('<div class="tb-preview"><div class="tb-preview-head">' +
              '<span class="tb-preview-name">#' + row.seq + ' ' + ROLE_PILL[row.role][0] + '</span>' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close">关闭</button></div>' +
              '<pre class="tb-code">' + esc(row.text.length > CAP ? row.text.slice(0, CAP) + '\n…（截断，共 ' + row.text.length + ' 字符）' : (row.text || '（无文本内容）')) + '</pre></div>')
          }
        }

        parts.push('</div>') // .tb-pane-head 结束
        parts.push('<div class="tb-pane-body tb-pane-col"><div class="tb-list">' + rows.map((r) => {
          const rp = ROLE_PILL[r.role]
          const pct = r.tok ? Math.max(2, Math.round((r.tok / maxTok) * 100)) : 0
          return '<div class="tb-rec' + (st.open === r.seq ? ' tb-rec-active' : '') + '" data-action="open" data-seq="' + r.seq + '">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-pill ' + rp[1] + '">' + rp[0] + '</span>' +
              '<span class="tb-rec-summary">' + esc(oneLine(r.text, 80) || '（非文本）') + '</span></div>' +
              '<div class="tb-rec-sub" style="flex-wrap:nowrap">' +
                '<span>' + fmtTime(r.time) + '</span>' +
                (r.tok ? '<div style="flex:1;max-width:120px;height:5px;border-radius:3px;background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33));overflow:hidden"><div style="height:100%;width:' + pct + '%;background:var(--tb-accent,#3f6fd9)"></div></div><span>' + fmtTok(r.tok) + ' tok</span>' : '') +
                '<span>#' + r.seq + '</span>' +
              '</div>' +
            '</div>' +
          '</div>'
        }).join('') + '</div></div>')
        parts.push('</div>') // .tb-pane 结束
        return { ok: true, html: parts.join(''), state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'context', label: '上下文', order: 10 }, handler)
  },
}
