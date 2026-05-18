import assert from "node:assert/strict";
import test from "node:test";

import { searchDoubanMovies } from "./douban-search.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";

function createConfig(): RuntimeConfig {
  return {
    concurrency: 1,
    batchSize: 1,
    requestIntervalMs: 0,
    requestTimeoutMs: 1_000,
    cookieCooldownMs: 1_000,
    outputDir: "covers",
    userAgentProfile: "desktop-chrome",
    doubanCookie: "dbcl2=secret",
  };
}

function createSearchHtml(coverUrl: string) {
  return `
    <script>
      window.__DATA__ = {
        "count": 1,
        "items": [{
          "id": "34780991",
          "title": "示例电影",
          "abstract": "导演",
          "cover_url": "${coverUrl}",
          "url": "https://movie.douban.com/subject/34780991/"
        }],
        "start": 0,
        "total": 1,
        "text": "示例"
      };
    </script>
  `;
}

test("豆瓣搜索封面只接受豆瓣 HTTPS 图片地址", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(createSearchHtml("https://example.com/cover.jpg"), {
      status: 200,
      headers: {
        "content-type": "text/html",
      },
    });
  }) as unknown as typeof fetch;

  try {
    const result = await searchDoubanMovies("示例", { config: createConfig(), page: 1, pageSize: 15 });

    assert.equal(result.items[0]?.coverDataUrl, undefined);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("豆瓣搜索封面请求不带 Cookie 且超限时不读取 body", async () => {
  const originalFetch = globalThis.fetch;
  const seenCookies: Array<string | null> = [];
  let bodyRead = false;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("subject_search")) {
      return new Response(createSearchHtml("https://img1.doubanio.com/view/photo/s/public/p1.jpg"), {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      });
    }

    seenCookies.push(new Headers(init?.headers).get("cookie"));
    return {
      ok: true,
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "content-type") return "image/jpeg";
          if (name.toLowerCase() === "content-length") return "1200001";
          return null;
        },
      },
      arrayBuffer: async () => {
        bodyRead = true;
        return new ArrayBuffer(0);
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;

  try {
    const result = await searchDoubanMovies("示例", { config: createConfig(), page: 1, pageSize: 15 });

    assert.equal(result.items[0]?.coverDataUrl, undefined);
    assert.deepEqual(seenCookies, [""]);
    assert.equal(bodyRead, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
