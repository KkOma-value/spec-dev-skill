#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;
const STATE_DIR = 'spec-dev';
const STATE_FILE = '.state.json';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(SCRIPT_DIR, '..');

const PHASES = [
  'research',
  'prd',
  'tech',
  'docs_confirm',
  'spec',
  'dev',
  'dev_confirm',
  'archive',
  'done',
];

const NEXT_PHASE = {
  research: 'prd',
  prd: 'tech',
  tech: 'docs_confirm',
  docs_confirm: 'spec',
  spec: 'dev',
  dev: 'dev_confirm',
  dev_confirm: 'archive',
  archive: 'done',
};

const ARTIFACT_KINDS = new Set(['prd', 'tech', 'spec', 'archive']);

const PINYIN_MAP = {
  为: 'wei',
  訂: 'ding',
  订: 'ding',
  单: 'dan',
  單: 'dan',
  服: 'fu',
  务: 'wu',
  務: 'wu',
  新: 'xin',
  增: 'zeng',
  按: 'an',
  状: 'zhuang',
  狀: 'zhuang',
  态: 'tai',
  態: 'tai',
  分: 'fen',
  页: 'ye',
  頁: 'ye',
  查: 'cha',
  询: 'xun',
  詢: 'xun',
  接: 'jie',
  口: 'kou',
  求: 'qiu',
  需: 'xu',
  开: 'kai',
  開: 'kai',
  发: 'fa',
  發: 'fa',
  流: 'liu',
  程: 'cheng',
  用: 'yong',
  户: 'hu',
  戶: 'hu',
  管: 'guan',
  理: 'li',
  业: 'ye',
  業: 'ye',
  后: 'hou',
  後: 'hou',
  台: 'tai',
  微: 'wei',
  订单: 'ding-dan',
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
    case 'spec':
      return `spec-dev/spec/${requirementName}-tasks.md`;
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
  const currentGate = state.current_gate || (phase === 'docs_confirm' || phase === 'dev_confirm' ? phase : null);
  let requiredReads = [];
  let expectedOutput = null;
  let message = '';

  switch (phase) {
    case 'research':
      requiredReads = ['agents/researcher.md'];
      message = '读取 researcher 指令，只执行本地代码分析和必要联网调研；调研结论沉淀到后续 PRD/Tech。';
      break;
    case 'prd':
      requiredReads = ['agents/prd-writer.md', 'references/prd-template.md'];
      expectedOutput = artifactPath('prd', state.requirement_name);
      message = '读取 PRD 专家指令和模板，生成 PRD 后调用 advance --completed prd 并记录 artifact。';
      break;
    case 'tech':
      requiredReads = ['agents/tech-writer.md', 'references/tech-template.md'];
      expectedOutput = artifactPath('tech', state.requirement_name);
      message = '读取技术方案专家指令和模板，生成 Tech 后调用 advance --completed tech 并进入 docs_confirm 门禁。';
      break;
    case 'docs_confirm':
      requiredReads = [requiredArtifact(state, 'prd'), requiredArtifact(state, 'tech')];
      message = '硬门禁：向用户展示 PRD 和 Tech 摘要；确认后调用 gate --confirm docs_confirm，修改意见则更新文档并停留门禁。';
      break;
    case 'spec':
      requiredReads = [
        'agents/spec-generator.md',
        'references/spec-template.md',
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'tech'),
      ];
      expectedOutput = artifactPath('spec', state.requirement_name);
      message = '读取任务拆分专家指令、模板和已确认文档，生成 tasks 后调用 advance --completed spec 并记录 artifact。';
      break;
    case 'dev':
      requiredReads = [requiredArtifact(state, 'spec')];
      message = '按任务清单顺序实现每个 [] 任务，完成后标记 [x] 并运行构建验证；全部完成后调用 advance --completed dev。';
      break;
    case 'dev_confirm':
      requiredReads = [requiredArtifact(state, 'spec')];
      message = '硬门禁：汇报完成任务、变更文件和构建结果；确认后调用 gate --confirm dev_confirm，修改意见则继续 dev。';
      break;
    case 'archive':
      requiredReads = ['references/archive-template.md'];
      expectedOutput = artifactPath('archive', state.requirement_name);
      message = '调用 archive 命令生成归档并推进到 done。';
      break;
    case 'done':
      message = 'Spec-Dev 流程已完成，无需加载额外阶段指令。';
      break;
    default:
      throw appError('UNKNOWN_PHASE', `Unknown phase: ${phase}`, { phase });
  }

  return {
    schema_version: SCHEMA_VERSION,
    phase,
    current_gate: currentGate,
    required_reads: requiredReads,
    expected_output: expectedOutput,
    requirement: state.requirement,
    requirement_name: state.requirement_name,
    artifacts: state.artifacts,
    message,
  };
}

async function ensureProjectDirs(root) {
  await mkdir(path.join(root, 'spec-dev', 'prd'), { recursive: true });
  await mkdir(path.join(root, 'spec-dev', 'tech'), { recursive: true });
  await mkdir(path.join(root, 'spec-dev', 'spec'), { recursive: true });
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
    if (!state.schema_version) {
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

function createState(requirement) {
  return {
    schema_version: SCHEMA_VERSION,
    phase: 'research',
    requirement,
    requirement_name: slugifyRequirement(requirement),
    created_at: new Date().toISOString(),
    phases_completed: [],
    current_gate: null,
    artifacts: {
      prd: null,
      tech: null,
      spec: null,
      archive: null,
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

  const state = createState(requirement);
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

  state.current_gate = state.phase === 'docs_confirm' || state.phase === 'dev_confirm' ? state.phase : null;
  await writeState(root, state);
  return phasePayload(state);
}

function artifactKindForCompletedPhase(phase) {
  if (phase === 'prd' || phase === 'tech' || phase === 'spec') {
    return phase;
  }
  return null;
}

async function commandGate(options) {
  const root = normalizeRoot(options);
  const confirm = String(options.confirm || '');
  const state = await readState(root);

  if (confirm !== 'docs_confirm' && confirm !== 'dev_confirm') {
    throw appError('INVALID_GATE', `Unknown gate: ${confirm}`, { confirm });
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
  return template
    .replaceAll('{需求名称}', state.requirement_name)
    .replaceAll('{YYYY-MM-DD}', archive.date)
    .replaceAll('{项目名称}', path.basename(root))
    .replaceAll('{开始日期}', startedAt)
    .replaceAll('{归档日期}', archive.date)
    .replaceAll('{从 PRD 中提取 3-5 条核心功能点}', `详见 ${archive.prdPath}`)
    .replaceAll('{从技术方案中提取核心设计决策}', `详见 ${archive.techPath}`)
    .replaceAll(
      '| {文件路径} | 新增/修改/删除 | {简要说明} |',
      [
        `| ${archive.prdPath} | 新增/修改 | PRD 产物 |`,
        `| ${archive.techPath} | 新增/修改 | 技术方案产物 |`,
        `| ${archive.specPath} | 新增/修改 | 任务清单产物，任务完成: ${archive.taskCounts.done}/${archive.taskCounts.total} |`,
        `| ${archive.archivePath} | 新增 | 本归档文件 |`,
      ].join('\n'),
    )
    .replaceAll('{记录开发过程中的重要技术决策和取舍}', '- 以 PRD、技术方案和任务清单为准；详细内容见对应产物文件。')
    .replaceAll(`spec-dev/prd/{requirement_name}-prd.md`, archive.prdPath)
    .replaceAll(`spec-dev/tech/{requirement_name}-tech.md`, archive.techPath)
    .replaceAll(`spec-dev/spec/{requirement_name}-tasks.md`, archive.specPath)
    .concat(`\n## 任务完成情况\n\n任务完成: ${archive.taskCounts.done}/${archive.taskCounts.total}\n`);
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
    return { valid: true, phase: state.phase, current_gate: state.current_gate || null };
  }

  await assertArtifactsExist(root, artifactsRequiredForPhase(state));

  return { valid: true, phase: state.phase, current_gate: state.current_gate || null };
}

function artifactsRequiredForPhase(state) {
  switch (state.phase) {
    case 'docs_confirm':
    case 'spec':
      return [requiredArtifact(state, 'prd'), requiredArtifact(state, 'tech')];
    case 'dev':
    case 'dev_confirm':
      return [requiredArtifact(state, 'spec')];
    case 'archive':
      return [requiredArtifact(state, 'prd'), requiredArtifact(state, 'tech'), requiredArtifact(state, 'spec')];
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
