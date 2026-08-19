// ===== git-tool.js：Git 历史工具（Host-only，HTML 面板经工具箱 RPC 渲染）=====
// 视图状态机：list / detail / diff；动作：refresh、more、open(hash)、diff(path)、wdiff(path)、back
// 变更清单点击文件 → 工作区/暂存区 diff（未暂存优先；未跟踪新文件走 git diff --no-index /dev/null）
// diff 本体留闭包 lastDiff（可能很大，不进 state——state 每次动作来回传输，必须轻量）
// 状态：{ view, branch, staged, unstaged, untracked, ahead, behind, files, commits, hasMore, offset, detail, diffFrom }

return {
  name: 'git-tool',
  inject: ['subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    let lastDiff = null // { text, name, note } diff 本体（闭包持有，不进 state；重跑即清空回列表/详情）

    const resolveWs = (rootArg) => {
      if (rootArg && /^([A-Za-z]:[\\/]|\/)/.test(rootArg)) {
        return rootArg.replace(/[\\/]+$/, '')
      }
      const sessionsSvc = ctx.get('sessions')
      if (sessionsSvc) {
        try {
          for (const s of sessionsSvc.list()) {
            const cwd = s && s.header && s.header.cwd
            if (typeof cwd === 'string' && cwd && cwd) return cwd.replace(/[\\/]+$/, '')
          }
        } catch (e) {}
      }
      const sp = ctx.get('sandboxPolicy')
      return sp && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot.replace(/[\\/]+$/, '') : ''
    }

    const runGit = async (args, root) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const handle = subprocess.spawn({
          argv: ['git', ...args],
          cwd: root,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 16 * 1024 * 1024 }, stderr: { maxBytes: 256 * 1024 } },
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

    // 仓库顶层目录（porcelain/numstat 路径都相对它）：工作区是子目录时 diff pathspec 仍能对上
    const topCache = {}
    const repoTop = async (root) => {
      if (topCache[root] !== undefined) return topCache[root]
      const r = await runGit(['rev-parse', '--show-toplevel'], root)
      topCache[root] = r.ok && String(r.out || '').trim() ? String(r.out).trim() : null
      return topCache[root]
    }

    const loadStatus = async (root) => {
      const br = await runGit(['symbolic-ref', '--short', 'HEAD'], root)
      if (!br.ok) {
        const rp = await runGit(['rev-parse', '--short', 'HEAD'], root)
        if (!rp.ok) return { error: firstLine(br.err) || firstLine(rp.err) || 'not a git repository' }
        return { branch: '(detached ' + (rp.out || '').trim() + ')', staged: 0, unstaged: 0, untracked: 0, ahead: null, behind: null, files: [] }
      }
      const branch = (br.out || '').trim() || 'HEAD'
      // -z：路径零转义零引用（中文名可读、可直接当 diff pathspec）；R/C 条目下一条记录是源路径（跳过）
      const st = await runGit(['status', '--porcelain', '-z'], root)
      let staged = 0
      let unstaged = 0
      let untracked = 0
      const files = []
      const recs = (st.out || '').split('\0')
      for (let i = 0; i < recs.length; i++) {
        const line = recs[i]
        if (!line) continue
        const xy = line.slice(0, 2)
        const filePath = line.substring(3)
        if (xy[0] === 'R' || xy[0] === 'C') i++ // 跳过重命名/复制的源路径记录
        let display = ' '
        if (xy === '??') { display = 'U'; untracked++ }
        else {
          if (xy[0] !== ' ' && xy[0] !== '?') { display = xy[0]; staged++ }
          if (xy[1] !== ' ' && xy[1] !== '?') { unstaged++ }
          if (display === ' ' && xy[1] !== ' ' && xy[1] !== '?') display = xy[1]
        }
        files.push({ path: filePath, status: display, xy })
      }
      let ahead = null
      let behind = null
      const up = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root)
      if (up.ok) {
        const a = await runGit(['rev-list', '--count', '@{upstream}..HEAD'], root)
        const b = await runGit(['rev-list', '--count', 'HEAD..@{upstream}'], root)
        ahead = a.ok ? (parseInt((a.out || '0').trim(), 10) || 0) : null
        behind = b.ok ? (parseInt((b.out || '0').trim(), 10) || 0) : null
      }
      return { branch, staged, unstaged, untracked, ahead, behind, files }
    }

    const loadHistory = async (root, skip, limit) => {
      const r = await runGit(['log', '--skip=' + skip, '-n', String(limit + 1), '--pretty=format:%x1e%H%x1f%an%x1f%aI%x1f%s'], root)
      if (!r.ok) {
        if (/does not have any commits yet|ambiguous argument/i.test(r.err)) return { commits: [], hasMore: false, error: null }
        return { commits: [], hasMore: false, error: firstLine(r.err) || 'git log failed' }
      }
      const commits = []
      for (const block of (r.out || '').split('\x1e')) {
        if (!block) continue
        const parts = block.split('\x1f')
        const hash = parts[0] || ''
        if (!hash) continue
        commits.push({ hash, short: hash.slice(0, 7), author: parts[1] || '', date: parts[2] || '', subject: parts.slice(3).join('\x1f') || '' })
      }
      return { commits: commits.slice(0, limit), hasMore: commits.length > limit, error: null }
    }

    const loadCommit = async (root, hash) => {
      if (!/^[0-9a-fA-F]{7,40}$/.test(hash)) return { error: '非法的 commit hash' }
      const r = await runGit(['show', '--numstat', '--format=%x1e%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e', hash], root)
      if (!r.ok) return { error: firstLine(r.err) || 'git show failed' }
      const parts = (r.out || '').split('\x1e')
      const head = parts[1] || ''
      const body = (parts[2] || '').replace(/^\s+/, '')
      const files = []
      for (const line of body.split(/\r?\n/)) {
        if (!line) continue
        const m = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/)
        if (!m) continue
        files.push({ path: m[3], additions: m[1] === '-' ? null : Number(m[1]), deletions: m[2] === '-' ? null : Number(m[2]) })
      }
      const hp = head.split('\x1f')
      return { commit: { hash: hp[0] || '', short: (hp[0] || '').slice(0, 7), author: hp[1] || '', date: hp[2] || '', subject: hp[3] || '', message: hp.slice(4).join('\x1f').trim(), files } }
    }

    const loadDiff = async (root, hash, path) => {
      if (!/^[0-9a-fA-F]{7,40}$/.test(hash)) return { error: '非法的 commit hash' }
      if (!path || path.length > 1000 || path.indexOf('\x00') >= 0) return { error: '非法的文件路径' }
      const r = await runGit(['show', '--format=', '--no-color', hash, '--', path], root)
      if (!r.ok) return { error: firstLine(r.err) || 'git diff failed' }
      return { diff: r.out || '' }
    }

    // 工作区/暂存区变更 diff（变更清单点击）：xy 为 porcelain 两位状态。
    // 未暂存（xy[1]）优先；其次已暂存（xy[0]）；未跟踪新文件走 --no-index /dev/null（有差异时 exit 1 属正常）
    const loadWorkDiff = async (root, path, xy) => {
      if (!path || path.length > 1000 || path.indexOf('\x00') >= 0) return { error: '非法的文件路径' }
      if (xy === '??') {
        const r = await runGit(['diff', '--no-index', '--no-color', '--', '/dev/null', path], root)
        if (!r.ok && r.code !== 1) return { error: firstLine(r.err) || '读取新文件失败' }
        return { diff: r.out || '', note: '新文件（未跟踪）· 全文即新增' }
      }
      if (xy && xy[1] && xy[1] !== ' ' && xy[1] !== '?') {
        const r = await runGit(['diff', '--no-color', '--', path], root)
        if (!r.ok) return { error: firstLine(r.err) || 'git diff failed' }
        return { diff: r.out || '', note: '工作区（未暂存）变更' }
      }
      const r = await runGit(['diff', '--cached', '--no-color', '--', path], root)
      if (!r.ok) return { error: firstLine(r.err) || 'git diff --cached failed' }
      return { diff: r.out || '', note: '已暂存变更' }
    }

    const fmtDate = (iso) => {
      if (!iso) return ''
      const d = new Date(iso)
      if (isNaN(d.getTime())) return esc(iso)
      return esc(d.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }))
    }
    const STATUS_CLS = { M: 'tb-tx-warn', A: 'tb-tx-done', D: 'tb-tx-danger', R: 'tb-tx-active', C: 'tb-tx-done', U: 'tb-tx-muted' }

    const renderList = (st) => {
      const parts = []
      parts.push('<div class="tb-row">')
      if (st.branch) parts.push('<span class="tb-key" title="当前分支">⎇ ' + esc(st.branch) + '</span>')
      if (st.staged > 0) parts.push('<span class="tb-pill tb-pill-done" title="已暂存变更">已暂存 ' + st.staged + '</span>')
      if (st.unstaged > 0) parts.push('<span class="tb-pill tb-pill-other" title="未暂存变更">修改 ' + st.unstaged + '</span>')
      if (st.untracked > 0) parts.push('<span class="tb-pill tb-pill-todo" title="未跟踪文件">未跟踪 ' + st.untracked + '</span>')
      if (st.ahead != null && st.ahead > 0) parts.push('<span class="tb-pill tb-pill-done" title="领先上游提交数">↑' + st.ahead + '</span>')
      if (st.behind != null && st.behind > 0) parts.push('<span class="tb-pill tb-pill-other" title="落后上游提交数">↓' + st.behind + '</span>')
      parts.push('<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button>')
      parts.push('</div>')
      if ((st.files || []).length > 0) {
        parts.push('<div class="tb-sec"><div class="tb-sec-label">变更 · ' + st.files.length + '（点击查看 diff）</div><div>' + st.files.slice(0, 120).map((f) =>
          '<div class="tb-line" data-action="wdiff" data-path="' + esc(f.path) + '" data-xy="' + esc(f.xy || '') + '" title="点击查看变更 diff" style="cursor:pointer"><span class="tb-line-status ' + (STATUS_CLS[f.status] || 'tb-tx-muted') + '">' + esc(f.status) + '</span><span class="tb-line-path" title="' + esc(f.path) + '">' + esc(f.path) + '</span></div>'
        ).join('') + '</div></div>')
        if (st.files.length > 120) parts.push('<div class="tb-note" style="padding-top:4px">…及更多 ' + (st.files.length - 120) + ' 项</div>')
        parts.push('<div class="tb-hr"></div>')
      }
      const commits = st.commits || []
      if (commits.length === 0) {
        parts.push('<div class="tb-note" style="text-align:center;padding:14px 0">暂无提交历史</div>')
      } else {
        parts.push('<div class="tb-list">' + commits.map((c) =>
          '<div class="tb-rec" data-action="open" data-hash="' + esc(c.hash) + '" title="点击查看提交详情">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-rec-key">' + esc(c.short) + '</span><span class="tb-rec-summary">' + esc(c.subject || '(无标题)') + '</span></div>' +
              '<div class="tb-rec-sub"><span>' + esc(c.author || '') + '</span><span>' + fmtDate(c.date) + '</span></div>' +
            '</div>' +
          '</div>'
        ).join('') + '</div>')
        if (st.hasMore) parts.push('<button type="button" class="tb-btn" data-action="more">加载更多</button>')
      }
      return '<div class="jr-tabpanel tb-root">' + parts.join('') + '</div>'
    }

    const renderDetail = (st) => {
      const d = st.detail
      const parts = []
      parts.push('<div class="tb-row"><button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="back">‹ 返回</button></div>')
      parts.push('<div class="tb-card">' +
        '<div class="tb-card-head"><span class="tb-key">' + esc(d.short) + '</span><div class="tb-title">' + esc(d.subject || '(无标题)') + '</div></div>' +
        '<div class="tb-rec-sub"><span>' + esc(d.author || '') + '</span><span>' + fmtDate(d.date) + '</span></div>' +
        (d.message ? '<div class="tb-desc">' + esc(d.message) + '</div>' : '') +
      '</div>')
      const files = d.files || []
      parts.push('<div class="tb-sec"><div class="tb-sec-label">文件变更 · ' + files.length + '</div>' +
        (files.length
          ? '<div class="tb-files">' + files.map((f) =>
              '<div class="tb-file" data-action="diff" data-path="' + esc(f.path) + '" title="点击查看 diff">' +
                '<span class="tb-file-name tb-mono">' + esc(f.path) + '</span>' +
                (f.additions != null ? '<span class="tb-num tb-tx-done">+' + f.additions + '</span>' : '') +
                (f.deletions != null ? '<span class="tb-num tb-tx-danger">-' + f.deletions + '</span>' : '') +
              '</div>'
            ).join('') + '</div>'
          : '<div class="tb-note">无文件变更</div>') +
      '</div>')
      return '<div class="jr-tabpanel tb-root">' + parts.join('') + '</div>'
    }

    const renderDiff = (st) => {
      const d = lastDiff || { text: '', name: '', note: '' }
      return '<div class="jr-tabpanel tb-root">' +
        '<div class="tb-row">' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="back-diff">‹ 返回</button>' +
          (d.note ? '<span class="tb-pill tb-pill-other">' + esc(d.note) + '</span>' : '') +
          '<span class="tb-file-name tb-mono" style="flex:1;word-break:break-all;white-space:normal">' + esc(d.name || '') + '</span>' +
        '</div>' +
        (d.text
          ? '<pre class="tb-code">' + esc(d.text) + '</pre>'
          : '<div class="tb-notice">（无文本差异）</div>') +
      '</div>'
    }

    const handler = async ({ action, fields, state, root }) => {
      const wsRoot = resolveWs(root)
      if (!wsRoot) return { ok: false, error: '无法确定工作区根', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : {
        view: 'list', branch: null, staged: 0, unstaged: 0, untracked: 0,
        ahead: null, behind: null, files: [], commits: [], hasMore: false, offset: 0,
        detail: null, diffFrom: null, error: null,
      }
      try {
        const elHash = fields.__el && fields.__el.hash ? fields.__el.hash : fields.hash
        const elPath = fields.__el && fields.__el.path ? fields.__el.path : fields.path
        const elXy = fields.__el && typeof fields.__el.xy === 'string' ? fields.__el.xy : ''
        // state 迁移：diff 本体已挪闭包（旧 state 可能还挂着 diff/diffName/diffNote 大字段）
        delete st.diff; delete st.diffName; delete st.diffNote
        if (action === 'open' && elHash) {
          const res = await loadCommit(wsRoot, String(elHash))
          if (res.error) { st.error = res.error }
          else { st.detail = res.commit; st.view = 'detail'; lastDiff = null }
        } else if (action === 'diff' && elPath && st.detail) {
          const gr = (await repoTop(wsRoot)) || wsRoot // numstat 路径相对仓库顶层
          const res = await loadDiff(gr, st.detail.hash, String(elPath))
          if (res.error) st.error = res.error
          else { lastDiff = { text: res.diff, name: String(elPath), note: '' }; st.view = 'diff'; st.diffFrom = 'detail' }
        } else if (action === 'wdiff' && elPath) {
          const gr = (await repoTop(wsRoot)) || wsRoot // porcelain 路径相对仓库顶层
          const res = await loadWorkDiff(gr, String(elPath), elXy)
          if (res.error) st.error = res.error
          else { lastDiff = { text: res.diff, name: String(elPath), note: res.note || '' }; st.view = 'diff'; st.diffFrom = 'list' }
        } else if (action === 'back') {
          st.view = 'list'; st.detail = null; lastDiff = null
        } else if (action === 'back-diff') {
          st.view = st.diffFrom === 'list' ? 'list' : 'detail'
          lastDiff = null
          if (st.view === 'detail' && !st.detail) st.view = 'list'
        } else if (action === 'more') {
          const res = await loadHistory(wsRoot, st.offset, 30)
          if (res.error) st.error = res.error
          else { st.commits = (st.commits || []).concat(res.commits || []); st.offset += res.commits.length; st.hasMore = res.hasMore }
        } else if (action === 'refresh' || action === '' || action === undefined) {
          const s = await loadStatus(wsRoot)
          if (s.error) { st.error = s.error }
          else { st.branch = s.branch; st.staged = s.staged; st.unstaged = s.unstaged; st.untracked = s.untracked; st.ahead = s.ahead; st.behind = s.behind; st.files = s.files }
          if (action !== 'refresh' || st.commits.length === 0) {
            const h = await loadHistory(wsRoot, 0, 30)
            if (!h.error) { st.commits = h.commits; st.offset = h.commits.length; st.hasMore = h.hasMore }
            else st.error = h.error
          }
          st.view = 'list'
          lastDiff = null
        }
        const html = (st.error ? '<div class="tb-banner tb-banner-error">' + esc(st.error) + '</div>' : '') +
          (st.view === 'diff' && lastDiff ? renderDiff(st) : (st.view === 'detail' && st.detail ? renderDetail(st) : renderList(st)))
        const next = { ...st }
        delete next.error
        return { ok: true, html, state: next }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '' }
      }
    }

    tryRegisterTool(ctx, { id: 'git', label: 'Git 历史', order: 1, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="4" cy="4" r="1.7"/><circle cx="12" cy="4" r="1.7"/><circle cx="12" cy="12" r="1.7"/><path d="M5.7 4H10.3"/><path d="M12 5.7V10.3"/></svg>' }, handler)
  },
}