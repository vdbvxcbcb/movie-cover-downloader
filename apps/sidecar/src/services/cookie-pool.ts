// Cookie 池服务：为 sidecar 保留站点 Cookie 的简单轮换能力。
import type { RuntimeConfig } from "../shared/runtime-config.js";
import type { SidecarLogger } from "../shared/logger.js";
import type { SourceSite } from "../shared/contracts.js";

// Cookie 内部记录：除了原始值，也保存失败次数和冷却结束时间，便于临时避开失效 Cookie。
interface CookieRecord {
  id: string;
  source: "douban";
  status: "active" | "cooling" | "testing";
  value?: string;
  coolingUntil?: number;
}

// Cookie 池服务为站点请求选择可用 Cookie；当前主要服务豆瓣请求。
export class CookiePoolService {
  private readonly cookies: CookieRecord[];

    // 初始化时从环境变量读取豆瓣 Cookie；没有 Cookie 时仍允许公共页面抓取。
constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: SidecarLogger,
  ) {
    this.cookies = [
      {
        id: "152",
        source: "douban",
        status: config.doubanCookie ? "active" : "testing",
        value: config.doubanCookie,
      },
    ];
  }

  // 返回当前站点第一个未处于冷却期的 Cookie；冷却过期后会自动恢复可用。
  getAvailableCookie(source: SourceSite) {
    if (source !== "douban") {
      return null;
    }

    const now = Date.now();

    for (const cookie of this.cookies) {
      if (cookie.status === "cooling" && cookie.coolingUntil && cookie.coolingUntil <= now) {
        cookie.status = "active";
        cookie.coolingUntil = undefined;
        this.logger.info(`cookie ${cookie.id} cooldown ended`);
      }
    }

    return this.cookies.find((cookie) => cookie.status === "active" && cookie.value);
  }

  // 只返回 Cookie 字符串，供 fetch 请求头使用；找不到可用 Cookie 时返回 null。
  getCookieHeader(source: SourceSite) {
    const cookie = this.getAvailableCookie(source);
    return cookie?.value ?? null;
  }

  // 当站点返回风控或鉴权失败时，把指定 Cookie 临时冷却，减少连续失败。
  markCooling(cookieId: string, reason: string) {
    const cookie = this.cookies.find((item) => item.id === cookieId);
    if (!cookie) return;

    cookie.status = "cooling";
    cookie.coolingUntil = Date.now() + this.config.cookieCooldownMs;
    this.logger.warn(`cookie ${cookieId} cooling: ${reason}`);
  }
}
