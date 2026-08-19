// ===== build/templates/README.md.mjs：生成包说明模板 =====
export const renderReadme = ({ packageName, version, bundleId, displayName, featureLines }) => `# ${displayName}（${packageName}）

由 dsh-dynamic-toolbox 构建的 **DSH 原生静态 Host/Client 插件**。

- bundleId: \`${bundleId}\`
- 版本: ${version}
- 动态批准: **不需要**（不使用 dynamicCordisRunner，不产生 dyn/*）
- 功能:
${featureLines}

## 安装 / 升级 / 卸载

\`\`\`powershell
npm pack
dsh plugin --profile web add <tgz>
# 重启 DSH 后由原生 Loader 直接挂载 Host 与 Client
dsh plugin --profile web remove ${packageName}
\`\`\`

升级时提高版本、重新 npm pack，然后对新 tgz 再执行 add 并重启 DSH。

## 运行结构

- \`lib/index.js\`：原生 Host 插件；
- \`lib/client.js\`：通过 package.json 的 \`dsh.client\` 和 \`exports["./client"]\` 原生加载；
- \`lib/remote.js\`：Host/Client Remote 描述；
- 不读取源码仓库的 loader.js / plugins.json / payload.json；
- 不调用 dynamicCordisRunner；
- 业务数据仍按工具约定写当前工作区的 \`.dsh-dynamic-toolbox/\`。
`
