import type { ResolvedSource, SidecarTask, SourceHint, SourceSite } from "../shared/contracts.js";

const doubanTypeParamMap = {
  still: "S",
  poster: "R",
  wallpaper: "W",
} as const;

export function detectSource(sourceHint: SourceHint, detailUrl: string): SourceSite {
  if (sourceHint === "douban" || detailUrl.includes("movie.douban.com")) return "douban";
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

export function resolveImagePageUrl(_source: SourceSite, task: SidecarTask) {
  return resolveDoubanPhotoPageUrl(task.detailUrl, task.doubanAssetType);
}

export function createResolvedSkeleton(task: SidecarTask): Omit<ResolvedSource, "title" | "confidence" | "reason"> {
  const source = detectSource(task.sourceHint, task.detailUrl);
  return {
    source,
    detailUrl: resolveDoubanSubjectDetailUrl(task.detailUrl),
    imagePageUrl: resolveDoubanPhotoPageUrl(task.detailUrl, task.doubanAssetType),
  };
}
