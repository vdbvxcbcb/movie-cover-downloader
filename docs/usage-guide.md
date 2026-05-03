# Movie Cover Downloader 使用说明

本文档只覆盖当前仓库这版代码已经落地的内容，重点说明：

- 如何安装依赖
- 如何本地启动桌面版
- 控制中心现在有哪些功能
- 豆瓣 `Cookie` 该怎么提供
- 后续做安装包时还缺什么

## 1. 当前形态

当前桌面端只有两个主页面：

- 控制中心
- 日志中心

控制中心现在包含：

- 添加链接任务
- 导入 Cookie
- 清空队列任务
- 下载队列表格
- Cookie 列表

下载队列表格现在还支持：

- 任务处理中点击`暂停`
- 任务已暂停后点击`继续`
- 任务完成后显示`完成`
- 任务失败后点击`重试`

日志中心现在包含：

- 实时日志列表
- `清空全部日志`

### 1.1 本地存储现状（2026-05-02）

当前桌面端持久化已经切到 `SQLite`，数据库文件位于应用数据目录下的：

```text
runtime-state.sqlite
```

当前使用的核心表：

- `tasks`：下载队列任务记录
- `cookies`：Cookie 值与状态（含成功/失败计数、冷却时间、导入与过期时间）
- `app_logs`：运行日志

兼容说明：

- 旧版 `runtime-state.json` 仅用于首次迁移读取
- 新版本持续读写均使用 `SQLite`

## 2. 环境要求

建议环境：

- Windows 10 / 11
- Node.js 18+
- pnpm 10+
- Rust stable
- cargo

可先检查：

```bash
node -v
pnpm -v
rustc -V
cargo -V
```

## 3. 安装依赖

在项目根目录执行：

```bash
pnpm install
```

## 4. 常用命令

当前根目录真实存在的脚本如下：

```bash
pnpm dev:web
pnpm dev:desktop
pnpm dev:sidecar
pnpm build:web
pnpm build:desktop
pnpm build:sidecar
pnpm typecheck
pnpm typecheck:sidecar
```

说明：

- `pnpm dev:web`
  只启动前端 Vite 页面
- `pnpm dev:desktop`
  启动 Tauri 桌面应用
- `pnpm dev:sidecar`
  启动 sidecar 开发模式
- `pnpm build:sidecar`
  构建 `apps/sidecar/dist/index.js`
- `pnpm typecheck`
  执行桌面端 `vue-tsc`
- `pnpm typecheck:sidecar`
  执行 sidecar TypeScript 类型检查

## 5. 本地运行

### 5.1 网页端启动命令

在项目根目录执行：

```bash
pnpm dev:web
```

等价写法：

```bash
cd apps/desktop
pnpm dev
```

当前网页端开发服务固定端口为：

```text
http://127.0.0.1:8467
```

这个模式下：

- 可以查看界面和交互
- 不会真的走 Tauri Rust 命令
- 不会执行真实下载链路

### 5.2 桌面端启动命令

在项目根目录执行：

```bash
pnpm dev:desktop
```

等价写法：

```bash
cd apps/desktop
pnpm tauri dev
```

当前桌面端启动链路会自动完成这些前置动作：

- 自动执行 `apps/desktop/package.json` 里的 `predev`
- 自动构建 `apps/sidecar/dist`
- 自动启动桌面端内部使用的 Vite 页面
- 自动拉起 Tauri 桌面窗口

所以现在不需要再手工先执行一次 `pnpm build:sidecar` 才能启动桌面端。

### 5.3 推荐启动顺序

首次启动或更新依赖后，推荐顺序：

```bash
pnpm install
pnpm typecheck
pnpm typecheck:sidecar
pnpm dev:desktop
```

如果是第一次跑 Tauri，建议额外检查一次：

```bash
cd apps/desktop/src-tauri
cargo check
```

### 5.4 注意事项

- `pnpm dev:web` 和 `pnpm dev:desktop` 底层都会使用 `8467` 端口，不建议同时启动
- 如果你只想看界面，用 `pnpm dev:web`
- 如果你要测试真实下载、Cookie 导入、Tauri 命令桥接，用 `pnpm dev:desktop`

## 6. 控制中心使用方式

### 6.1 新增链接任务

点击“添加链接任务”后：

- 支持批量添加
- 一行一个详情页链接
- 支持豆瓣详情页

示例：

```text
https://movie.douban.com/subject/35010610/
```

当前弹窗支持这些任务级选项：

- 输出目录
- 站点提示
- 豆瓣抓图类型：`剧照 / 海报 / 壁纸`
- 数量模式：`限制 / 无限制`
- 输出格式：`JPG / PNG`
- 请求间隔：`1-5 秒`

默认值：

- 豆瓣抓图类型：`剧照`
- 数量模式：`限制`
- 限制数量：`10`
- 输出格式：`JPG`
- 请求间隔：`1 秒`

豆瓣抓图类型规则：

- `剧照` 对应 `photos?type=S`
- `海报` 对应 `photos?type=R`
- `壁纸` 对应 `photos?type=W`
- 如果填的是 `subject`、`all_photos` 或已经带 `photos?type=...` 的豆瓣链接，程序仍然会以弹窗里的抓图类型为准

数量模式规则：

- `限制` 模式下只能输入 `1-100`
- `无限制` 模式下会抓取当前分类页中的全部图片

### 6.2 输出目录

输出目录支持两种方式：

- 手工输入，例如 `D:/cover`
- 点击“浏览”选择本地文件夹

任务加入队列后，程序会在输出目录下自动创建：

```text
片名 + 日期
```

其中：

- 会根据豆瓣创建 `片名 + 日期`，再按抓图类型进入对应子目录：
  `still / poster / wallpaper`

例如豆瓣剧照：

```text
D:\cover\示例电影 - 2026-05-01\still
```

例如豆瓣海报：

```text
D:\cover\示例电影 - 2026-05-01\poster
```

例如豆瓣壁纸：

```text
D:\cover\示例电影 - 2026-05-01\wallpaper
```

任务完成后，下载队列里“输出目录”这一列可以直接点击，打开的是该任务最终子目录，而不是根目录。

### 6.3 输出格式

当前支持：

- `JPG`
- `PNG`

处理规则：

- 如果源图本来就是目标格式，直接保存
- 如果源图是 `WEBP` 等其他格式，sidecar 会自动转码成目标 `JPG / PNG`

### 6.4 请求间隔

当前请求间隔是任务级参数：

- 可选 `1-5 秒`
- 默认 `1 秒`

当前实现方式是：

- 真实 HTML 请求受控
- 真实图片下载请求受控
- 下载中的单张图片支持断点续传
- 用户暂停后会保留当前图片的 `.part` 临时分片
- 用户继续后会优先带 `Range` 续传当前图片
- 如果源站不支持 `Range`，只会重下当前图片，不会重下整个任务

也就是说，这个值不是只停留在界面上，而是会进入真实抓图链路。

豆瓣真实抓图还会额外启用保护模式：

- 豆瓣请求间隔最低会提升到 `3 秒`
- 豆瓣任务在桌面端会按串行执行

这样做是为了降低连续请求触发豆瓣风控的概率。

### 6.5 导入 Cookie

点击“导入 Cookie”后，当前支持两种方式：

- 豆瓣登录自动导入
- `Cookie` 字符串导入

其中“豆瓣登录自动导入”会打开独立的豆瓣登录窗口。

在这个窗口里，支持使用：

- 密码登录
- 二维码登录
- 短信登录

如果豆瓣页面要求图形验证码，需要由用户直接在豆瓣页面内完成。

只有在登录成功并拿到有效登录态后，程序才会写入 Cookie。

如果未成功登录，或者用户手动关闭登录窗口，不会写入无效 Cookie。

导入后：

- Cookie 会保存在本地状态里
- 默认保留 30 天
- 到期后会在应用启动或再次使用前自动清理
- 用户手动删除后，需要重新登录或重新导入
- 豆瓣真实下载会优先使用它

### 6.6 清空队列任务

点击后会：

- 清空当前任务列表
- 停止当前队列流转
- 不会删除磁盘上已经下载好的文件

## 7. 豆瓣 Cookie 需要什么

如果使用 `Cookie` 字符串导入，最稳妥的做法仍然是：

- 直接提供浏览器导出的整份 `.douban.com / movie.douban.com` Cookie

当前验证里至少能确认这些字段有帮助：

```text
dbcl2
ck
bid
ll
ap_v
```

其中最关键的是：

```text
dbcl2
ck
```

示例：

```text
dbcl2="177473297:xxxxxx"; ck=hb-J; bid=DYDcN1_PDPs; ll="118289"; ap_v=0,6.0
```

## 8. 当前真实链路状态

### 8.1 豆瓣

当前已经做到：

- 使用导入的 Cookie
- 访问详情页
- 根据任务选项自动改写到 `photos?type=S/R/W`
- 进入图片抓取链路
- 自动创建 `片名 + 日期\still|poster|wallpaper` 子目录
- 真实下载到本地目录
- 默认启用保护模式
- 豆瓣任务串行执行，避免同一时间并发打多个豆瓣任务

实际是否能拿到高质量图片，仍取决于 Cookie 的可用性。

如果抓图失败，当前会优先给出更明确的提示：

- `该分类下暂无可抓取图片`
- `豆瓣登录状态失效，请重新导入 Cookie`
- `触发豆瓣风控，请稍后重试`
- `豆瓣页面结构异常，暂时无法解析`

其中：

- 空分类页不会让 Cookie 进入冷却
- 登录失效、风控页和典型反爬错误会触发 Cookie 冷却

## 9. 当前已知限制

当前还有这些现实限制：

- 豆瓣是否返回高清图，仍受登录态影响
- 大量图片任务会明显更慢，这是请求间隔和真实下载共同作用的结果
- 开发环境下 sidecar 仍通过本机 `node` 运行
- `sharp` 是当前图片转码链路依赖
- 还没有做浏览器 Cookie 自动同步

## 10. 安装包阶段必须补的一步

后面做安装包时，不能只打包 Tauri 前端壳。

因为当前真实下载依赖：

- `apps/sidecar/dist/index.js`
- Node 运行时
- `sharp` 运行时依赖

所以安装包阶段还必须补：

1. 把 sidecar 一起打包进安装包资源
2. 把 sidecar / Node 运行方式一起打包

这一步没补完之前：

- 开发环境可以跑
- 但安装包还不能算完整交付

## 11. 排查建议

### 11.1 桌面版启动失败

先执行：

```bash
pnpm build:sidecar
pnpm typecheck
pnpm typecheck:sidecar
cd apps/desktop/src-tauri
cargo check
```

### 11.2 豆瓣下载失败

优先检查：

- Cookie 是否过期
- 是否包含 `dbcl2`、`ck`
- 导入的是不是豆瓣影视站登录态
- 日志中心里是否出现 `403`、`418`、`登录受限`、`触发豆瓣风控，请稍后重试` 之类提示

如果界面直接提示：

- `该分类下暂无可抓取图片`
  说明当前分类页本身没有可抓的图片，不是 Cookie 失效
- `豆瓣登录状态失效，请重新导入 Cookie`
  说明当前登录态不可用，建议重新走一次登录导入或手动导入
- `触发豆瓣风控，请稍后重试`
  说明当前请求被豆瓣保护机制拦截，建议等待一段时间后再试
- `豆瓣页面结构异常，暂时无法解析`
  说明当前页面结构和程序预期不一致，需要结合日志进一步排查
