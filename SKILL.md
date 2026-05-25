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
2. 解析项目根目录为用户指定的目标项目路径；未指定时使用用户当前工作区根目录。后续所有项目产物都必须以该根目录为准。
3. 如果项目内不存在 `spec-dev/.state.json` 且本轮有需求描述，运行：

   ```bash
   node <skill-root>/scripts/spec-dev.mjs init --root <project-root> --requirement "<需求描述>"
   ```

4. 否则每轮开始先运行：

   ```bash
   node <skill-root>/scripts/spec-dev.mjs next --root <project-root>
   ```

5. 优先读取 JSON 中 `required_read_files` 列出的绝对路径；兼容旧版本时再按 `required_reads` 解析：
   - `agents/*` 和 `references/*` 路径相对 skill 根目录。
   - `spec-dev/*` 路径相对项目根目录。
6. 生成 PRD、Tech、Spec 等文档时，必须写入 JSON 中 `expected_output_file` 给出的绝对路径；不要把 `expected_output` 当作当前 shell 目录下的相对路径写入。
7. 按 JSON 中 `message` 执行当前阶段，不主动加载其他阶段的大段说明。
8. 阶段完成后调用对应命令推进状态；记录 artifact 时优先传 `expected_output` 的项目相对路径，执行器会校验并归一化路径。

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
  "required_read_files": [
    "/absolute/skill-root/agents/prd-writer.md",
    "/absolute/skill-root/references/prd-template.md"
  ],
  "expected_output": "spec-dev/prd/<requirement_name>-prd.md",
  "expected_output_file": "/absolute/project-root/spec-dev/prd/<requirement_name>-prd.md",
  "project_root": "/absolute/project-root",
  "message": "短指令，供 AI 本轮执行"
}
```

## 阶段推进规则

- `research` 完成：`advance --completed research`
- `prd` 完成：必须调用 `advance --completed prd --artifact prd=<expected_output>`
- `tech` 完成：必须调用 `advance --completed tech --artifact tech=<expected_output>`，进入 `docs_confirm`
- 用户确认 `docs_confirm`：`gate --confirm docs_confirm`
- `spec` 完成：必须调用 `advance --completed spec --artifact spec=<expected_output>`
- `dev` 完成：`advance --completed dev`，进入 `dev_confirm`
- 用户确认 `dev_confirm`：`gate --confirm dev_confirm`
- `archive` 阶段：`archive`

不要用 `advance --completed archive` 跳过归档；归档只能由 `archive` 命令生成文件并推进到 `done`。

用户在门禁阶段提出修改意见时，更新对应产物后停留在当前门禁，不调用 `gate`。只有用户明确确认后才推进。

## 门禁响应规则

`docs_confirm` 必须展示：

1. PRD 核心要点摘要 3-5 条。
2. Tech 方案核心要点摘要 3-5 条。
3. 明确提示：「请确认 PRD 和技术方案，确认后将进入任务拆分阶段。你可以说"确认"继续，或提出修改意见。」

`dev_confirm` 必须展示：

1. 已完成任务数量和列表。
2. 修改的文件清单。
3. 构建/编译结果。
4. 明确提示：「开发已完成，请确认。确认后将进行归档。你可以说"确认"继续，或指出需要修改的地方。」

用户响应分类：

- 确认类：`确认`、`通过`、`OK`、`ok`、`没问题`、`继续` → 调用对应 `gate --confirm ...`。
- 修改类：`修改`、`补充`、`改一下`、`继续改` 加具体内容 → 修改对应产物，留在当前门禁，再次展示摘要等待确认。
- 取消类：`取消`、`退出`、`不做了` → 停止流程但保留已有产物。

## dev 阶段执行规则

- 读取 `spec-dev/spec/<name>-tasks.md`，只执行 `[]` 状态任务。
- 按任务顺序执行，不跳过、不自由发挥，严格遵循任务中的文件、修改指令和验收标准。
- 每完成一个任务，将 `[]` 改为 `[x]`，并在任务末尾追加 `- 完成时间: YYYY-MM-DD HH:mm`。
- 每个任务完成后立即运行项目构建/编译验证；Java 项目默认 `mvn compile`，其他项目使用对应构建命令。
- 编译失败时先修复，修复并重新验证通过后才能标记任务完成。
- 全部任务完成后再调用 `advance --completed dev`。

## 错误恢复

- 执行器返回 `ARTIFACT_REQUIRED` 时，不要猜默认路径；回到刚完成的阶段记录真实 artifact 路径，或修正 `.state.json`。
- 执行器返回 `ARTIFACT_NOT_FOUND` 时，先检查产物是否被删除、路径是否写错，再继续流程。
- 状态文件损坏时，根据已有 `spec-dev/prd`、`spec-dev/tech`、`spec-dev/spec`、`spec-dev/archive` 产物推断当前阶段并重建 state。
- 联网调研失败时降级为纯本地分析并告知用户；不要阻塞 PRD/Tech 生成。

## 首轮响应契约

首次触发并成功 `init` 后，回复必须：

1. 声明「Spec-Dev 流水线已激活，当前阶段：research」。
2. 显示需求摘要。
3. 说明后续流程：research → PRD → Tech → 等待确认 → Spec → Dev → 等待确认 → 归档。
4. 读取 `required_reads` 中的 research 指令并开始 research 阶段。
