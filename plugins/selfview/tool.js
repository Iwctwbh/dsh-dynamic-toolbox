// ===== selfview-tool.js：界面自查（Host+Client；Host 半）=====
// 给 deepseek-harness 当前 WebGUI 装「眼睛和手」：
//   截屏（getDisplayMedia 一次授权，流复用抓帧）/ 语义 DOM 快照 / 界面操作（点击/填充/滚动/按键）。
// Host 半职责：
//   1. 工具箱 Tab「界面」（状态/缩略图/操作日志/说明；按钮条由 Client 半注入真实按钮——授权与复制要用户激活）；
//   2. 命令队列（Host→Client 无推送通道：Client 长轮询 selfview/pull，挂起 25s 心跳；结果经 selfview/result 按 id 配对）；
//   3. 模型工具 ui_snapshot / ui_capture / ui_click / ui_fill / ui_scroll / ui_press（harness.registerTool）。
// 截图 JPEG 落 <工作区>/.dsh-dynamic-toolbox/toolbox-selfview/shot-<ts>.jpg：subprocess stdin 批写二进制
// （求值器无 Buffer、fs.writeText 只 UTF-8、argv 有 32KB 上限——stdin 批写是唯一稳路）。
// state 只放 { notice }；缩略图/日志/最近截图元信息留闭包（state 轻量化，同 http/commitmsg 规矩）。

return {
  name: 'selfview-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtClock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }

    // ---- Client 在线状态 / 缩略图 / 日志（闭包） ----
    let clientSeenAt = 0
    let streamOn = false
    let lastThumb = null // { dataUrl, w, h, at }
    let lastShotPath = ''
    const logLines = []
    const log = (line) => { logLines.push(fmtClock(Date.now()) + ' ' + line); if (logLines.length > 40) logLines.shift() }

    // ---- 命令队列 + 结果配对 ----
    let seq = 0
    const queue = []      // 待取命令
    const waiters = []    // 挂起的 pull：[resolve]
    const pending = {}    // id -> resolve（工具调用等结果）

    const pushCmd = (cmd) => {
      if (waiters.length) waiters.shift()(cmd)
      else queue.push(cmd)
    }
    // RPC 返回必须是无损 JSON：剥掉 undefined 字段（如未传的 selector/maxLines），否则 cloneJson 拒收整条命令
    const cleanCmd = (o) => { const r = {}; for (const k of Object.keys(o)) if (o[k] !== undefined) r[k] = o[k]; return r }
    const sendToClient = (cmd, timeoutMs) => new Promise((resolve) => {
      const id = 'c' + (++seq)
      const timer = ctx.timeout(() => {
        if (pending[id]) {
          delete pending[id]
          resolve({ ok: false, error: 'Client 无响应（' + Math.round((timeoutMs || 12000) / 1000) + 's 超时）——界面插件的 Client 半在运行吗？浏览器标签页开着吗？' })
        }
      }, timeoutMs || 12000)
      pending[id] = (res) => { try { timer() } catch (e) {} delete pending[id]; resolve(res) }
      pushCmd(cleanCmd(Object.assign({ id }, cmd)))
    })

    ctx.effect(() => harness.handle('selfview/pull', async () => {
      clientSeenAt = Date.now()
      if (queue.length) return queue.shift()
      return await new Promise((resolve) => {
        const timer = ctx.timeout(() => {
          const i = waiters.indexOf(wrapped)
          if (i >= 0) waiters.splice(i, 1)
          resolve({ cmd: 'none' }) // 25s 心跳空转，Client 立刻重新 pull
        }, 25000)
        const wrapped = (cmd) => { try { timer() } catch (e) {} resolve(cmd) }
        waiters.push(wrapped)
      })
    }))

    ctx.effect(() => harness.handle('selfview/result', async (args) => {
      clientSeenAt = Date.now()
      const id = args && typeof args.id === 'string' ? args.id : ''
      const res = args && args.res && typeof args.res === 'object' ? args.res : { ok: false, error: '空结果' }
      const r = pending[id]
      if (r) r(res)
      // 截图结果顺带更新面板缩略图元信息（全量 b64 不进闭包——结果体可能 MB 级，用完即弃）
      if (res && res.ok && res.thumbB64) {
        lastThumb = { dataUrl: 'data:image/jpeg;base64,' + res.thumbB64, w: res.w || 0, h: res.h || 0, at: Date.now() }
      }
      return { ok: true }
    }))

    // Client 主动推送（状态/日志/缩略图）
    ctx.effect(() => harness.handle('selfview/push', async (args) => {
      clientSeenAt = Date.now()
      if (!args || typeof args !== 'object') return { ok: true }
      if (args.kind === 'state') {
        streamOn = Boolean(args.stream)
        if (typeof args.note === 'string' && args.note) log(args.note)
      } else if (args.kind === 'thumb' && typeof args.thumbB64 === 'string') {
        lastThumb = { dataUrl: 'data:image/jpeg;base64,' + args.thumbB64, w: args.w || 0, h: args.h || 0, at: Date.now() }
      } else if (args.kind === 'log' && typeof args.line === 'string') {
        log(args.line)
      }
      return { ok: true }
    }))

    // 停止时：唤醒全部挂起 pull / 工具等待者，Client 侧长轮询自行退出
    ctx.effect(() => () => {
      while (waiters.length) waiters.shift()({ cmd: 'stop' })
      for (const k of Object.keys(pending)) pending[k]({ ok: false, error: '界面插件已停止' })
      for (const k of Object.keys(pending)) delete pending[k]
    })

    // ---- 截图落盘（stdin 批写二进制） ----
    const saveJpg = async (b64) => {
      // 根目录与全工具箱一致走 findManifest（含 plugins.json 的仓库根，含一级子目录扫描）；
      // 数据目录名随 toolbox.config.json 的 dataDir；clone 部署时截图落本仓库，不污染宿主项目
      const found = await findManifest(ctx)
      const ws = found ? { root: found.root } : resolveWorkspace(ctx, null, null)
      if (!ws.root) return { ok: false, error: '无法确定工作区根目录' }
      const dataDir = await repoDataDir(ctx)
      const file = ws.root + '/' + dataDir + '/toolbox-selfview/shot-' + Date.now() + '.jpg'
      const sub = ctx.get('subprocess')
      if (!sub) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const handle = sub.spawn({
          argv: ['node', '-e', "let d='';process.stdin.on('data',(c)=>d+=c).on('end',()=>{const fs=require('fs');fs.mkdirSync(require('path').dirname(process.argv[1]),{recursive:true});fs.writeFileSync(process.argv[1],Buffer.from(d,'base64'))})", file],
          stdio: { stdin: { data: b64 }, stdout: { maxBytes: 512 }, stderr: { maxBytes: 2048 } },
          graceMs: 20000,
        })
        await handle.done
        lastShotPath = file
        log('截图已保存 ' + file)
        return { ok: true, path: file }
      } catch (e) {
        return { ok: false, error: '写文件失败: ' + String((e && e.message) || e) }
      }
    }

    // ---- 模型工具 ----
    // 动态注册必须经 harness.defineTool 归一化（guard 硬性校验：'dynamic tool registration
    // must use a tool returned by harness.defineTool'）；parameters 是字段描述格式（非裸 JSON Schema）
    const asText = (v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }]
    const objOut = {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (args, value) => asText(value && typeof value.text === 'string' ? value.text : value),
    }
    const reg = (def) => {
      try { return harness.registerTool(ctx, harness.defineTool(def)) } catch (e) { log('注册工具失败 ' + def.name + ': ' + String((e && e.message) || e)); return () => {} }
    }

    reg({
      name: 'ui_snapshot',
      description: '查看当前 deepseek-harness WebGUI 界面的语义结构：返回页面上可见可交互元素（按钮/输入框/链接/标签页等）的缩进大纲，每个元素带 [eN] 引用号。操作界面前先调用它拿引用号，再传给 ui_click/ui_fill 等工具。',
      parameters: {
        selector: { type: 'string', description: '可选 CSS 选择器，只看该子树（默认整个页面）' },
        maxLines: { type: 'number', description: '最大行数（默认 300）' },
      },
      output: objOut,
      timeoutMs: 20000,
      isConcurrencySafe: () => true,
      execute: async (args) => {
        const res = await sendToClient({ cmd: 'snapshot', selector: args && args.selector, maxLines: args && args.maxLines }, 12000)
        if (!res.ok) return { text: '快照失败：' + (res.error || '未知错误') }
        return { text: res.text || '（空页面）' }
      },
    })

    reg({
      name: 'ui_capture',
      description: '截取当前 deepseek-harness WebGUI 标签页的像素截图，保存为工作区文件。前提：用户已在 工具箱→界面 面板点过一次「开启截屏」授权（浏览器 getDisplayMedia 强制用户手势）；未授权时返回错误并提示用户去点。成功后用 read_image 工具查看返回的图片文件。',
      parameters: {},
      output: objOut,
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      execute: async () => {
        const res = await sendToClient({ cmd: 'capture' }, 15000)
        if (!res.ok) {
          if (res.error === 'no-stream') return { text: '截图失败：截屏未开启。请用户在 工具箱 →「界面」Tab 点一次「开启截屏」按钮完成浏览器授权（只需一次，之后流保持复用）。' }
          return { text: '截图失败：' + (res.error || '未知错误') }
        }
        const saved = await saveJpg(res.jpegB64)
        if (!saved.ok) return { text: saved.error }
        return { text: '已截图并保存：' + saved.path + '（' + (res.w || '?') + '×' + (res.h || '?') + '，约 ' + Math.round((res.jpegB64.length * 3 / 4) / 1024) + ' KB）。\n下一步：调用 read_image 读取该文件即可看到界面内容。' }
      },
    })

    const refOrSelector = {
      ref: { type: 'string', description: 'ui_snapshot 返回的引用号（如 "e12"），优先' },
      selector: { type: 'string', description: 'CSS 选择器兜底（无 ref 时用）' },
    }
    reg({
      name: 'ui_click',
      description: '点击当前 WebGUI 界面上的一个元素（按钮/链接/Tab 等）。先用 ui_snapshot 拿 ref。疑似破坏性操作（删除/清空/结束进程等文案）默认拒绝，确需执行传 allowDangerous=true。',
      parameters: Object.assign({}, refOrSelector, {
        allowDangerous: { type: 'boolean', description: '允许点击疑似破坏性按钮（默认 false 拒绝）' },
      }),
      output: objOut,
      timeoutMs: 20000,
      execute: async (args) => {
        const res = await sendToClient({ cmd: 'act', action: 'click', ref: args && args.ref, selector: args && args.selector, allowDangerous: Boolean(args && args.allowDangerous) }, 12000)
        return { text: res.ok ? ('已点击 ' + (res.detail || '')) : ('点击失败：' + (res.error || '未知错误')) }
      },
    })

    reg({
      name: 'ui_fill',
      description: '在当前 WebGUI 界面的输入框/文本域/下拉框中填入文本（React 受控组件安全：原生 setter + input/change 事件）。先用 ui_snapshot 拿 ref。',
      parameters: Object.assign({}, refOrSelector, {
        text: { type: 'string', required: true, description: '要填入的文本' },
      }),
      output: objOut,
      timeoutMs: 20000,
      execute: async (args) => {
        const res = await sendToClient({ cmd: 'act', action: 'fill', ref: args && args.ref, selector: args && args.selector, text: args && args.text }, 12000)
        return { text: res.ok ? ('已填充 ' + (res.detail || '')) : ('填充失败：' + (res.error || '未知错误')) }
      },
    })

    reg({
      name: 'ui_scroll',
      description: '滚动当前 WebGUI 页面或某个可滚动元素。',
      parameters: {
        selector: { type: 'string', description: '可选；不给则滚动整个页面' },
        dx: { type: 'number', description: '横向像素（默认 0）' },
        dy: { type: 'number', description: '纵向像素（默认 600，负值向上）' },
      },
      output: objOut,
      timeoutMs: 20000,
      execute: async (args) => {
        const res = await sendToClient({ cmd: 'act', action: 'scroll', selector: args && args.selector, dx: args && args.dx, dy: args && args.dy }, 12000)
        return { text: res.ok ? ('已滚动 ' + (res.detail || '')) : ('滚动失败：' + (res.error || '未知错误')) }
      },
    })

    reg({
      name: 'ui_press',
      description: '在当前 WebGUI 界面的焦点元素（或指定元素）上按一个键（如 Enter/Escape/Tab/ArrowDown）。',
      parameters: {
        key: { type: 'string', required: true, description: 'KeyboardEvent.key 值，如 "Enter"' },
        selector: { type: 'string', description: '可选目标元素 CSS 选择器（默认当前焦点元素）' },
      },
      output: objOut,
      timeoutMs: 20000,
      execute: async (args) => {
        const res = await sendToClient({ cmd: 'act', action: 'press', key: args && args.key, selector: args && args.selector }, 12000)
        return { text: res.ok ? ('已按键 ' + (res.detail || '')) : ('按键失败：' + (res.error || '未知错误')) }
      },
    })

    // ---- 工具箱 Tab ----
    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">截屏控制（按钮由 Client 半注入——授权/复制必须真实用户点击，面板 HTML 按钮做不到）</span>' +
        '<div data-selfview-mount="1"><span class="tb-note">界面 Client 半未连接或未注入按钮条…（确认 selfview 插件已启动、浏览器标签页在前台）</span></div></div>')
      const clientLive = clientSeenAt && (Date.now() - clientSeenAt < 30000)
      parts.push('<div class="tb-row">' +
        '<span class="tb-pill ' + (clientLive ? 'tb-pill-done' : 'tb-pill-todo') + '">Client ' + (clientLive ? '在线' : '离线') + '</span>' +
        '<span class="tb-pill ' + (streamOn ? 'tb-pill-active' : 'tb-pill-todo') + '">截屏流 ' + (streamOn ? '共享中' : '未开启') + '</span>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">刷新</button>' +
        (lastShotPath ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="open-dir-note">截图目录</button>' : '') +
        (logLines.length ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="clear-log">清日志</button>' : '') +
        '</div>')
      if (st.notice) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.notice) + '</div>')
      if (lastThumb) {
        parts.push('<div class="tb-preview"><div class="tb-preview-head"><span class="tb-preview-name">最近截图 ' + lastThumb.w + '×' + lastThumb.h + ' · ' + fmtClock(lastThumb.at) + '</span></div>' +
          '<img class="tb-preview-img" src="' + lastThumb.dataUrl + '" alt="最近截图缩略图" /></div>')
      }
      if (logLines.length) {
        parts.push('<div class="tb-sec"><span class="tb-sec-label">操作日志（最近 ' + logLines.length + ' 条）</span><pre class="tb-code">' + esc(logLines.slice().reverse().join('\n')) + '</pre></div>')
      }
      parts.push('<div class="tb-notice">模型工具：ui_snapshot 看界面结构 → ui_click / ui_fill / ui_scroll / ui_press 操作；ui_capture 截像素图（先点「开启截屏」授权一次）。截图存 .dsh-dynamic-toolbox/toolbox-selfview/，模型经 read_image 查看。</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, state }) => {
      const st = (state && typeof state === 'object' && state) ? state : { notice: null }
      if (action === 'clear-log') { logLines.length = 0; st.notice = null }
      else if (action === 'open-dir-note') { st.notice = '截图目录：' + (lastShotPath ? lastShotPath.replace(/[\\/][^\\/]+$/, '') : '(还没有截图)') }
      else if (action === '') { st.notice = null }
      return { ok: true, html: render(st), state: st }
    }

    tryRegisterTool(ctx, { id: 'selfview', label: '界面', order: 24, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z"/><circle cx="8" cy="8" r="1.7"/></svg>' }, handler)
  },
}
