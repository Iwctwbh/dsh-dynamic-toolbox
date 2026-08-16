// ===== compare-tool.js：多模型一问多答对比（Host-only）=====
// 同一问题并发 llm.stream 打多个模型（自选 provider/model 组合），并排对比回答/耗时/token。
// 与「问答」区别：问答是单模型快速提问，这里是横向评测。
// 历史（最近 3 轮，回答各截 4000 字符）落盘 .dsh-dynamic-toolbox/toolbox-compare.json。
// 结果本体留闭包 lastResults（多模型完整回答可能很大，不进 state——state 每次动作来回传输）。
// 状态：{ q, provider, picked[], notice }

return {
  name: 'compare-tool',
  inject: ['fs', 'llm', 'agentDefaultModel', 'timer'],
  apply(ctx) {
    const ai = makeLlmHelper(ctx)
    let lastResults = null // 最近一轮对比结果本体（闭包持有，不进 state；打开 Tab 时从磁盘恢复）

    const REL_STORE = '.dsh-dynamic-toolbox/toolbox-compare.json'

    // 默认路由 = 当前会话选中模型（经共享 resolveRoute 的兜底链解析）
    const defaultRoute = async () => {
      const tmp = { provider: '', model: '' }
      await ai.resolveRoute(tmp)
      return tmp.provider && tmp.model ? tmp.provider + '/' + tmp.model : ''
    }

    const askOne = async (q, route, ws) => {
      const slash = route.indexOf('/')
      const st = { provider: route.slice(0, slash), model: route.slice(slash + 1) }
      const r = await ai.chat(st, '', q, undefined, { root: ws.root, session: ws.session, tool: 'compare' })
      return { route, a: r.a || '', ms: r.ms || 0, out: r.out != null ? r.out : null, err: r.err || null }
    }

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }

    const render = (st, providers, models, roll) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">')
      // 路由选择：provider 下拉 + 加载芯片 + 已选清单
      parts.push('<div class="tb-row">' +
        '<select class="tb-select" data-field="provider" data-action-onchange="route" title="Provider（切换后自动加载模型芯片）">' +
          providers.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === st.provider ? ' selected' : '') + '>' + esc(p.name || p.id) + '</option>').join('') +
        '</select>' +
        '<span class="tb-note">点芯片加入对比，再点移除' + (roll && roll.calls ? ' · 累计 ' + roll.calls + ' 次 / 输出 ' + roll.out + ' tok' : '') + '</span></div>')
      if (models.length) {
        parts.push('<div class="tb-chips">' + models.map((m) => {
          const r = st.provider + '/' + m.id
          const on = (st.picked || []).indexOf(r) >= 0
          return '<button type="button" class="tb-chip' + (on ? ' tb-chip-on' : '') + '" data-action="pick" data-r="' + esc(r) + '">' + esc(m.name || m.id) + '</button>'
        }).join('') + '</div>')
      }
      parts.push('<div class="tb-row"><span class="tb-sec-label">已选 ' + (st.picked || []).length + ' 个模型：</span>' +
        ((st.picked || []).length
          ? st.picked.map((r) => '<button type="button" class="tb-chip tb-chip-on" data-action="pick" data-r="' + esc(r) + '" title="点击移除">' + esc(r) + ' ×</button>').join('')
          : '<span class="tb-note">（至少选 1 个）</span>') +
      '</div>')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">问题</span>' +
        '<textarea class="tb-textarea" data-field="q" placeholder="同一个问题，发给所有已选模型">' + esc(st.q || '') + '</textarea></div>')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="send"' + ((st.picked || []).length ? '' : ' disabled') + '>并发对比</button>' +
        (lastResults ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear-results">清除结果</button>' : '') +
      '</div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      parts.push('</div>')
      // 结果区（滚动；本体在闭包 lastResults，不进 state）
      parts.push('<div class="tb-pane-body tb-pane-col">')
      const res = lastResults
      if (res) {
        parts.push('<div class="tb-card" style="gap:6px"><div class="tb-sec"><span class="tb-sec-label">问题 · ' + fmtClock(res.t) + '</span>' +
          '<div style="font-size:12.5px;white-space:pre-wrap;word-break:break-word">' + esc(res.q) + '</div></div></div>')
        for (const it of res.items) {
          parts.push('<div class="tb-card">' +
            '<div class="tb-card-head"><span class="tb-key">' + esc(it.route) + '</span>' +
            '<span class="tb-note">' + it.ms + 'ms' + (it.out != null ? ' · 输出 ' + it.out + ' tok' : '') + '</span></div>' +
            (it.err
              ? '<div class="tb-banner tb-banner-error">' + esc(it.err) + '</div>'
              : '<pre class="tb-code">' + esc(it.a || '（空回复）') + '</pre>') +
          '</div>')
        }
      } else {
        parts.push('<div class="tb-notice">结果区：并发对比后按模型分别展示</div>')
      }
      parts.push('</div></div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { q: '', provider: '', picked: [], notice: null }
      if (!Array.isArray(st.picked)) st.picked = []
      if ('results' in st) delete st.results // state 迁移：结果本体已挪闭包
      const el = fields && fields.__el ? fields.__el : {}
      if (typeof fields.q === 'string') st.q = fields.q
      if (typeof fields.provider === 'string' && fields.provider) st.provider = fields.provider

      try {
        const providers = await ai.listProviders()
        if (!st.provider || !providers.some((p) => p.id === st.provider)) {
          st.provider = providers.length ? providers[0].id : ''
        }
        // 首次默认选中当前会话模型
        if (st.picked.length === 0 && !lastResults && action === '') {
          const d = await defaultRoute()
          if (d) st.picked = [d]
        }
        const models = await ai.listModels(st.provider) // 有缓存；芯片常驻当前 provider 的模型

        if (action === 'pick' && el.r) {
          const r = String(el.r)
          const i = st.picked.indexOf(r)
          if (i >= 0) st.picked.splice(i, 1); else st.picked.push(r)
        } else if (action === 'send' && st.q.trim() && st.picked.length) {
          const items = await Promise.all(st.picked.map((r) => askOne(st.q.trim(), r, ws)))
          lastResults = { q: st.q.trim(), t: Date.now(), items }
          // 落盘最近 3 轮（回答各截 4000 字符）
          const saved = await readJsonStore(ctx, REL_STORE, ws.root, [])
          const rounds = [{
            q: lastResults.q, t: lastResults.t,
            items: items.map((it) => ({ route: it.route, a: String(it.a || '').slice(0, 4000), err: it.err, ms: it.ms, out: it.out })),
          }].concat(Array.isArray(saved) ? saved : []).slice(0, 3)
          const persisted = await writeJsonStore(ctx, REL_STORE, rounds, ws.root, ws.session)
          st.notice = persisted ? null : '⚠ 对比记录未能写入 ' + REL_STORE
        } else if (action === 'clear-results') {
          lastResults = null
        } else if (action === '') {
          // 打开 Tab：恢复最近一轮对比结果（进闭包，不进 state）
          const saved = await readJsonStore(ctx, REL_STORE, ws.root, [])
          if (Array.isArray(saved) && saved.length && saved[0] && Array.isArray(saved[0].items)) {
            lastResults = saved[0]
          }
          st.notice = null
        }
        const roll = await ai.rollup(ws.root, 'compare')
        return { ok: true, html: render(st, providers, models, roll), state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'compare', label: '对比', order: 15 }, handler)
  },
}
