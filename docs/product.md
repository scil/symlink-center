# Product

This file owns compact product context for this project. Split product docs only when a product contract is large or independently maintained.

## Product Vision

### Product

- Chinese name: `系统盘瘦身与配置中心`
- English name: System Drive Slimming and Config Center
- Subtitle: `软链接管理、配置独立化`
- Directory and npm package slug: `symlink-management-and-config-decoupling`
- Rust crate: `symlink_management_and_config_decoupling`
- Primary platform: Windows.

### Goal

Help Windows users move application data and settings out of system-drive locations while keeping applications working through symbolic links.

### Primary Capabilities

- Manage symbolic-link mappings.
- Browse configured backup/settings roots.
- Keep real data in one or more Data Repos.
- Support one-to-one Free Links.
- Support batch Mapping Roots.
- Preview dangerous file operations before applying them.
- Show real-time and persistent logs.

### Non-Goals

- Do not call `restic` or `resticprofile`.
- Do not implement cloud backup.
- Do not produce release bundles during normal debug iterations unless explicitly requested.

### Success Criteria

- Users understand where real data lives and where target links appear.
- Dangerous operations require preview or confirmation.
- Source data is not deleted when removing links.
- Config profiles can be switched and tested safely.
- AI agents can locate project facts without re-deriving them from code each time.

## Users And Workflows

### Primary User

A Windows user who wants to keep application settings and data outside the system drive while preserving the original paths applications expect.

### Core Jobs

- Move one app profile to another drive with a Free Link.
- Organize many real data folders under a Data Repo.
- Use Mapping Roots to link many child folders into Windows locations.
- Inspect backup/settings files.
- Preview and safely apply filesystem operations.

### Important Workflows

1. Refresh UI state from TOML.
2. Scan Data Repo or Mapping Root changes.
3. Preview enable/remove actions.
4. Apply confirmed actions.
5. Review real-time and persistent logs.
6. Switch profiles for normal use or auto testing.

## Glossary

### 3. Core Domain Model

- `Data Repo`
  - A root directory that stores real files/directories.
  - There can be multiple Data Repos.
  - A Data Repo can be anywhere on disk, not only under the app directory.
- `Virtual Data Repo`
  - A UI-only table grouping for Independent Mapping Roots.
  - It is not a real Data Repo, does not own a physical repository root, and must not show Data Repo-only operations.
  - In source grouping, its first-level rows are Independent Mapping Roots; generated link mappings appear under their owning root.
- `Primary Data Repo`
  - The default Data Repo used when a mapping does not explicitly choose another one.
  - Config field: `settings.primary_data_repo`.
- `Mapping Root`
  - A batch mapping rule.
  - Its child entries create same-name symbolic links in the configured target directory.
  - Example: source `AppData_Local` under a Data Repo maps children into `%LOCALAPPDATA%`.
  - Config table: `[[mapping_roots]]`.
- `独立 Mapping Root` / `Independent Mapping Root`
  - A Mapping Root whose source is outside every configured Data Repo.
  - It belongs to the reserved virtual group `Virtual Data Repo` instead of a real Data Repo.
  - When creating one, overlapping Free Link records under the new source directory must be previewed and removed from the active profile only after user confirmation.
- Free link
  - User-facing concept for explicit one-to-one mappings whose source is outside every configured Data Repo.
  - It must remain supported because some real mappings point to locations such as `D:/A/Scoop/persist/...` or `O:/Users/...`.
  - If a source is already inside a Data Repo, it is not a free link. The user should scan the Data Repo or Mapping Root and refresh the list instead of creating a free link.
- `free_links`
  - Official TOML storage table for Free links.
  - This is the schema name for the same concept, not a separate mapping type.
  - New UI should say `自由链接` / `Free link`.
- Backup/settings root
  - A configured root used by the backup browser.
  - Default root name/path: `backup-or-settings`.

### Other Core Terms

- **Target**: The path where Windows applications expect files to appear. This is usually where the link is created.
- **Source**: The real file or directory that stores data.
- **Profile**: A named configuration folder containing `links.toml`. The default profile is `default`.
- **Auto-test profile**: The `auto-test` profile used for isolated symlink tests under `app-data/auto-test-runtime`.
- **Refresh**: Reload UI state according to the current TOML configuration.
- **Scan**: Inspect Data Repo or Mapping Root filesystem changes and show proposed differences.

### Naming Rules

- Use `Free Link`, `free_links`, `FreeLinkConfig`, and `自由链接` for the same concept at product/schema/code/UI layers.
- Use `Data Repo` with this exact capitalization in user-facing text.
- Use `Virtual Data Repo` with this exact capitalization for the virtual source-group label that contains Independent Mapping Roots.
- Use `Mapping Root` with this exact capitalization.
- Use `独立 Mapping Root` in Chinese UI text and `Independent Mapping Root` in English prose for Mapping Roots outside every Data Repo.
- Use these exact Chinese UI strings where the target-conflict setting is described:
  - `启用时如果目标已有真实内容`
  - `如果目标已有真实内容`
- Avoid vague labels such as `已配置的映射` unless the UI explains that it means mappings from the active profile config plus Mapping Root expansion.

Detailed implemented UI behavior and copy requirements live in [docs/product/frontend-ux.md](product/frontend-ux.md).

## Requirements

- [Frontend UX Requirements](product/frontend-ux.md): implemented frontend layout, UI behavior, copy, and interaction contract.

Accepted or implemented requirements should state their status and link to facts of record such as source files, schemas, tests, API docs, security docs, and glossary entries.



