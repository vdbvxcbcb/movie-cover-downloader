<script setup lang="ts">
// 新增链接任务弹窗：收集豆瓣链接、输出目录、抓取类型、数量和图片尺寸。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, shallowRef } from "vue";
import ActionButton from "../common/ActionButton.vue";
import MessageNotice from "../common/MessageNotice.vue";
import PopConfirmAction from "../common/PopConfirmAction.vue";
import AutoDownloadStrategyPanel from "./create-task/AutoDownloadStrategyPanel.vue";
import SelectedPhotoCategoryTabs from "./create-task/SelectedPhotoCategoryTabs.vue";
import SelectedPhotoGrid from "./create-task/SelectedPhotoGrid.vue";
import SelectedPhotoPreviewModal from "./create-task/SelectedPhotoPreviewModal.vue";
import type {
  DoubanAssetType,
  ImageCountMode,
  ImageAspectRatio,
  OutputImageFormat,
  RequestIntervalSeconds,
  RuntimeDiscoveredAsset,
  SelectableDoubanPhoto,
  SelectedDoubanPhoto,
  SelectedPhotoDownloadSeed,
  TaskDraft,
} from "../../types/app";
import {
  extractDetailUrlFromDisplayLine,
  formatDetailUrlDisplayLine,
  normalizeComparableDetailUrl,
  normalizeDetailUrlsInput,
  validateTaskDraftInput,
} from "../../lib/task-draft-input";
import { isDoubanEmptyCategoryMessage } from "../../lib/douban-empty-category";
import { runtimeBridge } from "../../lib/runtime-bridge";
import { useAppStore } from "../../stores/app";
import {
  createSelectedPhotoDiscoveryState,
  pickMoreCompleteTitle,
  selectedPhotoAssetTypes,
  selectedPhotoRenderBatchSize,
  titlePreviewResolveConcurrency,
} from "../composables/selected-photo-helpers";

const props = withDefaults(
  defineProps<{
    detailUrls?: string;
    selectedPhotoSeed?: SelectedPhotoDownloadSeed | null;
  }>(),
  {
    detailUrls: "",
    selectedPhotoSeed: null,
  },
);
const emit = defineEmits<{
  close: [];
  submit: [drafts: TaskDraft[], replacementTaskIds?: string[]];
  updateDetailUrls: [value: string];
}>();

const appStore = useAppStore();

// 表单状态保持字符串输入，提交前再统一校验和转换，便于给出明确的用户错误提示。
const form = reactive({
  detailUrls: props.detailUrls,
  outputRootDir: appStore.createTaskOutputRootDir,
  doubanAssetType: "still" as DoubanAssetType,
  imageCountMode: "limited" as ImageCountMode,
  maxImagesInput: "10",
  outputImageFormat: "jpg" as OutputImageFormat,
  imageAspectRatio: "original" as ImageAspectRatio,
  requestIntervalSeconds: "1" as "1" | "2" | "3" | "4" | "5",
});
const alertMessage = shallowRef("");
const alertRevision = shallowRef(0);
const pendingReplacementDrafts = ref<TaskDraft[]>([]);
const pendingReplacementTaskIds = ref<string[]>([]);
const replacementConfirmTitle = shallowRef("");
const browsingOutputDirectory = shallowRef(false);
const resolvedTitleCache = new Map<string, string>();
const activeMode = ref<"auto" | "selected">("auto");
const selectedPhotoLink = shallowRef("");
const selectedPhotoTitle = shallowRef("");
const selectedPhotoCover = shallowRef("");
const selectedPhotoCoverUrl = shallowRef("");
const selectedPhotoCoverDataUrl = shallowRef("");
const selectedPhotoPreviewSubjectUrl = shallowRef("");
const selectedPhotos = ref<SelectableDoubanPhoto[]>([]);
const selectedPhotoFilter = ref<DoubanAssetType>("still");
const discoveringSelectedPhotos = shallowRef(false);
const switchingSelectedPhotoFilter = shallowRef(false);
const selectedDiscoveryTaskId = shallowRef("");
const selectedPhotoDiscoveryStartedKey = shallowRef("");
const selectedPhotoLoadedUrls = ref(new Set<string>());
const selectedPhotoFailedUrls = ref(new Set<string>());
const selectedPhotoDiscoveryByAsset = ref(createSelectedPhotoDiscoveryState());
const selectedPhotoPreviewIndex = ref<number | null>(null);
const selectedPhotoLargeFailedIds = ref(new Set<string>());
const selectedPhotoVisibleLimit = ref(selectedPhotoRenderBatchSize);
const selectedPhotoGridLoadingRequested = shallowRef(false);
let titleResolveTimer: number | null = null;
let titleResolveRevision = 0;
let selectedPhotoAutoDiscoverTimer: number | null = null;
const stoppedSelectedDiscoveryTaskIds = new Set<string>();

function resetSelectedPhotoDiscoveryState() {
  selectedPhotoDiscoveryByAsset.value = createSelectedPhotoDiscoveryState();
}

function resolveNextSelectedPhotoAsset() {
  return selectedPhotoDiscoveryByAsset.value[selectedPhotoFilter.value].done ? null : selectedPhotoFilter.value;
}

function markAllSelectedPhotoDiscoveryDone() {
  selectedPhotoDiscoveryByAsset.value = selectedPhotoAssetTypes.reduce(
    (state, assetType) => {
      state[assetType] = { ...selectedPhotoDiscoveryByAsset.value[assetType], done: true };
      return state;
    },
    createSelectedPhotoDiscoveryState(),
  );
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, run: (item: T) => Promise<R>) {
  const results: R[] = [];
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function getDetailUrlDisplayEntries(value: string) {
  return normalizeDetailUrlsInput(value)
    .split(/\r?\n/g)
    .map((line) => {
      const normalizedLine = line.trim();
      const detailUrl = extractDetailUrlFromDisplayLine(normalizedLine);
      const urlIndex = detailUrl ? normalizedLine.indexOf(detailUrl) : -1;
      const titlePrefix = urlIndex > 0 ? normalizedLine.slice(0, urlIndex).replace(/[：:]\s*$/, "").trim() : "";
      return {
        line: normalizedLine,
        detailUrl,
        hasTitle: titlePrefix.length > 0,
      };
    })
    .filter((entry) => entry.line);
}

async function resolveMissingDetailUrlTitles() {
  titleResolveRevision += 1;
  const currentRevision = titleResolveRevision;
  const pendingUrls = new Map<string, string>();

  for (const entry of getDetailUrlDisplayEntries(form.detailUrls)) {
    if (!entry.detailUrl) continue;
    const comparableUrl = normalizeComparableDetailUrl(entry.detailUrl);
    const preview = appStore.getCreateTaskMoviePreview(entry.detailUrl);
    const hasPreviewCover = Boolean(preview?.coverDataUrl || preview?.coverUrl);
    const hasTitle = entry.hasTitle || resolvedTitleCache.has(comparableUrl);
    if (!comparableUrl || (hasTitle && hasPreviewCover)) continue;
    pendingUrls.set(comparableUrl, entry.detailUrl);
  }

  if (pendingUrls.size === 0) {
    return;
  }

  const resolvedPairs = await mapWithConcurrency(
    Array.from(pendingUrls.entries()),
    titlePreviewResolveConcurrency,
    async ([comparableUrl, detailUrl]) => {
      try {
        const preview = await runtimeBridge.resolveDoubanMoviePreview(detailUrl);
        return [comparableUrl, detailUrl, preview] as const;
      } catch {
        return [comparableUrl, detailUrl, null] as const;
      }
    },
  );

  if (currentRevision !== titleResolveRevision) {
    return;
  }

  for (const [comparableUrl, detailUrl, preview] of resolvedPairs) {
    if (!preview) continue;
    appStore.upsertCreateTaskMoviePreview(detailUrl, preview);
    if (preview.title) {
      resolvedTitleCache.set(comparableUrl, preview.title);
    }
  }

  let changed = false;
  const nextLines = getDetailUrlDisplayEntries(form.detailUrls).map((entry) => {
    if (!entry.detailUrl || entry.hasTitle) {
      return entry.line;
    }

    const title = resolvedTitleCache.get(normalizeComparableDetailUrl(entry.detailUrl));
    if (!title) {
      return entry.line;
    }

    changed = true;
    return formatDetailUrlDisplayLine(entry.detailUrl, title);
  });

  if (changed) {
    syncDetailUrls(nextLines.join("\n"));
  }
}
function scheduleMissingDetailUrlTitleResolution(delay = 500) {
  if (titleResolveTimer !== null) {
    window.clearTimeout(titleResolveTimer);
  }

  titleResolveTimer = window.setTimeout(() => {
    titleResolveTimer = null;
    void resolveMissingDetailUrlTitles();
  }, delay);
}

function clearSelectedPhotoAutoDiscoverTimer() {
  if (selectedPhotoAutoDiscoverTimer === null) return;
  window.clearTimeout(selectedPhotoAutoDiscoverTimer);
  selectedPhotoAutoDiscoverTimer = null;
}

function scheduleSelectedPhotoAutoDiscover(delay = 400) {
  clearSelectedPhotoAutoDiscoverTimer();
  selectedPhotoAutoDiscoverTimer = window.setTimeout(() => {
    selectedPhotoAutoDiscoverTimer = null;
    if (discoveringSelectedPhotos.value || switchingSelectedPhotoFilter.value) return;
    selectedPhotoFilter.value = "still";
    void discoverSelectedPhotos();
  }, delay);
}

watch(
  () => form.outputRootDir,
  (value) => appStore.syncCreateTaskOutputRootDir(value),
);

onBeforeUnmount(() => {
  if (titleResolveTimer !== null) {
    window.clearTimeout(titleResolveTimer);
  }
  clearSelectedPhotoAutoDiscoverTimer();
  void stopSelectedPhotoDiscovery();
  document.removeEventListener("keydown", handleSelectedPhotoPreviewKeydown);
});

onMounted(() => {
  document.addEventListener("keydown", handleSelectedPhotoPreviewKeydown);
});

watch(
  () => props.detailUrls,
  (value) => {
    if (value !== form.detailUrls) {
      form.detailUrls = value;
      scheduleMissingDetailUrlTitleResolution();
    }
  },
);

function syncDetailUrls(value: string) {
  form.detailUrls = value;
  emit("updateDetailUrls", value);
}
// 任务说明随表单实时计算，让用户在加入队列前确认抓取类型、数量和尺寸策略。
const strategySummary = computed(() => {
  const assetTypeLabel =
    form.doubanAssetType === "poster" ? "海报" : form.doubanAssetType === "wallpaper" ? "壁纸" : "剧照";
  const countSummary =
    form.imageCountMode === "unlimited" ? "不限制抓取数量" : `最多下载 ${form.maxImagesInput || 10} 张图片`;

  const ratioLabel = form.imageAspectRatio === "original" ? "原图尺寸" : form.imageAspectRatio;

  return `豆瓣抓图类型为${assetTypeLabel}，图片尺寸 ${ratioLabel}，请求间隔 ${form.requestIntervalSeconds} 秒；${countSummary}，并按当前表单配置加入队列`;
});

// 显示表单错误提示，阻止用户在校验失败时加入队列。
function showAlert(message: string) {
  alertMessage.value = message;
  alertRevision.value += 1;
}

// 清除表单提示，通常在用户重新输入或操作成功后调用。
function clearAlert() {
  alertMessage.value = "";
}

// 打开系统目录选择器，并把选择结果写回输出目录输入框。
async function browseOutputDirectory() {
  if (browsingOutputDirectory.value) return;

  browsingOutputDirectory.value = true;
  try {
    const selected = await runtimeBridge.pickOutputDirectory(form.outputRootDir);
    if (!selected) return;
    form.outputRootDir = selected;
    clearAlert();
  } finally {
    browsingOutputDirectory.value = false;
  }
}

// 把限制数量固定在 1 到 100 之间，避免输入过小或过大。
function clampMaxImages(value: number) {
  return Math.min(100, Math.max(1, value));
}

// 将数量输入框的字符串转换成可用于加减按钮的安全数字。
const currentMaxImagesValue = computed(() => {
  if (!/^\d+$/.test(form.maxImagesInput)) {
    return 10;
  }

  return clampMaxImages(Number(form.maxImagesInput));
});

// 数量拨轮减号是否可用，最小值为 1。
const canDecreaseMaxImages = computed(() => currentMaxImagesValue.value > 1);
// 数量拨轮加号是否可用，最大值为 100。
const canIncreaseMaxImages = computed(() => currentMaxImagesValue.value < 100);

const selectedPhotoStats = computed(() => {
  const counts: Record<DoubanAssetType, number> = { still: 0, poster: 0, wallpaper: 0 };
  const filtered: SelectableDoubanPhoto[] = [];
  let selectedCount = 0;
  let currentSelectedCount = 0;

  for (const photo of selectedPhotos.value) {
    counts[photo.doubanAssetType] += 1;
    if (photo.selected) selectedCount += 1;
    if (photo.doubanAssetType === selectedPhotoFilter.value) {
      filtered.push(photo);
      if (photo.selected) currentSelectedCount += 1;
    }
  }

  return { counts, filtered, selectedCount, currentSelectedCount };
});
const selectedPhotoCounts = computed(() => selectedPhotoStats.value.counts);
const filteredSelectedPhotos = computed(() => selectedPhotoStats.value.filtered);
const visibleSelectedPhotos = computed(() => {
  const filtered = filteredSelectedPhotos.value;
  return filtered.slice(0, selectedPhotoVisibleLimit.value);
});
const selectedPhotoCount = computed(() => selectedPhotoStats.value.selectedCount);
const currentSelectedPhotoCount = computed(() => selectedPhotoStats.value.currentSelectedCount);
const selectedPhotoDownloadLabel = computed(() =>
  selectedPhotoCount.value > 0 ? `下载选中 ${selectedPhotoCount.value} 张` : "请选择图片",
);
const selectedPhotoDiscoveryDone = computed(() =>
  selectedPhotoAssetTypes.every((assetType) => selectedPhotoDiscoveryByAsset.value[assetType].done),
);
const selectedPhotoDiscoveryBusy = computed(() => discoveringSelectedPhotos.value || switchingSelectedPhotoFilter.value);
const selectedPhotoCurrentFilterDone = computed(() => selectedPhotoDiscoveryByAsset.value[selectedPhotoFilter.value].done);
const showSelectedPhotoGridLoading = computed(
  () =>
    discoveringSelectedPhotos.value &&
    selectedPhotoGridLoadingRequested.value &&
    !selectedPhotoCurrentFilterDone.value &&
    filteredSelectedPhotos.value.length <= selectedPhotoVisibleLimit.value,
);
const selectedPhotoGridEmptyText = computed(() =>
  selectedPhotoCurrentFilterDone.value ? "该分类暂无可下载图片" : "输入链接后解析当前分类图片",
);
const selectedPhotoPreviewItems = computed(() => selectedPhotos.value);
const activeSelectedPhotoPreview = computed(() => {
  const index = selectedPhotoPreviewIndex.value;
  return index === null ? null : selectedPhotoPreviewItems.value[index] ?? null;
});

function resetSelectedPhotoGridPaging() {
  selectedPhotoVisibleLimit.value = selectedPhotoRenderBatchSize;
  selectedPhotoGridLoadingRequested.value = false;
}

function revealNextSelectedPhotoBatch() {
  if (filteredSelectedPhotos.value.length > selectedPhotoVisibleLimit.value) {
    selectedPhotoVisibleLimit.value += selectedPhotoRenderBatchSize;
    selectedPhotoGridLoadingRequested.value = false;
  }
}

function handleSelectedPhotoGridRequestNextBatch() {
  selectedPhotoGridLoadingRequested.value = true;
  revealNextSelectedPhotoBatch();
  requestNextSelectedPhotoBatch();
}

function requestNextSelectedPhotoBatch() {
  if (
    filteredSelectedPhotos.value.length <= selectedPhotoVisibleLimit.value &&
    !selectedPhotoCurrentFilterDone.value &&
    !discoveringSelectedPhotos.value
  ) {
    void loadNextSelectedPhotoBatch();
  }
}

async function setSelectedPhotoFilter(filter: DoubanAssetType) {
  if (filter === selectedPhotoFilter.value) return;
  selectedPhotoFilter.value = filter;
  resetSelectedPhotoGridPaging();
  switchingSelectedPhotoFilter.value = true;
  try {
    if (discoveringSelectedPhotos.value) {
      await stopSelectedPhotoDiscovery();
    }
    if (filteredSelectedPhotos.value.length <= selectedPhotoVisibleLimit.value && !selectedPhotoCurrentFilterDone.value) {
      selectedPhotoGridLoadingRequested.value = true;
      requestNextSelectedPhotoBatch();
    }
  } finally {
    switchingSelectedPhotoFilter.value = false;
  }
}

watch(
  () => filteredSelectedPhotos.value.length,
  () => {
    if (selectedPhotoGridLoadingRequested.value) {
      revealNextSelectedPhotoBatch();
    }
  },
);

function isSelectedPhotoLoaded(photo: SelectableDoubanPhoto) {
  return selectedPhotoLoadedUrls.value.has(getSelectedPhotoPreviewUrl(photo));
}

function isSelectedPhotoFailed(photo: SelectableDoubanPhoto) {
  return selectedPhotoFailedUrls.value.has(getSelectedPhotoPreviewUrl(photo));
}

function getSelectedPhotoPreviewUrl(photo: SelectableDoubanPhoto) {
  return photo.previewDataUrl || photo.previewUrl || photo.imageUrl;
}

function getSelectedPhotoLargePreviewUrl(photo: SelectableDoubanPhoto) {
  return selectedPhotoLargeFailedIds.value.has(photo.id) ? getSelectedPhotoPreviewUrl(photo) : photo.imageUrl;
}

function handleSelectedPhotoLargeError(photo: SelectableDoubanPhoto) {
  const failedIds = new Set(selectedPhotoLargeFailedIds.value);
  failedIds.add(photo.id);
  selectedPhotoLargeFailedIds.value = failedIds;
}

function closeSelectedPhotoPreview() {
  selectedPhotoPreviewIndex.value = null;
}

function openSelectedPhotoPreview(photoId: string) {
  const index = selectedPhotoPreviewItems.value.findIndex((photo) => photo.id === photoId);
  if (index >= 0) {
    selectedPhotoPreviewIndex.value = index;
  }
}

function stepSelectedPhotoPreview(delta: -1 | 1) {
  const total = selectedPhotoPreviewItems.value.length;
  const current = selectedPhotoPreviewIndex.value;
  if (total === 0 || current === null) return;
  selectedPhotoPreviewIndex.value = (current + delta + total) % total;
}

function handleSelectedPhotoPreviewKeydown(event: KeyboardEvent) {
  if (selectedPhotoPreviewIndex.value === null) return;
  if (event.key === "Escape") {
    closeSelectedPhotoPreview();
    return;
  }
  if (event.key === "ArrowLeft") {
    stepSelectedPhotoPreview(-1);
    return;
  }
  if (event.key === "ArrowRight") {
    stepSelectedPhotoPreview(1);
  }
}

function handleSelectedPhotoLoad(photo: SelectableDoubanPhoto) {
  const previewUrl = getSelectedPhotoPreviewUrl(photo);
  const loadedUrls = new Set(selectedPhotoLoadedUrls.value);
  const failedUrls = new Set(selectedPhotoFailedUrls.value);
  loadedUrls.add(previewUrl);
  failedUrls.delete(previewUrl);
  selectedPhotoLoadedUrls.value = loadedUrls;
  selectedPhotoFailedUrls.value = failedUrls;
}

function handleSelectedPhotoError(photo: SelectableDoubanPhoto) {
  const previewUrl = getSelectedPhotoPreviewUrl(photo);
  const loadedUrls = new Set(selectedPhotoLoadedUrls.value);
  const failedUrls = new Set(selectedPhotoFailedUrls.value);
  loadedUrls.delete(previewUrl);
  failedUrls.add(previewUrl);
  selectedPhotoLoadedUrls.value = loadedUrls;
  selectedPhotoFailedUrls.value = failedUrls;
}

const selectedDiscoveryStatusLabel = computed(() => {
  if (discoveringSelectedPhotos.value) {
    return selectedPhotos.value.length > 0
      ? `正在解析，已缓存 ${selectedPhotos.value.length} 张`
      : "正在解析当前分类...";
  }

  return selectedPhotos.value.length > 0 ? `已缓存 ${selectedPhotos.value.length} 张图片` : "";
});

function getUsableDoubanCookie() {
  return appStore.cookies.find((cookie) => cookie.source === "douban" && cookie.status !== "cooling" && cookie.value)?.value;
}

function normalizeSelectedPhotoUrl(value: string) {
  const detailUrl = extractDetailUrlFromDisplayLine(value.trim());
  if (!detailUrl) {
    throw new Error("请填写豆瓣影片链接。");
  }

  const parsed = new URL(detailUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "movie.douban.com") {
    throw new Error("只能填写 movie.douban.com 的影片链接。");
  }

  if (!/^\/subject\/\d+\/(?:all_photos\/?|photos\/?)?$/i.test(parsed.pathname)) {
    throw new Error("只支持 subject、all_photos 或 photos?type= 链接。");
  }

  return detailUrl;
}

function getSelectedPhotoSubjectUrl(detailUrl: string) {
  const parsed = new URL(detailUrl);
  const subjectId = parsed.pathname.match(/^\/subject\/(\d+)/i)?.[1];
  return subjectId ? `https://movie.douban.com/subject/${subjectId}/` : detailUrl;
}

function toSelectablePhoto(photo: SelectedDoubanPhoto): SelectableDoubanPhoto {
  return {
    ...photo,
    selected: false,
  };
}

function normalizeDiscoveredPhoto(photo: RuntimeDiscoveredAsset): SelectedDoubanPhoto {
  return {
    ...photo,
    doubanAssetType: photo.doubanAssetType ?? (photo.category === "poster" ? "poster" : "still"),
  };
}

function mergeSelectedDiscoveredPhotos(images: RuntimeDiscoveredAsset[]) {
  if (images.length === 0) return;

  const existingByUrl = new Map(selectedPhotos.value.map((photo) => [photo.imageUrl, photo]));
  const nextPhotos = [...selectedPhotos.value];

  for (const image of images) {
    const normalized = normalizeDiscoveredPhoto(image);
    const existing = existingByUrl.get(normalized.imageUrl);
    if (existing) {
      Object.assign(existing, {
        ...normalized,
        selected: existing.selected,
      });
      continue;
    }

    const nextPhoto = toSelectablePhoto(normalized);
    existingByUrl.set(nextPhoto.imageUrl, nextPhoto);
    nextPhotos.push(nextPhoto);
  }

  selectedPhotos.value = nextPhotos;
}

function handleSelectedPhotoLinkInput() {
  clearAlert();
  clearSelectedPhotoAutoDiscoverTimer();
  selectedPhotoTitle.value = "";
  selectedPhotoCover.value = "";
  selectedPhotoCoverUrl.value = "";
  selectedPhotoCoverDataUrl.value = "";
  selectedPhotoPreviewSubjectUrl.value = "";

  try {
    void resolveSelectedPhotoPreview(normalizeSelectedPhotoUrl(selectedPhotoLink.value));
    scheduleSelectedPhotoAutoDiscover();
  } catch {
    // 输入过程中链接可能还不完整，等用户补全后再解析预览。
  }
}

function isCurrentSelectedPhotoSubject(subjectUrl: string) {
  try {
    return getSelectedPhotoSubjectUrl(normalizeSelectedPhotoUrl(selectedPhotoLink.value)) === subjectUrl;
  } catch {
    return false;
  }
}

function applySelectedPhotoPreview(preview: { title?: string; coverUrl?: string; coverDataUrl?: string }) {
  selectedPhotoTitle.value = pickMoreCompleteTitle(selectedPhotoTitle.value, preview.title);
  selectedPhotoCoverUrl.value = selectedPhotoCoverUrl.value || preview.coverUrl || "";
  selectedPhotoCoverDataUrl.value = selectedPhotoCoverDataUrl.value || preview.coverDataUrl || "";
  selectedPhotoCover.value = selectedPhotoCover.value || selectedPhotoCoverDataUrl.value || selectedPhotoCoverUrl.value || "";
}

async function resolveSelectedPhotoPreview(detailUrl: string) {
  const subjectUrl = getSelectedPhotoSubjectUrl(detailUrl);
  const cachedPreview = appStore.getCreateTaskMoviePreview(subjectUrl);
  if (cachedPreview && isCurrentSelectedPhotoSubject(subjectUrl)) {
    selectedPhotoPreviewSubjectUrl.value = subjectUrl;
    applySelectedPhotoPreview(cachedPreview);
    if (selectedPhotoCover.value) return;
  }

  try {
    const preview = await runtimeBridge.resolveDoubanMoviePreview(subjectUrl);
    if (!preview) return;
    appStore.upsertCreateTaskMoviePreview(subjectUrl, preview);
    if (getSelectedPhotoSubjectUrl(normalizeSelectedPhotoUrl(selectedPhotoLink.value)) !== subjectUrl) return;
    selectedPhotoPreviewSubjectUrl.value = subjectUrl;
    applySelectedPhotoPreview(preview);
  } catch {
    // 预览信息只影响顶部展示，解析图片本身继续走原流程。
  }
}

function syncSelectedPhotoSeed(seed: SelectedPhotoDownloadSeed | null) {
  if (!seed) return;
  clearSelectedPhotoAutoDiscoverTimer();
  activeMode.value = "selected";
  selectedPhotoLink.value = seed.detailUrl;
  selectedPhotoTitle.value = seed.title ?? "";
  selectedPhotoCoverUrl.value = seed.coverUrl ?? "";
  selectedPhotoCoverDataUrl.value = seed.coverDataUrl ?? "";
  selectedPhotoCover.value = selectedPhotoCoverDataUrl.value || selectedPhotoCoverUrl.value;
  selectedPhotoPreviewSubjectUrl.value = getSelectedPhotoSubjectUrl(seed.detailUrl);
  selectedPhotos.value = [];
  selectedPhotoLoadedUrls.value = new Set();
  selectedPhotoFailedUrls.value = new Set();
  selectedPhotoLargeFailedIds.value = new Set();
  selectedPhotoPreviewIndex.value = null;
  selectedDiscoveryTaskId.value = "";
  resetSelectedPhotoDiscoveryState();
  selectedPhotoFilter.value = "still";
  resetSelectedPhotoGridPaging();
  clearAlert();

  const seedKey = `${seed.detailUrl}:${seed.title ?? ""}`;
  if (seed.autoDiscover && selectedPhotoDiscoveryStartedKey.value !== seedKey) {
    selectedPhotoDiscoveryStartedKey.value = seedKey;
    window.setTimeout(() => {
      void discoverSelectedPhotos();
    }, 0);
  }
}

watch(
  () => props.selectedPhotoSeed,
  (seed) => syncSelectedPhotoSeed(seed),
  { immediate: true },
);

// 数字拨轮点击一次只增加或减少 1，并同步清除旧错误提示。
function stepMaxImages(delta: -1 | 1) {
  form.maxImagesInput = String(clampMaxImages(currentMaxImagesValue.value + delta));
  clearAlert();
}

async function discoverSelectedPhotos() {
  let detailUrl = "";
  if (discoveringSelectedPhotos.value) return;

  try {
    detailUrl = normalizeSelectedPhotoUrl(selectedPhotoLink.value);
  } catch (error) {
    showAlert(error instanceof Error ? error.message : String(error));
    return;
  }

  const subjectUrl = getSelectedPhotoSubjectUrl(detailUrl);
  if (selectedPhotoPreviewSubjectUrl.value !== subjectUrl) {
    selectedPhotoTitle.value = "";
    selectedPhotoCover.value = "";
    selectedPhotoCoverUrl.value = "";
    selectedPhotoCoverDataUrl.value = "";
    selectedPhotoPreviewSubjectUrl.value = subjectUrl;
  }

  selectedPhotos.value = [];
  selectedPhotoLoadedUrls.value = new Set();
  selectedPhotoFailedUrls.value = new Set();
  selectedPhotoLargeFailedIds.value = new Set();
  selectedPhotoPreviewIndex.value = null;
  resetSelectedPhotoDiscoveryState();
  resetSelectedPhotoGridPaging();
  clearAlert();
  void resolveSelectedPhotoPreview(detailUrl);
  await loadNextSelectedPhotoBatch();
}

async function loadNextSelectedPhotoBatch() {
  if (discoveringSelectedPhotos.value || selectedPhotoDiscoveryDone.value) return;
  const doubanAssetType = resolveNextSelectedPhotoAsset();
  if (!doubanAssetType) return;

  let detailUrl = "";
  try {
    detailUrl = normalizeSelectedPhotoUrl(selectedPhotoLink.value);
  } catch (error) {
    showAlert(error instanceof Error ? error.message : String(error));
    return;
  }
  const subjectUrl = getSelectedPhotoSubjectUrl(detailUrl);

  const taskId = `selected-discovery-${Date.now()}`;
  selectedDiscoveryTaskId.value = taskId;
  stoppedSelectedDiscoveryTaskIds.delete(taskId);
  discoveringSelectedPhotos.value = true;
  clearAlert();
  try {
    const discovery = await runtimeBridge.discoverDoubanPhotos({
      taskId,
      detailUrl,
      outputRootDir: form.outputRootDir.trim() || "D:/cover",
      sourceHint: "auto",
      doubanAssetType,
      outputImageFormat: form.outputImageFormat,
      imageAspectRatio: form.imageAspectRatio,
      requestIntervalSeconds: Number(form.requestIntervalSeconds) as RequestIntervalSeconds,
      doubanCookie: getUsableDoubanCookie(),
      cursor: selectedPhotoDiscoveryByAsset.value[doubanAssetType].cursor,
      batchSize: selectedPhotoRenderBatchSize,
    });
    selectedPhotoTitle.value = pickMoreCompleteTitle(selectedPhotoTitle.value, discovery.normalizedTitle);
    appStore.upsertCreateTaskMoviePreview(subjectUrl, { title: selectedPhotoTitle.value });
    mergeSelectedDiscoveredPhotos(discovery.images);
    selectedPhotoDiscoveryByAsset.value = {
      ...selectedPhotoDiscoveryByAsset.value,
      [doubanAssetType]: {
        cursor: discovery.nextCursor,
        done: discovery.done,
      },
    };
    if (selectedPhotos.value.length === 0) {
      showAlert("没有解析到可下载图片。");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!stoppedSelectedDiscoveryTaskIds.has(taskId)) {
      if (isDoubanEmptyCategoryMessage(message)) {
        selectedPhotoDiscoveryByAsset.value = {
          ...selectedPhotoDiscoveryByAsset.value,
          [doubanAssetType]: {
            cursor: null,
            done: true,
          },
        };
        showAlert("没有解析到可下载图片。");
      } else {
        showAlert(`解析图片失败：${message}`);
      }
    }
  } finally {
    if (selectedDiscoveryTaskId.value === taskId) {
      discoveringSelectedPhotos.value = false;
      selectedDiscoveryTaskId.value = "";
      if (
        selectedPhotoGridLoadingRequested.value &&
        filteredSelectedPhotos.value.length === 0 &&
        !selectedPhotoCurrentFilterDone.value
      ) {
        window.setTimeout(requestNextSelectedPhotoBatch, 0);
      }
    }
    stoppedSelectedDiscoveryTaskIds.delete(taskId);
  }
}

function selectAllPhotos() {
  selectedPhotos.value = selectedPhotos.value.map((photo) =>
    photo.doubanAssetType === selectedPhotoFilter.value ? { ...photo, selected: true } : photo,
  );
}

function clearSelectedPhotos() {
  selectedPhotos.value = selectedPhotos.value.map((photo) =>
    photo.doubanAssetType === selectedPhotoFilter.value ? { ...photo, selected: false } : photo,
  );
}

async function stopSelectedPhotoDiscovery(markDone = false) {
  const taskId = selectedDiscoveryTaskId.value;
  if (!discoveringSelectedPhotos.value || !taskId) return;

  stoppedSelectedDiscoveryTaskIds.add(taskId);
  discoveringSelectedPhotos.value = false;
  if (markDone) {
    markAllSelectedPhotoDiscoveryDone();
  }
  try {
    await runtimeBridge.cancelDoubanPhotoDiscovery(taskId);
  } catch {
    // 解析进程可能已经自然结束；不阻塞用户下载已选图片。
  }
}

function buildSelectedPhotoDraft(): TaskDraft | null {
  let detailUrl = "";
  try {
    detailUrl = normalizeSelectedPhotoUrl(selectedPhotoLink.value);
  } catch (error) {
    showAlert(error instanceof Error ? error.message : String(error));
    return null;
  }

  const selectedImages = selectedPhotos.value
    .filter((photo) => photo.selected)
    .map(({ selected: _selected, previewDataUrl: _previewDataUrl, ...photo }) => photo);
  const selectedPhotoAssetType = selectedImages[0]?.doubanAssetType ?? selectedPhotoFilter.value;
  if (selectedImages.length === 0) {
    showAlert("请先勾选需要下载的图片。");
    return null;
  }

  if (!form.outputRootDir.trim()) {
    showAlert("请先填写输出目录。");
    return null;
  }

  return {
    detailUrl,
    outputRootDir: form.outputRootDir.trim(),
    sourceHint: "auto",
    doubanAssetType: selectedPhotoAssetType,
    imageCountMode: "limited",
    maxImages: selectedImages.length,
    outputImageFormat: form.outputImageFormat,
    imageAspectRatio: form.imageAspectRatio,
    requestIntervalSeconds: Number(form.requestIntervalSeconds) as RequestIntervalSeconds,
    coverUrl: (props.selectedPhotoSeed?.coverUrl ?? selectedPhotoCoverUrl.value) || undefined,
    coverDataUrl: (props.selectedPhotoSeed?.coverDataUrl ?? selectedPhotoCoverDataUrl.value) || undefined,
    selectedImages,
    selectedPhotoTitle: selectedPhotoTitle.value || undefined,
  };
}

async function prepareSelectedPhotoDownload() {
  const draft = buildSelectedPhotoDraft();
  if (!draft) {
    return false;
  }

  const duplicateTasks = appStore.findDuplicateTasksForDrafts([draft]);
  if (duplicateTasks.length === 0) {
    clearAlert();
    void stopSelectedPhotoDiscovery(true);
    emit("submit", [draft]);
    return false;
  }

  replacementConfirmTitle.value = "列表中任务已存在，是否覆盖目录并替换图片？";
  pendingReplacementDrafts.value = [draft];
  pendingReplacementTaskIds.value = Array.from(new Set(duplicateTasks.map((task) => task.id)));
  clearAlert();
  return true;
}

// 阻止 e、正负号、小数点等非整数输入进入数量输入框。
function handleMaxImagesKeydown(event: KeyboardEvent) {
  if (["e", "E", "+", "-", ".", ","].includes(event.key)) {
    event.preventDefault();
  }
}

// 实时记录数量输入内容，并在非数字时立即提示不能加入队列。
function handleMaxImagesInput(event: Event) {
  const input = event.target as HTMLInputElement;
  form.maxImagesInput = input.value;

  if (input.value && !/^\d+$/.test(input.value)) {
    showAlert("不能加入队列：数量限制填入文本类型错误，非数值类型。");
  } else {
    clearAlert();
  }
}

// 数量输入框失焦时把合法数字归一化到允许范围内。
function handleMaxImagesBlur(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!form.maxImagesInput || !/^\d+$/.test(form.maxImagesInput)) {
    return;
  }

  const normalized = clampMaxImages(Number(form.maxImagesInput));
  form.maxImagesInput = String(normalized);
  input.value = String(normalized);
}

// 粘贴多条链接时自动拆行，减少用户手工整理批量豆瓣链接的成本。
// 输入详情页链接时自动拆分连续 URL，并在用户继续输入时清理旧提示。
function handleDetailUrlsInput(event: Event) {
  const input = event.target as HTMLTextAreaElement;
  const protocolMatches = input.value.match(/https?:\/\//g) ?? [];
  if (protocolMatches.length < 2 && !/\shttps?:\/\//.test(input.value)) {
    syncDetailUrls(input.value);
    scheduleMissingDetailUrlTitleResolution();
    clearAlert();
    return;
  }

  const normalized = normalizeDetailUrlsInput(input.value);
  syncDetailUrls(normalized);
  input.value = normalized;
  scheduleMissingDetailUrlTitleResolution();
  clearAlert();
}

// 链接文本框失焦后统一规范化换行，保证提交时每行一个链接。
function handleDetailUrlsBlur(event: Event) {
  const input = event.target as HTMLTextAreaElement;
  const normalized = normalizeDetailUrlsInput(input.value);
  syncDetailUrls(normalized);
  input.value = normalized;
  void resolveMissingDetailUrlTitles();
}
function buildValidatedDrafts() {
  const validation = validateTaskDraftInput({
    detailUrls: form.detailUrls,
    outputRootDir: form.outputRootDir,
    imageCountMode: form.imageCountMode,
    maxImagesInput: form.maxImagesInput,
  });

  if (!validation.ok) {
    if (validation.message) {
      showAlert(validation.message);
    }
    return null;
  }

  const drafts: TaskDraft[] = [];
  for (const detailUrl of validation.detailUrls) {
    drafts.push({
      detailUrl,
      outputRootDir: form.outputRootDir.trim(),
      sourceHint: "auto",
      doubanAssetType: form.doubanAssetType,
      imageCountMode: form.imageCountMode,
      maxImages: validation.maxImages,
      outputImageFormat: form.outputImageFormat,
      imageAspectRatio: form.imageAspectRatio,
      requestIntervalSeconds: Number(form.requestIntervalSeconds) as RequestIntervalSeconds,
    });
  }

  return drafts;
}

// 加入队列前先检测重复任务；重复时打开气泡确认框，非重复则直接提交。
async function prepareSubmit() {
  await resolveMissingDetailUrlTitles();

  const drafts = buildValidatedDrafts();
  if (!drafts) {
    return false;
  }

  const duplicateTasks = appStore.findDuplicateTasksForDrafts(drafts);
  if (duplicateTasks.length === 0) {
    clearAlert();
    emit("submit", drafts);
    return false;
  }

  const duplicateTaskIds = new Set(duplicateTasks.map((task) => task.id));
  replacementConfirmTitle.value =
    `列表中任务已存在，是否覆盖目录并替换图片？`;
  pendingReplacementDrafts.value = drafts;
  pendingReplacementTaskIds.value = Array.from(duplicateTaskIds);
  clearAlert();
  return true;
}

function confirmReplacementSubmit() {
  clearAlert();
  if (activeMode.value === "selected") {
    void stopSelectedPhotoDiscovery(true);
  }
  emit("submit", pendingReplacementDrafts.value, pendingReplacementTaskIds.value);
  pendingReplacementDrafts.value = [];
  pendingReplacementTaskIds.value = [];
}

function cancelReplacementSubmit() {
  pendingReplacementDrafts.value = [];
  pendingReplacementTaskIds.value = [];
}
</script>

<template>
  <div class="modal-backdrop">
    <MessageNotice
      v-if="alertMessage"
      :key="`${alertRevision}:${alertMessage}`"
      :message="alertMessage"
      tone="warn"
      @close="clearAlert"
    />

    <section
      class="modal-card create-task-modal"
      :class="{ 'create-task-modal--auto': activeMode === 'auto', 'create-task-modal--selected': activeMode === 'selected' }"
    >
      <div class="panel__head modal-card__head">
        <div>
          <p class="eyebrow">New URL Task</p>
          <h3>添加下载任务</h3>
        </div>
        <button type="button" class="modal-close" aria-label="关闭弹窗" @click="emit('close')">
          ×
        </button>
      </div>

      <div class="mode-switch" aria-label="下载任务模式">
        <button
          type="button"
          class="mode-switch__item"
          :class="{ 'mode-switch__item--active': activeMode === 'auto' }"
          @click="activeMode = 'auto'"
        >
          自动下载
        </button>
        <button
          type="button"
          class="mode-switch__item"
          :class="{ 'mode-switch__item--active': activeMode === 'selected' }"
          @click="activeMode = 'selected'"
        >
          选图下载
        </button>
      </div>

      <div v-if="activeMode === 'auto'" class="create-task-modal__grid">
        <label class="field field--wide">
          <span>详情页链接（批量）</span>
          <textarea
            v-model="form.detailUrls"
            rows="5"
            wrap="off"
            placeholder="链接可自动换行，每行一个链接，例如：&#10;https://movie.douban.com/subject/35010610/&#10;https://movie.douban.com/subject/1292064/"
            @blur="handleDetailUrlsBlur"
            @input="handleDetailUrlsInput"
          />
        </label>

        <label class="field field--wide">
          <span>输出目录</span>
          <div class="field-inline">
            <input v-model="form.outputRootDir" placeholder="例如：D:\cover" />
            <ActionButton label="浏览" :disabled="browsingOutputDirectory" @click="void browseOutputDirectory()" />
          </div>
        </label>
        <label class="field">
          <span>输出格式</span>
          <select v-model="form.outputImageFormat">
            <option value="jpg">JPG</option>
            <option value="png">PNG</option>
          </select>
        </label>

        <label class="field">
          <span>请求间隔</span>
          <select v-model="form.requestIntervalSeconds">
            <option value="1">1 秒</option>
            <option value="2">2 秒</option>
            <option value="3">3 秒</option>
            <option value="4">4 秒</option>
            <option value="5">5 秒</option>
          </select>
        </label>

        <AutoDownloadStrategyPanel
          :douban-asset-type="form.doubanAssetType"
          :image-count-mode="form.imageCountMode"
          :max-images-input="form.maxImagesInput"
          :image-aspect-ratio="form.imageAspectRatio"
          :can-decrease-max-images="canDecreaseMaxImages"
          :can-increase-max-images="canIncreaseMaxImages"
          @select-asset-type="form.doubanAssetType = $event"
          @select-count-mode="form.imageCountMode = $event"
          @max-images-blur="handleMaxImagesBlur"
          @max-images-input="handleMaxImagesInput"
          @max-images-keydown="handleMaxImagesKeydown"
          @step-max-images="stepMaxImages"
          @select-aspect-ratio="form.imageAspectRatio = $event"
        />

        <label class="field field--wide">
          <span>任务说明</span>
          <input :value="strategySummary" disabled />
        </label>
      </div>

      <div v-if="activeMode === 'auto'" class="topbar__actions">
        <ActionButton label="取消" @click="emit('close')" />
        <PopConfirmAction
          label="加入队列"
          variant="primary"
          :title="replacementConfirmTitle"
          confirm-label="确认"
          cancel-label="取消"
          bubble-size="normal"
          :before-open="prepareSubmit"
          @confirm="confirmReplacementSubmit"
          @cancel="cancelReplacementSubmit"
        />
      </div>

      <div v-else class="selected-download">
        <section class="selected-download__hero">
          <div class="selected-download__cover">
            <img v-if="selectedPhotoCover" :src="selectedPhotoCover" :alt="selectedPhotoTitle || '影片封面'" />
            <span v-else class="selected-download__cover-placeholder">封面</span>
          </div>
          <div class="selected-download__link">
            <label class="field">
              <span>豆瓣图片链接</span>
              <div class="field-inline">
                <input
                  v-model="selectedPhotoLink"
                  :disabled="selectedPhotoDiscoveryBusy"
                  placeholder="支持 subject / all_photos / photos?type= 链接"
                  @input="handleSelectedPhotoLinkInput"
                />
              </div>
            </label>
            <p class="selected-download__title">{{ selectedPhotoTitle || "等待解析影片图片" }}</p>
          </div>
        </section>

        <section class="selected-download__library">
          <div class="selected-download__summary">
            <div>
              <span>当前分类</span>
              <strong>共 {{ filteredSelectedPhotos.length }} 张 / 当前已选 {{ currentSelectedPhotoCount }} 张</strong>
            </div>
            <div class="selected-download__bulk">
              <ActionButton label="全选" size="sm" :disabled="filteredSelectedPhotos.length === 0" @click="selectAllPhotos" />
              <ActionButton label="取消全选" size="sm" :disabled="currentSelectedPhotoCount === 0" @click="clearSelectedPhotos" />
            </div>
          </div>

          <p v-if="selectedDiscoveryStatusLabel" class="selected-download__status">
            <span>{{ selectedDiscoveryStatusLabel }}</span>
            <span v-if="discoveringSelectedPhotos" class="selected-spin selected-spin--inline" aria-label="正在加载">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </span>
          </p>

          <SelectedPhotoCategoryTabs
            :active-type="selectedPhotoFilter"
            :counts="selectedPhotoCounts"
            @select="void setSelectedPhotoFilter($event)"
          />

          <div v-if="discoveringSelectedPhotos && filteredSelectedPhotos.length === 0" class="selected-download__empty">正在解析当前分类，发现后会立即显示...</div>
          <SelectedPhotoGrid
            v-else
            :photos="selectedPhotos"
            :visible-photos="visibleSelectedPhotos"
            :show-loading="showSelectedPhotoGridLoading"
            :empty-text="selectedPhotoGridEmptyText"
            :is-photo-loaded="isSelectedPhotoLoaded"
            :is-photo-failed="isSelectedPhotoFailed"
            :get-preview-url="getSelectedPhotoPreviewUrl"
            @update-photos="selectedPhotos = $event"
            @request-next-batch="handleSelectedPhotoGridRequestNextBatch"
            @photo-load="handleSelectedPhotoLoad"
            @photo-error="handleSelectedPhotoError"
            @open-preview="openSelectedPhotoPreview"
          />
        </section>

        <section class="selected-download__bar">
          <label class="field selected-download__output">
            <span>输出目录</span>
            <div class="field-inline">
              <input v-model="form.outputRootDir" placeholder="例如：D:\cover" />
              <ActionButton label="浏览" :disabled="browsingOutputDirectory" @click="void browseOutputDirectory()" />
            </div>
          </label>

          <div class="selected-download__settings">
            <label class="field">
              <span>图片尺寸</span>
              <select v-model="form.imageAspectRatio">
                <option value="original">原图尺寸</option>
                <option value="9:16">9:16</option>
                <option value="3:4">3:4</option>
              </select>
            </label>
            <label class="field">
              <span>输出格式</span>
              <select v-model="form.outputImageFormat">
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
              </select>
            </label>
            <label class="field">
              <span>请求间隔</span>
              <select v-model="form.requestIntervalSeconds">
                <option value="1">1 秒</option>
                <option value="2">2 秒</option>
                <option value="3">3 秒</option>
                <option value="4">4 秒</option>
                <option value="5">5 秒</option>
              </select>
            </label>
          </div>

          <div class="topbar__actions selected-download__actions">
            <ActionButton label="取消" @click="emit('close')" />
            <PopConfirmAction
              :label="selectedPhotoDownloadLabel"
              variant="primary"
              :title="replacementConfirmTitle"
              confirm-label="确认"
              cancel-label="取消"
              bubble-size="normal"
              :disabled="selectedPhotoCount === 0"
              :before-open="prepareSelectedPhotoDownload"
              @confirm="confirmReplacementSubmit"
              @cancel="cancelReplacementSubmit"
            />
          </div>
        </section>
      </div>
    </section>

    <SelectedPhotoPreviewModal
      :photo="activeSelectedPhotoPreview"
      :image-url="activeSelectedPhotoPreview ? getSelectedPhotoLargePreviewUrl(activeSelectedPhotoPreview) : ''"
      :current-index="selectedPhotoPreviewIndex"
      :total="selectedPhotoPreviewItems.length"
      @close="closeSelectedPhotoPreview"
      @step="stepSelectedPhotoPreview"
      @image-error="handleSelectedPhotoLargeError"
    />
  </div>
</template>

<style scoped>
.modal-backdrop {
  overflow: hidden;
}

.create-task-modal {
  width: min(1180px, calc(100dvw - 48px));
  min-width: 0;
  max-height: calc(100dvh - 48px);
  overflow: auto;
  overscroll-behavior: contain;
}

.create-task-modal--auto {
  overflow: auto;
}

.create-task-modal--selected {
  display: grid;
  grid-template-rows: auto auto auto;
  align-content: start;
  height: calc(100dvh - 48px);
  overflow-x: hidden;
  overflow-y: auto;
}

.mode-switch {
  display: inline-flex;
  justify-self: start;
  width: max-content;
  max-width: 100%;
  gap: 8px;
  padding: 5px;
  margin-bottom: 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.mode-switch__item {
  min-width: 116px;
  height: 40px;
  padding: 0 18px;
  border-radius: 12px;
  color: var(--muted);
  background: transparent;
}

.mode-switch__item--active {
  color: #031113;
  background: linear-gradient(135deg, var(--accent), #7ce5c9);
}

.selected-download {
  display: grid;
  grid-template-rows: auto minmax(360px, 1fr) auto;
  gap: 14px;
  min-height: 780px;
  min-width: 0;
  overflow: visible;
}

.selected-download__hero {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
  min-width: 0;
}

.selected-download__cover {
  width: 72px;
  height: 96px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
}

.selected-download__cover img,
.selected-download__cover-placeholder {
  width: 100%;
  height: 100%;
  display: block;
}

.selected-download__cover img {
  object-fit: cover;
}

.selected-download__cover-placeholder {
  display: grid;
  place-items: center;
  color: rgba(179, 219, 214, 0.66);
  font-size: 0.78rem;
  letter-spacing: 0;
  background:
    linear-gradient(135deg, rgba(100, 221, 203, 0.12), rgba(255, 255, 255, 0.035)),
    rgba(8, 28, 31, 0.72);
}

.selected-download__link {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.selected-download__title {
  color: var(--muted);
}

.selected-download__library {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: rgba(3, 10, 13, 0.28);
}

.selected-download__summary {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
}

.selected-download__summary div:first-child {
  display: grid;
  gap: 2px;
}

.selected-download__summary span,
.selected-download__title {
  color: var(--muted);
  font-size: 0.9rem;
}

.selected-download__status {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  min-height: 20px;
  color: var(--accent);
  font-size: 0.86rem;
}

.selected-spin {
  position: relative;
  display: inline-block;
  color: var(--accent);
  animation: selected-spin-rotate 1.05s linear infinite;
}

.selected-spin span {
  position: absolute;
  width: 32%;
  height: 32%;
  border-radius: 999px;
  background: currentColor;
  opacity: 1;
}

.selected-spin span:nth-child(1) {
  top: 0;
  left: 50%;
  transform: translateX(-50%);
}

.selected-spin span:nth-child(2) {
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  opacity: 0.72;
}

.selected-spin span:nth-child(3) {
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  opacity: 0.46;
}

.selected-spin span:nth-child(4) {
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  opacity: 0.24;
}

.selected-spin--inline {
  width: 14px;
  height: 14px;
}

.selected-download__bulk,
.selected-download__settings {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

@keyframes selected-spin-rotate {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .selected-spin {
    animation: none;
  }
}

.selected-download__empty {
  grid-row: 4;
  min-height: 0;
  height: 100%;
  padding: 24px 12px;
  display: grid;
  align-self: stretch;
  place-items: center;
  color: var(--muted);
  text-align: center;
}

.selected-download__bar {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 14px;
  align-items: end;
  min-width: 0;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  background: var(--panel);
  box-shadow: 0 -10px 22px rgba(2, 9, 12, 0.28);
}

.selected-download__output {
  min-width: 0;
}

.selected-download__settings .field {
  min-width: 120px;
}

.selected-download__actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.selected-download .field-inline {
  min-width: 0;
}

.selected-download__link .field-inline {
  grid-template-columns: minmax(0, 1fr);
}

.selected-download .field-inline .action-btn {
  white-space: nowrap;
}

.create-task-modal__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  margin-bottom: 10px;
}

.create-task-modal textarea {
  height: 108px;
  min-height: 108px;
  line-height: 1.25;
  white-space: pre;
  overflow-x: auto;
}

@media (max-width: 1480px) {
  .create-task-modal__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

}

@media (max-width: 1280px) {
  .selected-download__bar {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "output output"
      "settings actions";
  }

  .selected-download__output {
    grid-area: output;
  }

  .selected-download__settings {
    grid-area: settings;
  }

  .selected-download__actions {
    grid-area: actions;
  }

  .selected-download__settings,
  .selected-download__actions {
    justify-content: flex-start;
  }
}

@media (max-width: 980px) {
  .create-task-modal__grid {
    grid-template-columns: 1fr;
  }

  .selected-download .field-inline {
    grid-template-columns: 1fr;
  }

  .selected-download__bar {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "output"
      "settings"
      "actions";
  }

  .selected-download__hero {
    grid-template-columns: 1fr;
  }
}

@media (max-height: 900px) {
  .create-task-modal {
    padding: 16px;
    border-radius: 22px;
  }

  .create-task-modal .modal-card__head {
    margin-bottom: 10px;
  }

  .create-task-modal h3 {
    font-size: 1.16rem;
  }

  .mode-switch {
    margin-bottom: 8px;
  }

  .selected-download {
    gap: 10px;
  }

  .selected-download__hero {
    gap: 10px;
  }

  .selected-download__cover {
    width: 58px;
    height: 76px;
    border-radius: 10px;
  }

  .selected-download__link {
    gap: 4px;
  }

  .selected-download__library {
    gap: 8px;
    padding: 10px;
    border-radius: 16px;
  }

  .selected-download__bar {
    gap: 10px;
    padding-top: 8px;
  }

  .selected-download__settings {
    gap: 8px;
  }

  .selected-download__settings .field {
    min-width: 104px;
  }

  .create-task-modal textarea {
    height: 88px;
    min-height: 88px;
  }

}
</style>
