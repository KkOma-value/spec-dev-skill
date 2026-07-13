#!/usr/bin/env node
import { access, lstat, mkdir, readdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
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
const VALIDATION_PLAN_FILE = 'VALIDATION_PLAN.json';
const VERIFICATION_FILE = 'verification.json';
const VALIDATION_PLAN_SCHEMA_VERSION = 1;
const VERIFICATION_SCHEMA_VERSION = 1;
const FAST_VERIFICATION_POLICY = 'fast-v1';
const LEGACY_VERIFICATION_POLICY = 'legacy';
const VALIDATION_SCOPES = ['frontend', 'backend'];
const REQUIRED_VALIDATION_KINDS = ['build', 'test'];
const FINGERPRINT_IGNORES = new Set([
  '.git', '.spec-dev', 'output', 'node_modules', 'dist', 'build', 'coverage',
  '.cache', '.next', '.nuxt', '.turbo', 'target', '__pycache__',
]);
const GIT_FINGERPRINT_EXCLUDES = [...FINGERPRINT_IGNORES]
  .filter((name) => name !== '.git')
  .map((name) => `:(exclude,glob)**/${name}/**`);
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

function validationPlanPath(root) {
  return path.join(root, STATE_DIR, VALIDATION_PLAN_FILE);
}

function verificationPath(root) {
  return path.join(root, STATE_DIR, VERIFICATION_FILE);
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

async function securityReferenceReads(root) {
  const reads = ['references/security/generic.md'];
  const manifests = new Set();
  async function scan(relative = '.', depth = 0) {
    if (depth > 4) {
      return;
    }
    let entries;
    try {
      entries = await readdir(path.join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isFile()) {
        manifests.add(entry.name);
      } else if (entry.isDirectory() && !entry.isSymbolicLink() && !FINGERPRINT_IGNORES.has(entry.name)) {
        const child = path.join(relative, entry.name);
        try {
          await access(path.join(root, child, '.git'));
          continue;
        } catch {
          // Not a nested repository.
        }
        await scan(child, depth + 1);
      }
    }
  }
  await scan();
  const candidates = [
    { ref: 'references/security/node.md', files: ['package.json'] },
    { ref: 'references/security/java.md', files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
    { ref: 'references/security/python.md', files: ['pyproject.toml', 'requirements.txt', 'poetry.lock', 'uv.lock'] },
    { ref: 'references/security/go.md', files: ['go.mod'] },
    { ref: 'references/security/rust.md', files: ['Cargo.toml'] },
  ];
  for (const candidate of candidates) {
    if (candidate.files.some((file) => manifests.has(file))) {
      reads.push(candidate.ref);
    }
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
        'references/validation-plan.md',
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
        requiredArtifact(state, 'tasks'),
      ];
      if (isFastVerification(state)) {
        expectedOutputs = [`${STATE_DIR}/${VALIDATION_PLAN_FILE}`];
      }
      message = '编码前门禁：完成 PRE_CODE_CHECKLIST.md；极速策略需声明 VALIDATION_PLAN.json，任务必须标注 FE/BE/SHARED。完成后调用 advance --completed pre_code。';
      break;
    case 'frontend':
      requiredReads = [
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'uiux'),
        `${STATE_DIR}/${PRE_CODE_CHECKLIST_FILE}`,
        ...(isFastVerification(state) ? [`${STATE_DIR}/${VALIDATION_PLAN_FILE}`] : []),
      ];
      message = '按前端功能切片实现；每项只跑定向测试/局部 lint 或 typecheck，禁止逐任务全量构建。全部完成后调用 verify --scope frontend --level full，一次通过后再 advance frontend。';
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
        ...(isFastVerification(state) ? [`${STATE_DIR}/${VALIDATION_PLAN_FILE}`] : []),
      ];
      message = '按后端功能切片实现；每项只跑定向测试/局部 lint 或 typecheck，禁止逐任务全量构建。全部完成后调用 verify --scope backend --level full，一次通过后再 advance backend。';
      break;
    case 'quality':
      requiredReads = [
        'agents/quality-reviewer.md',
        'agents/security-reviewer.md',
        'references/quality-checklist.md',
        ...(await securityReferenceReads(root)),
        requiredArtifact(state, 'tasks'),
        requiredArtifact(state, 'prd'),
        requiredArtifact(state, 'architecture'),
        requiredArtifact(state, 'uiux'),
        ...(isFastVerification(state) ? [
          `${STATE_DIR}/${VALIDATION_PLAN_FILE}`,
          `${STATE_DIR}/${VERIFICATION_FILE}`,
        ] : []),
      ];
      expectedOutputs = [artifactPath('quality', state.requirement_name)];
      message = '质量门禁：先查 verify-status，复用指纹一致证据，仅重跑 stale/missing 项；执行差量安全/代码/UI 审查。报告 frontmatter 必须为 PASSED 且 critical/high 均为 0。';
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
    verification_policy: state.verification_policy,
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
  let droppedSignificant = false;
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

    // A letter/number that is neither ASCII nor pinyin-mapped is lost from the
    // slug (e.g. unmapped CJK). Separators/punctuation are expected and ignored.
    if (/[\p{Letter}\p{Number}]/u.test(char)) {
      droppedSignificant = true;
    }
    tokens.push('-');
  }

  const slug = tokens
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  // When meaningful characters were dropped, distinct requirements can collapse
  // to the same slug (worst case the bare "requirement" fallback) and silently
  // overwrite each other's artifacts. Append a short content hash to keep them
  // distinct. Slugs built entirely from mapped/ASCII content are left untouched.
  if (droppedSignificant) {
    const hash = createHash('sha256').update(requirement).digest('hex').slice(0, 8);
    return slug ? `${slug}-${hash}` : `requirement-${hash}`;
  }

  return slug || 'requirement';
}

async function readState(root) {
  try {
    const parsed = JSON.parse(await readFile(statePath(root), 'utf8'));
    assertSchemaCompatible(parsed);
    return normalizeState(parsed);
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

function assertSchemaCompatible(state) {
  const version = Number(state?.schema_version);
  if (Number.isFinite(version) && version > SCHEMA_VERSION) {
    throw appError('STATE_SCHEMA_TOO_NEW', `State schema version ${version} is newer than supported version ${SCHEMA_VERSION}. Upgrade spec-dev.`, {
      found: version,
      supported: SCHEMA_VERSION,
    });
  }
}

function normalizeState(state) {
  const sourceSchemaVersion = Number(state?.schema_version || 0);
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

  const normalized = {
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
    verification_policy: state.verification_policy
      || (sourceSchemaVersion >= 3 ? FAST_VERIFICATION_POLICY : LEGACY_VERIFICATION_POLICY),
  };

  // Preserve migration audit trail so it survives the writeState round-trip.
  if (state.migrated_from) {
    normalized.migrated_from = state.migrated_from;
  }
  if (state.migrated_at) {
    normalized.migrated_at = state.migrated_at;
  }

  return normalized;
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
    verification_policy: FAST_VERIFICATION_POLICY,
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

function isFastVerification(state) {
  return state.verification_policy === FAST_VERIFICATION_POLICY;
}

function safeProjectPath(root, value, label) {
  const raw = String(value || '').trim();
  if (!raw || path.isAbsolute(raw)) {
    throw appError('VALIDATION_PLAN_INVALID', `${label} must be a non-empty project-relative path.`, { label, value });
  }
  const resolved = path.resolve(root, raw);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw appError('VALIDATION_PLAN_INVALID', `${label} escapes the project root.`, { label, value });
  }
  const relative = path.relative(root, resolved);
  const firstSegment = relative.split(path.sep)[0];
  if (FINGERPRINT_IGNORES.has(firstSegment)) {
    throw appError('VALIDATION_PLAN_INVALID', `${label} points to an excluded workflow or generated directory.`, { label, value });
  }
  return relative || '.';
}

async function readTaskScopes(root, state) {
  const taskPath = requiredArtifact(state, 'tasks');
  const raw = await readFile(path.join(root, taskPath), 'utf8');
  const taskLine = /^\s*(?:[-*]\s*)?\[(?:[ xX])?\]\s+\d+\.\s+\[(FE|BE|SHARED)\](?:\s|$)/;
  const allTaskLine = /^\s*(?:[-*]\s*)?\[(?:[ xX])?\]\s+\d+\./;
  const tasks = [];
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (allTaskLine.test(line)) {
      const match = line.match(taskLine);
      current = { tag: match?.[1] || null, targeted: null };
      tasks.push(current);
      continue;
    }
    const targeted = line.match(/^\s*-\s*定向验证:\s*(.+?)\s*$/);
    if (current && targeted) {
      current.targeted = targeted[1];
    }
  }
  const tagged = tasks.filter((task) => task.tag);
  if (tasks.length === 0 || tagged.length !== tasks.length) {
    throw appError('TASK_SCOPE_MISSING', 'Every task must be tagged [FE], [BE], or [SHARED] before fast verification can be configured.', {
      total_tasks: tasks.length,
      tagged_tasks: tagged.length,
    });
  }
  const missingTargeted = tasks
    .map((task, index) => ({ task, number: index + 1 }))
    .filter(({ task }) => !task.targeted)
    .map(({ number }) => number);
  if (missingTargeted.length > 0) {
    throw appError('TASK_TARGETED_VERIFICATION_MISSING', 'Every task must define a non-empty 定向验证 command.', { tasks: missingTargeted });
  }
  const fullBuildPattern = /\b(npm\s+run\s+build|pnpm\s+(?:run\s+)?build|yarn\s+build|mvn\s+[^\n]*(?:compile|package|verify)|gradle\w*\s+build|go\s+build\s+\.\/\.\.\.|cargo\s+build)/i;
  const fullBuildTasks = tasks
    .map((task, index) => ({ task, number: index + 1 }))
    .filter(({ task }) => fullBuildPattern.test(task.targeted))
    .map(({ number }) => number);
  if (fullBuildTasks.length > 0) {
    throw appError('TASK_TARGETED_VERIFICATION_TOO_BROAD', 'Targeted task checks must not run a full build.', { tasks: fullBuildTasks });
  }
  const tags = tasks.map((task) => task.tag);
  return {
    frontend: tags.includes('FE') || tags.includes('SHARED'),
    backend: tags.includes('BE') || tags.includes('SHARED'),
  };
}

async function readValidationPlan(root, state) {
  let plan;
  try {
    plan = JSON.parse(await readFile(validationPlanPath(root), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw appError('VALIDATION_PLAN_MISSING', `${path.join(STATE_DIR, VALIDATION_PLAN_FILE)} does not exist.`);
    }
    if (error instanceof SyntaxError) {
      throw appError('VALIDATION_PLAN_INVALID_JSON', `${path.join(STATE_DIR, VALIDATION_PLAN_FILE)} is not valid JSON.`);
    }
    throw error;
  }
  return validateValidationPlan(root, state, plan);
}

async function validateValidationPlan(root, state, plan) {
  if (!plan || Number(plan.schema_version) !== VALIDATION_PLAN_SCHEMA_VERSION || typeof plan.scopes !== 'object') {
    throw appError('VALIDATION_PLAN_INVALID', `Validation plan must use schema_version ${VALIDATION_PLAN_SCHEMA_VERSION} and define scopes.`);
  }
  const unknownScopes = Object.keys(plan.scopes).filter((scope) => !VALIDATION_SCOPES.includes(scope));
  if (unknownScopes.length > 0) {
    throw appError('VALIDATION_PLAN_INVALID', 'Validation plan contains unknown scopes.', { unknown_scopes: unknownScopes });
  }

  const taskScopes = await readTaskScopes(root, state);
  const normalizedScopes = {};
  for (const scope of VALIDATION_SCOPES) {
    const config = plan.scopes[scope];
    if (!config || typeof config.applicable !== 'boolean') {
      throw appError('VALIDATION_PLAN_INVALID', `Scope ${scope} must define boolean applicable.`, { scope });
    }
    if (config.applicable !== taskScopes[scope]) {
      throw appError('VALIDATION_PLAN_SCOPE_MISMATCH', `Scope ${scope} applicability does not match tagged tasks.`, {
        scope,
        expected: taskScopes[scope],
        found: config.applicable,
      });
    }
    if (!config.applicable) {
      normalizedScopes[scope] = { applicable: false, inputs: [], required_kinds: [], checks: [] };
      continue;
    }
    if (!Array.isArray(config.inputs) || config.inputs.length === 0) {
      throw appError('VALIDATION_PLAN_INVALID', `Scope ${scope} must define at least one input path.`, { scope });
    }
    const inputs = [...new Set(config.inputs.map((item, index) => safeProjectPath(root, item, `${scope}.inputs[${index}]`)))];
    const requiredKinds = Array.isArray(config.required_kinds)
      ? [...new Set(config.required_kinds.map((item) => String(item).trim()).filter(Boolean))]
      : [];
    for (const requiredKind of REQUIRED_VALIDATION_KINDS) {
      if (!requiredKinds.includes(requiredKind)) {
        throw appError('VALIDATION_PLAN_INVALID', `Scope ${scope} must require ${requiredKind}.`, { scope, required_kind: requiredKind });
      }
    }
    if (!Array.isArray(config.checks) || config.checks.length === 0) {
      throw appError('VALIDATION_PLAN_INVALID', `Scope ${scope} must define checks.`, { scope });
    }
    const ids = new Set();
    const checks = config.checks.map((check, index) => {
      const id = String(check?.id || '').trim();
      const kind = String(check?.kind || '').trim();
      if (!id || ids.has(id) || !kind) {
        throw appError('VALIDATION_PLAN_INVALID', `Scope ${scope} check ${index} needs a unique id and kind.`, { scope, index });
      }
      ids.add(id);
      if (!Array.isArray(check.argv) || check.argv.length === 0 || check.argv.some((arg) => typeof arg !== 'string' || arg.length === 0)) {
        throw appError('VALIDATION_PLAN_INVALID', `Check ${id} must define a non-empty argv string array.`, { scope, check: id });
      }
      const satisfies = [...new Set([kind, ...(Array.isArray(check.satisfies) ? check.satisfies : [])]
        .map((item) => String(item).trim()).filter(Boolean))];
      return {
        id,
        kind,
        satisfies,
        cwd: safeProjectPath(root, check.cwd || '.', `${scope}.checks[${index}].cwd`),
        argv: [...check.argv],
      };
    });
    const satisfiedKinds = new Set(checks.flatMap((check) => check.satisfies));
    const unsatisfiedKinds = requiredKinds.filter((kind) => !satisfiedKinds.has(kind));
    if (unsatisfiedKinds.length > 0) {
      throw appError('VALIDATION_PLAN_INVALID', `Scope ${scope} has required kinds without a satisfying check.`, {
        scope,
        missing_kinds: unsatisfiedKinds,
      });
    }
    normalizedScopes[scope] = {
      applicable: true,
      inputs,
      required_kinds: requiredKinds,
      checks,
    };
  }
  return { schema_version: VALIDATION_PLAN_SCHEMA_VERSION, scopes: normalizedScopes };
}

function emptyVerificationLedger() {
  return { schema_version: VERIFICATION_SCHEMA_VERSION, entries: [] };
}

async function initializeVerificationLedger(root) {
  await writeFile(verificationPath(root), `${JSON.stringify(emptyVerificationLedger(), null, 2)}\n`, 'utf8');
}

async function readVerificationLedger(root) {
  try {
    const ledger = JSON.parse(await readFile(verificationPath(root), 'utf8'));
    if (Number(ledger.schema_version) !== VERIFICATION_SCHEMA_VERSION || !Array.isArray(ledger.entries)) {
      throw appError('VERIFICATION_LEDGER_INVALID', `${path.join(STATE_DIR, VERIFICATION_FILE)} has an unsupported schema.`);
    }
    return ledger;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return emptyVerificationLedger();
    }
    if (error instanceof SyntaxError) {
      throw appError('VERIFICATION_LEDGER_INVALID', `${path.join(STATE_DIR, VERIFICATION_FILE)} is not valid JSON.`);
    }
    throw error;
  }
}

async function writeVerificationLedger(root, ledger) {
  ledger.entries = ledger.entries.slice(-200);
  await writeFile(verificationPath(root), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

function gitCapture(root, args) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

async function hashFileOrLink(hash, root, relative) {
  const absolute = path.join(root, relative);
  try {
    const stat = await lstat(absolute);
    hash.update(`path:${relative}\0mode:${stat.mode}\0`);
    if (stat.isSymbolicLink()) {
      hash.update(`link:${await readlink(absolute)}\0`);
    } else if (stat.isFile()) {
      hash.update(await readFile(absolute));
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      hash.update(`missing:${relative}\0`);
      return;
    }
    throw error;
  }
}

async function collectFallbackFiles(root, relative, files) {
  const absolute = path.join(root, relative);
  let stat;
  try {
    stat = await lstat(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') {
      files.add(relative);
      return;
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    files.add(relative);
    return;
  }
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    if (FINGERPRINT_IGNORES.has(entry.name)) {
      continue;
    }
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      await collectFallbackFiles(root, child, files);
    } else {
      files.add(child);
    }
  }
}

async function computeScopeFingerprint(root, scopeConfig) {
  const hash = createHash('sha256');
  hash.update(`validation-plan:${JSON.stringify(scopeConfig)}\0`);
  const gitProbe = gitCapture(root, ['rev-parse', '--is-inside-work-tree']);
  if (gitProbe.status === 0) {
    const pathspec = ['--', ...scopeConfig.inputs, ...GIT_FINGERPRINT_EXCLUDES];
    const index = gitCapture(root, ['ls-files', '-s', '-z', ...pathspec]);
    const worktree = gitCapture(root, ['diff', '--binary', '--no-ext-diff', ...pathspec]);
    const untracked = gitCapture(root, ['ls-files', '--others', '--exclude-standard', '-z', ...pathspec]);
    if (index.status === 0 && worktree.status === 0 && untracked.status === 0) {
      hash.update('git-index\0').update(index.stdout);
      hash.update('git-worktree\0').update(worktree.stdout);
      const untrackedPaths = untracked.stdout.toString('utf8').split('\0').filter(Boolean).sort();
      for (const relative of untrackedPaths) {
        await hashFileOrLink(hash, root, relative);
      }
      for (const relative of scopeConfig.inputs) {
        try {
          await access(path.join(root, relative));
        } catch {
          hash.update(`input-missing:${relative}\0`);
        }
      }
      return hash.digest('hex');
    }
  }

  hash.update('filesystem-fallback\0');
  const files = new Set();
  for (const relative of scopeConfig.inputs) {
    await collectFallbackFiles(root, relative, files);
  }
  for (const relative of [...files].sort()) {
    await hashFileOrLink(hash, root, relative);
  }
  return hash.digest('hex');
}

function checkEvidenceForFingerprint(ledger, scope, checkId, fingerprint) {
  return [...ledger.entries]
    .reverse()
    .find((entry) => entry.scope === scope && entry.check_id === checkId && entry.fingerprint === fingerprint);
}

async function verificationStatusForScope(root, plan, ledger, scope) {
  const config = plan.scopes[scope];
  if (!config.applicable) {
    return { scope, status: 'not_applicable', required_kinds: [], satisfied_kinds: [] };
  }
  const fingerprint = await computeScopeFingerprint(root, config);
  const currentEntries = config.checks
    .map((check) => checkEvidenceForFingerprint(ledger, scope, check.id, fingerprint))
    .filter(Boolean);
  const currentFailures = currentEntries.filter((entry) => entry.exit_code !== 0);
  const satisfiedKinds = [...new Set(currentEntries
    .filter((entry) => entry.exit_code === 0)
    .flatMap((entry) => entry.satisfies || [entry.kind]))];
  const missingKinds = config.required_kinds.filter((kind) => !satisfiedKinds.includes(kind));
  const priorEntries = ledger.entries.filter((entry) => entry.scope === scope);
  let status = 'fresh';
  if (currentFailures.length > 0) {
    status = 'failed';
  } else if (missingKinds.length > 0) {
    status = currentEntries.length === 0 && priorEntries.length > 0 ? 'stale' : 'missing';
  }
  return {
    scope,
    status,
    fingerprint,
    required_kinds: config.required_kinds,
    satisfied_kinds: satisfiedKinds,
    missing_kinds: missingKinds,
    failed_checks: currentFailures.map((entry) => entry.check_id),
  };
}

async function executeValidationCheck(root, scope, config, check, fingerprint) {
  const cwd = path.resolve(root, check.cwd);
  let realRoot;
  let realCwd;
  try {
    [realRoot, realCwd] = await Promise.all([realpath(root), realpath(cwd)]);
  } catch {
    throw appError('VALIDATION_CWD_MISSING', `Validation cwd does not exist: ${check.cwd}`, { scope, check: check.id });
  }
  if (realCwd !== realRoot && !realCwd.startsWith(`${realRoot}${path.sep}`)) {
    throw appError('VALIDATION_CWD_INVALID', `Validation cwd resolves outside project root: ${check.cwd}`, { scope, check: check.id });
  }

  const startedAt = new Date();
  const outputHash = createHash('sha256');
  const exitCode = await new Promise((resolve) => {
    let settled = false;
    const child = spawn(check.argv[0], check.argv.slice(1), {
      cwd: realCwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const consume = (chunk) => {
      outputHash.update(chunk);
      process.stderr.write(chunk);
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        outputHash.update(String(error.message));
        process.stderr.write(`${error.message}\n`);
        resolve(127);
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        resolve(Number.isInteger(code) ? code : 1);
      }
    });
  });
  const finishedAt = new Date();
  return {
    id: `${scope}-${check.id}-${finishedAt.getTime()}`,
    scope,
    level: 'full',
    check_id: check.id,
    kind: check.kind,
    satisfies: check.satisfies,
    cwd: check.cwd,
    argv: redactArgv(check.argv),
    fingerprint,
    exit_code: exitCode,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    output_sha256: outputHash.digest('hex'),
  };
}

function redactArgv(argv) {
  const sensitive = /(password|passwd|secret|token|api[-_]?key|authorization|credential)/i;
  const redacted = [];
  let redactNext = false;
  for (const arg of argv) {
    if (redactNext) {
      redacted.push('<redacted>');
      redactNext = false;
      continue;
    }
    if (/^--?[^=]+$/.test(arg) && sensitive.test(arg)) {
      redacted.push(arg);
      redactNext = true;
      continue;
    }
    if (arg.includes('=') && sensitive.test(arg.slice(0, arg.indexOf('=')))) {
      redacted.push(`${arg.slice(0, arg.indexOf('=') + 1)}<redacted>`);
      continue;
    }
    redacted.push(arg.replace(/(https?:\/\/)[^/@\s]+@/gi, '$1<redacted>@'));
  }
  return redacted;
}

async function commandVerify(options) {
  const root = normalizeRoot(options);
  const state = await readState(root);
  const scope = String(options.scope || '');
  const level = String(options.level || 'full');
  if (!VALIDATION_SCOPES.includes(scope)) {
    throw appError('INVALID_VERIFICATION_SCOPE', `Unknown verification scope: ${scope || '(missing)'}.`, { scope });
  }
  if (level !== 'full') {
    throw appError('INVALID_VERIFICATION_LEVEL', 'Only full phase-end verification is recorded by the executor.', { level });
  }
  const plan = await readValidationPlan(root, state);
  const config = plan.scopes[scope];
  if (!config.applicable) {
    return { scope, level, status: 'not_applicable', executed_checks: [], reused_checks: [] };
  }
  const ledger = await readVerificationLedger(root);
  const fingerprint = await computeScopeFingerprint(root, config);
  const executedChecks = [];
  const reusedChecks = [];
  for (const check of config.checks) {
    const existing = checkEvidenceForFingerprint(ledger, scope, check.id, fingerprint);
    if (existing?.exit_code === 0) {
      reusedChecks.push(check.id);
      continue;
    }
    const entry = await executeValidationCheck(root, scope, config, check, fingerprint);
    ledger.entries.push(entry);
    await writeVerificationLedger(root, ledger);
    executedChecks.push(check.id);
    if (entry.exit_code !== 0) {
      throw appError('VERIFICATION_FAILED', `Validation check failed: ${check.id}`, {
        scope,
        level,
        fingerprint,
        failed_check: check.id,
        exit_code: entry.exit_code,
        executed_checks: executedChecks,
        reused_checks: reusedChecks,
      });
    }
  }
  const status = await verificationStatusForScope(root, plan, ledger, scope);
  return { ...status, level, executed_checks: executedChecks, reused_checks: reusedChecks };
}

async function commandVerifyStatus(options) {
  const root = normalizeRoot(options);
  const state = await readState(root);
  const requestedScope = options.scope === undefined ? null : String(options.scope);
  if (requestedScope && !VALIDATION_SCOPES.includes(requestedScope)) {
    throw appError('INVALID_VERIFICATION_SCOPE', `Unknown verification scope: ${requestedScope}.`, { scope: requestedScope });
  }
  const plan = await readValidationPlan(root, state);
  const ledger = await readVerificationLedger(root);
  const scopes = requestedScope ? [requestedScope] : VALIDATION_SCOPES;
  const statuses = {};
  for (const scope of scopes) {
    statuses[scope] = await verificationStatusForScope(root, plan, ledger, scope);
  }
  return { verification_policy: state.verification_policy, scopes: statuses };
}

async function assertVerificationFresh(root, state, scopes) {
  if (!isFastVerification(state)) {
    return;
  }
  const plan = await readValidationPlan(root, state);
  const ledger = await readVerificationLedger(root);
  const failures = [];
  for (const scope of scopes) {
    const status = await verificationStatusForScope(root, plan, ledger, scope);
    if (status.status !== 'fresh' && status.status !== 'not_applicable') {
      failures.push(status);
    }
  }
  if (failures.length > 0) {
    throw appError('VERIFICATION_REQUIRED', 'Phase requires fresh passing full verification. Run verify for each reported scope.', { scopes: failures });
  }
}

async function assertQualityReportPasses(root, qualityArtifact) {
  let raw;
  try {
    raw = await readFile(path.join(root, qualityArtifact), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw appError('ARTIFACT_NOT_FOUND', 'Quality report artifact is missing.', { missing: [qualityArtifact] });
    }
    throw error;
  }
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw appError('QUALITY_REPORT_METADATA_MISSING', 'Quality report must begin with machine-readable frontmatter.');
  }
  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  const critical = Number(metadata.critical);
  const high = Number(metadata.high);
  if (metadata.status !== 'PASSED' || !Number.isInteger(critical) || !Number.isInteger(high)) {
    throw appError('QUALITY_REPORT_METADATA_INVALID', 'Quality report frontmatter requires status: PASSED plus integer critical/high counts.');
  }
  if (critical !== 0 || high !== 0) {
    throw appError('QUALITY_GATE_FAILED', 'CRITICAL and HIGH findings block delivery.', { critical, high });
  }
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
  await initializeVerificationLedger(root);
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
  if (completed === 'docs_confirm' || completed === 'preview_confirm') {
    throw appError('USE_GATE_COMMAND', `Phase ${completed} is a hard gate; use "gate --confirm ${completed}" instead of advance.`, {
      phase: completed,
    });
  }

  const artifacts = parseArtifacts(options.artifact);

  if (completed === 'pre_code') {
    await assertPreCodeChecklistComplete(root);
    if (isFastVerification(state)) {
      await readValidationPlan(root, state);
    }
  }
  if (completed === 'frontend') {
    await assertVerificationFresh(root, state, ['frontend']);
  }
  if (completed === 'backend') {
    await assertVerificationFresh(root, state, ['backend']);
  }

  for (const requiredKind of artifactKindsForCompletedPhase(completed)) {
    if (!artifacts[requiredKind]) {
      throw appError('ARTIFACT_REQUIRED', `Completing ${completed} requires --artifact ${requiredKind}=<path>.`, {
        phase: completed,
        kind: requiredKind,
      });
    }
  }

  if (completed === 'quality' && isFastVerification(state)) {
    await assertVerificationFresh(root, state, VALIDATION_SCOPES);
    await assertQualityReportPasses(root, artifacts.quality);
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
  // `dev_confirm` is a legacy alias for the `preview_confirm` gate.
  const confirm = normalizeGate(String(options.confirm || '')) || String(options.confirm || '');
  const state = await readState(root);

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
  if (isFastVerification(state)) {
    await assertVerificationFresh(root, state, VALIDATION_SCOPES);
    await assertQualityReportPasses(root, requiredArtifact(state, 'quality'));
  }
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
    `- [ ] Create \`${path.join(STATE_DIR, VALIDATION_PLAN_FILE)}\` with frontend/backend applicability, inputs, required kinds, and argv checks`,
    '',
    '## Spec Alignment',
    '',
    `- [ ] Read \`${state.artifacts.tasks}\` for the current task list`,
    '- [ ] Confirm every task title is tagged [FE], [BE], or [SHARED]',
    '- [ ] Confirm each task defines a targeted verification command; full checks run only at phase end',
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

  // Accept the bare `[] 1.` form plus conventional markdown list tasks
  // (`- [ ] 1.`, `* [x] 1.`) and indented sub-tasks.
  const taskLine = /^\s*(?:[-*]\s*)?\[(?:[ xX])?\]\s+\d+\./;
  const doneLine = /^\s*(?:[-*]\s*)?\[[xX]\]\s+\d+\./;
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
      // Spread details first so a stray detail key (e.g. `code`/`message`)
      // can never shadow the canonical fields below.
      ...error.details,
      code,
      message: error.message,
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
    verify: commandVerify,
    'verify-status': commandVerifyStatus,
  };

  if (!commands[command]) {
    throw appError('UNKNOWN_COMMAND', `Unknown command: ${command || '(missing)'}`, {
      commands: Object.keys(commands),
    });
  }

  ok(await commands[command](options));
}

main().catch(fail);
