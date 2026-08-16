// ===== 工具箱主题插件 · 青绿（演示） =====
// 原理：框架共享设计系统（tb- 类）只以 var(--tb-*, 兜底) 消费变量、从不声明；
// 本插件在 :root 声明一组 --tb-* 覆盖即整体换肤。停止本插件即回默认主题，无副作用。
// 多个主题插件并存时后插入者胜出 —— 按需只激活一个。

return {
  name: 'tb-theme-teal',
  apply(ctx) {
    const dispose = styles.insert([
      ':root{',
      '  --tb-accent:#0d9488;',
      '  --tb-accent-hover:#14b8a6;',
      '  --tb-accent-text:#5eead4;',
      '  --tb-accent-bg:rgba(20,184,166,.14);',
      '  --tb-accent-border:rgba(20,184,166,.45);',
      '  --tb-accent-ring:rgba(20,184,166,.16);',
      '  --tb-active:#14b8a6;',
      '  --tb-active-text:#5eead4;',
      '  --tb-active-border:rgba(20,184,166,.4);',
      '}',
    ].join('\n'))
    ctx.effect(() => dispose)
    console.log('tb-theme-teal: 已应用（工具箱面板 accent → 青绿）')
  },
}
