<script setup lang="ts">
// 豆瓣影片搜索弹窗：输入片名后通过 Tauri 调用 sidecar 搜索，并把详情页链接写入新增任务草稿。
import { computed, ref } from "vue";
import ActionButton from "../common/ActionButton.vue";
import MessageNotice from "../common/MessageNotice.vue";
import PopConfirmAction from "../common/PopConfirmAction.vue";
import { runtimeBridge } from "../../lib/runtime-bridge";
import { normalizeComparableDetailUrl } from "../../lib/task-draft-input";
import { useAppStore } from "../../stores/app";
import type { DoubanSearchResultItem, DoubanSearchResultPage } from "../../types/app";

const emit = defineEmits<{
  close: [];
}>();

const appStore = useAppStore();
const queryInput = ref("");
const currentPage = ref(1);
const loading = ref(false);
const alertMessage = ref("");
const alertTone = ref<"success" | "error" | "warn">("warn");
const alertRevision = ref(0);
const searchAttempted = ref(false);
const searchPage = ref<DoubanSearchResultPage | null>(null);
const searchPageCache = new Map<string, DoubanSearchResultPage>();
const addedDetailUrlSet = computed(() =>
  new Set(
    appStore.createTaskDetailUrls
      .split(/\r?\n/)
      .map((line) => normalizeComparableDetailUrl(line))
      .filter(Boolean),
  ),
);

// 搜索结果总页数由豆瓣返回的 total 和固定 pageSize 计算；只有多页时才显示分页器。
const totalPages = computed(() => {
  if (!searchPage.value || searchPage.value.pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(searchPage.value.total / searchPage.value.pageSize));
});

const hasSearched = computed(() => searchPage.value !== null || searchAttempted.value);

// 分页按钮只显示当前页附近的页码，避免结果很多时按钮挤满弹窗底部。
const visiblePages = computed(() => {
  const total = totalPages.value;
  const current = currentPage.value;
  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
});

function clearAlert() {
  alertMessage.value = "";
}

function showAlert(message: string, tone: "success" | "error" | "warn" = "warn") {
  alertMessage.value = message;
  alertTone.value = tone;
  alertRevision.value += 1;
}

function getCoverSource(item: DoubanSearchResultItem) {
  return item.coverDataUrl ?? item.coverUrl;
}

function buildSearchCacheKey(query: string, page: number) {
  return `${query.trim().toLocaleLowerCase()}:${Math.max(1, page)}`;
}

// 封面图加载失败时隐藏图片，保留统一占位，避免破图影响列表观感。
function handleCoverError(event: Event) {
  const image = event.target as HTMLImageElement;
  image.style.display = "none";
}

function isLinkAdded(item: DoubanSearchResultItem) {
  return addedDetailUrlSet.value.has(normalizeComparableDetailUrl(item.detailUrl));
}

function getUsableDoubanCookie() {
  const now = Date.now();
  return appStore.cookies.find((cookie) => {
    const coolingUntil = cookie.coolingUntil ? Date.parse(cookie.coolingUntil) : 0;
    const expiresAt = cookie.expiresAt ? Date.parse(cookie.expiresAt) : Number.POSITIVE_INFINITY;
    return (
      cookie.source === "douban" &&
      cookie.status !== "cooling" &&
      (!Number.isFinite(coolingUntil) || coolingUntil <= now) &&
      (!Number.isFinite(expiresAt) || expiresAt > now) &&
      cookie.value
    );
  })?.value;
}

function addDetailUrl(item: DoubanSearchResultItem) {
  if (isLinkAdded(item)) {
    return;
  }

  const added = appStore.addCreateTaskDetailUrl(item.detailUrl, item.title, {
    detailUrl: item.detailUrl,
    title: item.title,
    coverUrl: item.coverUrl,
    coverDataUrl: item.coverDataUrl,
  });
  if (added) {
    showAlert(`已添加到${item.title}链接到新增链接抓图任务。`, "success");
  }
}

function openSelectedPhotoDownload(item: DoubanSearchResultItem) {
  appStore.openSelectedPhotoDownload({
    detailUrl: item.detailUrl,
    title: item.title,
    coverUrl: item.coverUrl,
    coverDataUrl: item.coverDataUrl,
    autoDiscover: true,
  });
  emit("close");
}

function removeDetailUrl(item: DoubanSearchResultItem) {
  appStore.removeCreateTaskDetailUrl(item.detailUrl);
  showAlert("已从新增链接抓图任务中删除。", "success");
}

// 组装搜索请求：query 只取用户输入片名，cat=1002 和 start/pageSize 在 sidecar 内固定处理。
async function search(page = 1) {
  if (loading.value) return;

  const query = queryInput.value.trim();
  if (!query) {
    searchPage.value = null;
    searchAttempted.value = true;
    showAlert("请输入要搜索的影片名称");
    return;
  }

  const doubanCookie = getUsableDoubanCookie();
  if (!doubanCookie) {
    searchPage.value = null;
    searchAttempted.value = true;
    showAlert("请先导入可用的豆瓣 Cookie 后再搜索影片。", "error");
    return;
  }

  const cacheKey = buildSearchCacheKey(query, page);
  const cachedPage = searchPageCache.get(cacheKey);
  if (cachedPage) {
    searchPage.value = cachedPage;
    searchAttempted.value = true;
    currentPage.value = cachedPage.page;
    clearAlert();
    return;
  }

  loading.value = true;
  clearAlert();
  try {
    const result = await runtimeBridge.searchDoubanMovies(query, page, doubanCookie);
    searchPageCache.set(cacheKey, result);
    searchPage.value = result;
    searchAttempted.value = true;
    currentPage.value = result.page;
    if (result.items.length === 0) {
      showAlert("没有找到匹配的影片结果");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    searchPage.value = null;
    searchAttempted.value = true;
    showAlert(`搜索失败：${message}`, "error");
  } finally {
    loading.value = false;
  }
}

function submitSearch() {
  void search(1);
}

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value || page === currentPage.value || loading.value) {
    return;
  }

  void search(page);
}

function resultKey(item: DoubanSearchResultItem) {
  return `${item.id}-${item.detailUrl}`;
}
</script>

<template>
  <div class="modal-backdrop">
    <MessageNotice
      v-if="alertMessage"
      :key="`${alertRevision}:${alertMessage}`"
      :message="alertMessage"
      :tone="alertTone"
      @close="clearAlert"
    />

    <section class="modal-card search-movie-modal">
      <div class="panel__head modal-card__head">
        <div>
          <p class="eyebrow">Douban Movie Search</p>
          <h3>搜索影片</h3>
        </div>
        <button type="button" class="modal-close" aria-label="关闭弹窗" @click="emit('close')">
          ×
        </button>
      </div>

      <form class="search-movie-modal__form" @submit.prevent="submitSearch">
        <label class="field search-movie-modal__field">
          <span>影片名称</span>
          <div class="search-movie-modal__searchbar">
            <input
              v-model="queryInput"
              type="text"
              placeholder="请输入片名"
              :disabled="loading"
              @input="clearAlert"
            />
            <button type="submit" class="action-btn action-btn--primary" :disabled="loading">{{ loading ? "搜索中" : "搜索" }}</button>
          </div>
        </label>
      </form>

      <div class="search-movie-modal__body">
        <div v-if="loading" class="search-movie-modal__empty">正在搜索豆瓣电影...</div>
        <div v-else-if="searchPage?.items.length" class="search-result-list">
          <article v-for="item in searchPage.items" :key="resultKey(item)" class="search-result-row">
            <div class="search-result-row__cover" aria-hidden="true">
              <img v-if="getCoverSource(item)" :src="getCoverSource(item)" :alt="item.title" @error="handleCoverError" />
              <span v-else>无封面</span>
            </div>
            <div class="search-result-row__content">
              <div class="search-result-row__head">
                <strong>{{ item.title }}</strong>
                <div class="search-result-row__actions">
                  <ActionButton label="选图下载" size="sm" @click="openSelectedPhotoDownload(item)" />
                  <ActionButton :label="isLinkAdded(item) ? '完成添加' : '添加链接'" size="sm" :disabled="isLinkAdded(item)" @click="addDetailUrl(item)" />
                  <PopConfirmAction
                    label="删除链接"
                    size="sm"
                    title="删除已添加链接？"
                    description="该链接已添加，是否删除？"
                    confirm-label="删除"
                    :disabled="!isLinkAdded(item)"
                    @confirm="removeDetailUrl(item)"
                  />
                </div>
              </div>
              <p>{{ item.description || "暂无介绍" }}</p>
            </div>
          </article>
        </div>
        <div v-else-if="hasSearched" class="search-movie-modal__empty">暂无搜索结果</div>
        <div v-else class="search-movie-modal__empty">输入片名后开始搜索</div>
      </div>

      <div v-if="searchPage && totalPages > 1" class="search-movie-modal__pager" aria-label="搜索结果分页">
        <button type="button" :disabled="currentPage <= 1 || loading" @click="goToPage(currentPage - 1)">上一页</button>
        <button
          v-for="page in visiblePages"
          :key="page"
          type="button"
          :class="{ 'search-movie-modal__pager-active': page === currentPage }"
          :disabled="loading"
          @click="goToPage(page)"
        >
          {{ page }}
        </button>
        <button type="button" :disabled="currentPage >= totalPages || loading" @click="goToPage(currentPage + 1)">下一页</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.search-movie-modal {
  width: min(900px, 100%);
  max-height: calc(100vh - 48px);
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.search-movie-modal__form {
  margin-bottom: 14px;
}

.search-movie-modal__field {
  gap: 8px;
}

.search-movie-modal__searchbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: stretch;
}

.search-movie-modal__body {
  min-height: 360px;
  max-height: min(58vh, 620px);
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(3, 10, 13, 0.28);
}

.search-result-list {
  display: grid;
  gap: 0;
}

.search-result-row {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 14px;
  padding: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.search-result-row:last-child {
  border-bottom: 0;
}

.search-result-row__cover {
  width: 74px;
  height: 104px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  font-size: 0.78rem;
}

.search-result-row__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.search-result-row__content {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
}

.search-result-row__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.search-result-row__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.search-result-row__content strong {
  color: var(--text);
  line-height: 1.35;
}

.search-result-row__content p {
  color: var(--muted);
  line-height: 1.65;
  word-break: break-word;
}

.search-movie-modal__empty {
  min-height: 360px;
  display: grid;
  place-items: center;
  color: var(--muted);
}

.search-movie-modal__pager {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding-top: 14px;
}

.search-movie-modal__pager button {
  min-width: 40px;
  height: 40px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
}

.search-movie-modal__pager button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.search-movie-modal__pager button:not(:disabled):hover,
.search-movie-modal__pager-active {
  color: #031113 !important;
  border-color: transparent !important;
  background: linear-gradient(135deg, var(--accent), #7ce5c9) !important;
}

@media (max-width: 720px) {
  .search-movie-modal__searchbar,
  .search-result-row__head {
    grid-template-columns: 1fr;
  }

  .search-result-row {
    grid-template-columns: 62px minmax(0, 1fr);
  }

  .search-result-row__cover {
    width: 62px;
    height: 88px;
  }

  .search-result-row__actions {
    justify-content: flex-start;
  }
}
</style>

