#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 2;
const STATE_DIR = 'spec-dev';
const STATE_FILE = '.state.json';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(SCRIPT_DIR, '..');

const VALID_MODES = new Set(['new', 'evolve', 'patch']);

const PHASES = [
  'research',
  'prd',
  'tech',
  'uiux',
  'docs_confirm',
  'spec',
  'frontend',
  'preview_confirm',
  'backend',
  'quality',
  'archive',
  'done',
];

const NEXT_PHASE = {
  research: 'prd',
  prd: 'tech',
  tech: 'uiux',
  uiux: 'docs_confirm',
  docs_confirm: 'spec',
  spec: 'frontend',
  frontend: 'preview_confirm',
  preview_confirm: 'backend',
  backend: 'quality',
  quality: 'archive',
  archive: 'done',
};

const ARTIFACT_KINDS = new Set(['prd', 'tech', 'uiux', 'spec', 'quality', 'archive']);

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
  '页': 'ye',
  '面': 'mian',
  '界': 'jie',
  '交': 'jiao',
  '互': 'hu',
  '设': 'she',
  '修': 'xiu',
  '复': 'fu',
  '补': 'bu',
  '丁': 'ding',
  '安': 'an',
  '全': 'quan',
  '审': 'shen',
  '查': 'cha',
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

function statePath(root) {
  return path.join(root, STATE_DIR, STATE_FILE);
}

function normalizeRoot(options) {
  return path.resolve(String(options.root || process.cwd()));
}

function artifactPath(kind, requirementName) {
  switch (kind) {
    case 'prd':
      return `spec-dev/prd/${requirementName}-prd.md`;
    case 'tech':
      return `spec-dev/tech/${requirementName}-tech.md`;
    case 'uiux':
      return `spec-dev/uiux/${requirementName}-uiux.md`;
    case 'spec':
      return `spec-dev/spec/${requirementName}-tasks.md`;
    case 'quality':
      return `spec-dev/quality/${requirementName}-quality-report.md`;
    case 'archive':
      return `spec-dev/archive/<YYYY-MM-DD>-${requirementName}.md`;
    default:
      return null;
  }
}

function artifactOrDefault(state, kind) {
  return state.artifacts?.[kind] || artifactPath(kind, state.requirement_name);
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

function phasePayload(state) {
  const phase = state.phase;
  const currentGate = state.current_gate || (phase === 'docs_confirm' || phase === 'preview_confirm' ? phase : null);
  let requiredReads = [];
  let expectedOutput = null;
  let message = '';

  switch (phase) {
    case 'research':
      requiredReads = ['agents/researcher.md'];
      message = '读取 researcher 指令，执行本地代码分析和必要联网调研；调研结论沉淀到后续 PRD/Tech。';
      break;
    case 'prd':
      requiredReads = ['agents/prd-writer.md', 'references/prd-template.md'];
      expectedOutput = artifactPath('prd', state.requirement_name);
      message = '读取 PRD 专家指令和模板，生成 PRD 后调用 advance --completed prd 并记录 artifact。';
      break;
    case 'tech':
      requiredReads = ['agents/tech-writer.md', 'references/tech-template.md'];
      expectedOutput = artifactPath('tech', state.requirement_name);
      message = '读取技术方案专家指令和模板，生成 Tech 后调用 advance --completed tech 并记录 artifact。';
      break;
    case 'uiux':
      requiredReads = [
        'agents/ui-designer.md',
        'references/uiux-template.md',
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'tech'),
      ];
      expectedOutput = artifactPath('uiux', state.requirement_name);
      message = '读取 UI/UX 设计专家指令和模板，基于 PRD 和 Tech 生成 UI/UX 设计文档后调用 advance --completed uiux 并进入 docs_confirm 门禁。';
      break;
    case 'docs_confirm':
      requiredReads = [
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'tech'),
        requiredArtifact(state, 'uiux'),
      ];
      message = '硬门禁：向用户展示 PRD、Tech 和 UIUX 摘要；确认后调用 gate --confirm docs_confirm，修改意见则更新文档并停留门禁。';
      break;
    case 'spec':
      requiredReads = [
        'agents/spec-generator.md',
        'references/spec-template.md',
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'tech'),
        requiredArtifact(state, 'uiux'),
      ];
      expectedOutput = artifactPath('spec', state.requirement_name);
      message = '读取任务拆分专家指令、模板和已确认文档，生成 tasks 后调用 advance --completed spec 并记录 artifact。';
      break;
    case 'frontend':
      requiredReads = state.mode === 'patch'
        ? []
        : [requiredArtifact(state, 'spec')];
      message = state.mode === 'patch'
        ? 'Patch 模式：AI 自行管理任务清单，不依赖 spec 文件。直接开始前端开发，完成后调用 advance --completed frontend 进入 preview_confirm。'
        : '按任务清单中前端相关任务（标记 [FE] 或前端）顺序实现，每个完成后标记 [x] 并运行前端构建验证；全部完成后调用 advance --completed frontend 进入 preview_confirm。';
      break;
    case 'preview_confirm':
      requiredReads = state.mode === 'patch'
        ? (state.artifacts?.uiux ? [state.artifacts.uiux] : [])
        : [requiredArtifact(state, 'spec'), requiredArtifact(state, 'uiux')];
      message = '硬门禁：展示前端截图/运行结果和 UIUX 设计对比，汇报完成的前端任务和变更文件；确认后调用 gate --confirm preview_confirm，修改意见则继续 frontend。';
      break;
    case 'backend':
      requiredReads = state.mode === 'patch'
        ? []
        : [requiredArtifact(state, 'spec')];
      message = state.mode === 'patch'
        ? 'Patch 模式：AI 自行管理后端任务清单。完成后调用 advance --completed backend 进入 quality。'
        : '按任务清单中后端相关任务（标记 [BE] 或后端）顺序实现，每个完成后标记 [x] 并运行后端构建验证；全部完成后调用 advance --completed backend 进入 quality。';
      break;
    case 'quality':
      requiredReads = [
        'agents/quality-reviewer.md',
        'agents/security-reviewer.md',
        'references/quality-checklist.md',
        requiredArtifact(state, 'spec'),
      ];
      expectedOutput = artifactPath('quality', state.requirement_name);
      message = '自动化质量门禁：依次执行安全审查、代码审查、构建验证、覆盖率检查；汇总为质量报告后调用 advance --completed quality --artifact quality=<path>。CRITICAL 问题须修复后重新执行 quality。';
      break;
    case 'archive':
      requiredReads = ['references/archive-template.md'];
      expectedOutput = artifactPath('archive', state.requirement_name);
      message = '调用 archive 命令生成归档并推进到 done。';
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
    expected_output: expectedOutput,
    requirement: state.requirement,
    requirement_name: state.requirement_name,
    artifacts: state.artifacts,
    quality: state.quality || { security_passed: false, code_review_passed: false, build_passed: false, coverage_passed: false },
    message,
  };
}

async function ensureProjectDirs(root) {
  await mkdir(path.join(root, 'spec-dev', 'prd'), { recursive: true });
  await mkdir(path.join(root, 'spec-dev', 'tech'), { recursive: true });
  await mkdir(path.join(root, 'spec-dev', 'uiux'), { recursive: true });
  await mkdir(path.join(root, 'spec-dev', 'spec'), { recursive: true });
  await mkdir(path.join(root, 'spec-dev', 'quality'), { recursive: true });
  await mkdir(path.join(root, 'spec-dev', 'archive'), { recursive: true });
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
  const file = statePath(root);
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw appError('STATE_NOT_FOUND', `State file not found: ${path.join('spec-dev', '.state.json')}`);
    }
    throw error;
  }

  try {
    const state = JSON.parse(raw);
    if (!state.schema_version || state.schema_version < SCHEMA_VERSION) {
      state.schema_version = SCHEMA_VERSION;
    }
    return state;
  } catch {
    throw appError('STATE_INVALID_JSON', 'State file is not valid JSON.');
  }
}

async function writeState(root, state) {
  await ensureProjectDirs(root);
  await writeFile(statePath(root), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function createState(requirement, mode = 'new') {
  const initialPhase = mode === 'new' ? 'research' : mode === 'evolve' ? 'spec' : 'frontend';

  return {
    schema_version: SCHEMA_VERSION,
    mode,
    phase: initialPhase,
    requirement,
    requirement_name: slugifyRequirement(requirement),
    created_at: new Date().toISOString(),
    phases_completed: [],
    current_gate: null,
    artifacts: {
      prd: null,
      tech: null,
      uiux: null,
      spec: null,
      quality: null,
      archive: null,
    },
    quality: {
      security_passed: false,
      code_review_passed: false,
      build_passed: false,
      coverage_passed: false,
    },
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

  // evolve mode: validate prerequisite artifacts exist
  if (mode === 'evolve') {
    const missing = [];
    const rn = state.requirement_name;
    const prereqs = [
      { kind: 'prd', file: path.join(root, `spec-dev/prd/${rn}-prd.md`) },
      { kind: 'tech', file: path.join(root, `spec-dev/tech/${rn}-tech.md`) },
      { kind: 'uiux', file: path.join(root, `spec-dev/uiux/${rn}-uiux.md`) },
    ];
    for (const { kind, file } of prereqs) {
      try {
        await access(file);
        state.artifacts[kind] = `spec-dev/${kind}/${rn}-${kind === 'spec' ? 'tasks' : kind === 'quality' ? 'quality-report' : kind === 'uiux' ? 'uiux' : kind}.md`;
      } catch (error) {
        if (error.code === 'ENOENT') {
          missing.push(kind);
        } else {
          throw error;
        }
      }
    }
    if (missing.length > 0) {
      throw appError('MISSING_PREREQUISITE_ARTIFACTS', `Evolve mode requires existing PRD, Tech, and UIUX artifacts. Missing: ${missing.join(', ')}.`, { missing });
    }
  }

  await writeState(root, state);
  return phasePayload(state);
}

async function commandNext(options) {
  const root = normalizeRoot(options);
  const state = await readState(root);
  return phasePayload(state);
}

async function commandAdvance(options) {
  const root = normalizeRoot(options);
  const completed = String(options.completed || '');
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
  if (completed === 'archive') {
    throw appError('ARCHIVE_REQUIRES_COMMAND', 'Use the archive command to generate the archive artifact.');
  }

  const artifacts = parseArtifacts(options.artifact);
  const requiredKind = artifactKindForCompletedPhase(completed);
  if (requiredKind && !artifacts[requiredKind]) {
    throw appError('ARTIFACT_REQUIRED', `Completing ${completed} requires --artifact ${requiredKind}=<path>.`, {
      phase: completed,
      kind: requiredKind,
    });
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
  await writeState(root, state);
  return phasePayload(state);
}

function artifactKindForCompletedPhase(phase) {
  if (phase === 'prd' || phase === 'tech' || phase === 'uiux' || phase === 'spec' || phase === 'quality') {
    return phase;
  }
  return null;
}

async function commandGate(options) {
  const root = normalizeRoot(options);
  const confirm = String(options.confirm || '');
  const state = await readState(root);

  // Support docs_confirm, preview_confirm, and dev_confirm (backward compat)
  if (confirm === 'dev_confirm') {
    // Backward compat: dev_confirm maps to preview_confirm behavior
    if (state.phase !== 'dev_confirm' && state.phase !== 'preview_confirm') {
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
    return phasePayload(state);
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
  return phasePayload(state);
}

async function commandArchive(options) {
  const root = normalizeRoot(options);
  const state = await readState(root);
  if (state.phase !== 'archive') {
    throw appError('PHASE_MISMATCH', `Cannot archive while current phase is ${state.phase}.`, {
      current: state.phase,
      expected: 'archive',
    });
  }

  const date = resolveArchiveDate(process.env.SPEC_DEV_DATE);
  const prdPath = requiredArtifact(state, 'prd');
  const techPath = requiredArtifact(state, 'tech');
  const specPath = requiredArtifact(state, 'spec');
  const uiuxPath = state.artifacts?.uiux || null;
  const qualityPath = state.artifacts?.quality || null;
  await assertArtifactsExist(root, [prdPath, techPath, specPath]);

  const archivePath = `spec-dev/archive/${date}-${state.requirement_name}.md`;
  const archiveFile = path.join(root, archivePath);
  await mkdir(path.dirname(archiveFile), { recursive: true });

  const taskCounts = await countTasks(path.join(root, specPath));
  const body = await renderArchiveTemplate(root, state, {
    archivePath,
    date,
    prdPath,
    techPath,
    uiuxPath,
    qualityPath,
    specPath,
    taskCounts,
  });

  await writeFile(archiveFile, body, 'utf8');
  state.artifacts.archive = archivePath;
  addCompleted(state, 'archive');
  state.phase = 'done';
  state.current_gate = null;
  await writeState(root, state);

  return {
    ...phasePayload(state),
    archive_path: archivePath,
  };
}

function resolveArchiveDate(overrideDate) {
  const date = overrideDate || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError('INVALID_ARCHIVE_DATE', 'Archive date must use YYYY-MM-DD format.', { date });
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

async function renderArchiveTemplate(root, state, archive) {
  const templatePath = path.join(SKILL_ROOT, 'references', 'archive-template.md');
  const template = await readFile(templatePath, 'utf8');
  const startedAt = String(state.created_at || '').slice(0, 10) || archive.date;
  const mode = state.mode || 'new';
  const isPatch = mode === 'patch';

  let body = template
    .replaceAll('{需求名称}', state.requirement_name)
    .replaceAll('{YYYY-MM-DD}', archive.date)
    .replaceAll('{项目名称}', path.basename(root))
    .replaceAll('{开始日期}', startedAt)
    .replaceAll('{归档日期}', archive.date)
    .replaceAll('{从 PRD 中提取 3-5 条核心功能点}', isPatch ? '（Patch 模式 — 无 PRD）' : `详见 ${archive.prdPath}`)
    .replaceAll('{从技术方案中提取核心设计决策}', isPatch ? '（Patch 模式 — 无 Tech）' : `详见 ${archive.techPath}`);

  // Build change file list
  const changeLines = [
    `| ${archive.prdPath} | ${isPatch ? 'N/A' : '新增/修改'} | PRD 产物 |`,
    `| ${archive.techPath} | ${isPatch ? 'N/A' : '新增/修改'} | 技术方案产物 |`,
  ];
  if (archive.uiuxPath && !isPatch) {
    changeLines.push(`| ${archive.uiuxPath} | 新增/修改 | UI/UX 设计产物 |`);
  }
  changeLines.push(`| ${archive.specPath} | ${isPatch ? 'N/A' : '新增/修改'} | 任务清单产物，任务完成: ${archive.taskCounts.done}/${archive.taskCounts.total} |`);
  if (archive.qualityPath) {
    changeLines.push(`| ${archive.qualityPath} | 新增 | 质量审查报告 |`);
  }
  changeLines.push(`| ${archive.archivePath} | 新增 | 本归档文件 |`);

  body = body.replaceAll(
    '| {文件路径} | 新增/修改/删除 | {简要说明} |',
    changeLines.join('\n'),
  );

  body = body.replaceAll('{记录开发过程中的重要技术决策和取舍}', isPatch
    ? '- Patch 模式：快速修复/小改动，无详细决策记录。'
    : '- 以 PRD、技术方案、UIUX 设计、任务清单和质量报告为准；详细内容见对应产物文件。');

  body = body.replaceAll(`spec-dev/prd/{requirement_name}-prd.md`, archive.prdPath);
  body = body.replaceAll(`spec-dev/tech/{requirement_name}-tech.md`, archive.techPath);
  body = body.replaceAll(`spec-dev/spec/{requirement_name}-tasks.md`, archive.specPath);

  body += `\n## 任务完成情况\n\n任务完成: ${archive.taskCounts.done}/${archive.taskCounts.total}\n`;
  body += `\n## 工作模式\n\n${mode}\n`;

  return body;
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
    case 'docs_confirm':
    case 'spec':
      return [requiredArtifact(state, 'prd'), requiredArtifact(state, 'tech'), requiredArtifact(state, 'uiux')];
    case 'frontend':
    case 'preview_confirm':
    case 'backend':
    case 'quality':
      return [requiredArtifact(state, 'spec')];
    case 'archive':
      return [requiredArtifact(state, 'prd'), requiredArtifact(state, 'tech'), requiredArtifact(state, 'spec')];
    case 'uiux':
      return [requiredArtifact(state, 'prd'), requiredArtifact(state, 'tech')];
    default:
      return [];
  }
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
    archive: commandArchive,
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
