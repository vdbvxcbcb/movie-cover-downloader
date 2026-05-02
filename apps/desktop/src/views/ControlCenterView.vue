<script setup lang="ts">
import { storeToRefs } from "pinia";
import ActionButton from "../components/common/ActionButton.vue";
import PanelSection from "../components/common/PanelSection.vue";
import PopConfirmAction from "../components/common/PopConfirmAction.vue";
import StatusPill from "../components/common/StatusPill.vue";
import TaskTable from "../components/queue/TaskTable.vue";
import { describeCookieStatus, formatCookieExpiry, formatSourceSite } from "../lib/presenters";
import { useAppStore } from "../stores/app";

const appStore = useAppStore();
const { tasks, cookies, queueRunning } = storeToRefs(appStore);
</script>

<template>
  <div class="view-stack">
    <PanelSection eyebrow="Control Center" title="控制中心">
      <template #aside>
        <div class="topbar__actions">
          <ActionButton
            label="1、导入Cookie"
            :disabled="appStore.isActionPending('cookies.import')"
            @click="void appStore.importCookie()"
          />
          <ActionButton label="2、添加链接任务" @click="appStore.openCreateTask()" />
          <PopConfirmAction
            label="3、清空队列任务"
            title="清空全部任务？"
            description="队列记录和已生成的本地输出目录会一起删除。"
            confirm-label="清空"
            bubble-size="normal"
            :disabled="appStore.isActionPending('queue.clear-all')"
            @confirm="void appStore.clearQueueTasks()"
          />
        </div>
      </template>

      <div class="control-toolbar">
        <div class="control-pill">
          <span>任务数</span>
          <strong>{{ tasks.length }}</strong>
        </div>
        <div class="control-pill">
          <span>Cookie 数</span>
          <strong>{{ cookies.length }}</strong>
        </div>
        <div class="control-pill">
          <span>队列状态</span>
          <strong>{{ queueRunning ? "处理中" : "空闲" }}</strong>
        </div>
      </div>
    </PanelSection>

    <PanelSection eyebrow="Queue" title="下载队列">
      <TaskTable
        :tasks="tasks"
        @retry="void appStore.retryTask($event)"
        @pause="void appStore.pauseTask($event)"
        @resume="void appStore.resumeTask($event)"
        @remove="void appStore.deleteTask($event)"
        @open-output="void appStore.openTaskOutputDirectory($event)"
      />
    </PanelSection>

    <PanelSection eyebrow="Cookies" title="Cookie 列表">
      <div class="cookie-compact-list">
        <article v-for="cookie in cookies" :key="cookie.id" class="cookie-compact-row">
          <div class="cookie-compact-main">
            <div class="cookie-compact-head">
              <strong>#{{ cookie.id }}</strong>
              <span>{{ formatSourceSite(cookie.source) }}</span>
            </div>
            <p>{{ cookie.note }}</p>
            <p>有效期至 {{ formatCookieExpiry(cookie) }}</p>
          </div>

          <div class="cookie-compact-side">
            <StatusPill :label="describeCookieStatus(cookie).label" :tone="describeCookieStatus(cookie).tone" />
            <PopConfirmAction
              label="删除"
              size="sm"
              title="删除这个 Cookie？"
              description="Cookie 记录会被删除。"
              confirm-label="删除"
              @confirm="void appStore.deleteCookie(cookie.id)"
            />
          </div>
        </article>
      </div>
    </PanelSection>
  </div>
</template>
