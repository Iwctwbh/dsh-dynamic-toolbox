# Flowglass（流镜 · `dsh-flowglass`）

> DeepSeek Harness 的实时会话流程图插件。把当前会话画成三列泳道，展示工具调用、并行分组与子代理分支，并支持逐层钻取。
>
> A live session flowgraph for DeepSeek Harness. MIT License.

![实时流镜 · 三列泳道 · 子代理分支 · 并行分组](docs/screenshot.png)

## 流镜能做什么

- **三列泳道**：中列是用户与助手主干，工具调用从右侧发出、从左侧返回。
- **子代理分支**：子会话在触发步骤旁展开自己的分支和执行进度。
- **逐层钻取**：进入任意子代理会话，并通过面包屑逐级返回。
- **并行分组**：同一步中的并行调用集中显示，运行中的节点持续高亮。
- **完整详情**：点击消息或工具卡查看完整内容、参数、结果、模型和 token 信息。
- **实时刷新**：默认每 2 秒静默刷新；页面不可见时暂停，回到页面后继续。

## 安装

```powershell
dsh plugin --profile web add dsh-flowglass
```

升级到指定版本后重启 DSH：

```powershell
dsh plugin --profile web add dsh-flowglass@<新版本>
```

卸载：

```powershell
dsh plugin --profile web remove dsh-flowglass
```

`dsh-flowglass` 是本仓库的默认产品和默认构建目标。它是原生静态 Host/Client 插件，不使用 `dynamicCordisRunner`，也不产生 `dyn/*`。

## 与 dsh-better-sidebar 集成

`dsh-better-sidebar` 是可选依赖：

- 已安装时，流镜注册为按会话隔离的原生「流镜」Tab；默认 `auto` 模式优先使用这个 Tab。
- 未安装、Tab 被禁用或选择「独立抽屉」时，流镜继续使用自带入口和抽屉。

可先安装侧边栏，再安装流镜：

```powershell
dsh plugin --profile web add dsh-better-sidebar
dsh plugin --profile web add dsh-flowglass
```

## 默认构建 Flowglass

不传功能参数，或显式传入 `--flow`，都会构建 `dsh-flowglass`：

```powershell
node scripts/build-toolbox-bundle.mjs --version 0.3.0 --clean
# 等价：node scripts/build-toolbox-bundle.mjs --flow --version 0.3.0 --clean

node scripts/verify-bundle.mjs dist/toolbox-bundles/flow --pack
Push-Location dist/toolbox-bundles/flow
npm pack
Pop-Location
```

默认输出目录为 `dist/toolbox-bundles/flow/`，默认 npm 包名为 `dsh-flowglass`。只有构建其他功能组合时，才使用 `dsh-<bundleId>-toolbox` 命名；仍可通过 `--name` 显式覆盖。

## 开发与验证

```powershell
node scripts/verify-generated.mjs
node scripts/verify-bundle.mjs flowglass --pack
node smoke.mjs
```

Flowglass 的静态产物位于 [`flowglass/`](flowglass/)，核心功能实现位于 [`plugins/flow/`](plugins/flow/)，共享界面框架位于 [`plugins/toolbox/`](plugins/toolbox/)。内部保留 `toolboxRegistry`、`toolbox.*` RPC 与 `.dsh-dynamic-toolbox/` 数据路径，以兼容现有框架和历史数据；这些内部名称不改变默认安装入口。

---

## 可选：完整 Toolbox

本仓库也能构建包含全部工具的次级产品 `dsh-dynamic-toolbox`；它与默认的 `dsh-flowglass` 相互独立。只有确实需要 Jira、Git、文件、HTTP、AI 助手等整套工具时才安装：

```powershell
dsh plugin --profile web add dsh-dynamic-toolbox
```

完整工具箱的重建、开发和历史说明单独维护：

- [`dynamic-toolbox/README.md`](dynamic-toolbox/README.md) — 完整工具箱包
- [`REBUILD.md`](REBUILD.md) — 动态工具箱重建与自举
- [`PLUGIN-DEV.md`](PLUGIN-DEV.md) — 工具箱插件开发
- [`插件.md`](插件.md) — 动态插件架构与经验记录

## License

[MIT](LICENSE) © 2026 Iwctwbh
