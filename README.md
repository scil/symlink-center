# System Drive Slimming and Config Center

Chinese name: `系统盘瘦身与配置中心`  
Subtitle: `软链接管理、配置独立化`

System Drive Slimming and Config Center is a Windows desktop app for moving application data and settings out of system-drive locations while keeping programs working through symbolic links.

It also includes a backup/settings browser for inspecting configured folders, previewing text-like files, and opening or locating paths in Windows Explorer.

## What It Does

- symbolic links
        - Shows configured symbolic-link mappings in a searchable tree.
        - Groups mappings by source or target directory.
        - Supports one-to-one Free Links and batch Mapping Roots.
        - Supports multiple Data Repos, so real data can live on different drives.
        - Scans link status: enabled, missing, real content, wrong target, broken, or source missing.
        - Previews risky link operations before applying them.
        - Backs up or deletes existing real target content according to your chosen strategy.
        - Removes target links without deleting the real source data.
        - export bat script using `mklink`
- Browses configured backup/settings roots as trees and previews text files.
- Shows a real-time running log in the sidebar.
- Keeps persistent operation logs for review.

## The Main Idea For symbolic links

Many Windows applications store data under locations such as:

```text
C:\Users\Alice\AppData\Roaming
C:\Users\Alice\AppData\Local
C:\Users\Alice\.config
```

This app helps you move the real data somewhere else, for example:

```text
D:\ConfigVault
E:\PortableData
```

Then it creates links at the original locations, so applications continue to read and write as if nothing moved.

## A Symlink Walkthrough

Imagine Alice uses a note app called `NovaNote`.

NovaNote stores its settings on the system drive:

```text
C:\Users\Alice\AppData\Roaming\NovaNote
```

Alice wants those settings to live on another drive:

```text
D:\PortableApps\NovaNote\profile
```

She creates one mapping:

```text
source: D:\PortableApps\NovaNote\profile
target: C:\Users\Alice\AppData\Roaming\NovaNote
```

After enabling the mapping, NovaNote still reads and writes:

```text
C:\Users\Alice\AppData\Roaming\NovaNote
```

but the real files are stored at:

```text
D:\PortableApps\NovaNote\profile
```

This single source-to-target mapping is called a **Free Link**. Use a Free Link when the real source is outside every managed data repository. In the UI, Free Links are created with the `新建自由链接` form.

### From One App To Many Apps

After a while, Alice moves more app data off the system drive:

```text
D:\ConfigVault
  Roaming\
    NovaNote\
    SketchPad\
    TinyMail\
  Local\
    VideoTool\
  UserHome\
    .ssh\
    .gitconfig
```

Now `D:\ConfigVault` is more than a random folder. It is a known place where real data lives. In this app, such a root folder is called a **Data Repo**.

A Data Repo is not a link rule by itself. It is a storage root. The app can manage more than one Data Repo:

```text
D:\ConfigVault
E:\PortableData
O:\ArchiveConfig
```

This is useful when different kinds of data belong on different drives.

### From Many Manual Links To One Rule

Alice notices that several folders under her Data Repo all belong under Windows Roaming AppData:

```text
D:\ConfigVault\Roaming
  NovaNote
  SketchPad
  TinyMail
```

They should appear under:

```text
C:\Users\Alice\AppData\Roaming
```

Instead of creating three separate Free Links, she creates one batch rule:

```text
source: D:\ConfigVault\Roaming
target: C:\Users\Alice\AppData\Roaming
mode: children
```

Then the app can create:

```text
C:\Users\Alice\AppData\Roaming\NovaNote   -> D:\ConfigVault\Roaming\NovaNote
C:\Users\Alice\AppData\Roaming\SketchPad  -> D:\ConfigVault\Roaming\SketchPad
C:\Users\Alice\AppData\Roaming\TinyMail   -> D:\ConfigVault\Roaming\TinyMail
```

This batch rule is called a **Mapping Root**. A Mapping Root maps children under one source folder into one target folder as same-name links.

If you later add:

```text
D:\ConfigVault\Roaming\CalendarFox
```

you can scan the Mapping Root to detect the new folder and decide whether to update mappings.

If a source is already inside a Data Repo, it is not a Free Link. Scan the relevant Data Repo or Mapping Root instead.

## When To Use Which

Use a Free Link when:

- You have one specific source and one specific target.
- The source is outside every Data Repo.
- Example: `D:\PortableApps\NovaNote\profile -> %APPDATA%\NovaNote`

Use a Data Repo when:

- You want a known root location for real data.
- You want the app to understand that many sources belong together.
- Example: `D:\ConfigVault`

Use a Mapping Root when:

- Many child folders under one source should appear under one target.
- You want scanning to detect additions/removals.
- Example: `D:\ConfigVault\Roaming\* -> %APPDATA%\*`

## Safety Model

The app works with real files and directories, so destructive actions are guarded.

- Enable/remove operations show a preview before execution.
- If a target already contains real files, you choose whether to back it up or delete it before creating a link.
- Directory backups are stored as zip files.
- Removing a link removes only the target link/reparse point by default.
- Removing a link does not delete source data in a Data Repo.
- Windows may require Administrator rights or Developer Mode to create true symbolic links. The app reports the current capability in the header.

## Backup And Settings Browser

The backup browser shows configured backup/settings roots as a tree. It can:

- Search entries.
- Preview text-like files such as `.txt`, `.json`, `.xml`, `.reg`, `.toml`, and Markdown.
- Open paths in Windows Explorer.
- Reveal file locations.
- Copy paths.

This browser is intentionally separate from link management. It is for inspection and manual review, not for running backup tools.

## Profiles And Configuration

The app supports multiple configuration profiles. The default profile is:

```text
default
```

An auto-test profile is also used for isolated testing:

```text
auto-test
```

In debug mode, configuration is stored under:

```text
app-data
```

In release builds, the default configuration root is `app-data` beside the executable:

```text
app-data
```

Each profile has its own:

```text
links.toml
```

So the default release profile file is:

```text
app-data/default/links.toml
```

Current TOML schema names include:

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

[[mapping_roots]]
id = "roaming"
label = "Roaming AppData"
data_repo_id = "primary"
source = "Roaming"
target = "%APPDATA%"
mode = "children"
enabled = true
ignore = []

[[free_links]]
id = "novanote-portable"
label = "NovaNote portable profile"
source = "D:/PortableApps/NovaNote/profile"
target = "%APPDATA%/NovaNote"
kind = "directory"
enabled = true
```

For Windows absolute paths in TOML, prefer single quotes or forward slashes:

```toml
path = 'D:\ConfigVault'
path = "D:/ConfigVault"
```

Do not write raw backslashes inside double-quoted TOML strings:

```toml
path = "D:\ConfigVault"
```

because TOML treats `\` as an escape character.

## Development

Install dependencies:

```powershell
npm install
```

Run the desktop app with live reload:

```powershell
npm run tauri dev
```

Run only the Vite frontend dev server:

```powershell
npm run dev
```

Frontend dev URL:

```text
http://127.0.0.1:1420
```

## Tests And Checks

Frontend build:

```powershell
npm run build
```

Frontend unit tests:

```powershell
npm run test:frontend
```

Rust tests:

```powershell
cd src-tauri
cargo test
```

Isolated symlink auto-test profile:

```powershell
npm run test:auto-profile
```

The auto-test profile creates temporary sources and targets under `app-data/auto-test-runtime`, verifies links, prints created/deleted paths, and cleans up links created during the test. If true symbolic links are unavailable, directory links may fall back to junctions and are reported as `junction-fallback`.

## Packaging

Build the desktop app installer/executable:

```powershell
npm run tauri build
```

During normal UI/debug work, prefer:

```powershell
npm run build
```

Do not create release bundles unless you specifically need a packaged executable.

## Useful Project Files

- `src/App.tsx`: main UI, tabs, dialogs, mapping table, sidebar logs.
- `src/link-tree.ts`: pure tree-building logic for source/target grouping.
- `src/link-tree.test.ts`: frontend regression tests for tree behavior.
- `src/types.ts`: frontend types matching Rust command payloads.
- `src/tauri-api.ts`: Tauri command wrappers.
- `src-tauri/src/lib.rs`: config parsing, filesystem logic, scan/preview/apply actions, backup and logs.
- `app-data/default/links.toml`: default profile config.
- `app-data/auto-test/links.toml`: isolated test profile config.
- `docs/ai.md#ai-context-map`: AI first-read map.
- `docs/engineering/repo-map.md`: structural repo map.
- `docs/engineering/code-locator.md`: problem-to-file recipes and focused checks.
