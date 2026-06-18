# 构建指南

本文档详细说明如何从源代码构建 Movie Cover Downloader 的 Windows 安装包。

## 目录

- [前置要求](#前置要求)
- [环境安装步骤](#环境安装步骤)
- [环境检查](#环境检查)
- [完整构建流程](#完整构建流程)
- [Sidecar Bundle 打包原理](#sidecar-bundle-打包原理)
- [增量构建](#增量构建)
- [常见问题排查](#常见问题排查)
- [构建检查清单](#构建检查清单)

## 前置要求

构建此项目需要以下环境：

| 工具 | 版本要求 | 用途 |
|------|----------|------|
| **Rust** | 最新稳定版 | Tauri 桌面应用编译 |
| **Node.js** | v18+ | 前端和 sidecar 开发 |
| **pnpm** | v8+ | 依赖管理 |
| **Visual Studio Build Tools** | 2022/2026 | C++ 编译器（MSVC），Rust 编译需要 |
| **WebView2 Runtime** | 最新版 | Tauri 桌面应用运行时（通常系统已有） |
| **Git** | 任意版本 | 版本控制 |

## 环境安装步骤

### 1. 安装 Rust

访问 [rustup.rs](https://rustup.rs/) 下载安装器，运行后它会：
- 安装 Rust 工具链（rustc、cargo 等）
- 配置环境变量
- 提示你安装 Visual Studio Build Tools（如果缺失）

验证安装：
```powershell
rustc --version
cargo --version
```

### 2. 安装 Visual Studio Build Tools

**为什么需要**：Rust 在 Windows 上编译需要 MSVC 链接器和 Windows SDK。

**下载地址**：[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

**安装选项**：
- 勾选 **"使用 C++ 的桌面开发"**
- 必选组件：
  - MSVC v143 - VS 2022 C++ x64/x86 生成工具（或更高版本）
  - Windows 11 SDK（或 Windows 10 SDK）
  - C++ CMake 工具

**安装大小**：约 6-8 GB

**注意事项**：
- MSVC 编译器（cl.exe）**不会自动添加到 PATH**，这是正常的
- 我们的构建脚本会自动设置 MSVC 环境，无需手动配置

验证安装：
```powershell
# 检查 Visual Studio 安装位置
dir "C:\Program Files (x86)\Microsoft Visual Studio"
```

详细说明：[windows-setup.md](./windows-setup.md)

### 3. 安装 Node.js

**推荐方式**：使用 [fnm](https://github.com/Schniz/fnm)（快速 Node 版本管理器）

```powershell
# 使用 winget 安装 fnm
winget install Schniz.fnm

# 重启终端，然后安装 Node.js LTS
fnm install --lts
fnm use lts-latest
```

**或者直接下载**：[Node.js 官网](https://nodejs.org/)（选择 LTS 版本）

验证安装：
```powershell
node --version  # 应该显示 v18 或更高版本
npm --version
```

### 4. 安装 pnpm

```powershell
# 使用 npm 安装 pnpm
npm install -g pnpm

# 或使用 PowerShell 安装
iwr https://get.pnpm.io/install.ps1 -useb | iex
```

验证安装：
```powershell
pnpm --version  # 应该显示 v8 或更高版本
```

### 5. 克隆项目并安装依赖

```powershell
# 克隆仓库
git clone https://github.com/vdbvxcbcb/movie-cover-downloader.git
cd movie-cover-downloader

# 安装所有依赖
pnpm install
```

## 环境检查

首次构建前，运行环境检查脚本验证所有工具已正确安装：

```powershell
.\scripts\check-build-env.ps1
```

该脚本会检查：
- ✅ Rust 工具链（rustc、cargo）
- ✅ C++ 编译器（MSVC）
- ✅ Node.js 和 pnpm 版本
- ✅ WebView2 运行时
- ✅ 项目依赖是否已安装
- ✅ Sidecar 构建状态

**输出示例**：
```
========================================
Environment Check Results
========================================
[✓] Rust toolchain: rustc 1.78.0
[✓] Cargo: cargo 1.78.0
[✓] Node.js: v24.14.1
[✓] pnpm: 10.33.2
[✓] MSVC: Found at C:\Program Files (x86)\...
[✓] WebView2: Installed
[✓] Project dependencies: Installed
[✓] Sidecar dist: Built

All checks passed! Ready to build.
```

如果有任何失败项，脚本会给出具体的修复建议。

## 完整构建流程

### 方式一：使用自动化脚本（推荐）

项目提供了自动化构建脚本 `scripts/build-with-msvc.ps1`，它会自动设置 MSVC 环境并按正确顺序执行所有构建步骤：

```powershell
# 一键构建安装包（推荐）
.\scripts\build-with-msvc.ps1
```

**该脚本会自动执行以下步骤**：

1. **设置 MSVC 环境**
   - 自动查找 Visual Studio 安装路径
   - 调用 `vcvarsall.bat` 初始化 x64 编译环境
   - 将 MSVC 编译器（cl.exe）和链接器添加到当前会话的 PATH

2. **构建 Sidecar**
   ```powershell
   pnpm run build:sidecar
   ```
   - 编译 TypeScript 代码到 `apps/sidecar/dist`
   - 生成 `dist/index.js` 入口文件

3. **打包 Sidecar Bundle**
   ```powershell
   pnpm run prepare:sidecar-bundle
   ```
   - 复制 `package.json` 和 `dist/` 到 Tauri resources
   - 创建 `.npmrc` 配置 `node-linker=hoisted`（关键：避免符号链接）
   - 使用 hoisted 模式安装生产依赖（所有依赖变成真实文件）
   - 复制 Node.js 运行时（node.exe）
   - 验证 sharp 库安装为真实目录（不是符号链接）
   - 验证 sharp 原生二进制（sharp-win32-x64.node）存在

4. **构建桌面应用和安装包**
   ```powershell
   pnpm run build:desktop
   ```
   - 构建 Vue 前端（生成 `dist/index.html` 和静态资源）
   - 编译 Rust 后端（Tauri 应用）
   - 生成 MSI 和 NSIS 安装包

**构建输出**：

```
apps/desktop/src-tauri/target/release/bundle/
├── msi/
│   └── Movie Cover Downloader_0.1.0_x64_en-US.msi     (~226 MB)
└── nsis/
    └── Movie Cover Downloader_0.1.0_x64-setup.exe     (~226 MB)
```

**构建时间**：首次完整构建约 5-10 分钟（取决于机器性能）

### 方式二：手动分步构建

如果需要单独执行某个步骤或调试问题，可以手动运行：

```powershell
# 1. 检查环境（可选但推荐）
.\scripts\check-build-env.ps1

# 2. 确保依赖已安装
pnpm install

# 3. 初始化 MSVC 环境（手动构建时必须先执行）
# 查找 vcvarsall.bat 路径（通常在以下位置之一）：
# C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat
# C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat
# C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools\VC\Auxiliary\Build\vcvarsall.bat

# 执行 vcvarsall.bat 初始化环境
& "C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64

# 4. 构建 sidecar
pnpm run build:sidecar

# 5. 打包 sidecar bundle（使用 hoisted 模式，避免符号链接）
pnpm run prepare:sidecar-bundle

# 6. 构建桌面应用和安装包
pnpm run build:desktop
```

## Sidecar Bundle 打包原理

`scripts/prepare-sidecar-bundle.ps1` 负责将 sidecar 打包成完整的可执行环境。

### 打包结果结构

**目标位置**：
```
apps/desktop/src-tauri/resources/sidecar/ (~108 MB)
├── node.exe           (88 MB) - Node.js 运行时
├── dist/              - TypeScript 编译后的代码
│   └── index.js       - 入口文件
├── package.json       - 依赖清单
├── .npmrc             - pnpm 配置（关键：node-linker=hoisted）
└── node_modules/      (21 MB) - 生产依赖（真实文件，无符号链接）
    ├── sharp/
    │   └── lib/
    ├── @img/
    │   └── sharp-win32-x64/
    │       └── lib/
    │           └── sharp-win32-x64.node  (423 KB) - 原生二进制
    └── (其他依赖...)
```

### ⚠️ 关键：为什么必须使用 hoisted 模式

pnpm 默认使用**符号链接（symlink）**管理依赖：
```
node_modules/sharp -> /d/claude blog/new/.../node_modules/.pnpm/sharp@0.34.5/...
```

这些符号链接指向**开发机器的绝对路径**，在用户机器上会失效，导致：
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'sharp'
```

**解决方案**：`prepare-sidecar-bundle.ps1` 创建 `.npmrc` 文件配置 hoisted 模式：
```ini
node-linker=hoisted
shamefully-hoist=true
```

这样安装的依赖都是**真实文件和目录**，可以正常打包到安装包中。

详细技术说明：[sidecar-symlink-fix.md](./sidecar-symlink-fix.md)

### 验证 sidecar bundle 是否正确

```powershell
# 检查 sharp 是否为真实目录（不是符号链接）
$sharp = Get-Item "apps\desktop\src-tauri\resources\sidecar\node_modules\sharp"
if ($sharp.LinkType) { "❌ 符号链接 - 构建失败！" } else { "✅ 真实目录 - 正确" }

# 检查符号链接数量（应该为 0）
cd apps\desktop\src-tauri\resources\sidecar
find node_modules -maxdepth 2 -type l | wc -l

# 测试 Node.js 能否加载 sharp
.\node.exe -e "require('sharp'); console.log('Sharp loaded successfully');"
```

## 增量构建

根据修改的代码位置，可以只执行部分构建步骤：

**只修改了前端代码**（Vue 组件、样式、TypeScript）：
```powershell
pnpm run build:desktop
```

**只修改了 sidecar 代码**（Node.js 抓取逻辑、下载器）：
```powershell
pnpm run build:sidecar
pnpm run prepare:sidecar-bundle
pnpm run build:desktop
```

**只修改了 Rust 代码**（Tauri 命令、SQLite 操作）：
```powershell
.\scripts\build-with-msvc.ps1  # 或手动初始化 MSVC 后执行 pnpm run build:desktop
```

**修改了 sidecar 依赖**（package.json）：
```powershell
cd apps/sidecar
pnpm install
cd ../..
pnpm run prepare:sidecar-bundle
pnpm run build:desktop
```

## 常见问题排查

### 问题 1：`error: linker 'link.exe' not found`

**症状**：
```
error: linker `link.exe` not found
  |
  = note: program not found
```

**原因**：Rust 找不到 MSVC 链接器

**解决**：
- 使用 `.\scripts\build-with-msvc.ps1` 自动设置环境
- 或手动执行 `vcvarsall.bat x64` 后再构建

### 问题 2：`Sharp not installed correctly`

**症状**：
```
ERROR: Sharp not installed correctly
WARNING: Sharp is a symlink - this will break in production!
```

**原因**：sharp 被安装为符号链接

**解决**：
```powershell
# 删除旧的 sidecar bundle
Remove-Item "apps\desktop\src-tauri\resources\sidecar" -Recurse -Force

# 重新打包
pnpm run prepare:sidecar-bundle
```

### 问题 3：`Could not fully clean old sidecar (files in use)`

**症状**：
```
Warning: Could not fully clean old sidecar (files in use), will overwrite
```

**原因**：node.exe 或其他文件被其他进程占用（如开发服务器）

**影响**：这是警告而非错误，脚本会继续执行并覆盖文件

**建议**：
- 如果担心残留文件，关闭所有开发服务器和 IDE
- 手动删除 `apps\desktop\src-tauri\resources\sidecar` 目录
- 重新运行 `pnpm run prepare:sidecar-bundle`

### 问题 4：安装包在用户机器上报错 `Cannot find package 'sharp'`

**症状**：
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'sharp'
imported from D:\Movie Cover Downloader\sidecar\dist\services\downloader.js
```

**原因**：sidecar bundle 包含了符号链接

**解决**：
1. 确保 `prepare-sidecar-bundle.ps1` 使用了 hoisted 模式
2. 验证 sharp 是真实目录（参考上文验证命令）
3. 重新构建安装包

### 问题 5：`pnpm install` 超时或下载缓慢

**症状**：依赖下载非常慢或超时

**解决**：配置国内镜像源
```powershell
pnpm config set registry https://registry.npmmirror.com
```

### 问题 6：`WebView2 not found`

**症状**：应用启动失败，提示找不到 WebView2

**原因**：系统未安装 WebView2 运行时

**解决**：
- Windows 11 通常已预装
- Windows 10 需要手动下载：[WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

## 构建检查清单

发布安装包前，请确认以下项目：

### 构建前检查

- [ ] 运行 `.\scripts\check-build-env.ps1` 全部通过
- [ ] 所有依赖已正确安装（`pnpm install` 无错误）
- [ ] Sidecar 代码已编译（`apps/sidecar/dist/index.js` 存在）

### 构建后验证

- [ ] Sidecar bundle 中的 sharp 是真实目录（不是符号链接）
- [ ] Sharp 原生二进制存在且大小为 423 KB
- [ ] node_modules 中符号链接数量为 0
- [ ] 安装包文件大小约 226 MB（偏差 ±5 MB 正常）

### 功能测试

- [ ] 在开发机器上测试安装包能正常安装
- [ ] 应用能正常启动，无报错
- [ ] Cookie 导入功能正常
- [ ] 搜索影视功能正常
- [ ] 自动下载功能正常
- [ ] 选图下载功能正常
- [ ] 图片处理功能正常

### 发布前准备

- [ ] 在**全新的 Windows 机器**上测试安装包
- [ ] 确认没有 `Cannot find package 'sharp'` 错误
- [ ] 测试完整用户流程
- [ ] 更新版本号和 CHANGELOG

完整检查清单：[build-checklist.md](./build-checklist.md)

## 相关文档

- [windows-setup.md](./windows-setup.md) - Windows 开发环境配置
- [sidecar-symlink-fix.md](./sidecar-symlink-fix.md) - Sidecar 符号链接问题详解
- [build-checklist.md](./build-checklist.md) - 构建检查清单
- [usage-guide.md](./usage-guide.md) - 用户使用说明

## 获取帮助

如果遇到本文档未涵盖的问题：

1. 检查 [Issues](https://github.com/vdbvxcbcb/movie-cover-downloader/issues) 中是否有类似问题
2. 运行 `.\scripts\check-build-env.ps1` 获取详细诊断信息
3. 创建新 Issue，提供完整的错误信息和环境信息
