// ===== flow-tool.js：实时流镜（Host-only，经工具箱 RPC 注册）=====
// 当前 session 在干什么 → 自上而下不断加载的流程图（与「轨迹」工具互补：轨迹是过滤时间线，流程图是形态视图）。
// 形态约定（用户定制）：
//   · 主 session：自上而下箭头串联 用户消息 → 助手 → 工具组 → 助手 …（最新在底部，滚动条贴底跟随）
//   · 子代理（subagent/workflow/ralph）：git 树形式——从主干 ├─ 分出支线，支线内实时展示子会话事件流，╰─ 合并回主干
//   · 插件/技能/MCP/命令/文件 等普通工具调用：同一步骤内的多个调用 → 平行卡片并排（调用并返回成组）
// 实时：面板根带 data-autorefresh="2000"，框架抽屉每 2s 静默重拉（live 开关可暂停）。
// 钻取：点子代理分支「进入 →」切换到该子会话的流程图（当前会话压 crumbs 栈，「← 返回」逐级退回）。
// 数据源：sessionQuery（makeSessionLogReader 缓存；子代理会话按 id 各自缓存读取器）。
// 状态：{ live, sid, home, expanded, crumbs }（轻量标量；事件本体与流程模型每次动作重建，不进 state）

return {
  name: 'flow-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')
    const fs = ctx.get('fs')

    // ---- 会话日志读取缓存（主会话 + 每个子代理会话各一个读取器，避免缓存抖动）----
    const readers = {}
    const growth = {} // sid → 上次渲染的日志条数：本轮条数增长 = 会话活跃（助手卡流光判定用）
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
    const fmtTime = (t) => {
      const d = new Date(t)
      if (isNaN(d.getTime())) return '' // 注入类事件可能缺 time 字段，防空值渲染出 NaN:NaN:NaN
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    }
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
      const streamingAi = {} // turn:step → 首个 chunk 建立的临时助手卡；最终 message 原位落定，保持卡片 key 稳定
      const stepStarts = {} // turn:step → step/start 时间；助手运行计时从请求步骤开始，而不是首个 token 才开始
      const stepEnds = {} // turn:step → step/end 时间；无最终 message 的草稿据此落定（请求失败/中断）
      const turnEnds = {} // turn → turn/end 时间；step/end 缺失时的兜底落定依据
      let route = '' // 最近 request/header 的 provider/model，贴给后续助手消息卡
      let curTurn = null // 最近 turn/start 的轮次：user/message 不带 turn，用它推算归属
      for (const ev of events) {
        if (!ev || typeof ev.seq !== 'number') continue
        const d = ev.data || {}
        if (ev.type === 'turn/start') { if (typeof d.turn === 'number') curTurn = d.turn; continue }
        if (ev.type === 'step/start') {
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          stepStarts[String(turn) + ':' + step] = ev.time
          continue
        }
        if (ev.type === 'step/end') {
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          stepEnds[String(turn) + ':' + step] = ev.time
          continue
        }
        if (ev.type === 'turn/end') {
          if (typeof d.turn === 'number') turnEnds[d.turn] = ev.time
          continue
        }
        if (ev.type === 'request/header') {
          const cfg = d.header && d.header.config
          if (cfg && cfg.model) route = (cfg.provider ? cfg.provider + '/' : '') + cfg.model
          continue
        }
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
            it.resSeq = ev.seq // 结果事件位置：子代理出口卡对齐「结果之后的第一条消息」用
          }
        } else if (ev.type === 'user/message') {
          const src = d.source && d.source.kind ? String(d.source.kind) : 'user'
          const preview = oneLine(textOf(d.content), 110)
          // 空内容的上下文注入（subagent-settled 占位等）是噪声，不进流程图
          if (src !== 'user' && !preview) continue
          items.push({ kind: 'msg', role: src === 'user' ? 'user' : 'inject', seq: ev.seq, time: ev.time, turn: curTurn, preview, full: textOf(d.content) })
        } else if (ev.type === 'assistant/chunk') {
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          const key = String(turn) + ':' + step
          let it = streamingAi[key]
          if (!it) {
            it = { kind: 'msg', role: 'ai', seq: ev.seq, time: ev.time, turn, step, runStart: stepStarts[key] || ev.time, preview: '正在生成…', full: '', tok: null, route, streaming: true, chunks: [], reasoningChunks: [] }
            streamingAi[key] = it
            items.push(it)
          }
          const chunk = d.chunk || {}
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
            it.chunks.push(chunk.text)
          } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
            it.reasoningChunks.push(chunk.text)
          } else if (/tool-call/i.test(String(chunk.type || ''))) {
            it.hasToolCallChunk = true
          }
        } else if (ev.type === 'assistant/message') {
          const m = d.message || {}
          const u = d.usage || null
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          const key = String(turn) + ':' + step
          const finalText = textOf(m.content)
          const draft = streamingAi[key]
          if (draft) {
            // 保留首 chunk 的 seq，避免轮询时临时卡被当成另一张新卡；内容与完成态原位更新。
            draft.preview = oneLine(finalText, 110) || '（工具调用）'
            draft.full = finalText
            draft.tok = u ? (u.outputTokens || 0) : null
            draft.route = route
            draft.streaming = false
            draft.finalSeq = ev.seq
            draft.runDur = Math.max(0, ev.time - draft.runStart)
            delete draft.chunks
            delete draft.reasoningChunks
            delete draft.hasToolCallChunk
          } else {
            const runStart = stepStarts[key] || ev.time
            items.push({ kind: 'msg', role: 'ai', seq: ev.seq, time: ev.time, turn, step, runStart, runDur: Math.max(0, ev.time - runStart), preview: oneLine(finalText, 110) || '（工具调用）', full: finalText, tok: u ? (u.outputTokens || 0) : null, route, streaming: false })
          }
        }
      }
      // 流式中的助手卡只在整轮扫描结束后合并一次，避免每个 chunk 都重拼全文造成 O(n²) 和面板超时。
      for (const it of Object.values(streamingAi)) {
        if (!it.streaming) continue
        const text = Array.isArray(it.chunks) ? it.chunks.join('') : ''
        const reasoning = Array.isArray(it.reasoningChunks) ? it.reasoningChunks.join('') : ''
        it.full = text || reasoning
        const key = String(it.turn) + ':' + it.step
        const endedAt = stepEnds[key] != null ? stepEnds[key]
          : (it.turn != null && turnEnds[it.turn] != null ? turnEnds[it.turn] : null)
        if (endedAt != null) {
          // 步骤/轮次已终结却始终没有最终 message → 模型请求失败/中断：
          // 落定卡片（停止流光脉冲与耗时计时），标记中断并保留已生成片段
          it.streaming = false
          it.interrupted = true
          it.runDur = Math.max(0, endedAt - it.runStart)
          it.preview = (it.full ? oneLine(it.full, 100) + ' ' : '') + '（生成已中断）'
        } else {
          it.preview = oneLine(it.full, 110) || (it.hasToolCallChunk ? '正在准备工具调用…' : (reasoning ? '思考中…' : '正在生成…'))
        }
        delete it.chunks
        delete it.reasoningChunks
        delete it.hasToolCallChunk
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
      let live = false
      try {
        const agentsSvc = ctx.get('agents')
        if (agentsSvc) {
          const agent = agentsSvc.get(childId)
          live = !!(agent && agent.status === 'running')
        } else {
          // 旧版 harness/测试环境没有 agents 状态面，只能以仍挂载的 session 作为兼容兜底。
          const sessionsSvc = ctx.get('sessions')
          live = !!(sessionsSvc && sessionsSvc.get(childId))
        }
      } catch (e) {}
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
      return '<div class="fl-wp" data-flow-card="' + c.seq + '" data-flow-status="' + c.status + '">' +
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
            (pending ? '<span class="fl-spin"></span><span class="fl-time" data-flow-timer="' + c.time + '" data-flow-timer-prefix="⏱ ">⏱ 0ms</span>' : statusGlyph(c.status, c.dur)) + '</div>' +
          '</div>' +
        '</div>'
    }

    // 同一步骤的多个并行调用（>1）用虚线外框 + 「并行 ×N」角标圈成一组；单调用保持散卡
    const grpSide = (node, units) => {
      const n = node.calls.length
      if (n < 2) return '<div class="fl-lane-side">' + units + '</div>'
      return '<div class="fl-lane-side fl-grp"><span class="fl-grp-tag">并行 ×' + n + '</span>' + units + '</div>'
    }

    // 泳道中列包装：连接符（▼ 上方空隙由 ::before 主干线自适应填满，▼ 贴内容顶）+ 内容 + 对称弹性空间
    // —— 卡片保持垂直居中，▼ 始终落在「上一张卡 → 这一张卡」的空隙底端（先线后箭头）；可视首行不加（顶部不悬空）
    const connMain = (content, withConn) =>
      (withConn ? '<div class="fl-conn"><span class="fl-arrow">▼</span></div>' : '') +
      content +
      (withConn ? '<span class="fl-conn-gap"></span>' : '')

    // 孤立调用组（前无助手消息，如连续工具步）：中列只画主干竖线贯穿——无卡的行不放 ▼ 连接符（线本身即连续性）
    const renderPar = (node, expandedSeq) => {
      const units = node.calls.map((c) => renderCallWire(c, expandedSeq)).join('')
      return '<div class="fl-lane"><div></div>' +
        '<div class="fl-lane-main"><span class="fl-lane-line"></span></div>' +
        grpSide(node, units) +
      '</div>'
    }

    const msgCardInner = (it, expandedSeq, live) => {
      const isUser = it.role === 'user'
      const isAi = it.role === 'ai'
      const aiRunning = isAi && it.streaming
      const color = isUser ? 'var(--tb-done-text,#81c784)' : isAi ? 'var(--tb-active-text,#7fa7f0)' : 'var(--tb-text-3,#777884)'
      const label = isUser ? '用户' : isAi ? '助手' : '注入'
      // 卡片统一面片底色（fl-node），角色色只落在左侧色条 + 几何符号/tag 上，避免整卡彩色半透明的杂乱感
      // 用户/助手/注入卡均可点开右侧详情浮层看完整内容（与工具卡同一交互）；live=进行中 → 与工具卡同款流光脉冲
      return '<div class="fl-node' + (expandedSeq === it.seq ? ' fl-on' : '') + (live ? ' fl-live' : '') + '" style="border-left-color:' + color + '" data-flow-main-card="' + it.seq + '" data-flow-role="' + it.role + '" data-action="fdetail" data-seq="' + it.seq + '" title="点击查看完整消息">' +
        '<div class="fl-node-head"><span class="fl-glyph" style="color:' + color + '">' + (isUser ? '▲' : isAi ? '◆' : '■') + '</span><span class="fl-tag" style="color:' + color + '">' + label + '</span>' +
        (isAi && it.route ? '<span class="fl-model">' + esc(it.route) + '</span>' : '') +
        (fmtTime(it.time) ? '<span class="fl-time">' + fmtTime(it.time) + '</span>' : '') +
        (aiRunning && it.runStart ? '<span class="fl-time" data-flow-timer="' + it.runStart + '" data-flow-timer-prefix="⏱ ">⏱ 0ms</span>' : (isAi && it.runDur != null ? '<span class="fl-time">⏱ ' + fmtDur(it.runDur) + '</span>' : '')) +
        (it.tok ? '<span class="fl-time">+' + it.tok + ' tok</span>' : '') + '</div>' +
        '<div class="fl-preview"' + (it.interrupted ? ' style="color:var(--tb-danger-text,#f28b82)"' : '') + '>' + esc(it.preview || '（空）') + '</div>' +
      '</div>'
    }

    const renderMsg = (it, expandedSeq, withConn, live) => '<div class="fl-lane"><div></div><div class="fl-lane-main">' + connMain(msgCardInner(it, expandedSeq, live), withConn) + '</div><div></div></div>'

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

    // 消息详情浮层（用户/助手/注入卡点击）：角色 + 时间/模型/tokens 元信息 + 完整内容（截断标注）
    const msgRail = (it, anim) => {
      const label = it.role === 'user' ? '用户消息' : it.role === 'ai' ? '助手消息' : '注入消息'
      const cap = 8000
      const full = String(it.full || it.preview || '')
      const shown = full.length > cap ? full.slice(0, cap) + '\n…（截断，共 ' + full.length + ' 字符）' : full
      const meta = []
      if (fmtTime(it.time)) meta.push('时间 ' + fmtTime(it.time))
      if (it.route) meta.push('模型 ' + it.route)
      if (it.tok) meta.push('输出 +' + it.tok + ' tok')
      return '<div class="fl-rail' + (anim ? ' fl-rail-anim' : '') + '">' +
        '<div class="fl-rail-head"><span class="fl-rail-title">' + label + ' · 详情</span>' +
        '<button type="button" class="fl-rail-x" data-action="fdetail" data-seq="' + it.seq + '" title="关闭详情">✕</button></div>' +
        '<div class="fl-rail-body">' +
          (meta.length ? '<div class="fl-sec"><span class="fl-sec-label">' + esc(meta.join(' · ')) + '</span></div>' : '') +
          '<div class="fl-sec"><span class="fl-sec-label">完整内容' + (full.length > cap ? '（截断）' : '') + '</span><pre class="fl-pre">' + esc(shown || '（空）') + '</pre></div>' +
        '</div>' +
      '</div>'
    }

    // 子代理分支内容（左列）：入口卡（可点详情）+ 支线步骤（限高滚动）+ 出口卡
    // 运行中 = 调用在途（pending）或子会话仍 live——任一成立入口卡持续 fl-live（流光/脉冲/转圈）
    const subBranchHtml = async (c) => {
      const cid = childIdOf(c)
      let subLive = c.status === 'pending'
      let sub2 = null
      if (cid) {
        try { sub2 = await childRows(cid, 10); if (sub2.live) subLive = true } catch (e) {}
      }
      let sub = '<div class="fl-sub-card fl-sub-open' + (subLive ? ' fl-live' : '') + '" data-action="fdetail" data-seq="' + c.seq + '" title="点击查看完整任务传入/返回">' +
        '<div class="fl-iohead"><span class="fl-tag" style="color:var(--tb-active-text,#7fa7f0);background:rgba(91,141,239,.12)">子代理</span>' +
        '<span class="fl-name">' + esc(c.name) + '</span>' + statusGlyph(c.status, c.dur) + '</div>' +
        '<div class="fl-sub-io"><span class="fl-io-tag">入</span><span class="fl-branch-txt">' + esc(inSummary(c)) + '</span></div>' +
      '</div>'
      let steps = ''
      if (cid && sub2) {
        steps += '<div class="fl-sub-meta"><span class="fl-time">↳ ' + esc(cid.slice(0, 8)) + '… · ' + sub2.total + ' 步</span>' + (sub2.live ? '<span class="fl-tag" style="color:var(--tb-done-text,#81c784)">运行中</span>' : '') +
          '<button type="button" class="tb-btn tb-btn-sm" data-action="fenter" data-seq="' + c.seq + '" title="进入该子代理的完整流程图（可逐级返回）">进入 →</button></div>'
        for (const r of sub2.rows) {
          steps += '<div class="fl-sub-step">' +
            (r.pill ? '<span class="fl-branch-pill">' + esc(r.pill) + '</span>' : '') +
            '<span class="fl-branch-txt' + (r.pill ? '' : ' fl-branch-ai') + '">' + esc(r.txt) + '</span>' +
            (r.pill ? statusGlyph(r.status, r.dur) : '') +
          '</div>'
        }
        if (sub2.total > sub2.rows.length) steps += '<div class="fl-sub-step"><span class="fl-time">… 更早 ' + (sub2.total - sub2.rows.length) + ' 步未展开</span></div>'
      } else if (c.status === 'pending') {
        steps = '<div class="fl-sub-step"><span class="fl-time">子代理启动中…</span></div>'
      }
      if (steps) sub += '<div class="fl-sub-steps">' + steps + '</div>'
      if (c.status !== 'pending') {
        const o = outSummary(c)
        sub += '<div class="fl-sub-card fl-sub-close" data-action="fdetail" data-seq="' + c.seq + '" title="点击查看完整任务传入/返回">' +
          '<div class="fl-sub-io"><span class="fl-io-tag">出</span>' +
          '<span class="fl-time">' + fmtDur(c.dur) + '</span>' +
          (o ? '<span class="fl-args">' + esc(o.text) + '</span>' : '') + '</div>' +
        '</div>'
      }
      return sub
    }

    const render = async (st, sid) => {
      const r = await readLog(sid)
      // 活跃度：日志条数较上轮渲染增长 = 会话正在工作（用于助手卡流光；静止会话/他人会话不误亮）
      const prevCount = growth[sid]
      const active = prevCount != null && (r.count || 0) > prevCount
      growth[sid] = r.count || 0
      await loadManifestTools()
      const items = parseItems(r.events || [])
      const nodes = buildNodes(items)
      // 会话仍在运行且最新事件是一条助手消息 → 该助手卡持续流光；日志增长作为 sessions 服务缺失时的兜底。
      const lastIt = items.length ? items[items.length - 1] : null
      let sessionLive = false
      let hasAgentStatus = false
      try {
        const agentsSvc = ctx.get('agents')
        if (agentsSvc) {
          hasAgentStatus = true
          const agent = agentsSvc.get(sid)
          sessionLive = !!(agent && agent.status === 'running')
        }
      } catch (e) {}
      // provider/配额等请求错误有时先把 agent 置 idle，step/end / turn/end 尚未进入本次日志快照。
      // agent 状态是权威终态：强制结算残留流式草稿，避免“正在生成”和客户端计时无限增长。
      if (hasAgentStatus && !sessionLive) {
        const tail = r.events && r.events.length ? r.events[r.events.length - 1] : null
        const settledAt = tail && Number.isFinite(Number(tail.time)) ? Number(tail.time) : null
        for (const it of items) {
          if (it.kind !== 'msg' || it.role !== 'ai' || !it.streaming) continue
          it.streaming = false
          it.interrupted = true
          it.runDur = Math.max(0, (settledAt != null ? settledAt : it.runStart) - it.runStart)
          it.preview = (it.full ? oneLine(it.full, 100) + ' ' : '') + '（生成失败或已中断）'
        }
      }
      const liveAiSeq = (hasAgentStatus ? sessionLive : active) && lastIt && lastIt.kind === 'msg' && lastIt.role === 'ai' && !lastIt.interrupted ? lastIt.seq : null
      const CAP = 60
      const shown = nodes.slice(-CAP)
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root tb-pane" data-flow data-flow-scope="' + esc(sid) + '" data-autorefresh="' + (st.live ? '2000' : '') + '" data-tab-badge="' + (st.live ? String(nodes.length) : '') + '">')
      // 固定头
      parts.push('<div class="tb-pane-head">')
      // 钻取态：查看的不是面板所属会话 → 头部给「← 返回」+ 层级标注（crumbs 栈深度）
      const drilled = !!(st.home && sid !== st.home)
      const depth = drilled && Array.isArray(st.crumbs) ? st.crumbs.length : 0
      parts.push('<div class="tb-row">' +
        (drilled ? '<button type="button" class="tb-btn tb-btn-sm" data-action="fback" title="返回上一级流程图">← 返回</button>' : '') +
        '<span class="tb-sec-label">' + (drilled ? '子代理流镜' : '实时流镜') + '</span>' +
        '<span class="tb-note">' + esc(sid.replace(/^session-/, '').slice(0, 8)) + ' · ' + items.length + ' 条事件 · ' + nodes.length + ' 节点' + (drilled ? ' · 第 ' + (depth + 1) + ' 层' : '') + '</span>' +
        '<button type="button" class="tb-chip' + (st.live ? ' tb-chip-on' : '') + '" data-action="toggle-live">' + (st.live ? '● 实时同步中' : '⏸ 已暂停') + '</button>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button>' +
      '</div>')
      parts.push('<div class="tb-note">泳道：中列主干自上而下（用户/助手）；调用右出输入卡 ▶、左回输出卡 ◀，进行中的调用高亮脉冲；子代理分支在左列（入口/支线/出口），与主干卡同行不留空白；点工具卡看完整传入/返回，点消息卡看完整内容；点子代理分支「进入 →」钻取该子会话的完整流程图</div>')
      parts.push('</div>')
      // 流程体：tb-pane-body 为 column-reverse——这里以「视觉最新在底」渲染：DOM 先放最新节点，滚动条默认贴底
      parts.push('<div class="tb-pane-body">')
      if (!shown.length) {
        parts.push('<div class="tb-notice">当前会话还没有事件</div>')
      } else {
        // 子代理分支内容并行预取（串行 await 会让多个子代理分支的 readLog 延迟叠加）
        const subHtmls = {}
        await Promise.all(shown.map(async (n, i) => { if (n.t === 'sub') subHtmls[i] = await subBranchHtml(n.call) }))
        const rows = []
        for (let i = 0; i < shown.length; i++) {
          const n = shown[i]
          const withConn = rows.length > 0 // 可视首行（最老）不画连接符
          let h
          // 助手消息后紧跟的同步骤节点统一归并：普通调用组(par)与子代理(sub)任意顺序/兼有都并进同一行
          // —— 左=分支、中=助手卡、右=工具组（此前 par/sub 只认单一模式，混合步骤会把子代理落单到下一行导致分支错位）
          if (n.t === 'msg' && n.it.role === 'ai' && shown[i + 1] && (shown[i + 1].t === 'par' || shown[i + 1].t === 'sub')) {
            let parN = null, subN = null, subIdx = -1, next = i + 1
            if (shown[next] && shown[next].t === 'par') { parN = shown[next]; next++ }
            if (shown[next] && shown[next].t === 'sub') { subN = shown[next]; subIdx = next; next++ }
            if (!parN && shown[next] && shown[next].t === 'par') { parN = shown[next]; next++ }
            const call = subN ? subN.call : null
            // 进行中判定：工具组有 pending / 子代理还在跑 / 该助手消息正活跃
            const aiLive = (parN && parN.calls.some((c) => c.status === 'pending')) || (call && call.status === 'pending') || n.it.seq === liveAiSeq
            let main = msgCardInner(n.it, st.expanded, aiLive)
            let lastI = next - 1
            if (call && call.resSeq != null) {
              // 已完成：中列从卡A 起 ▼ 串到「结果之后的第一条消息」（出口卡贴底与其对齐）；
              // 合并边界按轮次（turn）——只吞同轮消息，下一轮的用户/助手消息回到独立行（对齐基准）
              for (let j = next; j < shown.length; j++) {
                const m = shown[j]
                if (m.t !== 'msg') break
                if (call.turn != null && m.it.turn != null && m.it.turn !== call.turn) break
                main += '<span class="fl-arrow">▼</span>' + msgCardInner(m.it, st.expanded, m.it.seq === liveAiSeq)
                lastI = j
                if (m.it.seq > call.resSeq) break
              }
            }
            h = '<div class="fl-lane">' +
              (subN ? '<div class="fl-subcol">' + (subHtmls[subIdx] || '') + '</div>' : '<div></div>') +
              '<div class="fl-lane-main">' + connMain(main, withConn) + '</div>' +
              (parN ? grpSide(parN, parN.calls.map((c) => renderCallWire(c, st.expanded)).join('')) : '<div></div>') +
            '</div>'
            i = lastI
          } else if (n.t === 'msg') h = renderMsg(n.it, st.expanded, withConn, n.it.seq === liveAiSeq)
          else if (n.t === 'par') h = renderPar(n, st.expanded)
          else h = '<div class="fl-lane"><div class="fl-subcol">' + (subHtmls[i] || '') + '</div><div class="fl-lane-main"><span class="fl-lane-line"></span></div><div></div></div>'
          rows.push(h)
        }
        if (nodes.length > CAP) rows.push('<div class="tb-notice">仅显示最近 ' + CAP + ' 个节点（更早 ' + (nodes.length - CAP) + ' 个未加载）</div>')
        parts.push(rows.reverse().join(''))
      }
      parts.push('</div>')
      // 详情右侧浮层：展开状态且目标仍在可视事件集内时渲染（工具调用→传入/返回；消息→完整内容）
      if (st.expanded != null) {
        const target = items.find((it) => it.seq === st.expanded && (it.kind === 'call' || it.kind === 'msg'))
        if (target) parts.push(target.kind === 'call' ? detailRail(target, st.freshSeq === target.seq) : msgRail(target, st.freshSeq === target.seq))
      }
      delete st.freshSeq // 一次性动画标记，不残留进 state
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { live: true, sid: null, home: null, expanded: null, crumbs: [] }
      if (typeof st.expanded !== 'number' && st.expanded != null) st.expanded = null
      if (!Array.isArray(st.crumbs)) st.crumbs = []
      const el = fields && fields.__el ? fields.__el : {}
      // home=面板所属会话（钻取不改变归属）；sid=当前查看的会话（默认=home）
      const home = session || st.home || st.sid
      if (!home) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到当前会话</div></div>', state: st }
      st.home = home
      if (!st.sid) st.sid = home
      if (action === 'toggle-live') st.live = !st.live
      else if (action === 'fdetail' && el.seq != null) {
        const seq = Number(el.seq)
        st.expanded = st.expanded === seq ? null : seq
        st.freshSeq = st.expanded // 仅新展开的那次渲染播放滑入动画（null=收起不播；轮询不重播）
      } else if (action === 'fenter' && el.seq != null) {
        // 钻取：解析当前查看会话的日志，找到该子代理调用的子会话 id 后切入（当前会话压栈）
        const seq = Number(el.seq)
        const r = await readLog(st.sid)
        const call = parseItems(r.events || []).find((it) => it.kind === 'call' && it.seq === seq && it.cat === 'subagent')
        const cid = call ? childIdOf(call) : null
        if (cid && cid !== st.sid) {
          st.crumbs.push({ sid: st.sid, label: call.name + ' ' + cid.slice(0, 8) })
          st.sid = cid
          st.expanded = null
        }
      } else if (action === 'fback') {
        const prev = st.crumbs.pop()
        if (prev && prev.sid) { st.sid = prev.sid; st.expanded = null }
      }
      const sid = st.sid
      try {
        const html = await render(st, sid)
        return { ok: true, html, state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'flow', label: '流镜', order: 2, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="5" height="4" rx="1"/><rect x="8.5" y="9.5" width="5" height="4" rx="1"/><path d="M5.5 6.5V8a3 3 0 0 0 3 3h.5"/><path d="M8 11.5l1.5-1L8 9.5"/></svg>' }, handler)
  },
}
