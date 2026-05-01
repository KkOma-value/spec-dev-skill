#!/bin/bash
# spec-dev-skill 安装脚本
# 用法: bash install.sh [codex|claude|both]

set -euo pipefail

RUNTIME="${1:-codex}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

copy_skill() {
  local skill_dir="$1"
  local label="$2"
  local skill_file="$3"

  if [ -d "$skill_dir" ]; then
    local backup_dir="${skill_dir}.bak.$(date +%Y%m%d%H%M%S)"
    echo "已存在 $skill_dir，将备份为 $backup_dir"
    mv "$skill_dir" "$backup_dir"
  fi

  mkdir -p "$(dirname "$skill_dir")"
  mkdir -p "$skill_dir"
  cp "$skill_file" "$skill_dir/SKILL.md"
  cp -r "$SCRIPT_DIR/agents" "$skill_dir/"
  cp -r "$SCRIPT_DIR/references" "$skill_dir/"
  cp -r "$SCRIPT_DIR/scripts" "$skill_dir/"

  echo "$label 安装完成: $skill_dir"
}

if [ -n "${CODEX_HOME:-}" ]; then
  CODEX_ROOT="$CODEX_HOME"
else
  CODEX_ROOT="$HOME/.codex"
fi

CLAUDE_ROOT="${CLAUDE_HOME:-$HOME/.claude}"

case "$RUNTIME" in
  codex)
    copy_skill "$CODEX_ROOT/skills/spec-dev" "Codex" "$SCRIPT_DIR/SKILL.md"
    echo '在 Codex 中输入: $spec-dev <需求描述>'
    ;;
  claude)
    copy_skill "$CLAUDE_ROOT/skills/spec-dev" "Claude Code" "$SCRIPT_DIR/SKILL.claude.md"
    echo "在 Claude Code 中输入: /spec-dev <需求描述>"
    ;;
  both)
    copy_skill "$CODEX_ROOT/skills/spec-dev" "Codex" "$SCRIPT_DIR/SKILL.md"
    copy_skill "$CLAUDE_ROOT/skills/spec-dev" "Claude Code" "$SCRIPT_DIR/SKILL.claude.md"
    echo '在 Codex 中输入: $spec-dev <需求描述>'
    echo "在 Claude Code 中输入: /spec-dev <需求描述>"
    ;;
  *)
    echo "用法: bash install.sh [codex|claude|both]" >&2
    exit 1
    ;;
esac
