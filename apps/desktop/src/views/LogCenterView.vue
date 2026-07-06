<script setup lang="ts">
// 日志中心页面：展示运行日志，并提供错误过滤与清空操作。
import ActionButton from "../components/common/ActionButton.vue";
import LogConsole from "../components/logs/LogConsole.vue";
import PanelSection from "../components/common/PanelSection.vue";
import PopConfirmAction from "../components/common/PopConfirmAction.vue";
import { useLogs } from "../stores/logs";
import { useUI } from "../stores/ui";
import { useAppStore } from "../stores/app";
import { storeToRefs } from "pinia";

const logsStore = useLogs();
const uiStore = useUI();
const appStore = useAppStore();

const { logs, visibleLogs, logOnlyErrors } = storeToRefs(logsStore);
const { toggleLogOnlyErrors } = logsStore;
const { isActionPending } = uiStore;
const { clearAllLogs } = appStore;
</script>

<template>
  <div class="view-stack">
    <PanelSection eyebrow="Log Center" title="日志中心">
      <template #aside>
        <div class="topbar__actions">
          <ActionButton
            :label="logOnlyErrors ? '显示全部日志' : '仅看错误'"
            @click="toggleLogOnlyErrors()"
          />
          <PopConfirmAction
            label="清空全部日志"
            title="清空全部日志？"
            description="日志记录会被清空。"
            confirm-label="清空"
            bubble-size="normal"
            :disabled="isActionPending('logs.clear-all')"
            @confirm="void clearAllLogs()"
          />
        </div>
      </template>

      <div class="control-toolbar">
        <div class="control-pill">
          <span>日志数</span>
          <strong>{{ logs.length }}</strong>
        </div>
        <div class="control-pill">
          <span>显示模式</span>
          <strong>{{ logOnlyErrors ? "仅错误" : "全部" }}</strong>
        </div>
        <div class="control-pill">
          <span>同步状态</span>
          <strong>实时</strong>
        </div>
      </div>
    </PanelSection>

    <PanelSection eyebrow="Realtime" title="实时日志">
      <LogConsole :entries="visibleLogs" scrollable />
    </PanelSection>
  </div>
</template>
