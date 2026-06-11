# spec-dev

`spec-dev` is a zero-dependency Codex / Claude Code skill for governed software delivery. It turns a natural-language requirement into research, three core documents, task planning, frontend-first implementation, backend work, quality checks, and a final delivery report.

## Pipeline

```mermaid
flowchart LR
  A[research] --> B[docs]
  B --> C{{docs_confirm}}
  C -->|confirm| D[spec]
  C -->|revise| B
  D --> E[pre_code]
  E --> F[frontend]
  F --> G{{preview_confirm}}
  G -->|confirm| H[backend]
  G -->|revise| F
  H --> I[quality]
  I --> J[delivery]
  J --> K[done]
```

`evolve` and `patch` modes start with `baseline`, then continue through the same governed flow.

## What It Produces

```text
{project}/.spec-dev/
├── state.json
├── SESSION_BRIEF.md
├── PRE_CODE_CHECKLIST.md
└── changes/{requirement_name}/
    ├── proposal.md
    └── tasks.md

{project}/output/
├── {requirement_name}-research.md
├── {requirement_name}-prd.md
├── {requirement_name}-architecture.md
├── {requirement_name}-uiux.md
├── {requirement_name}-quality-report.md
└── {YYYY-MM-DD}-{requirement_name}-delivery.md
```

## Work Modes

| Mode | Start | Use case |
|------|-------|----------|
| `new` | `research` | New feature or product work |
| `evolve` | `baseline` | Incremental work on an existing project |
| `patch` | `baseline` | Bug fixes and remediation work |

## Install

```bash
# Codex
git clone https://github.com/KkOma-value/spec-dev-skill.git ~/.codex/skills/spec-dev

# Claude Code
git clone https://github.com/KkOma-value/spec-dev-skill.git ~/.claude/skills/spec-dev
```

Requires Node.js 18+. No `npm install` is needed.

## Use

```text
/spec-dev Add paginated order-status query API
/spec-dev Fix login redirect loop --mode patch
/spec-dev Add export to CSV --mode evolve
```

Plain text also works: `$spec-dev ...`, `spec-dev: ...`, `spec-dev：...`.

## CLI Reference

```bash
node scripts/spec-dev.mjs init --root <dir> --requirement "<text>" [--mode new|evolve|patch]
node scripts/spec-dev.mjs next --root <dir>
node scripts/spec-dev.mjs advance --root <dir> --completed <phase> [--artifact <kind=path>]
node scripts/spec-dev.mjs gate --root <dir> --confirm <docs_confirm|preview_confirm>
node scripts/spec-dev.mjs deliver --root <dir>
node scripts/spec-dev.mjs archive --root <dir>   # compatibility alias for deliver
node scripts/spec-dev.mjs validate --root <dir>
```

Artifact kinds: `research`, `prd`, `architecture`, `uiux`, `proposal`, `tasks`, `quality`, `delivery`.

## Example Session

```bash
node scripts/spec-dev.mjs init --root . --requirement "Add order status query"
node scripts/spec-dev.mjs advance --root . --completed research --artifact research=output/add-order-status-query-research.md
node scripts/spec-dev.mjs advance --root . --completed docs --artifact prd=output/add-order-status-query-prd.md --artifact architecture=output/add-order-status-query-architecture.md --artifact uiux=output/add-order-status-query-uiux.md
node scripts/spec-dev.mjs gate --root . --confirm docs_confirm
node scripts/spec-dev.mjs advance --root . --completed spec --artifact proposal=.spec-dev/changes/add-order-status-query/proposal.md --artifact tasks=.spec-dev/changes/add-order-status-query/tasks.md
node scripts/spec-dev.mjs advance --root . --completed pre_code
node scripts/spec-dev.mjs advance --root . --completed frontend
node scripts/spec-dev.mjs gate --root . --confirm preview_confirm
node scripts/spec-dev.mjs advance --root . --completed backend
node scripts/spec-dev.mjs advance --root . --completed quality --artifact quality=output/add-order-status-query-quality-report.md
node scripts/spec-dev.mjs deliver --root .
```

## Design Principles

| Principle | Implementation |
|-----------|----------------|
| Zero dependencies | `scripts/spec-dev.mjs` uses only Node.js built-ins |
| Small context | Each phase returns only the files needed for that phase |
| Persistent state | `.spec-dev/state.json` supports recovery across sessions |
| Hard gates | Docs, pre-code, preview, and quality gates prevent skipped work |
| Frontend first | UI work is completed and confirmed before backend implementation |
| Traceability | Research, PRD, architecture, UI/UX, tasks, quality, and delivery are linked |

## Testing

```bash
node --test test/spec-dev.test.mjs
```

## License

[MIT](LICENSE)
