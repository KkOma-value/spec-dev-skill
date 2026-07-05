#!/usr/bin/env node
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 4;

const STATE_DIR = '.spec-dev';
const STATE_FILE = 'state.json';
const LEGACY_STATE_DIR = 'spec-dev';
const LEGACY_STATE_FILE = '.state.json';
const OUTPUT_DIR = 'output';
const CHANGES_DIR = `${STATE_DIR}/changes`;
const SESSION_BRIEF_FILE = 'SESSION_BRIEF.md';
const PRE_CODE_CHECKLIST_FILE = 'PRE_CODE_CHECKLIST.md';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(SCRIPT_DIR, '..');

const VALID_MODES = new Set(['new', 'evolve', 'patch']);

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

const PINYIN_MAP = {
  '为': 'wei',
  '订': 'ding',
  '单': 'dan',
  '服': 'fu',
  '务': 'wu',
  '新': 'xin',
  '增': 'zeng',
  '按': 'an',
  '状': 'zhuang',
  '态': 'tai',
  '分': 'fen',
  '页': 'ye',
  '查': 'cha',
  '询': 'xun',
  '接': 'jie',
  '口': 'kou',
  '求': 'qiu',
  '需': 'xu',
  '开': 'kai',
  '发': 'fa',
  '流': 'liu',
  '程': 'cheng',
  '用': 'yong',
  '户': 'hu',
  '管': 'guan',
  '理': 'li',
  '业': 'ye',
  '后': 'hou',
  '台': 'tai',
  '微': 'wei',
  '设': 'she',
  '计': 'ji',
  '面': 'mian',
  '界': 'jie',
  '交': 'jiao',
  '互': 'hu',
  '修': 'xiu',
  '复': 'fu',
  '补': 'bu',
  '丁': 'ding',
  '安': 'an',
  '全': 'quan',
  '审': 'shen',
  '质': 'zhi',
  '量': 'liang',
  '前': 'qian',
  '端': 'duan',
  '预': 'yu',
  '览': 'lan',
  '确': 'que',
  '认': 'ren',
  '归': 'gui',
  '档': 'dang',
  '模': 'mo',
  '式': 'shi',
  '演': 'yan',
  '进': 'jin',
};

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const options = { _: [] };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }

    const key = token.slice(2);
    const value = tokens[i + 1];
    if (value === undefined || value.startsWith('--')) {
      options[key] = true;
      continue;
    }

    if (options[key] === undefined) {
      options[key] = value;
    } else if (Array.isArray(options[key])) {
      options[key].push(value);
    } else {
      options[key] = [options[key], value];
    }
    i += 1;
  }

  return { command, options };
}

function normalizeRoot(options) {
  return path.resolve(String(options.root || process.cwd()));
}

function statePath(root) {
  return path.join(root, STATE_DIR, STATE_FILE);
}

function legacyStatePath(root) {
  return path.join(root, LEGACY_STATE_DIR, LEGACY_STATE_FILE);
}

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

function requiredArtifact(state, kind) {
  const artifact = state.artifacts?.[kind];
  if (!artifact) {
    throw appError('ARTIFACT_REQUIRED', `Artifact ${kind} must be recorded before phase ${state.phase}.`, {
      phase: state.phase,
      kind,
    });
  }
  return artifact;
}

async function optionalKnowledgeReads(root) {
  const reads = [];
  try {
    await access(path.join(root, 'knowledge'));
    reads.push('knowledge/');
  } catch {
    // Optional.
  }

  const cacheDir = path.join(root, OUTPUT_DIR, 'knowledge-cache');
  try {
    const entries = await readdir(cacheDir);
    for (const entry of entries.sort()) {
      if (entry.endsWith('-knowledge-bundle.json')) {
        reads.push(`${OUTPUT_DIR}/knowledge-cache/${entry}`);
      }
    }
  } catch {
    // Optional.
  }

  return reads;
}

async function phasePayload(root, state) {
  const phase = state.phase;
  const currentGate = state.current_gate || (VALID_GATES.has(phase) ? phase : null);
  let requiredReads = [];
  let expectedOutputs = [];
  let message = '';
  let parallelHint = null;

  switch (phase) {
    case 'baseline':
      message = '轻量 baseline：扫描当前项目结构、已有约束和差量范围；完成后调用 advance --completed baseline 进入 research。';
      break;
    case 'research':
      requiredReads = ['agents/researcher.md', ...(await optionalKnowledgeReads(root))];
      expectedOutputs = [artifactPath('research', state.requirement_name)];
      message = '读取 researcher 指令，执行本地知识发现、代码分析和必要联网调研；写入 output/*-research.md 后调用 advance --completed research 并记录 artifact。';
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
      message = '并行三文档阶段：按 parallel_hint 同时派出 prd-writer / architecture-writer / ui-designer 三个 subagent。每个 subagent 需读取各自 agent 指令文件和模板。全部完成后调用 advance --completed docs 并记录 artifacts。';
      parallelHint = {
        description: 'docs: 并行生成三文档',
        strategy: 'parallel',
        agents: [
          {
            label: 'prd-writer',
            input_files: [
              'agents/prd-writer.md',
              'references/prd-template.md',
              requiredArtifact(state, 'research'),
            ],
            output_file: artifactPath('prd', state.requirement_name),
          },
          {
            label: 'architecture-writer',
            input_files: [
              'agents/architecture-writer.md',
              'references/architecture-template.md',
              requiredArtifact(state, 'research'),
            ],
            output_file: artifactPath('architecture', state.requirement_name),
          },
          {
            label: 'ui-designer',
            input_files: [
              'agents/ui-designer.md',
              'references/uiux-template.md',
              'references/uiux-pro-max-adapter.md',
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
      message = '自动一致性校验：对照 PRD 功能点 ↔ Architecture 模块 ↔ UIUX 页面三者，确认每个 PRD 功能点在 Architecture 有承接模块、在 UIUX 有对应页面/状态。发现缺口直接修文档。完成后调用 advance --completed docs_check。';
      break;
    case 'docs_confirm':
      requiredReads = [
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
      ];
      message = '硬门禁：向用户展示 PRD、Architecture 和 UIUX 摘要（各 3-5 条核心要点）；提示用户"请确认三文档，确认后将进入任务拆分阶段。你可以说\'确认\'继续，或提出修改意见。"确认后调用 gate --confirm docs_confirm，修改意见则更新对应文档并停留门禁。';
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
      message = '拆分阶段：读取 spec-generator 指令和模板，生成含 wave 标记的 tasks.md + api-contract.md + proposal.md。tasks.md 头部需内嵌 Pre-Code Checklist。拆分完成后派单个拆分审查 subagent 按红旗清单（XL 任务、无验收标准、模糊指令、wave 内文件冲突、依赖顺序颠倒）做检查，问题修正后才 advance --completed spec。';
      parallelHint = {
        description: 'spec: 拆分审查（tasks.md 生成后派单个审查 agent）',
        strategy: 'single_after',
        trigger: 'tasks_generated',
        agents: [
          {
            label: 'spec-reviewer',
            input_files: [
              artifactPath('tasks', state.requirement_name),
              artifactPath('contract', state.requirement_name),
              requiredArtifact(state, 'prd'),
              requiredArtifact(state, 'architecture'),
              requiredArtifact(state, 'uiux'),
            ],
            check_rules: '红旗清单：XL 任务（8+ 文件）、无验收标准、模糊指令、wave 内文件冲突、依赖顺序颠倒。',
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
      message = '波次编码阶段：按 tasks.md 的 wave 逐波并行执行。wave 内无依赖切片由 parallel_hint 指引并行 subagent 实现（每波 ≤4 个）。单切片 >5 任务或跨切片重构留在主会话串行。每 wave 完成后跑一次构建（FE wave 跑 FE 构建，BE wave 跑 BE 构建）。全部 wave 完成自动进入 preview_confirm。';
      parallelHint = {
        description: 'dev: 按 wave 并行编码',
        strategy: 'wave_parallel',
        max_per_wave: 4,
        build_rule: 'per_wave_end',
        note: '主会话按 tasks.md 的 waves 结构逐波派发 subagent。编码 subagent 返回前需完成强制自查（导入完整性、接口路径与 contract 一致、空值/边界处理、无 emoji/无调试语句）。单切片 >5 任务或跨切片重构→留主会话串行。',
      };
      break;
    case 'preview_confirm':
      requiredReads = [
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'uiux'),
      ];
      message = '硬门禁：展示前端预览（已完成任务列表、修改文件清单、构建结果、UIUX 一致性对比）；提示用户"前端开发已完成，请确认。确认后将进入质量门禁阶段。你可以说\'确认\'继续，或指出需要修改的地方。"确认后调用 gate --confirm preview_confirm。';
      break;
    case 'quality':
      requiredReads = [
        'agents/security-reviewer.md',
        'agents/quality-reviewer.md',
        'references/quality-checklist.md',
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
        artifactPath('contract', state.requirement_name),
      ];
      expectedOutputs = [artifactPath('quality', state.requirement_name)];
      message = '自动质量门禁：按 parallel_hint 三路并行审查（安全审查 / 代码审查 / 构建+测试）。主会话汇总发现后自动修复 CRITICAL/HIGH 问题，最多 2 轮。2 轮后仍有 CRITICAL 则暂停问用户。通过后自动生成 quality-report 并调用 advance --completed quality 进入 delivery。';
      parallelHint = {
        description: 'quality: 三路并行审查 + 自动修复',
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
      message = '交付阶段：调用 deliver 命令生成 output/{YYYY-MM-DD}-{name}-delivery.md 并推进到 done。archive 是兼容别名。';
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

async function ensureProjectDirs(root, state = null) {
  await mkdir(path.join(root, STATE_DIR), { recursive: true });
  await mkdir(path.join(root, CHANGES_DIR), { recursive: true });
  await mkdir(path.join(root, OUTPUT_DIR), { recursive: true });
  if (state?.requirement_name) {
    await mkdir(path.join(root, CHANGES_DIR, state.requirement_name), { recursive: true });
  }
}

function defaultArtifacts() {
  return {
    research: null,
    prd: null,
    architecture: null,
    uiux: null,
    proposal: null,
    tasks: null,
    quality: null,
    delivery: null,
  };
}

function defaultQualityState() {
  return {
    security_passed: false,
    code_review_passed: false,
    build_passed: false,
    coverage_passed: false,
  };
}

function slugifyRequirement(requirement) {
  const tokens = [];
  for (const char of requirement.normalize('NFKD')) {
    if (/[\p{Letter}\p{Number}]/u.test(char) && char.charCodeAt(0) <= 127) {
      tokens.push(char.toLowerCase());
      continue;
    }

    const mapped = PINYIN_MAP[char];
    if (mapped) {
      tokens.push(`-${mapped}-`);
      continue;
    }

    tokens.push('-');
  }

  const slug = tokens
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return slug || 'requirement';
}

async function readState(root) {
  try {
    return normalizeState(JSON.parse(await readFile(statePath(root), 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error instanceof SyntaxError) {
        throw appError('STATE_INVALID_JSON', 'State file is not valid JSON.');
      }
      throw error;
    }
  }

  let legacyRaw;
  try {
    legacyRaw = await readFile(legacyStatePath(root), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw appError('STATE_NOT_FOUND', `State file not found: ${path.join(STATE_DIR, STATE_FILE)}`);
    }
    throw error;
  }

  let legacyState;
  try {
    legacyState = JSON.parse(legacyRaw);
  } catch {
    throw appError('STATE_INVALID_JSON', 'Legacy state file is not valid JSON.');
  }

  const migrated = migrateLegacyState(legacyState);
  migrated.migrated_from = path.join(LEGACY_STATE_DIR, LEGACY_STATE_FILE);
  migrated.migrated_at = new Date().toISOString();
  await writeState(root, migrated);
  return migrated;
}

async function writeState(root, state) {
  const normalized = normalizeState(state);
  await ensureProjectDirs(root, normalized);
  await writeFile(statePath(root), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}

function normalizeState(state) {
  const artifacts = { ...defaultArtifacts(), ...(state.artifacts || {}) };
  if (!artifacts.architecture && state.artifacts?.tech) {
    artifacts.architecture = state.artifacts.tech;
  }
  if (!artifacts.tasks && state.artifacts?.spec) {
    artifacts.tasks = state.artifacts.spec;
  }
  if (!artifacts.delivery && state.artifacts?.archive) {
    artifacts.delivery = state.artifacts.archive;
  }

  const phase = normalizePhase(state.phase || 'research');
  const currentGate = normalizeGate(state.current_gate || (VALID_GATES.has(phase) ? phase : null));

  return {
    schema_version: SCHEMA_VERSION,
    mode: VALID_MODES.has(state.mode) ? state.mode : 'new',
    phase,
    requirement: state.requirement || '',
    requirement_name: state.requirement_name || slugifyRequirement(state.requirement || 'requirement'),
    created_at: state.created_at || new Date().toISOString(),
    phases_completed: normalizeCompletedPhases(state.phases_completed || []),
    current_gate: currentGate,
    artifacts,
    quality: { ...defaultQualityState(), ...(state.quality || {}) },
    waves: state.waves || [],
  };
}

function migrateLegacyState(state) {
  const legacyArtifacts = state.artifacts || {};
  const requirementName = state.requirement_name || slugifyRequirement(state.requirement || 'requirement');
  return normalizeState({
    ...state,
    phase: normalizeLegacyPhase(state.phase || 'research'),
    current_gate: normalizeGate(state.current_gate || null),
    phases_completed: (state.phases_completed || []).map(normalizeLegacyPhase),
    artifacts: {
      research: legacyArtifacts.research || artifactPath('research', requirementName),
      prd: legacyArtifacts.prd || null,
      architecture: legacyArtifacts.architecture || legacyArtifacts.tech || null,
      uiux: legacyArtifacts.uiux || null,
      proposal: legacyArtifacts.proposal || null,
      tasks: legacyArtifacts.tasks || legacyArtifacts.spec || null,
      quality: legacyArtifacts.quality || null,
      delivery: legacyArtifacts.delivery || legacyArtifacts.archive || null,
    },
  });
}

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

function normalizePhase(phase) {
  const normalized = String(phase || '').trim();
  if (LEGACY_PHASE_MAP[normalized]) {
    return LEGACY_PHASE_MAP[normalized];
  }
  return PHASES.includes(normalized) ? normalized : 'research';
}

function normalizeGate(gate) {
  if (gate === 'dev_confirm') {
    return 'preview_confirm';
  }
  if (VALID_GATES.has(gate)) {
    return gate;
  }
  return null;
}

function normalizeCompletedPhases(phases) {
  const normalized = [];
  for (const phase of phases) {
    const item = normalizeLegacyPhase(phase);
    if (PHASES.includes(item) && !normalized.includes(item)) {
      normalized.push(item);
    }
  }
  return normalized;
}

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

function parseArtifacts(value) {
  const items = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const artifacts = {};

  for (const item of items) {
    const index = String(item).indexOf('=');
    if (index === -1) {
      throw appError('INVALID_ARTIFACT', `Artifact must use kind=path format: ${item}`);
    }

    const kind = item.slice(0, index);
    const artifact = item.slice(index + 1);
    if (!ARTIFACT_KINDS.has(kind)) {
      throw appError('INVALID_ARTIFACT_KIND', `Unknown artifact kind: ${kind}`, { kind });
    }
    if (!artifact) {
      throw appError('INVALID_ARTIFACT', `Artifact path is empty for kind: ${kind}`);
    }
    artifacts[kind] = artifact;
  }

  return artifacts;
}

function addCompleted(state, phase) {
  if (!state.phases_completed.includes(phase)) {
    state.phases_completed.push(phase);
  }
}

async function commandInit(options) {
  const root = normalizeRoot(options);
  const requirement = String(options.requirement || '').trim();
  if (!requirement) {
    throw appError('MISSING_REQUIREMENT', 'init requires --requirement.');
  }

  const mode = String(options.mode || 'new').trim();
  if (!VALID_MODES.has(mode)) {
    throw appError('INVALID_MODE', `Unknown mode: ${mode}. Valid modes: new, evolve, patch.`, { mode });
  }

  const state = createState(requirement, mode);
  await writeState(root, state);
  await writeSessionBrief(root, state);
  return phasePayload(root, state);
}

async function commandNext(options) {
  const root = normalizeRoot(options);
  const state = await readState(root);
  return phasePayload(root, state);
}

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

  if (completed === 'pre_code') {
    await assertPreCodeChecklistComplete(root);
  }

  if (completed === 'dev') {
    const waveNum = options.wave ? parseInt(String(options.wave), 10) : null;
    if (waveNum) {
      if (!state.waves) { state.waves = []; }
      const existingIdx = state.waves.findIndex(w => w.num === waveNum);
      if (existingIdx >= 0) {
        state.waves[existingIdx].completed = true;
        state.waves[existingIdx].completed_at = new Date().toISOString();
      } else {
        state.waves.push({ num: waveNum, completed: true, completed_at: new Date().toISOString() });
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

  state.current_gate = VALID_GATES.has(state.phase) ? state.phase : null;

  await writeState(root, state);
  return phasePayload(root, state);
}

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

async function commandGate(options) {
  const root = normalizeRoot(options);
  const confirm = String(options.confirm || '');
  const state = await readState(root);

  // 兼容旧 dev_confirm — 映射到 preview_confirm
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

async function commandDeliver(options) {
  const root = normalizeRoot(options);
  const state = await readState(root);
  if (state.phase !== 'delivery') {
    throw appError('PHASE_MISMATCH', `Cannot deliver while current phase is ${state.phase}.`, {
      current: state.phase,
      expected: 'delivery',
    });
  }

  const date = resolveDeliveryDate(process.env.SPEC_DEV_DATE);
  const required = [
    requiredArtifact(state, 'research'),
    requiredArtifact(state, 'prd'),
    requiredArtifact(state, 'architecture'),
    requiredArtifact(state, 'uiux'),
    requiredArtifact(state, 'tasks'),
    requiredArtifact(state, 'quality'),
  ];
  await assertArtifactsExist(root, required);

  const deliveryPath = `${OUTPUT_DIR}/${date}-${state.requirement_name}-delivery.md`;
  const deliveryFile = path.join(root, deliveryPath);
  await mkdir(path.dirname(deliveryFile), { recursive: true });

  const taskCounts = await countTasks(path.join(root, state.artifacts.tasks));
  const body = await renderDeliveryTemplate(root, state, {
    date,
    deliveryPath,
    taskCounts,
  });

  await writeFile(deliveryFile, body, 'utf8');
  state.artifacts.delivery = deliveryPath;
  addCompleted(state, 'delivery');
  state.phase = 'done';
  state.current_gate = null;
  await writeState(root, state);

  return {
    ...(await phasePayload(root, state)),
    delivery_path: deliveryPath,
    archive_path: deliveryPath,
  };
}

async function commandValidate(options) {
  const root = normalizeRoot(options);
  const state = await readState(root);
  if (!PHASES.includes(state.phase)) {
    throw appError('UNKNOWN_PHASE', `Unknown phase: ${state.phase}`, { phase: state.phase });
  }
  if (state.phase === 'done') {
    return { valid: true, phase: state.phase, mode: state.mode || 'new', current_gate: state.current_gate || null };
  }

  await assertArtifactsExist(root, artifactsRequiredForPhase(state));

  return { valid: true, phase: state.phase, mode: state.mode || 'new', current_gate: state.current_gate || null };
}

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

function resolveDeliveryDate(overrideDate) {
  const date = overrideDate || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError('INVALID_DELIVERY_DATE', 'Delivery date must use YYYY-MM-DD format.', { date });
  }
  return date;
}

async function assertArtifactsExist(root, artifacts) {
  const missing = [];
  for (const artifact of artifacts) {
    try {
      await access(path.join(root, artifact));
    } catch (error) {
      if (error.code === 'ENOENT') {
        missing.push(artifact);
      } else {
        throw error;
      }
    }
  }

  if (missing.length > 0) {
    throw appError('ARTIFACT_NOT_FOUND', 'One or more required artifacts are missing.', { missing });
  }
}

async function writeSessionBrief(root, state) {
  const file = path.join(root, STATE_DIR, SESSION_BRIEF_FILE);
  const body = [
    '# SESSION BRIEF',
    '',
    '## Session Title',
    '',
    `${state.requirement_name} -- spec-dev ${state.mode} flow`,
    '',
    '## Current State',
    '',
    `Phase: ${state.phase}`,
    `Mode: ${state.mode}`,
    '',
    '## Task Specification',
    '',
    state.requirement,
    '',
    '## Files and Functions',
    '',
    '_(empty)_',
    '',
    '## Workflow',
    '',
    'research -> docs (并行三文档) -> docs_check -> docs_confirm -> spec (拆分+审查) -> dev (波次并行) -> preview_confirm -> quality (三路并行+自动修复) -> delivery',
    '',
    '## Errors & Corrections',
    '',
    '_(empty)_',
    '',
    '## Codebase Documentation',
    '',
    '_(empty)_',
    '',
    '## Learnings',
    '',
    '_(empty)_',
    '',
    '## Key Results',
    '',
    '_(empty)_',
    '',
    '## Worklog',
    '',
    `- Created at ${state.created_at}`,
    '',
  ].join('\n');
  await writeFile(file, body, 'utf8');
}


async function renderDeliveryTemplate(root, state, delivery) {
  const templatePath = path.join(SKILL_ROOT, 'references', 'delivery-template.md');
  const template = await readFile(templatePath, 'utf8');
  const startedAt = String(state.created_at || '').slice(0, 10) || delivery.date;
  const docs = {
    research: requiredArtifact(state, 'research'),
    prd: requiredArtifact(state, 'prd'),
    architecture: requiredArtifact(state, 'architecture'),
    uiux: requiredArtifact(state, 'uiux'),
    tasks: requiredArtifact(state, 'tasks'),
    quality: requiredArtifact(state, 'quality'),
  };

  return template
    .replaceAll('{需求名称}', state.requirement_name)
    .replaceAll('{YYYY-MM-DD}', delivery.date)
    .replaceAll('{项目名称}', path.basename(root))
    .replaceAll('{开始日期}', startedAt)
    .replaceAll('{交付日期}', delivery.date)
    .replaceAll('{工作模式}', state.mode || 'new')
    .replaceAll('{research_path}', docs.research)
    .replaceAll('{prd_path}', docs.prd)
    .replaceAll('{architecture_path}', docs.architecture)
    .replaceAll('{uiux_path}', docs.uiux)
    .replaceAll('{tasks_path}', docs.tasks)
    .replaceAll('{quality_path}', docs.quality)
    .replaceAll('{delivery_path}', delivery.deliveryPath)
    .replaceAll('{task_done}', String(delivery.taskCounts.done))
    .replaceAll('{task_total}', String(delivery.taskCounts.total));
}

async function countTasks(specFile) {
  let raw = '';
  try {
    raw = await readFile(specFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const taskLine = /^\[(?:x| )?\]\s+\d+\./i;
  const doneLine = /^\[x\]\s+\d+\./i;
  const lines = raw.split(/\r?\n/);
  return {
    total: lines.filter((line) => taskLine.test(line)).length,
    done: lines.filter((line) => doneLine.test(line)).length,
  };
}

function appError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function ok(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function fail(error) {
  const code = error.code || 'UNEXPECTED_ERROR';
  ok({
    error: {
      code,
      message: error.message,
      ...error.details,
    },
  });
  process.exitCode = 1;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const commands = {
    init: commandInit,
    next: commandNext,
    advance: commandAdvance,
    gate: commandGate,
    deliver: commandDeliver,
    archive: commandDeliver,
    validate: commandValidate,
  };

  if (!commands[command]) {
    throw appError('UNKNOWN_COMMAND', `Unknown command: ${command || '(missing)'}`, {
      commands: Object.keys(commands),
    });
  }

  ok(await commands[command](options));
}

main().catch(fail);
