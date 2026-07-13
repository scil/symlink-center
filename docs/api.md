# API

Every API section states whether it documents provided APIs, consumed APIs, or both.

## API Documentation

This app does not expose an HTTP API. Its provided API is the Tauri command boundary between the React frontend and Rust backend.

### Provided APIs

- [docs/api.md#tauri-commands-api](#tauri-commands-api): Rust commands exposed to the frontend through Tauri `invoke`.

### Consumed APIs

None currently. The app uses local filesystem and Windows shell integrations through the Rust backend.

## Tauri Commands API

This document records the provided API between the React frontend and Rust backend.

- Direction: Provided API.
- Transport: Tauri `invoke`.
- Frontend wrapper: `src/tauri-api.ts`.
- Rust handlers: `#[tauri::command]` functions in `src-tauri/src/lib.rs`.
- Payload types: frontend types in `src/types.ts`; Rust structs in `src-tauri/src/lib.rs`.

Commands that mutate files, links, config, profiles, or logs must be treated as filesystem-affecting APIs. Risky link operations should use preview/confirmation flows where applicable.

### Environment And Config

| Command | Frontend wrapper | Purpose | Mutates filesystem/config |
| --- | --- | --- | --- |
| `get_environment_summary()` | `api.getEnvironmentSummary()` | Return repo path, config root/path, active profile, admin status, and symlink capability. | No |
| `get_link_settings()` | `api.getLinkSettings()` | Return Data Repos, Mapping Roots, backup roots, and settings for the active profile. | No |
| `update_config_dir(input)` | `api.updateConfigDir(input)` | Change the config root and optionally copy current config into the selected profile. | Yes |
| `switch_config_profile(input)` | `api.switchConfigProfile(input)` | Switch the active profile. | Yes |
| `create_config_profile(input)` | `api.createConfigProfile(input)` | Create a profile, optionally copy current config, and activate it. | Yes |
| `update_primary_data_repo(input)` | `api.updatePrimaryDataRepo(input)` | Change the Primary Data Repo, optionally move data and rebuild links. | Yes |

### Mapping Scan And Actions

| Command | Frontend wrapper | Purpose | Mutates filesystem/config |
| --- | --- | --- | --- |
| `scan_links()` | `api.scanLinks()` | Scan configured mappings and return link statuses defined in [docs/architecture.md#link-status-classification](architecture.md#link-status-classification). | No |
| `preview_link_actions(request)` | `api.previewLinkActions(request)` | Build an enable/remove plan before applying it. | No |
| `apply_link_actions(request)` | `api.applyLinkActions(request)` | Apply a confirmed enable/remove plan and write an operation log. | Yes |
| `create_link_mapping(input)` | `api.createLinkMapping(input)` | Create a new Free Link mapping, handling target conflicts according to input. | Yes |
| `remove_link(link_id)` | `api.removeLink(linkId)` | Remove only the target link/reparse point for one mapping. | Yes |
| `move_link_source(input)` | `api.moveLinkSource(input)` | Move a mapping source, update config, and relink the target. | Yes |
| `update_link_metadata(input)` | `api.updateLinkMetadata(input)` | Edit a mapping ID and display name. | Yes |

### Data Repo, Mapping Root, And Backup Roots

| Command | Frontend wrapper | Purpose | Mutates filesystem/config |
| --- | --- | --- | --- |
| `upsert_data_repo(input)` | `api.upsertDataRepo(input)` | Create or update a Data Repo. | Yes |
| `upsert_mapping_root(input)` | `api.upsertMappingRoot(input)` | Create or update a Mapping Root. For Independent Mapping Roots, `dataRepoId` is `virtual-independent-mapping-roots` and `cleanupFreeLinkIds` must match the latest cleanup preview when overlapping Free Links exist. | Yes |
| `preview_standalone_mapping_root_cleanup(input)` | `api.previewStandaloneMappingRootCleanup(input)` | Validate an Independent Mapping Root source and list Free Link records that would be removed from config after confirmation. | No |
| `upsert_backup_root(input)` | `api.upsertBackupRoot(input)` | Create or update a backup/settings browser root. | Yes |
| `scan_data_repo_changes(data_repo_id)` | `api.scanDataRepoChanges(dataRepoId)` | Scan Data Repo directory changes and report differences for user review. | No |
| `scan_mapping_root_changes(mapping_root_id)` | `api.scanMappingRootChanges(mappingRootId)` | Scan one Mapping Root source directory and report changes for user review. | No |

### Backup Browser And Logs

| Command | Frontend wrapper | Purpose | Mutates filesystem/config |
| --- | --- | --- | --- |
| `list_backup_entries()` | `api.listBackupEntries()` | List configured backup/settings roots as tree entries. | No |
| `read_text_preview(path)` | `api.readTextPreview(path)` | Read previewable text-like files for display. | No |
| `list_operation_logs()` | `api.listOperationLogs()` | List persistent operation logs. | No |
| `read_operation_log(path)` | `api.readOperationLog(path)` | Read one persistent operation log. | No |

### Shell Integration

| Command | Frontend wrapper | Purpose | Mutates filesystem/config |
| --- | --- | --- | --- |
| `open_path(path)` | `api.openPath(path)` | Open a file or directory in the system shell. | No |
| `reveal_path(path)` | `api.revealPath(path)` | Reveal a file or directory in Explorer. | No |
| `relaunch_as_admin()` | `api.relaunchAsAdmin()` | Request Windows UAC and relaunch the current app with administrator rights. | Starts a new elevated process |

### Export

| Command | Frontend wrapper | Purpose | Mutates filesystem/config |
| --- | --- | --- | --- |
| `export_mklink_script(input)` | `api.exportMklinkScript(input)` | Export mappings as a grouped mklink script/Markdown file. | Yes |

The export output is a Markdown file containing a `bat` code block for browsing, review, and copy/paste. It must include enabled and disabled mappings, clearly comment disabled/source-missing mappings so they do not execute if pasted as-is, and comment the whole prelude block when a disabled/source-missing mapping has prelude commands.

Export grouping follows Data Repos, Mapping Root folders, non-Mapping-Root links, and free links outside Data Repos. Mapping Root export can either call `tools/mklink-by-Mapping-Root.bat` through a configurable `MAPPING_ROOT_TOOL` variable or expand Mapping Roots into individual `mklink` commands.

Target conflict export options are `none`, `delete`, and `backup`. Backup mode defines `MKLINK_BACKUP_DIR` near the top and moves existing target objects there before `mklink`. Helper script mode maps delete strategy to `AUTO` and backup/none strategy to `MANUAL`.

### Safety Notes

- `preview_link_actions` should be used before applying bulk enable/remove operations.
- `apply_link_actions`, `create_link_mapping`, `move_link_source`, and Data Repo changes can create, remove, move, copy, or back up filesystem objects.
- Link removal must only remove target links/reparse points unless the user explicitly chooses a restore/copy strategy in a confirmed flow.
- Directory symlink creation on Windows may require administrator rights or Developer Mode; `relaunch_as_admin` exists for this path.
- Config behavior is documented in `docs/architecture/config.md`.
- Filesystem safety rules are documented in `docs/architecture/security.md`.



