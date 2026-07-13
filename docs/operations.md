# Operations

This file owns compact runtime operations context. Split operations docs only when a runbook, incident, or rollback procedure needs its own lifecycle.

## Monitoring And Logs

### Real-Time Running Log

The sidebar log shows current app steps such as refresh, scan, preview, and apply operations. It is grouped/tree-like and expandable.

The real-time log is UI runtime feedback, not a durable audit log. It should include environment loading, config/profile loading, symlink scan, backup scan, log scan, Tauri command calls with concrete command names, preview plans, applied actions, warnings, and errors.

### Persistent Operation Logs

Persistent logs are written under configured `settings.log_dir`.

Logs should include operation name, timestamp, preview plan, applied actions, errors, and backup paths.

Persistent operation logs are separate from the sidebar real-time running log and are the source to inspect during recovery or partial-failure repair.

## Rollback And Recovery

### Link Removal

Removing a link should remove only the target link/reparse point by default. It should not delete source data.

After removing a link, the user-facing recovery strategies are:

- only remove the link
- restore the latest backup to the target path
- copy source content back to the target path

### Target Content

If enabling a link replaces real target content, use the configured strategy:

- Back up then replace.
- Delete then replace.

Directory backups are zip files under the configured backup directory.

### Failed Operations

Use persistent operation logs to find actions already completed and backup paths created during the operation.

Operation logs should be checked before manual repair because a partially completed operation may already have moved data, created a backup, or removed a target link.

## Runbooks

No production alert runbooks exist yet. For manual recovery guidance, see [Rollback And Recovery](#rollback-and-recovery).

## Incidents

No formal incidents have been recorded yet.


