import type { ResolvedSource, SidecarTask, SourceHint, SourceSite } from "../shared/contracts.js";

const doubanTypeParamMap = {
  still: "S",
  poster: "R",
  wallpaper: "W",
} as const;

function stripQuery(url: string) {
  return url.replace(/[?#].*$/, "");
}

export function detectSource(sourceHint: SourceHint, detailUrl: string): SourceSite {
  if (sourceHint !== "auto") return sourceHint;
  if (detailUrl.includes("movie.douban.com")) return "douban";
  if (detailUrl.includes("impawards.com")) return "impawards";
  throw new Error(`unsupported source url: ${detailUrl}`);
}

function resolveDoubanSubjectDetailUrl(detailUrl: string) {
  const normalized = new URL(detailUrl);
  const subjectMatch = normalized.toString().match(/(https:\/\/movie\.douban\.com\/subject\/\d+)/i);
  if (!subjectMatch) {
    throw new Error(`cannot infer douban subject url from: ${detailUrl}`);
  }

  return `${subjectMatch[1]}/`;
}

function resolveDoubanPhotoPageUrl(detailUrl: string, doubanAssetType: SidecarTask["doubanAssetType"]) {
  const subjectDetailUrl = resolveDoubanSubjectDetailUrl(detailUrl);
  return `${subjectDetailUrl}photos?type=${doubanTypeParamMap[doubanAssetType]}`;
}

export function resolveImagePageUrl(source: SourceSite, task: SidecarTask) {
  if (source === "impawards") {
    return stripQuery(task.detailUrl);
  }

  return resolveDoubanPhotoPageUrl(task.detailUrl, task.doubanAssetType);
}

export function createResolvedSkeleton(task: SidecarTask): Omit<ResolvedSource, "title" | "confidence" | "reason"> {
  const source = detectSource(task.sourceHint, task.detailUrl);
  if (source === "douban") {
    return {
      source,
      detailUrl: resolveDoubanSubjectDetailUrl(task.detailUrl),
      imagePageUrl: resolveDoubanPhotoPageUrl(task.detailUrl, task.doubanAssetType),
    };
  }

  return {
    source,
    detailUrl: stripQuery(task.detailUrl),
    imagePageUrl: resolveImagePageUrl(source, task),
  };
}
