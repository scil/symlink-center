# Frontend UX Requirements

Status: Implemented.

This document is the product/UI behavior contract for the implemented frontend. It records layout, copy, interaction, and workflow requirements that future UI changes must preserve unless this requirement is intentionally revised.

Facts of record:

- `src/App.tsx`: app shell, dialogs, table layout, tabs, sidebar logs, and refresh orchestration.
- `src/link-tree.ts`: source/target grouping and tree-building behavior.
- `src/types.ts`: frontend data contracts.
- `src-tauri/src/lib.rs`: backend command behavior invoked by the UI.

Related owning docs:

- Terms and naming: [Glossary](../product.md#glossary).
- Filesystem safety: [Security And Safety](../architecture/security.md).
- Backend command boundary: [Tauri Commands API](../api.md#tauri-commands-api).
- Logs: [Monitoring And Logs](../operations.md#monitoring-and-logs).
- Required checks: [Testing](../engineering.md#testing).

## 1. App Shell

The header shows:

- product name
- subtitle
- current repo path
- global Profile selector
- admin/symlink capability badges
- refresh button

The sidebar shows:

- tabs for soft links, backup browser, and logs
- real-time running log
- core concept definitions when the soft-link tab is active

The sidebar is user-resizable. Its maximum width is half the screen.

## 2. Real-Time Running Log

The real-time log belongs in the sidebar. It is separate from persistent operation logs.

The real-time log must be grouped or tree-like and expandable. It should log:

- environment loading
- config/profile loading
- symlink scan
- backup scan
- log scan
- Tauri command calls with concrete command names
- preview plans
- applied actions
- warnings/errors

## 3. Soft-Link Mapping UI

### 3.1 Table Structure

The mapping table columns are:

- select
- `分组/目录`
- status
- source
- target
- operations

The second column includes the grouping mode switch:

- `按源`
- `按目标`

The default grouping mode is `按源`.

Every directory level should be expandable/collapsible. Directory sorting should reflect hierarchy, with shallower paths before deeper descendants.

### 3.2 Data Repo Rows

Data Repo rows appear as top-level groups.

The source column must show the absolute Data Repo path and include an edit icon for the Data Repo location.

The operation column supports:

- open Data Repo in Explorer
- scan Data Repo changes
- create Mapping Root
- preview enable/delete group

Data Repo path editing is done directly from the table, not hidden in a separate page. Changing a Data Repo path must ask whether to migrate old data and whether to rebuild links.

### 3.2.1 Virtual Data Repo Group

When grouping by source, top-level groups are Free Link, real Data Repo, and Virtual Data Repo groups.

Independent Mapping Roots appear under the virtual top-level group `Virtual Data Repo`. The group must show Independent Mapping Root rows as its first-level nodes; generated link mappings belong under their owning Independent Mapping Root, not directly under `Virtual Data Repo`.

This group uses the reserved id `virtual-independent-mapping-roots`; it is not a real Data Repo and should not show Data Repo-only actions such as open Data Repo, scan Data Repo, or create Mapping Root from Data Repo.

The group operation column supports preview enable/delete group. Mapping Root folder rows inside the group keep Mapping Root source actions such as open source, scan, and edit.

### 3.3 Mapping Root Rows

Do not add fake standalone records for Mapping Roots when grouping by target.

When grouping by source, put Mapping Root actions on the corresponding folder node.

Mapping Root creation belongs in the Data Repo row operation column. Mapping Root editing belongs in the Mapping Root folder row operation column.

Source column layout:

- line 1: `Mapping Root`
- line 2: source path
- line 3: source-side icon actions, such as open source and scan

Target column layout:

- line 1: target path
- line 2: target-side icon actions, such as open target

Source/target icon actions should be borderless inline icons. Other columns should be top-aligned, not vertically centered.

Mapping Root form fields:

- id
- label
- Data Repo
- source
- target
- mode: `children` or `direct`
- enabled
- ignore list

The create area also has a `新建独立 Mapping Root` tab. Its source must be outside every configured Data Repo and must be absolute or expand to an absolute path.

Before saving a new Independent Mapping Root, the UI previews Free Link records whose sources are inside the new source directory. If any are found, show a confirmation dialog and delete those Free Link records from the active profile `links.toml` only after confirmation.

### 3.4 Free Links

Free links use group label:

- `自由链接(源不在 Data Repo)`

Free links default collapsed. Do not expand every directory level for free links by default.

When grouping by source:

- if multiple free links share a meaningful parent directory, show a compressed folder group
- example: both `D:\A\Scoop\persist\Espanso\.espanso` and `D:\A\Scoop\persist\anki\data` should group under `D:\A\Scoop\persist`
- unrelated single free links should stay simple

The free-link source tree must support multiple mappings with the exact same source path.

Example: `D:\A\Scoop\persist\Espanso\.espanso` may link to both `%APPDATA%\espanso` and `D:\A\Scoop\persist\espanso-portable\.espanso`.

A terminal mapping means a mapping whose source path ends exactly at the current tree node, not under one of its child nodes. For source `D:\A\Scoop\persist\Espanso\.espanso`, the `.espanso` tree node owns that mapping as a terminal mapping.

Do not model a source-path trie node as owning only one terminal mapping; it must allow a list of terminal mappings.

Parent status counts and rendered leaf rows must match. A parent that says `3` enabled links must expand to three link leaves, not two.

### 3.5 Source Editing

A mapping's source migration control belongs in the source column, not in the operations column.

Editing a source should open a dialog. The dialog must explain:

- current source
- target
- Data Repo context
- new source meaning
- whether source content will move

### 3.6 Search And Bulk Controls

Search filters by name, group, source, target, and current target.

The status filter sits near search.

These buttons belong on the right side of the search row:

- `启用选中`
- `删除选中`
- `导出脚本`

Selected bulk actions must not live only in the table title area.

### 3.7 Operation Preview Dialogs

Enable and delete previews must show the generated filesystem action plan before execution.

If an enable preview contains target paths with real content, the dialog must label that control `目标已有真实内容` and show the same strategy options used by the main configuration area's `启用时如果目标已有真实内容` setting:

- `备份后替换`
- `直接删除后替换`

Changing this option in the dialog must re-preview the plan for the same selected links.

Delete previews must show the same `删除软链接后` options used by the main configuration area:

- `仅删除软链接`
- `恢复最近备份`
- `复制源内容到目标`

Changing this option in the dialog must re-preview the plan for the same selected links.

## 4. Backup Browser UI

Only show configured backup roots.

The default root is:

- `backup-or-settings`

Additional backup roots can be added.

Display backup roots as tree roots and display children as nested trees.

The backup browser supports:

- search
- preview text-like files
- open path
- reveal path
- copy path

Previewable text-like files include:

- plain text
- JSON
- XML
- REG
- TOML
- Markdown
- config-like files

## 5. Refresh, Scan, Enable, Delete

### 5.1 Refresh

`刷新` reloads current app state from the backend:

- environment summary
- config root and active profile
- current config path
- link settings
- symlink status scan
- backup browser entries
- persistent operation logs
- Data Repo list
- Mapping Root list
- backup root list

Refresh must be guarded against duplicate execution:

- In React development mode, `React.StrictMode` intentionally runs mount effects twice.
- Initial refresh should use a ref guard so the first `useEffect` does not create two visible real-time log groups.
- `refreshAll()` should use an in-flight promise guard. If a refresh is already running, another refresh request should reuse the same promise instead of starting another scan.

Refresh should parallelize independent backend reads:

- environment summary
- symlink status scan
- backup browser entries
- persistent operation logs
- link settings

Candidate performance improvements:

- Add a backend aggregate command such as `get_dashboard_state()` to return all refresh data in one Tauri call and reduce frontend/backend round trips.
- Use partial refresh after mutations. For example, editing Free link metadata should refresh link settings/status, but does not need to rescan backup browser entries.
- Refresh persistent operation logs lazily or only when the operation-log tab is opened, unless a just-finished operation produced a new log.
- Consider cache/invalidation boundaries for expensive filesystem scans, especially backup tree scans and large Mapping Root scans.

### 5.2 Scan

`扫描` is not the same as `启用`.

Scan detects directory/config changes and shows proposed changes before modifying config.

Data Repo scan and Mapping Root scan should report:

- additions
- removals
- ignored entries
- missing sources
- suggested config changes

### 5.3 Enable

`启用` applies link creation/replacement after preview.

If target exists as real content, obey the selected strategy:

- backup
- delete

For a single link row whose status is `enabled` / `已启用`, the `预览启用` operation button must be disabled. Its tooltip/title should explain that the link is already enabled and does not need another enable preview.

### 5.4 Delete

`删除` removes target links after preview.

Default behavior: only remove link/reparse point.

Delete preview must clearly explain that delete does not remove the mapping row from the table and does not remove the mapping from the active profile `links.toml`.

Optional behaviors:

- restore latest backup
- copy source content to target

## 6. Export Script

The export function writes a Markdown file containing a `bat` code block. It is for browsing, review, and copy/paste.

The output should be similar in spirit to `tools/old-files-before-this-app/mklink-bat/README-mklink.md`.

Export enabled and disabled mappings. Disabled mappings must be commented clearly and must not execute if pasted as-is.

Source-missing mappings must be commented clearly.

If a line has prelude commands and is disabled/source-missing, the whole block must be commented, not just the final `mklink`.

Group output by:

- each Data Repo
- within each Data Repo:
  - `Mapping Root folders`
  - `Non-Mapping-Root links`
- free links outside Data Repos

Mapping Root export options:

- call `tools/mklink-by-Mapping-Root.bat` through a configurable variable
- expand Mapping Root into individual `mklink` commands

If using helper script, export:

```bat
set "MAPPING_ROOT_TOOL=tools\mklink-by-Mapping-Root.bat"
```

The user can edit the variable after export.

Target conflict export options:

- `none`: output only `mklink`
- `delete`: emit delete prelude before `mklink`
- `backup`: emit backup prelude before `mklink`

Backup export behavior:

- define `MKLINK_BACKUP_DIR` near the top
- move existing target objects to that directory before `mklink`
- allow the user to edit `MKLINK_BACKUP_DIR`

Helper script mode mapping:

- delete strategy maps to helper mode `AUTO`
- backup/none strategy maps to helper mode `MANUAL`

## 7. Operation Logs

Persistent operation logs are separate from real-time running logs.

Persistent logs are written under configured `settings.log_dir`.

Logs should include:

- operation name
- timestamp
- preview plan
- applied actions
- errors
- backup paths

## 8. Automated Testing

Keep an `auto-test` profile:

- `app-data/auto-test/links.toml`

The auto-test profile must use only project-local temp paths:

- `app-data/auto-test-runtime`

Provide an automated test runner:

- `tools/run-auto-test.ps1`
- npm command: `npm run test:auto-profile`

The auto-test runner must:

- create temporary sources/targets
- create test links
- verify links
- remove links created during the test
- remove temporary runtime data unless explicitly kept
- print created paths
- print deleted paths

On systems without true symlink privileges, directory links may fall back to junctions and must be reported as `junction-fallback`.

## 9. UI Copy Requirements

Use `Data Repo` with this exact capitalization in user-facing text.

Use `Mapping Root` with this exact capitalization.

Use these exact Chinese strings:

- `启用时如果目标已有真实内容`
- `如果目标已有真实内容`

Avoid vague labels such as `已配置的映射` unless the UI explains that it means mappings from the active profile config plus Mapping Root expansion.

Dialogs for enable/delete/export must explain consequences with concrete examples.

Form fields must include plain-language meaning and examples.

