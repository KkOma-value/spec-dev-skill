---
name: spec-dev
description: 轻量治理式需求开发全流程 Skill。通过零依赖 JS 执行器推进 research → docs → docs_confirm → spec → pre_code → frontend → preview_confirm → backend → quality → delivery。状态记录在 .spec-dev/，三文档和交付产物写入 output/，任务写入 .spec-dev/changes/。
when-to-use: 当用户输入 /spec-dev、$spec-dev、spec-dev:、spec-dev：后跟需求描述时触发。也适用于用户要求走完整需求调研、三文档、任务拆分、前后端实现、质量门禁与交付流程时。
allowed-tools: Read, Edit, Write, Bash, Agent, WebFetch, WebSearch
user-invocable: true
version: 4.0.0
argument-hint: 需求描述
---

# Spec-Dev — 轻量治理流程调度器

你是 Spec-Dev 流水线调度器。每次调用时先运行本 skill 自带的 JS 执行器，让执行器判断当前阶段、返回本轮最小化需要读取的 Markdown 资源，再按返回的短指令继续。

## 触发方式

- `$spec-dev <需求描述>`
- `/spec-dev <需求描述>`
- `spec-dev: <需求描述>`
- `spec-dev：<需求描述>`
- 无参数时：读取项目内 `.spec-dev/state.json` 恢复未完成流程

## 固定阶段链

```text
baseline → research → docs → docs_confirm → spec → pre_code → frontend → preview_confirm → backend → quality → delivery → done
```

合法 phase 值：`baseline` | `research` | `docs` | `docs_confirm` | `spec` | `pre_code` | `frontend` | `preview_confirm` | `backend` | `quality` | `delivery` | `done`

工作模式：

- `new`：从 `research` 开始，适合新需求。
- `evolve`：从 `baseline` 开始，先确认现有项目边界，再走差量 research 和三文档。
- `patch`：从 `baseline` 开始，先确认缺陷范围、复现条件和回归风险，再走轻量但完整的文档与交付闭环。

硬门禁不可跳过：

1. `docs_confirm`：PRD + Architecture + UIUX 完成后暂停，等待用户确认。
2. `pre_code`：编码前必须完成 `.spec-dev/PRE_CODE_CHECKLIST.md`。
3. `preview_confirm`：前端完成后暂停，展示预览等待用户确认后进入后端。
4. `quality`：安全审查 + 代码审查 + 构建检查 + 覆盖率检查通过后方可 delivery。

## 目录与产物

```text
{project}/.spec-dev/
├── state.json
├── SESSION_BRIEF.md
├── PRE_CODE_CHECKLIST.md
└── changes/{requirement_name}/
    ├── proposal.md
    └── tasks.md

{project}/output/
├── {requirement_name}-research.md
├── {requirement_name}-prd.md
├── {requirement_name}-architecture.md
├── {requirement_name}-uiux.md
├── {requirement_name}-quality-report.md
└── {YYYY-MM-DD}-{requirement_name}-delivery.md
```

旧 `spec-dev/.state.json` 可被执行器读取并迁移到 `.spec-dev/state.json`。新写入只写 `.spec-dev/` 和 `output/`。

## 调度契约

1. 解析 skill 根目录为当前 `SKILL.md` 所在目录。
2. 解析项目根目录为用户当前工作区根目录。
3. 如果项目内不存在 `.spec-dev/state.json` 且本轮有需求描述，运行：

   ```bash
   node <skill-root>/scripts/spec-dev.mjs init --root <project-root> --requirement "<需求描述>" [--mode new|evolve|patch]
   ```

4. 否则每轮开始先运行：

   ```bash
   node <skill-root>/scripts/spec-dev.mjs next --root <project-root>
   ```

5. 只读取 JSON 中 `required_reads` 列出的文件：
   - `agents/*` 和 `references/*` 路径相对 skill 根目录。
   - `.spec-dev/*` 和 `output/*` 路径相对项目根目录。
6. 按 JSON 中 `message` 执行当前阶段，不主动加载其他阶段的大段说明。
7. 阶段完成后调用对应命令推进状态。

## JS 执行器命令

```bash
node scripts/spec-dev.mjs init --root <projectRoot> --requirement "<text>" [--mode new|evolve|patch]
node scripts/spec-dev.mjs next --root <projectRoot>
node scripts/spec-dev.mjs advance --root <projectRoot> --completed <phase> [--artifact <kind=path>]
node scripts/spec-dev.mjs gate --root <projectRoot> --confirm <docs_confirm|preview_confirm|dev_confirm>
node scripts/spec-dev.mjs deliver --root <projectRoot>
node scripts/spec-dev.mjs archive --root <projectRoot>   # deliver 的兼容别名
node scripts/spec-dev.mjs validate --root <projectRoot>
```

核心返回字段：

```json
{
  "schema_version": 3,
  "phase": "docs",
  "mode": "new",
  "current_gate": null,
  "required_reads": ["agents/prd-writer.md"],
  "expected_output": null,
  "expected_outputs": ["output/name-prd.md", "output/name-architecture.md", "output/name-uiux.md"],
  "artifacts": {
    "research": null,
    "prd": null,
    "architecture": null,
    "uiux": null,
    "proposal": null,
    "tasks": null,
    "quality": null,
    "delivery": null
  }
}
```

## 阶段推进规则

```text
baseline      → advance --completed baseline
research      → advance --completed research --artifact research=output/{name}-research.md
docs          → advance --completed docs --artifact prd=output/{name}-prd.md --artifact architecture=output/{name}-architecture.md --artifact uiux=output/{name}-uiux.md
docs_confirm  → gate --confirm docs_confirm
spec          → advance --completed spec --artifact proposal=.spec-dev/changes/{name}/proposal.md --artifact tasks=.spec-dev/changes/{name}/tasks.md
pre_code      → 完成 .spec-dev/PRE_CODE_CHECKLIST.md 后 advance --completed pre_code
frontend      → advance --completed frontend
preview_confirm → gate --confirm preview_confirm
backend       → advance --completed backend
quality       → advance --completed quality --artifact quality=output/{name}-quality-report.md
delivery      → deliver
```

不要用 `advance --completed delivery` 跳过交付报告；delivery 只能由 `deliver` 命令生成文件并推进到 `done`。

## 阶段执行规则

### research

- 读取 `agents/researcher.md`。
- 若项目存在 `knowledge/` 或 `output/knowledge-cache/*-knowledge-bundle.json`，必须先读取并继承。
- 生成 `output/{requirement_name}-research.md`。

### docs

- 读取 `agents/prd-writer.md`、`agents/architecture-writer.md`、`agents/ui-designer.md`。
- 读取 `references/prd-template.md`、`references/architecture-template.md`、`references/uiux-template.md`、`references/uiux-pro-max-adapter.md`。
- 基于 research 一次性生成三份核心文档：
  - `output/{requirement_name}-prd.md`
  - `output/{requirement_name}-architecture.md`
  - `output/{requirement_name}-uiux.md`

### docs_confirm

必须展示：

1. PRD 核心要点 3-5 条。
2. Architecture 核心决策 3-5 条。
3. UIUX 核心设计 3-5 条（页面结构、设计 token、图标库/组件库）。
4. 明确提示：「请确认 PRD、Architecture 和 UI/UX 设计，确认后将进入任务拆分阶段。你可以说"确认"继续，或提出修改意见。」

### spec

- 读取 `agents/spec-generator.md` 和 `references/spec-template.md`。
- 生成 `.spec-dev/changes/{requirement_name}/proposal.md` 和 `.spec-dev/changes/{requirement_name}/tasks.md`。
- 任务必须按前端优先、后端随后、质量收口组织。

### pre_code

- 读取并完成 `.spec-dev/PRE_CODE_CHECKLIST.md`。
- 未完成任意 `- [ ]` 项时，执行器会阻止进入 frontend。

### frontend

- 只执行 tasks 中标记为「前端」或 `[FE]` 的任务。
- 每个任务完成后将 `[]` 改为 `[x]`，追加完成时间，并运行前端构建验证。
- 全部前端任务完成后进入 `preview_confirm`。

### preview_confirm

必须展示：

1. 前端已完成任务数量和列表。
2. 前端修改文件清单。
3. 前端构建/编译结果。
4. 与 `output/*-uiux.md` 的一致性对比。
5. 明确提示：「前端开发已完成，请确认。确认后将进入后端开发。你可以说"确认"继续，或指出需要修改的地方。」

### backend

- 只执行 tasks 中标记为「后端」或 `[BE]` 的任务。
- 每个任务完成后将 `[]` 改为 `[x]`，追加完成时间，并运行后端构建验证。

### quality

- 读取 `agents/quality-reviewer.md`、`agents/security-reviewer.md`、`references/quality-checklist.md`。
- 执行安全审查、代码审查、构建验证、覆盖率检查和 UI 一致性检查。
- 生成 `output/{requirement_name}-quality-report.md`。

### delivery

- 调用 `node scripts/spec-dev.mjs deliver --root <projectRoot>`。
- 生成 `output/{YYYY-MM-DD}-{requirement_name}-delivery.md`。
- `archive` 命令仅作为兼容别名。

## 门禁响应规则

- 确认类：`确认`、`通过`、`OK`、`ok`、`没问题`、`继续` → 调用当前 gate 的确认命令。
- 修改类：`修改`、`补充`、`改一下`、`继续改` 加具体内容 → 修改对应产物，停留当前 gate。
- 取消类：`取消`、`退出`、`不做了` → 停止流程但保留已有产物。

## 首轮响应契约

首次触发并成功 `init` 后，回复必须：

1. 声明「Spec-Dev 流水线已激活，当前阶段：{phase}，工作模式：{mode}」。
2. 显示需求摘要。
3. 说明流程：
   - `new`：research → docs → 等待确认 → spec → pre_code → frontend → 等待确认 → backend → quality → delivery。
   - `evolve` / `patch`：baseline → research → docs → 等待确认 → spec → pre_code → frontend → 等待确认 → backend → quality → delivery。
4. 读取 `required_reads` 中的当前阶段指令并开始执行。
