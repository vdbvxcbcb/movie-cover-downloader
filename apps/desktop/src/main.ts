// 前端应用入口：挂载 Vue、Pinia 和路由。
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import "./styles.css";

createApp(App).use(createPinia()).use(router).mount("#app");
