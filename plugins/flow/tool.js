// ===== flow-tool.js：实时流程图（Host-only，经工具箱 RPC 注册）=====
// 当前 session 在干什么 → 自上而下不断加载的流程图（与「轨迹」工具互补：轨迹是过滤时间线，流程图是形态视图）。
// 形态约定（用户定制）：
//   · 主 session：自上而下箭头串联 用户消息 → 助手 → 工具组 → 助手 …（最新在底部，滚动条贴底跟随）
//   · 子代理（subagent/workflow/ralph）：git 树形式——从主干 ├─ 分出支线，支线内实时展示子会话事件流，╰─ 合并回主干
//   · 插件/技能/MCP/命令/文件 等普通工具调用：同一步骤内的多个调用 → 平行卡片并排（调用并返回成组）
// 实时：面板根带 data-autorefresh="2000"，框架抽屉每 2s 静默重拉（live 开关可暂停）。
// 数据源：sessionQuery（makeSessionLogReader 缓存；子代理会话按 id 各自缓存读取器）。
// 状态：{ live, sid }（轻量标量；事件本体与流程模型每次动作重建，不进 state）

return {
  name: 'flow-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')
    const fs = ctx.get('fs')

    // ---- 会话日志读取缓存（主会话 + 每个子代理会话各一个读取器，避免缓存抖动）----
    const readers = {}
    const readLog = async (sid) => {
      if (!sq) return { events: [], count: 0 }
      if (!readers[sid]) readers[sid] = makeSessionLogReader(ctx, sq)
      try { return await readers[sid](sid) } catch (e) { return { events: [], count: 0 } }
    }

    // ---- 工具分类（与 trace 工具同口径：真实清单优先，名字启发式兜底）----
    let manifestTools = null
    const loadManifestTools = async () => {
      if (manifestTools) return
      manifestTools = []
      try {
        const found = await findManifest(ctx)
        const list = found && found.manifest && Array.isArray(found.manifest.plugins) ? found.manifest.plugins : []
        for (const e of list) {
          if (e && Array.isArray(e.modelTools)) {
            for (const n of e.modelTools) if (typeof n === 'string' && n) manifestTools.push(n)
          }
        }
      } catch (e) {}
    }
    const RE_SKILL = /^skill$/
    const RE_MCP = /mcp/i
    const RE_SUBAGENT = /^(subagent|subagent_fork|workflow|ralph)$/
    const RE_SHELL = /^(pwsh|bash|sh|terminal_(open|send|read|close|list|signal)|run_code)$/
    const RE_FILE = /^(read|write|edit|glob|grep|read_image)$/
    const kindOf = (name) => {
      if (/^cordis_/.test(name)) return 'cordis'
      if (/^ssh_/.test(name)) return 'cordis'
      if (manifestTools && manifestTools.indexOf(name) >= 0) return 'cordis'
      if (RE_SKILL.test(name)) return 'skill'
      if (RE_MCP.test(name)) return 'mcp'
      if (RE_SUBAGENT.test(name)) return 'subagent'
      if (RE_SHELL.test(name)) return 'shell'
      if (RE_FILE.test(name)) return 'file'
      return 'builtin'
    }
    const KIND_META = {
      skill: { label: '技能', color: '#7fa7f0', bg: 'rgba(91,141,239,.12)' },
      cordis: { label: '插件', color: '#d4b95c', bg: 'rgba(212,167,44,.10)' },
      mcp: { label: 'MCP', color: '#81c784', bg: 'rgba(102,187,106,.10)' },
      shell: { label: '命令', color: '#d4b95c', bg: 'rgba(212,167,44,.08)' },
      file: { label: '文件', color: '#7fa7f0', bg: 'rgba(91,141,239,.10)' },
      builtin: { label: '内置', color: '#9a9ba6', bg: 'rgba(138,139,150,.10)' },
    }

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
    const fmtDur = (ms) => ms == null ? '' : (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's')
    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && b.type === 'text' ? b.text : '')).filter(Boolean).join('\n')
    }

    // ---- 事件流 → 基础条目（调用与结果按 callId 配对，同 trace）----
    const parseItems = (events) => {
      const items = []
      const byCallId = {}
      for (const ev of events) {
        if (!ev || typeof ev.seq !== 'number') continue
        const d = ev.data || {}
        if (ev.type === 'tool/call') {
          const it = {
            kind: 'call', seq: ev.seq, time: ev.time, turn: d.turn, step: d.step,
            name: String(d.name || '?'), cat: kindOf(String(d.name || '')),
            argsRaw: typeof d.arguments === 'string' ? d.arguments : '',
            status: 'pending', dur: null, resultText: '', outLen: 0,
          }
          items.push(it)
          if (d.callId != null) byCallId[String(d.callId)] = it
        } else if (ev.type === 'tool/result') {
          const m = d.message || {}
          const block = Array.isArray(m.content) ? m.content[0] : null
          const callId = block && block.toolCallId != null ? String(block.toolCallId) : null
          const text = block ? textOf(block.content) : ''
          const failed = !!(d.error || (block && block.isError))
          const it = callId ? byCallId[callId] : null
          if (it) {
            it.status = failed ? 'error' : 'ok'
            it.dur = ev.time - it.time
            it.resultText = text
            it.outLen = text.length
          }
        } else if (ev.type === 'user/message') {
          const src = d.source && d.source.kind ? String(d.source.kind) : 'user'
          items.push({ kind: 'msg', role: src === 'user' ? 'user' : 'inject', seq: ev.seq, time: ev.time, preview: oneLine(textOf(d.content), 110) })
        } else if (ev.type === 'assistant/message') {
          const m = d.message || {}
          const u = d.usage || null
          items.push({ kind: 'msg', role: 'ai', seq: ev.seq, time: ev.time, preview: oneLine(textOf(m.content), 110) || '（工具调用）', tok: u ? (u.outputTokens || 0) : null })
        }
      }
      return items
    }

    // ---- 条目 → 流程节点：消息各成节点；同步骤连续普通调用合成平行卡片组；子代理调用独立成分支节点 ----
    const buildNodes = (items) => {
      const nodes = []
      for (const it of items) {
        if (it.kind === 'msg') { nodes.push({ t: 'msg', it }); continue }
        if (it.cat === 'subagent') { nodes.push({ t: 'sub', call: it }); continue }
        const last = nodes[nodes.length - 1]
        if (last && last.t === 'par' && last.turn === it.turn && last.step === it.step) last.calls.push(it)
        else nodes.push({ t: 'par', turn: it.turn, step: it.step, calls: [it] })
      }
      return nodes
    }

    // ---- 子代理结果文本 → 子会话 id（"started subagent <uuid>" / 完成通知里的 id）----
    const childIdOf = (call) => {
      const m = /subagent\s+([0-9a-f]{8}-[0-9a-f-]{27,})/i.exec(call.resultText || '')
      return m ? m[1] : null
    }
    // 子代理分支：从子会话日志提取紧凑步骤流（限量；读失败/未启动给占位）
    const childRows = async (childId, cap) => {
      const r = await readLog(childId)
      if (!r.events || !r.events.length) return { rows: [], live: false, total: 0 }
      const items = parseItems(r.events)
      const rows = []
      for (const it of items) {
        if (it.kind === 'msg') {
          if (it.role === 'ai') rows.push({ txt: it.preview, cls: 'ai' })
        } else {
          const km = KIND_META[it.cat] || KIND_META.builtin
          rows.push({ txt: it.name + ' ' + oneLine(it.argsRaw, 40), cls: '', pill: km.label, status: it.status, dur: it.dur })
        }
      }
      const sessionsSvc = ctx.get('sessions')
      let live = false
      try { live = !!(sessionsSvc && sessionsSvc.get(childId)) } catch (e) {}
      return { rows: rows.slice(-cap), live, total: rows.length }
    }

    // ---- 渲染 ----
    const statusGlyph = (s, dur) => {
      if (s === 'ok') return '<span style="color:var(--tb-done-text,#81c784)">✓ ' + fmtDur(dur) + '</span>'
      if (s === 'error') return '<span style="color:var(--tb-danger-text,#f28b82)">✗ ' + fmtDur(dur) + '</span>'
      return '<span class="fl-spin"></span>'
    }

    // ---- 进出关系：传入/返回摘要（用户核心诉求——看到传给 skill 什么、skill 返回什么）----
    // 传入：从 arguments JSON 提取最有信息量的字段（command/file_path/pattern/prompt…），而非整段 JSON
    const ARG_KEYS = ['command', 'file_path', 'path', 'pattern', 'query', 'q', 'description', 'prompt', 'text', 'content', 'url', 'name', 'key', 'expression', 'expr', 'code', 'script', 'tool', 'method', 'message', 'input', 'old_string', 'new_string']
    const inSummary = (c) => {
      try {
        const a = JSON.parse(c.argsRaw || '{}')
        for (const k of ARG_KEYS) {
          if (typeof a[k] === 'string' && a[k].trim()) return k + ': ' + oneLine(a[k], 72)
          if (typeof a[k] === 'number' || typeof a[k] === 'boolean') return k + ': ' + a[k]
        }
        const ks = Object.keys(a)
        if (ks.length) return ks[0] + ': ' + oneLine(String(a[ks[0]]), 72)
        return '（无参数）'
      } catch (e) { return oneLine(c.argsRaw, 72) || '（无参数）' }
    }
    // 返回：结果首条有意义文本 + 体量 + 状态
    const outSummary = (c) => {
      if (c.status === 'pending') return null
      if (c.status === 'error') {
        const t = (c.resultText || '').trim()
        return { text: t ? oneLine(t, 72) : '（调用失败）', err: true }
      }
      const lines = String(c.resultText || '').split('\n').map((s) => s.trim()).filter(Boolean)
      const first = lines[0] || ''
      return { text: (first ? oneLine(first, 72) : '（空返回）') + (c.outLen > 72 ? ' · ' + fmtSize(c.outLen) : ''), err: false }
    }
    // 进出两行（传入必有；返回 pending 时显示进行中）
    const ioRows = (c) => {
      const o = outSummary(c)
      return '<div class="fl-io fl-in"><span class="fl-io-tag">入</span>' + esc(inSummary(c)) + '</div>' +
        (o
          ? '<div class="fl-io fl-out' + (o.err ? ' fl-out-err' : '') + '"><span class="fl-io-tag">出</span>' + esc(o.text) + '</div>'
          : '<div class="fl-io fl-out"><span class="fl-io-tag">出</span><span class="fl-time">进行中…</span></div>')
    }

    const renderMsg = (it) => {
      const isUser = it.role === 'user'
      const isAi = it.role === 'ai'
      const color = isUser ? 'var(--tb-done-text,#81c784)' : isAi ? 'var(--tb-active-text,#7fa7f0)' : 'var(--tb-text-3,#777884)'
      const bg = isUser ? 'rgba(102,187,106,.08)' : isAi ? 'rgba(91,141,239,.08)' : 'rgba(138,139,150,.06)'
      const label = isUser ? '用户' : isAi ? '助手' : '注入'
      return '<div class="fl-row"><div class="fl-node" style="border-color:' + color + '33;background:' + bg + '">' +
        '<div class="fl-node-head"><span class="fl-tag" style="color:' + color + '">' + label + '</span>' +
        '<span class="fl-time">' + fmtTime(it.time) + '</span>' +
        (it.tok ? '<span class="fl-time">+' + it.tok + ' tok</span>' : '') + '</div>' +
        '<div class="fl-preview">' + esc(it.preview || '（空）') + '</div>' +
      '</div></div>'
    }

    // 平行调用组：同一 step 的多个普通工具调用，从主干向右各分一条支线（├▶），末条 ╰▶ 合并回主干；
    // 卡片自适应宽度（不占满），入/出两行展示 传入参数 → 返回结果 的进出关系
    const renderPar = (node) => {
      const n = node.calls.length
      const rows = node.calls.map((c, i) => {
        const km = KIND_META[c.cat] || KIND_META.builtin
        const glyph = n === 1 ? '├▶' : (i === n - 1 ? '╰▶' : '├▶')
        return '<div class="fl-par-row">' +
          '<span class="fl-git">' + glyph + '</span>' +
          '<div class="fl-card" style="border-color:' + km.color + '44">' +
            '<div class="fl-node-head"><span class="fl-tag" style="color:' + km.color + ';background:' + km.bg + '">' + km.label + '</span>' +
            '<span class="fl-name">' + esc(c.name) + '</span>' + statusGlyph(c.status, c.dur) + '</div>' +
            ioRows(c) +
          '</div>' +
        '</div>'
      })
      return '<div class="fl-row"><div class="fl-par">' + rows.join('') + '</div></div>'
    }

    // 子代理分支（git 树）：┌─ 分出 / 支线步骤 / └─ 合并；分出行标「入：任务」，合并行标「出：返回」
    const renderSub = async (node) => {
      const c = node.call
      const parts = []
      parts.push('<div class="fl-row"><div class="fl-branch-open">' +
        '<span class="fl-git">├─</span><span class="fl-git-branch">◆</span>' +
        '<span class="fl-tag" style="color:var(--tb-active-text,#7fa7f0);background:rgba(91,141,239,.12)">子代理</span>' +
        '<span class="fl-name">' + esc(c.name) + '</span>' +
        statusGlyph(c.status, c.dur) +
      '</div></div>')
      // 入：传给子代理的任务（prompt/description）
      parts.push('<div class="fl-row"><div class="fl-branch-row">' +
        '<span class="fl-git">│</span><span class="fl-io-tag">入</span><span class="fl-branch-txt">' + esc(inSummary(c)) + '</span>' +
      '</div></div>')
      const cid = childIdOf(c)
      if (cid) {
        const sub = await childRows(cid, 10)
        const liveTag = sub.live ? '<span class="fl-tag" style="color:var(--tb-done-text,#81c784)">运行中</span>' : ''
        parts.push('<div class="fl-row"><div class="fl-branch-meta">' +
          '<span class="fl-git">│</span><span class="fl-time">↳ ' + esc(cid.slice(0, 8)) + '… · ' + sub.total + ' 步</span>' + liveTag + '</div></div>')
        for (const r of sub.rows) {
          parts.push('<div class="fl-row"><div class="fl-branch-row">' +
            '<span class="fl-git">│</span>' +
            (r.pill
              ? '<span class="fl-branch-pill">' + esc(r.pill) + '</span><span class="fl-branch-txt">' + esc(r.txt) + '</span>' + statusGlyph(r.status, r.dur)
              : '<span class="fl-branch-txt fl-branch-ai">' + esc(r.txt) + '</span>') +
          '</div></div>')
        }
        if (sub.total > sub.rows.length) {
          parts.push('<div class="fl-row"><div class="fl-branch-row"><span class="fl-git">│</span><span class="fl-time">… 更早 ' + (sub.total - sub.rows.length) + ' 步未展开</span></div></div>')
        }
      } else if (c.status === 'pending') {
        parts.push('<div class="fl-row"><div class="fl-branch-row"><span class="fl-git">│</span><span class="fl-time">子代理启动中…</span></div></div>')
      }
      if (c.status !== 'pending') {
        // 出：子代理返回主会话的结果
        const o = outSummary(c)
        parts.push('<div class="fl-row"><div class="fl-branch-close">' +
          '<span class="fl-git">╰─</span><span class="fl-io-tag">出</span>' +
          '<span class="fl-time">' + fmtDur(c.dur) + '</span>' +
          (o ? '<span class="fl-args">' + esc(o.text) + '</span>' : '') +
        '</div></div>')
      }
      return parts.join('')
    }

    const ARROW = '<div class="fl-row"><div class="fl-arrow">▼</div></div>'

    const render = async (st, sid) => {
      const r = await readLog(sid)
      await loadManifestTools()
      const items = parseItems(r.events || [])
      const nodes = buildNodes(items)
      const CAP = 60
      const shown = nodes.slice(-CAP)
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root tb-pane" data-autorefresh="' + (st.live ? '2000' : '') + '" data-tab-badge="' + (st.live ? String(nodes.length) : '') + '">')
      // 固定头
      parts.push('<div class="tb-pane-head">')
      parts.push('<div class="tb-row">' +
        '<span class="tb-sec-label">实时流程</span>' +
        '<span class="tb-note">' + esc(sid.replace(/^session-/, '').slice(0, 8)) + ' · ' + items.length + ' 条事件 · ' + nodes.length + ' 节点</span>' +
        '<button type="button" class="tb-chip' + (st.live ? ' tb-chip-on' : '') + '" data-action="toggle-live">' + (st.live ? '● 实时同步中' : '⏸ 已暂停') + '</button>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button>' +
      '</div>')
      parts.push('<div class="tb-note">主干自上而下：用户/助手/工具组（平行卡片=同步调用）；子代理以 git 树分支展开其实时步骤</div>')
      parts.push('</div>')
      // 流程体：tb-pane-body 为 column-reverse——这里以「视觉最新在底」渲染：DOM 先放最新节点，滚动条默认贴底
      parts.push('<div class="tb-pane-body">')
      if (!shown.length) {
        parts.push('<div class="tb-notice">当前会话还没有事件</div>')
      } else {
        const rows = []
        for (const n of shown) {
          if (n.t === 'msg') rows.push(renderMsg(n.it))
          else if (n.t === 'par') rows.push(renderPar(n))
          else rows.push(await renderSub(n))
          rows.push(ARROW)
        }
        if (rows.length && rows[rows.length - 1] === ARROW) rows.pop()
        if (nodes.length > CAP) rows.push('<div class="tb-notice">仅显示最近 ' + CAP + ' 个节点（更早 ' + (nodes.length - CAP) + ' 个未加载）</div>')
        parts.push(rows.reverse().join(''))
      }
      parts.push('</div></div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { live: true, sid: null }
      if (action === 'toggle-live') st.live = !st.live
      const sid = session || st.sid
      if (!sid) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到当前会话</div></div>', state: st }
      st.sid = sid
      try {
        const html = await render(st, sid)
        return { ok: true, html, state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'flow', label: '流程', order: 2 }, handler)
  },
}