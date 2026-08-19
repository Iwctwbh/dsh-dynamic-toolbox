// ===== aiusage-tool.js：AI 旁路调用台账（Host-only）=====
// 数据源：.dsh-dynamic-toolbox/toolbox-ai-usage.json（makeLlmHelper.chat 的 track 异步追加，cap 100 条）。
// 展示：总计（调用/输出/失败/今日）+ 按工具聚合条形图 + 最近 20 条明细；两步确认清空台账。
// 状态：{ confirmClear, notice }（台账本体每次动作重读磁盘，不进 state）

return {
  name: 'aiusage-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
    const fmtDay = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() }
    const fmtTok = (n) => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n)
    const fmtMs = (ms) => ms >= 10000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'

    const build = (list) => {
      const byTool = {}
      let calls = 0, out = 0, errs = 0, todayCalls = 0, todayOut = 0
      const dayStr = new Date().toDateString() // 本地日界（记录 t 为本地时间戳，同一日界口径）
      for (const r of list) {
        if (!r || typeof r !== 'object') continue
        const k = String(r.tool || '?')
        if (!byTool[k]) byTool[k] = { tool: k, calls: 0, out: 0, errors: 0 }
        if (r.ok) {
          byTool[k].calls++
          calls++
          const o = typeof r.out === 'number' ? r.out : 0
          byTool[k].out += o
          out += o
          if (typeof r.t === 'number' && new Date(r.t).toDateString() === dayStr) { todayCalls++; todayOut += o }
        } else {
          byTool[k].errors++
          errs++
        }
      }
      const tools = Object.keys(byTool).map((k) => byTool[k]).sort((a, b) => b.calls - a.calls)
      const recent = list.slice(-20).reverse()
      return { tools, recent, calls, out, errs, todayCalls, todayOut }
    }

    const render = (st, m) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="reload">刷新</button>' +
        (m.calls + m.errs > 0
          ? (st.confirmClear
            ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="clear-confirm">确认清空？</button>' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear-cancel">取消</button>'
            : '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空台账</button>')
          : '') +
        '<span class="tb-note">台账：.dsh-dynamic-toolbox/toolbox-ai-usage.json（AI 工具旁路调用，上限 100 条）</span></div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      if (m.calls + m.errs === 0) {
        parts.push('<div class="tb-notice">暂无旁路调用记录——用「问答 / 对比 / 翻译 / 提示优化 / 提交信息 / 评审 / 摘要」任一工具调一次模型即入账</div></div>')
        return parts.join('')
      }
      parts.push('<div class="tb-stats">' +
        '<div class="tb-stat"><span class="tb-stat-num">' + m.calls + '</span><span class="tb-stat-label">总调用</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(m.out) + '</span><span class="tb-stat-label">总输出 tok</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + m.errs + '</span><span class="tb-stat-label">失败</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + m.todayCalls + '</span><span class="tb-stat-label">今日调用</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(m.todayOut) + '</span><span class="tb-stat-label">今日输出</span></div>' +
      '</div>')

      const max = m.tools.length ? m.tools[0].calls : 1
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">按工具聚合（' + m.tools.length + '）</span>' +
        m.tools.map((t) =>
          '<div class="tb-row" style="flex-wrap:nowrap" title="' + esc(t.tool) + '：' + t.calls + ' 次 / 输出 ' + t.out + ' tok' + (t.errors ? ' / 失败 ' + t.errors : '') + '">' +
            '<span class="tb-num tb-mono" style="min-width:76px">' + esc(t.tool) + '</span>' +
            '<div style="flex:1;height:8px;border-radius:4px;background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33));overflow:hidden">' +
              '<div style="height:100%;width:' + Math.max(2, Math.round((t.calls / max) * 100)) + '%;background:var(--tb-accent,#3f6fd9);border-radius:4px"></div>' +
            '</div>' +
            '<span class="tb-num" style="min-width:44px;text-align:right">' + t.calls + ' 次</span>' +
            '<span class="tb-num" style="min-width:52px;text-align:right">' + fmtTok(t.out) + '</span>' +
            (t.errors ? '<span class="tb-num" style="min-width:36px;text-align:right;color:var(--tb-error,#d95f5f)">✗' + t.errors + '</span>' : '') +
          '</div>'
        ).join('') + '</div></div>')

      parts.push('<div class="tb-list-head"><span class="tb-list-title">最近 ' + m.recent.length + ' 条明细</span></div>')
      parts.push('<div class="tb-list">' + m.recent.map((r) =>
        '<div class="tb-rec"><div class="tb-rec-main">' +
          '<div class="tb-rec-top"><span class="tb-rec-key">' + esc(String(r.tool || '?')) + '</span>' +
          '<span class="tb-rec-summary">' + (r.ok ? '✓ 成功' : '✗ 失败') + ' · ' + fmtMs(r.ms || 0) + '</span></div>' +
          '<div class="tb-rec-sub"><span>' + fmtDay(r.t) + ' ' + fmtTime(r.t) + '</span>' +
          (r.ok && typeof r.out === 'number' ? '<span>输出 ' + r.out + ' tok</span>' : '') +
          '</div>' +
        '</div></div>'
      ).join('') + '</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { confirmClear: false, notice: null }
      if (action === 'clear') {
        st.confirmClear = true
        st.notice = null
      } else if (action === 'clear-cancel') {
        st.confirmClear = false
        st.notice = null
      } else if (action === 'clear-confirm') {
        st.confirmClear = false
        const persisted = await writeJsonStore(ctx, AI_USAGE_REL, [], ws.root, ws.session)
        st.notice = persisted ? '台账已清空' : '⚠ 未能写入 ' + AI_USAGE_REL + '，清空仅在内存生效'
      } else {
        // '' / reload：重读磁盘（其他 AI 工具可能刚追加了记录）
        st.confirmClear = false
        if (action === '') st.notice = null
      }
      const list = await readJsonStore(ctx, AI_USAGE_REL, ws.root, [])
      const m = build(Array.isArray(list) ? list : [])
      return { ok: true, html: render(st, m), state: st }
    }

    tryRegisterTool(ctx, { id: 'aiusage', label: 'AI 用量', order: 21, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l1.4 2.8 3.1.45-2.25 2.2.5 3.1-2.75-1.45-2.75 1.45.5-3.1-2.25-2.2 3.1-.45z"/></svg>' }, handler)
  },
}
