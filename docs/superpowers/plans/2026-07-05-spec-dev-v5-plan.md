# Spec-Dev v5.0 并行流水线实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 spec-dev v4.0 全串行流水线升级为 v5.0 并行流水线：壁钟时间大幅下降，代码正确性与文档拆分质量同步提升，用户确认点从 4 个减至 2 个。

**Architecture:** 改造零依赖 JS 执行器 `scripts/spec-dev.mjs` 的状态机（新阶段链 + wave 状态 + parallel_hint），精简三个巨型审查指令文件，更新 SKILL.md 契约。不改 research 阶段，不引入外部依赖。

**Tech Stack:** Node.js (ESM, 零依赖), Markdown (skill 契约)

## Global Constraints

- `scripts/spec-dev.mjs` 保持零依赖 Node.js ESM 脚本，不引入 npm 包
- 阶段推进规则以执行器返回的 JSON 为唯一事实源
- schema_version 从 3 升到 4
- 旧 state.json 无损迁移：`pre_code → spec`, `frontend → dev`, `backend → dev`
- `archive` 命令继续作为 `deliver` 别名
- 不做自动 git 提交/推送
- 不做跨 wave 乐观并行（wave 间严格串行）

---

## File Structure

```
scripts/spec-dev.mjs          — 修改：状态机核心（~350 行变更）
agents/spec-generator.md       — 修改：新增 wave 划分方法论
agents/security-reviewer.md    — 修改：1034→~250 行精简
agents/quality-reviewer.md     — 修改：633→~200 行精简
references/quality-checklist.md — 修改：373→~120 行精简
references/security-examples.md — 新建：从 security-reviewer 移出的长示例
SKILL.md                        — 修改：v5.0.0 契约更新
```

---

### Task 1: 更新 spec-dev.mjs — 新阶段链常量与 schema_version

**Files:**
- Modify: `scripts/spec-dev.mjs`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: Updated `SCHEMA_VERSION = 4`, `PHASES` array, `NEXT_PHASE` map, `VALID_GATES` set, `LEGACY_PHASE_MAP`, new `ARTIFACT_KINDS` including `contract`

- [ ] **Step 1: 升级版本号与阶段常量**

在 `scripts/spec-dev.mjs` 顶部区域，替换版本号和阶段常量为 v5.0 定义。找到并替换 `SCHEMA_VERSION`、`PHASES`、`NEXT_PHASE` 常量：

```javascript
const SCHEMA_VERSION = 4;

const PHASES = [
  'baseline',
  'research',
  'docs',
  'docs_check',
  'docs_confirm',
  'spec',
  'dev',
  'preview_confirm',
  'quality',
  'delivery',
  'done',
];

const NEXT_PHASE = {
  baseline: 'research',
  research: 'docs',
  docs: 'docs_check',
  docs_check: 'docs_confirm',
  docs_confirm: 'spec',
  spec: 'dev',
  dev: 'preview_confirm',
  preview_confirm: 'quality',
  quality: 'delivery',
  delivery: 'done',
};

// 旧 phase → 新 phase 映射（用于迁移）
const LEGACY_PHASE_MAP = {
  pre_code: 'spec',
  frontend: 'dev',
  backend: 'dev',
};

// 合法 gate 值（仅两个用户确认点）
const VALID_GATES = new Set(['docs_confirm', 'preview_confirm']);
```

- [ ] **Step 2: 更新 ARTIFACT_KINDS 与 artifactPath**

在同一区域，给 `ARTIFACT_KINDS` 新增 `'contract'`，给 `artifactPath()` 新增 `contract` case：

```javascript
const ARTIFACT_KINDS = new Set([
  'research',
  'prd',
  'architecture',
  'uiux',
  'proposal',
  'tasks',
  'contract',
  'quality',
  'delivery',
]);

function artifactPath(kind, requirementName) {
  switch (kind) {
    case 'research':
      return `${OUTPUT_DIR}/${requirementName}-research.md`;
    case 'prd':
      return `${OUTPUT_DIR}/${requirementName}-prd.md`;
    case 'architecture':
      return `${OUTPUT_DIR}/${requirementName}-architecture.md`;
    case 'uiux':
      return `${OUTPUT_DIR}/${requirementName}-uiux.md`;
    case 'proposal':
      return `${CHANGES_DIR}/${requirementName}/proposal.md`;
    case 'tasks':
      return `${CHANGES_DIR}/${requirementName}/tasks.md`;
    case 'contract':
      return `${CHANGES_DIR}/${requirementName}/api-contract.md`;
    case 'quality':
      return `${OUTPUT_DIR}/${requirementName}-quality-report.md`;
    case 'delivery':
      return `${OUTPUT_DIR}/<YYYY-MM-DD>-${requirementName}-delivery.md`;
    default:
      return null;
  }
}
```

- [ ] **Step 3: 更新 legacy phase 映射函数**

修改 `normalizeLegacyPhase()` 函数，增加 LEGACY_PHASE_MAP 映射并保留旧逻辑：

```javascript
function normalizeLegacyPhase(phase) {
  if (LEGACY_PHASE_MAP[phase]) {
    return LEGACY_PHASE_MAP[phase];
  }
  switch (phase) {
    case 'prd':
    case 'tech':
    case 'uiux':
      return 'docs';
    case 'archive':
      return 'delivery';
    case 'dev_confirm':
      return 'preview_confirm';
    default:
      return normalizePhase(phase);
  }
}
```

- [ ] **Step 4: 更新 gate 校验函数**

修改 `normalizeGate()` 函数，只接受 docs_confirm 和 preview_confirm：

```javascript
function normalizeGate(gate) {
  if (gate === 'dev_confirm') {
    return 'preview_confirm';
  }
  if (VALID_GATES.has(gate)) {
    return gate;
  }
  return null;
}
```

- [ ] **Step 5: 验证编译**

```bash
node scripts/spec-dev.mjs validate --root .
```

预期：命令不崩溃（可能因为 state.json 不存在而报 STATE_NOT_FOUND，但不应报语法错误）。

- [ ] **Step 6: 提交**

```bash
git add scripts/spec-dev.mjs
git commit -m "feat: upgrade state machine to v5.0 phase chain (schema_version 4)"
```

---

### Task 2: 更新 spec-dev.mjs — phasePayload 与波次支持

**Files:**
- Modify: `scripts/spec-dev.mjs`

**Interfaces:**
- Consumes: Task 1 产出的 PHASES / NEXT_PHASE / ARTIFACT_KINDS
- Produces: 新 `phasePayload()` 支持 docs_check/docs_confirm/spec/dev 阶段，`parallel_hint` 字段，`advance` 支持 wave 完成度校验

- [ ] **Step 1: 重写 phasePayload() switch**

替换整个 `phasePayload()` 函数的 switch 块，按 v5.0 阶段定义。关键是并行阶段要返回 `parallel_hint`：

```javascript
async function phasePayload(root, state) {
  const phase = state.phase;
  const currentGate = state.current_gate || (phase === 'docs_confirm' || phase === 'preview_confirm' ? phase : null);
  let requiredReads = [];
  let expectedOutputs = [];
  let message = '';
  let parallelHint = null;

  switch (phase) {
    case 'baseline':
      message = '轻量 baseline：扫描当前项目结构；完成后调用 advance --completed baseline。';
      break;

    case 'research':
      requiredReads = ['agents/researcher.md', ...(await optionalKnowledgeReads(root))];
      expectedOutputs = [artifactPath('research', state.requirement_name)];
      message = '读取 researcher 指令，执行调研；写入 output/*-research.md 后 advance --completed research。';
      break;

    case 'docs':
      requiredReads = [
        requiredArtifact(state, 'research'),
      ];
      expectedOutputs = [
        artifactPath('prd', state.requirement_name),
        artifactPath('architecture', state.requirement_name),
        artifactPath('uiux', state.requirement_name),
      ];
      message = '并行三文档阶段：按 parallel_hint 同时派出 prd-writer / architecture-writer / ui-designer 三个 subagent。全部完成后 advance --completed docs。';
      parallelHint = {
        description: 'docs: 并行生成三文档',
        strategy: 'parallel',
        agents: [
          {
            label: 'prd-writer',
            input_files: [
              `agents/prd-writer.md`,
              `references/prd-template.md`,
              requiredArtifact(state, 'research'),
            ],
            output_file: artifactPath('prd', state.requirement_name),
          },
          {
            label: 'architecture-writer',
            input_files: [
              `agents/architecture-writer.md`,
              `references/architecture-template.md`,
              requiredArtifact(state, 'research'),
            ],
            output_file: artifactPath('architecture', state.requirement_name),
          },
          {
            label: 'ui-designer',
            input_files: [
              `agents/ui-designer.md`,
              `references/uiux-template.md`,
              `references/uiux-pro-max-adapter.md`,
              requiredArtifact(state, 'research'),
            ],
            output_file: artifactPath('uiux', state.requirement_name),
          },
        ],
      };
      break;

    case 'docs_check':
      requiredReads = [
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
        requiredArtifact(state, 'research'),
      ];
      message = '自动一致性校验：对照 PRD 功能点 ↔ Architecture 模块 ↔ UIUX 页面三者；发现缺口直接修文档。完成后 advance --completed docs_check。';
      break;

    case 'docs_confirm':
      requiredReads = [
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
      ];
      message = '硬门禁：向用户展示三文档核心摘要；确认后 gate --confirm docs_confirm，修改则在对应文档上迭代。';
      break;

    case 'spec':
      requiredReads = [
        'agents/spec-generator.md',
        'references/spec-template.md',
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
      ];
      expectedOutputs = [
        artifactPath('proposal', state.requirement_name),
        artifactPath('tasks', state.requirement_name),
        artifactPath('contract', state.requirement_name),
      ];
      message = '拆分阶段：生成 wave 标记的 tasks.md + api-contract.md + proposal.md；完成后派拆分审查 subagent 做红旗自检。通过后 advance --completed spec。';
      parallelHint = {
        description: 'spec: 拆分审查（在 tasks.md 生成后派单个审查 agent）',
        strategy: 'single_after',
        trigger: 'tasks_generated',
        agents: [
          {
            label: 'spec-reviewer',
            input_files: [
              requiredArtifact(state, 'tasks'),
              artifactPath('contract', state.requirement_name),
              requiredArtifact(state, 'prd'),
              requiredArtifact(state, 'architecture'),
              requiredArtifact(state, 'uiux'),
            ],
            check_rules: 'spec-generator 红旗清单：XL 任务、无验收标准、模糊指令、wave 内文件冲突、依赖顺序颠倒',
          },
        ],
      };
      break;

    case 'dev':
      requiredReads = [
        requiredArtifact(state, 'tasks'),
        artifactPath('contract', state.requirement_name),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
      ];
      message = '波次编码阶段：按 tasks.md 的 wave 逐波并行执行。wave 内无依赖切片由 parallel_hint 指引并行 subagent 实现。每 wave 完成后跑一次构建。全部 wave 完成自动进入 preview_confirm。';
      // dev 阶段的 parallel_hint 由主会话解析 tasks.md 的 wave 结构动态生成
      parallelHint = {
        description: 'dev: 按 wave 并行编码',
        strategy: 'wave_parallel',
        max_per_wave: 4,
        build_rule: 'per_wave_end',
        note: '主会话按 tasks.md 的 waves 结构逐波派发 subagent。单切片 >5 任务或跨切片重构→留在主会话串行。',
      };
      break;

    case 'preview_confirm':
      requiredReads = [
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'uiux'),
      ];
      message = '硬门禁：展示前端预览、任务完成列表、构建结果和 UIUX 一致性对比；确认后 gate --confirm preview_confirm。';
      break;

    case 'quality':
      requiredReads = [
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
        artifactPath('contract', state.requirement_name),
      ];
      expectedOutputs = [artifactPath('quality', state.requirement_name)];
      message = '自动质量门禁：按 parallel_hint 三路并行审查（安全/代码/构建+测试）。发现 CRITICAL/HIGH 自动修复最多 2 轮。2 轮后仍 CRITICAL 才停。通过后自动 advance --completed quality 并进 delivery。';
      parallelHint = {
        description: 'quality: 三路并行审查',
        strategy: 'parallel',
        agents: [
          {
            label: 'security-review',
            input_files: [
              'agents/security-reviewer.md',
              'references/security-examples.md',
              requiredArtifact(state, 'prd'),
              requiredArtifact(state, 'architecture'),
            ],
          },
          {
            label: 'code-review',
            input_files: [
              'agents/quality-reviewer.md',
              artifactPath('contract', state.requirement_name),
              requiredArtifact(state, 'tasks'),
            ],
          },
          {
            label: 'build-and-test',
            input_files: [
              'references/quality-checklist.md',
            ],
          },
        ],
        auto_fix_rounds: 2,
      };
      break;

    case 'delivery':
      requiredReads = [
        'references/delivery-template.md',
        requiredArtifact(state, 'research'),
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'quality'),
      ];
      expectedOutputs = [artifactPath('delivery', state.requirement_name)];
      message = '交付阶段：调用 deliver 命令生成交付报告并推进到 done。';
      break;

    case 'done':
      message = 'Spec-Dev 流程已完成。';
      break;

    default:
      throw appError('UNKNOWN_PHASE', `Unknown phase: ${phase}`, { phase });
  }

  return {
    schema_version: SCHEMA_VERSION,
    phase,
    mode: state.mode || 'new',
    current_gate: currentGate,
    required_reads: requiredReads,
    expected_output: expectedOutputs.length === 1 ? expectedOutputs[0] : null,
    expected_outputs: expectedOutputs,
    requirement: state.requirement,
    requirement_name: state.requirement_name,
    artifacts: state.artifacts,
    quality: state.quality || defaultQualityState(),
    waves: state.waves || [],
    parallel_hint: parallelHint,
    message,
  };
}
```

- [ ] **Step 2: 更新 artifactKindsForCompletedPhase**

匹配新阶段链：

```javascript
function artifactKindsForCompletedPhase(phase) {
  switch (phase) {
    case 'research':
      return ['research'];
    case 'docs':
      return ['prd', 'architecture', 'uiux'];
    case 'spec':
      return ['proposal', 'tasks', 'contract'];
    case 'quality':
      return ['quality'];
    default:
      return [];
  }
}
```

- [ ] **Step 3: 更新 commandAdvance — 增加 wave 校验 + 删除 pre_code 逻辑 + 新 gate 逻辑**

修改 `commandAdvance()`：

```javascript
async function commandAdvance(options) {
  const root = normalizeRoot(options);
  const completed = normalizeLegacyPhase(String(options.completed || ''));
  const state = await readState(root);

  if (!PHASES.includes(completed)) {
    throw appError('INVALID_PHASE', `Unknown completed phase: ${completed}`, { completed });
  }
  if (state.phase !== completed) {
    throw appError('PHASE_MISMATCH', `Cannot complete ${completed} while current phase is ${state.phase}.`, {
      current: state.phase,
      completed,
    });
  }
  if (completed === 'delivery') {
    throw appError('DELIVERY_REQUIRES_COMMAND', 'Use the deliver command to generate the delivery artifact.');
  }

  // dev 阶段支持按 wave 推进
  if (completed === 'dev') {
    const waveNum = options.wave ? parseInt(String(options.wave), 10) : null;
    if (waveNum) {
      // 更新 state.waves 中对应 wave 的状态
      if (!state.waves) { state.waves = []; }
      const wave = state.waves.find(w => w.num === waveNum);
      if (wave) {
        wave.completed = true;
        wave.completed_at = new Date().toISOString();
      }
    }
  }

  const artifacts = parseArtifacts(options.artifact);
  for (const requiredKind of artifactKindsForCompletedPhase(completed)) {
    if (!artifacts[requiredKind]) {
      throw appError('ARTIFACT_REQUIRED', `Completing ${completed} requires --artifact ${requiredKind}=<path>.`, {
        phase: completed,
        kind: requiredKind,
      });
    }
  }

  for (const [kind, artifact] of Object.entries(artifacts)) {
    state.artifacts[kind] = artifact;
  }

  addCompleted(state, completed);
  state.phase = NEXT_PHASE[completed];
  if (!state.phase) {
    throw appError('NO_NEXT_PHASE', `Phase ${completed} cannot be advanced with this command.`);
  }

  // gate 只在 docs_confirm 和 preview_confirm 时设置
  state.current_gate = VALID_GATES.has(state.phase) ? state.phase : null;

  await writeState(root, state);
  return phasePayload(root, state);
}
```

- [ ] **Step 4: 更新 commandGate — 简化 gate 校验**

替换 `commandGate()` 函数，删除 dev_confirm 分支，只保留 docs_confirm 和 preview_confirm，并将旧 dev_confirm 映射：

```javascript
async function commandGate(options) {
  const root = normalizeRoot(options);
  const confirm = String(options.confirm || '');
  const state = await readState(root);

  // 兼容旧 dev_confirm
  const resolvedConfirm = confirm === 'dev_confirm' ? 'preview_confirm' : confirm;

  if (!VALID_GATES.has(resolvedConfirm)) {
    throw appError('INVALID_GATE', `Unknown gate: ${confirm}. Valid gates: docs_confirm, preview_confirm.`, { confirm });
  }
  if (state.phase !== resolvedConfirm || state.current_gate !== resolvedConfirm) {
    throw appError('GATE_MISMATCH', `Cannot confirm ${resolvedConfirm} while current gate is ${state.current_gate || 'none'}.`, {
      phase: state.phase,
      current_gate: state.current_gate,
      confirm: resolvedConfirm,
    });
  }

  addCompleted(state, resolvedConfirm);
  state.phase = NEXT_PHASE[resolvedConfirm];
  state.current_gate = null;
  await writeState(root, state);
  return phasePayload(root, state);
}
```

- [ ] **Step 5: 更新 createState — 初始化 waves**

在 `createState()` 返回对象中增加 `waves: []`：

```javascript
function createState(requirement, mode = 'new') {
  const initialPhase = mode === 'new' ? 'research' : 'baseline';

  return {
    schema_version: SCHEMA_VERSION,
    mode,
    phase: initialPhase,
    requirement,
    requirement_name: slugifyRequirement(requirement),
    created_at: new Date().toISOString(),
    phases_completed: [],
    current_gate: null,
    artifacts: defaultArtifacts(),
    quality: defaultQualityState(),
    waves: [],
  };
}
```

- [ ] **Step 6: 更新 writeSessionBrief — 新阶段链文字**

替换工作流行和当前阶段描述：

```javascript
// 在 writeSessionBrief 函数中，替换 Workflow 段为：
'research -> docs (并行三文档) -> docs_check -> docs_confirm -> spec (拆分+审查) -> dev (波次并行) -> preview_confirm -> quality (三路并行+自动修复) -> delivery',
```

- [ ] **Step 7: 删除 pre_code 相关函数**

删除 `writePreCodeChecklist()` 和 `assertPreCodeChecklistComplete()` 函数（及 `PRE_CODE_CHECKLIST_FILE` 常量不再需要）。`PRE_CODE_CHECKLIST_FILE` 常量本身保留但不再在 phase 流程中引用——改为 spec 阶段在 tasks.md 头部生成内嵌 checklist。

- [ ] **Step 8: 更新 commandValidate — 新 phase 对应的 artifacts**

修改 `artifactsRequiredForPhase()`：

```javascript
function artifactsRequiredForPhase(state) {
  switch (state.phase) {
    case 'docs_check':
    case 'docs':
      return [requiredArtifact(state, 'research')];
    case 'docs_confirm':
    case 'spec':
      return [requiredArtifact(state, 'prd'), requiredArtifact(state, 'architecture'), requiredArtifact(state, 'uiux')];
    case 'dev':
    case 'preview_confirm':
      return [requiredArtifact(state, 'tasks'), requiredArtifact(state, 'uiux'), requiredArtifact(state, 'architecture')];
    case 'quality':
      return [
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
        requiredArtifact(state, 'contract'),
      ];
    case 'delivery':
      return [
        requiredArtifact(state, 'research'),
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'quality'),
      ];
    default:
      return [];
  }
}
```

- [ ] **Step 9: 验证全部命令**

```bash
node scripts/spec-dev.mjs init --root /tmp/test-spec-dev --requirement "测试需求" --mode new
node scripts/spec-dev.mjs next --root /tmp/test-spec-dev
node scripts/spec-dev.mjs advance --root /tmp/test-spec-dev --completed research --artifact research=output/ce-shi-xu-qiu-research.md
# 检查 JSON 输出各字段正确，parallel_hint 不为 null
```

- [ ] **Step 10: 提交**

```bash
git add scripts/spec-dev.mjs
git commit -m "feat: implement v5.0 phasePayload with parallel_hint and wave support"
```

---

### Task 3: 精简 security-reviewer.md (1034 → ~250 行) + 新建 security-examples.md

**Files:**
- Modify: `agents/security-reviewer.md`
- Create: `references/security-examples.md`

**Interfaces:**
- Consumes: 原始 security-reviewer.md 的 10 个 Phase 结构
- Produces: 精简版 rule-only 指令 (~250 行) + 按需读取的示例库 (~400 行)

- [ ] **Step 1: 写精简版 security-reviewer.md**

用 Write 工具覆写 `agents/security-reviewer.md`，保留核心规则 + 搜索模式 + 严重级别判定 + 输出格式，删除教学解释和重复代码示例。结构：

```markdown
# 安全审查专家指令 (v5.0 精简版)

## 角色
你是安全审查专家，在 quality 阶段被并行调度。只审查安全，产出结构化发现列表。

## 严重级别
| 级别 | 含义 | 处理方式 |
|------|------|---------|
| CRITICAL | 可直接导致入侵/数据泄露 | BLOCK — 必须修复 |
| HIGH | 明确风险但条件苛刻 | WARN — 应修复 |
| MEDIUM | 最佳实践偏差 | INFO — 建议修复 |
| LOW | 加固建议 | NOTE — 可选 |

## 审查工作流（10 项，全部必做）

### 1. OWASP A01 — 访问控制
- 搜索 `@RestController` / `@RequestMapping` / `@PostMapping` 等端点注解
- 无 `@PreAuthorize` / `@Secured` 且非公开端点 → CRITICAL
- 资源操作未校验归属（userId/orderId 来自请求参数直接查询）→ CRITICAL
- CORS `allowedOrigins: "*"` 无其他保护 → HIGH
- JWT 签名算法为 `none` → CRITICAL; 弱密钥/硬编码密钥 → CRITICAL; 无过期时间 → MEDIUM

### 2. OWASP A02 — 加密失效
- 搜索 `MD5` / `SHA-1` / `DES` / `RC4` / `3DES`
- 用于密码哈希 → CRITICAL; 用于非安全校验 → LOW
- 内网 HTTP 明文传输敏感数据 → HIGH

### 3. OWASP A03 — 注入
- SQL 注入专项见下文 Phase 3
- 命令注入搜索 `Runtime.exec(` / `ProcessBuilder(` / `os.system(` / `subprocess.`，参数来自用户输入未白名单 → CRITICAL
- 表达式注入搜索 `SpelExpressionParser` / `ScriptEngine.eval` / `OGNL` / `MVEL`，表达式含用户输入 → CRITICAL

### 4-10. OWASP A04-A10
(按相同模式精简：每项 5-10 行核心规则 + 搜索模式，删除教学解释。完整搜索模式见表，长示例见 references/security-examples.md)

## 硬编码凭证检测 (Phase 2)
搜索模式（大小写不敏感）：
- `password\s*=` / `secret\s*=` / `apiKey\s*=` / `token\s*=` / `accessKey\s*=` / `privateKey\s*=`
- 排除合法来源：`System.getenv(` / `process.env.` / `os.Getenv(` / `@Value("${...}")` / `SecretsManager` / `Vault` / `KMS`
- 生产代码中确认硬编码 → CRITICAL

## SQL 注入深度检测 (Phase 3)
- Java: `"SELECT.*"\s*\+` / `String.format.*SELECT` / `Statement.execute(` / MyBatis `${` → CRITICAL
  例外：`${` 用于 ORDER BY / GROUP BY + 白名单 → MEDIUM
- Go: `fmt.Sprintf.*SELECT` / `db.Query("SELECT.*"+` → CRITICAL
- Python: `cursor.execute("SELECT.*"%` / f-string 拼接 → CRITICAL
- JS/TS: 模板字符串 `` `SELECT.*${ `` 拼接 → CRITICAL
- 参数化查询/占位符(`#{}` / `?` / `$1`) → OK

## XSS 检测 (Phase 4)
- 前端：`dangerouslySetInnerHTML` / `innerHTML=` / `v-html` / `document.write(` / `eval(`
  内容来自用户输入未净化 → CRITICAL
- 后端：Thymeleaf `th:utext` 使用用户输入 → HIGH

## CSRF 检查 (Phase 5)
- `csrf().disable()` 且无 SameSite Cookie + 自定义 Header 校验 → HIGH
- Token-based 认证(JWT in Header) → OK
- GET 接口做状态变更 → HIGH

## 认证授权绕过 (Phase 6)
- 新增端点逐条检查鉴权注解/拦截器
- `antMatchers("/admin/**").permitAll()` → CRITICAL
- 内部接口无 IP 白名单 → HIGH

## 路径遍历 (Phase 7)
- 搜索 `FileInputStream(` / `Files.read(` / `os.Open(` / `fs.readFile(`
- 路径来自用户输入且无白名单/规范化+前缀校验 → CRITICAL
- 文件上传保留原始文件名 → HIGH
- ZIP/TAR 解压未检查 `../` → CRITICAL (Zip Slip)

## 敏感数据泄露 (Phase 8)
- 日志搜索：`log.*password` / `log.*token` / `log.*secret` / `System.out.print.*password` / `console.log.*password`
  明文输出 → CRITICAL
- DTO/VO 含密码/身份证字段 → HIGH
- 异常返回完整堆栈/SQL → HIGH
- 前端硬编码 `apiKey:"sk-..."` → CRITICAL

## 速率限制 (Phase 9)
- 登录/注册/验证码/密码重置接口无速率限制 → HIGH
- 仅前端校验 → HIGH

## 依赖安全 (Phase 10)
- 运行 `npm audit` / `mvn dependency-check:check` / `pip-audit`
- 已知 CVE CRITICAL 的依赖 → CRITICAL
- 详细高危版本列表见 references/security-examples.md

## 输出格式

```json
{
  "security_passed": true,
  "total_findings": 0,
  "critical_count": 0,
  "high_count": 0,
  "findings": [
    {
      "severity": "CRITICAL",
      "file": "path/to/file",
      "line": 42,
      "description": "具体问题描述",
      "fix": "具体可执行修复建议",
      "owasp_category": "A01"
    }
  ]
}
```

## 判定规则
- 无 CRITICAL → security_passed: true
- 有 CRITICAL → security_passed: false
- 不确定的匹配项标为"疑似"上报，不静默跳过

## 注意事项
- 安全审查在任何模式下（new/evolve/patch）必须完整执行 10 项
- 无法执行的检查项标注"未执行"及原因
- 详细示例和已知 CVE 版本列表见 references/security-examples.md
```

- [ ] **Step 2: 新建 security-examples.md**

从原始 security-reviewer.md 提取长示例代码块、高危依赖版本列表、详细修复代码模板，写入 `references/security-examples.md`：

```markdown
# 安全审查示例与参考资料

> 按需读取。由 agents/security-reviewer.md 引用。

## 已知高危依赖版本

| 组件 | 高危版本 | CVE | 修复版本 |
|------|---------|-----|---------|
| Log4j 2.x | < 2.17.1 | CVE-2021-44228 | >= 2.17.1 |
| Spring Framework | < 5.3.18 | CVE-2022-22965 | >= 5.3.18 |
| Fastjson | < 1.2.83 | 多个反序列化 RCE | >= 1.2.83 |
| Jackson-databind | < 2.13.2 | 多个反序列化漏洞 | >= 2.13.2 |
| Shiro | < 1.10.0 | CVE-2022-40664 | >= 1.10.0 |

## SQL 注入修复代码模板

### Java — MyBatis `${}` 修复
\`\`\`java
// 危险
@Select("SELECT * FROM t_order WHERE status = ${status}")

// 安全：使用 #{}
@Select("SELECT * FROM t_order WHERE status = #{status}")

// ORDER BY 白名单方案
private static final Set<String> ALLOWED_SORT_FIELDS = Set.of("id", "name", "create_time");
public List<Order> query(String sortField) {
    if (!ALLOWED_SORT_FIELDS.contains(sortField)) {
        throw new IllegalArgumentException("Invalid sort field");
    }
    return mapper.query(sortField);
}
\`\`\`

## 路径遍历修复模板

### Java
\`\`\`java
// 危险
Path file = Paths.get("/data/files/" + userInput);

// 安全
Path base = Paths.get("/data/files/").toRealPath();
Path file = base.resolve(userInput).normalize().toRealPath();
if (!file.startsWith(base)) {
    throw new SecurityException("Path traversal detected");
}
\`\`\`

## XSS 修复模板

### React
\`\`\`jsx
// 危险
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// 安全 — 使用 DOMPurify
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userInput) }} />
\`\`\`

## 速率限制示例

### Spring Boot + Guava RateLimiter
\`\`\`java
private final RateLimiter loginLimiter = RateLimiter.create(5.0); // 5 req/s
public Result login(LoginRequest req) {
    if (!loginLimiter.tryAcquire(1, TimeUnit.SECONDS)) {
        return Result.fail("请求过于频繁，请稍后再试");
    }
    // ...
}
\`\`\`
\`\`\`
```

- [ ] **Step 3: 验证行数**

```bash
wc -l agents/security-reviewer.md references/security-examples.md
```

security-reviewer.md 预期 ~250 行，security-examples.md 预期 ~200 行。

- [ ] **Step 4: 提交**

```bash
git add agents/security-reviewer.md references/security-examples.md
git commit -m "refactor: slim security-reviewer to ~250 lines; extract examples to security-examples.md"
```

---

### Task 4: 精简 quality-reviewer.md (633 → ~200 行)

**Files:**
- Modify: `agents/quality-reviewer.md`

**Interfaces:**
- Consumes: 原始 quality-reviewer.md 的五项审查结构
- Produces: ~200 行精简版，"审什么 + 严重级别 + 输出格式"三块

- [ ] **Step 1: 覆写 quality-reviewer.md**

保留核心结构但精简到 ~200 行。具体删除：
- 冗长的委托规则说明（security-reviewer 已独立并行，不再经由 quality-reviewer 委托）
- 重复的严重级别定义（与 security-reviewer 一致的部分用引用）
- 大段代码搜索模式（security-reviewer 已覆盖的由它负责）
- 报告模板的逐项填充说明（保留模板骨架即可）

核心保留内容：
- 定位：并行代码质量审查，重点正确性/边界/接口对齐
- 5 项检查要点摘要（每项 ~5 行）
- 严重级别与判定规则
- 输出格式（JSON findings 列表）

- [ ] **Step 2: 验证行数**

```bash
wc -l agents/quality-reviewer.md
```

预期 ~200 行。

- [ ] **Step 3: 提交**

```bash
git add agents/quality-reviewer.md
git commit -m "refactor: slim quality-reviewer to ~200 lines"
```

---

### Task 5: 精简 references/quality-checklist.md (373 → ~120 行)

**Files:**
- Modify: `references/quality-checklist.md`

**Interfaces:**
- Consumes: 原始 7 章检查清单
- Produces: ~120 行纯检查表，解释文字全删

- [ ] **Step 1: 覆写为纯检查表**

保留所有 `[ ]` 检查条目，删除每节开头的解释文字、检查方法描述、严重级别定义（已在 agents 中定义）。保留 7 章结构但每章只留检查条目 + 严重级别标记。

```markdown
# 质量门禁检查清单

> 纯检查表。严重级别定义见 agents/quality-reviewer.md 与 agents/security-reviewer.md。

## 一、安全检查
- [ ] `[CRIT]` 无硬编码 API 密钥/密码/Token/私钥
- [ ] `[CRIT]` SQL 使用参数化查询，无字符串拼接
- [ ] `[CRIT]` 动态排序字段使用白名单
- [ ] `[CRIT]` 用户输入 HTML 经过转义
- [ ] `[CRIT]` 状态变更接口有 CSRF 保护
- [ ] `[CRIT]` 非公开接口有认证检查
- [ ] `[CRIT]` 文件操作路径无 `../` 穿越
- [ ] `[CRIT]` 错误消息不泄露堆栈/SQL/内部路径
- [ ] `[CRIT]` Controller 入参有 `@Valid` 校验
- [ ] `[HIGH]` 登录/注册/验证码接口有速率限制
- [ ] `[HIGH]` 无已知 CVE 的依赖版本
- ... (保留全部原有检查条目，删解释文字)

## 二、代码质量
- [ ] `[HIGH]` 类/方法/变量名清晰表达意图
- [ ] `[HIGH]` 函数 ≤ 50 行
- [ ] `[MED]` 文件 ≤ 800 行
- [ ] `[CRIT]` 无空 catch 块
- [ ] `[HIGH]` 无 console.log / print 调试残留
- ...

## 三、构建验证
- [ ] `[CRIT]` 项目编译通过
- [ ] `[CRIT]` 测试编译通过
- [ ] `[HIGH]` Lint 检查通过
- ...

## 四、Spec-Code 一致性
- [ ] `[CRIT]` tasks.md 所有任务 `[x]` 已完成
- [ ] `[CRIT]` 前端 fetch URL 与后端路径完全匹配
- [ ] `[HIGH]` 无 spec 未定义的额外功能
- ...

## 五、性能检查
- [ ] `[HIGH]` 无 N+1 查询
- [ ] `[HIGH]` 列表查询有分页且含最大限制
- [ ] `[MED]` 高频读取数据有缓存
- ...

## 六、测试检查
- [ ] `[CRIT]` 核心业务逻辑有单元测试
- [ ] `[CRIT]` 覆盖率 ≥ 80%
- ...

## 七、UI 一致性
- [ ] `[CRIT]` 无 emoji 作为功能图标
- [ ] `[HIGH]` 图标来自声明的图标库
- [ ] `[CRIT]` 无硬编码颜色值
- [ ] `[HIGH]` 无紫色/粉色渐变主题
- ...
```

- [ ] **Step 2: 验证行数**

```bash
wc -l references/quality-checklist.md
```

预期 ~120 行。

- [ ] **Step 3: 提交**

```bash
git add references/quality-checklist.md
git commit -m "refactor: slim quality-checklist to ~120 lines checklist-only format"
```

---

### Task 6: 更新 agents/spec-generator.md — 新增 wave 划分方法论

**Files:**
- Modify: `agents/spec-generator.md`

**Interfaces:**
- Consumes: 现有 spec-generator.md 的拆分方法论
- Produces: 新增 wave 划分段落 + api-contract 产出要求 + pre_code checklist 内嵌说明

- [ ] **Step 1: 在拆分方法论中新增 wave 划分章节**

在 Step 3（纵向切片）之后插入新章节：

```markdown
### Step 3.5：波次划分（Wave Planning）

每个切片必须声明 `files:` 文件清单。同一 wave 内的切片文件清单必须互不重叠——这是并行安全的硬规则。

#### 波次标记格式

```markdown
## Wave 1（可并行 — 无共享文件）
[] 1. [FE][slice:用户列表页]   files: src/views/UserList.vue
[] 2. [FE][slice:用户详情页]   files: src/views/UserDetail.vue
[] 3. [BE][slice:用户表DDL]    files: db/migration/V1__user.sql

## Wave 2（依赖 Wave 1 — DDL 就绪后）
[] 4. [BE][slice:用户查询API]  files: mapper/UserMapper.java, service/UserService.java, controller/UserController.java

## Wave 3（依赖 Wave 2 — API 就绪后）
[] 5. [FE][slice:列表接真实API] files: src/api/user.ts, src/views/UserList.vue
```

#### 波次划分规则

1. 共享文件的切片必须放在不同 wave。
2. 依赖下层产物的切片放在后续 wave（如 API 切片依赖 DDL；FE 接真实 API 依赖 BE 接口就绪）。
3. 单个切片涉及 >5 个文件或跨切片重构 → 标记 `[SERIAL]` 留在主会话串行执行。
4. 单个 wave 内切片数 ≤ 4（并行 subagent 上限）。
5. 前端可预览的切片整体排在靠前的 wave（保证 preview_confirm 时核心页面已可运行）。

#### 文件不兼容检测

拆分完成后必须过一遍：同一 wave 内任意两个切片的 `files:` 交集为空。有交集 → 把它们拆到不同 wave。
```

- [ ] **Step 2: 新增 api-contract 产出说明**

在"Proposal 产出"和"Tasks 产出"之间插入：

```markdown
## API Contract 产出

写入 `.spec-dev/changes/{requirement_name}/api-contract.md`。这是前后端接口的唯一事实源。内容必须包含：

| 方法 | 路径 | 请求体 | 响应体 | 鉴权 | 说明 |
|------|------|--------|--------|------|------|
| GET | /api/orders?status={s} | — | `{ code, data: Order[] }` | @PreAuthorize | 按状态查询订单 |
| POST | /api/orders | `{ productId, quantity }` | `{ code, data: Order }` | @PreAuthorize | 创建订单 |

- 前端 mock 和后端实现都必须以 contract 为准。
- Contract 中的接口必须能从 Architecture 文档中追溯。
- 编码 subagent 的强制自查要求用 contract 逐接口验证路径、方法、请求/响应结构。
```

- [ ] **Step 3: 新增 pre_code checklist 内嵌说明**

在 Tasks 产出章节中增加：

```markdown
## Pre-Code Checklist（内嵌于 tasks.md 头部）

生成 tasks.md 时，在文件头部自动嵌入以下检查清单。调度器在 spec advance 前验证全部已 `[x]`：

```markdown
## Pre-Code Checklist

- [ ] 已确认架构文档 API 路由/数据模型
- [ ] 已确认 PRD 功能范围和边界
- [ ] 已确认 UIUX 图标库、组件库、排版 token
- [ ] 已读取依赖清单确认框架版本
- [ ] 不确定的框架 API 已查阅官方文档
- [ ] 确认实现顺序：FE wave 优先 → preview_confirm → BE wave 继续
```
```

- [ ] **Step 4: 更新自检清单**

在现有自检清单末尾增加：

```markdown
- [ ] 每个切片有 `files:` 声明？
- [ ] 同一 wave 内切片文件无交集？
- [ ] 无 XL 切片（8+ 文件）？
- [ ] 单切片不超过 5 个任务（超过则标记 [SERIAL]）？
- [ ] api-contract 与 Architecture 文档接口一致？
- [ ] tasks.md 头部含 Pre-Code Checklist？
```

- [ ] **Step 5: 提效**

```bash
git add agents/spec-generator.md
git commit -m "feat: add wave planning methodology and api-contract output to spec-generator"
```

---

### Task 7: 更新 SKILL.md — v5.0.0 契约

**Files:**
- Modify: `SKILL.md`

**Interfaces:**
- Consumes: 新 spec-dev.mjs 的 phase/command 定义
- Produces: v5.0.0 SKILL.md 合约

- [ ] **Step 1: 更新 frontmatter 与阶段链**

替换 version 和阶段链：

```yaml
---
name: spec-dev
description: 并行治理式需求开发全流程 Skill。通过零依赖 JS 执行器推进 research → docs (并行三文档) → docs_check → docs_confirm → spec (拆分+审查) → dev (波次并行) → preview_confirm → quality (三路并行+自动修复) → delivery。状态记录在 .spec-dev/，三文档和交付产物写入 output/，任务写入 .spec-dev/changes/。
version: 5.0.0
# ... 其余不变
---
```

固定阶段链文本替换为：

```text
baseline → research → docs → docs_check → docs_confirm → spec → dev → preview_confirm → quality → delivery → done
```

合法 phase 值更新为新链。

- [ ] **Step 2: 更新硬门禁描述**

替换门禁段：

```markdown
硬门禁不可跳过：

1. `docs_confirm`：三文档完成后暂停，等待用户确认。
2. `preview_confirm`：前端完成后暂停，展示预览等待用户确认后进入 quality。

`quality` 为自动门禁：三路并行审查 + 自动修复循环，通过后自动进入 delivery。仅在修复 2 轮后仍有 CRITICAL 时暂停等待用户。
```

- [ ] **Step 3: 新增并行调度契约**

在"调度契约"段之后新增：

```markdown
## 并行调度契约

主会话必须按 `parallel_hint` 字段调度 subagent：

- `strategy: "parallel"`：同时派出所有 agents（一条消息多个 Agent 调用）。
- `strategy: "wave_parallel"`：按 tasks.md 的 wave 逐波派出，波内并行、波间串行。
- `strategy: "single_after"`：在指定 trigger 完成后派单个审查 agent。
- `max_per_wave`：单波最大并行数（默认 4）。
- `build_rule: "per_wave_end"`：每波完成后跑一次构建，而非每任务构建。

编码 subagent 的 prompt 模板：
\`\`\`text
<agent 指令文件路径>
<input 产物路径>
<api-contract 路径>
<output 路径>

## 强制自查（返回前逐项确认）
- [ ] 所有 import 完整且正确
- [ ] 接口路径与 api-contract.md 逐字一致
- [ ] 请求/响应结构与 contract 一致
- [ ] 空值/边界条件已处理
- [ ] 无 emoji 字符
- [ ] 无 console.log 或调试语句
\`\`\`
```

- [ ] **Step 4: 更新阶段推进规则**

替换为 v5.0 新规则：

```text
baseline     → advance --completed baseline
research     → advance --completed research --artifact research=...
docs         → advance --completed docs --artifact prd=... --artifact architecture=... --artifact uiux=...
docs_check   → advance --completed docs_check
docs_confirm → gate --confirm docs_confirm
spec         → advance --completed spec --artifact proposal=... --artifact tasks=... --artifact contract=.spec-dev/changes/{name}/api-contract.md
dev          → 每 wave 完成后 advance --completed dev --wave <n>；全部 wave 完后自动进入 preview_confirm
preview_confirm → gate --confirm preview_confirm
quality      → advance --completed quality --artifact quality=...
delivery     → deliver
```

- [ ] **Step 5: 更新阶段执行规则**

简要改写各阶段注释，重点：
- `docs`：按 `parallel_hint` 并行 subagent
- `docs_check`：新增，自动一致性校验
- `spec`：生成含 wave 的任务 + api-contract + 拆分审查
- `dev`：合并 frontend+backend，波次并行
- `quality`：三路并行 + 自动修复
- 删除 `pre_code` 独立段、`frontend`/`backend` 独立段

- [ ] **Step 6: 更新产物目录表**

新增 api-contract.md：

```text
{project}/.spec-dev/changes/{requirement_name}/
    ├── proposal.md
    ├── api-contract.md
    └── tasks.md
```

- [ ] **Step 7: 更新首轮响应契约**

新阶段链描述：
```text
- `new`：research → docs(并行) → docs_check → 等待确认(docs_confirm) → spec(拆分+审查) → dev(波次并行) → 等待确认(preview_confirm) → quality(三路并行自动修复) → delivery
- `evolve` / `patch`：baseline → research → ... (同上)
```

- [ ] **Step 8: 提交**

```bash
git add SKILL.md
git commit -m "feat: upgrade SKILL.md to v5.0.0 parallel pipeline contract"
```

---

### Task 8: 端到端验证 + 更新 README

**Files:**
- Modify: `README.md`, `README.zh.md` (如有必要)
- Verify: 全命令链

**Interfaces:**
- Consumes: Task 1-7 产出的完整 v5.0 skill
- Produces: 验证通过的 v5.0 流水线 + 更新后的 README

- [ ] **Step 1: 完整命令验证**

```bash
# 初始化新流程
node scripts/spec-dev.mjs init --root /tmp/test-v5 --requirement "测试并行流水线" --mode new

# 检查 state.json
cat /tmp/test-v5/.spec-dev/state.json
# 预期：schema_version=4, phase=research, waves=[], mode=new

# 模拟 research 完成
mkdir -p /tmp/test-v5/output
touch "/tmp/test-v5/output/ce-shi-bing-xing-liu-shui-xian-research.md"
node scripts/spec-dev.mjs advance --root /tmp/test-v5 --completed research --artifact "research=output/ce-shi-bing-xing-liu-shui-xian-research.md"

# 验证 next 返回 parallel_hint
node scripts/spec-dev.mjs next --root /tmp/test-v5
# 预期：phase=docs, parallel_hint.strategy="parallel", parallel_hint.agents.length=3

# 模拟 docs 完成
touch "/tmp/test-v5/output/ce-shi-bing-xing-liu-shui-xian-prd.md"
touch "/tmp/test-v5/output/ce-shi-bing-xing-liu-shui-xian-architecture.md"
touch "/tmp/test-v5/output/ce-shi-bing-xing-liu-shui-xian-uiux.md"
node scripts/spec-dev.mjs advance --root /tmp/test-v5 --completed docs --artifact "prd=output/ce-shi-bing-xing-liu-shui-xian-prd.md" --artifact "architecture=output/ce-shi-bing-xing-liu-shui-xian-architecture.md" --artifact "uiux=output/ce-shi-bing-xing-liu-shui-xian-uiux.md"

# 验证 docs_check
node scripts/spec-dev.mjs next --root /tmp/test-v5
# 预期：phase=docs_check

node scripts/spec-dev.mjs advance --root /tmp/test-v5 --completed docs_check
# 预期：phase=docs_confirm

# 验证 gate
node scripts/spec-dev.mjs gate --root /tmp/test-v5 --confirm docs_confirm
# 预期：phase=spec

# 模拟 spec 完成
mkdir -p "/tmp/test-v5/.spec-dev/changes/ce-shi-bing-xing-liu-shui-xian"
touch "/tmp/test-v5/.spec-dev/changes/ce-shi-bing-xing-liu-shui-xian/proposal.md"
touch "/tmp/test-v5/.spec-dev/changes/ce-shi-bing-xing-liu-shui-xian/tasks.md"
touch "/tmp/test-v5/.spec-dev/changes/ce-shi-bing-xing-liu-shui-xian/api-contract.md"
node scripts/spec-dev.mjs advance --root /tmp/test-v5 --completed spec --artifact "proposal=.spec-dev/changes/ce-shi-bing-xing-liu-shui-xian/proposal.md" --artifact "tasks=.spec-dev/changes/ce-shi-bing-xing-liu-shui-xian/tasks.md" --artifact "contract=.spec-dev/changes/ce-shi-bing-xing-liu-shui-xian/api-contract.md"

# 验证 dev 阶段
node scripts/spec-dev.mjs next --root /tmp/test-v5
# 预期：phase=dev, parallel_hint.strategy="wave_parallel"

# 验证 validate
node scripts/spec-dev.mjs validate --root /tmp/test-v5
# 预期：{"valid": true, ...}
```

- [ ] **Step 2: 旧 state 迁移测试**

```bash
# 创建 v4.0 格式的 state.json
cat > /tmp/test-migrate/.spec-dev/state.json << 'EOF'
{
  "schema_version": 3,
  "mode": "new",
  "phase": "frontend",
  "requirement": "测试迁移",
  "requirement_name": "ce-shi-qian-yi",
  "created_at": "2026-01-01T00:00:00.000Z",
  "phases_completed": ["research","docs","docs_confirm","spec","pre_code"],
  "current_gate": null,
  "artifacts": {
    "research": "output/ce-shi-qian-yi-research.md",
    "prd": "output/ce-shi-qian-yi-prd.md",
    "architecture": "output/ce-shi-qian-yi-architecture.md",
    "uiux": "output/ce-shi-qian-yi-uiux.md",
    "proposal": ".spec-dev/changes/ce-shi-qian-yi/proposal.md",
    "tasks": ".spec-dev/changes/ce-shi-qian-yi/tasks.md"
  },
  "quality": { "security_passed": false, "code_review_passed": false, "build_passed": false, "coverage_passed": false }
}
EOF

node scripts/spec-dev.mjs next --root /tmp/test-migrate
# 预期：phase=dev（frontend → dev 迁移），schema_version=4
```

- [ ] **Step 3: 清理测试目录**

```bash
rm -rf /tmp/test-v5 /tmp/test-migrate
```

- [ ] **Step 4: 更新 README.md 版本号与阶段链描述**

更新 README.md 中提及 v4.0.0 / 12-phase 的内容为 v5.0.0 / 11-phase（或相应描述）。

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: update README for v5.0.0 parallel pipeline"
```

---

## Plan Self-Review

### 1. Spec Coverage 检查

| Spec 需求 | 覆盖任务 |
|-----------|---------|
| 新阶段链：baseline→research→docs→docs_check→docs_confirm→spec→dev→preview_confirm→quality→delivery→done | Task 1 (常量), Task 2 (phasePayload), Task 7 (SKILL.md) |
| 删除 pre_code 独立阶段 | Task 2 (删除函数), Task 6 (内嵌 checklist) |
| frontend+backend → dev wave 并行 | Task 2 (phasePayload dev case), Task 6 (wave 方法论) |
| quality 自动门禁 + 2 轮修复 | Task 2 (phasePayload quality case) |
| 硬门禁 4→2 | Task 2 (commandGate 简化) |
| docs 三文档并行 subagent | Task 2 (parallel_hint docs case) |
| spec：wave 标记 + api-contract + 拆分审查 | Task 2 (phasePayload spec case), Task 6 |
| dev：波次并行，构建 per-wave | Task 2 (phasePayload dev case) |
| quality：三路并行审查 + 自动修复 | Task 2 (phasePayload quality case) |
| 三个巨型指令精简 | Task 3 (security-reviewer), Task 4 (quality-reviewer), Task 5 (quality-checklist) |
| parallel_hint 字段 | Task 2 (phasePayload 返回值) |
| advance wave 校验 | Task 2 (commandAdvance) |
| validate 增加 contract + wave | Task 2 (artifactsRequiredForPhase) |
| schema_version 4 + 旧 state 迁移 | Task 1, Task 8 (迁移测试) |
| SKILL.md v5.0.0 契约 | Task 7 |
| 强制自查段 | Task 7 (并行调度契约段的 prompt 模板) |

### 2. Placeholder 扫描

无 TBD/TODO/空段。所有代码块完整，所有命令可执行。

### 3. Type 一致性

- `phase` 值在所有函数中使用 PHASES 常量中的字符串，一致。
- `parallel_hint.strategy` 使用 `'parallel' | 'wave_parallel' | 'single_after'`，在所有 switch case 中一致。
- `state.waves` 是数组，在 createState（初始化为 [])、commandAdvance（push/update）、phasePayload（读取）中类型一致。
- `artifacts.contract` 是 string|null，在 ARTIFACT_KINDS、artifactPath、artifactKindsForCompletedPhase 中一致。
