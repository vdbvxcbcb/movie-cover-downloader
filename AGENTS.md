# AGENTS.md

本文件给接手 `movie-cover-downloader` 的 agent 使用。先读本文件，再读 `README.md`、`docs/usage-guide.md` 和相关代码。所有回复默认使用简体中文。

## 项目概览

`Movie Cover Downloader` 是面向 Windows 的豆瓣影视图片下载器桌面应用，用于下载影视剧照、海报、壁纸，并辅助制作视频封面。

当前已经落地的核心能力：

- 豆瓣影视搜索，支持结果缓存、分页、添加链接、从搜索结果进入选图下载。
- 添加下载任务弹窗包含两种模式：自动下载、选图下载。
- 自动下载支持批量豆瓣 subject 链接、图片类型、数量、尺寸、格式、请求间隔、输出目录。
- 选图下载支持剧照、海报、壁纸 3 个分类的分页/游标式解析，用户滚动到底部才继续请求下一批。
- 选图下载支持多选、全选当前分类、取消全选、双击预览大图、确认下载选中图片并停止后续解析。
- 下载队列支持暂停、继续、重试、删除、清空、打开输出目录、显示实时进度。
- Cookie 导入支持豆瓣登录窗口导入和手动字符串导入。
- 图片处理弹窗支持 1-9 张图片拼版、拖拽上传/换格、背景图、透明度、重叠效果、标注、导出 JPG/PNG。
- 自定义裁剪弹窗支持点击上传和拖拽上传本地图片，拖拽上传不限制图片必须位于输出根目录。
- 日志中心、SQLite 本地状态持久化、NSIS 安装包打包。

当前真实下载链路只围绕豆瓣电影设计。`docs/architecture.md`、`docs/database.md`、`docs/mvp-plan.md` 中有早期规划，例如 ImpAwards、Playwright、托盘、自动更新、代理等；未在代码里落地前，不要当成当前功能。

## 最近几次提交后的重要状态

- `3、添加下载任务` 是下载入口，不要在首页继续增加选图下载按钮。
- `CreateTaskModal.vue` 的选图下载只保留 `剧照 / 海报 / 壁纸` 三个分类，已经移除 `全部` 分类和 `解析当前分类` 按钮。
- 手动粘贴豆瓣链接进入选图下载时，会自动解析影片标题/封面，并默认先解析剧照分类。
- 从搜索影视结果点击 `选图下载` 时，会打开添加下载任务弹窗、进入选图下载模式、带入链接/标题/封面并自动解析。
- 切换选图分类时，应停止上一分类正在解析的任务，再优先解析新分类；这种取消是正常流程，不应弹错误警告。
- 选图下载的后端发现协议是分页/游标式：前端滚动到底部才请求下一批，不能恢复成一次性解析全部图片。
- 用户点击 `下载选中 N 张` 后会弹确认；确认后应停止继续解析后续图片，只下载已选列表。
- 选图下载图片列表要有 loading、失败占位图、懒加载/分批显示，避免 400+ 图片一次性渲染造成卡顿。
- 搜索影视结果已做页级缓存；切换已访问页不应重复请求豆瓣。
- 搜索影视弹窗分页器在普通笔记本高度下使用更小尺寸，加载下一页时分页器位置不能上下跳。
- 图片处理弹窗在普通笔记本宽度下仍应尽量保持横向三栏布局，左侧布局选择区域要能看清文字，中间预览区可适当缩窄。
- 控制中心和弹窗都要避免横向滚动；不是隐藏内容，而是重新排版到当前屏幕宽度内，超出高度时用纵向滚动。
- 自定义裁剪点击上传和拖拽上传权限应一致：拖拽本地图片读取使用 `readDroppedImageFile`，不要再绑定输出根目录。

## 项目结构

```text
movie-cover-downloader/
├─ apps/
│  ├─ desktop/                 # Vue 前端 + Tauri 桌面应用
│  │  ├─ src/                   # UI、Pinia、路由、运行时桥接、测试
│  │  └─ src-tauri/             # Rust/Tauri 命令层、SQLite、文件系统、sidecar 进程管理
│  └─ sidecar/                  # Node.js 抓取执行层
│     └─ src/                   # 豆瓣适配、下载、裁剪、续传、进度事件
├─ docs/                        # 架构、数据库草案、MVP、使用说明
├─ scripts/                     # sidecar 打包资源准备脚本
├─ package.json                 # pnpm workspace 脚本入口
└─ README.md                    # 当前项目说明
```

关键前端文件：

- `apps/desktop/src/stores/app.ts`：核心 Pinia store，管理任务、Cookie、日志、弹窗状态、持久化、队列调度。
- `apps/desktop/src/lib/runtime-bridge.ts`：前端和 Tauri 命令桥接层。
- `apps/desktop/src/types/app.ts`：前端状态、任务、Cookie、日志、运行时结果类型。
- `apps/desktop/src/layouts/AppShell.vue`：应用骨架和全局弹窗挂载处。
- `apps/desktop/src/views/ControlCenterView.vue`：控制中心入口。
- `apps/desktop/src/components/queue/CreateTaskModal.vue`：添加下载任务弹窗，包含自动下载和选图下载。
- `apps/desktop/src/components/queue/SearchMovieModal.vue`：豆瓣搜索影视弹窗。
- `apps/desktop/src/components/queue/TaskTable.vue`：下载队列表格、封面兜底、任务操作。
- `apps/desktop/src/components/queue/CustomCropModal.vue`：自定义裁剪弹窗。
- `apps/desktop/src/components/queue/ImageProcessModal.vue`：图片处理大弹窗。
- `apps/desktop/src/components/common/MessageNotice.vue`：全局 Message 提示。
- `apps/desktop/src/components/common/ToastNotice.vue`：全局 Toast 提示。

关键 Rust/Tauri 文件：

- `apps/desktop/src-tauri/src/lib.rs`：主要 Tauri command，实现 SQLite、文件读写、目录安全校验、启动 sidecar、转发日志/进度、保存图片等。
- `apps/desktop/src-tauri/src/main.rs`：Tauri 应用入口。
- `apps/desktop/src-tauri/tauri.conf.json`：窗口、CSP、bundle resources 配置。

关键 sidecar 文件：

- `apps/sidecar/src/index.ts`：sidecar 入口，一次进程处理一个命令。
- `apps/sidecar/src/adapters/douban.ts`：豆瓣详情页、搜索页、图片分类页解析。
- `apps/sidecar/src/services/douban-title.ts`：豆瓣标题/封面预览解析。
- `apps/sidecar/src/services/downloader.ts`：下载、断点续传、sharp 转码/裁剪、保存文件、上报进度。
- `apps/sidecar/src/services/scheduler.ts`：发现、下载、Cookie、任务控制编排。
- `apps/sidecar/src/services/task-control.ts`：读取 pause/resume/cancel 控制文件。
- `apps/sidecar/src/shared/contracts.ts`：sidecar stdout 事件和任务契约。
- `apps/sidecar/src/utils/source-detector.ts`：豆瓣图片分类入口 URL 生成。
- `apps/sidecar/src/utils/output-folder.ts`：安全生成输出目录和图片文件名。

## 运行与构建命令

根目录常用命令：

```bash
pnpm install
pnpm dev:web
pnpm dev:desktop
pnpm build:web
pnpm build:desktop
pnpm build:sidecar
pnpm typecheck
pnpm typecheck:sidecar
pnpm test
```

说明：

- 用户说“重新启动桌面端应用”时，默认运行 `pnpm dev:desktop`。
- `pnpm dev:web` 只启动 Vite 网页预览，不能验证真实 Tauri 命令、真实本地文件能力和真实下载。
- `pnpm dev:desktop` 会通过 Tauri 启动桌面端，并先构建 sidecar。
- `pnpm build:desktop` 会构建 sidecar、准备 Tauri resources，并输出 Windows 安装包。
- 如果完整 `pnpm build:desktop` 在 NSIS 阶段超时，但 release exe 已构建，可单独执行：

```bash
pnpm --dir apps/desktop tauri build --bundles nsis
```

NSIS 安装包默认输出：

```text
apps/desktop/src-tauri/target/release/bundle/nsis/Movie Cover Downloader_0.1.0_x64-setup.exe
```

打包后要检查安装包的 `LastWriteTime`、大小，必要时计算 SHA256。

## 选图下载链路

选图下载有两条自然路径：

```text
知道链接：
3、添加下载任务 -> 选图下载 -> 粘贴 subject/all_photos/photos?type= 链接 -> 自动解析剧照 -> 切换分类/滚动继续解析 -> 勾选下载

不知道链接：
2、搜索影视 -> 搜索片名 -> 结果里的选图下载 -> 打开添加下载任务弹窗 -> 自动带入链接/标题/封面 -> 自动解析
```

前端关键状态：

- `selectedPhotoLink`：当前选图下载链接。
- `selectedPhotoFilter`：当前分类，只能是 `still | poster | wallpaper`。
- `selectedPhotoDiscoveryByAsset`：每个分类的 cursor/done 状态。
- `selectedPhotoVisibleLimit`：当前已展示图片数量，默认 28 张。
- `selectedPhotoGridLoadingRequested`：滚动到底部后请求继续展示/继续解析。
- `selectedDiscoveryTaskId`：当前 discovery 任务 id，用于取消。
- `selectedPhotoLoadedUrls` / `selectedPhotoFailedUrls`：缩略图 loading 和失败占位控制。

行为约束：

- 不要恢复“全部”tab。
- 不要恢复“解析当前分类”按钮。
- 不要在切换分类时继续跑旧分类解析。
- 不要一次性解析全部分类或全部页。
- 不要默认全选解析结果。
- `全选 / 取消全选` 只作用于当前分类。
- 用户确认下载选中图片后，应停止继续解析，提交 selected images 到现有队列。
- 大图预览是双击图片触发，并支持左右切换。

运行时链路：

```text
CreateTaskModal
  -> runtime-bridge.discoverDoubanPhotos
  -> Tauri discover_douban_photos
  -> sidecar MCD_COMMAND=douban-photos-discover
  -> 返回一批图片 + nextCursor + done
  -> 前端合并缓存并按滚动继续请求

CreateTaskModal
  -> runtime-bridge.runSelectedPhotoDownload
  -> Tauri run_selected_photo_download
  -> sidecar MCD_COMMAND=douban-selected-download
  -> 只下载 selectedImages
```

## 搜索影视弹窗

- 搜索需要可用豆瓣 Cookie；没有 Cookie 时应提示先导入。
- 搜索结果页已做内存缓存，缓存 key 包含 query 和 page。
- 结果按钮顺序为：`选图下载`、`添加链接`、`删除链接`。
- `添加链接` 已添加时可以禁用或显示已添加，但 `选图下载` 仍应可用。
- 普通笔记本高度下分页器更小；点击下一页进入 loading 时分页器不能上移。
- 搜索结果封面优先使用 `coverDataUrl`，再用 `coverUrl`，失败时保留占位。

## 图片处理和自定义裁剪

图片处理弹窗：

- 支持 1-9 张图片布局、拖拽上传、格子换位、背景图、背景图透明度、重叠效果、图片透明度、标注、导出。
- 普通笔记本下仍优先保持横向布局，不要轻易回退成竖向布局。
- 左侧布局选择区域要能显示文字；中间预览区可以在普通屏下适当缩窄。
- 方框、圆圈、箭头等标注拖拽完成后不显示拖拽点；再次点击选中后再显示点位和设置。
- 箭头应保持 2D 平面旋转，箭头头部为三角形，不要发生 3D 偏转。

自定义裁剪弹窗：

- 点击上传使用浏览器 File。
- Tauri 拖拽本地路径应走 `runtimeBridge.readDroppedImageFile(filePath)`。
- 不要把自定义裁剪拖拽读取重新改成 `readLocalImageFile(filePath, outputRootDir)`，否则会再次限制图片必须位于输出根目录。
- 保存裁剪结果仍固定写入输出根目录下的 `custom-crop-photo`。

## 数据与持久化

前端以完整快照组织状态，Rust 层将快照拆分写入 SQLite。当前核心表包括：

- `tasks`：下载队列任务。
- `cookies`：Cookie 值、顺序、状态、成功/失败计数、冷却和过期信息。
- `app_logs`：运行日志。
- 设置类状态，例如队列配置、输出目录、图片处理输出目录等。

兼容旧数据：

- 旧版 `runtime-state.json` 只用于首次迁移读取。
- 新版本持续读写 SQLite。
- 如果 SQLite 损坏，Rust 会备份主库和 WAL/SHM 文件，再创建干净状态库继续运行。

安全注意：

- Cookie 不应写入命令行参数或日志。
- Cookie 当前通过环境变量传给 sidecar，SQLite 中会做保护/兼容处理。
- Cookie 顺序必须保持，避免重启后优先级变化。
- 本地文件删除和清理必须走 Rust 层目录边界校验。

## 代码开发原则

遵循用户反复强调的四个原则：

1. 编码前思考：不确定就说明假设，必要时询问；不要默默选择高风险解释。
2. 简洁优先：用最少代码解决当前问题，不做未要求的抽象和扩展。
3. 精准修改：只碰请求相关文件；不要顺手重构、改格式、删除无关死代码。
4. 目标驱动执行：改动要有可验证结果，尽量跑对应类型检查和测试。

前端规范：

- 优先匹配现有 Vue SFC、Pinia 和 CSS 风格。
- UI 保持当前深色桌面应用风格，不要做营销页式布局。
- 不要增加首页按钮，下载相关能力优先收进添加下载任务弹窗。
- 不要用浏览器 `alert`、`confirm`、`prompt` 做正式交互；使用现有 `MessageNotice`、`ToastNotice`、`PopConfirmAction`。
- 文本、按钮、弹窗内容要检查溢出、换行、遮挡。
- 普通笔记本屏幕是高频验收场景，尤其要检查纵向滚动、底部操作条、分页器、横向溢出。

状态管理规范：

- 任务、Cookie、日志、弹窗开关和持久化状态优先放在 `stores/app.ts`。
- 持久化字段必须同步更新 `AppSeedState` 类型、store 快照、Rust SQLite 读写和相关测试。
- 队列执行顺序按添加时间 FIFO，界面排序需求不要破坏后台调度顺序。
- 队列运行中危险操作必须有界面禁用和 store 入口二次保护。

Tauri/Rust 规范：

- 前端需要系统能力时，通过 `runtime-bridge.ts` 调用 Tauri command，不在前端绕过。
- Rust 文件系统操作必须做路径规范化和边界校验。
- 不要在 Rust 里 panic 处理外部输入；损坏数据应返回普通错误。
- sidecar stdout/stderr 解析要容错，错误信息要能转成用户可理解日志。
- Windows 路径、中文目录、空格路径都是正常场景。
- Windows 下启动 sidecar/下载进程应避免弹出命令行窗口，注意 `CREATE_NO_WINDOW` / `creation_flags`。

sidecar 规范：

- sidecar 不直接操作前端状态，也不调用 Tauri API。
- 新增站点时新增 adapter，不要把站点逻辑混入 downloader。
- 下载进度必须在每张图片保存成功后上报。
- 图片写入使用 `.part` 临时文件和 resume metadata，成功后清理。
- 豆瓣请求要尊重请求间隔和 Cookie 冷却逻辑，避免提高风控风险。
- 选图发现模式只返回图片列表和 cursor，不保存文件。
- 选图下载模式只下载前端传入的 selected images。

## 验证入口

常用验证：

```bash
pnpm --dir apps/desktop exec vue-tsc --noEmit
pnpm --dir apps/sidecar typecheck
pnpm test
```

桌面端测试：

```bash
pnpm --dir apps/desktop test
```

sidecar 测试：

```bash
pnpm --dir apps/sidecar test
```

Rust：

```bash
cd apps/desktop/src-tauri
cargo test
cargo check
```

修改建议：

- 只改前端 SFC/CSS：至少跑 `pnpm --dir apps/desktop exec vue-tsc --noEmit`。
- 改 sidecar：跑 `pnpm --dir apps/sidecar typecheck` 和相关测试。
- 改 Rust/Tauri：跑 `cargo check` 或 `cargo test`。
- 打包前建议跑 `pnpm test`、`pnpm typecheck`、`pnpm typecheck:sidecar`。

## 禁止事项

- 不要使用破坏性 Git 命令，例如 `git reset --hard`、`git checkout --`，除非用户明确要求。
- 不要回滚用户或其他 agent 的未提交改动。
- 不要把 Cookie、用户本地路径、下载图片、SQLite 状态库打包进安装包。
- 不要把 Cookie 放进命令行参数或日志。
- 不要绕过 Rust 层边界校验直接删除本地目录。
- 不要在未确认的情况下引入新框架、UI 库或大型依赖。
- 不要把早期规划文档中的功能当成已实现功能来改。
- 不要为修一个问题重构整条链路。
- 不要恢复已明确移除的选图下载 `全部` tab 或 `解析当前分类` 按钮。

## 常见任务提示

- “重新启动桌面端应用”：运行 `pnpm dev:desktop`。
- “重新打包安装包”：优先运行 `pnpm build:desktop`；如果只需 NSIS exe，可运行 `pnpm --dir apps/desktop tauri build --bundles nsis`。
- “推送 release 安装包”：需要 GitHub 网络和权限，通常替换 `v0.1.0` 的 NSIS asset。
- “检查未提交更改”：先看 `git status --short --branch`，再看 staged、unstaged、untracked。
- “写 commit 信息”：先总结实际 diff，再给简洁 commit 标题和正文。
- “代码审查”：优先列出影响正确性、安全、性能、可维护性的离散问题，不报无关样式。

## 文档优先级

1. 当前代码和测试。
2. `AGENTS.md`、`README.md`、`docs/usage-guide.md`、`apps/sidecar/README.md`。
3. `docs/architecture.md`、`docs/database.md`、`docs/mvp-plan.md` 中的规划信息。

如果文档和代码不一致，除非用户另有要求，以当前代码为准；必要时按现有实现更新文档。

如果遇到不确定的设计决策，先停下来问用户，不要自行假设。
