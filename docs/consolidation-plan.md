# 工具箱整合优化方案（联合 MiMo-V2.5 / Qwen3.8-MAX / Kimi K3 调研）

> 目标：解决「功能突兀（UUID 生成等零散 Tab）」「插件文件过多（29 个文件夹）」，
> 并基于 dsh-plugin 生态调研补充真正高频的工具能力。模型分工：
> MiMo-V2.5 出 AI 工具合一设计（见 docs/ai-assistant-merge-design.md，本方案沿用其核心），
> Qwen3.8-MAX 出文件整合分组建议，Kimi K3 两次子代理论坛失败（web_search 在其环境不可用），
> 生态调研由主 agent 完成（见第 4 节）。

## 1. 现状问题

| 问题 | 具体表现 |
| --- | --- |
| 功能突兀 | gen（UUID/随机串/哈希）、codec、regex、cron、txtdiff 各占一个 Tab，都是小工具却分散 |
| 文件过多 | 29 个插件文件夹 × 3 文件（plugin.json/payload.json/tool.js）；每个 Host-only 插件一个 Cordis 插件实例 |
| AI 工具重复 | ask/translate/promptopt/review/commitmsg/aisummary/compare 7 个插件结构几乎一样（routeRow + textarea + chat + 历史落盘），只差 system prompt 和输入形态 |

## 2. 整合方案（定稿）

### 2.1 AI 助手合一（plugins/aiassist/tool.js，用户点名）

7 个 AI 生成工具 → 单插件单 Tab「AI 助手」，一张 PRESETS 表 + 通用 handler：

| preset | label | mode | input | 参数 | 落盘 | cap |
| --- | --- | --- | --- | --- | --- | --- |
| ask | 问答 | single | text | — | toolbox-ask.json | 10 |
| translate | 翻译 | single | text | target（8 语言） | toolbox-translate.json | 10 |
| promptopt | 优化 | single | text | style（4 风格） | toolbox-promptopt.json | 10 |
| review | 评审 | single | fileOrText | — | toolbox-review.json | 5 |
| commitmsg | 提交信息 | single | gitsource | extra 补充说明 | toolbox-commitmsg.json | 5 |
| aisummary | 摘要 | single | sessionlog | — | toolbox-aisummary.json | 1 |
| compare | 对比 | multi | text | 模型芯片多选 | toolbox-compare.json | 3 |

- **无缝迁移**：沿用原 `toolbox-*.json` 落盘文件与 preset id 作台账 tool 键，历史与用量统计连续。
- **多模型并发**：compare 保留 provider+模型芯片选择与 `Promise.all` 并发，结果本体留闭包。
- **输入源机制**：`collectInput()` 按 `input: text|fileOrText|gitsource|sessionlog` 分派；diff/日志等大本体进闭包不进 state。
- **降级**：`ai.available===false` 时路由行换错误 banner、禁用发送；preset 切换与磁盘历史浏览不受影响。

### 2.2 计算台合一（plugins/calc/tool.js，解决"突兀"+文件过多）

5 个纯计算/纯 JS 小工具 → 单插件单 Tab「计算」，内部子模式芯片切换：

| 子模式 | 原插件 | 能力 | 依赖 |
| --- | --- | --- | --- |
| codec | codec | Base64/URL 编解码、JSON 美化/压缩、时间戳互转 | 无 |
| regex | regex | 正则匹配测试（flags/捕获分组/200 条上限） | 无 |
| cron | cron | 5 段 cron 解析 + 未来 8 次运行时刻 + 预设 | 无 |
| txtdiff | txtdiff | 行级 LCS 文本对比（增删行高亮/折叠） | 无 |
| gen | gen | UUID v4 批量 / CSPRNG 随机串 / 哈希摘要 | subprocess（真 crypto） |

各子模式状态独立子化（`st.sub.codec / st.sub.regex / ...`），大结果（diff/生成列表）留闭包。

### 2.3 保留独立（8 个）

- **框架/需要 Client 半**：toolbox、selfview、theme-teal、theme-amber（架构职责不同，不动）
- **业务重量级**：jira、git、http、ports（各有独立动作机与复杂面板，合并收益低、崩一个全没的风险高）
- **台账查看**：aiusage（职责独立：读 .dsh-dynamic-toolbox/toolbox-ai-usage.json 聚合显示）
- **会话类**：trace/usage/search/context/prompt/lineage/tools 暂缓合并（探针评估：各自 UI 重、信息密度不同，先做收益最高的 AI+计算两个包；保留原样降低回归风险）

合并后插件数：29 → 22（-7 AI 插件 +1 aiassist；-4 计算插件 +1 calc）。

## 3. PLUGINS 表改造

`make-payloads.mjs` 的 PLUGINS 表结构不变（一条 = 一个 Cordis 插件 = 一个 payload.json），
只是：
- 删 7 行 AI 插件（ask/translate/promptopt/review/commitmsg/aisummary/compare），加 1 行 aiassist
- 删 5 行计算插件（codec/regex/cron/txtdiff/gen），加 1 行 calc
- 删除对应 plugins/<key>/ 目录（git 历史保留，仓库瘦身）
- toolbox/client.js 的 DEFAULT_CAT：ai 分类加 aiassist、calc 归 dev；删旧 id 映射

## 4. 生态调研（dsh-plugin）与新增功能候选

调研来源：[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)、
[dsh-plugin-hub](https://github.com/Noob-stupid/dsh-plugin-hub)（一键启停 + GitHub 插件市场）、
[dsh-plugin-cc](https://github.com/cpj-dev/dsh-plugin-cc)（桥接 Claude Code）、
[awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness)、本机已装的 dsh-web-ui 全家桶（ssh/task-board/aionui-panel）。

生态共识的高频功能 → 本项目候选（限 Host-only 纯逻辑，不扩 Client 批准面）：
1. **临时 CodeBox / 沙箱执行** → 已有 selfview 界面操作；代码执行属危险面，暂不做
2. **Markdown/表格工具**（CSV↔表格、markdown 表格生成）→ 轻量纯 JS，可并入 calc 作为子模式
3. **JSON 工具**（现在的 codec 只有美化/压缩，缺 JSONPath 查询/遍历）→ 纯 JS，可并入 calc
4. **URL 工具**（解析 query/拼参数/解码）→ 并入 calc 的 codec 子模式
5. **备忘录/剪贴板历史** → 需 Client（localStorage），与抽屉架构不符，跳过

本轮先完成 2.1/2.2 整合（结构优化是主线）；新增功能（2-4）并入 calc 子模式表，随 calc 一起落地，不再新增插件文件夹。

## 5. 验收与提交

- 分步提交：① 设计文档 → ② aiassist → ③ calc → ④ 清单/分类/冒烟 → ⑤ REBUILD.md/PLUGIN-DEV.md 文档同步
- 每次 `node make-payloads.mjs`（语法检查）+ `node smoke.mjs`（契约冒烟）
- 本地分支 feat/consolidate，不 push