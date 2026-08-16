// ===== translate-tool.js：AI 翻译（Host-only，经工具箱 RPC 注册）=====
// llm.stream 旁路翻译（共享 makeLlmHelper 路由），不写入会话；历史落盘 .dsh-dynamic-toolbox/toolbox-translate.json。
// 状态：{ text, target, history[], notice, provider, model }

return {
  name: 'translate-tool',
  inject: ['fs', 'llm', 'agentDefaultModel', 'timer'],
  apply(ctx) {
    const ai = makeLlmHelper(ctx)
    const REL_STORE = '.dsh-dynamic-toolbox/toolbox-translate.json'
    const TARGETS = ['简体中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español', 'Русский']

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }

    const render = (st, route, roll) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push(ai.routeRow(st, route, '旁路调用 · 不写入会话' + (roll && roll.calls ? ' · 累计 ' + roll.calls + ' 次 / 输出 ' + roll.out + ' tok' : '')))
      parts.push('<div class="tb-row">' +
        '<span class="tb-sec-label">目标语言</span>' +
        '<select class="tb-select" data-field="target">' +
          TARGETS.map((t) => '<option value="' + esc(t) + '"' + (t === st.target ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
        '</select></div>')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">原文</span>' +
        '<textarea class="tb-textarea" data-field="text" placeholder="粘贴或输入要翻译的内容（保留 Markdown / 代码格式）">' + esc(st.text || '') + '</textarea></div>')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="translate">翻译</button>' +
        ((st.history || []).length ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空历史</button>' : '') +
      '</div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      const h = st.history || []
      for (let i = 0; i < h.length; i++) {
        const it = h[i]
        parts.push('<div class="tb-card">' +
          '<div class="tb-sec"><span class="tb-sec-label">原文 → ' + esc(it.target || '') + '</span>' +
          '<div style="font-size:12.5px;white-space:pre-wrap;word-break:break-word">' + esc(it.src) + '</div></div>' +
          (it.err
            ? '<div class="tb-banner tb-banner-error">' + esc(it.err) + '</div>'
            : '<pre class="tb-code">' + esc(it.dst || '（空译文）') + '</pre>') +
          '<div class="tb-rec-sub"><span>' + esc(it.route || '') + '</span><span>' + it.ms + 'ms</span>' +
          (it.out != null ? '<span>输出 ' + it.out + ' tok</span>' : '') +
          '<span>' + fmtClock(it.t) + '</span>' +
          (it.dst ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy" data-i="' + i + '">复制</button>' : '') +
          '</div>' +
        '</div>')
      }
      if (!h.length) parts.push('<div class="tb-notice">翻译结果显示在这里（最近 10 条落盘保留）</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { text: '', target: 'English', history: [], notice: null, provider: '', model: '' }
      if (typeof fields.text === 'string') st.text = fields.text
      if (typeof fields.target === 'string' && fields.target) st.target = fields.target
      if (typeof fields.provider === 'string' && fields.provider) st.provider = fields.provider
      if (typeof fields.model === 'string' && fields.model) st.model = fields.model
      if (TARGETS.indexOf(st.target) < 0) st.target = TARGETS[0]

      if (action === 'route') {
        st.model = ''
      } else if (action === 'clear') {
        st.history = []
        const persisted = await writeJsonStore(ctx, REL_STORE, [], ws.root, ws.session)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
      } else if (action === 'translate' && st.text && st.text.trim()) {
        await ai.resolveRoute(st)
        const sys = '你是专业翻译引擎。规则：只输出译文本身，不输出任何解释、注音、拼音或多余引号；完整保留原文的换行、Markdown 标记与代码格式。目标语言：' + st.target
        const r = await ai.chat(st, sys, st.text.trim(), undefined, { root: ws.root, session: ws.session, tool: 'translate' })
        st.history = [{
          src: st.text.trim().slice(0, 500), dst: (r.a || '').slice(0, 4000), err: r.err || null,
          target: st.target, ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: Date.now(),
        }].concat(st.history || []).slice(0, 10)
        const persisted = await writeJsonStore(ctx, REL_STORE, st.history, ws.root, ws.session)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
      } else if (action === '') {
        const saved = await readJsonStore(ctx, REL_STORE, ws.root, null)
        if (Array.isArray(saved)) st.history = saved
        st.notice = null
      }
      const route = await ai.resolveRoute(st)
      const roll = await ai.rollup(ws.root, 'translate')
      const out = { ok: true, html: render(st, route, roll), state: st }
      if (action === 'copy') {
        const it = (st.history || [])[Number((fields.__el || {}).i)]
        if (it && it.dst) out.copy = it.dst
      }
      return out
    }

    tryRegisterTool(ctx, { id: 'translate', label: '翻译', order: 16 }, handler)
  },
}
