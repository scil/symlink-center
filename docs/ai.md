# AI Agent Context

This file owns compact project navigation anchors, agent operating rules, and gotchas. Reusable task prompts and documentation evals live under `docs/ai/prompts/` and `docs/ai/evals/` because they are executable assets, not project facts.

## Agent Rules

### Scope

This file is an agent operating guardrail. It should not repeat product, architecture, config, safety, testing, repo-map, or code-locator facts that already have owning documents.

### Working Session Rules

- At the start of each working session, before the first edit, read this file once and follow these Agent Rules.
- Re-read this file if `AGENTS.md` or `docs/ai.md` changes, if the working context is reset or compacted, or if you are unsure you have the current rules.
- Treat source code, tests, config examples, and the owning docs listed in [docs/ownership.md](ownership.md) as facts of record.
- Use [docs/ai.md#ai-context-map](#ai-context-map) to find the owning document before changing behavior.
- When documentation must be created, updated, or checked for impact, use the `docs-maintainer` skill and follow its Updating Documentation and Cross-Cutting Change Rule.
- Update the owning document in the same change when behavior moves.
- Add focused regression tests for subtle config, filesystem, status, export, or tree/grouping bugs.

## AI Context Map

### Project Entry Points

Use these as project-specific navigation anchors, not a required reading list. After applying Document Routing, read only the entries relevant to the task.

- `docs/product.md#glossary`: project vocabulary and naming.
- `docs/product/frontend-ux.md`: implemented UI behavior and copy.
- `docs/engineering/code-locator.md`: problem-to-file implementation entry points.
- `src-tauri/src/lib.rs`: backend facts of record.
- `src/App.tsx`: frontend facts of record.
- `app-data/default/links.toml`: default profile example.
- `app-data/auto-test/links.toml`: auto-test profile example.

### Document Routing

Use the `docs-maintainer` skill's Annotated Structure to choose the owning document for product, architecture, API, config, security, operations, engineering, and AI-rule changes.

Use [docs/engineering/code-locator.md](engineering/code-locator.md) when you need problem-to-file implementation entry points, invariants, or focused verification commands.

## Gotchas

This document captures repeated mistakes and hidden traps. Keep canonical product, architecture, config, API, safety, and testing facts in their owning docs; use this file to prevent repeat errors.

### Config

- Do not assume `CARGO_MANIFEST_DIR` is the repo root; it is `src-tauri`.
- Do not confuse config root with active profile directory.
- Do not forget that `config-location.toml` can override both config root and active profile.
- Do not reintroduce legacy config aliases.
- Do not use raw backslashes in double-quoted TOML Windows paths.
- Do not treat `free_links` as a separate product concept from Free Links; it is the TOML table name for Free Links.
- Release default config is `exe_dir/app-data/default/links.toml`.

### Mapping Tree

- Do not flatten mappings under Data Repos.
- Do not flatten Independent Mapping Root mappings directly under the Virtual Data Repo group.
- Do not show every path level for Free Links.
- Duplicate source paths can map to different targets; tree nodes need multiple terminal mappings.

### UI

- Do not hide Mapping Root actions only in generic row actions; source/target-specific actions belong near source/target paths.
- Do not let React development StrictMode produce duplicate user-visible refresh logs; guard initial effects and in-flight refresh work.

### Safety

- Do not delete source data in Data Repos when removing links.
- Free Link source inside a Data Repo is not a Free Link; scan Data Repo or Mapping Root instead.

### Export

- Do not let disabled export entries execute prelude commands.

### Backup Browser

- Do not scan arbitrary project files in the backup browser; only scan configured backup roots.

### PowerShell And Windows Paths

- PowerShell `$args[0]` with `-Command` can be unreliable from Rust; quote paths safely and capture stderr.
