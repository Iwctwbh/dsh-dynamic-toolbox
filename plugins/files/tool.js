// ===== files-tool.js：工作区文件工具（Host-only，HTML 面板经工具箱 RPC 渲染）=====
// 状态：{ dirs: {路径: 条目[]}, expanded: {路径: bool} }，由客户端回传（无损 JSON）

return {
  name: 'files-tool',
  inject: ['fs', 'timer'],
  apply(ctx) {
    const fsService = ctx.get('fs')

    const resolveWs = (rootArg) => {
      if (rootArg && /^([A-Za-z]:[\\/]|\/)/.test(rootArg)) {
        return { root: rootArg.replace(/[\\/]+$/, ''), session: null }
      }
      const sessionsSvc = ctx.get('sessions')
      if (sessionsSvc) {
        try {
          let hit = null
          for (const s of sessionsSvc.list()) {
            const cwd = s && s.header && s.header.cwd
            if (typeof cwd === 'string' && cwd) hit = s
          }
          if (hit) return { root: hit.header.cwd.replace(/[\\/]+$/, ''), session: hit }
        } catch (e) {}
      }
      const sp = ctx.get('sandboxPolicy')
      const root = sp && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot.replace(/[\\/]+$/, '') : ''
      return { root, session: null }
    }

    const sortEntries = (entries) => entries
      .slice()
      .sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return (a.name || '').localeCompare(b.name || '')
      })
      .map((e) => ({ name: e.name, type: e.type, size: typeof e.size === 'number' ? e.size : null }))

    const ensureRoot = async (st, base) => {
      if (st.dirs['/']) return
      const target = await fsService.resolve('.', { cwd: base })
      st.dirs['/'] = sortEntries(await fsService.listDir(target))
    }

    // 树图标（内联 SVG，stroke 跟随 currentColor，颜色由 tb-tree-* 类控制）
    const ICO_CHEV = '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5l4.5 4.5L6 12.5"/></svg>'
    const ICO_FOLDER = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.8v6.7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V6.2a1 1 0 0 0-1-1H8.1L6.9 4a1 1 0 0 0-.7-.3H3.5a1 1 0 0 0-1 1z"/></svg>'
    const ICO_FILE = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5h4.8l3.2 3.2v7.8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/><path d="M8.8 2.5v3.2h3.2"/></svg>'

    const MAX_PER_DIR = 300 // 单文件夹渲染上限（node_modules 级目录防爆 HTML）
    const renderTree = (dirs, expanded) => {
      const rows = []
      const walk = (dirPath, depth) => {
        const key = dirPath || '/'
        const list = dirs[key] || []
        if (!list.length && dirPath) return
        const pad = (depth * 16 + 2) + 'px'
        const shown = list.length > MAX_PER_DIR ? list.slice(0, MAX_PER_DIR) : list
        for (const e of shown) {
          const fullPath = dirPath ? dirPath + '/' + e.name : e.name
          const isDir = e.type === 'directory'
          const isOpen = !!expanded[fullPath]
          if (isDir) {
            rows.push('<div class="tb-tree-row tb-tree-dir' + (isOpen ? ' tb-tree-open' : '') + '" style="padding-left:' + pad + '" data-action="expand" data-path="' + esc(fullPath) + '" title="' + esc(fullPath) + '">' +
              '<span class="tb-tree-chevron">' + ICO_CHEV + '</span>' +
              '<span class="tb-tree-ic">' + ICO_FOLDER + '</span>' +
              '<span class="tb-tree-name">' + esc(e.name) + '</span></div>')
            if (isOpen) walk(fullPath, depth + 1)
          } else {
            rows.push('<div class="tb-tree-row tb-tree-file" style="padding-left:' + pad + '" title="' + esc(fullPath) + '" data-action="preview" data-path="' + esc(fullPath) + '">' +
              '<span class="tb-tree-chevron"></span>' +
              '<span class="tb-tree-ic">' + ICO_FILE + '</span>' +
              '<span class="tb-tree-name">' + esc(e.name) + '</span>' +
              '<span class="tb-tree-size">' + fmtSize(e.size) + '</span></div>')
          }
        }
        if (list.length > MAX_PER_DIR) {
          rows.push('<div class="tb-tree-row" style="padding-left:' + pad + '"><span class="tb-tree-chevron"></span>' +
            '<span class="tb-note">… 还有 ' + (list.length - MAX_PER_DIR) + ' 个条目未显示（共 ' + list.length + '）</span></div>')
        }
      }
      walk('', 0)
      return rows.join('\n')
    }

    // 文本预览：常见代码/文本扩展名才读；其余（图片/二进制/压缩包）提示不支持
    const PREVIEW_CAP = 16 * 1024
    const TEXT_EXTS = /^(txt|md|markdown|json|jsonc|js|mjs|cjs|ts|tsx|jsx|css|html?|xml|ya?ml|toml|ini|env|sh|ps1|bat|cmd|py|java|go|rs|c|h|cpp|hpp|cs|sql|vue|svelte|log|csv|gitignore|gitattributes|editorconfig|lock|rc)$/
    const previewFile = async (rel, wsRoot) => {
      const ext = String(rel.split('.').pop() || '').toLowerCase()
      if (!TEXT_EXTS.test(ext)) return { error: '该类型（.' + ext + '）暂不支持文本预览' }
      const target = await fsService.resolve(rel, { cwd: wsRoot })
      if (!await fsService.stat(target)) return { error: '文件不存在: ' + rel }
      const text = await fsService.readText(target)
      return { text: text.length > PREVIEW_CAP ? text.slice(0, PREVIEW_CAP) : text, truncated: text.length > PREVIEW_CAP, total: text.length }
    }

    const handler = async ({ action, fields, state, root }) => {
      const ws = resolveWs(root)
      if (!ws.root) return { ok: false, error: '无法确定工作区根', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { dirs: {}, expanded: {}, preview: null, previewError: null }
      try {
        const elPath = fields.__el && fields.__el.path ? fields.__el.path : fields.path
        if (action === 'expand' && elPath) {
          const p = String(elPath)
          const willOpen = !(st.expanded || {})[p]
          st.expanded = { ...(st.expanded || {}), [p]: willOpen }
          st.dirs = st.dirs || {}
          if (willOpen && !st.dirs[p]) {
            const target = await fsService.resolve(p || '.', { cwd: ws.root })
            st.dirs[p] = sortEntries(await fsService.listDir(target))
          }
        } else if (action === 'preview' && elPath) {
          const p = String(elPath)
          // state 只记路径（本体每次动作重读，保持 state 轻量）；再点同一文件 = 收起
          st.preview = st.preview && st.preview.path === p ? null : { path: p }
        } else if (action === 'close-preview') {
          st.preview = null
        } else if (action === 'refresh') {
          st.dirs = {}
          st.expanded = {}
          st.preview = null
        }
        await ensureRoot(st, ws.root)
        const rows = renderTree(st.dirs, st.expanded || {})
        const rootName = ws.root.split(/[\\/]/).filter(Boolean).pop() || '工作区'
        let previewHtml = ''
        if (st.preview && st.preview.path) {
          try {
            const r = await previewFile(st.preview.path, ws.root)
            previewHtml = r.error
              ? '<div class="tb-banner tb-banner-info">' + esc(st.preview.path + '：' + r.error) + '</div>'
              : '<div class="tb-preview"><div class="tb-preview-head">' +
                '<span class="tb-preview-name">' + esc(st.preview.path) + '</span>' +
                '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close-preview">关闭</button></div>' +
                '<pre class="tb-code">' + esc(r.text) + (r.truncated ? '\n…（截断，共 ' + r.total + ' 字符）' : '') + '</pre></div>'
          } catch (e) {
            previewHtml = '<div class="tb-banner tb-banner-error">预览失败: ' + esc(String((e && e.message) || e)) + '</div>'
          }
        }
        const html = '<div class="jr-tabpanel tb-root">' +
            '<div class="tb-row"><span class="tb-key" title="' + esc(ws.root) + '">' + esc(rootName) + '</span>' +
            '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button></div>' +
            previewHtml +
            '<div class="tb-tree">' + rows + '</div>' +
            (rows ? '' : '<div class="tb-notice">空目录</div>') +
          '</div>'
        return { ok: true, html, state: { dirs: st.dirs, expanded: st.expanded, preview: st.preview } }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '' }
      }
    }

    tryRegisterTool(ctx, { id: 'files', label: '文件', order: 2, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5a1.5 1.5 0 0 1 1.5-1.5h3L8.5 6h4A1.5 1.5 0 0 1 14 7.5v3a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 10.5z"/></svg>' }, handler)
  },
}