// ===== toolbox-client.js：工具箱框架 Client 半 — 抽屉 + Tab 栏 + 通用 HTML 面板壳 =====
// 工具列表经 host.call('toolbox/tools') 轮询（1.5s，抽屉打开时）；
// 面板内容经 host.call('toolbox/panel') 获取 HTML 片段 + 状态回传；
// 面板内交互：点击 [data-action]，表单输入收集 [data-field] 一并回传。

return {
  name: 'toolbox',
  inject: ['timer'],
  apply(ctx) {
    // 进程级单例（工作区级）：页面已有主实例的抽屉时，本会话 Client 半空转——避免重复注册
    // sidebar.footer.action / shell.overlay 造成双抽屉。标记随 fiber 卸载清理；主实例停止后
    // 重新运行本插件即可重新成为主实例。
    if (typeof document !== 'undefined' && document.body) {
      if (document.body.hasAttribute('data-dsh-toolbox-mounted')) {
        console.log('toolbox: 页面已存在工具箱抽屉（另一会话的主实例），本会话 Client 半跳过')
        return
      }
      document.body.setAttribute('data-dsh-toolbox-mounted', '1')
      ctx.effect(() => () => {
        try { if (document.body) document.body.removeAttribute('data-dsh-toolbox-mounted') } catch (e) {}
      })
    }
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const themeSvc = ctx.get('theme')

    styles.insert([
      '.tb-entry{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;margin:0 4px 0 0;border:1px solid var(--dsw-alias-border-l2,#4a4b55);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#26272e);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12px;font-weight:600;line-height:1;cursor:pointer;white-space:nowrap;appearance:none;box-sizing:border-box;font-family:inherit}',
      '.tb-entry:hover{background:var(--dsw-alias-bg-layer-2,#30313a)}',
      '.tb-entry-active{color:var(--dsw-alias-brand-primary,#3b82f6);border-color:var(--dsw-alias-brand-primary,#3b82f6)}',
      // ---- 侧边栏导航条目（DOM 注入，样式对齐任务看板/SSH 导航行） ----
      '[data-dsh-toolbox-entry]{width:100%;height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:0 12px;font-size:13px;display:flex;font-family:inherit;box-sizing:border-box}',
      '[data-dsh-toolbox-entry]:hover{background:var(--dsw-specific-sidebar-nav-item-hover,var(--dsw-alias-bg-layer-2,#31323b));color:var(--dsw-alias-label-primary)}',
      '[data-dsh-toolbox-entry][data-active]{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-bg-layer-2,#31323b));color:var(--dsw-alias-label-primary);font-weight:600}',
      '.tb-nav-icon{flex:none;display:inline-flex;justify-content:center;align-items:center}',
      '.tb-nav-label{overflow:hidden;text-overflow:ellipsis}',
      '[data-dsh-frame][data-sidebar-collapsed] [data-dsh-toolbox-entry]{justify-content:center;width:100%;padding:0}',
      '[data-dsh-frame][data-sidebar-collapsed] .tb-nav-label{display:none}',
      '.jr-drawer{position:fixed;right:24px;top:64px;z-index:1300;width:520px;max-width:94vw;max-height:calc(100vh - 96px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#17181d);border:1px solid var(--dsw-alias-border-l1,#3a3b44);border-radius:10px;color:var(--dsw-alias-label-primary,#e8e8ea);font-size:13px;pointer-events:auto;box-shadow:-14px 0 44px rgba(0,0,0,.24);animation:jrDrawerIn .16s ease-out;overflow:hidden}',
      '.jr-docked{right:0;top:0;bottom:0;max-height:none;border-radius:0;border-top:none;border-right:none;border-bottom:none;border-left:1px solid var(--dsw-alias-border-l1,#3a3b44);box-shadow:-8px 0 24px rgba(0,0,0,.16)}',
      '.jr-docked .jr-drawer-body{flex:1;min-height:0}',
      // 全占右侧：左侧贴侧边栏右缘（left 由渲染时实测侧边栏给出），上下占满，替代主内容区视图
      // 挤压三栏停靠：抽屉 fixed 右栏（宽度内联给），主内容列 margin-right 让位（见 Drawer 内 effect），左中右并列互不遮挡
      '.jr-docked-full{right:0;top:0;bottom:0;max-height:none;max-width:none;width:auto;border-radius:0;border:none;border-left:1px solid var(--dsw-alias-border-l1,#3a3b44);box-shadow:none;animation:jrDrawerIn .16s ease-out}',
      '.jr-docked-full .jr-drawer-body{flex:1;min-height:0}',
      '@keyframes jrDrawerIn{from{transform:translateX(28px);opacity:.3}to{transform:translateX(0);opacity:1}}',
      '.jr-drawer-header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3b44);background:var(--dsw-alias-bg-base,#17181d);cursor:move;user-select:none}',
      '.jr-drawer-title{font-weight:600;flex:1;font-size:14px}',
      '.jr-overlay-close{width:30px;height:30px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9aa5);cursor:pointer;border-radius:6px;padding:0}',
      '.jr-overlay-close:hover{color:var(--dsw-alias-label-primary,#e8e8ea);background:var(--dsw-alias-bg-layer-2,#30313a)}',
      '.jr-drawer-body{padding:14px;overflow:auto;display:flex;flex-direction:column;gap:12px}',
      // ---- 抽屉内滚动条统一接管：轨道透明（融入面板背景），thumb 用边框色；Webkit + Firefox 双写 ----
      '.jr-drawer *{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#454650) transparent}',
      '.jr-drawer ::-webkit-scrollbar{width:9px;height:9px}',
      '.jr-drawer ::-webkit-scrollbar-track{background:transparent}',
      '.jr-drawer ::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#454650);border-radius:5px;border:2px solid transparent;background-clip:padding-box}',
      '.jr-drawer ::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-tertiary,#6f707c);border:2px solid transparent;background-clip:padding-box}',
      '.jr-drawer ::-webkit-scrollbar-corner{background:transparent}',
      '.jr-tabpanel{display:flex;flex-direction:column;gap:12px}',
      // ---- 三段式导航条（搜索整行 / 分类行 / 分类下工具行；分类与工具行横向滚动 + 滚轮横移见 HRow） ----
      '.tb-nav{display:flex;flex-direction:column;gap:8px;padding:10px 14px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3b44);flex:none}',
      '.tb-nav-search{flex:none;width:100%}',
      '.tb-hrow{display:flex;gap:6px;overflow-x:auto;scrollbar-width:thin}',
      '.tb-cats{padding-bottom:2px}',
      '.tb-tools{padding-bottom:9px}',
      '.tb-hrow-empty{flex:none;color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:11.5px;padding:2px 2px 10px}',
      '.tb-tab{flex:none;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;appearance:none;font-family:inherit}',
      // ---- 管理页树（分类节点 → 插件节点；分类头可折叠、可接拖放） ----
      '.tb-tree-cat{display:flex;align-items:center;gap:7px;height:26px;padding:0 6px;border-radius:6px;cursor:pointer;user-select:none;border:1px dashed transparent;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-tree-cat:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b))}',
      '.tb-tree-cat-drop{border-color:var(--tb-accent-border,rgba(91,141,239,.5));background:var(--tb-accent-bg,rgba(91,141,239,.08))}',
      '.tb-tree-chev{width:12px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));transition:transform .12s}',
      '.tb-tree-cat-open>.tb-tree-chev{transform:rotate(90deg)}',
      '.tb-tree-cat-label{font-size:12px;font-weight:700;letter-spacing:.3px}',
      '.tb-tree-kids{display:flex;flex-direction:column;gap:6px;padding:2px 0 6px 19px}',
      '.tb-drag{flex:none;cursor:grab;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:11px;letter-spacing:1px;line-height:1}',
      '.tb-tab:hover{background:var(--dsw-alias-bg-layer-2,#30313a);color:var(--dsw-alias-label-primary,#e8e8ea)}',
      '.tb-tab-active{color:var(--dsw-alias-brand-primary,#3b82f6);border-color:var(--dsw-alias-border-l2,#4a4b55);background:var(--dsw-alias-bg-layer-1,#26272e)}',
      // ---- Tab 忙碌转圈（替代面板内「处理中…」横幅，操作期间面板内容保持不动） ----
      '.tb-tab-spin{display:inline-block;width:10px;height:10px;border:1.5px solid var(--tb-accent-border,rgba(91,141,239,.35));border-top-color:var(--tb-accent,#3f6fd9);border-radius:50%;animation:tbSpin .7s linear infinite}',
      // ---- Tab 角标（工具经 data-tab-badge 声明；如流程图节点数 / 配额余量） ----
      '.tb-tab-badge{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 4px;border-radius:999px;font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums;background:var(--tb-accent-bg,rgba(91,141,239,.16));color:var(--tb-accent-text,#7fa7f0);border:1px solid var(--tb-accent-border,rgba(91,141,239,.35))}',
      '@keyframes tbSpin{to{transform:rotate(360deg)}}',
      '.tb-empty{color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:12px;text-align:center;padding:26px 0;line-height:1.7}',
      '.jr-snap-indicator{position:fixed;right:0;top:0;bottom:0;width:4px;background:var(--dsw-alias-brand-primary,#3b82f6);opacity:.65;z-index:1299;pointer-events:none}',
      '.jr-resize-left{position:absolute;left:0;top:0;bottom:0;width:6px;cursor:col-resize;z-index:6;touch-action:none}',
      '.jr-resize-left:hover{background:rgba(59,130,246,.28)}',
      '.jr-resize-right{position:absolute;top:0;right:0;bottom:0;width:6px;cursor:ew-resize;z-index:6;touch-action:none}',
      '.jr-resize-right:hover{background:rgba(59,130,246,.28)}',
      '.jr-resize-bottom{position:absolute;left:0;right:0;bottom:0;height:6px;cursor:ns-resize;z-index:6;touch-action:none}',
      '.jr-resize-bottom:hover{background:rgba(59,130,246,.28)}',
      '.jr-resize-corner{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:6;touch-action:none}',
      '.jr-resize-corner:hover{background:rgba(59,130,246,.22);border-radius:0 0 10px 0}',
      '.jr-resize-badge{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);padding:5px 12px;border:1px solid var(--dsw-alias-border-l2,#4a4b55);border-radius:6px;background:var(--dsw-alias-bg-overlay,#1e1f24);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12px;font-variant-numeric:tabular-nums;z-index:1310;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.3)}',
      '.tb-frame{position:relative;display:flex;flex-direction:column;gap:10px;min-height:0}',
      // 「回到最新」浮标：面板不在底部时显示（column-reverse 滚动容器 scrollTop<-40 / 正常方向 dist>40），点击平滑回底
      '.tb-jump-latest{position:absolute;right:16px;bottom:14px;z-index:6;display:inline-flex;align-items:center;height:27px;padding:0 13px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#454650);background:var(--dsw-alias-bg-overlay,#1e1f24);color:var(--tb-accent-text,#7fa7f0);font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3);font-family:inherit;animation:jrDrawerUp .16s ease-out}',
      '.tb-jump-latest:hover{border-color:var(--tb-accent-border,rgba(91,141,239,.45))}',
      // ---- 画中画（Document PiP）：主抽屉 DOM 的实时镜像窗口（脱离 WebUI 框体） ----
      '.jr-pip-root{display:flex;flex-direction:column;height:100vh;background:var(--dsw-alias-bg-base,#17181d);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:13px;overflow:hidden;font-family:inherit}',
      '.jr-pip-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3b44);background:var(--dsw-alias-bg-layer-1,#26272e)}',
      '.jr-pip-bar-title{flex:1;min-width:0;font-size:11.5px;color:var(--dsw-alias-label-secondary,#9a9aa5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.jr-pip-bar-btn{flex:none;height:24px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#454650);background:transparent;color:var(--dsw-alias-label-primary,#e8e8ea);font-size:11.5px;cursor:pointer;font-family:inherit}',
      '.jr-pip-bar-btn:hover{background:var(--dsw-alias-bg-layer-2,#30313a)}',
      // 镜像容器：抽屉克隆充满窗口；拖拽把手/吸附指示/尺寸徽章在 pip 里无意义隐藏
      '.jr-pip-mirror{flex:1;min-height:0;overflow:hidden;position:relative}',
      '.jr-pip-mirror .jr-drawer{display:flex}',
      '.jr-pip-mirror .jr-resize-left,.jr-pip-mirror .jr-resize-right,.jr-pip-mirror .jr-resize-bottom,.jr-pip-mirror .jr-resize-corner,.jr-pip-mirror .jr-snap-indicator,.jr-pip-mirror .jr-resize-badge{display:none}',
      '.jr-pip-root *{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#454650) transparent}',
      '.jr-pip-root ::-webkit-scrollbar{width:9px;height:9px}',
      '.jr-pip-root ::-webkit-scrollbar-track{background:transparent}',
      '.jr-pip-root ::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#454650);border-radius:5px;border:2px solid transparent;background-clip:padding-box}',
      '.tb-notice{color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:12px;text-align:center;padding:8px 0}',
      '.tb-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;white-space:pre-wrap;word-break:break-word;border:1px solid var(--dsw-alias-border-l1,#3a3b44);border-radius:6px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1,#26272e)}',
      // ===== 共享设计系统（tb-）：工具面板 HTML 直接使用；颜色只消费 --tb-* 变量（带兜底），主题插件在 :root 声明即可覆盖 =====
      '.tb-root{font-size:12.5px;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-root *{box-sizing:border-box}',
      // ---- 按钮（!important 压宿主全局按钮样式） ----
      '.tb-btn{display:inline-flex;align-items:center;justify-content:center;height:var(--tb-ctl-h-sm,26px);padding:0 11px;border-radius:6px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650))!important;background:transparent!important;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))!important;font-size:12px;font-weight:500;font-family:inherit;line-height:1;cursor:pointer;white-space:nowrap;appearance:none;-webkit-appearance:none;outline:none;margin:0;box-shadow:none;text-shadow:none;transition:background .12s,border-color .12s,color .12s}',
      '.tb-btn:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b))!important}',
      '.tb-btn:active{transform:translateY(1px)}',
      '.tb-btn:disabled{opacity:.4;cursor:default;transform:none}',
      '.tb-btn-primary{background:var(--tb-accent,#3f6fd9)!important;border-color:var(--tb-accent,#3f6fd9)!important;color:#fff!important}',
      '.tb-btn-primary:hover{background:var(--tb-accent-hover,#4c7ceb)!important;border-color:var(--tb-accent-hover,#4c7ceb)!important}',
      '.tb-btn-ghost{border-color:transparent!important;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))!important}',
      '.tb-btn-ghost:hover{color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))!important}',
      '.tb-btn-danger-ghost{border-color:transparent!important;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))!important}',
      '.tb-btn-danger-ghost:hover{background:var(--tb-danger-bg,rgba(239,83,80,.1))!important;color:var(--tb-danger-text,#f28b82)!important}',
      '.tb-btn-sm{height:23px;padding:0 8px;font-size:11.5px}',
      // ---- 输入（控件高度统一走 token：--tb-ctl-h 标准高 / --tb-ctl-h-sm 紧凑高，主题可覆盖） ----
      // flex:1 1 auto —— 曾经 flex:1（basis 0%）在纵向 flex（.tb-sec）里把 height 压成内容高（Cron/评审/提交信息/正则的输入框变矮），auto 基准则行列两相宜
      '.tb-query{display:flex;gap:8px;align-items:center}',
      '.tb-query .tb-btn{height:var(--tb-ctl-h,30px)}',
      '.tb-input{flex:1 1 auto;min-width:0;height:var(--tb-ctl-h,30px);padding:0 11px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:12.5px;outline:none;font-family:inherit;caret-color:var(--tb-accent,#3f6fd9);transition:border-color .12s,box-shadow .12s}',
      '.tb-input:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      '.tb-input:focus{border-color:var(--tb-accent,#3f6fd9);box-shadow:0 0 0 3px var(--tb-accent-ring,rgba(91,141,239,.16))}',
      '.tb-input::placeholder{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      // ---- 多行输入 ----
      '.tb-textarea{width:100%;min-height:62px;padding:8px 11px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:12px;font-family:ui-monospace,Consolas,monospace;line-height:1.55;outline:none;resize:vertical;box-sizing:border-box;caret-color:var(--tb-accent,#3f6fd9)}',
      '.tb-textarea:focus{border-color:var(--tb-accent,#3f6fd9);box-shadow:0 0 0 3px var(--tb-accent-ring,rgba(91,141,239,.16))}',
      '.tb-textarea::placeholder{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      // ---- 下拉 ----
      '.tb-select{height:var(--tb-ctl-h-sm,26px);padding:0 8px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:12px;font-family:inherit;outline:none;cursor:pointer}',
      // ---- 芯片组（单选/开关） ----
      '.tb-chips{display:flex;gap:5px;flex-wrap:wrap}',
      '.tb-chip{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;font-family:inherit;transition:border-color .12s,color .12s,background .12s}',
      '.tb-chip:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-chip-on{background:var(--tb-accent-bg,rgba(91,141,239,.14));border-color:var(--tb-accent-border,rgba(91,141,239,.45));color:var(--tb-accent-text,#7fa7f0)}',
      // ---- 统计行 ----
      '.tb-stats{display:flex;gap:8px;flex-wrap:wrap}',
      '.tb-stat{flex:1;min-width:70px;display:flex;flex-direction:column;gap:2px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;padding:7px 10px}',
      '.tb-stat-num{font-size:15px;font-weight:700;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-variant-numeric:tabular-nums}',
      '.tb-stat-label{font-size:10.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      // ---- 分栏面板（固定头 + 时间线独立滚动）----
      // :has() 作用域化：只有含 .tb-pane 的 tab 启用高度链，其他工具保持整页滚动不变；
      // .tb-pane-body 用 column-reverse —— DOM 最新在前 ⇒ 视觉越往下越新，且滚动条默认停在底部
      '.jr-drawer-body:has(.tb-pane){overflow:hidden}',
      '.tb-frame:has(.tb-pane){flex:1;min-height:0;overflow:hidden}',
      '.tb-frame:has(.tb-pane)>div{flex:1;min-height:0;display:flex;flex-direction:column}',
      '.tb-pane{position:relative;display:flex;flex-direction:column;flex:1;min-height:0;gap:10px;overflow:hidden}',
      '.tb-pane-head{flex:none;display:flex;flex-direction:column;gap:10px}',
      '.tb-pane-body{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column-reverse;gap:4px;padding-right:4px}',
      // 正常方向变体（默认 column-reverse 是给轨迹的「最新在底、滚动条默认底部」；其他分栏工具用 tb-pane-col）
      '.tb-pane-col{flex-direction:column}',
      // ---- 横幅 ----
      '.tb-banner{padding:7px 11px;border-radius:6px;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;border:1px solid}',
      '.tb-banner-error{color:var(--tb-danger-text,#f2b8b5);background:var(--tb-danger-bg,rgba(239,83,80,.07));border-color:var(--tb-danger-border,rgba(239,83,80,.25))}',
      '.tb-banner-info{color:var(--tb-ok-text,#a5d6a7);background:var(--tb-ok-bg,rgba(102,187,106,.07));border-color:var(--tb-ok-border,rgba(102,187,106,.25))}',
      // ---- 状态点 + pill ----
      '.tb-dot{flex:none;width:6px;height:6px;border-radius:50%}',
      '.tb-dot-done{background:var(--tb-done,#66bb6a)}',
      '.tb-dot-active{background:var(--tb-active,#5b8def)}',
      '.tb-dot-todo{background:var(--tb-muted,#8a8b96)}',
      '.tb-dot-other{background:var(--tb-warn,#d4a72c)}',
      '.tb-pill{display:inline-flex;align-items:center;gap:5px;height:19px;padding:0 8px;border-radius:999px;font-size:11px;border:1px solid;white-space:nowrap}',
      '.tb-pill-done{color:var(--tb-done-text,#81c784);border-color:var(--tb-done-border,rgba(102,187,106,.35))}',
      '.tb-pill-active{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-active-border,rgba(91,141,239,.4))}',
      '.tb-pill-todo{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));border-color:var(--tb-muted-border,rgba(138,139,150,.35))}',
      '.tb-pill-other{color:var(--tb-warn-text,#d4b95c);border-color:var(--tb-warn-border,rgba(212,167,44,.4))}',
      '.tb-pill-warn{color:var(--tb-warn-text,#d4b95c);border-color:var(--tb-warn-border,rgba(212,167,44,.4))}', // 语义同 other（警示黄）；轨迹「命令」类等需要语义名的场景用
      '.tb-pill-plain{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));border-color:var(--tb-border-2,var(--dsw-alias-border-l2,#454650))}',
      // 可点 pill（管理视图「重启后」默认启停）：幽灵虚线弱化存在感，悬停/开启才上 accent，与展示型 pill 拉开层级
      '.tb-pill-btn{display:inline-flex;align-items:center;gap:5px;height:19px;padding:0 8px;border-radius:999px;font-size:11px;white-space:nowrap;font-family:inherit;line-height:1;background:transparent;border:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650));color:var(--tb-text-3,#8b8c96);cursor:pointer}',
      '.tb-pill-btn:hover{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-active-border,rgba(91,141,239,.4))}',
      '.tb-pill-btn.on{color:var(--tb-active-text,#7fa7f0);border:1px solid var(--tb-active-border,rgba(91,141,239,.4));background:var(--tb-active-bg,rgba(91,141,239,.08))}',
      // ---- 文本色调 / 通用工具 ----
      '.tb-tx-done{color:var(--tb-done-text,#81c784)}',
      '.tb-tx-active{color:var(--tb-active-text,#7fa7f0)}',
      '.tb-tx-warn{color:var(--tb-warn-text,#d4b95c)}',
      '.tb-tx-danger{color:var(--tb-danger-text,#f28b82)}',
      '.tb-tx-muted{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-mono{font-family:ui-monospace,Consolas,monospace}',
      '.tb-num{font-variant-numeric:tabular-nums;font-size:11px;flex:none}',
      '.tb-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.tb-hr{height:1px;background:var(--tb-border,var(--dsw-alias-border-l1,#35363e))}',
      '.tb-note{font-size:11.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      // ---- 卡片 ----
      '.tb-card{display:flex;flex-direction:column;gap:12px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:10px;padding:13px 14px}',
      '.tb-card-head{display:flex;align-items:flex-start;gap:9px}',
      '.tb-key{flex:none;display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:5px;background:var(--tb-accent-bg,rgba(91,141,239,.12));color:var(--tb-accent-text,#7fa7f0);font-family:ui-monospace,Consolas,monospace;font-size:11px;font-weight:600;letter-spacing:.3px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tb-title{flex:1;min-width:0;font-size:13.5px;font-weight:600;line-height:1.5;word-break:break-word}',
      '.tb-pills{display:flex;flex-wrap:wrap;gap:6px}',
      '.tb-meta{display:grid;grid-template-columns:1fr 1fr;gap:7px 14px}',
      '.tb-meta-item{display:flex;flex-direction:column;gap:1px;min-width:0}',
      '.tb-meta-label{font-size:10.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-meta-value{font-size:12px;word-break:break-word}',
      '.tb-sec{display:flex;flex-direction:column;gap:6px}',
      '.tb-sec-label{font-size:10.5px;font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));letter-spacing:.5px}',
      '.tb-desc{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.7;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:6px;padding:9px 11px;max-height:220px;overflow:auto}',
      '.tb-code{white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.5;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:6px;padding:9px 11px;max-height:420px;overflow:auto;margin:0;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      // ---- 行（状态字母 + 路径） ----
      '.tb-line{display:flex;gap:8px;align-items:baseline;padding:1px 0;font-size:12px}',
      '.tb-line-status{width:14px;text-align:center;font-weight:600;flex:none;font-family:ui-monospace,Consolas,monospace}',
      '.tb-line-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace}',
      // ---- 文件/附件行 ----
      '.tb-files{display:flex;flex-direction:column}',
      '.tb-file{display:flex;align-items:center;gap:9px;padding:6px 7px;margin:0 -7px;border-radius:6px;cursor:pointer;transition:background .12s}',
      '.tb-file:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33))}',
      '.tb-ext{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:18px;padding:0 5px;border-radius:4px;font-size:9.5px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;font-family:ui-monospace,Consolas,monospace;border:1px solid}',
      '.tb-ext-img{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-active-border,rgba(91,141,239,.4));background:var(--tb-accent-bg,rgba(91,141,239,.1))}',
      '.tb-ext-doc{color:var(--tb-done-text,#81c784);border-color:var(--tb-done-border,rgba(102,187,106,.35));background:var(--tb-ok-bg,rgba(102,187,106,.08))}',
      '.tb-ext-zip{color:var(--tb-warn-text,#d4b95c);border-color:var(--tb-warn-border,rgba(212,167,44,.35));background:rgba(212,167,44,.08)}',
      '.tb-ext-gen{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));border-color:var(--tb-muted-border,rgba(138,139,150,.3))}',
      '.tb-file-name{flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tb-file:hover .tb-file-name{color:var(--tb-accent-text,#7fa7f0)}',
      '.tb-file-meta{flex:none;font-size:11px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-file-act{flex:none;font-size:11px;color:var(--tb-accent,#3f6fd9);opacity:0;transition:opacity .12s}',
      '.tb-file:hover .tb-file-act{opacity:1}',
      // ---- 预览 ----
      '.tb-preview{display:flex;flex-direction:column;gap:8px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;padding:10px}',
      '.tb-preview-head{display:flex;align-items:center;gap:8px}',
      '.tb-preview-name{flex:1;min-width:0;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tb-preview-img{display:block;max-width:100%;max-height:320px;border-radius:6px;margin:0 auto}',
      // ---- 记录/提交列表 ----
      '.tb-list-head{display:flex;align-items:center;gap:4px}',
      '.tb-list-title{flex:1;display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));letter-spacing:.4px}',
      '.tb-count{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:15px;padding:0 4px;border-radius:999px;background:var(--tb-accent-bg,rgba(91,141,239,.14));color:var(--tb-accent-text,#7fa7f0);font-size:10px;font-weight:700;font-variant-numeric:tabular-nums}',
      '.tb-list{display:flex;flex-direction:column;gap:4px}',
      '.tb-rec{display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;cursor:pointer;transition:background .12s,border-color .12s}',
      '.tb-rec:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33))}',
      '.tb-rec-active{border-color:var(--tb-accent-border,rgba(91,141,239,.5))}',
      '.tb-rec-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.tb-rec-top{display:flex;align-items:center;gap:8px;min-width:0}',
      '.tb-rec-key{flex:none;font-family:ui-monospace,Consolas,monospace;font-size:11px;font-weight:700;color:var(--tb-accent-text,#7fa7f0);letter-spacing:.3px}',
      '.tb-rec-summary{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tb-rec-sub{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-variant-numeric:tabular-nums;flex-wrap:wrap}',
      '.tb-rec-status{display:inline-flex;align-items:center;gap:5px}',
      '.tb-rec-acts{flex:none;display:flex;gap:2px;opacity:0;transition:opacity .12s}',
      '.tb-rec:hover .tb-rec-acts,.tb-rec-active .tb-rec-acts{opacity:1}',
      // ---- 文件树（chevron 旋转 + 文件夹/文件图标 + 展开态高亮） ----
      '.tb-tree{display:flex;flex-direction:column;gap:1px;font-size:12.5px}',
      '.tb-tree-row{display:flex;align-items:center;gap:6px;height:24px;padding:0 8px 0 2px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:background .1s;user-select:none}',
      '.tb-tree-row:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33))}',
      '.tb-tree-dir{color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-tree-dir .tb-tree-name{font-weight:600}',
      '.tb-tree-open>.tb-tree-chevron svg{transform:rotate(90deg)}',
      '.tb-tree-open>.tb-tree-ic{color:var(--tb-accent-text,#7fa7f0)}',
      '.tb-tree-file{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));cursor:default}',
      '.tb-tree-chevron{width:12px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-tree-chevron svg{transition:transform .12s}',
      '.tb-tree-ic{width:15px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-tree-dir>.tb-tree-ic{color:var(--tb-accent-text,#7fa7f0);opacity:.85}',
      '.tb-tree-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.tb-tree-size{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:11px;min-width:56px;text-align:right;flex:none;font-variant-numeric:tabular-nums}',
      // ---- 空状态 ----
      '.tb-empty{display:flex;flex-direction:column;align-items:center;gap:5px;padding:26px 14px;border:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:8px;text-align:center}',
      '.tb-empty-glyph{width:30px;height:30px;border-radius:8px;border:1px solid var(--tb-accent-border,rgba(91,141,239,.3));display:flex;align-items:center;justify-content:center;margin-bottom:3px}',
      '.tb-empty-glyph svg{stroke:var(--tb-accent,#3f6fd9)}',
      '.tb-empty-title{font-size:12px;font-weight:600;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))}',
      '.tb-empty-sub{font-size:11px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      // ---- 管理视图（Tab 显示开关） ----
      '.tb-manage-list{display:flex;flex-direction:column;gap:6px}',
      '.tb-manage-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px}',
      '.tb-manage-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.tb-manage-label{font-size:12.5px;font-weight:600;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-manage-id{font-size:10.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-family:ui-monospace,Consolas,monospace}',
      '.tb-switch{position:relative;width:34px;height:19px;flex:none;border-radius:999px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));cursor:pointer;padding:0;appearance:none;outline:none;transition:background .15s,border-color .15s}',
      '.tb-switch::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));transition:transform .15s,background .15s}',
      '.tb-switch-on{background:var(--tb-accent,#3f6fd9);border-color:var(--tb-accent,#3f6fd9)}',
      '.tb-switch-on::after{transform:translateX(15px);background:#fff}',
      // ===== 流程图（flow 工具；fl- 前缀）=====
      // 主干：自上而下节点 + 向下箭头；子代理：git 树分支（├─ │ ╰─）；普通工具组：向右分支（├▶ ╰▶）
      // 卡片自适应宽度（不占满，凸显左右分支结构）；入/出两行展示调用的传入与返回
      '.fl-row{display:flex;min-width:0}',
      '.fl-node{max-width:520px;min-width:0;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-left-width:2px;border-radius:8px;padding:7px 10px;display:flex;flex-direction:column;gap:3px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));box-shadow:0 2px 8px rgba(0,0,0,.18)}',
      // 消息卡可点开详情（与工具卡同一交互）：手势 + 选中高亮
      '.fl-node[data-action]{cursor:pointer;transition:border-color .12s}',
      '.fl-node[data-action]:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      // 选中高亮：tint 叠在实色底上（直接用半透明 accent 底会被身后主干线穿透）
      '.fl-node.fl-on{border-color:var(--tb-accent-border,rgba(91,141,239,.6));background:linear-gradient(var(--tb-accent-bg,rgba(91,141,239,.08)),var(--tb-accent-bg,rgba(91,141,239,.08))),var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e))}',
      '.fl-model{flex:none;font-size:10px;font-family:ui-monospace,Consolas,monospace;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));background:var(--dsw-alias-bg-base,#17181d);border-radius:3px;padding:1px 5px}',
      '.fl-glyph{flex:none;font-size:9px;line-height:1;opacity:.9}',
      '.fl-node-head{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      '.fl-tag{flex:none;display:inline-flex;align-items:center;height:17px;padding:0 6px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.3px}',
      '.fl-time{flex:none;font-size:10.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-variant-numeric:tabular-nums}',
      '.fl-preview{font-size:12px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));max-width:500px}',
      // ▼ 箭头自带画布底色块：主干竖线从下方穿过时字形不被线划过
      // （不用整体 opacity——色块必须 100% 不透明才盖得住线；字形色与线同 token，箭头实一点正好突出）
      '.fl-arrow{flex:none;align-self:center;line-height:1;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:10px;background:var(--dsw-alias-bg-base,#17181d);padding:0 3px;border-radius:3px}',
      // 泳道内连接符：上=弹性空隙（::before 主干线透出，长短随行高自适应）+ ▼ 贴内容顶；下=对称弹性空间保持卡片居中
      '.fl-conn{flex:1;min-height:16px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-width:0}',
      '.fl-conn-gap{flex:1;min-height:4px}',
      // 流程图画布：bg-base 实色 + blueprint 网格线（中性灰蓝极低透明，明暗两主题均隐约可见；实色底防透明皮肤重影）
      '.jr-drawer [data-flow] .tb-pane-body{background:var(--dsw-alias-bg-base,#17181d);border-radius:8px;background-image:linear-gradient(rgba(128,138,150,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(128,138,150,.055) 1px,transparent 1px);background-size:22px 22px}',
      '.fl-par{flex:1;display:flex;flex-direction:column;gap:10px;min-width:0}',
      '.fl-name{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;font-weight:700;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fl-args{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // ---- 三列泳道（手绘参考图 2：左=子代理分支区 / 中=主干用户·助手 / 右=工具调用卡） ----
      '.fl-lane{display:grid;grid-template-columns:minmax(96px,140px) minmax(0,1fr) minmax(0,1.25fr);gap:0 10px;min-width:0;align-items:stretch}',
      '.fl-lane-main{min-width:0;display:flex;flex-direction:column;justify-content:center;position:relative}',
      // 主干竖线贯通：每行中列全高画线，且向下多延 4px 盖住容器行间距（gap:4px），行间首尾相接成一条连续线；
      // 卡片不透明底自然盖线、只在空隙露出；线色与 ▼ 箭头一致（text-3 + .7 透明度），2.5px
      '.fl-lane-main::before{content:"";position:absolute;left:calc(50% - 1.25px);top:0;bottom:-4px;width:2.5px;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));opacity:.7;z-index:0}',
      '.fl-lane-main>*{position:relative;z-index:1}',
      '.fl-lane-main .fl-node{max-width:none}',
      '.fl-lane-side{min-width:0;display:grid;grid-template-columns:84px minmax(0,1fr);gap:6px 8px;align-items:center}',
      // 并行调用组外框：同一步骤 >1 个调用时虚线框圈成一组，右上「并行 ×N」角标（底色盖边框）
      '.fl-lane-side.fl-grp{position:relative;border:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:10px;padding:10px 10px;margin:4px 0}',
      '.fl-grp-tag{position:absolute;top:-7px;right:10px;padding:0 5px;font-size:9px;line-height:13px;font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));background:var(--dsw-alias-bg-base,#17181d);border-radius:3px;letter-spacing:.3px}',
      '.fl-lane-line{width:2.5px;align-self:center;flex:1;min-height:26px;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));opacity:.7}',
      // 子代理分支块（左列）：height:0+min-height:100% 经典技巧——分支不参与行高计算（行高由中列主干决定），
      // 自身拉伸进行高：入口贴顶、支线步骤中间限高滚动、出口贴底（= 中列最后一张卡下缘，对齐语义）；卡片右缘伸横线向主干
      '.fl-subcol{display:flex;flex-direction:column;gap:5px;min-width:0;height:0;min-height:100%}',
      // 分支行保底高度：中列只有一根竖线时（孤立分支行）分支不被压没
      '.fl-lane:has(> .fl-subcol){min-height:120px}',
      '.fl-sub-card{position:relative;flex:none;border:1px solid var(--tb-accent-border,rgba(91,141,239,.45));border-radius:8px;padding:5px 8px;background:var(--tb-accent-bg,rgba(91,141,239,.08));display:flex;flex-direction:column;gap:3px;min-width:0;cursor:pointer}',
      '.fl-sub-card::after{content:"";position:absolute;right:-11px;top:50%;width:10px;height:1px;background:var(--tb-accent-border,rgba(91,141,239,.45))}',
      '.fl-sub-steps{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:3px 4px 3px 8px;margin-left:6px;border-left:1px dashed var(--tb-accent-border,rgba(91,141,239,.4))}',
      // 出口卡贴底（支线步骤区 flex 填充把出口压到底部，与返回后的主干卡对齐）
      '.fl-sub-close{margin-top:auto}',
      '.fl-sub-meta{display:flex;align-items:center;gap:6px}',
      '.fl-sub-step{display:flex;align-items:center;gap:4px;min-width:0;font-size:10.5px}',
      '.fl-sub-io{display:flex;align-items:baseline;gap:5px;font-family:ui-monospace,Consolas,monospace;font-size:10.5px;min-width:0}',
      '.fl-wp{display:flex;flex-direction:column;justify-content:center;gap:10px;min-width:0}',
      '.fl-wl{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.fl-wl-txt{font-family:ui-monospace,Consolas,monospace;font-size:9px;line-height:1.2;color:var(--tb-accent-text,#7fa7f0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fl-wl-row{display:flex;align-items:center;gap:3px;height:8px}',
      '.fl-wl-line{flex:1;height:1px;min-width:8px;background:var(--tb-accent-border,rgba(91,141,239,.45))}',
      '.fl-wl-arr{flex:none;font-size:7px;line-height:1;color:var(--tb-accent-border,rgba(91,141,239,.6))}',
      '.fl-wl-b .fl-wl-txt{color:var(--tb-done-text,#81c784)}',
      '.fl-wl-b .fl-wl-line{background:rgba(102,187,106,.45)}',
      '.fl-wl-b .fl-wl-arr{color:rgba(102,187,106,.6)}',
      '.fl-wl-err .fl-wl-txt{color:var(--tb-danger-text,#f28b82)}',
      '.fl-wl-err .fl-wl-line{background:rgba(239,83,80,.5)}',
      '.fl-wl-err .fl-wl-arr{color:rgba(239,83,80,.6)}',
      '.fl-wl-wait .fl-wl-txt{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-wl-wait .fl-wl-line{background:transparent;border-top:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650))}',
      '.fl-callside{min-width:0;display:flex;flex-direction:column;gap:4px;justify-content:center}',
      '.fl-iocard{width:auto;max-width:none;min-width:0;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:9px;padding:6px 10px;display:flex;flex-direction:column;gap:3px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.18);transition:border-color .12s,box-shadow .12s}',
      '.fl-iocard:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      '.fl-iocard.fl-on{border-color:var(--tb-accent-border,rgba(91,141,239,.6));background:var(--tb-accent-bg,rgba(91,141,239,.08))}',
      '.fl-iocard.fl-err{border-color:var(--tb-danger-border,rgba(239,83,80,.5))}',
      '.fl-live{border-color:var(--tb-accent-border,rgba(91,141,239,.65))!important;animation:flPulse 1.6s ease-in-out infinite}',
      // 运行中卡片：渐变流光贴边转圈（conic-gradient 环形遮罩 + 角度动画）。
      // @property 驱动角度 → 亮段沿边框流动；mask-composite 裁出 1.5px 描边环，内容不被遮。
      // 不支持 mask-composite / @property 的环境走 @supports 整体降级为原有脉冲。
      '.fl-live{position:relative}',
      '@supports (mask-composite: exclude) or (-webkit-mask-composite: xor){' +
        '.fl-live::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1.5px;' +
        'background:conic-gradient(from var(--fl-sweep,0deg),transparent 0deg,rgba(127,167,240,.9) 55deg,transparent 135deg);' +
        '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;' +
        'mask-composite:exclude;pointer-events:none;animation:flSweep 1.5s linear infinite}' +
        // 日模式（浅色）下加深加宽亮段，流光同样明显
        'body:not([data-ds-dark-theme]) .fl-live::before{' +
        'background:conic-gradient(from var(--fl-sweep,0deg),transparent 0deg,rgba(43,102,240,.95) 80deg,transparent 165deg)}' +
      '}',
      '@property --fl-sweep{syntax:"<angle>";initial-value:0deg;inherits:false}',
      '@keyframes flSweep{to{--fl-sweep:360deg}}',
      // LIVE 脉冲点（进行中调用卡头部，蓝图风）
      '.fl-live .fl-iohead::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--tb-done-text,#81c784);animation:flBlink 1.1s ease-in-out infinite}',
      // 助手卡进行中同款流光 + 脉冲点（与工具卡视觉一致）
      '.fl-live .fl-node-head::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--tb-done-text,#81c784);animation:flBlink 1.1s ease-in-out infinite}',
      '@keyframes flBlink{0%,100%{opacity:1}50%{opacity:.25}}',
      '@keyframes flPulse{0%,100%{box-shadow:0 0 0 1.5px var(--tb-accent-ring,rgba(91,141,239,.16))}50%{box-shadow:0 0 0 4px var(--tb-accent-ring,rgba(91,141,239,.16))}}',
      '.fl-iohead{display:flex;align-items:center;gap:6px;min-width:0}',
      '.fl-io-tag{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:3px;font-size:9px;font-weight:700}',
      // 卡片点击展开的完整详情（入=完整传入 JSON / 出=完整返回文本）
      '.fl-detail{display:flex;flex-direction:column;gap:6px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;padding:8px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));max-width:460px;margin-top:2px}',
      '.fl-sec{display:flex;flex-direction:column;gap:3px}',
      '.fl-sec-label{font-size:10px;font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));letter-spacing:.4px}',
      '.fl-pre{white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:10.5px;line-height:1.5;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:6px;padding:6px 8px;max-height:220px;overflow:auto;margin:0;background:var(--dsw-alias-bg-base,#17181d);color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-spin{flex:none;display:inline-block;width:10px;height:10px;border:1.5px solid var(--tb-accent-border,rgba(91,141,239,.35));border-top-color:var(--tb-accent,#3f6fd9);border-radius:50%;animation:tbSpin .7s linear infinite}',
      // ---- 调用详情右侧浮层（不插入流程流撑高内容——展开/收起零跳跃，关闭回原来位置）----
      '.fl-rail{position:absolute;right:0;top:0;bottom:0;width:min(320px,58%);display:flex;flex-direction:column;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));border-left:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));box-shadow:-8px 0 18px rgba(0,0,0,.24);z-index:4;border-radius:0 8px 8px 0}',
      // 动画只在展开动作那次渲染带（轮询重渲染不重播，防详情浮层闪烁）
      '.fl-rail-anim{animation:jrDrawerIn .16s ease-out}',
      '.fl-rail-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));font-size:11px;font-weight:600;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-rail-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace}',
      '.fl-rail-x{flex:none;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));cursor:pointer;border-radius:5px;padding:0;font-size:11px;font-family:inherit}',
      '.fl-rail-x:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-rail-body{flex:1;min-height:0;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px}',
      '.fl-branch-pill{flex:none;font-size:9.5px;padding:0 5px;border-radius:3px;background:rgba(91,141,239,.12);color:var(--tb-active-text,#7fa7f0);font-weight:600}',
      '.fl-branch-txt{flex:1;min-width:0;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fl-branch-ai{font-style:italic}',
    ].join('\n'))

    let open = false
    const listeners = new Set()
    function emit() { listeners.forEach((fn) => { try { fn() } catch (e) {} }) }
    const store = {
      isOpen() { return open },
      toggle() { open = !open; emit() },
      close() { open = false; emit() },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    }

    function useOpenState() {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((t) => t + 1)), [])
      return store.isOpen()
    }

    function Entry(props) {
      const isOpen = useOpenState()
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'tb-entry' + (isOpen ? ' tb-entry-active' : ''),
          title: '工具箱（工具集）',
          onClick: () => store.toggle(),
        },
        props.wide ? '工具箱' : '箱',
      )
    }

    // ===== 侧边栏导航入口（DOM 注入） =====
    // 侧边栏导航区（新会话 / 任务看板 / SSH 那一列）没有官方 Slot，任务看板与 dsh-ssh
    // 同样走 DOM 注入 + MutationObserver 自愈。条目插在「新会话」行之后的插件族块
    // （taskboard/ssh/toolbox）末尾——即 SSH 之后、工作区之前；族块相对定位保证多个
    // 自愈插件重插后顺序稳定。纯 DOM（不进 React 树），不会干扰宿主 reconciliation。
    const NAV_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="12" height="8.5" rx="1.5"/><path d="M5.5 5V3.8A1.3 1.3 0 0 1 6.8 2.5h2.4A1.3 1.3 0 0 1 10.5 3.8V5"/><path d="M2 8.2h12"/></svg>'
    const NAV_FAMILY_SEL = '[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-toolbox-entry]'

    function mountSidebarEntry() {
      function sidebarRoot() {
        const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
        if (!column) return undefined
        const logoRow = column.querySelector('[class*="logoRow"]')
        return (logoRow && logoRow.parentElement) || column.firstElementChild || undefined
      }
      function newSessionButton(root) {
        const nested = root.querySelector('button[class*="newSession"]')
        if (nested) return nested
        for (const child of root.children) {
          if (child.tagName === 'BUTTON') return child
        }
        return undefined
      }
      function placeEntry(root, entry) {
        const button = newSessionButton(root)
        if (!button) return false
        if (entry.parentElement !== root) {
          const row = button.closest('[class*="logoRow"]')
          const base = (row && row.parentElement === root) ? row : button
          const family = Array.prototype.filter.call(root.children, (el) => el.matches && el.matches(NAV_FAMILY_SEL))
          const anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling
          root.insertBefore(entry, anchor)
        }
        return true
      }

      const entry = document.createElement('button')
      entry.type = 'button'
      entry.setAttribute('data-dsh-toolbox-entry', '')
      entry.setAttribute('aria-label', '工具箱')
      entry.setAttribute('title', '工具箱')
      entry.innerHTML = '<span class="tb-nav-icon">' + NAV_ICON + '</span><span class="tb-nav-label">工具箱</span>'
      entry.addEventListener('click', () => store.toggle())

      let root
      let placed = false
      function tryPlace() {
        if (root && !root.isConnected) { rootObserver.disconnect(); root = undefined; placed = false }
        if (placed) {
          if (document.body.contains(entry)) return
          rootObserver.disconnect(); root = undefined; placed = false
        }
        if (!root) root = sidebarRoot()
        if (!root) return
        placed = placeEntry(root, entry)
        if (placed) rootObserver.observe(root, { childList: true, subtree: true })
      }

      // body 级 watcher：整棵侧边栏重建时兜底发现新 root
      const waitObserver = new MutationObserver(() => { tryPlace() })
      waitObserver.observe(document.body, { childList: true, subtree: true })
      // root 级 watcher：React 重渲染挤掉条目时同帧重插（微任务先于绘制，无闪烁）
      const rootObserver = new MutationObserver(() => {
        if (!root || !root.isConnected) { placed = false; tryPlace(); return }
        if (!root.contains(entry)) placed = placeEntry(root, entry)
      })

      const syncActive = () => {
        if (store.isOpen()) entry.setAttribute('data-active', 'true')
        else entry.removeAttribute('data-active')
      }
      const unsubscribe = store.subscribe(syncActive)
      syncActive()
      tryPlace()

      return () => {
        waitObserver.disconnect()
        rootObserver.disconnect()
        unsubscribe()
        entry.remove()
      }
    }

    const MIN_W = 360
    const MIN_H = 240
    const SNAP_THRESHOLD = 120
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

    const fetchTools = (root) => host.call('toolbox/tools', { root: root || undefined })
      .then((r) => (r && r.ok && Array.isArray(r.tools) ? r.tools : []))
      .catch(() => [])

    // ---- 抽屉几何与激活 Tab 本地记忆（localStorage；无 localStorage 的环境静默跳过）----
    const LS_KEY = 'dsh.toolbox.drawer'
    const lsRead = () => {
      try {
        if (typeof localStorage === 'undefined') return null
        const raw = localStorage.getItem(LS_KEY)
        if (!raw) return null
        const p = JSON.parse(raw)
        return p && typeof p === 'object' ? p : null
      } catch (e) { return null }
    }
    const lsWrite = (patch) => {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(lsRead() || {}, patch)))
      } catch (e) {}
    }

    // ---- 工具分类（导航第二行 + 管理树共用）：默认表 + 用户覆盖（localStorage 持久化；键 = 工具/清单条目 id） ----
    const TOOL_CATS = [
      { id: 'ai', label: 'AI' },
      { id: 'dev', label: '开发' },
      { id: 'session', label: '会话' },
      { id: 'system', label: '系统' },
    ]
    const DEFAULT_CAT = {
      aiassist: 'ai', aiusage: 'ai', quota: 'ai',
      jira: 'dev', git: 'dev', files: 'dev', http: 'dev', ports: 'dev', calc: 'dev',
      trace: 'session', usage: 'session', prompt: 'session', context: 'session', search: 'session', lineage: 'session', tools: 'session', flow: 'session', flowedit: 'session',
      toolbox: 'system', 'theme-teal': 'system', 'theme-amber': 'system', selfview: 'system',
    }
    const CATS_LS_KEY = 'dsh.toolbox.cats'
    // 抽屉导航临时记忆（客户端重载即清）：上次离开的 分类+工具；null = 重载后还没打开过抽屉
    let lastNav = null
    const catsRead = () => {
      try {
        if (typeof localStorage === 'undefined') return null
        const raw = localStorage.getItem(CATS_LS_KEY)
        if (!raw) return null
        const p = JSON.parse(raw)
        return p && typeof p === 'object' ? p : null
      } catch (e) { return null }
    }
    const catsWrite = (patch) => {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(CATS_LS_KEY, JSON.stringify(Object.assign(catsRead() || {}, patch)))
      } catch (e) {}
    }

    // 横向滚动行：滚轮纵转横。React 根节点的 wheel 监听是 passive（preventDefault 会告警且无效），故挂原生非 passive
    function HRow(props) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const node = ref.current
        if (!node) return undefined
        const onWheel = (e) => {
          if (!e.deltaY || e.deltaX) return
          node.scrollLeft += e.deltaY
          e.preventDefault()
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => { try { node.removeEventListener('wheel', onWheel) } catch (e) {} }
      }, [])
      return React.createElement('div', { className: props.className, ref }, props.children)
    }

    function Drawer(props) {
      const isOpen = useOpenState()
      // 三态停靠：right 右侧栏 / full 全占右侧（贴侧边栏右缘起占满）/ float 浮动
      // 兼容旧版 docked 布尔（docked:false → float；docked:true/无 → right）与已移除的 bottom → right
      const [dockMode, setDockMode] = React.useState(() => {
        const s = lsRead()
        if (s && (s.dockMode === 'right' || s.dockMode === 'full' || s.dockMode === 'float')) return s.dockMode
        return (s && s.docked === false) ? 'float' : 'right'
      })
      const docked = dockMode !== 'float' // 右/底都算停靠（不用浮动 pos）
      const setDocked = (v) => setDockMode(v ? 'right' : 'float') // 旧调用点兼容（吸附右边缘）
      const [pos, setPos] = React.useState(() => { const s = lsRead(); return s && s.pos && typeof s.pos.x === 'number' && typeof s.pos.y === 'number' ? s.pos : null })
      const [drag, setDrag] = React.useState(null)
      const [width, setWidth] = React.useState(() => { const s = lsRead(); return s && typeof s.width === 'number' ? s.width : null })
      const [height, setHeight] = React.useState(() => { const s = lsRead(); return s && typeof s.height === 'number' ? s.height : null })
      const [snapHint, setSnapHint] = React.useState(false)
      const [resize, setResize] = React.useState(null)
      const [tools, setTools] = React.useState([])
      const toolsRef = React.useRef([]) // 最新工具列表（延迟回调里判断 active 是否仍有效）
      toolsRef.current = tools
      const [active, setActive] = React.useState(() => { const s = lsRead(); return s && typeof s.active === 'string' ? s.active : null })
      const [autoMs, setAutoMs] = React.useState({}) // toolId -> 自动刷新毫秒（面板 HTML 声明 data-autorefresh 驱动）
      const [tabBadges, setTabBadges] = React.useState({}) // toolId -> Tab 角标文本（面板 HTML 声明 data-tab-badge 驱动；借鉴 better-sidebar tab 角标）
      const [html, setHtml] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [copied, setCopied] = React.useState(null)
      const [busyTool, setBusyTool] = React.useState(null)
      const [managing, setManaging] = React.useState(false)
      const [plugins, setPlugins] = React.useState([])
      const [rebuilding, setRebuilding] = React.useState(false)
      const [rebuildLines, setRebuildLines] = React.useState(null)
      const [rebuildHistory, setRebuildHistory] = React.useState([])
      const [aiUsage, setAiUsage] = React.useState(null)
      const [pluginFilter, setPluginFilter] = React.useState('')
      const [hideHostOnly, setHideHostOnly] = React.useState(false) // 管理页「隐藏无界面工具」开关（Host-only 无 Client 半）
      const [tabFilter, setTabFilter] = React.useState('') // 工具搜索（整行长条；仅会话内存）
      const [cat, setCat] = React.useState(() => { const s = lsRead(); return s && typeof s.cat === 'string' ? s.cat : 'ai' }) // 激活分类（localStorage 记忆）
      const [activeByCat, setActiveByCat] = React.useState(() => { const s = lsRead(); return (s && s.activeByCat && typeof s.activeByCat === 'object') ? s.activeByCat : {} }) // 各分类最近选中的工具（切分类时恢复）
      const [catOverrides, setCatOverrides] = React.useState(() => { const s = catsRead(); return (s && s.overrides && typeof s.overrides === 'object') ? s.overrides : {} }) // 管理树拖拽改归属的结果
      const [collapsedCats, setCollapsedCats] = React.useState(() => { const s = catsRead(); return (s && s.collapsed && typeof s.collapsed === 'object') ? s.collapsed : {} })
      const [dragId, setDragId] = React.useState(null) // 管理树正在拖拽的条目 id（entryId）
      // 明暗主题：theme 服务持有偏好；ThemeSnapshot 无顶层 colorScheme，生效明暗在 snapshot.active.colorScheme
      const schemeOf = (snap) => {
        const c = snap && snap.active && snap.active.colorScheme
        if (c === 'dark' || c === 'light') return c
        const top = snap && snap.colorScheme
        return (top === 'dark' || top === 'light') ? top : null
      }
      const [themeScheme, setThemeScheme] = React.useState(() => {
        try { return (themeSvc && schemeOf(themeSvc.getTheme())) || 'dark' } catch (e) { return 'dark' }
      })
      React.useEffect(() => {
        if (!themeSvc) return undefined
        const off = ctx.on('theme/change', (snap) => {
          try { const c = schemeOf(snap); if (c) setThemeScheme(c) } catch (e) {}
        })
        return typeof off === 'function' ? off : undefined
      }, [])
      const toggleTheme = () => {
        if (!themeSvc) return
        try {
          const cur = schemeOf(themeSvc.getTheme()) || themeScheme
          themeSvc.setTheme(cur === 'dark' ? 'light' : 'dark')
        } catch (e) {}
      }

      // ---- 画中画（Document PiP）：主抽屉 DOM 的实时镜像（不是独立实现） ----
      // 原则：主抽屉 React 树是唯一事实源；pip 窗口显示其 DOM 克隆（MutationObserver debounce 同步），
      // 交互事件按索引路径代理回主 DOM 触发——两种模式显示与行为完全一致；
      // 主抽屉全程照常运行（轮询/状态不受影响）；pip 未开启时零开销、零影响。
      const pipRef = React.useRef(null) // { win, mo, syncTimer, themeOff, enlarged, baseW, baseH } | null
      const [pipOn, setPipOn] = React.useState(false)
      const [mainHidden, setMainHidden] = React.useState(false) // pip 期间主抽屉可视觉隐藏（DOM 存活：镜像源与轮询不断）
      const pipSupported = typeof window !== 'undefined' && Boolean(window.documentPictureInPicture)
      const closePip = () => {
        const cur = pipRef.current
        pipRef.current = null
        setPipOn(false)
        setMainHidden(false)
        if (!cur) return
        try { if (cur.mo) cur.mo.disconnect() } catch (e) {}
        try { if (cur.syncTimer) clearTimeout(cur.syncTimer) } catch (e) {}
        try { if (typeof cur.themeOff === 'function') cur.themeOff() } catch (e) {}
        try { cur.win.close() } catch (e) {}
      }
      // 侧边栏重新点开抽屉 → 取消视觉隐藏；抽屉被真正关闭 → 联动关 pip（镜像源消失）
      React.useEffect(() => {
        if (isOpen && mainHidden) setMainHidden(false)
        if (!isOpen && pipRef.current) closePip()
      }, [isOpen])
      // 组件卸载/插件重跑 → 必关 pip（防孤儿窗）
      React.useEffect(() => () => {
        const cur = pipRef.current
        pipRef.current = null
        if (!cur) return
        try { if (cur.mo) cur.mo.disconnect() } catch (e) {}
        try { if (cur.syncTimer) clearTimeout(cur.syncTimer) } catch (e) {}
        try { cur.win.close() } catch (e) {}
      }, [])

      // 索引路径：镜像内元素 ↔ 主抽屉元素（cloneNode 同构，children 索引一一对应）
      const pathOf = (el, root) => {
        const p = []
        let n = el
        while (n && n !== root) {
          const parent = n.parentElement
          if (!parent) return null
          p.unshift(Array.prototype.indexOf.call(parent.children, n))
          n = parent
        }
        return n === root ? p : null
      }
      const byPath = (root, path) => {
        let n = root
        for (const i of path) {
          if (!n || !n.children || i >= n.children.length) return null
          n = n.children[i]
        }
        return n
      }

      const openPip = async () => {
        if (pipRef.current) { closePip(); return }
        if (!pipSupported) return
        const src0 = drawerRef.current
        if (!src0) return
        try {
          const win = await window.documentPictureInPicture.requestWindow({ width: Math.max(560, width || 520), height: Math.round((window.screen ? window.screen.availHeight : 900) * 0.8) })
          // 1. 克隆样式表（link 克隆 / style 标签深克隆；tb- 设计系统与宿主 dsw- 变量一并带走）
          for (const sheet of document.styleSheets) {
            try {
              if (sheet.href) { const l = win.document.createElement('link'); l.rel = 'stylesheet'; l.href = sheet.href; win.document.head.appendChild(l) }
              else if (sheet.ownerNode) win.document.head.appendChild(sheet.ownerNode.cloneNode(true))
            } catch (e) {}
          }
          // 2. 主题同步（body[data-ds-dark-theme] + colorScheme；theme/change 跟随）
          const syncTheme = () => {
            try {
              const dark = document.body.hasAttribute('data-ds-dark-theme')
              win.document.body.toggleAttribute('data-ds-dark-theme', dark)
              win.document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
            } catch (e) {}
          }
          syncTheme()
          win.document.title = '工具箱 · 画中画'
          win.document.body.style.margin = '0'
          // 3. 结构：顶部工具条（pip 原生，非镜像）+ 镜像容器
          const rootEl = win.document.createElement('div')
          rootEl.className = 'jr-pip-root'
          const barEl = win.document.createElement('div')
          barEl.className = 'jr-pip-bar'
          const barTitle = win.document.createElement('span')
          barTitle.className = 'jr-pip-bar-title'
          barTitle.textContent = '工具箱 · 画中画（内容与主窗口一致，操作实时同步）'
          const btnMax = win.document.createElement('button')
          btnMax.className = 'jr-pip-bar-btn'
          btnMax.textContent = '⤢ 放大'
          btnMax.title = '放大到屏幕 72%×88%（再点还原）'
          const btnBack = win.document.createElement('button')
          btnBack.className = 'jr-pip-bar-btn'
          btnBack.textContent = '✕ 回主窗口'
          btnBack.title = '关闭画中画，回主窗口抽屉'
          barEl.appendChild(barTitle)
          barEl.appendChild(btnMax)
          barEl.appendChild(btnBack)
          const mirrorEl = win.document.createElement('div')
          mirrorEl.className = 'jr-pip-mirror'
          rootEl.appendChild(barEl)
          rootEl.appendChild(mirrorEl)
          win.document.body.appendChild(rootEl)
          const entry = { win, mo: null, syncTimer: null, themeOff: null, enlarged: false, baseW: 0, baseH: 0 }
          pipRef.current = entry
          setPipOn(true)
          // 4. 镜像同步（整体重克隆 + 滚动/焦点恢复；MutationObserver debounce 合并突变批次）
          const resync = () => {
            if (pipRef.current !== entry) return
            const src = drawerRef.current
            if (!src) return
            const scrolls = []
            try {
              const ss = mirrorEl.querySelectorAll('.tb-pane-body, .tb-code, .fl-pre, .tb-desc, .jr-drawer-body, .tb-hrow')
              for (const s of ss) {
                const p = pathOf(s, mirrorEl)
                if (p) scrolls.push([p, s.scrollTop, s.scrollLeft])
              }
            } catch (e) {}
            let focusPath = null, selStart = null, selEnd = null
            try {
              const ae = win.document.activeElement
              if (ae && mirrorEl.contains(ae)) {
                focusPath = pathOf(ae, mirrorEl)
                if (typeof ae.selectionStart === 'number') { selStart = ae.selectionStart; selEnd = ae.selectionEnd }
              }
            } catch (e) {}
            const clone = src.cloneNode(true)
            // 脱离 fixed 外壳语义（充满 pip 窗口）；主抽屉被视觉隐藏时镜像保持可见
            clone.style.position = 'static'
            clone.style.left = 'auto'; clone.style.right = 'auto'; clone.style.top = 'auto'; clone.style.bottom = 'auto'
            clone.style.width = '100%'; clone.style.height = '100%'
            clone.style.maxWidth = 'none'; clone.style.maxHeight = 'none'
            clone.style.animation = 'none'; clone.style.boxShadow = 'none'; clone.style.borderRadius = '0'; clone.style.border = 'none'
            clone.style.visibility = 'visible'; clone.style.pointerEvents = 'auto'
            mirrorEl.innerHTML = ''
            mirrorEl.appendChild(clone)
            try { for (const [p, st, sl] of scrolls) { const el = byPath(mirrorEl, p); if (el) { el.scrollTop = st; el.scrollLeft = sl } } } catch (e) {}
            if (focusPath) {
              try {
                const el = byPath(mirrorEl, focusPath)
                if (el && typeof el.focus === 'function') {
                  el.focus()
                  if (selStart != null && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(selStart, selEnd) } catch (e2) {} }
                }
              } catch (e) {}
            }
          }
          resync()
          entry.mo = new MutationObserver(() => {
            if (entry.syncTimer) clearTimeout(entry.syncTimer)
            entry.syncTimer = setTimeout(() => { entry.syncTimer = null; resync() }, 40)
          })
          entry.mo.observe(src0, { subtree: true, childList: true, attributes: true, characterData: true })
          // 5. 事件代理（镜像 → 主 DOM）：click/input/change/keydown 按索引路径回放，
          //    React 合成事件在主端 root 正常触发；pip 端 preventDefault 防双重状态
          const relay = (e) => {
            const t = e.target
            if (!t || !mirrorEl.contains(t)) return
            const p = pathOf(t, mirrorEl)
            const src = drawerRef.current
            if (!p || !src) return
            const main = byPath(src, p)
            if (!main) return
            if (e.type === 'click') {
              e.preventDefault()
              main.click()
            } else if (e.type === 'input') {
              try {
                const proto = main.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
                const desc = Object.getOwnPropertyDescriptor(proto, 'value')
                if (desc && desc.set) desc.set.call(main, t.value)
                else main.value = t.value
                main.dispatchEvent(new Event('input', { bubbles: true }))
              } catch (err) {}
            } else if (e.type === 'change') {
              try {
                if (main.tagName === 'SELECT') {
                  main.value = t.value
                  main.dispatchEvent(new Event('change', { bubbles: true }))
                } else if (main.type === 'checkbox' || main.type === 'radio') {
                  main.click()
                } else {
                  main.value = t.value
                  main.dispatchEvent(new Event('change', { bubbles: true }))
                }
              } catch (err) {}
            } else if (e.type === 'keydown') {
              try { main.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true })) } catch (err) {}
            }
          }
          for (const type of ['click', 'input', 'change', 'keydown']) mirrorEl.addEventListener(type, relay)
          // 6. 工具条：放大/还原（resizeTo + moveTo 居中）；回主窗口
          btnBack.onclick = () => closePip()
          btnMax.onclick = () => {
            try {
              if (!entry.enlarged) {
                entry.baseW = win.outerWidth; entry.baseH = win.outerHeight
                const sw = window.screen ? window.screen.availWidth : 1600
                const sh = window.screen ? window.screen.availHeight : 900
                const w = Math.round(sw * 0.72), h = Math.round(sh * 0.88)
                win.resizeTo(w, h)
                win.moveTo(Math.round((sw - w) / 2), Math.round((sh - h) / 2))
                entry.enlarged = true
                btnMax.textContent = '⤡ 还原'
              } else {
                win.resizeTo(entry.baseW || 560, entry.baseH || 620)
                entry.enlarged = false
                btnMax.textContent = '⤢ 放大'
              }
            } catch (err) {}
          }
          // 7. 主题跟随 + pip 窗口被关（系统 X）→ 释放
          if (themeSvc) entry.themeOff = ctx.on('theme/change', () => syncTheme())
          win.addEventListener('pagehide', () => {
            if (pipRef.current === entry) { pipRef.current = null; setPipOn(false); setMainHidden(false) }
            if (entry.syncTimer) { try { clearTimeout(entry.syncTimer) } catch (e) {} }
            if (entry.mo) { try { entry.mo.disconnect() } catch (e) {} }
            if (typeof entry.themeOff === 'function') { try { entry.themeOff() } catch (e) {} }
          })
          // 并存模型：不关主抽屉（它是镜像事实源，轮询照跑）；用户可点主抽屉 X 仅视觉隐藏（mainHidden）
        } catch (e) {}
      }
      const drawerRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const stateRef = React.useRef({})
      const htmlRef = React.useRef({})
      const htmlScrollRef = React.useRef(null) // 静默刷新前记录的滚动位置（effect 里恢复，防自动刷新打断阅读）
      const seqRef = React.useRef({}) // toolId -> 最新请求序号：丢弃过期响应，防 provider/模型联动竞态
      const managingRef = React.useRef(false)
      managingRef.current = managing
      const activeRef = React.useRef(null) // 延迟回调里取最新 active（重启落定后的面板刷新）
      activeRef.current = active

      // 停靠模式/激活 Tab/分类工具记忆变化即落盘（宽/高/浮动位置在手势结束时单独落盘，避免每帧写）
      React.useEffect(() => { lsWrite({ dockMode, active, activeByCat }) }, [dockMode, active, activeByCat])

      // 挤压三栏：full 模式给主内容列（DSH grid 的 centerCol）加 margin-right 让出抽屉宽度，
      // 聊天区收缩而非被覆盖（grid 项 margin 在轨道内生效，不影响侧边栏轨道）；
      // 关闭抽屉/切模式还原，拖拽调宽实时跟随；React 不管该列内联 style，不会被覆盖
      React.useEffect(() => {
        if (!isOpen || dockMode !== 'full') return undefined
        const col = typeof document !== 'undefined' ? document.querySelector('[class*="centerCol"]') : null
        if (!col) return undefined
        const w = width || 560
        const prev = col.style.marginRight
        col.style.marginRight = w + 'px'
        return () => { col.style.marginRight = prev }
      }, [isOpen, dockMode, width])

      // 静默刷新后恢复滚动位置（loadPanel 在 setHtml 前把各滚动容器 scrollTop 记进 htmlScrollRef）
      React.useEffect(() => {
        if (!panelRef.current) return
        const saved = htmlScrollRef.current
        htmlScrollRef.current = null
        if (saved && saved.tool === activeRef.current) {
          try {
            const scrollers = panelRef.current.querySelectorAll('.tb-pane-body, .tb-code, .fl-pre, .tb-desc')
            scrollers.forEach((s, i) => { if (i < saved.scrolls.length) s.scrollTop = saved.scrolls[i] })
          } catch (e) {}
          return
        }
        // 切工具/新面板不恢复旧位置：正常方向（tb-pane-col）容器默认滚到最底查看
        // （上下文/提示词/搜索/Jira/谱系等；column-reverse 面板天然贴底，无需处理）
        try {
          panelRef.current.querySelectorAll('.tb-pane-body.tb-pane-col').forEach((s) => { s.scrollTop = s.scrollHeight })
        } catch (e) {}
      }, [html])

      // 「回到最新」浮标：面板滚动容器不在底部时显示；scroll 不冒泡，挂容器捕获阶段（innerHTML 重渲不影响）
      // 依赖含 html：切管理视图/Tab 后 .tb-frame 是新建 DOM 节点，必须重新挂监听器（只挂 isOpen 会挂在已销毁节点上，浮标失效）
      const [showJump, setShowJump] = React.useState(false)
      React.useEffect(() => {
        if (!isOpen) return undefined
        const root = panelRef.current
        if (!root) return undefined
        const onScroll = (e) => {
          const t = e.target
          if (!t || !t.classList || !t.classList.contains('tb-pane-body')) return
          // column-reverse：底部 scrollTop=0 向上为负；正常方向（tb-pane-col）：底部 scrollTop+clientHeight≈scrollHeight
          const away = t.classList.contains('tb-pane-col')
            ? (t.scrollHeight - t.scrollTop - t.clientHeight > 40)
            : (t.scrollTop < -40)
          setShowJump(away)
        }
        root.addEventListener('scroll', onScroll, true)
        return () => { try { root.removeEventListener('scroll', onScroll, true) } catch (e) {} }
      }, [isOpen, html])
      const jumpToLatest = () => {
        const s = panelRef.current && panelRef.current.querySelector('.tb-pane-body')
        if (s) s.scrollTo({ top: s.classList.contains('tb-pane-col') ? s.scrollHeight : 0, behavior: 'smooth' })
      }

      const currentCwd = props.useSessions((s) => {
        if (!s || !s.current) return undefined
        const row = s.byId && s.byId[s.current]
        return row && typeof row.cwd === 'string' && row.cwd ? row.cwd : undefined
      })
      const currentSessionId = props.useSessions((s) => (s && s.current ? String(s.current) : undefined))
      // cwd 用 ref 固定：1.5s 轮询 interval 持有旧闭包，读取 ref 才能跟随「切工作区」拿到最新激活 cwd
      const cwdRef = React.useRef(currentCwd)
      cwdRef.current = currentCwd
      // 会话上下文检测：记录「上次已处理过」的 cwd 与 session id（只在 effect 内更新，
      // 不随渲染赋值——否则 effect 里比较恒等永远不会触发）
      const handledCwdRef = React.useRef(currentCwd || '')
      const handledSessionRef = React.useRef(currentSessionId || '')

      function collectFields() {
        const fields = {}
        const box = panelRef.current
        if (!box) return fields
        const nodes = box.querySelectorAll('[data-field]')
        for (const el of nodes) {
          const name = el.getAttribute('data-field')
          if (name) fields[name] = el.value == null ? '' : String(el.value)
        }
        return fields
      }

      async function loadPanel(toolId, action, el, opts) {
        if (!toolId) { setHtml(null); return }
        const silent = Boolean(opts && opts.silent) // 静默刷新（自动轮询）：不转圈、不清错误
        const seq = (seqRef.current[toolId] || 0) + 1
        seqRef.current[toolId] = seq
        if (!silent) setBusyTool(toolId)
        if (!silent) setError(null)
        // 联动切换在途锁定：禁用面板内 select，避免在陈旧 DOM 上继续操作（成功响应会整体重渲染解锁）
        let locked = null
        const unlock = () => { if (locked) for (const s of locked) { try { s.disabled = false } catch (e) {} } }
        try {
          let fields = collectFields()
          if (el) {
            // 点击元素自身的 data-* 属性随请求带回（data-key / data-hash / data-path 等）
            const ds = el.dataset || {}
            const d = {}
            for (const k of Object.keys(ds)) d[k] = ds[k]
            fields = { ...fields, __el: d }
          }
          if (opts && opts.lockSelects) {
            const box = panelRef.current
            if (box) {
              locked = [...box.querySelectorAll('select:not([disabled])')]
              for (const s of locked) s.disabled = true
            }
          }
          const res = await host.call('toolbox/panel', {
            tool: toolId,
            action: action || '',
            fields,
            state: stateRef.current[toolId] || null,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
          })
          if (seqRef.current[toolId] !== seq) return // 已有更新的请求发出：过期响应直接丢弃（联动切换竞态修复）；DOM 由新请求的响应接管
          if (res && res.ok) {
            stateRef.current[toolId] = res.state
            htmlRef.current[toolId] = res.html
            // 任何动作都保存滚动位置（自动轮询/展开详情/提交等）：全量 innerHTML 重渲染会丢滚动/选择，
            // 先记录各可滚动子容器 scrollTop 与所属工具，setHtml 后经 effect 恢复（切工具不恢复）
            if (panelRef.current) {
              try {
                const scrolls = []
                const scrollers = panelRef.current.querySelectorAll('.tb-pane-body, .tb-code, .fl-pre, .tb-desc')
                for (const s of scrollers) scrolls.push(s.scrollTop)
                htmlScrollRef.current = { tool: toolId, scrolls }
              } catch (e) {}
            }
            setHtml(res.html)
            // 自动刷新约定：工具 HTML 带 data-autorefresh="ms" → 抽屉静默定时重拉（静默 = 不转圈）
            const am = /data-autorefresh="(\d+)"/.exec(res.html)
            setAutoMs((cur) => {
              const has = Object.prototype.hasOwnProperty.call(cur, toolId)
              if (am) {
                const ms = Math.max(1500, parseInt(am[1], 10) || 2000)
                if (has && cur[toolId] === ms) return cur
                return { ...cur, [toolId]: ms }
              }
              if (!has) return cur
              const next = { ...cur }
              delete next[toolId]
              return next
            })
            // Tab 角标约定：工具 HTML 带 data-tab-badge="文本" → 该工具 Tab 显示角标（空字符串=清除）
            const bm = /data-tab-badge="([^"]{0,12})"/.exec(res.html)
            setTabBadges((cur) => {
              const has = Object.prototype.hasOwnProperty.call(cur, toolId)
              const val = bm ? bm[1] : null
              if (val) {
                if (has && cur[toolId] === val) return cur
                return { ...cur, [toolId]: val }
              }
              if (!has) return cur
              const next = { ...cur }
              delete next[toolId]
              return next
            })
            // copy 契约：Host 附带 copy 字符串 → 写剪贴板并短暂提示
            if (typeof res.copy === 'string' && res.copy) {
              try {
                if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                  await navigator.clipboard.writeText(res.copy)
                  setCopied('已复制 ' + res.copy.length + ' 字符')
                } else {
                  setCopied('当前环境无剪贴板 API')
                }
              } catch (e) {
                setCopied('复制失败: ' + String((e && e.message) || e))
              }
            } else {
              setCopied(null)
            }
          } else {
            unlock() // 失败未重渲染：恢复 select 可用
            setError((res && res.error) || '面板加载失败')
          }
        } catch (e) {
          if (seqRef.current[toolId] === seq) {
            unlock() // 异常未重渲染：恢复 select 可用
            setError('面板请求异常: ' + String((e && e.message) || e))
          }
        } finally {
          if (seqRef.current[toolId] === seq) setBusyTool((cur) => (cur === toolId ? null : cur))
        }
      }
      // loadPanel 的最新引用：原生 change 监听只挂一次，经 ref 调用避免闭包捕获过期渲染帧
      const loadPanelRef = React.useRef(null)
      loadPanelRef.current = loadPanel

      // 关键修复：面板是 dangerouslySetInnerHTML 注入的裸 DOM，其中的 <select> 没有 React fiber；
      // React 18 ChangeEventPlugin 只在「目标是 React 受管的 select/input」时派发合成 onChange
      // （裸 DOM select 取到最近祖先纤维 = 容器 div，shouldUseChangeEvent(div)=false ⇒ 永不派发），
      // 所以容器上的 onChange 属性对面板内 select 永远不触发（点击/键盘事件无此目标类型检查，不受影响）。
      // 原生 change 事件正常冒泡——改在抽屉根节点挂原生监听（随抽屉关闭卸载、重开重挂）。
      React.useEffect(() => {
        if (!isOpen) return undefined
        const root = drawerRef.current
        if (!root) return undefined
        const onNativeChange = (e) => {
          const t = e.target
          const el = t && t.closest ? t.closest('[data-action-onchange]') : null
          if (!el) return
          const box = panelRef.current
          if (!box || !box.contains(el)) return // 仅面板内控件（排除壳自身的 React 表单输入）
          const tool = activeRef.current
          if (!tool || typeof loadPanelRef.current !== 'function') return
          // 联动切换在途锁定面板内 select（lockSelects），避免在陈旧 DOM 上连续操作
          loadPanelRef.current(tool, el.getAttribute('data-action-onchange') || '', el, { lockSelects: true })
        }
        root.addEventListener('change', onNativeChange)
        return () => { try { root.removeEventListener('change', onNativeChange) } catch (err) {} }
      }, [isOpen])

      async function refreshTools() {
        const list = await fetchTools(cwdRef.current)
        setTools(list)
        // 无有效记忆时的默认 Tab：会话「流程」（用户指定）；没有 flow 才退到列表第一个。
        // 分类芯片必须同步切到目标工具的分类（flow 在「会话」），否则面板与 Tab 栏错位
        const cur = activeRef.current
        if (cur && list.some((t) => t.id === cur)) return
        const flow = list.find((t) => t.id === 'flow')
        const target = flow ? flow.id : (list.length ? list[0].id : null)
        if (target && catOf(target) !== cat) setCat(catOf(target))
        setActive(target)
      }

      // ===== 插件生命周期开关（齿轮管理视图）：直连 Host 半 toolbox/plugins + toolbox/plugin-toggle =====
      async function refreshPlugins() {
        try {
          const r = await host.call('toolbox/plugins', { session: currentSessionId || undefined })
          setPlugins(r && r.ok && Array.isArray(r.plugins) ? r.plugins : [])
        } catch (e) {}
      }

      async function togglePlugin(p) {
        if (p.hasClientHalf) return
        setError(null)
        try {
          const r = await host.call('toolbox/plugin-toggle', {
            pluginId: p.pluginId,
            enable: !p.running,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
          })
          if (r && !r.ok) setError(r.error || '插件操作失败')
        } catch (e) {
          setError('插件操作异常: ' + String((e && e.message) || e))
        }
        refreshPlugins()
        refreshTools() // 停止 → 注册表级联移除 Tab；启动 → 500ms 重试注册后自动回来
      }

      // 重跑类操作后的落定刷新：等注册表 500ms 重试周期过后再拉工具列表并重载当前面板——
      // 立即刷新会撞上「工具暂缺」窗口（registry 已清空、心跳未重挂），把 active Tab 挤走或报未注册
      function settleAfterRestart() {
        ctx.timeout(() => {
          refreshTools()
          const t = activeRef.current
          if (t) loadPanel(t, '', null)
        }, 700)
      }

      // 重跑单个插件：桩重读磁盘 impl，改完代码点这个即生效
      async function restartPlugin(p) {
        if (p.hasClientHalf) return
        setError(null)
        try {
          const r = await host.call('toolbox/plugin-restart', {
            pluginId: p.pluginId,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
          })
          if (r && !r.ok) setError(r.error || '插件重跑失败')
        } catch (e) {
          setError('插件重跑异常: ' + String((e && e.message) || e))
        }
        refreshPlugins()
        settleAfterRestart()
      }

      // 批量启停：Host-only 插件一次全停/全启，启停记忆统一落盘
      async function toggleAll(enable) {
        setError(null)
        try {
          const r = await host.call('toolbox/plugin-toggle-all', { enable, root: currentCwd || undefined, session: currentSessionId || undefined })
          const lines = []
          if (!r) lines.push('批量操作无响应')
          else {
            if (r.error) lines.push('✗ ' + r.error)
            if (Array.isArray(r.done) && r.done.length) lines.push((enable ? '已启动: ' : '已停止: ') + r.done.join('、'))
            if (Array.isArray(r.skippedClient) && r.skippedClient.length) lines.push('跳过（含 Client 半，需到 Cordis 面板）: ' + r.skippedClient.join('、'))
            if (Array.isArray(r.failed) && r.failed.length) lines.push('失败: ' + r.failed.join('；'))
            if (lines.length === 0) lines.push('没有可操作的插件')
          }
          setRebuildLines(lines)
        } catch (e) {
          setRebuildLines(['批量操作异常: ' + String((e && e.message) || e)])
        }
        refreshPlugins()
        refreshTools()
      }

      // 「重启后」pill 点击：只改启停记忆（下次重建的默认启停），不动当前运行态
      async function setDefaultPlugin(p) {
        if (p.defaultStart == null) return // 不在 plugins.json 清单内，无条目可记
        setError(null)
        try {
          const r = await host.call('toolbox/plugin-set-default', {
            pluginId: p.pluginId,
            enabled: !p.defaultStart,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
          })
          if (r && !r.ok) setError(r.error || '默认启停设置失败')
        } catch (e) {
          setError('默认启停设置异常: ' + String((e && e.message) || e))
        }
        refreshPlugins()
      }

      // 批量重跑：运行中的 Host-only 插件全部重启（桩重读磁盘 impl）——改完多个工具一键生效
      async function restartAll() {
        setError(null)
        try {
          const r = await host.call('toolbox/plugin-restart-all', { root: currentCwd || undefined, session: currentSessionId || undefined })
          const lines = []
          if (!r) lines.push('批量重跑无响应')
          else {
            if (r.error) lines.push('✗ ' + r.error)
            if (Array.isArray(r.done) && r.done.length) lines.push('已重跑: ' + r.done.join('、') + '（面板大本体如预览/diff 已随闭包重置）')
            if (Array.isArray(r.skippedClient) && r.skippedClient.length) lines.push('跳过（含 Client 半，需到 Cordis 面板）: ' + r.skippedClient.join('、'))
            if (Array.isArray(r.failed) && r.failed.length) lines.push('失败: ' + r.failed.join('；'))
            if (lines.length === 0) lines.push('没有运行中的 Host-only 插件')
          }
          setRebuildLines(lines)
        } catch (e) {
          setRebuildLines(['批量重跑异常: ' + String((e && e.message) || e)])
        }
        refreshPlugins()
        settleAfterRestart()
      }

      // 重建耗时历史（迷你柱状图）
      async function loadRebuildHistory() {
        try {
          const r = await host.call('toolbox/rebuild-history')
          setRebuildHistory(r && r.ok && Array.isArray(r.history) ? r.history : [])
        } catch (e) {}
      }

      // AI 用量台账聚合（管理视图总行）
      async function loadAiUsage() {
        try {
          const r = await host.call('toolbox/ai-usage')
          setAiUsage(r && r.ok ? r : null)
        } catch (e) {}
      }

      // 自举重建：框架读磁盘 payload.json 批量 define+run（幂等，已定义的跳过）
      async function runRebuild() {
        setRebuilding(true)
        setError(null)
        try {
          const r = await host.call('toolbox/rebuild', { root: currentCwd || undefined, session: currentSessionId || undefined })
          const lines = []
          if (!r) lines.push('重建请求无响应')
          else {
            if (r.error) lines.push('✗ ' + r.error)
            if (Array.isArray(r.defined) && r.defined.length) lines.push('新定义: ' + r.defined.join('、'))
            if (Array.isArray(r.started) && r.started.length) lines.push('已启动: ' + r.started.join('、'))
            if (Array.isArray(r.skipped) && r.skipped.length) lines.push('跳过（已定义/框架自身）: ' + r.skipped.join('、'))
            if (Array.isArray(r.suppressed) && r.suppressed.length) lines.push('保持关闭（启停记忆）: ' + r.suppressed.join('、'))
            if (Array.isArray(r.failed) && r.failed.length) lines.push('失败: ' + r.failed.join('；'))
            if (typeof r.ms === 'number') lines.push('耗时: ' + r.ms + 'ms（payload 读盘 + define + run 串行）')
            if (lines.length === 0) lines.push('plugins.json 内插件均已存在，无需重建')
          }
          setRebuildLines(lines)
        } catch (e) {
          setRebuildLines(['重建异常: ' + String((e && e.message) || e)])
        } finally {
          setRebuilding(false)
        }
        loadRebuildHistory()
        refreshPlugins()
        refreshTools()
      }

      React.useEffect(() => {
        // 轮询减负：plugins 清单只有管理视图需要——普通模式只刷 tools（RPC  chatter 减半）
        const disp = ctx.interval(() => { if (store.isOpen()) { refreshTools(); if (managingRef.current) refreshPlugins() } }, 1500)
        // 抽屉打开时的导航恢复（用户指定）：重载后「第一次」打开 → 默认 会话+流程；之后打开 →
        // 恢复上次离开的 分类+工具（lastNav 临时记录）。两路都同步分类芯片与工具 Tab，防面板/Tab 栏错位。
        const offOpen = store.subscribe(() => {
          if (!store.isOpen()) return
          const remembered = lastNav && lastNav.active
          // 有记忆恢复记忆（工具已停则由 refreshTools 兜底回默认并同步分类）；无记忆默认 会话+流程
          if (remembered) { setCat(catOf(remembered)); setActive(remembered) }
          else { setCat(catOf('flow')); setActive('flow') }
          refreshTools(); refreshPlugins()
        })
        refreshTools()
        refreshPlugins()
        return () => { try { disp() } catch (e) {} offOpen() }
      }, [])

      // 会话/工作区切换跟随：当前会话的 cwd 或 session id 任一变化 = 切会话或切工作区。
      // 两个仓库工具 id 同名时 refreshTools 的「active 保持」分支不会重载面板，且 loadPanel
      // 只在 active 变化时触发——切会话（同工作区或跨工作区）active 不变，面板仍显示旧会话
      // 内容（如 flow 流程图）。这里清掉缓存并强制重拉当前面板（带新 session 参数）。
      React.useEffect(() => {
        const cwd = currentCwd || ''
        const sid = currentSessionId || ''
        if (!sid) return
        if (handledCwdRef.current === cwd && handledSessionRef.current === sid) return
        const cwdChanged = handledCwdRef.current !== cwd
        const sidChanged = handledSessionRef.current !== sid
        handledCwdRef.current = cwd
        handledSessionRef.current = sid
        // 清会话级缓存（cwd 或 sid 任一变化）：工具的 st.sid 是会话级 state（flow/trace 等
        // 优先 st.sid 渲染），切会话不清理会沿用旧会话 id——必须清空让工具从新会话重算。
        // 工具列表只在跨工作区（cwd 变）时重拉（工具按仓库根分组）。
        if (cwdChanged || sidChanged) {
          htmlRef.current = {}
          stateRef.current = {}
          seqRef.current = {}
        }
        if (cwdChanged) {
          refreshTools()
        }
        // 面板重载延后一拍：等 refreshTools 的 setTools/active 纠正落地（新仓库无同名工具时
        // active 已被兜底切到新列表第一个），用最新 activeRef 加载，避免对不存在工具发请求。
        ctx.timeout(() => {
          const t = activeRef.current
          const list = toolsRef.current
          if (t && (!list || list.some((x) => x.id === t)) && typeof loadPanelRef.current === 'function') {
            loadPanelRef.current(t, '', null)
          }
        }, 0)
        refreshPlugins()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [currentCwd, currentSessionId])

      // 面板自动刷新：当前工具的 HTML 声明了 data-autorefresh="ms" 时，静默轮询（不转圈、不抢滚动——silent 路径）
      const curAutoMs = active ? autoMs[active] : undefined
      React.useEffect(() => {
        if (!isOpen || !active || !curAutoMs) return undefined
        const disp = ctx.interval(() => {
          if (managingRef.current) return
          if (typeof loadPanelRef.current === 'function') loadPanelRef.current(active, '__refresh', null, { silent: true })
        }, curAutoMs)
        return () => { try { disp() } catch (e) {} }
      }, [isOpen, active, curAutoMs])

      // 激活 Tab 变化 → 切回该工具上次的面板并刷新
      React.useEffect(() => {
        if (!active) { setHtml(null); return }
        // localStorage 记忆可能指向已停止的工具：tools 已加载且不含它时等 refreshTools 纠正，不闪错误
        if (tools.length && !tools.some((t) => t.id === active)) return
        setHtml(htmlRef.current[active] || null)
        loadPanel(active, '', null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [active])

      function onPanelClick(e) {
        if (!active) return
        const t = e.target
        const el = t && t.closest ? t.closest('[data-action]') : null
        if (!el) return
        e.preventDefault()
        const act = el.getAttribute('data-action') || ''
        // 抽屉本地动作（不进 RPC）：面板头部「↓ 最新」按钮，与右下角浮标同一跳转逻辑
        if (act === 'jump-latest') { jumpToLatest(); return }
        loadPanel(active, act, el)
      }

      function onPanelKeyDown(e) {
        if (!active || e.key !== 'Enter') return
        const t = e.target
        if (!(t && t.matches && t.matches('[data-field]'))) return
        e.preventDefault()
        const box = panelRef.current
        const btn = box && box.querySelector('[data-action="query"], [data-action="query-record"]')
        if (btn) loadPanel(active, btn.getAttribute('data-action') || '', btn)
      }

      // 面板契约扩展：select 等控件加 data-action-onchange="xxx"，change 即触发该动作（无需手动按钮）。
      // 派发走抽屉根节点的原生 change 监听（见 loadPanelRef 旁的修复注释），不要用 React onChange 属性。

      function onHeaderDown(e) {
        if (e.button !== 0) return
        e.preventDefault()
        let rect = null
        try { rect = e.currentTarget.parentElement.getBoundingClientRect() } catch (err) {}
        const baseX = rect ? rect.left : 0
        const baseY = rect ? rect.top : 0
        setPos({ x: baseX, y: baseY })
        setDockMode('float')
        setDrag({ startX: e.clientX, startY: e.clientY, baseX, baseY })
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
      }
      function onHeaderMove(e) {
        if (!drag) return
        const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
        let x = drag.baseX + e.clientX - drag.startX
        const near = vw - (x + curW()) < SNAP_THRESHOLD
        if (near) x = vw - curW()
        setSnapHint(near)
        setPos({ x, y: drag.baseY + e.clientY - drag.startY })
      }
      function onHeaderUp(e) {
        if (!drag) return
        const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
        const x = drag.baseX + e.clientX - drag.startX
        const near = vw - (x + curW()) < SNAP_THRESHOLD
        setDrag(null)
        setSnapHint(false)
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) {}
        if (near) { setDockMode('right'); lsWrite({ dockMode: 'right' }) }
        else if (e.type === 'pointerup') lsWrite({ dockMode: 'float', pos: { x, y: drag.baseY + e.clientY - drag.startY } })
      }

      function onResizeStart(e, mode) {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        let rect = null
        try { rect = drawerRef.current.getBoundingClientRect() } catch (err) {}
        setResize({
          mode,
          startX: e.clientX,
          startY: e.clientY,
          baseW: rect ? rect.width : curW(),
          baseH: rect ? rect.height : (height || 560),
        })
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
      }
      function onResizeMove(e) {
        if (!resize) return
        const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
        const vh = e.currentTarget.ownerDocument.defaultView.innerHeight
        const maxW = Math.min(1400, vw - 24)
        const maxH = vh - 96
        if (resize.mode === 'left') {
          setWidth(clamp(resize.baseW + (resize.startX - e.clientX), MIN_W, maxW))
        } else if (resize.mode === 'right') {
          setWidth(clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW))
        } else if (resize.mode === 'bottom') {
          setHeight(clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH))
        } else if (resize.mode === 'corner') {
          setWidth(clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW))
          setHeight(clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH))
        }
      }
      function onResizeEnd(e) {
        // 手势结束才落盘几何（move 每帧触发，直接写 localStorage 会卡）；cancel 事件的坐标不可信，不写
        if (resize && e.type === 'pointerup') {
          try {
            const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
            const vh = e.currentTarget.ownerDocument.defaultView.innerHeight
            const maxW = Math.min(1400, vw - 24)
            const maxH = vh - 96
            const patch = {}
            if (resize.mode === 'left') patch.width = clamp(resize.baseW + (resize.startX - e.clientX), MIN_W, maxW)
            else if (resize.mode === 'right') patch.width = clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW)
            else if (resize.mode === 'bottom') patch.height = clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH)
            else if (resize.mode === 'corner') {
              patch.width = clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW)
              patch.height = clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH)
            }
            lsWrite(patch)
          } catch (err) {}
        }
        setResize(null)
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) {}
      }

      if (!isOpen) return null

      const curW = () => width || 520

      // 主题切换按钮：暗色下显示太阳（点击切亮），亮色下显示月亮（点击切暗）；theme 服务缺失时不渲染
      const themeButton = !themeSvc ? null : React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: themeScheme === 'dark' ? '切换到亮色主题' : '切换到暗色主题',
        'aria-label': '切换明暗主题',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); toggleTheme() },
      },
        themeScheme === 'dark'
          ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' },
              React.createElement('circle', { cx: 7, cy: 7, r: 2.6 }),
              React.createElement('path', { d: 'M7 1.2v1.4M7 11.4v1.4M1.2 7h1.4M11.4 7h1.4M2.9 2.9l1 1M10.1 10.1l1 1M11.1 2.9l-1 1M3.9 10.1l-1 1' }),
            )
          : React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' },
              React.createElement('path', { d: 'M12.2 8.7A5.2 5.2 0 1 1 5.3 1.8a4.4 4.4 0 0 0 6.9 6.9z' }),
            ),
      )

      // 画中画按钮：浏览器支持 Document PiP 才渲染（Chrome/Edge 116+，localhost 安全上下文）
      const pipButton = !pipSupported ? null : React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: '画中画：把工具箱放到独立小窗（脱离主窗口，可拖到任意位置）',
        'aria-label': '画中画',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); openPip() },
      },
        React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 },
          React.createElement('rect', { x: 1.5, y: 3, width: 11, height: 8, rx: 1 }),
          React.createElement('rect', { x: 7.5, y: 7, width: 3.6, height: 2.8, rx: 0.5, fill: 'currentColor', stroke: 'none' }),
        ),
      )

      const gearButton = React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: managing ? '返回工具面板' : '管理插件（停止/启动）',
        'aria-label': '管理插件',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); const next = !managing; setManaging(next); if (next) { refreshPlugins(); loadRebuildHistory(); loadAiUsage() } },
      },
        // sliders 图标（横线+滑块）：明确表示「管理/调节」，与明暗切换的太阳/月亮区分开
        React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' },
          React.createElement('path', { d: 'M1.8 4.2h10.4M1.8 9.8h10.4' }),
          React.createElement('circle', { cx: 9.2, cy: 4.2, r: 1.6 }),
          React.createElement('circle', { cx: 4.8, cy: 9.8, r: 1.6 }),
        ),
      )

      const dockButton = React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: dockMode === 'right' ? '切换到三栏停靠（挤压聊天区，左中右并列）' : dockMode === 'full' ? '切换为浮动' : '停靠到右侧',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); setDockMode(dockMode === 'right' ? 'full' : dockMode === 'full' ? 'float' : 'right') },
      },
        dockMode === 'right'
          ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'currentColor' },
              React.createElement('rect', { x: 2.5, y: 2.5, width: 8, height: 8, rx: 1 }),
              React.createElement('rect', { x: 5.5, y: 5.5, width: 6, height: 6, rx: 1, opacity: 0.55 }),
            )
          : dockMode === 'full'
            ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'currentColor' },
                React.createElement('rect', { x: 1.5, y: 2, width: 2.6, height: 10, rx: 0.8, opacity: 0.35 }),
                React.createElement('rect', { x: 5.1, y: 2, width: 5, height: 10, rx: 0.8, opacity: 0.55 }),
                React.createElement('rect', { x: 11.1, y: 2, width: 1.6, height: 10, rx: 0.5 }),
              )
            : React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'currentColor' },
                React.createElement('rect', { x: 2, y: 2, width: 7, height: 10, rx: 1 }),
                React.createElement('rect', { x: 10.5, y: 5, width: 2.5, height: 7, rx: 0.5, opacity: 0.55 }),
              ),
      )

      const closeButton = React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: '关闭',
        'aria-label': '关闭',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); if (pipOn) setMainHidden(true); else store.close() },
      },
        React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' },
          React.createElement('path', { d: 'M2 2l10 10M12 2L2 12' }),
        ),
      )

      const handles = []
      if (dockMode === 'right' || dockMode === 'full') {
        handles.push(React.createElement('div', {
          key: 'resize-left',
          className: 'jr-resize-left',
          title: '拖拽调整宽度',
          onPointerDown: (e) => onResizeStart(e, 'left'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
      } else if (dockMode === 'float') {
        handles.push(React.createElement('div', {
          key: 'resize-right',
          className: 'jr-resize-right',
          title: '拖拽调整宽度',
          onPointerDown: (e) => onResizeStart(e, 'right'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
        handles.push(React.createElement('div', {
          key: 'resize-bottom',
          className: 'jr-resize-bottom',
          title: '拖拽调整高度',
          onPointerDown: (e) => onResizeStart(e, 'bottom'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
        handles.push(React.createElement('div', {
          key: 'resize-corner',
          className: 'jr-resize-corner',
          title: '拖拽调整大小',
          onPointerDown: (e) => onResizeStart(e, 'corner'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
      }

      const style = {}
      if ((dockMode === 'right' || dockMode === 'full') && width) style.width = width + 'px' // 停靠宽度可调（左缘拖拽）
      if (dockMode === 'full' && !width) style.width = '560px' // 三栏停靠默认宽
      // pip 画中画期间主抽屉可视觉隐藏（DOM 与轮询存活——它是镜像事实源）
      if (mainHidden) { style.visibility = 'hidden'; style.pointerEvents = 'none' }
      if (dockMode === 'float') {
        if (height) style.height = height + 'px'
        if (pos) {
          style.left = pos.x + 'px'
          style.top = pos.y + 'px'
        }
      }

      // ---- 分类归属与迁移（导航行与管理树共用同一 catOf 数据源） ----
      const catOf = (id) => catOverrides[id] || DEFAULT_CAT[id] || 'dev'
      const pickCat = (id) => {
        if (id === cat) return
        // 记住旧分类当前选择；切到新分类后恢复其上次选中的工具，无记录（或已停）则选该分类第一个
        const next = Object.assign({}, activeByCat)
        if (active) next[cat] = active
        setActiveByCat(next)
        setCat(id)
        lsWrite({ cat: id, activeByCat: next })
        const inCat = tools.filter((t) => catOf(t.id) === id)
        const remembered = next[id]
        const target = remembered && inCat.some((t) => t.id === remembered) ? remembered : (inCat.length ? inCat[0].id : null)
        setActive(target)
        lastNav = { cat: id, active: target }
      }
      const moveNode = (id, toCat) => {
        if (!id || !toCat) return
        if (catOf(id) === toCat) return
        const next = Object.assign({}, catOverrides)
        next[id] = toCat
        setCatOverrides(next)
        catsWrite({ overrides: next })
      }
      const toggleCat = (id) => {
        const next = Object.assign({}, collapsedCats)
        next[id] = !next[id]
        setCollapsedCats(next)
        catsWrite({ collapsed: next })
      }

      // ---- 三段式导航：搜索整行（全局匹配）/ 分类行 / 当前分类下的工具行 ----
      const tabFilterLc = tabFilter.trim().toLowerCase()
      const searching = tabFilterLc.length > 0
      const catCounts = {}
      for (const t of tools) { const c = catOf(t.id); catCounts[c] = (catCounts[c] || 0) + 1 }
      const visibleCats = TOOL_CATS.filter((c) => (catCounts[c.id] || 0) > 0)
      // 激活分类已空（工具全停）时回退到第一个非空分类，不闪空行
      const effCat = (catCounts[cat] || 0) > 0 ? cat : (visibleCats.length ? visibleCats[0].id : cat)
      const shownTools = searching
        ? tools.filter((t) => (String(t.label) + ' ' + String(t.id)).toLowerCase().indexOf(tabFilterLc) >= 0)
        : tools.filter((t) => catOf(t.id) === effCat)
      const toolButton = (t) => React.createElement('button', {
        key: t.id,
        type: 'button',
        className: 'tb-tab' + (t.id === active ? ' tb-tab-active' : ''),
        title: t.label + '（' + (TOOL_CATS.find((c) => c.id === catOf(t.id)) || {}).label + '）',
        onClick: () => { setActive(t.id); lastNav = { cat: catOf(t.id), active: t.id } },
      }, t.label,
        tabBadges[t.id] ? React.createElement('span', { className: 'tb-tab-badge' }, tabBadges[t.id]) : null,
        t.id === busyTool ? React.createElement('span', { className: 'tb-tab-spin' }) : null)

      let body = null
      if (managing) {
        // 与工具面板同款的「固定头 + 列表独立滚动」：tb-pane → tb-pane-head + tb-pane-body
        body = React.createElement('div', { className: 'tb-frame' },
          React.createElement('div', { className: 'tb-pane' },
            React.createElement('div', { className: 'tb-pane-head' },
              error ? React.createElement('div', { className: 'tb-error' }, String(error)) : null,
              copied ? React.createElement('div', { className: 'tb-banner tb-banner-info' }, String(copied)) : null,
              React.createElement('div', { className: 'tb-row' },
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn tb-btn-primary',
                  disabled: rebuilding,
                  onClick: runRebuild,
                }, rebuilding ? '重建中…' : '从 plugins.json 重建/补齐'),
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn',
                  onClick: () => toggleAll(true),
                }, '全部启动'),
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn',
                  title: '重跑全部运行中的 Host-only 插件（改完多个工具代码一键生效；停着的不动）',
                  onClick: restartAll,
                }, '全部重跑'),
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn tb-btn-ghost',
                  title: '隐藏全部无界面（Host-only）工具，只显示含界面的插件；再次点击恢复',
                  onClick: () => toggleAll(false),
                }, '全部停止'),
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-chip' + (hideHostOnly ? ' tb-chip-on' : ''),
                  title: '隐藏无界面（Host-only）工具，只显示含界面（Client）的插件；对含 Client 半的插件工具箱只能启停、操作请去 Cordis 面板',
                  onClick: () => setHideHostOnly((v) => !v),
                }, hideHostOnly ? '显示全部' : '隐藏无界面'),
                React.createElement('input', {
                  className: 'tb-input',
                  style: { flex: '1', minWidth: '120px' },
                  placeholder: '按名称 / ID 过滤插件',
                  value: pluginFilter,
                  onChange: (e) => setPluginFilter(e.target.value),
                }),
              ),
              rebuildLines
                ? React.createElement('div', { className: 'tb-note' }, rebuildLines.map((l, i) => React.createElement('div', { key: i }, l)))
                : null,
              rebuildHistory.length
                ? (() => {
                    const max = Math.max.apply(null, rebuildHistory.map((h) => h.ms || 0).concat([1]))
                    return React.createElement('div', { className: 'tb-note' },
                      '重建耗时（最近 ' + rebuildHistory.length + ' 次，悬停看详情；红 = 有失败）',
                      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: '36px', marginTop: '6px' } },
                        rebuildHistory.map((h, i) => React.createElement('div', {
                          key: i,
                          title: (h.at || '') + ' · ' + (h.ms == null ? '—' : h.ms + 'ms') + ' · 定义 ' + h.defined + ' / 启动 ' + h.started + ' / 关闭 ' + h.suppressed + ' / 失败 ' + h.failed,
                          style: {
                            width: '10px',
                            height: Math.max(2, Math.round(((h.ms || 0) / max) * 32)) + 'px',
                            borderRadius: '2px',
                            background: h.failed > 0 ? 'var(--tb-danger,#d94f4f)' : 'var(--tb-accent,#3f6fd9)',
                            opacity: 0.85,
                          },
                        }))))
                  })()
                : null,
              aiUsage && aiUsage.totals && aiUsage.totals.calls
                ? React.createElement('div', { className: 'tb-note' },
                    'AI 用量（台账最近 100 条）：共 ' + aiUsage.totals.calls + ' 次 · 输出 ' + aiUsage.totals.out + ' tok' + (aiUsage.totals.errors ? ' · 失败 ' + aiUsage.totals.errors + ' 次' : '') + (aiUsage.totals.todayCalls ? '；今日 ' + aiUsage.totals.todayCalls + ' 次 / ' + aiUsage.totals.todayOut + ' tok' : ''),
                    React.createElement('div', { className: 'tb-pills', style: { marginTop: '4px' } },
                      aiUsage.tools.map((t) => React.createElement('span', {
                        key: t.tool,
                        className: 'tb-pill tb-pill-plain',
                        title: t.tool + '：成功 ' + t.calls + ' 次 · 输出 ' + t.out + ' tok' + (t.errors ? ' · 失败 ' + t.errors + ' 次' : ''),
                      }, t.tool + ' ' + t.calls + '/' + (t.out >= 10000 ? (t.out / 1000).toFixed(1) + 'k' : t.out) + ' tok')),
                      React.createElement('button', {
                        type: 'button',
                        className: 'tb-btn tb-btn-sm tb-btn-ghost',
                        title: '复制台账汇总 CSV（tool,calls,output_tokens,errors）',
                        onClick: async () => {
                          if (!aiUsage || !Array.isArray(aiUsage.tools)) return
                          const csv = ['tool,calls,output_tokens,errors']
                            .concat(aiUsage.tools.map((t) => [t.tool, t.calls, t.out, t.errors].join(',')))
                            .join('\n')
                          try {
                            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                              await navigator.clipboard.writeText(csv)
                              setCopied('台账 CSV 已复制（' + aiUsage.tools.length + ' 个工具）')
                            } else setCopied('当前环境无剪贴板 API')
                          } catch (e) { setCopied('复制失败: ' + String((e && e.message) || e)) }
                        },
                      }, '复制 CSV')))
                : null,
              React.createElement('div', { className: 'tb-note' }, '开关 = 真停 / 真启插件（等同 Cordis 面板的停止/运行，两处状态同步），同时写入启停记忆 .dsh-dynamic-toolbox/toolbox-plugins.json；「重启后」pill = 下次重建的默认启停，点击切换、只改记忆不动当前状态。停止后 Tab 级联消失，启动后约 0.5s 自动挂回。含 Client 半的插件（框架/主题）请到 Cordis 面板操作。'),
            ),
            React.createElement('div', { className: 'tb-pane-body tb-pane-col' },
              (() => {
                // 「隐藏无界面」过滤：host-only（无 Client 半）不显示——含界面的插件启停走工具箱，
                // 但含 Client 半的仍需去 Cordis 面板；过滤后空态给出提示而非「暂无动态插件」
                const visiblePlugins = hideHostOnly ? plugins.filter((p) => p.hasClientHalf) : plugins
                if (visiblePlugins.length === 0) {
                  if (hideHostOnly) {
                    return React.createElement('div', null,
                      React.createElement('div', { className: 'tb-notice' }, '当前没有含界面（Client 半）的插件——全部 Host-only 工具已被「隐藏无界面」过滤'),
                      React.createElement('button', {
                        type: 'button',
                        className: 'tb-btn',
                        style: { marginTop: '8px' },
                        onClick: () => setHideHostOnly(false),
                      }, '显示全部 Host-only 工具'),
                    )
                  }
                  return React.createElement('div', { className: 'tb-notice' }, '暂无动态插件')
                }
                // 单个插件节点（行 key 用 pluginId，跨分类移动时稳定；条目 id 追加在副行便于辨认归属键）
                const manageRow = (p) =>
                      React.createElement('div', {
                        key: p.pluginId,
                        className: 'tb-manage-row',
                        draggable: Boolean(p.entryId),
                        onDragStart: (e) => {
                          if (!p.entryId) return
                          setDragId(p.entryId)
                          try { if (e.dataTransfer) e.dataTransfer.setData('text/plain', p.entryId) } catch (err) {}
                        },
                        onDragEnd: () => setDragId(null),
                      },
                        p.entryId ? React.createElement('span', { className: 'tb-drag', title: '拖拽到分类标题上调整归属' }, '⋮⋮') : null,
                        React.createElement('div', { className: 'tb-manage-main' },
                          React.createElement('span', { className: 'tb-manage-label' }, p.name),
                          React.createElement('span', { className: 'tb-manage-id' }, p.pluginId + (p.currentPackageId ? ' · ' + p.currentPackageId : '') + (p.entryId ? ' · ' + p.entryId : '')),
                        ),
                        React.createElement('span', { className: 'tb-pill ' + (p.running ? 'tb-pill-done' : 'tb-pill-todo') }, p.running ? '运行中' : '已停止'),
                        p.defaultStart != null
                          ? React.createElement('button', {
                            type: 'button',
                            className: 'tb-pill-btn' + (p.defaultStart ? ' on' : ''),
                            title: '下次重建的默认启停（启停记忆）——点击切换；只改记忆，不动当前运行状态',
                            onClick: () => setDefaultPlugin(p),
                          }, p.defaultStart ? '重启后启动' : '重启后关闭')
                          : null,
                        React.createElement('button', {
                          type: 'button',
                          className: 'tb-btn tb-btn-sm tb-btn-ghost',
                          title: p.hasClientHalf ? '含 Client 半，请到 Cordis 面板操作' : '重跑（重新从磁盘加载实现，改完代码点这个）',
                          disabled: Boolean(p.hasClientHalf),
                          style: p.hasClientHalf ? { opacity: 0.4, cursor: 'default' } : null,
                          onClick: () => restartPlugin(p),
                        }, '重跑'),
                        React.createElement('button', {
                          type: 'button',
                          className: 'tb-switch' + (p.running ? ' tb-switch-on' : ''),
                          title: p.hasClientHalf ? '含 Client 半，请到 Cordis 面板操作' : (p.running ? '停止该插件' : '启动该插件'),
                          disabled: Boolean(p.hasClientHalf),
                          style: p.hasClientHalf ? { opacity: 0.4, cursor: 'default' } : null,
                          onClick: () => togglePlugin(p),
                        }),
                      )
                    // 过滤模式：平铺（原行为）；否则按分类树展示
                    const fq = pluginFilter.trim().toLowerCase()
                    if (fq) {
                      return React.createElement('div', { className: 'tb-manage-list' }, visiblePlugins
                        .filter((p) => (p.name || '').toLowerCase().indexOf(fq) >= 0 || (p.pluginId || '').toLowerCase().indexOf(fq) >= 0)
                        .map(manageRow))
                    }
                    const byCat = {}
                    for (const p of visiblePlugins) {
                      const cid = p.entryId ? catOf(p.entryId) : 'system' // 清单外插件归「系统」且不可拖（无稳定归属键）
                      if (!byCat[cid]) byCat[cid] = []
                      byCat[cid].push(p)
                    }
                    const chevron = React.createElement('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'currentColor' },
                      React.createElement('path', { d: 'M3 1.5 L7.5 5 L3 8.5 Z' }))
                    return React.createElement('div', null, TOOL_CATS
                      .filter((c) => byCat[c.id] && byCat[c.id].length)
                      .map((c) => {
                        const list = byCat[c.id]
                        const open = !collapsedCats[c.id]
                        const running = list.filter((p) => p.running).length
                        return React.createElement('div', { key: 'cat-' + c.id },
                          React.createElement('div', {
                            className: 'tb-tree-cat' + (open ? ' tb-tree-cat-open' : '') + (dragId && catOf(dragId) !== c.id ? ' tb-tree-cat-drop' : ''),
                            title: '点击折叠/展开；拖节点到此标题上即改分类（与导航行联动）',
                            onClick: () => toggleCat(c.id),
                            onDragOver: (e) => { if (dragId) e.preventDefault() },
                            onDrop: (e) => { e.preventDefault(); if (dragId) moveNode(dragId, c.id); setDragId(null) },
                          },
                            React.createElement('span', { className: 'tb-tree-chev' }, chevron),
                            React.createElement('span', { className: 'tb-tree-cat-label' }, c.label),
                            React.createElement('span', { className: 'tb-note' }, list.length + ' 个 · ' + running + ' 运行'),
                          ),
                          open ? React.createElement('div', { className: 'tb-tree-kids' }, list.map(manageRow)) : null,
                        )
                      }))
                  })()),
          ),
        )
      } else if (tools.length === 0) {
        body = currentCwd
          ? React.createElement('div', { className: 'tb-empty' },
              '当前工作区未检测到 dsh-dynamic-toolbox\n切换到一个包含工具箱的工作区后自动加载；本工作区下不显示工具',
            )
          : React.createElement('div', { className: 'tb-empty' },
              '暂无工具\n运行工具插件（如 Jira）后自动出现在这里；已停止的插件可在右上角管理按钮里重新启动',
            )
      } else {
        body = React.createElement('div', { className: 'tb-frame', ref: panelRef, onClick: onPanelClick, onKeyDown: onPanelKeyDown },
          error ? React.createElement('div', { className: 'tb-error' }, String(error)) : null,
          copied ? React.createElement('div', { className: 'tb-banner tb-banner-info' }, String(copied)) : null,
          html
            ? React.createElement('div', { dangerouslySetInnerHTML: { __html: html } })
            : React.createElement('div', { className: 'tb-notice' }, '加载面板…'),
          showJump ? React.createElement('button', {
            type: 'button',
            className: 'tb-jump-latest',
            onClick: jumpToLatest,
          }, '↓ 回到最新') : null,
        )
      }

      const drawerEl = React.createElement('div', {
        ref: drawerRef,
        className: 'jr-drawer' + (dockMode === 'right' ? ' jr-docked' : dockMode === 'full' ? ' jr-docked-full' : ''),
        style,
      },
        React.createElement('div', {
          className: 'jr-drawer-header',
          onPointerDown: onHeaderDown,
          onPointerMove: onHeaderMove,
          onPointerUp: onHeaderUp,
          onPointerCancel: onHeaderUp,
        },
          React.createElement('span', { className: 'jr-drawer-title' }, managing ? '工具箱 · 管理' : '工具箱'),
          themeButton,
          pipButton,
          gearButton,
          dockButton,
          closeButton,
        ),
        managing ? null : React.createElement('div', { className: 'tb-nav' },
          React.createElement('input', {
            className: 'tb-input tb-nav-search',
            placeholder: '搜索工具（共 ' + tools.length + ' 个，匹配名称 / ID）',
            value: tabFilter,
            onChange: (e) => setTabFilter(e.target.value),
          }),
          React.createElement(HRow, { className: 'tb-hrow tb-cats' },
            visibleCats.map((c) => React.createElement('button', {
              key: c.id,
              type: 'button',
              className: 'tb-chip' + (!searching && c.id === effCat ? ' tb-chip-on' : ''),
              title: '分类「' + c.label + '」；管理页（右上角管理按钮）可把节点拖到别的分类',
              onClick: () => pickCat(c.id),
            }, c.label + ' · ' + catCounts[c.id]))),
          React.createElement(HRow, { className: 'tb-hrow tb-tools' },
            shownTools.length
              ? shownTools.map(toolButton)
              : React.createElement('span', { className: 'tb-hrow-empty' }, searching ? '无匹配工具' : '该分类暂无运行中的工具')),
        ),
        React.createElement('div', { className: 'jr-drawer-body' }, body),
        handles,
      )

      return React.createElement(React.Fragment, null,
        drawerEl,
        snapHint ? React.createElement('div', { className: 'jr-snap-indicator' }) : null,
        resize ? React.createElement('div', { className: 'jr-resize-badge' },
          Math.round(width || 520) + ' × ' + (height ? Math.round(height) : '自动'),
        ) : null,
      )
    }

    if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
      // 侧边栏导航区无官方 Slot：DOM 注入导航条目（新会话下方、SSH 之后），disposer 随插件停止清理
      ctx.effect(() => mountSidebarEntry())
    } else {
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'toolbox-entry', order: -1000, label: '工具箱' },
        (props) => React.createElement(Entry, { wide: Boolean(props.wide) }),
      ))
    }

    slots.inject('shell.overlay', () => slots.register(
      {
        name: 'shell.overlay',
        id: 'toolbox-drawer',
        order: 120,
        label: '工具箱抽屉',
      },
      (props) => React.createElement(Drawer, props),
    ))
  },
}