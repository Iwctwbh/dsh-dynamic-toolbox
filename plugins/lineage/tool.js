// ===== lineage-tool.js：会话血缘树（Host-only）=====
// sessionQuery.traceSession(当前会话)：祖先链（直至根）+ 后代子代理树（递归）。
// 纯只读视图，每动作重取（traceSession 是一次性观测，无大负载）。
// 状态：{}

return {
  name: 'lineage-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtDate = (t) => {
      if (!t) return '—'
      const d = new Date(t)
      return (d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
    }
    const shortId = (id) => String(id || '').replace(/^session-/, '').slice(0, 8)
    const cwdName = (cwd) => String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || '（无目录）'

    const badge = (rec) => {
      const b = []
      if (rec.live) b.push('<span class="tb-pill tb-pill-done">在线</span>')
      else if (rec.persisted) b.push('<span class="tb-pill tb-pill-plain">已落盘</span>')
      if (rec.header && rec.header.origin === 'subagent') b.push('<span class="tb-pill tb-pill-other">子代理</span>')
      return b.join('')
    }

    const rowHtml = (rec, depth, isTarget) => {
      const pad = (depth * 18 + 4) + 'px'
      return '<div class="tb-tree-row' + (isTarget ? ' tb-rec-active' : '') + '" style="padding-left:' + pad + ';cursor:default" title="' + esc(String((rec.header || {}).id || '')) + '">' +
        '<span class="tb-tree-ic">' + (isTarget ? '◉' : depth === 0 ? '●' : '○') + '</span>' +
        '<span class="tb-rec-key">' + esc(shortId((rec.header || {}).id)) + '</span>' +
        '<span class="tb-tree-name">' + esc(cwdName((rec.header || {}).cwd)) + '</span>' +
        badge(rec) +
        '<span class="tb-tree-size">' + fmtDate((rec.header || {}).createdAt) + '</span>' +
      '</div>'
    }

    const renderTree = (nodes, depth, out, targetId) => {
      for (const n of nodes || []) {
        const rec = n.session || {}
        out.push(rowHtml(rec, depth, String((rec.header || {}).id) === targetId))
        renderTree(n.descendants, depth + 1, out, targetId)
      }
    }

    const handler = async ({ session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      try {
        const sid = session || null
        if (!sid) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到当前会话</div></div>', state: {} }
        const tr = await sq.traceSession(sid)
        const targetId = String(((tr.target || {}).header || {}).id || sid)

        const head = []
        head.push('<div class="tb-card"><div class="tb-card-head">' +
          '<span class="tb-key">' + esc(shortId(targetId)) + '</span>' +
          '<div class="tb-title">当前会话</div>' + badge(tr.target || {}) + '</div>' +
          '<div class="tb-meta">' + [
            ['工作区', cwdName(((tr.target || {}).header || {}).cwd)],
            ['创建于', fmtDate(((tr.target || {}).header || {}).createdAt)],
            ['祖先链', tr.complete ? '完整（根可达）' : '不完整（有父级不可见）'],
            ['直接子代理', String(((tr.descendants) || []).length)],
          ].map((r) => '<div class="tb-meta-item"><span class="tb-meta-label">' + r[0] + '</span><span class="tb-meta-value">' + esc(r[1]) + '</span></div>').join('') +
          '</div></div>')

        const body = []
        // 祖先链：root → … → parent（traceSession.ancestors 是近父在前，反转为根在前）
        const ancestors = ((tr.ancestors) || []).slice().reverse()
        if (ancestors.length) {
          body.push('<div class="tb-list-head"><span class="tb-list-title">祖先链<span class="tb-count">' + ancestors.length + '</span></span></div>')
          ancestors.forEach((rec, i) => body.push(rowHtml(rec, i, false)))
          body.push(rowHtml(tr.target, ancestors.length, true))
        }
        // 后代树
        const countDesc = (nodes) => (nodes || []).reduce((n, x) => n + 1 + countDesc(x.descendants), 0)
        const descTotal = countDesc(tr.descendants)
        body.push('<div class="tb-list-head"><span class="tb-list-title">后代（子代理）<span class="tb-count">' + descTotal + '</span></span></div>')
        if (descTotal === 0) {
          body.push('<div class="tb-notice">当前会话没有子代理后代</div>')
        } else {
          const rows = []
          renderTree(tr.descendants, 0, rows, targetId)
          body.push('<div class="tb-tree">' + rows.join('') + '</div>')
        }
        if (!tr.complete) {
          body.push('<div class="tb-banner tb-banner-info">祖先链在 ' + esc(shortId(tr.unresolvedParentId)) + ' 处断出可见语料（该父级不在当前逻辑库中）</div>')
        }

        const html = '<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">' + head.join('') + '</div>' +
          '<div class="tb-pane-body tb-pane-col">' + body.join('') + '</div></div>'
        return { ok: true, html, state: {} }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: {} }
      }
    }

    tryRegisterTool(ctx, { id: 'lineage', label: '谱系', order: 14, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="3.5" r="1.6"/><circle cx="3.5" cy="12.5" r="1.6"/><circle cx="12.5" cy="12.5" r="1.6"/><path d="M8 5.1v.9a2 2 0 0 1-2 2H5.4"/><path d="M9.5 6.4h.6a2 2 0 0 1 2 2v1.6"/></svg>' }, handler)
  },
}
