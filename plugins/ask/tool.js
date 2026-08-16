// ===== ask-tool.js：大模型旁路问答（Host-only）=====
// llm.stream 直调模型，不写入会话日志、不污染上下文；历史存 .dsh-dynamic-toolbox/toolbox-ask.json。
// 模型路由：provider/model 下拉自选（listProviders/listModels，模型列表按 provider 缓存），
// 默认取当前会话选中模型（agentDefaultModel.currentSelection）。
// 状态：{ q, history[], notice, provider, model }

return {
  name: 'ask-tool',
  inject: ['fs', 'llm', 'agentDefaultModel', 'timer'],
  apply(ctx) {
    const ai = makeLlmHelper(ctx)

    const REL_STORE = '.dsh-dynamic-toolbox/toolbox-ask.json'

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }

    const render = (st, route, roll) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      // 模型路由自选
      parts.push(ai.routeRow(st, route, '旁路调用 · 不写入会话' + (roll && roll.calls ? ' · 累计 ' + roll.calls + ' 次 / 输出 ' + roll.out + ' tok' : '')))
      parts.push('<div class="tb-sec"><span class="tb-sec-label">问题</span>' +
        '<textarea class="tb-textarea" data-field="q" placeholder="向所选模型直接提问（不影响会话上下文）">' + esc(st.q || '') + '</textarea></div>')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="send">发送</button>' +
        ((st.history || []).length ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空历史</button>' : '') +
      '</div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      const h = st.history || []
      for (const it of h) {
        parts.push('<div class="tb-card">' +
          '<div class="tb-sec"><span class="tb-sec-label">问</span><div style="font-size:12.5px;white-space:pre-wrap;word-break:break-word">' + esc(it.q) + '</div></div>' +
          (it.err
            ? '<div class="tb-banner tb-banner-error">' + esc(it.err) + '</div>'
            : '<div class="tb-sec"><span class="tb-sec-label">答</span><pre class="tb-code">' + esc(it.a || '（空回复）') + '</pre></div>') +
          '<div class="tb-rec-sub"><span>' + esc(it.route || '') + '</span><span>' + it.ms + 'ms</span>' +
          (it.out != null ? '<span>输出 ' + it.out + ' tok</span>' : '') +
          '<span>' + fmtClock(it.t) + '</span></div>' +
        '</div>')
      }
      if (!h.length) parts.push('<div class="tb-notice">发送后回答显示在这里</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { q: '', history: [], notice: null, provider: '', model: '' }
      if (typeof fields.q === 'string') st.q = fields.q
      // 路由选择随任何动作同步（发送即按当前选择调用），resolveRoute 兜底非法组合
      if (typeof fields.provider === 'string' && fields.provider) st.provider = fields.provider
      if (typeof fields.model === 'string' && fields.model) st.model = fields.model

      if (action === 'route') {
        // provider 已随 fields 同步；清空 model 让 resolveRoute 取新 provider 的默认模型并重渲染列表
        st.model = ''
      } else if (action === 'clear') {
        st.history = []
        const persisted = await writeJsonStore(ctx, REL_STORE, [], ws.root, ws.session)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
      } else if (action === 'send' && st.q && st.q.trim()) {
        await ai.resolveRoute(st)
        const r = await ai.chat(st, '', st.q.trim(), undefined, { root: ws.root, session: ws.session, tool: 'ask' })
        st.history = [{ q: st.q.trim(), a: r.a || '', err: r.err || null, ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: Date.now() }].concat(st.history || []).slice(0, 10)
        const persisted = await writeJsonStore(ctx, REL_STORE, st.history, ws.root, ws.session)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
      } else if (action === '') {
        // 打开 Tab：磁盘为准恢复历史（面板 state 只是镜像）
        const saved = await readJsonStore(ctx, REL_STORE, ws.root, null)
        if (Array.isArray(saved)) st.history = saved
        st.notice = null
      }
      const route = await ai.resolveRoute(st)
      const roll = await ai.rollup(ws.root, 'ask')
      return { ok: true, html: render(st, route, roll), state: st }
    }

    tryRegisterTool(ctx, { id: 'ask', label: '问答', order: 11 }, handler)
  },
}
