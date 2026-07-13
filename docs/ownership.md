# Documentation Ownership

## Facts Of Record

- Source code: `src/`, `src-tauri/src/lib.rs`
- Config schema and examples: `app-data/default/links.toml`, `app-data/auto-test/links.toml`
- Tests: Rust tests in `src-tauri/src/lib.rs`, frontend tests in `src/link-tree.test.ts`, auto-test runner in `tools/run-auto-test.ps1`
- Product concepts: [docs/product.md#glossary](product.md#glossary), [docs/product.md#product-vision](product.md#product-vision)
- Architecture and config decisions: [docs/architecture.md#architecture-overview](architecture.md#architecture-overview), [docs/architecture.md#data-model](architecture.md#data-model), [docs/architecture/security.md](architecture/security.md)
- Tauri command API: [docs/api.md#tauri-commands-api](api.md#tauri-commands-api)
- Repeated AI mistakes and traps: [docs/ai.md#gotchas](ai.md#gotchas), [docs/ai.md#agent-rules](ai.md#agent-rules)
- Repo map: [docs/engineering/repo-map.md](engineering/repo-map.md)
- Code locator: [docs/engineering/code-locator.md](engineering/code-locator.md)

## Update Rules

- Public behavior or UI concept change: update [docs/product.md#glossary](product.md#glossary), [docs/product.md#product-vision](product.md#product-vision), and the owning architecture or engineering document if the decision is stable.
- Config schema or profile behavior change: update [docs/architecture/config.md](architecture/config.md), [docs/engineering.md#migrations](engineering.md#migrations), [docs/engineering.md#setup](engineering.md#setup), and example TOML files.
- Tauri command signature, payload, return, or side-effect change: update [docs/api.md#tauri-commands-api](api.md#tauri-commands-api), `src/tauri-api.ts`, and `src/types.ts`.
- Filesystem safety behavior change: update [docs/architecture/security.md](architecture/security.md), [docs/operations.md#rollback-and-recovery](operations.md#rollback-and-recovery), and relevant tests.
- Test command or strategy change: update [docs/engineering.md#testing](engineering.md#testing).
- Repeated AI mistake: update [docs/ai.md#gotchas](ai.md#gotchas) or [docs/ai.md#agent-rules](ai.md#agent-rules).
- Recurring or subtle problem solved: update [docs/engineering/code-locator.md](engineering/code-locator.md) with files involved, invariants/traps, and focused verification.

## Review Cadence

Review docs after any change that touches config, link operations, profile paths, filesystem mutation, tree grouping, logging, release paths, or test fixtures.




