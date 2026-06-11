#!/usr/bin/env node
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 3;
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
  'docs_confirm',
  'spec',
  'pre_code',
  'frontend',
  'preview_confirm',
  'backend',
  'quality',
  'delivery',
  'done',
];

const NEXT_PHASE = {
  baseline: 'research',
  research: 'docs',
  docs: 'docs_confirm',
  docs_confirm: 'spec',
  spec: 'pre_code',
  pre_code: 'frontend',
  frontend: 'preview_confirm',
  preview_confirm: 'backend',
  backend: 'quality',
  quality: 'delivery',
  delivery: 'done',
};

const ARTIFACT_KINDS = new Set([
  'research',
  'prd',
  'architecture',
  'uiux',
  'proposal',
  'tasks',
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
  const currentGate = state.current_gate || (phase === 'docs_confirm' || phase === 'preview_confirm' ? phase : null);
  let requiredReads = [];
  let expectedOutputs = [];
  let message = '';

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
        'agents/prd-writer.md',
        'agents/architecture-writer.md',
        'agents/ui-designer.md',
        'references/prd-template.md',
        'references/architecture-template.md',
        'references/uiux-template.md',
        'references/uiux-pro-max-adapter.md',
        requiredArtifact(state, 'research'),
      ];
      expectedOutputs = [
        artifactPath('prd', state.requirement_name),
        artifactPath('architecture', state.requirement_name),
        artifactPath('uiux', state.requirement_name),
      ];
      message = '三文档阶段：基于 research 一次性生成 PRD、Architecture、UIUX 到 output/，完成后调用 advance --completed docs 并记录 prd、architecture、uiux artifacts。';
      break;
    case 'docs_confirm':
      requiredReads = [
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
      ];
      message = '硬门禁：向用户展示 PRD、Architecture 和 UIUX 摘要；确认后调用 gate --confirm docs_confirm，修改意见则更新文档并停留门禁。';
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
      ];
      message = '读取任务拆分专家指令、模板和已确认文档，生成 .spec-dev/changes/*/proposal.md 与 tasks.md 后调用 advance --completed spec 并记录 artifacts。';
      break;
    case 'pre_code':
      requiredReads = [
        `${STATE_DIR}/${PRE_CODE_CHECKLIST_FILE}`,
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
        requiredArtifact(state, 'tasks'),
      ];
      message = '编码前门禁：逐项完成 .spec-dev/PRE_CODE_CHECKLIST.md；全部标记 [x] 后调用 advance --completed pre_code 进入 frontend。';
      break;
    case 'frontend':
      requiredReads = [
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'uiux'),
        `${STATE_DIR}/${PRE_CODE_CHECKLIST_FILE}`,
      ];
      message = '按 tasks 中前端相关任务顺序实现，每个完成后标记 [x] 并运行前端构建验证；全部完成后调用 advance --completed frontend 进入 preview_confirm。';
      break;
    case 'preview_confirm':
      requiredReads = [
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'uiux'),
      ];
      message = '硬门禁：展示前端截图/运行结果和 UIUX 设计对比，汇报完成的前端任务和变更文件；确认后调用 gate --confirm preview_confirm，修改意见则继续 frontend。';
      break;
    case 'backend':
      requiredReads = [
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'architecture'),
      ];
      message = '按 tasks 中后端相关任务顺序实现，每个完成后标记 [x] 并运行后端构建验证；全部完成后调用 advance --completed backend 进入 quality。';
      break;
    case 'quality':
      requiredReads = [
        'agents/quality-reviewer.md',
        'agents/security-reviewer.md',
        'references/quality-checklist.md',
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
      ];
      expectedOutputs = [artifactPath('quality', state.requirement_name)];
      message = '自动化质量门禁：执行安全审查、代码审查、构建验证、覆盖率检查与 UI 一致性检查；汇总为 output/*-quality-report.md 后调用 advance --completed quality。';
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
  const currentGate = normalizeGate(state.current_gate || (phase === 'docs_confirm' || phase === 'preview_confirm' ? phase : null));

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
  return PHASES.includes(normalized) ? normalized : 'research';
}

function normalizeGate(gate) {
  if (gate === 'dev_confirm') {
    return 'preview_confirm';
  }
  if (gate === 'docs_confirm' || gate === 'preview_confirm') {
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

  state.current_gate = (state.phase === 'docs_confirm' || state.phase === 'preview_confirm') ? state.phase : null;
  if (state.phase === 'pre_code') {
    await writePreCodeChecklist(root, state);
  }

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
      return ['proposal', 'tasks'];
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

  if (confirm === 'dev_confirm') {
    if (state.phase !== 'preview_confirm') {
      throw appError('GATE_MISMATCH', `Cannot confirm dev_confirm while current gate is ${state.current_gate || 'none'}.`, {
        phase: state.phase,
        current_gate: state.current_gate,
        confirm,
      });
    }
    addCompleted(state, 'preview_confirm');
    state.phase = 'backend';
    state.current_gate = null;
    await writeState(root, state);
    return phasePayload(root, state);
  }

  if (confirm !== 'docs_confirm' && confirm !== 'preview_confirm') {
    throw appError('INVALID_GATE', `Unknown gate: ${confirm}. Valid gates: docs_confirm, preview_confirm.`, { confirm });
  }
  if (state.phase !== confirm || state.current_gate !== confirm) {
    throw appError('GATE_MISMATCH', `Cannot confirm ${confirm} while current gate is ${state.current_gate || 'none'}.`, {
      phase: state.phase,
      current_gate: state.current_gate,
      confirm,
    });
  }

  addCompleted(state, confirm);
  state.phase = NEXT_PHASE[confirm];
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
    case 'docs':
      return [requiredArtifact(state, 'research')];
    case 'docs_confirm':
    case 'spec':
      return [requiredArtifact(state, 'prd'), requiredArtifact(state, 'architecture'), requiredArtifact(state, 'uiux')];
    case 'pre_code':
      return [
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
        requiredArtifact(state, 'tasks'),
      ];
    case 'frontend':
    case 'preview_confirm':
      return [requiredArtifact(state, 'tasks'), requiredArtifact(state, 'uiux')];
    case 'backend':
      return [requiredArtifact(state, 'tasks'), requiredArtifact(state, 'architecture')];
    case 'quality':
      return [
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
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
    'research -> docs -> docs_confirm -> spec -> pre_code -> frontend -> preview_confirm -> backend -> quality -> delivery',
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

async function writePreCodeChecklist(root, state) {
  const file = path.join(root, STATE_DIR, PRE_CODE_CHECKLIST_FILE);
  const body = [
    '# Pre-Code Checklist',
    '',
    '> Complete every item before writing implementation code. Mark each item with [x].',
    '',
    '## Architecture Confirmation',
    '',
    `- [ ] Read \`${state.artifacts.architecture}\` and confirm API routes / data model`,
    `- [ ] Read \`${state.artifacts.prd}\` and confirm functional scope`,
    '',
    '## UI/UX Confirmation',
    '',
    `- [ ] Read \`${state.artifacts.uiux}\` and confirm icon library`,
    '- [ ] Declare the component library being used',
    '- [ ] Confirm typography system and design tokens are defined',
    '',
    '## Tech Stack Verification',
    '',
    '- [ ] Read dependency manifests and record exact framework versions',
    '- [ ] Check official docs for any uncertain framework API before coding',
    '- [ ] Verify framework config files match the architecture document',
    '',
    '## Spec Alignment',
    '',
    `- [ ] Read \`${state.artifacts.tasks}\` for the current task list`,
    '- [ ] Confirm implementation order: frontend first, then preview gate, then backend',
    '',
  ].join('\n');
  await writeFile(file, body, 'utf8');
}

async function assertPreCodeChecklistComplete(root) {
  const file = path.join(root, STATE_DIR, PRE_CODE_CHECKLIST_FILE);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw appError('PRE_CODE_CHECKLIST_MISSING', `${path.join(STATE_DIR, PRE_CODE_CHECKLIST_FILE)} does not exist.`);
    }
    throw error;
  }

  const incomplete = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- [ ]'));

  if (incomplete.length > 0) {
    throw appError('PRE_CODE_CHECKLIST_INCOMPLETE', 'Pre-code checklist has incomplete items.', { incomplete });
  }
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
