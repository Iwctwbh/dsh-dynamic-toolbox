// ===== build/templates/native-remote.mjs：原生 Client Remote contribution =====
export const renderNativeRemote = ({ packageName, profile, bridgeMethods }) => `// DSH 原生静态工具箱 Remote 描述（构建生成，勿手改）
// 工具箱协议本身在 Host registry.panel 做结构校验；Remote 载荷是 JSON-safe 通用对象。
const json = Object.freeze({ parse(value) { return value } })
const descriptor = (method, implementation) => ({
  id: ${JSON.stringify(packageName + '/remote')} + '#' + ${JSON.stringify(profile.remoteNamespace)} + '/' + method,
  service: ${JSON.stringify(profile.remoteService)},
  namespace: ${JSON.stringify(profile.remoteNamespace)},
  method,
  ...(implementation && implementation !== method ? { implementation } : {}),
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request', wire: 'request', source: 'json',
    codec: { mode: 'strict', typeSymbol: ${JSON.stringify(packageName + '#JsonRequest')}, schema: json },
  }],
  result: { mode: 'strict', typeSymbol: ${JSON.stringify(packageName + '#JsonResult')}, schema: json },
})

export default Object.freeze({
  package: ${JSON.stringify(packageName)},
  descriptors: Object.freeze([
    descriptor('tools'),
    descriptor('panel'),
    descriptor('plugins'),
    descriptor('sessionInfo'),
${bridgeMethods.map(({ method }) => `    descriptor(${JSON.stringify(method)}),`).join('\n')}
  ]),
})
`
