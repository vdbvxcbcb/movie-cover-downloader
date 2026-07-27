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

const fallbackDetailHtml = `
  <html>
    <head>
      <meta property="og:title" content="汉尼拔 第二季 Hannibal Season 2" />
      <meta property="og:image" content="https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2166529641.jpg" />
    </head>
    <body>
      <h1><span property="v:itemreviewed">汉尼拔 第二季 Hannibal Season 2</span><span class="year">(2014)</span></h1>
      <div id="info">
        <span><span class="pl">导演</span>: <a rel="v:directedBy">大卫·斯雷德</a> / <a rel="v:directedBy">蒂姆·亨特</a> / <a>更多...</a></span><br>
        <span><span class="pl">编剧</span>: <a>布莱恩·福勒</a></span><br>
        <span class="actor"><span class="pl">主演</span>: <span class="attrs"><a rel="v:starring">休·丹西</a> / <a rel="v:starring">麦斯·米科尔森</a> / <a>更多...</a></span></span><br>
        <span class="pl">类型:</span> <span property="v:genre">悬疑</span> / <span property="v:genre">惊悚</span> / <span property="v:genre">恐怖</span> / <span property="v:genre">犯罪</span><br>
        <span class="pl">制片国家/地区:</span> 美国<br>
        <span class="pl">语言:</span> 英语<br>
        <span class="pl">首播:</span> <span property="v:initialReleaseDate">2014-02-28</span><br>
        <span class="pl">季数:</span> 2<br>
        <span class="pl">集数:</span> 13<br>
        <span class="pl">单集片长:</span> 43分钟<br>
        <span class="pl">IMDb:</span> tt3000124<br>
      </div>
      <strong class="ll rating_num" property="v:average">9.1</strong>
      <span property="v:votes">52707</span>
      <span class="all hidden">其他区域的展开内容。</span>
      <span property="v:summary">
        <span class="short">威尔逐渐找回记忆。汉尼拔继续隐藏秘密……</span>
        <span class="all hidden">威尔逐渐找回记忆。\n汉尼拔继续隐藏秘密。\n完整简介结尾。</span>
      </span>
    </body>
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
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(String(input));
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
    assert.deepEqual(requestedUrls, [
      "https://m.douban.com/rexxar/api/v2/movie/36189165",
      "https://movie.douban.com/subject/36189165/",
    ]);
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

test("结构化接口返回空载荷且详情页不可用时保留明确错误", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("/rexxar/api/")) {
      return Response.json(null);
    }
    return new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => resolveDoubanMovieDetails("https://movie.douban.com/subject/24733062/", { config: createConfig() }),
      /response payload was invalid/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("结构化接口无权限时使用已登录详情页作为完整兜底", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("/rexxar/api/")) {
      return Response.json({ msg: "need_permission", code: 1000 }, { status: 403 });
    }
    return new Response(fallbackDetailHtml, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;

  try {
    const details = await resolveDoubanMovieDetails("https://movie.douban.com/subject/24733062/", {
      config: createConfig("dbcl2=secret; ck=token"),
    });

    assert.equal(details.title, "汉尼拔 第二季 Hannibal Season 2");
    assert.equal(details.year, "2014");
    assert.equal(details.coverUrl, "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2166529641.jpg");
    assert.deepEqual(details.directors, ["大卫·斯雷德", "蒂姆·亨特"]);
    assert.deepEqual(details.writers, ["布莱恩·福勒"]);
    assert.deepEqual(details.casts, ["休·丹西", "麦斯·米科尔森"]);
    assert.deepEqual(details.genres, ["悬疑", "惊悚", "恐怖", "犯罪"]);
    assert.deepEqual(details.countries, ["美国"]);
    assert.deepEqual(details.languages, ["英语"]);
    assert.deepEqual(details.releaseDates, ["2014-02-28"]);
    assert.deepEqual(details.durations, ["43分钟"]);
    assert.equal(details.seasonNumber, 2);
    assert.equal(details.episodeCount, 13);
    assert.deepEqual(details.aka, []);
    assert.equal(details.imdbId, "tt3000124");
    assert.equal(details.ratingValue, 9.1);
    assert.equal(details.ratingCount, 52707);
    assert.equal(details.summary, "威尔逐渐找回记忆。\n汉尼拔继续隐藏秘密。\n完整简介结尾。");
    assert.deepEqual(requestedUrls, [
      "https://m.douban.com/rexxar/api/v2/movie/24733062",
      "https://movie.douban.com/subject/24733062/",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
