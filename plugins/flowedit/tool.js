// ===== flowedit-tool.js：工作流编辑器（Host-only，经工具箱 RPC 注册）=====
// 参考 kanghelyu/dsh-deepseek-flow 的「Markdown 优先 + 流程图可视化」思路，
// 适配工具箱 HTML 面板架构（无 Client 拖拽画布，做合理取舍）：
//   · Markdown 是唯一事实来源（## 步骤 / ### gate:门 / - 是→目标 分支）
//   · 编辑区 ↔ 流程图实时预览双向同步（改 Markdown 即重渲染图）
//   · 逻辑门分支用 git 树样式渲染（├─ 是 / ╰─ 否，复用 fl- 流程图样式族）
//   · 文件落盘 <工作区>/.dsh-dynamic-toolbox/data/flows/<name>.md（pluginDataDir 约定，content 产物）
// 状态：{ files[], name, md, dirty, view, notice, confirmDel }（md 正文在 state，可编辑需要）

return {
  name: 'flowedit-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const fs = ctx.get('fs')
    const subprocess = ctx.get('subprocess')
    const REL_DIR = pluginDataDir('flows') // .dsh-dynamic-toolbox/data/flows

    // ---- 目录/读写（走仓库根 resolveDataPath：clone 部署时数据归属本仓库，不污染宿主项目）----
    // 返回 flows 目录的绝对路径字符串（供 fs cwd 与子进程 argv 共用）
    const flowsDirAbs = async (wsRoot) => {
      if (!fs) return null
      const t = await resolveDataPath(ctx, REL_DIR, wsRoot)
      return t ? fs.processPath(t) : null
    }
    const ensureDir = async (wsRoot) => {
      if (!subprocess) return
      try {
        const abs = await flowsDirAbs(wsRoot)
        if (!abs) return
        const handle = subprocess.spawn({
          argv: ['node', '-e', "require('fs').mkdirSync(process.argv[1], { recursive: true })", abs],
          cwd: wsRoot,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
          graceMs: 15000,
        })
        await handle.done
      } catch (e) {}
    }
    const listFlows = async (wsRoot) => {
      if (!fs) return []
      try {
        const abs = await flowsDirAbs(wsRoot)
        if (!abs) return []
        const dir = await fs.resolve(abs)
        if (!await fs.stat(dir)) return []
        const entries = await fs.listDir(dir)
        return (entries || [])
          .map((e) => String((e && (e.name !== undefined ? e.name : e.targetKey)) || ''))
          .map((n) => n.split(/[\\/]/).pop())
          .filter((n) => /\.md$/i.test(n))
          .map((n) => n.replace(/\.md$/i, ''))
          .sort()
      } catch (e) { return [] }
    }
    const readFlow = async (wsRoot, name) => {
      const abs = await flowsDirAbs(wsRoot)
      if (!abs) return null
      const t = await fs.resolve(name + '.md', { cwd: abs })
      if (!await fs.stat(t)) return null
      return fs.readText(t)
    }
    const saveFlow = async (wsRoot, session, name, content) => {
      await ensureDir(wsRoot)
      const abs = await flowsDirAbs(wsRoot)
      const t = await fs.resolve(name + '.md', { cwd: abs })
      await fs.writeText(t, content, undefined, undefined, storePolicy(ctx, wsRoot, session))
      return true
    }
    const deleteFlow = async (wsRoot, name) => {
      if (!subprocess || !fs) return false
      try {
        const dirAbs = await flowsDirAbs(wsRoot)
        if (!dirAbs) return false
        const t = await fs.resolve(name + '.md', { cwd: dirAbs })
        const abs = typeof fs.processPath === 'function' ? fs.processPath(t) : t
        const handle = subprocess.spawn({
          argv: ['node', '-e', "require('fs').rmSync(process.argv[1], { force: true })", abs],
          cwd: wsRoot,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
          graceMs: 15000,
        })
        await handle.done
        return true
      } catch (e) { return false }
    }

    // ---- 逻辑门元数据 ----
    const GATES = {
      ifelse: { sym: '◇', label: 'IF/ELSE', color: '#d4b95c' },
      and: { sym: '∧', label: 'AND', color: '#7fa7f0' },
      or: { sym: '∨', label: 'OR', color: '#81c784' },
      not: { sym: '¬', label: 'NOT', color: '#f28b82' },
      nand: { sym: '⊼', label: 'NAND', color: '#7fa7f0' },
      nor: { sym: '⊽', label: 'NOR', color: '#81c784' },
      xor: { sym: '⊻', label: 'XOR', color: '#d4b95c' },
      xnor: { sym: '⊙', label: 'XNOR', color: '#d4b95c' },
    }

    // ---- Markdown → 流程模型 ----
    // 约定：# 标题 / ## 步骤 / ### gate:类型 条件名 / - 是 → 目标 / - 否 → 目标 / - 其他=要点 / 段落=描述
    // ``` 代码围栏内的内容不解析（围栏里的 ## / ### gate: 是示例文本，不产生幻影节点）
    const parseFlow = (md) => {
      const lines = String(md || '').split(/\r?\n/)
      let title = ''
      const nodes = []
      let cur = null
      let inFence = false
      for (const ln of lines) {
        if (/^\s*```/.test(ln)) { inFence = !inFence; continue } // 围栏开关
        if (inFence) continue
        const h1 = /^#\s+(.+)/.exec(ln)
        if (h1) { if (!title) title = h1[1].trim(); continue }
        const gate = /^###\s+gate:(\w+)\s*(.*)/.exec(ln)
        if (gate) {
          cur = { kind: 'gate', gate: gate[1].toLowerCase(), label: (gate[2] || '').trim() || gate[1], desc: [], branches: [] }
          nodes.push(cur); continue
        }
        const h2 = /^##\s+(.+)/.exec(ln)
        if (h2) {
          cur = { kind: 'step', label: h2[1].trim(), desc: [], branches: [] }
          nodes.push(cur); continue
        }
        const li = /^[-*]\s+(.+)/.exec(ln)
        if (li && cur) {
          const br = /^(是|否)\s*→\s*(.+)/.exec(li[1].trim())
          if (br) cur.branches.push({ cond: br[1], target: br[2].trim() })
          else cur.desc.push(li[1].trim())
          continue
        }
        if (cur && ln.trim()) cur.desc.push(ln.trim())
      }
      return { title, nodes }
    }

    // ---- 流程模型 → 流程图 HTML（复用 fl- 样式族；自上而下 ▼ 串联，门用 git 树分支）----
    const nodeHtml = (n, idx) => {
      if (n.kind === 'gate') {
        const g = GATES[n.gate] || { sym: '◇', label: String(n.gate || '?').toUpperCase(), color: '#d4b95c' }
        const branchRows = (n.branches || []).map((b, i, arr) => {
          const glyph = i === arr.length - 1 ? '╰─' : '├─'
          const condColor = b.cond === '是' ? 'var(--tb-done-text,#81c784)' : 'var(--tb-danger-text,#f28b82)'
          return '<div class="fl-branch-row"><span class="fl-git">' + glyph + '</span>' +
            '<span class="fl-branch-pill" style="color:' + condColor + '">' + esc(b.cond) + '</span>' +
            '<span class="fl-branch-txt">→ ' + esc(b.target) + '</span></div>'
        }).join('')
        return '<div class="fl-row"><div class="fl-node" style="border-color:' + g.color + '55;background:' + g.color + '0d">' +
          '<div class="fl-node-head"><span class="fl-tag" style="color:' + g.color + ';background:' + g.color + '22">' + g.sym + ' ' + g.label + '</span>' +
          '<span class="fl-name">' + esc(n.label) + '</span></div>' +
          (n.desc.length ? '<div class="fl-args">' + esc(n.desc[0]) + '</div>' : '') +
        '</div></div>' +
        (branchRows ? '<div class="fl-row"><div class="fl-node" style="border-color:' + g.color + '33;background:transparent;padding:2px 8px">' + branchRows + '</div></div>' : '')
      }
      return '<div class="fl-row"><div class="fl-node">' +
        '<div class="fl-node-head"><span class="fl-tag" style="color:var(--tb-active-text,#7fa7f0);background:rgba(91,141,239,.12)">步骤 ' + idx + '</span>' +
        '<span class="fl-name">' + esc(n.label) + '</span></div>' +
        (n.desc.length ? '<div class="fl-args" style="white-space:normal">' + esc(n.desc.slice(0, 3).join(' · ')) + '</div>' : '') +
      '</div></div>'
    }

    const ARROW = '<div class="fl-row"><div class="fl-arrow">▼</div></div>'
    const graphHtml = (flow) => {
      if (!flow.nodes.length) return '<div class="tb-notice">在左侧 Markdown 里用 ## 定义步骤、### gate: 定义逻辑门，右侧实时出图</div>'
      const parts = []
      if (flow.title) {
        parts.push('<div class="fl-row"><div class="fl-node" style="border-color:var(--tb-accent-border,rgba(91,141,239,.5));background:rgba(91,141,239,.1)">' +
          '<div class="fl-node-head"><span class="fl-tag" style="color:var(--tb-accent-text,#7fa7f0);background:rgba(91,141,239,.16)">工作流</span>' +
          '<span class="fl-name">' + esc(flow.title) + '</span></div></div></div>')
        parts.push(ARROW)
      }
      let stepIdx = 0
      flow.nodes.forEach((n, i) => {
        if (n.kind === 'step') stepIdx++
        parts.push(nodeHtml(n, stepIdx))
        if (i < flow.nodes.length - 1) parts.push(ARROW)
      })
      return parts.join('')
    }

    // ---- 新建模板 ----
    const TEMPLATE = '# 我的工作流\n\n## 01 输入\n收集需求与上下文\n\n## 02 研究\n检索资料、分析方案\n\n### gate:ifElse 质量达标？\n- 是 → 03 输出\n- 否 → 02 研究\n\n## 03 输出\n产出结果并复盘\n'

    // ---- 渲染 ----
    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      // 文件行
      parts.push('<div class="tb-row">' +
        '<select class="tb-select" data-field="pick">' +
          '<option value="">（选择工作流）</option>' +
          (st.files || []).map((f) => '<option value="' + esc(f) + '"' + (f === st.name ? ' selected' : '') + '>' + esc(f) + '</option>').join('') +
        '</select>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="open">打开</button>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="new">新建</button>' +
        (st.name ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-danger-ghost" data-action="del">' + (st.confirmDel ? '再点一次确认删除' : '删除') + '</button>' : '') +
      '</div>')
      // 名称 + 保存
      if (st.name) {
        parts.push('<div class="tb-row">' +
          '<input class="tb-input tb-mono" data-field="name" value="' + esc(st.name) + '" title="文件名（不含 .md）" />' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="save">保存</button>' +
          (st.dirty ? '<span class="tb-note tb-tx-warn">● 未保存</span>' : '<span class="tb-note">已保存</span>') +
          '<span class="tb-note">' + esc(REL_DIR + '/' + st.name + '.md') + '</span>' +
        '</div>')
        // 视图切换
        parts.push('<div class="tb-chips">' +
          [['split', '分屏'], ['edit', '仅编辑'], ['graph', '仅流程图']].map(([v, l]) =>
            '<button type="button" class="tb-chip' + (st.view === v ? ' tb-chip-on' : '') + '" data-action="view" data-v="' + v + '">' + l + '</button>'
          ).join('') +
          '<span class="tb-note">## 步骤 · ### gate:门 · - 是→目标</span>' +
        '</div>')
      }
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      // 编辑 + 预览
      if (st.name) {
        const flow = parseFlow(st.md)
        const showEdit = st.view !== 'graph'
        const showGraph = st.view !== 'edit'
        if (showEdit) {
          parts.push('<div class="tb-sec"><span class="tb-sec-label">Markdown（唯一事实来源）</span>' +
            '<textarea class="tb-textarea tb-mono" data-field="md" style="min-height:' + (st.view === 'split' ? '160px' : '320px') + '" placeholder="## 01 步骤名&#10;描述&#10;### gate:ifElse 条件名&#10;- 是 → 目标步骤&#10;- 否 → 目标步骤">' + esc(st.md || '') + '</textarea></div>')
        }
        if (showGraph) {
          parts.push('<div class="tb-sec"><span class="tb-sec-label">流程图（' + flow.nodes.length + ' 节点）</span>' +
            '<div style="display:flex;flex-direction:column;gap:2px;border:1px solid var(--tb-border,#35363e);border-radius:8px;padding:10px;max-height:420px;overflow:auto">' +
            graphHtml(flow) + '</div></div>')
        }
      } else {
        parts.push('<div class="tb-notice">新建或打开一个工作流开始编辑；Markdown 是唯一事实来源，流程图实时预览</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    // ---- handler ----
    // 文件名消毒（state 回传的 name 不可信）：剔除路径分隔符、.. 遍历、前导点、控制字符——
    // 防 save/del/open 把相对路径解析到 flows 目录外（Qwen 评审指出的路径遍历→任意文件删除）
    const sanitizeName = (n) => String(n == null ? '' : n)
      .replace(/\.{2,}/g, '')          // .. 路径遍历
      .replace(/[\\/:*?"<>|]/g, '')     // 路径分隔符与非法字符
      .replace(/^\.+/, '')              // 前导点
      .trim()

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { files: [], name: '', md: '', dirty: false, view: 'split', notice: null, confirmDel: false }
      if (!Array.isArray(st.files)) st.files = []
      const el = fields && fields.__el ? fields.__el : {}
      // state 回传的 name 统一消毒（不可信输入）
      st.name = sanitizeName(st.name)
      // md 体量上限：state 每次动作往返传输，超阈值截断防大包（64KB）
      const MD_CAP = 64 * 1024
      if (typeof st.md === 'string' && st.md.length > MD_CAP) {
        st.md = st.md.slice(0, MD_CAP)
        st.notice = '⚠ 文档超 64KB 已截断（state 每次动作往返，过大影响响应）'
      }
      // 同步表单
      if (typeof fields.md === 'string' && fields.md !== st.md) { st.md = fields.md.length > MD_CAP ? fields.md.slice(0, MD_CAP) : fields.md; st.dirty = true }
      if (typeof fields.name === 'string') {
        const fn = sanitizeName(fields.name)
        if (fn !== st.name) { st.name = fn; st.dirty = true }
      }
      const pick = sanitizeName(typeof fields.pick === 'string' ? fields.pick : '')

      if (action === 'new') {
        st.name = 'workflow-' + String(Date.now()).slice(-5)
        st.md = TEMPLATE
        st.dirty = true
        st.confirmDel = false
        st.notice = '已生成模板，点「保存」落盘到 ' + REL_DIR
      } else if (action === 'open') {
        const target = pick || st.name
        if (!target) {
          st.notice = '先在下拉里选一个工作流'
        } else {
          const content = await readFlow(ws.root, target)
          if (content == null) {
            st.notice = '文件不存在: ' + target + '.md'
          } else {
            st.name = target
            st.md = content
            st.dirty = false
            st.confirmDel = false
            st.notice = null
          }
        }
      } else if (action === 'save') {
        if (!st.name) {
          st.notice = '请填写文件名'
        } else {
          try {
            await saveFlow(ws.root, ws.session, st.name, st.md || '')
            st.dirty = false
            st.notice = '已保存 ' + st.name + '.md'
            st.files = await listFlows(ws.root)
          } catch (e) {
            st.notice = '⚠ 保存失败: ' + String((e && e.message) || e)
          }
        }
      } else if (action === 'del') {
        if (!st.confirmDel) {
          st.confirmDel = true
          st.notice = '⚠ 再点一次「删除」确认移除 ' + st.name + '.md'
        } else {
          await deleteFlow(ws.root, st.name)
          st.notice = '已删除 ' + st.name + '.md'
          st.name = ''
          st.md = ''
          st.dirty = false
          st.confirmDel = false
          st.files = await listFlows(ws.root)
        }
      } else if (action === 'view' && el.v) {
        st.view = ['split', 'edit', 'graph'].indexOf(el.v) >= 0 ? el.v : 'split'
      } else if (action === '') {
        st.files = await listFlows(ws.root)
        st.notice = null
      }
      // 每次动作后刷新文件列表（轻量）
      if (action && action !== '') st.files = await listFlows(ws.root)
      return { ok: true, html: render(st), state: st }
    }

    tryRegisterTool(ctx, { id: 'flowedit', label: '工作流', order: 5, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 2.5l2.5 2.5-7 7H4v-2.5z"/><path d="M3.5 12.5h9"/></svg>' }, handler)
  },
}
