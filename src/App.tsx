import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  FolderSearch,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./tauri-api";
import {
  VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID,
  VIRTUAL_INDEPENDENT_MAPPING_ROOTS_LABEL,
} from "./constants";
import {
  buildLinkTree,
  collectExpandableNodeIds,
  comparePathsByHierarchy,
  isFreeLinkGroup,
  type LinkTreeGroup,
  type LinkTreeMode,
  type LinkTreeNode,
} from "./link-tree";
import type {
  ActionPlan,
  ActionRequest,
  ActionResult,
  BackupEntry,
  BackupRoot,
  CreateConfigProfileInput,
  EnvironmentSummary,
  ExportMklinkScriptInput,
  LinkRecord,
  LinkSettings,
  LinkStatus,
  DataRepo,
  MoveLinkSourceInput,
  NewLinkInput,
  OperationLog,
  ScanChangesResult,
  StandaloneMappingRootCleanupPreview,
  TextPreview,
  SwitchConfigProfileInput,
  UpdateConfigDirInput,
  UpdateLinkMetadataInput,
  UpsertBackupRootInput,
  UpsertDataRepoInput,
  UpsertMappingRootInput,
} from "./types";
import { Badge, Button, Panel, Select, TextInput, cx } from "./components/ui";

type TabKey = "links" | "backups" | "logs";
type CreateTabKey = "free-link" | "standalone-mapping-root" | "data-repo";

type PendingDataRepoUpdate = {
  root: DataRepo;
};

type PendingScanResult = {
  result: ScanChangesResult;
};

type PendingMappingRootUpdate = {
  root?: LinkSettings["mappingRoots"][number];
  dataRepoId?: string;
};

type PendingStandaloneMappingRootCleanup = {
  input: UpsertMappingRootInput;
  preview: StandaloneMappingRootCleanupPreview;
};

type PendingLinkMetadataUpdate = {
  link: LinkRecord;
};

type PendingExportScript = {
  outputPath: string;
  useMappingRootHelper: boolean;
  helperScriptPath: string;
  targetConflictStrategy: "none" | "delete" | "backup";
};

type TargetConflictStrategy = NonNullable<ActionRequest["targetConflictStrategy"]>;
type RemoveLinkStrategy = NonNullable<ActionRequest["removeLinkStrategy"]>;

type BackupTreeRoot = {
  id: string;
  label: string;
  path: string;
  entries: BackupEntry[];
  children: BackupTreeNode[];
};

type BackupTreeNode = {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  depth: number;
  entries: BackupEntry[];
  children: BackupTreeNode[];
  entry?: BackupEntry;
};

type ActivityStatus = "running" | "success" | "error" | "info";

type ActivityEntry = {
  id: string;
  time: string;
  status: ActivityStatus;
  message: string;
  detail?: string;
  details?: string[];
};

type ActivityGroup = {
  id: string;
  title: string;
  startedAt: string;
  status: ActivityStatus;
  entries: ActivityEntry[];
};

type ExpandedActivity = {
  groups: Set<string>;
  entries: Set<string>;
};

const statusLabel: Record<LinkStatus, string> = {
  enabled: "已启用",
  missing: "未创建",
  "real-content": "真实内容",
  "wrong-target": "目标错误",
  broken: "断链",
  "source-missing": "源缺失",
};

const statusTone: Record<LinkStatus, "green" | "yellow" | "red" | "blue" | "gray"> = {
  enabled: "green",
  missing: "gray",
  "real-content": "yellow",
  "wrong-target": "red",
  broken: "red",
  "source-missing": "red",
};

const actionLabel: Record<string, string> = {
  "create-link": "创建链接",
  "remove-link": "删除链接",
  "backup-target": "备份目标",
  "delete-target": "删除目标",
  "restore-backup": "恢复备份",
  "copy-source-to-target": "复制源到目标",
  skip: "跳过",
  error: "错误",
};

const targetConflictOptions: Array<{ value: TargetConflictStrategy; label: string }> = [
  { value: "backup", label: "备份后替换" },
  { value: "delete", label: "直接删除后替换" },
];

const removeLinkOptions: Array<{ value: RemoveLinkStrategy; label: string }> = [
  { value: "only-link", label: "仅删除软链接" },
  { value: "restore-backup", label: "恢复最近备份" },
  { value: "copy-source", label: "复制源内容到目标" },
];

const targetConflictHint = "备份会写入 data/link-backups；目录会压缩为 zip。";
const removeLinkHint = "恢复备份会查找该目标最近一次备份；复制源会保留源目录不变。";

const initialNewLink: NewLinkInput = {
  id: "exampleapp-config",
  label: "ExampleApp config",
  source: "%APPDATA%/ExampleApp/config",
  target: "%USERPROFILE%/ExampleApp/config",
  kind: "auto",
  targetConflictStrategy: "backup",
};

const initialStandaloneMappingRoot: UpsertMappingRootInput = {
  id: "",
  label: "",
  dataRepoId: VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID,
  source: "",
  target: "",
  mode: "children",
  enabled: true,
  ignore: [],
};

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_FALLBACK_MAX_WIDTH = 640;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("links");
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [env, setEnv] = useState<EnvironmentSummary | null>(null);
  const [linkSettings, setLinkSettings] = useState<LinkSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [pendingRequest, setPendingRequest] = useState<ActionRequest | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [pendingScanResult, setPendingScanResult] = useState<PendingScanResult | null>(null);
  const didInitialRefreshRef = useRef(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const [activityGroups, setActivityGroups] = useState<ActivityGroup[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_MIN_WIDTH);

  function nowText() {
    return new Date().toLocaleTimeString();
  }

  function startActivity(title: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setActivityGroups((prev) => [
      {
        id,
        title,
        startedAt: nowText(),
        status: "running",
        entries: [
          {
            id: `${id}-start`,
            time: nowText(),
            status: "running",
            message: "开始",
          },
        ],
      },
      ...prev.slice(0, 39),
    ]);
    return id;
  }

  function addActivity(
    groupId: string,
    status: ActivityStatus,
    message: string,
    detail?: string,
    details?: string[],
  ) {
    setActivityGroups((prev) =>
      prev.map((group) =>
        group.id === groupId
          ? {
              ...group,
              entries: [
                ...group.entries,
                {
                  id: `${groupId}-${group.entries.length}-${Date.now()}`,
                  time: nowText(),
                  status,
                  message,
                  detail,
                  details,
                },
              ],
            }
          : group,
      ),
    );
  }

  function finishActivity(groupId: string, status: ActivityStatus, message: string) {
    addActivity(groupId, status, message);
    setActivityGroups((prev) =>
      prev.map((group) => (group.id === groupId ? { ...group, status } : group)),
    );
  }

  function describeTaskValue(value: unknown) {
    if (isActionPlan(value)) {
      return `生成 ${value.actions.length} 个计划动作；需要管理员：${value.requiresAdmin ? "是" : "否"}`;
    }
    if (isActionResult(value)) {
      return `${value.message}；动作 ${value.actions.length} 个`;
    }
    if (Array.isArray(value)) {
      return `返回 ${value.length} 条记录`;
    }
    return undefined;
  }

  function logResultDetails(groupId: string, value: unknown) {
    if (isActionPlan(value)) {
      value.warnings.forEach((warning) => addActivity(groupId, "info", "计划警告", warning));
      value.actions.slice(0, 20).forEach((action) =>
        addActivity(
          groupId,
          action.severity === "danger" ? "error" : "info",
          action.description,
          `${actionLabel[action.kind] ?? action.kind}: ${action.target ?? ""}`,
          [
            `动作类型：${actionLabel[action.kind] ?? action.kind}`,
            `映射 ID：${action.linkId}`,
            `源：${action.source ?? "无"}`,
            `目标：${action.target ?? "无"}`,
            `备份：${action.backupPath ?? "无"}`,
          ],
        ),
      );
      if (value.actions.length > 20) {
        addActivity(groupId, "info", "计划动作已截断显示", `还有 ${value.actions.length - 20} 个动作未在实时日志中展开`);
      }
    } else if (isActionResult(value)) {
      value.actions.slice(0, 20).forEach((action) =>
        addActivity(
          groupId,
          action.ok ? "success" : "error",
          action.message,
          actionLabel[action.kind] ?? action.kind,
          [`动作类型：${actionLabel[action.kind] ?? action.kind}`, `结果：${action.ok ? "成功" : "失败"}`],
        ),
      );
      if (value.actions.length > 20) {
        addActivity(groupId, "info", "执行结果已截断显示", `还有 ${value.actions.length - 20} 个动作未在实时日志中展开`);
      }
    }
  }

  async function runTask<T>(
    label: string,
    task: () => Promise<T>,
    success?: string,
    commandName?: string,
  ) {
    const groupId = startActivity(label);
    setLoading(true);
    setError(null);
    const backendCommand = commandName ?? label;
    try {
      addActivity(groupId, "running", `调用后端接口：${backendCommand}`);
      const value = await task();
      const detail = describeTaskValue(value);
      addActivity(groupId, "success", `后端接口返回成功：${backendCommand}`, detail);
      logResultDetails(groupId, value);
      if (success) setNotice(success);
      finishActivity(groupId, "success", success ?? "完成");
      return value;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      finishActivity(groupId, "error", message);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  function refreshAll() {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const groupId = startActivity("刷新界面数据");
    setLoading(true);
    setError(null);
    const task = (async () => {
      addActivity(groupId, "running", "读取环境信息", "管理员权限、软链接权限、仓库路径");
      addActivity(groupId, "running", "扫描软链接映射状态", "读取配置并检查源/目标文件系统状态");
      addActivity(groupId, "running", "扫描备份根目录", "读取已配置备份根并生成树形条目");
      addActivity(groupId, "running", "读取持久操作日志列表", "读取 data/logs");
      addActivity(groupId, "running", "读取应用配置", "Data Repo、备份根、日志目录");

      const [envInfo, linkRows, backupRows, logRows, settings] = await Promise.all([
        api.getEnvironmentSummary(),
        api.scanLinks(),
        api.listBackupEntries(),
        api.listOperationLogs(),
        api.getLinkSettings(),
      ]);

      addActivity(
        groupId,
        "success",
        "环境信息已读取",
        `管理员：${envInfo.isAdmin ? "是" : "否"}；可创建软链：${envInfo.canCreateSymlink ? "是" : "否"}`,
        [
          `仓库路径：${envInfo.repoRoot}`,
          `配置根目录：${envInfo.configRoot}`,
          `当前 Profile：${envInfo.activeProfile}`,
          `配置文件：${envInfo.configPath}`,
          `当前 Primary Data Repo：${envInfo.primaryDataRepo}`,
          `管理员权限：${envInfo.isAdmin ? "是" : "否"}`,
          `可创建软链接：${envInfo.canCreateSymlink ? "是" : "否"}`,
        ],
      );

      addActivity(
        groupId,
        "success",
        "软链接状态扫描完成",
        `${linkRows.length} 条映射`,
        summarizeLinksByStatus(linkRows),
      );

      addActivity(
        groupId,
        "success",
        "备份条目扫描完成",
        `${backupRows.length} 个条目`,
        summarizeBackupsByRoot(backupRows),
      );

      addActivity(
        groupId,
        "success",
        "持久操作日志已读取",
        `${logRows.length} 个日志文件`,
        logRows.slice(0, 10).map((log) => `${log.name} · ${formatBytes(log.size)}`),
      );

      addActivity(
        groupId,
        "success",
        "应用配置已读取",
        `${settings.dataRepos.length} 个 Data Repo；${settings.backupRoots.length} 个备份根`,
        [
          `Data Repo：${settings.dataRepos.map((root) => `${root.label}=${root.resolvedPath}`).join("；") || "无"}`,
          `备份根：${settings.backupRoots.map((root) => `${root.label}=${root.resolvedPath}`).join("；") || "无"}`,
          `软链接备份目录：${settings.backupDir}`,
          `日志目录：${settings.logDir}`,
        ],
      );

      setEnv(envInfo);
      setLinkSettings(settings);
      setLinks(linkRows);
      setBackups(backupRows);
      setLogs(logRows);
      finishActivity(groupId, "success", "刷新完成");
    })()
      .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      finishActivity(groupId, "error", message);
      throw err;
      })
      .finally(() => {
        setLoading(false);
        refreshInFlightRef.current = null;
      });
    refreshInFlightRef.current = task;
    return task;
  }

  useEffect(() => {
    if (didInitialRefreshRef.current) return;
    didInitialRefreshRef.current = true;
    refreshAll().catch(() => undefined);
  }, []);

  async function scanAllDataRepos() {
    const repos = linkSettings?.dataRepos ?? [];
    if (repos.length === 0) {
      setPendingScanResult({
        result: {
          title: "扫描所有 Data Repo",
          summary: ["没有已配置的 Data Repo。"],
          details: [],
        },
      });
      return;
    }

    const results = await runTask(
      "扫描所有 Data Repo 改动",
      () => Promise.all(repos.map((repo) => api.scanDataRepoChanges(repo.id))),
      undefined,
      "scan_data_repo_changes",
    );
    setPendingScanResult({
      result: {
        title: "扫描所有 Data Repo",
        summary: results.flatMap((result) =>
          result.summary.length ? result.summary.map((item) => `${result.title}：${item}`) : [`${result.title}：无变化`],
        ),
        details: results.flatMap((result) => [
          result.title,
          ...result.details.map((item) => `  ${item}`),
        ]),
      },
    });
  }

  async function applyPlan() {
    if (!pendingRequest) return;
    const result = await runTask(
      "执行软链接操作计划",
      () => api.applyLinkActions(pendingRequest),
      "操作完成",
      "apply_link_actions",
    );
    setLastResult(result);
    setPlan(null);
    setPendingRequest(null);
    await refreshAll();
  }

  async function previewPlan(request: ActionRequest, label = "预览软链接操作计划") {
    const nextPlan = await runTask(label, () => api.previewLinkActions(request), undefined, "preview_link_actions");
    setPendingRequest(request);
    setPlan(nextPlan);
  }

  return (
    <div className="min-h-screen bg-[#eef2f7] text-ink">
      <header className="flex h-16 items-center justify-between border-b border-line bg-white px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-700 text-white">
            <Link2 size={19} />
          </div>
          <div>
            <h1 className="text-base font-semibold">系统盘瘦身与配置中心</h1>
            <div className="text-xs text-slate-500">
              软链接管理、配置独立化 · {env?.repoRoot ?? "加载中"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold">Profile</span>
            <Select
              className="h-9 min-w-36 bg-white py-1 text-xs"
              value={env?.activeProfile ?? "default"}
              disabled={loading}
              onChange={async (event) => {
                const profile = event.target.value;
                const result = await runTask(
                  "切换配置 Profile",
                  () => api.switchConfigProfile({ profile }),
                  `已切换到 ${profile}`,
                  "switch_config_profile",
                );
                setLastResult(result);
                await refreshAll();
              }}
            >
              {(env?.profiles?.length ? env.profiles : [{ name: "default", path: "", active: true }]).map((profile) => (
                <option key={profile.name} value={profile.name}>
                  {profile.name}
                </option>
              ))}
            </Select>
          </label>
          <Badge tone={env?.isAdmin ? "green" : "yellow"}>
            {env?.isAdmin ? "管理员" : "普通权限"}
          </Badge>
          <Badge tone={env?.canCreateSymlink ? "green" : "red"}>
            {env?.canCreateSymlink ? "可创建软链" : "软链受限"}
          </Badge>
          {env && !env.isAdmin && (
            <Button
              onClick={() => runTask("以管理员权限重启", () => api.relaunchAsAdmin(), undefined, "relaunch_as_admin")}
              disabled={loading}
              title="请求 Windows UAC，以管理员权限重启本程序"
            >
              <ShieldAlert size={16} />
              管理员重启
            </Button>
          )}
          <Button
            onClick={() => refreshAll()}
            disabled={loading}
            title="根据 TOML 配置刷新界面状态"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
            刷新
          </Button>
          <Button
            onClick={scanAllDataRepos}
            disabled={loading || !(linkSettings?.dataRepos?.length)}
            title="扫描所有 Data Repo 下的目录和文件变化"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <FolderSearch size={16} />}
            扫描
          </Button>
        </div>
      </header>

      <div
        className="grid min-h-[calc(100vh-64px)]"
        style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
      >
        <aside className="relative flex min-h-0 flex-col border-r border-line bg-slate-950 p-3 text-slate-200">
          <div className="shrink-0">
            <NavButton active={activeTab === "links"} onClick={() => setActiveTab("links")}>
              <Link2 size={17} />
              软链接
            </NavButton>
            <NavButton active={activeTab === "backups"} onClick={() => setActiveTab("backups")}>
              <FolderOpen size={17} />
              备份浏览
            </NavButton>
            <NavButton active={activeTab === "logs"} onClick={() => setActiveTab("logs")}>
              <FileText size={17} />
              操作日志
            </NavButton>
          </div>
          <SidebarActivityLog groups={activityGroups} onClear={() => setActivityGroups([])} />
          {activeTab === "links" && <SidebarLinkConcepts />}
          <SidebarResizeHandle width={sidebarWidth} onChange={setSidebarWidth} />
        </aside>

        <main className="min-w-0 p-5">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
          {notice && (
            <div className="mb-4 flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <span className="flex items-center gap-2">
                <CheckCircle2 size={16} />
                {notice}
              </span>
              <button onClick={() => setNotice(null)}>
                <X size={15} />
              </button>
            </div>
          )}

          {activeTab === "links" && (
            <LinksView
              links={links}
              settings={linkSettings}
              env={env}
              loading={loading}
              onPreview={(request) => previewPlan(request)}
              onCreate={async (input) => {
                const result = await runTask(
                  "新建软链接映射",
                  () => api.createLinkMapping(input),
                  "映射已创建",
                  "create_link_mapping",
                );
                setLastResult(result);
                await refreshAll();
              }}
              onUpsertDataRepo={async (input) => {
                const result = await runTask(
                  "保存 Data Repo",
                  () => api.upsertDataRepo(input),
                  "Data Repo 已保存",
                  "upsert_data_repo",
                );
                setLastResult(result);
                await refreshAll();
              }}
              onUpsertMappingRoot={async (input) => {
                const result = await runTask(
                  "保存 Mapping Root",
                  () => api.upsertMappingRoot(input),
                  "Mapping Root 已保存",
                  "upsert_mapping_root",
                );
                setLastResult(result);
                await refreshAll();
              }}
              onPreviewStandaloneMappingRootCleanup={(input) =>
                runTask("预览独立 Mapping Root 清理", () =>
                  api.previewStandaloneMappingRootCleanup(input),
                  undefined,
                  "preview_standalone_mapping_root_cleanup",
                )
              }
              onExportMklinkScript={async (input) => {
                const result = await runTask(
                  "导出 mklink 脚本",
                  () => api.exportMklinkScript(input),
                  "mklink 脚本已导出",
                  "export_mklink_script",
                );
                setLastResult(result);
                await refreshAll();
              }}
              onUpdateConfigDir={async (input) => {
                const result = await runTask(
                  "保存配置文件目录",
                  () => api.updateConfigDir(input),
                  "配置文件目录已保存",
                  "update_config_dir",
                );
                setLastResult(result);
                await refreshAll();
              }}
              onSwitchConfigProfile={async (input) => {
                const result = await runTask(
                  "切换配置 Profile",
                  () => api.switchConfigProfile(input),
                  "配置 Profile 已切换",
                  "switch_config_profile",
                );
                setLastResult(result);
                await refreshAll();
              }}
              onCreateConfigProfile={async (input) => {
                const result = await runTask(
                  "新建配置 Profile",
                  () => api.createConfigProfile(input),
                  "配置 Profile 已创建",
                  "create_config_profile",
                );
                setLastResult(result);
                await refreshAll();
              }}
              onMoveSource={async (input) => {
                const result = await runTask(
                  "迁移映射源并重建链接",
                  () => api.moveLinkSource(input),
                  "映射源已迁移并重建链接",
                  "move_link_source",
                );
                setLastResult(result);
                await refreshAll();
              }}
              onUpdateLinkMetadata={async (input) => {
                const result = await runTask(
                  "更新映射 ID 和显示名称",
                  () => api.updateLinkMetadata(input),
                  "映射信息已更新",
                  "update_link_metadata",
                );
                setLastResult(result);
                await refreshAll();
              }}
              onOpen={(path) => runTask("打开路径", () => api.openPath(path), undefined, "open_path")}
              onReveal={(path) => runTask("定位路径", () => api.revealPath(path), undefined, "reveal_path")}
              onScanDataRepo={async (id) => {
                const result = await runTask("扫描 Data Repo 改动", () => api.scanDataRepoChanges(id), undefined, "scan_data_repo_changes");
                setPendingScanResult({ result });
              }}
              onScanMappingRoot={async (id) => {
                const result = await runTask("扫描 Mapping Root 改动", () => api.scanMappingRootChanges(id), undefined, "scan_mapping_root_changes");
                setPendingScanResult({ result });
              }}
            />
          )}

          {activeTab === "backups" && (
            <BackupsView
              entries={backups}
              backupRoots={linkSettings?.backupRoots ?? []}
              loading={loading}
              onUpsertBackupRoot={async (input) => {
                const result = await runTask(
                  "保存备份根目录",
                  () => api.upsertBackupRoot(input),
                  "备份根目录已保存",
                  "upsert_backup_root",
                );
                setLastResult(result);
                await refreshAll();
              }}
              onOpen={(path) => runTask("打开备份路径", () => api.openPath(path), undefined, "open_path")}
              onReveal={(path) => runTask("定位备份路径", () => api.revealPath(path), undefined, "reveal_path")}
              onPreview={(path) => runTask("预览备份文本", () => api.readTextPreview(path), undefined, "read_text_preview")}
            />
          )}

          {activeTab === "logs" && (
            <LogsView
              logs={logs}
              lastResult={lastResult}
              onPreview={(path) => runTask("读取持久操作日志", () => api.readOperationLog(path), undefined, "read_operation_log")}
            />
          )}
        </main>
      </div>

      {plan && pendingRequest && (
        <PlanDialog
          plan={plan}
          request={pendingRequest}
          onClose={() => {
            setPlan(null);
            setPendingRequest(null);
          }}
          onRequestChange={(request) => previewPlan(request, "更新软链接操作预览")}
          onApply={applyPlan}
          loading={loading}
        />
      )}
      {pendingScanResult && (
        <ScanChangesDialog
          result={pendingScanResult.result}
          onClose={() => setPendingScanResult(null)}
          onRefresh={async () => {
            setPendingScanResult(null);
            await refreshAll();
          }}
        />
      )}
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cx(
        "mb-1 flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition",
        active ? "bg-white text-slate-950" : "text-slate-300 hover:bg-slate-800",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SidebarResizeHandle({
  width,
  onChange,
}: {
  width: number;
  onChange: (width: number) => void;
}) {
  function clampWidth(value: number) {
    const maxWidth =
      typeof window === "undefined"
        ? SIDEBAR_FALLBACK_MAX_WIDTH
        : Math.max(SIDEBAR_MIN_WIDTH, Math.floor(window.innerWidth / 2));
    return Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, value));
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    function onMove(moveEvent: PointerEvent) {
      const next = clampWidth(startWidth + moveEvent.clientX - startX);
      onChange(next);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none"
      onPointerDown={onPointerDown}
      title="拖拽调整侧边栏宽度（最大为窗口宽度的一半）"
    >
      <div className="ml-auto h-full w-px bg-slate-800 transition-colors hover:bg-blue-400" />
    </div>
  );
}

function SidebarLinkConcepts() {
  return (
    <div className="mt-3 shrink-0 rounded-md border border-slate-800 bg-slate-900/70 p-3 text-xs leading-5 text-slate-300">
      <div className="mb-2 font-semibold text-slate-100">软链接核心概念</div>
      <div className="space-y-2">
        <ConceptLine
          term="Data Repo"
          description="真实数据所在的根目录。可以有多个，用来集中保存原本散落在系统目录里的配置文件或文件夹。"
        />
        <ConceptLine
          term="Mapping Root"
          description="其下的条目会在目标目录中建立同名软链接；内容有变化时，可点击“扫描”。"
        />
      </div>
    </div>
  );
}

function ConceptLine({ term, description }: { term: string; description: string }) {
  return (
    <div>
      <span className="font-semibold text-blue-200">{term}</span>
      <span className="text-slate-500">： </span>
      <span className="text-slate-400">{description}</span>
    </div>
  );
}

function LinksView({
  links,
  settings,
  env,
  loading,
  onPreview,
  onCreate,
  onUpdateConfigDir,
  onSwitchConfigProfile,
  onCreateConfigProfile,
  onUpsertDataRepo,
  onUpsertMappingRoot,
  onPreviewStandaloneMappingRootCleanup,
  onExportMklinkScript,
  onMoveSource,
  onUpdateLinkMetadata,
  onOpen,
  onReveal,
  onScanDataRepo,
  onScanMappingRoot,
}: {
  links: LinkRecord[];
  settings: LinkSettings | null;
  env: EnvironmentSummary | null;
  loading: boolean;
  onPreview: (request: ActionRequest) => Promise<void>;
  onCreate: (input: NewLinkInput) => Promise<void>;
  onUpdateConfigDir: (input: UpdateConfigDirInput) => Promise<void>;
  onSwitchConfigProfile: (input: SwitchConfigProfileInput) => Promise<void>;
  onCreateConfigProfile: (input: CreateConfigProfileInput) => Promise<void>;
  onUpsertDataRepo: (input: UpsertDataRepoInput) => Promise<void>;
  onUpsertMappingRoot: (input: UpsertMappingRootInput) => Promise<void>;
  onPreviewStandaloneMappingRootCleanup: (input: { source: string }) => Promise<StandaloneMappingRootCleanupPreview>;
  onExportMklinkScript: (input: ExportMklinkScriptInput) => Promise<void>;
  onMoveSource: (input: MoveLinkSourceInput) => Promise<void>;
  onUpdateLinkMetadata: (input: UpdateLinkMetadataInput) => Promise<void>;
  onOpen: (path: string) => Promise<unknown>;
  onReveal: (path: string) => Promise<unknown>;
  onScanDataRepo: (id: string) => Promise<void>;
  onScanMappingRoot: (id: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LinkStatus | "all">("all");
  const [treeMode, setTreeMode] = useState<LinkTreeMode>("source");
  const [targetConflictStrategy, setTargetConflictStrategy] = useState<"backup" | "delete">("backup");
  const [removeLinkStrategy, setRemoveLinkStrategy] = useState<"only-link" | "restore-backup" | "copy-source">("only-link");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());
  const [newLink, setNewLink] = useState<NewLinkInput>(initialNewLink);
  const [newLinkAutoFields, setNewLinkAutoFields] = useState({ id: true, label: true });
  const [pendingRepoUpdate, setPendingRepoUpdate] = useState<PendingDataRepoUpdate | null>(null);
  const [pendingMappingRootUpdate, setPendingMappingRootUpdate] = useState<PendingMappingRootUpdate | null>(null);
  const [pendingStandaloneCleanup, setPendingStandaloneCleanup] =
    useState<PendingStandaloneMappingRootCleanup | null>(null);
  const [pendingExportScript, setPendingExportScript] = useState<PendingExportScript | null>(null);
  const [newRoot, setNewRoot] = useState<UpsertDataRepoInput>({
    id: "",
    label: "",
    path: "",
    moveDataFromRepoId: null,
    rebuildLinks: false,
  });
  const [configOpen, setConfigOpen] = useState(false);
  const [configDir, setConfigDir] = useState("");
  const [newProfile, setNewProfile] = useState("");
  const [copyCurrentProfileConfig, setCopyCurrentProfileConfig] = useState(true);
  const [copyCurrentConfig, setCopyCurrentConfig] = useState(true);
  const [sourceDialogLink, setSourceDialogLink] = useState<LinkRecord | null>(null);
  const [metadataDialogLink, setMetadataDialogLink] = useState<LinkRecord | null>(null);
  const [createTab, setCreateTab] = useState<CreateTabKey>("free-link");
  const [standaloneRoot, setStandaloneRoot] =
    useState<UpsertMappingRootInput>(initialStandaloneMappingRoot);
  const [standaloneIgnoreText, setStandaloneIgnoreText] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return links.filter((link) => {
      const matchesStatus = status === "all" || link.status === status;
      const matchesSearch =
        !query ||
        [link.label, link.groupLabel, link.source, link.target, link.currentTarget ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [links, search, status]);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((link) => selected.has(link.id));
  const treeGroups = useMemo(
    () => buildLinkTree(filtered, treeMode, settings?.mappingRoots ?? []),
    [filtered, settings?.mappingRoots, treeMode],
  );

  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      for (const group of treeGroups) {
        if (search.trim() || (!prev.size && !isFreeLinkGroup(group.id))) next.add(group.id);
      }
      return next;
    });
  }, [search, treeGroups]);

  useEffect(() => {
    setExpandedNodes((prev) => {
      const nodeIds = collectExpandableNodeIds(treeGroups);
      const next = new Set(prev);
      if (search.trim()) {
        nodeIds.forEach((id) => next.add(id));
      } else {
        for (const id of Array.from(next)) {
          if (!nodeIds.has(id)) next.delete(id);
        }
      }
      return next;
    });
  }, [search, treeGroups]);

  useEffect(() => {
    if (env?.configRoot) setConfigDir(env.configRoot);
  }, [env?.configRoot]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(group: LinkTreeGroup) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group.id)) next.delete(group.id);
      else next.add(group.id);
      return next;
    });
  }

  function toggleNode(node: LinkTreeNode) {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }

  function toggleGroupSelection(group: LinkTreeGroup) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = group.links.every((link) => next.has(link.id));
      for (const link of group.links) {
        if (allSelected) next.delete(link.id);
        else next.add(link.id);
      }
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((link) => next.delete(link.id));
      } else {
        filtered.forEach((link) => next.add(link.id));
      }
      return next;
    });
  }

  function linkActionRequest(linkIds: string[], operation: "enable" | "remove"): ActionRequest {
    return {
      linkIds,
      operation,
      targetConflictStrategy,
      removeLinkStrategy,
    };
  }

  async function submitNewLink(event: React.FormEvent) {
    event.preventDefault();
    await onCreate({ ...newLink, kind: "auto" });
    setNewLink(initialNewLink);
    setNewLinkAutoFields({ id: true, label: true });
  }

  function resetStandaloneMappingRoot() {
    setStandaloneRoot(initialStandaloneMappingRoot);
    setStandaloneIgnoreText("");
  }

  function standaloneMappingRootInput(): UpsertMappingRootInput {
    return {
      ...standaloneRoot,
      id: standaloneRoot.id.trim(),
      label: standaloneRoot.label.trim(),
      dataRepoId: VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID,
      source: standaloneRoot.source.trim(),
      target: standaloneRoot.target.trim(),
      ignore: splitIgnoreText(standaloneIgnoreText),
    };
  }

  async function submitStandaloneMappingRoot(event: React.FormEvent) {
    event.preventDefault();
    const input = standaloneMappingRootInput();
    const preview = await onPreviewStandaloneMappingRootCleanup({ source: input.source });
    if (preview.overlappingFreeLinks.length > 0) {
      setPendingStandaloneCleanup({ input, preview });
      return;
    }
    await onUpsertMappingRoot({ ...input, cleanupFreeLinkIds: [] });
    resetStandaloneMappingRoot();
  }

  async function submitNewDataRepo(event: React.FormEvent) {
    event.preventDefault();
    await onUpsertDataRepo(newRoot);
    setNewRoot({
      id: "",
      label: "",
      path: "",
      moveDataFromRepoId: null,
      rebuildLinks: false,
    });
  }

  function updateNewLinkPaths(patch: Partial<Pick<NewLinkInput, "source" | "target">>) {
    setNewLink((prev) => {
      const next = { ...prev, ...patch, kind: "auto" as const };
      const generated = generateNewLinkMetadata(next.source, next.target);
      return {
        ...next,
        id: newLinkAutoFields.id ? generated.id : next.id,
        label: newLinkAutoFields.label ? generated.label : next.label,
      };
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">软链接映射</h2>
          <div className="text-sm text-slate-500">{filtered.length} / {links.length}</div>
        </div>
      </div>

      <Panel className="overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          onClick={() => setConfigOpen((value) => !value)}
        >
          <div>
            <div className="text-sm font-semibold text-slate-800">配置</div>
            <div className="text-xs text-slate-500">配置根目录、Profile、启用策略、删除策略</div>
          </div>
          {configOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {configOpen && (
          <div className="space-y-4 border-t border-line p-4">
            <form
              className="grid gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                await onUpdateConfigDir({
                  newDir: configDir,
                  copyCurrentConfig,
                  activeProfile: env?.activeProfile ?? "default",
                });
              }}
            >
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-slate-600">配置根目录</span>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <TextInput
                    value={configDir}
                    onChange={(event) => setConfigDir(event.target.value)}
                    placeholder="D:/Config/symlink-profiles"
                  />
                  <Button disabled={loading || !configDir.trim()}>
                    <FolderOpen size={16} />
                    保存
                  </Button>
                </div>
                <span className="text-xs text-slate-500">
                  当前配置文件：{env?.configPath ?? "加载中"}；Profile 会作为根目录下的子目录保存。
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={copyCurrentConfig}
                  onChange={(event) => setCopyCurrentConfig(event.target.checked)}
                />
                <span>保存到新根目录时，若当前 Profile 还没有 links.toml，则复制当前配置文件过去。</span>
              </label>
            </form>

            <div className="grid gap-3 rounded-md border border-line bg-slate-50 p-3">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">当前 Profile</span>
                  <Select
                    value={env?.activeProfile ?? "default"}
                    onChange={(event) => onSwitchConfigProfile({ profile: event.target.value })}
                    disabled={loading}
                  >
                    {(env?.profiles?.length ? env.profiles : [{ name: "default", path: "", active: true }]).map((profile) => (
                      <option key={profile.name} value={profile.name}>
                        {profile.name}{profile.active ? "（当前）" : ""}
                      </option>
                    ))}
                  </Select>
                  <span className="text-xs text-slate-500">
                    默认 Profile 名为 default；当前根目录：{env?.configRoot ?? "加载中"}。
                  </span>
                </label>
                <form
                  className="grid min-w-80 gap-1"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    await onCreateConfigProfile({
                      profile: newProfile,
                      copyCurrentConfig: copyCurrentProfileConfig,
                    });
                    setNewProfile("");
                  }}
                >
                  <span className="text-xs font-semibold text-slate-600">新建 Profile</span>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <TextInput
                      value={newProfile}
                      onChange={(event) => setNewProfile(event.target.value)}
                      placeholder="work"
                    />
                    <Button disabled={loading || !newProfile.trim()}>
                      <Plus size={16} />
                      新建
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={copyCurrentProfileConfig}
                      onChange={(event) => setCopyCurrentProfileConfig(event.target.checked)}
                    />
                    <span>复制当前 Profile 的 links.toml</span>
                  </label>
                </form>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-slate-600">启用时如果目标已有真实内容</span>
                <Select
                  value={targetConflictStrategy}
                  onChange={(event) => setTargetConflictStrategy(event.target.value as "backup" | "delete")}
                >
                  {targetConflictOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-slate-500">{targetConflictHint}</span>
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-slate-600">删除软链接后</span>
                <Select
                  value={removeLinkStrategy}
                  onChange={(event) =>
                    setRemoveLinkStrategy(event.target.value as "only-link" | "restore-backup" | "copy-source")
                  }
                >
                  {removeLinkOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-slate-500">{removeLinkHint}</span>
              </label>
            </div>
          </div>
        )}
      </Panel>

      <Panel className="p-4">
        <div className="grid grid-cols-[1fr_180px_auto] gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 text-slate-400" size={16} />
            <TextInput
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索名称、源、目标"
            />
          </div>
          <Select value={status} onChange={(event) => setStatus(event.target.value as LinkStatus | "all")}>
            <option value="all">全部状态</option>
            {Object.entries(statusLabel).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="primary"
              disabled={selectedIds.length === 0 || loading}
              onClick={() => onPreview(linkActionRequest(selectedIds, "enable"))}
            >
              <Play size={16} />
              启用选中
            </Button>
            <Button
              variant="danger"
              disabled={selectedIds.length === 0 || loading}
              onClick={() => onPreview(linkActionRequest(selectedIds, "remove"))}
            >
              <Trash2 size={16} />
              删除选中
            </Button>
            <Button
              disabled={loading}
              onClick={() =>
                setPendingExportScript({
                  outputPath: defaultExportPath(env?.configPath),
                  useMappingRootHelper: true,
                  helperScriptPath: "tools\\mklink-by-Mapping-Root.bat",
                  targetConflictStrategy: "backup",
                })
              }
            >
              <FileText size={16} />
              导出脚本
            </Button>
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="link-tree-grid border-b border-line bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
          <div>
            <input
              type="checkbox"
              aria-label="Select all filtered links"
              checked={allFilteredSelected}
              onChange={toggleAllFiltered}
            />
          </div>
          <div className="flex items-center gap-2">
            <span>分组/目录</span>
            <Select
              className="h-8 w-28 bg-white py-1 text-xs font-medium"
              value={treeMode}
              onChange={(event) => setTreeMode(event.target.value as LinkTreeMode)}
            >
              <option value="target">按目标</option>
              <option value="source">按源</option>
            </Select>
          </div>
          <div>状态</div>
          <div>源</div>
          <div>目标</div>
          <div>操作</div>
        </div>
        <div className="max-h-[52vh] overflow-auto">
          {treeGroups.map((group) => {
            const expanded = expandedGroups.has(group.id);
            const groupSelected = group.links.every((link) => selected.has(link.id));
            const someGroupSelected = group.links.some((link) => selected.has(link.id));
            const groupLinkIds = group.links.map((link) => link.id);
            const dataRepo = settings?.dataRepos.find((root) => root.id === group.id);
            const isVirtualDataRepo = group.id === VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID;
            const isFreeLinkGroupRow = isFreeLinkGroup(group.id);
            const groupKindLabel = dataRepo
              ? "Data Repo"
              : isVirtualDataRepo
                ? "Virtual Data Repo"
                : isFreeLinkGroupRow
                  ? "自由链接"
                  : "分组";
            return (
              <div key={group.id} className="border-b border-slate-100 last:border-b-0">
                <div className="link-tree-grid items-start bg-slate-50 px-3 py-2 text-sm hover:bg-slate-100">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${group.label}`}
                      checked={groupSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = someGroupSelected && !groupSelected;
                      }}
                      onChange={() => toggleGroupSelection(group)}
                    />
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-white"
                      onClick={() => toggleGroup(group)}
                      title={expanded ? "折叠分组" : "展开分组"}
                    >
                      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left"
                    onClick={() => toggleGroup(group)}
                  >
                    <Folder className="shrink-0 text-blue-700" size={17} />
                    <span className="truncate font-semibold">{group.label}</span>
                    <span className="text-xs text-slate-500">{group.links.length}</span>
                  </button>
                  <StatusSummary counts={group.statusCounts} />
                  {dataRepo ? (
                    <PathCell value={dataRepo.resolvedPath} compact>
                      <InlineIconButton
                        title="更改 Data Repo 位置"
                        onClick={() => setPendingRepoUpdate({ root: dataRepo })}
                      >
                        <Pencil size={15} />
                      </InlineIconButton>
                    </PathCell>
                  ) : isVirtualDataRepo ? (
                    <div className="text-xs text-slate-500">独立源目录</div>
                  ) : (
                    <div className="text-xs text-slate-500">{group.id}</div>
                  )}
                  <div className="text-xs text-slate-500">
                    {groupKindLabel}
                  </div>
                  <div className="flex items-center gap-1">
                    {dataRepo && (
                      <>
                        <IconButton title="打开 Data Repo" onClick={() => onOpen(dataRepo.resolvedPath)}>
                          <ExternalLink size={15} />
                        </IconButton>
                        <IconButton
                          title="扫描此 Data Repo 下的目录和文件变化"
                          onClick={() => onScanDataRepo(dataRepo.id)}
                        >
                          <FolderSearch size={15} />
                        </IconButton>
                        <IconButton
                          title="新增 Mapping Root"
                          onClick={() => setPendingMappingRootUpdate({ dataRepoId: dataRepo.id })}
                        >
                          <Plus size={15} />
                        </IconButton>
                      </>
                    )}
                    <IconButton title="预览启用整组" onClick={() => onPreview(linkActionRequest(groupLinkIds, "enable"))}>
                      <Play size={15} />
                    </IconButton>
                    <IconButton title="预览删除整组" onClick={() => onPreview(linkActionRequest(groupLinkIds, "remove"))}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </div>
                {expanded && (
                  <LinkTreeNodes
                    nodes={group.nodes}
                    mode={treeMode}
                    selected={selected}
                    expandedNodes={expandedNodes}
                    onToggleLink={toggle}
                    onToggleNode={(node) =>
                      setSelected((prev) => toggleMany(prev, node.links.map((link) => link.id)))
                    }
                    onToggleExpanded={toggleNode}
                    makeActionRequest={linkActionRequest}
                    onPreview={onPreview}
                    onOpen={onOpen}
                    onReveal={onReveal}
                    onMoveSource={setSourceDialogLink}
                    onEditMetadata={setMetadataDialogLink}
                    onEditMappingRoot={(root) => setPendingMappingRootUpdate({ root, dataRepoId: root.dataRepoId ?? "primary" })}
                    onScanMappingRoot={onScanMappingRoot}
                  />
                )}
              </div>
            );
          })}
          {treeGroups.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-slate-500">
              没有匹配的软链接映射
            </div>
          )}
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="mb-4 flex border-b border-line">
          <CreateTabButton active={createTab === "free-link"} onClick={() => setCreateTab("free-link")}>
            新建自由链接
          </CreateTabButton>
          <CreateTabButton
            active={createTab === "standalone-mapping-root"}
            onClick={() => setCreateTab("standalone-mapping-root")}
          >
            新建独立 Mapping Root
          </CreateTabButton>
          <CreateTabButton active={createTab === "data-repo"} onClick={() => setCreateTab("data-repo")}>
            新增 Data Repo
          </CreateTabButton>
        </div>

        {createTab === "free-link" ? (
          <form className="grid gap-3" onSubmit={submitNewLink}>
            <div>
              <h3 className="text-base font-semibold text-slate-800">新建自由链接</h3>
              <div className="text-sm text-slate-500">
                用于源不在 Data Repo 的一对一映射；如果源已在 Data Repo，请扫描对应 Data Repo 或 Mapping Root 后刷新列表。
              </div>
            </div>
            <div className="grid grid-cols-[minmax(240px,1fr)_minmax(240px,1fr)_190px_auto] gap-3">
              <Field label="源" hint="真实数据位置，例如 %APPDATA%/ExampleApp/config 或 D:/Data/ExampleApp/config">
                <TextInput
                  value={newLink.source}
                  onChange={(event) => updateNewLinkPaths({ source: event.target.value })}
                  placeholder="%APPDATA%/ExampleApp/config"
                  required
                />
              </Field>
              <Field
                label="目标"
                hint="将出现在系统中的软链接路径，例如 %APPDATA%/Cursor/User 或 C:/Users/i/.config/tool"
              >
                <TextInput
                  value={newLink.target}
                  onChange={(event) => updateNewLinkPaths({ target: event.target.value })}
                  placeholder="%APPDATA%/Cursor/User"
                  required
                />
              </Field>
              <Field label="如果目标已有真实内容" hint="目录备份会压缩为 zip">
                <Select
                  value={newLink.targetConflictStrategy}
                  onChange={(event) =>
                    setNewLink({ ...newLink, targetConflictStrategy: event.target.value as "backup" | "delete" })
                  }
                >
                  {targetConflictOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-start pt-6">
                <Button type="submit" variant="primary">
                  <Plus size={16} />
                  新建自由链接
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-[minmax(180px,0.7fr)_minmax(240px,1fr)] gap-3">
              <Field label="映射 ID" hint="根据源/目标自动生成，可手动修改；例如 cursor-settings">
                <TextInput
                  value={newLink.id}
                  onChange={(event) => {
                    setNewLinkAutoFields((prev) => ({ ...prev, id: false }));
                    setNewLink({ ...newLink, id: event.target.value });
                  }}
                  placeholder="cursor-settings"
                  required
                />
              </Field>
              <Field label="显示名称" hint="根据源/目标自动生成，可手动修改；例如 Cursor 设置">
                <TextInput
                  value={newLink.label}
                  onChange={(event) => {
                    setNewLinkAutoFields((prev) => ({ ...prev, label: false }));
                    setNewLink({ ...newLink, label: event.target.value });
                  }}
                  placeholder="Cursor 设置"
                  required
                />
              </Field>
            </div>
          </form>
        ) : createTab === "standalone-mapping-root" ? (
          <form className="grid gap-3" onSubmit={submitStandaloneMappingRoot}>
            <div>
              <h3 className="text-base font-semibold text-slate-800">新建独立 Mapping Root</h3>
              <div className="text-sm text-slate-500">
                用于不属于任何 Data Repo 的目录批量映射；保存前会检查并清理源目录内已有的自由链接记录。
              </div>
            </div>
            <div className="grid grid-cols-[minmax(140px,0.55fr)_minmax(180px,0.8fr)_160px_auto] gap-3">
              <Field label="规则 ID" hint="唯一英文标识，例如 external-tools">
                <TextInput
                  value={standaloneRoot.id}
                  onChange={(event) => setStandaloneRoot({ ...standaloneRoot, id: event.target.value })}
                  placeholder="external-tools"
                  required
                />
              </Field>
              <Field label="显示名称" hint="表格中显示的人类可读名称，例如 External Tools">
                <TextInput
                  value={standaloneRoot.label}
                  onChange={(event) => setStandaloneRoot({ ...standaloneRoot, label: event.target.value })}
                  placeholder="External Tools"
                  required
                />
              </Field>
              <Field label="模式" hint="children：映射子项；direct：映射源本身">
                <Select
                  value={standaloneRoot.mode}
                  onChange={(event) =>
                    setStandaloneRoot({ ...standaloneRoot, mode: event.target.value as "children" | "direct" })
                  }
                >
                  <option value="children">children</option>
                  <option value="direct">direct</option>
                </Select>
              </Field>
              <div className="flex items-start pt-6">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={
                    loading ||
                    !standaloneRoot.id.trim() ||
                    !standaloneRoot.label.trim() ||
                    !standaloneRoot.source.trim() ||
                    !standaloneRoot.target.trim()
                  }
                >
                  <Plus size={16} />
                  新建独立 Mapping Root
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-[minmax(240px,1fr)_minmax(240px,1fr)] gap-3">
              <Field label="源目录" hint="必须是 Data Repo 外的绝对目录，例如 D:/A/Scoop/persist">
                <TextInput
                  value={standaloneRoot.source}
                  onChange={(event) => setStandaloneRoot({ ...standaloneRoot, source: event.target.value })}
                  placeholder="D:/A/Scoop/persist"
                  required
                />
              </Field>
              <Field label="目标目录" hint="系统中要放置软链接的目录，例如 %APPDATA% 或 C:/Users/i/AppData/Roaming">
                <TextInput
                  value={standaloneRoot.target}
                  onChange={(event) => setStandaloneRoot({ ...standaloneRoot, target: event.target.value })}
                  placeholder="%APPDATA%"
                  required
                />
              </Field>
            </div>
            <Field label="忽略条目" hint="每行一个，或用逗号分隔；扫描和展开 Mapping Root 时会跳过这些名称">
              <textarea
                className="min-h-20 w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                value={standaloneIgnoreText}
                onChange={(event) => setStandaloneIgnoreText(event.target.value)}
                placeholder={"Cache\nTemp"}
              />
            </Field>
            <label className="flex items-start gap-3 rounded-md border border-line p-3 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={standaloneRoot.enabled}
                onChange={(event) => setStandaloneRoot({ ...standaloneRoot, enabled: event.target.checked })}
              />
              <span>
                <span className="block font-medium">启用这条独立 Mapping Root 配置</span>
                <span className="text-slate-500">
                  这里只控制是否参与扫描和列表展开；真正建立软链接仍需在表格中执行“启用”并确认预览。
                </span>
              </span>
            </label>
          </form>
        ) : (
          <form className="grid gap-3" onSubmit={submitNewDataRepo}>
            <div>
              <h3 className="text-base font-semibold text-slate-800">新增 Data Repo</h3>
              <div className="text-sm text-slate-500">
                添加一个保存真实数据的根目录；之后可在该根下创建 Mapping Root 或通过扫描发现目录变化。
              </div>
            </div>
            <div className="grid grid-cols-[minmax(140px,0.6fr)_minmax(180px,0.8fr)_minmax(260px,1fr)_auto] gap-3">
              <Field label="Data Repo ID" hint="唯一英文标识，例如 portable-data">
                <TextInput
                  value={newRoot.id}
                  onChange={(event) => setNewRoot({ ...newRoot, id: event.target.value })}
                  placeholder="portable-data"
                  required
                />
              </Field>
              <Field label="显示名称" hint="表格中显示的人类可读名称，例如 Portable Data">
                <TextInput
                  value={newRoot.label}
                  onChange={(event) => setNewRoot({ ...newRoot, label: event.target.value })}
                  placeholder="Portable Data"
                  required
                />
              </Field>
              <Field label="目录位置" hint="可以是任意硬盘上的绝对目录，例如 D:/Config/mklink2">
                <TextInput
                  value={newRoot.path}
                  onChange={(event) => setNewRoot({ ...newRoot, path: event.target.value })}
                  placeholder="D:/Config/mklink2"
                  required
                />
              </Field>
              <div className="flex items-start pt-6">
                <Button type="submit" variant="primary">
                  <Plus size={16} />
                  新增 Data Repo
                </Button>
              </div>
            </div>
          </form>
        )}
      </Panel>

      {pendingRepoUpdate && (
        <DataRepoUpdateDialog
          root={pendingRepoUpdate.root}
          onClose={() => setPendingRepoUpdate(null)}
          onApply={async (input) => {
            await onUpsertDataRepo(input);
            setPendingRepoUpdate(null);
          }}
          loading={loading}
        />
      )}
      {pendingMappingRootUpdate && (
        <MappingRootDialog
          mappingRoot={pendingMappingRootUpdate.root}
          initialDataRepoId={pendingMappingRootUpdate.dataRepoId}
          dataRepos={settings?.dataRepos ?? []}
          onClose={() => setPendingMappingRootUpdate(null)}
          onApply={async (input) => {
            await onUpsertMappingRoot(input);
            setPendingMappingRootUpdate(null);
          }}
          loading={loading}
        />
      )}
      {pendingStandaloneCleanup && (
        <StandaloneCleanupDialog
          pending={pendingStandaloneCleanup}
          onClose={() => setPendingStandaloneCleanup(null)}
          onApply={async () => {
            await onUpsertMappingRoot({
              ...pendingStandaloneCleanup.input,
              cleanupFreeLinkIds: pendingStandaloneCleanup.preview.overlappingFreeLinks.map((link) => link.id),
            });
            setPendingStandaloneCleanup(null);
            resetStandaloneMappingRoot();
          }}
          loading={loading}
        />
      )}
      {pendingExportScript && (
        <ExportScriptDialog
          initial={pendingExportScript}
          onClose={() => setPendingExportScript(null)}
          onApply={async (input) => {
            await onExportMklinkScript(input);
            setPendingExportScript(null);
          }}
          loading={loading}
        />
      )}
      {sourceDialogLink && (
        <MoveSourceDialog
          link={sourceDialogLink}
          dataRepos={settings?.dataRepos ?? []}
          onClose={() => setSourceDialogLink(null)}
          onApply={async (input) => {
            await onMoveSource(input);
            setSourceDialogLink(null);
          }}
          loading={loading}
        />
      )}
      {metadataDialogLink && (
        <LinkMetadataDialog
          link={metadataDialogLink}
          onClose={() => setMetadataDialogLink(null)}
          onApply={async (input) => {
            await onUpdateLinkMetadata(input);
            setMetadataDialogLink(null);
          }}
          loading={loading}
        />
      )}
    </div>
  );
}

function LinkTreeNodes({
  nodes,
  mode,
  selected,
  expandedNodes,
  onToggleLink,
  onToggleNode,
  onToggleExpanded,
  makeActionRequest,
  onPreview,
  onOpen,
  onReveal,
  onMoveSource,
  onEditMetadata,
  onEditMappingRoot,
  onScanMappingRoot,
}: {
  nodes: LinkTreeNode[];
  mode: LinkTreeMode;
  selected: Set<string>;
  expandedNodes: Set<string>;
  onToggleLink: (id: string) => void;
  onToggleNode: (node: LinkTreeNode) => void;
  onToggleExpanded: (node: LinkTreeNode) => void;
  makeActionRequest: (linkIds: string[], operation: "enable" | "remove") => ActionRequest;
  onPreview: (request: ActionRequest) => Promise<void>;
  onOpen: (path: string) => Promise<unknown>;
  onReveal: (path: string) => Promise<unknown>;
  onMoveSource: (link: LinkRecord) => void;
  onEditMetadata: (link: LinkRecord) => void;
  onEditMappingRoot: (root: LinkSettings["mappingRoots"][number]) => void;
  onScanMappingRoot: (id: string) => Promise<void>;
}) {
  return (
    <>
      {nodes.map((node) => {
        const link = node.link;
        const allSelected = node.links.length > 0 && node.links.every((item) => selected.has(item.id));
        const someSelected = node.links.some((item) => selected.has(item.id));
        const paddingLeft = 24 + node.depth * 18;
        const canExpand = node.children.length > 0;
        const expanded = expandedNodes.has(node.id);
        const mappingRoot = mode === "source" ? node.mappingRoot : undefined;

        if (!link) {
          return (
            <div key={node.id}>
              <div className="link-tree-grid items-start bg-white px-3 py-2 text-sm hover:bg-slate-50">
                <div className="pl-9">
                  <input
                    type="checkbox"
                    aria-label={`Select ${node.name}`}
                    checked={allSelected}
                    ref={(input) => {
                      if (input) input.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={() => onToggleNode(node)}
                  />
                </div>
                <div className="min-w-0 border-l border-slate-200" style={{ paddingLeft }}>
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
                      onClick={() => onToggleExpanded(node)}
                      title={expanded ? "折叠目录" : "展开目录"}
                    >
                      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <Folder className="shrink-0 text-blue-600" size={15} />
                    <button
                      type="button"
                      className="min-w-0 truncate text-left font-medium"
                      onClick={() => onToggleExpanded(node)}
                    >
                      {node.name}
                    </button>
                    <span className="text-xs text-slate-500">{node.links.length}</span>
                  </div>
                </div>
                <StatusSummary counts={node.statusCounts} />
                {mappingRoot ? (
                  <MappingRootSourceCell
                    mappingRoot={mappingRoot}
                    onOpen={onOpen}
                    onScanMappingRoot={onScanMappingRoot}
                  />
                ) : mode === "source" ? (
                  <PathCell value={node.path} />
                ) : (
                  <div className="text-xs text-slate-500">目录</div>
                )}
                {mappingRoot ? (
                  <MappingRootTargetCell
                    mappingRoot={mappingRoot}
                    onOpen={onOpen}
                  />
                ) : (
                  <div className="text-xs text-slate-500">目录</div>
                )}
                <div className="flex items-center gap-1">
                  <IconButton
                    title="预览启用目录下映射"
                    onClick={() =>
                      onPreview(makeActionRequest(node.links.map((item) => item.id), "enable"))
                    }
                  >
                    <Play size={15} />
                  </IconButton>
                  <IconButton
                    title="预览删除目录下映射"
                    onClick={() =>
                      onPreview(makeActionRequest(node.links.map((item) => item.id), "remove"))
                    }
                  >
                    <Trash2 size={15} />
                  </IconButton>
                  {mappingRoot && (
                    <IconButton title="编辑 Mapping Root" onClick={() => onEditMappingRoot(mappingRoot)}>
                      <Pencil size={15} />
                    </IconButton>
                  )}
                </div>
              </div>
              {expanded && (
                <LinkTreeNodes
                  nodes={node.children}
                  mode={mode}
                  selected={selected}
                  expandedNodes={expandedNodes}
                  onToggleLink={onToggleLink}
                  onToggleNode={onToggleNode}
                  onToggleExpanded={onToggleExpanded}
                  makeActionRequest={makeActionRequest}
                  onPreview={onPreview}
                  onOpen={onOpen}
                  onReveal={onReveal}
                  onMoveSource={onMoveSource}
                  onEditMetadata={onEditMetadata}
                  onEditMappingRoot={onEditMappingRoot}
                  onScanMappingRoot={onScanMappingRoot}
                />
              )}
            </div>
          );
        }

        return (
          <div key={node.id}>
            <div className="link-tree-grid items-start px-3 py-2 text-sm hover:bg-slate-50">
              <div className="pl-9">
                <input
                  type="checkbox"
                  aria-label={`Select ${link.label}`}
                  checked={selected.has(link.id)}
                  onChange={() => onToggleLink(link.id)}
                />
              </div>
              <div className="min-w-0 border-l border-slate-200" style={{ paddingLeft }}>
                <div className="flex min-w-0 items-center gap-2">
                  {canExpand ? (
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
                      onClick={() => onToggleExpanded(node)}
                      title={expanded ? "折叠目录" : "展开目录"}
                    >
                      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                  ) : (
                    <span className="h-6 w-6 shrink-0" />
                  )}
                  <Link2 className="shrink-0 text-slate-500" size={15} />
                  <span className="truncate font-medium">{node.name}</span>
                  {node.children.length > 0 && (
                    <span className="text-xs text-slate-500">{node.children.length}</span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-500" title={link.id}>
                  <span>{link.label} · {link.id}</span>
                  <InlineIconButton title="编辑映射 ID 和显示名称" onClick={() => onEditMetadata(link)}>
                    <Pencil size={13} />
                  </InlineIconButton>
                </div>
              </div>
              <div>
                <Badge tone={statusTone[link.status]}>{statusLabel[link.status]}</Badge>
              </div>
              <PathCell value={link.source}>
                <InlineIconButton title="打开源" onClick={() => onOpen(link.source)}>
                  <ExternalLink size={15} />
                </InlineIconButton>
                <InlineIconButton title="修改源并迁移" onClick={() => onMoveSource(link)}>
                  <Pencil size={15} />
                </InlineIconButton>
              </PathCell>
              <PathCell value={link.target}>
                <InlineIconButton title="定位目标" onClick={() => onReveal(link.target)}>
                  <FolderOpen size={15} />
                </InlineIconButton>
              </PathCell>
              <div className="flex items-center gap-1">
                <IconButton
                  title={link.status === "enabled" ? "该软链接已启用，无需再次预览启用" : "预览启用"}
                  disabled={link.status === "enabled"}
                  onClick={() => onPreview(makeActionRequest([link.id], "enable"))}
                >
                  <Play size={15} />
                </IconButton>
                <IconButton title="预览删除" onClick={() => onPreview(makeActionRequest([link.id], "remove"))}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </div>
            {expanded && node.children.length > 0 && (
              <LinkTreeNodes
                nodes={node.children}
                mode={mode}
                selected={selected}
                expandedNodes={expandedNodes}
                onToggleLink={onToggleLink}
                onToggleNode={onToggleNode}
                onToggleExpanded={onToggleExpanded}
                makeActionRequest={makeActionRequest}
                onPreview={onPreview}
                onOpen={onOpen}
                onReveal={onReveal}
                onMoveSource={onMoveSource}
                onEditMetadata={onEditMetadata}
                onEditMappingRoot={onEditMappingRoot}
                onScanMappingRoot={onScanMappingRoot}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function splitIgnoreText(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function generateNewLinkMetadata(source: string, target: string) {
  const parts = splitPathParts(source || target).filter((part) => !/^%[^%]+%$/.test(part));
  const nameParts = parts.slice(-2);
  const fallback = source || target || "free-link";
  const label = nameParts.length > 0 ? nameParts.join(" ") : fallback;
  const idSource = nameParts.length > 0 ? nameParts.join("-") : fallback;
  return {
    id: slugId(idSource) || "free-link",
    label: label || "Free link",
  };
}

function slugId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/%/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function toggleMany(prev: Set<string>, ids: string[]) {
  const next = new Set(prev);
  const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) {
    if (allSelected) next.delete(id);
    else next.add(id);
  }
  return next;
}

function parentPathForDisplay(path: string) {
  const normalized = path.replace(/\//g, "\\").replace(/\\+$/g, "");
  const index = normalized.lastIndexOf("\\");
  if (index <= 0) return normalized;
  return normalized.slice(0, index);
}

function defaultExportPath(configPath?: string | null) {
  const base = configPath ? parentPathForDisplay(configPath) : "data";
  return `${base}\\exported-mklink.md`;
}

function splitPathParts(path: string) {
  return path.replace(/\//g, "\\").replace(/\\+$/g, "").split("\\").filter(Boolean);
}

function StatusSummary({
  counts,
}: {
  counts: Partial<Record<LinkStatus, number>>;
}) {
  const order: LinkStatus[] = [
    "enabled",
    "missing",
    "real-content",
    "wrong-target",
    "broken",
    "source-missing",
  ];
  const active = order.filter((status) => counts[status]);
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {active.map((status) => (
        <Badge key={status} tone={statusTone[status]}>
          {statusLabel[status]} {counts[status]}
        </Badge>
      ))}
    </div>
  );
}

function DataRepoUpdateDialog({
  root,
  onClose,
  onApply,
  loading,
}: {
  root: DataRepo;
  onClose: () => void;
  onApply: (input: UpsertDataRepoInput) => Promise<void>;
  loading: boolean;
}) {
  const [nextPath, setNextPath] = useState(root.resolvedPath);
  const [moveData, setMoveData] = useState(true);
  const [rebuildLinks, setRebuildLinks] = useState(true);
  const trimmedNextPath = nextPath.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">更改 Data Repo 位置</h3>
            <div className="text-sm text-slate-500">确认迁移方式后再更新配置</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="rounded-md border border-line bg-slate-50 p-3">
            <PathLine label="根" value={`${root.label} (${root.id})`} />
            <PathLine label="旧配置" value={root.path} />
            <PathLine label="旧路径" value={root.resolvedPath} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              新位置
            </label>
            <TextInput
              value={nextPath}
              onChange={(event) => setNextPath(event.target.value)}
              placeholder="D:/Config/mklink 或 E:/app-settings"
            />
            <div className="mt-1 text-xs text-slate-500">
              可填写任意硬盘上的绝对目录；提交后会更新这个 Data Repo 的源位置。
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-md border border-line p-3">
            <input
              className="mt-1"
              type="checkbox"
              checked={moveData}
              onChange={(event) => setMoveData(event.target.checked)}
            />
            <span>
              <span className="block font-medium">把旧 Data Repo 内容转移到新目录</span>
              <span className="text-slate-500">
                会移动这个 Data Repo。新目录可以在任意硬盘；若已存在且非空，操作会被拒绝。
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-md border border-line p-3">
            <input
              className="mt-1"
              type="checkbox"
              checked={rebuildLinks}
              onChange={(event) => setRebuildLinks(event.target.checked)}
            />
            <span>
              <span className="block font-medium">重建当前所有软链接</span>
              <span className="text-slate-500">
                会按新位置重新启用这个根下的映射；旧目标链接会先移除再创建。
              </span>
            </span>
          </label>
          {!moveData && (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              <AlertTriangle size={16} />
              如果新目录里没有对应数据，重建时这些映射会显示源缺失。
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-slate-50 px-5 py-4">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={
              loading ||
              trimmedNextPath.length === 0 ||
              trimmedNextPath.toLowerCase() === root.resolvedPath.toLowerCase()
            }
            onClick={() =>
              onApply({
                id: root.id,
                label: root.label,
                path: trimmedNextPath,
                moveDataFromRepoId: moveData ? root.id : null,
                rebuildLinks,
              })
            }
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <FolderOpen size={16} />}
            更新目录
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScanChangesDialog({
  result,
  onClose,
  onRefresh,
}: {
  result: ScanChangesResult;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">{result.title}</h3>
            <div className="text-sm text-slate-500">扫描完成，请确认是否更新界面状态</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="max-h-[60vh] space-y-4 overflow-auto p-5 text-sm">
          <div className="rounded-md border border-line bg-slate-50 p-3">
            <div className="mb-2 text-xs font-semibold text-slate-600">摘要</div>
            <div className="space-y-1">
              {result.summary.map((item) => (
                <div key={item} className="text-slate-700">{item}</div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-line p-3">
            <div className="mb-2 text-xs font-semibold text-slate-600">细节</div>
            {result.details.length ? (
              <div className="space-y-1">
                {result.details.map((item, index) => (
                  <div key={`${item}-${index}`} className="break-words text-xs text-slate-600">{item}</div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500">没有发现需要展示的目录差异。</div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-slate-50 px-5 py-4">
          <Button onClick={onClose}>暂不更新</Button>
          <Button variant="primary" onClick={onRefresh}>
            <RefreshCw size={16} />
            更新界面状态
          </Button>
        </div>
      </div>
    </div>
  );
}

function StandaloneCleanupDialog({
  pending,
  onClose,
  onApply,
  loading,
}: {
  pending: PendingStandaloneMappingRootCleanup;
  onClose: () => void;
  onApply: () => Promise<void>;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">确认清理自由链接记录</h3>
            <div className="text-sm text-slate-500">
              这些自由链接的源目录位于新的独立 Mapping Root 内，确认后会从当前 Profile 的 links.toml 删除记录。
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="rounded-md border border-line bg-slate-50 p-3 text-xs text-slate-600">
            <PathLine label="独立源目录" value={pending.preview.resolvedSource} />
            <PathLine label="Mapping Root" value={`${pending.input.label} (${pending.input.id})`} />
          </div>
          <div className="space-y-2">
            {pending.preview.overlappingFreeLinks.map((link) => (
              <div key={link.id} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-amber-950">{link.label}</span>
                  <Badge tone={link.enabled ? "yellow" : "gray"}>
                    {link.enabled ? "已启用记录" : "未启用记录"}
                  </Badge>
                </div>
                <div className="mt-1 grid gap-1 text-xs text-amber-900">
                  <PathLine label="源" value={link.source} />
                  <PathLine label="目标" value={link.target} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-slate-50 px-5 py-4">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={onApply} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
            确认并删除这些记录
          </Button>
        </div>
      </div>
    </div>
  );
}

function MappingRootDialog({
  mappingRoot,
  initialDataRepoId,
  dataRepos,
  onClose,
  onApply,
  loading,
}: {
  mappingRoot?: LinkSettings["mappingRoots"][number];
  initialDataRepoId?: string;
  dataRepos: DataRepo[];
  onClose: () => void;
  onApply: (input: UpsertMappingRootInput) => Promise<void>;
  loading: boolean;
}) {
  const isEdit = Boolean(mappingRoot);
  const [form, setForm] = useState<UpsertMappingRootInput>(() => ({
    id: mappingRoot?.id ?? "",
    label: mappingRoot?.label ?? "",
    dataRepoId: mappingRoot?.dataRepoId ?? initialDataRepoId ?? "primary",
    source: mappingRoot?.source ?? "",
    target: mappingRoot?.target ?? "",
    mode: mappingRoot?.mode ?? "children",
    enabled: mappingRoot?.enabled ?? true,
    ignore: mappingRoot?.ignore ?? [],
  }));
  const [ignoreText, setIgnoreText] = useState((mappingRoot?.ignore ?? []).join("\n"));

  const isStandalone = form.dataRepoId === VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID;
  const selectedRepo = isStandalone ? null : dataRepos.find((repo) => repo.id === (form.dataRepoId ?? "primary"));
  const canSubmit = form.id.trim() && form.label.trim() && form.source.trim() && form.target.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">{isEdit ? "编辑 Mapping Root" : "新增 Mapping Root"}</h3>
            <div className="text-sm text-slate-500">
              Mapping Root 下的条目会在目标目录中建立同名软链接
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <form
          className="space-y-4 p-5 text-sm"
          onSubmit={async (event) => {
            event.preventDefault();
            await onApply({
              ...form,
              id: form.id.trim(),
              label: form.label.trim(),
              source: form.source.trim(),
              target: form.target.trim(),
              dataRepoId: form.dataRepoId?.trim() || "primary",
              ignore: splitIgnoreText(ignoreText),
            });
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="规则 ID" hint="唯一英文标识，例如 scoop-persist；编辑已有规则时不可修改">
              <TextInput
                value={form.id}
                onChange={(event) => setForm({ ...form, id: event.target.value })}
                placeholder="scoop-persist"
                disabled={isEdit}
                required
              />
            </Field>
            <Field label="显示名称" hint="表格中显示的人类可读名称，例如 Scoop persist">
              <TextInput
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                placeholder="Scoop persist"
                required
              />
            </Field>
            <Field label="所属 Data Repo" hint="源目录会相对这个 Data Repo 解析；也可填写绝对源路径">
              <Select
                value={form.dataRepoId ?? "primary"}
                onChange={(event) => setForm({ ...form, dataRepoId: event.target.value })}
              >
                {isStandalone && (
                  <option value={VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID}>
                    {VIRTUAL_INDEPENDENT_MAPPING_ROOTS_LABEL}
                  </option>
                )}
                {dataRepos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.label} ({repo.id})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="模式" hint="children：把源目录子项映射到目标；direct：把源本身映射到目标">
              <Select
                value={form.mode}
                onChange={(event) => setForm({ ...form, mode: event.target.value as "children" | "direct" })}
              >
                <option value="children">children：源目录下每个条目建立同名链接</option>
                <option value="direct">direct：源本身映射到目标</option>
              </Select>
            </Field>
          </div>

          <Field
            label="源目录"
            hint={
              isStandalone
                ? "独立 Mapping Root 必须使用 Data Repo 外的绝对路径"
                : "相对所属 Data Repo 的路径，例如 AppData_Local；也可以是 D:/Data/AppData_Local"
            }
          >
            <TextInput
              value={form.source}
              onChange={(event) => setForm({ ...form, source: event.target.value })}
              placeholder="AppData_Local"
              required
            />
          </Field>
          <Field
            label="目标目录"
            hint="系统中要放置软链接的目录，例如 %LOCALAPPDATA% 或 C:/Users/i/AppData/Local"
          >
            <TextInput
              value={form.target}
              onChange={(event) => setForm({ ...form, target: event.target.value })}
              placeholder="%LOCALAPPDATA%"
              required
            />
          </Field>

          <div className="rounded-md border border-line bg-slate-50 p-3 text-xs text-slate-600">
            <PathLine
              label="Data Repo"
              value={
                isStandalone
                  ? `${VIRTUAL_INDEPENDENT_MAPPING_ROOTS_LABEL} (${VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID})`
                  : selectedRepo
                    ? `${selectedRepo.label} (${selectedRepo.resolvedPath})`
                    : "未找到"
              }
            />
            <PathLine label="示例" value="source = AppData_Local, target = %LOCALAPPDATA%, mode = children" />
          </div>

          <Field label="忽略条目" hint="每行一个，或用逗号分隔；扫描和展开 Mapping Root 时会跳过这些名称">
            <textarea
              className="min-h-24 w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
              value={ignoreText}
              onChange={(event) => setIgnoreText(event.target.value)}
              placeholder={"Wox\nAnki2"}
            />
          </Field>

          <label className="flex items-start gap-3 rounded-md border border-line p-3">
            <input
              className="mt-1"
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            <span>
              <span className="block font-medium">启用这条 Mapping Root 配置</span>
              <span className="text-slate-500">
                这里只控制是否参与扫描和列表展开；真正建立软链接仍需在表格中执行“启用”并确认预览。
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={loading || !canSubmit}>
              <CheckCircle2 size={16} />
              保存
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ExportScriptDialog({
  initial,
  onClose,
  onApply,
  loading,
}: {
  initial: PendingExportScript;
  onClose: () => void;
  onApply: (input: ExportMklinkScriptInput) => Promise<void>;
  loading: boolean;
}) {
  const [form, setForm] = useState<ExportMklinkScriptInput>(initial);
  const canSubmit = form.outputPath.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">导出 mklink 脚本</h3>
            <div className="text-sm text-slate-500">
              导出为 Markdown 文件，包含分组注释和可复制的 mklink 命令
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <form
          className="space-y-4 p-5 text-sm"
          onSubmit={async (event) => {
            event.preventDefault();
            await onApply(form);
          }}
        >
          <Field label="导出文件" hint="建议使用 .md，方便浏览分组、注释和命令">
            <TextInput
              value={form.outputPath}
              onChange={(event) => setForm({ ...form, outputPath: event.target.value })}
              placeholder="D:/A/resticprofile/thirdparty_configs/mklink-export.md"
              required
            />
          </Field>

          <label className="flex items-start gap-3 rounded-md border border-line p-3">
            <input
              className="mt-1"
              type="checkbox"
              checked={form.useMappingRootHelper}
              onChange={(event) => setForm({ ...form, useMappingRootHelper: event.target.checked })}
            />
            <span>
              <span className="block font-medium">Mapping Root 使用批量脚本调用</span>
              <span className="text-slate-500">
                勾选后会生成 `set "MAPPING_ROOT_TOOL=..."`，并用 `call "%MAPPING_ROOT_TOOL%"` 导出 Mapping Root。
                未勾选则展开为多条 mklink 命令。
              </span>
            </span>
          </label>

          <Field label="批量脚本位置变量默认值" hint="导出的脚本里可以继续修改这个变量">
            <TextInput
              value={form.helperScriptPath}
              onChange={(event) => setForm({ ...form, helperScriptPath: event.target.value })}
              placeholder="tools\\mklink-by-Mapping-Root.bat"
              disabled={!form.useMappingRootHelper}
            />
          </Field>

          <Field
            label="mklink 前如果目标已有对象"
            hint="影响导出的每条 mklink 前置命令；使用 Mapping Root 批量脚本时，删除会转为 AUTO，备份/不处理保持 MANUAL"
          >
            <Select
              value={form.targetConflictStrategy}
              onChange={(event) =>
                setForm({
                  ...form,
                  targetConflictStrategy: event.target.value as "none" | "delete" | "backup",
                })
              }
            >
              <option value="backup">先备份到脚本变量 MKLINK_BACKUP_DIR</option>
              <option value="delete">先删除目标位置上的已有对象</option>
              <option value="none">不处理，仅输出 mklink</option>
            </Select>
          </Field>

          <div className="rounded-md border border-line bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            禁用的映射也会导出，但会在命令前标注 `:: DISABLED`。源目录不存在的条目会标注 `:: SOURCE MISSING`。
            备份策略会在脚本顶部生成 `MKLINK_BACKUP_DIR` 变量，导出后可手动改位置。
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={loading || !canSubmit}>
              <FileText size={16} />
              导出
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MoveSourceDialog({
  link,
  dataRepos,
  onClose,
  onApply,
  loading,
}: {
  link: LinkRecord;
  dataRepos: DataRepo[];
  onClose: () => void;
  onApply: (input: MoveLinkSourceInput) => Promise<void>;
  loading: boolean;
}) {
  const [newSource, setNewSource] = useState(link.sourceConfig || link.source);
  const [syncTargetName, setSyncTargetName] = useState(true);
  const root = dataRepos.find((item) => item.id === link.dataRepoId);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">修改映射源</h3>
            <div className="text-sm text-slate-500">会移动源数据，并重建目标软链接</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="rounded-md border border-line bg-slate-50 p-3">
            <PathLine label="映射" value={link.label} />
            <PathLine label="当前源" value={link.source} />
            <PathLine label="目标" value={link.target} />
            <PathLine label="Data Repo" value={root ? `${root.label} (${root.resolvedPath})` : "自由链接/绝对路径"} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              新源位置
            </label>
            <TextInput
              value={newSource}
              onChange={(event) => setNewSource(event.target.value)}
              placeholder={root ? "相对该 Data Repo 的路径，或绝对路径" : "绝对路径"}
            />
            <div className="mt-1 text-xs text-slate-500">
              新位置必须不存在；app 会把当前源移动过去，然后让目标链接指向新源。
            </div>
          </div>
          <label className="flex items-start gap-2 rounded-md border border-line bg-white px-3 py-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={syncTargetName}
              onChange={(event) => setSyncTargetName(event.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-slate-700">同步目标软链接的名字</span>
              <span className="block text-xs text-slate-500">
                默认开启。例如源从 <code>D:/Data/old</code> 改为 <code>D:/Data/new</code> 时，
                目标会从 <code>C:/App/old</code> 同步改为 <code>C:/App/new</code>。
                关闭后只更新链接指向，目标路径名称保持不变。
              </span>
            </span>
          </label>
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            <AlertTriangle size={16} />
            如果目标位置存在真实内容而不是链接，操作会被拒绝。
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-slate-50 px-5 py-4">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={loading || newSource.trim().length === 0}
            onClick={() => onApply({ linkId: link.id, newSource: newSource.trim(), syncTargetName })}
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <Pencil size={16} />}
            迁移并重建
          </Button>
        </div>
      </div>
    </div>
  );
}

function LinkMetadataDialog({
  link,
  onClose,
  onApply,
  loading,
}: {
  link: LinkRecord;
  onClose: () => void;
  onApply: (input: UpdateLinkMetadataInput) => Promise<void>;
  loading: boolean;
}) {
  const [newId, setNewId] = useState(link.id);
  const [label, setLabel] = useState(link.label);
  const isGeneratedMappingRootChild = !link.isFreeLink && link.id.includes("::");
  const canSubmit = newId.trim().length > 0 && label.trim().length > 0 && !isGeneratedMappingRootChild;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">编辑映射 ID 和显示名称</h3>
            <div className="text-sm text-slate-500">只更新当前 profile 配置，不移动源数据，也不重建软链接</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <form
          className="space-y-4 p-5 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) onApply({ linkId: link.id, newId: newId.trim(), label: label.trim() });
          }}
        >
          <div className="rounded-md border border-line bg-slate-50 p-3">
            <PathLine label="当前映射" value={`${link.label} (${link.id})`} />
            <PathLine label="源" value={link.source} />
            <PathLine label="目标" value={link.target} />
          </div>

          {isGeneratedMappingRootChild && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              <AlertTriangle className="mt-0.5 shrink-0" size={16} />
              <div>
                这条映射是 Mapping Root 根据目录自动展开的子项，ID 和显示名称由规则派生。
                请编辑对应的 Mapping Root，或新建一条独立映射。
              </div>
            </div>
          )}

          <Field label="映射 ID" hint="唯一英文标识，只能使用 ASCII 字母、数字、短横线和下划线；例如 espanso-roaming">
            <TextInput value={newId} onChange={(event) => setNewId(event.target.value)} disabled={isGeneratedMappingRootChild} />
          </Field>
          <Field label="显示名称" hint="列表中显示的人类可读名称；例如 Espanso Roaming">
            <TextInput value={label} onChange={(event) => setLabel(event.target.value)} disabled={isGeneratedMappingRootChild} />
          </Field>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={loading || !canSubmit}>
              {loading ? <Loader2 className="animate-spin" size={16} /> : <Pencil size={16} />}
              保存
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BackupsView({
  entries,
  backupRoots,
  loading,
  onUpsertBackupRoot,
  onOpen,
  onReveal,
  onPreview,
}: {
  entries: BackupEntry[];
  backupRoots: BackupRoot[];
  loading: boolean;
  onUpsertBackupRoot: (input: UpsertBackupRootInput) => Promise<void>;
  onOpen: (path: string) => Promise<unknown>;
  onReveal: (path: string) => Promise<unknown>;
  onPreview: (path: string) => Promise<TextPreview | undefined>;
}) {
  const [search, setSearch] = useState("");
  const [rootFilter, setRootFilter] = useState("all");
  const [preview, setPreview] = useState<TextPreview | null>(null);
  const [expandedBackupNodes, setExpandedBackupNodes] = useState<Set<string>>(() => new Set());
  const [newBackupRoot, setNewBackupRoot] = useState<UpsertBackupRootInput>({
    id: "",
    label: "",
    path: "",
  });
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesRoot = rootFilter === "all" || entry.rootId === rootFilter;
      const matchesSearch =
        !query ||
        [entry.name, entry.rootLabel, entry.relativePath, entry.path].join(" ").toLowerCase().includes(query);
      return matchesRoot && matchesSearch;
    });
  }, [entries, rootFilter, search]);
  const backupTree = useMemo(() => buildBackupTree(backupRoots, filtered, rootFilter), [backupRoots, filtered, rootFilter]);

  useEffect(() => {
    setExpandedBackupNodes((prev) => {
      const nodeIds = collectBackupExpandableIds(backupTree);
      const next = new Set(prev);
      if (search.trim()) {
        nodeIds.forEach((id) => next.add(id));
      } else {
        for (const id of Array.from(next)) {
          if (!nodeIds.has(id)) next.delete(id);
        }
      }
      return next;
    });
  }, [backupTree, search]);

  function toggleBackupNode(id: string) {
    setExpandedBackupNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitBackupRoot(event: React.FormEvent) {
    event.preventDefault();
    await onUpsertBackupRoot(newBackupRoot);
    setNewBackupRoot({ id: "", label: "", path: "" });
  }

  async function previewEntry(entry: BackupEntry) {
    if (!entry.previewable) return;
    const text = await onPreview(entry.path);
    if (text) setPreview(text);
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">备份浏览</h2>
            <div className="text-sm text-slate-500">{filtered.length} / {entries.length}</div>
          </div>
          <div className="flex gap-2">
            <Select value={rootFilter} onChange={(event) => setRootFilter(event.target.value)}>
              <option value="all">全部根目录</option>
              {backupRoots.map((root) => (
                <option key={root.id} value={root.id}>
                  {root.label}
                </option>
              ))}
            </Select>
            <div className="relative w-80">
              <Search className="pointer-events-none absolute left-3 top-3 text-slate-400" size={16} />
              <TextInput
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索文件"
              />
            </div>
          </div>
        </div>

        <Panel className="p-4">
          <form className="grid grid-cols-[120px_180px_minmax(0,1fr)_auto] gap-2" onSubmit={submitBackupRoot}>
            <TextInput
              value={newBackupRoot.id}
              onChange={(event) => setNewBackupRoot({ ...newBackupRoot, id: event.target.value })}
              placeholder="root id"
              required
            />
            <TextInput
              value={newBackupRoot.label}
              onChange={(event) => setNewBackupRoot({ ...newBackupRoot, label: event.target.value })}
              placeholder="显示名称"
              required
            />
            <TextInput
              value={newBackupRoot.path}
              onChange={(event) => setNewBackupRoot({ ...newBackupRoot, path: event.target.value })}
              placeholder="D:/Backup/settings 或 backup-or-settings"
              required
            />
            <Button type="submit" disabled={loading}>
              <Plus size={16} />
              新增根
            </Button>
          </form>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="backup-grid border-b border-line bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
            <div>根目录 / 条目</div>
            <div>类型</div>
            <div>路径</div>
            <div>大小</div>
            <div>操作</div>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            {backupTree.map((root) => (
              <div key={root.id} className="border-b border-slate-100 last:border-b-0">
                <div className="backup-grid items-start bg-slate-50 px-3 py-2 text-sm hover:bg-slate-100">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-white"
                      onClick={() => toggleBackupNode(root.id)}
                      title={expandedBackupNodes.has(root.id) ? "折叠根目录" : "展开根目录"}
                    >
                      {expandedBackupNodes.has(root.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <Folder className="shrink-0 text-blue-700" size={16} />
                    <span className="truncate font-semibold">{root.label}</span>
                    <span className="text-xs text-slate-500">{root.entries.length}</span>
                  </div>
                  <Badge tone="blue">根目录</Badge>
                  <PathCell value={root.path} />
                  <div className="text-xs text-slate-500">{formatBytes(sumBackupSizes(root.entries))}</div>
                  <div className="flex items-center gap-1">
                    <IconButton title="打开" onClick={() => onOpen(root.path)}>
                      <ExternalLink size={15} />
                    </IconButton>
                    <IconButton title="定位" onClick={() => onReveal(root.path)}>
                      <FolderOpen size={15} />
                    </IconButton>
                  </div>
                </div>
                {expandedBackupNodes.has(root.id) && (
                  <BackupTreeNodes
                    nodes={root.children}
                    expandedNodes={expandedBackupNodes}
                    onToggleExpanded={toggleBackupNode}
                    onOpen={onOpen}
                    onReveal={onReveal}
                    onPreview={previewEntry}
                  />
                )}
              </div>
            ))}
            {backupTree.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-slate-500">
                没有匹配的备份条目
              </div>
            )}
          </div>
        </Panel>
      </div>
      <PreviewPanel preview={preview} />
    </div>
  );
}

function BackupTreeNodes({
  nodes,
  expandedNodes,
  onToggleExpanded,
  onOpen,
  onReveal,
  onPreview,
}: {
  nodes: BackupTreeNode[];
  expandedNodes: Set<string>;
  onToggleExpanded: (id: string) => void;
  onOpen: (path: string) => Promise<unknown>;
  onReveal: (path: string) => Promise<unknown>;
  onPreview: (entry: BackupEntry) => Promise<void>;
}) {
  return (
    <>
      {nodes.map((node) => {
        const entry = node.entry;
        const expanded = expandedNodes.has(node.id);
        const canExpand = node.children.length > 0;
        const paddingLeft = 26 + node.depth * 18;

        return (
          <div key={node.id}>
            <div className="backup-grid items-start border-t border-slate-100 px-3 py-2 text-sm hover:bg-slate-50">
              <div className="min-w-0 border-l border-slate-200" style={{ paddingLeft }}>
                <div className="flex min-w-0 items-center gap-2">
                  {canExpand ? (
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
                      onClick={() => onToggleExpanded(node.id)}
                      title={expanded ? "折叠目录" : "展开目录"}
                    >
                      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                  ) : (
                    <span className="h-6 w-6 shrink-0" />
                  )}
                  {entry?.kind === "file" ? (
                    <FileText className="shrink-0 text-slate-500" size={15} />
                  ) : (
                    <Folder className="shrink-0 text-blue-600" size={15} />
                  )}
                  <span className="truncate font-medium">{node.name}</span>
                  {canExpand && <span className="text-xs text-slate-500">{node.entries.length}</span>}
                </div>
              </div>
              <Badge tone={entry?.kind === "file" ? "gray" : "blue"}>
                {entry?.kind ?? "directory"}
              </Badge>
              <PathCell value={entry?.relativePath || node.relativePath} />
              <div className="text-xs text-slate-500">{formatBytes(entry?.size ?? sumBackupSizes(node.entries))}</div>
              <div className="flex items-center gap-1">
                {entry && (
                  <IconButton title="预览" disabled={!entry.previewable} onClick={() => onPreview(entry)}>
                    <Eye size={15} />
                  </IconButton>
                )}
                <IconButton title="打开" onClick={() => onOpen(entry?.path ?? node.path)}>
                  <ExternalLink size={15} />
                </IconButton>
                <IconButton title="定位" onClick={() => onReveal(entry?.path ?? node.path)}>
                  <FolderOpen size={15} />
                </IconButton>
                {entry && (
                  <IconButton title="复制路径" onClick={() => navigator.clipboard.writeText(entry.path)}>
                    <Clipboard size={15} />
                  </IconButton>
                )}
              </div>
            </div>
            {expanded && canExpand && (
              <BackupTreeNodes
                nodes={node.children}
                expandedNodes={expandedNodes}
                onToggleExpanded={onToggleExpanded}
                onOpen={onOpen}
                onReveal={onReveal}
                onPreview={onPreview}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function buildBackupTree(roots: BackupRoot[], entries: BackupEntry[], rootFilter: string): BackupTreeRoot[] {
  const entriesByRoot = new Map<string, BackupEntry[]>();
  for (const entry of entries) {
    const list = entriesByRoot.get(entry.rootId) ?? [];
    list.push(entry);
    entriesByRoot.set(entry.rootId, list);
  }

  const rootsById = new Map(roots.map((root) => [root.id, root]));
  for (const entry of entries) {
    if (!rootsById.has(entry.rootId)) {
      rootsById.set(entry.rootId, {
        id: entry.rootId,
        label: entry.rootLabel,
        path: entry.rootPath,
        resolvedPath: entry.rootPath,
        enabled: true,
      });
    }
  }

  return Array.from(rootsById.values())
    .filter((root) => rootFilter === "all" || root.id === rootFilter)
    .map((root) => {
      const rootEntries = entriesByRoot.get(root.id) ?? [];
      return {
        id: `backup-root:${root.id}`,
        label: root.label,
        path: root.resolvedPath,
        entries: rootEntries,
        children: buildBackupTreeNodes(root, rootEntries),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildBackupTreeNodes(root: BackupRoot, entries: BackupEntry[]) {
  const rootNode: BackupTreeNode = {
    id: `backup-node:${root.id}:root`,
    name: root.label,
    path: root.resolvedPath,
    relativePath: "",
    depth: 0,
    entries: [],
    children: [],
  };

  for (const entry of entries.sort((a, b) => comparePathsByHierarchy(a.relativePath, b.relativePath))) {
    const parts = splitPathParts(entry.relativePath);
    let cursor = rootNode;
    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      let child = cursor.children.find((node) => node.name === part);
      if (!child) {
        const relativePath = parts.slice(0, index + 1).join("\\");
        child = {
          id: `backup-node:${entry.rootId}:${relativePath}`,
          name: part,
          path: isLeaf ? entry.path : joinPathForDisplay(entry.rootPath, relativePath),
          relativePath,
          depth: cursor.depth + 1,
          entries: [],
          children: [],
        };
        cursor.children.push(child);
      }
      cursor = child;
      cursor.entries.push(entry);
      if (isLeaf) {
        cursor.entry = entry;
        cursor.path = entry.path;
      }
    });
  }

  sortBackupTreeNodes(rootNode.children);
  return rootNode.children;
}

function sortBackupTreeNodes(nodes: BackupTreeNode[]) {
  nodes.sort((a, b) => {
    if (!!a.entry !== !!b.entry) return a.entry ? 1 : -1;
    return comparePathsByHierarchy(a.relativePath, b.relativePath) || a.name.localeCompare(b.name);
  });
  nodes.forEach((node) => sortBackupTreeNodes(node.children));
}

function collectBackupExpandableIds(roots: BackupTreeRoot[]) {
  const ids = new Set<string>();
  roots.forEach((root) => {
    if (root.children.length > 0) ids.add(root.id);
    const visit = (node: BackupTreeNode) => {
      if (node.children.length > 0) ids.add(node.id);
      node.children.forEach(visit);
    };
    root.children.forEach(visit);
  });
  return ids;
}

function sumBackupSizes(entries: BackupEntry[]) {
  return entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
}

function joinPathForDisplay(root: string, relativePath: string) {
  if (!relativePath) return root;
  return `${root.replace(/[\\/]$/g, "")}\\${relativePath}`;
}

function isActionPlan(value: unknown): value is ActionPlan {
  return (
    typeof value === "object" &&
    value !== null &&
    "actions" in value &&
    "requiresAdmin" in value &&
    "warnings" in value
  );
}

function isActionResult(value: unknown): value is ActionResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "actions" in value &&
    "message" in value &&
    "ok" in value
  );
}

function summarizeLinksByStatus(rows: LinkRecord[]) {
  const counts = new Map<string, number>();
  rows.forEach((row) => counts.set(statusLabel[row.status], (counts.get(statusLabel[row.status]) ?? 0) + 1));
  return Array.from(counts.entries()).map(([label, count]) => `${label}：${count}`);
}

function summarizeBackupsByRoot(rows: BackupEntry[]) {
  const counts = new Map<string, number>();
  rows.forEach((row) => counts.set(row.rootLabel, (counts.get(row.rootLabel) ?? 0) + 1));
  return Array.from(counts.entries()).map(([label, count]) => `${label}：${count}`);
}

function LogsView({
  logs,
  lastResult,
  onPreview,
}: {
  logs: OperationLog[];
  lastResult: ActionResult | null;
  onPreview: (path: string) => Promise<TextPreview | undefined>;
}) {
  const [preview, setPreview] = useState<TextPreview | null>(null);

  async function previewLog(log: OperationLog) {
    const text = await onPreview(log.path);
    if (text) setPreview(text);
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-4">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">持久操作日志</h2>
          <div className="text-sm text-slate-500">{logs.length} 个文件</div>
        </div>
        {lastResult && (
          <Panel className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Badge tone={lastResult.ok ? "green" : "red"}>
                {lastResult.ok ? "成功" : "有错误"}
              </Badge>
              <span className="text-sm font-medium">{lastResult.message}</span>
            </div>
            <div className="space-y-2 text-sm">
              {lastResult.actions.slice(0, 8).map((item) => (
                <div key={item.actionId} className="flex items-start gap-2">
                  <Badge tone={item.ok ? "green" : "red"}>
                    {item.ok ? "OK" : "FAIL"}
                  </Badge>
                  <span>{item.message}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
        <Panel className="overflow-hidden">
          <div className="grid grid-cols-[minmax(260px,1fr)_160px_120px] border-b border-line bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
            <div>文件</div>
            <div>时间</div>
            <div>大小</div>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            {logs.map((log) => (
              <button
                key={log.path}
                className="grid w-full grid-cols-[minmax(260px,1fr)_160px_120px] border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                onClick={() => previewLog(log)}
              >
                <span className="truncate font-medium">{log.name}</span>
                <span className="text-xs text-slate-500">{formatDate(log.modified)}</span>
                <span className="text-xs text-slate-500">{formatBytes(log.size)}</span>
              </button>
            ))}
          </div>
        </Panel>
      </div>
      <PreviewPanel preview={preview} />
    </div>
  );
}

function PlanDialog({
  plan,
  request,
  onClose,
  onRequestChange,
  onApply,
  loading,
}: {
  plan: ActionPlan;
  request: ActionRequest;
  onClose: () => void;
  onRequestChange: (request: ActionRequest) => Promise<void>;
  onApply: () => Promise<void>;
  loading: boolean;
}) {
  const dangerCount = plan.actions.filter((action) => action.severity === "danger").length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6">
      <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">操作预览</h3>
            <div className="text-sm text-slate-500">{plan.actions.length} 个动作</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="max-h-[58vh] overflow-auto p-5">
          {plan.requiresAdmin && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <ShieldAlert size={16} />
              当前环境可能需要管理员权限或开发者模式。
            </div>
          )}
          {dangerCount > 0 && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle size={16} />
              包含 {dangerCount} 个会移动真实内容的动作。
            </div>
          )}
          <PlanStrategyControls
            plan={plan}
            request={request}
            onRequestChange={onRequestChange}
            loading={loading}
          />
          <PlanExplanation plan={plan} />
          <div className="space-y-2">
            {plan.actions.map((action) => (
              <div
                key={action.id}
                className="rounded-md border border-line bg-slate-50 px-3 py-2 text-sm"
              >
                <div className="mb-1 flex items-center gap-2">
                  <Badge
                    tone={
                      action.severity === "danger"
                        ? "red"
                        : action.severity === "warning"
                          ? "yellow"
                          : "gray"
                    }
                  >
                    {actionLabel[action.kind] ?? action.kind}
                  </Badge>
                  <span className="font-medium">{action.description}</span>
                </div>
                <div className="grid gap-1 text-xs text-slate-600">
                  {action.source && <PathLine label="源" value={action.source} />}
                  {action.target && <PathLine label="目标" value={action.target} />}
                  {action.backupPath && <PathLine label="备份" value={action.backupPath} />}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-slate-50 px-5 py-4">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={onApply} disabled={loading || plan.actions.length === 0}>
            {loading ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
            执行
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlanStrategyControls({
  plan,
  request,
  onRequestChange,
  loading,
}: {
  plan: ActionPlan;
  request: ActionRequest;
  onRequestChange: (request: ActionRequest) => Promise<void>;
  loading: boolean;
}) {
  const hasRealTargetConflict = plan.actions.some(
    (action) => action.kind === "backup-target" || action.kind === "delete-target",
  );
  const targetConflictStrategy = request.targetConflictStrategy ?? "backup";
  const removeLinkStrategy = request.removeLinkStrategy ?? "only-link";

  function previewWith(nextRequest: ActionRequest) {
    onRequestChange(nextRequest).catch(() => undefined);
  }

  if (request.operation === "enable" && hasRealTargetConflict) {
    return (
      <div className="mb-4 rounded-md border border-line bg-white px-4 py-3">
        <Field label="目标已有真实内容" hint={targetConflictHint}>
          <Select
            value={targetConflictStrategy}
            disabled={loading}
            onChange={(event) =>
              previewWith({
                ...request,
                targetConflictStrategy: event.target.value as TargetConflictStrategy,
              })
            }
          >
            {targetConflictOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    );
  }

  if (request.operation === "remove") {
    return (
      <div className="mb-4 rounded-md border border-line bg-white px-4 py-3">
        <Field label="删除软链接后" hint={removeLinkHint}>
          <Select
            value={removeLinkStrategy}
            disabled={loading}
            onChange={(event) =>
              previewWith({
                ...request,
                removeLinkStrategy: event.target.value as RemoveLinkStrategy,
              })
            }
          >
            {removeLinkOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    );
  }

  return null;
}

function PlanExplanation({ plan }: { plan: ActionPlan }) {
  const counts = countPlanActions(plan);
  const example = plan.actions.find((action) => action.source || action.target);
  const exampleText =
    example?.source && example?.target
      ? `例如：把源 ${example.source} 映射到目标 ${example.target}。`
      : example?.target
        ? `例如：处理目标 ${example.target}。`
        : "例如：对选中的映射逐条生成待执行动作。";

  if (plan.operation === "enable") {
    return (
      <PlanInfoBox
        title="启用会做什么"
        items={[
          "为配置文件中已登记的映射，或 Mapping Root 动态展开出的映射，创建软链接。",
          "如果目标位置已经是正确软链接，会跳过；如果目标位置是错误链接，会先删除旧链接再创建新链接。",
          "如果目标位置已有真实文件或目录，会按你在本弹窗中选择的策略处理：备份后替换，或直接删除后替换。",
          `${exampleText} 启用后，程序访问目标路径时，实际读写的是源目录内容。`,
        ]}
        details={[
          counts["backup-target"] ? `将备份真实目标：${counts["backup-target"]} 项。备份会写入单独的软链接备份目录。` : null,
          counts["delete-target"] ? `将直接删除真实目标：${counts["delete-target"]} 项。这个动作不可当作普通软链接删除看待。` : null,
          counts["create-link"] ? `将创建软链接：${counts["create-link"]} 项。` : null,
        ]}
      />
    );
  }

  if (plan.operation === "remove") {
    return (
      <PlanInfoBox
        title="删除会做什么"
        items={[
          "删除操作默认只移除目标位置上的软链接，不会删除源目录中的真实数据。",
          "删除操作不会移除映射表格中的记录，也不会从当前 Profile 的 links.toml 配置文件中删除映射。",
          "如果目标不是软链接而是真实文件或目录，计划会标出风险；这类内容不会被当成普通链接随手删除。",
          "删除后可按你在本弹窗中选择的策略处理目标位置：仅删除链接、从最近备份恢复，或把源内容复制回目标位置。",
          `${exampleText} 删除后，目标路径不再指向源目录；源目录本身仍然保留。`,
        ]}
        details={[
          counts["remove-link"] ? `将删除软链接：${counts["remove-link"]} 项。` : null,
          counts["restore-backup"] ? `将尝试恢复备份：${counts["restore-backup"]} 项。` : null,
          counts["copy-source-to-target"] ? `将复制源内容回目标：${counts["copy-source-to-target"]} 项。` : null,
        ]}
      />
    );
  }

  return (
    <PlanInfoBox
      title="本次计划说明"
      items={[
        "这里列出即将执行的文件系统动作；执行前请确认源、目标和备份位置。",
        exampleText,
      ]}
      details={[]}
    />
  );
}

function PlanInfoBox({
  title,
  items,
  details,
}: {
  title: string;
  items: string[];
  details: Array<string | null>;
}) {
  const visibleDetails = details.filter(Boolean) as string[];
  return (
    <div className="mb-4 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-950">
      <div className="mb-2 font-semibold">{title}</div>
      <div className="space-y-1 leading-5">
        {items.map((item, index) => (
          <div key={`item-${index}`}>{item}</div>
        ))}
      </div>
      {visibleDetails.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-blue-100 pt-2 text-blue-900">
          {visibleDetails.map((item, index) => (
            <div key={`detail-${index}`}>{item}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function countPlanActions(plan: ActionPlan) {
  return plan.actions.reduce<Record<string, number>>((counts, action) => {
    counts[action.kind] = (counts[action.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function PathCell({
  value,
  children,
  compact,
}: {
  value: string;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div
        className={cx(
          "path-cell min-w-0 text-xs text-slate-600",
          compact ? "shrink" : "shrink",
        )}
        title={value}
      >
        {value}
      </div>
      {children}
    </div>
  );
}

function MappingRootSourceCell({
  mappingRoot,
  onOpen,
  onScanMappingRoot,
}: {
  mappingRoot: LinkSettings["mappingRoots"][number];
  onOpen: (path: string) => Promise<unknown>;
  onScanMappingRoot: (id: string) => Promise<void>;
}) {
  return (
    <div className="min-w-0 space-y-1 text-xs">
      <div className="font-semibold text-slate-600">Mapping Root</div>
      <div className="truncate text-slate-700" title={mappingRoot.resolvedSource}>
        {mappingRoot.resolvedSource}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-slate-400">源目录</span>
        <InlineIconButton title="打开 Mapping Root 源目录" onClick={() => onOpen(mappingRoot.resolvedSource)}>
          <ExternalLink size={15} />
        </InlineIconButton>
        <InlineIconButton
          title="扫描此 Mapping Root 源目录下的目录和文件变化"
          onClick={() => onScanMappingRoot(mappingRoot.id)}
        >
          <FolderSearch size={15} />
        </InlineIconButton>
      </div>
    </div>
  );
}

function MappingRootTargetCell({
  mappingRoot,
  onOpen,
}: {
  mappingRoot: LinkSettings["mappingRoots"][number];
  onOpen: (path: string) => Promise<unknown>;
}) {
  return (
    <div className="min-w-0 space-y-1 text-xs">
      <div className="truncate text-slate-700" title={mappingRoot.resolvedTarget}>
        {mappingRoot.resolvedTarget}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-slate-400">目标目录</span>
        <InlineIconButton title="打开 Mapping Root 目标文件夹" onClick={() => onOpen(mappingRoot.resolvedTarget)}>
          <FolderOpen size={15} />
        </InlineIconButton>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {children}
      <span className="text-xs leading-4 text-slate-500">{hint}</span>
    </label>
  );
}

function PathLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[52px_1fr] gap-2">
      <span className="font-medium text-slate-500">{label}</span>
      <span className="truncate" title={value}>{value}</span>
    </div>
  );
}

function CreateTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx(
        "border-b-2 px-4 py-2 text-sm font-semibold transition",
        active
          ? "border-primary text-primary"
          : "border-transparent text-slate-500 hover:text-slate-800",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function InlineIconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SidebarActivityLog({
  groups,
  onClear,
}: {
  groups: ActivityGroup[];
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState<ExpandedActivity>(() => ({
    groups: new Set(),
    entries: new Set(),
  }));
  const latestGroups = groups.slice(0, 8);

  useEffect(() => {
    setExpanded((prev) => {
      const nextGroups = new Set(prev.groups);
      if (groups[0]) nextGroups.add(groups[0].id);
      for (const id of Array.from(nextGroups)) {
        if (!groups.some((group) => group.id === id)) nextGroups.delete(id);
      }
      const allEntryIds = new Set(groups.flatMap((group) => group.entries.map((entry) => entry.id)));
      const nextEntries = new Set(Array.from(prev.entries).filter((id) => allEntryIds.has(id)));
      return { groups: nextGroups, entries: nextEntries };
    });
  }, [groups]);

  function toggleGroup(id: string) {
    setExpanded((prev) => {
      const groups = new Set(prev.groups);
      if (groups.has(id)) groups.delete(id);
      else groups.add(id);
      return { ...prev, groups };
    });
  }

  function toggleEntry(id: string) {
    setExpanded((prev) => {
      const entries = new Set(prev.entries);
      if (entries.has(id)) entries.delete(id);
      else entries.add(id);
      return { ...prev, entries };
    });
  }

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-800 bg-slate-900">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-100">实时运行日志</div>
          <div className="text-[11px] text-slate-400">{groups.length} 个任务</div>
        </div>
        <button
          type="button"
          className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
          disabled={groups.length === 0}
          onClick={onClear}
        >
          清空
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {groups.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            暂无实时日志
          </div>
        ) : (
          latestGroups.map((group) => {
            const groupExpanded = expanded.groups.has(group.id);
            const entries = group.entries;
            return (
              <div key={group.id} className="border-b border-slate-800 p-2 last:border-b-0">
                <button
                  type="button"
                  className="mb-1 flex w-full min-w-0 items-center gap-2 text-left"
                  onClick={() => toggleGroup(group.id)}
                  title={groupExpanded ? "折叠任务" : "展开任务"}
                >
                  {groupExpanded ? (
                    <ChevronDown className="shrink-0 text-slate-400" size={14} />
                  ) : (
                    <ChevronRight className="shrink-0 text-slate-400" size={14} />
                  )}
                  <span className={cx("h-2 w-2 shrink-0 rounded-full", activityDotClass(group.status))} />
                  <span className="min-w-0 truncate text-xs font-medium text-slate-100">{group.title}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">{group.startedAt}</span>
                </button>
                {groupExpanded && (
                  <div className="space-y-1 border-l border-slate-700 pl-2">
                    {entries.map((entry) => {
                      const hasDetails = !!entry.detail || !!entry.details?.length;
                      const entryExpanded = expanded.entries.has(entry.id);
                      return (
                        <div key={entry.id} className="text-[11px] leading-4">
                          <button
                            type="button"
                            className="flex w-full min-w-0 items-center gap-1 text-left"
                            onClick={() => hasDetails && toggleEntry(entry.id)}
                            disabled={!hasDetails}
                            title={hasDetails ? (entryExpanded ? "折叠步骤详情" : "展开步骤详情") : undefined}
                          >
                            {hasDetails ? (
                              entryExpanded ? (
                                <ChevronDown className="shrink-0 text-slate-500" size={12} />
                              ) : (
                                <ChevronRight className="shrink-0 text-slate-500" size={12} />
                              )
                            ) : (
                              <span className="w-3 shrink-0" />
                            )}
                            <span className="shrink-0 text-slate-500">{entry.time}</span>
                            <span className={cx("shrink-0", activityTextClass(entry.status))}>
                              {activityLabel(entry.status)}
                            </span>
                            <span className="min-w-0 truncate text-slate-300">{entry.message}</span>
                          </button>
                          {entryExpanded && hasDetails && (
                            <div className="ml-3 mt-1 space-y-1 border-l border-slate-800 pl-2 text-slate-500">
                              {entry.detail && <div className="break-words">{entry.detail}</div>}
                              {entry.details?.map((detail, index) => (
                                <div key={`${entry.id}-detail-${index}`} className="break-words">
                                  {detail}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function activityTone(status: ActivityStatus): "green" | "yellow" | "red" | "blue" | "gray" {
  if (status === "success") return "green";
  if (status === "error") return "red";
  if (status === "running") return "yellow";
  return "blue";
}

function activityLabel(status: ActivityStatus) {
  if (status === "success") return "成功";
  if (status === "error") return "错误";
  if (status === "running") return "进行中";
  return "信息";
}

function activityDotClass(status: ActivityStatus) {
  if (status === "success") return "bg-green-400";
  if (status === "error") return "bg-red-400";
  if (status === "running") return "bg-amber-400";
  return "bg-blue-400";
}

function activityTextClass(status: ActivityStatus) {
  if (status === "success") return "text-green-300";
  if (status === "error") return "text-red-300";
  if (status === "running") return "text-amber-300";
  return "text-blue-300";
}

function PreviewPanel({ preview }: { preview: TextPreview | null }) {
  return (
    <Panel className="flex min-h-[70vh] flex-col overflow-hidden">
      <div className="border-b border-line bg-slate-100 px-3 py-2 text-sm font-semibold">
        预览
      </div>
      <div className="border-b border-line px-3 py-2 text-xs text-slate-500">
        {preview?.path ?? "未选择"}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#0f172a] p-3 text-xs leading-5 text-slate-100">
        <pre>{preview?.content ?? ""}</pre>
      </div>
      {preview?.truncated && (
        <div className="border-t border-line bg-amber-50 px-3 py-2 text-xs text-amber-800">
          内容已截断
        </div>
      )}
    </Panel>
  );
}

function formatBytes(value?: number | null) {
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value?: number | null) {
  if (!value) return "";
  return new Date(value * 1000).toLocaleString();
}
