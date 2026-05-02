import type { SidecarTask, TaskRunResult } from "../shared/contracts.js";
import { emitTaskProgress, type SidecarLogger } from "../shared/logger.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";
import type { CookiePoolService } from "./cookie-pool.js";
import type { DownloaderService } from "./downloader.js";
import type { MatcherService } from "./matcher.js";
import type { FileTaskControl } from "./task-control.js";

interface SchedulerDependencies {
  cookiePool: CookiePoolService;
  matcher: MatcherService;
  downloader: DownloaderService;
  taskControl: FileTaskControl;
}

export class SchedulerService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly deps: SchedulerDependencies,
    private readonly logger: SidecarLogger,
  ) {}

  async warmup() {
    this.logger.info(
      `scheduler warmup complete: batch=${this.config.batchSize}, concurrency=${this.config.concurrency}`,
    );
  }

  async shutdown() {
    this.logger.info("scheduler shutdown complete");
  }

  async runTask(task: SidecarTask): Promise<TaskRunResult> {
    this.logger.info(`task queued: ${task.detailUrl}`, task.id);
    await this.deps.taskControl.assertNotPaused();

    const discovery = await this.deps.matcher.discover(task);
    await this.deps.taskControl.assertNotPaused();
    emitTaskProgress(task.id, "downloading", discovery.images.length, 0);

    const cookieHeader = this.deps.cookiePool.getCookieHeader(discovery.source);
    const download = await this.deps.downloader.download(task, discovery, cookieHeader, this.deps.taskControl);
    this.logger.info(`task finished: ${download.saved.length} files -> ${download.outputDir}`, task.id);
    return {
      discovery,
      download,
    };
  }
}
