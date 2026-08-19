// 存储归属仿真：验证 clone 部署场景下数据落仓库根而非宿主项目根。
// 场景：宿主项目根 D:\host，工具箱仓库 clone 为其子目录 D:\host\toolbox（含 plugins.json）。
// 断言：findRepoRoot 子目录扫描命中 toolbox 子目录；writeJsonStore/readJsonStore 落 toolbox 子目录；
//       不产生宿主根 .dsh-dynamic-toolbox 目录；toolbox.config.json dataDir 自定义生效。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 内存文件系统：模拟 D:\host（宿主根）+ D:\host\toolbox（本仓库，含 plugins.json）
const HOST = 'D:/host'
const mem = {}
mem[HOST + '/toolbox/plugins.json'] = '{"version":2,"plugins":[{"id":"toolbox","name":"框架"}]}'
mem[HOST + '/unrelated/plugins.json'] = '{"version":1,"plugins":[]}'  // 无 toolbox 条目的无关清单（误判防护样本）
const fsSvc = {
  async resolve(rel, opts) {
    let p
    if (/^[A-Za-z]:[\\/]|^\//.test(rel)) p = rel
    else p = (opts && opts.cwd ? opts.cwd : HOST) + '/' + rel
    // 归一化 ./ 段（真实 fs 服务的 resolve 会 realpath 归一）
    return p.replace(/\/\.\//g, '/').replace(/\/\.$/, '')
  },
  processPath(t) { return t },
  async stat(t) {
    if (Object.prototype.hasOwnProperty.call(mem, t)) return { isDir: false }
    const prefix = t.replace(/\/+$/, '') + '/'
    if (Object.keys(mem).some((k) => k.indexOf(prefix) === 0)) return { isDir: true }
    return undefined
  },
  async readText(t) { return mem[t] },
  async writeText(t, content) { mem[t] = String(content) },
  async listDir(dir) {
    const prefix = dir.replace(/\/+$/, '') + '/'
    const seen = {}
    for (const k of Object.keys(mem)) {
      if (k.indexOf(prefix) !== 0) continue
      const rest = k.slice(prefix.length)
      const seg = rest.split('/')[0]
      if (!seg || seen[seg]) continue
      seen[seg] = true
    }
    return Object.keys(seen).map((name) => ({ name, type: 'directory' }))
  },
}
const subprocess = {
  spawn() { return { done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } } } },
}

// sandboxPolicy.workspaceRoot = 宿主根（clone 场景的真实形态）
const ctx = {
  get(name) {
    if (name === 'fs') return fsSvc
    if (name === 'subprocess') return subprocess
    if (name === 'sandboxPolicy') return { workspaceRoot: HOST }
    return undefined
  },
  on() {}, effect() {},
  timeout(fn, ms) { const t = setTimeout(fn, ms); t.unref && t.unref(); return () => clearTimeout(t) },
  interval(fn) { try { fn() } catch (e) {} return () => {} },
}

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}

;(async () => {
  // shared/host.js 不返回插件对象——单独求值后捕获其内部函数不可行；
  // 改为求值 shared + 一个微型探针插件（借 tryRegisterTool 把函数暴露出来）。
  const probe = `
return {
  name: 'probe',
  apply(ctx) {
    tryRegisterTool(ctx, { id: 'probe', label: 'probe', order: 1 }, async () => {
      const repo = await findRepoRoot(ctx)
      const dataDir = await repoDataDir(ctx)
      return { ok: true, html: '', state: { repo, dataDir } }
    })
    // 暴露存储函数供断言
    ctx.__probe = { findRepoRoot, repoDataDir, readJsonStore, writeJsonStore, resolveDataPath, dataPathAbs, findManifest }
  },
}
`
  const handlers = {}
  const c2 = Object.create(ctx)
  c2.get = (name) => (name === 'toolboxRegistry' ? { register(d, h) { handlers[d.id] = h; return () => {} } } : ctx.get(name))
  const src = read('shared/runtime.js') + '\n' + read('shared/host.js') + '\n' + probe
  const plugin = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(c2, undefined, console)
  await plugin.apply(c2)
  const P = c2.__probe
  if (!P) { console.log('FAIL | 探针未暴露'); process.exit(1) }

  // 1. 仓库发现：直下无 plugins.json（宿主根没有），一级子目录扫描命中 toolbox
  const repo = await P.findRepoRoot(ctx)
  check('clone 场景 → 发现仓库根为 toolbox 子目录', repo === HOST + '/toolbox', String(repo))

  // 2. dataDir 默认
  check('dataDir 默认 .dsh-dynamic-toolbox', (await P.repoDataDir(ctx)) === '.dsh-dynamic-toolbox')

  // 3. 存储落仓库子目录，不落宿主根
  const ok = await P.writeJsonStore(ctx, '.dsh-dynamic-toolbox/probe.json', { hello: 1 }, HOST, null)
  check('writeJsonStore → 写入成功', ok === true)
  check('数据落 toolbox 子目录', !!mem[HOST + '/toolbox/.dsh-dynamic-toolbox/probe.json'])
  check('宿主根不产生数据目录', !mem[HOST + '/.dsh-dynamic-toolbox/probe.json'])

  // 4. 读回
  const back = await P.readJsonStore(ctx, '.dsh-dynamic-toolbox/probe.json', HOST, null)
  check('readJsonStore → 从仓库根读回', back && back.hello === 1)

  // 5. 绝对路径助手
  const abs = await P.dataPathAbs(ctx, '.dsh-dynamic-toolbox/data/jira', HOST)
  check('dataPathAbs → 仓库根绝对路径', abs === HOST + '/toolbox/.dsh-dynamic-toolbox/data/jira', abs)

  // 6. findManifest 同口径
  const mf = await P.findManifest(ctx)
  check('findManifest → 清单根为 toolbox 子目录', mf && mf.root === HOST + '/toolbox', mf && mf.root)

  // 7. dataDir 自定义：写入 toolbox.config.json 后（新插件实例清缓存）生效
  mem[HOST + '/toolbox/toolbox.config.json'] = '{"version":1,"dataDir":".tb-data"}'
  const c3 = Object.create(ctx)
  c3.get = (name) => (name === 'toolboxRegistry' ? { register() { return () => {} } } : ctx.get(name))
  const plugin2 = await new Function('ctx', 'harness', 'console', 'return (async () => {\n' + src + '\n})()')(c3, undefined, console)
  await plugin2.apply(c3)
  const P2 = c3.__probe
  check('自定义 dataDir 生效', (await P2.repoDataDir(ctx)) === '.tb-data')
  const abs2 = await P2.dataPathAbs(ctx, '.dsh-dynamic-toolbox/probe.json', HOST)
  check('自定义 dataDir → 路径映射', abs2 === HOST + '/toolbox/.tb-data/probe.json', abs2)

  console.log(failures ? ('\n共 ' + failures + ' 项失败') : '\n全部通过')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('仿真异常:', e); process.exit(2) })