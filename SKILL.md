---
name: spec-dev
description: 需求开发全流程 Skill。接收需求后通过 JS 执行器按需加载阶段指令，推进 Deep Research → PRD → 技术方案 → 质量门禁确认 → 任务拆分 → 自动开发 → 质量门禁确认 → 归档。适用于 Java 后端微服务需求开发，兼容其他技术栈。当用户提到 spec-dev、需求开发流程、从需求到开发、需求拆分开发、开发流水线时触发此 skill。
when-to-use: 当用户输入 /spec-dev、$spec-dev、spec-dev:、spec-dev：后跟需求描述时触发。也适用于用户要求走完整的需求调研→文档→开发→归档流程时。
allowed-tools: Read, Edit, Write, Bash, Agent, WebFetch, WebSearch
user-invocable: true
version: 2.0.0
argument-hint: 需求描述
---

# Spec-Dev — JS 加载式需求开发流水线

你是 Spec-Dev 流水线调度器。每次调用时都先运行本 skill 自带的 JS 执行器，让执行器判断当前阶段、返回本轮最小化需要读取的 Markdown 资源，再按返回的短指令继续。

## 触发方式

- `$spec-dev <需求描述>`
- `/spec-dev <需求描述>`
- `spec-dev: <需求描述>`
- `spec-dev：<需求描述>`
- 无参数时：读取项目内 `spec-dev/.state.json` 恢复未完成流程

## 固定阶段链

```
research → prd → tech → docs_confirm → spec → dev → dev_confirm → archive → done
```

合法 phase 值：`research` | `prd` | `tech` | `docs_confirm` | `spec` | `dev` | `dev_confirm` | `archive` | `done`

硬门禁不可跳过：

1. `docs_confirm`：PRD + Tech 完成后暂停，等待用户确认。
2. `dev_confirm`：开发完成后暂停，等待用户确认后归档。

## 调度契约

1. 解析 skill 根目录为当前 `SKILL.md` 所在目录。
2. 解析项目根目录为用户当前工作区根目录。
3. 如果项目内不存在 `spec-dev/.state.json` 且本轮有需求描述，运行：

   ```bash
   node <skill-root>/scripts/spec-dev.mjs init --root <project-root> --requirement "<需求描述>"
   ```

4. 否则每轮开始先运行：

   ```bash
   node <skill-root>/scripts/spec-dev.mjs next --root <project-root>
   ```

5. 只读取 JSON 中 `required_reads` 列出的文件：
   - `agents/*` 和 `references/*` 路径相对 skill 根目录。
   - `spec-dev/*` 路径相对项目根目录。
6. 按 JSON 中 `message` 执行当前阶段，不主动加载其他阶段的大段说明。
7. 阶段完成后调用对应命令推进状态。

## JS 执行器命令

```bash
node scripts/spec-dev.mjs init --root <projectRoot> --requirement "<text>"
node scripts/spec-dev.mjs next --root <projectRoot>
node scripts/spec-dev.mjs advance --root <projectRoot> --completed <phase> [--artifact <kind=path>]
node scripts/spec-dev.mjs gate --root <projectRoot> --confirm <docs_confirm|dev_confirm>
node scripts/spec-dev.mjs archive --root <projectRoot>
node scripts/spec-dev.mjs validate --root <projectRoot>
```

所有命令输出 JSON。错误也以 JSON 输出，并使用非零退出码。

核心返回字段：

```json
{
  "phase": "prd",
  "current_gate": null,
  "required_reads": ["agents/prd-writer.md", "references/prd-template.md"],
  "expected_output": "spec-dev/prd/<requirement_name>-prd.md",
  "message": "短指令，供 AI 本轮执行"
}
```

## 阶段推进规则

- `research` 完成：`advance --completed research`
- `prd` 完成：`advance --completed prd --artifact prd=<path>`
- `tech` 完成：`advance --completed tech --artifact tech=<path>`，进入 `docs_confirm`
- 用户确认 `docs_confirm`：`gate --confirm docs_confirm`
- `spec` 完成：`advance --completed spec --artifact spec=<path>`
- `dev` 完成：`advance --completed dev`，进入 `dev_confirm`
- 用户确认 `dev_confirm`：`gate --confirm dev_confirm`
- `archive` 阶段：`archive`

用户在门禁阶段提出修改意见时，更新对应产物后停留在当前门禁，不调用 `gate`。只有用户明确确认后才推进。

## 首轮响应契约

首次触发并成功 `init` 后，回复必须：

1. 声明「Spec-Dev 流水线已激活，当前阶段：research」。
2. 显示需求摘要。
3. 说明后续流程：research → PRD → Tech → 等待确认 → Spec → Dev → 等待确认 → 归档。
4. 读取 `required_reads` 中的 research 指令并开始 research 阶段。
