// ===== promptopt-tool.js：AI 提示词优化器（Host-only，经工具箱 RPC 注册）=====
// 粗糙草稿 → llm.stream 改写为结构化高质量提示词（角色/任务/背景/约束/输出格式）。
// 历史落盘 .dsh-dynamic-toolbox/toolbox-promptopt.json。状态：{ draft, style, history[], notice, provider, model }

return {
  name: 'promptopt-tool',
  inject: ['fs', 'llm', 'agentDefaultModel', 'timer'],
  apply(ctx) {
    const ai = makeLlmHelper(ctx)
    const REL_STORE = '.dsh-dynamic-toolbox/toolbox-promptopt.json'
    const STYLES = ['通用', '代码', '分析', '创意']

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }

    const render = (st, route, roll) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push(ai.routeRow(st, route, '旁路调用 · 不写入会话' + (roll && roll.calls ? ' · 累计 ' + roll.calls + ' 次 / 输出 ' + roll.out + ' tok' : '')))
      parts.push('<div class="tb-row">' +
        '<span class="tb-sec-label">风格</span>' +
        '<select class="tb-select" data-field="style">' +
          STYLES.map((s) => '<option value="' + esc(s) + '"' + (s === st.style ? ' selected' : '') + '>' + esc(s) + '</option>').join('') +
        '</select></div>')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">草稿</span>' +
        '<textarea class="tb-textarea" data-field="draft" placeholder="用大白话描述你想让 AI 做什么，越随意越好，优化器负责补全结构">' + esc(st.draft || '') + '</textarea></div>')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="opt">优化提示词</button>' +
        ((st.history || []).length ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空历史</button>' : '') +
      '</div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      const h = st.history || []
      for (let i = 0; i < h.length; i++) {
        const it = h[i]
        parts.push('<div class="tb-card">' +
          '<div class="tb-sec"><span class="tb-sec-label">草稿（' + esc(it.style || '通用') + '）</span>' +
          '<div style="font-size:12.5px;white-space:pre-wrap;word-break:break-word">' + esc(it.draft) + '</div></div>' +
          (it.err
            ? '<div class="tb-banner tb-banner-error">' + esc(it.err) + '</div>'
            : '<div class="tb-sec"><span class="tb-sec-label">优化后</span><pre class="tb-code">' + esc(it.opt || '（空结果）') + '</pre></div>') +
          '<div class="tb-rec-sub"><span>' + esc(it.route || '') + '</span><span>' + it.ms + 'ms</span>' +
          (it.out != null ? '<span>输出 ' + it.out + ' tok</span>' : '') +
          '<span>' + fmtClock(it.t) + '</span>' +
          (it.opt ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy" data-i="' + i + '">复制</button>' : '') +
          '</div>' +
        '</div>')
      }
      if (!h.length) parts.push('<div class="tb-notice">优化结果显示在这里（最近 10 条落盘保留）</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { draft: '', style: '通用', history: [], notice: null, provider: '', model: '' }
      if (typeof fields.draft === 'string') st.draft = fields.draft
      if (typeof fields.style === 'string' && fields.style) st.style = fields.style
      if (typeof fields.provider === 'string' && fields.provider) st.provider = fields.provider
      if (typeof fields.model === 'string' && fields.model) st.model = fields.model
      if (STYLES.indexOf(st.style) < 0) st.style = STYLES[0]

      if (action === 'route') {
        st.model = ''
      } else if (action === 'clear') {
        st.history = []
        const persisted = await writeJsonStore(ctx, REL_STORE, [], ws.root, ws.session)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
      } else if (action === 'opt' && st.draft && st.draft.trim()) {
        await ai.resolveRoute(st)
        const sys = '你是提示词工程专家。把用户的粗糙草稿改写为高质量结构化提示词，包含【角色】【任务】【背景】【约束】【输出格式】五个小节（不适用的可省略）；风格倾向：' + st.style + '；语言跟随草稿（中文草稿用中文，英文草稿用英文）；只输出优化后的提示词本身，不要解释、不要代码块围栏。'
        const r = await ai.chat(st, sys, st.draft.trim(), undefined, { root: ws.root, session: ws.session, tool: 'promptopt' })
        st.history = [{
          draft: st.draft.trim().slice(0, 300), opt: (r.a || '').slice(0, 6000), err: r.err || null,
          style: st.style, ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: Date.now(),
        }].concat(st.history || []).slice(0, 10)
        const persisted = await writeJsonStore(ctx, REL_STORE, st.history, ws.root, ws.session)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
      } else if (action === '') {
        const saved = await readJsonStore(ctx, REL_STORE, ws.root, null)
        if (Array.isArray(saved)) st.history = saved
        st.notice = null
      }
      const route = await ai.resolveRoute(st)
      const roll = await ai.rollup(ws.root, 'promptopt')
      const out = { ok: true, html: render(st, route, roll), state: st }
      if (action === 'copy') {
        const it = (st.history || [])[Number((fields.__el || {}).i)]
        if (it && it.opt) out.copy = it.opt
      }
      return out
    }

    tryRegisterTool(ctx, { id: 'promptopt', label: '提示优化', order: 17 }, handler)
  },
}
