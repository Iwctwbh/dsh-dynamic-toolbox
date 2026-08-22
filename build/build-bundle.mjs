// ===== build/build-bundle.mjs：原生静态合集构建管线（纯计算，不写盘）=====
// 输出普通 DSH Host + dsh.client 双端包；不生成动态 payload，不调用 dynamicCordisRunner。
import { PLUGINS } from './plugin-catalog.mjs'
import { sha256 } from './source-loader.mjs'
import { validateCatalog, normalizeSelection, deriveRuntimeOverrides, BUNDLE_ID_RE, SEMVER_RE, PACKAGE_NAME_RE } from './profile.mjs'
import { renderNativeHost } from './templates/native-host.mjs'
import { renderNativeClient } from './templates/native-client.mjs'
import { renderNativeRemote } from './templates/native-remote.mjs'
import { renderPackageJson } from './templates/package.json.mjs'
import { renderCordisPatch } from './templates/cordis.patch.yml.mjs'
import { renderReadme } from './templates/README.md.mjs'

export const buildBundle = (loader, opts) => {
  const errors = validateCatalog(PLUGINS, loader)
  // Flowglass is the repository's primary product. An omitted/empty feature
  // selection therefore builds Flowglass; callers must explicitly select
  // additional features when they want a toolbox bundle.
  const requestedFeatures = opts.features && opts.features.length ? opts.features : ['flow']
  const sel = normalizeSelection(PLUGINS, requestedFeatures)
  if (!sel.ok) errors.push(...sel.errors)
  if (errors.length) return { ok: false, errors }

  const byKey = new Map(PLUGINS.map((entry) => [entry.key, entry]))
  const selected = sel.selected.map((key) => byKey.get(key))
  const featureEntries = selected.slice(1)
  const featureKey = sel.selected.slice(1).sort().join('-')
  // A legal bundle id is capped at 40 characters. Large selections used to
  // fail unless the caller knew to provide --id; derive a compact, stable id
  // instead. Keep short ids readable and include a hash for long selections
  // so different feature sets cannot collapse onto the same package name.
  const autoBundleId = BUNDLE_ID_RE.test(featureKey)
    ? featureKey
    : 'bundle-' + featureEntries.length + '-' + sha256(featureKey).slice(0, 12)
  const bundleId = opts.id || autoBundleId
  if (!BUNDLE_ID_RE.test(bundleId)) errors.push('bundleId 不合法: ' + bundleId + '（须匹配 ' + BUNDLE_ID_RE + '）')
  const isFlowglass = bundleId === 'flow' && featureEntries.length === 1 && featureEntries[0].key === 'flow'
  const packageName = opts.name || (isFlowglass ? 'dsh-flowglass' : 'dsh-' + bundleId + '-toolbox')
  if (!PACKAGE_NAME_RE.test(packageName) || packageName.length > 214) errors.push('npm package name 不合法: ' + packageName)
  const label = opts.label || (featureEntries.length === 1
    ? featureEntries[0].bundle.defaultLabel
    : featureEntries.map((entry) => entry.bundle.defaultLabel).join(' + ') + ' 工具箱')
  if (!label || /[\u0000\r\n]/.test(label)) errors.push('label 不合法：不能为空或包含换行/控制字符')
  const version = opts.version || '0.0.0-dev'
  if (!SEMVER_RE.test(version)) errors.push('version 不合法: ' + version)
  if (!loader.exists('LICENSE')) errors.push('仓库根缺少 LICENSE')

  // Client RPC features must have an explicit native bridge. The toolbox
  // loader endpoint is internal to dynamic mode and does not need one.
  const nativeClientRpc = {
    selfview: [
      { rpc: 'selfview/pull', method: 'selfviewPull' },
      { rpc: 'selfview/result', method: 'selfviewResult' },
      { rpc: 'selfview/push', method: 'selfviewPush' },
    ],
  }
  for (const entry of featureEntries) {
    if (entry.clientRpc && entry.key !== 'toolbox' && !nativeClientRpc[entry.key]) {
      errors.push(entry.key + ': 尚未迁移到原生静态 Remote，当前不能编译进静态合集')
    }
  }
  if (errors.length) return { ok: false, errors }

  const profile = deriveRuntimeOverrides(bundleId, label)
  const runtimeSource = loader.read('shared/runtime.js')
  const sharedHostSource = loader.read('shared/host.js')
  const toolboxClientSource = loader.read('plugins/toolbox/client.js')
  const hostFeatures = featureEntries.filter((entry) => entry.hostFiles && entry.hostFiles.length).map((entry) => ({
    key: entry.key,
    source: entry.hostFiles.map(loader.read).join('\n'),
  }))
  const clientFeatures = featureEntries.filter((entry) => entry.clientFile).map((entry) => ({
    key: entry.key,
    source: loader.read(entry.clientFile),
  }))
  const bridgeMethods = featureEntries.flatMap((entry) => nativeClientRpc[entry.key] || [])
  const hasModelTools = featureEntries.some((entry) => entry.modelTools && entry.modelTools.length)
  const inject = []
  for (const entry of featureEntries) for (const service of entry.inject || []) if (!inject.includes(service)) inject.push(service)
  if (hasModelTools && !inject.includes('tools')) inject.push('tools')

  const indexJs = renderNativeHost({ packageName, profile, runtimeSource, sharedHostSource, hostFeatures, inject, bridgeMethods, hasModelTools })
  const clientJs = renderNativeClient({ packageName, profile, runtimeSource, toolboxClientSource, clientFeatures, bridgeMethods })
  const remoteJs = renderNativeRemote({ packageName, profile, bridgeMethods })
  const fingerprint = sha256(JSON.stringify(profile) + '\n' + indexJs + '\n' + clientJs + '\n' + remoteJs).slice(0, 16)

  const sourceHashes = {}
  for (const entry of selected) {
    for (const file of (entry.hostFiles || []).concat(entry.clientFile ? [entry.clientFile] : [])) sourceHashes[file] = sha256(loader.read(file))
  }
  for (const file of ['shared/runtime.js', 'shared/host.js']) sourceHashes[file] = sha256(loader.read(file))

  const manifest = {
    version: 3,
    mode: 'native-static',
    bundle: bundleId,
    plugins: selected.map((entry) => ({
      id: entry.key, name: entry.name, platform: entry.platform, order: entry.order, purpose: entry.purpose,
    })),
  }
  const buildInfo = {
    bundleId, packageName, version, displayName: label,
    mode: 'native-static', dynamicApprovalRequired: false,
    features: { explicit: sel.explicit, dependencyAdded: sel.dependencyAdded, all: sel.selected },
    fingerprint, builderVersion: '2',
    sourceHashes: Object.fromEntries(Object.entries(sourceHashes).sort(([a], [b]) => a < b ? -1 : 1)),
    profile,
  }
  const featureLines = featureEntries.map((entry) => '  - `' + entry.key + '` — ' + entry.name).join('\n')
  const files = new Map([
    ['package.json', renderPackageJson({
      packageName,
      version,
      description: isFlowglass ? '流镜（DSH 原生静态插件）' : label + '（DSH 原生静态工具箱）',
      bundleId,
      repositoryDirectory: opts.repositoryDirectory,
      hasModelTools,
    })],
    ['cordis.patch.yml', renderCordisPatch({ bundleId, packageName })],
    ['README.md', renderReadme({ packageName, version, bundleId, displayName: label, featureLines, isFlowglass })],
    ['manifest.json', JSON.stringify(manifest, null, 2) + '\n'],
    ['BUILDINFO.json', JSON.stringify(buildInfo, null, 2) + '\n'],
    ['lib/index.js', indexJs],
    ['lib/client.js', clientJs],
    ['lib/remote.js', remoteJs],
    ['LICENSE', loader.read('LICENSE')],
  ])
  const summary = {
    bundleId, packageName, version, label, mode: 'native-static',
    features: buildInfo.features, approvalCount: 0, fingerprint,
    files: [...files].map(([path, content]) => ({ path, bytes: content.length })),
  }
  return { ok: true, errors: [], files, summary }
}
