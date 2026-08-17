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
          // 遍历 content 找第一个带 toolCallId 的块（首块非 tool-result 时也能配上对）
          let callId = null
          let text = ''
          if (Array.isArray(m.content)) {
            for (const block of m.content) {
              if (callId == null && block && block.toolCallId != null) callId = String(block.toolCallId)
              if (!text && block) { const t = textOf(block.content); if (t) text = t }
            }
          }
          const failed = !!(d.error || (Array.isArray(m.content) && m.content[0] && m.content[0].isError))
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

    // 进出摘要：传入/返回（用户核心诉求——看到传给 skill 什么、skill 返回什么）
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
    // 调用连线单元（形态约定·手绘参考图：主干卡在左、工具卡在右，中间两条水平连线——
    // 上=输入摘要 + 横线 + ▶ 右出；下=◀ + 横线 + 输出摘要 回左；输出线绿色系、错误红色系、进行中虚线）；
    // 进行中的工具卡高亮脉冲（调用到哪步哪步亮）；点击工具卡展开完整传入/返回（详情挂卡下方）
    const renderCallWire = (c, expandedSeq) => {
      const km = KIND_META[c.cat] || KIND_META.builtin
      const isExp = expandedSeq === c.seq
      const pending = c.status === 'pending'
      const o = outSummary(c)
      return '<div class="fl-wp">' +
          '<div class="fl-wl"><span class="fl-wl-txt">输入 ' + esc(inSummary(c)) + '</span>' +
            '<span class="fl-wl-row"><span class="fl-wl-line"></span><span class="fl-wl-arr">▶</span></span></div>' +
          (pending
            ? '<div class="fl-wl fl-wl-b fl-wl-wait"><span class="fl-wl-txt">输出 进行中…</span>' +
              '<span class="fl-wl-row"><span class="fl-wl-arr">◀</span><span class="fl-wl-line"></span></span></div>'
            : '<div class="fl-wl fl-wl-b' + (o && o.err ? ' fl-wl-err' : '') + '"><span class="fl-wl-txt">输出 ' + esc(o ? o.text : '') + '</span>' +
              '<span class="fl-wl-row"><span class="fl-wl-arr">◀</span><span class="fl-wl-line"></span></span></div>') +
        '</div>' +
        '<div class="fl-callside">' +
          '<div class="fl-iocard' + (pending ? ' fl-live' : '') + (isExp ? ' fl-on' : '') + (o && o.err ? ' fl-err' : '') + '" data-action="fdetail" data-seq="' + c.seq + '" title="点击在右侧查看完整传入/返回">' +
            '<div class="fl-iohead"><span class="fl-tag" style="color:' + km.color + ';background:' + km.bg + '">' + km.label + '</span>' +
            '<span class="fl-name">' + esc(c.name) + '</span>' +
            (pending ? '<span class="fl-spin"></span>' : statusGlyph(c.status, c.dur)) + '</div>' +
          '</div>' +
        '</div>'
    }

    // 助手消息 + 紧跟的同步调用组 → 合并为一行 block（左=助手卡跨行居中，右=每调用 连线对+工具卡）
    const renderCallBlock = (aiIt, node, expandedSeq) => {
      const units = node.calls.map((c) => renderCallWire(c, expandedSeq)).join('')
      return '<div class="fl-row"><div class="fl-callblock">' +
        '<div class="fl-cb-main" style="grid-row:1/' + (node.calls.length + 1) + '">' + msgCardInner(aiIt) + '</div>' +
        units +
      '</div></div>'
    }

    // 孤立调用组（前无助手消息，如连续工具步）：左列画主干竖线占位，保持双列节奏
    const renderPar = (node, expandedSeq) => {
      const units = node.calls.map((c) => renderCallWire(c, expandedSeq)).join('')
      return '<div class="fl-row"><div class="fl-callblock">' +
        '<div class="fl-cb-main fl-cb-empty" style="grid-row:1/' + (node.calls.length + 1) + '"><span class="fl-cb-line"></span></div>' +
        units +
      '</div></div>'
    }

    const msgCardInner = (it) => {
      const isUser = it.role === 'user'
      const isAi = it.role === 'ai'
      const color = isUser ? 'var(--tb-done-text,#81c784)' : isAi ? 'var(--tb-active-text,#7fa7f0)' : 'var(--tb-text-3,#777884)'
      const label = isUser ? '用户' : isAi ? '助手' : '注入'
      // 卡片统一面片底色（fl-node），角色色只落在左侧色条 + 几何符号/tag 上，避免整卡彩色半透明的杂乱感
      return '<div class="fl-node" style="border-left-color:' + color + '">' +
        '<div class="fl-node-head"><span class="fl-glyph" style="color:' + color + '">' + (isUser ? '▲' : isAi ? '◆' : '■') + '</span><span class="fl-tag" style="color:' + color + '">' + label + '</span>' +
        '<span class="fl-time">' + fmtTime(it.time) + '</span>' +
        (it.tok ? '<span class="fl-time">+' + it.tok + ' tok</span>' : '') + '</div>' +
        '<div class="fl-preview">' + esc(it.preview || '（空）') + '</div>' +
      '</div>'
    }

    const renderMsg = (it) => '<div class="fl-row">' + msgCardInner(it) + '</div>'

    // 完整详情 → 右侧浮层（不插入流程流撑高内容：展开/收起零跳跃，滚动位置不动）：
    // 完整输入参数（美化 JSON）+ 完整返回结果（均截断标注，防大参数撑爆 HTML）；头部 ✕ 或再点卡片关闭
    const detailRail = (c, anim) => {
      let input = c.argsRaw || ''
      try { input = JSON.stringify(JSON.parse(c.argsRaw || '{}'), null, 2) } catch (e) {}
      const cap = 8000
      const inShown = input.length > cap ? input.slice(0, cap) + '\n…（截断，共 ' + input.length + ' 字符）' : input
      const out = c.status === 'pending' ? '（进行中，尚无返回）' : (c.resultText || '（空返回）')
      const outShown = out.length > cap ? out.slice(0, cap) + '\n…（截断，共 ' + out.length + ' 字符）' : out
      // anim=是否新展开（轮询重渲染不重播滑入动画，防闪烁）
      return '<div class="fl-rail' + (anim ? ' fl-rail-anim' : '') + '">' +
        '<div class="fl-rail-head"><span class="fl-rail-title">' + esc(c.name) + ' · 详情</span>' +
        '<button type="button" class="fl-rail-x" data-action="fdetail" data-seq="' + c.seq + '" title="关闭详情">✕</button></div>' +
        '<div class="fl-rail-body">' +
          '<div class="fl-sec"><span class="fl-sec-label">入 · 完整传入' + (input.length > cap ? '（截断）' : '') + '</span><pre class="fl-pre">' + esc(inShown) + '</pre></div>' +
          '<div class="fl-sec"><span class="fl-sec-label">出 · 完整返回' + (c.outLen ? '（' + fmtSize(c.outLen) + '）' : '') + '</span><pre class="fl-pre">' + esc(outShown) + '</pre></div>' +
        '</div>' +
      '</div>'
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
      parts.push('<div class="jr-tabpanel tb-root tb-pane" data-flow data-autorefresh="' + (st.live ? '2000' : '') + '" data-tab-badge="' + (st.live ? String(nodes.length) : '') + '">')
      // 固定头
      parts.push('<div class="tb-pane-head">')
      parts.push('<div class="tb-row">' +
        '<span class="tb-sec-label">实时流程</span>' +
        '<span class="tb-note">' + esc(sid.replace(/^session-/, '').slice(0, 8)) + ' · ' + items.length + ' 条事件 · ' + nodes.length + ' 节点</span>' +
        '<button type="button" class="tb-chip' + (st.live ? ' tb-chip-on' : '') + '" data-action="toggle-live">' + (st.live ? '● 实时同步中' : '⏸ 已暂停') + '</button>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button>' +
      '</div>')
      parts.push('<div class="tb-note">主干自上而下：用户/助手；调用右出输入卡 ▶、左回输出卡 ◀，进行中的调用高亮脉冲；点卡片在右侧看完整传入/返回；子代理以 git 树分支展开实时步骤</div>')
      parts.push('</div>')
      // 流程体：tb-pane-body 为 column-reverse——这里以「视觉最新在底」渲染：DOM 先放最新节点，滚动条默认贴底
      parts.push('<div class="tb-pane-body">')
      if (!shown.length) {
        parts.push('<div class="tb-notice">当前会话还没有事件</div>')
      } else {
        // 子代理分支并行预渲染（串行 await 会让多个子代理分支的 readLog 延迟叠加）
        const subHtmls = {}
        await Promise.all(shown.map(async (n, i) => { if (n.t === 'sub') subHtmls[i] = await renderSub(n) }))
        const rows = []
        for (let i = 0; i < shown.length; i++) {
          const n = shown[i]
          let h
          // 助手消息紧跟同步调用组 → 合并为一行（左=助手卡，右=连线+工具卡）
          if (n.t === 'msg' && n.it.role === 'ai' && shown[i + 1] && shown[i + 1].t === 'par') {
            h = renderCallBlock(n.it, shown[i + 1], st.expanded)
            i++
          } else if (n.t === 'msg') h = renderMsg(n.it)
          else if (n.t === 'par') h = renderPar(n, st.expanded)
          else h = subHtmls[i] || ''
          rows.push(h)
          rows.push(ARROW)
        }
        if (rows.length && rows[rows.length - 1] === ARROW) rows.pop()
        if (nodes.length > CAP) rows.push('<div class="tb-notice">仅显示最近 ' + CAP + ' 个节点（更早 ' + (nodes.length - CAP) + ' 个未加载）</div>')
        parts.push(rows.reverse().join(''))
      }
      parts.push('</div>')
      // 详情右侧浮层：展开状态且目标调用仍在可视事件集内时渲染（absolute 覆盖右缘，流程流不动）
      if (st.expanded != null) {
        const target = items.find((it) => it.kind === 'call' && it.seq === st.expanded)
        if (target) parts.push(detailRail(target, st.freshSeq === target.seq))
      }
      delete st.freshSeq // 一次性动画标记，不残留进 state
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { live: true, sid: null, expanded: null }
      if (typeof st.expanded !== 'number' && st.expanded != null) st.expanded = null
      const el = fields && fields.__el ? fields.__el : {}
      if (action === 'toggle-live') st.live = !st.live
      else if (action === 'fdetail' && el.seq != null) {
        const seq = Number(el.seq)
        st.expanded = st.expanded === seq ? null : seq
        st.freshSeq = st.expanded // 仅新展开的那次渲染播放滑入动画（null=收起不播；轮询不重播）
      }
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