import type { RuntimeConfig } from "../shared/runtime-config.js";
import type { SidecarLogger } from "../shared/logger.js";
import type { SourceSite } from "../shared/contracts.js";

interface CookieRecord {
  id: string;
  source: "douban";
  status: "active" | "cooling" | "testing";
  value?: string;
  coolingUntil?: number;
}

export class CookiePoolService {
  private readonly cookies: CookieRecord[];

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

  getCookieHeader(source: SourceSite) {
    const cookie = this.getAvailableCookie(source);
    return cookie?.value ?? null;
  }

  markCooling(cookieId: string, reason: string) {
    const cookie = this.cookies.find((item) => item.id === cookieId);
    if (!cookie) return;

    cookie.status = "cooling";
    cookie.coolingUntil = Date.now() + this.config.cookieCooldownMs;
    this.logger.warn(`cookie ${cookieId} cooling: ${reason}`);
  }
}
