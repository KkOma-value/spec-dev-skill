---
name: spec-dev
description: 需求开发全流程 Skill。接收需求后通过 JS 执行器按需加载阶段指令，推进 Deep Research → PRD → 技术方案 → UI/UX 设计 → 质量门禁确认 → 任务拆分 → 前端开发 → 预览确认 → 后端开发 → 质量门禁 → 归档。支持 new/evolve/patch 三种工作模式。当用户提到 spec-dev、需求开发流程、从需求到开发、需求拆分开发、开发流水线时触发此 skill。
when-to-use: 当用户输入 /spec-dev、$spec-dev、spec-dev:、spec-dev：后跟需求描述时触发。也适用于用户要求走完整的需求调研→文档→开发→归档流程时。
allowed-tools: Read, Edit, Write, Bash, Agent, WebFetch, WebSearch
user-invocable: true
version: 3.0.0
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
research → prd → tech → uiux → docs_confirm → spec → frontend → preview_confirm → backend → quality → archive → done
```

合法 phase 值：`research` | `prd` | `tech` | `uiux` | `docs_confirm` | `spec` | `frontend` | `preview_confirm` | `backend` | `quality` | `archive` | `done`

硬门禁不可跳过：

1. `docs_confirm`：PRD + Tech + UIUX 完成后暂停，等待用户确认。
2. `preview_confirm`：前端完成后暂停，展示预览等待用户确认后进入后端。
3. `quality`：自动化质量门禁，安全审查 + 代码审查 + 构建检查 + 覆盖率检查全部通过后方可归档。

## 工作模式

支持三种工作模式，通过 init 的 `--mode` 参数指定（默认 `new`）。无参数触发时，检测项目内 `.state.json` 的 `mode` 字段自动判断当前模式。

### new — 全新需求开发

- **描述**：从零开始执行完整流水线，所有阶段全部执行。
- **使用阶段**：全部 12 个阶段。
- **跳过**：无。
- **init 示例**：`node <skill-root>/scripts/spec-dev.mjs init --root <project-root> --requirement "<text>" --mode new`

### evolve — 基于已有产物演进

- **描述**：项目已有 PRD/Tech/UIUX 产物，基于已有文档直接进入 spec 阶段继续开发。
- **使用阶段**：`spec → frontend → preview_confirm → backend → quality → archive → done`
- **跳过**：`research`、`prd`、`tech`、`uiux`、`docs_confirm`
- **前置条件**：`spec-dev/prd/{name}-prd.md`、`spec-dev/tech/{name}-tech.md`、`spec-dev/uiux/{name}-uiux.md` 必须已存在。init 时校验，缺失则报错 `MISSING_PREREQUISITE_ARTIFACTS`。
- **init 示例**：`node <skill-root>/scripts/spec-dev.mjs init --root <project-root> --requirement "<text>" --mode evolve`
- **行为差异**：init 后直接进入 `spec` 阶段。`required_reads` 始终包含已有三份文档路径。

### patch — 快速修复 / 小改动

- **描述**：小型需求、Bug 修复或紧急补丁，跳过所有文档阶段，直接进入实现。
- **使用阶段**：`frontend → preview_confirm → backend → quality → archive → done`
- **跳过**：`research`、`prd`、`tech`、`uiux`、`docs_confirm`、`spec`
- **前置条件**：无强制文档要求。如果存在相关文档，会在 `required_reads` 中推荐读取但不强制。
- **init 示例**：`node <skill-root>/scripts/spec-dev.mjs init --root <project-root> --requirement "<text>" --mode patch`
- **行为差异**：init 后直接进入 `frontend` 阶段。不生成 PRD/Tech/UIUX/Spec 文档。任务清单由 AI 内联管理。quality 阶段仅执行安全审查 + 构建验证，跳过完整代码审查。archive 阶段生成轻量归档。

## 调度契约

1. 解析 skill 根目录为当前 `SKILL.md` 所在目录。
2. 解析项目根目录为用户当前工作区根目录。
3. 如果项目内不存在 `spec-dev/.state.json` 且本轮有需求描述，运行：

   ```bash
   node <skill-root>/scripts/spec-dev.mjs init --root <project-root> --requirement "<需求描述>" [--mode new|evolve|patch]
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
node scripts/spec-dev.mjs init --root <projectRoot> --requirement "<text>" [--mode new|evolve|patch]
node scripts/spec-dev.mjs next --root <projectRoot>
node scripts/spec-dev.mjs advance --root <projectRoot> --completed <phase> [--artifact <kind=path>]
node scripts/spec-dev.mjs gate --root <projectRoot> --confirm <docs_confirm|preview_confirm|dev_confirm>
node scripts/spec-dev.mjs archive --root <projectRoot>
node scripts/spec-dev.mjs validate --root <projectRoot>
```

所有命令输出 JSON。错误也以 JSON 输出，并使用非零退出码。

核心返回字段：

```json
{
  "schema_version": 2,
  "phase": "frontend",
  "mode": "new",
  "current_gate": null,
  "required_reads": ["spec-dev/spec/<name>-tasks.md"],
  "expected_output": null,
  "requirement": "...",
  "requirement_name": "...",
  "artifacts": {
    "prd": null,
    "tech": null,
    "uiux": null,
    "spec": null,
    "quality": null,
    "archive": null
  },
  "quality": {
    "security_passed": false,
    "code_review_passed": false,
    "build_passed": false,
    "coverage_passed": false
  },
  "message": "短指令，供 AI 本轮执行"
}
```

## 阶段推进规则

```
research       → advance --completed research
prd            → advance --completed prd --artifact prd=<path>
tech           → advance --completed tech --artifact tech=<path>
uiux           → advance --completed uiux --artifact uiux=<path>   [进入 docs_confirm]
docs_confirm   → gate --confirm docs_confirm                        [用户确认]
spec           → advance --completed spec --artifact spec=<path>
frontend       → advance --completed frontend                       [进入 preview_confirm]
preview_confirm → gate --confirm preview_confirm                    [用户确认]
backend        → advance --completed backend                        [进入 quality]
quality        → advance --completed quality --artifact quality=<path>  [自动化，非阻塞但需通过]
archive        → archive                                              [仅通过 archive 命令]
```

`gate` 命令合法值：`docs_confirm`、`preview_confirm`。`dev_confirm` 保留向后兼容，映射到新的 `preview_confirm` + `quality` 两段。

不要用 `advance --completed archive` 跳过归档；归档只能由 `archive` 命令生成文件并推进到 `done`。

用户在门禁阶段提出修改意见时，更新对应产物后停留在当前门禁，不调用 `gate`。只有用户明确确认后才推进。

## 门禁响应规则

### docs_confirm 门禁

`docs_confirm` 必须展示：

1. PRD 核心要点摘要 3-5 条。
2. Tech 方案核心要点摘要 3-5 条。
3. UIUX 设计核心要点摘要 3-5 条（页面结构、设计 token、图标库/组件库选型）。
4. 明确提示：「请确认 PRD、技术方案和 UI/UX 设计，确认后将进入任务拆分阶段。你可以说"确认"继续，或提出修改意见。」

### preview_confirm 门禁

`preview_confirm` 必须展示：

1. 前端已完成任务数量和列表。
2. 前端修改的文件清单。
3. 前端构建/编译结果。
4. 与 UIUX 设计文档的一致性对比（如有截图则展示截图）。
5. 明确提示：「前端开发已完成，请确认。确认后将进入后端开发。你可以说"确认"继续，或指出需要修改的地方。」

### 用户响应分类

所有门禁统一处理：

- 确认类：`确认`、`通过`、`OK`、`ok`、`没问题`、`继续` → 调用对应 `gate --confirm ...`。
- 修改类：`修改`、`补充`、`改一下`、`继续改` 加具体内容 → 修改对应产物，留在当前门禁，再次展示摘要等待确认。
- 取消类：`取消`、`退出`、`不做了` → 停止流程但保留已有产物。

### 门禁三态逻辑

对于 `preview_confirm`，用户可能只反馈部分修改意见（非全量否定），处理方式：

- **确认通过**：用户明确说「确认」「通过」「没问题，继续后端」→ 调用 `gate --confirm preview_confirm`，进入 backend。
- **部分修改**：用户说「XX 页面的按钮改一下，其他的没问题」→ 只修改指定项，完成后再次展示 preview_confirm 摘要，不调用 gate。
- **大改 / 重做**：用户说「整体样式需要重新设计」→ 回到 frontend 阶段重新实现，不调用 gate。完成后再次进入 preview_confirm。

## uiux 阶段执行规则

- 读取 `agents/ui-designer.md` 和 `references/uiux-template.md`。
- 基于已生成的 PRD (`spec-dev/prd/{name}-prd.md`) 和 Tech (`spec-dev/tech/{name}-tech.md`) 文档设计 UI/UX。
- 必须声明图标库（Lucide / Heroicons / Tabler 三选一）和组件库选型，禁止使用 emoji 作为功能图标。
- 必须定义设计 token 系统：颜色调色板（主色/辅色/语义色/中性色 >= 15 色）、排版层级（标题/正文/辅助文本 >= 4 级）、间距系统（4px 基准）。
- 必须描述每个页面的 loading / empty / error / success / edge-case 交互状态。
- 必须定义响应式断点（mobile < 768px, tablet 768-1024px, desktop > 1024px）。
- 产出的 UI/UX 文档包含 UI 自检清单：无 emoji 图标、无紫色渐变模板化配色、颜色来自设计 token。
- 完成后调用 `advance --completed uiux --artifact uiux=<path>`，自动进入 `docs_confirm` 门禁。

## frontend 阶段执行规则

- 读取 `spec-dev/spec/{name}-tasks.md`，只执行标记为「前端」或 `[FE]` 的任务。
- 按任务顺序执行，不跳过、不自由发挥，严格遵循任务中的文件、修改指令和验收标准。
- 每个任务完成后：
  1. 将 `[]` 改为 `[x]`，追加 `- 完成时间: YYYY-MM-DD HH:mm`。
  2. 运行前端构建验证（`npm run build` / `pnpm build` 等）。
  3. 构建失败时先修复再标记完成。
- 全部前端任务完成后调用 `advance --completed frontend`，进入 `preview_confirm`。

## backend 阶段执行规则

- 读取 `spec-dev/spec/{name}-tasks.md`，只执行标记为「后端」或 `[BE]` 的任务。
- 按任务顺序执行，不跳过、不自由发挥，严格遵循任务中的文件、修改指令和验收标准。
- 每个任务完成后：
  1. 将 `[]` 改为 `[x]`，追加 `- 完成时间: YYYY-MM-DD HH:mm`。
  2. 运行后端构建验证（Java: `mvn compile`，Go: `go build ./...`，其他按项目类型）。
  3. 构建失败时先修复再标记完成。
- 全部后端任务完成后调用 `advance --completed backend`，进入 `quality`。

## quality 阶段执行规则

- 读取 `agents/quality-reviewer.md`、`agents/security-reviewer.md`、`references/quality-template.md`。
- 依次执行四项检查：

  1. **安全审查**：扫描硬编码密钥（`password=`、`secret=`、`apiKey=`、`token=` 等模式）、SQL 注入风险（字符串拼接构建 SQL）、XSS 风险（未转义的用户输入）、认证/授权漏洞（缺失权限校验）、敏感数据泄露（日志中输出密码/手机号等）。由 `agents/security-reviewer.md` 指导执行。

  2. **代码审查**：检查文件行数 <= 800、函数行数 <= 50、嵌套层级 <= 4、无 `console.log`/debug 语句、错误处理显式。由 `agents/quality-reviewer.md` 指导执行。

  3. **构建验证**：运行项目构建命令（Java: `mvn compile`，Node: `npm run build`，其他按项目类型），确认零错误。

  4. **覆盖率检查**：运行测试并验证覆盖率 >= 80%（读取 coverage 报告或运行测试命令）。

- 发现 **CRITICAL** 级别问题时，必须先修复代码，然后重新执行 quality。
- **HIGH** / **MEDIUM** 问题记录在质量报告中，不阻塞归档。
- `patch` 模式下，quality 仅执行安全审查 + 构建验证，跳过完整代码审查。
- 全部通过后调用 `advance --completed quality --artifact quality=<path>`。

## 归档规则

- 仅通过 `archive` 命令进入归档。
- archive 命令会自动：读取 PRD/Tech/UIUX/Spec/Quality 产物路径、统计任务完成数、渲染归档模板、生成 `spec-dev/archive/{YYYY-MM-DD}-{name}.md`。
- `new` / `evolve` 模式归档包含：PRD 摘要、Tech 摘要、UIUX 摘要、变更清单、任务完成统计、质量门禁结果。
- `patch` 模式归档仅包含：变更清单、任务完成统计（精简版）。

## 错误恢复

- 执行器返回 `ARTIFACT_REQUIRED` 时，不要猜默认路径；回到刚完成的阶段记录真实 artifact 路径，或修正 `.state.json`。
- 执行器返回 `ARTIFACT_NOT_FOUND` 时，先检查产物是否被删除、路径是否写错，再继续流程。
- 执行器返回 `MISSING_PREREQUISITE_ARTIFACTS` 时，检查 evolve 模式所需的三份前置文档（PRD/Tech/UIUX）是否存在。
- 执行器返回 `QUALITY_GATE_FAILED` 时，根据 quality report 中的 CRITICAL 问题修复代码，重新执行 quality。
- 执行器返回 `INVALID_MODE` 时，检查 `--mode` 参数是否为 `new` / `evolve` / `patch` 之一。
- 状态文件损坏时，根据已有产物目录（`spec-dev/prd`、`spec-dev/tech`、`spec-dev/uiux`、`spec-dev/spec`、`spec-dev/quality`、`spec-dev/archive`）推断当前阶段并重建 state。
- 联网调研失败时降级为纯本地分析并告知用户；不要阻塞 PRD/Tech/UIUX 生成。

## 首轮响应契约

首次触发并成功 `init` 后，回复必须：

1. 声明「Spec-Dev 流水线已激活，当前阶段：{phase}，工作模式：{mode}」。
2. 显示需求摘要。
3. 根据当前模式说明后续流程：
   - `new`：research → PRD → Tech → UIUX → 等待确认 → Spec → Frontend → 等待确认 → Backend → Quality → 归档。
   - `evolve`：Spec → Frontend → 等待确认 → Backend → Quality → 归档。
   - `patch`：Frontend → 等待确认 → Backend → Quality（轻量）→ 归档。
4. 读取 `required_reads` 中的当前阶段指令并开始执行。
