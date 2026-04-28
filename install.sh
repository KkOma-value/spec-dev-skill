#!/bin/bash
# spec-dev-skill 安装脚本
# 将 skill 安装到 ~/.claude/skills/spec-dev/

set -e

SKILL_DIR="$HOME/.claude/skills/spec-dev"

if [ -d "$SKILL_DIR" ]; then
  echo "已存在 $SKILL_DIR，将备份为 ${SKILL_DIR}.bak"
  mv "$SKILL_DIR" "${SKILL_DIR}.bak"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$SKILL_DIR"
cp -r "$SCRIPT_DIR/SKILL.md" "$SKILL_DIR/"
cp -r "$SCRIPT_DIR/agents" "$SKILL_DIR/"
cp -r "$SCRIPT_DIR/references" "$SKILL_DIR/"
cp -r "$SCRIPT_DIR/scripts" "$SKILL_DIR/"

echo "安装完成: $SKILL_DIR"
echo "在 Claude Code 中输入 /spec-dev <需求描述> 即可使用"
