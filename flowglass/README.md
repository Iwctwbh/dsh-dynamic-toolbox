# 流镜（dsh-flowglass）

这是本仓库的默认产品与默认构建目标，是 **DSH 原生静态 Host/Client 插件**。

- bundleId: `flow`
- 版本: 0.3.0
- 动态批准: **不需要**（不使用 dynamicCordisRunner，不产生 dyn/*）
- 功能:
  - `flow` — 实时流镜 (Host-only)

## 安装 / 升级 / 卸载

```powershell
npm pack
dsh plugin --profile web add <tgz>
# 或已发布于 npm registry 时直接在线安装：
dsh plugin --profile web add dsh-flowglass
# 重启 DSH 后由原生 Loader 直接挂载 Host 与 Client
dsh plugin --profile web remove dsh-flowglass
```

升级时提高版本、重新构建发布，然后对新版本再执行 add 并重启 DSH。

## 运行结构

- `lib/index.js`：原生 Host 插件；
- `lib/client.js`：通过 package.json 的 `dsh.client` 和 `exports["./client"]` 原生加载；
- `lib/remote.js`：Host/Client Remote 描述；
- 不读取源码仓库的 loader.js / plugins.json / payload.json；
- 不调用 dynamicCordisRunner；
- 业务数据仍按工具约定写当前工作区的 `.dsh-dynamic-toolbox/`。
