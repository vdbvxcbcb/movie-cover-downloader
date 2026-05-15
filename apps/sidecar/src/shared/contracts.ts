// sidecar 与 Tauri/前端共享的数据契约：描述任务、发现结果、下载结果和进度阶段。
export type LogLevel = "INFO" | "WARN" | "ERROR";
export type SourceSite = "douban";
export type SourceHint = "auto" | SourceSite;
export type OutputImageFormat = "jpg" | "png";
export type ImageAspectRatio = "original" | "9:16" | "3:4";
export type AssetCategory = "poster" | "still";
export type AssetOrientation = "vertical" | "horizontal";
export type DoubanAssetType = "still" | "poster" | "wallpaper";
export type ImageCountMode = "limited" | "unlimited";
export type TaskPhase = "queued" | "resolving" | "discovering" | "downloading" | "completed" | "failed" | "retrying";

// Tauri 传给 sidecar 的任务契约，描述一次下载需要的全部参数。
export interface SidecarTask {
  id: string;
  detailUrl: string;
  outputRootDir: string;
  sourceHint: SourceHint;
  doubanAssetType: DoubanAssetType;
  imageCountMode: ImageCountMode;
  maxImages: number;
  outputImageFormat: OutputImageFormat;
  imageAspectRatio: ImageAspectRatio;
  requestIntervalMs: number;
  phase: TaskPhase;
  attempts: number;
}

// 豆瓣搜索列表中的单个影片条目，只保留弹窗展示需要的信息，不返回评分字段。
export interface DoubanSearchResultItem {
  id: string;
  title: string;
  description: string;
  coverUrl?: string;
  coverDataUrl?: string;
  detailUrl: string;
}

// 豆瓣搜索分页结果；pageSize 对应豆瓣搜索页每页返回数量。
export interface DoubanSearchResultPage {
  query: string;
  page: number;
  pageSize: number;
  total: number;
  items: DoubanSearchResultItem[];
}
// 详情页解析后的来源信息，包含规范化标题、图片页 URL 和解析可信度。
export interface ResolvedSource {
  source: SourceSite;
  detailUrl: string;
  imagePageUrl: string;
  title: string;
  confidence: number;
  reason: string;
}

// 单张待下载图片的发现结果，保存图片 URL、来源页面、分类和可选尺寸。
export interface DiscoveredImage {
  id: string;
  source: SourceSite;
  title: string;
  imageUrl: string;
  previewUrl?: string;
  previewDataUrl?: string;
  pageUrl?: string;
  category: AssetCategory;
  doubanAssetType?: DoubanAssetType;
  orientation: AssetOrientation;
  width?: number;
  height?: number;
}

// 适配器发现阶段的完整输出，下载服务会按 images 顺序逐张保存。
export interface DiscoveryResult {
  source: SourceSite;
  detailUrl: string;
  imagePageUrl: string;
  normalizedTitle: string;
  outputFolderName: string;
  outputDir: string;
  images: DiscoveredImage[];
}

// 单张图片保存后的结果，记录源 URL、输出路径、分类、方向和最终尺寸。
export interface DownloadedImage {
  sourceUrl: string;
  outputPath: string;
  category: AssetCategory;
  orientation: AssetOrientation;
  width?: number;
  height?: number;
}

// 下载阶段返回给调度器的结果，包含输出目录和所有成功保存的图片。
export interface DownloadResult {
  outputDir: string;
  saved: DownloadedImage[];
  source: SourceSite;
}

// 调度器最终返回给 Tauri 的任务结果，前端据此把队列任务标记为完成。
export interface TaskRunResult {
  discovery: DiscoveryResult;
  download: DownloadResult;
}

// sidecar 输出到 stdout 的结构化日志事件。
export interface SidecarLogEvent {
  level: LogLevel;
  scope: string;
  timestamp: number;
  message: string;
  taskId?: string;
}

// sidecar 输出到 stdout 的实时进度事件。
export interface SidecarTaskProgressEvent {
  kind: "task-progress";
  taskId: string;
  phase: TaskPhase;
  targetCount: number;
  savedCount: number;
  timestamp: number;
}

// sidecar 输出到 stdout 的最终任务结果事件。
export interface SidecarTaskEvent {
  taskId: string;
  phase: TaskPhase;
  message: string;
  attempt: number;
  timestamp: number;
}

// 任务控制接口，下载流程只关心“现在是否应该暂停或取消”。
export interface SidecarTaskControl {
  taskId: string;
  action: "pause" | "resume" | "cancel";
}
