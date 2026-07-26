# Movie Cover Downloader 使用说明

本文档按当前仓库代码编写，只覆盖已经落地的功能。当前应用是面向 Windows 的豆瓣影视图片下载器，真实下载链路围绕豆瓣电影 `subject` 页面、图片分类页和豆瓣图片资源设计。

## 1. 支持范围

- 目标平台：Windows 桌面端。
- 最低支持系统：Windows 10。
- 不支持：Windows 7 / 8 / 8.1。
- 当前站点：豆瓣电影。
- 当前主页面：控制中心、日志中心。
- 真实下载环境：Tauri 桌面端或安装包环境；网页预览只能看界面和部分交互。

控制中心顶部按钮依次为：

- `1、导入Cookie`
- `2、搜索影视`
- `3、添加下载任务`
- `4、自定义裁剪`
- `5、图片处理`
- `6、清空队列任务`

除了导入 Cookie 外，搜索、添加任务、裁剪和图片处理入口都要求先存在可用 Cookie 记录。

## 2. 安装和启动

建议开发环境：

- Windows 10 / 11
- Node.js >= 20
- pnpm 10.33.2（由根目录 `package.json` 固定）
- Rust stable
- Visual Studio Build Tools + MSVC x64 工具链
- WebView2 Runtime

安装依赖：

```bash
pnpm install
```

常用命令：

```bash
pnpm dev:web
pnpm dev:desktop
pnpm dev:sidecar
pnpm build:web
pnpm build:desktop
pnpm build:sidecar
pnpm prepare:sidecar-bundle
pnpm typecheck
pnpm typecheck:sidecar
pnpm test
```

`pnpm dev:web` 会启动 Vite 网页预览，固定端口为：

```text
http://127.0.0.1:5173
```

网页预览适合检查界面，不会执行真实 Tauri command、登录窗口、本地文件读写或 sidecar 下载。

`pnpm dev:desktop` 会启动 Tauri 桌面开发模式。它会先通过 `apps/desktop/package.json` 的 `predev` 构建 sidecar，再启动桌面窗口。真实下载、Cookie 登录导入、目录选择、拖拽本地图片读取和 sidecar 子进程都要用这个模式验证。

注意：`pnpm dev:web` 和 `pnpm dev:desktop` 都使用 Vite `5173` 端口，不建议同时启动。

## 3. 导入 Cookie

点击 `1、导入Cookie` 后，有两种方式：

- `豆瓣登录自动导入`：打开独立豆瓣登录窗口，完成密码、二维码或短信登录后，应用自动读取 Cookie。
- `Cookie字符串导入`：把浏览器请求头中的 Cookie 整段粘贴进弹窗。

导入成功后：

- Cookie 会保存到本地 SQLite 状态库。
- 默认保留 30 天，到期后会在启动或使用前清理并提示。
- Cookie 顺序会持久化，重启后仍按原顺序使用。
- 下载、搜索和解析时优先使用可用且未冷却的豆瓣 Cookie。

如果使用字符串导入，建议至少包含：

```text
dbcl2
ck
bid
ll
ap_v
```

其中 `dbcl2` 和 `ck` 最关键。Cookie 不会写进命令行参数或日志；Windows 下持久化 payload 会通过 DPAPI 保护。

## 4. 搜索影视

点击 `2、搜索影视` 后输入片名并搜索。搜索弹窗会请求豆瓣搜索页，展示封面、片名、简介和分页结果。

点击任一搜索结果封面会打开共用影片详情弹窗。下载队列中的封面，以及选图下载顶部的影片封面，也使用同一个详情弹窗。

搜索结果提供三个操作：

- `选图下载`：打开 `3、添加下载任务`，自动切到选图下载模式，带入影片链接、片名、封面，并默认开始解析剧照。
- `添加链接`：把影片详情页加入添加下载任务弹窗的自动下载链接草稿。
- `删除链接`：从自动下载链接草稿中移除已添加链接。

同一次搜索内，已访问过的页会做内存缓存；切换页码不会重复请求已缓存页面。搜索要求存在可用豆瓣 Cookie，否则会提示先导入。

### 4.1 影片详情

影片详情在点击封面时按需获取。未缓存详情会等待 500ms 后打开，快速连续点击不同封面时只请求并展示最后一次点击对应的影片；同一影片在本次运行中会复用内存缓存和正在进行的请求。

详情弹窗会按豆瓣实际返回内容展示：

- 影片标题、原始标题和年份。
- 导演、编剧、主演、类型、制片国家/地区、语言、上映日期、片长、季数、集数、又名和 IMDb 编号。
- 豆瓣评分数字和评分人数；没有有效评分时只显示 `暂无评分`。
- 完整剧情简介和 `复制简介` 按钮。

主演默认显示前 6 位，可点击 `更多` 展开并用 `收起` 恢复。缺失字段不会显示；关闭按钮或 `Esc` 可关闭弹窗，点击遮罩不会误关闭。详情请求优先使用可用 Cookie，没有 Cookie 时会尝试匿名获取；加载失败后可重试。

## 5. 添加下载任务

点击 `3、添加下载任务` 后，弹窗包含两个模式：

- `自动下载`
- `选图下载`

### 5.1 自动下载

自动下载适合批量处理一个或多个豆瓣 `subject` 链接。每行填写一个链接，例如：

```text
https://movie.douban.com/subject/35010610/
https://movie.douban.com/subject/1292064/
```

可配置项：

- 输出目录：手动输入或点击 `浏览` 选择目录。
- 豆瓣抓图类型：`剧照`、`海报`、`壁纸`。
- 数量：`限制` 或 `无限制`，限制模式范围为 1-100，默认 10。
- 图片尺寸：`原图尺寸`、`9:16`、`3:4`。
- 输出格式：`JPG`、`PNG`。
- 请求间隔：1-5 秒。

豆瓣抓图类型对应关系：

- `剧照` -> `photos?type=S`
- `海报` -> `photos?type=R`
- `壁纸` -> `photos?type=W`

即使粘贴的是 `subject`、`all_photos` 或带 `photos?type=` 的链接，自动下载仍以弹窗里选择的抓图类型为准。

提交前会检查重复任务。重复判定包含链接、输出根目录、分类和图片比例；确认覆盖后会清理旧输出、移除旧任务并重新加入新任务。

### 5.2 选图下载

选图下载适合先看图再下载。支持粘贴豆瓣 `subject`、`all_photos` 和 `photos?type=S/R/W` 链接，也支持从搜索结果直接进入。

当前只保留三个分类：

- `剧照`
- `海报`
- `壁纸`

选图下载行为：

- 粘贴链接后会解析影片标题和封面，并默认先解析剧照分类。
- 切换分类会停止旧分类正在进行的解析，再优先解析新分类。
- 图片发现是分页/游标式，滚动到底部才继续请求下一批。
- 已解析结果按分类缓存，切回已加载分类会复用当前结果。
- 单击图片勾选或取消勾选。
- 拖拽图片网格区域可以框选多张图片。
- `全选` 和 `取消全选` 只作用于当前分类。
- 双击图片打开大图预览，预览内支持左右切换，并显示图片分辨率和最接近的 `1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3` 比例，例如 `1920x1080 16:9`。
- 点击 `下载选中 N 张` 并确认后，会停止继续解析后续图片，只下载已选图片。

选图下载同样会做重复任务检测。重复判定包含链接、输出根目录、分类和图片比例；确认覆盖后替换旧任务。

## 6. 下载队列

任务加入队列后会按添加时间 FIFO 执行。界面排序和搜索只影响展示，不改变后台调度顺序。

下载队列表格包含：

- 任务标题和详情页链接，点击链接区域可复制。
- 豆瓣封面，优先使用缓存的 data URL，失败时显示占位；点击封面可打开影片详情。
- 状态：排队、解析、下载、暂停、完成、失败等。
- 下载进度：每保存一张图片都会更新。
- 输出目录：任务完成后可点击打开最终输出目录。
- 结果摘要：显示下载数量和图片比例。
- 操作：暂停、继续、重试、删除。

队列表格支持：

- 按添加时间升序/降序展示。
- 按影片名或链接搜索。
- 分页、首页、上一页、下一页、末页和跳页。

删除单个任务会删除该任务生成的输出目录；下载中的任务不能删除，已暂停任务可以删除。清空队列会取消后台任务并清理相关输出目录内容，但会保留用户选择的输出根目录本身。

## 7. 输出目录

用户选择的是输出根目录，例如：

```text
D:\cover
```

自动下载会按影片和分类生成目录，例如：

```text
D:\cover\示例电影\still
D:\cover\示例电影\poster
D:\cover\示例电影\wallpaper
```

选图下载会写入单独的 selected 目录，按分类和比例区分，避免和自动下载混在一起。

自定义裁剪结果固定保存到：

```text
D:\cover\custom-crop-photo
```

所有删除和清空都会通过 Rust 层做路径规范化和边界校验，避免删除输出根目录之外的文件。

## 8. 自定义裁剪

点击 `4、自定义裁剪` 后，可以处理本地单张图片。

支持方式：

- 点击上传本地图片。
- 拖拽本地图片到弹窗。

当前拖拽读取走 `readDroppedImageFile(filePath)`，不要求图片必须位于输出根目录。保存时仍会写入输出根目录下的 `custom-crop-photo`；界面展示的 Windows 保存路径会移除内部扩展路径前缀 `\\?\`。

## 9. 图片处理

点击 `5、图片处理` 后，可以制作本地拼版和标注图。

当前支持：

- 默认打开单图布局，格子固定不动并始终作为裁剪窗口。
- 上传或拖拽 1-9 张图片。
- 选择拼版布局。
- 拖拽换格。
- 选中格子后可放大图片；只有缩放比例高于 100% 的当前选中图片可以在格子内拖动调整取景。
- 放大后点击缩小仍可继续拖动，缩放下限是刚好覆盖格子的 100%，不能继续缩小到露出空白；拖动范围同样限制在格子边界内。
- 上传背景图。
- 调整背景图透明度。
- 开启背景重叠效果。
- 调整当前选中图片透明度。
- 添加方框、圆圈、箭头标注。
- 导出 JPG 或 PNG。

标注拖拽完成后会隐藏拖拽点；再次点击标注区域后显示点位和设置。箭头保持 2D 平面旋转效果。

## 10. 日志中心

日志中心包含：

- 实时日志列表。
- `仅看错误` / `显示全部日志` 切换。
- `清空全部日志`。

sidecar 的结构化 stdout 会由 Rust 解析成日志、进度事件、搜索结果、标题/封面结果、影片详情结果或选图发现结果。stderr 会作为错误日志进入日志中心。

## 11. 本地持久化

应用状态保存在 Tauri 应用数据目录下：

```text
runtime-state.sqlite
```

主要保存：

- 下载队列任务。
- Cookie 列表和值。
- 运行日志。
- 队列配置。
- 添加下载任务输出目录。
- 图片处理输出目录。

旧版 `runtime-state.json` 只在首次迁移时读取；新版本持续读写 SQLite。如果 SQLite 损坏，应用会备份主库和 WAL/SHM 文件，再创建干净状态库继续运行。

## 12. 构建安装包

首次构建前建议运行环境检查：

```powershell
.\scripts\check-build-env.ps1
```

推荐一键构建：

```powershell
.\scripts\build-with-msvc.ps1
```

该脚本会设置 MSVC x64 环境，并按项目当前脚本准备 sidecar、前端和 Tauri 安装包。

也可以手动执行：

```bash
pnpm build:sidecar
pnpm prepare:sidecar-bundle
pnpm build:desktop
```

`pnpm build:desktop` 会触发桌面端构建链路，确保前端类型检查、Vite build、sidecar resources 和 Tauri bundle 参与构建。

NSIS 安装包默认输出：

```text
apps/desktop/src-tauri/target/release/bundle/nsis/Movie Cover Downloader_0.1.0_x64-setup.exe
```

MSI 默认输出：

```text
apps/desktop/src-tauri/target/release/bundle/msi/Movie Cover Downloader_0.1.0_x64_en-US.msi
```

发布时推荐优先使用 NSIS 安装包。

### 12.1 sidecar resources

安装包不能只包含 Tauri 前端壳。真实下载需要同时打包：

- `apps/sidecar/dist/index.js`
- Node.js 运行时 `node.exe`
- sidecar 生产依赖
- `sharp` 原生依赖
- Tauri 桌面程序和前端静态资源

`scripts/prepare-sidecar-bundle.ps1` 会把 sidecar 资源准备到：

```text
apps/desktop/src-tauri/resources/sidecar
```

脚本会在 resources 目录内使用 `npm install --omit=dev` 创建真实目录，避免直接复制 pnpm workspace `node_modules` 的 symlink/junction。打包后如果出现 `Cannot find package 'sharp'`，优先检查 resources 内的 `node_modules\sharp` 是否是真实目录。

## 13. 常见排查

### 13.1 桌面端启动失败

建议依次检查：

```bash
pnpm build:sidecar
pnpm typecheck
pnpm typecheck:sidecar
```

再检查 Rust：

```bash
cd apps/desktop/src-tauri
cargo check
```

### 13.2 搜索或下载失败

优先检查：

- 是否已经导入豆瓣 Cookie。
- Cookie 是否包含 `dbcl2` 和 `ck`。
- Cookie 是否过期或处于冷却状态。
- 日志中心是否出现 `403`、`418`、`登录状态失效`、`触发豆瓣风控` 等提示。
- 当前分类是否本身没有图片。

常见提示含义：

- `该分类下暂无可抓取图片`：当前豆瓣分类页为空，不代表 Cookie 失效。
- `豆瓣登录状态失效，请重新导入 Cookie`：登录态不可用，需要重新导入。
- `触发豆瓣风控，请稍后重试`：请求被豆瓣保护机制拦截，建议稍后再试。
- `豆瓣页面结构异常，暂时无法解析`：页面结构和当前解析逻辑不一致，需要结合日志排查。

### 13.3 打包后下载失败

重点检查：

- `apps/sidecar/dist/index.js` 是否存在。
- `apps/desktop/src-tauri/resources/sidecar/node.exe` 是否存在。
- `apps/desktop/src-tauri/resources/sidecar/node_modules/sharp` 是否是真实目录。
- resources 中是否存在 sharp 的 `.node` 原生二进制。
- 安装包是否为最近一次构建生成。

## 14. 验证建议

文档和代码改动分开验证。常用命令：

```bash
pnpm --dir apps/desktop exec vue-tsc --noEmit
pnpm --dir apps/sidecar typecheck
pnpm --dir apps/desktop test
pnpm --dir apps/sidecar test
```

Rust：

```bash
cd apps/desktop/src-tauri
cargo check
cargo test
cargo clippy --all-targets
```

如果只修改 README 或本文档，通常不需要运行代码测试，但至少应检查 Markdown 链接、路径和过时术语。
