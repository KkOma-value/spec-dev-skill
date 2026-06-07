import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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
  return JSON.parse(await readFile(path.join(root, 'spec-dev', '.state.json'), 'utf8'));
}

async function writeState(root, state) {
  await mkdir(path.join(root, 'spec-dev'), { recursive: true });
  await writeFile(path.join(root, 'spec-dev', '.state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

function baseState(overrides = {}) {
  return {
    schema_version: 2,
    mode: 'new',
    phase: 'research',
    requirement: 'Add status query API',
    requirement_name: 'add-status-query-api',
    created_at: '2026-05-25T00:00:00.000Z',
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
    ...overrides,
  };
}

// Helper: create stub artifact files
async function createStubArtifacts(root, name) {
  await mkdir(path.join(root, 'spec-dev', 'prd'), { recursive: true });
  await mkdir(path.join(root, 'spec-dev', 'tech'), { recursive: true });
  await mkdir(path.join(root, 'spec-dev', 'uiux'), { recursive: true });
  await mkdir(path.join(root, 'spec-dev', 'spec'), { recursive: true });
  await writeFile(path.join(root, 'spec-dev', 'prd', `${name}-prd.md`), '# PRD\n');
  await writeFile(path.join(root, 'spec-dev', 'tech', `${name}-tech.md`), '# Tech\n');
  await writeFile(path.join(root, 'spec-dev', 'uiux', `${name}-uiux.md`), '# UIUX\n');
  await writeFile(path.join(root, 'spec-dev', 'spec', `${name}-tasks.md`), '[x] 1. Done\n[x] 2. Done\n');
}

// ============================================================
// INIT tests
// ============================================================

test('init creates project directories and research state (new mode)', async () => {
  await withTempProject(async (root) => {
    const result = runCli(['init', '--root', root, '--requirement', '为订单服务新增按订单状态分页查询接口']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.phase, 'research');
    assert.equal(result.json.mode, 'new');
    assert.deepEqual(result.json.required_reads, ['agents/researcher.md']);
    assert.equal(result.json.current_gate, null);

    const state = await readState(root);
    assert.equal(state.schema_version, 2);
    assert.equal(state.phase, 'research');
    assert.equal(state.mode, 'new');
    assert.equal(state.requirement, '为订单服务新增按订单状态分页查询接口');
    assert.equal(state.requirement_name, 'wei-ding-dan-fu-wu-xin-zeng-an-ding-dan-zhuang-tai-fen-ye-cha-xun-jie-kou');
    assert.deepEqual(state.phases_completed, []);
    assert.deepEqual(state.quality, {
      security_passed: false,
      code_review_passed: false,
      build_passed: false,
      coverage_passed: false,
    });
  });
});

test('init new mode starts at research phase', async () => {
  await withTempProject(async (root) => {
    const result = runCli(['init', '--root', root, '--requirement', 'Test feature', '--mode', 'new']);
    assert.equal(result.status, 0, result.stderr || JSON.stringify(result.json));
    assert.equal(result.json.phase, 'research');
    assert.equal(result.json.mode, 'new');
  });
});

test('init patch mode starts at frontend phase', async () => {
  await withTempProject(async (root) => {
    const result = runCli(['init', '--root', root, '--requirement', 'Quick fix', '--mode', 'patch']);
    assert.equal(result.status, 0, result.stderr || JSON.stringify(result.json));
    assert.equal(result.json.phase, 'frontend');
    assert.equal(result.json.mode, 'patch');
  });
});

test('init evolve mode starts at spec phase when artifacts exist', async () => {
  await withTempProject(async (root) => {
    const name = 'test-feature';
    await mkdir(path.join(root, 'spec-dev', 'prd'), { recursive: true });
    await mkdir(path.join(root, 'spec-dev', 'tech'), { recursive: true });
    await mkdir(path.join(root, 'spec-dev', 'uiux'), { recursive: true });
    await writeFile(path.join(root, 'spec-dev', 'prd', `${name}-prd.md`), '# PRD\n');
    await writeFile(path.join(root, 'spec-dev', 'tech', `${name}-tech.md`), '# Tech\n');
    await writeFile(path.join(root, 'spec-dev', 'uiux', `${name}-uiux.md`), '# UIUX\n');

    const result = runCli(['init', '--root', root, '--requirement', 'Test feature', '--mode', 'evolve']);
    assert.equal(result.status, 0, result.stderr || JSON.stringify(result.json));
    assert.equal(result.json.phase, 'spec');
    assert.equal(result.json.mode, 'evolve');
  });
});

test('init evolve mode fails when artifacts are missing', async () => {
  await withTempProject(async (root) => {
    const result = runCli(['init', '--root', root, '--requirement', 'Test feature', '--mode', 'evolve']);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'MISSING_PREREQUISITE_ARTIFACTS');
  });
});

test('init rejects invalid mode', async () => {
  await withTempProject(async (root) => {
    const result = runCli(['init', '--root', root, '--requirement', 'Test', '--mode', 'invalid']);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'INVALID_MODE');
  });
});

// ============================================================
// NEXT tests (v3 phase chain)
// ============================================================

test('next returns minimal reads and expected output for each v3 phase', async () => {
  const cases = [
    {
      phase: 'research',
      reads: ['agents/researcher.md'],
      expectedOutput: null,
      gate: null,
    },
    {
      phase: 'prd',
      reads: ['agents/prd-writer.md', 'references/prd-template.md'],
      expectedOutput: 'spec-dev/prd/add-status-query-api-prd.md',
      gate: null,
    },
    {
      phase: 'tech',
      reads: ['agents/tech-writer.md', 'references/tech-template.md'],
      expectedOutput: 'spec-dev/tech/add-status-query-api-tech.md',
      gate: null,
    },
    {
      phase: 'uiux',
      reads: [
        'agents/ui-designer.md',
        'references/uiux-template.md',
        'spec-dev/prd/add-status-query-api-prd.md',
        'spec-dev/tech/add-status-query-api-tech.md',
      ],
      expectedOutput: 'spec-dev/uiux/add-status-query-api-uiux.md',
      gate: null,
    },
    {
      phase: 'docs_confirm',
      reads: [
        'spec-dev/prd/add-status-query-api-prd.md',
        'spec-dev/tech/add-status-query-api-tech.md',
        'spec-dev/uiux/add-status-query-api-uiux.md',
      ],
      expectedOutput: null,
      gate: 'docs_confirm',
    },
    {
      phase: 'spec',
      reads: [
        'agents/spec-generator.md',
        'references/spec-template.md',
        'spec-dev/prd/add-status-query-api-prd.md',
        'spec-dev/tech/add-status-query-api-tech.md',
        'spec-dev/uiux/add-status-query-api-uiux.md',
      ],
      expectedOutput: 'spec-dev/spec/add-status-query-api-tasks.md',
      gate: null,
    },
    {
      phase: 'frontend',
      reads: ['spec-dev/spec/add-status-query-api-tasks.md'],
      expectedOutput: null,
      gate: null,
    },
    {
      phase: 'preview_confirm',
      reads: [
        'spec-dev/spec/add-status-query-api-tasks.md',
        'spec-dev/uiux/add-status-query-api-uiux.md',
      ],
      expectedOutput: null,
      gate: 'preview_confirm',
    },
    {
      phase: 'backend',
      reads: ['spec-dev/spec/add-status-query-api-tasks.md'],
      expectedOutput: null,
      gate: null,
    },
    {
      phase: 'quality',
      reads: [
        'agents/quality-reviewer.md',
        'agents/security-reviewer.md',
        'references/quality-checklist.md',
        'spec-dev/spec/add-status-query-api-tasks.md',
      ],
      expectedOutput: 'spec-dev/quality/add-status-query-api-quality-report.md',
      gate: null,
    },
    {
      phase: 'archive',
      reads: ['references/archive-template.md'],
      expectedOutput: 'spec-dev/archive/<YYYY-MM-DD>-add-status-query-api.md',
      gate: null,
    },
    {
      phase: 'done',
      reads: [],
      expectedOutput: null,
      gate: null,
    },
  ];

  for (const item of cases) {
    await withTempProject(async (root) => {
      await writeState(
        root,
        baseState({
          phase: item.phase,
          current_gate: item.gate,
          artifacts: {
            prd: 'spec-dev/prd/add-status-query-api-prd.md',
            tech: 'spec-dev/tech/add-status-query-api-tech.md',
            uiux: 'spec-dev/uiux/add-status-query-api-uiux.md',
            spec: 'spec-dev/spec/add-status-query-api-tasks.md',
            quality: null,
            archive: null,
          },
        }),
      );

      const result = runCli(['next', '--root', root]);

      assert.equal(result.status, 0, `${item.phase}: ${result.stderr}`);
      assert.equal(result.json.phase, item.phase);
      assert.equal(result.json.mode, 'new');
      assert.deepEqual(result.json.required_reads, item.reads);
      assert.equal(result.json.expected_output, item.expectedOutput);
      assert.equal(result.json.current_gate, item.gate);
    });
  }
});

// ============================================================
// ADVANCE tests
// ============================================================

test('advance enforces phase order and records artifacts', async () => {
  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'prd', phases_completed: ['research'] }));

    const skipped = runCli(['advance', '--root', root, '--completed', 'tech']);
    assert.notEqual(skipped.status, 0);
    assert.equal(skipped.json.error.code, 'PHASE_MISMATCH');

    const advanced = runCli([
      'advance',
      '--root',
      root,
      '--completed',
      'prd',
      '--artifact',
      'prd=spec-dev/prd/add-status-query-api-prd.md',
    ]);

    assert.equal(advanced.status, 0, advanced.stderr);
    assert.equal(advanced.json.phase, 'tech');

    const state = await readState(root);
    assert.deepEqual(state.phases_completed, ['research', 'prd']);
    assert.equal(state.artifacts.prd, 'spec-dev/prd/add-status-query-api-prd.md');
  });
});

test('advance requires artifacts for artifact-producing phases', async () => {
  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'prd', phases_completed: ['research'] }));

    const missingPrd = runCli(['advance', '--root', root, '--completed', 'prd']);
    assert.notEqual(missingPrd.status, 0);
    assert.equal(missingPrd.json.error.code, 'ARTIFACT_REQUIRED');
    assert.equal(missingPrd.json.error.kind, 'prd');

    await writeState(root, baseState({ phase: 'tech', phases_completed: ['research', 'prd'] }));
    const missingTech = runCli(['advance', '--root', root, '--completed', 'tech']);
    assert.notEqual(missingTech.status, 0);
    assert.equal(missingTech.json.error.code, 'ARTIFACT_REQUIRED');
    assert.equal(missingTech.json.error.kind, 'tech');

    await writeState(root, baseState({ phase: 'uiux', phases_completed: ['research', 'prd', 'tech'] }));
    const missingUiux = runCli(['advance', '--root', root, '--completed', 'uiux']);
    assert.notEqual(missingUiux.status, 0);
    assert.equal(missingUiux.json.error.code, 'ARTIFACT_REQUIRED');
    assert.equal(missingUiux.json.error.kind, 'uiux');
  });
});

test('advance cannot mark archive complete without generating archive file', async () => {
  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'archive' }));

    const result = runCli(['advance', '--root', root, '--completed', 'archive']);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'ARCHIVE_REQUIRES_COMMAND');
  });
});

test('advance enters docs_confirm gate after uiux completion', async () => {
  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'uiux',
        phases_completed: ['research', 'prd', 'tech'],
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          uiux: null,
          spec: null,
          quality: null,
          archive: null,
        },
      }),
    );

    const uiux = runCli(['advance', '--root', root, '--completed', 'uiux', '--artifact', 'uiux=spec-dev/uiux/add-status-query-api-uiux.md']);
    assert.equal(uiux.status, 0, uiux.stderr);
    assert.equal(uiux.json.phase, 'docs_confirm');
    assert.equal(uiux.json.current_gate, 'docs_confirm');
  });
});

test('advance enters preview_confirm gate after frontend completion', async () => {
  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'frontend',
        phases_completed: ['research', 'prd', 'tech', 'uiux', 'docs_confirm', 'spec'],
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          uiux: 'spec-dev/uiux/add-status-query-api-uiux.md',
          spec: 'spec-dev/spec/add-status-query-api-tasks.md',
          quality: null,
          archive: null,
        },
      }),
    );

    const fe = runCli(['advance', '--root', root, '--completed', 'frontend']);
    assert.equal(fe.status, 0, fe.stderr);
    assert.equal(fe.json.phase, 'preview_confirm');
    assert.equal(fe.json.current_gate, 'preview_confirm');
  });
});

// ============================================================
// GATE tests
// ============================================================

test('gate confirms docs_confirm and preview_confirm', async () => {
  // docs_confirm gate
  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'docs_confirm',
        current_gate: 'docs_confirm',
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          uiux: 'spec-dev/uiux/add-status-query-api-uiux.md',
          spec: null,
          quality: null,
          archive: null,
        },
      }),
    );

    const confirmed = runCli(['gate', '--root', root, '--confirm', 'docs_confirm']);
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.equal(confirmed.json.phase, 'spec');
    assert.equal(confirmed.json.current_gate, null);

    const state = await readState(root);
    assert.deepEqual(state.phases_completed, ['docs_confirm']);
  });

  // preview_confirm gate
  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'preview_confirm',
        current_gate: 'preview_confirm',
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          uiux: 'spec-dev/uiux/add-status-query-api-uiux.md',
          spec: 'spec-dev/spec/add-status-query-api-tasks.md',
          quality: null,
          archive: null,
        },
      }),
    );

    const confirmed = runCli(['gate', '--root', root, '--confirm', 'preview_confirm']);
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.equal(confirmed.json.phase, 'backend');
    assert.equal(confirmed.json.current_gate, null);
  });
});

test('gate only confirms the matching current gate', async () => {
  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'docs_confirm',
        current_gate: 'docs_confirm',
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          uiux: 'spec-dev/uiux/add-status-query-api-uiux.md',
          spec: null,
          quality: null,
          archive: null,
        },
      }),
    );

    const wrong = runCli(['gate', '--root', root, '--confirm', 'preview_confirm']);
    assert.notEqual(wrong.status, 0);
    assert.equal(wrong.json.error.code, 'GATE_MISMATCH');

    const invalid = runCli(['gate', '--root', root, '--confirm', 'nonexistent']);
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.json.error.code, 'INVALID_GATE');
  });
});

// ============================================================
// ARCHIVE tests
// ============================================================

test('archive creates a dated markdown summary with task counts', async () => {
  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'archive',
        phases_completed: ['research', 'prd', 'tech', 'uiux', 'docs_confirm', 'spec', 'frontend', 'preview_confirm', 'backend', 'quality'],
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          uiux: 'spec-dev/uiux/add-status-query-api-uiux.md',
          spec: 'spec-dev/spec/add-status-query-api-tasks.md',
          quality: 'spec-dev/quality/add-status-query-api-quality-report.md',
          archive: null,
        },
      }),
    );
    await mkdir(path.join(root, 'spec-dev', 'prd'), { recursive: true });
    await mkdir(path.join(root, 'spec-dev', 'tech'), { recursive: true });
    await mkdir(path.join(root, 'spec-dev', 'spec'), { recursive: true });
    await writeFile(path.join(root, 'spec-dev', 'prd', 'add-status-query-api-prd.md'), '# PRD\n');
    await writeFile(path.join(root, 'spec-dev', 'tech', 'add-status-query-api-tech.md'), '# Tech\n');
    await writeFile(
      path.join(root, 'spec-dev', 'spec', 'add-status-query-api-tasks.md'),
      '[] 1. Pending\n[Architecture](../arch.md)\n[x] 2. Done\n[x] 3. Also done\n',
    );

    const result = runCli(['archive', '--root', root], {
      env: { ...process.env, SPEC_DEV_DATE: '2026-05-25' },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.phase, 'done');
    assert.equal(result.json.archive_path, 'spec-dev/archive/2026-05-25-add-status-query-api.md');

    const archive = await readFile(path.join(root, result.json.archive_path), 'utf8');
    assert.match(archive, /# add-status-query-api — 开发归档/);
    assert.match(archive, /任务完成: 2\/3/);
    assert.match(archive, /spec-dev\/prd\/add-status-query-api-prd\.md/);
    assert.match(archive, /## 相关文档/);
    assert.match(archive, /## 工作模式/);
    assert.match(archive, /new/);

    const state = await readState(root);
    assert.equal(state.phase, 'done');
    assert.equal(state.artifacts.archive, 'spec-dev/archive/2026-05-25-add-status-query-api.md');
  });
});

test('archive rejects unsafe override dates and missing required artifacts', async () => {
  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'archive',
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          uiux: null,
          spec: 'spec-dev/spec/add-status-query-api-tasks.md',
          quality: null,
          archive: null,
        },
      }),
    );
    await mkdir(path.join(root, 'spec-dev', 'prd'), { recursive: true });
    await mkdir(path.join(root, 'spec-dev', 'tech'), { recursive: true });
    await mkdir(path.join(root, 'spec-dev', 'spec'), { recursive: true });
    await writeFile(path.join(root, 'spec-dev', 'prd', 'add-status-query-api-prd.md'), '# PRD\n');
    await writeFile(path.join(root, 'spec-dev', 'tech', 'add-status-query-api-tech.md'), '# Tech\n');
    await writeFile(path.join(root, 'spec-dev', 'spec', 'add-status-query-api-tasks.md'), '[] 1. Pending\n');

    const unsafe = runCli(['archive', '--root', root], {
      env: { ...process.env, SPEC_DEV_DATE: '../../etc' },
    });
    assert.notEqual(unsafe.status, 0);
    assert.equal(unsafe.json.error.code, 'INVALID_ARCHIVE_DATE');

    await rm(path.join(root, 'spec-dev', 'spec', 'add-status-query-api-tasks.md'));

    const missingSpec = runCli(['archive', '--root', root], {
      env: { ...process.env, SPEC_DEV_DATE: '2026-05-25' },
    });
    assert.notEqual(missingSpec.status, 0);
    assert.equal(missingSpec.json.error.code, 'ARTIFACT_NOT_FOUND');
    assert.deepEqual(missingSpec.json.error.missing, ['spec-dev/spec/add-status-query-api-tasks.md']);
  });
});

// ============================================================
// VALIDATE & ERROR tests
// ============================================================

test('next fails when a required prior artifact was not recorded', async () => {
  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'docs_confirm',
        current_gate: 'docs_confirm',
        artifacts: {
          prd: null,
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          uiux: 'spec-dev/uiux/add-status-query-api-uiux.md',
          spec: null,
          quality: null,
          archive: null,
        },
      }),
    );

    const result = runCli(['next', '--root', root]);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'ARTIFACT_REQUIRED');
    assert.equal(result.json.error.kind, 'prd');
  });
});

test('validate reports missing state, damaged json, missing artifacts, and done state', async () => {
  await withTempProject(async (missingRoot) => {
    const result = runCli(['validate', '--root', missingRoot]);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'STATE_NOT_FOUND');
  });

  await withTempProject(async (damagedRoot) => {
    await mkdir(path.join(damagedRoot, 'spec-dev'), { recursive: true });
    await writeFile(path.join(damagedRoot, 'spec-dev', '.state.json'), '{broken');
    const result = runCli(['validate', '--root', damagedRoot]);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'STATE_INVALID_JSON');
  });

  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'docs_confirm',
        current_gate: 'docs_confirm',
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          uiux: 'spec-dev/uiux/add-status-query-api-uiux.md',
          spec: null,
          quality: null,
          archive: null,
        },
      }),
    );

    const result = runCli(['validate', '--root', root]);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'ARTIFACT_NOT_FOUND');
  });

  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'done' }));
    const result = runCli(['validate', '--root', root]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.valid, true);
    assert.equal(result.json.phase, 'done');
    assert.equal(result.json.mode, 'new');
  });
});

test('validate returns mode in payload', async () => {
  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'done', mode: 'patch' }));
    const result = runCli(['validate', '--root', root]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.mode, 'patch');
  });
});
