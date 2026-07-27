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
  ).filter((name) => name && !/^更多(?:\.{3}|…)?$/i.test(name));
  return [...new Set(names)];
}

function extractNumberField(fragment: string | undefined) {
  const value = normalizeWhitespace(decodeHtml(stripTags(fragment ?? ""))).match(/\d+/)?.[0];
  return value ? Number(value) : undefined;
}

function extractTextField(fragment: string | undefined) {
  return normalizeText(decodeHtml(stripTags(fragment ?? "")));
}

function extractPropertyValues(html: string, property: string) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<([a-z][\\w:-]*)\\b[^>]*\\bproperty=["']${escapedProperty}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    "gi",
  );
  return normalizeList(
    Array.from(html.matchAll(pattern), (match) => decodeHtml(stripTags(match[2] ?? "")).replace(/&nbsp;/gi, " ")),
  );
}

function extractMetaProperty(html: string, property: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const tagProperty = tag.match(/\bproperty=["']([^"']+)["']/i)?.[1];
    if (tagProperty !== property) continue;
    return normalizeText(decodeHtml(tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? ""));
  }
  return undefined;
}

function extractClassText(html: string, className: string) {
  const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fragment = html.match(
    new RegExp(`<[^>]*class=["'][^"']*\\b${escapedClassName}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"),
  )?.[1];
  return normalizeText(decodeHtml(stripTags(fragment ?? "")));
}

function splitInfoList(fragment: string | undefined) {
  const value = extractTextField(fragment);
  return value ? normalizeList(value.split(/\s*\/\s*/)) : [];
}

function extractSummary(html: string) {
  const summaryMatch = html.match(
    /<([a-z][\w:-]*)\b[^>]*\bproperty=["']v:summary["'][^>]*>([\s\S]*?)<\/\1>/i,
  );
  if (!summaryMatch?.[2]) return undefined;
  const summaryRegion = html.slice(summaryMatch.index ?? 0);
  const boundaryIndex = summaryRegion.search(/<\/div\s*>|<h2\b/i);
  const boundedSummaryRegion = boundaryIndex >= 0 ? summaryRegion.slice(0, boundaryIndex) : summaryRegion;
  const expandedFragment = boundedSummaryRegion.match(
    /<([a-z][\w:-]*)\b[^>]*\bclass=["'][^"']*\ball\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i,
  )?.[2];
  const fragment = expandedFragment ?? summaryMatch[2];
  return normalizeParagraphs(
    decodeHtml(fragment.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p\s*>/gi, "\n").replace(/<[^>]+>/g, " ")),
  );
}

function parseHtmlDetails(html: string) {
  const infoHtml = extractInfoBlock(html);
  const propertyDurations = extractPropertyValues(infoHtml, "v:runtime");
  const textDurations = splitInfoList(
    extractInfoFieldHtml(infoHtml, "单集片长") ?? extractInfoFieldHtml(infoHtml, "片长"),
  );
  const ratingValue = Number(extractPropertyValues(html, "v:average")[0]);
  const ratingCount = Number(extractPropertyValues(html, "v:votes")[0]);
  const hasRating =
    Number.isFinite(ratingValue) &&
    ratingValue > 0 &&
    ratingValue <= 10 &&
    Number.isFinite(ratingCount) &&
    ratingCount > 0;

  return {
    title: extractPropertyValues(html, "v:itemreviewed")[0] ?? extractMetaProperty(html, "og:title"),
    year: extractClassText(html, "year")?.replace(/^\(|\)$/g, ""),
    coverUrl: normalizeCoverUrl(extractMetaProperty(html, "og:image")),
    directors: extractLinkedNames(extractInfoFieldHtml(infoHtml, "导演")),
    writers: extractLinkedNames(extractInfoFieldHtml(infoHtml, "编剧")),
    casts: extractLinkedNames(extractInfoFieldHtml(infoHtml, "主演")),
    genres: extractPropertyValues(infoHtml, "v:genre"),
    countries: splitInfoList(extractInfoFieldHtml(infoHtml, "制片国家/地区")),
    languages: splitInfoList(extractInfoFieldHtml(infoHtml, "语言")),
    releaseDates: extractPropertyValues(infoHtml, "v:initialReleaseDate"),
    durations: propertyDurations.length > 0 ? propertyDurations : textDurations,
    seasonNumber: extractNumberField(extractInfoFieldHtml(infoHtml, "季数")),
    episodeCount: extractNumberField(extractInfoFieldHtml(infoHtml, "集数")),
    aka: splitInfoList(extractInfoFieldHtml(infoHtml, "又名")),
    imdbId: extractTextField(extractInfoFieldHtml(infoHtml, "IMDb")),
    ratingValue: hasRating ? ratingValue : undefined,
    ratingCount: hasRating ? Math.round(ratingCount) : undefined,
    summary: extractSummary(html),
  };
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

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("douban movie details response payload was invalid");
  }
  return payload as DoubanMovieDetailsPayload;
}

async function fetchDetailHtml(detailUrl: string, config: RuntimeConfig) {
  try {
    const page = await fetchText(detailUrl, {
      config,
      logger: silentLogger,
      cookieHeader: config.doubanCookie,
    });
    const finalUrl = page.finalUrl || detailUrl;
    const isExpectedUrl = finalUrl === detailUrl;
    const isHtml = !page.contentType || /\btext\/html\b/i.test(page.contentType);
    const hasDetailStructure = /\bid=["']info["']|\bproperty=["']v:itemreviewed["']/i.test(page.html);
    return page.status >= 200 && page.status < 300 && isExpectedUrl && isHtml && hasDetailStructure ? page.html : "";
  } catch {
    return "";
  }
}

export async function resolveDoubanMovieDetails(detailUrl: string, options: ResolveMovieDetailsOptions) {
  const normalized = normalizeDoubanSubjectUrl(detailUrl);
  let payload: DoubanMovieDetailsPayload | undefined;
  let structuredError: unknown;
  try {
    payload = await fetchStructuredDetails(normalized.subjectId, options.config);
  } catch (error) {
    structuredError = error;
  }
  const detailHtml = await fetchDetailHtml(normalized.detailUrl, options.config);
  if (!payload && !detailHtml) {
    throw structuredError;
  }
  const htmlDetails = parseHtmlDetails(detailHtml);
  const apiDirectors = normalizePeople(payload?.directors);
  const apiCasts = normalizePeople(payload?.actors);
  const apiGenres = normalizeList(payload?.genres);
  const apiCountries = normalizeList(payload?.countries);
  const apiLanguages = normalizeList(payload?.languages);
  const apiReleaseDates = normalizeList(payload?.pubdate);
  const apiDurations = normalizeList(payload?.durations);
  const apiAka = normalizeList(payload?.aka);
  const ratingValue = payload?.rating?.value;
  const ratingCount = payload?.rating?.count;
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
    title: normalizeText(payload?.title) ?? htmlDetails.title ?? "未知影片",
    originalTitle: normalizeText(payload?.original_title),
    year: normalizeText(payload?.year) ?? htmlDetails.year,
    coverUrl: normalizeCoverUrl(payload?.pic?.normal ?? payload?.cover_url ?? payload?.pic?.large) ?? htmlDetails.coverUrl,
    directors: apiDirectors.length > 0 ? apiDirectors : htmlDetails.directors,
    writers: htmlDetails.writers,
    casts: apiCasts.length > 0 ? apiCasts : htmlDetails.casts,
    genres: apiGenres.length > 0 ? apiGenres : htmlDetails.genres,
    countries: apiCountries.length > 0 ? apiCountries : htmlDetails.countries,
    languages: apiLanguages.length > 0 ? apiLanguages : htmlDetails.languages,
    releaseDates: apiReleaseDates.length > 0 ? apiReleaseDates : htmlDetails.releaseDates,
    durations: apiDurations.length > 0 ? apiDurations : htmlDetails.durations,
    seasonNumber: htmlDetails.seasonNumber,
    episodeCount:
      typeof payload?.episodes_count === "number" && Number.isFinite(payload.episodes_count) && payload.episodes_count > 0
        ? Math.round(payload.episodes_count)
        : htmlDetails.episodeCount,
    aka: apiAka.length > 0 ? apiAka : htmlDetails.aka,
    imdbId: htmlDetails.imdbId,
    ratingValue: hasRating ? ratingValue : htmlDetails.ratingValue,
    ratingCount: hasRating ? Math.round(ratingCount) : htmlDetails.ratingCount,
    summary: normalizeParagraphs(payload?.intro) ?? htmlDetails.summary,
  };
}
