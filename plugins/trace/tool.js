// ===== trace-tool.js：会话轨迹工具（Host-only，HTML 面板经工具箱 RPC 渲染）=====
// 数据源：sessionQuery.readSession(当前会话) 完整日志（含 tool/call、tool/result、
// user/message、assistant/message、usage），构建 技能/插件/MCP/子代理/命令/文件/内置工具 调用
// 时间线；点击任意条目查看完整输入（arguments 美化）与输出（result 文本）。
// 状态：{ sid, filter, detail }（均为轻量标量；事件本体每次动作重读，不进 state）

return {
  name: 'trace-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')

    // ---- 性能：事件模型缓存（shared-host 的 readLog 负责事件缓存，这里缓存 build 结果） ----
    const readLog = sq ? makeSessionLogReader(ctx, sq) : null
    let modelCache = null   // { sid, count, model, header }
    let recentCache = []    // 会话下拉选项缓存（refresh/pick/首次 才重取）

    const getModel = async (sid) => {
      const r = await readLog(sid)
      if (!modelCache || modelCache.sid !== sid || modelCache.count !== r.count) {
        await loadManifestTools()
        modelCache = { sid, count: r.count, model: build(r.events), header: r.header }
      }
      return modelCache
    }

    // ---- 工具分类（真实来源优先，名字启发式兜底）----
    // 插件类判定三层：
    //   1. cordis_*：动态插件管理面（内置管理工具，语义上属插件体系）
    //   2. ssh_* 等已知宿主组合插件前缀：宿主组合插件注册工具时注册表不留来源标记，只能按名约定
    //   3. 清单 modelTools：plugins.json 各条目声明的模型工具名（make-payloads.mjs 为事实源）。
    //      沙箱的 ctx.tools.get 被刻意降级成 schema 视图（拿不到 harness.registerTool 的动态标记，
    //      日志事件也无 origin 字段），清单是动态插件工具归类的唯一事实源；随 model 重建刷新。
    let manifestTools = []
    const loadManifestTools = async () => {
      try {
        const found = await findManifest(ctx)
        const list = found && found.manifest && Array.isArray(found.manifest.plugins) ? found.manifest.plugins : []
        const names = []
        for (const e of list) {
          if (e && Array.isArray(e.modelTools)) {
            for (const n of e.modelTools) if (typeof n === 'string' && n) names.push(n)
          }
        }
        manifestTools = names
      } catch (e) {}
    }
    const RE_SKILL = /^skill$/
    const RE_MCP = /mcp/i
    const RE_SUBAGENT = /^(subagent|subagent_fork|send_message|interrupt_agent|list_agents|workflow|ralph)$/
    // 命令执行类（pwsh/bash/终端/run_code）：独立于「内置」兜底——这类调用副作用大、排查时常看
    const RE_SHELL = /^(pwsh|bash|sh|terminal_(open|send|read|close|list|signal)|run_code)$/
    // 文件操作类（read/write/edit/glob/grep/read_image）：从「内置」拆出，排查文件改动时高频
    const RE_FILE = /^(read|write|edit|glob|grep|read_image)$/
    const kindOf = (name) => {
      if (/^cordis_/.test(name)) return 'cordis'
      if (/^ssh_/.test(name)) return 'cordis'
      if (manifestTools.indexOf(name) >= 0) return 'cordis'
      if (RE_SKILL.test(name)) return 'skill'
      if (RE_MCP.test(name)) return 'mcp'
      if (RE_SUBAGENT.test(name)) return 'subagent'
      if (RE_SHELL.test(name)) return 'shell'
      if (RE_FILE.test(name)) return 'file'
      return 'builtin'
    }
    const KIND_META = {
      skill: { label: '技能', pill: 'tb-pill-active' },
      cordis: { label: '插件', pill: 'tb-pill-other' },
      mcp: { label: 'MCP', pill: 'tb-pill-done' },
      subagent: { label: '子代理', pill: 'tb-pill-plain' },
      shell: { label: '命令', pill: 'tb-pill-warn' },
      file: { label: '文件', pill: 'tb-pill-active' },
      builtin: { label: '内置', pill: 'tb-pill-plain' },
      msg: { label: '消息', pill: 'tb-pill-plain' },
      user: { label: '用户', pill: 'tb-pill-done' },
      ai: { label: '助手', pill: 'tb-pill-active' },
    }

    const FILTERS = [
      ['skill', '技能'], ['cordis', '插件'], ['mcp', 'MCP'],
      ['subagent', '子代理'], ['shell', '命令'], ['file', '文件'],
      ['builtin', '内置'], ['msg', '消息'], ['error', '失败'],
    ]
    // 「失败」是状态过滤（只看失败调用，与其他分类为并集），不参与「全部」分类开关
    const ALL_CATS = FILTERS.map(([v]) => v).filter((v) => v !== 'error')
    const DEFAULT_FILTERS = ['skill', 'cordis', 'mcp', 'shell']

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => {
      const d = new Date(t)
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    }
    const fmtDur = (ms) => ms == null ? '' : (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's')
    const fmtTok = (n) => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n)
    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && b.type === 'text' ? b.text : '')).filter(Boolean).join('\n')
    }

    // ---- 日志 → 时间线条目 + 统计 ----
    const build = (events) => {
      const items = []
      const byCallId = {}
      const bySeq = {}
      const stats = { turns: 0, steps: 0, calls: 0, inTok: 0, outTok: 0, errors: 0 }
      for (const ev of events) {
        if (!ev || typeof ev.seq !== 'number') continue
        bySeq[ev.seq] = ev
        const d = ev.data || {}
        if (ev.type === 'turn/start') stats.turns++
        else if (ev.type === 'step/start') stats.steps++
        else if (ev.type === 'tool/call') {
          stats.calls++
          const it = {
            kind: 'call', seq: ev.seq, time: ev.time, turn: d.turn, step: d.step,
            name: String(d.name || '?'), cat: kindOf(String(d.name || '')),
            argsRaw: typeof d.arguments === 'string' ? d.arguments : '',
            status: 'pending', dur: null, outLen: 0, resSeq: null,
          }
          items.push(it)
          if (d.callId != null) byCallId[String(d.callId)] = it
        } else if (ev.type === 'tool/result') {
          const m = d.message || {}
          const block = Array.isArray(m.content) ? m.content[0] : null
          const callId = block && block.toolCallId != null ? String(block.toolCallId) : null
          const text = block ? textOf(block.content) : ''
          const failed = !!(d.error || (block && block.isError))
          if (failed) stats.errors++
          const it = callId ? byCallId[callId] : null
          if (it) {
            it.status = failed ? 'error' : 'ok'
            it.dur = ev.time - it.time
            it.outLen = text.length
            it.resSeq = ev.seq
          }
        } else if (ev.type === 'user/message') {
          const m = d
          const src = m.source && m.source.kind ? String(m.source.kind) : 'user'
          items.push({
            kind: 'msg', role: src === 'user' ? 'user' : 'inject', seq: ev.seq, time: ev.time,
            preview: oneLine(textOf(m.content), 90),
          })
        } else if (ev.type === 'assistant/message') {
          const m = d.message || {}
          const u = d.usage || null
          if (u) {
            stats.inTok += (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
            stats.outTok += (u.outputTokens || 0)
          }
          items.push({
            kind: 'msg', role: 'ai', seq: ev.seq, time: ev.time,
            preview: oneLine(textOf(m.content), 90) || '（工具调用）',
            tok: u ? (u.outputTokens || 0) : null,
          })
        }
      }
      return { items, bySeq, byCallId, stats }
    }

    const matchFilter = (it, filters) => {
      // 失败过滤：只看 status=error 的调用（与分类并集）
      if (filters.indexOf('error') >= 0 && it.kind === 'call' && it.status === 'error') return true
      const cat = it.kind === 'msg' ? 'msg' : it.cat
      return filters.indexOf(cat) >= 0
    }

    const statusHtml = (it) => {
      if (it.status === 'ok') return '<span class="tb-tx-done">✓ ' + fmtDur(it.dur) + '</span>'
      if (it.status === 'error') return '<span class="tb-tx-danger">✗ ' + fmtDur(it.dur) + '</span>'
      return '<span class="tb-tx-warn">… 待结果</span>'
    }

    const renderRow = (it, detailSeq) => {
      const km = it.kind === 'call' ? KIND_META[it.cat] : KIND_META[it.role === 'user' || it.role === 'inject' ? 'user' : 'ai']
      const active = detailSeq === it.seq ? ' tb-rec-active' : ''
      if (it.kind === 'call') {
        return '<div class="tb-rec' + active + '" data-action="detail" data-seq="' + it.seq + '">' +
          '<div class="tb-rec-main">' +
            '<div class="tb-rec-top">' +
              '<span class="tb-pill ' + km.pill + '">' + km.label + '</span>' +
              '<span class="tb-rec-key">' + esc(it.name) + '</span>' +
              '<span class="tb-rec-summary">' + esc(oneLine(it.argsRaw, 80)) + '</span>' +
            '</div>' +
            '<div class="tb-rec-sub">' +
              '<span>T' + it.turn + '·S' + it.step + '</span>' +
              '<span>' + fmtTime(it.time) + '</span>' +
              statusHtml(it) +
              (it.outLen ? '<span>输出 ' + fmtSize(it.outLen) + '</span>' : '') +
              '<span>#' + it.seq + '</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      }
      const tag = it.role === 'inject' ? '注入' : km.label
      return '<div class="tb-rec' + active + '" data-action="detail" data-seq="' + it.seq + '">' +
        '<div class="tb-rec-main">' +
          '<div class="tb-rec-top">' +
            '<span class="tb-pill ' + km.pill + '">' + tag + '</span>' +
            '<span class="tb-rec-summary">' + esc(it.preview) + '</span>' +
          '</div>' +
          '<div class="tb-rec-sub">' +
            '<span>' + fmtTime(it.time) + '</span>' +
            (it.tok ? '<span>+' + fmtTok(it.tok) + ' tok</span>' : '') +
            '<span>#' + it.seq + '</span>' +
          '</div>' +
        '</div>' +
      '</div>'
    }

    // 复制用：取详情某部分的完整原文（不截断，截断只用于展示）
    const copyText = (model, seq, which) => {
      const ev = model.bySeq[seq]
      if (!ev) return null
      const d = ev.data || {}
      if (ev.type === 'tool/call') {
        if (which === 'in') {
          let input = d.arguments || ''
          try { input = JSON.stringify(JSON.parse(d.arguments), null, 2) } catch (e) {}
          return input || null
        }
        const it = model.byCallId[d.callId != null ? String(d.callId) : '']
        if (!it || it.resSeq == null) return null
        const rev = model.bySeq[it.resSeq]
        const rm = rev && rev.data && rev.data.message
        const block = rm && Array.isArray(rm.content) ? rm.content[0] : null
        const text = block ? textOf(block.content) : ''
        return text || null
      }
      const m = ev.type === 'assistant/message' ? (d.message || {}) : d
      return textOf(m.content) || null
    }

    // ---- 详情卡（输入/输出完整内容）----
    const renderDetail = (model, detailSeq) => {
      const ev = model.bySeq[detailSeq]
      if (!ev) return ''
      const d = ev.data || {}
      const isCall = ev.type === 'tool/call'
      const head = '<div class="tb-preview-head">' +
        '<span class="tb-preview-name">详情 #' + detailSeq + '</span>' +
        (isCall
          ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-in">复制输入</button>' +
            '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-out">复制输出</button>'
          : '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy-text">复制</button>') +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close-detail">关闭</button></div>'
      if (isCall) {
        let input = d.arguments || ''
        try { input = JSON.stringify(JSON.parse(d.arguments), null, 2) } catch (e) {}
        const it = model.byCallId[d.callId != null ? String(d.callId) : '']
        let out = ''
        if (it && it.resSeq != null) {
          const rev = model.bySeq[it.resSeq]
          const rm = rev && rev.data && rev.data.message
          const block = rm && Array.isArray(rm.content) ? rm.content[0] : null
          const text = block ? textOf(block.content) : ''
          const err = rev && rev.data && rev.data.error
          out = (err ? '[error] ' + esc(err.name || '') + ' ' + esc(err.code || '') + '\n\n' : '') +
            esc(text.length > 12000 ? text.slice(0, 12000) + '\n…（截断，共 ' + text.length + ' 字符）' : text)
        } else {
          out = '（尚无结果事件）'
        }
        return '<div class="tb-preview">' + head +
          '<div class="tb-sec"><span class="tb-sec-label">输入 · ' + esc(String(d.name || '')) + '（T' + d.turn + '·S' + d.step + '）</span>' +
          '<pre class="tb-code">' + esc(input) + '</pre></div>' +
          '<div class="tb-sec"><span class="tb-sec-label">输出</span>' +
          '<pre class="tb-code">' + out + '</pre></div></div>'
      }
      const m = ev.type === 'assistant/message' ? (d.message || {}) : d
      const u = ev.type === 'assistant/message' ? d.usage : null
      const text = textOf(m.content)
      return '<div class="tb-preview">' + head +
        (u ? '<div class="tb-rec-sub"><span>输入 ' + fmtTok((u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)) + ' tok</span><span>输出 ' + fmtTok(u.outputTokens || 0) + ' tok</span>' + (u.cacheReadTokens ? '<span>缓存命中 ' + fmtTok(u.cacheReadTokens) + '</span>' : '') + '</div>' : '') +
        '<pre class="tb-code">' + esc(text.length > 12000 ? text.slice(0, 12000) + '\n…（截断，共 ' + text.length + ' 字符）' : text) + '</pre></div>'
    }

    const handler = async ({ action, fields, state, session }) => {
      if (!sq) return { ok: false, error: 'sessionQuery 服务不可用', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { sid: null, filters: DEFAULT_FILTERS.slice(), detail: null }
      // 旧版单选 state 迁移：filter: 'all' → 全选；filter: 'xxx' → [xxx]
      if (!Array.isArray(st.filters)) {
        st.filters = st.filter && st.filter !== 'all' ? [String(st.filter)] : ALL_CATS.slice()
        delete st.filter
      }
      const el = fields && fields.__el ? fields.__el : {}

      if (action === 'filter' && el.v) {
        const v = String(el.v)
        if (v === 'all') {
          // 「全部」只切分类位，保留「失败」位
          const errOn = st.filters.indexOf('error') >= 0
          const allOn = ALL_CATS.every((c) => st.filters.indexOf(c) >= 0)
          st.filters = allOn ? (errOn ? ['error'] : []) : ALL_CATS.concat(errOn ? ['error'] : [])
        } else {
          const i = st.filters.indexOf(v)
          if (i >= 0) st.filters.splice(i, 1); else st.filters.push(v)
        }
        st.detail = null
      }
      else if (action === 'detail' && el.seq) { const n = Number(el.seq); st.detail = st.detail === n ? null : n }
      else if (action === 'close-detail') st.detail = null
      else if (action === 'pick') { st.sid = fields.sid || null; st.detail = null }

      try {
        // 会话解析：state 覆盖 → 当前会话（Client 透传）→ 最新会话
        // 下拉选项只在 首次/刷新/切换 时重取（listSessions 有持久化扫描成本）
        let sid = st.sid || session || null
        if (recentCache.length === 0 || action === '' || action === 'refresh' || action === 'pick') {
          try {
            recentCache = (await sq.listSessions()).slice(0, 20)
          } catch (e) {}
        }
        const recent = recentCache
        if (!sid && recent.length) sid = String((recent[0].header || {}).id || '')
        if (!sid) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice">未找到会话</div></div>', state: st }
        st.sid = sid

        const got = await getModel(sid)
        const model = got.model
        const st2 = model.stats
        const shortId = sid.replace(/^session-/, '').slice(0, 8)
        const header = got.header || {}
        const cwdName = String(header.cwd || '').split(/[\\/]/).filter(Boolean).pop() || ''

        const filtered = model.items.filter((it) => matchFilter(it, st.filters))
        const CAP = 400
        const shown = filtered.slice(-CAP).reverse()

        const parts = []
        parts.push('<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">')
        // 统计行
        parts.push('<div class="tb-stats">' +
          '<div class="tb-stat"><span class="tb-stat-num">' + st2.turns + '</span><span class="tb-stat-label">轮次</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + st2.steps + '</span><span class="tb-stat-label">步骤</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + st2.calls + '</span><span class="tb-stat-label">工具调用</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(st2.inTok) + '</span><span class="tb-stat-label">输入 tok</span></div>' +
          '<div class="tb-stat"><span class="tb-stat-num">' + fmtTok(st2.outTok) + '</span><span class="tb-stat-label">输出 tok</span></div>' +
        '</div>')
        // 时间线密度条：按分钟分桶（最近 60 分钟窗口内），柱高 = 该分钟事件数——爆发期一眼可见
        const buckets = {}
        let maxB = -Infinity
        let minB = Infinity
        for (const it of model.items) {
          if (typeof it.time !== 'number') continue
          const b = Math.floor(it.time / 60000)
          buckets[b] = (buckets[b] || 0) + 1
          if (b > maxB) maxB = b
          if (b < minB) minB = b
        }
        if (minB <= maxB) {
          const lo = Math.max(minB, maxB - 59)
          const span = maxB - lo + 1
          const maxN = Math.max.apply(null, Object.keys(buckets).map((k) => buckets[k]).concat([1]))
          const bars = []
          for (let b = lo; b <= maxB; b++) {
            const n = buckets[b] || 0
            const d = new Date(b * 60000)
            bars.push('<div style="flex:1;min-width:2px;height:' + Math.max(1, Math.round((n / maxN) * 24)) + 'px;border-radius:1px;background:' +
              (n ? 'var(--tb-accent,#3f6fd9)' : 'var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33))') + ';opacity:.85" title="' +
              pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' · ' + n + ' 条"></div>')
          }
          parts.push('<div class="tb-note">事件密度（' + span + ' 分钟窗，悬停看每分钟计数）</div>' +
            '<div style="display:flex;align-items:flex-end;gap:1px;height:26px;margin:2px 0 6px">' + bars.join('') + '</div>')
        }
        // 会话行
        const opts = recent.map((r) => {
          const id = String((r.header || {}).id || '')
          const lbl = id.replace(/^session-/, '').slice(0, 8) + (r.live ? ' · 在线' : '')
          return '<option value="' + esc(id) + '"' + (id === sid ? ' selected' : '') + '>' + esc(lbl) + '</option>'
        }).join('')
        parts.push('<div class="tb-row">' +
          '<span class="tb-key" title="' + esc(sid) + '">' + esc(shortId) + '</span>' +
          '<span class="tb-note">' + esc(cwdName) + ' · ' + model.items.length + ' 条事件' + (st2.errors ? ' · <span class="tb-tx-danger">' + st2.errors + ' 失败</span>' : '') + '</span>' +
          '<select class="tb-select" data-field="sid">' + opts + '</select>' +
          '<button type="button" class="tb-btn tb-btn-sm" data-action="pick">切换</button>' +
          '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button>' +
        '</div>')
        // 过滤芯片（多选；「全部」= 分类全选/清空开关，不含「失败」状态位）
        const allOn = ALL_CATS.every((v) => st.filters.indexOf(v) >= 0)
        parts.push('<div class="tb-chips">' +
          '<button type="button" class="tb-chip' + (allOn ? ' tb-chip-on' : '') + '" data-action="filter" data-v="all">全部 ' + model.items.length + '</button>' +
          FILTERS.map(([v, label]) => {
            const n = model.items.filter((it) => matchFilter(it, [v])).length
            return '<button type="button" class="tb-chip' + (st.filters.indexOf(v) >= 0 ? ' tb-chip-on' : '') + '" data-action="filter" data-v="' + v + '">' + label + ' ' + n + '</button>'
          }).join('') + '</div>')
        // 详情卡
        if (st.detail != null) {
          const card = renderDetail(model, st.detail)
          if (card) parts.push(card)
        }
        // 时间线标题（固定头末尾）
        parts.push('<div class="tb-list-head"><span class="tb-list-title">调用时间线<span class="tb-count">' + filtered.length + '</span></span></div>')
        parts.push('</div>') // .tb-pane-head 结束
        // 时间线体：独立滚动；column-reverse —— shown 为最新在前（DOM 序），视觉越下越新，滚动条默认底部
        parts.push('<div class="tb-pane-body">' +
          (shown.length === 0
            ? '<div class="tb-notice">该分类下暂无条目</div>'
            : shown.map((it) => renderRow(it, st.detail)).join('') +
              (filtered.length > CAP ? '<div class="tb-notice">仅显示最近 ' + CAP + ' 条（更早的未加载）</div>' : '')) +
        '</div>')
        parts.push('</div>') // .tb-pane 结束
        const out = { ok: true, html: parts.join(''), state: st }
        if ((action === 'copy-in' || action === 'copy-out' || action === 'copy-text') && st.detail != null) {
          const which = action === 'copy-in' ? 'in' : action === 'copy-out' ? 'out' : 'text'
          const txt = copyText(model, st.detail, which)
          if (txt) out.copy = txt
        }
        return out
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'trace', label: '轨迹', order: 3, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.8"/><path d="M8 2.5V8l3.5 2"/></svg>' }, handler)
  },
}
