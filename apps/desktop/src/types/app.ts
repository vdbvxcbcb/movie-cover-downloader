export type StatusTone = "good" | "warn" | "danger" | "neutral";

export type LogLevel = "INFO" | "WARN" | "ERROR";
export type SourceSite = "douban" | "impawards";
export type SourceHint = "auto" | SourceSite;
export type OutputImageFormat = "jpg" | "png";
export type DoubanAssetType = "still" | "poster" | "wallpaper";
export type ImageCountMode = "limited" | "unlimited";
export type RequestIntervalSeconds = 1 | 2 | 3 | 4 | 5;
export type CookieImportMode = "login" | "manual";
export type AssetCategory = "poster" | "still";
export type AssetOrientation = "vertical" | "horizontal";
export type TaskPhase =
  | "queued"
  | "resolving"
  | "discovering"
  | "downloading"
  | "pausing"
  | "paused"
  | "completed"
  | "failed"
  | "retrying";
export type CookieStatus = "active" | "cooling" | "testing";

export interface TopAction {
  id: string;
  label: string;
  variant?: "primary" | "ghost";
  size?: "md" | "sm";
}

export interface NavItem {
  label: string;
  to: string;
  eyebrow: string;
}

export interface TaskTarget {
  detailUrl: string;
  outputRootDir: string;
  sourceHint: SourceHint;
  doubanAssetType: DoubanAssetType;
  imageCountMode: ImageCountMode;
  maxImages: number;
  outputImageFormat: OutputImageFormat;
  requestIntervalSeconds: RequestIntervalSeconds;
}

export interface SourceDetectionSnapshot {
  site: SourceSite;
  confidence: number;
  reason: string;
  detailUrl: string;
  imagePageUrl: string;
}

export interface DiscoveredAsset {
  id: string;
  source: SourceSite;
  title: string;
  imageUrl: string;
  pageUrl?: string;
  category: AssetCategory;
  orientation: AssetOrientation;
  width?: number;
  height?: number;
  extension?: string;
}

export interface DiscoverySnapshot {
  discovered: DiscoveredAsset[];
  posterCount: number;
  stillCount: number;
  verticalCount: number;
  horizontalCount: number;
}

export interface DownloadSnapshot {
  savedCount: number;
  targetCount: number;
  directory: string;
  files: string[];
}

export interface TaskLifecycle {
  phase: TaskPhase;
  attempts: number;
  updatedAt: string;
  cooldownUntil?: string;
  lastError?: string;
}

// 任务实体围绕“详情页链接 -> 图片页 -> 输出目录”主链路组织。
export interface TaskItem {
  id: string;
  title: string;
  target: TaskTarget;
  lifecycle: TaskLifecycle;
  summary: string;
  detection?: SourceDetectionSnapshot;
  discovery?: DiscoverySnapshot;
  download?: DownloadSnapshot;
  outputFolderName?: string;
  outputDirectory?: string;
}

export interface CookieProfile {
  id: string;
  source: SourceSite;
  status: CookieStatus;
  success: number;
  failure: number;
  coolingUntil?: string;
  note: string;
  value?: string;
  importedAt?: string;
  expiresAt?: string;
}

export interface LogEntry {
  id: number;
  level: LogLevel;
  scope: string;
  timestamp: string;
  message: string;
  taskId?: string;
}

export interface NoticePayload {
  message: string;
  tone: "info" | "success" | "warn";
}

export interface QueueConfig {
  batchSize: number;
  concurrency: number;
  failureCooldownMs: number;
  maxAttempts: number;
}

export interface TaskDraft {
  detailUrl: string;
  outputRootDir: string;
  sourceHint: SourceHint;
  doubanAssetType: DoubanAssetType;
  imageCountMode: ImageCountMode;
  maxImages: number;
  outputImageFormat: OutputImageFormat;
  requestIntervalSeconds: RequestIntervalSeconds;
}

export interface CookieDraft {
  value: string;
  note: string;
}

export interface DoubanLoginImportStatus {
  state: "pending" | "ready" | "closed";
  cookieValue?: string;
}

export interface AppSeedState {
  schemaVersion: number;
  tasks: TaskItem[];
  cookies: CookieProfile[];
  logs: LogEntry[];
  queueConfig: QueueConfig;
}

export interface RuntimeDiscoveredAsset {
  id: string;
  source: SourceSite;
  title: string;
  imageUrl: string;
  pageUrl?: string;
  category: AssetCategory;
  orientation: AssetOrientation;
  width?: number;
  height?: number;
}

export interface RuntimeDownloadedAsset {
  sourceUrl: string;
  outputPath: string;
  category: AssetCategory;
  orientation: AssetOrientation;
  width?: number;
  height?: number;
}

export interface RuntimeDownloadTaskPayload {
  taskId: string;
  detailUrl: string;
  outputRootDir: string;
  sourceHint: SourceHint;
  doubanAssetType: DoubanAssetType;
  imageCountMode: ImageCountMode;
  maxImages: number;
  outputImageFormat: OutputImageFormat;
  requestIntervalSeconds: RequestIntervalSeconds;
  doubanCookie?: string;
}

export interface RuntimeDownloadTaskResult {
  discovery: {
    source: SourceSite;
    detailUrl: string;
    imagePageUrl: string;
    normalizedTitle: string;
    outputFolderName: string;
    outputDir: string;
    images: RuntimeDiscoveredAsset[];
  };
  download: {
    outputDir: string;
    saved: RuntimeDownloadedAsset[];
    source: SourceSite;
  };
}

export interface RuntimeTaskProgressEvent {
  taskId: string;
  phase: TaskPhase;
  targetCount: number;
  savedCount: number;
  timestamp: string;
}

export interface CookieMutation {
  id: string;
  status?: CookieStatus;
  coolingUntil?: string | null;
  successDelta?: number;
  failureDelta?: number;
}

export interface TaskRuntimeFrame {
  task: TaskItem;
  cookieMutations?: CookieMutation[];
}
