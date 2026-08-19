// ===== build/templates/package.json.mjs：原生 DSH 双端包 manifest =====
export const renderPackageJson = ({ packageName, version, description, bundleId }) => JSON.stringify({
  name: packageName,
  version,
  description,
  type: 'module',
  main: './lib/index.js',
  exports: {
    '.': './lib/index.js',
    './client': './lib/client.js',
    './remote': './lib/remote.js',
    './package.json': './package.json',
  },
  repository: {
    type: 'git',
    url: 'https://github.com/Iwctwbh/dsh-flowglass.git',
  },
  license: 'MIT',
  author: 'Iwctwbh',
  keywords: [...new Set(['deepseek-harness', 'dsh', 'plugin', 'toolbox'].concat(bundleId ? [bundleId] : []))],
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    client: {
      platform: 'web',
      inject: [
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-api-remotes',
        '@deepseek-ai/dsh-client-ui-layout',
        '@deepseek-ai/dsh-client-ui-sidebar',
      ],
    },
  },
  files: ['lib/**', 'manifest.json', 'BUILDINFO.json', 'cordis.patch.yml', 'README.md', 'LICENSE'],
  engines: { node: '>=22.19' },
  peerDependencies: {
    react: '^18.3.1',
  },
}, null, 2) + '\n'
