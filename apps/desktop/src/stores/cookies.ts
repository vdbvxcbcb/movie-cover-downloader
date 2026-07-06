// Cookie 管理 store：处理豆瓣 Cookie 导入、删除、状态管理和登录窗口交互。
import { ref } from "vue";
import { defineStore } from "pinia";
import { runtimeBridge } from "../lib/runtime-bridge";
import { buildAutoImportedCookieNote } from "./app-helpers";
import { createCookieLifetime, normalizeCookieProfiles } from "../composables/useCookieNormalization";
import type { CookieDraft, CookieProfile, CookieMutation } from "../types/app";

// store 内部等待工具，用于登录窗口轮询等异步等待场景。
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const useCookies = defineStore("cookies", () => {
  const cookies = ref<CookieProfile[]>([]);
  let cookieIdSequence = 299;

  // 生成新的 Cookie id，保持导入列表的编号递增。
  function nextCookieId() {
    const maxExistingId = cookies.value.reduce((maxId, cookie) => {
      const numericId = Number(cookie.id);
      return Number.isInteger(numericId) ? Math.max(maxId, numericId) : maxId;
    }, 299);

    cookieIdSequence = Math.max(cookieIdSequence, maxExistingId) + 1;
    return String(cookieIdSequence);
  }

  // 为豆瓣任务选择一个未过期、未冷却的 Cookie。
  function pickUsableCookie() {
    const normalized = normalizeCookieProfiles(cookies.value);
    if (normalized.changed) {
      cookies.value = normalized.cookies;
    }

    return cookies.value.find((cookie) => cookie.source === "douban" && cookie.status !== "cooling" && cookie.value);
  }

  // 应用浏览器演示运行时返回的 Cookie 成功/失败/冷却变更。
  function applyCookieMutations(mutations?: CookieMutation[]) {
    if (!mutations?.length) return;

    const mutationById = new Map(mutations.map((mutation) => [mutation.id, mutation]));
    cookies.value = cookies.value.map((cookie) => {
      const mutation = mutationById.get(cookie.id);
      if (!mutation) return cookie;

      return {
        ...cookie,
        status: mutation.status ?? cookie.status,
        success: cookie.success + (mutation.successDelta ?? 0),
        failure: cookie.failure + (mutation.failureDelta ?? 0),
        coolingUntil:
          mutation.coolingUntil === null
            ? undefined
            : mutation.coolingUntil ?? cookie.coolingUntil,
      };
    });
  }

  // 手动导入 Cookie。
  function importCookie(draft: CookieDraft) {
    const normalized = normalizeCookieProfiles(cookies.value);
    if (normalized.changed) {
      cookies.value = normalized.cookies;
    }

    const id = nextCookieId();
    cookies.value.unshift({
      id,
      status: "active",
      success: 0,
      failure: 0,
      note: draft.note,
      source: "douban",
      value: draft.value,
      ...createCookieLifetime(),
    });

    return { id, removedCount: normalized.removedCount };
  }

  // 自动登录导入 Cookie：打开豆瓣登录窗口，轮询 Cookie，成功后保存并关闭窗口。
  async function startDoubanLoginImport() {
    const windowLabel = "douban-login-import";
    const normalized = normalizeCookieProfiles(cookies.value);
    if (normalized.changed) {
      cookies.value = normalized.cookies;
    }

    await runtimeBridge.openDoubanLoginWindow(windowLabel);

    for (;;) {
      await wait(1200);
      const status = await runtimeBridge.inspectDoubanLoginWindow(windowLabel);

      if (status.state === "ready" && status.cookieValue) {
        const id = nextCookieId();
        const baseTime = Date.now();
        // 如果有真实过期时间，使用它；否则使用 30 天估算值
        const cookieLifetime = status.dbcl2ExpiresAt
          ? {
              importedAt: new Date(baseTime).toISOString(),
              expiresAt: status.dbcl2ExpiresAt,
            }
          : createCookieLifetime(baseTime);

        cookies.value.unshift({
          id,
          status: "active",
          success: 0,
          failure: 0,
          note: buildAutoImportedCookieNote(),
          source: "douban",
          value: status.cookieValue,
          ...cookieLifetime,
        });

        await runtimeBridge.closeDoubanLoginWindow(windowLabel);
        return { id, success: true };
      }

      if (status.state === "closed") {
        return { id: null, success: false };
      }
    }
  }

  // 删除 Cookie 列表中的一条记录。
  function deleteCookie(cookieId: string) {
    cookies.value = cookies.value.filter((cookie) => cookie.id !== cookieId);
    return cookieId;
  }

  // 更新 Cookie 状态（成功/失败/冷却）。
  function updateCookieStatus(
    cookieId: string,
    update: {
      status?: CookieProfile["status"];
      successDelta?: number;
      failureDelta?: number;
      coolingUntil?: string;
    },
  ) {
    cookies.value = cookies.value.map((cookie) =>
      cookie.id === cookieId
        ? {
            ...cookie,
            status: update.status ?? cookie.status,
            success: cookie.success + (update.successDelta ?? 0),
            failure: cookie.failure + (update.failureDelta ?? 0),
            coolingUntil: update.coolingUntil ?? cookie.coolingUntil,
          }
        : cookie,
    );
  }

  // 初始化时加载 Cookie 列表。
  function setCookies(newCookies: CookieProfile[]) {
    const normalized = normalizeCookieProfiles(newCookies);
    cookies.value = normalized.cookies;
    return {
      changed: normalized.changed,
      removedCount: normalized.removedCount,
      latestExpiresAt: normalized.latestExpiresAt,
    };
  }

  return {
    cookies,
    pickUsableCookie,
    applyCookieMutations,
    importCookie,
    startDoubanLoginImport,
    deleteCookie,
    updateCookieStatus,
    setCookies,
  };
});
