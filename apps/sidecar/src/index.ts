// sidecar 入口：读取环境变量创建一次性下载任务，并驱动调度器执行。
import fs from "node:fs";
import path from "node:path";
import { CookiePoolService } from "./services/cookie-pool.js";
import { DownloaderService } from "./services/downloader.js";
import { MatcherService } from "./services/matcher.js";
import { SchedulerService } from "./services/scheduler.js";
import { searchDoubanMovies } from "./services/douban-search.js";
import { resolveDoubanMovieTitle } from "./services/douban-title.js";
import { CancelRequestedError, FileTaskControl, PauseRequestedError } from "./services/task-control.js";
import { createLogger, emitTaskProgress } from "./shared/logger.js";
import { createRuntimeConfig, formatRuntimeConfig } from "./shared/runtime-config.js";
import type {
  DiscoveredImage,
  DiscoveryResult,
  DoubanPhotoDiscoveryCursor,
  SidecarTask,
} from "./shared/contracts.js";
import { buildOutputDir, buildOutputFolderName, formatDirectoryImageAspectRatio } from "./utils/output-folder.js";

// sidecar 参数全部来自环境变量，入口层先做白名单解析，避免非法值进入下载流程。
// 解析输出图片格式环境变量；未传时使用 jpg，传入非法值时立即失败，避免下载阶段才暴露配置错误。
function parseOutputImageFormat(
  value: string | undefined,
  variableName: string,
): SidecarTask["outputImageFormat"] {
  if (value === undefined) {
    return "jpg";
  }

  if (value === "jpg" || value === "png") {
    return value;
  }

  throw new Error(`invalid ${variableName}: "${value}", expected "jpg" or "png"`);
}

// 解析豆瓣图片分类；只允许剧照、海报、壁纸三类，和前端按钮选项保持一致。
function parseDoubanAssetType(value: string | undefined): SidecarTask["doubanAssetType"] {
  if (value === undefined) {
    return "still";
  }

  if (value === "still" || value === "poster" || value === "wallpaper") {
    return value;
  }

  throw new Error(`invalid MCD_DOUBAN_ASSET_TYPE: "${value}", expected still/poster/wallpaper`);
}

// 解析数量模式；limited 会使用 maxImages，unlimited 会让适配器返回发现到的全部图片。
function parseImageCountMode(value: string | undefined): SidecarTask["imageCountMode"] {
  if (value === undefined) {
    return "limited";
  }

  if (value === "limited" || value === "unlimited") {
    return value;
  }

  throw new Error(`invalid MCD_IMAGE_COUNT_MODE: "${value}", expected limited/unlimited`);
}


// 解析图片比例策略；original 保留原图，9:16 和 3:4 会在下载保存前居中裁剪。
function parseImageAspectRatio(value: string | undefined): SidecarTask["imageAspectRatio"] {
  if (value === undefined) {
    return "original";
  }

  if (value === "original" || value === "9:16" || value === "3:4") {
    return value;
  }

  throw new Error(`invalid MCD_IMAGE_ASPECT_RATIO: "${value}", expected original/9:16/3:4`);
}
// Tauri 每次执行任务都会通过环境变量注入一条 bootstrap 任务；没有任务时 sidecar 只启动后退出空闲。
// 根据 Tauri 注入的 MCD_BOOTSTRAP_* 环境变量创建一次性任务；没有 URL 时返回 null，sidecar 只启动后空闲退出。
function createBootstrapTask(configOutputDir: string): SidecarTask | null {
  const detailUrl = process.env.MCD_BOOTSTRAP_TASK_URL;
  if (!detailUrl) {
    return null;
  }

  const requestIntervalMs = Number(
    process.env.MCD_BOOTSTRAP_REQUEST_INTERVAL_MS ?? process.env.MCD_REQUEST_INTERVAL_MS ?? 1000,
  );

  return {
    id: process.env.MCD_BOOTSTRAP_TASK_ID ?? "bootstrap-url-task",
    detailUrl,
    outputRootDir: process.env.MCD_BOOTSTRAP_OUTPUT_DIR ?? configOutputDir,
    sourceHint: (process.env.MCD_BOOTSTRAP_SOURCE_HINT as SidecarTask["sourceHint"] | undefined) ?? "auto",
    doubanAssetType: parseDoubanAssetType(process.env.MCD_DOUBAN_ASSET_TYPE),
    imageCountMode: parseImageCountMode(process.env.MCD_IMAGE_COUNT_MODE),
    maxImages: Number(process.env.MCD_BOOTSTRAP_MAX_IMAGES ?? 50),
    outputImageFormat: parseOutputImageFormat(
      process.env.MCD_BOOTSTRAP_OUTPUT_FORMAT,
      "MCD_BOOTSTRAP_OUTPUT_FORMAT",
    ),
    imageAspectRatio: parseImageAspectRatio(process.env.MCD_IMAGE_ASPECT_RATIO),
    requestIntervalMs,
    phase: "queued",
    attempts: 0,
  };
}

// 搜索模式只负责返回豆瓣电影搜索结果，不启动下载调度器，避免影响队列任务。
async function runDoubanSearchCommand(config: ReturnType<typeof createRuntimeConfig>) {
  const query = process.env.MCD_SEARCH_QUERY ?? "";
  const page = Number(process.env.MCD_SEARCH_PAGE ?? 1);
  const pageSize = Number(process.env.MCD_SEARCH_PAGE_SIZE ?? 15);
  const result = await searchDoubanMovies(query, { config, page, pageSize });
  process.stdout.write(`${JSON.stringify({ kind: "douban-search-result", payload: result })}\n`);
}

function createRequiredBootstrapTask(configOutputDir: string): SidecarTask {
  const task = createBootstrapTask(configOutputDir);
  if (!task) {
    throw new Error("missing douban photo task url");
  }

  return task;
}

function buildSelectedOutputDir(rootDir: string, outputFolderName: string, imageAspectRatio: SidecarTask["imageAspectRatio"]) {
  return path.join(
    buildOutputDir(rootDir, outputFolderName),
    "selected",
    `selected-${formatDirectoryImageAspectRatio(imageAspectRatio)}`,
  );
}

function normalizeDoubanSubjectUrl(value: string) {
  const match = value.match(/(https:\/\/movie\.douban\.com\/subject\/\d+)/i);
  return match ? `${match[1]}/` : value;
}

function parseDiscoveryCursor(): DoubanPhotoDiscoveryCursor | null {
  const raw = process.env.MCD_DISCOVERY_CURSOR;
  if (!raw) return null;
  const parsed = JSON.parse(raw) as DoubanPhotoDiscoveryCursor;
  if (!Number.isFinite(parsed.assetIndex) || !Number.isFinite(parsed.pageIndex)) {
    return null;
  }
  return {
    assetIndex: Math.max(0, Number(parsed.assetIndex)),
    pageIndex: Math.max(0, Number(parsed.pageIndex)),
    withinPageOffset: Math.max(0, Number(parsed.withinPageOffset ?? 0)),
    normalizedTitle: parsed.normalizedTitle,
    outputFolderName: parsed.outputFolderName,
  };
}

function parseSelectedImages(): DiscoveredImage[] {
  const payloadFile = process.env.MCD_SELECTED_IMAGES_FILE;
  const raw = payloadFile ? fs.readFileSync(payloadFile, "utf8") : process.env.MCD_SELECTED_IMAGES;
  if (!raw) {
    throw new Error("missing selected images payload");
  }

  const parsed = JSON.parse(raw) as DiscoveredImage[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("selected images payload is empty");
  }

  return parsed.map((image, index) => ({
    ...image,
    id: image.id || `selected-${index + 1}`,
    source: "douban",
  }));
}

// 片名解析模式只解析单个豆瓣详情页标题，供前端把纯链接展示成“片名：链接”。
async function runDoubanTitleCommand(config: ReturnType<typeof createRuntimeConfig>) {
  const detailUrl = process.env.MCD_TITLE_DETAIL_URL ?? "";
  const result = await resolveDoubanMovieTitle(detailUrl, { config });
  process.stdout.write(`${JSON.stringify({ kind: "douban-title-result", payload: result })}\n`);
}

async function runDoubanPhotosDiscoverCommand(
  config: ReturnType<typeof createRuntimeConfig>,
  matcher: MatcherService,
) {
  const task = createRequiredBootstrapTask(config.outputDir);
  const discovery = await matcher.discoverDoubanPhotoBatch(
    task,
    parseDiscoveryCursor(),
    Number(process.env.MCD_DISCOVERY_BATCH_SIZE ?? 28),
    { includePreviewDataUrl: true },
  );
  process.stdout.write(`${JSON.stringify({
    kind: "douban-photos-discover-result",
    payload: discovery,
  })}\n`);
}

async function runDoubanSelectedDownloadCommand(
  config: ReturnType<typeof createRuntimeConfig>,
  downloader: DownloaderService,
  cookiePool: CookiePoolService,
  taskControl: FileTaskControl,
) {
  const task = createRequiredBootstrapTask(config.outputDir);
  const selectedImages = parseSelectedImages();
  const selectedTitle = process.env.MCD_SELECTED_TITLE?.trim() || selectedImages[0]?.title || "Douban Selected Photos";
  const outputFolderName = buildOutputFolderName(selectedTitle);
  const detailUrl = normalizeDoubanSubjectUrl(task.detailUrl);
  const discovery: DiscoveryResult = {
    source: "douban",
    detailUrl,
    imagePageUrl: `${detailUrl}all_photos`,
    normalizedTitle: selectedTitle,
    outputFolderName,
    outputDir: buildSelectedOutputDir(task.outputRootDir, outputFolderName, task.imageAspectRatio),
    images: selectedImages,
  };
  const cookieHeader = cookiePool.getCookieHeader("douban");
  emitTaskProgress(task.id, "downloading", discovery.images.length, 0);
  const download = await downloader.download(task, discovery, cookieHeader, taskControl);
  process.stdout.write(`${JSON.stringify({ kind: "task-result", payload: { discovery, download } })}\n`);
}
// 主流程组装 Cookie 池、匹配器、下载器和调度器，然后执行一次性任务并把结果写回 stdout。
// sidecar 主入口：组装配置、Cookie 池、匹配器、下载器和调度器，并把最终结果输出给 Tauri。
async function main() {
  const logger = createLogger("bootstrap");
  const config = createRuntimeConfig();
  if (process.env.MCD_COMMAND === "douban-search") {
    await runDoubanSearchCommand(config);
    return;
  }

  if (process.env.MCD_COMMAND === "douban-title") {
    await runDoubanTitleCommand(config);
    return;
  }

  const cookiePool = new CookiePoolService(config, createLogger("cookie-pool"));
  const matcher = new MatcherService(config, cookiePool, createLogger("discoverer"));
  const downloader = new DownloaderService(config, createLogger("downloader"));
  const taskControl = new FileTaskControl(process.env.MCD_TASK_CONTROL_FILE);
  if (process.env.MCD_COMMAND === "douban-photos-discover") {
    await runDoubanPhotosDiscoverCommand(config, matcher);
    return;
  }

  if (process.env.MCD_COMMAND === "douban-selected-download") {
    await runDoubanSelectedDownloadCommand(config, downloader, cookiePool, taskControl);
    return;
  }

  const scheduler = new SchedulerService(
    config,
    {
      cookiePool,
      matcher,
      downloader,
      taskControl,
    },
    createLogger("scheduler"),
  );

  logger.info(`sidecar ready: ${formatRuntimeConfig(config)}`);
  logger.info("real url-driven fetch is enabled for douban detail pages");

  process.on("SIGINT", async () => {
    logger.warn("received SIGINT, shutting down sidecar");
    await scheduler.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.warn("received SIGTERM, shutting down sidecar");
    await scheduler.shutdown();
    process.exit(0);
  });

  await scheduler.warmup();

  const bootstrapTask = createBootstrapTask(config.outputDir);
  if (bootstrapTask) {
    let result;
    try {
      result = await scheduler.runTask(bootstrapTask);
    } catch (error) {
      if (error instanceof CancelRequestedError) {
        logger.warn("task cancelled by user");
        process.stdout.write(`${JSON.stringify({ kind: "task-cancelled", message: error.message })}\n`);
        return;
      }
      if (error instanceof PauseRequestedError) {
        logger.warn("task paused by user");
        process.stdout.write(`${JSON.stringify({ kind: "task-paused", message: error.message })}\n`);
        return;
      }
      throw error;
    }
    process.stdout.write(`${JSON.stringify({ kind: "task-result", payload: result })}\n`);
  } else {
    logger.info("no bootstrap task url provided; scheduler is idle");
  }
}

void main().catch((error) => {
  const logger = createLogger("bootstrap");
  logger.error(`sidecar command failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
