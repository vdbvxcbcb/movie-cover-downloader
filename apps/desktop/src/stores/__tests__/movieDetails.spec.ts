import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeBridge } from "../../lib/runtime-bridge";
import type { DoubanMovieDetails } from "../../types/app";
import { useMovieDetails } from "../movieDetails";

const originalResolveDoubanMovieDetails = runtimeBridge.resolveDoubanMovieDetails;

function createDetails(detailUrl: string, title: string): DoubanMovieDetails {
  return {
    detailUrl,
    title,
    directors: [],
    writers: [],
    casts: [],
    genres: [],
    countries: [],
    languages: [],
    releaseDates: [],
    durations: [],
    aka: [],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("movie details store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    runtimeBridge.resolveDoubanMovieDetails = originalResolveDoubanMovieDetails;
    vi.useRealTimers();
  });

  it("debounces uncached covers and only opens the last clicked movie", async () => {
    const firstUrl = "https://movie.douban.com/subject/1/";
    const secondUrl = "https://movie.douban.com/subject/2/";
    runtimeBridge.resolveDoubanMovieDetails = vi.fn(async (detailUrl) => createDetails(detailUrl, "第二部"));
    const store = useMovieDetails();

    store.openDetails({ detailUrl: firstUrl, title: "第一部" });
    store.openDetails({ detailUrl: secondUrl, title: "第二部" });

    expect(store.pendingDetailUrl).toBe(secondUrl);
    expect(store.isOpen).toBe(false);
    await vi.advanceTimersByTimeAsync(499);
    expect(runtimeBridge.resolveDoubanMovieDetails).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(runtimeBridge.resolveDoubanMovieDetails).toHaveBeenCalledTimes(1);
    expect(runtimeBridge.resolveDoubanMovieDetails).toHaveBeenCalledWith(secondUrl, undefined);
    expect(store.isOpen).toBe(true);
    expect(store.details?.title).toBe("第二部");
  });

  it("opens cached details immediately without another runtime request", async () => {
    const detailUrl = "https://movie.douban.com/subject/1/";
    runtimeBridge.resolveDoubanMovieDetails = vi.fn(async () => createDetails(detailUrl, "缓存影片"));
    const store = useMovieDetails();

    store.openDetails({ detailUrl, title: "缓存影片" });
    await vi.advanceTimersByTimeAsync(500);
    store.closeDetails();
    store.openDetails({ detailUrl, title: "缓存影片" });

    expect(store.isOpen).toBe(true);
    expect(store.details?.title).toBe("缓存影片");
    expect(runtimeBridge.resolveDoubanMovieDetails).toHaveBeenCalledTimes(1);
  });

  it("reuses an in-flight request and ignores a stale response", async () => {
    const firstUrl = "https://movie.douban.com/subject/1/";
    const secondUrl = "https://movie.douban.com/subject/2/";
    const firstRequest = createDeferred<DoubanMovieDetails>();
    const secondRequest = createDeferred<DoubanMovieDetails>();
    runtimeBridge.resolveDoubanMovieDetails = vi.fn((detailUrl) =>
      detailUrl === firstUrl ? firstRequest.promise : secondRequest.promise,
    );
    const store = useMovieDetails();

    store.openDetails({ detailUrl: firstUrl, title: "第一部" });
    await vi.advanceTimersByTimeAsync(500);
    store.closeDetails();
    store.openDetails({ detailUrl: firstUrl, title: "第一部" });
    await vi.advanceTimersByTimeAsync(500);
    expect(runtimeBridge.resolveDoubanMovieDetails).toHaveBeenCalledTimes(1);

    store.closeDetails();
    store.openDetails({ detailUrl: secondUrl, title: "第二部" });
    await vi.advanceTimersByTimeAsync(500);
    secondRequest.resolve(createDetails(secondUrl, "第二部"));
    await Promise.resolve();
    firstRequest.resolve(createDetails(firstUrl, "第一部"));
    await Promise.resolve();

    expect(store.details?.title).toBe("第二部");
    expect(store.errorMessage).toBe("");
  });

  it("shows a failed request without leaking an unhandled rejection and can retry", async () => {
    const detailUrl = "https://movie.douban.com/subject/1/";
    runtimeBridge.resolveDoubanMovieDetails = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(createDetails(detailUrl, "重试成功"));
    const store = useMovieDetails();

    store.openDetails({ detailUrl, title: "测试影片" });
    await vi.advanceTimersByTimeAsync(500);

    expect(store.errorMessage).toBe("network unavailable");
    expect(store.loading).toBe(false);

    store.retry();
    await Promise.resolve();

    expect(store.details?.title).toBe("重试成功");
    expect(store.errorMessage).toBe("");
  });
});
