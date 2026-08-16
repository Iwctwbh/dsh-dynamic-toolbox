// ===== codec-tool.js：编解码工具（Host-only，纯 JS）=====
// Base64 / URL 编解码、JSON 美化/压缩、Unix 时间戳 ↔ 日期时间 互转。
// 状态：{ mode, input, output, error }

return {
  name: 'codec-tool',
  inject: ['fs', 'timer'],
  apply(ctx) {
    const MODES = [
      ['b64e', 'Base64 编码'], ['b64d', 'Base64 解码'],
      ['urle', 'URL 编码'], ['urld', 'URL 解码'],
      ['jp', 'JSON 美化'], ['jm', 'JSON 压缩'],
      ['tsd', '时间戳 → 日期'], ['dts', '日期 → 时间戳'],
    ]

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtLocal = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())

    const convert = (mode, input) => {
      const s = String(input == null ? '' : input)
      switch (mode) {
        case 'b64e': return { out: b64encode(s) }
        case 'b64d': return { out: b64decode(s.trim()) }
        case 'urle': return { out: encodeURIComponent(s) }
        case 'urld': return { out: decodeURIComponent(s) }
        case 'jp': return { out: JSON.stringify(JSON.parse(s), null, 2) }
        case 'jm': return { out: JSON.stringify(JSON.parse(s)) }
        case 'tsd': {
          let n = Number(s.trim())
          if (!isFinite(n)) return { error: '请输入数字时间戳（秒或毫秒）' }
          if (Math.abs(n) < 1e12) n = n * 1000
          const d = new Date(n)
          if (isNaN(d.getTime())) return { error: '时间戳超出有效范围' }
          return { out: '本地时间  ' + fmtLocal(d) + '\nISO       ' + d.toISOString() + '\n毫秒      ' + n }
        }
        case 'dts': {
          const t = Date.parse(s.trim())
          if (isNaN(t)) return { error: '无法解析日期，示例：2026-08-16 12:30:00 或 2026-08-16T04:30:00Z' }
          return { out: '毫秒时间戳  ' + t + '\n秒时间戳    ' + Math.floor(t / 1000) + '\nISO         ' + new Date(t).toISOString() }
        }
        default: return { error: '未知模式' }
      }
    }

    const render = (st) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-chips">' + MODES.map(([v, label]) =>
        '<button type="button" class="tb-chip' + (st.mode === v ? ' tb-chip-on' : '') + '" data-action="mode" data-m="' + v + '">' + label + '</button>'
      ).join('') + '</div>')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">输入</span>' +
        '<textarea class="tb-textarea" data-field="input" placeholder="在此输入待转换内容">' + esc(st.input || '') + '</textarea></div>')
      parts.push('<div class="tb-row"><button type="button" class="tb-btn tb-btn-primary" data-action="run">转换</button>' +
        (st.output ? '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="copy">复制输出</button><span class="tb-note">输出 ' + fmtSize(st.output.length) + '</span>' : '') + '</div>')
      if (st.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(st.error) + '</div>')
      if (st.output) parts.push('<pre class="tb-code">' + esc(st.output) + '</pre>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state }) => {
      const st = (state && typeof state === 'object' && state) ? state : { mode: 'b64e', input: '', output: '', error: null }
      const el = fields && fields.__el ? fields.__el : {}
      if (typeof fields.input === 'string') st.input = fields.input
      if (action === 'mode' && el.m) st.mode = String(el.m)
      if ((action === 'run' || action === 'mode') && st.input) {
        try {
          const r = convert(st.mode, st.input)
          st.output = r.out || ''
          st.error = r.error || null
        } catch (e) {
          st.output = ''
          st.error = String((e && e.message) || e)
        }
      }
      const out = { ok: true, html: render(st), state: st }
      if (action === 'copy' && st.output) out.copy = st.output
      return out
    }

    tryRegisterTool(ctx, { id: 'codec', label: '编解码', order: 7 }, handler)
  },
}
