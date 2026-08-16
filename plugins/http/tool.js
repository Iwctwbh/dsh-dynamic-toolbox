// ===== http-tool.js：HTTP 接口调试工具（Host-only，Postman/Apifox 风格）=====
// method 芯片 + URL + Query Params / Headers 键值对编辑器（启用开关/增删行）+
// Body 类型（none/JSON/raw/form）+ 响应区 Body/响应头切换与 JSON 美化 + 历史一键重发。
// 所有输入常驻 DOM（display:none 隐藏），保证任何动作时表单值完整回传进 state。
// 请求 spec 经环境变量传入 node 子进程 fetch，用户输入不进脚本文本。
// 响应本体留闭包 lastResult（可达 256KB，不进 state——state 每次动作来回传输，必须轻量）。
// 状态：{ method, url, params[], headers[], bodyType, body, form[], tab, resTab, history[] }

return {
  name: 'http-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    let lastResult = null // 最近一次响应本体（闭包持有，不进 state；插件重跑即清空，面板提示重发）

    // 子进程脚本：数组 join 无内嵌 \n 字面量（规避双层求值转义坑）
    const FETCH_SCRIPT = [
      "const spec = JSON.parse(process.env.HTTP_REQ || '{}')",
      "const ctrl = new AbortController()",
      "setTimeout(() => ctrl.abort(), 30000)",
      "const t0 = Date.now()",
      "(async () => {",
      "  try {",
      "    const init = { method: spec.method || 'GET', headers: spec.headers || {}, redirect: 'follow', signal: ctrl.signal }",
      "    if (spec.body != null && spec.body !== '' && init.method !== 'GET' && init.method !== 'HEAD') init.body = spec.body",
      "    const res = await fetch(spec.url, init)",
      "    const buf = Buffer.from(await res.arrayBuffer())",
      "    const headers = {}",
      "    res.headers.forEach((v, k) => { headers[k] = v })",
      "    let body = buf.toString('utf8')",
      "    const truncated = body.length > 262144",
      "    if (truncated) body = body.slice(0, 262144)",
      "    process.stdout.write(JSON.stringify({ ok: true, status: res.status, statusText: res.statusText, headers, body, bytes: buf.length, truncated, ms: Date.now() - t0 }))",
      "  } catch (e) {",
      "    process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e), ms: Date.now() - t0 }))",
      "  }",
      "})()",
    ].join('\n')

    const REL_STORE = '.dsh-dynamic-toolbox/toolbox-http.json'

    // sessionId 优先：root 与 session 同时确定（写策略按会话 cwd 授权）
    const resolveWs = (rootArg, sessionId) => {
      const sessionsSvc = ctx.get('sessions')
      if (sessionId && sessionsSvc) {
        try {
          const s = sessionsSvc.get(sessionId)
          const cwd = s && s.header && s.header.cwd
          if (s && typeof cwd === 'string' && cwd) return { root: cwd.replace(/[\\/]+$/, ''), session: s }
        } catch (e) {}
      }
      if (rootArg && /^([A-Za-z]:[\\/]|\/)/.test(rootArg)) return { root: rootArg.replace(/[\\/]+$/, ''), session: null }
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

    const runNode = async (script, env, cwd) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      const handle = subprocess.spawn({
        argv: ['node', '-'],
        cwd,
        stdio: { stdin: { data: script }, stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 128 * 1024 } },
        graceMs: 45000,
        env,
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout.readFrom(0).text
      const stderr = handle.collected.stderr.readFrom(0).text
      if (outcome.exitCode !== 0) return { ok: false, error: (stderr || stdout).slice(0, 500) }
      return { ok: true, stdout }
    }

    // ---- 键值对（params/headers/form）同步与组装 ----
    const syncKV = (fields, prefix, cur) => {
      const rows = []
      for (let i = 0; ; i++) {
        const k = fields[prefix + '.k.' + i]
        const v = fields[prefix + '.v.' + i]
        if (k === undefined && v === undefined) break
        rows.push({ k: String(k == null ? '' : k), v: String(v == null ? '' : v), on: cur && cur[i] ? cur[i].on !== false : true })
      }
      return rows
    }
    const enabled = (rows) => (rows || []).filter((r) => r.on !== false && r.k)

    const buildRequest = (st) => {
      let url = st.url || ''
      const qp = enabled(st.params)
      if (qp.length) {
        const q = qp.map((r) => encodeURIComponent(r.k) + '=' + encodeURIComponent(r.v)).join('&')
        url += (url.indexOf('?') >= 0 ? '&' : '?') + q
      }
      const headers = {}
      for (const r of enabled(st.headers)) headers[r.k] = r.v
      let body = null
      if (st.bodyType === 'json') {
        body = st.body || ''
        if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'
      } else if (st.bodyType === 'raw') {
        body = st.body || ''
      } else if (st.bodyType === 'form') {
        body = enabled(st.form).map((r) => encodeURIComponent(r.k) + '=' + encodeURIComponent(r.v)).join('&')
        if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
      return { method: st.method, url, headers, body }
    }

    const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
    const BODY_TYPES = [['none', 'none'], ['json', 'JSON'], ['raw', 'raw'], ['form', 'form']]
    const TABS = [['params', 'Params'], ['headers', 'Headers'], ['body', 'Body']]
    const statusPill = (s) => {
      if (s >= 200 && s < 300) return 'tb-pill-done'
      if (s >= 300 && s < 400) return 'tb-pill-active'
      if (s >= 400 && s < 500) return 'tb-pill-other'
      return 'tb-pill-plain'
    }
    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const prettyBody = (body) => {
      const t = String(body || '')
      try { return JSON.stringify(JSON.parse(t), null, 2) } catch (e) { return t }
    }

    // ---- 键值对编辑器（Postman 风格：开关 + key + value + 删除 + 添加行）----
    const renderKV = (list, rows, addLabel) => {
      const rowsHtml = (rows || []).map((r, i) =>
        '<div class="tb-row" style="flex-wrap:nowrap;gap:5px">' +
          '<button type="button" class="tb-chip' + (r.on !== false ? ' tb-chip-on' : '') + '" style="height:20px;padding:0 7px;flex:none" data-action="kv-toggle" data-list="' + list + '" data-i="' + i + '" title="启用/禁用">' + (r.on !== false ? '✓' : '○') + '</button>' +
          '<input class="tb-input tb-mono" style="height:26px;width:36%;flex:none" data-field="' + list + '.k.' + i + '" placeholder="Key" value="' + esc(r.k) + '" />' +
          '<input class="tb-input tb-mono" style="height:26px" data-field="' + list + '.v.' + i + '" placeholder="Value" value="' + esc(r.v) + '" />' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" style="flex:none" data-action="kv-del" data-list="' + list + '" data-i="' + i + '" title="删除">×</button>' +
        '</div>'
      ).join('')
      return rowsHtml + '<div class="tb-row"><button type="button" class="tb-btn tb-btn-sm" data-action="kv-add" data-list="' + list + '">+ ' + addLabel + '</button></div>'
    }

    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      // 方法 + URL + 发送
      parts.push('<div class="tb-chips">' + METHODS.map((m) =>
        '<button type="button" class="tb-chip' + (st.method === m ? ' tb-chip-on' : '') + '" data-action="method" data-v="' + m + '">' + m + '</button>'
      ).join('') + '</div>')
      parts.push('<div class="tb-query">' +
        '<input class="tb-input tb-mono" data-field="url" placeholder="https://api.example.com/path" value="' + esc(st.url || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="send">发送</button>' +
      '</div>')
      // 最终 URL 预览（Params 合并后）
      const req = buildRequest(st)
      if (st.url && req.url !== st.url) {
        parts.push('<div class="tb-note tb-mono" style="word-break:break-all">最终 URL：' + esc(req.url) + '</div>')
      }
      // 分区芯片
      const tab = st.tab || 'params'
      parts.push('<div class="tb-chips">' + TABS.map(([v, label]) => {
        const n = v === 'params' ? enabled(st.params).length : v === 'headers' ? enabled(st.headers).length : (st.bodyType === 'form' ? enabled(st.form).length : (st.bodyType === 'none' ? 0 : 1))
        return '<button type="button" class="tb-chip' + (tab === v ? ' tb-chip-on' : '') + '" data-action="tab" data-v="' + v + '">' + label + (n ? ' ' + n : '') + '</button>'
      }).join('') + '</div>')

      // 三个分区全部渲染，非活跃区 display:none（保证字段随任何动作回传）
      parts.push('<div style="' + (tab === 'params' ? '' : 'display:none') + '">' + renderKV('params', st.params, '参数') + '</div>')
      parts.push('<div style="' + (tab === 'headers' ? '' : 'display:none') + '">' + renderKV('headers', st.headers, '请求头') + '</div>')
      let bodyHtml = '<div class="tb-chips" style="margin-bottom:8px">' + BODY_TYPES.map(([v, label]) =>
        '<button type="button" class="tb-chip' + (st.bodyType === v ? ' tb-chip-on' : '') + '" data-action="body-type" data-v="' + v + '">' + label + '</button>'
      ).join('') + '</div>'
      if (st.bodyType === 'json' || st.bodyType === 'raw') {
        bodyHtml += '<textarea class="tb-textarea" data-field="body" placeholder="' + (st.bodyType === 'json' ? '{ "key": "value" }' : '原始请求体') + '">' + esc(st.body || '') + '</textarea>'
      } else if (st.bodyType === 'form') {
        bodyHtml += renderKV('form', st.form, '表单项')
      } else {
        bodyHtml += '<div class="tb-note">无请求体</div>'
      }
      parts.push('<div style="' + (tab === 'body' ? '' : 'display:none') + '">' + bodyHtml + '</div>')

      // 响应区（本体在闭包 lastResult；state 不带它，切换 Tab/KV 编辑不再来回传大 JSON）
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      const r = lastResult
      if (r) {
        if (!r.ok) {
          parts.push('<div class="tb-banner tb-banner-error">' + esc(r.error || '请求失败') + (r.ms != null ? '（' + r.ms + 'ms）' : '') + '</div>')
        } else {
          const resTab = st.resTab || 'body'
          parts.push('<div class="tb-card">' +
            '<div class="tb-card-head">' +
              '<span class="tb-pill ' + statusPill(r.status) + '">' + r.status + ' ' + esc(r.statusText || '') + '</span>' +
              '<span class="tb-note">' + r.ms + 'ms · ' + fmtSize(r.bytes) + (r.truncated ? ' · 已截断' : '') + '</span>' +
            '</div>' +
            '<div class="tb-chips">' +
              '<button type="button" class="tb-chip' + (resTab === 'body' ? ' tb-chip-on' : '') + '" data-action="res-tab" data-v="body">响应体</button>' +
              '<button type="button" class="tb-chip' + (resTab === 'headers' ? ' tb-chip-on' : '') + '" data-action="res-tab" data-v="headers">响应头 ' + Object.keys(r.headers || {}).length + '</button>' +
              (r.body ? '<button type="button" class="tb-chip" data-action="copy-res">复制响应体</button>' : '') +
            '</div>' +
            (resTab === 'body'
              ? '<pre class="tb-code" style="max-height:480px">' + esc(prettyBody(r.body) || '（空）') + '</pre>'
              : '<div class="tb-sec">' + Object.keys(r.headers || {}).map((k) =>
                  '<div class="tb-line"><span class="tb-line-status tb-tx-muted" style="width:auto;min-width:120px;text-align:left">' + esc(k) + '</span><span class="tb-line-path">' + esc(r.headers[k]) + '</span></div>'
                ).join('') + '</div>') +
          '</div>')
        }
      }

      // 历史
      const h = st.history || []
      if (h.length) {
        parts.push('<div class="tb-list-head"><span class="tb-list-title">历史<span class="tb-count">' + h.length + '</span></span>' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear-history">清空</button></div>')
        parts.push('<div class="tb-list">' + h.map((it, i) =>
          '<div class="tb-rec" data-action="rerun" data-i="' + i + '" title="点击重新发送">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-pill tb-pill-plain">' + esc(it.m) + '</span>' +
              '<span class="tb-rec-summary">' + esc(oneLine(it.u, 70)) + '</span></div>' +
              '<div class="tb-rec-sub"><span>' + (it.s ? '<span class="' + (it.s < 400 ? 'tb-tx-done' : 'tb-tx-danger') + '">' + it.s + '</span>' : '<span class="tb-tx-danger">失败</span>') + '</span>' +
              '<span>' + (it.ms != null ? it.ms + 'ms' : '') + '</span><span>' + fmtClock(it.t) + '</span></div>' +
            '</div>' +
          '</div>'
        ).join('') + '</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    const send = async (st, ws) => {
      const spec = buildRequest(st)
      const res = await runNode(FETCH_SCRIPT, { HTTP_REQ: JSON.stringify(spec) }, ws.root)
      if (!res.ok) { lastResult = { ok: false, error: res.error }; return }
      try {
        lastResult = JSON.parse(res.stdout)
      } catch (e) {
        lastResult = { ok: false, error: '响应解析失败: ' + res.stdout.slice(0, 300) }
      }
      const r = lastResult
      st.history = [{
        m: spec.method, u: spec.url,
        params: st.params, headers: st.headers, bodyType: st.bodyType, body: st.body, form: st.form,
        s: r.ok ? r.status : 0, ms: r.ms != null ? r.ms : null, t: Date.now(),
      }].concat(st.history || []).slice(0, 8)
      const persisted = await writeJsonStore(ctx, REL_STORE, st.history, ws.root, ws.session)
      st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWs(root, session)
      const st = (state && typeof state === 'object' && state) ? state : {
        method: 'GET', url: '', params: [], headers: [], bodyType: 'none', body: '', form: [],
        tab: 'params', resTab: 'body', history: [], notice: null,
      }
      if ('result' in st) delete st.result // state 迁移：响应本体已挪闭包（旧 state 里可能还挂着大 JSON）
      if (!Array.isArray(st.params)) st.params = []
      if (!Array.isArray(st.headers)) st.headers = []
      if (!Array.isArray(st.form)) st.form = []
      const el = fields && fields.__el ? fields.__el : {}
      // 全量表单同步（所有输入常驻 DOM，任何动作时值都在 fields 里）
      if (typeof fields.url === 'string') st.url = fields.url
      if (typeof fields.body === 'string') st.body = fields.body
      const p = syncKV(fields, 'params', st.params); if (p.length || st.tab === 'params') st.params = p
      const hh = syncKV(fields, 'headers', st.headers); if (hh.length || st.tab === 'headers') st.headers = hh
      const f = syncKV(fields, 'form', st.form); if (f.length || (st.tab === 'body' && st.bodyType === 'form')) st.form = f

      const LIST_OF = { params: 'params', headers: 'headers', form: 'form' }
      if (action === 'method' && el.v) st.method = String(el.v)
      else if (action === 'tab' && el.v) st.tab = String(el.v)
      else if (action === 'res-tab' && el.v) st.resTab = String(el.v)
      else if (action === 'body-type' && el.v) st.bodyType = String(el.v)
      else if (action === 'kv-add' && LIST_OF[el.list]) st[el.list].push({ k: '', v: '', on: true })
      else if (action === 'kv-del' && LIST_OF[el.list] && el.i != null) st[el.list].splice(Number(el.i), 1)
      else if (action === 'kv-toggle' && LIST_OF[el.list] && el.i != null) {
        const row = st[el.list][Number(el.i)]
        if (row) row.on = row.on === false
      }
      else if (action === 'send') {
        if (!/^https?:\/\//i.test(st.url || '')) {
          lastResult = { ok: false, error: '请输入以 http(s):// 开头的 URL' }
        } else {
          await send(st, ws)
        }
      }
      else if (action === 'rerun' && el.i != null) {
        const it = (st.history || [])[Number(el.i)]
        if (it) {
          st.method = it.m; st.url = it.u
          st.params = it.params || []; st.headers = it.headers || []
          st.bodyType = it.bodyType || 'none'; st.body = it.body || ''; st.form = it.form || []
          await send(st, ws)
        }
      }
      else if (action === 'clear-history') {
        st.history = []
        const persisted = await writeJsonStore(ctx, REL_STORE, [], ws.root, ws.session)
        st.notice = persisted ? null : '⚠ 历史未能写入 ' + REL_STORE + '，仅保存在面板内存中'
      }
      else if (action === '') {
        // 打开 Tab：磁盘为准恢复历史（面板 state 只是镜像）
        const saved = await readJsonStore(ctx, REL_STORE, ws.root, null)
        if (Array.isArray(saved)) st.history = saved
        st.notice = null
      }

      const out = { ok: true, html: render(st), state: st }
      if (action === 'copy-res' && lastResult && lastResult.ok && lastResult.body) out.copy = lastResult.body
      return out
    }

    tryRegisterTool(ctx, { id: 'http', label: 'HTTP', order: 4 }, handler)
  },
}
