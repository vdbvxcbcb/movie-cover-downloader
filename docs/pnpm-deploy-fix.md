# pnpm deploy 路径问题修复方案

## 问题描述

在 Windows 上，当项目路径包含空格时（如 `D:\claude blog\new\movie-cover-downloader`），`pnpm deploy` 命令会错误地拼接路径，导致构建失败：

```
ERR_PNPM_ENOENT [importPackage D:\claude blog\new\movie-cover-downloader\C:\Users\...\Temp\...] 
ENOENT: no such file or directory
```

这是 pnpm 的一个已知 bug，在处理带空格的工作目录时，会错误地将相对路径和绝对路径拼接在一起。

## 临时解决方案

### 方案 1：使用快速构建脚本（推荐）

如果 sidecar bundle 已经存在（`apps/desktop/src-tauri/resources/sidecar/` 目录已准备好），使用快速构建脚本跳过 sidecar 重建：

```bat
.\build-quick.bat
```

此脚本会：
1. 设置 MSVC 环境
2. 构建前端
3. 直接编译 Rust 代码
4. 生成 MSI 安装包

### 方案 2：手动构建流程

```powershell
# 1. 打开 "x64 Native Tools Command Prompt for VS 2026"

# 2. 导航到项目
cd "d:\claude blog\new\movie-cover-downloader\apps\desktop"

# 3. 构建前端
pnpm build

# 4. 进入 Tauri 目录
cd src-tauri

# 5. 编译 Rust
cargo build --release

# 6. 生成安装包
cd ..
pnpm tauri build --bundles msi --no-bundle
```

### 方案 3：移动项目到无空格路径

最彻底的解决方案是将项目移动到不包含空格的路径：

```powershell
# 移动项目
mv "d:\claude blog\new\movie-cover-downloader" "d:\movie-cover-downloader"

# 然后正常构建
cd d:\movie-cover-downloader
.\scripts\build-with-msvc.ps1
```

## 根本原因

pnpm deploy 命令在内部处理路径时，没有正确处理当前工作目录包含空格的情况。即使传入的目标路径是绝对路径，pnpm 也会错误地将当前工作目录作为前缀拼接上去。

相关 pnpm issue: 
- https://github.com/pnpm/pnpm/issues/5895
- https://github.com/pnpm/pnpm/issues/6254

## 验证 sidecar bundle 是否完整

在使用快速构建前，确认 sidecar bundle 已准备好：

```powershell
# 检查必需文件
Test-Path "apps\desktop\src-tauri\resources\sidecar\node.exe"        # 应返回 True
Test-Path "apps\desktop\src-tauri\resources\sidecar\dist\index.js"  # 应返回 True
Test-Path "apps\desktop\src-tauri\resources\sidecar\node_modules\sharp"  # 应返回 True
```

如果这些文件都存在，说明 sidecar bundle 完整，可以直接使用快速构建。

## 构建产物位置

构建成功后，安装包位于：
```
apps/desktop/src-tauri/target/release/bundle/msi/
```

可执行文件位于：
```
apps/desktop/src-tauri/target/release/movie-cover-downloader-desktop.exe
```

## 更新日志

- 2026-06-18: 发现并记录 pnpm deploy 空格路径问题
- 2026-06-18: 创建 build-quick.bat 快速构建脚本作为临时解决方案
