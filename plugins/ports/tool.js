// ===== ports-tool.js：端口与进程查看工具（Host-only，HTML 面板经工具箱 RPC 渲染）=====
// pwsh Get-NetTCPConnection 列 LISTEN 端口（地址/端口/PID/进程名），支持过滤、刷新、
// 两步确认结束进程（先「结束」武装 → 再「确认结束」执行 Stop-Process）。
// 状态：{ rows, q, arm, error }（rows 为标量小对象数组，纯 JSON）

return {
  name: 'ports-tool',
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')

    // node 子进程：netstat 列 LISTEN + tasklist 取进程名（子进程是真实 node，process/Buffer 可用；
    // 插件求值器里这些全局被遮蔽——脚本只经 stdin 传入，绝不在插件侧拼用户输入）
    // 注意 impl 字符串转义：'\\s' → 子脚本 '\s'，'\\d' → '\d'
    const LIST_SCRIPT = [
      'const { spawnSync } = require("child_process")',
      'const n = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", maxBuffer: 8388608 })',
      'const tl = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", maxBuffer: 8388608 })',
      'const procs = {}',
      'for (const line of String(tl.stdout || "").split(/\\r?\\n/)) {',
      '  const m = /^"([^"]*)","(\\d+)"/.exec(line)',
      '  if (m) procs[m[2]] = m[1]',
      '}',
      'const rows = []',
      'for (const line of String(n.stdout || "").split(/\\r?\\n/)) {',
      '  const t = line.trim().split(/\\s+/)',
      '  if (t.length >= 5 && t[3] === "LISTENING") {',
      '    const lp = t[1]',
      '    const idx = lp.lastIndexOf(":")',
      '    if (idx > 0) {',
      '      const pid = t[4]',
      '      rows.push({ addr: lp.slice(0, idx), port: Number(lp.slice(idx + 1)), pid: Number(pid), proc: procs[pid] || "" })',
      '    }',
      '  }',
      '}',
      'process.stdout.write(JSON.stringify(rows))',
    ].join('\n')

    const runNode = async (script, argv1) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      const spec = {
        argv: argv1 == null ? ['node', '-'] : ['node', '-e', script, String(argv1)],
        stdio: argv1 == null
          ? { stdin: { data: script }, stdout: { maxBytes: 2 * 1024 * 1024 }, stderr: { maxBytes: 128 * 1024 } }
          : { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 64 * 1024 } },
        graceMs: 30000,
      }
      const handle = subprocess.spawn(spec)
      const outcome = await handle.done
      const stdout = handle.collected.stdout.readFrom(0).text
      const stderr = handle.collected.stderr.readFrom(0).text
      if (outcome.exitCode !== 0) return { ok: false, error: (stderr || stdout).slice(0, 500) }
      return { ok: true, stdout }
    }

    const loadRows = async () => {
      const res = await runNode(LIST_SCRIPT)
      if (!res.ok) return { error: res.error, rows: [] }
      try {
        const parsed = JSON.parse(res.stdout.trim() || '[]')
        const rows = Array.isArray(parsed) ? parsed : [parsed]
        return { rows: rows.filter((r) => r && typeof r.port === 'number') }
      } catch (e) {
        return { error: '解析失败: ' + res.stdout.slice(0, 300), rows: [] }
      }
    }

    const render = (st) => {
      const rows = (st.rows || []).filter((r) => {
        const q = (st.q || '').trim().toLowerCase()
        if (!q) return true
        return String(r.port).indexOf(q) >= 0 || String(r.proc || '').toLowerCase().indexOf(q) >= 0 || String(r.pid).indexOf(q) >= 0
      })
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-query">' +
        '<input class="tb-input" data-field="q" placeholder="按端口 / 进程名 / PID 过滤" value="' + esc(st.q || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="refresh">刷新</button>' +
      '</div>')
      if (st.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(st.error) + '</div>')
      if (st.info) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.info) + '</div>')
      parts.push('<div class="tb-list-head"><span class="tb-list-title">监听端口<span class="tb-count">' + rows.length + '</span></span>' +
        '<span class="tb-note">共 ' + (st.rows || []).length + ' 条</span></div>')
      if (rows.length === 0) {
        parts.push('<div class="tb-notice">' + (st.rows ? '无匹配项' : '点击「刷新」加载') + '</div>')
      } else {
        parts.push('<div class="tb-list">' + rows.map((r) => {
          const armed = st.arm === String(r.pid)
          const act = armed
            ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-danger-ghost" data-action="kill-confirm" data-pid="' + r.pid + '">确认结束</button>' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="kill-cancel">取消</button>'
            : '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="kill" data-pid="' + r.pid + '">结束</button>'
          return '<div class="tb-rec' + (armed ? ' tb-rec-active' : '') + '">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-rec-key">:' + r.port + '</span>' +
              '<span class="tb-rec-summary">' + esc(r.proc || '（未知进程）') + '</span>' + act + '</div>' +
              '<div class="tb-rec-sub"><span>' + esc(r.addr || '*') + '</span><span>PID ' + r.pid + '</span></div>' +
            '</div>' +
          '</div>'
        }).join('') + '</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state }) => {
      const st = (state && typeof state === 'object' && state) ? state : { rows: null, q: '', arm: null, error: null, info: null }
      const el = fields && fields.__el ? fields.__el : {}
      if (typeof fields.q === 'string') st.q = fields.q
      st.error = null; st.info = null

      if (action === '' || action === 'refresh') {
        const r = await loadRows()
        st.rows = r.rows; st.error = r.error || null; st.arm = null
      } else if (action === 'kill' && el.pid && /^\d+$/.test(String(el.pid))) {
        st.arm = String(el.pid)
      } else if (action === 'kill-cancel') {
        st.arm = null
      } else if (action === 'kill-confirm' && el.pid && /^\d+$/.test(String(el.pid))) {
        const pid = String(el.pid)
        const res = await runNode('require("child_process").spawnSync("taskkill", ["/PID", process.argv[1], "/F"], { stdio: "inherit" })', pid)
        st.arm = null
        if (res.ok) {
          st.info = '已结束进程 PID ' + pid
          const r = await loadRows()
          st.rows = r.rows; st.error = r.error || null
        } else {
          st.error = '结束失败: ' + res.error
        }
      }
      return { ok: true, html: render(st), state: st }
    }

    tryRegisterTool(ctx, { id: 'ports', label: '端口', order: 5, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 2v3M11 2v3"/><path d="M4.5 5h7v2a3.5 3.5 0 0 1-7 0z"/><path d="M8 10.5V14"/></svg>' }, handler)
  },
}
