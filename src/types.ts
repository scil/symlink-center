export type LinkKind = "auto" | "file" | "directory";
export type LinkStatus =
  | "enabled"
  | "missing"
  | "real-content"
  | "wrong-target"
  | "broken"
  | "source-missing";

export type EntryKind = "file" | "directory" | "link" | "unknown";
export type ActionKind =
  | "create-link"
  | "remove-link"
  | "backup-target"
  | "delete-target"
  | "restore-backup"
  | "copy-source-to-target"
  | "skip"
  | "error";
export type ActionSeverity = "info" | "warning" | "danger";

export interface LinkRecord {
  id: string;
  label: string;
  groupId: string;
  groupLabel: string;
  source: string;
  target: string;
  kind: LinkKind;
  sourceConfig: string;
  dataRepoId?: string | null;
  status: LinkStatus;
  sourceExists: boolean;
  targetExists: boolean;
  currentTarget?: string | null;
  isFreeLink: boolean;
  notes: string[];
}

export interface ActionRequest {
  linkIds: string[];
  operation: "enable" | "remove";
  targetConflictStrategy?: "backup" | "delete";
  removeLinkStrategy?: "only-link" | "restore-backup" | "copy-source";
}

export interface LinkAction {
  id: string;
  linkId: string;
  kind: ActionKind;
  severity: ActionSeverity;
  description: string;
  source?: string | null;
  target?: string | null;
  backupPath?: string | null;
}

export interface ActionPlan {
  operation: string;
  actions: LinkAction[];
  summary: Record<string, number>;
  warnings: string[];
  requiresAdmin: boolean;
}

export interface AppliedAction {
  actionId: string;
  kind: ActionKind;
  ok: boolean;
  message: string;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  logPath?: string | null;
  actions: AppliedAction[];
}

export interface BackupEntry {
  id: string;
  rootId: string;
  rootLabel: string;
  rootPath: string;
  category: string;
  name: string;
  relativePath: string;
  path: string;
  kind: EntryKind;
  size?: number | null;
  modified?: number | null;
  previewable: boolean;
}

export interface TextPreview {
  path: string;
  content: string;
  truncated: boolean;
}

export interface OperationLog {
  name: string;
  path: string;
  modified?: number | null;
  size?: number | null;
}

export interface EnvironmentSummary {
  repoRoot: string;
  configRoot: string;
  activeProfile: string;
  profiles: ConfigProfile[];
  configPath: string;
  primaryDataRepo: string;
  isAdmin: boolean;
  canCreateSymlink: boolean;
}

export interface ConfigProfile {
  name: string;
  path: string;
  active: boolean;
}

export interface LinkSettings {
  primaryDataRepo: string;
  resolvedPrimaryDataRepo: string;
  dataRepos: DataRepo[];
  mappingRoots: MappingRootSetting[];
  backupRoots: BackupRoot[];
  backupDir: string;
  logDir: string;
}

export interface DataRepo {
  id: string;
  label: string;
  path: string;
  resolvedPath: string;
  enabled: boolean;
}

export interface MappingRootSetting {
  id: string;
  label: string;
  dataRepoId?: string | null;
  source: string;
  resolvedSource: string;
  target: string;
  resolvedTarget: string;
  mode: "children" | "direct";
  enabled: boolean;
  ignore: string[];
}

export interface ScanChangesResult {
  title: string;
  summary: string[];
  details: string[];
}

export interface BackupRoot {
  id: string;
  label: string;
  path: string;
  resolvedPath: string;
  enabled: boolean;
}

export interface NewLinkInput {
  id: string;
  label: string;
  source: string;
  target: string;
  kind: LinkKind;
  targetConflictStrategy: "backup" | "delete";
}

export interface UpdatePrimaryDataRepoInput {
  newRoot: string;
  moveData: boolean;
  rebuildLinks: boolean;
}

export interface UpdateConfigDirInput {
  newDir: string;
  copyCurrentConfig: boolean;
  activeProfile?: string | null;
}

export interface SwitchConfigProfileInput {
  profile: string;
}

export interface CreateConfigProfileInput {
  profile: string;
  copyCurrentConfig: boolean;
}

export interface UpsertDataRepoInput {
  id: string;
  label: string;
  path: string;
  moveDataFromRepoId?: string | null;
  rebuildLinks: boolean;
}

export interface UpsertBackupRootInput {
  id: string;
  label: string;
  path: string;
}

export interface UpsertMappingRootInput {
  id: string;
  label: string;
  dataRepoId?: string | null;
  source: string;
  target: string;
  mode: "children" | "direct";
  enabled: boolean;
  ignore: string[];
  cleanupFreeLinkIds?: string[];
}

export interface PreviewStandaloneMappingRootCleanupInput {
  source: string;
}

export interface OverlappingFreeLink {
  id: string;
  label: string;
  source: string;
  target: string;
  enabled: boolean;
}

export interface StandaloneMappingRootCleanupPreview {
  resolvedSource: string;
  overlappingFreeLinks: OverlappingFreeLink[];
}

export interface ExportMklinkScriptInput {
  outputPath: string;
  useMappingRootHelper: boolean;
  helperScriptPath: string;
  targetConflictStrategy: "none" | "delete" | "backup";
}

export interface MoveLinkSourceInput {
  linkId: string;
  newSource: string;
  syncTargetName: boolean;
}

export interface UpdateLinkMetadataInput {
  linkId: string;
  newId: string;
  label: string;
}
