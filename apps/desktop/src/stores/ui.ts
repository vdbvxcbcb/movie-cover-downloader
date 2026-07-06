// UI 状态管理 store：处理所有弹窗、提示和 UI 标志位。
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { NoticePayload, SelectedPhotoDownloadSeed, DoubanMoviePreview } from "../types/app";
import { normalizeComparableDetailUrl, formatDetailUrlDisplayLine } from "../lib/task-draft-input";

export const useUI = defineStore("ui", () => {
  const createTaskOpen = ref(false);
  const createTaskDetailUrls = ref("");
  const selectedPhotoDownloadSeed = ref<SelectedPhotoDownloadSeed | null>(null);
  const createTaskOutputRootDir = ref("");
  const createTaskMoviePreviews = ref<Record<string, Partial<DoubanMoviePreview>>>({});
  const importCookieOpen = ref(false);
  const searchMovieOpen = ref(false);
  const customCropOpen = ref(false);
  const imageProcessOpen = ref(false);
  const imageProcessOutputRootDir = ref("");
  const expiredCookiePromptOpen = ref(false);
  const expiredCookieCount = ref(0);
  const expiredCookieExpiresAt = ref<string | undefined>(undefined);
  const notice = ref<NoticePayload | null>(null);
  const pendingActionIds = ref<string[]>([]);

  // 自定义裁剪默认保存到最近任务的输出根目录；没有任务时回退 D:/cover。
  const customCropOutputRootDir = computed(() => createTaskOutputRootDir.value || "D:/cover");

  // 把链接草稿拆成去空白后的展示行，搜索弹窗和新增任务弹窗共用这份草稿。
  function getCreateTaskDetailUrlLines() {
    return createTaskDetailUrls.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  // 同步新增链接任务弹窗中的详情页链接文本。
  function syncCreateTaskDetailUrls(value: string) {
    createTaskDetailUrls.value = value;
  }

  // 同步新增链接任务弹窗中的输出根目录，供自定义裁剪复用。
  function syncCreateTaskOutputRootDir(value: string) {
    const nextValue = value.trim();
    if (createTaskOutputRootDir.value === nextValue) return false;
    createTaskOutputRootDir.value = nextValue;
    return true;
  }

  function syncImageProcessOutputRootDir(value: string) {
    const nextValue = value.trim();
    if (imageProcessOutputRootDir.value === nextValue) return false;
    imageProcessOutputRootDir.value = nextValue;
    return true;
  }

  function getCreateTaskMoviePreview(detailUrl: string) {
    return createTaskMoviePreviews.value[normalizeComparableDetailUrl(detailUrl)];
  }

  function upsertCreateTaskMoviePreview(detailUrl: string, preview: Partial<DoubanMoviePreview>) {
    const key = normalizeComparableDetailUrl(detailUrl);
    if (!key) return;

    createTaskMoviePreviews.value = {
      ...createTaskMoviePreviews.value,
      [key]: {
        ...createTaskMoviePreviews.value[key],
        ...preview,
        detailUrl: preview.detailUrl ?? detailUrl.trim(),
      },
    };
  }

  // 判断搜索结果中的详情页链接是否已经加入新增任务草稿；比较时只看 URL，不看显示片名。
  function hasCreateTaskDetailUrl(detailUrl: string) {
    const normalized = normalizeComparableDetailUrl(detailUrl);
    return getCreateTaskDetailUrlLines().some((line) => normalizeComparableDetailUrl(line) === normalized);
  }

  // 从搜索结果添加一条豆瓣详情页链接；文本框显示"片名：链接"，后续提交仍只提取链接。
  function addCreateTaskDetailUrl(detailUrl: string, title?: string | null, preview?: Partial<DoubanMoviePreview>) {
    const normalized = detailUrl.trim();
    if (!normalized || hasCreateTaskDetailUrl(normalized)) {
      return false;
    }

    createTaskDetailUrls.value = [
      ...getCreateTaskDetailUrlLines(),
      formatDetailUrlDisplayLine(normalized, title ?? preview?.title),
    ].join("\n");
    upsertCreateTaskMoviePreview(normalized, { ...preview, title: title ?? preview?.title ?? "" });
    return true;
  }

  // 从新增任务草稿中删除一条链接，供搜索结果行里的删除按钮调用。
  function removeCreateTaskDetailUrl(detailUrl: string) {
    const normalized = normalizeComparableDetailUrl(detailUrl);
    const currentLines = getCreateTaskDetailUrlLines();
    const nextLines = currentLines.filter((line) => normalizeComparableDetailUrl(line) !== normalized);
    const changed = nextLines.length !== currentLines.length;
    const { [normalized]: _removedPreview, ...remainingPreviews } = createTaskMoviePreviews.value;
    createTaskDetailUrls.value = nextLines.join("\n");
    createTaskMoviePreviews.value = remainingPreviews;
    return changed;
  }

  // 设置全局 toast 提示，供界面右上角统一展示反馈。
  function showNotice(message: string, tone: NoticePayload["tone"] = "info") {
    notice.value = { message, tone };
  }

  // 清除当前 toast，通常由用户点击关闭触发。
  function clearNotice() {
    notice.value = null;
  }

  // 打开新增链接任务弹窗。
  function openCreateTask() {
    selectedPhotoDownloadSeed.value = null;
    createTaskOpen.value = true;
  }

  function openSelectedPhotoDownload(seed: SelectedPhotoDownloadSeed) {
    selectedPhotoDownloadSeed.value = {
      ...seed,
      autoDiscover: seed.autoDiscover ?? false,
    };
    upsertCreateTaskMoviePreview(seed.detailUrl, seed);
    searchMovieOpen.value = false;
    createTaskOpen.value = true;
  }

  // 关闭新增链接任务弹窗。
  function closeCreateTask() {
    createTaskOpen.value = false;
    selectedPhotoDownloadSeed.value = null;
  }

  // 打开 Cookie 导入弹窗。
  function openImportCookie() {
    importCookieOpen.value = true;
  }

  // 关闭 Cookie 导入弹窗。
  function closeImportCookie() {
    importCookieOpen.value = false;
  }

  // 打开豆瓣影片搜索弹窗。
  function openSearchMovie() {
    searchMovieOpen.value = true;
  }

  // 关闭豆瓣影片搜索弹窗。
  function closeSearchMovie() {
    searchMovieOpen.value = false;
  }

  // 打开自定义裁剪弹窗。
  function openCustomCrop() {
    customCropOpen.value = true;
  }

  // 关闭自定义裁剪弹窗。
  function closeCustomCrop() {
    customCropOpen.value = false;
  }

  function openImageProcess() {
    imageProcessOpen.value = true;
  }

  function closeImageProcess() {
    imageProcessOpen.value = false;
  }

  // 关闭过期 Cookie 提示弹窗。
  function closeExpiredCookiePrompt() {
    expiredCookiePromptOpen.value = false;
    expiredCookieCount.value = 0;
    expiredCookieExpiresAt.value = undefined;
  }

  // 从过期提示弹窗点击"打开登录窗口"，关闭提示并打开登录导入。
  function openLoginFromExpiredPrompt() {
    closeExpiredCookiePrompt();
    openImportCookie();
  }

  // 判断某个异步动作是否执行中，用于按钮 loading/disabled 状态。
  function isActionPending(actionId: string) {
    return pendingActionIds.value.includes(actionId);
  }

  // 添加 pending 动作。
  function addPendingAction(actionId: string) {
    if (!pendingActionIds.value.includes(actionId)) {
      pendingActionIds.value = [...pendingActionIds.value, actionId];
    }
  }

  // 移除 pending 动作。
  function removePendingAction(actionId: string) {
    pendingActionIds.value = pendingActionIds.value.filter((item) => item !== actionId);
  }

  // 清空新增任务草稿。
  function clearCreateTaskDraft() {
    createTaskDetailUrls.value = "";
    selectedPhotoDownloadSeed.value = null;
    createTaskMoviePreviews.value = {};
  }

  // 显示过期 Cookie 提示。
  function showExpiredCookiePrompt(count: number, expiresAt?: string) {
    expiredCookieCount.value = count;
    expiredCookieExpiresAt.value = expiresAt;
    expiredCookiePromptOpen.value = true;
  }

  return {
    createTaskOpen,
    createTaskDetailUrls,
    selectedPhotoDownloadSeed,
    createTaskOutputRootDir,
    createTaskMoviePreviews,
    importCookieOpen,
    searchMovieOpen,
    customCropOpen,
    imageProcessOpen,
    imageProcessOutputRootDir,
    expiredCookiePromptOpen,
    expiredCookieCount,
    expiredCookieExpiresAt,
    notice,
    pendingActionIds,
    customCropOutputRootDir,
    getCreateTaskDetailUrlLines,
    syncCreateTaskDetailUrls,
    syncCreateTaskOutputRootDir,
    syncImageProcessOutputRootDir,
    getCreateTaskMoviePreview,
    upsertCreateTaskMoviePreview,
    hasCreateTaskDetailUrl,
    addCreateTaskDetailUrl,
    removeCreateTaskDetailUrl,
    showNotice,
    clearNotice,
    openCreateTask,
    openSelectedPhotoDownload,
    closeCreateTask,
    openImportCookie,
    closeImportCookie,
    openSearchMovie,
    closeSearchMovie,
    openCustomCrop,
    closeCustomCrop,
    openImageProcess,
    closeImageProcess,
    closeExpiredCookiePrompt,
    openLoginFromExpiredPrompt,
    isActionPending,
    addPendingAction,
    removePendingAction,
    clearCreateTaskDraft,
    showExpiredCookiePrompt,
  };
});
