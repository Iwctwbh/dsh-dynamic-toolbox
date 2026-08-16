# AI 助手整合设计：7 个 AI 工具合并为单插件

## 1. 总体结构

新插件 `plugins/aiassist/tool.js`，Host-only，`inject: ['fs','llm','agentDefaultModel','timer','subprocess']`（subprocess 仅 commitmsg 用，`ctx.get` 软依赖）。注册 1 个 Tab：`{ id:'ai', label:'AI 助手', order:11 }`。核心是一张 **PRESETS 表** + 一个通用 handler + 分段渲染函数。原 7 个插件目录删除；`toolbox-*.json` 各 preset 沿用原文件名，历史无缝保留。

## 2. PRESET 表（单一事实源）

```js
const PRESETS = [
 { id:'ask',       label:'问答',   mode:'single', input:'text',
   hint:'向所选模型直接提问', sys:()=>'', store:'toolbox-ask.json', cap:10 },
 { id:'translate', label:'翻译',   mode:'single', input:'text', hint:'要翻译的原文',
   params:[{key:'target',label:'目标语言',options:['简体中文','English','日本語','한국어','Français','Deutsch','Español','Русский']}],
   sys:p=>'你是翻译引擎，只输出'+p.target+'译文，保留格式，不加解释',
   store:'toolbox-translate.json', cap:10 },
 { id:'promptopt', label:'优化',   mode:'single', input:'text', hint:'提示词草稿',
   params:[{key:'style',label:'风格',options:['通用','代码','分析','创意']}],
   sys:p=>'将草稿改写为结构化'+p.style+'提示词，只输出改写结果',
   store:'toolbox-promptopt.json', cap:10 },
 { id:'review',    label:'评审',   mode:'single', input:'fileOrText', sys:()=>REVIEW_SYS,
   store:'toolbox-review.json', cap:5 },
 { id:'commitmsg', label:'提交信息', mode:'single', input:'gitsource', sys:()=>COMMIT_SYS,
   store:'toolbox-commitmsg.json', cap:5 },
 { id:'aisummary', label:'摘要',   mode:'single', input:'sessionlog', sys:()=>SUMMARY_SYS,
   store:'toolbox-aisummary.json', cap:5 },
 { id:'compare',   label:'对比',   mode:'multi', input:'text', hint:'同一问题发给所有已选模型',
   sys:()=>'', store:'toolbox-compare.json', cap:3 },
]
const PRESET_MAP = {}; for (const p of PRESETS) PRESET_MAP[p.id] = p
```

`sys` 收 params 返回 system prompt；长系统提示词提为模块级常量。`entry(q, r, p)` 可选，默认 `{ q, a:r.a, err, ms, out, route, t }`，translate 落盘键映射（src/dst/target）在写入前一次性转换，读取时不再兼容旧结构（旧文件结构本就一致，仅键名差异——迁移函数 `migrate(presetId, raw)` 集中处理）。

## 3. 状态与闭包

```js
// state（每次动作往返，保持轻量）：
{ preset, provider, model, picked:[], q, path, code, params:{target,style,extra},
  info, notice, history:[] }   // history 只装当前 preset
// 闭包（不进 state）：
let lastResults = null         // multi 结果本体（沿用 compare 模式）
let lastInput   = null         // gitsource diff / 会话日志采样本体
const paramMem  = {}           // presetId -> 上次 params，切回时恢复
```

## 4. inputMode 采集机制

```js
const collectInput = async (p, st, ws) => {   // -> { content, meta } | { error }
  switch (p.input) {
    case 'text':        return st.q.trim() ? { content: st.q.trim() } : { error:'请输入内容' }
    case 'fileOrText':  // path 优先：fs.resolve+readText 截 20000；否则 st.code（沿用 review 逻辑）
    case 'gitsource':   // scanGit(ws.root) 进 lastInput 闭包；meta={scope,chars,truncated}（沿用 commitmsg 的 runGit/scan）
    case 'sessionlog':  // sampleSessionLog(ws) 进 lastInput；meta={turns,chars}
  }
}
```

## 5. 渲染函数（HTML 字符串拼接，全 esc）

```
render(st, route, roll, ai) =
  renderPresetBar(st)            // preset 芯片行：PRESETS.map → tb-chip[on]，data-action="preset" data-p=id
+ (st.mode==='multi' ? renderPickRow(st) : ai.routeRow(st, route, note))  // 单模型路由行 / 多模型芯片选择
+ renderParams(p, st)            // params[].options → <select data-field="target|style">；gitsource 加 extra 输入
+ renderInput(p, st)             // text→textarea(q)；fileOrText→path input + code textarea；gitsource/sessionlog→扫描信息 banner + 「扫描」按钮
+ renderActions(p, st, ai)       // 主按钮 label=p.label；ai.available===false 时 disabled
+ (multi ? renderResults(lastResults) : renderHistory(st.history, p))   // 卡片沿用现有 tb-card/tb-rec-sub，含 copy 按钮
```

llm 缺失降级：`ai.available` 为 false 时路由行替换为 `tb-banner-error`「llm 服务不可用，仅可浏览历史」，发送按钮 disabled；preset 切换、历史读取（纯 fs）不受影响。`resolveRoute` 返回空 providers 时同理。

## 6. handler 动作分派（伪代码）

```js
const handler = async ({ action, fields, state, root, session }) => {
  const ws = resolveWorkspace(ctx, root, session)
  const st = state && typeof state==='object' ? state : { preset:'ask', provider:'', model:'', picked:[], q:'', params:{}, history:[] }
  syncFields(st, fields)                       // q/code/path/provider/model/target/style/extra
  const el = (fields && fields.__el) || {}
  const p = PRESET_MAP[st.preset] || PRESETS[0]

  if (action==='preset' && PRESET_MAP[el.p]) {
    paramMem[st.preset] = st.params            // 记住旧 preset 参数
    st.preset = el.p; st.params = paramMem[el.p] || {}
    st.history = migrate(el.p, await readJsonStore(ctx, REL(el.p), ws.root, []))  // 磁盘为准
    st.notice = null
  } else if (action==='route') { st.model='' }
  else if (action==='pick' && p.mode==='multi') { toggle(st.picked, el.r) }
  else if (action==='scan' && (p.input==='gitsource'||p.input==='sessionlog')) { st.info = await scanFor(p, ws) }
  else if (action==='clear') { st.history=[]; await writeJsonStore(ctx, REL(p), [], ws.root, ws.session) }
  else if (action==='copy') { out.copy = pickCopyText(st.history[el.i], p) }
  else if (action==='send') {
    if (!ai.available) st.notice='llm 服务不可用'
    else if (p.mode==='multi') {
      const items = await Promise.all(st.picked.map(r=>askOne(st.q.trim(), r, ws)))   // 沿用 compare
      lastResults = { q:st.q.trim(), t:Date.now(), items }
      await persistRound(p, lastResults, ws)     // 截 4000、cap 3
    } else {
      const inp = await collectInput(p, st, ws)
      if (inp.error) st.notice = inp.error
      else {
        await ai.resolveRoute(st)
        const user = buildUser(p, st, inp)       // 如 commitmsg 拼 extra+diff
        const r = await ai.chat(st, p.sys(st.params), user, undefined, { root:ws.root, session:ws.session, tool:p.id })
        st.history = [mkEntry(p, inp, r)].concat(st.history).slice(0, p.cap)
        st.notice = await writeJsonStore(...) ? null : '⚠ 历史未能写入'
      }
    }
  } else if (action==='') {                     // 打开 Tab
    st.history = migrate(p.id, await readJsonStore(ctx, REL(p), ws.root, []))
    if (p.mode==='multi' && !st.picked.length) st.picked = [await defaultRoute()]
  }
  const route = await ai.resolveRoute(st)
  const roll  = await ai.rollup(ws.root, p.id) // 用量台账 tool 用 preset id，原数据连续
  return { ok:true, html:render(st, route, roll, ai), state:st, ...(out||{}) }
}
```

## 7. 迁移要点

- `REL(p)` = `.dsh-dynamic-toolbox/toolbox-<store 名>`，沿用原文件名，历史不丢；`tool` 记账键用 preset id，与 `toolbox-ai-usage.json` 旧记录连续。
- 删除 `plugins/{ask,translate,promptopt,review,commitmsg,aisummary,compare}/`，`make-payloads.mjs` 清单同步移除并加入 `aiassist`。
- 全部逻辑为纯 JS 字符串拼接；无 Buffer/process；大本体（diff、对比结果）一律闭包持有，state 仅留索引与轻量字段。
