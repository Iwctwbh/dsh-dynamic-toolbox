// ===== commitmsg-tool.js：AI 提交信息生成（Host-only，经工具箱 RPC 注册）=====
// git diff（暂存区优先，空则退回工作区）→ llm.stream 生成 Conventional Commits 中文提交信息。
// git 直 argv spawn（无 shell 转义坑）；最近 5 条落盘 .dsh-dynamic-toolbox/toolbox-commitmsg.json。
// 状态：{ extra, info, history[], notice, provider, model }；diff 本体留闭包（不进 state）。

return {
  name: 'commitmsg-tool',
  inject: ['fs', 'subprocess', 'llm', 'agentDefaultModel', 'timer'],
  apply(ctx) {
    const ai = makeLlmHelper(ctx)
    const subprocess = ctx.get('subprocess')
    const REL_STORE = '.dsh-dynamic-toolbox/toolbox-commitmsg.json'
    const DIFF_CAP = 8000

    let lastDiff = null // { scope: 'staged'|'unstaged', text, truncated }

    const runGit = async (args, root) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const handle = subprocess.spawn({
          argv: ['git', ...args],
          cwd: root,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 256 * 1024 } },
          graceMs: 60000,
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout.readFrom(0).text
        const stderr = handle.collected.stderr.readFrom(0).text
        return { ok: outcome.exitCode === 0, code: outcome.exitCode, out: stdout, err: stderr }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
    const firstLine = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 3).join(' | ')
    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }

    const scan = async (root) => {
      const st = await runGit(['status', '--porcelain'], root)
      if (!st.ok) return { error: firstLine(st.err) || 'not a git repository' }
      let staged = 0, unstaged = 0, untracked = 0
      for (const line of (st.out || '').split(/\r?\n/)) {
        if (!line) continue
        const xy = line.slice(0, 2)
        if (xy === '??') { untracked++; continue }
        if (xy[0] !== ' ' && xy[0] !== '?') staged++
        if (xy[1] !== ' ' && xy[1] !== '?') unstaged++
      }
      let scope = 'staged'
      let d = await runGit(['diff', '--staged'], root)
      if (!d.ok) return { error: firstLine(d.err) || 'git diff 失败' }
      if (!(d.out || '').trim()) {
        scope = 'unstaged'
        d = await runGit(['diff'], root)
        if (!d.ok) return { error: firstLine(d.err) || 'git diff 失败' }
      }
      const full = (d.out || '').trim()
      lastDiff = { scope, text: full.slice(0, DIFF_CAP), truncated: full.length > DIFF_CAP }
      return { staged, unstaged, untracked, scope, chars: full.length, truncated: lastDiff.truncated, empty: !full }
    }

    const render = (st, route, roll) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push(ai.routeRow(st, route, '旁路调用 · 不写入会话' + (roll && roll.calls ? ' · 累计 ' + roll.calls + ' 次 / 输出 ' + roll.out + ' tok' : '')))
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn" data-action="scan">扫描改动</button>' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="gen">生成提交信息</button>' +
        ((st.history || []).length ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空历史</button>' : '') +
      '</div>')
      if (st.info) {
        if (st.info.error) {
          parts.push('<div class="tb-banner tb-banner-error">' + esc(st.info.error) + '</div>')
        } else {
          parts.push('<div class="tb-banner tb-banner-info">' +
            '暂存 ' + st.info.staged + ' · 未暂存 ' + st.info.unstaged + ' · 未跟踪 ' + st.info.untracked +
            (st.info.empty ? ' · 暂存区与工作区 diff 均为空（未跟踪文件不参与 diff）'
              : ' · 取用 ' + (st.info.scope === 'staged' ? '暂存区' : '工作区') + ' diff ' + st.info.chars + ' 字符' + (st.info.truncated ? '（超 ' + DIFF_CAP + ' 已截断）' : '')) +
            '</div>')
        }
      }
      parts.push('<div class="tb-sec"><span class="tb-sec-label">补充说明（可选，随 diff 一起发给模型）</span>' +
        '<input class="tb-input" data-field="extra" placeholder="如：这次改动是为了修复重建时主题丢失" value="' + esc(st.extra || '') + '"></div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      const h = st.history || []
      for (let i = 0; i < h.length; i++) {
        const it = h[i]
        parts.push('<div class="tb-card">' +
          (it.err
            ? '<div class="tb-banner tb-banner-error">' + esc(it.err) + '</div>'
            : '<pre class="tb-code">' + esc(it.msg || '（空结果）') + '</pre>') +
          '<div class="tb-rec-sub"><span>' + esc(it.scope === 'staged' ? '暂存区' : '工作区') + '</span><span>' + esc(it.route || '') + '</span><span>' + it.ms + 'ms</span>' +
          (it.out != null ? '<span>输出 ' + it.out + ' tok</span>' : '') +
          '<span>' + fmtClock(it.t) + '</span>' +
          (it.msg ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy" data-i="' + i + '">复制</button>' : '') +
          '</div>' +
        '</div>')
      }
      if (!h.length) parts.push('<div class="tb-notice">先「扫描改动」，再「生成提交信息」（最近 5 条落盘保留）</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { extra: '', info: null, history: [], notice: null, provider: '', model: '' }
      if (typeof fields.extra === 'string') st.extra = fields.extra
      if (typeof fields.provider === 'string' && fields.provider) st.provider = fields.provider
      if (typeof fields.model === 'string' && fields.model) st.model = fields.model

      if (action === 'route') {
        st.model = ''
      } else if (action === 'clear') {
        st.history = []
        const persisted = await writeJsonStore(ctx, REL_STORE, [], ws.root, ws.session)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
      } else if (action === 'scan' || action === '') {
        if (action === 'scan' || !st.info) st.info = await scan(ws.root)
        if (action === '') {
          const saved = await readJsonStore(ctx, REL_STORE, ws.root, null)
          if (Array.isArray(saved)) st.history = saved
          st.notice = null
        }
      } else if (action === 'gen') {
        if (!lastDiff) st.info = await scan(ws.root)
        if (st.info && st.info.error) {
          // 扫描失败，banner 已呈现
        } else if (!lastDiff || !lastDiff.text) {
          st.notice = '没有可提交的 diff（新文件请先 git add）'
        } else {
          await ai.resolveRoute(st)
          const sys = '你是提交信息撰写助手。依据给定 git diff 生成一条符合 Conventional Commits 的提交信息：首行 “type(scope): 中文主题”（≤50 字，type 从 feat/fix/refactor/docs/chore/test/perf/style 中选，scope 可省略）；改动复杂时空一行，每行以 “- ” 列出要点；只输出提交信息本身，不要代码块围栏、不要解释。'
          const user = (st.extra && st.extra.trim() ? '补充说明：' + st.extra.trim() + '\n\n' : '') +
            'git diff（' + (lastDiff.scope === 'staged' ? '暂存区' : '工作区') + (lastDiff.truncated ? '，已截断' : '') + '）：\n' + lastDiff.text
          const r = await ai.chat(st, sys, user, undefined, { root: ws.root, session: ws.session, tool: 'commitmsg' })
          st.history = [{
            msg: (r.a || '').slice(0, 2000), err: r.err || null, scope: lastDiff.scope,
            ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: Date.now(),
          }].concat(st.history || []).slice(0, 5)
          const persisted = await writeJsonStore(ctx, REL_STORE, st.history, ws.root, ws.session)
          st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
        }
      }
      const route = await ai.resolveRoute(st)
      const roll = await ai.rollup(ws.root, 'commitmsg')
      const out = { ok: true, html: render(st, route, roll), state: st }
      if (action === 'copy') {
        const it = (st.history || [])[Number((fields.__el || {}).i)]
        if (it && it.msg) out.copy = it.msg
      }
      return out
    }

    tryRegisterTool(ctx, { id: 'commitmsg', label: '提交信息', order: 18 }, handler)
  },
}
