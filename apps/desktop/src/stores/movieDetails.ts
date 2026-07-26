import { shallowRef } from "vue";
import { defineStore } from "pinia";
import { runtimeBridge } from "../lib/runtime-bridge";
import type { DoubanMovieDetails, DoubanMovieDetailsSeed } from "../types/app";
import { useCookies } from "./cookies";

const openDebounceMs = 500;

function normalizeDetailsKey(detailUrl: string) {
  const subjectId = detailUrl.match(/https:\/\/movie\.douban\.com\/subject\/(\d+)/i)?.[1];
  return subjectId ? `https://movie.douban.com/subject/${subjectId}/` : detailUrl.trim();
}

function describeDetailsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/risk|captcha|验证码|异常请求/i.test(message)) {
    return "豆瓣触发了访问保护，请导入可用 Cookie 后重试";
  }
  if (/auth|login|登录/i.test(message)) {
    return "豆瓣需要登录，请导入可用 Cookie 后重试";
  }
  return message || "影片详情获取失败，请稍后重试";
}

export const useMovieDetails = defineStore("movieDetails", () => {
  const isOpen = shallowRef(false);
  const pendingDetailUrl = shallowRef("");
  const loading = shallowRef(false);
  const details = shallowRef<DoubanMovieDetails | null>(null);
  const errorMessage = shallowRef("");
  const currentSeed = shallowRef<DoubanMovieDetailsSeed | null>(null);
  const detailsCache = new Map<string, DoubanMovieDetails>();
  const inFlightRequests = new Map<string, Promise<DoubanMovieDetails>>();
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let requestRevision = 0;

  function clearOpenTimer() {
    if (!openTimer) return;
    clearTimeout(openTimer);
    openTimer = undefined;
  }

  function requestDetails(detailUrl: string) {
    const key = normalizeDetailsKey(detailUrl);
    const existing = inFlightRequests.get(key);
    if (existing) return existing;

    const cookie = useCookies().pickUsableCookie()?.value;
    const request = runtimeBridge.resolveDoubanMovieDetails(detailUrl, cookie);
    inFlightRequests.set(key, request);
    const cleanup = () => {
      if (inFlightRequests.get(key) === request) {
        inFlightRequests.delete(key);
      }
    };
    void request.then(cleanup, cleanup);
    return request;
  }

  async function loadDetails(seed: DoubanMovieDetailsSeed, revision: number) {
    const key = normalizeDetailsKey(seed.detailUrl);
    pendingDetailUrl.value = "";
    currentSeed.value = seed;
    isOpen.value = true;
    loading.value = true;
    details.value = null;
    errorMessage.value = "";

    try {
      const result = await requestDetails(seed.detailUrl);
      detailsCache.set(key, result);
      if (revision !== requestRevision || normalizeDetailsKey(currentSeed.value?.detailUrl ?? "") !== key) return;
      details.value = result;
    } catch (error) {
      if (revision !== requestRevision || normalizeDetailsKey(currentSeed.value?.detailUrl ?? "") !== key) return;
      errorMessage.value = describeDetailsError(error);
    } finally {
      if (revision === requestRevision && normalizeDetailsKey(currentSeed.value?.detailUrl ?? "") === key) {
        loading.value = false;
      }
    }
  }

  function openDetails(seed: DoubanMovieDetailsSeed) {
    clearOpenTimer();
    const revision = ++requestRevision;
    const key = normalizeDetailsKey(seed.detailUrl);
    const cached = detailsCache.get(key);
    pendingDetailUrl.value = key;

    if (cached) {
      pendingDetailUrl.value = "";
      currentSeed.value = seed;
      details.value = cached;
      errorMessage.value = "";
      loading.value = false;
      isOpen.value = true;
      return;
    }

    openTimer = setTimeout(() => {
      openTimer = undefined;
      void loadDetails(seed, revision);
    }, openDebounceMs);
  }

  function closeDetails() {
    clearOpenTimer();
    requestRevision += 1;
    isOpen.value = false;
    pendingDetailUrl.value = "";
    loading.value = false;
    details.value = null;
    errorMessage.value = "";
    currentSeed.value = null;
  }

  function retry() {
    const seed = currentSeed.value;
    if (!seed) return;
    void loadDetails(seed, ++requestRevision);
  }

  function isDetailsPending(detailUrl: string) {
    return pendingDetailUrl.value === normalizeDetailsKey(detailUrl);
  }

  return {
    isOpen,
    pendingDetailUrl,
    loading,
    details,
    errorMessage,
    currentSeed,
    openDetails,
    isDetailsPending,
    closeDetails,
    retry,
  };
});
