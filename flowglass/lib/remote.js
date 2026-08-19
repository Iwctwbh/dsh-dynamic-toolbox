// DSH 原生静态工具箱 Remote 描述（构建生成，勿手改）
// 工具箱协议本身在 Host registry.panel 做结构校验；Remote 载荷是 JSON-safe 通用对象。
const json = Object.freeze({ parse(value) { return value } })
const descriptor = (method, implementation) => ({
  id: "dsh-flowglass/remote" + '#' + "toolboxNativeFlow" + '/' + method,
  service: "toolboxNativeFlow",
  namespace: "toolboxNativeFlow",
  method,
  ...(implementation && implementation !== method ? { implementation } : {}),
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request', wire: 'request', source: 'json',
    codec: { mode: 'strict', typeSymbol: "dsh-flowglass#JsonRequest", schema: json },
  }],
  result: { mode: 'strict', typeSymbol: "dsh-flowglass#JsonResult", schema: json },
})

export default Object.freeze({
  package: "dsh-flowglass",
  descriptors: Object.freeze([
    descriptor('tools'),
    descriptor('panel'),
    descriptor('plugins'),
    descriptor('sessionInfo'),
  ]),
})
