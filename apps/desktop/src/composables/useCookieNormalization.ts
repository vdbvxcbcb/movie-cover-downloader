import type { CookieProfile } from "../types/app";

const cookieRetentionMs = 30 * 24 * 60 * 60 * 1000;

// 为新导入 Cookie 生成导入时间和默认过期时间。
export function createCookieLifetime(baseTime = Date.now()) {
  return {
    importedAt: new Date(baseTime).toISOString(),
    expiresAt: new Date(baseTime + cookieRetentionMs).toISOString(),
  };
}

// 清理过期 Cookie，并补齐缺失或非法的导入/过期时间。
export function normalizeCookieProfiles(rawCookies: CookieProfile[], now = Date.now()) {
  let changed = false;
  let removedCount = 0;
  let latestExpiresAt: string | undefined;

  const cookies = rawCookies.flatMap((cookie) => {
    const expiresAt = Number.isFinite(new Date(cookie.expiresAt ?? "").getTime())
      ? new Date(cookie.expiresAt!).toISOString()
      : new Date(now + cookieRetentionMs).toISOString();
    const expiresTime = new Date(expiresAt).getTime();

    if (expiresTime <= now) {
      changed = true;
      removedCount += 1;
      // 记录最晚的过期时间
      if (!latestExpiresAt || expiresTime > new Date(latestExpiresAt).getTime()) {
        latestExpiresAt = expiresAt;
      }
      return [];
    }

    const importedAt = Number.isFinite(new Date(cookie.importedAt ?? "").getTime())
      ? new Date(cookie.importedAt!).toISOString()
      : new Date(now).toISOString();

    if (cookie.expiresAt !== expiresAt || cookie.importedAt !== importedAt) {
      changed = true;
    }

    return [
      {
        ...cookie,
        importedAt,
        expiresAt,
      },
    ];
  });

  return {
    cookies,
    changed,
    removedCount,
    latestExpiresAt,
  };
}
