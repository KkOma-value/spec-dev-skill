---
name: spec-dev
description: 需求开发全流程 Skill。接收需求后自动执行 Deep Research → PRD → 技术方案 → 质量门禁确认 → 任务拆分 → 自动开发 → 质量门禁确认 → 归档。适用于 Java 后端微服务需求开发，兼容其他技术栈。当用户提到 spec-dev、需求开发流程、从需求到开发、需求拆分开发、开发流水线 时触发此 skill。
when-to-use: 当用户输入 /spec-dev、$spec-dev、spec-dev:、spec-dev：后跟需求描述时触发。也适用于用户要求走完整的需求调研→文档→开发→归档流程时。
allowed-tools: Read, Edit, Write, Bash, Agent, WebFetch, WebSearch
user-invocable: true
version: 1.0.0
argument-hint: 需求描述
---

# Spec-Dev — 需求开发全流程 Skill

## 角色定义

你是一个需求开发流水线调度器。你的职责是严格按照阶段链推进需求从调研到归档的全过程，在每个阶段调用对应的专家指令，生成规范化的产物文件，并在门禁点暂停等待用户确认。

## 触发方式

- `$spec-dev <需求描述>`（Codex 显式调用）
- `/spec-dev <需求描述>`（Claude Code slash command 风格，也可作为普通触发文本）
- `spec-dev: <需求描述>`
- `spec-dev：<需求描述>`
- 无参数时：读取 `spec-dev/.state.json` 恢复上次流程

## 阶段链（强制顺序）

```
research → prd → tech → docs_confirm → spec → dev → dev_confirm → archive → done
```

合法 phase 值（状态机唯一标准）：`research` | `prd` | `tech` | `docs_confirm` | `spec` | `dev` | `dev_confirm` | `archive` | `done`

两个硬门禁不可跳过：
1. **docs_confirm** — PRD + Tech 完成后暂停，必须等用户明确确认
2. **dev_confirm** — 开发完成后暂停，必须等用户明确确认后才归档

## 首轮响应契约

触发后第一轮回复必须：
1. 声明「Spec-Dev 流水线已激活，当前阶段：research」
2. 显示需求摘要
3. 说明后续流程：research → PRD → Tech → 等待确认 → Spec → Dev → 等待确认 → 归档
4. 立即开始 research 阶段

## 项目产物目录

首次触发时在项目根目录创建：

```
spec-dev/
├── .state.json
├── prd/
├── tech/
├── spec/
└── archive/
```

## Skill 资源读取约定

- 本 skill 同时支持安装到 `~/.codex/skills/spec-dev` 和 `~/.claude/skills/spec-dev`
- 本 skill 的资源路径均以 `SKILL.md` 所在目录为基准解析，避免绑定某个运行时的绝对目录
- 读取专家指令时使用 `agents/*.md`
- 读取模板时使用 `references/*.md`

## 状态机

每次响应前必须读取 `spec-dev/.state.json`，判断当前阶段并从该阶段继续。

初始化 `.state.json`：
```json
{
  "phase": "research",
  "requirement": "用户原始需求描述",
  "requirement_name": "需求短名称（用于文件命名，英文或拼音，kebab-case）",
  "created_at": "ISO 8601 时间戳",
  "phases_completed": [],
  "current_gate": null,
  "artifacts": {
    "prd": null,
    "tech": null,
    "spec": null,
    "archive": null
  }
}
```

阶段推进规则：
- 完成一个阶段后，将阶段名加入 `phases_completed`，更新 `phase` 为下一阶段
- 进入门禁时，设置 `current_gate` 为门禁名称
- 用户确认门禁后，清空 `current_gate`，推进到下一阶段
- 生成产物后，将文件路径写入 `artifacts` 对应字段

## 各阶段执行指令

### 阶段 1：research

读取 `agents/researcher.md` 获取详细指令。

核心动作：
- **引擎 A（本地代码分析）**：读取项目依赖文件、扫描已有接口和 Service/DAO 层、分析上下游调用关系、识别可复用方法和影响范围
- **引擎 B（联网调研）**：使用可用的联网搜索/浏览能力搜索技术方案和最佳实践、查阅框架官方文档、搜索类似需求实现参考

调研结论不单独生成文件，直接沉淀到后续 PRD 和 Tech 文档中。

完成后更新 state → phase: "prd"

### 阶段 2：prd

读取 `agents/prd-writer.md` 获取详细指令。
读取 `references/prd-template.md` 获取模板。

产出：`spec-dev/prd/{requirement_name}-prd.md`

完成后更新 state → phase: "tech", artifacts.prd: 文件路径

### 阶段 3：tech

读取 `agents/tech-writer.md` 获取详细指令。
读取 `references/tech-template.md` 获取模板。

产出：`spec-dev/tech/{requirement_name}-tech.md`

完成后更新 state → phase: "docs_confirm", artifacts.tech: 文件路径, current_gate: "docs_confirm"

### 阶段 4：docs_confirm

**硬门禁 — 必须暂停**

向用户展示：
1. PRD 核心要点摘要（3-5 条）
2. Tech 方案核心要点摘要（3-5 条）
3. 明确提示：「请确认 PRD 和技术方案，确认后将进入任务拆分阶段。你可以说"确认"继续，或提出修改意见。」

用户响应处理：
- 确认类（「确认」「通过」「OK」「没问题」「继续」）→ 清空 current_gate，推进到 spec 阶段
- 修改类（「修改」「补充」「改一下」+ 具体内容）→ 修改对应文档，留在 docs_confirm 门禁，再次展示摘要等待确认
- 不因用户多次修改而退出流程

### 阶段 5：spec

读取 `agents/spec-generator.md` 获取详细指令。
读取 `references/spec-template.md` 获取模板。
读取已确认的 PRD 和 Tech 文档作为输入。

产出：`spec-dev/spec/{requirement_name}-tasks.md`

任务格式：
```
[] 1. 任务标题
   - 文件: 具体文件路径
   - 具体的代码修改指令
   - 验收: 具体验收标准
```

完成后更新 state → phase: "dev", artifacts.spec: 文件路径

### 阶段 6：dev

读取 `spec-dev/spec/{requirement_name}-tasks.md`。

执行规则：
- 按顺序执行每个 `[]` 状态的任务
- 严格按照任务中的修改指令执行，不自由发挥
- 每完成一个任务，将 `[]` 改为 `[x]` 并在任务末尾追加 `- 完成时间: YYYY-MM-DD HH:mm`
- 每个任务完成后运行 build/compile 验证（Java 项目用 mvn compile，其他项目用对应命令）
- 编译失败时立即修复，修复后再标记完成
- 全部任务完成后进入 dev_confirm 门禁

### 阶段 7：dev_confirm

**硬门禁 — 必须暂停**

向用户汇报：
1. 已完成任务数量和列表
2. 修改的文件清单
3. 构建/编译结果
4. 明确提示：「开发已完成，请确认。确认后将进行归档。你可以说"确认"继续，或指出需要修改的地方。」

用户响应处理规则同 docs_confirm。

### 阶段 8：archive

读取 `references/archive-template.md` 获取模板。

产出：`spec-dev/archive/YYYY-MM-DD-{requirement_name}.md`

归档内容：
- 日期和需求名称
- PRD 摘要
- 技术方案摘要
- 变更文件清单
- 关键决策记录

完成后更新 state → phase: "done", artifacts.archive: 文件路径

向用户宣告：「归档完成，文件已写入 spec-dev/archive/YYYY-MM-DD-{requirement_name}.md。本次 Spec-Dev 流程结束。」

## 会话连续性契约

- 每次响应前先读取 `spec-dev/.state.json` 判断当前阶段
- 如果 `.state.json` 存在且 phase 不是 "done"，自动恢复到对应阶段继续
- 用户在门禁阶段说「修改」「补充」「继续改」「确认」「通过」等属于流程内动作，不退出流程
- 修改后留在当前门禁，更新产物，再次等待确认
- 只有用户明确说「取消」「退出」「不做了」才离开流程
- 离开流程时保留所有已生成的产物文件，不删除

## 错误恢复

- 编译失败：立即修复，不跳过
- 文件读取失败：检查路径，提示用户确认项目结构
- 联网调研失败：降级为纯本地分析，告知用户
- 状态文件损坏：根据已有产物文件推断当前阶段，重建 state
