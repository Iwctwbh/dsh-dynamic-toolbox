// ===== jira-tool.js：Jira 工具（Host-only，HTML 面板经工具箱 RPC 渲染）=====
// 复用 host.js 的凭据/子进程/记录持久化逻辑；交互语义同原 client.js
// 归档规范（参考 prompt/Jira.md）：查询成功即自动归档 → .dsh-dynamic-toolbox/data/jira/{key}/ 下写 issue.md
// （人类可读：字段表+描述+附件清单）+ issue.json（面板离线查看的机读副本）+ 下载全部附件；
// 点击记录 = 读本地归档（零 API），行尾「刷新」才重新打 API 并覆盖归档。
// 工单本体（description/附件清单）与预览图（base64，可 MB 级）留闭包 lastIssue/lastPreview——
// 不进 state（state 每次动作来回传输，必须轻量）；重跑后面板按重新查询降级。
// 状态：{ input, records, error, info }

const FETCH_SCRIPT = `
const base = (process.env.JIRA_BASE_URL || '').replace(/\\/+$/, '');
const email = process.env.JIRA_EMAIL || '';
const token = process.env.JIRA_TOKEN || '';
const auth = 'Basic ' + Buffer.from(email + ':' + token).toString('base64');
const FIELDS = 'summary,description,status,priority,issuetype,key,created,updated,attachment,assignee,reporter';
function adfText(node) {
  if (!node) return '';
  if (node.type === 'hardBreak') return '\\n';
  let text = node.text || '';
  if (Array.isArray(node.content)) for (const c of node.content) text += adfText(c);
  if (['paragraph','heading','codeBlock','listItem'].includes(node.type)) text += '\\n';
  return text;
}
(async () => {
  const out = { ok: false, issue: null, error: null };
  try {
    if (!email || !token) { out.error = 'JIRA_EMAIL or JIRA_TOKEN is not configured'; console.log(JSON.stringify(out)); return; }
    const key = process.env.JIRA_ISSUE_KEY || '';
    if (!key) { out.error = 'missing issue key'; console.log(JSON.stringify(out)); return; }
    const url = base + '/rest/api/3/issue/' + encodeURIComponent(key) + '?fields=' + encodeURIComponent(FIELDS);
    const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) { out.error = 'Jira API ' + res.status; console.log(JSON.stringify(out)); return; }
    const data = await res.json();
    const f = data.fields || {};
    const person = (p) => (p && p.displayName) || null;
    out.issue = {
      key: data.key, id: data.id,
      summary: f.summary || null,
      status: f.status && f.status.name || null,
      priority: f.priority && f.priority.name || null,
      issuetype: f.issuetype && f.issuetype.name || null,
      assignee: person(f.assignee), reporter: person(f.reporter),
      created: f.created || null, updated: f.updated || null,
      description: (adfText(f.description) || '').trim(),
      attachments: (f.attachment || []).slice(0, 100).map((a) => ({
        filename: a.filename, size: a.size, author: person(a.author), content: a.content,
      })),
    };
    out.ok = true;
  } catch (e) { out.error = String((e && e.message) || e); }
  console.log(JSON.stringify(out));
})()
`

const ATTACH_SCRIPT = `
const fs = require('fs');
const path = require('path');
const base = (process.env.JIRA_BASE_URL || '').replace(/\\/+$/, '');
const email = process.env.JIRA_EMAIL || '';
const token = process.env.JIRA_TOKEN || '';
const auth = 'Basic ' + Buffer.from(email + ':' + token).toString('base64');
(async () => {
  try {
    const url = process.env.JIRA_ATTACH_URL || '';
    const key = process.env.JIRA_ISSUE_KEY || '';
    const fname = process.env.JIRA_ATTACH_NAME || 'attachment';
    const root = process.env.JIRA_ARCHIVE_ROOT || '.dsh-dynamic-toolbox/data/jira';
    if (!email || !token) { console.log('ERR|JIRA_EMAIL or JIRA_TOKEN is not configured'); return; }
    if (!url.startsWith(base)) { console.log('ERR|attachment url not allowed'); return; }
    const safe = String(fname).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'attachment';
    const dir = path.join(root, key);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, safe);
    const res = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(120000) });
    if (!res.ok) { console.log('ERR|HTTP ' + res.status); return; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) { console.log('ERR|attachment too large'); return; }
    fs.writeFileSync(out, buf);
    console.log('OK|' + out);
    console.log('LEN|' + buf.length);
    if (buf.length <= 5 * 1024 * 1024) console.log('B64|' + buf.toString('base64'));
  } catch (e) { console.log('ERR|' + String((e && e.message) || e)); }
})()
`

// 一键归档脚本：读 .dsh-dynamic-toolbox/jira-issue-in.json（fetchAndArchive 先落盘，规避 Windows 环境变量长度限制），
// 创建 Jira-Issue/{key}/ → 下载全部附件（覆盖同名）→ 写 issue.md（模板参考 prompt/Jira.md）→ 写 issue.json 机读副本
const ARCHIVE_SCRIPT = `
const fs = require('fs');
const path = require('path');
const base = (process.env.JIRA_BASE_URL || '').replace(/\\/+$/, '');
const email = process.env.JIRA_EMAIL || '';
const token = process.env.JIRA_TOKEN || '';
const auth = 'Basic ' + Buffer.from(email + ':' + token).toString('base64');
const cell = (v) => String(v == null || v === '' ? '—' : v).split('|').join('｜').split('\\r\\n').join(' ').split('\\n').join(' ');
const fmtSz = (n) => (n == null || isNaN(Number(n)) ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
(async () => {
  const out = { ok: false, dir: '', archivedAt: '', files: [], errors: [] };
  try {
    const inFile = process.env.JIRA_ISSUE_FILE || '';
    const issue = JSON.parse(fs.readFileSync(inFile, 'utf8'));
    try { fs.unlinkSync(inFile) } catch (e) {}
    const key = String(issue.key || '');
    if (!key) { out.error = 'missing issue key'; console.log(JSON.stringify(out)); return; }
    const root = process.env.JIRA_ARCHIVE_ROOT || '.dsh-dynamic-toolbox/data/jira';
    const dir = path.join(root, key);
    fs.mkdirSync(dir, { recursive: true });
    const atts = Array.isArray(issue.attachments) ? issue.attachments : [];
    for (const a of atts) {
      const fname = String(a.filename || 'attachment').replace(/[\\\\/:*?"<>|]/g, '_').trim() || 'attachment';
      const rec = { filename: a.filename || fname, size: a.size != null ? a.size : null, author: a.author || null, content: a.content || null, path: key + '/' + fname, downloaded: false, error: null };
      try {
        const url = String(a.content || '');
        if (!url.startsWith(base)) throw new Error('附件地址不被允许');
        const res = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(120000) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 20 * 1024 * 1024) throw new Error('附件超过 20MB 上限');
        fs.writeFileSync(path.join(dir, fname), buf);
        rec.size = buf.length;
        rec.downloaded = true;
      } catch (e) { rec.error = String((e && e.message) || e); out.errors.push((a.filename || fname) + ': ' + rec.error); }
      out.files.push(rec);
    }
    out.archivedAt = new Date().toISOString();
    const L = [];
    L.push('# ' + key + ': ' + (issue.summary || '(无标题)'));
    L.push('');
    L.push('| 字段 | 值 |');
    L.push('|------|-----|');
    L.push('| Key | ' + cell(issue.key) + ' |');
    L.push('| ID | ' + cell(issue.id) + ' |');
    L.push('| Type | ' + cell(issue.issuetype) + ' |');
    L.push('| Status | ' + cell(issue.status) + ' |');
    L.push('| Priority | ' + cell(issue.priority) + ' |');
    L.push('| Assignee | ' + cell(issue.assignee) + ' |');
    L.push('| Reporter | ' + cell(issue.reporter) + ' |');
    L.push('| Created | ' + cell(issue.created) + ' |');
    L.push('| Updated | ' + cell(issue.updated) + ' |');
    L.push('');
    L.push('## 描述');
    L.push('');
    L.push(issue.description ? String(issue.description) : '（无描述）');
    L.push('');
    L.push('## 附件清单');
    L.push('');
    if (out.files.length) {
      L.push('| 文件名 | 大小 | 上传者 | 下载路径 |');
      L.push('|--------|------|--------|----------|');
      for (const f of out.files) L.push('| ' + cell(f.filename) + ' | ' + fmtSz(f.size) + ' | ' + cell(f.author) + ' | ./' + cell(f.path.split('/').pop()) + ' |');
    } else {
      L.push('（无附件）');
    }
    L.push('');
    L.push('> 归档时间：' + out.archivedAt + (out.errors.length ? '；部分附件失败：' + out.errors.join('；') : ''));
    fs.writeFileSync(path.join(dir, 'issue.md'), L.join('\\n'));
    fs.writeFileSync(path.join(dir, 'issue.json'), JSON.stringify(Object.assign({}, issue, { archivedAt: out.archivedAt, attachments: out.files }), null, 2));
    out.dir = (root + '/' + key).split('\\\\').join('/');
    out.ok = true;
  } catch (e) { out.error = String((e && e.message) || e); }
  console.log(JSON.stringify(out));
})()
`

// 本地附件预览：只允许读 <cwd>/Jira-Issue/ 下的文件（防路径逃逸），≤5MB 转 base64
const LOCAL_B64_SCRIPT = `
const fs = require('fs');
const path = require('path');
(async () => {
  try {
    const root = path.resolve(process.env.JIRA_ARCHIVE_ROOT || '.dsh-dynamic-toolbox/data/jira');
    const target = path.resolve(root, String(process.env.JIRA_LOCAL_FILE || ''));
    if (target.indexOf(root + path.sep) !== 0) { console.log('ERR|非法路径'); return; }
    const buf = fs.readFileSync(target);
    if (buf.length > 5 * 1024 * 1024) { console.log('ERR|文件较大，暂不支持网页预览'); return; }
    console.log('B64|' + buf.toString('base64'));
  } catch (e) { console.log('ERR|' + String((e && e.message) || e)); }
})()
`

const REL_DATA_DIR = '.dsh-dynamic-toolbox'
const REL_WATCH_FILE = '.dsh-dynamic-toolbox\\jira-watch.json'
const REL_ARCHIVE_DIR = pluginDataDir('jira') // .dsh-dynamic-toolbox/data/jira（shared 约定：内容产物目录）

return {
  name: 'jira-tool',
  inject: ['credentials', 'subprocess', 'timer'],
  apply(ctx) {
    const fsService = ctx.get('fs')
    const subprocess = ctx.get('subprocess')
    let lastIssue = null // 工单本体（闭包持有，不进 state）
    let lastPreview = null // 预览图 { name, data(base64) }（闭包持有，不进 state）

    // sessionId 优先：拿到当前会话 → root 与 session 同时确定（写入策略需要 session 才能按会话 cwd 授权）
    const resolveWs = (rootArg, sessionId) => {
      const sessionsSvc = ctx.get('sessions')
      if (sessionId && sessionsSvc) {
        try {
          const s = sessionsSvc.get(sessionId)
          const cwd = s && s.header && s.header.cwd
          if (s && typeof cwd === 'string' && cwd) return { root: cwd.replace(/[\\/]+$/, ''), session: s }
        } catch (e) {}
      }
      if (rootArg && /^([A-Za-z]:[\\/]|\/)/.test(rootArg)) {
        return { root: rootArg.replace(/[\\/]+$/, ''), session: null }
      }
      if (sessionsSvc) {
        try {
          let hit = null
          for (const s of sessionsSvc.list()) {
            const cwd = s && s.header && s.header.cwd
            if (typeof cwd === 'string' && cwd) hit = s
          }
          if (hit) return { root: hit.header.cwd.replace(/[\\/]+$/, ''), session: hit }
        } catch (e) {}
      }
      const sp = ctx.get('sandboxPolicy')
      const root = sp && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot.replace(/[\\/]+$/, '') : ''
      return { root, session: null }
    }

    const resolveCred = async (ref) => {
      const r = await ctx.credentials.resolve(ref)
      return r ? r.value : undefined
    }
    // ===== 凭据设置（面板内配置，写入 credentials 服务的可写层 —— 与 Harness 设置的 API Key 同机制同存储）=====
    // 三键：JIRA_BASE_URL / JIRA_EMAIL / JIRA_TOKEN。describe 只暴露配置状态与来源、不暴露值；
    // set 拒绝空值（清空走 unset），被只读来源（真实环境变量）遮蔽时 set/unset 会拒绝。
    // 安全约定：输入框永远渲染空值、密文绝不进 state / HTML，每次动作后由 describe 刷新状态。
    const CRED_ROWS = [
      ['JIRA_BASE_URL', 'Base URL', 'credUrl', 'text', '如 https://your-team.atlassian.net'],
      ['JIRA_EMAIL', '邮箱', 'credEmail', 'text', '如 you@example.com'],
      ['JIRA_TOKEN', 'API Token', 'credToken', 'password', 'Atlassian API Token'],
    ]
    const describeCred = async (ref) => {
      try {
        const info = await ctx.credentials.describe(ref)
        if (!info || typeof info !== 'object') return null
        const src = info.source
        return {
          configured: Boolean(info.configured),
          source: typeof src === 'string' ? src : (src && (src.id || src.kind || src.label)) || '',
          writable: info.writable !== false,
        }
      } catch (e) { return null }
    }
    const describeAllCreds = async () => {
      const out = {}
      for (const row of CRED_ROWS) out[row[0]] = await describeCred(row[0])
      return out
    }
    const renderCredSettings = (st) => {
      if (!st.credOpen) return ''
      const info = st.credInfo || {}
      const rows = CRED_ROWS.map(([ref, label, field, type, ph]) => {
        const d = info[ref]
        const pill = d == null
          ? '<span class="tb-pill tb-pill-plain">状态未知</span>'
          : d.configured
            ? '<span class="tb-pill tb-pill-done">已配置' + (d.source ? ' · ' + esc(d.source) : '') + '</span>'
            : '<span class="tb-pill tb-pill-todo">未配置</span>'
        const roHint = d && d.configured && d.writable === false
          ? '<span class="tb-note">被只读来源（环境变量）遮蔽，需在系统环境中修改</span>' : ''
        return '<div class="tb-sec"><span class="tb-sec-label">' + esc(label) + '（' + esc(ref) + '）' + pill + '</span>' +
          '<input class="tb-input tb-mono" type="' + type + '" data-field="' + field + '" value="" placeholder="' + esc(ph) + '（留空保持不变）" autocomplete="off">' +
          roHint + '</div>'
      })
      return '<div class="tb-card">' +
        '<div class="tb-sec-label">Jira 凭据 · 保存到 Harness 凭据存储（与设置的 API Key 同机制，立即生效）</div>' +
        rows.join('') +
        '<div class="tb-row">' +
          '<button type="button" class="tb-btn tb-btn-primary" data-action="save-cred">保存凭据</button>' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-danger-ghost" data-action="clear-cred">清除全部</button>' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="toggle-cred">收起</button>' +
        '</div></div>'
    }
    const baseEnv = async () => {
      const [base, email, token] = await Promise.all([
        resolveCred('JIRA_BASE_URL'),
        resolveCred('JIRA_EMAIL'),
        resolveCred('JIRA_TOKEN'),
      ])
      return {
        JIRA_BASE_URL: base || 'https://your-team.atlassian.net',
        JIRA_EMAIL: email || '',
        JIRA_TOKEN: token || '',
      }
    }
    const runNode = async (script, env, wsRoot) => {
      if (!subprocess) return { ok: false, error: 'subprocess 服务不可用' }
      const handle = subprocess.spawn({
        argv: ['node', '-'],
        cwd: wsRoot,
        stdio: {
          stdin: { data: script },
          stdout: { maxBytes: 8 * 1024 * 1024 },
          stderr: { maxBytes: 256 * 1024 },
        },
        graceMs: 120000,
        env,
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout.readFrom(0).text
      const stderr = handle.collected.stderr.readFrom(0).text
      if (outcome.exitCode !== 0) return { ok: false, error: (stderr || stdout).slice(0, 500) }
      return { ok: true, stdout }
    }

    const ensureDirPromises = {}
    const ensureDataDir = (wsRoot) => {
      const existing = ensureDirPromises[wsRoot]
      if (existing) return existing
      const p = (async () => {
        if (!subprocess) return
        try {
          const handle = subprocess.spawn({
            argv: ['node', '-e', "require('fs').mkdirSync(process.argv[1], { recursive: true })", REL_DATA_DIR],
            cwd: wsRoot,
            stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
            graceMs: 30000,
          })
          await handle.done
        } catch (e) {}
      })()
      ensureDirPromises[wsRoot] = p
      return p
    }

    const readJsonFile = async (rel, wsRoot) => {
      if (!fsService) return []
      try {
        const target = await fsService.resolve(rel, { cwd: wsRoot })
        const info = await fsService.stat(target)
        if (!info) return []
        const parsed = JSON.parse(await fsService.readText(target))
        return Array.isArray(parsed) ? parsed : []
      } catch (e) { return [] }
    }
    const writeJsonFile = async (rel, data, ws) => {
      if (!fsService) return false
      try {
        await ensureDataDir(ws.root)
        const target = await fsService.resolve(rel, { cwd: ws.root })
        // 有会话 → 按会话策略（cwd 即工作区边界）；无会话 → 显式以工具工作区为可写根
        // （缺省会回落到部署默认策略，其 root 是宿主进程 cwd，写不进 D:\prompt 会被 FS_SANDBOX_DENIED 静默吞掉）
        const sp = ctx.get('sandboxPolicy')
        const policy = sp && ws.session ? sp.resolve({ session: ws.session }) : { mode: 'workspace-write', workspaceRoot: ws.root }
        await fsService.writeText(target, JSON.stringify(data, null, 2), undefined, undefined, policy)
        return true
      } catch (e) {
        console.error('jira/records 持久化失败:', String((e && e.message) || e))
        return false
      }
    }


    const fmtDate = (iso) => {
      if (!iso) return '—'
      const d = new Date(iso)
      if (isNaN(d.getTime())) return esc(iso)
      return esc(d.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }))
    }
    const getTimeAgo = (iso) => {
      if (!iso) return '未知时间'
      const d = new Date(iso)
      if (isNaN(d.getTime())) return '未知时间'
      const now = new Date()
      const diffMs = now - d
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)
      if (diffMins < 1) return '刚刚'
      if (diffMins < 60) return diffMins + ' 分钟前'
      if (diffHours < 24) return diffHours + ' 小时前'
      if (diffDays < 30) return diffDays + ' 天前'
      return fmtDate(iso)
    }
    const mimeFor = (name) => {
      const n = String(name || '').toLowerCase()
      if (n.indexOf('.png') > -1) return 'image/png'
      if (n.indexOf('.jpg') > -1 || n.indexOf('.jpeg') > -1) return 'image/jpeg'
      if (n.indexOf('.gif') > -1) return 'image/gif'
      if (n.indexOf('.webp') > -1) return 'image/webp'
      if (n.indexOf('.bmp') > -1) return 'image/bmp'
      return 'image/png'
    }
    // 状态 → pill 色调：进行中=蓝、完成=绿、待办=灰、其他=黄
    const statusTone = (s) => {
      const v = String(s || '').toLowerCase()
      if (/完成|已完成|done|closed|resolved|解决|关闭/.test(v)) return 'done'
      if (/进行|progress|开发|处理中|review|评审|测试/.test(v)) return 'active'
      if (/待办|todo|to do|open|新建|未开始|backlog/.test(v)) return 'todo'
      return 'other'
    }

    const fetchIssue = async (key, ws) => {
      const env = await baseEnv()
      env.JIRA_ISSUE_KEY = key
      const res = await runNode(FETCH_SCRIPT, env, ws.root)
      if (!res.ok) return { ok: false, error: res.error }
      return JSON.parse(res.stdout)
    }
    const downloadAttachment = async (url, key, filename, ws) => {
      const env = await baseEnv()
      env.JIRA_ATTACH_URL = url
      env.JIRA_ISSUE_KEY = key
      env.JIRA_ATTACH_NAME = filename
      env.JIRA_ARCHIVE_ROOT = REL_ARCHIVE_DIR
      const res = await runNode(ATTACH_SCRIPT, env, ws.root)
      if (!res.ok) return res
      let path = ''
      let len = 0
      let b64 = ''
      for (const line of res.stdout.split(/\r?\n/)) {
        if (line.indexOf('OK|') === 0) path = line.slice(3).trim()
        else if (line.indexOf('LEN|') === 0) len = Number(line.slice(4)) || 0
        else if (line.indexOf('B64|') === 0) b64 = line.slice(4)
        else if (line.indexOf('ERR|') === 0) return { ok: false, error: line.slice(4) }
      }
      if (!path) return { ok: false, error: '附件归档失败' }
      if (!/^[A-Za-z]:[\\/]/.test(path) && path.charAt(0) !== '/') path = ws.root + '\\' + path
      return { ok: true, path, len, previewable: b64.length > 0, data: b64 || null }
    }

    // ---- 归档（prompt/Jira.md 规范）：Jira-Issue/{key}/ = issue.md + issue.json + 全部附件 ----
    // issue.json 是面板离线查看的机读副本；issue.md 是人类可读摘要（字段表+描述+附件清单）
    const archiveIssue = async (issue, ws) => {
      const inRel = '.dsh-dynamic-toolbox\\jira-issue-in.json'
      if (!await writeJsonFile(inRel, issue, ws)) return { ok: false, error: '临时文件写入失败' }
      const env = await baseEnv()
      env.JIRA_ISSUE_FILE = inRel
      env.JIRA_ARCHIVE_ROOT = REL_ARCHIVE_DIR
      const res = await runNode(ARCHIVE_SCRIPT, env, ws.root)
      if (!res.ok) return { ok: false, error: res.error }
      try { return JSON.parse(res.stdout) } catch (e) { return { ok: false, error: '归档结果解析失败' } }
    }
    // 读本地归档（零 API）；无归档返回 null
    const loadArchive = async (key, ws) => {
      if (!fsService) return null
      try {
        const target = await fsService.resolve(REL_ARCHIVE_DIR + '/' + key + '/issue.json', { cwd: ws.root })
        if (!await fsService.stat(target)) return null
        const data = JSON.parse(await fsService.readText(target))
        if (!data || typeof data !== 'object' || !data.key) return null
        return data
      } catch (e) { return null }
    }
    // 归档模式下补下载成功的附件 → 回写 issue.json 对应条目
    const updateArchiveEntry = async (key, filename, size, ws) => {
      const data = await loadArchive(key, ws)
      if (!data || !Array.isArray(data.attachments)) return
      for (const a of data.attachments) {
        if (a && a.filename === filename) { a.downloaded = true; a.error = null; if (size) a.size = size }
      }
      await writeJsonFile(REL_ARCHIVE_DIR + '/' + key + '/issue.json', data, ws)
    }
    // 本地附件预览（base64，≤5MB；LOCAL_B64_SCRIPT 限定 Jira-Issue/ 内）
    const previewLocalFile = async (relPath, ws) => {
      const res = await runNode(LOCAL_B64_SCRIPT, { JIRA_ARCHIVE_ROOT: REL_ARCHIVE_DIR, JIRA_LOCAL_FILE: relPath }, ws.root)
      if (!res.ok) return { ok: false, error: res.error }
      for (const line of res.stdout.split(/\r?\n/)) {
        if (line.indexOf('B64|') === 0) return { ok: true, data: line.slice(4) }
        if (line.indexOf('ERR|') === 0) return { ok: false, error: line.slice(4) }
      }
      return { ok: false, error: '预览读取失败' }
    }
    // 查询 + 自动归档 + 记录落盘（query / view-record 兜底 / refresh-record / refresh-all 共用）
    const fetchAndArchive = async (k, st, ws, opts) => {
      const setView = !opts || opts.setView !== false
      const res = await fetchIssue(k, ws)
      if (!res.ok) return { ok: false, error: res.error }
      const ar = await archiveIssue(res.issue, ws)
      const old = (st.records || []).find((x) => x && x.key === res.issue.key)
      const rec = {
        key: res.issue.key, summary: res.issue.summary, status: res.issue.status, updated: res.issue.updated,
        fetchedAt: new Date().toISOString(),
        archivedAt: (ar.ok && ar.archivedAt) || (old && old.archivedAt) || null,
      }
      const r2 = await runRecords('upsert', rec, ws)
      if (r2.ok) {
        st.records = r2.records
        if (r2.persisted === false) st.info = '⚠ 记录未能写入 .dsh-dynamic-toolbox/jira-watch.json，仅保存在面板内存中'
      }
      if (setView) {
        lastIssue = ar.ok
          ? Object.assign({}, res.issue, { __archived: true, archivedAt: ar.archivedAt, attachments: ar.files })
          : res.issue
        if (ar.ok) {
          const fails = (ar.files || []).filter((f) => !f.downloaded)
          st.info = '已归档 → ' + REL_ARCHIVE_DIR + '/' + res.issue.key + '/（附件 ' + ((ar.files || []).length - fails.length) + '/' + (ar.files || []).length + '）' +
            (fails.length ? '；失败：' + fails.map((f) => f.filename).join('、') : '')
        } else {
          st.info = '⚠ 查询成功但归档失败：' + (ar.error || '未知原因') + '（仅本次内存展示）'
        }
      }
      return { ok: true, archived: Boolean(ar.ok) }
    }

    const render = (st, busy) => {
      const parts = []
      parts.push('<div class="tb-query">' +
        '<input class="tb-input" data-field="key" placeholder="输入 Jira ID，如 PROJ-123" value="' + esc(st.input || '') + '" />' +
        '<button type="button" class="tb-btn tb-btn-primary" data-action="query"' + (busy ? ' disabled' : '') + '>' + (busy ? '查询中…' : '查询') + '</button>' +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="toggle-cred">' + (st.credOpen ? '收起设置' : '凭据设置') + '</button>' +
      '</div>')
      parts.push(renderCredSettings(st))
      if (st.error) parts.push('<div class="tb-banner tb-banner-error">' + esc(st.error) + '</div>')
      if (st.info) parts.push('<div class="tb-banner tb-banner-info">' + esc(st.info) + '</div>')
      if (lastIssue) {
        const i = lastIssue
        const it = []
        it.push('<div class="tb-card-head">' +
          '<span class="tb-key">' + esc(i.key) + '</span>' +
          '<div class="tb-title">' + esc(i.summary || '(无标题)') + '</div>' +
          '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close-issue" title="关闭详情（记录保留在列表中）" style="margin-left:auto">关闭</button>' +
        '</div>')
        const pills = []
        if (i.status) pills.push('<span class="tb-pill tb-pill-' + statusTone(i.status) + '"><span class="tb-dot tb-dot-' + statusTone(i.status) + '"></span>' + esc(i.status) + '</span>')
        if (i.priority) pills.push('<span class="tb-pill tb-pill-plain">优先级 ' + esc(i.priority) + '</span>')
        if (i.issuetype) pills.push('<span class="tb-pill tb-pill-plain">' + esc(i.issuetype) + '</span>')
        if (i.__archived) pills.push('<span class="tb-pill tb-pill-done" title="归档时间 ' + esc(i.archivedAt || '') + '；查看未访问 API">本地归档 · ' + esc(getTimeAgo(i.archivedAt)) + '</span>')
        if (pills.length) it.push('<div class="tb-pills">' + pills.join('') + '</div>')
        it.push('<div class="tb-meta">' + [['经办人', i.assignee], ['报告人', i.reporter], ['创建时间', fmtDate(i.created)], ['更新时间', fmtDate(i.updated)]].map((row) =>
          '<div class="tb-meta-item"><span class="tb-meta-label">' + esc(row[0]) + '</span><span class="tb-meta-value">' + (row[1] == null || row[1] === '' ? '—' : esc(String(row[1]))) + '</span></div>'
        ).join('') + '</div>')
        if (i.description) {
          it.push('<div class="tb-sec"><div class="tb-sec-label">描述</div><div class="tb-desc">' + esc(i.description) + '</div></div>')
        }
        if (i.attachments && i.attachments.length) {
          const isArc = Boolean(i.__archived)
          const failCount = isArc ? i.attachments.filter((a) => !a.downloaded).length : 0
          it.push('<div class="tb-sec"><div class="tb-sec-label">附件 · ' + i.attachments.length +
            (isArc
              ? ' <span class="tb-note">已归档到 ' + esc(REL_ARCHIVE_DIR + '/' + i.key + '/') + (failCount ? '；' + failCount + ' 个失败（行尾「刷新」重试）' : '') + '</span>'
              : ' <button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="download-all"' + (busy ? ' disabled' : '') + '>全部归档</button>') +
            '</div><div class="tb-files">' +
            i.attachments.map((a) => {
              const ext = String((a.filename || '').split('.').pop() || '').toLowerCase()
              const extClass = /^(png|jpe?g|gif|webp|bmp|svg)$/.test(ext) ? 'tb-ext-img'
                : /^(zip|rar|7z|tar|gz)$/.test(ext) ? 'tb-ext-zip'
                : /^(pdf|docx?|xlsx?|pptx?|txt|md|csv|log)$/.test(ext) ? 'tb-ext-doc' : 'tb-ext-gen'
              const extLabel = ext ? ext.slice(0, 4) : 'file'
              if (isArc) {
                if (!a.downloaded) {
                  return '<div class="tb-file" title="归档失败：' + esc(a.error || '') + '（行尾「刷新」重试）">' +
                    '<span class="tb-ext ' + extClass + '">' + esc(extLabel) + '</span>' +
                    '<span class="tb-file-name">' + esc(a.filename || '(未命名)') + '</span>' +
                    '<span class="tb-file-meta">归档失败</span>' +
                    '<span class="tb-file-act">—</span>' +
                  '</div>'
                }
                return '<div class="tb-file" data-action="preview-local" data-path="' + esc(a.path || '') + '" title="本地预览（零 API）">' +
                  '<span class="tb-ext ' + extClass + '">' + esc(extLabel) + '</span>' +
                  '<span class="tb-file-name">' + esc(a.filename || '(未命名)') + '</span>' +
                  '<span class="tb-file-meta">' + esc((a.size != null ? fmtSize(a.size) : '') + (a.author ? ' · ' + a.author : '')) + '</span>' +
                  '<span class="tb-file-act">' + (busy ? '读取中…' : '预览') + '</span>' +
                '</div>'
              }
              return '<div class="tb-file" data-action="download" data-url="' + esc(a.content || '') + '" data-filename="' + esc(a.filename || '') + '" title="点击预览 / 归档">' +
                '<span class="tb-ext ' + extClass + '">' + esc(extLabel) + '</span>' +
                '<span class="tb-file-name">' + esc(a.filename || '(未命名)') + '</span>' +
                '<span class="tb-file-meta">' + esc((a.size != null ? fmtSize(a.size) : '') + (a.author ? ' · ' + a.author : '')) + '</span>' +
                '<span class="tb-file-act">' + (busy ? '下载中…' : '预览') + '</span>' +
              '</div>'
            }).join('') + '</div></div>')
        }
        if (lastPreview && lastPreview.data) {
          it.push('<div class="tb-preview">' +
            '<div class="tb-preview-head"><span class="tb-preview-name">' + esc(lastPreview.name || '预览') + '</span>' +
            '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="close-preview">关闭</button></div>' +
            '<img class="tb-preview-img" src="data:' + mimeFor(lastPreview.name) + ';base64,' + lastPreview.data + '" alt="' + esc(lastPreview.name || 'preview') + '" />' +
          '</div>')
        }
        parts.push('<div class="tb-card">' + it.join('') + '</div>')
      }
      const records = st.records || []
      let body = ''
      parts.push('<div class="tb-list-head">' +
        '<span class="tb-list-title">已查询记录<span class="tb-count">' + records.length + '</span></span>' +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="refresh-all"' + (busy || records.length === 0 ? ' disabled' : '') + '>全部刷新</button>' +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-danger-ghost" data-action="clear"' + (records.length === 0 ? ' disabled' : '') + '>清空</button>' +
      '</div>')
      if (records.length === 0) {
        body = '<div class="tb-empty">' +
          '<div class="tb-empty-glyph"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg></div>' +
          '<div class="tb-empty-title">暂无查询记录</div>' +
          '<div class="tb-empty-sub">输入 Jira ID 查询后将自动保存</div>' +
        '</div>'
      } else {
        body = '<div class="tb-list">' + records.map((r) => {
          const tone = statusTone(r.status)
          return '<div class="tb-rec' + (lastIssue && lastIssue.key === r.key ? ' tb-rec-active' : '') + '" data-action="view-record" data-key="' + esc(r.key) + '" title="点击查看本地归档（零 API）">' +
            '<div class="tb-rec-main">' +
              '<div class="tb-rec-top">' +
                '<span class="tb-rec-key">' + esc(r.key) + '</span>' +
                (r.summary ? '<span class="tb-rec-summary">' + esc(String(r.summary)) + '</span>' : '') +
              '</div>' +
              '<div class="tb-rec-sub">' +
                (r.status ? '<span class="tb-rec-status"><span class="tb-dot tb-dot-' + tone + '"></span>' + esc(r.status) + '</span>' : '') +
                '<span class="tb-rec-time">' + esc(getTimeAgo(r.updated)) + '</span>' +
                (r.archivedAt
                  ? '<span title="归档时间 ' + esc(r.archivedAt) + '">已归档 · ' + esc(getTimeAgo(r.archivedAt)) + '</span>'
                  : '<span>未归档（点击查看时自动归档）</span>') +
              '</div>' +
            '</div>' +
            '<div class="tb-rec-acts">' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-ghost" data-action="refresh-record" data-key="' + esc(r.key) + '" title="从 Jira 重新获取并覆盖归档"' + (busy ? ' disabled' : '') + '>刷新</button>' +
              '<button type="button" class="tb-btn tb-btn-sm tb-btn-danger-ghost" data-action="remove" data-key="' + esc(r.key) + '"' + (busy ? ' disabled' : '') + '>删除</button>' +
            '</div>' +
          '</div>'
        }).join('') + '</div>'
      }
      return '<div class="jr-tabpanel tb-root tb-pane"><div class="tb-pane-head">' + parts.join('') + '</div><div class="tb-pane-body tb-pane-col">' + body + '</div></div>'
    }

    const handler = async ({ action, fields, state, root, session }) => {
      const ws = resolveWs(root, session)
      if (!ws.root) return { ok: false, error: '无法确定工作区根', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { input: '', records: [], error: null, info: null, credOpen: false, credInfo: null }
      // state 迁移：issue/preview 本体已挪闭包（旧 state 可能还挂着 description/base64 大字段）
      delete st.issue; delete st.preview
      try {
        if (action === 'toggle-cred') {
          st.credOpen = !st.credOpen
          if (st.credOpen) st.credInfo = await describeAllCreds()
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'save-cred') {
          const saved = []
          const failed = []
          for (const [ref, label, field] of CRED_ROWS) {
            const v = String(fields[field] != null ? fields[field] : '').trim()
            if (!v) continue
            try { await ctx.credentials.set(ref, v); saved.push(label) }
            catch (e) { failed.push(label + ': ' + String((e && e.message) || e)) }
          }
          st.credOpen = true
          st.credInfo = await describeAllCreds()
          if (failed.length) st.error = '凭据保存失败 — ' + failed.join('；')
          else st.error = null
          st.info = saved.length ? '已保存 ' + saved.join('、') + ' 到 Harness 凭据存储，下次查询立即生效' : '没有输入新值（留空保持不变）'
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'clear-cred') {
          const failed = []
          for (const [ref, label] of CRED_ROWS) {
            try { await ctx.credentials.unset(ref) }
            catch (e) { failed.push(label + ': ' + String((e && e.message) || e)) }
          }
          st.credOpen = true
          st.credInfo = await describeAllCreds()
          if (failed.length) { st.error = '凭据清除失败 — ' + failed.join('；'); st.info = null }
          else { st.error = null; st.info = '已清除 Jira 凭据（环境变量来源不受影响）' }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'query' || action === 'refresh-record') {
          // query = 输入框主动查询；refresh-record = 记录行尾「刷新」——两者都打 API 并自动归档
          const elKey = fields.__el && fields.__el.key != null ? fields.__el.key : null
          const k = String(elKey != null ? elKey : (fields.key != null ? fields.key : st.input)).trim()
          if (!k || (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(k) && !/^\d+$/.test(k))) { st.error = '非法的 Jira key: ' + k; if (!/^\d+$/.test(k) && k) st.input = k; return { ok: true, html: render(st, false), state: st } }
          st.input = k
          st.error = null
          st.info = null
          lastPreview = null
          const res = await fetchAndArchive(k, st, ws)
          if (!res.ok) {
            st.error = (res.error || '查询失败')
            if (/not configured/i.test(String(res.error || ''))) st.error += '（点「凭据设置」直接配置，立即生效）'
            lastIssue = null
          }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'view-record' || action === 'query-record') {
          // 点击记录 = 读本地归档（零 API）；本地无归档才回退 API + 自动归档
          const elKey = fields.__el && fields.__el.key != null ? fields.__el.key : null
          const k = String(elKey != null ? elKey : (fields.key != null ? fields.key : '')).trim()
          if (!k) { st.error = '缺少 Jira key'; return { ok: true, html: render(st, false), state: st } }
          st.input = k
          st.error = null
          st.info = null
          lastPreview = null
          const arc = await loadArchive(k, ws)
          if (arc) {
            lastIssue = Object.assign({}, arc, { __archived: true })
            st.info = '本地归档（' + getTimeAgo(arc.archivedAt) + '归档）· 未访问 API；点行尾「刷新」可从 Jira 重新获取并覆盖归档'
          } else {
            const res = await fetchAndArchive(k, st, ws)
            if (!res.ok) {
              st.error = '本地无归档，联网获取失败：' + (res.error || '')
              if (/not configured/i.test(String(res.error || ''))) st.error += '（点「凭据设置」直接配置，立即生效）'
              lastIssue = null
            } else if (st.info == null || st.info === '') {
              st.info = '本地无归档，已从 Jira 获取并自动归档'
            }
          }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'download') {
          const el = fields.__el || {}
          const url = String(el.url != null ? el.url : fields.url || '').trim()
          const key = lastIssue && lastIssue.key ? lastIssue.key : ''
          const filename = String(el.filename != null ? el.filename : fields.filename || 'attachment')
          if (!/^https?:\/\//i.test(url)) { st.error = '非法的附件地址'; return { ok: true, html: render(st, false), state: st } }
          st.error = null
          st.info = null
          const res = await downloadAttachment(url, key, filename, ws)
          if (!res.ok) { st.error = res.error || '附件下载失败' }
          else {
            if (lastIssue && lastIssue.__archived) await updateArchiveEntry(key, filename, res.len, ws)
            const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(filename)
            if (res.previewable && isImage) lastPreview = { name: filename, data: res.data }
            else {
              lastPreview = null
              st.info = '已归档：' + res.path + (res.previewable ? '（该类型暂不支持网页预览）' : '（文件较大，暂不支持网页预览）')
            }
          }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'preview-local') {
          // 归档附件的本地预览（零 API）
          const el = fields.__el || {}
          const rel = String(el.path != null ? el.path : fields.path || '')
          const filename = rel.split('/').pop() || 'attachment'
          st.error = null
          st.info = null
          const res = await previewLocalFile(rel, ws)
          if (!res.ok) { st.error = res.error || '预览读取失败' }
          else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(filename)) lastPreview = { name: filename, data: res.data }
          else { lastPreview = null; st.info = '该类型暂不支持网页预览：' + filename + '（文件已在本地归档，可直接打开）' }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'download-all') {
          const list = (lastIssue && Array.isArray(lastIssue.attachments)) ? lastIssue.attachments : []
          const key = lastIssue && lastIssue.key ? lastIssue.key : ''
          if (!list.length) { st.info = '当前工单没有附件'; return { ok: true, html: render(st, false), state: st } }
          st.error = null
          lastPreview = null
          const okNames = []
          const failNames = []
          for (const a of list) {
            const url = String(a.content || '')
            const fname = String(a.filename || 'attachment')
            if (!/^https?:\/\//i.test(url)) { failNames.push(fname + '（非法地址）'); continue }
            const res = await downloadAttachment(url, key, fname, ws)
            if (res.ok) okNames.push(fname)
            else failNames.push(fname + '（' + (res.error || '失败') + '）')
          }
          st.info = '批量归档完成：成功 ' + okNames.length + ' / 共 ' + list.length + ' → ' + REL_ARCHIVE_DIR + '/' + key + '/' +
            (failNames.length ? '；失败：' + failNames.join('、') : '')
          if (!okNames.length && failNames.length) { st.error = '批量归档全部失败：' + failNames.join('、'); st.info = null }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'close-preview') {
          lastPreview = null
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'close-issue') {
          // 关闭详情卡（记录保留在列表中，再点行可重新查看本地归档）
          lastIssue = null
          lastPreview = null
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'remove') {
          const elKey = fields.__el && fields.__el.key != null ? fields.__el.key : fields.key
          const r2 = await runRecords('remove', null, ws, String(elKey || ''))
          if (r2.ok) {
            st.records = r2.records
            if (lastIssue && lastIssue.key === elKey) lastIssue = null
          }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'clear') {
          const r2 = await runRecords('clear', null, ws)
          if (r2.ok) { st.records = []; lastIssue = null; lastPreview = null }
          return { ok: true, html: render(st, false), state: st }
        }
        if (action === 'refresh-all') {
          st.error = null
          st.info = null
          const list = (st.records || []).slice()
          for (const r of list) {
            const res = await fetchAndArchive(r.key, st, ws, { setView: false })
            if (!res.ok) st.error = (res.error || '') + '（' + r.key + '）'
          }
          if (!st.error) st.info = '全部刷新完成（已重新归档 ' + list.length + ' 个工单）'
          return { ok: true, html: render(st, false), state: st }
        }
        // 默认（''）：加载记录列表
        const r0 = await runRecords('list', null, ws)
        if (r0.ok) st.records = r0.records
        return { ok: true, html: render(st, false), state: st }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), html: '' }
      }
    }

    const runRecords = async (action, rec, ws, key) => {
      try {
        if (action === 'list') return { ok: true, records: await readJsonFile(REL_WATCH_FILE, ws.root) }
        if (action === 'upsert') {
          if (!rec || typeof rec.key !== 'string' || !rec.key) return { ok: false, error: 'record.key 必填' }
          const records = await readJsonFile(REL_WATCH_FILE, ws.root)
          const idx = records.findIndex((r) => r && r.key === rec.key)
          if (idx >= 0) records[idx] = rec
          else records.push(rec)
          const persisted = await writeJsonFile(REL_WATCH_FILE, records, ws)
          return { ok: true, records, persisted }
        }
        if (action === 'remove') {
          const records = await readJsonFile(REL_WATCH_FILE, ws.root)
          const next = records.filter((r) => !r || r.key !== key)
          const persisted = await writeJsonFile(REL_WATCH_FILE, next, ws)
          return { ok: true, records: next, persisted }
        }
        if (action === 'clear') {
          const persisted = await writeJsonFile(REL_WATCH_FILE, [], ws)
          return { ok: true, records: [], persisted }
        }
        return { ok: false, error: '未知 action: ' + String(action) }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }

    tryRegisterTool(ctx, { id: 'jira', label: 'Jira', order: 0 }, handler)
  },
}