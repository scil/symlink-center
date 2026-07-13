# Engineering

This file owns compact engineering workflow context. The structural repo map lives in [Repo Map](engineering/repo-map.md); problem-first recipes live in [Code Locator](engineering/code-locator.md).

## Setup

### Install

```powershell
npm install
```

### Run Desktop App

```powershell
npm run tauri dev
```

### Run Frontend Only

```powershell
npm run dev
```

Frontend dev URL:

```text
http://127.0.0.1:1420
```

### Config Location

During debug, the app base is the project root. The default config root is:

```text
app-data
```

Debug default profile:

```text
app-data/default/links.toml
```

Debug config pointer:

```text
app-data/config-location.toml
```

Release runtime layout is documented in [Release](#release). Config schema and path rules are documented in [Config Model](architecture/config.md).

## Engineering Conventions

### Naming

- Use `Free Link`, `free_links`, `FreeLinkConfig`, `isFreeLink`.
- Use `Data Repo` and `Mapping Root` exactly in UI text.
- Do not reintroduce legacy aliases or old `custom` names.

### Frontend

- Use lucide icons for buttons.
- Put source actions near source paths and target actions near target paths.
- Keep tree algorithms pure where possible and test them.

### Backend

- Rust owns filesystem work.
- Use structured path/config helpers instead of ad hoc string manipulation.
- Return useful error details from shell/PowerShell calls.

### Docs

- Update docs after config schema, safety, testing, release, or repeated AI mistake changes.

## Debugging

### Useful Checks

```powershell
npm run build
npm run test:frontend
cd src-tauri
cargo test
```

### Common Diagnosis Paths

- Duplicate refresh logs: check `React.StrictMode`, initial refresh guard, and in-flight refresh guard.
- Missing link row in tree: check `src/link-tree.ts` and duplicate terminal mappings.
- Config path surprise: check `app-data/config-location.toml`, active profile, and `default_config_dir()`.
- PowerShell archive failure: inspect stderr and path quoting in `src-tauri/src/lib.rs`.

## Implementation Order For A Fresh Build

This is an engineering playbook for building the app from a fresh repository or major rewrite. It is not a product backlog and not the source of truth for current behavior.

For current facts, follow the linked owning docs: product vocabulary, architecture overview, config model, Tauri command API, safety rules, and testing strategy.

### Order

1. Scaffold Tauri 2 + React + TypeScript + Vite + Tailwind + Rust.
2. Establish product naming, package name, Tauri product name, and Rust crate name.
3. Implement config profiles and TOML schema.
4. Implement path resolution and Windows path/TOML parsing guidance.
5. Implement Rust link scanning and status classification.
6. Implement preview/apply action planning with safety strategies.
7. Implement Data Repo, Mapping Root, Free Link, and backup root CRUD commands. Store Free Links in `[[free_links]]`.
8. Implement source migration and link rebuild.
9. Implement backup browser tree and text preview.
10. Implement operation logs and real-time UI running logs.
11. Implement mapping table with source/target grouping, expandable trees, and Data Repo/Mapping Root rows.
12. Implement export script generation and options.
13. Add `auto-test` profile and runner.
14. Add docs, repo map, code locator, tests, and build checks.

### Owning References

- Product naming and vocabulary: [docs/product.md#glossary](product.md#glossary).
- Architecture boundaries and backend responsibilities: [docs/architecture.md#architecture-overview](architecture.md#architecture-overview).
- Config profiles and TOML schema: [docs/architecture/config.md](architecture/config.md).
- Link status classification: [docs/architecture.md#link-status-classification](architecture.md#link-status-classification).
- Tauri command API: [docs/api.md#tauri-commands-api](api.md#tauri-commands-api).
- Filesystem safety rules: [docs/architecture/security.md](architecture/security.md).
- Required tests and checks: [docs/engineering.md#testing](#testing).
- Repo map: [docs/engineering/repo-map.md](engineering/repo-map.md).
- Code locator: [docs/engineering/code-locator.md](engineering/code-locator.md).

## Migrations

### Config Schema

Current schema uses:

- `primary_data_repo`
- `data_repos`
- `data_repo_id`
- `mapping_roots`
- `backup_roots`
- `free_links`

Legacy aliases are removed and should not be silently supported.

### Profile Migration

Old `app-data/links.toml` is migrated to `app-data/default/links.toml`.

### Completed Naming Migration

Old `custom_links` naming was removed from code, docs, and profile TOML. Use `free_links`.

## Release

### Build Package

```powershell
npm run tauri build
```

### Debug Rule

During normal UI/debug work, do not build release bundles unless explicitly requested. Use:

```powershell
npm run build
```

### Release Config Default

The release app base is the executable directory. The default config root is:

```text
exe_dir/app-data
```

The release executable reads the default profile from:

```text
exe_dir/app-data/default/links.toml
```

Release config pointer:

```text
exe_dir/app-data/config-location.toml
```

Config schema and path rules are documented in [Config Model](architecture/config.md).

## Testing

This document is the owning reference for required tests and checks. Other docs should link here instead of duplicating the full test matrix.

### Check Commands

Frontend build check:

```powershell
npm run build
```

Frontend unit test check:

```powershell
npm run test:frontend
```

Rust test check:

```powershell
cd src-tauri
cargo test
```

Isolated symlink auto-test:

```powershell
npm run test:auto-profile
```

The npm command runs `tools/run-auto-test.ps1`.

During ordinary debug work, do not build release bundles or exe files unless requested. Use release packaging only for explicit release/output tasks.

### Auto-test Profile

The auto-test profile is stored at `app-data/auto-test/links.toml` and must use only project-local temporary paths under `app-data/auto-test-runtime`.

The auto-test runner creates temporary sources and targets, creates test links, verifies links, removes links created during the test, removes temporary runtime data unless explicitly kept, and prints created/deleted paths.

On systems without true symlink privileges, directory links may fall back to junctions and must be reported as `junction-fallback`.

### Rust Unit Tests

Rust unit tests should cover:

- environment variable/path expansion
- TOML parsing, including single-quoted Windows paths
- config profile listing and migration
- Mapping Root expansion
- external/free link formatting
- status classification, as defined in [docs/architecture.md#link-status-classification](architecture.md#link-status-classification)
- export script structure
- disabled export block commenting

### Integration-Style Tests

Integration-style tests should use temporary directories to cover:

- file links
- directory links
- real target content
- wrong target
- broken link
- source missing
- remove link
- source migration

### Frontend Unit Tests

Frontend unit tests should cover tree-building behavior:

- source and target grouping
- compressed Free Link source folders
- hierarchy sorting with shallow parents before deep descendants
- duplicate-source Free Links, where two or more mappings share the same source but have different targets
- consistency between group/status counts and rendered leaf link count

### Required Coverage Themes

Every subtle config, filesystem, status, export, or tree/grouping bug should get a focused regression test.

High-risk themes:

- config parsing and profile listing
- Windows path handling and TOML path examples
- link status classification
- export script generation
- directory backup/restore
- Free Link metadata updates
- tree grouping, especially duplicate-source Free Links



