#requires -Version 5.1
<#
.SYNOPSIS
  dsh-dynamic-toolbox · host-bootstrap 一键安装/卸载（零模型调用自举）。

.DESCRIPTION
  把本仓库的 host-bootstrap 静态插件挂进 DSH profile：
    1. 在 <DshHome>\profiles\<Profile>\node_modules\ 建 junction dsh-toolbox-bootstrap → 本脚本所在目录
    2. 向 <DshHome>\profiles\<Profile>\cordis.patch.yml 幂等写入 insert 行
  之后重启 DSH，任何模式下打开会话即自动 define+run 工具箱框架（0 模型调用 + 1 次批准点击）。
  脚本幂等：重复执行不会产生重复配置；已安装时只做状态确认。
  -Uninstall 卸载：移除 patch 块与 junction，回到零安装状态（手动/模型工具路径不受影响）。

.PARAMETER DshHome
  DSH_HOME 目录。默认取 $env:DSH_HOME，未设置时为 ~\.dsh。

.PARAMETER Profile
  profile 名。默认 web。

.PARAMETER Uninstall
  执行卸载而非安装。

.EXAMPLE
  pwsh host-bootstrap/install.ps1
  pwsh host-bootstrap/install.ps1 -Profile web -Uninstall
#>
[CmdletBinding()]
param(
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }),
  [string]$Profile = 'web',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$pkgName    = 'dsh-toolbox-bootstrap'
$rowId      = 'toolbox-bootstrap'
$src        = $PSScriptRoot                                    # host-bootstrap/ 自身（junction 目标）
$profileDir = Join-Path $DshHome (Join-Path 'profiles' $Profile)
$modulesDir = Join-Path $profileDir 'node_modules'
$link       = Join-Path $modulesDir $pkgName
$patchFile  = Join-Path $profileDir 'cordis.patch.yml'
$isWin      = ($null -eq (Get-Variable IsWindows -ErrorAction SilentlyContinue)) -or $IsWindows

# install.ps1 管理的 patch 块（标记注释供卸载时整块识别；勿手改，改了就由你自己维护）
$block = @"
- insert:
    # dsh-dynamic-toolbox 零模型调用自举（host-bootstrap/install.ps1 管理，卸载请跑 -Uninstall）
    - id: $rowId
      name: '$pkgName'
"@

$header = @'
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
'@

function Read-Patch {
  if (Test-Path $patchFile) { return [System.IO.File]::ReadAllText($patchFile) }
  return ''
}
function Write-Patch([string]$text) {
  [System.IO.File]::WriteAllText($patchFile, $text, (New-Object System.Text.UTF8Encoding($false)))
}
# 移除我们管理的 insert 块（按标记注释 + 行内容匹配，整块删除；含历史版本注释的写法）
function Remove-ManagedBlock([string]$text) {
  $pattern = "(?ms)^- insert:\r?\n    \# dsh-dynamic-toolbox [^\r\n]*\r?\n    - id: $rowId\r?\n      name: '$pkgName'\r?\n?"
  return [regex]::Replace($text, $pattern, '')
}
function Get-LinkTarget([string]$path) {
  $item = Get-Item $path -Force -ErrorAction SilentlyContinue
  if (-not $item) { return $null }
  if (-not ($item.LinkType)) { return '__NOT_A_LINK__' }   # 真实目录/文件，不动它
  $t = $item.Target
  if ($t -is [array]) { $t = $t[0] }
  return ([string]$t).TrimEnd('\', '/')
}

# ---------- 卸载 ----------
if ($Uninstall) {
  $did = $false
  $text = Read-Patch
  if ($text -match [regex]::Escape("name: '$pkgName'")) {
    $text = Remove-ManagedBlock $text
    if ($text -match [regex]::Escape("name: '$pkgName'")) {
      Write-Warning "patch 块被手改过，无法整块识别；请手动编辑 $patchFile 移除 id=$rowId 的行"
    } else {
      if ($text -notmatch '(?m)^- ') { $text = ($text.TrimEnd() -replace '(?m)^\[\]\s*$', '').TrimEnd() + "`r`n[]`r`n" }
      Write-Patch $text
      Write-Host "✓ 已移除 patch 行（$patchFile）"
      $did = $true
    }
  }
  $target = Get-LinkTarget $link
  if ($target -and $target -ne '__NOT_A_LINK__') {
    Remove-Item $link -Force
    Write-Host "✓ 已删除 junction（$link）"
    $did = $true
  } elseif ($target -eq '__NOT_A_LINK__') {
    Write-Warning "$link 是真实目录而非链接，未删除；如确认无用请手动移除"
  }
  if (-not $did) { Write-Host '未安装，无需卸载。' }
  else { Write-Host "`n卸载完成：重启 DSH 后生效。工具箱的手动/模型工具重建路径不受影响。" }
  return
}

# ---------- 安装 ----------
if (-not (Test-Path (Join-Path $src 'index.js')) -or -not (Test-Path (Join-Path $src 'package.json'))) {
  throw "未找到 host-bootstrap 本体（$src 下缺 index.js/package.json）——请把本脚本放在仓库 host-bootstrap/ 目录内执行"
}
if (-not (Test-Path $profileDir)) {
  throw "未找到 DSH profile 目录：$profileDir`n请先安装并启动过一次 DSH（profile=$Profile），或用 -DshHome/-Profile 指定"
}

# 1) junction
$changed = $false
New-Item -ItemType Directory -Path $modulesDir -Force | Out-Null
$target = Get-LinkTarget $link
$srcNorm = $src.TrimEnd('\', '/')
if ($target -eq '__NOT_A_LINK__') {
  throw "$link 已存在且是真实目录（不是链接），为避免误删已中止；请手动处理后重跑"
} elseif ($target -and $target.ToLower() -eq $srcNorm.ToLower()) {
  Write-Host "✓ junction 已存在且指向本仓库，跳过（$link）"
} else {
  if ($target) { Remove-Item $link -Force; Write-Host "· 移除旧 junction（曾指向 $target）" }
  $linkType = if ($isWin) { 'Junction' } else { 'SymbolicLink' }
  New-Item -ItemType $linkType -Path $link -Target $src | Out-Null
  Write-Host "✓ 已建 junction：$link → $src"
  $changed = $true
}

# 2) patch 行（幂等）
$text = Read-Patch
if ($text -match [regex]::Escape("name: '$pkgName'")) {
  Write-Host "✓ patch 行已存在，跳过（$patchFile）"
} else {
  if (-not $text.Trim()) {
    $text = $header + "`r`n[]`r`n"
  }
  if ($text -match '(?m)^\[\]\s*$') {
    $text = $text -replace '(?m)^\[\]\s*$', $block
  } else {
    $text = $text.TrimEnd() + "`r`n" + $block + "`r`n"
  }
  Write-Patch $text
  Write-Host "✓ 已写入 patch 行（$patchFile）"
  $changed = $true
}

if ($changed) {
  Write-Host "`n安装完成。重启 DSH 进程后生效：任何模式下打开会话 → 首次弹询问卡 → 批准卡点一次允许 → 框架自动补齐全部插件。"
} else {
  Write-Host "`n已是安装状态，无变更。（若尚未重启过 DSH，重启后自举生效）"
}
Write-Host "提示：selfview（界面自查）自动启动时每进程会多一张批准卡；不想弹可在启停记忆置 enabled=false（详见 REBUILD.md「零模型调用自举」）。"
