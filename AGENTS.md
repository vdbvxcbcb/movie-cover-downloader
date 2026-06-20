# AGENTS.md

本文件给接手 `movie-cover-downloader` 的 agent 使用。先读本文件，再读 `README.md`、`docs/usage-guide.md` 和相关代码。所有回复默认使用简体中文。

为降低 AI 编程场景下的重复扫描成本，处理复杂问题时先读 `docs/ai-context/project-map.md`，再按任务类型读取 `docs/ai-context/runtime-flows.md` 和 `docs/ai-context/module-index.md` 中对应部分。`docs/ai-context` 是导航图谱，不替代当前代码和测试；如果不一致，以代码为准并同步更新图谱。

## 项目概览

`Movie Cover Downloader` 是面向 Windows 的豆瓣影视图片下载器桌面应用，用于下载影视剧照、海报、壁纸，并辅助制作视频封面。

当前已经落地的核心能力：

- 豆瓣影视搜索，支持结果缓存、分页、添加链接、从搜索结果进入选图下载。
- 添加下载任务弹窗包含两种模式：自动下载、选图下载。
- 自动下载支持批量豆瓣 subject 链接、图片类型、数量、尺寸、格式、请求间隔、输出目录。
- 选图下载支持剧照、海报、壁纸 3 个分类的分页/游标式解析，用户滚动到底部才继续请求下一批。
- 选图下载支持单击勾选、拖拽框选、多选、全选当前分类、取消全选、双击预览大图、确认下载选中图片并停止后续解析。
- 选图下载提交前会检测相同链接、输出目录、分类和图片比例的重复任务；确认覆盖后清理旧输出、移除旧任务并重新加入新任务。
- 下载队列支持暂停、继续、重试、删除、清空、打开输出目录、显示实时进度。
- Cookie 导入支持豆瓣登录窗口导入和手动字符串导入。
- 图片处理弹窗支持 1-9 张图片拼版、拖拽上传/换格、背景图、透明度、重叠效果、标注、导出 JPG/PNG。
- 自定义裁剪弹窗支持点击上传和拖拽上传本地图片，拖拽上传不限制图片必须位于输出根目录。
- 日志中心、SQLite 本地状态持久化、NSIS 安装包打包。

当前真实下载链路只围绕豆瓣电影设计。`docs/architecture.md`、`docs/database.md`、`docs/mvp-plan.md` 中有早期规划，例如 ImpAwards、Playwright、托盘、自动更新、代理等；未在代码里落地前，不要当成当前功能。

## 最近几次提交后的重要状态

**Rust 后端模块化重构**（2026年6月完成）：

- lib.rs 从 **3562 行减少到 857 行**（减少 76%）
- 新增 **20 个模块文件**，清晰的职责分离
- 所有 **40 个单元测试**保持通过
- **Clippy 零警告**，符合 Rust 最佳实践
- 修改 Rust 代码时，定位到对应模块文件，而非全部在 lib.rs 中查找

**选图下载状态**：

- `3、添加下载任务` 是下载入口，不要在首页继续增加选图下载按钮。
- `CreateTaskModal.vue` 的选图下载只保留 `剧照 / 海报 / 壁纸` 三个分类，已经移除 `全部` 分类和 `解析当前分类` 按钮。
- 手动粘贴豆瓣链接进入选图下载时，会自动解析影片标题/封面，并默认先解析剧照分类。
- 从搜索影视结果点击 `选图下载` 时，会打开添加下载任务弹窗、进入选图下载模式、带入链接/标题/封面并自动解析。
- 切换选图分类时，应停止上一分类正在解析的任务，再优先解析新分类；这种取消是正常流程，不应弹错误警告。
- 选图下载的后端发现协议是分页/游标式：前端滚动到底部才请求下一批，不能恢复成一次性解析全部图片。
- 用户点击 `下载选中 N 张` 后会弹确认；确认后应停止继续解析后续图片，只下载已选列表。
- 单击图片只负责勾选/取消勾选；双击同一张图片才打开大图预览，不要让单击误触发预览。
- 拖拽框选从图片网格区域触发，超过阈值后进入框选状态；框选会保留拖拽开始前已有选择，并把框选命中的图片设为选中。
- 选图下载提交前要走重复任务检测。重复判定包含链接、输出根目录、分类和图片比例；确认覆盖时要把旧任务从队列和 activeTaskIds 中移除，并清理旧输出目录。
- 选图下载图片列表要有 loading、失败占位图、懒加载/分批显示，避免 400+ 图片一次性渲染造成卡顿。
- 空分类应显示空状态，不要卡在 loading 或提示仍需手动点击“解析当前分类”。
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
├─ docs/                        # 使用说明、AI 项目图谱、早期规划文档
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

**模块化架构**（2026年6月重构完成，lib.rs 从 3562 行减少到 857 行）：

- `apps/desktop/src-tauri/src/lib.rs`：Tauri 应用入口，注册命令和状态管理。
- `apps/desktop/src-tauri/src/main.rs`：Tauri 主程序入口。

**基础模块**：
- `constants.rs`：应用常量（日志种子、请求间隔、状态版本）
- `types.rs`：类型定义（TableName enum、任务 payload、事件类型）
- `utils.rs`：工具函数（校验、编码、文件名清理）
- `crypto.rs`：Windows DPAPI Cookie 加密
- `task_control.rs`：任务控制注册表（暂停/继续/取消）

**SQLite 模块** (`sqlite/`)：
- `connection.rs`：数据库连接、初始化、损坏检测
- `state.rs`：状态读写、快照管理
- `migration.rs`：JSON 到 SQLite 迁移

**Sidecar 模块** (`sidecar/`)：
- `runtime.rs`：sidecar 路径解析、请求间隔控制
- `parser.rs`：stdout/stderr 解析、事件转发
- `download.rs`：下载任务执行、豆瓣图片发现
- `douban.rs`：豆瓣搜索、标题解析、预览解析

**Commands 模块** (`commands/`)：
- `state.rs`：状态持久化命令
- `login.rs`：登录窗口管理
- `task.rs`：任务控制和执行命令
- `fs.rs`：文件系统操作命令
- `image.rs`：图片处理命令

配置文件：
- `apps/desktop/src-tauri/tauri.conf.json`：窗口、CSP、bundle resources 配置。
- `apps/desktop/src-tauri/Cargo.toml`：Rust 依赖。

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
- `selectedPhotoClickTimer` / `selectedPhotoClickPhotoId`：区分单击选择和双击预览。
- `selectedPhotoDragState` / `selectedPhotoDragBox`：拖拽框选状态和可视选区。

行为约束：

- 不要恢复“全部”tab。
- 不要恢复“解析当前分类”按钮。
- 不要在切换分类时继续跑旧分类解析。
- 不要一次性解析全部分类或全部页。
- 不要默认全选解析结果。
- `全选 / 取消全选` 只作用于当前分类。
- 用户确认下载选中图片后，应停止继续解析，提交 selected images 到现有队列。
- 单击图片用于选择，双击图片用于大图预览，并支持左右切换。
- 保留拖拽框选能力，不要把 pointer 事件退回为普通 checkbox 点击。
- 重复选图任务必须先弹出覆盖确认，确认后再用 `createTasks(drafts, { replacementTaskIds })` 替换旧任务。

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
- 预览区应在没有当前分类图片时显示明确空状态；不要让空分类导致预览残留旧图片或布局塌陷。
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
- **模块化开发**：新增功能时，找到对应的模块文件（commands/、sidecar/、sqlite/ 等），不要全部堆在 lib.rs。
- **新增命令**：在 commands/ 模块中添加，然后在 lib.rs 的 `generate_handler!` 中注册。
- Rust 文件系统操作必须做路径规范化和边界校验。
- 不要在 Rust 里 panic 处理外部输入；损坏数据应返回普通错误。
- sidecar stdout/stderr 解析要容错，错误信息要能转成用户可理解日志。
- Windows 路径、中文目录、空格路径都是正常场景。
- Windows 下启动 sidecar/下载进程应避免弹出命令行窗口，注意 `CREATE_NO_WINDOW` / `creation_flags`。
- **代码风格**：遵循 Apollo Rust Best Practices，借用优先于克隆，使用类型安全的 enum。

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
cargo test      # 运行所有 40 个单元测试
cargo check     # 快速类型检查
cargo clippy --all-targets  # Lint 检查，确保零警告
cargo build     # 完整构建
```

修改建议：

- 只改前端 SFC/CSS：至少跑 `pnpm --dir apps/desktop exec vue-tsc --noEmit`。
- 改 sidecar：跑 `pnpm --dir apps/sidecar typecheck` 和相关测试。
- 改 Rust/Tauri：跑 `cargo check` 和 `cargo test`，确保 40 个测试全部通过。
- 改 Rust 模块：运行 `cargo clippy --all-targets` 确保零警告。
- 打包前建议跑 `pnpm test`、`pnpm typecheck`、`pnpm typecheck:sidecar`、`cargo test`。

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

遵循四个原则，解决movie-cover-downloader项目问题：

## 四个原则

### 1. 编码前思考

**不要假设。不要隐藏困惑。呈现权衡。**

LLM 经常默默选择一种解释然后执行。这个原则强制明确推理：

- **明确说明假设** — 如果不确定，询问而不是猜测
- **呈现多种解释** — 当存在歧义时，不要默默选择
- **适时提出异议** — 如果存在更简单的方法，说出来
- **困惑时停下来** — 指出不清楚的地方并要求澄清

### 2. 简洁优先

**用最少的代码解决问题。不要过度推测。**

对抗过度工程的倾向：

- 不要添加要求之外的功能
- 不要为一次性代码创建抽象
- 不要添加未要求的"灵活性"或"可配置性"
- 不要为不可能发生的场景做错误处理
- 如果 200 行代码可以写成 50 行，重写它

**检验标准：** 资深工程师会觉得这过于复杂吗？如果是，简化。

### 3. 精准修改

**只碰必须碰的。只清理自己造成的混乱。**

编辑现有代码时：

- 不要"改进"相邻的代码、注释或格式
- 不要重构没坏的东西
- 匹配现有风格，即使你更倾向于不同的写法
- 如果注意到无关的死代码，提一下 —— 不要删除它

当你的改动产生孤儿代码时：

- 删除因你的改动而变得无用的导入/变量/函数
- 不要删除预先存在的死代码，除非被要求

**检验标准：** 每一行修改都应该能直接追溯到用户的请求。

### 4. 目标驱动执行

**定义成功标准。循环验证直到达成。**

将指令式任务转化为可验证的目标：

| 不要这样做... | 转化为... |
|--------------|-----------------|
| "添加验证" | "为无效输入编写测试，然后让它们通过" |
| "修复 bug" | "编写重现 bug 的测试，然后让它通过" |
| "重构 X" | "确保重构前后测试都能通过" |

对于多步骤任务，说明一个简短的计划：

```
1. [步骤] → 验证: [检查]
2. [步骤] → 验证: [检查]
3. [步骤] → 验证: [检查]
```

如果遇到不确定的设计决策，先停下来问用户，不要自行假设。

## 代码提交

每次代码提交前必须要对未提交的更改做检查，检查完之后再从性能和安全的角度重新做一遍检查。

如果代码审查发现问题，在不影响功能正常运行和界面效果的前提下，修复审查出来的问题。
