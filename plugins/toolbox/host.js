// ===== toolbox-host.js：工具箱框架 Host 半 — 工具注册表 + 面板 RPC + 插件生命周期开关 =====
// 工具插件（Host-only）通过 ctx.get('toolboxRegistry').register(...) 注册；
// Client 壳通过 toolbox/tools（列表）与 toolbox/panel（渲染/动作）驱动；
// 齿轮管理视图经 toolbox/plugins（清单）与 toolbox/plugin-toggle（真停/真启）驱动——
// 直连 dynamicCordisRunner 服务（Cordis 面板的停止/运行按钮就是它的 @Remote 版本
// stopFromPanel/runHostHalf），与 Cordis 面板同一注册表，两处状态天然同步。
// 注意：ctx.get 是不受 inject 限制的可选查找（guard.ts readService 仅属性访问强制声明）。

return {
  name: 'toolbox-host',
  async apply(ctx) {
    // ===== 仓库定位（v6.3 multiplex）：探测所有含本仓库强标记（plugins.json 含 id:'toolbox'）的根 ====
    // 直下命中优先，一级子目录兜底（仓库 clone 为宿主项目子目录场景）；不缓存——多仓库并存时
    // 每个候选都是独立仓库，不能锁死第一个。
    const baseRoots = () => {
      const r = []
      const sp = ctx.get('sandboxPolicy')
      if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot) r.push(sp.workspaceRoot)
      const ss = ctx.get('sessions')
      if (ss) { try { for (const s of ss.list()) { const c = s && s.header && s.header.cwd; if (typeof c === 'string' && c && r.indexOf(c) < 0) r.push(c) } } catch (e) {} }
      return r
    }
    const readManifestAt = async (fs, dir) => {
      try {
        const t = await fs.resolve('plugins.json', { cwd: dir })
        if (!await fs.stat(t)) return null
        const parsed = JSON.parse(await fs.readText(t))
        if (!parsed || !Array.isArray(parsed.plugins) || !parsed.plugins.some((e) => e && e.id === 'toolbox')) return null
        return { manifest: parsed, root: String(dir).replace(/[\\/]+$/, '') }
      } catch (e) { return null }
    }
    const probeManifests = async (bases) => {
      const fs = ctx.get('fs')
      if (!fs) return []
      const out = []
      const seen = new Set()
      for (const b of bases) {
        const hit = await readManifestAt(fs, b)
        if (hit && !seen.has(hit.root)) { seen.add(hit.root); out.push(hit) }
      }
      for (const b of bases) {
        try {
          const entries = await fs.listDir(await fs.resolve('.', { cwd: b }))
          for (const ent of entries || []) {
            if (!ent || ent.type !== 'directory' || !ent.name) continue
            if (ent.name.charAt(0) === '.' || ent.name === 'node_modules') continue
            const hit = await readManifestAt(fs, b.replace(/[\\/]+$/, '') + '/' + ent.name)
            if (hit && !seen.has(hit.root)) { seen.add(hit.root); out.push(hit) }
          }
        } catch (e) {}
      }
      return out
    }
    // findManifest(base?)：base 给定时只探测该路径（resolveRoot 用）；省略时全局探测，返回第一个命中
    const findManifest = async (base) => {
      const hits = await probeManifests(base ? [base] : baseRoots())
      return hits[0] || null
    }
    // 全部候选仓库根（本框架挑选自己的 root 用）
    const rootCands = (await probeManifests(baseRoots())).map((h) => h.root)

    // ==== 全局 multiplex 注册表（v6.3）：进程内只 provide 一份（首个框架或静态 bootstrapper），后续框架 attach ====
    // 状态挂在服务对象上（跨 fiber 共享，见 makeRegistry 返回对象）：root → 工具表。
    // 工具注册归「当前 build root」；build 用锁式 runInBuild(root, fn) —— 整个异步段持锁，
    // 段内（工具插件 apply 的 register）buildRoot 稳定，多仓库并行冷启/手动启停绝不串表。
    const makeRegistry = () => {
      const tables = new Map() // root -> Map<id, entry>
      let buildRoot = null
      let lastRoot = null
      let lock = Promise.resolve()
      let release = null
      const tableOf = (root) => {
        if (!root) return null
        let t = tables.get(root)
        if (!t) { t = new Map(); tables.set(root, t) }
        return t
      }
      const register = (desc, handler) => {
        if (!desc || typeof desc.id !== 'string' || !desc.id || typeof handler !== 'function') return () => {}
        const t = tableOf(buildRoot || lastRoot)
        if (!t) return () => {}
        const entry = { id: desc.id, label: desc.label || desc.id, order: typeof desc.order === 'number' ? desc.order : 0, handler }
        t.set(desc.id, entry)
        return () => { if (t.get(desc.id) === entry) t.delete(desc.id) }
      }
      return {
        attach(root) { if (!root) return; lastRoot = root; tableOf(root) },
        register,
        // 互斥 build 段（评审 H2/H3 修复）：await 前一个段结束 → buildRoot=root → 执行 fn（段内
        // 任何 register 都归 root）→ finally 清 buildRoot 并释放锁。锁在服务对象上，跨框架共享。
        async runInBuild(root, fn) {
          const prev = lock
          let r
          lock = new Promise((res) => { r = res })
          await prev
          buildRoot = root || null
          try { return await fn() } finally { buildRoot = null; r() }
        },
        tools(root) {
          const t = tables.get(root || lastRoot) || new Map()
          return [...t.values()].sort((a, b) => a.order - b.order)
            .map((x) => ({ id: x.id, label: x.label, order: x.order }))
        },
        async panel(root, call) {
          const t = tables.get(root || lastRoot)
          const toolId = call && typeof call.tool === 'string' ? call.tool : ''
          const entry = t && t.get(toolId)
          if (!entry || !entry.handler) return { ok: false, error: '工具未注册或已停止: ' + (toolId || '(空)') }
          try {
            const res = await entry.handler({
              action: call && typeof call.action === 'string' ? call.action : '',
              fields: (call && call.fields && typeof call.fields === 'object') ? call.fields : {},
              state: (call && call.state) || null,
              root: (typeof root === 'string' && root) ? root : undefined,
              session: (call && typeof call.session === 'string' && call.session) ? call.session : undefined,
            })
            if (!res || typeof res.html !== 'string') return { ok: false, error: '工具返回了无效的面板内容' }
            const out = { ok: true, html: res.html, state: res.state == null ? null : res.state }
            if (typeof res.copy === 'string' && res.copy) out.copy = res.copy
            return out
          } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
        },
        has(root) { return root ? tables.has(root) : false },
        roots() { return [...tables.keys()] },
      }
    }

    // 注册表复用/提供：已存在（其他仓库先启动）→ 复用同一全局实例；否则 provide 新实例。
    const existingReg = ctx.get('toolboxRegistry')
    const registry = existingReg || (() => { const r = makeRegistry(); ctx.provide('toolboxRegistry', r); return r })()

    // 框架驱动的 runner.run 必须在注册表互斥 build 段内执行（工具插件 apply 里 register 归入
    // 本 root 的表）——手动启停/重跑/批量/重挂/重建都走这里，避免落 lastRoot 单槽归错仓库。
    const runInBuild = (root, fn) => registry.runInBuild(root, fn)

    // 本框架所属仓库根：探测所有候选（sandboxPolicy.workspaceRoot + 各会话 cwd，含一级子目录），
    // 挑选「尚未被任何框架 attach」的仓库——多仓库并存时各框架各占一个，不会都抢第一个。
    const myRoot = (() => {
      for (const c of rootCands) if (!registry.has(c)) return c
      return rootCands[0] || null
    })()
    if (myRoot) registry.attach(myRoot)

    // 面板 RPC root 解析：优先调用方显式 cwd（client 传当前激活工作区路径）→ 仓库探测；
    // 无 cwd / 探测不到 → 回退本框架 root（多仓库并存时理论上总有 cwd，回退仅兼容旧调用）
    const resolveRoot = async (args) => {
      const cwd = args && ((typeof args.cwd === 'string' && args.cwd) ? args.cwd : (typeof args.root === 'string' && args.root) ? args.root : '')
      if (cwd) {
        const found = await findManifest(String(cwd).replace(/[\\/]+$/, ''))
        if (found) return found.root
        return null // 明确探测不到（该 cwd 无工具箱）：不回落本框架 root，避免切到别的仓库却显示错仓工具
      }
      return myRoot || null
    }

    ctx.effect(() => harness.handle('toolbox/tools', async (args) => {
      const root = await resolveRoot(args)
      return { ok: true, root, tools: registry.tools(root) }
    }))

    // ===== 插件生命周期管理（齿轮视图）=====
    const runner = ctx.get('dynamicCordisRunner')
    const agents = ctx.get('agents')
    const sessionOf = (args) => (args && typeof args.session === 'string' && args.session) ? args.session : undefined

    // agent 解析：live agent 优先；宿主会话/幽灵 id 等非 live 会话兜底为最小 agent
    // （runner 的内部调用只消费 agent.id；steer/inject 在 agents.get 查不到时本就静默）。
    // 自举宿主会话模式下主实例归属「宿主会话 id」，此兜底让抽屉的管理 RPC 也能驱动它。
    const agentFor = (sid) => sid ? ((agents && agents.get(sid)) || { id: sid }) : undefined

    // 宿主会话 id（与 host-bootstrap/index.js hostIdOf 同算法）：唯一标识一个仓库根，
    // 用于自动补齐时把「本框架」与其宿主会话行对上（多仓库并存不误认别的框架行）
    const hostIdOf = (root) => 'toolbox-host-' + String(root || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 48)

    // 清单映射（按 root 缓存）：root → { name → { entryId, defaultStart } }。
    // 惰性函数：body 引用 readConfig（定义在其后），调用时已初始化。
    const manifestCacheByRoot = new Map()
    const manifestMap = async (root) => {
      if (manifestCacheByRoot.has(root)) return manifestCacheByRoot.get(root)
      const out = {}
      try {
        const found = await findManifest(root || undefined)
        if (found && found.manifest && Array.isArray(found.manifest.plugins)) {
          const cfg = await readConfig(found.root)
          const recs = (cfg && cfg.plugins) || {}
          for (const e of found.manifest.plugins) {
            if (!e || typeof e.name !== 'string') continue
            const rec = recs[e.id]
            out[e.name] = {
              entryId: e.id,
              defaultStart: rec && typeof rec.enabled === 'boolean' ? rec.enabled : Boolean(e.autoStart),
            }
          }
        }
      } catch (e) {}
      manifestCacheByRoot.set(root, out)
      return out
    }

    // 行是否属于本仓库：行名命中 plugins.json 清单 → 属于；清单读失败（空映射）时回退按会话过滤。
    // 管理视图从「本会话插件」改为「本仓库插件」（工作区级单例 + 自举宿主会话后，插件可能挂在
    // 宿主会话名下，不能再按 agentId 过滤——否则用户会话的管理页永远空白）。
    const isRepoRow = (row, byName, sid) => {
      const current = row.packages.find((p) => p.packageId === (row.currentPackageId || row.nextPackageId))
        || row.packages[row.packages.length - 1]
      const name = (current && current.name) || row.pluginId
      if (byName && Object.keys(byName).length > 0) return byName[name] !== undefined
      return !sid || row.agentId === sid
    }

    // 当前仓库的动态插件清单（inventory 是全进程的，按「清单归属」过滤为当前仓库的行；
    // 自举宿主会话模式下插件可能挂在宿主会话名下，不再按 agentId===session 过滤）
    // 附带 defaultStart：该插件在「下次重建」时的默认启停（启停记忆 .dsh-dynamic-toolbox/toolbox-plugins.json
    // 有记录从其记录，无记录按 plugins.json 的 autoStart；未入清单为 null）
    ctx.effect(() => harness.handle('toolbox/plugins', async (args) => {
      if (!runner) return { ok: false, error: 'dynamicCordisRunner 服务不可用' }
      const sid = sessionOf(args)
      const root = await resolveRoot(args)
      const rows = []
      const byName = await manifestMap(root)
      for (const r of runner.inventory()) {
        if (!isRepoRow(r, byName, sid)) continue
        const current = r.packages.find((p) => p.packageId === (r.currentPackageId || r.nextPackageId))
          || r.packages[r.packages.length - 1]
        const name = (current && current.name) || r.pluginId
        const meta = byName[name] || null
        rows.push({
          pluginId: r.pluginId,
          name,
          entryId: meta ? meta.entryId : null, // 清单条目 id（== 工具 id）；清单外插件为 null（管理树归「系统」且不可移动）
          running: Boolean(r.activeRun),
          currentPackageId: r.currentPackageId || null,
          // 含 Client 半的插件启停涉及浏览器编排/批准，交给 Cordis 面板
          hasClientHalf: r.packages.some((p) => p.hasClientHalf),
          defaultStart: meta ? meta.defaultStart : null,
        })
      }
      return { ok: true, root, plugins: rows }
    }))

    // 真停/真启：stop 走 stopFromPanel（与面板一致，会向会话注入通知）；
    // run 直接激活（Host-only 无 Client 半 → 无需批准，同步完成）。
    ctx.effect(() => harness.handle('toolbox/plugin-toggle', async (args) => {
      if (!runner) return { ok: false, error: '插件运行器服务不可用' }
      const sid = sessionOf(args)
      const agent = agentFor(sid)
      const root = await resolveRoot(args)
      const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : ''
      if (!pluginId) return { ok: false, error: '缺少 pluginId' }
      const byName = await manifestMap(root)
      const row = runner.inventory().find((r) => r.pluginId === pluginId)
      if (!row || !isRepoRow(row, byName, sid)) return { ok: false, error: '插件不存在或不属于当前仓库: ' + pluginId }
      if (row.packages.some((p) => p.hasClientHalf)) {
        return { ok: false, error: pluginId + ' 含 Client 半，启停请到 Cordis 面板操作' }
      }
      const enable = Boolean(args && args.enable)
      if (enable) {
        if (row.activeRun) return { ok: true, running: true, note: '已在运行' }
        const pkg = row.currentPackageId || row.nextPackageId
        if (!pkg) return { ok: false, error: pluginId + ' 没有可运行的 Package' }
        const res = await runInBuild(root, () => runner.run(agent, pluginId, pkg, 'run'))
        if (res && res.ok) { await persistToggle(pluginId, true, root); return { ok: true, running: true } }
        return { ok: false, error: (res && (res.message || res.reason)) || '启动失败' }
      }
      const res = await runner.stopFromPanel(agent, pluginId)
      if (res && res.ok) { await persistToggle(pluginId, false, root); return { ok: true, running: false } }
      return { ok: false, error: (res && (res.message || res.reason)) || '停止失败' }
    }))

    // ===== 启停状态配置文件：<工作区>/.dsh-dynamic-toolbox/toolbox-plugins.json =====
    // 齿轮开关每次真停/真启成功后落盘 { plugins: { <清单条目id>: { enabled, at } } }；
    // 重建（doRebuild）时：有记录且 enabled=false 的条目只 define 不启动（恢复上次记录），
    // 无记录的条目按 plugins.json 的 autoStart 默认行为。写盘走 subprocess（与自动补齐报告同路径，绕过 fs 沙箱策略）。
    const CONFIG_REL = '.dsh-dynamic-toolbox/toolbox-plugins.json'
    const readConfig = async (root) => {
      const fs = ctx.get('fs')
      if (!fs || !root) return { version: 1, plugins: {} }
      try {
        const t = await fs.resolve(CONFIG_REL, { cwd: root })
        if (!await fs.stat(t)) return { version: 1, plugins: {} }
        const parsed = JSON.parse(await fs.readText(t))
        if (!parsed || typeof parsed !== 'object' || !parsed.plugins || typeof parsed.plugins !== 'object') {
          return { version: 1, plugins: {} }
        }
        return parsed
      } catch (e) { return { version: 1, plugins: {} } }
    }
    const writeConfig = async (root, cfg) => {
      const sub = ctx.get('subprocess')
      if (!sub || !root) return false
      try {
        const handle = sub.spawn({
          argv: ['node', '-e', "const fs=require('fs');fs.mkdirSync(require('path').dirname(process.argv[1]),{recursive:true});fs.writeFileSync(process.argv[1],process.argv[2])", root.replace(/[\\/]+$/, '') + '/' + CONFIG_REL, JSON.stringify(cfg, null, 2)],
          stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
          graceMs: 10000,
        })
        await handle.done
        return true
      } catch (e) { return false }
    }
    // 动态 pluginId → 清单条目 id：按当前 Package 名匹配指定仓库 plugins.json 条目名
    // （匹配不到返回 null，不落盘）。按 root 路由——多仓库并存时各写各的启停记忆。
    const manifestEntryIdOf = async (pluginId, root) => {
      if (!runner) return null
      const row = runner.inventory().find((r) => r.pluginId === pluginId)
      if (!row) return null
      const current = row.packages.find((p) => p.packageId === (row.currentPackageId || row.nextPackageId))
        || row.packages[row.packages.length - 1]
      const pkgName = current && current.name
      if (!pkgName) return null
      const found = await findManifest(root || undefined)
      if (!found || !found.manifest || !Array.isArray(found.manifest.plugins)) return null
      const entry = found.manifest.plugins.find((e) => e && e.name === pkgName)
      return entry ? { entryId: entry.id, root: found.root } : null
    }
    const persistToggle = async (pluginId, enabled, root) => {
      try {
        const hit = await manifestEntryIdOf(pluginId, root)
        if (!hit) return
        const cfg = await readConfig(hit.root)
        let at = null
        try { at = new Date().toISOString() } catch (e) {}
        cfg.plugins[hit.entryId] = { enabled: Boolean(enabled), at }
        await writeConfig(hit.root, cfg)
      } catch (e) {}
    }

    // 只改「下次重建默认启停」（启停记忆），不动当前运行态——管理视图「重启后」pill 的点击链路
    ctx.effect(() => harness.handle('toolbox/plugin-set-default', async (args) => {
      const root = await resolveRoot(args)
      const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : ''
      if (!pluginId) return { ok: false, error: '缺少 pluginId' }
      const hit = await manifestEntryIdOf(pluginId, root)
      if (!hit) return { ok: false, error: '插件不在 plugins.json 清单内，无法写启停记忆' }
      const cfg = await readConfig(hit.root)
      let at = null
      try { at = new Date().toISOString() } catch (e) {}
      cfg.plugins[hit.entryId] = { enabled: Boolean(args && args.enabled), at }
      const written = await writeConfig(hit.root, cfg)
      if (!written) return { ok: false, error: '启停记忆写盘失败' }
      return { ok: true, entryId: hit.entryId, enabled: Boolean(args && args.enabled) }
    }))

    // 重跑单个插件：桩在 apply 时重读磁盘 impl——改完 plugins/<key>/tool.js 点它即生效，
    // 不用重新 define/批准。等同 toggle(enable=true) 但允许对运行中的插件执行（真重启）。
    ctx.effect(() => harness.handle('toolbox/plugin-restart', async (args) => {
      if (!runner) return { ok: false, error: '插件运行器服务不可用' }
      const sid = sessionOf(args)
      const agent = agentFor(sid)
      const root = await resolveRoot(args)
      const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : ''
      if (!pluginId) return { ok: false, error: '缺少 pluginId' }
      const byName = await manifestMap(root)
      const row = runner.inventory().find((r) => r.pluginId === pluginId)
      if (!row || !isRepoRow(row, byName, sid)) return { ok: false, error: '插件不存在或不属于当前仓库: ' + pluginId }
      if (row.packages.some((p) => p.hasClientHalf)) {
        return { ok: false, error: pluginId + ' 含 Client 半，重跑请到 Cordis 面板操作' }
      }
      const pkg = row.currentPackageId || row.nextPackageId
      if (!pkg) return { ok: false, error: pluginId + ' 没有可运行的 Package' }
      const res = await runInBuild(root, () => runner.run(agent, pluginId, pkg, 'run'))
      if (res && res.ok) { await persistToggle(pluginId, true, root); return { ok: true, running: true } }
      return { ok: false, error: (res && (res.message || res.reason)) || '重跑失败' }
    }))

    // 批量启停：一次动作完成当前仓库全部 Host-only 插件的真停/真启，启停记忆统一写一次
    ctx.effect(() => harness.handle('toolbox/plugin-toggle-all', async (args) => {
      if (!runner) return { ok: false, error: '插件运行器服务不可用' }
      const sid = sessionOf(args)
      const agent = agentFor(sid)
      const root = await resolveRoot(args)
      const enable = Boolean(args && args.enable)
      // 清单映射 + 配置（各取一次，循环内复用）
      const entryIdByName = {}
      let cfg = null
      let cfgRoot = null
      try {
        const found = await findManifest(root || undefined)
        if (found && found.manifest && Array.isArray(found.manifest.plugins)) {
          cfgRoot = found.root
          cfg = await readConfig(cfgRoot)
          for (const e of found.manifest.plugins) if (e && typeof e.name === 'string') entryIdByName[e.name] = e.id
        }
      } catch (e) {}
      const done = []
      const failed = []
      const skippedClient = []
      for (const r of runner.inventory()) {
        if (!isRepoRow(r, entryIdByName, sid)) continue
        if (r.packages.some((p) => p.hasClientHalf)) { skippedClient.push(r.pluginId); continue }
        const current = r.packages.find((p) => p.packageId === (r.currentPackageId || r.nextPackageId))
          || r.packages[r.packages.length - 1]
        const name = (current && current.name) || ''
        if (enable) {
          if (r.activeRun) { done.push(r.pluginId + '（已在运行）') }
          else {
            const pkg = r.currentPackageId || r.nextPackageId
            if (!pkg) { failed.push(r.pluginId + ': 没有可运行的 Package'); continue }
            const res = await runInBuild(root, () => runner.run(agent, r.pluginId, pkg, 'run'))
            if (res && res.ok) done.push(r.pluginId)
            else { failed.push(r.pluginId + ': ' + ((res && (res.message || res.reason)) || '启动失败')); continue }
          }
        } else {
          if (!r.activeRun) { done.push(r.pluginId + '（本已停止）') }
          else {
            const res = await runner.stopFromPanel(agent, r.pluginId)
            if (res && res.ok) done.push(r.pluginId)
            else { failed.push(r.pluginId + ': ' + ((res && (res.message || res.reason)) || '停止失败')); continue }
          }
        }
        const eid = entryIdByName[name]
        if (cfg && eid) {
          let at = null
          try { at = new Date().toISOString() } catch (e) {}
          cfg.plugins[eid] = { enabled: enable, at }
        }
      }
      if (cfg && cfgRoot) await writeConfig(cfgRoot, cfg)
      return { ok: failed.length === 0, done, failed, skippedClient }
    }))

    // 批量重跑：对当前运行中的 Host-only 插件逐个 run（桩重读磁盘 impl）——
    // 改完多个 tool.js / shared/host.js / loader.js 后一键全部生效，不用逐行点「重跑」。
    // 停着的插件不动（尊重开关状态，不隐式启动）；含 Client 半的跳过（去 Cordis 面板）。
    ctx.effect(() => harness.handle('toolbox/plugin-restart-all', async (args) => {
      if (!runner) return { ok: false, error: '插件运行器服务不可用' }
      const sid = sessionOf(args)
      const agent = agentFor(sid)
      const root = await resolveRoot(args)
      const byName = await manifestMap(root)
      const done = []
      const failed = []
      const skippedClient = []
      for (const r of runner.inventory()) {
        if (!isRepoRow(r, byName, sid)) continue
        if (r.packages.some((p) => p.hasClientHalf)) { skippedClient.push(r.pluginId); continue }
        if (!r.activeRun) continue // 只重跑运行中的
        const pkg = r.currentPackageId || r.nextPackageId
        if (!pkg) { failed.push(r.pluginId + ': 没有可运行的 Package'); continue }
        const res = await runInBuild(root, () => runner.run(agent, r.pluginId, pkg, 'run'))
        if (res && res.ok) done.push(r.pluginId)
        else failed.push(r.pluginId + ': ' + ((res && (res.message || res.reason)) || '重跑失败'))
      }
      return { ok: failed.length === 0, done, failed, skippedClient }
    }))

    // ===== 从 plugins.json 自举重建（齿轮按钮 + 启动自动补齐共用 doRebuild）=====
    // 框架读磁盘 payload.json（本身就是 define 参数的完整 JSON），经 dynamicCordisRunner
    // 批量 define + run Host-only 插件——全新重建缩到「define+run 框架 + 一次批准」，零点击。
    // 幂等：按插件 name 跳过本仓库已定义的（含被用户停掉的，尊重开关状态）。
    // 启停记忆：读 .dsh-dynamic-toolbox/toolbox-plugins.json，记录为关闭的条目只 define 不 run（恢复上次记录）。
    // v6.3：串行 + build 上下文——工具插件在 apply 里注册必须归入本仓库 root，串行保证
    // buildRoot 全程稳定；beginBuild/endBuild 互斥队列让多仓库并行冷启也不会串组。
    const doRebuild = async (sid, root) => {
      const t0 = Date.now()
      const fs = ctx.get('fs')
      if (!runner || !fs) return { ok: false, error: 'dynamicCordisRunner/fs 服务不可用' }
      const agent = agentFor(sid)
      const found = await findManifest(root || undefined)
      if (!found || !found.manifest || !Array.isArray(found.manifest.plugins)) {
        return { ok: false, error: '找不到 plugins.json' + (root ? '（root: ' + root + '）' : '') }
      }
      const manifest = found.manifest
      const manifestRoot = found.root
      const config = await readConfig(manifestRoot)
      const cfgPlugins = (config && config.plugins) || {}
      const existingNames = new Set()
      // 幂等按「本仓库宿主/本仓库会话」的行判定（评审 H4 修复）：isRepoRow 只按清单名匹配，
      // 两仓库同名工具会互相误判已定义——必须限定 agentId（本仓库宿主 id 或本次构建 sid）
      const hostOfRoot = hostIdOf(manifestRoot)
      for (const r of runner.inventory()) {
        if (r.agentId !== sid && r.agentId !== hostOfRoot) continue
        for (const p of r.packages) if (p && p.name) existingNames.add(p.name)
      }
      const defined = []
      const started = []
      const skipped = []
      const suppressed = []
      const failed = []
      const approvalPending = [] // approval 条目：run 非阻塞发起 → 批准卡弹出，用户点一次即启动（授权不跨进程，这是浏览器代码执行的安全闸门）
      const entries = manifest.plugins.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
      // 整段持锁：串行 define+run 期间 buildRoot 固定 = manifestRoot，工具注册不会归错 root；
      // 与其他仓库的并行自举/手动启停互斥（同一把注册表锁）
      await registry.runInBuild(manifestRoot, async () => {
        for (const entry of entries) {
          if (entry.id === 'toolbox') { skipped.push('toolbox（框架自身）'); continue }
          if (existingNames.has(entry.name)) { skipped.push(entry.id); continue }
          try {
            const pt = await fs.resolve(entry.payload, { cwd: manifestRoot })
            const payload = JSON.parse(await fs.readText(pt))
            const rec = runner.define({ sessionId: sid, plugin: payload.plugin, name: payload.name, purpose: payload.purpose, code: payload.code })
            defined.push(entry.id + '→' + rec.pluginId)
            existingNames.add(entry.name)
            const recCfg = cfgPlugins[entry.id]
            if (recCfg && recCfg.enabled === false) { suppressed.push(entry.id); continue }
            if (entry.autoStart) {
              const res = await runner.run(agent, rec.pluginId, rec.packageId, 'run')
              if (res && res.ok) {
                if (res.status === 'awaiting-approval') approvalPending.push(entry.id) // 批准卡已弹出；点允许后异步启动
                else started.push(entry.id)
              }
              else failed.push(entry.id + ': ' + ((res && (res.message || res.reason)) || 'run 失败'))
            }
          } catch (e) {
            failed.push(entry.id + ': ' + String((e && e.message) || e))
          }
        }
      })
      const orderOf = (s) => { const id = String(s).split('→')[0].split(':')[0]; const e = entries.find((x) => x.id === id); return e ? e.order || 0 : 999 }
      for (const list of [defined, started, skipped, suppressed, failed, approvalPending]) list.sort((a, b) => orderOf(a) - orderOf(b))
      return { ok: failed.length === 0, defined, started, skipped, suppressed, failed, approvalPending, ms: Date.now() - t0 }
    }

    ctx.effect(() => harness.handle('toolbox/rebuild', async (args) => {
      const sid = sessionOf(args)
      return doRebuild(sid, await resolveRoot(args))
    }))

    // AI 用量台账聚合（管理视图总行）：读 .dsh-dynamic-toolbox/toolbox-ai-usage.json，按工具聚合 次数/输出token/失败
    ctx.effect(() => harness.handle('toolbox/ai-usage', async () => {
      const fs = ctx.get('fs')
      if (!fs) return { ok: true, tools: [], totals: null }
      try {
        const found = await findManifest(myRoot)
        if (!found) return { ok: true, tools: [], totals: null }
        const t = await fs.resolve('.dsh-dynamic-toolbox/toolbox-ai-usage.json', { cwd: found.root })
        if (!await fs.stat(t)) return { ok: true, tools: [], totals: null }
        const parsed = JSON.parse(await fs.readText(t))
        const list = Array.isArray(parsed) ? parsed : []
        const byTool = {}
        let calls = 0
        let out = 0
        let errs = 0
        let todayCalls = 0
        let todayOut = 0
        const dayStr = new Date().toDateString() // 本地日界（与台账 t 同含时区）
        for (const r of list) {
          if (!r || typeof r !== 'object') continue
          const k = String(r.tool || '?')
          if (!byTool[k]) byTool[k] = { tool: k, calls: 0, out: 0, errors: 0 }
          if (r.ok) {
            byTool[k].calls++
            calls++
            const o = typeof r.out === 'number' ? r.out : 0
            byTool[k].out += o
            out += o
            if (typeof r.t === 'number' && new Date(r.t).toDateString() === dayStr) { todayCalls++; todayOut += o }
          } else {
            byTool[k].errors++
            errs++
          }
        }
        const tools = Object.keys(byTool).sort().map((k) => byTool[k])
        return { ok: true, tools, totals: { calls, out, errors: errs, todayCalls, todayOut } }
      } catch (e) { return { ok: true, tools: [], totals: null } }
    }))
    // 重建耗时历史（管理视图迷你柱状图数据源）：读 .dsh-dynamic-toolbox/toolbox-autorebuild.json 的 history
    ctx.effect(() => harness.handle('toolbox/rebuild-history', async () => {
      const fs = ctx.get('fs')
      if (!fs) return { ok: false, error: 'fs 服务不可用' }
      try {
        const found = await findManifest(myRoot)
        if (!found) return { ok: true, history: [] }
        const t = await fs.resolve('.dsh-dynamic-toolbox/toolbox-autorebuild.json', { cwd: found.root })
        if (!await fs.stat(t)) return { ok: true, history: [] }
        const parsed = JSON.parse(await fs.readText(t))
        return { ok: true, history: (parsed && Array.isArray(parsed.history)) ? parsed.history : [] }
      } catch (e) { return { ok: true, history: [] } }
    }))

    // ===== 启动自动补齐：框架每次启动自调一次 doRebuild（幂等，已定义的按名跳过）=====
    // sid 发现：优先 agents.currentInitiator()（cordis_run 由 agent 驱动时携带发起者）；
    // 兜底：inventory 里按 plugins.json 的 toolbox 条目 name 找框架自身所在行——
    // 恰好一行才采用（多会话同名框架并存时无法区分归属，宁可跳过也不补齐到别的会话）。
    let stopped = false
    ctx.effect(() => () => { stopped = true })
    ;(async () => {
      // 分阶段落盘报告（subprocess 直写，绕过 fs 沙箱策略）：每到一个阶段整份重写，
      // 文件停在哪一阶段，问题就在哪一阶段之后。报告路径 <工作区>/.dsh-dynamic-toolbox/toolbox-autorebuild.json
      const stages = []
      const report = async (stage, extra) => {
        stages.push(Object.assign({ stage }, extra || {}))
        let at = null
        try { at = new Date().toISOString() } catch (e) {}
        const roots = []
        try {
          const sp = ctx.get('sandboxPolicy')
          if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot) roots.push(sp.workspaceRoot)
          const ss = ctx.get('sessions')
          if (ss) { for (const s of ss.list()) { const c = s && s.header && s.header.cwd; if (typeof c === 'string' && c && roots.indexOf(c) < 0) roots.push(c) } }
        } catch (e) {}
        // 报告落本框架仓库（多仓库并存时各框架各自落盘，不抢第一个）
        let root = myRoot || roots[0]
        try {
          const fs = ctx.get('fs')
          if (fs && !myRoot) {
            outer:
            for (const r of roots) {
              try {
                const t = await fs.resolve('plugins.json', { cwd: r })
                if (await fs.stat(t)) { root = r; break }
                const dt = await fs.resolve('.', { cwd: r })
                const entries = await fs.listDir(dt)
                for (const ent of entries || []) {
                  if (!ent || ent.type !== 'directory' || !ent.name) continue
                  if (ent.name.charAt(0) === '.' || ent.name === 'node_modules') continue
                  const sub = r.replace(/[\\/]+$/, '') + '/' + ent.name
                  const t2 = await fs.resolve('plugins.json', { cwd: sub })
                  if (await fs.stat(t2)) { root = sub; break outer }
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
        if (!root) { stages.push({ stage: 'report-no-root' }); return }
        const sub = ctx.get('subprocess')
        if (!sub) { stages.push({ stage: 'report-no-subprocess' }); return }
        // 历史耗时曲线：读旧文件的 history 追加本次 done 结果（最近 20 次），重建速度变化可追踪
        let history = []
        try {
          const fs2 = ctx.get('fs')
          if (fs2) {
            const t = await fs2.resolve('.dsh-dynamic-toolbox/toolbox-autorebuild.json', { cwd: root })
            if (await fs2.stat(t)) {
              const prev = JSON.parse(await fs2.readText(t))
              if (prev && Array.isArray(prev.history)) history = prev.history
            }
          }
        } catch (e) {}
        if (stage === 'done') {
          const res = extra && extra.res
          history = history.concat([{
            at,
            ms: res && typeof res.ms === 'number' ? res.ms : null,
            defined: res && Array.isArray(res.defined) ? res.defined.length : 0,
            started: res && Array.isArray(res.started) ? res.started.length : 0,
            failed: res && Array.isArray(res.failed) ? res.failed.length : 0,
            suppressed: res && Array.isArray(res.suppressed) ? res.suppressed.length : 0,
          }]).slice(-20)
        }
        const payload = JSON.stringify({ at, stages, history }, null, 2)
        try {
          const handle = sub.spawn({
            argv: ['node', '-e', "const fs=require('fs');fs.mkdirSync(require('path').dirname(process.argv[1]),{recursive:true});fs.writeFileSync(process.argv[1],process.argv[2])", root.replace(/[\\/]+$/, '') + '/.dsh-dynamic-toolbox/toolbox-autorebuild.json', payload],
            stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
            graceMs: 10000,
          })
          await handle.done
        } catch (e) {
          try { stages.push({ stage: 'report-failed', error: String((e && e.message) || e) }) } catch (e2) {}
        }
      }
      if (!runner) { await report('no-services', { runner: Boolean(runner) }); return }
      await report('start')
      let sid = undefined
      try {
        const init = typeof agents.currentInitiator === 'function' ? agents.currentInitiator() : undefined
        if (init && typeof init.id === 'string' && init.id) sid = init.id
      } catch (e) {}
      if (!sid) {
        try {
          // 兜底：优先本框架仓库的宿主会话（agentId === hostIdOf(myRoot)）匹配框架行
          const fn0 = await findManifest(myRoot)
          const selfName = fn0 && fn0.manifest && Array.isArray(fn0.manifest.plugins)
            ? fn0.manifest.plugins.find((e) => e && e.id === 'toolbox') : undefined
          const sName = selfName && selfName.name
          if (sName) {
            const hits = runner.inventory().filter((r) => r.packages.some((p) => p && p.name === sName) && r.agentId === hostIdOf(myRoot))
            const anyHits = hits.length ? hits : runner.inventory().filter((r) => r.packages.some((p) => p && p.name === sName))
            if (anyHits.length === 1) sid = anyHits[0].agentId
            else if (anyHits.length > 1) console.log('toolbox: 自动补齐跳过（多仓库同名框架并存且宿主不可区分），可在抽屉管理重跑')
          }
        } catch (e) {}
      }
      await report('sid', { sid: sid || null })
      if (stopped) { await report('stopped-before-rebuild'); return }
      if (!sid) { console.log('toolbox: 自动补齐跳过（无法确定当前会话）'); return }
      const res = await doRebuild(sid, myRoot)
      if (stopped) { await report('stopped-after-rebuild'); return }
      // 确定性重挂：框架重启后注册表是全新空表，运行中的插件重跑一遍，
      // 让注册确定性落进新表（2s 慢心跳在服务重 provide 后因子 fiber 的 ctx.get 命中
      // isolate key 变化而 throw、无法自愈，必须重跑重建 fiber；刚由 doRebuild 启动的跳过避免双跑）
      const justDefined = new Set()
      for (const s of (res && Array.isArray(res.defined) ? res.defined : [])) {
        const pid = String(s).split('→')[1]
        if (pid) justDefined.add(pid)
      }
      const reattachAgent = agentFor(sid)
      const reattached = []
      const reattachFailed = []
      const reattachAsync = [] // 含 Client 半的插件：重跑为异步 starting，浏览器端另行激活
      // 排除框架自身（清单 id=toolbox 对应插件）：否则 reattach 重跑框架 → 框架重启再 reattach → 无限重启循环
      // 门控（MiMo H1）：仅当 doRebuild 成功且能从清单识别框架自身时才重挂——findManifest 失败/清单缺条目时
      // selfPluginIds 必空、排除失效，此时整体跳过 reattach，宁可这轮不重挂也不冒重启循环风险。
      const selfPluginIds = new Set()
      let selfName = null
      try {
        const found0 = await findManifest(myRoot)
        const tbEntry = found0 && found0.manifest && Array.isArray(found0.manifest.plugins)
          ? found0.manifest.plugins.find((e) => e && e.id === 'toolbox') : undefined
        selfName = tbEntry && tbEntry.name
        if (selfName) {
          for (const r of runner.inventory()) {
            if (r.packages.some((p) => p && p.name === selfName)) selfPluginIds.add(r.pluginId)
          }
        }
      } catch (e) {}
      const reattachEnabled = Boolean(res && res.ok && selfName && selfPluginIds.size > 0 && sid)
      if (!reattachEnabled) {
        console.log('toolbox: 重挂跳过（' + (!res || !res.ok ? 'doRebuild 未成功' : !selfName ? '清单无 toolbox 条目' : selfPluginIds.size === 0 ? '未识别到框架自身' : 'sid 未确定') + '），运行中工具靠心跳/手动恢复')
      }
      if (reattachEnabled) {
        const reattachByName = await manifestMap(myRoot)
        for (const r of runner.inventory()) {
          if (stopped) break // M2：框架停止中立即中断重挂
          if (!isRepoRow(r, reattachByName, sid)) continue
          if (!r.activeRun) continue
          const hasClient = r.packages.some((p) => p.hasClientHalf)
          if (selfPluginIds.has(r.pluginId)) continue // 框架自身绝不重挂（防重启循环）
          if (justDefined.has(r.pluginId)) continue
          const pkg = r.currentPackageId || r.nextPackageId
          if (!pkg) continue
          try {
            const rr = await runInBuild(myRoot, () => runner.run(reattachAgent, r.pluginId, pkg, 'run'))
            if (rr && rr.ok) {
              if (hasClient) reattachAsync.push(r.pluginId)
              else reattached.push(r.pluginId)
            } else {
              reattachFailed.push(r.pluginId + ': ' + ((rr && (rr.message || rr.reason)) || '重跑失败'))
            }
          } catch (e) {
            reattachFailed.push(r.pluginId + ': ' + String((e && e.message) || e))
          }
        }
      }
      if (reattached.length) console.log('toolbox: 框架重启，确定性重挂运行中工具: ' + reattached.join('、'))
      if (reattachAsync.length) console.log('toolbox: 重挂含界面插件（异步激活）: ' + reattachAsync.join('、'))
      if (reattachFailed.length) console.log('toolbox: 重挂失败: ' + reattachFailed.join('；'))
      await report('done', { sid, res, reattached: reattached.length + reattachAsync.length })
      if (res && res.ok) {
        if (res.defined && res.defined.length) {
          console.log('toolbox: 自动补齐 新定义: ' + res.defined.join('、') + '；已启动: ' + (res.started || []).join('、'))
        } else {
          console.log('toolbox: 自动补齐检查完成，plugins.json 内插件均已存在')
        }
        if (res.failed && res.failed.length) console.log('toolbox: 自动补齐部分失败: ' + res.failed.join('；'))
        if (res.suppressed && res.suppressed.length) console.log('toolbox: 按上次记录保持关闭: ' + res.suppressed.join('、'))
        if (res.approvalPending && res.approvalPending.length) console.log('toolbox: 待批准启动（批准卡已弹出，点一次允许即启动）: ' + res.approvalPending.join('、'))
      } else {
        console.log('toolbox: 自动补齐失败: ' + ((res && res.error) || '(未知)'))
      }
    })().catch((e) => { console.log('toolbox: 自动补齐异常: ' + String((e && e.message) || e)) })

    ctx.effect(() => harness.handle('toolbox/panel', async (args) => {
      const root = await resolveRoot(args)
      return registry.panel(root, args)
    }))
  },
}
