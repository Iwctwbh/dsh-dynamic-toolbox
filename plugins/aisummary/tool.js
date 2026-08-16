// ===== aisummary-tool.js：会话 AI 摘要（Host-only，经工具箱 RPC 注册）=====
// makeSessionLogReader 读当前会话日志（缓存）→ 抽取用户/助手文本 → 首尾采样压缩
// （超 12000 字符取头 4000 + 尾 8000，保证长会话也快速出摘要）→ llm.stream 四节摘要。
// 最近一次摘要落盘 .dsh-dynamic-toolbox/toolbox-aisummary.json。状态：{ summary, meta, notice, provider, model }

return {
  name: 'aisummary-tool',
  inject: ['fs', 'sessionQuery', 'llm', 'agentDefaultModel', 'timer'],
  apply(ctx) {
    const ai = makeLlmHelper(ctx)
    const sq = ctx.get('sessionQuery')
    const readLog = sq ? makeSessionLogReader(ctx, sq) : null
    const REL_STORE = '.dsh-dynamic-toolbox/toolbox-aisummary.json'
    const CAP = 12000
    const HEAD = 4000

    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && b.type === 'text' ? b.text : '')).filter(Boolean).join('\n')
    }

    // 日志 → 对话流水（用户/助手文本，跳过工具调用细节）
    const transcript = (events) => {
      const lines = []
      for (const ev of events) {
        if (!ev || typeof ev.seq !== 'number') continue
        const d = ev.data || {}
        if (ev.type === 'user/message') {
          const t = textOf(d.content)
          if (t) lines.push('用户：' + t)
        } else if (ev.type === 'assistant/message') {
          const t = textOf((d.message || {}).content)
          if (t) lines.push('助手：' + t)
        }
      }
      const full = lines.join('\n\n')
      if (full.length <= CAP) return { text: full, truncated: false, omitted: 0 }
      const head = full.slice(0, HEAD)
      const tail = full.slice(-(CAP - HEAD))
      return { text: head + '\n\n…（中间省略 ' + (full.length - CAP) + ' 字符）…\n\n' + tail, truncated: true, omitted: full.length - CAP }
    }

    const render = (st, route, roll) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push(ai.routeRow(st, route, '旁路调用 · 摘要不写回会话' + (roll && roll.calls ? ' · 累计 ' + roll.calls + ' 次 / 输出 ' + roll.out + ' tok' : '')))
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="gen">生成 / 刷新摘要</button>' +
        (st.meta ? '<span class="tb-note">事件 ' + st.meta.events + ' · 对话 ' + st.meta.chars + ' 字符' + (st.meta.truncated ? '（首尾采样，省略 ' + st.meta.omitted + '）' : '') + '</span>' : '') +
      '</div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      if (st.summary) {
        parts.push('<div class="tb-card"><pre class="tb-code">' + esc(st.summary) + '</pre>' +
          '<div class="tb-row"><button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy">复制摘要</button></div>' +
          (st.meta ? '<div class="tb-rec-sub"><span>' + esc(st.meta.route || '') + '</span><span>' + st.meta.ms + 'ms</span>' +
            (st.meta.out != null ? '<span>输出 ' + st.meta.out + ' tok</span>' : '') +
            '<span>' + esc(st.meta.at || '') + '</span></div>' : '') +
        '</div>')
      } else {
        parts.push('<div class="tb-notice">点击「生成 / 刷新摘要」对当前会话做 AI 摘要（最近一次结果落盘保留）</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { summary: '', meta: null, notice: null, provider: '', model: '' }
      if (typeof fields.provider === 'string' && fields.provider) st.provider = fields.provider
      if (typeof fields.model === 'string' && fields.model) st.model = fields.model

      if (action === 'route') {
        st.model = ''
      } else if (action === 'gen') {
        if (!readLog) {
          st.notice = 'sessionQuery 服务不可用'
        } else if (!session) {
          st.notice = '未获取到当前会话 ID'
        } else {
          const r = await readLog(session)
          const t = transcript(r.events || [])
          if (!t.text.trim()) {
            st.notice = '当前会话还没有可摘要的对话内容'
          } else {
            await ai.resolveRoute(st)
            const sys = '你是会话摘要助手。把给定的 用户/助手 对话流水整理为四节中文摘要：🎯 目标（用户想达成什么）/ ✅ 进展（已完成的关键事项）/ 🔑 关键决定（技术选型、约定、踩坑结论）/ 📌 待办（未完成或后续要做的事）。每节 1-4 条要点，精炼，不要复述原文。'
            const r2 = await ai.chat(st, sys, t.text, undefined, { root: ws.root, session: ws.session, tool: 'aisummary' })
            if (r2.err) {
              st.notice = '摘要失败: ' + r2.err
            } else {
              let at = ''
              try { at = new Date().toISOString().slice(0, 19).replace('T', ' ') } catch (e) {}
              st.summary = (r2.a || '').slice(0, 8000)
              st.meta = { events: r.count, chars: t.text.length, truncated: t.truncated, omitted: t.omitted, ms: r2.ms || 0, out: r2.out != null ? r2.out : null, route: r2.route || '', at }
              const persisted = await writeJsonStore(ctx, REL_STORE, { sid: session, summary: st.summary, meta: st.meta }, ws.root, ws.session)
              st.notice = persisted ? null : '⚠ 摘要未能写入 ' + REL_STORE + '，仅保存在面板内存中'
            }
          }
        }
      } else if (action === '') {
        const saved = await readJsonStore(ctx, REL_STORE, ws.root, null)
        if (saved && typeof saved.summary === 'string' && saved.summary) {
          st.summary = saved.summary
          st.meta = saved.meta || null
        }
        st.notice = null
      }
      const route = await ai.resolveRoute(st)
      const roll = await ai.rollup(ws.root, 'aisummary')
      const out = { ok: true, html: render(st, route, roll), state: st }
      if (action === 'copy' && st.summary) out.copy = st.summary
      return out
    }

    tryRegisterTool(ctx, { id: 'aisummary', label: '摘要', order: 20 }, handler)
  },
}
