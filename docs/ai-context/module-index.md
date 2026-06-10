# 模块索引

本文列出 AI 常用定位入口。修改代码前仍要读取相关源码，不能只按索引推断实现。

## 前端层

| 文件 | 责任 | 常见触发任务 |
| --- | --- | --- |
| `apps/desktop/src/stores/app.ts` | 核心 Pinia store；任务队列、Cookie、日志、弹窗开关、持久化、队列调度、重复任务检测 | 队列、任务状态、Cookie 冷却、持久化、弹窗打开方式 |
| `apps/desktop/src/lib/runtime-bridge.ts` | 前端和 Tauri command/event 统一桥接；网页预览降级实现 | 新增系统能力、改 Tauri command 名称、事件订阅 |
| `apps/desktop/src/types/app.ts` | 前端任务、Cookie、日志、运行时 payload 类型 | 新增状态字段、跨层 payload、持久化 schema |
| `apps/desktop/src/layouts/AppShell.vue` | 应用骨架和全局弹窗挂载 | 新增/移动全局弹窗 |
| `apps/desktop/src/views/ControlCenterView.vue` | 控制中心入口布局 | 首页按钮、控制中心区域排版 |
| `apps/desktop/src/views/LogCenterView.vue` | 日志中心页面 | 日志列表入口、过滤展示 |

## 前端队列和弹窗

| 文件 | 责任 | 常见触发任务 |
| --- | --- | --- |
| `apps/desktop/src/components/queue/CreateTaskModal.vue` | 添加下载任务弹窗；自动下载、选图下载、重复任务覆盖确认 | 链接输入、选图下载、分类切换、滚动解析、提交下载 |
| `apps/desktop/src/components/queue/create-task/AutoDownloadStrategyPanel.vue` | 自动下载模式配置面板 | 图片类型、数量、尺寸、格式、请求间隔 |
| `apps/desktop/src/components/queue/create-task/SelectedPhotoCategoryTabs.vue` | 选图分类 tabs | 剧照/海报/壁纸分类切换 |
| `apps/desktop/src/components/queue/create-task/SelectedPhotoGrid.vue` | 选图图片网格；懒加载、选择、拖拽框选、触底请求 | 单击选择、框选、loading/失败占位、滚动加载 |
| `apps/desktop/src/components/queue/create-task/SelectedPhotoPreviewModal.vue` | 选中图片大图预览 | 双击预览、左右切换、键盘关闭 |
| `apps/desktop/src/components/queue/SearchMovieModal.vue` | 豆瓣搜索影视弹窗；页级缓存、结果操作 | 搜索结果、分页器、添加链接、选图下载入口 |
| `apps/desktop/src/components/queue/TaskTable.vue` | 下载队列表格、任务操作、输出目录入口 | 暂停、继续、重试、删除、打开目录、进度展示 |
| `apps/desktop/src/components/queue/CustomCropModal.vue` | 自定义裁剪弹窗 | 上传/拖拽读取、本地图片裁剪、保存 |
| `apps/desktop/src/components/queue/ImageProcessModal.vue` | 图片处理大弹窗 | 拼版、背景、透明度、标注、导出 |

## 前端工具和测试

| 文件 | 责任 |
| --- | --- |
| `apps/desktop/src/lib/queue-runtime.ts` | 队列运行时辅助逻辑 |
| `apps/desktop/src/lib/task-draft-input.ts` | 任务草稿输入解析 |
| `apps/desktop/src/lib/task-order.ts` | 任务排序 |
| `apps/desktop/src/lib/task-pagination.ts` | 任务分页 |
| `apps/desktop/src/lib/presenters.ts` | 展示格式化 |
| `apps/desktop/src/lib/douban-empty-category.ts` | 豆瓣空分类提示解析 |
| `apps/desktop/src/components/composables/selected-photo-helpers.ts` | 选图下载辅助函数 |
| `apps/desktop/src/components/composables/useSelectedPhotoGridSelection.ts` | 选图网格选择/框选逻辑 |
| `apps/desktop/src/components/composables/useImageProcess*.ts` | 图片处理弹窗状态和标注逻辑 |
| `apps/desktop/src/test/**` | 前端 Vitest 测试 |

## Tauri/Rust 层

主要文件：`apps/desktop/src-tauri/src/lib.rs`。

这个文件较大，读代码时按命令或功能块定位：

| 区域/函数 | 责任 |
| --- | --- |
| `load_persisted_state` / `save_persisted_state` | 读取/保存前端完整状态快照，Rust 内部拆分到 SQLite |
| `write_snapshot_to_sqlite` / `load_snapshot_from_sqlite` | SQLite 表读写和快照重建 |
| `migrate_json_snapshot_if_needed` | 旧版 `runtime-state.json` 首次迁移 |
| `rotate_corrupted_state_db` | SQLite 损坏备份和恢复 |
| `run_download_task` / `run_download_task_blocking` | 自动下载任务，启动 sidecar |
| `run_selected_photo_download` | 选图下载任务，写入 selected images payload 文件后启动 sidecar |
| `discover_douban_photos` / `discover_douban_photos_blocking` | 选图发现任务，按 cursor/batch 返回图片 |
| `search_douban_movies` | 豆瓣影视搜索 |
| `resolve_douban_movie_title` / `resolve_douban_movie_preview` | 手动链接的标题/封面预览解析 |
| `pause_download_task` / `resume_download_task` / `clear_download_tasks` | 任务控制文件和进程取消 |
| `delete_directory_path` / `clear_directory_contents` | 输出目录删除/清理，带边界校验 |
| `read_local_image_file` / `read_dropped_image_file` | 本地图片读取；前者绑定输出根目录，后者用于显式拖拽 |
| `save_custom_cropped_image` / `save_processed_image` | 图片处理结果写入本地 |
| `parse_sidecar_stdout_line` / `parse_douban_photos_discover_stdout_line` | sidecar 结构化 stdout 解析和 Tauri 事件转发 |
| `generate_handler!` | 前端可调用 command 注册表；新增 command 必须登记 |

Rust 测试也在同一文件底部，重点覆盖 SQLite、Cookie 保护、目录边界、本地图片读取和任务控制。

## sidecar 层

| 文件 | 责任 | 常见触发任务 |
| --- | --- | --- |
| `apps/sidecar/src/index.ts` | sidecar 入口；解析环境变量；按 `MCD_COMMAND` 分派搜索、标题、选图发现、选图下载、自动下载 | 新增命令、改 payload 环境变量、改命令分派 |
| `apps/sidecar/src/services/scheduler.ts` | 自动下载任务编排：discover -> download | 下载队列任务行为 |
| `apps/sidecar/src/services/matcher.ts` | 根据任务选择 adapter；当前只注册 `DoubanAdapter` | 新增站点、改发现入口 |
| `apps/sidecar/src/adapters/douban.ts` | 豆瓣详情页、图片分类页、分页/游标解析、预览 data URL | 解析不到图片、空分类、选图批次、豆瓣页面结构变化 |
| `apps/sidecar/src/services/downloader.ts` | 图片下载、断点续传、格式转换、裁剪、保存、进度上报 | 下载失败、图片格式、尺寸比例、续传 |
| `apps/sidecar/src/services/douban-search.ts` | 豆瓣搜索页解析 | 搜索结果缺失、封面/简介解析 |
| `apps/sidecar/src/services/douban-title.ts` | 豆瓣详情页标题和封面预览解析 | 手动粘贴链接后的标题/封面 |
| `apps/sidecar/src/services/cookie-pool.ts` | sidecar 内 Cookie 读取和站点分发 | Cookie 是否传入真实请求 |
| `apps/sidecar/src/services/task-control.ts` | sidecar 安全点暂停/取消读取 | 暂停、继续、取消 |
| `apps/sidecar/src/services/resume-store.ts` | 断点续传元数据 | `.part` 和 resume metadata |
| `apps/sidecar/src/shared/contracts.ts` | sidecar 任务、发现、下载、进度契约 | 跨层类型变更 |
| `apps/sidecar/src/shared/logger.ts` | stdout 结构化日志和任务进度事件 | 日志/进度事件格式 |
| `apps/sidecar/src/shared/runtime-config.ts` | sidecar 运行配置 | batch/concurrency/output 默认值 |
| `apps/sidecar/src/utils/source-detector.ts` | 豆瓣图片分类入口 URL 生成 | subject/all_photos/photos 链接改写 |
| `apps/sidecar/src/utils/output-folder.ts` | 输出目录和文件名生成 | 输出目录命名、图片比例目录 |

## 构建和打包

| 文件 | 责任 |
| --- | --- |
| `package.json` | 根 workspace 脚本入口 |
| `apps/desktop/package.json` | 桌面端脚本、Vite/Tauri 开发构建入口 |
| `apps/sidecar/package.json` | sidecar 构建、测试、类型检查 |
| `apps/desktop/src-tauri/tauri.conf.json` | Tauri 窗口、bundle、resources 配置 |
| `scripts/prepare-sidecar-bundle.ps1` | 打包前准备 sidecar dist、Node、依赖和资源 |
| `apps/desktop/src-tauri/Cargo.toml` | Rust/Tauri 依赖 |

## 常见验证命令

```bash
pnpm --dir apps/desktop exec vue-tsc --noEmit
pnpm --dir apps/sidecar typecheck
pnpm --dir apps/desktop test
pnpm --dir apps/sidecar test
cd apps/desktop/src-tauri
cargo check
```

如果只改文档，通常不需要跑类型检查；但要检查新增链接、章节锚点和路径是否真实。
