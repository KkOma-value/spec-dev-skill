# Spec-Dev v5.0 — 并行流水线提速与提质设计

日期：2026-07-05
状态：已与用户逐节确认（方案 A：全面并行 + 保护性设计）

## 背景与目标

v4.0 的 spec-dev 流水线全串行执行，开发阶段耗时过长。主要时间黑洞：

1. 全流程在主会话一条线串行：research → 三文档 → spec → 逐任务开发 → 三路审查。
2. 每个任务完成后都跑一次构建验证（Java 项目一次 `mvn compile` 数十秒，累加惊人）。
3. 硬门禁 4 个，每个都挂起等用户回复。
4. 巨型指令文件：security-reviewer 1034 行 + quality-reviewer 633 行 + quality-checklist 373 行，quality 阶段一轮吞 2000+ 行。
5. 缺少「实现后自查」与「文档交叉校验」，返工拖慢总时长。

**目标：**

- 壁钟时间大幅下降（激进并行 subagent，接受 token 消耗上升 2-4 倍）。
- 质量同时提升，重点补两个短板：代码正确性（接口对齐、边界条件）、文档/拆分质量（PRD-架构-UIUX 一致性、任务拆分红旗）。
- 用户确认点从 4 个减到 2 个（docs_confirm、preview_confirm）。

## 第 1 节：新阶段链与状态机

### 新阶段链（v5.0）

```text
baseline → research → docs → docs_check → docs_confirm → spec → dev → preview_confirm → quality → delivery → done
```

### 对比 v4.0 的变化

| 变化 | 说明 |
|------|------|
| 新增 `docs_check` | 三文档并行生成后的自动一致性校验（PRD 功能点 ↔ Architecture 模块 ↔ UIUX 页面三方对照），不等用户，校验通过自动进入 docs_confirm |
| 删除 `pre_code` 独立阶段 | 编码前检查清单合并进 spec 阶段产物（tasks.md 头部自动生成 checklist 并由调度器自检），不再单独暂停 |
| `frontend` + `backend` 合并为 `dev` | 按 tasks.md 中的执行波次（wave）推进：wave 内无依赖切片并行，wave 间串行。前端切片整体排在靠前的 wave，保证 preview_confirm 时前端可预览 |
| `quality` 变为自动门禁 | 三路并行审查 + 自动修复循环，通过后自动进入 delivery；仅在修复 2 轮后仍有 CRITICAL 时停下来问用户 |
| 硬门禁 4 → 2 | 仅 `docs_confirm` 与 `preview_confirm` 需要用户确认 |

### 状态机（scripts/spec-dev.mjs）变更

- `PHASES` 数组更新为新链；`gate --confirm` 只接受 `docs_confirm | preview_confirm`。
- 兼容旧 state：读到旧 phase 值时自动映射——`pre_code → spec`（重新走拆分自检）、`frontend → dev`、`backend → dev`。
- `state.json` 新增 `waves` 字段记录 wave 进度（当前 wave 序号、各切片状态），支持中断恢复。
- schema_version 升级为 4。

## 第 2 节：并行执行设计

### 2.1 docs 阶段 — 三文档并行

主会话读完 research 后，一次性派出 3 个并行 subagent：

```text
Agent A: prd-writer          → output/{name}-prd.md
Agent B: architecture-writer → output/{name}-architecture.md
Agent C: ui-designer         → output/{name}-uiux.md
```

- 每个 subagent 输入 = research 文档 + 各自 agent 指令 + 对应模板，互不依赖。
- 三个全部完成后进入 `docs_check`：主会话做三方一致性对照（轻量，不派 agent），发现缺漏直接修文档，然后 `advance --completed docs_check`。

### 2.2 spec 阶段 — 拆分 + 并行审查

1. 主会话按 spec-generator 指令生成 proposal.md + tasks.md。
2. tasks.md 引入波次标记（并行编码的基础）：

```markdown
## Wave 1（可并行）
[] 1. [FE][slice:订单列表] ...   files: src/views/OrderList.vue
[] 2. [FE][slice:订单详情] ...   files: src/views/OrderDetail.vue
[] 3. [BE][slice:基础DDL]  ...   files: db/migration/V1__order.sql

## Wave 2（依赖 Wave 1）
[] 4. [BE][slice:订单查询] ...   files: mapper/OrderMapper.java, service/OrderService.java
```

   - 硬规则：同一 wave 内的切片必须声明 `files:` 清单且互不重叠；文件有交集的切片必须放不同 wave。
   - 拆分时同步生成 `.spec-dev/changes/{name}/api-contract.md`：所有前后端接口的路径、方法、请求/响应结构。前端 mock 与后端实现都以它为唯一事实源。
3. 拆分完成后派 1 个拆分审查 subagent：按红旗清单（XL 任务、无验收标准、模糊指令、wave 内文件冲突、依赖顺序颠倒）审 tasks.md，问题返给主会话修正后才 advance。

### 2.3 dev 阶段 — 波次并行编码

```text
for each wave in tasks.md:
    并行派出 subagent（每切片一个，单 wave 上限 4 个）
    每个 subagent：读 api-contract + uiux(FE) / architecture(BE) + 自己切片的任务
                  → 实现 → 逐项自查 → 报告修改文件清单
    主会话：核对文件清单无越界 → 标记 [x]
    wave 结束：跑一次全量构建（FE 波次结束跑 FE 构建，BE 波次结束跑 BE 构建）
    构建失败 → 主会话统一修复（不重派 subagent）
```

- 保护性设计：单切片超过 5 个任务、或涉及跨切片重构时，该切片留在主会话串行执行。
- 前端 wave 全部完成后进入 preview_confirm，展示要求与 v4.0 一致。
- 构建频率：从「每任务构建」改为「每 wave 末构建」+ dev 全部完成后一次全量构建 + 测试。

### 2.4 quality 阶段 — 三路并行审查 + 自动修复

```text
Agent 1: security-review（精简版指令）
Agent 2: code-review（精简版指令，重点：正确性、边界、接口对齐）
Agent 3: build + test + coverage 实测
      ↓ 汇总
CRITICAL/HIGH → 主会话修复 → 只复验涉及的维度（最多 2 轮）
2 轮后仍有 CRITICAL → 停下来问用户；否则自动生成 quality-report 并进 delivery
```

## 第 3 节：指令文件精简与质量强化

### 3.1 精简巨型指令文件

| 文件 | 现状 | 改后 | 手段 |
|------|------|------|------|
| `agents/security-reviewer.md` | 1034 行 | ~250 行 | 保留 OWASP 核心检查项 + 高危模式清单（硬编码密钥、注入、越权）；删除教学式解释与重复示例；长示例移到 `references/security-examples.md` 按需读取 |
| `agents/quality-reviewer.md` | 633 行 | ~200 行 | 收敛为「审什么 + 严重级别判定 + 输出格式」三块；与 security-reviewer 重叠的安全条目删除 |
| `references/quality-checklist.md` | 373 行 | ~120 行 | 变成纯检查表（可勾选条目），解释性文字全删 |

精简原则：subagent 只需要「规则 + 判定标准 + 输出格式」，不需要教学内容。每路审查 agent 指令控制在一次读取 ~250 行内。

### 3.2 质量强化点

**代码正确性：**

1. `api-contract.md` 作为前后端唯一事实源。
2. 每个编码 subagent 指令模板末尾带强制自查段（~15 行）：导入完整性、接口路径与 contract 逐字对照、空值/边界处理、无 emoji/无调试语句。自查不过不返回。
3. wave 末构建失败由主会话修复（主会话有全局上下文，避免 subagent 盲修）。

**文档/拆分质量：**

1. `docs_check` 自动一致性校验：PRD 每个功能点在 Architecture 有承接模块、在 UIUX 有对应页面/状态；对不上就补。
2. 拆分审查 subagent：红旗清单一票否决，修完才 advance。
3. spec-generator 指令新增「wave 划分方法论」一节：切片独立性判定、files 清单写法、必须串行的情形。

### 3.3 调度器配套改动

- `next` 返回新增 `parallel_hint` 字段：当前阶段该派几个 subagent、每个的输入文件列表。调度逻辑写死在执行器里，主会话照做，不靠模型自由发挥。
- `advance` 校验 wave 完成度（该 wave 全部 `[x]` 才放行）。
- `validate` 增加 api-contract 存在性 + wave 文件冲突静态检查。

## 第 4 节：SKILL.md 契约更新与兼容性

### SKILL.md 更新点

- version 升到 5.0.0；阶段链、阶段推进规则、目录产物表全部按新链改写。
- 新增「并行调度契约」一节：主会话必须按 `parallel_hint` 用 Agent 工具并行派发 subagent（一条消息多个调用）；subagent 的 prompt 由「agent 指令文件路径 + 输入产物路径 + 输出路径 + 强制自查段」拼成。
- 阶段推进规则更新：

```text
baseline     → advance --completed baseline
research     → advance --completed research --artifact research=...
docs         → advance --completed docs --artifact prd=... --artifact architecture=... --artifact uiux=...
docs_check   → advance --completed docs_check
docs_confirm → gate --confirm docs_confirm
spec         → advance --completed spec --artifact proposal=... --artifact tasks=... --artifact contract=.spec-dev/changes/{name}/api-contract.md
dev          → 每 wave 完成后 advance --completed wave --wave <n>；全部 wave 完成自动进入 preview_confirm
preview_confirm → gate --confirm preview_confirm
quality      → advance --completed quality --artifact quality=...
delivery     → deliver
```

- 首轮响应契约同步更新为新链描述。

### 兼容性

- 旧 `.spec-dev/state.json`（schema_version 3）自动迁移：旧 phase 映射规则见第 1 节；`artifacts` 键集保留并新增 `contract`。
- `archive` 命令继续作为 `deliver` 别名。
- 无 wave 标记的旧 tasks.md：执行器把全部任务视为单一串行 wave，行为等同 v4.0。

## 验收标准

1. `node scripts/spec-dev.mjs` 全命令在新链下工作，旧 state 可无损迁移。
2. docs 阶段 3 个 subagent 并行产出三文档；spec 阶段产出含 wave 标记的 tasks.md + api-contract.md。
3. dev 阶段按 wave 并行执行且文件不冲突；构建只在 wave 末与阶段末触发。
4. quality 三路并行 + 自动修复循环可自动通过进入 delivery。
5. 三个巨型指令文件精简到目标行数，审查行为不劣化（红旗项仍全覆盖）。
6. 全流程仅 docs_confirm、preview_confirm 两处等待用户。

## 明确不做（YAGNI）

- 不引入外部依赖或构建工具，spec-dev.mjs 保持零依赖 Node 脚本。
- 不做跨 wave 的乐观并行（wave 间严格串行）。
- 不做自动 git 提交/推送（保持现有边界）。
- 不改 research 阶段（其耗时主要是外部检索，与本次优化无关）。
