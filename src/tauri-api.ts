import { invoke } from "@tauri-apps/api/core";
import type {
  ActionPlan,
  ActionRequest,
  ActionResult,
  BackupEntry,
  CreateConfigProfileInput,
  EnvironmentSummary,
  ExportMklinkScriptInput,
  LinkSettings,
  LinkRecord,
  MoveLinkSourceInput,
  NewLinkInput,
  OperationLog,
  PreviewStandaloneMappingRootCleanupInput,
  ScanChangesResult,
  StandaloneMappingRootCleanupPreview,
  TextPreview,
  SwitchConfigProfileInput,
  UpdateConfigDirInput,
  UpdateLinkMetadataInput,
  UpdatePrimaryDataRepoInput,
  UpsertBackupRootInput,
  UpsertDataRepoInput,
  UpsertMappingRootInput,
} from "./types";

export const api = {
  scanLinks: () => invoke<LinkRecord[]>("scan_links"),
  previewLinkActions: (request: ActionRequest) =>
    invoke<ActionPlan>("preview_link_actions", { request }),
  applyLinkActions: (request: ActionRequest) =>
    invoke<ActionResult>("apply_link_actions", { request }),
  createLinkMapping: (input: NewLinkInput) =>
    invoke<ActionResult>("create_link_mapping", { input }),
  removeLink: (linkId: string) => invoke<ActionResult>("remove_link", { linkId }),
  listBackupEntries: () => invoke<BackupEntry[]>("list_backup_entries"),
  readTextPreview: (path: string) => invoke<TextPreview>("read_text_preview", { path }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  listOperationLogs: () => invoke<OperationLog[]>("list_operation_logs"),
  readOperationLog: (path: string) => invoke<TextPreview>("read_operation_log", { path }),
  getEnvironmentSummary: () =>
    invoke<EnvironmentSummary>("get_environment_summary"),
  getLinkSettings: () => invoke<LinkSettings>("get_link_settings"),
  updateConfigDir: (input: UpdateConfigDirInput) =>
    invoke<ActionResult>("update_config_dir", { input }),
  switchConfigProfile: (input: SwitchConfigProfileInput) =>
    invoke<ActionResult>("switch_config_profile", { input }),
  createConfigProfile: (input: CreateConfigProfileInput) =>
    invoke<ActionResult>("create_config_profile", { input }),
  updatePrimaryDataRepo: (input: UpdatePrimaryDataRepoInput) =>
    invoke<ActionResult>("update_primary_data_repo", { input }),
  upsertDataRepo: (input: UpsertDataRepoInput) =>
    invoke<ActionResult>("upsert_data_repo", { input }),
  upsertBackupRoot: (input: UpsertBackupRootInput) =>
    invoke<ActionResult>("upsert_backup_root", { input }),
  upsertMappingRoot: (input: UpsertMappingRootInput) =>
    invoke<ActionResult>("upsert_mapping_root", { input }),
  previewStandaloneMappingRootCleanup: (input: PreviewStandaloneMappingRootCleanupInput) =>
    invoke<StandaloneMappingRootCleanupPreview>("preview_standalone_mapping_root_cleanup", { input }),
  exportMklinkScript: (input: ExportMklinkScriptInput) =>
    invoke<ActionResult>("export_mklink_script", { input }),
  moveLinkSource: (input: MoveLinkSourceInput) =>
    invoke<ActionResult>("move_link_source", { input }),
  updateLinkMetadata: (input: UpdateLinkMetadataInput) =>
    invoke<ActionResult>("update_link_metadata", { input }),
  relaunchAsAdmin: () => invoke<void>("relaunch_as_admin"),
  scanDataRepoChanges: (dataRepoId: string) =>
    invoke<ScanChangesResult>("scan_data_repo_changes", { dataRepoId }),
  scanMappingRootChanges: (mappingRootId: string) =>
    invoke<ScanChangesResult>("scan_mapping_root_changes", { mappingRootId }),
};
