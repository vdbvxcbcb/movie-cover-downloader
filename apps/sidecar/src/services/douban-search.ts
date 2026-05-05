// 豆瓣影片搜索服务：抓取 subject_search 页面里的 window.__DATA__，并转换成前端弹窗需要的字段。
import { buildHeaders, decodeHtml, normalizeWhitespace, stripTags } from "../adapters/base.js";
import type { DoubanSearchResultItem, DoubanSearchResultPage } from "../shared/contracts.js";
import type { SidecarLogger } from "../shared/logger.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";

interface RawDoubanSearchItem {
  id?: number | string;
  title?: string;
  abstract?: string;
  abstract_2?: string;
  cover_url?: string;
  url?: string;
}

interface RawDoubanSearchData {
  count?: number;
  items?: RawDoubanSearchItem[];
  start?: number;
  total?: number;
  text?: string;
}

interface SearchOptions {
  config: RuntimeConfig;
  page: number;
  pageSize: number;
}

const silentLogger: SidecarLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

// 在 HTML 中从 window.__DATA__ 后面按括号配对提取 JSON，避免简单正则被字符串内容误截断。
function extractWindowDataJson(html: string) {
  const marker = "window.__DATA__";
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error("douban search page data was not found");
  }

  const equalsIndex = html.indexOf("=", markerIndex);
  const startIndex = html.indexOf("{", equalsIndex);
  if (equalsIndex === -1 || startIndex === -1) {
    throw new Error("douban search page data is malformed");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < html.length; index += 1) {
    const char = html[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(startIndex, index + 1);
      }
    }
  }

  throw new Error("douban search page data is incomplete");
}

function parseSearchData(html: string) {
  return JSON.parse(extractWindowDataJson(html)) as RawDoubanSearchData;
}

function cleanText(value: string | undefined) {
  if (!value) return "";
  return normalizeWhitespace(decodeHtml(stripTags(value)));
}

function buildDescription(item: RawDoubanSearchItem) {
  return [cleanText(item.abstract), cleanText(item.abstract_2)].filter(Boolean).join(" / ");
}

function normalizeSearchItem(item: RawDoubanSearchItem): DoubanSearchResultItem | null {
  const id = item.id === undefined ? "" : String(item.id);
  const title = cleanText(item.title);
  const detailUrl = item.url?.trim() ?? "";

  if (!id || !title || !detailUrl.startsWith("https://movie.douban.com/subject/")) {
    return null;
  }

  return {
    id,
    title,
    description: buildDescription(item),
    coverUrl: item.cover_url?.trim() || undefined,
    detailUrl,
  };
}


async function fetchCoverDataUrl(coverUrl: string | undefined, config: RuntimeConfig) {
  if (!coverUrl) return undefined;

  try {
    const response = await fetch(coverUrl, {
      headers: buildHeaders(
        { config, logger: silentLogger },
        {
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          referer: "https://search.douban.com/",
        },
      ),
      redirect: "follow",
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });

    if (!response.ok) return undefined;

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function attachCoverDataUrls(items: DoubanSearchResultItem[], config: RuntimeConfig) {
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      coverDataUrl: await fetchCoverDataUrl(item.coverUrl, config),
    })),
  );
}
function buildSearchUrl(query: string, page: number, pageSize: number) {
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  const url = new URL("https://search.douban.com/movie/subject_search");
  url.searchParams.set("search_text", query);
  url.searchParams.set("cat", "1002");
  url.searchParams.set("start", String(start));
  return url.toString();
}

// 执行一次豆瓣电影搜索。这里只访问固定域名和固定 cat=1002，避免把任意 URL 代理出去。
export async function searchDoubanMovies(query: string, options: SearchOptions): Promise<DoubanSearchResultPage> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error("search query is required");
  }

  const page = Math.max(1, options.page);
  const pageSize = Math.max(1, options.pageSize);
  const response = await fetch(buildSearchUrl(normalizedQuery, page, pageSize), {
    headers: buildHeaders({ config: options.config, logger: silentLogger }),
    redirect: "follow",
    signal: AbortSignal.timeout(options.config.requestTimeoutMs),
  });

  const html = await response.text();
  if (!response.ok) {
    throw new Error(`douban search request failed: ${response.status}`);
  }

  const data = parseSearchData(html);
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = await attachCoverDataUrls(
    rawItems.flatMap((item) => {
      const normalized = normalizeSearchItem(item);
      return normalized ? [normalized] : [];
    }),
    options.config,
  );
  const start = Number.isFinite(data.start) ? Number(data.start) : (page - 1) * pageSize;
  const actualPageSize = Number.isFinite(data.count) && Number(data.count) > 0 ? Number(data.count) : pageSize;

  return {
    query: cleanText(data.text) || normalizedQuery,
    page: Math.floor(start / actualPageSize) + 1,
    pageSize: actualPageSize,
    total: Number.isFinite(data.total) ? Number(data.total) : items.length,
    items,
  };
}