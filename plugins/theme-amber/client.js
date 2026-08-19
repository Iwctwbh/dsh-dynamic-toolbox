// ===== 工具箱主题插件 · 暖橙 =====
// 原理同 theme-teal：框架共享设计系统只以 var(--tb-*, 兜底) 消费变量、从不声明；
// 在 :root 声明覆盖即整体换肤，停止本插件即回默认主题。多主题并存后插入者胜出——按需只激活一个。
// 与 teal 的差异：除 accent 家族外同步覆盖 active 家族（Tab 激活态/链接色）与统计数字色，观感更完整。

return {
  name: 'tb-theme-amber',
  apply(ctx) {
    const themeRoot = TOOLBOX_RUNTIME.bundleId === 'dynamic'
      ? ':root'
      : '[data-dsh-toolbox-scope="' + TOOLBOX_RUNTIME.domValue() + '"]'
    const dispose = styles.insert([
      themeRoot + '{',
      '  --tb-accent:#d97706;',
      '  --tb-accent-hover:#f59e0b;',
      '  --tb-accent-text:#fbbf24;',
      '  --tb-accent-bg:rgba(245,158,11,.14);',
      '  --tb-accent-border:rgba(245,158,11,.45);',
      '  --tb-accent-ring:rgba(245,158,11,.16);',
      '  --tb-active:#f59e0b;',
      '  --tb-active-text:#fbbf24;',
      '  --tb-active-border:rgba(245,158,11,.4);',
      '  --tb-active-bg:rgba(245,158,11,.12);',
      '}',
    ].join('\n'))
    ctx.effect(() => dispose)
    console.log('tb-theme-amber: 已应用（工具箱面板 accent → 暖橙）')
  },
}
