// 来源识别工具：把豆瓣详情页链接转换成对应图片分类页。
import type { ResolvedSource, SidecarTask, SourceHint, SourceSite } from "../shared/contracts.js";

const doubanTypeParamMap = {
  still: "S",
  poster: "R",
  wallpaper: "W",
} as const;

// 根据前端传入的 sourceHint 和详情页 URL 判断站点来源；当前项目只保留豆瓣。
export function detectSource(sourceHint: SourceHint, detailUrl: string): SourceSite {
  if (sourceHint === "douban" || detailUrl.includes("movie.douban.com")) return "douban";
  throw new Error(`unsupported source url: ${detailUrl}`);
}

// 把豆瓣 subject 链接规范成详情页标准 URL，后续构造分类页时依赖这个稳定格式。
function resolveDoubanSubjectDetailUrl(detailUrl: string) {
  const normalized = new URL(detailUrl);
  const subjectMatch = normalized.toString().match(/(https:\/\/movie\.douban\.com\/subject\/\d+)/i);
  if (!subjectMatch) {
    throw new Error(`cannot infer douban subject url from: ${detailUrl}`);
  }

  return `${subjectMatch[1]}/`;
}

// 根据用户选择的剧照/海报/壁纸，把豆瓣详情页转换成对应图片分类页。
function resolveDoubanPhotoPageUrl(detailUrl: string, doubanAssetType: SidecarTask["doubanAssetType"]) {
  const subjectDetailUrl = resolveDoubanSubjectDetailUrl(detailUrl);
  return `${subjectDetailUrl}photos?type=${doubanTypeParamMap[doubanAssetType]}`;
}

// 当前只保留豆瓣来源，详情页会被转换成对应的 all_photos/photos 分类页。
// 对外返回任务实际要抓取的图片页 URL；后续如果增加站点，可以在这里分流。
export function resolveImagePageUrl(_source: SourceSite, task: SidecarTask) {
  return resolveDoubanPhotoPageUrl(task.detailUrl, task.doubanAssetType);
}

// 创建解析结果的公共骨架，站点适配器只需要补充片名、置信度和解析原因。
export function createResolvedSkeleton(task: SidecarTask): Omit<ResolvedSource, "title" | "confidence" | "reason"> {
  const source = detectSource(task.sourceHint, task.detailUrl);
  return {
    source,
    detailUrl: resolveDoubanSubjectDetailUrl(task.detailUrl),
    imagePageUrl: resolveDoubanPhotoPageUrl(task.detailUrl, task.doubanAssetType),
  };
}
