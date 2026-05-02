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
