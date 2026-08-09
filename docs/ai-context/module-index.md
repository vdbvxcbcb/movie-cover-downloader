# 模块索引

本文列出 AI 常用定位入口。修改代码前仍要读取相关源码，不能只按索引推断实现。

## 前端层

| 文件 | 责任 | 常见触发任务 |
| --- | --- | --- |
| `apps/desktop/src/stores/app.ts` | 主 Pinia store 协调层；启动恢复、持久化调度、组合子 store、任务动作和队列封面回写 | 应用启动、快照保存/加载、跨 store 协作、封面持久化 |
| `apps/desktop/src/stores/app-helpers.ts` | store 辅助函数；状态快照、任务恢复、持久化错误提示 | 持久化字段、恢复逻辑、启动后任务状态 |
| `apps/desktop/src/stores/taskQueue.ts` | 任务队列、运行状态、队列配置、重复任务检测 | 队列调度、任务状态、重复选图任务判断 |
| `apps/desktop/src/stores/taskActions.ts` | 任务动作；创建、暂停、继续、重试、删除、清空、打开输出目录，并按规范化详情 URL 匹配封面预览 | 队列操作、下载执行、任务生命周期、创建任务封面 |
| `apps/desktop/src/stores/cookies.ts` | Cookie 状态；导入、可用性、冷却、失效、优先级 | Cookie 导入、冷却、反爬错误处理 |
| `apps/desktop/src/stores/logs.ts` | 运行日志状态 | 日志追加、清空、持久化 |
| `apps/desktop/src/stores/ui.ts` | UI 状态；弹窗开关、输出目录、全局提示 | 弹窗打开方式、Notice/Toast、输出目录记忆 |
| `apps/desktop/src/stores/movieDetails.ts` | 影片详情状态；500ms 防抖、内存缓存、在途请求复用、请求竞争和重试 | 封面点击反馈、详情加载、快速切换影片、缓存行为 |
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
| `apps/desktop/src/components/queue/create-task/SelectedPhotoPreviewModal.vue` | 选中图片大图预览；分辨率和近似常用比例 | 双击预览、左右切换、尺寸/比例、键盘关闭 |
| `apps/desktop/src/components/queue/SearchMovieModal.vue` | 豆瓣搜索影视弹窗；页级缓存、结果操作 | 搜索结果、分页器、添加链接、选图下载入口 |
| `apps/desktop/src/components/queue/TaskTable.vue` | 下载队列表格、任务操作、输出目录入口 | 暂停、继续、重试、删除、打开目录、进度展示 |
| `apps/desktop/src/components/queue/CustomCropModal.vue` | 自定义裁剪弹窗 | 上传/拖拽读取、本地图片裁剪、保存 |
| `apps/desktop/src/components/queue/ImageProcessModal.vue` | 图片处理大弹窗；编排拼版、画布预览、前景/背景图层、标注和 Canvas 导出 | 拼版交互、旋转、图层选择、预览/导出一致性 |
| `apps/desktop/src/components/queue/movie-details/MovieDetailModal.vue` | 共用影片详情弹窗；字段、评分、主演折叠、简介复制和错误状态 | 详情布局、字段顺序、封面兜底、复制简介、关闭/重试 |

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
| `apps/desktop/src/composables/useCookieNormalization.ts` | Cookie 输入标准化 |
| `apps/desktop/src/composables/useDoubanFailureClassifier.ts` | 豆瓣失败/风控/空分类错误分类 |
| `apps/desktop/src/composables/useTaskComparison.ts` | 任务重复和比较辅助 |
| `apps/desktop/src/composables/useTaskOutputDirectory.ts` | 任务输出目录辅助 |
| `apps/desktop/src/components/composables/useSelectedPhotoGridSelection.ts` | 选图网格选择/框选逻辑 |
| `apps/desktop/src/components/composables/useImageProcessLayoutState.ts` | 默认单图布局、可见格子和随画布预览比例变化的导出尺寸 |
| `apps/desktop/src/components/composables/useImageProcessSlotImages.ts` | 前景图批量拖入、换格、缩放、90 度旋转、受限平移和异步拖入竞态保护 |
| `apps/desktop/src/components/composables/useImageProcessBackgroundPlacement.ts` | 背景图等比完整显示、30%-100% 缩放和画布边界内拖动 |
| `apps/desktop/src/components/composables/useImageProcessAnnotations.ts` | 文字/形状标注、多行文字、对齐参考线、清除和最多 50 步撤销历史 |
| `apps/desktop/src/components/queue/image-process/__tests__/*.spec.ts` | 图片处理组件与 composable 回归测试 |
| `apps/desktop/src/**/__tests__/*.spec.ts` | 当前主要前端 Vitest 测试，按源码目录就近放置 |
| `apps/desktop/src/**/*.{test,spec}.ts` | Vitest 配置允许的补充测试入口 |

## Tauri/Rust 层

**重构后的模块化结构**（lib.rs 已从 3562 行减少到 857 行）：

### 核心入口

| 文件 | 责任 |
| --- | --- |
| `apps/desktop/src-tauri/src/lib.rs` | Tauri 应用入口；注册所有命令和状态管理；已模块化，只保留 main 和 tests |

### 基础模块

| 文件 | 责任 |
| --- | --- |
| `apps/desktop/src-tauri/src/constants.rs` | 应用常量：日志种子、请求间隔限制、状态库版本、创建窗口标志 |
| `apps/desktop/src-tauri/src/types.rs` | 类型定义：TableName enum、任务 payload、登录窗口状态、日志事件 |
| `apps/desktop/src-tauri/src/utils.rs` | 工具函数：任务 ID 校验、时间戳、hex 编解码、文件名清理、阻塞任务执行 |
| `apps/desktop/src-tauri/src/crypto.rs` | Windows DPAPI 加密：Cookie 加密保护、序列化反序列化 |
| `apps/desktop/src-tauri/src/task_control.rs` | 任务控制注册表：暂停/继续/取消、控制文件管理、进程终止 |

### SQLite 模块

| 文件 | 责任 |
| --- | --- |
| `apps/desktop/src-tauri/src/sqlite/mod.rs` | 模块导出 |
| `apps/desktop/src-tauri/src/sqlite/connection.rs` | 数据库连接：打开、初始化、错误检测、损坏备份 |
| `apps/desktop/src-tauri/src/sqlite/state.rs` | 状态读写：快照写入/加载、表计数、日志种子恢复 |
| `apps/desktop/src-tauri/src/sqlite/migration.rs` | 数据迁移：JSON 到 SQLite 迁移、损坏恢复 |

### Sidecar 模块

| 文件 | 责任 |
| --- | --- |
| `apps/desktop/src-tauri/src/sidecar/mod.rs` | 模块导出 |
| `apps/desktop/src-tauri/src/sidecar/runtime.rs` | 运行时管理：sidecar 路径解析、请求间隔控制、错误格式化 |
| `apps/desktop/src-tauri/src/sidecar/parser.rs` | 输出解析：stdout/stderr、日志/进度/结果提取；非零退出时优先透传 stderr 或 stdout 中最后一条结构化错误消息 |
| `apps/desktop/src-tauri/src/sidecar/download.rs` | 下载执行：下载任务阻塞执行、豆瓣图片发现 |
| `apps/desktop/src-tauri/src/sidecar/douban.rs` | 豆瓣操作：搜索、标题解析、预览解析、影片详情 sidecar 调用 |

### Commands 模块

| 文件 | 责任 |
| --- | --- |
| `apps/desktop/src-tauri/src/commands/mod.rs` | 命令模块导出 |
| `apps/desktop/src-tauri/src/commands/state.rs` | 状态命令：load_persisted_state、save_persisted_state、emit_runtime_log |
| `apps/desktop/src-tauri/src/commands/login.rs` | 登录命令：check_login_window_cookie_status、close_login_window |
| `apps/desktop/src-tauri/src/commands/task.rs` | 任务命令：暂停/继续/清理、下载、发现、搜索、标题/封面和影片详情解析 |
| `apps/desktop/src-tauri/src/commands/fs.rs` | 文件系统命令：目录删除/清空、目录选择、打开目录、定位文件 |
| `apps/desktop/src-tauri/src/commands/image.rs` | 图片命令：读取本地/拖拽图片、保存裁剪/处理结果 |

### 测试

Rust 测试主要在 `lib.rs` 底部，重点覆盖：
- SQLite 状态库恢复
- Cookie 加密保护
- 目录边界校验
- 本地图片读取权限
- 任务控制注册表

前端测试已经迁移到 Vitest 4 + happy-dom，常用入口：

- `apps/desktop/src/stores/__tests__/app.spec.ts`
- `apps/desktop/src/stores/__tests__/taskQueue.spec.ts`
- `apps/desktop/src/stores/__tests__/cookies.spec.ts`
- `apps/desktop/src/stores/__tests__/logs.spec.ts`
- `apps/desktop/src/stores/__tests__/ui.spec.ts`
- `apps/desktop/src/components/queue/create-task/__tests__/*.spec.ts`
- `apps/desktop/src/components/__tests__/*.spec.ts`
- `apps/desktop/src/lib/__tests__/*.spec.ts`

## sidecar 层

| 文件 | 责任 | 常见触发任务 |
| --- | --- | --- |
| `apps/sidecar/src/index.ts` | sidecar 入口；解析环境变量；按 `MCD_COMMAND` 分派搜索、标题、影片详情、选图发现、选图下载、自动下载 | 新增命令、改 payload 环境变量、改命令分派 |
| `apps/sidecar/src/services/scheduler.ts` | 自动下载任务编排：discover -> download | 下载队列任务行为 |
| `apps/sidecar/src/services/matcher.ts` | 根据任务选择 adapter；当前只注册 `DoubanAdapter` | 新增站点、改发现入口 |
| `apps/sidecar/src/adapters/douban.ts` | 豆瓣详情页、图片分类页、分页/游标解析、预览 data URL | 解析不到图片、空分类、选图批次、豆瓣页面结构变化 |
| `apps/sidecar/src/services/downloader.ts` | 图片下载、断点续传、格式转换、裁剪、保存、进度上报 | 下载失败、图片格式、尺寸比例、续传 |
| `apps/sidecar/src/services/douban-search.ts` | 豆瓣搜索页解析 | 搜索结果缺失、封面/简介解析 |
| `apps/sidecar/src/services/douban-title.ts` | 豆瓣详情页标题和封面预览解析 | 手动粘贴链接后的标题/封面 |
| `apps/sidecar/src/services/douban-details.ts` | 结构化 API 优先，详情页补充或完整兜底；校验 subject URL、API 重定向、详情页最终 URL/类型/结构，并提取展开简介 | 影片字段缺失、完整简介、API 无权限、详情风控、movie/tv API 跳转 |
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
| `apps/desktop/src-tauri/Cargo.toml` | Rust/Tauri 依赖 |
| `scripts/prepare-sidecar-bundle.ps1` | 打包前准备 sidecar dist、Node、依赖和资源 |
| `scripts/check-build-env.ps1` | 环境检查脚本 |
| `scripts/build-with-msvc.ps1` | MSVC 环境一键构建脚本 |

打包要点：

- Windows release 重新打包优先运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-with-msvc.ps1`。
- `prepare-sidecar-bundle.ps1` 会复制 sidecar `dist`，在 `resources/sidecar` 内用 npm 安装生产依赖，再复制 `node.exe` 并验证 `sharp` 原生二进制。
- 不要把 pnpm workspace 的 `node_modules` 直接复制进 Tauri resources；pnpm junction/symlink 会导致安装包在用户机器上缺依赖。
- `pnpm-workspace.yaml` 允许 `esbuild` 和 `sharp` build scripts，这是当前构建 sharp 原生依赖所需配置。

## 常见验证命令

```bash
# 前端类型检查
pnpm --dir apps/desktop exec vue-tsc --noEmit

# Sidecar 类型检查
pnpm --dir apps/sidecar typecheck

# 前端测试
pnpm --dir apps/desktop test

# 单个前端 Vitest spec
pnpm --dir apps/desktop test -- src/stores/__tests__/app.spec.ts

# Sidecar 测试
pnpm --dir apps/sidecar test

# Rust 检查和测试
cd apps/desktop/src-tauri
cargo check
cargo test
cargo clippy --all-targets
```

如果只改文档，通常不需要跑类型检查；但要检查新增链接、章节锚点和路径是否真实。

## 模块化重构说明

2026年6月 完成了 Rust 后端的模块化重构：

- **lib.rs**: 从 3562 行减少到 857 行（减少 76%）
- **新增 20 个模块文件**：清晰的职责分离
- **测试覆盖**: 41/41 单元测试全部通过
- **代码质量**: Clippy 零警告

重构后的优势：
- 模块职责清晰，易于维护
- 代码复用性提高
- 测试更容易编写
- 依赖关系一目了然
- 符合 Rust 最佳实践

## Store 和测试迁移说明

最近的前端重构将 `apps/desktop/src/stores/app.ts` 从单体 store 改成协调层，并把领域逻辑拆到 `taskQueue.ts`、`taskActions.ts`、`cookies.ts`、`logs.ts`、`ui.ts`。

测试体系同步迁移到 Vitest 4 + happy-dom，测试文件从旧的 `apps/desktop/src/test/**` 为主，转为源码旁 `__tests__/*.spec.ts` 为主。排查超时或类型错误时，先按具体 spec 单独运行，再扩大到 `pnpm --dir apps/desktop test`。
