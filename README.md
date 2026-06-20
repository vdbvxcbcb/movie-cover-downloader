# Movie Cover Downloader

一个面向 Windows 的豆瓣影视图片下载器桌面应用，用于制作视频封面和整理影视图片素材。当前主要支持豆瓣电影，提供影片搜索、自动下载、选图下载、任务队列、Cookie 管理、实时进度、本地输出目录管理和图片处理能力。

## 快速入口

- 使用说明：[docs/usage-guide.md](./docs/usage-guide.md)
- sidecar 说明：[apps/sidecar/README.md](./apps/sidecar/README.md)
- 安装包下载：[Release page](https://github.com/vdbvxcbcb/movie-cover-downloader/releases/download/v0.1.0/Movie.Cover.Downloader_0.1.0_x64-setup.exe)
- **Windows 开发环境配置**：[docs/windows-setup.md](./docs/windows-setup.md)
- **构建检查清单**：[docs/build-checklist.md](./docs/build-checklist.md)

## 视频演示

项目会持续更新，演示效果仅供参考，最新功能都会放进安装包：[Release page](https://github.com/vdbvxcbcb/movie-cover-downloader/releases/download/v0.1.0/Movie.Cover.Downloader_0.1.0_x64-setup.exe)

https://github.com/user-attachments/assets/908c6e0d-6f0f-4608-9224-5a001f564801

https://github.com/user-attachments/assets/e4e03bf4-594c-4769-b632-072f80325735

https://github.com/user-attachments/assets/8fc89742-8dd9-4f2c-99c9-dacde3a0fec7

## 当前定位

- 桌面壳：`Tauri 2`
- 前端：`Vue 3 + TypeScript + Vite + Pinia`
- 抓取执行层：`Node.js sidecar + TypeScript`
- 图片处理：`sharp`
- 本地状态存储：`SQLite`
- 目标平台：`Windows`

## 主要功能

- 豆瓣影视搜索：按片名搜索豆瓣电影，展示封面、标题、简介、详情页链接和分页结果。
- 搜索结果缓存：同一次搜索内切换分页会复用已请求过的结果，减少重复请求。
- Cookie 管理：搜索影视、添加下载任务和图片处理等需要访问豆瓣资源的能力都依赖导入可用 Cookie。
- 自动下载：在 `3、添加下载任务` 弹窗的 `自动下载` 模式中粘贴豆瓣 `subject` 链接，按配置批量下载剧照、海报、壁纸。
- 选图下载：在 `选图下载` 模式中按 `剧照 / 海报 / 壁纸` 三个分类分页解析豆瓣图片，用户滚动到底部继续加载下一批，勾选后只下载选中的内容。
- 双路径选图：既支持知道链接时手动粘贴解析，也支持从 `2、搜索影视` 的搜索结果直接进入选图下载。
- 图片选择与预览：选图下载列表支持单击勾选、拖拽框选多张图片、双击预览大图，并可在预览组中左右切换。
- 图片处理：支持 1 到 9 张图片拼版、单张图片透明度、背景图透明度、背景重叠、方框/圆圈/箭头标注和导出。
- 任务队列：下载任务进入队列后按添加顺序执行，并实时展示进度、日志和输出目录；重复任务可在确认后覆盖旧输出并替换为新任务。

## 使用流程

### 1. 导入 Cookie

点击控制中心的 Cookie 导入入口，导入可访问豆瓣电影页面的 Cookie。应用会把 Cookie 保存到本地 SQLite 状态库中，后续搜索、解析图片和下载时复用。

### 2. 搜索影视

1. 点击 `2、搜索影视`。
2. 输入片名并搜索。
3. 搜索结果右侧提供两个操作：
   - `选图下载`：打开 `3、添加下载任务`，切到 `选图下载` 模式，自动填入链接、片名、封面并开始解析。
   - `添加链接`：把影片详情页加入添加下载任务弹窗的链接草稿，继续走自动下载流程。

### 3. 自动下载

1. 点击 `3、添加下载任务`。
2. 选择 `自动下载`。
3. 粘贴一个或多个豆瓣 `subject` 链接。
4. 设置输出目录、下载数量、图片尺寸、输出格式和请求间隔。
5. 提交后任务进入队列，sidecar 自动发现并下载图片。

### 4. 选图下载

选图下载支持豆瓣 `subject`、`all_photos` 和 `photos?type=S/R/W` 链接。当前只保留 `剧照 / 海报 / 壁纸` 三个分类，不再提供 `全部` 分类，也不再一次性解析全部页面。

1. 点击 `3、添加下载任务`，切换到 `选图下载`。
2. 粘贴豆瓣影片链接后会自动解析影片标题、封面，并默认先解析 `剧照` 分类。
3. 切换 `剧照 / 海报 / 壁纸` 时，会停止旧分类正在进行的解析，再优先解析新分类。
4. 图片按当前分类分页/游标式加载，滚动到底部才会继续请求下一批，已解析结果会按分类缓存。
5. 单击图片可勾选/取消勾选，拖拽空白区域可框选多张图片；`全选`、`取消全选` 只作用于当前分类。
6. 双击图片打开大图预览，预览中可以左右切换同一组图片。
7. 设置输出目录、图片尺寸、输出格式和请求间隔。
8. 点击 `下载选中 N 张`，确认后会停止继续解析后续图片，并只下载已选图片。

如果相同链接、输出目录、分类和图片比例的任务已经在队列中存在，提交时会弹出覆盖确认；确认后会清理旧任务输出目录、移除旧任务行，并把新的选图任务重新加入队列。

### 5. 图片处理

图片处理弹窗用于本地拼版和标注：

- 上传 1 到 9 张图片后生成拼版。
- 点击某一张图片后，只调整当前图片透明度，并用完整实线框表示当前选择。
- 背景区域支持上传背景图、设置背景图透明度。
- 背景区域的 `重叠` 按钮可让背景图与拼版图片叠加，预览和导出保持一致。
- 方框、圆圈、箭头标注在拖拽完成后隐藏拖拽点；再次点击原区域时显示拖拽点和设置项。
- 箭头保持 2D 平面效果，拖拽头尾两个点位可调整长度。

## 项目结构

```text
movie-cover-downloader/
├─ apps/
│  ├─ desktop/                 # 桌面端应用：Vue 前端 + Tauri Rust 命令层
│  │  ├─ src/                   # 前端 UI、状态管理、运行时桥接、表单校验
│  │  └─ src-tauri/             # Tauri 后端：SQLite、文件系统、sidecar 进程管理
│  └─ sidecar/                  # Node 抓取执行层：站点适配、图片发现、下载、裁剪
├─ docs/                        # 用户使用说明和安装包说明
├─ scripts/                     # 构建安装包前的 sidecar 资源准备脚本
├─ package.json                 # 工作区级脚本入口
└─ README.md
```

## 运行时数据流

项目采用三层协作结构：

1. `apps/desktop/src` 是用户界面层，负责搜索弹窗、添加下载任务弹窗、图片处理弹窗、任务队列、日志中心、Cookie 管理和本地状态展示。
2. `apps/desktop/src-tauri/src/lib.rs` 是桌面能力层，负责 SQLite 持久化、文件系统操作、启动 Node sidecar、转发日志和进度事件。
3. `apps/sidecar/src` 是真实抓取执行层，负责解析豆瓣页面、发现图片、下载图片、裁剪/转格式，并通过 stdout 返回结构化事件给 Tauri。

### 搜索与添加下载任务联动

```text
用户点击“2、搜索影视”
  ↓
SearchMovieModal 调用 searchDoubanMovies(query, page)
  ↓
runtime-bridge 调用 Tauri 命令 search_douban_movies
  ↓
Rust 以 MCD_COMMAND=douban-search 启动 sidecar
  ↓
sidecar 请求豆瓣搜索页并解析影片封面、片名、简介和详情页链接
  ↓
搜索弹窗展示结果列表和分页器
  ↓
用户点击“添加链接”或“选图下载”
  ↓
添加链接写入共享草稿；选图下载打开 CreateTaskModal 并自动进入选图模式
```

### 自动下载任务

```text
用户在自动下载模式填写豆瓣 subject 链接和下载配置
  ↓
CreateTaskModal 校验链接、数量、输出目录、图片尺寸、输出格式
  ↓
Pinia store 创建 TaskItem，并启动队列 drainQueue
  ↓
runtime-bridge 调用 Tauri 命令 run_download_task
  ↓
Rust 创建任务控制文件，启动 Node sidecar 子进程
  ↓
sidecar 发现图片并逐张下载、裁剪或转格式
  ↓
sidecar 输出 task-progress / runtime-log / task-result
  ↓
前端实时更新任务进度、状态、日志和本地持久化快照
```

### 选图下载任务

```text
用户进入选图下载模式并解析豆瓣图片页
  ↓
runtime-bridge 调用 discover_douban_photos
  ↓
Rust 以 MCD_COMMAND=douban-photos-discover 启动 sidecar
  ↓
sidecar 按当前分类和游标返回一批图片、nextCursor 与 done
  ↓
前端按分类合并缓存，滚动到底部后继续请求下一批
  ↓
用户选择图片并确认下载
  ↓
runtime-bridge 调用 run_selected_photo_download
  ↓
Rust 以 MCD_COMMAND=douban-selected-download 启动 sidecar
  ↓
sidecar 只下载用户选中的图片列表，并沿用现有进度事件进入任务队列体验
```

## 主要模块

### 前端层：`apps/desktop/src`

- `layouts/AppShell.vue`：应用主布局，挂载任务、搜索、Cookie、图片处理等弹窗。
- `views/ControlCenterView.vue`：控制中心，展示任务队列、Cookie 列表和主要操作按钮。
- `stores/app.ts`：核心状态仓库，管理任务队列、Cookie、日志、持久化、下载调度、选图 seed 和图片处理状态。
- `lib/runtime-bridge.ts`：前端与 Tauri 的统一桥接层，封装搜索、自动下载、选图发现、选图下载和本地文件操作。
- `components/queue/SearchMovieModal.vue`：豆瓣影视搜索弹窗，负责分页缓存、搜索结果展示、添加链接和选图下载入口。
- `components/queue/CreateTaskModal.vue`：添加下载任务弹窗，包含 `自动下载 / 选图下载` 两种模式。
- `components/queue/ImageProcessModal.vue`：图片处理弹窗，负责拼版、透明度、背景重叠和标注导出。
- `components/queue/TaskTable.vue`：任务队列表格，负责分页、进度展示、打开目录和删除确认。
- `components/logs/LogConsole.vue`：日志列表组件。
- `components/cookies/ImportCookieModal.vue`：Cookie 导入弹窗。

### Tauri 层：`apps/desktop/src-tauri`

**模块化架构**（2026年6月重构完成，lib.rs 从 3562 行减少到 857 行）：

**核心入口**：
- `lib.rs`：Tauri 应用入口，注册命令和状态管理

**基础模块**：
- `constants.rs`：应用常量（日志种子、请求间隔、状态版本）
- `types.rs`：类型定义（TableName enum、任务 payload、事件类型）
- `utils.rs`：工具函数（校验、编码、文件名清理、阻塞任务）
- `crypto.rs`：Windows DPAPI Cookie 加密保护
- `task_control.rs`：任务控制注册表（暂停/继续/取消）

**SQLite 模块** (`sqlite/`)：
- `connection.rs`：数据库连接、初始化、损坏检测和备份
- `state.rs`：状态读写、快照管理、日志种子恢复
- `migration.rs`：JSON 到 SQLite 自动迁移

**Sidecar 模块** (`sidecar/`)：
- `runtime.rs`：sidecar 路径解析、请求间隔控制、错误格式化
- `parser.rs`：stdout/stderr 解析、日志/进度事件转发
- `download.rs`：下载任务执行、豆瓣图片发现
- `douban.rs`：豆瓣搜索、标题解析、预览解析

**Commands 模块** (`commands/`)：
- `state.rs`：状态持久化命令（load/save/emit_log）
- `login.rs`：登录窗口管理（check_cookie_status/close_window）
- `task.rs`：任务命令（暂停/继续/清理/下载/搜索）
- `fs.rs`：文件系统操作（删除/清空/选择/打开目录）
- `image.rs`：图片处理（读取/保存裁剪结果）

**核心职责**：
- 读取/保存 SQLite 状态库
- 从旧 JSON 状态迁移到 SQLite
- 检测和恢复损坏状态库
- 启动 sidecar 子进程
- 解析 sidecar stdout/stderr
- 转发日志、任务进度和选图发现进度
- 打开目录、定位文件、删除输出目录
- 读取本地图片和保存图片处理结果
- 管理任务控制文件和 pid 文件
- Windows DPAPI Cookie 加密

**命令列表**：
- `load_persisted_state` / `save_persisted_state`：状态持久化
- `check_login_window_cookie_status` / `close_login_window`：登录窗口
- `run_download_task`：自动下载任务
- `run_selected_photo_download`：选图下载任务
- `discover_douban_photos`：图片发现（不下载，返回列表）
- `search_douban_movies`：豆瓣影视搜索
- `resolve_douban_movie_title` / `resolve_douban_movie_preview`：标题/封面解析
- `pause_download_task` / `resume_download_task` / `clear_download_tasks`：任务控制
- `delete_directory_path` / `clear_directory_contents`：目录管理
- `pick_output_directory` / `open_directory_path` / `reveal_file_path`：目录操作
- `read_dropped_image_file` / `read_local_image_file`：图片读取
- `save_custom_cropped_image` / `save_processed_image`：图片保存

### sidecar 层：`apps/sidecar/src`

sidecar 是独立 Node 进程，不直接操作前端状态，也不直接调用 Tauri API，只通过 stdout 输出结构化 JSON 给 Rust 解析。

核心职责包括：

- 通过 `MCD_COMMAND=douban-search` 执行豆瓣影视搜索。
- 通过 `MCD_COMMAND=douban-photos-discover` 执行选图下载的图片发现模式。
- 通过 `MCD_COMMAND=douban-selected-download` 下载用户选中的图片列表。
- 解析豆瓣详情页、`all_photos` 页面和 `photos?type=S/R/W` 分类页。
- 为搜索弹窗返回影片缩略图、片名、简介和详情页链接。
- 为选图下载返回图片标题、图片地址、页面地址、分类、方向和尺寸信息。
- 下载图片并支持断点续传、请求间隔、暂停/取消控制。
- 使用 `sharp` 做裁剪和格式转换。
- 保存图片后立即上报实时进度。

## 本地持久化设计

应用状态保存在 Tauri 应用数据目录下的 `runtime-state.sqlite`，不保存在项目目录，也不会打进安装包。状态库主要保存：

- 任务队列；
- Cookie 列表；
- 日志列表；
- 队列配置。

前端仍以完整快照保存状态，Rust 层把快照拆分写入 SQLite 表。这样可以保持前端状态结构简单，同时减少单个 JSON 文件变大或损坏后的恢复风险。

如果 SQLite 状态库损坏，Rust 会把主库和 WAL/SHM 文件备份成 `runtime-state.corrupt-*`，再创建干净状态库继续运行。

## 图片输出设计

用户选择的是输出根目录，例如：

```text
D:/cover
```

每个下载任务会在输出根目录下生成影片目录和分类目录，例如：

```text
D:/cover/让子弹飞/still
D:/cover/让子弹飞/poster
D:/cover/让子弹飞/wallpaper
```

图片处理结果固定保存到：

```text
D:/cover/custom-crop-photo
```

删除任务时只会删除任务生成的输出子目录。清空队列时会清理相关输出根目录里的内容并保留根目录本身；代码会拒绝删除或清理输出根目录之外的路径。

## 开发与构建脚本

### 环境检查

首次构建前，运行环境检查脚本：

```powershell
.\scripts\check-build-env.ps1
```

该脚本会检查：Rust 工具链、C++ 编译器、Node.js、pnpm、WebView2、项目依赖、sidecar 构建状态等。

详细的环境配置指南请参考：[docs/windows-setup.md](./docs/windows-setup.md)

### 常用脚本

根目录常用脚本：

```bash
pnpm dev:web              # 启动前端网页预览
pnpm dev:desktop          # 启动 Tauri 桌面开发模式
pnpm build:web            # 构建前端
pnpm build:desktop        # 构建 Windows 桌面安装包
pnpm dev:sidecar          # 启动 sidecar 开发模式
pnpm build:sidecar        # 单独构建 sidecar
pnpm prepare:sidecar-bundle # 打包 sidecar bundle 到 Tauri resources
pnpm test                 # 运行 desktop 和 sidecar 测试
pnpm typecheck            # 前端类型检查
pnpm typecheck:sidecar    # sidecar 类型检查
```

### 完整构建流程

**一键构建（推荐）**：

```powershell
.\scripts\build-with-msvc.ps1
```

该脚本会自动设置 MSVC 环境并按正确顺序执行所有构建步骤。

**详细构建指南**：[docs/build-guide.md](./docs/build-guide.md)  
包含环境安装、打包原理、增量构建、常见问题排查和构建检查清单。

**手动分步构建**：

```powershell
# 1. 检查环境
.\scripts\check-build-env.ps1

# 2. 安装依赖
pnpm install

# 3. 初始化 MSVC 环境（必须先执行）
& "C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64

# 4. 构建 sidecar
pnpm run build:sidecar

# 5. 打包 sidecar bundle
pnpm run prepare:sidecar-bundle

# 6. 构建桌面应用和安装包
pnpm run build:desktop
```

**构建输出**：

```text
apps/desktop/src-tauri/target/release/bundle/
├── msi/Movie Cover Downloader_0.1.0_x64_en-US.msi     (~226 MB)
└── nsis/Movie Cover Downloader_0.1.0_x64-setup.exe    (~226 MB)
```

## 安装包打包说明

Windows 安装包不能只打包 Tauri 前端壳，否则用户机器上没有 Node、sidecar、sharp 等运行资源时会下载失败。因此发布安装包时需要保证：

- 前端静态资源已构建；
- Rust/Tauri 桌面壳已构建；
- sidecar 的 `dist/index.js` 已构建；
- sidecar 运行依赖已复制到 Tauri resources；
- 打包内包含运行 sidecar 所需的 Node 可执行文件；
- **依赖必须使用 hoisted（扁平化）结构，不能使用符号链接**（详见 [docs/sidecar-symlink-fix.md](./docs/sidecar-symlink-fix.md)）；
- 不包含开发机已有的用户数据、下载图片、SQLite 状态库或本地输出目录。

构建完成后的 NSIS 安装包通常位于：

```text
apps/desktop/src-tauri/target/release/bundle/nsis/Movie Cover Downloader_0.1.0_x64-setup.exe
```

### ⚠️ 重要：Sidecar 依赖打包问题

pnpm 默认使用**符号链接（symlink）**管理依赖。这些符号链接指向开发机器的绝对路径，在用户机器上会失效，导致 `Cannot find package 'sharp'` 错误。

**解决方案**：`prepare-sidecar-bundle.ps1` 脚本已配置使用 `node-linker=hoisted` 模式，会创建扁平化的真实文件结构。验证方法：

```powershell
# 检查 sharp 是否为符号链接（应该返回 "真实目录"）
$sharp = Get-Item "apps\desktop\src-tauri\resources\sidecar\node_modules\sharp"
if ($sharp.LinkType) { "❌ 符号链接" } else { "✅ 真实目录" }
```

详细说明请参考：[docs/sidecar-symlink-fix.md](./docs/sidecar-symlink-fix.md)

## 设计边界

- 当前站点支持豆瓣电影，搜索、片名解析、自动下载和选图下载都围绕豆瓣 `subject` 链接设计。
- 选图下载 v1 一次处理一个影片链接；多链接批量下载继续走自动下载模式。
- 前端界面可以在浏览器预览，但真实下载只在 Tauri 桌面环境中执行。
- sidecar 通过环境变量和临时 JSON 文件接收任务参数，通过 stdout 返回事件，不直接依赖前端。
- Cookie 只用于当前请求链路，不应出现在命令行参数中。
- 所有本地文件删除都应经过 Rust 层边界校验。
