import { extractDoubanEmptyCategoryTitle, formatDoubanAssetTypeLabel } from "../lib/douban-empty-category";
import type { TaskItem } from "../types/app";

// 根据失败消息判断是否需要让当前豆瓣 Cookie 冷却，降低连续风控风险。
export function shouldCooldownDoubanCookie(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("no images discovered on douban photos page")) {
    return false;
  }

  return [
    "403",
    "418",
    "429",
    "forbidden",
    "captcha",
    "验证码",
    "sec.douban.com",
  ].some((keyword) => normalized.includes(keyword));
}

// 判断错误是否属于豆瓣登录失效或未登录，便于提示用户重新导入 Cookie。
export function isDoubanAuthFailure(message: string) {
  const normalized = message.toLowerCase();

  return [
    "douban login required",
    "login required",
    "session expired",
    "login expired",
    "cookie expired",
    "sign in again",
    "log in again",
    "please sign in again",
    "please log in again",
    "登录失效",
    "登录已失效",
    "登录过期",
    "会话过期",
    "需要登录",
    "请重新登录",
    "请先登录",
  ].some((keyword) => normalized.includes(keyword));
}

// 豆瓣失败会按用户可理解的原因分类，决定是否冷却 Cookie 和展示什么提示。
export function classifyDoubanFailure(message: string, task: TaskItem) {
  const normalized = message.toLowerCase();

  if (normalized.includes("douban photo category is empty")) {
    const title = extractDoubanEmptyCategoryTitle(message) ?? (task.title !== "待解析标题" ? task.title : "当前条目");
    const assetLabel = formatDoubanAssetTypeLabel(task.target.doubanAssetType);
    return {
      kind: "empty" as const,
      cooldown: false,
      userMessage: `${title}暂时没有${assetLabel}`,
    };
  }

  if (isDoubanAuthFailure(message)) {
    return {
      kind: "auth" as const,
      cooldown: true,
      userMessage: "豆瓣登录状态失效，请重新导入 Cookie",
    };
  }

  if (normalized.includes("douban risk page detected")) {
    return {
      kind: "risk" as const,
      cooldown: true,
      userMessage: "触发豆瓣风控，请稍后重试",
    };
  }

  if (normalized.includes("douban page structure mismatch")) {
    return {
      kind: "unexpected" as const,
      cooldown: false,
      userMessage: "豆瓣页面结构异常，暂时无法解析",
    };
  }

  return {
    kind: "generic" as const,
    cooldown: shouldCooldownDoubanCookie(message),
    userMessage: shouldCooldownDoubanCookie(message)
      ? "豆瓣访问受限，请稍后重试或重新导入 Cookie"
      : "豆瓣抓图失败，请稍后重试",
  };
}

// 失败时尽量保留已解析片名；空分类错误也可以从消息里提取片名。
export function resolveFailureTaskTitle(message: string, task: TaskItem) {
  if (task.title !== "待解析标题") {
    return task.title;
  }

  return extractDoubanEmptyCategoryTitle(message) ?? task.title;
}
