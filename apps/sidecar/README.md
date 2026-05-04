# Sidecar Service

`apps/sidecar` 是 Movie Cover Downloader 的真实抓取执行层。它以独立 Node.js 进程运行，由 Tauri 在执行下载任务时启动。sidecar 不直接操作前端状态，也不直接调用 Tauri API，而是通过 stdout 输出结构化 JSON，交给 Rust 命令层解析并转发给前端。

## 职责概览

sidecar 负责这些事情：

1. 从环境变量读取 Tauri 注入的单次下载任务。
2. 根据任务链接识别站点来源，目前主要是豆瓣电影。
3. 解析详情页标题和图片分类页。
4. 发现剧照、海报或壁纸图片链接。
5. 根据限制数量或无限制模式决定下载范围。
6. 下载图片，支持断点续传。
7. 按用户选择保存原图、9:16 或 3:4。
8. 使用 `sharp` 进行图片裁剪和格式转换。
9. 每保存一张图片后输出实时进度事件。
10. 读取任务控制文件，响应暂停或取消。
11. 返回最终任务结果给 Tauri。

## 目录结构

```text
apps/sidecar/
├─ package.json              # sidecar 独立包配置、构建脚本和依赖
├─ tsconfig.json             # TypeScript 编译配置
├─ README.md                 # 当前说明文档
├─ dist/                     # TypeScript 编译后的 JS 产物，由 build 生成
├─ node_modules/             # sidecar 依赖，开发或构建时安装
└─ src/
   ├─ index.ts               # sidecar 入口：读取环境变量、组装服务、执行 bootstrap 任务
   ├─ adapters/              # 站点适配器层
   │  ├─ base.ts             # 通用请求、HTML 解析、URL 工具和适配器接口
   │  ├─ douban.ts           # 豆瓣适配器：解析详情页、分类页和图片链接
   │  └─ douban.test.ts      # 豆瓣适配器单元测试
   ├─ services/              # 业务服务层
   │  ├─ cookie-pool.ts      # Cookie 池：选择可用 Cookie、冷却异常 Cookie
   │  ├─ downloader.ts       # 下载服务：断点续传、图片保存、裁剪、格式转换、进度上报
   │  ├─ downloader.test.ts  # 下载服务单元测试
   │  ├─ matcher.ts          # 匹配服务：为任务选择合适站点适配器
   │  ├─ resume-store.ts     # 断点续传元数据和 .part 临时文件管理
   │  ├─ scheduler.ts        # 调度器：串联发现、下载、Cookie 和任务控制
   │  └─ task-control.ts     # 任务控制：读取 pause/resume/cancel 文件信号
   ├─ shared/                # 共享契约和基础设施
   │  ├─ contracts.ts        # 任务、发现结果、下载结果、日志和进度事件类型
   │  ├─ logger.ts           # 输出 NDJSON 日志和 task-progress 事件
   │  └─ runtime-config.ts   # 从环境变量生成运行配置
   └─ utils/                 # 小型工具函数
      ├─ output-folder.ts    # 输出目录和图片文件名生成
      ├─ source-detector.ts  # 来源识别和豆瓣图片页 URL 构造
      └─ wait-for.ts         # Promise 等待工具
```

## 关键文件说明

### `src/index.ts`

sidecar 的进程入口。它负责：

- 读取 `MCD_BOOTSTRAP_*`、`MCD_DOUBAN_*`、`MCD_IMAGE_*` 等环境变量；
- 把环境变量解析成 `SidecarTask`；
- 创建 `RuntimeConfig`、`CookiePoolService`、`MatcherService`、`DownloaderService`、`FileTaskControl` 和 `SchedulerService`；
- 监听 `SIGINT` / `SIGTERM`，在进程退出前调用调度器 shutdown；
- 执行一次 bootstrap 任务；
- 成功时输出 `{ kind: "task-result", payload: ... }`；
- 暂停或取消时输出 `{ kind: "task-paused" }` 或 `{ kind: "task-cancelled" }`。

这个入口设计成“一次进程执行一个任务”，这样 Tauri 可以用任务 id、控制文件和 pid 文件精确管理每个下载任务。

### `src/adapters/base.ts`

站点适配器的基础工具。它提供：

- `SourceAdapter` 接口，约束每个站点适配器必须实现 `canHandle` 和 `discover`；
- `AdapterContext`，向适配器传入运行配置、日志器、Cookie 和请求间隔状态；
- `buildHeaders`，统一构造 User-Agent、语言和 Cookie 请求头；
- `fetchText`，统一执行 HTML 请求、请求间隔、状态码检查和响应读取；
- `extractTitleFromHtml`、`stripTags`、`decodeHtml` 等 HTML 文本工具；
- `dedupeUrls` 和 `resolveRelativeUrl` 等 URL 工具。

### `src/adapters/douban.ts`

豆瓣站点适配器。它负责：

- 判断任务是否属于豆瓣电影链接；
- 抓取豆瓣详情页并提取片名；
- 根据用户选择的 `still`、`poster`、`wallpaper` 构造图片分类页 URL；
- 识别豆瓣登录页、风控页、空分类页和结构异常页；
- 解析分类页中的图片链接；
- 把缩略图 URL 尽量升级为更清晰的大图 URL；
- 按任务数量限制截断图片列表；
- 生成最终输出目录。

如果豆瓣分类页没有图片，适配器会抛出结构化错误，例如 `douban photo category is empty|title=...`，前端会把它转换成“某影片暂时没有剧照/海报/壁纸”的友好提示。

### `src/services/scheduler.ts`

调度器是 sidecar 的编排层。单个任务的执行顺序是：

```text
assertNotPaused
  ↓
matcher.discover
  ↓
assertNotPaused
  ↓
downloader.download
  ↓
组装 TaskRunResult
```

调度器本身不解析 HTML，也不写图片文件。它只串联不同服务，让发现、下载、Cookie 和任务控制职责保持分离。

### `src/services/matcher.ts`

匹配服务负责选择站点适配器。当前注册的是 `DoubanAdapter`。后续如果扩展其他站点，应新增适配器并注册到这里。

### `src/services/downloader.ts`

下载服务是 sidecar 中最核心的执行模块。它负责：

- 为每张图片构造请求头，包含 Accept、Referer 和可选 Cookie；
- 支持 Range 断点续传；
- 下载数据先写入 `.part` 临时文件；
- 持续刷新续传 metadata；
- 识别 pause/cancel 控制信号；
- 判断原图是否可以直接保存；
- 在需要时用 `sharp` 转换为 JPG/PNG；
- 在用户选择 9:16 或 3:4 时做居中裁剪；
- 根据片名、分类、尺寸、序号和比例生成文件名；
- 成功保存后删除续传临时文件；
- 输出 `task-progress` 事件；
- 写入 `saved image` 日志。

裁剪策略是“居中裁剪，不放大、不拉伸”。也就是说，9:16 或 3:4 只改变构图比例，不会把小图强行放大，因此尽量保持原图清晰度。

### `src/services/resume-store.ts`

断点续传状态管理。临时文件集中放在输出目录下的 `.mcd-resume`：

```text
输出目录/
└─ .mcd-resume/
   └─ task-id/
      ├─ 1.part
      ├─ 1.json
      ├─ 2.part
      └─ 2.json
```

`.part` 保存已下载图片字节，`.json` 保存 URL、已下载字节、总字节数、ETag 和 Last-Modified。图片保存成功后会清理对应临时文件，并尝试删除空目录。

### `src/services/task-control.ts`

任务控制服务读取 Tauri 写入的控制文件。控制文件内容很简单：

- `resume`：继续执行；
- `pause`：抛出 `PauseRequestedError`；
- `cancel`：抛出 `CancelRequestedError`。

下载流程会在关键节点调用 `assertNotPaused()`，确保暂停或取消发生在安全点，而不是中断到文件写入中间。

### `src/services/cookie-pool.ts`

Cookie 池负责选择当前站点可用 Cookie，并在出现风控或鉴权问题时临时冷却 Cookie。当前主要服务豆瓣请求。

### `src/shared/contracts.ts`

sidecar 的类型契约集中在这里，主要包括：

- `SidecarTask`：Tauri 注入给 sidecar 的任务参数；
- `ResolvedSource`：详情页解析结果；
- `DiscoveredImage`：单张待下载图片；
- `DiscoveryResult`：图片发现阶段结果；
- `DownloadedImage`：单张图片保存结果；
- `DownloadResult`：下载阶段结果；
- `TaskRunResult`：sidecar 最终返回给 Tauri 的任务结果；
- `SidecarLogEvent`、`SidecarTaskProgressEvent`、`SidecarTaskEvent`：stdout 事件结构。

### `src/shared/logger.ts`

日志器把日志和进度事件写成单行 JSON，也就是 NDJSON。Tauri 会逐行读取 stdout 并解析。

普通日志示例：

```json
{"level":"INFO","scope":"downloader","message":"saved image: D:/cover/...jpg","taskId":"task-301","timestamp":...}
```

进度事件示例：

```json
{"kind":"task-progress","taskId":"task-301","phase":"downloading","targetCount":10,"savedCount":3,"timestamp":...}
```

最终结果示例：

```json
{"kind":"task-result","payload":{"discovery":{},"download":{}}}
```

### `src/shared/runtime-config.ts`

运行配置从环境变量读取，包含输出目录、并发、请求间隔、请求超时、Cookie 冷却时间、User-Agent 配置和豆瓣 Cookie。

### `src/utils/output-folder.ts`

负责生成输出目录和文件名。文件名会包含：

```text
片名-分类-尺寸-比例-序号.扩展名
```

例如：

```text
让子弹飞-still-1080x1920-9x16-001.jpg
让子弹飞-poster-1200x1600-原图-001.jpg
```

### `src/utils/source-detector.ts`

负责把任务链接转换成实际要抓取的图片页 URL。当前只保留豆瓣逻辑：

- `still` -> `all_photos?type=S`
- `poster` -> `all_photos?type=R`
- `wallpaper` -> `photos?type=W`

### `src/utils/wait-for.ts`

简单的 Promise 等待工具，用于请求间隔和测试等待。

## sidecar 与 Tauri 的通信方式

### 输入：环境变量

Tauri 启动 sidecar 子进程时通过环境变量传入任务参数，常见变量包括：

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

使用环境变量而不是复杂命令行参数，可以减少 Windows 路径、Cookie 特殊字符和空格转义带来的问题。

### 输出：stdout NDJSON

sidecar 输出的每一行都是一个 JSON 对象，Tauri 根据字段分流：

- `kind: "task-progress"` -> 前端实时进度条；
- `kind: "task-result"` -> 任务完成结果；
- `kind: "task-paused"` -> 用户暂停；
- `kind: "task-cancelled"` -> 用户取消；
- 普通 `level/scope/message` -> 日志中心。

stderr 会被 Tauri 视为错误日志。

## 构建脚本

在项目根目录运行：

```bash
pnpm build:sidecar
pnpm typecheck:sidecar
pnpm dev:sidecar
```

在 `apps/sidecar` 目录内运行：

```bash
pnpm build      # tsc -p tsconfig.json
pnpm typecheck  # tsc --noEmit
pnpm dev        # tsx watch src/index.ts
pnpm start      # node dist/index.js
```

桌面端构建时会自动先构建 sidecar，并通过根目录的 `prepare:sidecar-bundle` 脚本把运行资源准备到 Tauri resources 中。

## 测试覆盖重点

当前测试主要覆盖：

- 豆瓣页面分类识别；
- 豆瓣分页和图片解析；
- 空分类、登录、风控等异常页面判断；
- 下载服务保存文件；
- 下载失败时跳过单张图片；
- 断点续传和暂停恢复；
- 图片比例裁剪和文件命名。

## 设计注意事项

- sidecar 不应直接修改前端状态，必须通过 stdout 事件返回给 Tauri。
- 下载进度必须在每张图片保存成功后立即输出。
- Cookie 不应写入命令行参数，当前通过环境变量传入子进程。
- `.mcd-resume` 是临时续传目录，图片保存完成后应清理。
- 删除输出目录的安全边界由 Tauri 层负责，sidecar 只负责写入任务输出目录。
- 新增站点时，应优先新增 `SourceAdapter`，不要把站点逻辑混进下载服务。