# Sidecar Service

`apps/sidecar` 是 Movie Cover Downloader 的 Node.js 抓取执行层。它由 Tauri/Rust 作为独立子进程启动，通过环境变量接收一次性命令和任务参数，通过 stdout 输出单行 JSON 事件，再由 Rust 解析并转发给前端。

sidecar 不直接操作前端状态，也不调用 Tauri API。它只负责豆瓣搜索、标题/封面预览、图片发现、选中图片下载、自动下载、图片保存和进度上报。

## 职责概览

- 读取 Tauri 注入的 `MCD_*` 环境变量，解析为一次性命令或下载任务。
- 当前真实站点只支持豆瓣电影，链接来源限定在 `movie.douban.com` 和豆瓣图片域名。
- 支持豆瓣影视搜索、豆瓣详情页标题/封面预览解析。
- 支持剧照、海报、壁纸三类图片发现，包含分页/游标式批量发现。
- 支持前端传入选中图片列表，只下载用户确认的图片。
- 自动下载链路会解析详情页、分类页、图片页，并按数量限制或无限制模式生成下载列表。
- 下载图片时支持 `.part` 断点续传、Range 请求、失败单图跳过、最终无保存则报错。
- 使用 `sharp` 进行 JPG/PNG 输出、9:16 或 3:4 居中裁剪；原图模式会尽量保留原始 JPG/PNG 二进制。
- 每保存一张图片后输出 `task-progress`，最终输出 `task-result`。
- 读取任务控制文件，在安全点响应 `pause` / `cancel`。

## 命令模式

`src/index.ts` 根据 `MCD_COMMAND` 分派：

| `MCD_COMMAND` | 用途 | 主要输出 |
| --- | --- | --- |
| 未设置 | 自动下载任务：发现图片并下载 | `task-progress`、`task-result` |
| `douban-search` | 豆瓣影片搜索 | `douban-search-result` |
| `douban-title` | 豆瓣详情页标题和封面预览 | `douban-title-result` |
| `douban-photos-discover` | 选图下载的分页/游标发现 | `douban-photos-discover-progress`、`douban-photos-discover-result` |
| `douban-selected-download` | 下载前端传入的选中图片 | `task-progress`、`task-result` |

没有 `MCD_BOOTSTRAP_TASK_URL` 且不是特殊命令时，sidecar 会启动后记录空闲日志并退出。

## 目录结构

```text
apps/sidecar/
├─ package.json              # sidecar 包配置、构建/测试/类型检查脚本
├─ tsconfig.json             # TypeScript 编译配置
├─ README.md                 # 当前说明文档
├─ dist/                     # tsc 构建产物，打包前由脚本复制到 Tauri resources
└─ src/
   ├─ index.ts               # 命令分派入口，读取环境变量并组装服务
   ├─ adapters/
   │  ├─ base.ts             # 适配器接口、请求头、HTML 请求和通用解析工具
   │  └─ douban.ts           # 豆瓣详情页/分类页/分页图片解析
   ├─ services/
   │  ├─ cookie-pool.ts      # 从运行配置读取豆瓣 Cookie，并提供简单冷却能力
   │  ├─ douban-search.ts    # 豆瓣搜索页解析，返回分页搜索结果和封面 data URL
   │  ├─ douban-title.ts     # 豆瓣详情页标题和封面预览解析
   │  ├─ downloader.ts       # 图片下载、续传、sharp 转换/裁剪、进度上报
   │  ├─ matcher.ts          # 根据任务选择适配器，当前只注册 DoubanAdapter
   │  ├─ resume-store.ts     # `.mcd-resume` 续传临时文件和 metadata
   │  ├─ scheduler.ts        # 自动下载任务编排：发现 -> 下载
   │  └─ task-control.ts     # 读取 pause/resume/cancel 控制文件
   ├─ shared/
   │  ├─ contracts.ts        # sidecar 输入、输出、发现、下载和事件契约
   │  ├─ logger.ts           # stdout NDJSON 日志和 task-progress 输出
   │  └─ runtime-config.ts   # 从环境变量创建运行配置
   ├─ test/
   │  ├─ adapters/
   │  │  └─ douban.test.ts
   │  └─ services/
   │     ├─ douban-search.test.ts
   │     └─ downloader.test.ts
   └─ utils/
      ├─ output-folder.ts    # 输出目录、选图输出目录和文件名生成
      ├─ source-detector.ts  # 豆瓣 subject 链接规范化和分类页 URL 构造
      └─ wait-for.ts         # Promise 等待工具
```

## 关键文件说明

### `src/index.ts`

sidecar 入口。它读取环境变量，解析输出格式、豆瓣图片分类、数量模式、图片比例、分页 cursor 和选中图片 payload，然后按 `MCD_COMMAND` 执行对应流程。

自动下载模式会创建 `RuntimeConfig`、`CookiePoolService`、`MatcherService`、`DownloaderService`、`FileTaskControl` 和 `SchedulerService`。搜索、标题解析、选图发现和选中下载模式不会走完整调度器，只运行各自需要的最小服务。

选中图片下载优先从 `MCD_SELECTED_IMAGES_FILE` 读取 JSON，避免大 payload 放进命令行或环境变量；每张图片 URL 会校验为豆瓣图片域名。

### `src/adapters/base.ts`

定义 `SourceAdapter` 和 `AdapterContext`，并集中处理：

- User-Agent、Accept-Language、Cookie 等请求头。
- HTML 请求超时、重定向和文本读取。
- 请求间隔下限。
- 标题、HTML 文本、实体解码、URL 去重和相对链接解析。

### `src/adapters/douban.ts`

豆瓣适配器。它负责：

- 只处理 `movie.douban.com/subject/` 链接。
- 将 `still` / `poster` / `wallpaper` 映射到豆瓣图片分类页。
- 解析详情页标题，分类页总数和分页。
- 区分正常页、空分类、登录页、风控页和结构异常页。
- 将缩略图升级为更清晰的大图 URL。
- 选图发现时按 cursor 和 batchSize 返回一批图片，并可附带缩略图 data URL。
- 自动下载时按 `limited` / `unlimited` 返回下载列表和输出目录。

豆瓣请求会启用最小 3000ms 间隔，避免过快访问触发风控。

### `src/services/douban-search.ts`

抓取 `https://search.douban.com/movie/subject_search`，从 `window.__DATA__` 中解析搜索结果。它会过滤非豆瓣电影详情页结果，并尝试下载封面为 `coverDataUrl`，供前端搜索弹窗稳定展示。

### `src/services/douban-title.ts`

解析单个豆瓣 subject 链接。优先访问移动端 Rexxar API 获取标题和封面，失败时回退到移动端 HTML 标题解析。返回结果用于手动粘贴链接后的标题/封面预览。

### `src/services/matcher.ts`

适配器分发层。当前只注册 `DoubanAdapter`。新增站点时应新增 adapter，再在这里注册，不要把站点逻辑混入 downloader。

### `src/services/scheduler.ts`

自动下载编排层。主流程是：

```text
assertNotPaused
  -> matcher.discover
  -> assertNotPaused
  -> emitTaskProgress(downloading, target, 0)
  -> downloader.download
  -> TaskRunResult
```

调度器不解析 HTML、不保存图片，只协调 Cookie、适配器、下载器和任务控制。

### `src/services/downloader.ts`

图片下载核心模块。它负责：

- 为图片请求设置 Referer、Accept 和 Cookie。
- 使用 `.mcd-resume/<task-id>/` 保存 `.part` 和 `.json` 续传数据。
- 支持 Range 续传，Range 失效时清理残片并重试完整下载。
- 限制单张源图最大 80MB。
- 校验豆瓣图片重定向目标仍是豆瓣图片域名。
- 根据输出格式和比例决定直接保存原图，或用 `sharp` 转 JPG/PNG、居中裁剪。
- 保存成功后清理续传文件、输出进度事件和日志。
- 单张图片失败时写 warning 并跳过；全部失败时抛出 `no downloadable images were saved`。

### `src/services/resume-store.ts`

管理续传临时文件：

```text
输出目录/
└─ .mcd-resume/
   └─ task-id/
      ├─ 1.part
      ├─ 1.json
      ├─ 2.part
      └─ 2.json
```

图片保存成功或续传状态不可用时，会清理对应 `.part` / `.json`，并尝试删除空目录。

### `src/services/task-control.ts`

读取 Tauri 写入的控制文件：

- `resume`：继续。
- `pause`：抛出 `PauseRequestedError`。
- `cancel`：抛出 `CancelRequestedError`。

下载流程只在安全点调用 `assertNotPaused()`，避免中断到文件写入中间。

### `src/shared/contracts.ts`

sidecar 和 Rust/前端之间的核心类型契约，包括：

- `SidecarTask`
- `DoubanSearchResultPage`
- `DiscoveredImage`
- `DiscoveryResult`
- `DoubanPhotoDiscoveryCursor`
- `DoubanPhotoDiscoveryBatchResult`
- `DownloadResult`
- `TaskRunResult`
- `SidecarLogEvent`
- `SidecarTaskProgressEvent`

跨层 payload 变更时要同步前端类型、Rust `types.rs` 和相关测试。

### `src/shared/logger.ts`

所有日志和进度都写到 stdout，每行一个 JSON 对象。Rust 会逐行解析：

- `task-progress`：更新前端队列进度。
- `task-result`：自动下载或选中下载结果。
- `douban-search-result`：搜索结果。
- `douban-title-result`：标题/封面预览。
- `douban-photos-discover-progress`：选图发现过程增量图片。
- `douban-photos-discover-result`：选图发现批次结果。

stderr 会被 Rust 当作错误日志处理。

### `src/shared/runtime-config.ts`

从环境变量读取运行配置：

- `MCD_CONCURRENCY`
- `MCD_BATCH_SIZE`
- `MCD_REQUEST_INTERVAL_MS`
- `MCD_REQUEST_TIMEOUT_MS`
- `MCD_COOKIE_COOLDOWN_MS`
- `MCD_OUTPUT_DIR`
- `MCD_UA_PROFILE`
- `MCD_DOUBAN_COOKIE`

Cookie 只放在子进程环境变量中，不写入命令行参数。

### `src/utils/source-detector.ts`

将豆瓣详情页规范化为 `https://movie.douban.com/subject/<id>/`，并构造分类页：

- `still` -> `photos?type=S`
- `poster` -> `photos?type=R`
- `wallpaper` -> `photos?type=W`

### `src/utils/output-folder.ts`

清理 Windows 非法文件名字符，并统一生成：

- 影片输出目录名。
- 自动下载输出目录。
- 选图下载输出目录：`selected/<asset>/<asset>-<ratio>`。
- 最终图片文件名：`片名 - 分类 - 尺寸 - 比例.ext`。

## 与 Tauri 的通信

### 输入：环境变量

常见变量：

- `MCD_COMMAND`
- `MCD_BOOTSTRAP_TASK_ID`
- `MCD_BOOTSTRAP_TASK_URL`
- `MCD_BOOTSTRAP_OUTPUT_DIR`
- `MCD_BOOTSTRAP_SOURCE_HINT`
- `MCD_DOUBAN_ASSET_TYPE`
- `MCD_IMAGE_COUNT_MODE`
- `MCD_BOOTSTRAP_MAX_IMAGES`
- `MCD_BOOTSTRAP_OUTPUT_FORMAT`
- `MCD_IMAGE_ASPECT_RATIO`
- `MCD_REQUEST_INTERVAL_MS`
- `MCD_TASK_CONTROL_FILE`
- `MCD_DOUBAN_COOKIE`
- `MCD_SEARCH_QUERY`
- `MCD_SEARCH_PAGE`
- `MCD_DISCOVERY_CURSOR`
- `MCD_DISCOVERY_BATCH_SIZE`
- `MCD_DISCOVERY_TITLE`
- `MCD_SELECTED_IMAGES_FILE`
- `MCD_SELECTED_TITLE`

### 输出：stdout NDJSON

sidecar 输出的每一行都是 JSON。Rust 解析 stdout 并分流为运行日志、进度事件、搜索结果、标题结果、发现结果或最终任务结果。

## 构建与测试

在项目根目录运行：

```bash
pnpm build:sidecar
pnpm typecheck:sidecar
pnpm --dir apps/sidecar test
```

在 `apps/sidecar` 目录内运行：

```bash
pnpm build      # tsc -p tsconfig.json
pnpm typecheck  # tsc --noEmit
pnpm test       # tsx --test src/test/...
pnpm dev        # tsx watch src/index.ts
pnpm start      # node dist/index.js
```

桌面端构建会先执行 sidecar build，再通过根目录 `prepare:sidecar-bundle` 把 `dist`、生产依赖和 `node.exe` 准备到 Tauri resources。

## 设计注意事项

- 不要让 sidecar 直接修改前端状态，必须通过 stdout 事件返回。
- 不要把 Cookie 放进命令行参数或日志。
- 不要绕过 `task-control.ts` 的安全点暂停/取消设计。
- 不要直接复制 pnpm workspace 的 `node_modules` 到安装包；打包资源由 `scripts/prepare-sidecar-bundle.ps1` 在临时 resources 目录内安装生产依赖。
- 新增站点时优先新增 adapter，再注册到 `MatcherService`。
- 豆瓣空分类、登录、风控和结构异常要保持可区分，前端依赖这些错误信息展示友好提示。
