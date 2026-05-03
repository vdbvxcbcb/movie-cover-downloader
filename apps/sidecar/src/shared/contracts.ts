export type LogLevel = "INFO" | "WARN" | "ERROR";
export type SourceSite = "douban";
export type SourceHint = "auto" | SourceSite;
export type OutputImageFormat = "jpg" | "png";
export type AssetCategory = "poster" | "still";
export type AssetOrientation = "vertical" | "horizontal";
export type DoubanAssetType = "still" | "poster" | "wallpaper";
export type ImageCountMode = "limited" | "unlimited";
export type TaskPhase = "queued" | "resolving" | "discovering" | "downloading" | "completed" | "failed" | "retrying";

export interface SidecarTask {
  id: string;
  detailUrl: string;
  outputRootDir: string;
  sourceHint: SourceHint;
  doubanAssetType: DoubanAssetType;
  imageCountMode: ImageCountMode;
  maxImages: number;
  outputImageFormat: OutputImageFormat;
  requestIntervalMs: number;
  phase: TaskPhase;
  attempts: number;
}

export interface ResolvedSource {
  source: SourceSite;
  detailUrl: string;
  imagePageUrl: string;
  title: string;
  confidence: number;
  reason: string;
}

export interface DiscoveredImage {
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

export interface DiscoveryResult {
  source: SourceSite;
  detailUrl: string;
  imagePageUrl: string;
  normalizedTitle: string;
  outputFolderName: string;
  outputDir: string;
  images: DiscoveredImage[];
}

export interface DownloadedImage {
  sourceUrl: string;
  outputPath: string;
  category: AssetCategory;
  orientation: AssetOrientation;
  width?: number;
  height?: number;
}

export interface DownloadResult {
  outputDir: string;
  saved: DownloadedImage[];
  source: SourceSite;
}

export interface TaskRunResult {
  discovery: DiscoveryResult;
  download: DownloadResult;
}

export interface SidecarLogEvent {
  level: LogLevel;
  scope: string;
  timestamp: number;
  message: string;
  taskId?: string;
}

export interface SidecarTaskProgressEvent {
  kind: "task-progress";
  taskId: string;
  phase: TaskPhase;
  targetCount: number;
  savedCount: number;
  timestamp: number;
}

export interface SidecarTaskEvent {
  taskId: string;
  phase: TaskPhase;
  message: string;
  attempt: number;
  timestamp: number;
}

export interface SidecarTaskControl {
  taskId: string;
  action: "pause" | "resume" | "cancel";
}
