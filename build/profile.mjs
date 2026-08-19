// ===== build/profile.mjs：功能选择、依赖闭包、命名空间与构建配置解析 =====
// 编译 CLI 的纯计算层：不读盘（文件存在性校验由调用方注入 loader）、不写盘、不含时间。
import { checkTimerInject } from './source-loader.mjs'

// 连续/尾随连字符会在 camelOf 后折叠成同一 Service 名（a-b 与 a--b），因此一并拒绝。
export const BUNDLE_ID_RE = /^(?=.{2,40}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
export const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

// ---- Catalog 校验（§5.3）：返回错误列表（空 = 通过）----
export const validateCatalog = (plugins, loader) => {
  const errors = []
  const byKey = new Map()
  for (const p of plugins) {
    if (byKey.has(p.key)) errors.push('重复 key: ' + p.key)
    byKey.set(p.key, p)
  }
  const prefixGroups = new Map() // idPrefix -> [keys]
  const aliasOwners = new Map()
  for (const p of plugins) {
    // idPrefix 合法性 + 重复（重复必须声明共享组）
    if (!/^[a-z]{3,6}$/.test(p.idPrefix || '')) errors.push(p.key + ': idPrefix 须为 3–6 个小写字母（当前: ' + p.idPrefix + '）')
    const g = prefixGroups.get(p.idPrefix) || []
    g.push(p)
    prefixGroups.set(p.idPrefix, g)
    // platform 与 Host/Client 文件一致
    const hasHost = Boolean(p.hostFiles && p.hostFiles.length)
    const hasClient = Boolean(p.clientFile)
    if (p.platform === 'host-only' && (!hasHost || hasClient)) errors.push(p.key + ': platform=host-only 但 hostFiles/clientFile 不一致')
    if (p.platform === 'client-only' && (!hasClient || hasHost)) errors.push(p.key + ': platform=client-only 但 hostFiles/clientFile 不一致')
    if (p.platform === 'host+client' && (!hasHost || !hasClient)) errors.push(p.key + ': platform=host+client 需要同时有 hostFiles 与 clientFile')
    // Client-only / 含 Client 半必须需要批准
    if (hasClient && p.approval !== true) errors.push(p.key + ': 含 Client 半必须 approval: true（浏览器代码执行的安全闸门）')
    // 含 Client 半的 feature 强制 process scope（避免按 root 重复批准，评审非阻断 2）
    if (hasClient && p.bundle && p.bundle.scope !== 'process') errors.push(p.key + ': 含 Client 半的 feature 必须 bundle.scope=process')
    // 引用不存在的源文件
    if (loader) {
      for (const f of (p.hostFiles || []).concat(p.clientFile ? [p.clientFile] : [])) {
        if (!loader.exists(f)) errors.push(p.key + ': 源文件不存在: ' + f)
      }
      // timer 动词检查
      if (hasHost) {
        const implSrc = loader.readExisting(
          ['shared/runtime.js']
            .concat(p.sharedRegistry ? ['shared/registry.js'] : [])
            .concat(p.sharedHost === false ? [] : ['shared/host.js'])
            .concat(p.hostFiles || []),
        ).join('\n')
        const timerErr = checkTimerInject(p, implSrc)
        if (timerErr) errors.push(timerErr)
      }
    }
    // 未知 dependency/conflict
    const b = p.bundle || {}
    if (b.selectable) {
      for (const alias of [p.key].concat(b.aliases || [])) {
        const owner = aliasOwners.get(alias)
        if (owner && owner !== p.key) errors.push('功能别名重复: ' + alias + '（' + owner + ', ' + p.key + '）')
        else aliasOwners.set(alias, p.key)
      }
    }
    for (const d of b.dependencies || []) if (!byKey.has(d)) errors.push(p.key + ': 未知 dependency: ' + d)
    for (const c of b.conflicts || []) if (!byKey.has(c)) errors.push(p.key + ': 未知 conflict: ' + c)
  }
  for (const [prefix, group] of prefixGroups) {
    if (group.length > 1 && !group.every((p) => p.idPrefixSharedGroup && group.every((q) => q.idPrefixSharedGroup === p.idPrefixSharedGroup))) {
      errors.push('idPrefix 重复且未声明同一共享组: ' + prefix + '（' + group.map((p) => p.key).join(', ') + '）')
    }
  }
  // dependency 环（DFS 三色标记）
  const color = new Map()
  const visit = (key, chain) => {
    const c = color.get(key)
    if (c === 2) return
    if (c === 1) { errors.push('dependency 环: ' + chain.concat([key]).join(' → ')); return }
    color.set(key, 1)
    const p = byKey.get(key)
    for (const d of (p && p.bundle && p.bundle.dependencies) || []) visit(d, chain.concat([key]))
    color.set(key, 2)
  }
  for (const p of plugins) visit(p.key, [])
  return errors
}

// ---- 功能选择归一化：别名解析 → 依赖闭包 → 冲突拒绝 → (order, key) 排序（order 相同按 key 字典序）----
// 返回 { ok, errors, explicit, dependencyAdded, selected }；selected 含 toolbox 且总排第一
export const normalizeSelection = (plugins, requested) => {
  const errors = []
  const byKey = new Map(plugins.map((p) => [p.key, p]))
  const aliasToKey = new Map()
  for (const p of plugins) {
    const b = p.bundle || {}
    if (!b.selectable) continue
    aliasToKey.set(p.key, p.key)
    for (const a of b.aliases || []) aliasToKey.set(a, p.key)
  }
  const explicit = []
  for (const r of requested) {
    const key = aliasToKey.get(r)
    if (!key) { errors.push('未知功能: ' + r + '（可选: ' + [...aliasToKey.keys()].join(', ') + '）'); continue }
    if (explicit.indexOf(key) < 0) explicit.push(key)
  }
  if (requested.length && !explicit.length) return { ok: false, errors, explicit: [], dependencyAdded: [], selected: [] }
  if (!explicit.length) { errors.push('空选择：至少选择一个功能（toolbox 框架会隐式加入）'); return { ok: false, errors, explicit: [], dependencyAdded: [], selected: [] } }
  // 依赖闭包
  const all = new Set(explicit)
  const dependencyAdded = []
  const queue = [...explicit]
  while (queue.length) {
    const key = queue.shift()
    const p = byKey.get(key)
    for (const d of (p && p.bundle && p.bundle.dependencies) || []) {
      if (!all.has(d)) { all.add(d); dependencyAdded.push(d); queue.push(d) }
    }
  }
  // 冲突拒绝
  for (const key of all) {
    const p = byKey.get(key)
    for (const c of (p && p.bundle && p.bundle.conflicts) || []) {
      if (all.has(c)) errors.push('功能冲突: ' + key + ' 与 ' + c + ' 不能同时编译进一个合集')
    }
  }
  if (errors.length) return { ok: false, errors, explicit, dependencyAdded, selected: [] }
  const cmp = (a, b) => {
    const pa = byKey.get(a); const pb = byKey.get(b)
    return ((pa.order || 0) - (pb.order || 0)) || (a < b ? -1 : a > b ? 1 : 0)
  }
  const features = [...all].sort(cmp)
  return {
    ok: true,
    errors: [],
    explicit: explicit.slice().sort(cmp),
    dependencyAdded: dependencyAdded.sort(cmp),
    selected: ['toolbox'].concat(features),
  }
}

// ---- 命名空间派生（§9.2）：bundleId → 全部技术名称 ----
export const camelOf = (bundleId) => bundleId.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')

export const deriveRuntimeOverrides = (bundleId, displayName, { aiUsage = true } = {}) => ({
  mode: 'static-bundle',
  bundleId,
  displayName,
  registryService: 'toolboxRegistry' + camelOf(bundleId),
  artifactService: 'toolboxArtifacts' + camelOf(bundleId),
  remoteService: 'toolboxNative' + camelOf(bundleId),
  remoteNamespace: 'toolboxNative' + camelOf(bundleId),
  rpcPrefix: 'toolbox.' + bundleId,
  storagePrefix: 'dsh.toolbox.' + bundleId,
  eventPrefix: 'tb-' + bundleId,
  slotPrefix: 'toolbox-' + bundleId,
  domId: bundleId,
  hostIdPrefix: 'toolbox-host-' + bundleId,
  dataDir: '.dsh-dynamic-toolbox', // 业务数据目录沿用动态模式约定（固化构建期值，不读 toolbox.config.json）
  capabilities: {
    diskReload: false,
    rebuildFromDisk: false,
    pluginDefaults: false,
    pluginRestart: false,
    aiUsage: false,
    managePlugins: false,
  },
})
