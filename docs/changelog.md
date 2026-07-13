# Changelog

No formal releases have been recorded yet.

Recent documentation restructure:

- Created AI-agent-first docs structure.
- Redistributed old `DEVELOPMENT_DECISIONS.md` content into focused product, architecture, engineering, operations, and AI gotcha docs.
- Moved old `CODE_MAP.md` to `docs/engineering/repo-map.md`, then split problem-first recipes into `docs/engineering/code-locator.md`.
- Consolidated docs toward file-first ownership and removed catch-all AI facts.

Recent UI behavior updates:

- Replaced generic real-time log command-call messages with concrete Tauri command names.
- Added per-preview strategy selectors to enable/delete operation dialogs, reusing the main configuration choices and regenerating the plan when changed.
- Added Independent Mapping Roots under the virtual `Virtual Data Repo` table group, with generated mappings nested under their owning root, a new create tab, and confirmed cleanup of overlapping Free Link config records.
- Disabled the single-row `预览启用` button when a link is already `已启用`, with a title explaining that no enable preview is needed.
- Added delete-preview copy clarifying that delete removes target links but does not remove mapping records from the table or active profile `links.toml`.


