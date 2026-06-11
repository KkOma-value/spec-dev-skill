# {需求名称} - Delivery Report

## 基本信息

| 字段 | 值 |
|------|-----|
| 需求名称 | {需求名称} |
| 所属项目 | {项目名称} |
| 工作模式 | {工作模式} |
| 开始日期 | {开始日期} |
| 交付日期 | {交付日期} |

## 交付产物

| 产物 | 路径 |
|------|------|
| Research | `{research_path}` |
| PRD | `{prd_path}` |
| Architecture | `{architecture_path}` |
| UI/UX | `{uiux_path}` |
| Proposal | `.spec-dev/changes/{需求名称}/proposal.md` |
| Tasks | `{tasks_path}` |
| Quality Report | `{quality_path}` |
| Delivery Report | `{delivery_path}` |

## 任务完成情况

Tasks completed: {task_done}/{task_total}

## 质量门禁

质量结论以 `{quality_path}` 为准。交付前必须确认无 CRITICAL / HIGH 阻断项，构建、测试、安全和 UI 一致性检查均已记录。

## 交付证据

- [ ] 构建命令与结果已记录
- [ ] 测试命令与结果已记录
- [ ] 安全审查结论已记录
- [ ] UI/UX 一致性检查已记录
- [ ] 已知风险和后续事项已记录

## 后续风险

- {记录未阻塞交付但需要跟进的风险}
