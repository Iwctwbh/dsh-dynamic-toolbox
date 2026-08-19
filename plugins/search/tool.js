// ===== search-tool.js：当前会话全文搜索（Host-only）=====
// sessionQuery.searchEvents 语义扫描（命中带 snippet），点击条目 readEvent 读完整事件。
// 与「轨迹」互补：轨迹是结构化时间线，这里是自由文本检索。
// 状态：{ q, hits, open, searched }（详情原文按需 readEvent，不进 state）

return {
  name: 'search-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && (b.type === 'text' || b.type === 'reasoning') ? b.text : '')).filter(Boolean).join('\n')
    }
    const CAP = 12000

    const TYPE_LABEL = {
      'user/message': '用户', 'assistant/message': '助手', 'tool/call': '调用',
      'tool/result': '结果', 'todo/write': '待办', 'turn/start': '轮次',
    }
    const typePill = (t) => {
      if (t === 'user/message') return 'tb-pill-done'
      if (t === 'assistant/message') return 'tb-pill-active'
      if (t === 'tool/call' || t === 'tool/result') return 'tb-pill-other'
      return 'tb-pill-plain'
    }

    // 完整事件 → 可读文本
    const eventText = (ev) => {
      if (!ev) return ''
      const d = ev.data || {}
      if (ev.type === 'tool/call') {
        let args = d.arguments || ''
        try { args = JSON.stringify(JSON.parse(d.arguments), null, 2) } catch (e) {}
        return '工具：' + (d.name || '?') + '（T' + d.turn + '·S' + d.step + '）\n\n' + args
      }
      if (ev.type === 'tool/result') {
        const m = d.message || {}
        const block = Array.isArray(m.content) ? m.content[0] : null
        return (d.error ? '[error] ' + (d.error.name || '') + ' ' + (d.error.code || '') + '\n\n' : '') + (block ? textOf(block.content) : '')
      }
      if (ev.type === 'assistant/message') return textOf((d.message || {}).content)
      if (ev.type === 'user/message') return textOf(d.content)
      return JSON.stringify(d, null, 2)
    }

    const handler = async ({ action, fields, state, root, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { q: '', hits: [], open: null, searched: false, recent: [] }
      if (!Array.isArray(st.recent)) st.recent = []
      const el = fields && fields.__el ? fields.__el : {}
      if (typeof fields.q === 'string') st.q = fields.q
      const ws = resolveWorkspace(ctx, root, session)
      const REL_STORE = '.dsh-dynamic-toolbox/toolbox-search.json'

      let detailHtml = ''
      try {
        const sid = session || null
        if (!sid) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到当前会话</div></div>', state: st }

        // 查询历史：最近 8 条（去重置顶）落盘工作区，点芯片即重搜
        const remember = async (q) => {
          st.recent = [q].concat(st.recent.filter((x) => x !== q)).slice(0, 8)
          await writeJsonStore(ctx, REL_STORE, st.recent, ws.root, ws.session)
        }
        const runSearch = async () => {
          const page = await sq.searchEvents({ sessionId: sid, query: st.q.trim(), limit: 50 })
          st.hits = ((page && page.items) || []).map((h) => ({
            seq: h.seq, type: String(h.type || ''), time: h.time, snippet: String(h.snippet || ''), surface: String(h.surface || ''),
          }))
          st.open = null
          st.searched = true
          await remember(st.q.trim())
        }

        if (action === 'query' && st.q.trim()) {
          await runSearch()
        } else if (action === 'research' && el.q) {
          st.q = String(el.q)
          await runSearch()
        } else if (action === 'clear-recent') {
          st.recent = []
          await writeJsonStore(ctx, REL_STORE, [], ws.root, ws.session)
        } else if (action === 'open' && el.seq) {
          const n = Number(el.seq)
          st.open = st.open === n ? null : n
        } else if (action === 'close') {
          st.open = null
        } else if (action === '') {
          const saved = await readJsonStore(ctx, REL_STORE, ws.root, null)
          if (Array.isArray(saved)) st.recent = saved.filter((x) => typeof x === 'string').slice(0, 8)
        }

        if (st.open != null) {
          const w = await sq.readEvent({ sessionId: sid, seq: st.open, before: 0, after: 0 })
          const text = eventText(w && w.target)
          detailHtml = '<div class="tb-preview"><div class="tb-preview-head">' +
            '<span class="tb-preview-name">#' + st.open + ' 完整内容</span>' +
            '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close">关闭</button></div>' +
            '<pre class="tb-code">' + esc(text.length > CAP ? text.slice(0, CAP) + '\n…（截断，共 ' + text.length + ' 字符）' : (text || '（无文本）')) + '</pre></div>'
        }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }

      const parts = []
      parts.push('<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">')
      parts.push('<div class="tb-query">' +
        '<input class="tb-input" data-field="q" placeholder="在当前会话里搜索（消息 / 工具调用 / 结果）" value="' + esc(st.q || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="query">搜索</button>' +
      '</div>')
      if (st.recent.length) {
        parts.push('<div class="tb-chips">' +
          st.recent.map((q) => '<button type="button" class="tb-chip" data-action="research" data-q="' + esc(q) + '" title="点击重搜">' + esc(q.length > 20 ? q.slice(0, 19) + '…' : q) + '</button>').join('') +
          '<button type="button" class="tb-chip" data-action="clear-recent" title="清空搜索历史">×</button>' +
        '</div>')
      }
      if (detailHtml) parts.push(detailHtml)
      if (st.searched) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">命中<span class="tb-count">' + st.hits.length + '</span></span>' +
          '<span class="tb-note">上限 50 条</span></div>')
      }
      parts.push('</div>')
      parts.push('<div class="tb-pane-body tb-pane-col">')
      if (!st.searched) {
        parts.push('<div class="tb-notice">输入关键词搜索当前会话的完整日志</div>')
      } else if (st.hits.length === 0) {
        parts.push('<div class="tb-notice">无命中</div>')
      } else {
        parts.push('<div class="tb-list">' + st.hits.map((h) =>
          '<div class="tb-rec' + (st.open === h.seq ? ' tb-rec-active' : '') + '" data-action="open" data-seq="' + h.seq + '">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top">' +
                '<span class="tb-pill ' + typePill(h.type) + '">' + esc(TYPE_LABEL[h.type] || h.type) + '</span>' +
                '<span class="tb-rec-summary">' + esc(h.snippet) + '</span>' +
              '</div>' +
              '<div class="tb-rec-sub"><span>' + fmtTime(h.time) + '</span><span>#' + h.seq + '</span>' +
              (h.surface === 'shadowed' ? '<span class="tb-tx-warn">已被压缩</span>' : '') +
              (h.surface === 'log-only' ? '<span class="tb-tx-muted">仅日志</span>' : '') + '</div>' +
            '</div>' +
          '</div>'
        ).join('') + '</div>')
      }
      parts.push('</div></div>')
      return { ok: true, html: parts.join(''), state: st }
    }

    tryRegisterTool(ctx, { id: 'search', label: '搜索', order: 13, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/></svg>' }, handler)
  },
}
