// ===== cron-tool.js：Cron 表达式工具（Host-only，纯 JS）=====
// 5 段 cron（分 时 日 月 周）解析：*/,-/ + 月/周三字母名（JAN-DEC / SUN-SAT，周日 0 或 7）；
// 标准 OR 语义：日与周同时受限时任一命中即运行。输出字段明细 + 未来 8 次运行时刻（本地时区）。
// 常用预设芯片一键填入。计算每次动作现算（便宜），无大状态。
// 状态：{ expr }

return {
  name: 'cron-tool',
  inject: ['timer'],
  apply(ctx) {
    const FIELD_DEFS = [
      { key: 'minute', label: '分', min: 0, max: 59 },
      { key: 'hour', label: '时', min: 0, max: 23 },
      { key: 'dom', label: '日', min: 1, max: 31 },
      { key: 'month', label: '月', min: 1, max: 12, names: { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 } },
      { key: 'dow', label: '周', min: 0, max: 7, names: { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 } },
    ]

    // 单字段解析 → { set: Set<number>, any: bool } 或 { error }
    const parseField = (text, def) => {
      const raw = String(text == null ? '' : text).trim()
      if (!raw) return { error: '不能为空' }
      const vals = new Set()
      let any = false
      const nameOf = (s) => {
        const up = s.toUpperCase()
        if (def.names && Object.prototype.hasOwnProperty.call(def.names, up)) return def.names[up]
        if (!/^\d+$/.test(s)) return null
        return Number(s)
      }
      for (const part0 of raw.split(',')) {
        const part = part0.trim()
        if (!part) return { error: '存在空项（多余逗号）' }
        const slash = part.split('/')
        if (slash.length > 2 || (slash[1] !== undefined && (!/^\d+$/.test(slash[1]) || Number(slash[1]) < 1))) {
          return { error: '非法步长: ' + part }
        }
        const step = slash[1] !== undefined ? Number(slash[1]) : 1
        let lo
        let hi
        const base = slash[0]
        if (base === '*' || base === '') {
          lo = def.min; hi = def.max
          if (base === '*' && step === 1) any = true
        } else if (base.indexOf('-') >= 0) {
          const pair = base.split('-')
          if (pair.length !== 2) return { error: '非法范围: ' + part }
          lo = nameOf(pair[0]); hi = nameOf(pair[1])
          if (lo == null || hi == null) return { error: '非法范围端点: ' + part }
          if (lo > hi) return { error: '范围起点大于终点: ' + part }
        } else {
          const v = nameOf(base)
          if (v == null) return { error: '非法值: ' + base }
          lo = v
          hi = slash[1] !== undefined ? def.max : v // 带步长时 v/step 等价 v-max/step
        }
        if (lo < def.min || hi > def.max) return { error: '超出范围(' + def.min + '-' + def.max + '): ' + part }
        for (let v = lo; v <= hi; v += step) vals.add(def.key === 'dow' && v === 7 ? 0 : v) // 周日 7 归一为 0
      }
      return { set: vals, any }
    }

    const parseCron = (expr) => {
      const segs = String(expr || '').trim().split(/\s+/)
      if (segs.length !== 5) return { error: '需要 5 段（分 时 日 月 周），当前 ' + segs.length + ' 段' }
      const fields = []
      for (let i = 0; i < 5; i++) {
        const r = parseField(segs[i], FIELD_DEFS[i])
        if (r.error) return { error: '第 ' + (i + 1) + ' 段（' + FIELD_DEFS[i].label + '）' + r.error }
        fields.push(r)
      }
      return { fields }
    }

    const matchDay = (dom, dow, y, mo, d) => {
      // 标准 cron OR 语义：日/周都受限时任一命中；否则两者都要满足
      const dt = new Date(y, mo, d)
      const domHit = dom.set.has(d)
      const dowHit = dow.set.has(dt.getDay())
      if (!dom.any && !dow.any) return domHit || dowHit
      return domHit && dowHit
    }

    // 从 from 之后找下 N 次：逐分钟步进 + 字段级快进（月→日→时→分），上限 4 年
    const nextRuns = (fields, count) => {
      const [minute, hour, dom, month, dow] = fields
      const out = []
      const t = new Date()
      t.setSeconds(0, 0)
      t.setMinutes(t.getMinutes() + 1)
      const limit = new Date(t.getTime())
      limit.setFullYear(limit.getFullYear() + 4)
      let cur = t
      while (out.length < count && cur < limit) {
        if (!month.set.has(cur.getMonth() + 1)) { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 0, 0); continue }
        if (!matchDay(dom, dow, cur.getFullYear(), cur.getMonth(), cur.getDate())) {
          cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 0, 0)
          continue
        }
        if (!hour.set.has(cur.getHours())) { cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), cur.getHours() + 1, 0); continue }
        if (!minute.set.has(cur.getMinutes())) { cur = new Date(cur.getTime() + 60000); continue }
        out.push(new Date(cur))
        cur = new Date(cur.getTime() + 60000)
      }
      return out
    }

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const WEEK = ['日', '一', '二', '三', '四', '五', '六']
    const fmtRun = (d) =>
      d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' 周' + WEEK[d.getDay()]
    const fmtIn = (d) => {
      const mins = Math.max(0, Math.round((d.getTime() - Date.now()) / 60000))
      if (mins < 60) return mins + ' 分钟后'
      if (mins < 1440) return Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分后'
      return Math.floor(mins / 1440) + ' 天 ' + Math.floor((mins % 1440) / 60) + ' 时后'
    }
    const summarize = (set, min, max, any) => {
      if (any) return '每' + '个'
      const arr = [...set].sort((a, b) => a - b)
      if (arr.length > 12) return arr.slice(0, 12).join(',') + ' …（共 ' + arr.length + ' 个）'
      return arr.join(',')
    }

    const PRESETS = [
      ['* * * * *', '每分钟'],
      ['0 * * * *', '每小时整点'],
      ['0 0 * * *', '每天 00:00'],
      ['0 9 * * 1-5', '工作日 09:00'],
      ['30 2 * * *', '每天 02:30'],
      ['0 0 * * 1', '每周一 00:00'],
      ['0 0 1 * *', '每月 1 号'],
      ['*/5 * * * *', '每 5 分钟'],
    ]

    const render = (st, parsed, runs) => {
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root">')
      parts.push('<div class="tb-sec"><span class="tb-sec-label">Cron 表达式（分 时 日 月 周）</span>' +
        '<input class="tb-input tb-mono" data-field="expr" placeholder="如 0 9 * * 1-5" value="' + esc(st.expr || '') + '" /></div>')
      parts.push('<div class="tb-chips">' + PRESETS.map((p) =>
        '<button type="button" class="tb-chip" data-action="preset" data-v="' + esc(p[0]) + '" title="点击填入">' + esc(p[1]) + '</button>'
      ).join('') + '</div>')
      parts.push('<div class="tb-row">' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="calc">解析</button>' +
        '<span class="tb-note">标准 5 段；日/周同时受限时任一命中即运行（OR 语义）</span></div>')
      if (parsed && parsed.error) {
        parts.push('<div class="tb-banner tb-banner-error">' + esc(parsed.error) + '</div>')
      }
      if (parsed && !parsed.error && runs) {
        parts.push('<div class="tb-card"><div class="tb-sec"><span class="tb-sec-label">字段明细</span>' +
          parsed.fields.map((f, i) =>
            '<div class="tb-line"><span class="tb-line-status tb-tx-muted" style="width:auto;min-width:28px">' + esc(FIELD_DEFS[i].label) + '</span>' +
            '<span class="tb-line-path tb-mono">' + esc(summarize(f.set, FIELD_DEFS[i].min, FIELD_DEFS[i].max, f.any)) + '</span></div>'
          ).join('') + '</div></div>')
        if (runs.length) {
          parts.push('<div class="tb-list-head"><span class="tb-list-title">未来 ' + runs.length + ' 次运行（本地时区）</span></div>')
          parts.push('<div class="tb-list">' + runs.map((d) =>
            '<div class="tb-rec"><div class="tb-rec-main">' +
              '<div class="tb-rec-top"><span class="tb-rec-key tb-mono">' + esc(fmtRun(d)) + '</span></div>' +
              '<div class="tb-rec-sub"><span>' + esc(fmtIn(d)) + '</span></div>' +
            '</div></div>'
          ).join('') + '</div>')
        } else {
          parts.push('<div class="tb-notice">未来 4 年内无运行时刻（检查日/月/周组合是否过窄）</div>')
        }
      }
      if (!parsed) parts.push('<div class="tb-notice">输入表达式或点预设芯片，解析后显示字段明细与未来运行时刻</div>')
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state }) => {
      const st = (state && typeof state === 'object' && state) ? state : { expr: '' }
      const el = fields && fields.__el ? fields.__el : {}
      if (typeof fields.expr === 'string') st.expr = fields.expr
      if (action === 'preset' && el.v) st.expr = String(el.v)
      let parsed = null
      let runs = null
      if (action === 'calc' || action === 'preset' || (action === '' && st.expr)) {
        if (!st.expr.trim()) {
          parsed = { error: '请输入 cron 表达式' }
        } else {
          parsed = parseCron(st.expr)
          if (!parsed.error) runs = nextRuns(parsed.fields, 8)
        }
      }
      return { ok: true, html: render(st, parsed, runs), state: st }
    }

    tryRegisterTool(ctx, { id: 'cron', label: 'Cron', order: 23 }, handler)
  },
}
