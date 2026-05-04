/// <reference types="vite/client" />
// Vite 与 Vue 单文件组件的全局类型补充，保证 TypeScript 能识别运行时环境。

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}
