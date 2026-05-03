import { CookiePoolService } from "./services/cookie-pool.js";
import { DownloaderService } from "./services/downloader.js";
import { MatcherService } from "./services/matcher.js";
import { SchedulerService } from "./services/scheduler.js";
import { CancelRequestedError, FileTaskControl, PauseRequestedError } from "./services/task-control.js";
import { createLogger } from "./shared/logger.js";
import { createRuntimeConfig, formatRuntimeConfig } from "./shared/runtime-config.js";
import type { SidecarTask } from "./shared/contracts.js";

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

function parseDoubanAssetType(value: string | undefined): SidecarTask["doubanAssetType"] {
  if (value === undefined) {
    return "still";
  }

  if (value === "still" || value === "poster" || value === "wallpaper") {
    return value;
  }

  throw new Error(`invalid MCD_DOUBAN_ASSET_TYPE: "${value}", expected still/poster/wallpaper`);
}

function parseImageCountMode(value: string | undefined): SidecarTask["imageCountMode"] {
  if (value === undefined) {
    return "limited";
  }

  if (value === "limited" || value === "unlimited") {
    return value;
  }

  throw new Error(`invalid MCD_IMAGE_COUNT_MODE: "${value}", expected limited/unlimited`);
}

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
    requestIntervalMs,
    phase: "queued",
    attempts: 0,
  };
}

async function main() {
  const logger = createLogger("bootstrap");
  const config = createRuntimeConfig();

  const cookiePool = new CookiePoolService(config, createLogger("cookie-pool"));
  const matcher = new MatcherService(config, cookiePool, createLogger("discoverer"));
  const downloader = new DownloaderService(config, createLogger("downloader"));
  const taskControl = new FileTaskControl(process.env.MCD_TASK_CONTROL_FILE);
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
  logger.error(`sidecar failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
