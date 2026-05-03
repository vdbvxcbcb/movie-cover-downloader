import { DoubanAdapter } from "../adapters/douban.js";
import type { DiscoveryResult, SidecarTask } from "../shared/contracts.js";
import type { SidecarLogger } from "../shared/logger.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";
import type { CookiePoolService } from "./cookie-pool.js";

export class MatcherService {
  private readonly adapters;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly cookiePool: CookiePoolService,
    private readonly logger: SidecarLogger,
  ) {
    this.adapters = [new DoubanAdapter()];
  }

  async discover(task: SidecarTask): Promise<DiscoveryResult> {
    const adapter = this.adapters.find((item) => item.canHandle(task));
    if (!adapter) {
      throw new Error(`no adapter can handle url: ${task.detailUrl}`);
    }

    const cookieHeader = this.cookiePool.getCookieHeader(adapter.source);
    const result = await adapter.discover(task, {
      config: this.config,
      logger: this.logger,
      cookieHeader,
    });

    this.logger.info(
      `discovered ${result.images.length} images from ${result.source} -> ${result.outputDir}`,
      task.id,
    );
    return result;
  }
}
