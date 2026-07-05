---
name: spec-dev
description: 并行治理式需求开发全流程 Skill。通过零依赖 JS 执行器推进 research → docs (并行三文档) → docs_check → docs_confirm → spec (拆分+审查) → dev (波次并行) → preview_confirm → quality (三路并行+自动修复) → delivery。状态记录在 .spec-dev/，三文档和交付产物写入 output/，任务写入 .spec-dev/changes/。
when-to-use: 当用户输入 /spec-dev、$spec-dev、spec-dev:、spec-dev：后跟需求描述时触发。也适用于用户要求走完整需求调研、三文档、任务拆分、波次并行实现、质量门禁与交付流程时。
allowed-tools: Read, Edit, Write, Bash, Agent, WebFetch, WebSearch
user-invocable: true
version: 5.0.0
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
baseline → research → docs → docs_check → docs_confirm → spec → dev → preview_confirm → quality → delivery → done
```

合法 phase 值：`baseline` | `research` | `docs` | `docs_check` | `docs_confirm` | `spec` | `dev` | `preview_confirm` | `quality` | `delivery` | `done`

工作模式：

- `new`：从 `research` 开始，适合新需求。
- `evolve`：从 `baseline` 开始，先确认现有项目边界，再走差量 research 和三文档。
- `patch`：从 `baseline` 开始，先确认缺陷范围、复现条件和回归风险，再走轻量但完整的文档与交付闭环。

硬门禁不可跳过：

1. `docs_confirm`：PRD + Architecture + UIUX 完成后暂停，等待用户确认。
2. `preview_confirm`：前端完成后暂停，展示预览等待用户确认后进入质量门禁。

`quality` 为自动门禁：三路并行审查（安全/代码/构建+测试）+ 自动修复循环，通过后自动进入 delivery。仅在修复 2 轮后仍有 CRITICAL 时暂停等待用户。

## 目录与产物

```text
{project}/.spec-dev/
├── state.json
├── SESSION_BRIEF.md
└── changes/{requirement_name}/
    ├── proposal.md
    ├── api-contract.md
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
7. JSON 中 `parallel_hint` 字段指示当前阶段的并行策略：主会话必须按 `parallel_hint` 用 Agent 工具并行派发 subagent。编码 subagent prompt 由「agent 指令文件 + 输入产物 + 输出路径 + 强制自查段」拼成。
8. 阶段完成后调用对应命令推进状态。

## JS 执行器命令

```bash
node scripts/spec-dev.mjs init --root <projectRoot> --requirement "<text>" [--mode new|evolve|patch]
node scripts/spec-dev.mjs next --root <projectRoot>
node scripts/spec-dev.mjs advance --root <projectRoot> --completed <phase> [--artifact <kind=path>]
node scripts/spec-dev.mjs gate --root <projectRoot> --confirm <docs_confirm|preview_confirm>
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
docs_check    → advance --completed docs_check
docs_confirm  → gate --confirm docs_confirm
spec          → advance --completed spec --artifact proposal=.spec-dev/changes/{name}/proposal.md --artifact tasks=.spec-dev/changes/{name}/tasks.md --artifact contract=.spec-dev/changes/{name}/api-contract.md
dev           → 每 wave 完成后 advance --completed dev --wave <n>；全部 wave 完成自动进入 preview_confirm
preview_confirm → gate --confirm preview_confirm
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

- 按 `parallel_hint` 同时派出 3 个并行 subagent：
  - prd-writer：读取 `agents/prd-writer.md` + `references/prd-template.md` + research → `output/{name}-prd.md`
  - architecture-writer：读取 `agents/architecture-writer.md` + `references/architecture-template.md` + research → `output/{name}-architecture.md`
  - ui-designer：读取 `agents/ui-designer.md` + `references/uiux-template.md` + `references/uiux-pro-max-adapter.md` + research → `output/{name}-uiux.md`
- 三个都完成后 advance --completed docs。

### docs_check

- 自动一致性校验：对照 PRD 功能点 ↔ Architecture 模块 ↔ UIUX 页面三者。
- 确认每个 PRD 功能点在 Architecture 有承接模块、在 UIUX 有对应页面/状态。
- 发现缺口直接修文档，完成后 advance --completed docs_check。

### docs_confirm

必须展示：

1. PRD 核心要点 3-5 条。
2. Architecture 核心决策 3-5 条。
3. UIUX 核心设计 3-5 条（页面结构、设计 token、图标库/组件库）。
4. 明确提示：「请确认 PRD、Architecture 和 UI/UX 设计，确认后将进入任务拆分阶段。你可以说"确认"继续，或提出修改意见。」

### spec

- 读取 `agents/spec-generator.md` 和 `references/spec-template.md`。
- 生成三个产物：
  - `.spec-dev/changes/{requirement_name}/proposal.md`
  - `.spec-dev/changes/{requirement_name}/tasks.md`（头部含 Pre-Code Checklist，任务按 wave 组织）
  - `.spec-dev/changes/{requirement_name}/api-contract.md`（前后端接口唯一事实源）
- 拆分完成后派单个拆分审查 subagent 按红旗清单（XL 任务、无验收标准、模糊指令、wave 内文件冲突、依赖顺序颠倒）检查 tasks.md，问题修正后才 advance --completed spec。

### dev

- 按 tasks.md 的 wave 逐波并行执行：wave 内无依赖切片由并行 subagent 实现（每波 ≤4 个）。
- 每个编码 subagent 返回前完成强制自查（导入完整性、接口路径与 contract 一致、空值/边界处理、无 emoji/调试语句）。
- 单切片 >5 任务或跨切片重构留在主会话串行执行。
- 每 wave 完成后跑一次构建（FE wave 跑 FE 构建，BE wave 跑 BE 构建），构建失败由主会话统一修复。
- 全部 wave 完成自动进入 preview_confirm。

### preview_confirm

必须展示：

1. 前端已完成任务数量和列表。
2. 前端修改文件清单。
3. 前端构建/编译结果。
4. 与 `output/*-uiux.md` 的一致性对比。
5. 明确提示：「前端开发已完成，请确认。确认后将进入质量门禁阶段。你可以说"确认"继续，或指出需要修改的地方。」

### quality

- 按 `parallel_hint` 三路并行审查：
  - security-review：读取 `agents/security-reviewer.md` + `references/security-examples.md`
  - code-review：读取 `agents/quality-reviewer.md` + api-contract + tasks
  - build-and-test：读取 `references/quality-checklist.md`
- 主会话汇总发现后自动修复 CRITICAL/HIGH 问题，最多 2 轮。
- 2 轮后仍有 CRITICAL 则暂停问用户。
- 通过后自动生成 `output/{requirement_name}-quality-report.md` 并 advance --completed quality。

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
   - `new`：research → docs(并行) → docs_check → 等待确认(docs_confirm) → spec(拆分+审查) → dev(波次并行) → 等待确认(preview_confirm) → quality(三路并行+自动修复) → delivery。
   - `evolve` / `patch`：baseline → research → ... (同上)。
4. 读取 `required_reads` 中的当前阶段指令并开始执行。
