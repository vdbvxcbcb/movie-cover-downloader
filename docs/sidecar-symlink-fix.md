# Sidecar Symlink 问题修复

## 问题描述

打包后的安装包在用户机器上运行时报错：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'sharp'
imported from D:\Movie Cover Downloader\sidecar\dist\services\downloader.js
```

## 根本原因

pnpm 默认使用**符号链接（symlink）结构**来管理 `node_modules`：

```
node_modules/
├── sharp -> /d/claude blog/new/.../node_modules/.pnpm/sharp@0.34.5/...
├── .pnpm/
│   └── sharp@0.34.5/
│       └── node_modules/
│           └── sharp/  (实际文件)
```

### 问题分析

1. **符号链接指向开发机器的绝对路径**
   - `sharp` 是一个符号链接，指向 `/d/claude blog/new/movie-cover-downloader/node_modules/.pnpm/...`
   - 这个路径在开发机器上存在，但在用户机器上不存在

2. **Tauri 打包时复制了符号链接本身**
   - 符号链接被原样复制到安装包中
   - 用户安装后，符号链接的目标路径不存在
   - Node.js 尝试解析 `require('sharp')` 时找不到模块

3. **为什么之前的脚本没有发现问题**
   - 验证脚本只检查了 `node_modules/sharp` 是否存在
   - 在开发机器上，符号链接的目标路径存在，所以验证通过
   - 只有在用户机器上才会暴露问题

## 解决方案

修改 `prepare-sidecar-bundle.ps1` 使用 **hoisted（扁平化）安装模式**：

### 关键修改

```powershell
# 创建 .npmrc 配置
$npmrcContent = @"
enable-pre-post-scripts=true
node-linker=hoisted          # 使用扁平化结构
shamefully-hoist=true        # 提升所有依赖到顶层
"@

# 安装时使用 hoisted 模式
pnpm install --prod --no-lockfile --ignore-workspace
```

### Hoisted 模式的效果

```
node_modules/
├── sharp/               # 真实目录（不是符号链接）
│   ├── lib/
│   │   └── index.js
│   └── package.json
├── @img/
│   └── sharp-win32-x64/
│       └── lib/
│           └── sharp-win32-x64.node  # 原生二进制
└── (其他依赖都是真实目录)
```

所有依赖都是**真实文件和目录**，不包含任何指向开发机器路径的符号链接。

## 验证方法

### 1. 检查 sharp 是否为符号链接

```powershell
$sharpPath = "apps\desktop\src-tauri\resources\sidecar\node_modules\sharp"
$sharpItem = Get-Item -LiteralPath $sharpPath

if ($sharpItem.LinkType) {
    Write-Host "ERROR: Sharp is a symlink!" -ForegroundColor Red
    Write-Host "Target: $($sharpItem.Target)" -ForegroundColor Red
} else {
    Write-Host "OK: Sharp is a real directory" -ForegroundColor Green
}
```

### 2. 测试 Node.js 能否加载 sharp

```bash
cd apps/desktop/src-tauri/resources/sidecar
./node.exe -e "require('sharp'); console.log('Sharp loaded successfully');"
```

### 3. 检查符号链接数量

```bash
# 应该返回 0（没有符号链接）
find node_modules -maxdepth 2 -type l | wc -l
```

## 技术细节

### pnpm 的三种 node-linker 模式

| 模式 | 描述 | 符号链接 | 适用场景 |
|------|------|----------|----------|
| `isolated` | 默认模式，使用 `.pnpm` + 符号链接 | ✅ 有 | 开发环境（节省空间） |
| `hoisted` | 扁平化结构，类似 npm | ❌ 无 | 打包部署（兼容性好） |
| `pnp` | Plug'n'Play，无 node_modules | N/A | Yarn PnP 项目 |

### 为什么不能用 `pnpm deploy`

`pnpm deploy` 命令本应该解决这个问题，但在 Windows 上当路径包含空格时有 bug：

```
ERR_PNPM_ENOENT D:\claude blog\new\movie-cover-downloader\C:\Users\...\Temp\...
```

pnpm 错误地将当前工作目录和临时目录拼接在一起。

## 相关文件

- `scripts/prepare-sidecar-bundle.ps1` - 主打包脚本（已修复）
- `apps/desktop/src-tauri/tauri.conf.json` - Tauri 资源配置
- `apps/desktop/src-tauri/src/lib.rs:1830` - Rust 启动 sidecar 的代码

## 测试清单

- [x] Sharp 是真实目录而非符号链接
- [x] Sharp 原生二进制文件存在（423 KB）
- [x] Node.js 能成功 `require('sharp')`
- [x] node_modules 中没有符号链接
- [ ] 在全新的 Windows 机器上测试安装包
- [ ] 验证搜索和下载功能正常工作

## 相关 Issue

- pnpm symlink issue: https://github.com/pnpm/pnpm/issues/5895
- pnpm deploy path bug: https://github.com/pnpm/pnpm/issues/6254

## 更新日志

- **2026-06-18**: 发现并修复 sidecar symlink 问题
- **2026-06-18**: 修改打包脚本使用 hoisted 模式
- **2026-06-18**: 添加符号链接检测到验证步骤
