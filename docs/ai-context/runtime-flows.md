# 运行链路图

本文按业务链路描述跨层调用。AI 排查问题时优先按链路读文件，避免从全仓库目录扫描开始。

## Rust 后端模块化架构

**2026年6月完成重构**，lib.rs 从 3562 行减少到 857 行，按功能分离成独立模块：

- **commands/** - Tauri 命令入口（state, login, task, fs, image）
- **sidecar/** - Sidecar 进程管理（runtime, parser, download, douban）
- **sqlite/** - 数据库操作（connection, state, migration）
- **基础模块** - constants, types, utils, crypto, task_control

各链路中提到的 `lib.rs` 命令现在位于对应的 commands 模块文件中。

## 搜索影视链路

```mermaid
sequenceDiagram
  participant User as 用户
  participant Search as SearchMovieModal.vue
  participant Store as app.ts
  participant Bridge as runtime-bridge.ts
  participant Tauri as lib.rs
  participant Sidecar as sidecar index.ts
  participant SearchSvc as douban-search.ts
  participant Douban as 豆瓣搜索页

  User->>Search: 输入片名并搜索
  Search->>Store: 读取可用 Cookie
  Search->>Bridge: searchDoubanMovies(query,page,cookie)
  Bridge->>Tauri: invoke search_douban_movies
  Tauri->>Sidecar: MCD_COMMAND=douban-search
  Sidecar->>SearchSvc: searchDoubanMovies
  SearchSvc->>Douban: 请求并解析搜索页
  SearchSvc-->>Sidecar: DoubanSearchResultPage
  Sidecar-->>Tauri: douban-search-result
  Tauri-->>Bridge: JSON string
  Bridge-->>Search: 结果分页
  Search->>Store: 添加链接或 openSelectedPhotoDownload
```

关键文件：

- `apps/desktop/src/components/queue/SearchMovieModal.vue`：搜索输入、页级缓存、结果按钮、可用 Cookie 判断。
- `apps/desktop/src/lib/runtime-bridge.ts`：`searchDoubanMovies`。
- `apps/desktop/src-tauri/src/commands/task.rs`：`search_douban_movies` 命令。
- `apps/desktop/src-tauri/src/sidecar/douban.rs`：`search_douban_movies_blocking` 实现。
- `apps/sidecar/src/index.ts`：`MCD_COMMAND=douban-search`。
- `apps/sidecar/src/services/douban-search.ts`：豆瓣搜索页解析。

注意：搜索结果页已做内存缓存，缓存 key 包含 query 和 page；切换已访问页不应重复请求豆瓣。

## 自动下载链路

```mermaid
sequenceDiagram
  participant Modal as CreateTaskModal.vue
  participant Store as app.ts
  participant Bridge as runtime-bridge.ts
  participant Tauri as lib.rs
  participant Sidecar as sidecar index.ts
  participant Scheduler as scheduler.ts
  participant Matcher as matcher.ts
  participant DoubanAdapter as douban.ts
  participant Downloader as downloader.ts
  participant FS as 输出目录

  Modal->>Store: createTasks(drafts)
  Store->>Store: drainQueue / processTask
  Store->>Bridge: runDownloadTask(payload)
  Bridge->>Tauri: invoke run_download_task
  Tauri->>Sidecar: bootstrap env + MCD_COMMAND 默认下载
  Sidecar->>Scheduler: runTask
  Scheduler->>Matcher: discover(task)
  Matcher->>DoubanAdapter: discover(task)
  DoubanAdapter-->>Matcher: DiscoveryResult
  Scheduler->>Downloader: download(task, discovery, cookie, control)
  Downloader->>FS: 保存图片 / .part / metadata
  Downloader-->>Sidecar: DownloadResult
  Sidecar-->>Tauri: task-progress / runtime-log / task-result
  Tauri-->>Bridge: 事件与最终 JSON
  Bridge-->>Store: 更新进度、状态、日志、持久化
```

关键文件：

- `apps/desktop/src/components/queue/CreateTaskModal.vue`：自动下载表单和 draft 校验。
- `apps/desktop/src/stores/app.ts`：`createTasks`、`drainQueue`、`runNativeTask`、`buildCompletedTask`。
- `apps/desktop/src-tauri/src/commands/task.rs`：`run_download_task` 命令。
- `apps/desktop/src-tauri/src/sidecar/download.rs`：`run_download_task_blocking` 实现。
- `apps/desktop/src-tauri/src/sidecar/parser.rs`：stdout/stderr 解析。
- `apps/sidecar/src/services/scheduler.ts`：任务编排。
- `apps/sidecar/src/services/matcher.ts`：选择站点适配器。
- `apps/sidecar/src/adapters/douban.ts`：豆瓣详情页和图片页解析。
- `apps/sidecar/src/services/downloader.ts`：下载、断点续传、sharp 转换/裁剪、保存文件。

注意：豆瓣任务在前端队列层会串行保护，请求间隔会进入真实抓取链路。

## 选图发现链路

```mermaid
sequenceDiagram
  participant Modal as CreateTaskModal.vue
  participant Grid as SelectedPhotoGrid.vue
  participant Bridge as runtime-bridge.ts
  participant Tauri as lib.rs
  participant Sidecar as sidecar index.ts
  participant Matcher as matcher.ts
  participant DoubanAdapter as douban.ts

  Modal->>Bridge: discoverDoubanPhotos(payload)
  Bridge->>Tauri: invoke discover_douban_photos
  Tauri->>Sidecar: MCD_COMMAND=douban-photos-discover
  Sidecar->>Matcher: discoverDoubanPhotoBatch(task,cursor,batchSize)
  Matcher->>DoubanAdapter: discoverBatch(...)
  DoubanAdapter-->>Sidecar: images + nextCursor + done
  Sidecar-->>Tauri: douban-photos-discover-progress
  Tauri-->>Bridge: douban-photo-discovery-progress event
  Bridge-->>Modal: 合并已发现图片
  Sidecar-->>Tauri: douban-photos-discover-result
  Tauri-->>Bridge: batch result JSON
  Modal->>Grid: 当前分类可见图片
  Grid->>Modal: 滚动到底部 request-next-batch
```

关键状态在 `CreateTaskModal.vue`：

- `selectedPhotoFilter`：当前分类，只能是 `still | poster | wallpaper`。
- `selectedPhotoDiscoveryByAsset`：每个分类的 cursor/done。
- `selectedPhotoVisibleLimit`：前端当前展示数量。
- `selectedPhotoGridLoadingRequested`：滚动到底部后请求下一批。
- `selectedDiscoveryTaskId`：当前 discovery task id，用于取消。
- `selectedPhotoLoadedUrls` / `selectedPhotoFailedUrls`：缩略图 loading 和失败占位。

注意：

- 不要一次性解析全部分类或全部页面。
- 空分类应显示空状态，不能卡在 loading。
- 切换分类要停止旧 discovery，再优先解析新分类。

## 选图下载链路

```mermaid
sequenceDiagram
  participant Modal as CreateTaskModal.vue
  participant Store as app.ts
  participant Bridge as runtime-bridge.ts
  participant Tauri as lib.rs
  participant Sidecar as sidecar index.ts
  participant Downloader as downloader.ts

  Modal->>Modal: 用户勾选图片并确认下载
  Modal->>Bridge: cancelDoubanPhotoDiscovery(taskId)
  Modal->>Store: findDuplicateTasksForDrafts(drafts)
  Modal->>Store: createTasks(drafts,{replacementTaskIds})
  Store->>Bridge: runSelectedPhotoDownload(payload)
  Bridge->>Tauri: invoke run_selected_photo_download
  Tauri->>Sidecar: MCD_COMMAND=douban-selected-download + selected images file
  Sidecar->>Sidecar: parseSelectedImages / buildSelectedOutputDir
  Sidecar->>Downloader: download(task, selected discovery, cookie, control)
  Downloader-->>Sidecar: DownloadResult
  Sidecar-->>Tauri: task-result
  Tauri-->>Bridge: RuntimeDownloadTaskResult
  Bridge-->>Store: 完成任务并持久化
```

重复任务检测在 `app.ts` 的 `findDuplicateTasksForDrafts` 和 `createTasks` 附近；覆盖确认 UI 在 `CreateTaskModal.vue`。

## 队列和任务控制链路

```mermaid
flowchart LR
  Store["app.ts\npause/resume/delete/clear"] --> Bridge["runtime-bridge.ts"]
  Bridge --> Tauri["lib.rs\npause_download_task / resume_download_task / clear_download_tasks"]
  Tauri --> Control["控制文件\npause / resume / cancel"]
  Tauri --> Process["sidecar 进程 pid"]
  Sidecar["task-control.ts\nFileTaskControl"] --> Control
  Downloader["downloader.ts"] --> Sidecar
```

关键点：

- 前端入口要做 UI 禁用和 store 入口二次保护。
- sidecar 在安全点读取控制文件，暂停保留当前 `.part`。
- 删除或清空队列时，Rust 负责取消可能仍在运行的 sidecar 进程。

## Cookie 链路

```mermaid
flowchart TB
  Import["ImportCookieModal.vue"] --> Store["app.ts\nimportCookie / startDoubanLoginImport"]
  Store --> Bridge["runtime-bridge.ts"]
  Bridge --> Login["Tauri WebviewWindow\n豆瓣登录窗口"]
  Bridge --> Tauri["lib.rs\ncheck_login_window_cookie_status"]
  Store --> SQLite["SQLite cookies 表"]
  Store --> Task["任务运行时挑选可用 Cookie"]
  Task --> TauriRun["run_* Tauri command"]
  TauriRun --> SidecarEnv["MCD_DOUBAN_COOKIE 环境变量"]
  SidecarEnv --> CookiePool["cookie-pool.ts"]
  CookiePool --> Douban["豆瓣请求"]
```

安全约束：

- Cookie 不写命令行参数。
- Cookie 不写日志。
- SQLite 中 Cookie 会走保护/兼容处理。
- 登录失效、风控页、典型反爬错误会触发 Cookie 冷却；空分类不应让 Cookie 冷却。

## 持久化链路

```mermaid
sequenceDiagram
  participant Store as app.ts
  participant Bridge as runtime-bridge.ts
  participant Tauri as lib.rs
  participant SQLite as runtime-state.sqlite

  Store->>Bridge: saveState(AppSeedState)
  Bridge->>Tauri: save_persisted_state(snapshotJson)
  Tauri->>SQLite: 拆分写入 tasks/cookies/app_logs/settings
  Store->>Bridge: loadState()
  Bridge->>Tauri: load_persisted_state
  Tauri->>SQLite: 读取并重建 AppSeedState
  Tauri-->>Bridge: snapshot JSON
  Bridge-->>Store: hydrate 状态
```

涉及持久化字段时要同时检查：

- `apps/desktop/src/types/app.ts`
- `apps/desktop/src/stores/app.ts`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src/test/stores/app.test.ts`
- `apps/desktop/src-tauri/src/lib.rs` 中 SQLite 相关 Rust 测试

## 图片处理和自定义裁剪链路

```mermaid
flowchart TB
  ImageProcess["ImageProcessModal.vue\n拼版 / 标注 / 导出"] --> Bridge["runtime-bridge.ts"]
  CustomCrop["CustomCropModal.vue\n上传 / 拖拽 / 裁剪"] --> Bridge
  Bridge --> Tauri["lib.rs"]
  Tauri --> ReadDropped["read_dropped_image_file"]
  Tauri --> ReadLocal["read_local_image_file"]
  Tauri --> SaveCustom["save_custom_cropped_image"]
  Tauri --> SaveProcessed["save_processed_image"]
  SaveCustom --> FS["输出根目录/custom-crop-photo"]
  SaveProcessed --> FS
```

注意：

- 自定义裁剪的 Tauri 拖拽读取必须走 `readDroppedImageFile(filePath)`，不绑定输出根目录。
- `readLocalImageFile(filePath, outputRootDir)` 仍用于需要输出根目录边界校验的读取场景。
- 保存裁剪结果固定写入输出根目录下的 `custom-crop-photo`。
