import { buildHeaders, decodeHtml, fetchText, normalizeWhitespace, stripTags } from "../adapters/base.js";
import type { SidecarLogger } from "../shared/logger.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";

interface ResolveMovieDetailsOptions {
  config: RuntimeConfig;
}

interface DoubanPerson {
  name?: string;
}

interface DoubanMovieDetailsPayload {
  title?: string;
  original_title?: string;
  year?: string;
  cover_url?: string;
  pic?: {
    large?: string;
    normal?: string;
  };
  directors?: DoubanPerson[];
  actors?: DoubanPerson[];
  genres?: string[];
  countries?: string[];
  languages?: string[];
  pubdate?: string[];
  durations?: string[];
  episodes_count?: number;
  aka?: string[];
  rating?: {
    value?: number;
    count?: number;
  };
  intro?: string;
}

const silentLogger: SidecarLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const doubanImageHostPattern = /^img\d+\.doubanio\.com$/i;

function normalizeDoubanSubjectUrl(detailUrl: string) {
  const url = new URL(detailUrl.trim());
  const subjectId = url.pathname.match(/^\/subject\/(\d+)(?:\/.*)?$/i)?.[1];
  if (url.protocol !== "https:" || url.hostname !== "movie.douban.com" || !subjectId) {
    throw new Error("unsupported douban subject url");
  }

  return {
    detailUrl: `https://movie.douban.com/subject/${subjectId}/`,
    subjectId,
  };
}

function normalizeText(value: string | undefined) {
  const normalized = normalizeWhitespace(value ?? "");
  return normalized || undefined;
}

function normalizeParagraphs(value: string | undefined) {
  const paragraphs = (value ?? "")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  return paragraphs.length > 0 ? paragraphs.join("\n") : undefined;
}

function normalizeList(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

function normalizePeople(people: DoubanPerson[] | undefined) {
  return normalizeList((people ?? []).map((person) => person.name ?? ""));
}

function normalizeCoverUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && doubanImageHostPattern.test(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function extractInfoBlock(html: string) {
  return html.match(/<div[^>]*\bid=["']info["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
}

function extractInfoFieldHtml(infoHtml: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return infoHtml.match(
    new RegExp(`<span[^>]*class=["'][^"']*\\bpl\\b[^"']*["'][^>]*>\\s*${escapedLabel}\\s*:?\\s*<\\/span>\\s*:?\\s*([\\s\\S]*?)(?=<br\\s*\\/?>)`, "i"),
  )?.[1];
}

function extractLinkedNames(fragment: string | undefined) {
  if (!fragment) return [];
  const names = Array.from(fragment.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi), (match) =>
    normalizeWhitespace(decodeHtml(stripTags(match[1] ?? ""))),
  ).filter(Boolean);
  return [...new Set(names)];
}

function extractNumberField(fragment: string | undefined) {
  const value = normalizeWhitespace(decodeHtml(stripTags(fragment ?? ""))).match(/\d+/)?.[0];
  return value ? Number(value) : undefined;
}

function extractTextField(fragment: string | undefined) {
  return normalizeText(decodeHtml(stripTags(fragment ?? "")));
}

async function fetchStructuredDetails(subjectId: string, config: RuntimeConfig) {
  const requestUrl = `https://m.douban.com/rexxar/api/v2/movie/${subjectId}`;
  const requestOptions: RequestInit = {
    headers: buildHeaders(
      { config, logger: silentLogger, cookieHeader: config.doubanCookie },
      {
        accept: "application/json, text/plain, */*",
        referer: `https://m.douban.com/movie/subject/${subjectId}/`,
      },
    ),
    redirect: "manual",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  };
  let response = await fetch(requestUrl, requestOptions);

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "";
    if (/sec\.douban\.com|accounts\.douban\.com/i.test(location)) {
      throw new Error("douban risk protection requires authentication");
    }
    const redirectUrl = new URL(location, requestUrl);
    const allowedPath = new RegExp(`^/rexxar/api/v2/(?:movie|tv)/${subjectId}$`);
    if (
      redirectUrl.protocol !== "https:" ||
      redirectUrl.hostname !== "m.douban.com" ||
      redirectUrl.port ||
      !allowedPath.test(redirectUrl.pathname)
    ) {
      throw new Error("douban movie details request returned an unsupported redirect");
    }
    response = await fetch(redirectUrl, requestOptions);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new Error("douban movie details request returned too many redirects");
  }

  if (response.status === 401 || response.status === 403 || response.status === 429) {
    throw new Error("douban risk protection requires authentication");
  }

  if (!response.ok) {
    throw new Error(`douban movie details request failed with status ${response.status}`);
  }

  if (!/\bapplication\/json\b/i.test(response.headers.get("content-type") ?? "")) {
    throw new Error("douban movie details response was not JSON");
  }

  return (await response.json()) as DoubanMovieDetailsPayload;
}

async function fetchDetailHtml(detailUrl: string, config: RuntimeConfig) {
  try {
    const page = await fetchText(detailUrl, {
      config,
      logger: silentLogger,
      cookieHeader: config.doubanCookie,
    });
    return page.status >= 200 && page.status < 300 ? page.html : "";
  } catch {
    return "";
  }
}

export async function resolveDoubanMovieDetails(detailUrl: string, options: ResolveMovieDetailsOptions) {
  const normalized = normalizeDoubanSubjectUrl(detailUrl);
  const payload = await fetchStructuredDetails(normalized.subjectId, options.config);
  const detailHtml = await fetchDetailHtml(normalized.detailUrl, options.config);
  const infoHtml = extractInfoBlock(detailHtml);
  const ratingValue = payload.rating?.value;
  const ratingCount = payload.rating?.count;
  const hasRating =
    typeof ratingValue === "number" &&
    Number.isFinite(ratingValue) &&
    ratingValue > 0 &&
    ratingValue <= 10 &&
    typeof ratingCount === "number" &&
    Number.isFinite(ratingCount) &&
    ratingCount > 0;

  return {
    detailUrl: normalized.detailUrl,
    title: normalizeText(payload.title) ?? "未知影片",
    originalTitle: normalizeText(payload.original_title),
    year: normalizeText(payload.year),
    coverUrl: normalizeCoverUrl(payload.pic?.normal ?? payload.cover_url ?? payload.pic?.large),
    directors: normalizePeople(payload.directors),
    writers: extractLinkedNames(extractInfoFieldHtml(infoHtml, "编剧")),
    casts: normalizePeople(payload.actors),
    genres: normalizeList(payload.genres),
    countries: normalizeList(payload.countries),
    languages: normalizeList(payload.languages),
    releaseDates: normalizeList(payload.pubdate),
    durations: normalizeList(payload.durations),
    seasonNumber: extractNumberField(extractInfoFieldHtml(infoHtml, "季数")),
    episodeCount:
      typeof payload.episodes_count === "number" && Number.isFinite(payload.episodes_count) && payload.episodes_count > 0
        ? Math.round(payload.episodes_count)
        : undefined,
    aka: normalizeList(payload.aka),
    imdbId: extractTextField(extractInfoFieldHtml(infoHtml, "IMDb")),
    ratingValue: hasRating ? ratingValue : undefined,
    ratingCount: hasRating ? Math.round(ratingCount) : undefined,
    summary: normalizeParagraphs(payload.intro),
  };
}
