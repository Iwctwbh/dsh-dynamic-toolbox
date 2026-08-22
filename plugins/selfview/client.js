// ===== selfview-client.js：界面自查 Client 半 =====
// 动态模式经 Host 半 selfview/client-impl RPC 从磁盘拉取；静态模式在构建期直接打包，
// 两种模式共用 host.call('selfview/*') 通道。
// 职责：
//   1. getDisplayMedia 截屏流（一次授权持续复用；抓帧不需要用户激活，授权必须——所以授权/复制按钮
//      由本半注入真实 DOM 按钮到面板的 [data-selfview-mount]，React 合成事件与 RPC 都没有用户激活）；
//   2. 语义 DOM 快照（[eN] ref → 元素映射，供 ui_snapshot/ui_click 等模型工具）；
//   3. DOM 操作：点击/填充（原生 setter + input/change，绕 React 受控组件值跟踪）/滚动/按键；
//   4. 截图塞进聊天框：合成 ClipboardEvent('paste') + DataTransfer(File)，命中 composer 的 onPaste；
//   5. 长轮询命令通道：host.call('selfview/pull') 挂起 25s 心跳，结果回 selfview/result。

return {
  name: 'selfview-client',
  inject: ['timer'],
  apply(ctx) {
    if (typeof document === 'undefined' || typeof navigator === 'undefined') return

    // ---------- 模块状态（bar 重建不丢） ----------
    let stream = null
    let video = null
    let lastFrame = null // { blob, dataUrl, thumbB64, b64, w, h, at }
    let stopped = false
    let refMap = new Map() // 'e12' -> Element（最近一次快照）

    const sleep = (ms) => new Promise((r) => ctx.timeout(r, ms))
    const pushState = (note) => host.call('selfview/push', { kind: 'state', stream: Boolean(stream && stream.active), note: note || '' }).catch(() => {})
    const pushThumb = () => {
      if (!lastFrame) return
      host.call('selfview/push', { kind: 'thumb', thumbB64: lastFrame.thumbB64, w: lastFrame.w, h: lastFrame.h }).catch(() => {})
    }
    const pushLog = (line) => host.call('selfview/push', { kind: 'log', line }).catch(() => {})

    // ---------- 截屏 ----------
    async function enableStream() {
      if (stream && stream.active) return { ok: true, already: true }
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
        return { ok: false, error: '此浏览器不支持 getDisplayMedia' }
      }
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      })
      stream = s
      const track = s.getVideoTracks()[0]
      if (track) {
        track.addEventListener('ended', () => {
          stream = null
          video = null
          pushState('截屏共享已结束（用户在浏览器停止了共享）')
          refreshBars()
        })
      }
      video = document.createElement('video')
      video.muted = true
      video.srcObject = s
      await video.play()
      pushState('截屏共享已开启')
      return { ok: true }
    }

    function stopStream() {
      try { if (stream) for (const t of stream.getTracks()) t.stop() } catch (e) {}
      stream = null
      video = null
      pushState('截屏共享已停止')
      refreshBars()
    }

    function blobToB64(blob) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result || '').replace(/^data:[^,]*,/, ''))
        fr.onerror = () => reject(new Error('FileReader 失败'))
        fr.readAsDataURL(blob)
      })
    }

    async function grabFrame() {
      if (!stream || !stream.active || !video || !video.videoWidth) throw new Error('no-stream')
      const w = video.videoWidth
      const h = video.videoHeight
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(video, 0, 0, w, h)
      const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob 失败'))), 'image/jpeg', 0.85))
      // 缩略图（面板/日志用，宽 ≤ 360）
      const tw = Math.min(360, w)
      const th = Math.round((h * tw) / w)
      const tc = document.createElement('canvas')
      tc.width = tw
      tc.height = th
      tc.getContext('2d').drawImage(canvas, 0, 0, tw, th)
      const tBlob = await new Promise((res, rej) => tc.toBlob((b) => (b ? res(b) : rej(new Error('toBlob 失败'))), 'image/jpeg', 0.7))
      const b64 = await blobToB64(blob)
      const thumbB64 = await blobToB64(tBlob)
      return { blob, b64, thumbB64, dataUrl: 'data:image/jpeg;base64,' + b64, w, h, at: Date.now() }
    }

    async function doCapture() {
      if (!stream || !stream.active) return { ok: false, error: 'no-stream' }
      try {
        lastFrame = await grabFrame()
        refreshBars()
        pushThumb()
        return { ok: true, jpegB64: lastFrame.b64, thumbB64: lastFrame.thumbB64, w: lastFrame.w, h: lastFrame.h }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }

    // ---------- 语义快照 ----------
    const ROLE_HIT = /^(button|link|tab|menuitem|switch|checkbox|radio|dialog|option|treeitem|combobox|textbox)$/
    const isVisible = (el) => {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return false
      return true // 尺寸有效即认为可见（不逐元素 getComputedStyle，太贵）
    }
    const labelOf = (el) => {
      const pick = (s) => (typeof s === 'string' && s.trim() ? s.trim().replace(/\s+/g, ' ') : '')
      let s = pick(el.getAttribute && el.getAttribute('aria-label')) || pick(el.title) ||
        pick(el.getAttribute && el.getAttribute('placeholder')) || pick(el.value) ||
        pick(el.textContent)
      return s.length > 48 ? s.slice(0, 48) + '…' : s
    }
    const describe = (el, ref) => {
      const tag = el.tagName.toLowerCase()
      const type = tag === 'input' ? (' type=' + (el.type || 'text')) : ''
      const dis = el.disabled || el.getAttribute('aria-disabled') === 'true' ? '（禁用）' : ''
      const focus = el === document.activeElement ? '（焦点）' : ''
      return (ref ? '[' + ref + '] ' : '') + '<' + tag + type + '> "' + labelOf(el) + '"' + dis + focus
    }
    function doSnapshot(opts) {
      refMap = new Map()
      const maxLines = Math.max(20, Math.min(800, (opts && opts.maxLines) || 300))
      let root = document.body
      if (opts && opts.selector) {
        root = document.querySelector(opts.selector)
        if (!root) return { ok: false, error: 'selector 未命中: ' + opts.selector }
      }
      const lines = []
      let n = 0
      let truncated = false
      const walk = (el, depth) => {
        if (lines.length >= maxLines) { truncated = true; return }
        if (depth > 14 || !el || !el.tagName) return
        const tag = el.tagName
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|PATH|NOSCRIPT)$/.test(tag)) return
        if (!isVisible(el)) return
        const role = (el.getAttribute && el.getAttribute('role')) || ''
        const interesting =
          /^(A|BUTTON|INPUT|TEXTAREA|SELECT|SUMMARY|H1|H2|H3|H4|H5|H6)$/.test(tag) ||
          ROLE_HIT.test(role) ||
          el.hasAttribute('contenteditable') ||
          el.hasAttribute('data-action') ||
          el.hasAttribute('data-field')
        let childDepth = depth
        if (interesting) {
          n += 1
          const ref = 'e' + n
          refMap.set(ref, el)
          lines.push('  '.repeat(Math.min(depth, 10)) + describe(el, ref))
          childDepth = depth + 1
        }
        for (const c of el.children) walk(c, childDepth + (interesting ? 0 : 1))
      }
      walk(root, 0)
      const head = '页面: ' + (document.title || '(无标题)') + ' @ ' + location.href + '\n可见可交互元素 ' + n + ' 个' + (truncated ? '（已达 ' + maxLines + ' 行上限，截断；用 selector 缩范围）' : '') + '：'
      return { ok: true, text: head + '\n' + lines.join('\n'), count: n }
    }

    // ---------- DOM 操作 ----------
    const resolveEl = (cmd) => {
      if (cmd.ref) {
        const el = refMap.get(String(cmd.ref))
        if (!el) return { error: 'ref 不存在或已过期: ' + cmd.ref + '（重新 ui_snapshot 获取最新引用）' }
        if (!document.contains(el)) return { error: 'ref 指向的元素已离开文档: ' + cmd.ref + '（重新 ui_snapshot）' }
        return { el }
      }
      if (cmd.selector) {
        const el = document.querySelector(cmd.selector)
        if (!el) return { error: 'selector 未命中: ' + cmd.selector }
        return { el }
      }
      return { error: '需要 ref 或 selector' }
    }
    const DANGER = /删除|清空|结束进程|停止全部|退出登录|注销|废弃|还原|delete|remove|discard|logout|sign[\s-]?out/i
    function doAct(cmd) {
      try {
        if (cmd.action === 'scroll') {
          const dx = cmd.dx || 0
          const dy = cmd.dy == null ? 600 : cmd.dy
          if (cmd.selector) {
            const hit = resolveEl(cmd)
            if (hit.error) return { ok: false, error: hit.error }
            hit.el.scrollBy({ left: dx, top: dy })
            return { ok: true, detail: describe(hit.el) + ' → scrollTop=' + Math.round(hit.el.scrollTop) }
          }
          window.scrollBy({ left: dx, top: dy })
          return { ok: true, detail: 'window → scrollY=' + Math.round(window.scrollY) }
        }
        if (cmd.action === 'press') {
          const key = String(cmd.key || '')
          if (!key) return { ok: false, error: '缺少 key' }
          const target = cmd.selector ? resolveEl(cmd).el : (document.activeElement || document.body)
          if (!target) return { ok: false, error: '无目标元素' }
          for (const type of ['keydown', 'keypress', 'keyup']) {
            target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, view: window }))
          }
          return { ok: true, detail: key + ' @ ' + describe(target) }
        }
        const hit = resolveEl(cmd)
        if (hit.error) return { ok: false, error: hit.error }
        const el = hit.el
        if (cmd.action === 'click') {
          const label = labelOf(el)
          if (!cmd.allowDangerous && DANGER.test(label)) {
            return { ok: false, error: '疑似破坏性操作（"' + label + '"），已拦截；确认要点请用 allowDangerous=true' }
          }
          el.scrollIntoView && el.scrollIntoView({ block: 'nearest' }) // scrollIntoView 并非所有元素都有（svg/jsdom），缺则跳过
          el.focus && el.focus()
          el.click()
          pushLog('点击 ' + describe(el))
          return { ok: true, detail: describe(el) }
        }
        if (cmd.action === 'fill') {
          const text = String(cmd.text == null ? '' : cmd.text)
          el.focus && el.focus()
          const tag = el.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA') {
            const proto = tag === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text) // 原生 setter：绕 React 值跟踪
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
          } else if (tag === 'SELECT') {
            el.value = text
            el.dispatchEvent(new Event('change', { bubbles: true }))
          } else if (el.hasAttribute('contenteditable')) {
            el.textContent = text
            el.dispatchEvent(new Event('input', { bubbles: true }))
          } else {
            return { ok: false, error: '不是可填充元素: <' + tag.toLowerCase() + '>' }
          }
          pushLog('填充 ' + describe(el) + ' ← ' + text.slice(0, 30))
          return { ok: true, detail: describe(el) + ' ← "' + (text.length > 30 ? text.slice(0, 30) + '…' : text) + '"' }
        }
        return { ok: false, error: '未知 action: ' + cmd.action }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }

    // ---------- 粘贴进聊天框 ----------
    function pasteIntoComposer() {
      if (!lastFrame) return { ok: false, error: '还没有截图（先截一张）' }
      const ta = document.querySelector('textarea[data-phase]') ||
        document.querySelector('textarea[rows="2"]') ||
        document.querySelector('textarea')
      if (!ta) return { ok: false, error: '找不到聊天输入框（textarea[data-phase]）' }
      const file = new File([lastFrame.blob], 'webui-shot-' + lastFrame.at + '.jpg', { type: 'image/jpeg' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      ta.focus()
      ta.dispatchEvent(ev)
      pushLog('截图已粘贴进聊天框')
      return { ok: true, detail: ev.defaultPrevented ? '已进入聊天框附件区' : '已派发粘贴事件（聊天框未拦截，可能未接收——请目测确认）' }
    }

    // ---------- 面板按钮条（真实 DOM 按钮：授权/复制需要用户激活） ----------
    const barState = { note: '' }
    function ensureBar(mount) {
      if (mount.__selfviewBar) return
      mount.__selfviewBar = true
      mount.innerHTML = ''
      const bar = document.createElement('div')
      bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px'
      const mkBtn = (label, title, primary) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'tb-btn tb-btn-sm' + (primary ? ' tb-btn-primary' : '')
        b.textContent = label
        b.title = title || ''
        return b
      }
      const status = document.createElement('span')
      status.className = 'tb-note'
      const btnEnable = mkBtn('开启截屏', '浏览器弹窗选「当前标签页」；授权一次，流保持复用', true)
      const btnShot = mkBtn('截一张', '从共享流抓当前帧（不需再次授权）')
      const btnCopy = mkBtn('复制图片', '复制最近一帧到剪贴板（PNG）')
      const btnPaste = mkBtn('插入聊天框', '把最近一帧作为图片附件粘贴进聊天输入框（你确认后才会发送）')
      const btnStop = mkBtn('停止共享', '结束 getDisplayMedia 流')
      const note = document.createElement('span')
      note.className = 'tb-note'
      const preview = document.createElement('img')
      preview.style.cssText = 'max-width:100%;max-height:140px;border-radius:6px;display:none'
      const say = (t) => { note.textContent = t }

      const syncUI = () => {
        const on = Boolean(stream && stream.active)
        status.textContent = on ? '● 截屏共享中' : '○ 未开启'
        btnEnable.textContent = on ? '重新授权' : '开启截屏'
        btnShot.disabled = !on
        btnCopy.disabled = !on && !lastFrame
        btnPaste.disabled = !lastFrame
        btnStop.disabled = !on
        if (lastFrame) { preview.src = lastFrame.dataUrl; preview.style.display = 'block' }
      }
      btnEnable.onclick = async () => {
        btnEnable.disabled = true
        say('等待浏览器授权…（选「当前标签页」）')
        try {
          const r = await enableStream()
          say(r.ok ? '已开启 ✓ 之后截屏/模型 ui_capture 都直接用' : (r.error || '授权失败'))
        } catch (e) {
          say('授权被取消或失败: ' + String((e && e.message) || e))
        }
        btnEnable.disabled = false
        syncUI()
      }
      btnShot.onclick = async () => {
        say('抓帧中…')
        const r = await doCapture()
        say(r.ok ? '已截 ' + lastFrame.w + '×' + lastFrame.h + ' ✓' : ('失败: ' + (r.error === 'no-stream' ? '未开启共享' : r.error)))
        syncUI()
      }
      btnCopy.onclick = async () => {
        try {
          if (!lastFrame) { const r = await doCapture(); if (!r.ok) { say('先开启截屏'); syncUI(); return } }
          // 剪贴板只收 PNG：jpeg blob → ImageBitmap → canvas → png
          const bmp = await createImageBitmap(lastFrame.blob)
          const c = document.createElement('canvas')
          c.width = bmp.width
          c.height = bmp.height
          c.getContext('2d').drawImage(bmp, 0, 0)
          const png = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob 失败'))), 'image/png'))
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
          say('已复制到剪贴板 ✓（PNG ' + Math.round(png.size / 1024) + 'KB）')
          pushLog('截图已复制到剪贴板')
        } catch (e) {
          say('复制失败: ' + String((e && e.message) || e))
        }
        syncUI()
      }
      btnPaste.onclick = () => {
        const r = pasteIntoComposer()
        say(r.ok ? r.detail + ' ✓' : ('失败: ' + r.error))
        syncUI()
      }
      btnStop.onclick = () => { stopStream(); say('已停止共享') }
      bar.appendChild(status)
      bar.appendChild(btnEnable)
      bar.appendChild(btnShot)
      bar.appendChild(btnCopy)
      bar.appendChild(btnPaste)
      bar.appendChild(btnStop)
      mount.appendChild(bar)
      mount.appendChild(note)
      mount.appendChild(preview)
      mount.__selfviewSync = syncUI
      syncUI()
      if (barState.note) say(barState.note)
    }
    function refreshBars() {
      const mounts = document.querySelectorAll('[data-selfview-mount]')
      for (const m of mounts) {
        ensureBar(m)
        if (m.__selfviewSync) m.__selfviewSync()
      }
    }
    const observer = new MutationObserver(() => {
      const mounts = document.querySelectorAll('[data-selfview-mount]')
      for (const m of mounts) ensureBar(m)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    refreshBars() // 首扫：面板可能先于本半渲染（插件重启而抽屉开着），MutationObserver 只管之后的变更

    // ---------- 长轮询命令循环 ----------
    ;(async () => {
      while (!stopped) {
        let cmd = null
        try { cmd = await host.call('selfview/pull') } catch (e) { await sleep(2000); continue }
        if (stopped) break
        if (!cmd || cmd.cmd === 'none') continue
        if (cmd.cmd === 'stop') break
        let res
        try { res = await execCmd(cmd) } catch (e) { res = { ok: false, error: String((e && e.message) || e) } }
        try { await host.call('selfview/result', { id: cmd.id, res }) } catch (e) {}
      }
    })()
    async function execCmd(cmd) {
      if (cmd.cmd === 'capture') return doCapture()
      if (cmd.cmd === 'snapshot') return doSnapshot(cmd)
      if (cmd.cmd === 'act') return doAct(cmd)
      return { ok: false, error: '未知命令: ' + String(cmd.cmd) }
    }

    ctx.effect(() => () => {
      stopped = true
      try { observer.disconnect() } catch (e) {}
      try { if (stream) for (const t of stream.getTracks()) t.stop() } catch (e2) {}
      stream = null
      video = null
    })
  },
}
