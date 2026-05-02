import { createRouter, createWebHistory } from "vue-router";
import AppShell from "../layouts/AppShell.vue";
import ControlCenterView from "../views/ControlCenterView.vue";
import LogCenterView from "../views/LogCenterView.vue";
import type { TopAction } from "../types/app";

type RouteMetaPayload = Record<PropertyKey, unknown> & {
  eyebrow: string;
  title: string;
  description: string;
  actions: TopAction[];
};

const makeMeta = (meta: RouteMetaPayload) => meta;

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      component: AppShell,
      children: [
        {
          path: "",
          redirect: "/control",
        },
        {
          path: "control",
          component: ControlCenterView,
          meta: makeMeta({
            eyebrow: "Control / Queue",
            title: "控制中心",
            description: "集中处理链接任务、下载队列和 Cookie。",
            actions: [],
          }),
        },
        {
          path: "logs",
          component: LogCenterView,
          meta: makeMeta({
            eyebrow: "Observability / Logs",
            title: "日志中心",
            description: "实时显示解析、下载、重试和 Cookie 日志。",
            actions: [],
          }),
        },
      ],
    },
  ],
});

export default router;
