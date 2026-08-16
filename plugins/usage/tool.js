// ===== usage-tool.js：会话 Token 用量分析（Host-only）=====
// 数据源：sessionQuery.readSession(当前会话) 的 assistant/message usage 事件。
// 汇总：总输入/输出/缓存读取/命中率/步数；Top10 步骤横向条形图；最近 20 步明细。
// 状态：{}（数据每次动作重算，不进 state）

return {
  name: 'usage-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')
    const readLog = sq ? makeSessionLogReader(ctx, sq) : null
    let modelCache = null // { sid, count, data }（build 结果缓存；日志不增长不重建）

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
    const fmtTok = (n) => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n)

    const build = (events) => {
      const steps = []
      let inTok = 0, outTok = 0, cacheRead = 0, reasoning = 0
      for (const ev of events) {
        if (!ev || ev.type !== 'assistant/message') continue
        const d = ev.data || {}
        const u = d.usage
        if (!u) continue
        const input = (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
        const output = u.outputTokens || 0
        steps.push({
          seq: ev.seq, turn: d.turn, step: d.step, time: ev.time,
          input, output, cacheRead: u.cacheReadTokens || 0, reasoning: u.reasoningTokens || 0,
          total: input + output,
        })
        inTok += input; outTok += output; cacheRead += u.cacheReadTokens || 0; reasoning += u.reasoningTokens || 0
      }
      return { steps, inTok, outTok, cacheRead, reasoning }
    }

    const render = (m) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      if (m.steps.length === 0) {
        parts.push('<div class="tb-notice">本会话暂无用量的助手消息（usage 由适配器上报）</div></div>')
        return parts.join('')
      }
      const hitRate = m.inTok > 0 ? Math.round((m.cacheRead / m.inTok) * 100) : 0
      const avg = Math.round((m.inTok + m.outTok) / m.steps.length)
      parts.push('<div class="tb-stats">' +
        '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(m.inTok) + '</span><span class="tb-stat-label">总输入</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(m.outTok) + '</span><span class="tb-stat-label">总输出</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + hitRate + '%</span><span class="tb-stat-label">缓存命中率</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(avg) + '</span><span class="tb-stat-label">平均/步</span></div>' +
        '<div class="tb-stat"><span class="tb-stat-num">' + m.steps.length + '</span><span class="tb-stat-label">计费步数</span></div>' +
      '</div>')

      const top = m.steps.slice().sort((a, b) => b.total - a.total).slice(0, 10)
      const max = top.length ? top[0].total : 1
      parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">消耗最高的步骤 Top ' + top.length + '</span>' +
        top.map((s) =>
          '<div class="tb-row" style="flex-wrap:nowrap" title="T' + s.turn + '·S' + s.step + ' 输入 ' + s.input + ' / 输出 ' + s.output + '">' +
            '<span class="tb-num tb-mono" style="min-width:52px">T' + s.turn + '·S' + s.step + '</span>' +
            '<div style="flex:1;height:8px;border-radius:4px;background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33));overflow:hidden">' +
              '<div style="height:100%;width:' + Math.max(2, Math.round((s.total / max) * 100)) + '%;background:var(--tb-accent,#3f6fd9);border-radius:4px"></div>' +
            '</div>' +
            '<span class="tb-num" style="min-width:56px;text-align:right">' + fmtTok(s.total) + '</span>' +
          '</div>'
        ).join('') + '</div></div>')

      // 按轮次聚合趋势（最近 15 轮）：一眼看出哪几轮在烧 token
      const byTurn = {}
      for (const s of m.steps) byTurn[s.turn] = (byTurn[s.turn] || 0) + s.total
      const turnRows = Object.keys(byTurn).map((t) => ({ turn: Number(t), total: byTurn[t] })).sort((a, b) => a.turn - b.turn).slice(-15)
      const maxTurn = turnRows.reduce((mx, r) => Math.max(mx, r.total), 1)
      if (turnRows.length > 1) {
        parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">按轮次趋势（最近 ' + turnRows.length + ' 轮）</span>' +
          turnRows.map((r) =>
            '<div class="tb-row" style="flex-wrap:nowrap" title="轮次 T' + r.turn + ' 合计 ' + r.total + ' tok">' +
              '<span class="tb-num tb-mono" style="min-width:52px">T' + r.turn + '</span>' +
              '<div style="flex:1;height:8px;border-radius:4px;background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33));overflow:hidden">' +
                '<div style="height:100%;width:' + Math.max(2, Math.round((r.total / maxTurn) * 100)) + '%;background:var(--tb-accent,#3f6fd9);border-radius:4px"></div>' +
              '</div>' +
              '<span class="tb-num" style="min-width:56px;text-align:right">' + fmtTok(r.total) + '</span>' +
            '</div>'
          ).join('') + '</div></div>')
      }

      const recent = m.steps.slice(-20).reverse()
      parts.push('<div class="tb-list-head"><span class="tb-list-title">最近 ' + recent.length + ' 步明细<span class="tb-count">' + m.steps.length + '</span></span></div>')
      parts.push('<div class="tb-list">' + recent.map((s) =>
        '<div class="tb-rec"><div class="tb-rec-main">' +
          '<div class="tb-rec-top"><span class="tb-rec-key">T' + s.turn + '·S' + s.step + '</span>' +
          '<span class="tb-rec-summary">输入 ' + fmtTok(s.input) + ' · 输出 ' + fmtTok(s.output) + '</span></div>' +
          '<div class="tb-rec-sub"><span>' + fmtTime(s.time) + '</span>' +
          (s.cacheRead ? '<span class="tb-tx-done">缓存 ' + fmtTok(s.cacheRead) + '</span>' : '') +
          (s.reasoning ? '<span>推理 ' + fmtTok(s.reasoning) + '</span>' : '') +
          '<span>#' + s.seq + '</span></div>' +
        '</div></div>'
      ).join('') + '</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ state, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : {}
      try {
        let sid = session || null
        if (!sid) {
          const recent = await sq.listSessions()
          if (recent.length) sid = String((recent[0].header || {}).id || '')
        }
        if (!sid) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到会话</div></div>', state: st }
        const r = await readLog(sid)
        if (!modelCache || modelCache.sid !== sid || modelCache.count !== r.count) {
          modelCache = { sid, count: r.count, data: build(r.events) }
        }
        return { ok: true, html: render(modelCache.data), state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'usage', label: '用量', order: 8 }, handler)
  },
}
