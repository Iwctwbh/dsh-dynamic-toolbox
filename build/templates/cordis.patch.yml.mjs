// ===== build/templates/cordis.patch.yml.mjs：DSH bundle patch 模板 =====
// 行 ID 由 bundle ID 生成（不能全部叫 toolbox-bootstrap）；name 为包名——bundle 安装进
// profile 的 node_modules 后，裸包名经 Node 父级查找从配置目录解析到包自身（exports "." → lib/index.js）。
export const renderCordisPatch = ({ bundleId, packageName }) => `# ${packageName} · 原生静态 Host/Client 工具箱 patch 层
- insert:
    - id: toolbox-bundle-${bundleId}
      name: '${packageName}'
`
