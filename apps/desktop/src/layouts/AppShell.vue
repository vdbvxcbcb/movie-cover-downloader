<script setup lang="ts">
// 桌面端主框架：侧边栏、顶栏、弹窗和页面内容在这里组合。
import { computed, watch, shallowRef } from "vue";
import { storeToRefs } from "pinia";
import { RouterView, useRoute } from "vue-router";
import AppSidebar from "../components/chrome/AppSidebar.vue";
import AppTopbar from "../components/chrome/AppTopbar.vue";
import ImportCookieModal from "../components/cookies/ImportCookieModal.vue";
import ExpiredCookiePromptModal from "../components/cookies/ExpiredCookiePromptModal.vue";
import ToastNotice from "../components/common/ToastNotice.vue";
import CreateTaskModal from "../components/queue/CreateTaskModal.vue";
import CustomCropModal from "../components/queue/CustomCropModal.vue";
import ImageProcessModal from "../components/queue/ImageProcessModal.vue";
import SearchMovieModal from "../components/queue/SearchMovieModal.vue";
import MovieDetailModal from "../components/queue/movie-details/MovieDetailModal.vue";
import { useAppStore } from "../stores/app";
import { useUI } from "../stores/ui";
import { useMovieDetails } from "../stores/movieDetails";
import type { CookieDraft, TaskDraft, TopAction } from "../types/app";

const route = useRoute();
const appStore = useAppStore();
const uiStore = useUI();
const movieDetailsStore = useMovieDetails();
const noticeRevision = shallowRef(0);

const {
  notice,
  pendingActionIds,
  createTaskOpen,
  createTaskDetailUrls,
  selectedPhotoDownloadSeed,
  importCookieOpen,
  searchMovieOpen,
  customCropOpen,
  customCropOutputRootDir,
  imageProcessOpen,
  imageProcessOutputRootDir,
  expiredCookiePromptOpen,
  expiredCookieCount,
  expiredCookieExpiresAt,
} = storeToRefs(uiStore);
const {
  isOpen: movieDetailsOpen,
  loading: movieDetailsLoading,
  details: movieDetails,
  errorMessage: movieDetailsError,
  currentSeed: movieDetailsSeed,
} = storeToRefs(movieDetailsStore);

const {
  clearNotice,
  closeCreateTask,
  closeImportCookie,
  closeSearchMovie,
  closeCustomCrop,
  closeImageProcess,
  closeExpiredCookiePrompt,
  openLoginFromExpiredPrompt,
  syncCreateTaskDetailUrls,
  syncImageProcessOutputRootDir,
} = uiStore;

const { triggerAction, createTasks, importCookie, startDoubanLoginImport } = appStore;

// 根据当前路由 meta 计算页面标题、副标题和顶栏操作按钮。
const pageMeta = computed(() => {
  const meta = route.meta as {
    eyebrow?: string;
    title?: string;
    description?: string;
    actions?: TopAction[];
  };

  return {
    eyebrow: meta.eyebrow ?? "Desktop App",
    title: meta.title ?? "影视封面下载器",
    description: meta.description ?? "",
    actions: meta.actions ?? [],
  };
});

// 顶栏按钮统一入口：不同 actionId 会打开对应弹窗或交给 store 处理。
function handleAction(actionId: string) {
  void triggerAction(actionId);
}

// 新增链接任务弹窗提交后，把校验完成的草稿交给队列 store 创建任务。
function handleCreateTask(drafts: TaskDraft[], replacementTaskIds?: string[]) {
  void createTasks(drafts, { replacementTaskIds });
}

// 手动 Cookie 导入弹窗提交后，交给 store 保存 Cookie 并写日志。
function handleImportCookieManual(draft: CookieDraft) {
  void importCookie(draft);
}

// 自动登录导入入口：打开豆瓣登录窗口并等待 Cookie 可用。
function handleStartLoginImport() {
  void startDoubanLoginImport();
}

watch(notice, (value) => {
  if (value) {
    noticeRevision.value += 1;
  }
});
</script>

<template>
  <div class="shell">
    <AppSidebar />

    <main class="workspace">
      <AppTopbar
        :eyebrow="pageMeta.eyebrow"
        :title="pageMeta.title"
        :description="pageMeta.description"
        :actions="pageMeta.actions"
        :pending-action-ids="pendingActionIds"
        @action="handleAction"
      />

      <section class="view-stage">
        <RouterView />
      </section>

      <ToastNotice
        v-if="notice"
        :key="noticeRevision"
        :message="notice.message"
        :tone="notice.tone"
        @close="clearNotice"
      />
    </main>
  </div>

  <CreateTaskModal
    v-if="createTaskOpen"
    :detail-urls="createTaskDetailUrls"
    :selected-photo-seed="selectedPhotoDownloadSeed"
    @close="closeCreateTask"
    @submit="handleCreateTask"
    @update-detail-urls="syncCreateTaskDetailUrls"
  />


  <SearchMovieModal
    v-if="searchMovieOpen"
    @close="closeSearchMovie"
  />

  <CustomCropModal
    v-if="customCropOpen"
    :output-root-dir="customCropOutputRootDir"
    @close="closeCustomCrop"
  />
  <ImageProcessModal
    v-if="imageProcessOpen"
    :output-root-dir="imageProcessOutputRootDir"
    @close="closeImageProcess"
    @update-output-root-dir="syncImageProcessOutputRootDir"
  />
  <ImportCookieModal
    v-if="importCookieOpen"
    @close="closeImportCookie"
    @submit-manual="handleImportCookieManual"
    @start-login-import="handleStartLoginImport"
  />

  <ExpiredCookiePromptModal
    v-if="expiredCookiePromptOpen"
    :count="expiredCookieCount"
    :latest-expires-at="expiredCookieExpiresAt"
    @close="closeExpiredCookiePrompt"
    @open-login="openLoginFromExpiredPrompt"
  />

  <MovieDetailModal
    v-if="movieDetailsOpen"
    :details="movieDetails"
    :seed="movieDetailsSeed"
    :loading="movieDetailsLoading"
    :error-message="movieDetailsError"
    @close="movieDetailsStore.closeDetails"
    @retry="movieDetailsStore.retry"
  />
</template>
