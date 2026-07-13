use anyhow::{anyhow, Context, Result};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};
use std::time::UNIX_EPOCH;

#[cfg(windows)]
use std::os::windows::fs::{symlink_dir, symlink_file, MetadataExt};

#[cfg(unix)]
use std::os::unix::fs as unix_fs;

const VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID: &str = "virtual-independent-mapping-roots";
const VIRTUAL_INDEPENDENT_MAPPING_ROOTS_LABEL: &str = "Virtual Data Repo";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct LinksConfig {
    #[serde(default)]
    settings: AppSettings,
    #[serde(default)]
    data_repos: Vec<DataRepoConfig>,
    #[serde(default)]
    backup_roots: Vec<BackupRootConfig>,
    #[serde(default)]
    mapping_roots: Vec<MappingRootConfig>,
    #[serde(default)]
    free_links: Vec<FreeLinkConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppSettings {
    #[serde(default = "default_primary_data_repo")]
    primary_data_repo: String,
    #[serde(default = "default_backup_dir")]
    backup_dir: String,
    #[serde(default = "default_log_dir")]
    log_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ConfigLocation {
    #[serde(default)]
    config_dir: Option<String>,
    #[serde(default = "default_profile_name")]
    active_profile: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            primary_data_repo: default_primary_data_repo(),
            backup_dir: default_backup_dir(),
            log_dir: default_log_dir(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DataRepoConfig {
    id: String,
    label: String,
    path: String,
    #[serde(default = "default_true")]
    enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupRootConfig {
    id: String,
    label: String,
    path: String,
    #[serde(default = "default_true")]
    enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MappingRootConfig {
    id: String,
    label: String,
    #[serde(default)]
    data_repo_id: Option<String>,
    source: String,
    target: String,
    #[serde(default)]
    mode: RootMode,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    ignore: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FreeLinkConfig {
    id: String,
    label: String,
    #[serde(default)]
    data_repo_id: Option<String>,
    #[serde(default)]
    group_id: Option<String>,
    #[serde(default)]
    group_label: Option<String>,
    source: String,
    target: String,
    #[serde(default)]
    kind: LinkKind,
    #[serde(default = "default_true")]
    enabled: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RootMode {
    Children,
    Direct,
}

impl Default for RootMode {
    fn default() -> Self {
        Self::Children
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum LinkKind {
    Auto,
    File,
    Directory,
}

impl Default for LinkKind {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum LinkStatus {
    Enabled,
    Missing,
    RealContent,
    WrongTarget,
    Broken,
    SourceMissing,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum EntryKind {
    File,
    Directory,
    Link,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkRecord {
    id: String,
    label: String,
    group_id: String,
    group_label: String,
    source: String,
    target: String,
    kind: LinkKind,
    source_config: String,
    data_repo_id: Option<String>,
    status: LinkStatus,
    source_exists: bool,
    target_exists: bool,
    current_target: Option<String>,
    is_free_link: bool,
    notes: Vec<String>,
}

#[derive(Debug, Clone)]
struct LinkSpec {
    id: String,
    label: String,
    group_id: String,
    group_label: String,
    source: PathBuf,
    target: PathBuf,
    kind: LinkKind,
    source_config: String,
    data_repo_id: Option<String>,
    is_free_link: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionRequest {
    link_ids: Vec<String>,
    operation: String,
    #[serde(default)]
    target_conflict_strategy: TargetConflictStrategy,
    #[serde(default)]
    remove_link_strategy: RemoveLinkStrategy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionPlan {
    operation: String,
    actions: Vec<LinkAction>,
    summary: BTreeMap<String, usize>,
    warnings: Vec<String>,
    requires_admin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkAction {
    id: String,
    link_id: String,
    kind: ActionKind,
    severity: ActionSeverity,
    description: String,
    source: Option<String>,
    target: Option<String>,
    backup_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
enum ActionKind {
    CreateLink,
    RemoveLink,
    BackupTarget,
    DeleteTarget,
    RestoreBackup,
    CopySourceToTarget,
    Skip,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum TargetConflictStrategy {
    Backup,
    Delete,
}

impl Default for TargetConflictStrategy {
    fn default() -> Self {
        Self::Backup
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RemoveLinkStrategy {
    OnlyLink,
    RestoreBackup,
    CopySource,
}

impl Default for RemoveLinkStrategy {
    fn default() -> Self {
        Self::OnlyLink
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ActionSeverity {
    Info,
    Warning,
    Danger,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResult {
    ok: bool,
    message: String,
    log_path: Option<String>,
    actions: Vec<AppliedAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppliedAction {
    action_id: String,
    kind: ActionKind,
    ok: bool,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupEntry {
    id: String,
    root_id: String,
    root_label: String,
    root_path: String,
    category: String,
    name: String,
    relative_path: String,
    path: String,
    kind: EntryKind,
    size: Option<u64>,
    modified: Option<u64>,
    previewable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextPreview {
    path: String,
    content: String,
    truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationLog {
    name: String,
    path: String,
    modified: Option<u64>,
    size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentSummary {
    repo_root: String,
    config_root: String,
    active_profile: String,
    profiles: Vec<ConfigProfile>,
    config_path: String,
    primary_data_repo: String,
    is_admin: bool,
    can_create_symlink: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigProfile {
    name: String,
    path: String,
    active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkSettings {
    primary_data_repo: String,
    resolved_primary_data_repo: String,
    data_repos: Vec<DataRepo>,
    mapping_roots: Vec<MappingRootSetting>,
    backup_roots: Vec<BackupRoot>,
    backup_dir: String,
    log_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DataRepo {
    id: String,
    label: String,
    path: String,
    resolved_path: String,
    enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MappingRootSetting {
    id: String,
    label: String,
    data_repo_id: Option<String>,
    source: String,
    resolved_source: String,
    target: String,
    resolved_target: String,
    mode: RootMode,
    enabled: bool,
    ignore: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlappingFreeLink {
    id: String,
    label: String,
    source: String,
    target: String,
    enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewStandaloneMappingRootCleanupInput {
    source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StandaloneMappingRootCleanupPreview {
    resolved_source: String,
    overlapping_free_links: Vec<OverlappingFreeLink>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanChangesResult {
    title: String,
    summary: Vec<String>,
    details: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupRoot {
    id: String,
    label: String,
    path: String,
    resolved_path: String,
    enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewLinkInput {
    id: String,
    label: String,
    source: String,
    target: String,
    kind: LinkKind,
    #[serde(default)]
    target_conflict_strategy: TargetConflictStrategy,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePrimaryDataRepoInput {
    new_root: String,
    move_data: bool,
    rebuild_links: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateConfigDirInput {
    new_dir: String,
    copy_current_config: bool,
    active_profile: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwitchConfigProfileInput {
    profile: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateConfigProfileInput {
    profile: String,
    copy_current_config: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertDataRepoInput {
    id: String,
    label: String,
    path: String,
    move_data_from_repo_id: Option<String>,
    rebuild_links: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertBackupRootInput {
    id: String,
    label: String,
    path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertMappingRootInput {
    id: String,
    label: String,
    data_repo_id: Option<String>,
    source: String,
    target: String,
    mode: RootMode,
    enabled: bool,
    ignore: Vec<String>,
    #[serde(default)]
    cleanup_free_link_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportMklinkScriptInput {
    output_path: String,
    use_mapping_root_helper: bool,
    helper_script_path: String,
    target_conflict_strategy: ExportTargetConflictStrategy,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ExportTargetConflictStrategy {
    None,
    Delete,
    Backup,
}

impl Default for ExportTargetConflictStrategy {
    fn default() -> Self {
        Self::Backup
    }
}

#[derive(Debug, Clone, Copy)]
struct ExportCommandMeta {
    enabled: bool,
    source_exists: bool,
}

#[derive(Debug, Clone, Copy)]
enum ExportLineKind {
    Directory,
    File,
}

struct ExportLine {
    label: String,
    command: String,
    target: Option<String>,
    meta: ExportCommandMeta,
}

struct ExportSection {
    title: String,
    notes: Vec<String>,
    lines: Vec<ExportLine>,
    subsections: Vec<ExportSubsection>,
}

struct ExportSubsection {
    title: String,
    notes: Vec<String>,
    lines: Vec<ExportLine>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveLinkSourceInput {
    link_id: String,
    new_source: String,
    #[serde(default = "default_true")]
    sync_target_name: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateLinkMetadataInput {
    link_id: String,
    new_id: String,
    label: String,
}

fn default_primary_data_repo() -> String {
    "mklink".to_string()
}

fn default_backup_dir() -> String {
    "data/link-backups".to_string()
}

fn default_log_dir() -> String {
    "data/logs".to_string()
}

fn default_true() -> bool {
    true
}

fn default_profile_name() -> String {
    "default".to_string()
}

#[tauri::command]
fn scan_links() -> std::result::Result<Vec<LinkRecord>, String> {
    scan_links_inner().map_err(error_string)
}

#[tauri::command]
fn preview_link_actions(request: ActionRequest) -> std::result::Result<ActionPlan, String> {
    build_action_plan(&request).map_err(error_string)
}

#[tauri::command]
fn apply_link_actions(request: ActionRequest) -> std::result::Result<ActionResult, String> {
    apply_link_actions_inner(&request).map_err(error_string)
}

#[tauri::command]
fn create_link_mapping(input: NewLinkInput) -> std::result::Result<ActionResult, String> {
    create_link_mapping_inner(input).map_err(error_string)
}

#[tauri::command]
fn remove_link(link_id: String) -> std::result::Result<ActionResult, String> {
    apply_link_actions_inner(&ActionRequest {
        link_ids: vec![link_id],
        operation: "remove".to_string(),
        target_conflict_strategy: TargetConflictStrategy::Backup,
        remove_link_strategy: RemoveLinkStrategy::OnlyLink,
    })
    .map_err(error_string)
}

#[tauri::command]
fn list_backup_entries() -> std::result::Result<Vec<BackupEntry>, String> {
    list_backup_entries_inner().map_err(error_string)
}

#[tauri::command]
fn read_text_preview(path: String) -> std::result::Result<TextPreview, String> {
    read_text_preview_inner(path).map_err(error_string)
}

#[tauri::command]
fn open_path(path: String) -> std::result::Result<(), String> {
    open_path_inner(path).map_err(error_string)
}

#[tauri::command]
fn reveal_path(path: String) -> std::result::Result<(), String> {
    reveal_path_inner(path).map_err(error_string)
}

#[tauri::command]
fn list_operation_logs() -> std::result::Result<Vec<OperationLog>, String> {
    list_operation_logs_inner().map_err(error_string)
}

#[tauri::command]
fn read_operation_log(path: String) -> std::result::Result<TextPreview, String> {
    read_text_preview_inner(path).map_err(error_string)
}

#[tauri::command]
fn get_environment_summary() -> std::result::Result<EnvironmentSummary, String> {
    get_environment_summary_inner().map_err(error_string)
}

#[tauri::command]
fn get_link_settings() -> std::result::Result<LinkSettings, String> {
    get_link_settings_inner().map_err(error_string)
}

#[tauri::command]
fn update_config_dir(input: UpdateConfigDirInput) -> std::result::Result<ActionResult, String> {
    update_config_dir_inner(input).map_err(error_string)
}

#[tauri::command]
fn switch_config_profile(
    input: SwitchConfigProfileInput,
) -> std::result::Result<ActionResult, String> {
    switch_config_profile_inner(input).map_err(error_string)
}

#[tauri::command]
fn create_config_profile(
    input: CreateConfigProfileInput,
) -> std::result::Result<ActionResult, String> {
    create_config_profile_inner(input).map_err(error_string)
}

#[tauri::command]
fn scan_data_repo_changes(data_repo_id: String) -> std::result::Result<ScanChangesResult, String> {
    scan_data_repo_changes_inner(data_repo_id).map_err(error_string)
}

#[tauri::command]
fn scan_mapping_root_changes(
    mapping_root_id: String,
) -> std::result::Result<ScanChangesResult, String> {
    scan_mapping_root_changes_inner(mapping_root_id).map_err(error_string)
}

#[tauri::command]
fn preview_standalone_mapping_root_cleanup(
    input: PreviewStandaloneMappingRootCleanupInput,
) -> std::result::Result<StandaloneMappingRootCleanupPreview, String> {
    preview_standalone_mapping_root_cleanup_inner(input).map_err(error_string)
}

#[tauri::command]
fn update_primary_data_repo(
    input: UpdatePrimaryDataRepoInput,
) -> std::result::Result<ActionResult, String> {
    update_primary_data_repo_inner(input).map_err(error_string)
}

#[tauri::command]
fn upsert_data_repo(input: UpsertDataRepoInput) -> std::result::Result<ActionResult, String> {
    upsert_data_repo_inner(input).map_err(error_string)
}

#[tauri::command]
fn upsert_backup_root(input: UpsertBackupRootInput) -> std::result::Result<ActionResult, String> {
    upsert_backup_root_inner(input).map_err(error_string)
}

#[tauri::command]
fn upsert_mapping_root(input: UpsertMappingRootInput) -> std::result::Result<ActionResult, String> {
    upsert_mapping_root_inner(input).map_err(error_string)
}

#[tauri::command]
fn export_mklink_script(
    input: ExportMklinkScriptInput,
) -> std::result::Result<ActionResult, String> {
    export_mklink_script_inner(input).map_err(error_string)
}

#[tauri::command]
fn move_link_source(input: MoveLinkSourceInput) -> std::result::Result<ActionResult, String> {
    move_link_source_inner(input).map_err(error_string)
}

#[tauri::command]
fn update_link_metadata(
    input: UpdateLinkMetadataInput,
) -> std::result::Result<ActionResult, String> {
    update_link_metadata_inner(input).map_err(error_string)
}

#[tauri::command]
fn relaunch_as_admin(app: tauri::AppHandle) -> std::result::Result<(), String> {
    relaunch_as_admin_inner(app).map_err(error_string)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_links,
            preview_link_actions,
            apply_link_actions,
            create_link_mapping,
            remove_link,
            list_backup_entries,
            read_text_preview,
            open_path,
            reveal_path,
            list_operation_logs,
            read_operation_log,
            get_environment_summary,
            get_link_settings,
            update_config_dir,
            switch_config_profile,
            create_config_profile,
            scan_data_repo_changes,
            scan_mapping_root_changes,
            preview_standalone_mapping_root_cleanup,
            update_primary_data_repo,
            upsert_data_repo,
            upsert_backup_root,
            upsert_mapping_root,
            export_mklink_script,
            move_link_source,
            update_link_metadata,
            relaunch_as_admin
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Symlink Management and Config Decoupling");
}

fn scan_links_inner() -> Result<Vec<LinkRecord>> {
    let specs = load_link_specs()?;
    Ok(specs.iter().map(classify_link).collect())
}

fn build_action_plan(request: &ActionRequest) -> Result<ActionPlan> {
    let specs = load_link_specs()?;
    let operation = parse_operation(&request.operation)?;
    let selected_ids: HashSet<&str> = request.link_ids.iter().map(String::as_str).collect();
    let mut actions = Vec::new();
    let mut warnings = Vec::new();

    if selected_ids.is_empty() {
        warnings.push("No mappings selected.".to_string());
    }

    for spec in specs
        .iter()
        .filter(|spec| selected_ids.contains(spec.id.as_str()))
    {
        let record = classify_link(spec);
        match operation {
            Operation::Enable => append_enable_actions(
                spec,
                &record,
                &mut actions,
                request.target_conflict_strategy,
            )?,
            Operation::Remove => {
                append_remove_actions(spec, &record, &mut actions, request.remove_link_strategy)
            }
        }
    }

    let mut summary = BTreeMap::new();
    for action in &actions {
        *summary.entry(format!("{:?}", action.kind)).or_insert(0) += 1;
    }

    let requires_admin =
        actions.iter().any(|a| a.kind == ActionKind::CreateLink) && !can_create_symlink_quiet();

    Ok(ActionPlan {
        operation: request.operation.clone(),
        actions,
        summary,
        warnings,
        requires_admin,
    })
}

fn apply_link_actions_inner(request: &ActionRequest) -> Result<ActionResult> {
    let plan = build_action_plan(request)?;
    let mut applied = Vec::new();
    let mut ok = true;

    for action in &plan.actions {
        if action.kind == ActionKind::Skip || action.kind == ActionKind::Error {
            applied.push(AppliedAction {
                action_id: action.id.clone(),
                kind: action.kind,
                ok: action.kind == ActionKind::Skip,
                message: action.description.clone(),
            });
            if action.kind == ActionKind::Error {
                ok = false;
            }
            continue;
        }

        let result = apply_one_action(action);
        match result {
            Ok(message) => applied.push(AppliedAction {
                action_id: action.id.clone(),
                kind: action.kind,
                ok: true,
                message,
            }),
            Err(err) => {
                ok = false;
                applied.push(AppliedAction {
                    action_id: action.id.clone(),
                    kind: action.kind,
                    ok: false,
                    message: error_string(err),
                });
            }
        }
    }

    let log_path = write_operation_log("apply-link-actions", &plan, &applied)?;
    Ok(ActionResult {
        ok,
        message: if ok {
            "Operation completed.".to_string()
        } else {
            "Operation completed with errors.".to_string()
        },
        log_path: Some(log_path.display().to_string()),
        actions: applied,
    })
}

fn create_link_mapping_inner(input: NewLinkInput) -> Result<ActionResult> {
    validate_id(&input.id)?;
    let mut config = load_config()?;
    if config.free_links.iter().any(|link| link.id == input.id)
        || config.mapping_roots.iter().any(|root| root.id == input.id)
    {
        return Err(anyhow!("A mapping with id '{}' already exists.", input.id));
    }

    let source = resolve_source_path(&input.source, &config)?;
    if let Some(repo) = data_repo_containing_path(&source, &config)? {
        return Err(anyhow!(
            "source is already inside Data Repo '{}': {}. Scan the Data Repo or Mapping Root, then refresh the list instead of creating a free link.",
            repo.label,
            repo.resolved_path.display()
        ));
    }
    let repo_root = repo_root();
    let target = resolve_path(&input.target, &repo_root)?;
    let mut applied = Vec::new();

    if let Ok(target_meta) = fs::symlink_metadata(&target) {
        if is_link_like(&target_meta) {
            remove_link_path(&target)?;
            applied.push(AppliedAction {
                action_id: "remove-existing-link".to_string(),
                kind: ActionKind::RemoveLink,
                ok: true,
                message: format!("Removed existing link {}", target.display()),
            });
        } else {
            match input.target_conflict_strategy {
                TargetConflictStrategy::Backup => {
                    let backup = backup_path_for(&target)?;
                    backup_real_target(&target, &backup)?;
                    applied.push(AppliedAction {
                        action_id: "backup-existing-target".to_string(),
                        kind: ActionKind::BackupTarget,
                        ok: true,
                        message: format!(
                            "Backed up real target {} to {}",
                            target.display(),
                            backup.display()
                        ),
                    });
                }
                TargetConflictStrategy::Delete => {
                    remove_real_path(&target)?;
                    applied.push(AppliedAction {
                        action_id: "delete-existing-target".to_string(),
                        kind: ActionKind::DeleteTarget,
                        ok: true,
                        message: format!("Deleted real target {}", target.display()),
                    });
                }
            }
        }
    }

    if !source.exists() {
        match input.kind {
            LinkKind::File => {
                if let Some(parent) = source.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::File::create(&source)?;
            }
            LinkKind::Auto | LinkKind::Directory => {
                fs::create_dir_all(&source)?;
            }
        }
        applied.push(AppliedAction {
            action_id: "create-source".to_string(),
            kind: ActionKind::CreateLink,
            ok: true,
            message: format!("Created source {}", source.display()),
        });
    }
    create_parent_dir(&target)?;
    create_link(&source, &target, input.kind)?;
    applied.push(AppliedAction {
        action_id: "create-link".to_string(),
        kind: ActionKind::CreateLink,
        ok: true,
        message: format!("Linked {} -> {}", target.display(), source.display()),
    });

    config.free_links.push(FreeLinkConfig {
        id: input.id,
        label: input.label,
        data_repo_id: None,
        group_id: None,
        group_label: None,
        source: input.source,
        target: input.target,
        kind: input.kind,
        enabled: true,
    });
    save_config(&config)?;

    let plan = ActionPlan {
        operation: "create-mapping".to_string(),
        actions: vec![],
        summary: BTreeMap::new(),
        warnings: vec![],
        requires_admin: false,
    };
    let log_path = write_operation_log("create-link-mapping", &plan, &applied)?;

    Ok(ActionResult {
        ok: true,
        message: "Mapping created.".to_string(),
        log_path: Some(log_path.display().to_string()),
        actions: applied,
    })
}

fn list_backup_entries_inner() -> Result<Vec<BackupEntry>> {
    let config = load_config()?;
    let mut entries = Vec::new();

    for root in effective_backup_roots(&config)? {
        if !root.resolved_path.exists() {
            continue;
        }
        let read_dir = match fs::read_dir(&root.resolved_path) {
            Ok(read_dir) => read_dir,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            collect_entries(&root, &entry.path(), &mut entries, 0)?;
        }
    }

    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

fn read_text_preview_inner(path: String) -> Result<TextPreview> {
    let path = ensure_workspace_path(Path::new(&path))?;
    if !is_previewable_path(&path) {
        return Err(anyhow!("This file type is not previewable."));
    }
    let mut file = fs::File::open(&path)?;
    let mut buf = Vec::new();
    let limit = 256 * 1024;
    let mut handle = std::io::Read::by_ref(&mut file).take(limit as u64 + 1);
    handle.read_to_end(&mut buf)?;
    let truncated = buf.len() > limit;
    buf.truncate(limit);
    let content = String::from_utf8_lossy(&buf).to_string();
    Ok(TextPreview {
        path: path.display().to_string(),
        content,
        truncated,
    })
}

fn list_operation_logs_inner() -> Result<Vec<OperationLog>> {
    let config = load_config()?;
    let log_dir = resolve_path(&config.settings.log_dir, &repo_root())?;
    let mut logs = Vec::new();
    if !log_dir.exists() {
        return Ok(logs);
    }
    for entry in fs::read_dir(&log_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let meta = fs::metadata(&path).ok();
        logs.push(OperationLog {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.display().to_string(),
            modified: meta.as_ref().and_then(modified_secs),
            size: meta.as_ref().map(|m| m.len()),
        });
    }
    logs.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(logs)
}

fn open_path_inner(path: String) -> Result<()> {
    let path = PathBuf::from(path);
    if path.is_dir() {
        Command::new("explorer")
            .arg(path.as_os_str())
            .spawn()
            .context("failed to open directory in explorer")?;
        return Ok(());
    }
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Start-Process -LiteralPath $args[0]",
        ])
        .arg(path.as_os_str())
        .spawn()
        .context("failed to open path")?;
    Ok(())
}

fn reveal_path_inner(path: String) -> Result<()> {
    let path = PathBuf::from(path);
    let arg = format!("/select,{}", path.display());
    Command::new("explorer")
        .arg(arg)
        .spawn()
        .context("failed to reveal path")?;
    Ok(())
}

fn get_environment_summary_inner() -> Result<EnvironmentSummary> {
    migrate_legacy_config_to_default_profile()?;
    let config = load_config()?;
    let config_root = config_root_dir();
    let active_profile = active_profile_name();
    Ok(EnvironmentSummary {
        repo_root: repo_root().display().to_string(),
        config_root: config_root.display().to_string(),
        active_profile: active_profile.clone(),
        profiles: list_config_profiles_inner(&config_root, &active_profile)?,
        config_path: config_path().display().to_string(),
        primary_data_repo: resolve_primary_data_repo(&config)?.display().to_string(),
        is_admin: is_admin(),
        can_create_symlink: can_create_symlink_quiet(),
    })
}

fn get_link_settings_inner() -> Result<LinkSettings> {
    let config = load_config()?;
    Ok(LinkSettings {
        primary_data_repo: config.settings.primary_data_repo.clone(),
        resolved_primary_data_repo: resolve_primary_data_repo(&config)?.display().to_string(),
        data_repos: effective_data_repos(&config)?
            .into_iter()
            .map(|root| DataRepo {
                id: root.id,
                label: root.label,
                path: root.path.clone(),
                resolved_path: root.resolved_path.display().to_string(),
                enabled: root.enabled,
            })
            .collect(),
        mapping_roots: config
            .mapping_roots
            .iter()
            .map(|root| {
                let resolved_source =
                    if is_virtual_data_repo_id(root.data_repo_id.as_deref().unwrap_or("primary")) {
                        resolve_standalone_mapping_root_source(&root.source, &config).ok()
                    } else {
                        root.data_repo_id
                            .as_deref()
                            .and_then(|id| {
                                resolve_source_path_with_root(&root.source, &config, Some(id)).ok()
                            })
                            .or_else(|| {
                                resolve_source_path_with_root(
                                    &root.source,
                                    &config,
                                    Some("primary"),
                                )
                                .ok()
                            })
                    }
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|| root.source.clone());
                let resolved_target = resolve_path(&root.target, &repo_root())
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|_| root.target.clone());
                MappingRootSetting {
                    id: root.id.clone(),
                    label: root.label.clone(),
                    data_repo_id: root.data_repo_id.clone(),
                    source: root.source.clone(),
                    resolved_source,
                    target: root.target.clone(),
                    resolved_target,
                    mode: root.mode,
                    enabled: root.enabled,
                    ignore: root.ignore.clone(),
                }
            })
            .collect(),
        backup_roots: effective_backup_roots(&config)?
            .into_iter()
            .map(|root| BackupRoot {
                id: root.id,
                label: root.label,
                path: root.path,
                resolved_path: root.resolved_path.display().to_string(),
                enabled: root.enabled,
            })
            .collect(),
        backup_dir: config.settings.backup_dir.clone(),
        log_dir: config.settings.log_dir.clone(),
    })
}

fn update_config_dir_inner(input: UpdateConfigDirInput) -> Result<ActionResult> {
    if input.new_dir.trim().is_empty() {
        return Err(anyhow!("config directory cannot be empty"));
    }

    let old_config = config_path();
    let new_dir = resolve_path(input.new_dir.trim(), &repo_root())?;
    let profile = input
        .active_profile
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("default");
    validate_profile_name(profile)?;
    let new_profile_dir = new_dir.join(profile);
    let new_config = new_profile_dir.join("links.toml");
    let same_config = paths_equivalent(&old_config, &new_config);
    let mut applied = Vec::new();

    fs::create_dir_all(&new_profile_dir).with_context(|| {
        format!(
            "failed to create config profile directory {}",
            new_profile_dir.display()
        )
    })?;
    applied.push(AppliedAction {
        action_id: "ensure-config-dir".to_string(),
        kind: ActionKind::CreateLink,
        ok: true,
        message: format!(
            "Ensured config profile directory {}",
            new_profile_dir.display()
        ),
    });

    if input.copy_current_config && old_config.exists() && !same_config {
        if new_config.exists() {
            applied.push(AppliedAction {
                action_id: "copy-current-config".to_string(),
                kind: ActionKind::Skip,
                ok: true,
                message: format!(
                    "Skipped copying because target config already exists: {}",
                    new_config.display()
                ),
            });
        } else {
            fs::copy(&old_config, &new_config).with_context(|| {
                format!(
                    "failed to copy config from {} to {}",
                    old_config.display(),
                    new_config.display()
                )
            })?;
            applied.push(AppliedAction {
                action_id: "copy-current-config".to_string(),
                kind: ActionKind::BackupTarget,
                ok: true,
                message: format!(
                    "Copied current config from {} to {}",
                    old_config.display(),
                    new_config.display()
                ),
            });
        }
    }

    save_config_location(&ConfigLocation {
        config_dir: Some(input.new_dir.trim().to_string()),
        active_profile: profile.to_string(),
    })?;
    applied.push(AppliedAction {
        action_id: "save-config-location".to_string(),
        kind: ActionKind::CreateLink,
        ok: true,
        message: format!(
            "Saved config root {} with active profile {}",
            new_dir.display(),
            profile
        ),
    });

    Ok(ActionResult {
        ok: true,
        message: "Config directory updated.".to_string(),
        log_path: None,
        actions: applied,
    })
}

fn switch_config_profile_inner(input: SwitchConfigProfileInput) -> Result<ActionResult> {
    let profile = input.profile.trim();
    validate_profile_name(profile)?;
    let root = config_root_dir();
    let profile_dir = root.join(profile);
    fs::create_dir_all(&profile_dir)
        .with_context(|| format!("failed to create config profile {}", profile_dir.display()))?;
    let mut location = load_config_location().unwrap_or_default();
    location.active_profile = profile.to_string();
    save_config_location(&location)?;
    Ok(ActionResult {
        ok: true,
        message: format!("Switched to profile '{}'.", profile),
        log_path: None,
        actions: vec![AppliedAction {
            action_id: "switch-config-profile".to_string(),
            kind: ActionKind::CreateLink,
            ok: true,
            message: format!("Active profile: {}", profile),
        }],
    })
}

fn create_config_profile_inner(input: CreateConfigProfileInput) -> Result<ActionResult> {
    let profile = input.profile.trim();
    validate_profile_name(profile)?;
    let old_config = config_path();
    let root = config_root_dir();
    let profile_dir = root.join(profile);
    let new_config = profile_dir.join("links.toml");
    fs::create_dir_all(&profile_dir)
        .with_context(|| format!("failed to create config profile {}", profile_dir.display()))?;
    let mut applied = vec![AppliedAction {
        action_id: "ensure-config-profile".to_string(),
        kind: ActionKind::CreateLink,
        ok: true,
        message: format!("Ensured profile directory {}", profile_dir.display()),
    }];
    if input.copy_current_config && old_config.exists() && !new_config.exists() {
        fs::copy(&old_config, &new_config).with_context(|| {
            format!(
                "failed to copy config from {} to {}",
                old_config.display(),
                new_config.display()
            )
        })?;
        applied.push(AppliedAction {
            action_id: "copy-current-config".to_string(),
            kind: ActionKind::BackupTarget,
            ok: true,
            message: format!("Copied current config to {}", new_config.display()),
        });
    } else if !new_config.exists() {
        save_config_to_path(&LinksConfig::default(), &new_config)?;
        applied.push(AppliedAction {
            action_id: "create-empty-config".to_string(),
            kind: ActionKind::CreateLink,
            ok: true,
            message: format!("Created empty profile config {}", new_config.display()),
        });
    }
    let mut location = load_config_location().unwrap_or_default();
    location.active_profile = profile.to_string();
    save_config_location(&location)?;
    applied.push(AppliedAction {
        action_id: "activate-config-profile".to_string(),
        kind: ActionKind::CreateLink,
        ok: true,
        message: format!("Active profile: {}", profile),
    });
    Ok(ActionResult {
        ok: true,
        message: format!("Profile '{}' created.", profile),
        log_path: None,
        actions: applied,
    })
}

fn update_primary_data_repo_inner(input: UpdatePrimaryDataRepoInput) -> Result<ActionResult> {
    if input.new_root.trim().is_empty() {
        return Err(anyhow!("Primary Data Repo cannot be empty"));
    }

    let mut config = load_config()?;
    let old_root = resolve_primary_data_repo(&config)?;
    let new_root = resolve_path(input.new_root.trim(), &repo_root())?;
    let same_root = paths_equivalent(&old_root, &new_root);
    let mut applied = Vec::new();

    if input.move_data && !same_root {
        if normalize_components(&new_root).starts_with(&normalize_components(&old_root)) {
            return Err(anyhow!(
                "new Primary Data Repo cannot be inside the old Primary Data Repo when moving data"
            ));
        }
        if !old_root.exists() {
            applied.push(AppliedAction {
                action_id: "move-primary-data-repo".to_string(),
                kind: ActionKind::Skip,
                ok: true,
                message: format!(
                    "Old Primary Data Repo does not exist: {}",
                    old_root.display()
                ),
            });
        } else {
            ensure_can_receive_data_repo(&new_root)?;
            move_path(&old_root, &new_root)?;
            applied.push(AppliedAction {
                action_id: "move-primary-data-repo".to_string(),
                kind: ActionKind::BackupTarget,
                ok: true,
                message: format!(
                    "Moved Primary Data Repo from {} to {}",
                    old_root.display(),
                    new_root.display()
                ),
            });
        }
    }

    config.settings.primary_data_repo = input.new_root.trim().to_string();
    upsert_primary_data_repo(&mut config, input.new_root.trim());
    save_config(&config)?;
    applied.push(AppliedAction {
        action_id: "save-primary-data-repo".to_string(),
        kind: ActionKind::CreateLink,
        ok: true,
        message: format!("Saved Primary Data Repo: {}", new_root.display()),
    });

    let mut plan = ActionPlan {
        operation: "update-primary-data-repo".to_string(),
        actions: vec![],
        summary: BTreeMap::new(),
        warnings: vec![],
        requires_admin: false,
    };

    if input.rebuild_links {
        let link_ids = load_link_specs()?
            .into_iter()
            .map(|spec| spec.id)
            .collect::<Vec<_>>();
        plan = build_action_plan(&ActionRequest {
            link_ids,
            operation: "enable".to_string(),
            target_conflict_strategy: TargetConflictStrategy::Backup,
            remove_link_strategy: RemoveLinkStrategy::OnlyLink,
        })?;
        for action in &plan.actions {
            if action.kind == ActionKind::Skip || action.kind == ActionKind::Error {
                applied.push(AppliedAction {
                    action_id: action.id.clone(),
                    kind: action.kind,
                    ok: action.kind == ActionKind::Skip,
                    message: action.description.clone(),
                });
                continue;
            }

            match apply_one_action(action) {
                Ok(message) => applied.push(AppliedAction {
                    action_id: action.id.clone(),
                    kind: action.kind,
                    ok: true,
                    message,
                }),
                Err(err) => applied.push(AppliedAction {
                    action_id: action.id.clone(),
                    kind: action.kind,
                    ok: false,
                    message: error_string(err),
                }),
            }
        }
    }

    let ok = applied.iter().all(|item| item.ok);
    let log_path = write_operation_log("update-primary-data-repo", &plan, &applied)?;
    Ok(ActionResult {
        ok,
        message: if ok {
            "Primary Data Repo updated.".to_string()
        } else {
            "Primary Data Repo updated with errors.".to_string()
        },
        log_path: Some(log_path.display().to_string()),
        actions: applied,
    })
}

fn scan_data_repo_changes_inner(data_repo_id: String) -> Result<ScanChangesResult> {
    let config = load_config()?;
    let repo = resolve_data_repo(&data_repo_id, &config)?;
    let mapping_roots = config
        .mapping_roots
        .iter()
        .filter(|root| {
            root.enabled && root.data_repo_id.as_deref().unwrap_or("primary") == data_repo_id
        })
        .collect::<Vec<_>>();
    let repo_entries = list_direct_child_names(&repo.resolved_path)?;
    let covered = mapping_roots
        .iter()
        .map(|root| first_path_part(&root.source).unwrap_or_else(|| root.source.clone()))
        .collect::<HashSet<_>>();
    let missing_sources = mapping_roots
        .iter()
        .filter_map(|root| {
            let source =
                resolve_source_path_with_root(&root.source, &config, Some(&repo.id)).ok()?;
            if source.exists() {
                None
            } else {
                Some(format!("源缺失：{} -> {}", root.id, source.display()))
            }
        })
        .collect::<Vec<_>>();
    let uncovered = repo_entries
        .iter()
        .filter(|entry| !covered.contains(*entry))
        .cloned()
        .collect::<Vec<_>>();
    let mut details = Vec::new();
    details.push("已配置 Mapping Roots:".to_string());
    details.extend(
        mapping_roots
            .iter()
            .map(|root| format!("  {}：{} -> {}", root.id, root.source, root.target)),
    );
    if !uncovered.is_empty() {
        details.push("新增/未覆盖的顶层目录:".to_string());
        details.extend(uncovered.iter().map(|item| format!("  + {}", item)));
    }
    if !missing_sources.is_empty() {
        details.push("已配置但源缺失:".to_string());
        details.extend(missing_sources.iter().cloned());
    }

    Ok(ScanChangesResult {
        title: format!("扫描 Data Repo：{}", repo.label),
        summary: vec![
            format!("路径：{}", repo.resolved_path.display()),
            format!("Mapping Roots：{}", mapping_roots.len()),
            format!("顶层条目：{}", repo_entries.len()),
            format!("未被 Mapping Roots 覆盖的顶层条目：{}", uncovered.len()),
            format!("已配置但源缺失：{}", missing_sources.len()),
        ],
        details,
    })
}

fn scan_mapping_root_changes_inner(mapping_root_id: String) -> Result<ScanChangesResult> {
    let config = load_config()?;
    let root = config
        .mapping_roots
        .iter()
        .find(|root| root.id == mapping_root_id)
        .ok_or_else(|| anyhow!("Mapping Root not found: {}", mapping_root_id))?;
    let source = if is_virtual_data_repo_id(root.data_repo_id.as_deref().unwrap_or("primary")) {
        resolve_standalone_mapping_root_source(&root.source, &config)?
    } else {
        let data_repo_id = root.data_repo_id.as_deref().unwrap_or("primary");
        resolve_source_path_with_root(&root.source, &config, Some(data_repo_id))?
    };
    let entries = list_direct_child_names(&source)?;
    let ignored = root.ignore.iter().cloned().collect::<HashSet<_>>();
    let ignored_missing = root
        .ignore
        .iter()
        .filter(|item| !entries.iter().any(|entry| entry.eq_ignore_ascii_case(item)))
        .cloned()
        .collect::<Vec<_>>();
    let active = entries
        .iter()
        .filter(|entry| !ignored.contains(*entry))
        .cloned()
        .collect::<Vec<_>>();
    let mut details = Vec::new();
    details.push("新增/当前映射候选:".to_string());
    details.extend(active.iter().map(|entry| format!("  + {}", entry)));
    if !ignored.is_empty() {
        details.push("已忽略:".to_string());
        details.extend(root.ignore.iter().map(|entry| {
            if ignored_missing.iter().any(|missing| missing == entry) {
                format!("  - {} (当前目录中不存在)", entry)
            } else {
                format!("  - {}", entry)
            }
        }));
    }

    Ok(ScanChangesResult {
        title: format!("扫描 Mapping Root：{}", root.label),
        summary: vec![
            format!("源目录：{}", source.display()),
            format!("目标根：{}", root.target),
            format!("目录模式：{:?}", root.mode),
            format!("直接子项：{}", entries.len()),
            format!("忽略项：{}", root.ignore.len()),
            format!("忽略但当前不存在：{}", ignored_missing.len()),
            format!(
                "会生成/显示的映射：{}",
                if root.mode == RootMode::Direct {
                    1
                } else {
                    active.len()
                }
            ),
        ],
        details,
    })
}

fn preview_standalone_mapping_root_cleanup_inner(
    input: PreviewStandaloneMappingRootCleanupInput,
) -> Result<StandaloneMappingRootCleanupPreview> {
    let config = load_config()?;
    let source = resolve_standalone_mapping_root_source(&input.source, &config)?;
    validate_standalone_source_outside_data_repos(&source, &config)?;
    let overlapping_free_links = overlapping_free_links_for_source(&config, &source)?;
    Ok(StandaloneMappingRootCleanupPreview {
        resolved_source: source.display().to_string(),
        overlapping_free_links,
    })
}

fn list_direct_child_names(path: &Path) -> Result<Vec<String>> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut names = fs::read_dir(path)?
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    names.sort_by_key(|name| name.to_lowercase());
    Ok(names)
}

fn first_path_part(path: &str) -> Option<String> {
    path.replace('\\', "/")
        .split('/')
        .find(|part| !part.is_empty())
        .map(str::to_string)
}

fn upsert_primary_data_repo(config: &mut LinksConfig, path: &str) {
    match config
        .data_repos
        .iter_mut()
        .find(|root| root.id == "primary")
    {
        Some(root) => {
            root.label = if root.label.trim().is_empty() {
                "Primary Data Repo".to_string()
            } else {
                root.label.clone()
            };
            root.path = path.to_string();
            root.enabled = true;
        }
        None => config.data_repos.push(DataRepoConfig {
            id: "primary".to_string(),
            label: "Primary Data Repo".to_string(),
            path: path.to_string(),
            enabled: true,
        }),
    }
}

fn upsert_data_repo_inner(input: UpsertDataRepoInput) -> Result<ActionResult> {
    validate_id(&input.id)?;
    if is_virtual_data_repo_id(input.id.trim()) {
        return Err(anyhow!(
            "'{}' is reserved for independent Mapping Roots and cannot be used as a Data Repo id",
            VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID
        ));
    }
    if input.label.trim().is_empty() || input.path.trim().is_empty() {
        return Err(anyhow!("Data Repo label and path are required"));
    }

    let mut config = load_config()?;
    let new_root_path = resolve_path(input.path.trim(), &repo_root())?;
    let mut applied = Vec::new();

    if let Some(source_root_id) = input.move_data_from_repo_id.as_deref() {
        let from = resolve_data_repo(source_root_id, &config)?;
        if !paths_equivalent(&from.resolved_path, &new_root_path) {
            if normalize_components(&new_root_path)
                .starts_with(&normalize_components(&from.resolved_path))
            {
                return Err(anyhow!(
                    "new Data Repo cannot be inside the source Data Repo when moving data"
                ));
            }
            if from.resolved_path.exists() {
                ensure_can_receive_data_repo(&new_root_path)?;
                move_path(&from.resolved_path, &new_root_path)?;
                applied.push(AppliedAction {
                    action_id: "move-data-repo".to_string(),
                    kind: ActionKind::BackupTarget,
                    ok: true,
                    message: format!(
                        "Moved Data Repo from {} to {}",
                        from.resolved_path.display(),
                        new_root_path.display()
                    ),
                });
            } else {
                applied.push(AppliedAction {
                    action_id: "move-data-repo".to_string(),
                    kind: ActionKind::Skip,
                    ok: true,
                    message: format!(
                        "Source Data Repo does not exist: {}",
                        from.resolved_path.display()
                    ),
                });
            }
        }
    } else {
        fs::create_dir_all(&new_root_path)?;
        applied.push(AppliedAction {
            action_id: "ensure-data-repo".to_string(),
            kind: ActionKind::CreateLink,
            ok: true,
            message: format!("Ensured Data Repo exists: {}", new_root_path.display()),
        });
    }

    match config
        .data_repos
        .iter_mut()
        .find(|root| root.id == input.id)
    {
        Some(root) => {
            root.label = input.label.trim().to_string();
            root.path = input.path.trim().to_string();
            root.enabled = true;
        }
        None => config.data_repos.push(DataRepoConfig {
            id: input.id.clone(),
            label: input.label.trim().to_string(),
            path: input.path.trim().to_string(),
            enabled: true,
        }),
    }
    save_config(&config)?;
    applied.push(AppliedAction {
        action_id: "save-data-repo".to_string(),
        kind: ActionKind::CreateLink,
        ok: true,
        message: format!("Saved Data Repo '{}'", input.id),
    });

    let mut plan = ActionPlan {
        operation: "upsert-link-data-root".to_string(),
        actions: vec![],
        summary: BTreeMap::new(),
        warnings: vec![],
        requires_admin: false,
    };

    if input.rebuild_links {
        let link_ids = load_link_specs()?
            .into_iter()
            .filter(|spec| spec.data_repo_id.as_deref() == Some(input.id.as_str()))
            .map(|spec| spec.id)
            .collect::<Vec<_>>();
        plan = build_action_plan(&ActionRequest {
            link_ids,
            operation: "enable".to_string(),
            target_conflict_strategy: TargetConflictStrategy::Backup,
            remove_link_strategy: RemoveLinkStrategy::OnlyLink,
        })?;
        for action in &plan.actions {
            if action.kind == ActionKind::Skip || action.kind == ActionKind::Error {
                applied.push(AppliedAction {
                    action_id: action.id.clone(),
                    kind: action.kind,
                    ok: action.kind == ActionKind::Skip,
                    message: action.description.clone(),
                });
                continue;
            }
            match apply_one_action(action) {
                Ok(message) => applied.push(AppliedAction {
                    action_id: action.id.clone(),
                    kind: action.kind,
                    ok: true,
                    message,
                }),
                Err(err) => applied.push(AppliedAction {
                    action_id: action.id.clone(),
                    kind: action.kind,
                    ok: false,
                    message: error_string(err),
                }),
            }
        }
    }

    let ok = applied.iter().all(|item| item.ok);
    let log_path = write_operation_log("upsert-link-data-root", &plan, &applied)?;
    Ok(ActionResult {
        ok,
        message: if ok {
            "Data root saved.".to_string()
        } else {
            "Data root saved with errors.".to_string()
        },
        log_path: Some(log_path.display().to_string()),
        actions: applied,
    })
}

fn upsert_backup_root_inner(input: UpsertBackupRootInput) -> Result<ActionResult> {
    validate_id(&input.id)?;
    if input.label.trim().is_empty() || input.path.trim().is_empty() {
        return Err(anyhow!("backup root label and path are required"));
    }

    let mut config = load_config()?;
    if config.backup_roots.is_empty() {
        config.backup_roots.push(BackupRootConfig {
            id: "backup-or-settings".to_string(),
            label: "backup-or-settings".to_string(),
            path: "backup-or-settings".to_string(),
            enabled: true,
        });
    }

    let resolved_path = resolve_path(input.path.trim(), &repo_root())?;
    fs::create_dir_all(&resolved_path)?;

    match config
        .backup_roots
        .iter_mut()
        .find(|root| root.id == input.id)
    {
        Some(root) => {
            root.label = input.label.trim().to_string();
            root.path = input.path.trim().to_string();
            root.enabled = true;
        }
        None => config.backup_roots.push(BackupRootConfig {
            id: input.id.clone(),
            label: input.label.trim().to_string(),
            path: input.path.trim().to_string(),
            enabled: true,
        }),
    }
    save_config(&config)?;

    Ok(ActionResult {
        ok: true,
        message: format!("Backup root '{}' saved.", input.id),
        log_path: None,
        actions: vec![AppliedAction {
            action_id: "save-backup-root".to_string(),
            kind: ActionKind::CreateLink,
            ok: true,
            message: format!("Saved backup root: {}", resolved_path.display()),
        }],
    })
}

fn upsert_mapping_root_inner(input: UpsertMappingRootInput) -> Result<ActionResult> {
    let id = input.id.trim();
    let label = input.label.trim();
    let source = input.source.trim();
    let target = input.target.trim();
    if id.is_empty() || label.is_empty() || source.is_empty() || target.is_empty() {
        return Err(anyhow!(
            "Mapping Root id, label, source, and target are required"
        ));
    }
    validate_id(id)?;

    let mut config = load_config()?;
    let data_repo_id = input
        .data_repo_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let is_standalone = is_virtual_data_repo_id(data_repo_id.as_deref().unwrap_or("primary"));
    let cleanup_free_link_ids = input
        .cleanup_free_link_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if is_standalone {
        let root_source = resolve_standalone_mapping_root_source(source, &config)?;
        validate_standalone_source_outside_data_repos(&root_source, &config)?;
        validate_standalone_cleanup_confirmation(&config, &root_source, &cleanup_free_link_ids)?;
    } else {
        let resolved_data_repo_id = data_repo_id.as_deref().unwrap_or("primary");
        resolve_data_repo(resolved_data_repo_id, &config).with_context(|| {
            format!(
                "Data Repo not found for Mapping Root: {}",
                resolved_data_repo_id
            )
        })?;
    }

    let normalized_ignore = input
        .ignore
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    let mut applied = Vec::new();
    match config.mapping_roots.iter_mut().find(|root| root.id == id) {
        Some(root) => {
            root.label = label.to_string();
            root.data_repo_id = data_repo_id;
            root.source = source.to_string();
            root.target = target.to_string();
            root.mode = input.mode;
            root.enabled = input.enabled;
            root.ignore = normalized_ignore;
            applied.push(AppliedAction {
                action_id: "update-mapping-root".to_string(),
                kind: ActionKind::CreateLink,
                ok: true,
                message: format!("Updated Mapping Root '{}'", id),
            });
        }
        None => {
            config.mapping_roots.push(MappingRootConfig {
                id: id.to_string(),
                label: label.to_string(),
                data_repo_id,
                source: source.to_string(),
                target: target.to_string(),
                mode: input.mode,
                enabled: input.enabled,
                ignore: normalized_ignore,
            });
            applied.push(AppliedAction {
                action_id: "create-mapping-root".to_string(),
                kind: ActionKind::CreateLink,
                ok: true,
                message: format!("Created Mapping Root '{}'", id),
            });
        }
    }

    if is_standalone && !cleanup_free_link_ids.is_empty() {
        let cleanup_ids = cleanup_free_link_ids
            .iter()
            .cloned()
            .collect::<HashSet<_>>();
        let removed = config
            .free_links
            .iter()
            .filter(|link| cleanup_ids.contains(&link.id))
            .map(|link| format!("{} ({})", link.label, link.id))
            .collect::<Vec<_>>();
        config
            .free_links
            .retain(|link| !cleanup_ids.contains(&link.id));
        for item in removed {
            applied.push(AppliedAction {
                action_id: "remove-overlapping-free-link".to_string(),
                kind: ActionKind::CreateLink,
                ok: true,
                message: format!("Removed overlapping Free Link record {}", item),
            });
        }
    }

    save_config(&config)?;
    applied.push(AppliedAction {
        action_id: "save-config".to_string(),
        kind: ActionKind::CreateLink,
        ok: true,
        message: format!("Saved Mapping Root '{}'", id),
    });

    Ok(ActionResult {
        ok: true,
        message: "Mapping Root saved.".to_string(),
        log_path: None,
        actions: applied,
    })
}

fn export_mklink_script_inner(input: ExportMklinkScriptInput) -> Result<ActionResult> {
    let config = load_config()?;
    let output_path = if input.output_path.trim().is_empty() {
        config_dir().join("exported-mklink.md")
    } else {
        resolve_path(input.output_path.trim(), &repo_root())?
    };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let content = render_mklink_export(
        &config,
        input.use_mapping_root_helper,
        input.helper_script_path.trim(),
        input.target_conflict_strategy,
    )?;
    fs::write(&output_path, content)?;

    Ok(ActionResult {
        ok: true,
        message: format!("mklink script exported to {}", output_path.display()),
        log_path: None,
        actions: vec![AppliedAction {
            action_id: "export-mklink-script".to_string(),
            kind: ActionKind::CreateLink,
            ok: true,
            message: format!("Exported {}", output_path.display()),
        }],
    })
}

fn move_link_source_inner(input: MoveLinkSourceInput) -> Result<ActionResult> {
    if input.new_source.trim().is_empty() {
        return Err(anyhow!("new source cannot be empty"));
    }

    let mut config = load_config()?;
    let specs = load_link_specs()?;
    let spec = specs
        .iter()
        .find(|spec| spec.id == input.link_id)
        .cloned()
        .ok_or_else(|| anyhow!("mapping not found: {}", input.link_id))?;
    let new_source = resolve_source_path_with_root(
        input.new_source.trim(),
        &config,
        spec.data_repo_id.as_deref(),
    )?;

    if paths_equivalent(&spec.source, &new_source) {
        return Err(anyhow!("new source is the same as current source"));
    }
    if new_source.exists() {
        return Err(anyhow!(
            "new source already exists: {}",
            new_source.display()
        ));
    }

    let new_target = moved_source_target(&spec.target, &new_source, input.sync_target_name)?;
    validate_target_for_source_move(&spec.target, &new_target)?;

    move_path(&spec.source, &new_source)?;
    update_mapping_source_config(
        &mut config,
        &spec,
        input.new_source.trim(),
        &new_target.display().to_string(),
    )?;
    save_config(&config)?;

    let mut applied = vec![
        AppliedAction {
            action_id: "move-source".to_string(),
            kind: ActionKind::BackupTarget,
            ok: true,
            message: format!(
                "Moved source {} to {}",
                spec.source.display(),
                new_source.display()
            ),
        },
        AppliedAction {
            action_id: "save-source".to_string(),
            kind: ActionKind::CreateLink,
            ok: true,
            message: format!("Updated mapping source to {}", input.new_source.trim()),
        },
    ];

    if let Ok(meta) = fs::symlink_metadata(&spec.target) {
        if is_link_like(&meta) {
            remove_link_path(&spec.target)?;
            applied.push(AppliedAction {
                action_id: "remove-old-target-link".to_string(),
                kind: ActionKind::RemoveLink,
                ok: true,
                message: format!("Removed old target link {}", spec.target.display()),
            });
        } else {
            return Err(anyhow!(
                "target has real content and will not be replaced: {}",
                spec.target.display()
            ));
        }
    }

    if !paths_equivalent(&spec.target, &new_target) {
        if let Ok(meta) = fs::symlink_metadata(&new_target) {
            if is_link_like(&meta) {
                remove_link_path(&new_target)?;
                applied.push(AppliedAction {
                    action_id: "remove-new-target-link".to_string(),
                    kind: ActionKind::RemoveLink,
                    ok: true,
                    message: format!("Removed existing new target link {}", new_target.display()),
                });
            }
        }
    }

    if !paths_equivalent(&spec.target, &new_target) {
        applied.push(AppliedAction {
            action_id: "sync-target-name".to_string(),
            kind: ActionKind::CreateLink,
            ok: true,
            message: format!(
                "Target link name synced from {} to {}",
                spec.target.display(),
                new_target.display()
            ),
        });
    }

    create_parent_dir(&new_target)?;
    create_link(&new_source, &new_target, spec.kind)?;
    applied.push(AppliedAction {
        action_id: "relink-target".to_string(),
        kind: ActionKind::CreateLink,
        ok: true,
        message: format!(
            "Relinked {} -> {}",
            new_target.display(),
            new_source.display()
        ),
    });

    let plan = ActionPlan {
        operation: "move-link-source".to_string(),
        actions: vec![],
        summary: BTreeMap::new(),
        warnings: vec![],
        requires_admin: false,
    };
    let log_path = write_operation_log("move-link-source", &plan, &applied)?;
    Ok(ActionResult {
        ok: true,
        message: "Source moved and link updated.".to_string(),
        log_path: Some(log_path.display().to_string()),
        actions: applied,
    })
}

fn update_link_metadata_inner(input: UpdateLinkMetadataInput) -> Result<ActionResult> {
    let old_id = input.link_id.trim();
    let new_id = input.new_id.trim();
    let label = input.label.trim();
    validate_id(new_id)?;
    if label.is_empty() {
        return Err(anyhow!("display name cannot be empty"));
    }

    let specs = load_link_specs()?;
    let spec = specs
        .iter()
        .find(|spec| spec.id == old_id)
        .cloned()
        .ok_or_else(|| anyhow!("mapping not found: {}", old_id))?;
    if !spec.is_free_link && spec.id.contains("::") {
        return Err(anyhow!(
            "this row is generated by Mapping Root '{}'; edit the Mapping Root or create a free link instead",
            spec.group_label
        ));
    }

    let mut config = load_config()?;
    update_link_metadata_config(&mut config, &spec, new_id, label)?;
    save_config(&config)?;

    let applied = vec![AppliedAction {
        action_id: "update-link-metadata".to_string(),
        kind: ActionKind::CreateLink,
        ok: true,
        message: format!(
            "Updated mapping metadata: {} -> {}, label {}",
            old_id, new_id, label
        ),
    }];
    let plan = ActionPlan {
        operation: "update-link-metadata".to_string(),
        actions: vec![],
        summary: BTreeMap::new(),
        warnings: vec![],
        requires_admin: false,
    };
    let log_path = write_operation_log("update-link-metadata", &plan, &applied)?;
    Ok(ActionResult {
        ok: true,
        message: "Mapping metadata updated.".to_string(),
        log_path: Some(log_path.display().to_string()),
        actions: applied,
    })
}

fn relaunch_as_admin_inner(app: tauri::AppHandle) -> Result<()> {
    if is_admin() {
        return Ok(());
    }

    #[cfg(windows)]
    {
        let exe = std::env::current_exe().context("failed to resolve current executable")?;
        let command = format!(
            "Start-Process -FilePath {} -Verb RunAs",
            powershell_single_quoted_path(&exe)
        );
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &command,
            ])
            .output()
            .context("failed to request administrator relaunch")?;
        if !output.status.success() {
            return Err(powershell_failure(
                "Start-Process -Verb RunAs",
                &exe,
                &output,
            ));
        }
        app.exit(0);
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        Err(anyhow!(
            "administrator relaunch is only supported on Windows"
        ))
    }
}

fn update_link_metadata_config(
    config: &mut LinksConfig,
    spec: &LinkSpec,
    new_id: &str,
    label: &str,
) -> Result<()> {
    if new_id != spec.id {
        let duplicate_free_link = config.free_links.iter().any(|item| item.id == new_id);
        let duplicate_root = config.mapping_roots.iter().any(|root| root.id == new_id);
        if duplicate_free_link || duplicate_root {
            return Err(anyhow!("A mapping with id '{}' already exists.", new_id));
        }
    }

    if spec.is_free_link {
        let item = config
            .free_links
            .iter_mut()
            .find(|item| item.id == spec.id)
            .ok_or_else(|| anyhow!("free link not found: {}", spec.id))?;
        item.id = new_id.to_string();
        item.label = label.to_string();
    } else {
        let root = config
            .mapping_roots
            .iter_mut()
            .find(|root| root.id == spec.id)
            .ok_or_else(|| anyhow!("Mapping Root not found: {}", spec.id))?;
        root.id = new_id.to_string();
        root.label = label.to_string();
    }
    Ok(())
}

fn append_enable_actions(
    spec: &LinkSpec,
    record: &LinkRecord,
    actions: &mut Vec<LinkAction>,
    target_conflict_strategy: TargetConflictStrategy,
) -> Result<()> {
    match record.status {
        LinkStatus::Enabled => push_action(
            actions,
            spec,
            ActionKind::Skip,
            ActionSeverity::Info,
            "Already linked to the expected source.",
            None,
        ),
        LinkStatus::SourceMissing => push_action(
            actions,
            spec,
            ActionKind::Error,
            ActionSeverity::Danger,
            "Source is missing; link cannot be created.",
            None,
        ),
        LinkStatus::Missing => push_action(
            actions,
            spec,
            ActionKind::CreateLink,
            ActionSeverity::Info,
            "Create target link.",
            None,
        ),
        LinkStatus::WrongTarget | LinkStatus::Broken => {
            push_action(
                actions,
                spec,
                ActionKind::RemoveLink,
                ActionSeverity::Warning,
                "Remove existing link before recreating it.",
                None,
            );
            push_action(
                actions,
                spec,
                ActionKind::CreateLink,
                ActionSeverity::Info,
                "Create target link.",
                None,
            );
        }
        LinkStatus::RealContent => {
            match target_conflict_strategy {
                TargetConflictStrategy::Backup => {
                    let backup_path = backup_path_for(&spec.target)?;
                    push_action(
                        actions,
                        spec,
                        ActionKind::BackupTarget,
                        ActionSeverity::Danger,
                        "Back up real target content before replacing it.",
                        Some(backup_path.display().to_string()),
                    );
                }
                TargetConflictStrategy::Delete => push_action(
                    actions,
                    spec,
                    ActionKind::DeleteTarget,
                    ActionSeverity::Danger,
                    "Delete real target content before replacing it.",
                    None,
                ),
            }
            push_action(
                actions,
                spec,
                ActionKind::CreateLink,
                ActionSeverity::Info,
                "Create target link after backup.",
                None,
            );
        }
    }
    Ok(())
}

fn append_remove_actions(
    spec: &LinkSpec,
    record: &LinkRecord,
    actions: &mut Vec<LinkAction>,
    remove_link_strategy: RemoveLinkStrategy,
) {
    match record.status {
        LinkStatus::Enabled | LinkStatus::WrongTarget | LinkStatus::Broken => {
            push_action(
                actions,
                spec,
                ActionKind::RemoveLink,
                ActionSeverity::Warning,
                "Remove target link; source data is left untouched.",
                None,
            );
            match remove_link_strategy {
                RemoveLinkStrategy::OnlyLink => {}
                RemoveLinkStrategy::RestoreBackup => {
                    let backup_path = latest_backup_for_target(&spec.target)
                        .map(|path| path.display().to_string());
                    push_action(
                        actions,
                        spec,
                        if backup_path.is_some() {
                            ActionKind::RestoreBackup
                        } else {
                            ActionKind::Error
                        },
                        if backup_path.is_some() {
                            ActionSeverity::Warning
                        } else {
                            ActionSeverity::Danger
                        },
                        if backup_path.is_some() {
                            "Restore latest target backup after removing the link."
                        } else {
                            "No backup was found for this target."
                        },
                        backup_path,
                    );
                }
                RemoveLinkStrategy::CopySource => push_action(
                    actions,
                    spec,
                    ActionKind::CopySourceToTarget,
                    ActionSeverity::Warning,
                    "Copy source content to the target path after removing the link.",
                    None,
                ),
            }
        }
        LinkStatus::Missing | LinkStatus::SourceMissing => push_action(
            actions,
            spec,
            ActionKind::Skip,
            ActionSeverity::Info,
            "Target link is not present.",
            None,
        ),
        LinkStatus::RealContent => push_action(
            actions,
            spec,
            ActionKind::Error,
            ActionSeverity::Danger,
            "Target is real content, not a link; refusing to delete it.",
            None,
        ),
    }
}

fn push_action(
    actions: &mut Vec<LinkAction>,
    spec: &LinkSpec,
    kind: ActionKind,
    severity: ActionSeverity,
    description: &str,
    backup_path: Option<String>,
) {
    let action_index = actions.len() + 1;
    actions.push(LinkAction {
        id: format!("{}:{}:{action_index}", spec.id, action_key(kind)),
        link_id: spec.id.clone(),
        kind,
        severity,
        description: description.to_string(),
        source: Some(spec.source.display().to_string()),
        target: Some(spec.target.display().to_string()),
        backup_path,
    });
}

fn apply_one_action(action: &LinkAction) -> Result<String> {
    match action.kind {
        ActionKind::BackupTarget => {
            let target = action_target(action)?;
            let backup = action
                .backup_path
                .as_ref()
                .map(PathBuf::from)
                .ok_or_else(|| anyhow!("backup path is missing"))?;
            backup_real_target(&target, &backup)?;
            Ok(format!(
                "Backed up {} to {}",
                target.display(),
                backup.display()
            ))
        }
        ActionKind::DeleteTarget => {
            let target = action_target(action)?;
            remove_real_path(&target)?;
            Ok(format!("Deleted real target {}", target.display()))
        }
        ActionKind::RemoveLink => {
            let target = action_target(action)?;
            remove_link_path(&target)?;
            Ok(format!("Removed link {}", target.display()))
        }
        ActionKind::RestoreBackup => {
            let target = action_target(action)?;
            let backup = action
                .backup_path
                .as_ref()
                .map(PathBuf::from)
                .ok_or_else(|| anyhow!("backup path is missing"))?;
            restore_backup_to_target(&backup, &target)?;
            Ok(format!(
                "Restored backup {} to {}",
                backup.display(),
                target.display()
            ))
        }
        ActionKind::CopySourceToTarget => {
            let source = action_source(action)?;
            let target = action_target(action)?;
            copy_path(&source, &target)?;
            Ok(format!(
                "Copied {} to {}",
                source.display(),
                target.display()
            ))
        }
        ActionKind::CreateLink => {
            let source = action_source(action)?;
            let target = action_target(action)?;
            create_parent_dir(&target)?;
            create_link(&source, &target, LinkKind::Auto)?;
            Ok(format!(
                "Linked {} -> {}",
                target.display(),
                source.display()
            ))
        }
        ActionKind::Skip | ActionKind::Error => Ok(action.description.clone()),
    }
}

fn action_source(action: &LinkAction) -> Result<PathBuf> {
    action
        .source
        .as_ref()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow!("action source is missing"))
}

fn action_target(action: &LinkAction) -> Result<PathBuf> {
    action
        .target
        .as_ref()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow!("action target is missing"))
}

fn action_key(kind: ActionKind) -> &'static str {
    match kind {
        ActionKind::CreateLink => "create-link",
        ActionKind::RemoveLink => "remove-link",
        ActionKind::BackupTarget => "backup-target",
        ActionKind::DeleteTarget => "delete-target",
        ActionKind::RestoreBackup => "restore-backup",
        ActionKind::CopySourceToTarget => "copy-source-to-target",
        ActionKind::Skip => "skip",
        ActionKind::Error => "error",
    }
}

#[derive(Debug, Clone, Copy)]
enum Operation {
    Enable,
    Remove,
}

fn parse_operation(value: &str) -> Result<Operation> {
    match value {
        "enable" => Ok(Operation::Enable),
        "remove" => Ok(Operation::Remove),
        other => Err(anyhow!("unsupported operation '{}'", other)),
    }
}

fn classify_link(spec: &LinkSpec) -> LinkRecord {
    let mut notes = Vec::new();
    let source_exists = spec.source.exists();
    if !source_exists {
        return LinkRecord {
            id: spec.id.clone(),
            label: spec.label.clone(),
            group_id: spec.group_id.clone(),
            group_label: spec.group_label.clone(),
            source: spec.source.display().to_string(),
            target: spec.target.display().to_string(),
            kind: spec.kind,
            source_config: spec.source_config.clone(),
            data_repo_id: spec.data_repo_id.clone(),
            status: LinkStatus::SourceMissing,
            source_exists,
            target_exists: spec.target.exists(),
            current_target: None,
            is_free_link: spec.is_free_link,
            notes: vec!["Source path is missing.".to_string()],
        };
    }

    let target_meta = match fs::symlink_metadata(&spec.target) {
        Ok(meta) => meta,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return LinkRecord {
                id: spec.id.clone(),
                label: spec.label.clone(),
                group_id: spec.group_id.clone(),
                group_label: spec.group_label.clone(),
                source: spec.source.display().to_string(),
                target: spec.target.display().to_string(),
                kind: spec.kind,
                source_config: spec.source_config.clone(),
                data_repo_id: spec.data_repo_id.clone(),
                status: LinkStatus::Missing,
                source_exists,
                target_exists: false,
                current_target: None,
                is_free_link: spec.is_free_link,
                notes,
            }
        }
        Err(err) => {
            return LinkRecord {
                id: spec.id.clone(),
                label: spec.label.clone(),
                group_id: spec.group_id.clone(),
                group_label: spec.group_label.clone(),
                source: spec.source.display().to_string(),
                target: spec.target.display().to_string(),
                kind: spec.kind,
                source_config: spec.source_config.clone(),
                data_repo_id: spec.data_repo_id.clone(),
                status: LinkStatus::Broken,
                source_exists,
                target_exists: false,
                current_target: None,
                is_free_link: spec.is_free_link,
                notes: vec![format!("Could not inspect target: {err}")],
            }
        }
    };

    if !is_link_like(&target_meta) {
        return LinkRecord {
            id: spec.id.clone(),
            label: spec.label.clone(),
            group_id: spec.group_id.clone(),
            group_label: spec.group_label.clone(),
            source: spec.source.display().to_string(),
            target: spec.target.display().to_string(),
            kind: spec.kind,
            source_config: spec.source_config.clone(),
            data_repo_id: spec.data_repo_id.clone(),
            status: LinkStatus::RealContent,
            source_exists,
            target_exists: true,
            current_target: None,
            is_free_link: spec.is_free_link,
            notes: vec!["Target contains real content.".to_string()],
        };
    }

    match fs::read_link(&spec.target) {
        Ok(link_target) => {
            let resolved = if link_target.is_absolute() {
                link_target
            } else {
                spec.target
                    .parent()
                    .unwrap_or_else(|| Path::new(""))
                    .join(link_target)
            };
            let current_target = Some(resolved.display().to_string());
            if !resolved.exists() {
                notes.push("Link points to a missing path.".to_string());
                return LinkRecord {
                    id: spec.id.clone(),
                    label: spec.label.clone(),
                    group_id: spec.group_id.clone(),
                    group_label: spec.group_label.clone(),
                    source: spec.source.display().to_string(),
                    target: spec.target.display().to_string(),
                    kind: spec.kind,
                    source_config: spec.source_config.clone(),
                    data_repo_id: spec.data_repo_id.clone(),
                    status: LinkStatus::Broken,
                    source_exists,
                    target_exists: true,
                    current_target,
                    is_free_link: spec.is_free_link,
                    notes,
                };
            }
            let status = if paths_equivalent(&resolved, &spec.source) {
                LinkStatus::Enabled
            } else {
                LinkStatus::WrongTarget
            };
            LinkRecord {
                id: spec.id.clone(),
                label: spec.label.clone(),
                group_id: spec.group_id.clone(),
                group_label: spec.group_label.clone(),
                source: spec.source.display().to_string(),
                target: spec.target.display().to_string(),
                kind: spec.kind,
                source_config: spec.source_config.clone(),
                data_repo_id: spec.data_repo_id.clone(),
                status,
                source_exists,
                target_exists: true,
                current_target,
                is_free_link: spec.is_free_link,
                notes,
            }
        }
        Err(err) => LinkRecord {
            id: spec.id.clone(),
            label: spec.label.clone(),
            group_id: spec.group_id.clone(),
            group_label: spec.group_label.clone(),
            source: spec.source.display().to_string(),
            target: spec.target.display().to_string(),
            kind: spec.kind,
            source_config: spec.source_config.clone(),
            data_repo_id: spec.data_repo_id.clone(),
            status: LinkStatus::Broken,
            source_exists,
            target_exists: true,
            current_target: None,
            is_free_link: spec.is_free_link,
            notes: vec![format!("Could not read link target: {err}")],
        },
    }
}

fn load_link_specs() -> Result<Vec<LinkSpec>> {
    let config = load_config()?;
    let repo = repo_root();
    let mut specs = Vec::new();

    for root in config.mapping_roots.iter().filter(|root| root.enabled) {
        let is_standalone =
            is_virtual_data_repo_id(root.data_repo_id.as_deref().unwrap_or("primary"));
        let (root_source, group_id, group_label, spec_data_repo_id) = if is_standalone {
            let source = resolve_standalone_mapping_root_source(&root.source, &config)?;
            validate_standalone_source_outside_data_repos(&source, &config)?;
            (
                source,
                VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID.to_string(),
                VIRTUAL_INDEPENDENT_MAPPING_ROOTS_LABEL.to_string(),
                Some(VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID.to_string()),
            )
        } else {
            let data_repo =
                resolve_data_repo(root.data_repo_id.as_deref().unwrap_or("primary"), &config)?;
            (
                resolve_source_path_with_root(&root.source, &config, Some(&data_repo.id))?,
                data_repo.id.clone(),
                data_repo.label.clone(),
                Some(data_repo.id),
            )
        };
        let root_target = resolve_path(&root.target, &repo)?;
        match root.mode {
            RootMode::Direct => specs.push(LinkSpec {
                id: root.id.clone(),
                label: root.label.clone(),
                group_id: group_id.clone(),
                group_label: group_label.clone(),
                source: root_source,
                target: root_target,
                kind: LinkKind::Directory,
                source_config: root.source.clone(),
                data_repo_id: spec_data_repo_id.clone(),
                is_free_link: false,
            }),
            RootMode::Children => {
                if !root_source.exists() {
                    specs.push(LinkSpec {
                        id: root.id.clone(),
                        label: format!("{} root", root.label),
                        group_id: group_id.clone(),
                        group_label: group_label.clone(),
                        source: root_source,
                        target: root_target,
                        kind: LinkKind::Directory,
                        source_config: root.source.clone(),
                        data_repo_id: spec_data_repo_id.clone(),
                        is_free_link: false,
                    });
                    continue;
                }

                let ignores: HashSet<String> =
                    root.ignore.iter().map(|item| item.to_lowercase()).collect();
                for entry in fs::read_dir(&root_source)
                    .with_context(|| format!("failed to read {}", root_source.display()))?
                {
                    let entry = entry?;
                    let file_name = entry.file_name();
                    let name = file_name.to_string_lossy().to_string();
                    if ignores.contains(&name.to_lowercase()) {
                        continue;
                    }
                    let source = entry.path();
                    let target = root_target.join(&file_name);
                    specs.push(LinkSpec {
                        id: format!("{}::{}", root.id, name),
                        label: format!("{} / {}", root.label, name),
                        group_id: group_id.clone(),
                        group_label: group_label.clone(),
                        kind: infer_kind_from_path(&source),
                        source,
                        target,
                        source_config: PathBuf::from(&root.source)
                            .join(&file_name)
                            .display()
                            .to_string(),
                        data_repo_id: spec_data_repo_id.clone(),
                        is_free_link: false,
                    });
                }
            }
        }
    }

    for item in config.free_links.iter().filter(|item| item.enabled) {
        let source =
            resolve_source_path_with_root(&item.source, &config, item.data_repo_id.as_deref())?;
        let is_external = PathBuf::from(expand_env_vars(&item.source).replace('/', "\\"))
            .is_absolute()
            && item.data_repo_id.is_none();
        let default_group_id = if is_external {
            "free-links-source-outside-data-repo".to_string()
        } else {
            item.data_repo_id
                .clone()
                .unwrap_or_else(|| "primary".to_string())
        };
        let default_group_label = if is_external {
            "自由链接(源不在 Data Repo)".to_string()
        } else {
            resolve_data_repo(item.data_repo_id.as_deref().unwrap_or("primary"), &config)
                .map(|root| root.label)
                .unwrap_or_else(|_| "Primary Data Repo".to_string())
        };
        specs.push(LinkSpec {
            id: item.id.clone(),
            label: item.label.clone(),
            group_id: item.group_id.clone().unwrap_or(default_group_id),
            group_label: item.group_label.clone().unwrap_or(default_group_label),
            source,
            target: resolve_path(&item.target, &repo)?,
            kind: item.kind,
            source_config: item.source.clone(),
            data_repo_id: item.data_repo_id.clone(),
            is_free_link: true,
        });
    }

    Ok(specs)
}

fn render_mklink_export(
    config: &LinksConfig,
    use_mapping_root_helper: bool,
    helper_script_path: &str,
    target_conflict_strategy: ExportTargetConflictStrategy,
) -> Result<String> {
    let mut out = String::new();
    let created_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let helper_path = if helper_script_path.is_empty() {
        "tools\\mklink-by-Mapping-Root.bat"
    } else {
        helper_script_path
    };

    out.push_str("# mklink export\n\n");
    out.push_str(&format!("Generated at: `{}`\n\n", created_at));
    out.push_str("说明：\n\n");
    out.push_str("- 这份文件用于人工浏览和复制命令，不会自动执行。\n");
    out.push_str("- 以 `:: DISABLED` 开头的命令来自未启用配置，默认不要执行。\n");
    out.push_str("- 执行前请确认目标位置没有需要保留的真实内容。\n\n");
    out.push_str("```bat\n");
    out.push_str("@echo off\n");
    out.push_str("setlocal\n");
    out.push_str(&format!(
        "set \"MKLINK_BACKUP_DIR={}\"\n",
        "mklink-target-backups"
    ));
    out.push_str(":: 当导出策略为 backup 时，可把 MKLINK_BACKUP_DIR 改成目标已有对象的备份目录\n");
    if use_mapping_root_helper {
        out.push_str(&format!("set \"MAPPING_ROOT_TOOL={}\"\n", helper_path));
        out.push_str(":: 可把 MAPPING_ROOT_TOOL 改成 mklink-by-Mapping-Root.bat 的实际位置\n");
    }
    out.push_str("\n");

    let sections =
        build_export_sections(config, use_mapping_root_helper, target_conflict_strategy)?;
    for (index, section) in sections.iter().enumerate() {
        out.push_str(&format_export_section(
            index + 1,
            section,
            target_conflict_strategy,
        ));
    }

    out.push_str("endlocal\n");
    out.push_str("```\n");
    Ok(out)
}

fn build_export_sections(
    config: &LinksConfig,
    use_mapping_root_helper: bool,
    target_conflict_strategy: ExportTargetConflictStrategy,
) -> Result<Vec<ExportSection>> {
    let repo = repo_root();
    let mut sections = Vec::new();
    let mut free_link_lines_by_repo = BTreeMap::<String, Vec<ExportLine>>::new();
    let mut free_lines = Vec::new();

    for item in config.free_links.iter() {
        let source =
            resolve_source_path_with_root(&item.source, config, item.data_repo_id.as_deref())?;
        let target = resolve_path(&item.target, &repo)?;
        let is_external = PathBuf::from(expand_env_vars(&item.source).replace('/', "\\"))
            .is_absolute()
            && item.data_repo_id.is_none();
        let line = ExportLine {
            label: item.label.clone(),
            command: mklink_command(item.kind.into_export_line_kind(&source), &target, &source),
            target: Some(target.display().to_string()),
            meta: ExportCommandMeta {
                enabled: item.enabled,
                source_exists: source.exists(),
            },
        };
        if is_external {
            free_lines.push(line);
        } else {
            let data_repo_id = item
                .data_repo_id
                .clone()
                .unwrap_or_else(|| "primary".to_string());
            free_link_lines_by_repo
                .entry(data_repo_id)
                .or_default()
                .push(line);
        }
    }

    for data_repo in effective_data_repos(config)? {
        let mut mapping_root_lines = Vec::new();
        let roots = config
            .mapping_roots
            .iter()
            .filter(|root| root.data_repo_id.as_deref().unwrap_or("primary") == data_repo.id);

        for root in roots {
            let root_source =
                resolve_source_path_with_root(&root.source, config, Some(&data_repo.id))?;
            let root_target = resolve_path(&root.target, &repo)?;
            let meta = ExportCommandMeta {
                enabled: root.enabled,
                source_exists: root_source.exists(),
            };
            match (use_mapping_root_helper, root.mode) {
                (true, RootMode::Children) => {
                    let helper_mode = match target_conflict_strategy {
                        ExportTargetConflictStrategy::Delete => "AUTO",
                        ExportTargetConflictStrategy::None
                        | ExportTargetConflictStrategy::Backup => "MANUAL",
                    };
                    mapping_root_lines.push(ExportLine {
                        label: root.label.clone(),
                        command: format!(
                            "call \"%MAPPING_ROOT_TOOL%\" {} {} {} {}",
                            quote_bat_path(&root_source),
                            quote_bat_path(&root_target),
                            quote_bat_arg(helper_mode),
                            quote_bat_arg(&root.ignore.join(";"))
                        ),
                        target: None,
                        meta,
                    });
                }
                _ => {
                    mapping_root_lines.extend(export_lines_for_mapping_root(
                        root,
                        &root_source,
                        &root_target,
                        meta,
                    )?);
                }
            }
        }
        let non_mapping_root_lines = free_link_lines_by_repo
            .remove(&data_repo.id)
            .unwrap_or_default();

        sections.push(ExportSection {
            title: format!("Data Repo: {}", data_repo.label),
            notes: vec![
                format!("id: {}", data_repo.id),
                format!("path: {}", data_repo.resolved_path.display()),
            ],
            lines: vec![],
            subsections: vec![
                ExportSubsection {
                    title: "Mapping Root folders".to_string(),
                    notes: vec![
                        "处理 Mapping Root 文件夹：批量规则或由 Mapping Root 展开的链接。"
                            .to_string(),
                    ],
                    lines: mapping_root_lines,
                },
                ExportSubsection {
                    title: "Non-Mapping-Root links".to_string(),
                    notes: vec!["处理非 Mapping Root 文件夹：显式配置的一对一映射。".to_string()],
                    lines: non_mapping_root_lines,
                },
            ],
        });
    }

    let mut standalone_mapping_root_lines = Vec::new();
    for root in config
        .mapping_roots
        .iter()
        .filter(|root| is_virtual_data_repo_id(root.data_repo_id.as_deref().unwrap_or("primary")))
    {
        let root_source = resolve_standalone_mapping_root_source(&root.source, config)?;
        let root_target = resolve_path(&root.target, &repo)?;
        let meta = ExportCommandMeta {
            enabled: root.enabled,
            source_exists: root_source.exists(),
        };
        match (use_mapping_root_helper, root.mode) {
            (true, RootMode::Children) => {
                let helper_mode = match target_conflict_strategy {
                    ExportTargetConflictStrategy::Delete => "AUTO",
                    ExportTargetConflictStrategy::None | ExportTargetConflictStrategy::Backup => {
                        "MANUAL"
                    }
                };
                standalone_mapping_root_lines.push(ExportLine {
                    label: root.label.clone(),
                    command: format!(
                        "call \"%MAPPING_ROOT_TOOL%\" {} {} {} {}",
                        quote_bat_path(&root_source),
                        quote_bat_path(&root_target),
                        quote_bat_arg(helper_mode),
                        quote_bat_arg(&root.ignore.join(";"))
                    ),
                    target: None,
                    meta,
                });
            }
            _ => {
                standalone_mapping_root_lines.extend(export_lines_for_mapping_root(
                    root,
                    &root_source,
                    &root_target,
                    meta,
                )?);
            }
        }
    }

    if !standalone_mapping_root_lines.is_empty() {
        sections.push(ExportSection {
            title: VIRTUAL_INDEPENDENT_MAPPING_ROOTS_LABEL.to_string(),
            notes: vec![
                format!("id: {}", VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID),
                "source path is outside configured Data Repos".to_string(),
            ],
            lines: standalone_mapping_root_lines,
            subsections: vec![],
        });
    }

    for (data_repo_id, lines) in free_link_lines_by_repo {
        sections.push(ExportSection {
            title: format!("Non-Mapping-Root links: {}", data_repo_id),
            notes: vec![
                "These mappings reference a Data Repo id that is not currently enabled or found."
                    .to_string(),
            ],
            lines,
            subsections: vec![],
        });
    }

    sections.push(ExportSection {
        title: "自由链接(源不在 Data Repo)".to_string(),
        notes: vec!["source path is outside configured Data Repos".to_string()],
        lines: free_lines,
        subsections: vec![],
    });

    Ok(sections)
}

fn export_lines_for_mapping_root(
    root: &MappingRootConfig,
    root_source: &Path,
    root_target: &Path,
    meta: ExportCommandMeta,
) -> Result<Vec<ExportLine>> {
    let mut lines = Vec::new();
    match root.mode {
        RootMode::Direct => {
            lines.push(ExportLine {
                label: root.label.clone(),
                command: mklink_command(ExportLineKind::Directory, root_target, root_source),
                target: Some(root_target.display().to_string()),
                meta,
            });
        }
        RootMode::Children => {
            if !root_source.exists() {
                lines.push(ExportLine {
                    label: format!("{} root source missing", root.label),
                    command: format!(
                        ":: SOURCE MISSING: {} -> {}",
                        root_source.display(),
                        root_target.display()
                    ),
                    target: None,
                    meta,
                });
                return Ok(lines);
            }

            let ignores: HashSet<String> =
                root.ignore.iter().map(|item| item.to_lowercase()).collect();
            for entry in fs::read_dir(root_source)
                .with_context(|| format!("failed to read {}", root_source.display()))?
            {
                let entry = entry?;
                let file_name = entry.file_name();
                let name = file_name.to_string_lossy().to_string();
                if ignores.contains(&name.to_lowercase()) {
                    lines.push(ExportLine {
                        label: format!("{} / {}", root.label, name),
                        command: format!(":: IGNORED: {}", name),
                        target: None,
                        meta,
                    });
                    continue;
                }
                let source = entry.path();
                let target = root_target.join(&file_name);
                lines.push(ExportLine {
                    label: format!("{} / {}", root.label, name),
                    command: mklink_command(
                        infer_kind_from_path(&source).into_export_line_kind(&source),
                        &target,
                        &source,
                    ),
                    target: Some(target.display().to_string()),
                    meta,
                });
            }
        }
    }
    Ok(lines)
}

fn format_export_section(
    index: usize,
    section: &ExportSection,
    target_conflict_strategy: ExportTargetConflictStrategy,
) -> String {
    let mut out = String::new();
    out.push_str("::::::::::::::::::::::::::::::::::::\n");
    out.push_str(&format!("::::: {}. {}\n", index, section.title));
    out.push_str("::::::::::::::::::::::::::::::::::::\n");
    for note in &section.notes {
        out.push_str(&format!(":: {}\n", note));
    }
    if section.lines.is_empty() && section.subsections.is_empty() {
        out.push_str(":: no mappings\n\n");
        return out;
    }
    out.push_str(&format_export_lines(
        &section.lines,
        target_conflict_strategy,
    ));
    for (sub_index, subsection) in section.subsections.iter().enumerate() {
        out.push_str(&format!(
            "\n:::: {}.{} {}\n",
            index,
            sub_index + 1,
            subsection.title
        ));
        for note in &subsection.notes {
            out.push_str(&format!(":: {}\n", note));
        }
        if subsection.lines.is_empty() {
            out.push_str(":: no mappings\n");
        } else {
            out.push_str(&format_export_lines(
                &subsection.lines,
                target_conflict_strategy,
            ));
        }
    }
    out.push('\n');
    out
}

fn format_export_lines(
    lines: &[ExportLine],
    target_conflict_strategy: ExportTargetConflictStrategy,
) -> String {
    let mut out = String::new();
    for line in lines {
        out.push_str(&format!(":: {}\n", line.label));
        let mut block = String::new();
        if let Some(target) = &line.target {
            block.push_str(&target_conflict_prelude(target, target_conflict_strategy));
        }
        block.push_str(&line.command);
        let comment_prefix = match (line.meta.enabled, line.meta.source_exists) {
            (false, false) => Some(":: DISABLED SOURCE MISSING "),
            (false, true) => Some(":: DISABLED "),
            (true, false) => Some(":: SOURCE MISSING "),
            (true, true) => None,
        };
        if let Some(prefix) = comment_prefix {
            for command_line in block.lines() {
                out.push_str(prefix);
                out.push_str(command_line);
                out.push('\n');
            }
        } else {
            out.push_str(&block);
            out.push('\n');
        }
    }
    out
}

fn target_conflict_prelude(target: &str, strategy: ExportTargetConflictStrategy) -> String {
    match strategy {
        ExportTargetConflictStrategy::None => String::new(),
        ExportTargetConflictStrategy::Delete => format!(
            "if exist {target} rmdir /s /q {target}\nif exist {target} del /f /q {target}\n",
            target = quote_bat_arg(target)
        ),
        ExportTargetConflictStrategy::Backup => format!(
            "if not exist \"%MKLINK_BACKUP_DIR%\" mkdir \"%MKLINK_BACKUP_DIR%\"\nif exist {target} move /Y {target} \"%MKLINK_BACKUP_DIR%\\%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%_{safe_name}\"\n",
            target = quote_bat_arg(target),
            safe_name = sanitize_file_name(target).replace('%', "_")
        ),
    }
}

trait ExportKindExt {
    fn into_export_line_kind(self, source: &Path) -> ExportLineKind;
}

impl ExportKindExt for LinkKind {
    fn into_export_line_kind(self, source: &Path) -> ExportLineKind {
        match self {
            LinkKind::File => ExportLineKind::File,
            LinkKind::Directory => ExportLineKind::Directory,
            LinkKind::Auto => {
                if source.is_file() {
                    ExportLineKind::File
                } else {
                    ExportLineKind::Directory
                }
            }
        }
    }
}

fn mklink_command(kind: ExportLineKind, target: &Path, source: &Path) -> String {
    match kind {
        ExportLineKind::Directory => {
            format!(
                "mklink /d {} {}",
                quote_bat_path(target),
                quote_bat_path(source)
            )
        }
        ExportLineKind::File => format!(
            "mklink {} {}",
            quote_bat_path(target),
            quote_bat_path(source)
        ),
    }
}

fn quote_bat_path(path: &Path) -> String {
    quote_bat_arg(&path.display().to_string())
}

fn quote_bat_arg(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn load_config() -> Result<LinksConfig> {
    migrate_legacy_config_to_default_profile()?;
    let path = config_path();
    if !path.exists() {
        return Ok(LinksConfig::default());
    }
    let text = fs::read_to_string(&path)
        .with_context(|| format!("failed to read config {}", path.display()))?;
    parse_links_config(&text, &path)
}

fn parse_links_config(text: &str, path: &Path) -> Result<LinksConfig> {
    toml::from_str(text).with_context(|| {
        format!(
            "failed to parse {}. For Windows paths in TOML, use single quotes like path = 'D:\\A\\mklink', escaped backslashes like path = \"D:\\\\A\\\\mklink\", or forward slashes like path = \"D:/A/mklink\"",
            path.display()
        )
    })
}

fn save_config(config: &LinksConfig) -> Result<()> {
    let path = config_path();
    save_config_to_path(config, &path)
}

fn save_config_to_path(config: &LinksConfig, path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = toml::to_string_pretty(config)?;
    fs::write(path, text)?;
    Ok(())
}

fn config_path() -> PathBuf {
    config_dir().join("links.toml")
}

fn config_dir() -> PathBuf {
    config_root_dir().join(active_profile_name())
}

fn config_root_dir() -> PathBuf {
    load_config_location()
        .ok()
        .and_then(|location| location.config_dir)
        .map(|dir| resolve_path(&dir, &repo_root()).unwrap_or_else(|_| default_config_dir()))
        .unwrap_or_else(default_config_dir)
}

fn active_profile_name() -> String {
    load_config_location()
        .ok()
        .map(|location| location.active_profile)
        .filter(|profile| validate_profile_name(profile).is_ok())
        .unwrap_or_else(default_profile_name)
}

fn config_location_path() -> PathBuf {
    default_config_dir().join("config-location.toml")
}

fn load_config_location() -> Result<ConfigLocation> {
    let path = config_location_path();
    if !path.exists() {
        return Ok(ConfigLocation::default());
    }
    let text = fs::read_to_string(&path)
        .with_context(|| format!("failed to read config location {}", path.display()))?;
    toml::from_str(&text).with_context(|| format!("failed to parse {}", path.display()))
}

fn save_config_location(location: &ConfigLocation) -> Result<()> {
    let path = config_location_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = toml::to_string_pretty(location)?;
    fs::write(path, text)?;
    Ok(())
}

fn list_config_profiles_inner(root: &Path, active_profile: &str) -> Result<Vec<ConfigProfile>> {
    fs::create_dir_all(root)?;
    let mut profiles = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if validate_profile_name(&name).is_err() {
            continue;
        }
        if !entry.path().join("links.toml").exists() && name != active_profile && name != "default"
        {
            continue;
        }
        profiles.push(ConfigProfile {
            name: name.clone(),
            path: entry.path().display().to_string(),
            active: name == active_profile,
        });
    }
    if !profiles.iter().any(|profile| profile.name == "default") {
        let path = root.join("default");
        fs::create_dir_all(&path)?;
        profiles.push(ConfigProfile {
            name: "default".to_string(),
            path: path.display().to_string(),
            active: active_profile == "default",
        });
    }
    profiles.sort_by(|a, b| {
        if a.name == "default" && b.name != "default" {
            std::cmp::Ordering::Less
        } else if b.name == "default" && a.name != "default" {
            std::cmp::Ordering::Greater
        } else {
            a.name.cmp(&b.name)
        }
    });
    Ok(profiles)
}

fn migrate_legacy_config_to_default_profile() -> Result<()> {
    let root = config_root_dir();
    let legacy_config = root.join("links.toml");
    let default_dir = root.join("default");
    let default_config = default_dir.join("links.toml");
    if legacy_config.exists() && !default_config.exists() {
        fs::create_dir_all(&default_dir)?;
        fs::rename(&legacy_config, &default_config).or_else(|_| {
            fs::copy(&legacy_config, &default_config)?;
            fs::remove_file(&legacy_config)?;
            Ok::<(), std::io::Error>(())
        })?;
    }
    Ok(())
}

fn validate_profile_name(value: &str) -> Result<()> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(anyhow!(
            "profile name must contain only ASCII letters, numbers, '-' or '_'"
        ));
    }
    Ok(())
}

fn repo_root() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
    }

    #[cfg(not(debug_assertions))]
    {
        std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| PathBuf::from("."))
            })
    }
}

fn default_config_dir() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        return repo_root().join("data");
    }

    #[cfg(not(debug_assertions))]
    {
        repo_root().join("data")
    }
}

fn resolve_path(value: &str, base: &Path) -> Result<PathBuf> {
    let expanded = expand_env_vars(value);
    let normalized = expanded.replace('/', "\\");
    let path = PathBuf::from(normalized);
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(base.join(path))
    }
}

fn resolve_primary_data_repo(config: &LinksConfig) -> Result<PathBuf> {
    resolve_data_repo("primary", config).map(|root| root.resolved_path)
}

fn resolve_source_path(value: &str, config: &LinksConfig) -> Result<PathBuf> {
    resolve_source_path_with_root(value, config, None)
}

fn resolve_source_path_with_root(
    value: &str,
    config: &LinksConfig,
    data_repo_id: Option<&str>,
) -> Result<PathBuf> {
    let expanded = expand_env_vars(value);
    let normalized = expanded.replace('/', "\\");
    let path = PathBuf::from(&normalized);
    if path.is_absolute() {
        return Ok(path);
    }

    let relative = strip_legacy_mklink_prefix(&path);
    let root = resolve_data_repo(data_repo_id.unwrap_or("primary"), config)?;
    Ok(root.resolved_path.join(relative))
}

fn is_virtual_data_repo_id(id: &str) -> bool {
    id == VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID
}

fn resolve_standalone_mapping_root_source(value: &str, _config: &LinksConfig) -> Result<PathBuf> {
    let expanded = expand_env_vars(value);
    let normalized = expanded.replace('/', "\\");
    let path = PathBuf::from(&normalized);
    if !path.is_absolute() {
        return Err(anyhow!(
            "Independent Mapping Root source must be an absolute path or expand to an absolute path"
        ));
    }
    Ok(path)
}

fn validate_standalone_source_outside_data_repos(
    source: &Path,
    config: &LinksConfig,
) -> Result<()> {
    if let Some(repo) = data_repo_containing_path(source, config)? {
        return Err(anyhow!(
            "Independent Mapping Root source must be outside every Data Repo; {} is inside {} ({})",
            source.display(),
            repo.label,
            repo.resolved_path.display()
        ));
    }
    Ok(())
}

fn overlapping_free_links_for_source(
    config: &LinksConfig,
    source_root: &Path,
) -> Result<Vec<OverlappingFreeLink>> {
    let repo = repo_root();
    let mut links = Vec::new();
    for item in &config.free_links {
        let source =
            resolve_source_path_with_root(&item.source, config, item.data_repo_id.as_deref())?;
        if path_is_inside_or_same(&source, source_root) {
            links.push(OverlappingFreeLink {
                id: item.id.clone(),
                label: item.label.clone(),
                source: source.display().to_string(),
                target: resolve_path(&item.target, &repo)
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|_| item.target.clone()),
                enabled: item.enabled,
            });
        }
    }
    links.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(links)
}

fn validate_standalone_cleanup_confirmation(
    config: &LinksConfig,
    source_root: &Path,
    cleanup_free_link_ids: &[String],
) -> Result<()> {
    let mut expected = overlapping_free_links_for_source(config, source_root)?
        .into_iter()
        .map(|link| link.id)
        .collect::<Vec<_>>();
    let mut actual = cleanup_free_link_ids.to_vec();
    expected.sort();
    expected.dedup();
    actual.sort();
    actual.dedup();
    if expected != actual {
        return Err(anyhow!(
            "Overlapping Free Link records changed. Preview the independent Mapping Root cleanup again before saving."
        ));
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct EffectiveDataRepo {
    id: String,
    label: String,
    path: String,
    resolved_path: PathBuf,
    enabled: bool,
}

#[derive(Debug, Clone)]
struct EffectiveBackupRoot {
    id: String,
    label: String,
    path: String,
    resolved_path: PathBuf,
    enabled: bool,
}

fn effective_data_repos(config: &LinksConfig) -> Result<Vec<EffectiveDataRepo>> {
    let mut roots = Vec::new();
    roots.push(EffectiveDataRepo {
        id: "primary".to_string(),
        label: "Primary Data Repo".to_string(),
        path: config.settings.primary_data_repo.clone(),
        resolved_path: resolve_path(&config.settings.primary_data_repo, &repo_root())?,
        enabled: true,
    });

    for root in config.data_repos.iter().filter(|root| root.enabled) {
        if root.id == "primary" {
            roots[0] = EffectiveDataRepo {
                id: root.id.clone(),
                label: root.label.clone(),
                path: root.path.clone(),
                resolved_path: resolve_path(&root.path, &repo_root())?,
                enabled: root.enabled,
            };
        } else {
            roots.push(EffectiveDataRepo {
                id: root.id.clone(),
                label: root.label.clone(),
                path: root.path.clone(),
                resolved_path: resolve_path(&root.path, &repo_root())?,
                enabled: root.enabled,
            });
        }
    }
    Ok(roots)
}

fn effective_backup_roots(config: &LinksConfig) -> Result<Vec<EffectiveBackupRoot>> {
    let mut roots = Vec::new();
    if config.backup_roots.is_empty() {
        roots.push(EffectiveBackupRoot {
            id: "backup-or-settings".to_string(),
            label: "backup-or-settings".to_string(),
            path: "backup-or-settings".to_string(),
            resolved_path: repo_root().join("backup-or-settings"),
            enabled: true,
        });
        return Ok(roots);
    }

    for root in config.backup_roots.iter().filter(|root| root.enabled) {
        roots.push(EffectiveBackupRoot {
            id: root.id.clone(),
            label: root.label.clone(),
            path: root.path.clone(),
            resolved_path: resolve_path(&root.path, &repo_root())?,
            enabled: root.enabled,
        });
    }
    Ok(roots)
}

fn resolve_data_repo(id: &str, config: &LinksConfig) -> Result<EffectiveDataRepo> {
    effective_data_repos(config)?
        .into_iter()
        .find(|root| root.id == id)
        .ok_or_else(|| anyhow!("Data Repo not found: {}", id))
}

fn strip_legacy_mklink_prefix(path: &Path) -> PathBuf {
    let mut components = path.components();
    let Some(first) = components.next() else {
        return PathBuf::new();
    };

    if matches!(first, Component::Normal(name) if name.to_string_lossy().eq_ignore_ascii_case("mklink"))
    {
        components.collect()
    } else {
        path.to_path_buf()
    }
}

fn expand_env_vars(input: &str) -> String {
    let mut output = String::new();
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '%' {
            output.push(ch);
            continue;
        }
        let mut name = String::new();
        while let Some(&next) = chars.peek() {
            chars.next();
            if next == '%' {
                break;
            }
            name.push(next);
        }
        if name.is_empty() {
            output.push('%');
        } else if let Some(value) = env_var_os(&name) {
            output.push_str(&value.to_string_lossy());
        } else {
            output.push('%');
            output.push_str(&name);
            output.push('%');
        }
    }
    output
}

fn env_var_os(name: &str) -> Option<OsString> {
    std::env::var_os(name).or_else(|| {
        let upper = name.to_ascii_uppercase();
        match upper.as_str() {
            "USERPROFILE" => std::env::var_os("USERPROFILE"),
            "APPDATA" => std::env::var_os("APPDATA"),
            "LOCALAPPDATA" => std::env::var_os("LOCALAPPDATA"),
            _ => None,
        }
    })
}

fn infer_kind_from_path(path: &Path) -> LinkKind {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => LinkKind::File,
        Ok(meta) if meta.is_dir() => LinkKind::Directory,
        _ => LinkKind::Auto,
    }
}

fn create_parent_dir(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn create_link(source: &Path, target: &Path, requested_kind: LinkKind) -> Result<()> {
    if target.exists() {
        return Err(anyhow!("target already exists: {}", target.display()));
    }
    let kind = match requested_kind {
        LinkKind::Auto => infer_kind_from_path(source),
        other => other,
    };
    match kind {
        LinkKind::File => create_file_link(source, target),
        LinkKind::Directory | LinkKind::Auto => create_dir_link(source, target),
    }
}

#[cfg(windows)]
fn create_dir_link(source: &Path, target: &Path) -> Result<()> {
    symlink_dir(source, target).map_err(|error| {
        let help = if error.raw_os_error() == Some(1314) {
            "。当前进程没有创建目录软链接权限，请点击界面右上角“管理员重启”，再重试。"
        } else {
            ""
        };
        anyhow!(
            "failed to create directory link {} -> {}{}: {}",
            target.display(),
            source.display(),
            help,
            error
        )
    })
}

#[cfg(windows)]
fn create_file_link(source: &Path, target: &Path) -> Result<()> {
    symlink_file(source, target).map_err(|error| {
        let help = if error.raw_os_error() == Some(1314) {
            "。当前进程没有创建文件软链接权限，请点击界面右上角“管理员重启”，再重试。"
        } else {
            ""
        };
        anyhow!(
            "failed to create file link {} -> {}{}: {}",
            target.display(),
            source.display(),
            help,
            error
        )
    })
}

#[cfg(unix)]
fn create_dir_link(source: &Path, target: &Path) -> Result<()> {
    unix_fs::symlink(source, target)?;
    Ok(())
}

#[cfg(unix)]
fn create_file_link(source: &Path, target: &Path) -> Result<()> {
    unix_fs::symlink(source, target)?;
    Ok(())
}

fn remove_link_path(target: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(target)
        .with_context(|| format!("failed to inspect {}", target.display()))?;
    if !is_link_like(&meta) {
        return Err(anyhow!(
            "refusing to remove real content: {}",
            target.display()
        ));
    }
    fs::remove_dir(target)
        .or_else(|_| fs::remove_file(target))
        .with_context(|| format!("failed to remove link {}", target.display()))
}

#[cfg(windows)]
fn is_link_like(meta: &fs::Metadata) -> bool {
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_type().is_symlink() || (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0
}

#[cfg(unix)]
fn is_link_like(meta: &fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

fn backup_path_for(target: &Path) -> Result<PathBuf> {
    let config = load_config()?;
    let backup_root = resolve_path(&config.settings.backup_dir, &repo_root())?;
    let stem = backup_stem_for_target(target);
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let mut path = backup_root
        .join("target-backups")
        .join(timestamp)
        .join(stem);
    if target.is_dir() {
        path.set_extension("zip");
    }
    Ok(path)
}

fn backup_stem_for_target(target: &Path) -> String {
    sanitize_file_name(&target.display().to_string().replace(':', ""))
}

fn backup_real_target(target: &Path, backup: &Path) -> Result<()> {
    create_parent_dir(backup)?;
    let meta = fs::symlink_metadata(target)?;
    if meta.is_dir() && !is_link_like(&meta) {
        compress_directory(target, backup)?;
        fs::remove_dir_all(target)?;
    } else {
        move_path(target, backup)?;
    }
    Ok(())
}

fn compress_directory(source: &Path, zip_path: &Path) -> Result<()> {
    create_parent_dir(zip_path)?;
    if zip_path.exists() {
        fs::remove_file(zip_path)?;
    }
    let script = format!(
        "$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath {} -DestinationPath {} -Force",
        powershell_single_quoted_path(source),
        powershell_single_quoted_path(zip_path)
    );
    let output = run_powershell(&script).context("failed to run Compress-Archive")?;
    if !output.status.success() {
        return Err(powershell_failure("Compress-Archive", source, &output));
    }
    Ok(())
}

fn restore_backup_to_target(backup: &Path, target: &Path) -> Result<()> {
    if target.exists() {
        return Err(anyhow!("target already exists: {}", target.display()));
    }
    create_parent_dir(target)?;
    if backup
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
    {
        let temp_parent = target
            .parent()
            .ok_or_else(|| anyhow!("target has no parent: {}", target.display()))?;
        let script = format!(
            "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath {} -DestinationPath {} -Force",
            powershell_single_quoted_path(backup),
            powershell_single_quoted_path(temp_parent)
        );
        let output = run_powershell(&script).context("failed to run Expand-Archive")?;
        if !output.status.success() {
            return Err(powershell_failure("Expand-Archive", backup, &output));
        }
    } else {
        copy_path(backup, target)?;
    }
    Ok(())
}

fn run_powershell(script: &str) -> Result<Output> {
    Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .context("failed to start PowerShell")
}

fn powershell_single_quoted_path(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', "''"))
}

fn powershell_failure(operation: &str, path: &Path, output: &Output) -> anyhow::Error {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let mut message = format!(
        "{operation} failed for {} (exit code: {})",
        path.display(),
        output
            .status
            .code()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "terminated".to_string())
    );
    if !stderr.is_empty() {
        message.push_str(&format!("\nstderr: {stderr}"));
    }
    if !stdout.is_empty() {
        message.push_str(&format!("\nstdout: {stdout}"));
    }
    anyhow!(message)
}

fn latest_backup_for_target(target: &Path) -> Option<PathBuf> {
    let config = load_config().ok()?;
    let backup_root = resolve_path(&config.settings.backup_dir, &repo_root()).ok()?;
    let root = backup_root.join("target-backups");
    let stem = backup_stem_for_target(target);
    let mut matches = Vec::new();
    for dir in fs::read_dir(root).ok()?.flatten() {
        let path = dir.path();
        if !path.is_dir() {
            continue;
        }
        for item in fs::read_dir(path).ok()?.flatten() {
            let item_path = item.path();
            let file_stem = item_path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            let file_name = item_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if file_stem == stem || file_name == stem {
                matches.push(item_path);
            }
        }
    }
    matches.sort();
    matches.pop()
}

fn move_path(source: &Path, target: &Path) -> Result<()> {
    create_parent_dir(target)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_path(source, target)?;
            remove_real_path(source)
        }
    }
}

fn ensure_can_receive_data_repo(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }

    let meta = fs::symlink_metadata(path)?;
    if !meta.is_dir() || is_link_like(&meta) {
        return Err(anyhow!(
            "new Primary Data Repo exists but is not an empty real directory: {}",
            path.display()
        ));
    }

    let mut entries = fs::read_dir(path)?;
    if entries.next().is_some() {
        return Err(anyhow!(
            "new Primary Data Repo already exists and is not empty: {}",
            path.display()
        ));
    }

    fs::remove_dir(path)?;
    Ok(())
}

fn update_mapping_source_config(
    config: &mut LinksConfig,
    spec: &LinkSpec,
    new_source: &str,
    new_target: &str,
) -> Result<()> {
    if spec.is_free_link {
        let item = config
            .free_links
            .iter_mut()
            .find(|item| item.id == spec.id)
            .ok_or_else(|| anyhow!("free link not found: {}", spec.id))?;
        item.source = new_source.to_string();
        item.target = new_target.to_string();
        return Ok(());
    }

    if spec.id.contains("::") {
        config.free_links.push(FreeLinkConfig {
            id: format!("moved-{}", sanitize_id(&spec.id.replace("::", "-"))),
            label: spec.label.clone(),
            data_repo_id: spec.data_repo_id.clone(),
            group_id: spec.data_repo_id.clone(),
            group_label: None,
            source: new_source.to_string(),
            target: new_target.to_string(),
            kind: spec.kind,
            enabled: true,
        });
        Ok(())
    } else {
        let root = config
            .mapping_roots
            .iter_mut()
            .find(|root| root.id == spec.id)
            .ok_or_else(|| anyhow!("root mapping not found: {}", spec.id))?;
        root.source = new_source.to_string();
        root.target = new_target.to_string();
        Ok(())
    }
}

fn moved_source_target(
    current_target: &Path,
    new_source: &Path,
    sync_target_name: bool,
) -> Result<PathBuf> {
    if !sync_target_name {
        return Ok(current_target.to_path_buf());
    }

    let name = new_source.file_name().ok_or_else(|| {
        anyhow!(
            "new source has no file or directory name: {}",
            new_source.display()
        )
    })?;
    let parent = current_target.parent().ok_or_else(|| {
        anyhow!(
            "target has no parent directory: {}",
            current_target.display()
        )
    })?;
    Ok(parent.join(name))
}

fn validate_target_for_source_move(current_target: &Path, new_target: &Path) -> Result<()> {
    validate_existing_move_target(current_target, "current target")?;
    if !paths_equivalent(current_target, new_target) {
        validate_existing_move_target(new_target, "new target")?;
    }
    Ok(())
}

fn validate_existing_move_target(target: &Path, label: &str) -> Result<()> {
    if let Ok(meta) = fs::symlink_metadata(target) {
        if !is_link_like(&meta) {
            return Err(anyhow!(
                "{} has real content and will not be replaced: {}",
                label,
                target.display()
            ));
        }
    }
    Ok(())
}

fn sanitize_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn copy_path(source: &Path, target: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(source)?;
    if meta.is_dir() && !is_link_like(&meta) {
        fs::create_dir_all(target)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_path(&entry.path(), &target.join(entry.file_name()))?;
        }
    } else {
        create_parent_dir(target)?;
        fs::copy(source, target)?;
    }
    Ok(())
}

fn remove_real_path(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if is_link_like(&meta) {
        return remove_link_path(path);
    }
    if meta.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn paths_equivalent(a: &Path, b: &Path) -> bool {
    normalize_path_for_compare(a) == normalize_path_for_compare(b)
}

fn data_repo_containing_path(
    path: &Path,
    config: &LinksConfig,
) -> Result<Option<EffectiveDataRepo>> {
    for repo in effective_data_repos(config)? {
        if path_is_inside_or_same(path, &repo.resolved_path) {
            return Ok(Some(repo));
        }
    }
    Ok(None)
}

fn path_is_inside_or_same(path: &Path, root: &Path) -> bool {
    let normalized_path = PathBuf::from(normalize_path_for_prefix(path));
    let normalized_root = PathBuf::from(normalize_path_for_prefix(root));
    normalized_path == normalized_root || normalized_path.starts_with(normalized_root)
}

fn normalize_path_for_prefix(path: &Path) -> String {
    let mut value = path.display().to_string().replace('/', "\\");
    while value.ends_with('\\') {
        value.pop();
    }
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn normalize_path_for_compare(path: &Path) -> String {
    let path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut value = path.display().to_string().replace('/', "\\");
    while value.ends_with('\\') {
        value.pop();
    }
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn collect_entries(
    root: &EffectiveBackupRoot,
    path: &Path,
    entries: &mut Vec<BackupEntry>,
    depth: usize,
) -> Result<()> {
    if entries.len() >= 10_000 || depth > 8 {
        return Ok(());
    }
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(_) => return Ok(()),
    };
    let relative = format_backup_relative_path(&root.resolved_path, path);
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| root.label.clone());
    let kind = if is_link_like(&meta) {
        EntryKind::Link
    } else if meta.is_dir() {
        EntryKind::Directory
    } else if meta.is_file() {
        EntryKind::File
    } else {
        EntryKind::Unknown
    };

    entries.push(BackupEntry {
        id: format!("{}:{}", root.id, relative),
        root_id: root.id.clone(),
        root_label: root.label.clone(),
        root_path: root.resolved_path.display().to_string(),
        category: root.label.clone(),
        name,
        relative_path: relative,
        path: path.display().to_string(),
        kind,
        size: if meta.is_file() {
            Some(meta.len())
        } else {
            None
        },
        modified: modified_secs(&meta),
        previewable: meta.is_file() && is_previewable_path(path),
    });

    if meta.is_dir() && !is_link_like(&meta) {
        let read_dir = match fs::read_dir(path) {
            Ok(read_dir) => read_dir,
            Err(_) => return Ok(()),
        };
        for entry in read_dir.flatten() {
            collect_entries(root, &entry.path(), entries, depth + 1)?;
        }
    }
    Ok(())
}

fn format_backup_relative_path(base: &Path, path: &Path) -> String {
    match path.strip_prefix(base) {
        Ok(relative) if relative.as_os_str().is_empty() => String::new(),
        Ok(relative) => relative.display().to_string(),
        Err(_) => path.display().to_string(),
    }
}

fn modified_secs(meta: &fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
}

fn is_previewable_path(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "txt"
            | "md"
            | "json"
            | "toml"
            | "ps1"
            | "bat"
            | "cmd"
            | "reg"
            | "xml"
            | "ini"
            | "lua"
            | "sh"
            | "rc"
            | "yml"
            | "yaml"
            | "conf"
            | "config"
            | "bak"
    )
}

fn ensure_workspace_path(path: &Path) -> Result<PathBuf> {
    let repo = repo_root();
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        repo.join(path)
    };
    let normalized = normalize_components(&absolute);
    let mut allowed_roots = vec![normalize_components(&repo)];
    if let Ok(config) = load_config() {
        if let Ok(primary_data_repo) = resolve_primary_data_repo(&config) {
            allowed_roots.push(normalize_components(&primary_data_repo));
        }
        if let Ok(backup_roots) = effective_backup_roots(&config) {
            for root in backup_roots {
                allowed_roots.push(normalize_components(&root.resolved_path));
            }
        }
    }
    if !allowed_roots
        .iter()
        .any(|root| normalized.starts_with(root))
    {
        return Err(anyhow!("path is outside the configured app roots"));
    }
    Ok(normalized)
}

fn normalize_components(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn validate_id(value: &str) -> Result<()> {
    if value.is_empty()
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(anyhow!(
            "id must contain only ASCII letters, numbers, '-' or '_'"
        ));
    }
    Ok(())
}

fn sanitize_file_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            other => other,
        })
        .collect()
}

fn write_operation_log(
    operation: &str,
    plan: &ActionPlan,
    applied: &[AppliedAction],
) -> Result<PathBuf> {
    let config = load_config()?;
    let log_dir = resolve_path(&config.settings.log_dir, &repo_root())?;
    fs::create_dir_all(&log_dir)?;
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let path = log_dir.join(format!("{timestamp}_{operation}.json"));
    let payload = serde_json::json!({
        "operation": operation,
        "createdAt": Local::now().to_rfc3339(),
        "plan": plan,
        "applied": applied,
    });
    let mut file = fs::File::create(&path)?;
    file.write_all(serde_json::to_string_pretty(&payload)?.as_bytes())?;
    Ok(path)
}

fn can_create_symlink_quiet() -> bool {
    let root = repo_root().join("data").join("runtime-check");
    let source = root.join("source");
    let link = root.join("link");
    let _ = remove_link_path(&link);
    let _ = fs::remove_dir_all(&source);
    if fs::create_dir_all(&source).is_err() {
        return false;
    }
    let ok = create_dir_link(&source, &link).is_ok();
    let _ = remove_link_path(&link);
    let _ = fs::remove_dir_all(&source);
    ok
}

fn is_admin() -> bool {
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        ])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn error_string(error: anyhow::Error) -> String {
    format!("{error:#}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn expands_known_env_vars() {
        std::env::set_var("THIRDPARTY_CONFIGS_TEST", r"C:\Temp\Test");
        assert_eq!(
            expand_env_vars("%THIRDPARTY_CONFIGS_TEST%/child"),
            r"C:\Temp\Test/child"
        );
    }

    #[test]
    fn debug_default_config_dir_is_app_root_data() {
        #[cfg(debug_assertions)]
        {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let expected = manifest_dir.parent().unwrap().join("data");
            assert_eq!(default_config_dir(), expected);
        }
    }

    #[test]
    fn parses_single_quoted_windows_data_repo_path() {
        let text = r#"
[settings]
primary_data_repo = "mklink"

[[data_repos]]
id = "primary"
label = "Primary Data Repo"
path = 'D:\A\resticprofile\thirdparty_configs\mklink'
enabled = true
"#;
        let config = parse_links_config(text, Path::new("links.toml")).unwrap();
        assert_eq!(
            config.data_repos[0].path,
            r"D:\A\resticprofile\thirdparty_configs\mklink"
        );
    }

    #[test]
    fn export_includes_disabled_mappings_with_comment() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir_all(&source).unwrap();
        let config = LinksConfig {
            settings: AppSettings {
                primary_data_repo: temp.path().join("repo").display().to_string(),
                ..AppSettings::default()
            },
            free_links: vec![FreeLinkConfig {
                id: "disabled-one".to_string(),
                label: "Disabled One".to_string(),
                data_repo_id: None,
                group_id: None,
                group_label: None,
                source: source.display().to_string(),
                target: temp.path().join("target").display().to_string(),
                kind: LinkKind::Directory,
                enabled: false,
            }],
            ..LinksConfig::default()
        };
        let output = render_mklink_export(
            &config,
            true,
            "tools\\mklink-by-Mapping-Root.bat",
            ExportTargetConflictStrategy::Backup,
        )
        .unwrap();
        assert!(
            output.contains(":: DISABLED mklink /d") || output.contains(":: DISABLED if not exist")
        );
        assert!(output.contains("Disabled One"));
        assert!(output.contains("Mapping Root folders"));
        assert!(output.contains("Non-Mapping-Root links"));
        assert!(output.contains("MKLINK_BACKUP_DIR"));
        assert!(output.contains("move /Y"));
    }

    #[test]
    fn profile_list_includes_auto_test_and_excludes_runtime_cache() {
        let temp = tempdir().unwrap();
        fs::create_dir_all(temp.path().join("default")).unwrap();
        fs::write(temp.path().join("default").join("links.toml"), "").unwrap();
        fs::create_dir_all(temp.path().join("auto-test")).unwrap();
        fs::write(temp.path().join("auto-test").join("links.toml"), "").unwrap();
        fs::create_dir_all(temp.path().join("runtime-check")).unwrap();

        let profiles = list_config_profiles_inner(temp.path(), "default").unwrap();
        let names = profiles
            .into_iter()
            .map(|profile| profile.name)
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["default".to_string(), "auto-test".to_string()]);
    }

    #[test]
    fn classifies_missing_and_real_content() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        fs::create_dir_all(&source).unwrap();

        let spec = LinkSpec {
            id: "one".to_string(),
            label: "One".to_string(),
            group_id: "group".to_string(),
            group_label: "Group".to_string(),
            source: source.clone(),
            target: target.clone(),
            kind: LinkKind::Directory,
            source_config: "source".to_string(),
            data_repo_id: None,
            is_free_link: false,
        };

        assert_eq!(classify_link(&spec).status, LinkStatus::Missing);
        fs::create_dir_all(&target).unwrap();
        assert_eq!(classify_link(&spec).status, LinkStatus::RealContent);
    }

    #[test]
    fn classifies_source_missing() {
        let temp = tempdir().unwrap();
        let spec = LinkSpec {
            id: "missing".to_string(),
            label: "Missing".to_string(),
            group_id: "group".to_string(),
            group_label: "Group".to_string(),
            source: temp.path().join("nope"),
            target: temp.path().join("target"),
            kind: LinkKind::Directory,
            source_config: "nope".to_string(),
            data_repo_id: None,
            is_free_link: false,
        };
        assert_eq!(classify_link(&spec).status, LinkStatus::SourceMissing);
    }

    #[test]
    fn classifies_enabled_link_when_supported() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        fs::create_dir_all(&source).unwrap();
        if create_dir_link(&source, &target).is_err() {
            return;
        }

        let spec = LinkSpec {
            id: "enabled".to_string(),
            label: "Enabled".to_string(),
            group_id: "group".to_string(),
            group_label: "Group".to_string(),
            source,
            target,
            kind: LinkKind::Directory,
            source_config: "source".to_string(),
            data_repo_id: None,
            is_free_link: false,
        };
        assert_eq!(classify_link(&spec).status, LinkStatus::Enabled);
    }

    #[cfg(windows)]
    #[test]
    fn compresses_and_restores_hidden_style_directory_names() {
        let temp = tempdir().unwrap();
        let source = temp.path().join(".espanso");
        let nested = source.join("config");
        let backup = temp.path().join("backup.zip");
        let target = temp.path().join("restored").join(".espanso");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("default.yml"), "matches: []").unwrap();

        compress_directory(&source, &backup).unwrap();
        assert!(backup.exists());
        assert!(backup.metadata().unwrap().len() > 0);

        restore_backup_to_target(&backup, &target).unwrap();
        assert_eq!(
            fs::read_to_string(target.join("config").join("default.yml")).unwrap(),
            "matches: []"
        );
    }

    #[test]
    fn updates_free_link_id_and_label_without_allowing_duplicates() {
        let temp = tempdir().unwrap();
        let mut config = LinksConfig {
            free_links: vec![
                FreeLinkConfig {
                    id: "old-id".to_string(),
                    label: "Old Label".to_string(),
                    data_repo_id: None,
                    group_id: None,
                    group_label: None,
                    source: "D:/source".to_string(),
                    target: "D:/target".to_string(),
                    kind: LinkKind::Directory,
                    enabled: true,
                },
                FreeLinkConfig {
                    id: "existing-id".to_string(),
                    label: "Existing".to_string(),
                    data_repo_id: None,
                    group_id: None,
                    group_label: None,
                    source: "D:/other-source".to_string(),
                    target: "D:/other-target".to_string(),
                    kind: LinkKind::Directory,
                    enabled: true,
                },
            ],
            ..LinksConfig::default()
        };
        let spec = LinkSpec {
            id: "old-id".to_string(),
            label: "Old Label".to_string(),
            group_id: "free-links-source-outside-data-repo".to_string(),
            group_label: "自由链接(源不在 Data Repo)".to_string(),
            source: temp.path().join("source"),
            target: temp.path().join("target"),
            kind: LinkKind::Directory,
            source_config: "D:/source".to_string(),
            data_repo_id: None,
            is_free_link: true,
        };

        assert!(
            update_link_metadata_config(&mut config, &spec, "existing-id", "New Label").is_err()
        );
        update_link_metadata_config(&mut config, &spec, "new-id", "New Label").unwrap();

        assert_eq!(config.free_links[0].id, "new-id");
        assert_eq!(config.free_links[0].label, "New Label");
        assert_eq!(config.free_links[1].id, "existing-id");
    }

    #[test]
    fn detects_paths_inside_data_repos_for_free_link_guard() {
        let temp = tempdir().unwrap();
        let repo_path = temp.path().join("repo");
        let outside_path = temp.path().join("outside").join("tool");
        let config = LinksConfig {
            settings: AppSettings {
                primary_data_repo: repo_path.display().to_string(),
                ..AppSettings::default()
            },
            data_repos: vec![],
            backup_roots: vec![],
            mapping_roots: vec![],
            free_links: vec![],
        };

        fs::create_dir_all(&repo_path).unwrap();

        assert_eq!(
            data_repo_containing_path(&repo_path.join("AppData").join("Tool"), &config)
                .unwrap()
                .map(|repo| repo.id),
            Some("primary".to_string())
        );
        assert!(data_repo_containing_path(&outside_path, &config)
            .unwrap()
            .is_none());
    }

    #[test]
    fn standalone_mapping_root_source_must_be_outside_data_repos() {
        let temp = tempdir().unwrap();
        let repo_path = temp.path().join("repo");
        let config = LinksConfig {
            settings: AppSettings {
                primary_data_repo: repo_path.display().to_string(),
                ..AppSettings::default()
            },
            ..LinksConfig::default()
        };

        assert!(
            validate_standalone_source_outside_data_repos(&repo_path.join("nested"), &config)
                .is_err()
        );
        assert!(validate_standalone_source_outside_data_repos(
            &temp.path().join("outside"),
            &config
        )
        .is_ok());
    }

    #[test]
    fn standalone_cleanup_finds_enabled_and_disabled_free_links_under_source() {
        let temp = tempdir().unwrap();
        let standalone = temp.path().join("standalone");
        let outside = temp.path().join("outside");
        let config = LinksConfig {
            settings: AppSettings {
                primary_data_repo: temp.path().join("repo").display().to_string(),
                ..AppSettings::default()
            },
            free_links: vec![
                FreeLinkConfig {
                    id: "enabled-inside".to_string(),
                    label: "Enabled Inside".to_string(),
                    data_repo_id: None,
                    group_id: None,
                    group_label: None,
                    source: standalone.join("tool").display().to_string(),
                    target: temp.path().join("target-a").display().to_string(),
                    kind: LinkKind::Directory,
                    enabled: true,
                },
                FreeLinkConfig {
                    id: "disabled-inside".to_string(),
                    label: "Disabled Inside".to_string(),
                    data_repo_id: None,
                    group_id: None,
                    group_label: None,
                    source: standalone.join("other").display().to_string(),
                    target: temp.path().join("target-b").display().to_string(),
                    kind: LinkKind::Directory,
                    enabled: false,
                },
                FreeLinkConfig {
                    id: "outside".to_string(),
                    label: "Outside".to_string(),
                    data_repo_id: None,
                    group_id: None,
                    group_label: None,
                    source: outside.display().to_string(),
                    target: temp.path().join("target-c").display().to_string(),
                    kind: LinkKind::Directory,
                    enabled: true,
                },
            ],
            ..LinksConfig::default()
        };

        let ids = overlapping_free_links_for_source(&config, &standalone)
            .unwrap()
            .into_iter()
            .map(|link| link.id)
            .collect::<Vec<_>>();

        assert_eq!(
            ids,
            vec!["disabled-inside".to_string(), "enabled-inside".to_string()]
        );
    }

    #[test]
    fn export_includes_independent_mapping_root_section() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("standalone-source");
        fs::create_dir_all(&source).unwrap();
        let config = LinksConfig {
            settings: AppSettings {
                primary_data_repo: temp.path().join("repo").display().to_string(),
                ..AppSettings::default()
            },
            mapping_roots: vec![MappingRootConfig {
                id: "external-root".to_string(),
                label: "External Root".to_string(),
                data_repo_id: Some(VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID.to_string()),
                source: source.display().to_string(),
                target: temp.path().join("target").display().to_string(),
                mode: RootMode::Direct,
                enabled: true,
                ignore: vec![],
            }],
            ..LinksConfig::default()
        };

        let output = render_mklink_export(
            &config,
            false,
            "tools\\mklink-by-Mapping-Root.bat",
            ExportTargetConflictStrategy::None,
        )
        .unwrap();

        assert!(output.contains(VIRTUAL_INDEPENDENT_MAPPING_ROOTS_LABEL));
        assert!(output.contains("External Root"));
    }

    #[test]
    fn moved_source_target_can_sync_target_name() {
        let current_target = PathBuf::from(r"C:\Users\i\AppData\Roaming\old-name");
        let new_source = PathBuf::from(r"D:\Data\new-name");

        assert_eq!(
            moved_source_target(&current_target, &new_source, true).unwrap(),
            PathBuf::from(r"C:\Users\i\AppData\Roaming\new-name")
        );
        assert_eq!(
            moved_source_target(&current_target, &new_source, false).unwrap(),
            current_target
        );
    }

    #[test]
    fn moving_free_link_source_can_update_target_name_in_config() {
        let temp = tempdir().unwrap();
        let target = temp.path().join("target").join("old-name");
        let new_target = temp.path().join("target").join("new-name");
        let mut config = LinksConfig {
            free_links: vec![FreeLinkConfig {
                id: "free-one".to_string(),
                label: "Free One".to_string(),
                data_repo_id: None,
                group_id: None,
                group_label: None,
                source: "D:/source/old-name".to_string(),
                target: target.display().to_string(),
                kind: LinkKind::Directory,
                enabled: true,
            }],
            ..LinksConfig::default()
        };
        let spec = LinkSpec {
            id: "free-one".to_string(),
            label: "Free One".to_string(),
            group_id: "free-links-source-outside-data-repo".to_string(),
            group_label: "自由链接(源不在 Data Repo)".to_string(),
            source: temp.path().join("source").join("old-name"),
            target,
            kind: LinkKind::Directory,
            source_config: "D:/source/old-name".to_string(),
            data_repo_id: None,
            is_free_link: true,
        };

        update_mapping_source_config(
            &mut config,
            &spec,
            "D:/source/new-name",
            &new_target.display().to_string(),
        )
        .unwrap();

        assert_eq!(config.free_links[0].source, "D:/source/new-name");
        assert_eq!(
            config.free_links[0].target,
            new_target.display().to_string()
        );
    }

    #[test]
    fn resolves_sources_under_absolute_primary_data_repo() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("external-root");
        let config = LinksConfig {
            settings: AppSettings {
                primary_data_repo: root.display().to_string(),
                ..AppSettings::default()
            },
            data_repos: vec![],
            backup_roots: vec![],
            mapping_roots: vec![],
            free_links: vec![],
        };

        assert_eq!(
            resolve_source_path("Roaming/Cursor", &config).unwrap(),
            root.join("Roaming").join("Cursor")
        );
        assert_eq!(
            resolve_source_path("mklink/Roaming/Cursor", &config).unwrap(),
            root.join("Roaming").join("Cursor")
        );
    }

    #[test]
    fn formats_external_mklink_entries_relative_to_primary_data_repo() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("external-root");
        let child = root.join("Roaming").join("Cursor");
        assert_eq!(
            format_backup_relative_path(&root, &child),
            PathBuf::from("Roaming")
                .join("Cursor")
                .display()
                .to_string()
        );
    }
}
