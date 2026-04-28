#!/bin/bash
# spec-dev 归档脚本
# 用法: bash archive.sh <项目根目录> <需求短名称>

set -e

PROJECT_ROOT="${1:-.}"
REQ_NAME="${2}"

if [ -z "$REQ_NAME" ]; then
  echo "用法: bash archive.sh <项目根目录> <需求短名称>"
  exit 1
fi

SPEC_DEV_DIR="${PROJECT_ROOT}/spec-dev"
ARCHIVE_DIR="${SPEC_DEV_DIR}/archive"
TODAY=$(date +%Y-%m-%d)
ARCHIVE_FILE="${ARCHIVE_DIR}/${TODAY}-${REQ_NAME}.md"

# 确保归档目录存在
mkdir -p "${ARCHIVE_DIR}"

# 检查产物文件是否存在
PRD_FILE="${SPEC_DEV_DIR}/prd/${REQ_NAME}-prd.md"
TECH_FILE="${SPEC_DEV_DIR}/tech/${REQ_NAME}-tech.md"
SPEC_FILE="${SPEC_DEV_DIR}/spec/${REQ_NAME}-tasks.md"

echo "# ${REQ_NAME} — 开发归档" > "${ARCHIVE_FILE}"
echo "" >> "${ARCHIVE_FILE}"
echo "## 基本信息" >> "${ARCHIVE_FILE}"
echo "" >> "${ARCHIVE_FILE}"
echo "| 字段 | 值 |" >> "${ARCHIVE_FILE}"
echo "|------|-----|" >> "${ARCHIVE_FILE}"
echo "| 需求名称 | ${REQ_NAME} |" >> "${ARCHIVE_FILE}"
echo "| 归档日期 | ${TODAY} |" >> "${ARCHIVE_FILE}"
echo "| 项目目录 | ${PROJECT_ROOT} |" >> "${ARCHIVE_FILE}"
echo "" >> "${ARCHIVE_FILE}"

# PRD 摘要
if [ -f "${PRD_FILE}" ]; then
  echo "## PRD 文档" >> "${ARCHIVE_FILE}"
  echo "" >> "${ARCHIVE_FILE}"
  echo "文件: spec-dev/prd/${REQ_NAME}-prd.md" >> "${ARCHIVE_FILE}"
  echo "" >> "${ARCHIVE_FILE}"
fi

# 技术方案摘要
if [ -f "${TECH_FILE}" ]; then
  echo "## 技术方案" >> "${ARCHIVE_FILE}"
  echo "" >> "${ARCHIVE_FILE}"
  echo "文件: spec-dev/tech/${REQ_NAME}-tech.md" >> "${ARCHIVE_FILE}"
  echo "" >> "${ARCHIVE_FILE}"
fi

# 任务清单
if [ -f "${SPEC_FILE}" ]; then
  echo "## 任务清单" >> "${ARCHIVE_FILE}"
  echo "" >> "${ARCHIVE_FILE}"
  echo "文件: spec-dev/spec/${REQ_NAME}-tasks.md" >> "${ARCHIVE_FILE}"
  echo "" >> "${ARCHIVE_FILE}"
  # 统计完成情况
  TOTAL=$(grep -c '^\[' "${SPEC_FILE}" 2>/dev/null || echo "0")
  DONE=$(grep -c '^\[x\]' "${SPEC_FILE}" 2>/dev/null || echo "0")
  echo "任务完成: ${DONE}/${TOTAL}" >> "${ARCHIVE_FILE}"
  echo "" >> "${ARCHIVE_FILE}"
fi

echo "归档完成: ${ARCHIVE_FILE}"
