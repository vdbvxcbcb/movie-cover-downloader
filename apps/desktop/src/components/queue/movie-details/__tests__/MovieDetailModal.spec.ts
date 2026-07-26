import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoubanMovieDetails } from "../../../../types/app";
import MovieDetailModal from "../MovieDetailModal.vue";

function createDetails(overrides: Partial<DoubanMovieDetails> = {}): DoubanMovieDetails {
  return {
    detailUrl: "https://movie.douban.com/subject/36189165/",
    title: "死神 千年血战篇 -祸进谭-",
    originalTitle: "BLEACH 千年血戦篇 -禍進譚-",
    year: "2026",
    directors: ["田口智久"],
    writers: ["久保带人"],
    casts: Array.from({ length: 8 }, (_, index) => `主演${index + 1}`),
    genres: ["剧情", "动作", "动画"],
    countries: ["日本"],
    languages: ["日语"],
    releaseDates: ["2026-07-25(日本)"],
    durations: ["24分钟"],
    seasonNumber: 4,
    episodeCount: 13,
    aka: ["境·界 新篇章 祸进谭篇"],
    imdbId: "tt39128668",
    ratingValue: 8.6,
    ratingCount: 16084,
    summary: "第一段。\n第二段。",
    ...overrides,
  };
}

describe("movie detail modal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders movie fields and folds casts after the first six", async () => {
    const wrapper = mount(MovieDetailModal, {
      props: { details: createDetails(), seed: null, loading: false, errorMessage: "" },
      global: { stubs: { Teleport: true } },
    });

    expect(wrapper.text()).toContain("死神 千年血战篇 -祸进谭-");
    expect(wrapper.text()).toContain("IMDb");
    expect(wrapper.text()).toContain("tt39128668");
    expect(wrapper.text()).toContain("主演6");
    expect(wrapper.text()).not.toContain("主演7");

    await wrapper.get(".movie-detail__cast-toggle").trigger("click");
    expect(wrapper.text()).toContain("主演8");
    expect(wrapper.get(".movie-detail__cast-toggle").text()).toBe("收起");
  });

  it("renders casts between writers and genres", () => {
    const wrapper = mount(MovieDetailModal, {
      props: { details: createDetails(), seed: null, loading: false, errorMessage: "" },
      global: { stubs: { Teleport: true } },
    });

    expect(wrapper.findAll(".movie-detail__facts dt").map((item) => item.text()).slice(0, 4)).toEqual([
      "导演",
      "编剧",
      "主演",
      "类型",
    ]);
  });

  it("shows the rating value and count without stars or a ten-point suffix", () => {
    const wrapper = mount(MovieDetailModal, {
      props: { details: createDetails(), seed: null, loading: false, errorMessage: "" },
      global: { stubs: { Teleport: true } },
    });

    expect(wrapper.get(".movie-detail__rating-value").text()).toBe("8.6");
    expect(wrapper.text()).not.toContain("/ 10");
    expect(wrapper.find(".movie-detail__stars").exists()).toBe(false);
    expect(wrapper.text()).toContain("16,084 人评价");
  });

  it("copies only the synopsis body and preserves paragraphs", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mount(MovieDetailModal, {
      props: { details: createDetails(), seed: null, loading: false, errorMessage: "" },
      global: { stubs: { Teleport: true } },
    });

    await wrapper.get(".movie-detail__copy").trigger("click");

    expect(writeText).toHaveBeenCalledWith("第一段。\n第二段。");
    expect(wrapper.get(".movie-detail__copy").text()).toBe("已复制");
  });

  it("shows only the unavailable label when the movie has no rating", () => {
    const wrapper = mount(MovieDetailModal, {
      props: {
        details: createDetails({ ratingValue: undefined, ratingCount: undefined }),
        seed: null,
        loading: false,
        errorMessage: "",
      },
      global: { stubs: { Teleport: true } },
    });

    expect(wrapper.get(".movie-detail__rating-empty").text()).toBe("暂无评分");
    expect(wrapper.find(".movie-detail__stars").exists()).toBe(false);
  });

  it("closes on Escape but not when the backdrop is clicked", async () => {
    const wrapper = mount(MovieDetailModal, {
      props: { details: createDetails(), seed: null, loading: false, errorMessage: "" },
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    });

    await wrapper.get(".movie-detail-backdrop").trigger("click");
    expect(wrapper.emitted("close")).toBeUndefined();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("prefers the already loaded seed data URL over a remote detail cover", () => {
    const wrapper = mount(MovieDetailModal, {
      props: {
        details: createDetails({ coverUrl: "https://img3.doubanio.com/remote.jpg" }),
        seed: {
          detailUrl: "https://movie.douban.com/subject/36189165/",
          title: "测试影片",
          coverDataUrl: "data:image/jpeg;base64,loaded-cover",
        },
        loading: false,
        errorMessage: "",
      },
      global: { stubs: { Teleport: true } },
    });

    expect(wrapper.get(".movie-detail__cover img").attributes("src")).toBe("data:image/jpeg;base64,loaded-cover");
  });

  it("removes task category and download mode from the fallback title", () => {
    const wrapper = mount(MovieDetailModal, {
      props: {
        details: null,
        seed: {
          detailUrl: "https://movie.douban.com/subject/36189163/",
          title: "死神 千年血战篇 -诀别谭- BLEACH 千年血戦篇 -訣別譚- (2023) 海报 选图下载",
        },
        loading: true,
        errorMessage: "",
      },
      global: { stubs: { Teleport: true } },
    });

    expect(wrapper.get("#movie-detail-title").text()).toBe(
      "死神 千年血战篇 -诀别谭- BLEACH 千年血戦篇 -訣別譚- (2023)",
    );
  });
});
