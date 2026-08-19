// ===== aiassist-tool.js：AI 助手（Host-only）— 7 个 AI 工具合一 =====
// ask/translate/promptopt/review/commitmsg/aisummary/compare 合并为单插件单 Tab「AI 助手」，
// 一张 PRESETS 表（单一事实源）+ 通用 handler + 分段渲染；通过 preset 芯片切换，
// 每个 preset 定义 { id, label, mode, input, params, sys, store, cap } —— 切换 prompt/system 即切换用途。
// 无缝迁移：沿用原 .dsh-dynamic-toolbox/toolbox-<key>.json 落盘文件与台账 tool 键（历史/用量连续）。
// 大本体（git diff / 会话日志采样 / 对比结果）一律留闭包不进 state（state 每次动作来回传输必须轻量）。
// 状态：{ preset, provider, model, picked[], q, path, code, params{target,style,extra}, info, history[], notice }

return {
  name: 'aiassist-tool',
  inject: ['fs', 'llm', 'agentDefaultModel', 'timer'],
  apply(ctx) {
    const ai = makeLlmHelper(ctx)
    const subprocess = ctx.get('subprocess')
    const fsService = ctx.get('fs')
    const sq = ctx.get('sessionQuery')
    const readLog = sq ? makeSessionLogReader(ctx, sq) : null

    // ===== PRESETS 表（单一事实源；store = 落盘文件名，同时是台账 tool 键）=====
    const TARGETS = ['简体中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español', 'Русский']
    const STYLES = ['通用', '代码', '分析', '创意']
    const DIFF_CAP = 8000
    const CODE_CAP = 20000
    const LOG_CAP = 12000
    const LOG_HEAD = 4000
    const LANGS = { js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TSX', jsx: 'JSX', json: 'JSON', py: 'Python', java: 'Java', go: 'Go', rs: 'Rust', yml: 'YAML', yaml: 'YAML', md: 'Markdown', html: 'HTML', css: 'CSS', ps1: 'PowerShell', sh: 'Shell', sql: 'SQL', vue: 'Vue' }

    const PRESETS = [
      { id: 'ask', label: '问答', mode: 'single', input: 'text', params: [],
        hint: '向所选模型直接提问（不写入会话）', store: 'toolbox-ask.json', cap: 10,
        sys: () => '', row: (it) => aiHistoryCard(it, it.q, it.a, '问', '答') },
      { id: 'translate', label: '翻译', mode: 'single', input: 'text',
        params: [{ key: 'target', label: '目标语言', options: TARGETS }],
        hint: '粘贴或输入要翻译的内容（保留 Markdown / 代码格式）', store: 'toolbox-translate.json', cap: 10,
        sys: (st) => '你是专业翻译引擎。规则：只输出译文本身，不输出任何解释、注音、拼音或多余引号；完整保留原文的换行、Markdown 标记与代码格式。目标语言：' + (st.params && st.params.target || TARGETS[0]),
        row: (it) => aiHistoryCard(it, it.src, it.dst, '原文 → ' + (it.target || ''), '译文'), copyKey: 'dst' },
      { id: 'promptopt', label: '优化', mode: 'single', input: 'text',
        params: [{ key: 'style', label: '风格', options: STYLES }],
        hint: '用大白话描述你想让 AI 做什么，优化器负责补全结构', store: 'toolbox-promptopt.json', cap: 10,
        sys: (st) => '你是提示词工程专家。把用户的粗糙草稿改写为高质量结构化提示词，包含【角色】【任务】【背景】【约束】【输出格式】五个小节（不适用的可省略）；风格倾向：' + (st.params && st.params.style || STYLES[0]) + '；语言跟随草稿（中文草稿用中文，英文草稿用英文）；只输出优化后的提示词本身，不要解释、不要代码块围栏。',
        row: (it) => aiHistoryCard(it, it.draft, it.opt, '草稿（' + (it.style || '通用') + '）', '优化后'), copyKey: 'opt' },
      { id: 'review', label: '评审', mode: 'single', input: 'fileOrText', params: [],
        hint: '工作区相对路径或粘贴代码 → 三级评审 + 评分', store: 'toolbox-review.json', cap: 5,
        sys: () => '你是资深代码评审。输出三部分：🔴 严重问题 / 🟡 改进建议 / 🟢 可选优化，每条含位置（行号或函数名）、问题与具体改法；末尾给总体评分 x/10 与一句总结。中文、精炼、Markdown 列表，不要客套话。',
        row: (it) => aiHistoryCard(it, it.target + (it.chars ? '（' + it.chars + ' 字符' + (it.truncated ? '，已截断' : '') + '）' : ''), it.report, '评审对象', '报告'), copyKey: 'report' },
      { id: 'commitmsg', label: '提交信息', mode: 'single', input: 'gitsource',
        params: [{ key: 'extra', label: '补充说明', type: 'text' }],
        hint: '扫描 git diff → 生成 Conventional Commits 中文提交信息', store: 'toolbox-commitmsg.json', cap: 5,
        sys: () => '你是提交信息撰写助手。依据给定 git diff 生成一条符合 Conventional Commits 的提交信息：首行 “type(scope): 中文主题”（≤50 字，type 从 feat/fix/refactor/docs/chore/test/perf/style 中选，scope 可省略）；改动复杂时空一行，每行以 “- ” 列出要点；只输出提交信息本身，不要代码块围栏、不要解释。',
        row: (it) => aiHistoryCard(it, it.scope === 'staged' ? '暂存区改动' : '工作区改动', it.msg, 'diff 范围', '提交信息'), copyKey: 'msg' },
      { id: 'aisummary', label: '摘要', mode: 'single', input: 'sessionlog', params: [],
        hint: '对当前会话做四节 AI 摘要', store: 'toolbox-aisummary.json', cap: 1,
        sys: () => '你是会话摘要助手。把给定的 用户/助手 对话流水整理为四节中文摘要：🎯 目标（用户想达成什么）/ ✅ 进展（已完成的关键事项）/ 🔑 关键决定（技术选型、约定、踩坑结论）/ 📌 待办（未完成或后续要做的事）。每节 1-4 条要点，精炼，不要复述原文。',
        row: (it) => aiHistoryCard(it, it.meta && it.meta.at ? '会话摘要 · ' + it.meta.at : '会话摘要', it.summary, '', '摘要'), copyKey: 'summary' },
      { id: 'compare', label: '对比', mode: 'multi', input: 'text', params: [],
        hint: '同一问题并发发给所有已选模型', store: 'toolbox-compare.json', cap: 3,
        sys: () => '' },
    ]
    const PRESET_MAP = {}
    for (const p of PRESETS) PRESET_MAP[p.id] = p

    // ===== 历史条目标签文案（保持与原 tools 一致） =====
    const LABELS = { ask: '问答', translate: '翻译', promptopt: '优化', review: '评审', commitmsg: '提交信息', aisummary: '摘要', compare: '对比' }

    // ===== 闭包：大本体不进 state =====
    let lastResults = null   // compare 结果本体（{ q, t, items[] }）
    let lastDiff = null      // commitmsg diff 本体（{ scope, text, truncated }）
    let lastLog = null       // aisummary 日志采样本体（{ text, truncated, omitted, events }）
    const paramMem = {}      // presetId -> params 记忆（切换回来恢复上次参数）

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }

    // ===== 通用历史卡片（AI 类历史统一视觉；原 7 个工具的卡片样式不变）=====
    function aiHistoryCard(it, srcText, dstText, srcLabel, dstLabel) {
      const parts = []
      parts.push('<div class="tb-card">')
      if (srcLabel && srcText) parts.push('<div class="tb-sec"><span class="tb-sec-label">' + esc(srcLabel) + '</span>' +
        '<div style="font-size:12.5px;white-space:pre-wrap;word-break:break-word">' + esc(String(srcText).slice(0, 500)) + '</div></div>')
      parts.push(it.err
        ? '<div class="tb-banner tb-banner-error">' + esc(it.err) + '</div>'
        : '<div class="tb-sec"><span class="tb-sec-label">' + esc(dstLabel || '结果') + '</span><pre class="tb-code">' + esc(it.a != null ? it.a : (dstText || '（空结果）')) + '</pre></div>')
      parts.push('<div class="tb-rec-sub"><span>' + esc(it.route || '') + '</span><span>' + it.ms + 'ms</span>' +
        (it.out != null ? '<span>输出 ' + it.out + ' tok</span>' : '') +
        '<span>' + fmtClock(it.t) + '</span>' +
        (dstText ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy" data-i="' + it.__i + '">复制</button>' : '') +
        '</div></div>')
      return parts.join('')
    }

    // ===== 输入源采集：text / fileOrText / gitsource / sessionlog =====
    const collectInput = async (p, st, ws, sessionId) => {
      if (p.input === 'text') {
        return st.q && st.q.trim() ? { content: st.q.trim() } : { error: '请输入内容' }
      }
      if (p.input === 'fileOrText') {
        if (st.path && st.path.trim()) {
          const target = st.path.trim()
          const m = target.toLowerCase().match(/\.([a-z0-9]+)$/)
          const lang = m && LANGS[m[1]] ? LANGS[m[1]] : (m ? m[1] : '')
          if (!fsService) return { error: 'fs 服务不可用' }
          try {
            const t = await fsService.resolve(target, { cwd: ws.root })
            if (!await fsService.stat(t)) return { error: '文件不存在: ' + target }
            const full = await fsService.readText(t)
            const truncated = full.length > CODE_CAP
            return { content: full.slice(0, CODE_CAP), meta: { target, lang, chars: full.length, truncated } }
          } catch (e) { return { error: '读取失败: ' + String((e && e.message) || e) } }
        }
        if (st.code && st.code.trim()) {
          const c = st.code.trim()
          return { content: c.slice(0, CODE_CAP), meta: { target: '(粘贴代码)', chars: c.length, truncated: c.length > CODE_CAP } }
        }
        return { error: '请填写文件路径或粘贴代码' }
      }
      if (p.input === 'gitsource') {
        const scan = await scanGit(ws.root)
        if (scan.error) return { error: scan.error }
        lastDiff = scan
        return { meta: scan }
      }
      if (p.input === 'sessionlog') {
        if (!readLog) return { error: 'sessionQuery 服务不可用' }
        if (!sessionId) return { error: '未获取到当前会话 ID' }
        const r = await readLog(sessionId)
        const t = transcript(r.events || [])
        if (!t.text.trim()) return { error: '当前会话还没有可摘要的对话内容' }
        lastLog = { text: t.text, truncated: t.truncated, omitted: t.omitted, events: r.count }
        return { meta: { events: r.count, chars: t.text.length, truncated: t.truncated, omitted: t.omitted } }
      }
      return { error: '未知输入类型' }
    }

    // ===== commitmsg：git scan（沿用原实现；diff 本体留闭包）=====
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
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    }
    const firstLine = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 3).join(' | ')
    const scanGit = async (root) => {
      if (!subprocess) return { error: 'subprocess 服务不可用' }
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
      return { scope, text: full.slice(0, DIFF_CAP), truncated: full.length > DIFF_CAP, staged, unstaged, untracked, chars: full.length, empty: !full }
    }

    // ===== aisummary：会话日志 → 对话流水（沿用原实现）=====
    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && b.type === 'text' ? b.text : '')).filter(Boolean).join('\n')
    }
    const transcript = (events) => {
      const lines = []
      for (const ev of events) {
        if (!ev || typeof ev.seq !== 'number') continue
        const d = ev.data || {}
        if (ev.type === 'user/message') {
          const t = textOf(d.content)
          if (t) lines.push('用户：' + t)
        } else if (ev.type === 'assistant/message') {
          const t = textOf((d.message || {}).content)
          if (t) lines.push('助手：' + t)
        }
      }
      const full = lines.join('\n\n')
      if (full.length <= LOG_CAP) return { text: full, truncated: false, omitted: 0 }
      const head = full.slice(0, LOG_HEAD)
      const tail = full.slice(-(LOG_CAP - LOG_HEAD))
      return { text: head + '\n\n…（中间省略 ' + (full.length - LOG_CAP) + ' 字符）…\n\n' + tail, truncated: true, omitted: full.length - LOG_CAP }
    }

    // ===== 磁盘历史读写（按 preset 的 store 文件；读取归一化为数组）=====
    const storeRel = (p) => '.dsh-dynamic-toolbox/' + p.store
    const loadHistory = async (p, ws) => {
      const saved = await readJsonStore(ctx, storeRel(p), ws.root, null)
      if (p.id === 'aisummary') {
        // aisummary 磁盘是单对象 { sid, summary, meta }（原实现结构，保持兼容）
        if (saved && typeof saved.summary === 'string' && saved.summary) return [saved]
        return []
      }
      return Array.isArray(saved) ? saved : []
    }
    const persistHistory = async (p, st, ws) => {
      let data = st.history || []
      if (p.id === 'aisummary') {
        const top = data[0]
        if (!top) data = []
        else data = { sid: top.sid, summary: top.summary, meta: top.meta }
      }
      return writeJsonStore(ctx, storeRel(p), data, ws.root, ws.session)
    }

    // ===== 对比默认路由（仅供参考提示；不强制）=====
    const defaultRoute = async () => {
      const tmp = { provider: '', model: '' }
      await ai.resolveRoute(tmp)
      return tmp.provider && tmp.model ? tmp.provider + '/' + tmp.model : ''
    }
    const askOne = async (q, route, ws) => {
      const slash = route.indexOf('/')
      const st = { provider: route.slice(0, slash), model: route.slice(slash + 1) }
      const r = await ai.chat(st, '', q, undefined, { root: ws.root, session: ws.session, tool: 'compare' })
      return { route, a: r.a || '', ms: r.ms || 0, out: r.out != null ? r.out : null, err: r.err || null }
    }

    // ===== 渲染 =====
    const render = (st, route, roll) => {
      const p = PRESET_MAP[st.preset] || PRESETS[0]
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      // preset 芯片行
      parts.push('<div class="tb-chips">' + PRESETS.map((x) =>
        '<button type="button" class="tb-chip' + (x.id === p.id ? ' tb-chip-on' : '') + '" data-action="preset" data-p="' + esc(x.id) + '">' + esc(x.label) + '</button>'
      ).join('') + '</div>')
      // 路由 / 模型选择
      if (p.mode === 'multi') {
        parts.push('<div class="tb-row">' +
          '<select class="tb-select" data-field="provider" data-action-onchange="route" title="Provider（切换后自动加载模型芯片）">' +
            route.providers.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === st.provider ? ' selected' : '') + '>' + esc(x.name || x.id) + '</option>').join('') +
          '</select>' +
          '<span class="tb-note">点芯片加入对比，再点移除' + (roll && roll.calls ? ' · 累计 ' + roll.calls + ' 次 / 输出 ' + roll.out + ' tok' : '') + '</span></div>')
        if (route.models.length) {
          parts.push('<div class="tb-chips">' + route.models.map((m) => {
            const r = st.provider + '/' + m.id
            const on = (st.picked || []).indexOf(r) >= 0
            return '<button type="button" class="tb-chip' + (on ? ' tb-chip-on' : '') + '" data-action="pick" data-r="' + esc(r) + '">' + esc(m.name || m.id) + '</button>'
          }).join('') + '</div>')
        }
        parts.push('<div class="tb-row"><span class="tb-sec-label">已选 ' + (st.picked || []).length + ' 个：</span>' +
          ((st.picked || []).length
            ? st.picked.map((r) => '<button type="button" class="tb-chip tb-chip-on" data-action="pick" data-r="' + esc(r) + '" title="点击移除">' + esc(r) + ' ×</button>').join('')
            : '<span class="tb-note">（至少选 1 个）</span>') +
        '</div>')
      } else {
        const note = '旁路调用 · 不写入会话' + (roll && roll.calls ? ' · 累计 ' + roll.calls + ' 次 / 输出 ' + roll.out + ' tok' : '')
        parts.push(ai.routeRow(st, route, note))
      }
      // 参数区（translate 目标语言 / promptopt 风格 / commitmsg 补充说明）
      for (const param of p.params || []) {
        if (param.options) {
          parts.push('<div class="tb-row"><span class="tb-sec-label">' + esc(param.label) + '</span>' +
            '<select class="tb-select" data-field="' + esc(param.key) + '">' +
              param.options.map((o) => '<option value="' + esc(o) + '"' + (o === (st.params || {})[param.key] ? ' selected' : '') + '>' + esc(o) + '</option>').join('') +
            '</select></div>')
        } else if (param.type === 'text') {
          parts.push('<div class="tb-sec"><span class="tb-sec-label">' + esc(param.label) + '（可选）</span>' +
            '<input class="tb-input" data-field="' + esc(param.key) + '" placeholder="如：这次改动是为了修复重建时主题丢失" value="' + esc((st.params || {})[param.key] || '') + '"></div>')
        }
      }
      // 输入区
      if (p.input === 'text') {
        parts.push('<div class="tb-sec"><span class="tb-sec-label">' + (p.mode === 'multi' ? '问题' : '输入') + '</span>' +
          '<textarea class="tb-textarea" data-field="q" placeholder="' + esc(p.hint || '') + '">' + esc(st.q || '') + '</textarea></div>')
      } else if (p.input === 'fileOrText') {
        parts.push('<div class="tb-sec"><span class="tb-sec-label">文件路径（工作区相对，优先于粘贴）</span>' +
          '<input class="tb-input tb-mono" data-field="path" placeholder="如 shared/host.js" value="' + esc(st.path || '') + '"></div>')
        parts.push('<div class="tb-sec"><span class="tb-sec-label">或直接粘贴代码</span>' +
          '<textarea class="tb-textarea" data-field="code" placeholder="路径留空时评审这里粘贴的代码">' + esc(st.code || '') + '</textarea></div>')
      } else if (p.input === 'gitsource' || p.input === 'sessionlog') {
        if (st.info) {
          if (st.info.error) {
            parts.push('<div class="tb-banner tb-banner-error">' + esc(st.info.error) + '</div>')
          } else if (p.input === 'gitsource') {
            parts.push('<div class="tb-banner tb-banner-info">暂存 ' + st.info.staged + ' · 未暂存 ' + st.info.unstaged + ' · 未跟踪 ' + st.info.untracked +
              (st.info.empty ? ' · 暂存区与工作区 diff 均为空（未跟踪文件不参与 diff）'
                : ' · 取用 ' + (st.info.scope === 'staged' ? '暂存区' : '工作区') + ' diff ' + st.info.chars + ' 字符' + (st.info.truncated ? '（超 ' + DIFF_CAP + ' 已截断）' : '')) +
              '</div>')
          } else if (p.input === 'sessionlog') {
            parts.push('<div class="tb-banner tb-banner-info">事件 ' + st.info.events + ' · 对话 ' + st.info.chars + ' 字符' +
              (st.info.truncated ? '（首尾采样，省略 ' + st.info.omitted + '）' : '') + '</div>')
          }
        }
      }
      // 动作按钮
      const btn = { ask: '发送', translate: '翻译', promptopt: '优化提示词', review: '开始评审', commitmsg: '生成提交信息', aisummary: '生成 / 刷新摘要', compare: '并发对比' }
      const acts = []
      if (p.input === 'gitsource' || p.input === 'sessionlog') {
        acts.push('<button type="button" class="tb-btn" data-action="scan">' + (p.input === 'gitsource' ? '扫描改动' : '读取会话') + '</button>')
      }
      acts.push('<button type="button" class="tb-btn tb-btn-primary" data-action="send">' + (btn[p.id] || '执行') + '</button>')
      if ((st.history || []).length) acts.push('<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear">清空历史</button>')
      if (p.mode === 'multi' && lastResults) acts.push('<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear-results">清除结果</button>')
      parts.push('<div class="tb-row">' + acts.join('') + '</div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      // 结果 / 历史区
      if (p.mode === 'multi') {
        const res = lastResults
        if (res) {
          parts.push('<div class="tb-card" style="gap:6px"><div class="tb-sec"><span class="tb-sec-label">问题 · ' + fmtClock(res.t) + '</span>' +
            '<div style="font-size:12.5px;white-space:pre-wrap;word-break:break-word">' + esc(res.q) + '</div></div></div>')
          for (const it of res.items) {
            parts.push('<div class="tb-card">' +
              '<div class="tb-card-head"><span class="tb-key">' + esc(it.route) + '</span>' +
              '<span class="tb-note">' + it.ms + 'ms' + (it.out != null ? ' · 输出 ' + it.out + ' tok' : '') + '</span></div>' +
              (it.err
                ? '<div class="tb-banner tb-banner-error">' + esc(it.err) + '</div>'
                : '<pre class="tb-code">' + esc(it.a || '（空回复）') + '</pre>') +
            '</div>')
          }
        } else {
          parts.push('<div class="tb-notice">结果区：并发对比后按模型分别展示</div>')
        }
      } else {
        const h = st.history || []
        for (let i = 0; i < h.length; i++) {
          const it = Object.assign({}, h[i], { __i: i })
          parts.push(p.row ? p.row(it) : aiHistoryCard(it, '', it.a, '', '结果'))
        }
        if (!h.length) parts.push('<div class="tb-notice">' + (p.id === 'aisummary' ? '点击「生成 / 刷新摘要」对当前会话做 AI 摘要（最近一次结果落盘保留）' : (p.id === 'compare' ? '' : '结果显示在这里（最近 ' + p.cap + ' 条落盘保留）')) + '</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    // ===== handler（通用动作分派）=====
    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const init = { preset: 'ask', provider: '', model: '', picked: [], q: '', path: '', code: '', params: {}, info: null, history: [], notice: null }
      const st = (state && typeof state === 'object' && state) ? state : init
      if (!Array.isArray(st.history)) st.history = []
      if (!Array.isArray(st.picked)) st.picked = []
      if (!st.params || typeof st.params !== 'object') st.params = {}
      const el = fields && fields.__el ? fields.__el : {}
      const p = PRESET_MAP[st.preset] || PRESETS[0]

      // 同步表单字段
      if (typeof fields.q === 'string') st.q = fields.q
      if (typeof fields.path === 'string') st.path = fields.path
      if (typeof fields.code === 'string') st.code = fields.code
      if (typeof fields.provider === 'string' && fields.provider) st.provider = fields.provider
      if (typeof fields.model === 'string' && fields.model) st.model = fields.model
      for (const param of p.params || []) {
        if (typeof fields[param.key] === 'string') st.params[param.key] = fields[param.key]
      }

      // 动作分派
      if (action === 'preset' && el.p && PRESET_MAP[el.p]) {
        paramMem[st.preset] = st.params
        st.preset = el.p
        st.params = paramMem[el.p] || {}
        st.info = null
        st.notice = null
        const np = PRESET_MAP[st.preset]
        st.history = await loadHistory(np, ws)
        if (np.mode === 'multi' && !st.picked.length) {
          const d = await defaultRoute()
          if (d) st.picked = [d]
        }
      } else if (action === 'route') {
        st.model = ''
        if (p.mode === 'multi') st.picked = [] // provider 换了，旧芯片路由作废（与 compare 原行为一致）
      } else if (action === 'pick' && el.r && p.mode === 'multi') {
        const i = st.picked.indexOf(String(el.r))
        if (i >= 0) st.picked.splice(i, 1); else st.picked.push(String(el.r))
      } else if (action === 'scan') {
        const inp = await collectInput(p, st, ws, session)
        if (inp.error) { st.notice = inp.error; st.info = null }
        else if (inp.meta) st.info = inp.meta
      } else if (action === 'clear') {
        st.history = []
        const persisted = await persistHistory(p, st, ws)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + storeRel(p) + '，仅保存在面板内存中'
      } else if (action === 'send') {
        if (!ai.available) {
          st.notice = 'llm 服务不可用（可切换 preset 浏览历史）'
        } else if (p.mode === 'multi') {
          if (!(st.q || '').trim()) {
            st.notice = '请输入问题'
          } else if (!st.picked.length) {
            st.notice = '请至少选择 1 个模型'
          } else {
            const items = await Promise.all(st.picked.map((r) => askOne(st.q.trim(), r, ws)))
            lastResults = { q: st.q.trim(), t: Date.now(), items }
            const saved = await readJsonStore(ctx, storeRel(p), ws.root, [])
            const rounds = [{
              q: lastResults.q, t: lastResults.t,
              items: items.map((it) => ({ route: it.route, a: String(it.a || '').slice(0, 4000), err: it.err, ms: it.ms, out: it.out })),
            }].concat(Array.isArray(saved) ? saved : []).slice(0, p.cap)
            st.history = rounds
            const persisted = await writeJsonStore(ctx, storeRel(p), rounds, ws.root, ws.session)
            st.notice = persisted ? null : '⚠ 对比记录未能写入 ' + storeRel(p)
          }
        } else {
          const inp = await collectInput(p, st, ws, session)
          if (inp.error) {
            st.notice = inp.error
          } else if (!ai.available) {
            st.notice = 'llm 服务不可用'
          } else {
            await ai.resolveRoute(st)
            let user
            if (p.id === 'commitmsg') {
              user = (st.params.extra && st.params.extra.trim() ? '补充说明：' + st.params.extra.trim() + '\n\n' : '') +
                'git diff（' + (lastDiff.scope === 'staged' ? '暂存区' : '工作区') + (lastDiff.truncated ? '，已截断' : '') + '）：\n' + lastDiff.text
            } else if (p.id === 'review') {
              user = '文件：' + inp.meta.target + (inp.meta.lang ? '（' + inp.meta.lang + '）' : '') + '\n```\n' + inp.content + '\n```' + (inp.meta.truncated ? '\n（内容过长，仅评审前 ' + CODE_CAP + ' 字符）' : '')
            } else if (p.id === 'aisummary') {
              user = lastLog ? lastLog.text : ''
            } else {
              user = inp.content
            }
            const r = await ai.chat(st, p.sys(st), user, undefined, { root: ws.root, session: ws.session, tool: p.id })
            const ts = Date.now()
            if (p.id === 'translate') {
              st.history = [{
                src: inp.content.slice(0, 500), dst: (r.a || '').slice(0, 4000), err: r.err || null,
                target: st.params.target || TARGETS[0], ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: ts,
              }].concat(st.history || []).slice(0, p.cap)
            } else if (p.id === 'promptopt') {
              st.history = [{
                draft: inp.content.slice(0, 300), opt: (r.a || '').slice(0, 6000), err: r.err || null,
                style: st.params.style || STYLES[0], ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: ts,
              }].concat(st.history || []).slice(0, p.cap)
            } else if (p.id === 'review') {
              st.history = [{
                target: inp.meta.target, chars: inp.content.length, truncated: inp.meta.truncated, report: (r.a || '').slice(0, 8000), err: r.err || null,
                ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: ts,
              }].concat(st.history || []).slice(0, p.cap)
            } else if (p.id === 'commitmsg') {
              st.history = [{
                msg: (r.a || '').slice(0, 2000), err: r.err || null, scope: lastDiff.scope,
                ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: ts,
              }].concat(st.history || []).slice(0, p.cap)
            } else if (p.id === 'aisummary') {
              let at = ''
              try { at = new Date().toISOString().slice(0, 19).replace('T', ' ') } catch (e) {}
              st.history = [{
                sid: session, summary: (r.a || '').slice(0, 8000),
                meta: { events: lastLog.events, chars: lastLog.text.length, truncated: lastLog.truncated, omitted: lastLog.omitted, ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', at },
              }]
            } else {
              st.history = [{ q: inp.content, a: r.a || '', err: r.err || null, ms: r.ms || 0, out: r.out != null ? r.out : null, route: r.route || '', t: ts }].concat(st.history || []).slice(0, p.cap)
            }
            const persisted = await persistHistory(p, st, ws)
            st.notice = persisted ? null : '⚠ 历史未能写入 ' + storeRel(p) + '，仅保存在面板内存中'
          }
        }
      } else if (action === 'clear-results') {
        lastResults = null
      } else if (action === '') {
        st.history = await loadHistory(p, ws)
        if (p.id === 'compare') {
          const saved = st.history
          if (Array.isArray(saved) && saved.length && saved[0] && Array.isArray(saved[0].items)) lastResults = saved[0]
          const d = await defaultRoute()
          if (!st.picked.length && d) st.picked = [d]
        }
        st.info = null
        st.notice = null
      }

      // 渲染数据
      const show = st
      const route = await ai.resolveRoute(show)
      const roll = await ai.rollup(ws.root, p.id)
      const out = { ok: true, html: render(show, route, roll), state: show }
      if (action === 'copy' && el.i != null) {
        const it = (st.history || [])[Number(el.i)]
        const copyKey = p.copyKey || 'a'
        if (it && typeof it[copyKey] === 'string' && it[copyKey]) out.copy = it[copyKey]
      }
      return out
    }

    tryRegisterTool(ctx, { id: 'aiassist', label: 'AI 助手', order: 11, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l1.4 2.8 3.1.45-2.25 2.2.5 3.1-2.75-1.45-2.75 1.45.5-3.1-2.25-2.2 3.1-.45z"/><circle cx="13" cy="13" r="1.2"/></svg>' }, handler)
  },
}