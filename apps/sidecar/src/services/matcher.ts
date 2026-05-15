// 匹配服务：根据任务来源选择站点适配器，并产出可下载图片列表。
import { DoubanAdapter } from "../adapters/douban.js";
import type { DiscoveryResult, SidecarTask } from "../shared/contracts.js";
import type { SidecarLogger } from "../shared/logger.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";
import type { CookiePoolService } from "./cookie-pool.js";

export interface DiscoverOptions {
  onImagesDiscovered?: Parameters<DoubanAdapter["discover"]>[1]["onImagesDiscovered"];
  includePreviewDataUrl?: boolean;
}

// 匹配服务只负责选适配器和输出目录，不直接下载图片，保持职责边界清晰。
// 匹配服务在调度器和站点适配器之间做分发，不直接下载图片。
export class MatcherService {
  private readonly adapters;

    // 构造时注册当前支持的站点适配器；后续新增站点只需把适配器加入这里。
constructor(
    private readonly config: RuntimeConfig,
    private readonly cookiePool: CookiePoolService,
    private readonly logger: SidecarLogger,
  ) {
    this.adapters = [new DoubanAdapter()];
  }

  // 根据任务选择第一个能处理的适配器，并返回该任务可下载的图片列表。
  async discover(task: SidecarTask, options: DiscoverOptions = {}): Promise<DiscoveryResult> {
    const adapter = this.adapters.find((item) => item.canHandle(task));
    if (!adapter) {
      throw new Error(`no adapter can handle url: ${task.detailUrl}`);
    }

    const cookieHeader = this.cookiePool.getCookieHeader(adapter.source);
    const result = await adapter.discover(task, {
      config: this.config,
      logger: this.logger,
      cookieHeader,
      includePreviewDataUrl: options.includePreviewDataUrl,
      onImagesDiscovered: options.onImagesDiscovered,
    });

    this.logger.info(
      `discovered ${result.images.length} images from ${result.source} -> ${result.outputDir}`,
      task.id,
    );
    return result;
  }
}
