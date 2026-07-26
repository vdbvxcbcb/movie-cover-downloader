import assert from "node:assert/strict";
import test from "node:test";

import { resolveDoubanMovieDetails } from "../../services/douban-details.js";
import type { RuntimeConfig } from "../../shared/runtime-config.js";

function createConfig(doubanCookie?: string): RuntimeConfig {
  return {
    concurrency: 1,
    batchSize: 1,
    requestIntervalMs: 0,
    requestTimeoutMs: 1_000,
    cookieCooldownMs: 1_000,
    outputDir: "covers",
    userAgentProfile: "desktop-chrome",
    doubanCookie,
  };
}

function createApiPayload() {
  return {
    id: "36189165",
    title: "死神 千年血战篇 -祸进谭-",
    original_title: "BLEACH 千年血戦篇 -禍進譚-",
    year: "2026",
    pic: {
      normal: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2933444018.jpg",
    },
    directors: [{ name: "田口智久" }],
    actors: Array.from({ length: 8 }, (_, index) => ({ name: `主演${index + 1}` })),
    genres: ["剧情", "动作", "动画"],
    countries: ["日本"],
    languages: ["日语"],
    pubdate: ["2026-07-25(日本)"],
    durations: ["24分钟"],
    episodes_count: 13,
    aka: ["境·界 新篇章 祸进谭篇"],
    rating: { value: 0, count: 0, max: 10 },
    intro: "第一段。\n第二段。",
  };
}

const detailHtml = `
  <html>
    <div id="info">
      <span><span class="pl">编剧</span>: <a href="/celebrity/1/">久保带人</a> / <a href="/celebrity/2/">田口智久</a></span><br>
      <span class="pl">季数:</span> 4<br>
      <span class="pl">IMDb:</span> tt39128668<br>
    </div>
  </html>
`;

test("影片详情会合并结构化接口和详情页补充字段", async () => {
  const originalFetch = globalThis.fetch;
  const cookies: Array<string | null> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    cookies.push(new Headers(init?.headers).get("cookie"));
    if (String(input).includes("/rexxar/api/")) {
      return Response.json(createApiPayload(), { status: 200 });
    }
    return new Response(detailHtml, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;

  try {
    const details = await resolveDoubanMovieDetails("https://movie.douban.com/subject/36189165/", {
      config: createConfig("dbcl2=secret"),
    });

    assert.equal(details.title, "死神 千年血战篇 -祸进谭-");
    assert.equal(details.originalTitle, "BLEACH 千年血戦篇 -禍進譚-");
    assert.deepEqual(details.writers, ["久保带人", "田口智久"]);
    assert.deepEqual(details.casts, Array.from({ length: 8 }, (_, index) => `主演${index + 1}`));
    assert.equal(details.seasonNumber, 4);
    assert.equal(details.episodeCount, 13);
    assert.equal(details.imdbId, "tt39128668");
    assert.equal(details.summary, "第一段。\n第二段。");
    assert.equal(details.ratingValue, undefined);
    assert.equal(details.ratingCount, undefined);
    assert.deepEqual(cookies, ["dbcl2=secret", "dbcl2=secret"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("影片详情拒绝非豆瓣 subject 链接", async () => {
  await assert.rejects(
    () => resolveDoubanMovieDetails("https://example.com/subject/36189165/", { config: createConfig() }),
    /unsupported douban subject url/,
  );
});

test("影片详情不会跟随豆瓣风控或异常重定向", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://sec.douban.com/b?r=movie" },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => resolveDoubanMovieDetails("https://movie.douban.com/subject/36189165/", { config: createConfig() }),
      /risk protection/,
    );
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("影片详情允许同一豆瓣 API 从 movie 跳转到 tv", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.endsWith("/rexxar/api/v2/movie/36189163")) {
      return new Response(null, {
        status: 301,
        headers: { location: "https://m.douban.com/rexxar/api/v2/tv/36189163" },
      });
    }
    if (url.endsWith("/rexxar/api/v2/tv/36189163")) {
      return Response.json({ ...createApiPayload(), title: "死神 千年血战篇 -诀别谭-" });
    }
    return new Response(detailHtml, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;

  try {
    const details = await resolveDoubanMovieDetails("https://movie.douban.com/subject/36189163/", {
      config: createConfig(),
    });

    assert.equal(details.title, "死神 千年血战篇 -诀别谭-");
    assert.deepEqual(requestedUrls.slice(0, 2), [
      "https://m.douban.com/rexxar/api/v2/movie/36189163",
      "https://m.douban.com/rexxar/api/v2/tv/36189163",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
