# Windows 开发环境配置指南

本指南将帮助你在 Windows 上配置 Movie Cover Downloader 项目的完整开发环境。

## 📋 前置要求

### 1. Node.js 环境

- **Node.js**: 20.x 或更高版本
- **pnpm**: 项目使用的包管理器

```powershell
# 检查 Node.js 版本
node --version

# 安装 pnpm（如果未安装）
npm install -g pnpm

# 检查 pnpm 版本
pnpm --version
```

### 2. Rust 工具链（必需）

Tauri 需要完整的 Rust 工具链来构建桌面应用。

#### 安装 Rust

1. **下载 rustup-init.exe**
   - 访问：https://rustup.rs/
   - 或直接下载：https://win.rustup.rs/

2. **运行安装程序**
   ```powershell
   # 运行下载的 rustup-init.exe
   # 选择默认安装选项（按 1 然后回车）
   ```

3. **验证安装**
   ```powershell
   # 重启终端后运行
   rustc --version
   cargo --version
   ```

   预期输出类似：
   ```
   rustc 1.78.0 (xxx)
   cargo 1.78.0 (xxx)
   ```

### 3. Microsoft C++ Build Tools（必需）

Rust 和某些 Node.js 原生模块（如 sharp）需要 C++ 编译器。

#### 安装方式一：Visual Studio Build Tools（推荐）

1. **下载 Build Tools**
   - 访问：https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - 下载 "Build Tools for Visual Studio 2026"（或 2022）

2. **安装时选择工作负载**
   - ✅ **Desktop development with C++** (使用 C++ 的桌面开发)
   - 在右侧详细选项中确保勾选：
     - MSVC v143/v145 - VS 2022/2026 C++ x64/x86 build tools
     - Windows 11 SDK

3. **安装大小**：约 6-8 GB

4. **重要提示**
   - 安装完成后，MSVC 编译器 (cl.exe) **不会**自动添加到系统 PATH
   - 需要使用专门的开发者命令提示符或构建脚本（见下文）

#### 安装方式二：完整 Visual Studio Community（可选）

如果你需要完整的 IDE：
- 下载 Visual Studio Community 2022
- 安装时选择 "Desktop development with C++"

### 4. WebView2（Windows 11 通常已预装）

检查是否已安装：

```powershell
# 检查注册表
Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -Name pv -ErrorAction SilentlyContinue
```

如果未安装：
- 下载：https://developer.microsoft.com/microsoft-edge/webview2/
- 选择 "Evergreen Bootstrapper" 或 "Evergreen Standalone Installer"

## 🔧 项目特定配置

### 1. 安装项目依赖

```powershell
cd "d:\claude blog\new\movie-cover-downloader"

# 安装所有依赖
pnpm install
```

### 2. 构建 Sidecar Bundle

本项目使用一个独立的 Node.js sidecar 进程来处理图像操作（基于 sharp 库）。

```powershell
# 构建 sidecar（必须在构建桌面应用前执行）
pnpm run prepare:sidecar-bundle
```

这个命令会：
- 构建 sidecar TypeScript 代码
- 打包生产依赖（包括 sharp 的原生二进制文件）
- 复制 Node.js 运行时
- 将所有内容放到 `apps/desktop/src-tauri/resources/sidecar/` 目录

### 3. 构建 Sidecar 代码

```powershell
# 编译 TypeScript 到 JavaScript
pnpm run build:sidecar
```

## 🚀 开发和构建

### 开发模式

```powershell
# 启动开发服务器（Web 预览）
pnpm run dev:web

# 启动 Tauri 开发模式（桌面应用）
pnpm run dev:desktop
```

### 生产构建

#### 方法 1：使用自动化构建脚本（推荐，自动设置 MSVC 环境）

```powershell
# PowerShell 脚本
.\scripts\build-with-msvc.ps1

# 或者 CMD 脚本
.\scripts\build-with-msvc.bat
```

这些脚本会：
- 自动设置 Visual Studio MSVC 环境变量
- 按正确顺序构建 sidecar 和桌面应用
- 无需手动打开开发者命令提示符

#### 方法 2：使用 Developer Command Prompt

1. 在 Windows 开始菜单搜索：**"x64 Native Tools Command Prompt for VS 2026"**（或 2022）
2. 在该终端中运行：

```powershell
cd "d:\claude blog\new\movie-cover-downloader"

# 构建流程
pnpm run build:sidecar
pnpm run prepare:sidecar-bundle
pnpm run build:desktop
```

#### 方法 3：手动设置环境（不推荐）

```powershell
# 先激活 MSVC 环境
& "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

# 然后构建
pnpm run build:sidecar
pnpm run prepare:sidecar-bundle
pnpm run build:desktop
```

**构建产物位置：**

- 安装包：`apps/desktop/src-tauri/target/release/bundle/`
- 可执行文件：`apps/desktop/src-tauri/target/release/movie-cover-downloader-desktop.exe`

## 🐛 常见问题排查

### 问题 1: `cargo metadata` 命令失败

**错误信息**：
```
failed to run 'cargo metadata' command: program not found
```

**解决方案**：
1. 确认 Rust 已正确安装：`cargo --version`
2. 重启终端以刷新环境变量
3. 检查 PATH 环境变量是否包含 `C:\Users\<你的用户名>\.cargo\bin`

### 问题 2: sharp 安装失败

**错误信息**：
```
error: could not compile `sharp`
```

**解决方案**：
1. 确保已安装 Visual Studio Build Tools
2. 清理并重新安装：
   ```powershell
   pnpm clean
   pnpm install
   ```

### 问题 3: MSVC 编译器 (cl.exe) 找不到

**错误信息**：
```
error: linker `link.exe` not found
```
或运行 `where cl` 返回找不到文件

**原因**：
Visual Studio Build Tools 安装后，MSVC 编译器不会自动添加到系统 PATH

**解决方案**：

1. **使用自动化构建脚本（最简单）**：
   ```powershell
   .\scripts\build-with-msvc.ps1
   ```

2. **使用开发者命令提示符**：
   - 在开始菜单搜索 "x64 Native Tools Command Prompt for VS 2026"
   - 在该终端中运行构建命令

3. **确认 Build Tools 已正确安装**：
   - 检查路径是否存在：`C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\`
   - 如果不存在，重新安装并确保勾选 "Desktop development with C++"

### 问题 4: WebView2 运行时缺失

**错误信息**：应用启动失败或显示白屏

**解决方案**：

1. 手动安装 WebView2 Runtime
2. 或在 `tauri.conf.json` 中已配置离线安装器：
   ```json
   "webviewInstallMode": {
     "type": "offlineInstaller",
     "silent": true
   }
   ```

### 问题 5: 构建时找不到 sidecar 资源

**错误信息**：
```
resource not found: resources/sidecar
```

**解决方案**：

```powershell
# 按顺序执行
pnpm run build:sidecar
pnpm run prepare:sidecar-bundle
pnpm run build:desktop
```

或使用自动化脚本：`.\scripts\build-with-msvc.ps1`

### 问题 6: PowerShell 执行策略限制

**错误信息**：
```
cannot be loaded because running scripts is disabled
```

**解决方案**：
```powershell
# 以管理员身份运行 PowerShell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## 📦 构建产物说明

成功构建后，你会在 `apps/desktop/src-tauri/target/release/bundle/` 目录下找到：

- **msi**: Windows Installer 安装包
- **nsis**: NSIS 安装程序（可选）
- **exe**: 独立可执行文件（绿色版）

推荐分发 `.msi` 安装包，它会自动处理：
- 应用图标
- 开始菜单快捷方式
- 卸载程序
- WebView2 运行时（如果缺失）

## 🔍 验证环境

运行以下命令验证所有依赖是否正确安装：

```powershell
# 1. Node.js 和 pnpm
node --version
pnpm --version

# 2. Rust 工具链
rustc --version
cargo --version

# 3. C++ 编译器
where cl

# 4. WebView2
Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -Name pv
```

全部通过后，你就可以开始开发了！

## 📝 开发工作流

推荐的开发流程：

```powershell
# 1. 开发前端界面（快速热重载）
pnpm run dev:web

# 2. 开发 Rust 后端功能或测试完整应用
pnpm run dev:desktop

# 3. 发布前完整构建
pnpm run build:sidecar
pnpm run prepare:sidecar-bundle
pnpm run build:desktop
```

## 🆘 获取帮助

如果遇到其他问题：

1. 检查 Tauri 官方文档：https://tauri.app/v2/guides/prerequisites/
2. 查看项目 Issues
3. 确保所有依赖版本符合要求

---

**最后更新**: 2026-06-18
