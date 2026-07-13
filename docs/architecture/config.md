# Config Architecture

This document is the owning reference for configuration behavior. Other docs should link here instead of duplicating config facts.

## Config Roots

The app uses an `app-data` directory under the app base directory for default configuration.

- Debug app base: project root.
- Release app base: executable directory.
- Debug default config file: `app-data/default/links.toml`.
- Release default config file: `app-data/default/links.toml` beside the exe.

The bootstrap pointer is `app-data/config-location.toml`:

```toml
config_dir = "D:/Config/symlink-profiles"
active_profile = "default"
```

When `config_dir` is set, profiles are loaded from that directory.

## Profiles

Config supports multiple profiles. Profiles are directories that contain `links.toml`.

```text
app-data/
  config-location.toml
  default/
    links.toml
  auto-test/
    links.toml
```

Rules:

- Default profile name is `default`.
- `auto-test` is reserved for isolated automatic tests.
- Runtime/cache folders such as `runtime-check` are not profiles.
- A valid profile directory should have `links.toml`, or be the active profile/default profile being initialized.
- Profile names may contain only ASCII letters, numbers, `-`, and `_`.

## links.toml Schema

Use only current config names:

- `primary_data_repo`
- `data_repos`
- `data_repo_id`
- `mapping_roots`
- `backup_roots`
- `free_links`

Current top-level tables:

- `[settings]`
- `[[data_repos]]`
- `[[backup_roots]]`
- `[[mapping_roots]]`
- `[[free_links]]`

Example:

```toml
[settings]
primary_data_repo = "mklink"
backup_dir = "app-data/link-backups"
log_dir = "app-data/logs"

[[data_repos]]
id = "primary"
label = "Primary Data Repo"
path = "mklink"
enabled = true

[[backup_roots]]
id = "backup-or-settings"
label = "backup-or-settings"
path = "backup-or-settings"
enabled = true

[[mapping_roots]]
id = "appdata-local"
label = "AppData Local"
data_repo_id = "primary"
source = "AppData_Local"
target = "%LOCALAPPDATA%"
mode = "children"
enabled = true
ignore = []

[[free_links]]
id = "external-espanso"
label = "espanso"
group_id = "free-links-source-outside-data-repo"
group_label = "自由链接(源不在 Data Repo)"
source = "D:/A/Scoop/persist/Espanso/.espanso"
target = "C:/Users/i/AppData/Roaming/espanso"
kind = "directory"
enabled = true
```

## Settings

- `primary_data_repo`: default Data Repo path.
- `backup_dir`: link backup location.
- `log_dir`: persistent operation log location.

## Data Repos

A Data Repo stores real files and directories. It can be anywhere on disk.

The id `virtual-independent-mapping-roots` is reserved for the virtual `Virtual Data Repo` table group. It must not be used by a real `[[data_repos]]` entry.

Required fields:

- `id`
- `label`
- `path`
- `enabled`

## Mapping Roots

A Mapping Root is a batch mapping rule.

Required fields:

- `id`
- `label`
- `data_repo_id`
- `source`
- `target`
- `mode`
- `enabled`

Normal Mapping Roots use a real Data Repo id in `data_repo_id`.

Independent Mapping Roots use the reserved `data_repo_id = "virtual-independent-mapping-roots"`. Their `source` must be absolute or expand to an absolute path, and it must be outside every configured Data Repo. They are displayed under the virtual `Virtual Data Repo` group rather than under a real Data Repo.

Modes:

- `children`: each direct child of `source` creates a same-name link under `target`.
- `direct`: `source` itself maps to `target`.

## Free Links

`free_links` stores explicit one-to-one mappings whose source is outside every configured Data Repo.

`free_links` is the TOML table name for Free Links. It is a storage/schema name for the same user-facing Free Link concept, not a separate mapping type.

If a source is already inside a Data Repo, do not create a Free Link. Scan the Data Repo or Mapping Root and refresh the UI instead.

When creating an Independent Mapping Root, Free Link records whose sources are inside the new source directory are deleted from `links.toml` only after preview and user confirmation. The cleanup includes enabled and disabled Free Link records.

## Path Rules

- Relative paths in config resolve against the app base directory.
  - Debug: app project root.
  - Release: executable directory.
- `CARGO_MANIFEST_DIR` points to `src-tauri`; the app project root is one `parent()` above it.
- Windows absolute paths are supported.
- `%USERPROFILE%`, `%APPDATA%`, and `%LOCALAPPDATA%` are expanded by the backend.
- Mapping Root `source` values are resolved relative to their `data_repo_id` unless they are absolute.

## Windows TOML Paths

Prefer single-quoted backslash paths or forward slashes:

```toml
path = 'D:\A\resticprofile\thirdparty_configs\mklink'
path = "D:/A/resticprofile/thirdparty_configs/mklink"
```

Do not use raw backslashes inside TOML double quotes:

```toml
path = "D:\A\mklink"
```

## Removed Names

Do not use or reintroduce these legacy names:

- `custom_links`
- `CustomLinkConfig`
- `mklink_root`
- `link_data_roots`
- `link_roots`
- `data_root_id`

## Migration Rules

- If legacy `app-data/links.toml` exists, migrate it to `app-data/default/links.toml`.
- Do not silently support removed legacy schema aliases.
- Config migrations must update examples and tests together.

## Code References

- Config loading, path resolution, profile management: `src-tauri/src/lib.rs`.
- Frontend config/profile types: `src/types.ts`.
- Tauri command wrappers: `src/tauri-api.ts`.
- Default profile: `app-data/default/links.toml`.
- Auto-test profile: `app-data/auto-test/links.toml`.
