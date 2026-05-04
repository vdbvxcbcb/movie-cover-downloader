// sidecar 运行配置：从环境变量读取输出目录、并发、请求头和超时。
// sidecar 运行配置结构，所有字段都来自环境变量或默认值，供服务层统一读取。
export interface RuntimeConfig {
  concurrency: number;
  batchSize: number;
  requestIntervalMs: number;
  requestTimeoutMs: number;
  cookieCooldownMs: number;
  outputDir: string;
  userAgentProfile: string;
  doubanCookie?: string;
}

// 从环境变量构造运行配置；Tauri 打开任务时会注入输出目录、并发、Cookie 等参数。
export function createRuntimeConfig(): RuntimeConfig {
  return {
    concurrency: Number(process.env.MCD_CONCURRENCY ?? 2),
    batchSize: Number(process.env.MCD_BATCH_SIZE ?? 4),
    requestIntervalMs: Number(process.env.MCD_REQUEST_INTERVAL_MS ?? 1000),
    requestTimeoutMs: Number(process.env.MCD_REQUEST_TIMEOUT_MS ?? 15_000),
    cookieCooldownMs: Number(process.env.MCD_COOKIE_COOLDOWN_MS ?? 10 * 60 * 1000),
    outputDir: process.env.MCD_OUTPUT_DIR ?? "covers/internal",
    userAgentProfile: process.env.MCD_UA_PROFILE ?? "desktop-chrome",
    doubanCookie: process.env.MCD_DOUBAN_COOKIE,
  };
}

// 把运行配置格式化成启动日志，方便排查 sidecar 是否使用了正确目录和并发参数。
export function formatRuntimeConfig(config: RuntimeConfig) {
  return [
    `batch=${config.batchSize}`,
    `concurrency=${config.concurrency}`,
    `interval=${config.requestIntervalMs}ms`,
    `timeout=${config.requestTimeoutMs}ms`,
    `cookieCooldown=${config.cookieCooldownMs}ms`,
    `output=${config.outputDir}`,
    `ua=${config.userAgentProfile}`,
    `doubanCookie=${config.doubanCookie ? "set" : "unset"}`,
  ].join(", ");
}
