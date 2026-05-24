#!/bin/bash
# Deprecated wrapper. Use:
#   node scripts/spec-dev.mjs archive --root <project-root>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${1:-.}"
REQ_NAME="${2:-}"

echo "scripts/archive.sh is deprecated; use scripts/spec-dev.mjs archive instead." >&2

if [ -n "${REQ_NAME}" ]; then
  SPEC_DEV_DIR="${PROJECT_ROOT}/spec-dev"
  ARCHIVE_DIR="${SPEC_DEV_DIR}/archive"
  TODAY="${SPEC_DEV_DATE:-$(date +%Y-%m-%d)}"

  if ! printf '%s' "${TODAY}" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
    echo "Invalid archive date: ${TODAY}. Expected YYYY-MM-DD." >&2
    exit 1
  fi

  mkdir -p "${ARCHIVE_DIR}"
  ARCHIVE_FILE="${ARCHIVE_DIR}/${TODAY}-${REQ_NAME}.md"
  PRD_FILE="${SPEC_DEV_DIR}/prd/${REQ_NAME}-prd.md"
  TECH_FILE="${SPEC_DEV_DIR}/tech/${REQ_NAME}-tech.md"
  SPEC_FILE="${SPEC_DEV_DIR}/spec/${REQ_NAME}-tasks.md"

  {
    echo "# ${REQ_NAME} — 开发归档"
    echo ""
    echo "## 基本信息"
    echo ""
    echo "| 字段 | 值 |"
    echo "|------|-----|"
    echo "| 需求名称 | ${REQ_NAME} |"
    echo "| 归档日期 | ${TODAY} |"
    echo "| 项目目录 | ${PROJECT_ROOT} |"
    echo ""

    if [ -f "${PRD_FILE}" ]; then
      echo "## PRD 文档"
      echo ""
      echo "文件: spec-dev/prd/${REQ_NAME}-prd.md"
      echo ""
    fi

    if [ -f "${TECH_FILE}" ]; then
      echo "## 技术方案"
      echo ""
      echo "文件: spec-dev/tech/${REQ_NAME}-tech.md"
      echo ""
    fi

    if [ -f "${SPEC_FILE}" ]; then
      TOTAL=$(grep -Ec '^\[(x| )?\][[:space:]]+[0-9]+\.' "${SPEC_FILE}" 2>/dev/null || true)
      DONE=$(grep -Eic '^\[x\][[:space:]]+[0-9]+\.' "${SPEC_FILE}" 2>/dev/null || true)
      TOTAL="${TOTAL:-0}"
      DONE="${DONE:-0}"
      echo "## 任务清单"
      echo ""
      echo "文件: spec-dev/spec/${REQ_NAME}-tasks.md"
      echo ""
      echo "任务完成: ${DONE}/${TOTAL}"
      echo ""
    fi
  } > "${ARCHIVE_FILE}"

  echo "归档完成: ${ARCHIVE_FILE}"
  exit 0
fi

node "${SCRIPT_DIR}/spec-dev.mjs" archive --root "${PROJECT_ROOT}"
