param(
  [ValidateSet("codex", "claude", "both")]
  [string]$Runtime = "codex",
  [string]$CodexHome = $env:CODEX_HOME,
  [string]$ClaudeHome = $env:CLAUDE_HOME
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($CodexHome)) {
  $CodexHome = Join-Path $HOME ".codex"
}

if ([string]::IsNullOrWhiteSpace($ClaudeHome)) {
  $ClaudeHome = Join-Path $HOME ".claude"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Install-SpecDevSkill {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SkillDir,
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [Parameter(Mandatory = $true)]
    [string]$SkillFile
  )

  if (Test-Path -LiteralPath $SkillDir) {
    $timestamp = Get-Date -Format "yyyyMMddHHmmss"
    $backupDir = "$SkillDir.bak.$timestamp"
    Write-Host "已存在 $SkillDir，将备份为 $backupDir"
    Move-Item -LiteralPath $SkillDir -Destination $backupDir
  }

  New-Item -ItemType Directory -Path $SkillDir -Force | Out-Null
  Copy-Item -LiteralPath $SkillFile -Destination (Join-Path $SkillDir "SKILL.md") -Force
  Copy-Item -LiteralPath (Join-Path $scriptDir "agents") -Destination $SkillDir -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $scriptDir "references") -Destination $SkillDir -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $scriptDir "scripts") -Destination $SkillDir -Recurse -Force

  Write-Host "$Label 安装完成: $SkillDir"
}

$codexSkillDir = Join-Path $CodexHome "skills\spec-dev"
$claudeSkillDir = Join-Path $ClaudeHome "skills\spec-dev"
$codexSkillFile = Join-Path $scriptDir "SKILL.md"
$claudeSkillFile = Join-Path $scriptDir "SKILL.claude.md"

switch ($Runtime) {
  "codex" {
    Install-SpecDevSkill -SkillDir $codexSkillDir -Label "Codex" -SkillFile $codexSkillFile
    Write-Host '在 Codex 中输入: $spec-dev <需求描述>'
  }
  "claude" {
    Install-SpecDevSkill -SkillDir $claudeSkillDir -Label "Claude Code" -SkillFile $claudeSkillFile
    Write-Host "在 Claude Code 中输入: /spec-dev <需求描述>"
  }
  "both" {
    Install-SpecDevSkill -SkillDir $codexSkillDir -Label "Codex" -SkillFile $codexSkillFile
    Install-SpecDevSkill -SkillDir $claudeSkillDir -Label "Claude Code" -SkillFile $claudeSkillFile
    Write-Host '在 Codex 中输入: $spec-dev <需求描述>'
    Write-Host "在 Claude Code 中输入: /spec-dev <需求描述>"
  }
}
