# Security And Safety

## Filesystem Safety Rules

All destructive or batch operations must have a preview or confirmation step before mutation.

Risky operations include enabling mappings, removing links, replacing real target content, moving mapping sources, changing Data Repo locations with data movement, and bulk actions.

Scan and enable are separate operations. Scan detects Data Repo or Mapping Root changes and shows proposed additions, removals, ignored entries, missing sources, and suggested config changes before any config or filesystem mutation.

Changing a Data Repo path must ask whether to migrate old data and whether to rebuild links.

## Enable Mapping Safety

Enabling mappings must preview:

- created links
- skipped entries
- target backups
- target deletes
- wrong targets
- source missing
- permissions/admin warnings

If target status is `real-content`, user strategy decides backup or delete before replacement. Status definitions live in [docs/architecture.md#link-status-classification](../architecture.md#link-status-classification).

## Remove Link Safety

Removing a mapping must remove only the target link/reparse point by default.

Removing a link must never delete source data in a Data Repo.

Remove-link preview must state that the operation does not delete the mapping record from the UI table and does not remove it from the active profile `links.toml`. The mapping remains configured and will reappear on refresh with its current filesystem status.

Deleting a link can offer follow-up strategies:

- only remove link
- restore latest backup
- copy source content back to target

Recovery behavior is documented in [docs/operations.md#rollback-and-recovery](../operations.md#rollback-and-recovery).

## Backup Safety

Directory backups should be compressed as zip files under the configured backup directory.

Backup paths should be included in persistent operation logs so a failed operation can be inspected and recovered.

## Source Migration Safety

Moving a mapping source must:

- copy or move data first
- verify the new source
- update config
- rebuild target link

The operation must validate target state before replacing links. If target contains real content, the operation must be refused or require an explicit user strategy.

## Free Link Safety

Free Links may point outside Data Repos. Treat them conservatively because the app cannot assume Data Repo ownership over the source path.

Creating an Independent Mapping Root must preview overlapping Free Link records before config mutation. After user confirmation, only matching `free_links` records are removed from the active profile `links.toml`; no source data or target links are deleted by this cleanup.

The backend must re-check the overlap set during save. If the confirmed IDs do not match the latest overlapping Free Links, saving fails and the user must preview again.

## Permissions

- Detect admin/symlink capability at startup.
- Show whether symlink creation is available.
- Windows Developer Mode or Administrator rights may be required for true symlinks.

## Trust Boundary

The frontend must not directly mutate the filesystem. All filesystem effects go through Rust Tauri commands.



