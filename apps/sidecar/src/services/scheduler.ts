// sidecar 调度服务：串联 Cookie、匹配、下载和任务控制。
import type { SidecarTask, TaskRunResult } from "../shared/contracts.js";
import { emitTaskProgress, type SidecarLogger } from "../shared/logger.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";
import type { CookiePoolService } from "./cookie-pool.js";
import type { DownloaderService } from "./downloader.js";
import type { MatcherService } from "./matcher.js";
import type { FileTaskControl } from "./task-control.js";

// 调度器依赖项集合，便于测试替换，也让下载、匹配、Cookie 和控制职责分开。
interface SchedulerDependencies {
  cookiePool: CookiePoolService;
  matcher: MatcherService;
  downloader: DownloaderService;
  taskControl: FileTaskControl;
}

// 调度器是 sidecar 的编排层：预热 Cookie、解析图片列表、下载图片并输出任务结果。
// sidecar 调度器负责把单个任务从“解析来源”推进到“发现图片”和“下载完成”。
export class SchedulerService {
    // 构造时注入运行配置和各服务实例，调度器本身不直接关心底层实现。
constructor(
    private readonly config: RuntimeConfig,
    private readonly deps: SchedulerDependencies,
    private readonly logger: SidecarLogger,
  ) {}

  // sidecar 启动预热钩子，目前只记录日志，保留给后续浏览器或网络预热扩展。
  async warmup() {
    this.logger.info(
      `scheduler warmup complete: batch=${this.config.batchSize}, concurrency=${this.config.concurrency}`,
    );
  }

  // sidecar 退出前的清理钩子，目前只记录日志，便于排查进程生命周期。
  async shutdown() {
    this.logger.info("scheduler shutdown complete");
  }

  // 执行单个任务：检查控制状态、发现图片、下载图片，并组装返回给 Tauri 的结果。
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
