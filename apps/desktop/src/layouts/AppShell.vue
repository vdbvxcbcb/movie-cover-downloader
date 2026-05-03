<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppSidebar from "../components/chrome/AppSidebar.vue";
import AppTopbar from "../components/chrome/AppTopbar.vue";
import ImportCookieModal from "../components/cookies/ImportCookieModal.vue";
import ToastNotice from "../components/common/ToastNotice.vue";
import CreateTaskModal from "../components/queue/CreateTaskModal.vue";
import CustomCropModal from "../components/queue/CustomCropModal.vue";
import { useAppStore } from "../stores/app";
import type { CookieDraft, TaskDraft, TopAction } from "../types/app";

const route = useRoute();
const appStore = useAppStore();

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

function handleAction(actionId: string) {
  void appStore.triggerAction(actionId);
}

function handleCreateTask(drafts: TaskDraft[]) {
  void appStore.createTasks(drafts);
}

function handleImportCookieManual(draft: CookieDraft) {
  void appStore.importCookie(draft);
}

function handleStartLoginImport() {
  void appStore.startDoubanLoginImport();
}

watch(
  () => appStore.notice,
  (value) => {
    if (!value) return;
    const timer = window.setTimeout(() => {
      appStore.clearNotice();
      window.clearTimeout(timer);
    }, 2800);
  },
  { deep: true },
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
        :message="appStore.notice.message"
        :tone="appStore.notice.tone"
        @close="appStore.clearNotice"
      />
    </main>
  </div>

  <CreateTaskModal
    v-if="appStore.createTaskOpen"
    @close="appStore.closeCreateTask"
    @submit="handleCreateTask"
  />


  <CustomCropModal
    v-if="appStore.customCropOpen"
    :output-root-dir="appStore.customCropOutputRootDir"
    @close="appStore.closeCustomCrop"
  />
  <ImportCookieModal
    v-if="appStore.importCookieOpen"
    @close="appStore.closeImportCookie"
    @submit-manual="handleImportCookieManual"
    @start-login-import="handleStartLoginImport"
  />
</template>
