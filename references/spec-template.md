# Spec 任务清单模板

# {需求名称} — 任务清单

## 基本信息

| 字段 | 值 |
|------|-----|
| 需求名称 | {需求名称} |
| 创建日期 | {YYYY-MM-DD} |
| PRD 文档 | output/{requirement_name}-prd.md |
| Architecture 文档 | output/{requirement_name}-architecture.md |
| UI/UX 文档 | output/{requirement_name}-uiux.md |
| 任务总数 | {N} |

## Proposal 摘要

| 字段 | 值 |
|------|-----|
| Proposal 文档 | .spec-dev/changes/{requirement_name}/proposal.md |
| 确认门 | docs_confirm 已确认，pre_code 待完成 |
| 实施顺序 | frontend → preview_confirm → backend → quality → delivery |

## 任务清单

[] 1. {任务标题}
   - 文件: {完整文件路径}
   - {具体修改指令：新增什么字段/方法/类，写明类型、名称、注解、逻辑}
   - {具体修改指令续}
   - 验收: {编译通过/测试通过/具体验证方式}

[] 2. {任务标题}
   - 文件: {完整文件路径}
   - {具体修改指令}
   - 验收: {具体验收标准}

## 进度统计

- 总任务数: {N}
- 已完成: {已完成数}
- 未完成: {未完成数}
