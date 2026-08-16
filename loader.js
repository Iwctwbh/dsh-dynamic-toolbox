// ===== loader.js（v5 磁盘级加载器）：由静态桩经 new Function 形参注入调用 =====
// 桩只负责定位本文件；本文件负责读 impl 文件、拼接求值、委托 apply。
// 改本文件无需重新 define/批准（桩在 apply 时实时读它）。
// 形参：ctx、harness、console（Builtin 显式下传——嵌套 new Function 帧不吃外层形参，
// 真机上它们虽是全局 builtin，显式传参可保证两种求值环境都可用）、IMPL_FILES、usedRoot
const fs = ctx.get('fs')
if (!fs) throw new Error('loader: fs 服务不可用')
const parts = []
for (const f of IMPL_FILES) {
  const target = await fs.resolve(f, { cwd: usedRoot })
  if (!await fs.stat(target)) throw new Error('loader: 缺少 ' + f)
  parts.push(await fs.readText(target))
}
console.log('loader: ' + usedRoot + ' <- ' + IMPL_FILES.join(' + '))
const impl = await (new Function('ctx', 'harness', 'console', 'return (async () => {\n' + parts.join('\n') + '\n})()'))(ctx, harness, console)
if (!impl || typeof impl.apply !== 'function') throw new Error('loader: 实现文件未返回插件对象')
return impl.apply(ctx)
