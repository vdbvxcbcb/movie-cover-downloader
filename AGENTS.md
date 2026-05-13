# AGENTS.md

本文档给接手 `movie-cover-downloader` 的 agent 使用。请先读本文，再读根目录 `README.md`、`docs/usage-guide.md` 和相关代码。所有回复默认使用简体中文。

## 项目概述

`Movie Cover Downloader` 是一个面向 Windows 的豆瓣影视图片下载器桌面应用，用于下载影视剧照、海报、壁纸并辅助制作视频封面。当前已落地的核心能力包括：

- 豆瓣影片搜索，并把搜索结果加入新增链接任务草稿。
- 批量添加豆瓣 subject 链接下载任务。
- 下载队列、暂停、继续、重试、删除、清空队列。
- Cookie 导入，包括豆瓣登录窗口导入和手动 Cookie 字符串导入。
- 日志中心和实时下载进度。
- SQLite 本地状态持久化。
- 自定义裁剪图片保存。
- 图片处理大弹窗：1-9 张图片拼版、拖拽上传/换格、标注、导出 JPG/PNG。

当前真实下载链路只围绕豆瓣电影设计。`docs/architecture.md`、`docs/database.md`、`docs/mvp-plan.md` 里有一些早期规划，例如 `ImpAwards`、Playwright、托盘、自动更新、代理等；没有在代码里落地前，不要把它们当成当前功能。

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
- `apps/desktop/src/lib/runtime-bridge.ts`：前端和 Tauri 命令的桥接层；浏览器预览模式有降级实现。
- `apps/desktop/src/types/app.ts`：前端状态、任务、Cookie、日志、运行时结果类型。
- `apps/desktop/src/layouts/AppShell.vue`：应用骨架和全局弹窗挂载处。
- `apps/desktop/src/views/ControlCenterView.vue`：控制中心入口。
- `apps/desktop/src/components/queue/CreateTaskModal.vue`：新增链接抓图任务弹窗。
- `apps/desktop/src/components/queue/SearchMovieModal.vue`：豆瓣搜索影视弹窗。
- `apps/desktop/src/components/queue/CustomCropModal.vue`：自定义裁剪弹窗。
- `apps/desktop/src/components/queue/ImageProcessModal.vue`：图片处理大弹窗。
- `apps/desktop/src/components/common/MessageNotice.vue`：全局 Message 提示组件。
- `apps/desktop/src/components/common/ToastNotice.vue`：全局 Toast 提示组件。

关键 Rust/Tauri 文件：

- `apps/desktop/src-tauri/src/lib.rs`：主要命令实现，负责 SQLite、文件读写、目录安全校验、启动 sidecar、转发日志/进度、保存处理后图片等。
- `apps/desktop/src-tauri/src/main.rs`：Tauri 应用入口。
- `apps/desktop/src-tauri/tauri.conf.json`：窗口、CSP、bundle resources 配置。

关键 sidecar 文件：

- `apps/sidecar/src/index.ts`：sidecar 入口，一次进程处理一个任务。
- `apps/sidecar/src/adapters/douban.ts`：豆瓣详情页和图片分类页解析。
- `apps/sidecar/src/services/downloader.ts`：下载、断点续传、sharp 转码/裁剪、保存文件、上报进度。
- `apps/sidecar/src/services/scheduler.ts`：发现、下载、Cookie、任务控制的编排层。
- `apps/sidecar/src/services/task-control.ts`：读取 pause/resume/cancel 控制文件。
- `apps/sidecar/src/shared/contracts.ts`：sidecar stdout 事件和任务契约。
- `apps/sidecar/src/utils/output-folder.ts`：安全生成输出目录和图片文件名。

## 技术栈

- 包管理：`pnpm` workspace，根项目使用 `pnpm@10.33.2`。
- 桌面壳：`Tauri 2`。
- 前端：`Vue 3 + TypeScript + Vite + Pinia + Vue Router`。
- Rust 后端：`tauri`、`rusqlite`、`serde`、`windows-sys`。
- 抓取执行层：`Node.js + TypeScript` sidecar。
- 图片处理：sidecar 使用 `sharp`；前端图片处理弹窗使用浏览器 Canvas，再通过 Tauri 保存。
- 本地持久化：`SQLite`，数据库文件为应用数据目录下的 `runtime-state.sqlite`。
- 目标平台：Windows 10/11。

## 运行与构建命令

根目录常用命令：

```bash
pnpm install
pnpm dev:web
pnpm dev:desktop
pnpm dev:sidecar
pnpm build:web
pnpm build:desktop
pnpm build:sidecar
pnpm typecheck
pnpm typecheck:sidecar
pnpm test
```

用户说“重新启动桌面端应用”时，默认执行：

```bash
pnpm dev:desktop
```

说明：

- `pnpm dev:web` 只启动 Vite 网页预览，不能验证真实 Tauri 命令和真实下载。
- `pnpm dev:desktop` 会通过 Tauri 启动桌面端，并先构建 sidecar。
- `pnpm build:desktop` 会构建 sidecar、准备 Tauri resources，并输出 Windows 安装包。
- NSIS 安装包默认输出：

```text
apps/desktop/src-tauri/target/release/bundle/nsis/Movie Cover Downloader_0.1.0_x64-setup.exe
```

## 数据与持久化

前端仍以完整快照组织状态，Rust 层将快照拆分写入 SQLite。当前核心表包括：

- `tasks`：下载队列任务。
- `cookies`：Cookie 值、顺序、状态、成功/失败计数、冷却和过期信息。
- `app_logs`：运行日志。
- 设置类状态，例如队列配置、输出目录、图片处理输出目录等。

兼容旧数据：

- 旧版 `runtime-state.json` 只用于首次迁移读取。
- 新版本持续读写均使用 SQLite。
- 如果 SQLite 损坏，Rust 会备份主库和 WAL/SHM 文件，再创建干净状态库继续运行。

安全注意：

- Cookie 不应写入命令行参数；当前通过环境变量传给 sidecar，SQLite 中会做保护/兼容处理。
- Cookie 顺序必须保持，避免重启后优先级变化。
- 本地文件删除和清理必须走 Rust 层目录边界校验。

## 运行时链路

新增链接任务链路：

```text
CreateTaskModal
  -> stores/app.ts 创建 TaskItem 并进入队列
  -> runtime-bridge.ts 调用 run_download_task
  -> Tauri Rust 创建控制文件并启动 Node sidecar
  -> sidecar 解析豆瓣页面、下载图片、输出 NDJSON 事件
  -> Rust 解析 stdout/stderr，emit task-progress/runtime-log
  -> Pinia 更新进度、日志、任务状态并防抖保存快照
```

sidecar 输出每行都是 JSON。常见事件：

- `kind: "task-progress"`：前端实时进度。
- `kind: "task-result"`：任务完成结果。
- `kind: "task-paused"`：用户暂停。
- `kind: "task-cancelled"`：用户取消。
- 普通 `level/scope/message`：日志中心。

暂停/继续/取消通过任务控制文件实现：

- `pause`
- `resume`
- `cancel`

sidecar 会在安全点检查控制文件，避免中断在文件写入中间。

## 输出目录规则

下载任务中，用户选择的是输出根目录，例如：

```text
D:/cover
```

任务会在根目录下创建：

```text
片名/still
片名/poster
片名/wallpaper
```

注意：

- 片名来自外部页面内容，必须清理非法字符、保留名、点号目录和路径穿越片段。
- 删除任务只删除任务生成的输出子目录。
- 清空队列会清理相关输出根目录里的内容，但保留根目录本身。
- 所有删除、清空、打开目录、定位文件都要考虑 Windows 路径分隔符和大小写差异。

## 代码开发规范

遵循用户反复强调的四个原则：

1. 编码前思考：不确定就说明假设，必要时询问；不要默默选择高风险解释。
2. 简洁优先：用最少代码解决当前问题，不做未要求的抽象和扩展。
3. 精准修改：只碰请求相关文件；不要顺手重构、改格式、删无关死代码。
4. 目标驱动执行：改动要有可验证结果，尽量跑对应类型检查和测试。

前端规范：

- 优先匹配现有 Vue SFC、Pinia 和 CSS 风格。
- UI 改动必须保持当前深色桌面应用风格，不要做营销页式布局。
- 不要改动原有界面效果，除非用户明确要求。
- 新提示优先使用现有 `MessageNotice.vue` 或 `ToastNotice.vue`，不要回到浏览器 `alert/prompt`。
- 需要图标按钮时，保持现有按钮尺寸、hover、禁用态和 tooltip 风格。
- 文本、按钮、弹窗内容要检查溢出、换行、遮挡问题。

状态管理规范：

- 任务、Cookie、日志、弹窗开关和持久化状态优先放在 `stores/app.ts`。
- 持久化字段必须同步更新 `AppSeedState` 类型、store 快照、Rust SQLite 读写和相关测试。
- 队列执行顺序按添加时间 FIFO，界面排序需求不要破坏后台调度顺序。
- 队列运行中危险操作必须有界面禁用和 store 入口二次保护。

Tauri/Rust 规范：

- 前端需要系统能力时，通过 `runtime-bridge.ts` 调用 Tauri command，不在前端绕过。
- Rust 文件系统操作必须做路径规范化和边界校验。
- 不要在 Rust 里 panic 处理外部输入；损坏数据应返回普通错误。
- sidecar stdout/stderr 解析要容错，错误信息要能转成用户可理解的日志。
- Windows 路径、中文目录、空格路径都必须作为正常场景处理。

sidecar 规范：

- sidecar 不直接操作前端状态，也不调用 Tauri API。
- 新增站点时应新增 adapter，不要把站点逻辑混入 downloader。
- 下载进度必须在每张图片保存成功后上报。
- 图片写入使用 `.part` 临时文件和 resume metadata，成功后清理。
- 豆瓣请求要尊重请求间隔和 Cookie 冷却逻辑，避免提高风控风险。

测试规范：

- 新行为优先补单元测试，尤其是路径、持久化、输入清理、队列状态、下载边界。
- 修改前端类型或 store：跑 `pnpm --dir apps/desktop exec vue-tsc --noEmit`。
- 修改 sidecar：跑 `pnpm --dir apps/sidecar typecheck` 和相关 sidecar 测试。
- 修改 Rust/Tauri：在 `apps/desktop/src-tauri` 下跑 `cargo test` 或至少 `cargo check`。
- 打包前建议跑根目录 `pnpm test`、`pnpm typecheck`、`pnpm typecheck:sidecar`。

## 已有测试入口

根目录：

```bash
pnpm test
pnpm typecheck
pnpm typecheck:sidecar
```

桌面端：

```bash
pnpm --dir apps/desktop exec vue-tsc --noEmit
pnpm --dir apps/desktop test
```

sidecar：

```bash
pnpm --dir apps/sidecar typecheck
pnpm --dir apps/sidecar test
```

Rust：

```bash
cd apps/desktop/src-tauri
cargo test
cargo check
cargo audit
```

`cargo audit` 需要先安装 `cargo-audit`。安装后建议在 `apps/desktop/src-tauri` 下执行。

## 禁止事项

- 不要使用破坏性 Git 命令，例如 `git reset --hard`、`git checkout --`，除非用户明确要求。
- 不要回滚用户或其他 agent 的未提交改动。
- 不要把 Cookie、用户本地路径、下载图片、SQLite 状态库打包进安装包。
- 不要把 Cookie 放进命令行参数或日志。
- 不要绕过 Rust 层边界校验直接删除本地目录。
- 不要在未确认的情况下引入新框架、UI 库或大型依赖。
- 不要把早期规划文档中的功能当成已实现功能来改。
- 不要为了修一个问题重构整条链路。
- 不要用浏览器 `alert`、`confirm`、`prompt` 做正式交互。

## 常见任务提示

- “重新启动桌面端应用”：运行 `pnpm dev:desktop`。
- “重新打包安装包”：运行 `pnpm build:desktop`，优先检查 NSIS 安装包是否存在。
- “推送 release 安装包”：需要 GitHub 网络和权限，通常替换 `v0.1.0` 的 NSIS asset。
- “检查未提交更改”：先看 `git status --short --branch`，再看 staged、unstaged、untracked。
- “写 commit 信息”：先总结实际 diff，再给简洁中文 commit 标题和正文。
- “代码审查”：优先列出会影响正确性、安全、性能、可维护性的离散问题，不报无关样式。

## 文档参考优先级

1. 当前代码和测试。
2. `README.md`、`docs/usage-guide.md`、`apps/sidecar/README.md`。
3. `docs/architecture.md`、`docs/database.md`、`docs/mvp-plan.md` 中的规划信息。

如果文档和代码不一致，除非用户另有要求，以当前代码为准；必要时可以按现有实现更新文档。

如果遇到不确定的设计决策，可以先停下来问我，不要自行假设。

遵循以下四个原则，解决movie-cover-downloader项目问题：

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
