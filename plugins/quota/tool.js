// ===== quota-tool.js：API 配额查询（Host-only，经工具箱 RPC 注册）=====
// 多提供商配额/余额查询（提供商与数据接口分类参考 cc-switch 的用量查询模板）：
//   · Kimi Coding（k3）：GET api.kimi.com/coding/v1/usages（官方 usages：周额度 + 5h 滑动窗口 + 并发）
//   · DeepSeek：GET api.deepseek.com/user/balance（官方余额：总额 / 赠送 / 充值，is_available）
//   · Qwen Token Plan（阿里云百炼）：POST bailian.console.aliyun.com/data/api.json?…queryCodingPlanInstanceInfoV2
//     （端点与 5h/周/月窗口字段参考 CodexBar 文档；部分 CN 账号 API 模式可能要求控制台会话，失败时明示）
// Key 凭据链：环境变量 → ~/.dsh/.credentials.yaml（键名随提供商，Node 子进程读取，沙箱外）。
// 子进程跑 https 查询（插件求值器无 fetch/process；Node 走系统 TUN 代理可直连，curl 走 schannel 会被拒）。
// 状态：{ loading, error, data, at, provider }（data 是脱敏后的余量摘要，key 永不出子进程）
// 注：查询走用户自己的 API Key，产生的是配额查询请求（轻量，不计入模型 token 用量）。

return {
  name: 'quota-tool',
  inject: ['subprocess', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')

    // 提供商表：id / 显示名 / 凭据键名（cc-switch 模板分类：Token Plan 套餐配额 + 第三方余额）
    // qwen 特殊：阿里云未开放套餐用量 API key 接口（zeldaEasy 端点实测 ConsoleNeedLogin），
    // 只能走控制台 Cookie 会话（CodexBar baseline 同款）——凭据键为 Cookie 而非 API key
    const PROVIDERS = [
      { id: 'kimi', label: 'Kimi Coding', keyName: 'KIMI_CODING_API_KEY' },
      { id: 'deepseek', label: 'DeepSeek', keyName: 'DEEPSEEK_API_KEY' },
      { id: 'qwen', label: 'Qwen Plan · 百炼', keyName: 'QWEN_TOKEN_PLAN_CN_API_KEY', credName: 'QWEN_TOKEN_PLAN_CN_COOKIE', credNote: '控制台 Cookie（bailian.console.aliyun.com 登录后从浏览器复制）' },
    ]
    const providerOf = (id) => {
      for (const p of PROVIDERS) { if (p.id === id) return p }
      return PROVIDERS[0]
    }

    // 子进程脚本：读凭据 → 按提供商查询 → 输出归一化 JSON（windows[] 配额窗口 / balances[] 余额）。
    // 数组 join 规避模板 \n 转义坑（PLUGIN-DEV.md 血泪）；提供商 id/键名经 JSON.stringify 内联。
    const scriptFor = (pid, keyName, cookieName) => [
      "const https = require('https')",
      "const fs = require('fs')",
      "const os = require('os')",
      "const path = require('path')",
      'const PID = ' + JSON.stringify(pid),
      'const KEY_NAME = ' + JSON.stringify(keyName),
      'const COOKIE_NAME = ' + JSON.stringify(cookieName || ''),
      "function readNamed(n) {",
      "  if (!n) return ''",
      "  if (process.env[n]) return process.env[n]",
      "  try {",
      "    const f = path.join(os.homedir(), '.dsh', '.credentials.yaml')",
      "    const re = new RegExp('^' + n + ':\\\\s*(.+)\\\\s*$', 'm')",
      "    const m = fs.readFileSync(f, 'utf8').match(re)",
      "    if (m) return m[1].trim()",
      "  } catch (e) {}",
      "  return ''",
      "}",
      "const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0) }",
      "const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0 }",
      "const key = readNamed(KEY_NAME)",
      "if (!key && PID !== 'qwen') out({ ok: false, error: '未找到 ' + KEY_NAME + '（环境变量或 ~/.dsh/.credentials.yaml）' })",
      "function req(o) { return new Promise((resolve) => {",
      "  const r = https.request({ host: o.host, port: 443, path: o.path, method: o.method, timeout: 20000, headers: o.headers }, (res) => {",
      "    let body = ''",
      "    res.on('data', (c) => body += c)",
      "    res.on('end', () => {",
      "      let j = null",
      "      try { j = JSON.parse(body) } catch (e) {}",
      "      resolve({ status: res.statusCode, json: j, raw: body })",
      "    })",
      "  })",
      "  r.on('error', (e) => resolve({ status: 0, error: '网络错误: ' + e.message }))",
      "  r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: '请求超时（20s）' }) })",
      "  if (o.body) r.write(o.body)",
      "  r.end()",
      "})}",
      "(async () => {",
      "  try {",
      // ---- Kimi Coding：官方 usages（周额度 + 滑动窗口 + 并发）----
      "    if (PID === 'kimi') {",
      "      const r = await req({ host: 'api.kimi.com', path: '/coding/v1/usages', method: 'GET', headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'KimiCLI/1.5' } })",
      "      if (r.error) out({ ok: false, error: r.error })",
      "      const j = r.json || {}",
      "      if (r.status !== 200) out({ ok: false, error: 'HTTP ' + r.status + ': ' + ((j.error && j.error.message) || (r.raw || '').slice(0, 200)) })",
      "      const usage = j.usage || {}",
      "      const win = (j.limits && j.limits[0] && j.limits[0].detail) || {}",
      "      const winInfo = (j.limits && j.limits[0] && j.limits[0].window) || {}",
      "      out({ ok: true, data: {",
      "        plan: (j.user && j.user.membership && j.user.membership.level) || '',",
      "        windows: [",
      "          { label: '主额度（每周重置）', used: num(usage.used), total: num(usage.limit), resetTime: usage.resetTime || '' },",
      "          { label: '限流窗口（' + (num(winInfo.duration) || 300) + ' 分钟滑动）', used: num(win.used), total: num(win.limit), resetTime: win.resetTime || '' },",
      "        ],",
      "        extra: '并发 ' + ((j.parallel && Array.isArray(j.parallel.details)) ? j.parallel.details.length : 0) + ' / ' + num(j.parallel && j.parallel.limit) + ((j.boosterWallet && j.boosterWallet.status && j.boosterWallet.status !== 'STATUS_DISABLED') ? ' · 加量包已启用' : '')",
      "      } })",
      "    }",
      // ---- DeepSeek：官方余额（is_available + 各币种总额/赠送/充值）----
      "    else if (PID === 'deepseek') {",
      "      const r = await req({ host: 'api.deepseek.com', path: '/user/balance', method: 'GET', headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' } })",
      "      if (r.error) out({ ok: false, error: r.error })",
      "      const j = r.json || {}",
      "      if (r.status !== 200) out({ ok: false, error: 'HTTP ' + r.status + ': ' + ((j.error && j.error.message) || (r.raw || '').slice(0, 200)) })",
      "      const infos = Array.isArray(j.balance_infos) ? j.balance_infos : []",
      "      out({ ok: true, data: {",
      "        available: !!j.is_available,",
      "        balances: infos.map((b) => ({ currency: b.currency || '', total: num(b.total_balance), granted: num(b.granted_balance), toppedUp: num(b.topped_up_balance) }))",
      "      } })",
      "    }",
      // ---- Qwen Token Plan（阿里云百炼 Coding Plan）：控制台 Cookie 会话模式 ----
      // 阿里云未开放套餐用量 API key 接口（zeldaEasy 实测 ConsoleNeedLogin），只能控制台会话（CodexBar baseline 同款）
      "    else if (PID === 'qwen') {",
      "      const cookie = readNamed(COOKIE_NAME)",
      "      if (!cookie) out({ ok: false, error: 'Qwen Plan 套餐用量阿里云未开放 API key 查询接口（实测 ConsoleNeedLogin），仅支持控制台会话：登录百炼控制台 bailian.console.aliyun.com 后，浏览器 F12 → Network → 任意请求 → 复制 Cookie 整行，写入凭据键 ' + COOKIE_NAME + '（环境变量或 ~/.dsh/.credentials.yaml）；或前往控制台「订阅套餐」页直接查看' })",
      "      const qPath = '/data/api.json?action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian&api=queryCodingPlanInstanceInfoV2'",
      "      const r = await req({ host: 'bailian.console.aliyun.com', path: qPath, method: 'POST', body: '{}', headers: { Cookie: cookie, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } })",
      "      if (r.error) out({ ok: false, error: r.error })",
      "      if (r.status !== 200) out({ ok: false, error: 'HTTP ' + r.status + ': ' + (r.raw || '').slice(0, 200) })",
      "      const j = r.json || {}",
      "      if (j.code === 'ConsoleNeedLogin') out({ ok: false, error: '控制台 Cookie 已过期或不完整，请重新登录百炼控制台后复制最新 Cookie 更新到 ' + COOKIE_NAME })",
      "      const datas = j.data || {}",
      "      const infos = Array.isArray(datas.codingPlanInstanceInfos) ? datas.codingPlanInstanceInfos : []",
      "      if (!infos.length) out({ ok: false, error: '未返回套餐信息：' + (r.raw || '').slice(0, 160) })",
      "      const inst = infos[0] || {}",
      "      const q = inst.codingPlanQuotaInfo || datas.codingPlanQuotaInfo || {}",
      "      const wins = []",
      "      if (num(q.per5HourTotalQuota)) wins.push({ label: '5 小时窗口', used: num(q.per5HourUsedQuota), total: num(q.per5HourTotalQuota), resetTime: q.per5HourQuotaNextRefreshTime || '' })",
      "      if (num(q.perWeekTotalQuota)) wins.push({ label: '每周额度', used: num(q.perWeekUsedQuota), total: num(q.perWeekTotalQuota), resetTime: q.perWeekQuotaNextRefreshTime || '' })",
      "      if (num(q.perBillMonthTotalQuota)) wins.push({ label: '每月额度', used: num(q.perBillMonthUsedQuota), total: num(q.perBillMonthTotalQuota), resetTime: q.perBillMonthQuotaNextRefreshTime || '' })",
      "      out({ ok: true, data: { plan: inst.planName || inst.instanceName || inst.packageName || '', windows: wins } })",
      "    }",
      "  } catch (e) { out({ ok: false, error: '查询异常: ' + String((e && e.message) || e) }) }",
      "})()",
    ].join('\n')

    const runQuery = async (wsRoot, pid) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      const p = providerOf(pid)
      try {
        const handle = subprocess.spawn({
          argv: ['node', '-e', scriptFor(p.id, p.keyName, p.credName)],
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
        // 兼容 ISO 字符串与数字时间戳（秒/毫秒，百炼窗口刷新时间是 epoch）
        let d
        if (typeof iso === 'number' || /^\d{10,}$/.test(String(iso))) {
          let n = Number(iso)
          if (n < 1e12) n *= 1000
          d = new Date(n)
        } else {
          d = new Date(iso)
        }
        if (isNaN(d.getTime())) return String(iso)
        const p2 = (n) => (n < 10 ? '0' : '') + n
        return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
      } catch (e) { return String(iso) }
    }
    const fmtNum = (n) => {
      const v = Number(n)
      if (!isFinite(v)) return String(n)
      return v >= 10000 ? (v / 1000).toFixed(1) + 'k' : String(v)
    }
    const bar = (used, limit) => {
      if (!limit) return ''
      const pct = Math.max(0, Math.min(100, Math.round((used / limit) * 100)))
      return '<div style="flex:1;height:8px;border-radius:999px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:var(--tb-accent,#3f6fd9);transition:width .2s"></div></div>'
    }

    // 配额窗口卡片（统一模型：label + 剩余 pill + 进度条 + 重置时间）
    const windowCard = (w) => {
      const remaining = Math.max(0, (w.total || 0) - (w.used || 0))
      return '<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">' + esc(w.label) + '</span>' +
        '<div class="tb-row"><span class="tb-pill tb-pill-' + levelOf(remaining, w.total) + '">剩 ' + fmtNum(remaining) + '</span>' +
        '<span class="tb-note">已用 ' + fmtNum(w.used) + ' / ' + fmtNum(w.total) + '</span></div>' +
        '<div class="tb-row">' + bar(w.used, w.total) + '</div>' +
        '<div class="tb-note">重置：' + esc(fmtTime(w.resetTime)) + '（本地）</div>' +
      '</div></div>'
    }

    const LEVEL_LABEL = { LEVEL_ADVANCED: '高级版', LEVEL_BASIC: '基础版', LEVEL_FREE: '免费版' }

    const render = (st) => {
      const p = providerOf(st.provider)
      const d = st.data
      // Tab 角标：第一窗口剩余量 / 余额总值
      let badge = ''
      if (d && Array.isArray(d.windows) && d.windows.length) badge = fmtNum(Math.max(0, (d.windows[0].total || 0) - (d.windows[0].used || 0)))
      else if (d && Array.isArray(d.balances) && d.balances.length) badge = fmtNum(d.balances[0].total)
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root" data-tab-badge="' + esc(badge) + '">')
      // 提供商选择芯片 + 刷新
      parts.push('<div class="tb-row">' +
        PROVIDERS.map((pv) => '<button type="button" class="tb-chip' + (pv.id === p.id ? ' tb-chip-on' : '') + '" data-action="pick" data-v="' + pv.id + '">' + esc(pv.label) + '</button>').join('') +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="query"' + (st.loading ? ' disabled' : '') + '>' + (st.loading ? '查询中…' : '刷新') + '</button>' +
      '</div>')
      parts.push('<div class="tb-row"><span class="tb-note">' + (p.credName ? '凭据键 ' + p.credName + '（' + p.credNote + '）' : '凭据键 ' + p.keyName + '（环境变量 / ~/.dsh/.credentials.yaml）') + '</span>' +
        (st.at ? '<span class="tb-note">更新于 ' + esc(st.at) + '</span>' : '') + '</div>')
      if (st.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(st.error) + '</div>')
      if (d) {
        if (d.plan) {
          parts.push('<div class="tb-pills"><span class="tb-pill tb-pill-active">' + esc(LEVEL_LABEL[d.plan] || d.plan) + '</span>' +
            (d.extra ? '<span class="tb-pill tb-pill-plain">' + esc(d.extra) + '</span>' : '') + '</div>')
        }
        if (Array.isArray(d.windows)) for (const w of d.windows) parts.push(windowCard(w))
        if (Array.isArray(d.balances)) {
          for (const b of d.balances) {
            parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">余额（' + esc(b.currency || '币种') + '）</span>' +
              '<div class="tb-row"><span class="tb-pill tb-pill-' + (b.total > 5 ? 'done' : b.total > 1 ? 'other' : 'warn') + '">总 ' + fmtNum(b.total) + '</span>' +
              '<span class="tb-note">赠送 ' + fmtNum(b.granted) + ' · 充值 ' + fmtNum(b.toppedUp) + '</span></div>' +
            '</div></div>')
          }
          parts.push('<div class="tb-note">账户状态：' + (d.available ? '可用' : '不可用（余额不足或已停用）') + '</div>')
        }
        if (!d.windows && !d.balances) parts.push('<div class="tb-notice">该提供商未返回配额窗口</div>')
        if (p.id === 'kimi') parts.push('<div class="tb-note">双层限流：周额度 + 滑动窗口，任一耗尽触发 429。额度查询本身不计模型 token。</div>')
      } else if (!st.error && !st.loading) {
        parts.push('<div class="tb-notice">点「刷新」查询 ' + esc(p.label) + ' 配额/余额</div>')
      }
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWorkspace(ctx, root, session)
      const st = (state && typeof state === 'object' && state) ? state : { loading: false, error: null, data: null, at: null, provider: 'kimi' }
      if (!providerOf(st.provider).id || PROVIDERS.every((p) => p.id !== st.provider)) st.provider = 'kimi'
      const el = fields && fields.__el ? fields.__el : {}

      if (action === 'pick' && el.v) {
        // 切换提供商：清空旧数据并立即查询新提供商
        st.provider = String(el.v)
        st.data = null
        st.error = null
        action = 'query'
      }
      if (action === 'query' || (action === '' && !st.data && !st.error)) {
        st.loading = true
        const r = await runQuery(ws.root, st.provider)
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

    tryRegisterTool(ctx, { id: 'quota', label: '配额', order: 25, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 11.5a6.5 6.5 0 0 1 11 0"/><path d="M8 6v2.5l2.5 1.5"/></svg>' }, handler)
  },
}
