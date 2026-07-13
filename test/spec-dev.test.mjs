import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'scripts', 'spec-dev.mjs');

async function withTempProject(fn) {
  const root = await mkProjectRoot();
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function mkProjectRoot() {
  const dir = path.join(tmpdir(), `spec-dev-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });

  let json = null;
  if (result.stdout.trim()) {
    json = JSON.parse(result.stdout);
  }

  return { ...result, json };
}

async function readState(root) {
  return JSON.parse(await readFile(path.join(root, '.spec-dev', 'state.json'), 'utf8'));
}

async function writeState(root, state) {
  await mkdir(path.join(root, '.spec-dev'), { recursive: true });
  await writeFile(path.join(root, '.spec-dev', 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function baseState(overrides = {}) {
  return {
    schema_version: 3,
    mode: 'new',
    phase: 'research',
    requirement: 'Add status query API',
    requirement_name: 'add-status-query-api',
    created_at: '2026-05-25T00:00:00.000Z',
    phases_completed: [],
    current_gate: null,
    artifacts: {
      research: 'output/add-status-query-api-research.md',
      prd: 'output/add-status-query-api-prd.md',
      architecture: 'output/add-status-query-api-architecture.md',
      uiux: 'output/add-status-query-api-uiux.md',
      proposal: '.spec-dev/changes/add-status-query-api/proposal.md',
      tasks: '.spec-dev/changes/add-status-query-api/tasks.md',
      quality: 'output/add-status-query-api-quality-report.md',
      delivery: null,
    },
    quality: {
      security_passed: false,
      code_review_passed: false,
      build_passed: false,
      coverage_passed: false,
    },
    verification_policy: 'legacy',
    ...overrides,
  };
}

function fastState(overrides = {}) {
  return baseState({
    schema_version: 4,
    verification_policy: 'fast-v1',
    ...overrides,
  });
}

async function writeTaggedTasks(root, state, tags = ['FE']) {
  await mkdir(path.dirname(path.join(root, state.artifacts.tasks)), { recursive: true });
  const body = tags.map((tag, index) => `[] ${index + 1}. [${tag}] Task ${index + 1}\n   - 定向验证: targeted-${index + 1}\n`).join('');
  await writeFile(path.join(root, state.artifacts.tasks), body);
}

async function writeValidationPlan(root, plan) {
  await mkdir(path.join(root, '.spec-dev'), { recursive: true });
  await writeFile(path.join(root, '.spec-dev', 'VALIDATION_PLAN.json'), `${JSON.stringify(plan, null, 2)}\n`);
}

function validationPlan({ frontend = null, backend = null, unknown = null } = {}) {
  const notApplicable = { applicable: false, inputs: [], required_kinds: [], checks: [] };
  const scopes = {
    frontend: frontend || notApplicable,
    backend: backend || notApplicable,
  };
  if (unknown) {
    scopes[unknown] = notApplicable;
  }
  return { schema_version: 1, scopes };
}

function runnableScope(rootName, input = 'src.txt', options = {}) {
  const buildCounter = `../output/${rootName}-build-count`;
  const testCounter = `../output/${rootName}-test-count`;
  return {
    applicable: true,
    inputs: [rootName, ...(options.sharedInputs || [])],
    required_kinds: ['build', 'test', ...(options.requireCoverage ? ['coverage'] : [])],
    checks: [
      {
        id: `${rootName}-build`,
        kind: 'build',
        cwd: rootName,
        argv: [process.execPath, '-e', `const fs=require('fs');const p='${buildCounter}';const n=fs.existsSync(p)?Number(fs.readFileSync(p)):0;fs.writeFileSync(p,String(n+1));console.log('build-ok')`],
      },
      {
        id: `${rootName}-coverage`,
        kind: 'coverage',
        satisfies: ['test', 'coverage'],
        cwd: rootName,
        argv: [process.execPath, '-e', `const fs=require('fs');const p='${testCounter}';const n=fs.existsSync(p)?Number(fs.readFileSync(p)):0;fs.writeFileSync(p,String(n+1));console.log('coverage-ok')`],
      },
    ],
  };
}

async function createArtifactFiles(root, state = baseState()) {
  await mkdir(path.join(root, 'output'), { recursive: true });
  await mkdir(path.join(root, '.spec-dev', 'changes', state.requirement_name), { recursive: true });
  for (const key of ['research', 'prd', 'architecture', 'uiux', 'quality']) {
    await writeFile(path.join(root, state.artifacts[key]), `# ${key}\n`);
  }
  await writeFile(path.join(root, state.artifacts.proposal), '# Proposal\n');
  await writeFile(
    path.join(root, state.artifacts.tasks),
    '[] 1. Pending\n[x] 2. Done\n[x] 3. Also done\n',
  );
}

test('init creates .spec-dev state and session brief for new mode', async () => {
  await withTempProject(async (root) => {
    const result = runCli(['init', '--root', root, '--requirement', '为订单服务新增按订单状态分页查询接口']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.phase, 'research');
    assert.equal(result.json.mode, 'new');
    assert.deepEqual(result.json.required_reads, ['agents/researcher.md']);
    assert.deepEqual(result.json.expected_outputs, [
      'output/wei-ding-dan-fu-wu-xin-zeng-an-ding-dan-zhuang-tai-fen-ye-cha-xun-jie-kou-research.md',
    ]);

    const state = await readState(root);
    assert.equal(state.schema_version, 4);
    assert.equal(state.verification_policy, 'fast-v1');
    assert.equal(state.phase, 'research');
    assert.equal(state.requirement_name, 'wei-ding-dan-fu-wu-xin-zeng-an-ding-dan-zhuang-tai-fen-ye-cha-xun-jie-kou');
    assert.equal(await exists(path.join(root, '.spec-dev', 'SESSION_BRIEF.md')), true);
    assert.equal(await exists(path.join(root, '.spec-dev', 'verification.json')), true);
    assert.equal(await exists(path.join(root, 'spec-dev', '.state.json')), false);
  });
});

test('init evolve and patch modes start with baseline', async () => {
  await withTempProject(async (root) => {
    const evolve = runCli(['init', '--root', root, '--requirement', 'Evolve feature', '--mode', 'evolve']);
    assert.equal(evolve.status, 0, evolve.stderr);
    assert.equal(evolve.json.phase, 'baseline');
    assert.equal(evolve.json.mode, 'evolve');
  });

  await withTempProject(async (root) => {
    const patch = runCli(['init', '--root', root, '--requirement', 'Fix login loop', '--mode', 'patch']);
    assert.equal(patch.status, 0, patch.stderr);
    assert.equal(patch.json.phase, 'baseline');
    assert.equal(patch.json.mode, 'patch');
  });
});

test('init rejects invalid mode', async () => {
  await withTempProject(async (root) => {
    const result = runCli(['init', '--root', root, '--requirement', 'Test', '--mode', 'invalid']);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'INVALID_MODE');
  });
});

test('next returns minimal reads and expected outputs for the governed phase chain', async () => {
  const cases = [
    { phase: 'baseline', reads: [], outputs: [], gate: null },
    { phase: 'research', reads: ['agents/researcher.md'], outputs: ['output/add-status-query-api-research.md'], gate: null },
    {
      phase: 'docs',
      reads: [
        'agents/prd-writer.md',
        'agents/architecture-writer.md',
        'agents/ui-designer.md',
        'references/prd-template.md',
        'references/architecture-template.md',
        'references/uiux-template.md',
        'references/uiux-pro-max-adapter.md',
        'output/add-status-query-api-research.md',
      ],
      outputs: [
        'output/add-status-query-api-prd.md',
        'output/add-status-query-api-architecture.md',
        'output/add-status-query-api-uiux.md',
      ],
      gate: null,
    },
    {
      phase: 'docs_confirm',
      reads: [
        'output/add-status-query-api-prd.md',
        'output/add-status-query-api-architecture.md',
        'output/add-status-query-api-uiux.md',
      ],
      outputs: [],
      gate: 'docs_confirm',
    },
    {
      phase: 'spec',
      reads: [
        'agents/spec-generator.md',
        'references/spec-template.md',
        'output/add-status-query-api-prd.md',
        'output/add-status-query-api-architecture.md',
        'output/add-status-query-api-uiux.md',
      ],
      outputs: [
        '.spec-dev/changes/add-status-query-api/proposal.md',
        '.spec-dev/changes/add-status-query-api/tasks.md',
      ],
      gate: null,
    },
    {
      phase: 'pre_code',
      reads: [
        '.spec-dev/PRE_CODE_CHECKLIST.md',
        'references/validation-plan.md',
        'output/add-status-query-api-prd.md',
        'output/add-status-query-api-architecture.md',
        'output/add-status-query-api-uiux.md',
        '.spec-dev/changes/add-status-query-api/tasks.md',
      ],
      outputs: [],
      gate: null,
    },
    {
      phase: 'frontend',
      reads: [
        '.spec-dev/changes/add-status-query-api/tasks.md',
        'output/add-status-query-api-uiux.md',
        '.spec-dev/PRE_CODE_CHECKLIST.md',
      ],
      outputs: [],
      gate: null,
    },
    {
      phase: 'preview_confirm',
      reads: ['.spec-dev/changes/add-status-query-api/tasks.md', 'output/add-status-query-api-uiux.md'],
      outputs: [],
      gate: 'preview_confirm',
    },
    {
      phase: 'backend',
      reads: ['.spec-dev/changes/add-status-query-api/tasks.md', 'output/add-status-query-api-architecture.md'],
      outputs: [],
      gate: null,
    },
    {
      phase: 'quality',
      reads: [
        'agents/quality-reviewer.md',
        'agents/security-reviewer.md',
        'references/quality-checklist.md',
        'references/security/generic.md',
        '.spec-dev/changes/add-status-query-api/tasks.md',
        'output/add-status-query-api-prd.md',
        'output/add-status-query-api-architecture.md',
        'output/add-status-query-api-uiux.md',
      ],
      outputs: ['output/add-status-query-api-quality-report.md'],
      gate: null,
    },
    {
      phase: 'delivery',
      reads: [
        'references/delivery-template.md',
        'output/add-status-query-api-research.md',
        'output/add-status-query-api-prd.md',
        'output/add-status-query-api-architecture.md',
        'output/add-status-query-api-uiux.md',
        '.spec-dev/changes/add-status-query-api/tasks.md',
        'output/add-status-query-api-quality-report.md',
      ],
      outputs: ['output/<YYYY-MM-DD>-add-status-query-api-delivery.md'],
      gate: null,
    },
    { phase: 'done', reads: [], outputs: [], gate: null },
  ];

  for (const item of cases) {
    await withTempProject(async (root) => {
      await writeState(root, baseState({ phase: item.phase, current_gate: item.gate }));

      const result = runCli(['next', '--root', root]);

      assert.equal(result.status, 0, `${item.phase}: ${result.stderr || JSON.stringify(result.json)}`);
      assert.equal(result.json.phase, item.phase);
      assert.deepEqual(result.json.required_reads, item.reads);
      assert.deepEqual(result.json.expected_outputs, item.outputs);
      assert.equal(result.json.expected_output, item.outputs.length === 1 ? item.outputs[0] : null);
      assert.equal(result.json.current_gate, item.gate);
    });
  }
});

test('research, docs, spec, and quality phases require their artifacts', async () => {
  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'research', artifacts: { ...baseState().artifacts, research: null } }));
    const missingResearch = runCli(['advance', '--root', root, '--completed', 'research']);
    assert.notEqual(missingResearch.status, 0);
    assert.equal(missingResearch.json.error.kind, 'research');

    const research = runCli([
      'advance',
      '--root',
      root,
      '--completed',
      'research',
      '--artifact',
      'research=output/add-status-query-api-research.md',
    ]);
    assert.equal(research.status, 0, research.stderr);
    assert.equal(research.json.phase, 'docs');

    const missingDocs = runCli(['advance', '--root', root, '--completed', 'docs', '--artifact', 'prd=output/add-status-query-api-prd.md']);
    assert.notEqual(missingDocs.status, 0);
    assert.equal(missingDocs.json.error.kind, 'architecture');

    const docs = runCli([
      'advance',
      '--root',
      root,
      '--completed',
      'docs',
      '--artifact',
      'prd=output/add-status-query-api-prd.md',
      '--artifact',
      'architecture=output/add-status-query-api-architecture.md',
      '--artifact',
      'uiux=output/add-status-query-api-uiux.md',
    ]);
    assert.equal(docs.status, 0, docs.stderr);
    assert.equal(docs.json.phase, 'docs_confirm');
    assert.equal(docs.json.current_gate, 'docs_confirm');

    const confirmed = runCli(['gate', '--root', root, '--confirm', 'docs_confirm']);
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.equal(confirmed.json.phase, 'spec');

    const missingSpec = runCli([
      'advance',
      '--root',
      root,
      '--completed',
      'spec',
      '--artifact',
      'proposal=.spec-dev/changes/add-status-query-api/proposal.md',
    ]);
    assert.notEqual(missingSpec.status, 0);
    assert.equal(missingSpec.json.error.kind, 'tasks');

    const spec = runCli([
      'advance',
      '--root',
      root,
      '--completed',
      'spec',
      '--artifact',
      'proposal=.spec-dev/changes/add-status-query-api/proposal.md',
      '--artifact',
      'tasks=.spec-dev/changes/add-status-query-api/tasks.md',
    ]);
    assert.equal(spec.status, 0, spec.stderr);
    assert.equal(spec.json.phase, 'pre_code');
    assert.equal(await exists(path.join(root, '.spec-dev', 'PRE_CODE_CHECKLIST.md')), true);

    await writeState(root, baseState({ phase: 'quality' }));
    const missingQuality = runCli(['advance', '--root', root, '--completed', 'quality']);
    assert.notEqual(missingQuality.status, 0);
    assert.equal(missingQuality.json.error.kind, 'quality');
  });
});

test('pre_code phase blocks until checklist is complete', async () => {
  await withTempProject(async (root) => {
    const state = baseState({ phase: 'pre_code' });
    await writeState(root, state);
    await mkdir(path.join(root, '.spec-dev'), { recursive: true });
    await writeFile(path.join(root, '.spec-dev', 'PRE_CODE_CHECKLIST.md'), '- [ ] Read docs\n- [x] Done item\n');

    const blocked = runCli(['advance', '--root', root, '--completed', 'pre_code']);
    assert.notEqual(blocked.status, 0);
    assert.equal(blocked.json.error.code, 'PRE_CODE_CHECKLIST_INCOMPLETE');
    assert.deepEqual(blocked.json.error.incomplete, ['- [ ] Read docs']);

    await writeFile(path.join(root, '.spec-dev', 'PRE_CODE_CHECKLIST.md'), '- [x] Read docs\n- [x] Done item\n');
    const advanced = runCli(['advance', '--root', root, '--completed', 'pre_code']);
    assert.equal(advanced.status, 0, advanced.stderr);
    assert.equal(advanced.json.phase, 'frontend');
  });
});

test('gate confirms only matching docs_confirm and preview_confirm gates', async () => {
  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'docs_confirm', current_gate: 'docs_confirm' }));

    const wrong = runCli(['gate', '--root', root, '--confirm', 'preview_confirm']);
    assert.notEqual(wrong.status, 0);
    assert.equal(wrong.json.error.code, 'GATE_MISMATCH');

    const docs = runCli(['gate', '--root', root, '--confirm', 'docs_confirm']);
    assert.equal(docs.status, 0, docs.stderr);
    assert.equal(docs.json.phase, 'spec');
  });

  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'preview_confirm', current_gate: 'preview_confirm' }));

    const preview = runCli(['gate', '--root', root, '--confirm', 'preview_confirm']);
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(preview.json.phase, 'backend');
  });
});

test('deliver creates dated output delivery report and archive remains an alias', async () => {
  await withTempProject(async (root) => {
    const state = baseState({
      phase: 'delivery',
      phases_completed: ['research', 'docs', 'docs_confirm', 'spec', 'pre_code', 'frontend', 'preview_confirm', 'backend', 'quality'],
    });
    await writeState(root, state);
    await createArtifactFiles(root, state);

    const result = runCli(['deliver', '--root', root], {
      env: { ...process.env, SPEC_DEV_DATE: '2026-05-25' },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.phase, 'done');
    assert.equal(result.json.delivery_path, 'output/2026-05-25-add-status-query-api-delivery.md');
    assert.equal(result.json.archive_path, result.json.delivery_path);

    const delivery = await readFile(path.join(root, result.json.delivery_path), 'utf8');
    assert.match(delivery, /# add-status-query-api - Delivery Report/);
    assert.match(delivery, /Tasks completed: 2\/3/);
    assert.match(delivery, /output\/add-status-query-api-architecture\.md/);
  });

  await withTempProject(async (root) => {
    const state = baseState({ phase: 'delivery' });
    await writeState(root, state);
    await createArtifactFiles(root, state);

    const result = runCli(['archive', '--root', root], {
      env: { ...process.env, SPEC_DEV_DATE: '2026-05-26' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.delivery_path, 'output/2026-05-26-add-status-query-api-delivery.md');
  });
});

test('legacy spec-dev/.state.json is read and migrated to .spec-dev/state.json', async () => {
  await withTempProject(async (root) => {
    await mkdir(path.join(root, 'spec-dev'), { recursive: true });
    await writeFile(
      path.join(root, 'spec-dev', '.state.json'),
      `${JSON.stringify({
        schema_version: 2,
        mode: 'new',
        phase: 'tech',
        requirement: 'Legacy feature',
        requirement_name: 'legacy-feature',
        created_at: '2026-05-25T00:00:00.000Z',
        phases_completed: ['research', 'prd'],
        current_gate: null,
        artifacts: {
          prd: 'spec-dev/prd/legacy-feature-prd.md',
          tech: 'spec-dev/tech/legacy-feature-tech.md',
          uiux: null,
          spec: null,
          quality: null,
          archive: null,
        },
        quality: {},
      }, null, 2)}\n`,
    );

    const result = runCli(['next', '--root', root]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.phase, 'docs');
    assert.equal(result.json.artifacts.architecture, 'spec-dev/tech/legacy-feature-tech.md');

    const migrated = await readState(root);
    assert.equal(migrated.schema_version, 4);
    assert.equal(migrated.verification_policy, 'legacy');
    assert.equal(migrated.phase, 'docs');
    assert.equal(migrated.artifacts.architecture, 'spec-dev/tech/legacy-feature-tech.md');
    assert.equal(await exists(path.join(root, '.spec-dev', 'state.json')), true);
  });
});

test('validate reports missing state, missing artifacts, and done state', async () => {
  await withTempProject(async (missingRoot) => {
    const result = runCli(['validate', '--root', missingRoot]);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'STATE_NOT_FOUND');
  });

  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'docs' }));
    const result = runCli(['validate', '--root', root]);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'ARTIFACT_NOT_FOUND');
    assert.deepEqual(result.json.error.missing, ['output/add-status-query-api-research.md']);
  });

  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'done', mode: 'patch' }));
    const result = runCli(['validate', '--root', root]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.valid, true);
    assert.equal(result.json.phase, 'done');
    assert.equal(result.json.mode, 'patch');
  });
});

test('advance cannot bypass the docs_confirm and preview_confirm hard gates', async () => {
  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'docs_confirm', current_gate: 'docs_confirm' }));
    const bypass = runCli(['advance', '--root', root, '--completed', 'docs_confirm']);
    assert.notEqual(bypass.status, 0);
    assert.equal(bypass.json.error.code, 'USE_GATE_COMMAND');
    assert.equal((await readState(root)).phase, 'docs_confirm');
  });

  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'preview_confirm', current_gate: 'preview_confirm' }));
    const bypass = runCli(['advance', '--root', root, '--completed', 'preview_confirm']);
    assert.notEqual(bypass.status, 0);
    assert.equal(bypass.json.error.code, 'USE_GATE_COMMAND');
    assert.equal((await readState(root)).phase, 'preview_confirm');
  });
});

test('distinct requirements with unmapped CJK get distinct, non-colliding slugs', async () => {
  await withTempProject(async (rootA) => {
    await withTempProject(async (rootB) => {
      const a = runCli(['init', '--root', rootA, '--requirement', '图书馆藏书']);
      const b = runCli(['init', '--root', rootB, '--requirement', '餐厅排队叫号']);
      assert.equal(a.status, 0, a.stderr);
      assert.equal(b.status, 0, b.stderr);
      assert.notEqual(a.json.requirement_name, b.json.requirement_name);
      // Neither may collapse to the bare fallback that overwrites artifacts.
      assert.notEqual(a.json.requirement_name, 'requirement');
      assert.notEqual(b.json.requirement_name, 'requirement');
    });
  });

  await withTempProject(async (root) => {
    // Fully mapped / ASCII slugs stay clean (no hash suffix).
    const mapped = runCli(['init', '--root', root, '--requirement', 'Add status query API']);
    assert.equal(mapped.json.requirement_name, 'add-status-query-api');
  });
});

test('dev_confirm is a routed alias for the preview_confirm gate', async () => {
  await withTempProject(async (root) => {
    // Wrong phase: the alias must be rejected via the shared validation block,
    // not silently confirmed. (normalizeState heals current_gate to the phase,
    // so phase mismatch is the reachable failure path.)
    await writeState(root, baseState({ phase: 'docs_confirm', current_gate: 'docs_confirm' }));
    const wrongPhase = runCli(['gate', '--root', root, '--confirm', 'dev_confirm']);
    assert.notEqual(wrongPhase.status, 0);
    assert.equal(wrongPhase.json.error.code, 'GATE_MISMATCH');
    assert.equal((await readState(root)).phase, 'docs_confirm');
  });

  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'preview_confirm', current_gate: 'preview_confirm' }));
    const confirmed = runCli(['gate', '--root', root, '--confirm', 'dev_confirm']);
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.equal(confirmed.json.phase, 'backend');
  });
});

test('deliver counts markdown list tasks, not only the bare bracket form', async () => {
  await withTempProject(async (root) => {
    const state = baseState({ phase: 'delivery' });
    await writeState(root, state);
    await mkdir(path.join(root, 'output'), { recursive: true });
    await mkdir(path.join(root, '.spec-dev', 'changes', state.requirement_name), { recursive: true });
    for (const key of ['research', 'prd', 'architecture', 'uiux', 'quality']) {
      await writeFile(path.join(root, state.artifacts[key]), `# ${key}\n`);
    }
    await writeFile(path.join(root, state.artifacts.proposal), '# Proposal\n');
    // Conventional markdown list task syntax that the old strict regex missed.
    await writeFile(
      path.join(root, state.artifacts.tasks),
      '- [x] 1. Done frontend\n- [x] 2. Done backend\n  - [ ] 3. Pending subtask\n* [ ] 4. Pending\n',
    );

    const result = runCli(['deliver', '--root', root], {
      env: { ...process.env, SPEC_DEV_DATE: '2026-05-25' },
    });
    assert.equal(result.status, 0, result.stderr);
    const delivery = await readFile(path.join(root, result.json.delivery_path), 'utf8');
    assert.match(delivery, /Tasks completed: 2\/4/);
  });
});

test('error detail keys cannot shadow the canonical code and message', async () => {
  await withTempProject(async (root) => {
    // INVALID_ARTIFACT_KIND attaches a detail `kind`; ensure code stays intact
    // and detail flattening still works for consumers that read error.kind.
    await writeState(root, baseState({ phase: 'research', artifacts: { ...baseState().artifacts, research: null } }));
    const result = runCli([
      'advance', '--root', root, '--completed', 'research',
      '--artifact', 'bogus=output/x.md',
    ]);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'INVALID_ARTIFACT_KIND');
    assert.equal(result.json.error.kind, 'bogus');
  });
});

test('state.json with a newer schema_version is rejected', async () => {
  await withTempProject(async (root) => {
    await writeState(root, baseState({ schema_version: 99 }));
    const result = runCli(['next', '--root', root]);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'STATE_SCHEMA_TOO_NEW');
    assert.equal(result.json.error.found, 99);
  });
});

test('v3 workflows migrate to fast verification before the next development gate', async () => {
  await withTempProject(async (root) => {
    const state = baseState({ phase: 'frontend' });
    delete state.verification_policy;
    await writeState(root, state);

    const next = runCli(['next', '--root', root]);
    assert.equal(next.status, 0, next.stderr);
    assert.equal(next.json.verification_policy, 'fast-v1');
    assert.ok(next.json.required_reads.includes('.spec-dev/VALIDATION_PLAN.json'));

    const blocked = runCli(['advance', '--root', root, '--completed', 'frontend']);
    assert.notEqual(blocked.status, 0);
    assert.equal(blocked.json.error.code, 'VALIDATION_PLAN_MISSING');
  });
});

test('migration audit keys survive the state write round-trip', async () => {
  await withTempProject(async (root) => {
    await mkdir(path.join(root, 'spec-dev'), { recursive: true });
    await writeFile(
      path.join(root, 'spec-dev', '.state.json'),
      `${JSON.stringify({
        schema_version: 2,
        mode: 'new',
        phase: 'research',
        requirement: 'Legacy feature',
        requirement_name: 'legacy-feature',
        created_at: '2026-05-25T00:00:00.000Z',
        phases_completed: [],
        current_gate: null,
        artifacts: { research: 'output/legacy-feature-research.md' },
        quality: {},
      }, null, 2)}\n`,
    );

    const first = runCli(['next', '--root', root]);
    assert.equal(first.status, 0, first.stderr);
    const migrated = await readState(root);
    assert.equal(migrated.migrated_from, path.join('spec-dev', '.state.json'));
    assert.ok(migrated.migrated_at);

    // A second read re-normalizes and re-writes; audit keys must not be stripped.
    runCli(['next', '--root', root]);
    const persisted = await readState(root);
    assert.equal(persisted.migrated_from, path.join('spec-dev', '.state.json'));
    assert.equal(persisted.migrated_at, migrated.migrated_at);
  });
});

test('fast pre_code requires a valid scoped validation plan', async () => {
  await withTempProject(async (root) => {
    const state = fastState({ phase: 'pre_code' });
    await writeState(root, state);
    await writeTaggedTasks(root, state, ['FE']);
    await writeFile(path.join(root, '.spec-dev', 'PRE_CODE_CHECKLIST.md'), '- [x] Ready\n');

    const missing = runCli(['advance', '--root', root, '--completed', 'pre_code']);
    assert.notEqual(missing.status, 0);
    assert.equal(missing.json.error.code, 'VALIDATION_PLAN_MISSING');

    await writeValidationPlan(root, validationPlan({ frontend: runnableScope('frontend') }));
    await writeFile(path.join(root, state.artifacts.tasks), '[] 1. [FE] Missing targeted check\n');
    const noTargeted = runCli(['advance', '--root', root, '--completed', 'pre_code']);
    assert.equal(noTargeted.json.error.code, 'TASK_TARGETED_VERIFICATION_MISSING');

    await writeFile(path.join(root, state.artifacts.tasks), '[] 1. [FE] Broad check\n   - 定向验证: npm run build\n');
    const broad = runCli(['advance', '--root', root, '--completed', 'pre_code']);
    assert.equal(broad.json.error.code, 'TASK_TARGETED_VERIFICATION_TOO_BROAD');
    await writeTaggedTasks(root, state, ['FE']);

    await writeValidationPlan(root, validationPlan({ unknown: 'mobile' }));
    const unknown = runCli(['advance', '--root', root, '--completed', 'pre_code']);
    assert.equal(unknown.json.error.code, 'VALIDATION_PLAN_INVALID');
    assert.deepEqual(unknown.json.error.unknown_scopes, ['mobile']);

    const invalidPath = runnableScope('frontend');
    invalidPath.inputs = ['../escape'];
    await writeValidationPlan(root, validationPlan({ frontend: invalidPath }));
    const escaped = runCli(['advance', '--root', root, '--completed', 'pre_code']);
    assert.equal(escaped.json.error.code, 'VALIDATION_PLAN_INVALID');

    const emptyCommand = runnableScope('frontend');
    emptyCommand.checks[0].argv = [];
    await writeValidationPlan(root, validationPlan({ frontend: emptyCommand }));
    const empty = runCli(['advance', '--root', root, '--completed', 'pre_code']);
    assert.equal(empty.json.error.code, 'VALIDATION_PLAN_INVALID');

    await writeValidationPlan(root, validationPlan({ frontend: runnableScope('frontend') }));
    const advanced = runCli(['advance', '--root', root, '--completed', 'pre_code']);
    assert.equal(advanced.status, 0, advanced.stderr);
    assert.equal(advanced.json.phase, 'frontend');
  });
});

test('verify records scoped evidence, reuses fresh checks, and invalidates only changed inputs', async () => {
  await withTempProject(async (root) => {
    const state = fastState({ phase: 'frontend' });
    await writeState(root, state);
    await writeTaggedTasks(root, state, ['FE', 'BE']);
    await mkdir(path.join(root, 'frontend'), { recursive: true });
    await mkdir(path.join(root, 'backend'), { recursive: true });
    await mkdir(path.join(root, 'output'), { recursive: true });
    await writeFile(path.join(root, 'frontend', 'src.txt'), 'frontend-v1\n');
    await writeFile(path.join(root, 'backend', 'src.txt'), 'backend-v1\n');
    await writeFile(path.join(root, 'shared.config'), 'shared-v1\n');

    const gitInit = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
    assert.equal(gitInit.status, 0, gitInit.stderr);
    spawnSync('git', ['add', 'frontend/src.txt', 'backend/src.txt', 'shared.config'], { cwd: root });
    const commit = spawnSync('git', ['-c', 'user.name=Spec Dev', '-c', 'user.email=spec@example.test', 'commit', '-qm', 'fixture'], { cwd: root, encoding: 'utf8' });
    assert.equal(commit.status, 0, commit.stderr);

    const plan = validationPlan({
      frontend: runnableScope('frontend', 'src.txt', { sharedInputs: ['shared.config'], requireCoverage: true }),
      backend: runnableScope('backend', 'src.txt', { sharedInputs: ['shared.config'], requireCoverage: true }),
    });
    await writeValidationPlan(root, plan);

    await writeState(root, fastState({ phase: 'backend' }));
    const backendMissing = runCli(['advance', '--root', root, '--completed', 'backend']);
    assert.notEqual(backendMissing.status, 0);
    assert.equal(backendMissing.json.error.code, 'VERIFICATION_REQUIRED');
    await writeState(root, state);

    const firstFrontend = runCli(['verify', '--root', root, '--scope', 'frontend', '--level', 'full'], {
      env: { ...process.env, SPEC_DEV_TEST_SECRET: 'do-not-persist-this-value' },
    });
    assert.equal(firstFrontend.status, 0, firstFrontend.stderr);
    assert.equal(firstFrontend.json.status, 'fresh');
    assert.equal(firstFrontend.json.executed_checks.length, 2);

    const firstBackend = runCli(['verify', '--root', root, '--scope', 'backend', '--level', 'full']);
    assert.equal(firstBackend.status, 0, firstBackend.stderr);
    assert.equal(firstBackend.json.status, 'fresh');

    await writeState(root, fastState({ phase: 'backend' }));
    const backendAdvanced = runCli(['advance', '--root', root, '--completed', 'backend']);
    assert.equal(backendAdvanced.status, 0, backendAdvanced.stderr);
    assert.equal(backendAdvanced.json.phase, 'quality');

    const reused = runCli(['verify', '--root', root, '--scope', 'frontend', '--level', 'full']);
    assert.equal(reused.status, 0, reused.stderr);
    assert.deepEqual(reused.json.executed_checks, []);
    assert.equal(reused.json.reused_checks.length, 2);
    assert.equal(await readFile(path.join(root, 'output', 'frontend-build-count'), 'utf8'), '1');
    assert.equal(await readFile(path.join(root, 'output', 'frontend-test-count'), 'utf8'), '1');

    await writeFile(path.join(root, 'output', 'note.txt'), 'workflow-only change\n');
    const taskText = await readFile(path.join(root, state.artifacts.tasks), 'utf8');
    await writeFile(path.join(root, state.artifacts.tasks), taskText.replace('[] 1.', '[x] 1.'));
    const unchanged = runCli(['verify-status', '--root', root]);
    assert.equal(unchanged.json.scopes.frontend.status, 'fresh');
    assert.equal(unchanged.json.scopes.backend.status, 'fresh');

    await writeFile(path.join(root, 'frontend', 'src.txt'), 'frontend-v2\n');
    const frontendChanged = runCli(['verify-status', '--root', root]);
    assert.equal(frontendChanged.json.scopes.frontend.status, 'stale');
    assert.equal(frontendChanged.json.scopes.backend.status, 'fresh');

    await writeFile(path.join(root, 'shared.config'), 'shared-v2\n');
    const sharedChanged = runCli(['verify-status', '--root', root]);
    assert.equal(sharedChanged.json.scopes.frontend.status, 'stale');
    assert.equal(sharedChanged.json.scopes.backend.status, 'stale');

    const ledger = await readFile(path.join(root, '.spec-dev', 'verification.json'), 'utf8');
    assert.doesNotMatch(ledger, /do-not-persist-this-value/);
    const parsed = JSON.parse(ledger);
    assert.ok(parsed.entries.every((entry) => entry.output_sha256 && !('output' in entry)));
  });
});

test('failed verification is recorded with its real exit code', async () => {
  await withTempProject(async (root) => {
    const state = fastState({ phase: 'frontend' });
    await writeState(root, state);
    await writeTaggedTasks(root, state, ['FE']);
    await mkdir(path.join(root, 'frontend'), { recursive: true });
    await writeFile(path.join(root, 'frontend', 'src.txt'), 'source\n');
    const scope = runnableScope('frontend');
    scope.checks[0].argv = [process.execPath, '-e', 'process.exit(7)'];
    await writeValidationPlan(root, validationPlan({ frontend: scope }));

    const failed = runCli(['verify', '--root', root, '--scope', 'frontend', '--level', 'full']);
    assert.notEqual(failed.status, 0);
    assert.equal(failed.json.error.code, 'VERIFICATION_FAILED');
    assert.equal(failed.json.error.exit_code, 7);

    const ledger = JSON.parse(await readFile(path.join(root, '.spec-dev', 'verification.json'), 'utf8'));
    assert.equal(ledger.entries.at(-1).exit_code, 7);
    const status = runCli(['verify-status', '--root', root, '--scope', 'frontend']);
    assert.equal(status.json.scopes.frontend.status, 'failed');
  });
});

test('root-scoped Git fingerprints exclude verification and output artifacts', async () => {
  await withTempProject(async (root) => {
    const state = fastState({ phase: 'frontend' });
    await writeState(root, state);
    await writeTaggedTasks(root, state, ['FE']);
    await mkdir(path.join(root, 'frontend'), { recursive: true });
    await mkdir(path.join(root, 'output'), { recursive: true });
    await writeFile(path.join(root, 'frontend', 'src.txt'), 'source\n');
    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['add', 'frontend/src.txt'], { cwd: root });
    const commit = spawnSync('git', ['-c', 'user.name=Spec Dev', '-c', 'user.email=spec@example.test', 'commit', '-qm', 'fixture'], { cwd: root, encoding: 'utf8' });
    assert.equal(commit.status, 0, commit.stderr);

    const scope = runnableScope('frontend');
    scope.inputs = ['.'];
    await writeValidationPlan(root, validationPlan({ frontend: scope }));
    const first = runCli(['verify', '--root', root, '--scope', 'frontend', '--level', 'full']);
    assert.equal(first.status, 0, first.stderr);
    const second = runCli(['verify', '--root', root, '--scope', 'frontend', '--level', 'full']);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(second.json.executed_checks, []);
    assert.equal(second.json.reused_checks.length, 2);
  });
});

test('phase gates require fresh evidence and quality blocks CRITICAL or HIGH findings', async () => {
  await withTempProject(async (root) => {
    let state = fastState({ phase: 'frontend' });
    await writeState(root, state);
    await writeTaggedTasks(root, state, ['FE']);
    await mkdir(path.join(root, 'frontend'), { recursive: true });
    await mkdir(path.join(root, 'output'), { recursive: true });
    await writeFile(path.join(root, 'frontend', 'src.txt'), 'source\n');
    await writeValidationPlan(root, validationPlan({ frontend: runnableScope('frontend') }));

    const blocked = runCli(['advance', '--root', root, '--completed', 'frontend']);
    assert.notEqual(blocked.status, 0);
    assert.equal(blocked.json.error.code, 'VERIFICATION_REQUIRED');

    const verified = runCli(['verify', '--root', root, '--scope', 'frontend', '--level', 'full']);
    assert.equal(verified.status, 0, verified.stderr);
    const advanced = runCli(['advance', '--root', root, '--completed', 'frontend']);
    assert.equal(advanced.status, 0, advanced.stderr);
    assert.equal(advanced.json.phase, 'preview_confirm');

    state = fastState({ phase: 'quality' });
    await writeState(root, state);
    const qualityPath = path.join(root, state.artifacts.quality);
    await writeFile(qualityPath, '---\nstatus: PASSED\ncritical: 0\nhigh: 1\n---\n# Quality\n');
    const high = runCli([
      'advance', '--root', root, '--completed', 'quality',
      '--artifact', `quality=${state.artifacts.quality}`,
    ]);
    assert.notEqual(high.status, 0);
    assert.equal(high.json.error.code, 'QUALITY_GATE_FAILED');
    assert.equal(high.json.error.high, 1);

    await writeFile(qualityPath, '---\nstatus: PASSED\ncritical: 0\nhigh: 0\n---\n# Quality\n');
    const passed = runCli([
      'advance', '--root', root, '--completed', 'quality',
      '--artifact', `quality=${state.artifacts.quality}`,
    ]);
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(passed.json.phase, 'delivery');
  });
});

test('scope without matching tasks is not applicable and cannot be enabled falsely', async () => {
  await withTempProject(async (root) => {
    const state = fastState({ phase: 'backend' });
    await writeState(root, state);
    await writeTaggedTasks(root, state, ['BE']);
    await writeValidationPlan(root, validationPlan({ backend: runnableScope('backend') }));
    const status = runCli(['verify-status', '--root', root, '--scope', 'frontend']);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(status.json.scopes.frontend.status, 'not_applicable');

    await writeValidationPlan(root, validationPlan({ frontend: runnableScope('frontend'), backend: runnableScope('backend') }));
    const mismatch = runCli(['verify-status', '--root', root]);
    assert.notEqual(mismatch.status, 0);
    assert.equal(mismatch.json.error.code, 'VALIDATION_PLAN_SCOPE_MISMATCH');

    const invalidScope = runCli(['verify-status', '--root', root, '--scope', 'mobile']);
    assert.notEqual(invalidScope.status, 0);
    assert.equal(invalidScope.json.error.code, 'INVALID_VERIFICATION_SCOPE');
  });
});

test('quality loads only security references matching nested project manifests', async () => {
  await withTempProject(async (root) => {
    const state = baseState({ phase: 'quality' });
    await writeState(root, state);
    await mkdir(path.join(root, 'apps', 'web'), { recursive: true });
    await writeFile(path.join(root, 'apps', 'web', 'package.json'), '{}\n');

    const next = runCli(['next', '--root', root]);
    assert.equal(next.status, 0, next.stderr);
    assert.ok(next.json.required_reads.includes('references/security/generic.md'));
    assert.ok(next.json.required_reads.includes('references/security/node.md'));
    assert.ok(!next.json.required_reads.includes('references/security/python.md'));
  });
});
