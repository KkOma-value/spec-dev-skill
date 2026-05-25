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
  return await mkdir(path.join(tmpdir(), `spec-dev-test-${Date.now()}-${Math.random().toString(16).slice(2)}`), {
    recursive: true,
  });
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
    schema_version: 1,
    phase: 'research',
    requirement: 'Add status query API',
    requirement_name: 'add-status-query-api',
    created_at: '2026-05-25T00:00:00.000Z',
    phases_completed: [],
    current_gate: null,
    artifacts: {
      prd: null,
      tech: null,
      spec: null,
      archive: null,
    },
    ...overrides,
  };
}

test('init creates project directories and research state', async () => {
  await withTempProject(async (root) => {
    const result = runCli(['init', '--root', root, '--requirement', '为订单服务新增按订单状态分页查询接口']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.phase, 'research');
    assert.deepEqual(result.json.required_reads, ['agents/researcher.md']);
    assert.equal(result.json.current_gate, null);

    const state = await readState(root);
    assert.equal(state.schema_version, 1);
    assert.equal(state.phase, 'research');
    assert.equal(state.requirement, '为订单服务新增按订单状态分页查询接口');
    assert.equal(state.requirement_name, 'wei-ding-dan-fu-wu-xin-zeng-an-ding-dan-zhuang-tai-fen-ye-cha-xun-jie-kou');
    assert.deepEqual(state.phases_completed, []);
  });
});

test('next returns minimal reads and expected output for each phase', async () => {
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
      phase: 'docs_confirm',
      reads: ['spec-dev/prd/add-status-query-api-prd.md', 'spec-dev/tech/add-status-query-api-tech.md'],
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
      ],
      expectedOutput: 'spec-dev/spec/add-status-query-api-tasks.md',
      gate: null,
    },
    {
      phase: 'dev',
      reads: ['spec-dev/spec/add-status-query-api-tasks.md'],
      expectedOutput: null,
      gate: null,
    },
    {
      phase: 'dev_confirm',
      reads: ['spec-dev/spec/add-status-query-api-tasks.md'],
      expectedOutput: null,
      gate: 'dev_confirm',
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
            spec: 'spec-dev/spec/add-status-query-api-tasks.md',
            archive: null,
          },
        }),
      );

      const result = runCli(['next', '--root', root]);

      assert.equal(result.status, 0, `${item.phase}: ${result.stderr}`);
      assert.equal(result.json.phase, item.phase);
      assert.deepEqual(result.json.required_reads, item.reads);
      assert.equal(result.json.expected_output, item.expectedOutput);
      assert.equal(result.json.current_gate, item.gate);
    });
  }
});

test('next returns absolute output file under project root independent of command cwd', async () => {
  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'prd', phases_completed: ['research'] }));

    const result = runCli(['next', '--root', root], { cwd: tmpdir() });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.project_root, path.resolve(root));
    assert.equal(result.json.expected_output, 'spec-dev/prd/add-status-query-api-prd.md');
    assert.equal(
      result.json.expected_output_file,
      path.join(root, 'spec-dev', 'prd', 'add-status-query-api-prd.md'),
    );
  });
});

test('next returns absolute read files aligned with required reads', async () => {
  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'spec',
        phases_completed: ['research', 'prd', 'tech', 'docs_confirm'],
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          spec: null,
          archive: null,
        },
      }),
    );

    const result = runCli(['next', '--root', root]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.json.required_reads, [
      'agents/spec-generator.md',
      'references/spec-template.md',
      'spec-dev/prd/add-status-query-api-prd.md',
      'spec-dev/tech/add-status-query-api-tech.md',
    ]);
    assert.deepEqual(result.json.required_read_files, [
      path.join(repoRoot, 'agents', 'spec-generator.md'),
      path.join(repoRoot, 'references', 'spec-template.md'),
      path.join(root, 'spec-dev', 'prd', 'add-status-query-api-prd.md'),
      path.join(root, 'spec-dev', 'tech', 'add-status-query-api-tech.md'),
    ]);
  });
});

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

test('advance stores absolute artifact paths as project-relative posix paths', async () => {
  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'prd', phases_completed: ['research'] }));
    const absolutePrd = path.join(root, 'spec-dev', 'prd', 'add-status-query-api-prd.md');

    const result = runCli(['advance', '--root', root, '--completed', 'prd', '--artifact', `prd=${absolutePrd}`]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.artifacts.prd, 'spec-dev/prd/add-status-query-api-prd.md');

    const state = await readState(root);
    assert.equal(state.artifacts.prd, 'spec-dev/prd/add-status-query-api-prd.md');
  });
});

test('advance rejects artifact paths outside project root', async () => {
  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'prd', phases_completed: ['research'] }));
    const outsidePath = path.join(tmpdir(), `spec-dev-outside-${Date.now()}.md`);

    const result = runCli(['advance', '--root', root, '--completed', 'prd', '--artifact', `prd=${outsidePath}`]);

    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'ARTIFACT_OUTSIDE_ROOT');
    assert.equal(result.json.error.kind, 'prd');
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

test('advance enters gates for tech and dev completions', async () => {
  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'tech',
        phases_completed: ['research', 'prd'],
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: null,
          spec: null,
          archive: null,
        },
      }),
    );

    const tech = runCli(['advance', '--root', root, '--completed', 'tech', '--artifact', 'tech=spec-dev/tech/add-status-query-api-tech.md']);
    assert.equal(tech.status, 0, tech.stderr);
    assert.equal(tech.json.phase, 'docs_confirm');
    assert.equal(tech.json.current_gate, 'docs_confirm');

    await writeState(
      root,
      baseState({
        phase: 'dev',
        phases_completed: ['research', 'prd', 'tech', 'docs_confirm', 'spec'],
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          spec: 'spec-dev/spec/add-status-query-api-tasks.md',
          archive: null,
        },
      }),
    );

    const dev = runCli(['advance', '--root', root, '--completed', 'dev']);
    assert.equal(dev.status, 0, dev.stderr);
    assert.equal(dev.json.phase, 'dev_confirm');
    assert.equal(dev.json.current_gate, 'dev_confirm');
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
          spec: null,
          archive: null,
        },
      }),
    );

    const wrong = runCli(['gate', '--root', root, '--confirm', 'dev_confirm']);
    assert.notEqual(wrong.status, 0);
    assert.equal(wrong.json.error.code, 'GATE_MISMATCH');

    const confirmed = runCli(['gate', '--root', root, '--confirm', 'docs_confirm']);
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.equal(confirmed.json.phase, 'spec');
    assert.equal(confirmed.json.current_gate, null);

    const state = await readState(root);
    assert.deepEqual(state.phases_completed, ['docs_confirm']);
  });
});

test('archive creates a dated markdown summary with task counts', async () => {
  await withTempProject(async (root) => {
    await writeState(
      root,
      baseState({
        phase: 'archive',
        phases_completed: ['research', 'prd', 'tech', 'docs_confirm', 'spec', 'dev', 'dev_confirm'],
        artifacts: {
          prd: 'spec-dev/prd/add-status-query-api-prd.md',
          tech: 'spec-dev/tech/add-status-query-api-tech.md',
          spec: 'spec-dev/spec/add-status-query-api-tasks.md',
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
          spec: 'spec-dev/spec/add-status-query-api-tasks.md',
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
          spec: null,
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
          spec: null,
          archive: null,
        },
      }),
    );

    const result = runCli(['validate', '--root', root]);
    assert.notEqual(result.status, 0);
    assert.equal(result.json.error.code, 'ARTIFACT_NOT_FOUND');
    assert.deepEqual(result.json.error.missing, [
      'spec-dev/prd/add-status-query-api-prd.md',
      'spec-dev/tech/add-status-query-api-tech.md',
    ]);
  });

  await withTempProject(async (root) => {
    await writeState(root, baseState({ phase: 'done' }));
    const result = runCli(['validate', '--root', root]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.valid, true);
    assert.equal(result.json.phase, 'done');
  });
});
