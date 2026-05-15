<script setup lang="ts">
// 桌面端主框架：侧边栏、顶栏、弹窗和页面内容在这里组合。
import { computed, ref, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppSidebar from "../components/chrome/AppSidebar.vue";
import AppTopbar from "../components/chrome/AppTopbar.vue";
import ImportCookieModal from "../components/cookies/ImportCookieModal.vue";
import ToastNotice from "../components/common/ToastNotice.vue";
import CreateTaskModal from "../components/queue/CreateTaskModal.vue";
import CustomCropModal from "../components/queue/CustomCropModal.vue";
import ImageProcessModal from "../components/queue/ImageProcessModal.vue";
import SearchMovieModal from "../components/queue/SearchMovieModal.vue";
import { useAppStore } from "../stores/app";
import type { CookieDraft, TaskDraft, TopAction } from "../types/app";

const route = useRoute();
const appStore = useAppStore();
const noticeRevision = ref(0);

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
  void appStore.triggerAction(actionId);
}

// 新增链接任务弹窗提交后，把校验完成的草稿交给队列 store 创建任务。
function handleCreateTask(drafts: TaskDraft[], replacementTaskIds?: string[]) {
  void appStore.createTasks(drafts, { replacementTaskIds });
}

// 手动 Cookie 导入弹窗提交后，交给 store 保存 Cookie 并写日志。
function handleImportCookieManual(draft: CookieDraft) {
  void appStore.importCookie(draft);
}

// 自动登录导入入口：打开豆瓣登录窗口并等待 Cookie 可用。
function handleStartLoginImport() {
  void appStore.startDoubanLoginImport();
}

watch(
  () => appStore.notice,
  (value) => {
    if (value) {
      noticeRevision.value += 1;
    }
  },
);
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
        :pending-action-ids="appStore.pendingActionIds"
        @action="handleAction"
      />

      <section class="view-stage">
        <RouterView />
      </section>

      <ToastNotice
        v-if="appStore.notice"
        :key="noticeRevision"
        :message="appStore.notice.message"
        :tone="appStore.notice.tone"
        @close="appStore.clearNotice"
      />
    </main>
  </div>

  <CreateTaskModal
    v-if="appStore.createTaskOpen"
    :detail-urls="appStore.createTaskDetailUrls"
    :selected-photo-seed="appStore.selectedPhotoDownloadSeed"
    @close="appStore.closeCreateTask"
    @submit="handleCreateTask"
    @update-detail-urls="appStore.syncCreateTaskDetailUrls"
  />


  <SearchMovieModal
    v-if="appStore.searchMovieOpen"
    @close="appStore.closeSearchMovie"
  />

  <CustomCropModal
    v-if="appStore.customCropOpen"
    :output-root-dir="appStore.customCropOutputRootDir"
    @close="appStore.closeCustomCrop"
  />
  <ImageProcessModal
    v-if="appStore.imageProcessOpen"
    :output-root-dir="appStore.imageProcessOutputRootDir"
    @close="appStore.closeImageProcess"
    @update-output-root-dir="appStore.syncImageProcessOutputRootDir"
  />
  <ImportCookieModal
    v-if="appStore.importCookieOpen"
    @close="appStore.closeImportCookie"
    @submit-manual="handleImportCookieManual"
    @start-login-import="handleStartLoginImport"
  />
</template>
