// ===== review-tool.js：AI 代码评审（Host-only，经工具箱 RPC 注册）=====
// 工作区相对路径读文件（fs 服务，截断 20000 字符）或粘贴代码 → llm.stream 三级评审 + 评分。
// 最近 5 条落盘 .dsh-dynamic-toolbox/toolbox-review.json。状态：{ path, code, history[], notice, provider, model }

return {
  name: 'review-tool',
  inject: ['fs', 'llm', 'agentDefaultModel', 'timer'],
  apply(ctx) {
    const ai = makeLlmHelper(ctx)
    const REL_STORE = '.dsh-dynamic-toolbox/toolbox-review.json'
    const CODE_CAP = 20000
    const LANGS = { js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TSX', jsx: 'JSX', json: 'JSON', py: 'Python', java: 'Java', go: 'Go', rs: 'Rust', yml: 'YAML', yaml: 'YAML', md: 'Markdown', html: 'HTML', css: 'CSS', ps1: 'PowerShell', sh: 'Shell', sql: 'SQL', vue: 'Vue' }

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
    const langOf = (p) => {
      const m = String(p || '').toLowerCase().match(/\.([a-z0-9]+)$/)
      return m && LANGS[m[1]] ? LANGS[m[1]] : (m ? m[1] : '')
    }

    const render = (st, route, roll) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push(ai.routeRow(st, route, '旁路调用 · 不写入会话' + (roll && roll.calls ? ' · 累计 ' + roll.calls + ' 次 / 输出 ' + roll.out + ' tok' : '')))
      parts.push('<div class="tb-sec"><span class="tb-sec-label">文件路径（工作区相对，优先于粘贴代码）</span>' +
        '<input class="tb-input tb-mono" data-field="path" placeholder="如 shared/host.js" value="' + esc(st.path || '') + '"></div>')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">或直接粘贴代码</span>' +
        '<textarea class="tb-textarea" data-field="code" placeholder="路径留空时评审这里粘贴的代码">' + esc(st.code || '') + '</textarea></div>')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="review">开始评审</button>' +
        ((st.history || []).length ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空历史</button>' : '') +
      '</div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      const h = st.history || []
      for (let i = 0; i < h.length; i++) {
        const it = h[i]
        parts.push('<div class="tb-card">' +
          '<div class="tb-sec"><span class="tb-sec-label">' + esc(it.target || '') + (it.chars ? '（' + it.chars + ' 字符' + (it.truncated ? '，已截断' : '') + '）' : '') + '</span></div>' +
          (it.err
            ? '<div class="tb-banner tb-banner-error">' + esc(it.err) + '</div>'
            : '<pre class="tb-code">' + esc(it.report || '（空报告）') + '</pre>') +
          '<div class="tb-rec-sub"><span>' + esc(it.route || '') + '</span><span>' + it.ms + 'ms</span>' +
          (it.out != null ? '<span>输出 ' + it.out + ' tok</span>' : '') +
          '<span>' + fmtClock(it.t) + '</span>' +
          (it.report ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy" data-i="' + i + '">复制</button>' : '') +
          '</div>' +
        '</div>')
      }
      if (!h.length) parts.push('<div class="tb-notice">评审报告显示在这里（最近 5 条落盘保留）</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { path: '', code: '', history: [], notice: null, provider: '', model: '' }
      if (typeof fields.path === 'string') st.path = fields.path
      if (typeof fields.code === 'string') st.code = fields.code
      if (typeof fields.provider === 'string' && fields.provider) st.provider = fields.provider
      if (typeof fields.model === 'string' && fields.model) st.model = fields.model

      if (action === 'route') {
        st.model = ''
      } else if (action === 'clear') {
        st.history = []
        const persisted = await writeJsonStore(ctx, REL_STORE, [], ws.root, ws.session)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
      } else if (action === 'review') {
        let target = ''
        let content = ''
        let truncated = false
        let lang = ''
        if (st.path && st.path.trim()) {
          target = st.path.trim()
          lang = langOf(target)
          const fs = ctx.get('fs')
          if (!fs) {
            st.notice = 'fs 服务不可用'
          } else {
            try {
              const t = await fs.resolve(target, { cwd: ws.root })
              if (!await fs.stat(t)) {
                st.notice = '文件不存在: ' + target
              } else {
                const full = await fs.readText(t)
                content = full.slice(0, CODE_CAP)
                truncated = full.length > CODE_CAP
              }
            } catch (e) {
              st.notice = '读取失败: ' + String((e && e.message) || e)
            }
          }
        } else if (st.code && st.code.trim()) {
          target = '(粘贴代码)'
          content = st.code.trim().slice(0, CODE_CAP)
          truncated = st.code.trim().length > CODE_CAP
        } else {
          st.notice = '请填写文件路径或粘贴代码'
        }
        if (content) {
          await ai.resolveRoute(st)
          const sys = '你是资深代码评审。输出三部分：🔴 严重问题 / 🟡 改进建议 / 🟢 可选优化，每条含位置（行号或函数名）、问题与具体改法；末尾给总体评分 x/10 与一句总结。中文、精炼、Markdown 列表，不要客套话。'
          const user = '文件：' + target + (lang ? '（' + lang + '）' : '') + '\n```\n' + content + '\n```' + (truncated ? '\n（内容过长，仅评审前 ' + CODE_CAP + ' 字符）' : '')
          const r = await ai.chat(st, sys, user, undefined, { root: ws.root, session: ws.session, tool: 'review' })
          st.history = [{
            target, chars: content.length, truncated, report: (r.a || '').slice(0, 8000), err: r.err || null,
            ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: Date.now(),
          }].concat(st.history || []).slice(0, 5)
          const persisted = await writeJsonStore(ctx, REL_STORE, st.history, ws.root, ws.session)
          st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
        }
      } else if (action === '') {
        const saved = await readJsonStore(ctx, REL_STORE, ws.root, null)
        if (Array.isArray(saved)) st.history = saved
        st.notice = null
      }
      const route = await ai.resolveRoute(st)
      const roll = await ai.rollup(ws.root, 'review')
      const out = { ok: true, html: render(st, route, roll), state: st }
      if (action === 'copy') {
        const it = (st.history || [])[Number((fields.__el || {}).i)]
        if (it && it.report) out.copy = it.report
      }
      return out
    }

    tryRegisterTool(ctx, { id: 'review', label: '评审', order: 19 }, handler)
  },
}
