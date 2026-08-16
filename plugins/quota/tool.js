// ===== quota-tool.js：API 配额查询（Host-only，经工具箱 RPC 注册）=====
// 查询 Kimi for Coding（k3）套餐余量：主额度（周）+ 5 小时滑动窗口 + 并发上限。
// 端点：GET https://api.kimi.com/coding/v1/usages（Authorization: Bearer KIMI_CODING_API_KEY）。
// Key 凭据链：环境变量 → ~/.dsh/.credentials.yaml（与 jira 插件同款，Node 子进程读取，沙箱外）。
// 子进程跑 https 查询（插件求值器无 fetch/process；Node 走系统 TUN 代理可直连，curl 走 schannel 会被拒）。
// 状态：{ loading, error, data, at }（data 是脱敏后的余量摘要，key 永不出子进程）
// 注：查询走用户自己的 API Key，产生的是配额查询请求（轻量，不计入模型 token 用量）。

return {
  name: 'quota-tool',
  inject: ['subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')

    // 子进程脚本：读凭据 → 查 usages → 输出脱敏摘要 JSON。
    // 数组 join 规避模板 \n 转义坑（PLUGIN-DEV.md 血泪）。
    const QUOTA_SCRIPT = [
      "const https = require('https')",
      "const fs = require('fs')",
      "const os = require('os')",
      "const path = require('path')",
      "function readKey() {",
      "  if (process.env.KIMI_CODING_API_KEY) return process.env.KIMI_CODING_API_KEY",
      "  try {",
      "    const f = path.join(os.homedir(), '.dsh', '.credentials.yaml')",
      "    const m = fs.readFileSync(f, 'utf8').match(/^KIMI_CODING_API_KEY:\\s*(\\S+)\\s*$/m)",
      "    if (m) return m[1]",
      "  } catch (e) {}",
      "  return ''",
      "}",
      "const key = readKey()",
      "if (!key) { process.stdout.write(JSON.stringify({ ok: false, error: '未找到 KIMI_CODING_API_KEY（环境变量或 ~/.dsh/.credentials.yaml）' })); process.exit(0) }",
      "const req = https.request({ host: 'api.kimi.com', port: 443, path: '/coding/v1/usages', method: 'GET',",
      "  headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'KimiCLI/1.5' }, timeout: 20000 }, (res) => {",
      "  let body = ''",
      "  res.on('data', (c) => body += c)",
      "  res.on('end', () => {",
      "    try {",
      "      const j = JSON.parse(body)",
      "      if (res.statusCode !== 200) { process.stdout.write(JSON.stringify({ ok: false, error: 'HTTP ' + res.statusCode + ': ' + (j.error && j.error.message || body.slice(0, 200)) })); return }",
      "      const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0 }",
      "      const usage = j.usage || {}",
      "      const win = (j.limits && j.limits[0] && j.limits[0].detail) || {}",
      "      const winInfo = (j.limits && j.limits[0] && j.limits[0].window) || {}",
      "      process.stdout.write(JSON.stringify({ ok: true, data: {",
      "        level: (j.user && j.user.membership && j.user.membership.level) || '',",
      "        region: (j.user && j.user.region) || '',",
      "        main: { limit: num(usage.limit), used: num(usage.used), remaining: num(usage.remaining), resetTime: usage.resetTime || '' },",
      "        window: { limit: num(win.limit), used: num(win.used), remaining: num(win.remaining), resetTime: win.resetTime || '', durationMin: num(winInfo.duration) },",
      "        parallel: num(j.parallel && j.parallel.limit),",
      "        parallelActive: (j.parallel && Array.isArray(j.parallel.details) ? j.parallel.details.length : 0),",
      "        booster: (j.boosterWallet && j.boosterWallet.status) || ''",
      "      } }))",
      "    } catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: '解析失败: ' + String((e && e.message) || e) })) }",
      "  })",
      "})",
      "req.on('error', (e) => { process.stdout.write(JSON.stringify({ ok: false, error: '网络错误: ' + e.message })) })",
      "req.on('timeout', () => { req.destroy(); process.stdout.write(JSON.stringify({ ok: false, error: '请求超时（20s）' })) })",
      "req.end()",
    ].join('\n')

    const runQuery = async (wsRoot) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const handle = subprocess.spawn({
          argv: ['node', '-e', QUOTA_SCRIPT],
          cwd: wsRoot,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 16 * 1024 } },
          graceMs: 30000,
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout.readFrom(0).text
        if (outcome.exitCode !== 0) {
          return { ok: false, error: handle.collected.stderr.readFrom(0).text.slice(0, 300) || '子进程失败' }
        }
        return JSON.parse(stdout)
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    }

    // 用量比例 → 状态色（剩余比例越高越绿，低则黄/红）
    const levelOf = (remaining, limit) => {
      if (!limit) return 'plain'
      const r = remaining / limit
      if (r > 0.5) return 'done'
      if (r > 0.2) return 'other'
      return 'warn'
    }
    const fmtTime = (iso) => {
      if (!iso) return '—'
      try {
        const d = new Date(iso)
        if (isNaN(d.getTime())) return iso
        const p2 = (n) => (n < 10 ? '0' : '') + n
        return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
      } catch (e) { return iso }
    }
    const bar = (used, limit) => {
      if (!limit) return ''
      const pct = Math.max(0, Math.min(100, Math.round((used / limit) * 100)))
      return '<div style="flex:1;height:8px;border-radius:999px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:var(--tb-accent,#3f6fd9);transition:width .2s"></div></div>'
    }

    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="query"' + (st.loading ? ' disabled' : '') + '>' + (st.loading ? '查询中…' : '刷新') + '</button>' +
        (st.at ? '<span class="tb-note">更新于 ' + esc(st.at) + '</span>' : '') +
        '<span class="tb-note">Kimi for Coding（k3）· 数据来自官方 usages 接口</span>' +
      '</div>')
      if (st.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(st.error) + '</div>')
      const d = st.data
      if (d) {
        // 主额度（周）
        parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">主额度（每周重置）</span>' +
          '<div class="tb-row"><span class="tb-pill tb-pill-' + levelOf(d.main.remaining, d.main.limit) + '">剩 ' + d.main.remaining + '</span>' +
          '<span class="tb-note">已用 ' + d.main.used + ' / ' + d.main.limit + '</span></div>' +
          '<div class="tb-row">' + bar(d.main.used, d.main.limit) + '</div>' +
          '<div class="tb-note">重置：' + esc(fmtTime(d.main.resetTime)) + '（本地）</div>' +
        '</div></div>')
        // 5 小时滑动窗口
        parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">限流窗口（' + (d.window.durationMin || 300) + ' 分钟滑动）</span>' +
          '<div class="tb-row"><span class="tb-pill tb-pill-' + levelOf(d.window.remaining, d.window.limit) + '">剩 ' + d.window.remaining + '</span>' +
          '<span class="tb-note">已用 ' + d.window.used + ' / ' + d.window.limit + '</span></div>' +
          '<div class="tb-row">' + bar(d.window.used, d.window.limit) + '</div>' +
          '<div class="tb-note">重置：' + esc(fmtTime(d.window.resetTime)) + '（本地）</div>' +
        '</div></div>')
        // 其他信息
        const LEVEL_LABEL = { LEVEL_ADVANCED: '高级版', LEVEL_BASIC: '基础版', LEVEL_FREE: '免费版' }
        parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">套餐</span>' +
          '<div class="tb-pills">' +
            '<span class="tb-pill tb-pill-active">' + esc(LEVEL_LABEL[d.level] || d.level || '未知') + '</span>' +
            '<span class="tb-pill tb-pill-plain">并发 ' + d.parallelActive + ' / ' + d.parallel + '</span>' +
            (d.booster && d.booster !== 'STATUS_DISABLED'
              ? '<span class="tb-pill tb-pill-done">加量包已启用</span>'
              : '<span class="tb-pill tb-pill-plain">加量包未启用</span>') +
          '</div>' +
          '<div class="tb-note" style="margin-top:6px">双层限流：周额度 + 滑动窗口，任一耗尽触发 429。额度查询本身不计模型 token。</div>' +
        '</div></div>')
      } else if (!st.error && !st.loading) {
        parts.push('<div class="tb-notice">点「刷新」查询 Kimi for Coding 套餐余量（主额度 / 限流窗口 / 并发）</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { loading: false, error: null, data: null, at: null }

      if (action === 'query' || (action === '' && !st.data && !st.error)) {
        st.loading = true
        const r = await runQuery(ws.root)
        st.loading = false
        if (r && r.ok) {
          st.data = r.data
          st.error = null
          try { st.at = new Date().toTimeString().slice(0, 8) } catch (e) { st.at = '' }
        } else {
          st.error = (r && r.error) || '查询失败'
        }
      }
      return { ok: true, html: render(st), state: st }
    }

    tryRegisterTool(ctx, { id: 'quota', label: '配额', order: 25 }, handler)
  },
}