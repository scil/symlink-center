# Repo Map

Use this map to understand the codebase structure: entry points, feature areas, frontend/backend ownership, config files, tests, and tooling. Line numbers drift, so search by the listed function/type names.

For problem-first entry points and past change recipes, see [Code Locator](code-locator.md).

## Entry Points

- Frontend app shell: `src/App.tsx`
- Frontend API wrappers: `src/tauri-api.ts`
- Shared frontend types: `src/types.ts`
- Reusable UI primitives: `src/components/ui.tsx`
- Rust command/backend logic: `src-tauri/src/lib.rs`
- Tauri config: `src-tauri/tauri.conf.json`
- Product concepts: `docs/product.md#glossary`
- Config/data model: `docs/architecture.md#data-model`
- Safety behavior: `docs/architecture/security.md`
- Main TOML config: active profile `links.toml`; debug default is `../app-data/default/links.toml`, release default is `app-data/default/links.toml` beside the exe
- Auto-test profile config: `../app-data/auto-test/links.toml`
- Auto-test runner: `../tools/run-auto-test.ps1`
- Config root/profile pointer: debug default is `../app-data/config-location.toml`, release default is `app-data/config-location.toml` beside the exe

## Naming Rules

Current config and code names:

- `primary_data_repo` / `primaryDataRepo`
- `data_repos` / `dataRepos`
- `data_repo_id` / `dataRepoId`
- `mapping_roots` / `mappingRoots`
- `MappingRoot`

Legacy config aliases are intentionally removed. Do not add aliases for:

- `mklink_root`
- `link_data_roots`
- `link_roots`
- `data_root_id`

## Frontend Feature Map

### App Layout, Navigation, Header

- `App` in `src/App.tsx`
- `NavButton`
- `SidebarResizeHandle`
- `SidebarLinkConcepts`
- State: `activeTab`, `sidebarWidth`, `env`, `linkSettings`

### Realtime Running Log

- `SidebarActivityLog`
- Activity types: `ActivityStatus`, `ActivityEntry`, `ActivityGroup`, `ExpandedActivity`
- Helpers: `startActivity`, `addActivity`, `finishActivity`, `describeTaskValue`, `describeTaskResult`
- Styling helpers: `activityTone`, `activityLabel`, `activityDotClass`, `activityTextClass`

### Soft-Link Main View

- `LinksView`
- Selection and bulk action state: `selected`, `targetConflictStrategy`, `removeLinkStrategy`
- Tree state: `treeMode`, `expandedGroups`, `expandedNodes`
- Action creation: `linkActionRequest`
- Child components:
  - `MappingTree`
  - `MappingRootSourceCell`
  - `MappingRootTargetCell`
  - `PathCell`

### Mapping Tree Construction

- `buildLinkTree`
- `buildLinkTreeNodes`
- `attachMappingRoots`
- `sortTreeNodes`
- `comparePathsByHierarchy`
- `commonParentPath`
- `relativePathParts`
- `pathForTreeMode`
- `isFreeLinkGroup`

### Enable/Delete Preview Dialog

- `PlanDialog`
- `PlanExplanation`
- `PlanInfoBox`
- `countPlanActions`
- Backend source: `preview_link_actions` -> `build_action_plan`
- Apply flow: `applyPlan` in `App`, `apply_link_actions` in Rust

### Data Repo Editing

- UI:
  - `DataRepoUpdateDialog`
  - Data Repo row handling inside `LinksView`
- API wrapper:
  - `api.upsertDataRepo`
- Rust:
  - `upsert_data_repo`
  - `upsert_data_repo_inner`
  - `effective_data_repos`
  - `resolve_data_repo`

### Mapping Source Move

- UI:
  - `MoveSourceDialog`
  - source column edit icon on link rows
- API wrapper:
  - `api.moveLinkSource`
- Rust:
  - `move_link_source`
  - `move_link_source_inner`
  - `move_path`
  - `remove_link_path`
  - `create_symlink`

### Config Panel

- UI:
  - Collapsible `"配置"` panel inside `LinksView`
  - State: `configOpen`, `configDir`, `newProfile`, `copyCurrentConfig`, `copyCurrentProfileConfig`
- API wrapper:
  - `api.updateConfigDir`
- Rust:
  - `update_config_dir`
  - `update_config_dir_inner`
  - `config_path`
  - `config_dir`
  - `config_location_path`
  - `load_config_location`
  - `save_config_location`

### Scan Data Repo / Mapping Root Changes

- UI:
  - `ScanChangesDialog`
  - `onScanDataRepo`
  - `onScanMappingRoot`
- API wrappers:
  - `api.scanDataRepoChanges`
  - `api.scanMappingRootChanges`
- Rust:
  - `scan_data_repo_changes`
  - `scan_data_repo_changes_inner`
  - `scan_mapping_root_changes`
  - `scan_mapping_root_changes_inner`
  - `list_direct_child_names`

### New Free Link Form

- UI:
  - `submitNewLink`
  - `initialNewLink`
  - new mapping form inside `LinksView`
- API wrapper:
  - `api.createLinkMapping`
- Rust:
  - `create_link_mapping`
  - `create_link_mapping_inner`
  - `resolve_source_path`
  - `backup_real_target`
  - `create_symlink`

### Backup Browser

- UI:
  - `BackupsView`
  - `BackupTree`
  - `BackupNodeRows`
  - `PreviewPanel`
- Tree helpers:
  - `buildBackupTree`
  - `buildBackupTreeNodes`
  - `sortBackupNodes`
  - `sumBackupSizes`
- API wrappers:
  - `api.listBackupEntries`
  - `api.readTextPreview`
  - `api.upsertBackupRoot`
- Rust:
  - `list_backup_entries`
  - `list_backup_entries_inner`
  - `collect_entries`
  - `effective_backup_roots`
  - `read_text_preview`
  - `read_text_preview_inner`
  - `upsert_backup_root`
  - `upsert_backup_root_inner`

### Persistent Operation Logs

- UI:
  - `LogsView`
  - `PreviewPanel`
- API wrappers:
  - `api.listOperationLogs`
  - `api.readOperationLog`
- Rust:
  - `list_operation_logs`
  - `list_operation_logs_inner`
  - `read_operation_log`
  - `write_operation_log`

### Open / Reveal Paths

- UI:
  - `onOpen`
  - `onReveal`
  - `IconButton`
  - `InlineIconButton`
- API wrappers:
  - `api.openPath`
  - `api.revealPath`
- Rust:
  - `open_path`
  - `open_path_inner`
  - `reveal_path`
  - `reveal_path_inner`

## Rust Backend Map

### Tauri Commands

Search `#[tauri::command]` in `src-tauri/src/lib.rs`. Command contracts are documented in [docs/api.md#tauri-commands-api](../api.md#tauri-commands-api).

- `scan_links`
- `preview_link_actions`
- `apply_link_actions`
- `create_link_mapping`
- `remove_link`
- `list_backup_entries`
- `read_text_preview`
- `open_path`
- `reveal_path`
- `list_operation_logs`
- `read_operation_log`
- `get_environment_summary`
- `get_link_settings`
- `update_config_dir`
- `switch_config_profile`
- `create_config_profile`
- `scan_data_repo_changes`
- `scan_mapping_root_changes`
- `update_primary_data_repo`
- `upsert_data_repo`
- `upsert_backup_root`
- `upsert_mapping_root`
- `export_mklink_script`
- `move_link_source`
- `update_link_metadata`
- `relaunch_as_admin`

### Config Parsing And Saving

- Data structures:
  - `LinksConfig`
  - `AppSettings`
  - `DataRepoConfig`
  - `MappingRootConfig`
  - `FreeLinkConfig`
  - `BackupRootConfig`
  - `ConfigLocation`
- Functions:
  - `load_config`
  - `save_config`
  - `config_path`
  - `config_dir`
  - `load_config_location`
  - `save_config_location`

### Link Spec Loading

- `load_link_specs`
- `resolve_source_path`
- `resolve_source_path_with_root`
- `resolve_path`
- `effective_data_repos`
- `resolve_data_repo`
- `effective_backup_roots`

### Status Classification

- `classify_link`
- `link_points_to`
- `read_link_target`
- `is_link_like`
- `metadata_kind`
- Types:
  - `LinkRecord`
  - `LinkSpec`
  - `LinkStatus`

### Preview And Apply Link Actions

- `build_action_plan`
- `append_enable_actions`
- `append_remove_actions`
- `apply_link_actions_inner`
- `apply_one_action`
- Types:
  - `ActionRequest`
  - `ActionPlan`
  - `LinkAction`
  - `AppliedAction`
  - `ActionKind`
  - `ActionSeverity`
  - `TargetConflictStrategy`
  - `RemoveLinkStrategy`

### Filesystem Safety

- `remove_link_path`
- `remove_real_path`
- `safe_backup_dir`
- `ensure_within_allowed_source_roots`
- `ensure_can_receive_data_repo`
- `paths_equivalent`
- `normalize_path_for_compare`
- `normalize_components`
- `create_parent_dir`

### Backup/Restore

- `backup_path_for`
- `backup_stem_for_target`
- `backup_real_target`
- `zip_directory`
- `restore_backup_to_target`
- `latest_backup_for_target`
- `copy_path`

### Windows Symlink Behavior

- `create_symlink`
- `can_create_symlink_quiet`
- `is_admin`
- `link_points_to`
- `read_link_target`

## Verification Commands

```powershell
npm run build
cd src-tauri
cargo test
```

Project directory and package name:

```text
symlink-management-and-config-decoupling
```

Rust crate name:

```text
symlink_management_and_config_decoupling
```

For app live reload:

```powershell
npm run tauri dev
```



