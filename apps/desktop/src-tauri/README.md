# Tauri Backend

`apps/desktop/src-tauri` 是 Movie Cover Downloader 桌面端的 Rust/Tauri 后端。前端通过 `apps/desktop/src/lib/runtime-bridge.ts` 调用这里注册的 Tauri commands，Rust 层再负责本地状态、文件系统、登录窗口、sidecar 子进程、运行日志和任务控制。

本目录只承载桌面系统能力和跨进程桥接，不负责 Vue UI 状态，也不直接解析豆瓣网页内容。真实抓取和图片下载逻辑在 `apps/sidecar`。

## 功能概述

- 启动 Tauri 2 桌面应用，并注册前端可调用的 commands。
- 管理 SQLite 本地状态库，保存任务、Cookie、日志和设置类状态。
- 兼容旧版 `runtime-state.json` 首次迁移到 SQLite。
- 在 Windows 上用 DPAPI 保护 Cookie 持久化 payload。
- 启动 Node sidecar 子进程，注入任务环境变量，并解析 stdout/stderr。
- 将 sidecar 日志、下载进度、选图发现进度转发为前端事件。
- 管理任务控制文件和 pid 文件，支持暂停、继续、取消和清空队列。
- 提供安全的本地文件系统能力：选择目录、打开目录、定位文件、删除/清空输出目录。
- 提供图片读写能力：读取本地/拖拽图片，保存自定义裁剪图和图片处理成品图。
- 管理豆瓣登录 WebView Cookie 读取和登录窗口关闭。
- 配置 Tauri 窗口、CSP、bundle resources、图标和 WebView2 离线安装。

## 职责边界

| 层级 | 本目录负责 | 不负责 |
| --- | --- | --- |
| Tauri 入口 | 注册 commands、插件和全局状态 | 前端组件状态和界面交互 |
| Commands | 把前端请求转换成本地能力或 sidecar 调用 | 直接解析豆瓣 HTML |
| Sidecar 管理 | 解析路径、启动子进程、转发事件、处理退出错误 | 下载图片的具体 HTTP/Sharp 逻辑 |
| SQLite | 状态快照拆表保存、恢复和损坏库备份 | 前端 Pinia 内部状态计算 |
| 文件系统 | 路径规范化、边界校验、打开/删除/保存文件 | 绕过输出根目录边界执行危险删除 |
| Cookie | 登录窗口 Cookie 读取、SQLite 中 DPAPI 保护 | 把 Cookie 写入命令行或日志 |

## 目录结构

```text
apps/desktop/src-tauri/
├─ Cargo.toml                 # Rust crate、Tauri、SQLite、DPAPI 依赖
├─ Cargo.lock                 # Rust 依赖锁定
├─ build.rs                   # tauri-build 构建入口
├─ tauri.conf.json            # Tauri 窗口、CSP、bundle、resources 配置
├─ capabilities/
│  └─ default.json            # 主窗口权限：core、webview、opener
├─ icons/                     # 应用图标
├─ resources/
│  └─ sidecar/                # 打包时生成的 sidecar 运行资源，不应手写维护
└─ src/
   ├─ main.rs                 # 桌面应用二进制入口
   ├─ lib.rs                  # Tauri Builder 入口、command 注册、单元测试
   ├─ constants.rs            # 全局常量、日志 id、请求间隔、文件大小限制
   ├─ types.rs                # Tauri command payload、事件、SQLite 表名类型
   ├─ utils.rs                # 任务 id、时间戳、文件名、路径、阻塞任务工具
   ├─ crypto.rs               # Cookie payload DPAPI 保护和兼容解密
   ├─ task_control.rs         # 任务控制注册表、控制文件、pid 终止
   ├─ commands/
   │  ├─ mod.rs               # command 模块导出
   │  ├─ state.rs             # load/save SQLite 状态、主动运行日志
   │  ├─ login.rs             # 豆瓣登录窗口 Cookie 检查和关闭
   │  ├─ task.rs              # 任务控制、下载、选图发现、搜索、标题预览
   │  ├─ fs.rs                # 目录选择、打开、定位、删除和清空
   │  └─ image.rs             # 图片读取、裁剪结果保存、处理图保存
   ├─ sidecar/
   │  ├─ mod.rs               # sidecar 模块导出
   │  ├─ runtime.rs           # sidecar 路径、node、入口、请求间隔、错误格式化
   │  ├─ download.rs          # 下载/选图发现子进程启动和 stdout/stderr 线程读取
   │  ├─ parser.rs            # sidecar stdout/stderr JSON 解析和前端事件转发
   │  └─ douban.rs            # 搜索、标题、预览等短生命周期 sidecar 命令
   └─ sqlite/
      ├─ mod.rs               # SQLite 模块导出
      ├─ connection.rs        # DB 路径、连接、建表、WAL、损坏库备份
      ├─ state.rs             # 快照拆表写入、读取重组、Cookie 解密、日志 seed
      └─ migration.rs         # 旧 JSON 状态迁移和保存失败恢复
```

## 关键文件说明

### `src/main.rs`

桌面应用二进制入口，调用 `movie_cover_downloader_desktop_lib::run()`。release 构建下带 `windows_subsystem = "windows"`，避免启动时弹出额外控制台窗口。

### `src/lib.rs`

Tauri 后端入口。它声明模块，创建 `TaskControlRegistry` 全局状态，初始化 `tauri-plugin-opener`，并在 `generate_handler!` 中注册所有前端可调用 commands。

新增 Tauri command 时，通常流程是：

1. 在 `src/commands/<domain>.rs` 中实现函数。
2. 在 `src/commands/mod.rs` 重新导出。
3. 在 `src/lib.rs` 的 `generate_handler!` 中注册。
4. 在前端 `runtime-bridge.ts` 中增加调用。

`lib.rs` 底部还保留 Rust 单元测试，覆盖 SQLite 恢复、Cookie 保护、目录边界、图片读取、任务控制等高风险边界。

### `src/types.rs`

集中定义 Rust 与前端交互的 payload 和事件类型：

- `DownloadTaskPayload`
- `DiscoverDoubanPhotosPayload`
- `SelectedPhotoDownloadPayload`
- `SelectedPhotoPayload`
- `RuntimeLogPayload`
- `RuntimeLogEvent`
- `RuntimeTaskProgressEvent`
- `LoginWindowCookieStatus`
- `TableName`

字段通过 `serde(rename_all = "camelCase")` 与前端 TypeScript payload 对齐。跨层字段变更时要同步前端类型、runtime bridge、sidecar contract 和测试。

### `src/constants.rs`

保存全局常量：

- `APP_STATE_SCHEMA_VERSION = 2`
- `LOG_ID_SEED`
- 请求间隔限制：1000ms 到 5000ms
- 选图发现 batch 限制：1 到 60，默认 28
- 拖拽图片最大 100MB
- Windows `CREATE_NO_WINDOW`
- Cookie 保护 scheme：`win32-dpapi`

### `src/utils.rs`

通用工具函数，包括：

- `validate_task_id`：只允许字母、数字、短横线、下划线，避免路径穿越。
- `timestamp_now`：生成运行日志时间戳。
- `hex_encode` / `hex_decode`：Cookie 加密 payload 编码。
- `escape_powershell_single_quote`：目录选择器 PowerShell 参数转义。
- `sanitize_processed_image_file_name`：保存处理图时清理非法/保留文件名。
- `is_supported_local_image_path`：限制本地图片扩展名。
- `run_blocking_job`：把阻塞 IO 或子进程任务放到 Tauri blocking runtime，避免 UI 假死。

### `src/crypto.rs`

Cookie 持久化保护模块。Windows 下使用 DPAPI `CryptProtectData` / `CryptUnprotectData`，非 Windows 测试或开发环境退化为原文 round-trip。

写入 SQLite 时，Cookie payload 会保存为：

```json
{
  "protected": true,
  "scheme": "win32-dpapi",
  "payload": "hex..."
}
```

读取时仍兼容旧版未保护明文 Cookie payload。

### `src/task_control.rs`

任务控制注册表。它维护：

- 内存中的暂停任务集合。
- task id 到控制文件路径的映射。
- `pause` / `resume` / `cancel` 控制文件写入。
- `.pid` 文件读取和后台 sidecar 进程终止。

控制文件位于 Tauri 应用数据目录下，不写入用户选择的图片输出目录。删除任务或清空队列时，会写 `cancel` 并尝试终止仍在运行的 sidecar 进程。

## Commands 模块

### `src/commands/state.rs`

- `load_persisted_state`：打开 SQLite，必要时迁移旧 JSON；如果状态库损坏，备份后重建。
- `save_persisted_state`：前端传入完整快照 JSON，Rust 拆分写入 SQLite。
- `emit_runtime_log`：前端主动写运行日志，仍通过统一 `runtime-log` 事件返回。

### `src/commands/login.rs`

- `check_login_window_cookie_status`：读取指定 WebViewWindow Cookie，只有 `dbcl2` 和 `ck` 同时存在时返回 `ready`。
- `close_login_window`：关闭豆瓣登录窗口。

### `src/commands/task.rs`

任务相关主入口：

- `pause_download_task`
- `resume_download_task`
- `clear_download_tasks`
- `run_download_task`
- `run_selected_photo_download`
- `discover_douban_photos`
- `search_douban_movies`
- `resolve_douban_movie_title`
- `resolve_douban_movie_preview`

长任务都通过 `run_blocking_job` 执行，避免阻塞 Tauri 主线程。选中图片下载会先把 selected images 写入应用数据目录下的临时 JSON 文件，再把文件路径传给 sidecar。

### `src/commands/fs.rs`

本地文件系统命令：

- `pick_output_directory`：Windows 下通过 PowerShell + `System.Windows.Forms.FolderBrowserDialog` 打开目录选择器。
- `open_directory_path`：打开已存在目录。
- `reveal_file_path`：打开文件所在目录并选中文件。
- `delete_directory_path`：删除输出目录，并清理空的分类/影片父目录。
- `clear_directory_contents`：清空目录内容但保留目录本身。
- `open_output_dir`：兼容早期内部输出目录命令。

删除和清空都会 canonicalize 路径并校验目标必须在输出根目录内，且拒绝删除输出根目录本身或磁盘根目录。

### `src/commands/image.rs`

图片读写命令：

- `read_local_image_file(filePath, outputRootDir)`：只允许读取输出根目录内图片。
- `read_dropped_image_file(filePath)`：拖拽外部本地图片读取，不绑定输出根目录。
- `save_custom_cropped_image(outputRootDir, fileName, bytes)`：保存到 `custom-crop-photo` 子目录。
- `save_processed_image(outputRootDir, fileName, bytes)`：保存图片处理弹窗导出的成品图。

读取图片会校验扩展名和 100MB 大小限制；保存图片要求输出目录为绝对路径，并清理文件名。

## Sidecar 模块

### `src/sidecar/runtime.rs`

解析 sidecar 运行环境：

- 开发环境使用仓库内 `apps/sidecar`。
- release 环境优先使用 Tauri resources 中的 `sidecar`。
- 优先使用打包资源内的 `node.exe`，否则回退系统 `node`。
- Node 入口参数固定为 `./dist/index.js`，避免 Windows 盘符路径被误解析。
- 请求间隔从秒转毫秒，并限制在 1000ms 到 5000ms。
- sidecar 失败时优先返回业务错误消息。

### `src/sidecar/download.rs`

启动长生命周期 sidecar 子进程：

- 自动下载：默认 `MCD_COMMAND` 未设置。
- 选图发现：`MCD_COMMAND=douban-photos-discover`。
- 选中图片下载：`MCD_COMMAND=douban-selected-download`。

它会注入 `MCD_BOOTSTRAP_*`、`MCD_DOUBAN_*`、`MCD_IMAGE_*`、`MCD_TASK_CONTROL_FILE` 等环境变量，隐藏 Windows 控制台窗口，写入 `.pid` 文件，并用独立线程持续读取 stdout/stderr。

正常结束必须拿到 sidecar 的结果 JSON；非 0 退出会返回最近的业务错误或 stderr。

### `src/sidecar/parser.rs`

解析 sidecar stdout/stderr：

- `task-result`：保存最终结果给 command 返回。
- `task-progress`：发送前端 `task-progress` 事件，并写隐藏进度日志。
- `task-paused` / `task-cancelled`：记录为可识别错误消息。
- 普通 `level/scope/message`：转为 `runtime-log` 事件。
- `douban-photos-discover-progress`：发送 `douban-photo-discovery-progress` 事件。
- `douban-photos-discover-result`：保存发现批次结果。

stderr 一律作为错误日志，并记住最后一条错误供命令失败时返回。

### `src/sidecar/douban.rs`

启动短生命周期 sidecar 命令：

- `douban-search`：豆瓣搜索，返回分页结果。
- `resolve_douban_movie_title_blocking`：通过 `douban-title` 返回片名。
- `resolve_douban_movie_preview_blocking`：通过 `douban-title` 返回完整预览 payload，供前端显示标题和封面。

这些命令用 `Command::output()` 一次性等待结果，并通过 `parse_sidecar_json_result` 提取 payload。

## SQLite 模块

### `src/sqlite/connection.rs`

状态库路径为 Tauri 应用数据目录下的 `runtime-state.sqlite`。连接时会：

- 创建父目录。
- 设置 `busy_timeout = 5s`。
- 启用 WAL。
- 创建 `app_meta`、`tasks`、`cookies`、`app_logs` 表。

如果发现可恢复损坏，会把主库、`-wal`、`-shm` 一起改名为 `runtime-state.corrupt-<timestamp>.*` 后重建。

### `src/sqlite/state.rs`

前端仍以完整 `AppSeedState` 快照保存，Rust 在事务中拆分写入：

- `tasks`：按前端数组顺序写入和读取，保持队列顺序。
- `cookies`：按顺序写入和读取，保持 Cookie 优先级。
- `app_logs`：按 id 保存，读取时按 id 倒序。
- `app_meta`：保存 `schemaVersion`、`queueConfig`、`createTaskOutputRootDir`、`imageProcessOutputRootDir`。

读取日志后会恢复 `LOG_ID_SEED`，避免重启后日志 id 重复。

### `src/sqlite/migration.rs`

兼容旧版 `runtime-state.json`。只有 SQLite 为空且旧 JSON 存在时才迁移，避免覆盖新状态。保存失败如果判断为可恢复 SQLite 损坏，会备份旧库并重试一次写入。

## 配置文件

### `tauri.conf.json`

关键配置：

- 主窗口标题：`影视封面下载器`。
- 默认窗口 1520x960，最小 1280x800，启动最大化。
- CSP 允许 Tauri IPC、本地 Vite dev server、豆瓣页面和豆瓣图片域名。
- bundle resources 把 `resources/sidecar` 打包为 `sidecar`。
- Windows WebView2 使用 offline installer silent 模式。

### `capabilities/default.json`

主窗口权限包括：

- `core:default`
- `core:webview:allow-clear-all-browsing-data`
- `core:webview:allow-create-webview-window`
- `opener:default`

### `Cargo.toml`

主要依赖：

- `tauri = "2"`
- `tauri-plugin-opener = "2"`
- `serde` / `serde_json`
- `rusqlite` bundled SQLite
- `windows-sys` DPAPI 相关 Win32 API

## 运行与验证

在项目根目录常用：

```bash
pnpm dev:desktop
pnpm build:desktop
```

只检查 Rust/Tauri：

```bash
cd apps/desktop/src-tauri
cargo check
cargo test
cargo clippy --all-targets
cargo build
```

打包前 sidecar resources 由根目录脚本准备：

```bash
pnpm prepare:sidecar-bundle
```

Windows release 重新打包时优先使用项目脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-with-msvc.ps1
```

## 开发注意事项

- 新增系统能力时先放到合适的 `commands/*` 文件，不要把逻辑堆回 `lib.rs`。
- 所有长耗时任务必须走 `run_blocking_job` 或等价阻塞线程，避免 UI 假死。
- Cookie 不要写入命令行、日志或普通明文字段；持久化时走 `crypto.rs`。
- 删除、清空、保存文件前必须 canonicalize 路径并校验输出根目录边界。
- 自定义裁剪拖拽外部图片应走 `read_dropped_image_file`，不要重新限制到输出根目录。
- Windows 路径、中文目录、空格路径都是正常场景，命令行参数和 PowerShell 字符串要谨慎转义。
- sidecar stdout 是跨层协议，新增 `kind` 时要同步 `parser.rs`、sidecar `logger/contracts` 和前端事件处理。
- `resources/sidecar` 是构建产物目录，由脚本生成；不要手动维护或提交用户本地状态、Cookie、下载图片。
