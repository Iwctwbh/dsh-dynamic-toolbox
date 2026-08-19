// ===== build/generate-dynamic.mjs：动态模式生成物的纯计算 =====
// 从 catalog + 磁盘源码计算 plugins/<key>/plugin.json、plugins/<key>/payload.json、根 plugins.json
// 的目标内容（不写盘），供 make-payloads.mjs（写入）与 scripts/verify-generated.mjs（漂移对比）共用。
import { PLUGINS } from './plugin-catalog.mjs'
import { makeSourceLoader, syntaxCheck, checkTimerInject } from './source-loader.mjs'
import { buildDynamicPayload, hostImplFiles } from './payload-builder.mjs'

// rootUrl：仓库根 file URL；log：可选日志函数（语法 OK 等进度）
// 返回 { files: Map<根相对路径, 文本内容>, errors: string[] }
export const buildDynamicArtifacts = (rootUrl, log) => {
  const loader = makeSourceLoader(rootUrl)
  const files = new Map()
  const errors = []
  const check = (label, code) => {
    const err = syntaxCheck(label, code)
    if (err) { errors.push('syntax FAIL: ' + err); if (log) log('syntax FAIL: ' + err) }
    else if (log) log('syntax OK: ' + label)
    return !err
  }

  check('loader.js [impl]', loader.read('loader.js'))

  for (const p of PLUGINS) {
    const dir = 'plugins/' + p.key
    const implRel = (p.hostFiles || []).map((f) => f.slice(dir.length + 1))
    const clientRel = p.clientFile ? p.clientFile.slice(dir.length + 1) : null
    const shared = p.sharedHost !== false
    const implFiles = hostImplFiles(p)

    // impl 存在性与语法
    for (const f of implFiles) {
      if (!loader.exists(f)) {
        errors.push('missing impl: ' + f + ' (' + p.key + ')')
        if (log) log('missing impl: ' + f + ' (' + p.key + ')')
      }
    }
    if (p.hostFiles) check(implFiles.join(' + ') + ' [impl]', loader.readExisting(implFiles).join('\n'))

    if (p.hostFiles && p.platform !== 'client-only') {
      const implSrc = loader.readExisting(implFiles).join('\n')
      const timerErr = checkTimerInject(p, implSrc)
      if (timerErr) {
        errors.push(timerErr)
        if (log) log(timerErr)
      }
    }

    // plugin.json（文件夹级元数据）
    files.set(dir + '/plugin.json', JSON.stringify({
      key: p.key, idPrefix: p.idPrefix, name: p.name, purpose: p.purpose,
      platform: p.platform, inject: p.inject || [], impl: implRel, client: clientRel,
      shared, order: p.order, autoStart: p.autoStart, approval: p.approval,
    }, null, 2) + '\n')

    // payload.json
    const payload = buildDynamicPayload(p, { readSource: loader.read })
    if (payload.code.host) check('payload ' + p.key + ' [host stub]', payload.code.host)
    if (payload.code.client) check('payload ' + p.key + ' [client]', payload.code.client)
    files.set(dir + '/payload.json', JSON.stringify(payload, null, 2) + '\n')
  }

  // 根 plugins.json（重建总清单：只留决策所需元数据；define 参数一律读条目 payload.json）
  files.set('plugins.json', JSON.stringify({
    version: 2,
    comment: '工具箱插件总清单（v6 文件夹结构，make-payloads.mjs 生成）。最快重建：cordis_define tbx 框架（Host 桩 + Client 加载桩）→ cordis_run → GUI 批准，零点击——框架启动自动补齐（doRebuild：读磁盘 payload.json 经 dynamicCordisRunner 并行 define+run，幂等按名跳过已定义，含被停掉的；启动与否遵循 .dsh-dynamic-toolbox/toolbox-plugins.json 启停记忆）。抽屉齿轮「从 plugins.json 重建/补齐」按钮是同一逻辑的手动触发。无框架时的手动路径：按 order 依次读该条目 payload.json（即完整 define 参数）→ cordis_define → autoStart=true 的再 cordis_run(mode: run)。approval=true 含 Client 半需 GUI 批准。inject/implFiles 等只在 payload.json 维护，本清单不重复。',
    plugins: PLUGINS.slice().sort((a, b) => a.order - b.order).map((p) => ({
      id: p.key,
      name: p.name,
      payload: 'plugins/' + p.key + '/payload.json',
      platform: p.platform,
      approval: p.approval,
      autoStart: p.autoStart,
      order: p.order,
      idPrefix: p.idPrefix,
      purpose: p.purpose,
      ...(p.clientFile ? { client: p.clientFile } : {}),
      ...(p.modelTools ? { modelTools: p.modelTools } : {}),
      ...(p.note ? { note: p.note } : {}),
    })),
  }, null, 2) + '\n')

  return { files, errors }
}
