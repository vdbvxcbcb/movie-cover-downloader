# 构建检查清单

在执行 `.\scripts\build-with-msvc.ps1` 或手动 `pnpm run build:desktop` 前，请按照此清单逐项检查。

## ✅ 环境检查

### 1. Rust 工具链
```powershell
rustc --version
cargo --version
```
- [ ] rustc 版本 ≥ 1.70
- [ ] cargo 可正常运行

### 2. C++ 编译器
```powershell
where cl
```

**重要提示**：如果显示 "找不到文件"，这是正常的！

MSVC 编译器 (cl.exe) 不会自动添加到系统 PATH。你需要：

**选项 1 - 使用自动化脚本（推荐）**：
```powershell
.\scripts\build-with-msvc.ps1
```

**选项 2 - 使用开发者命令提示符**：
- 在开始菜单搜索："x64 Native Tools Command Prompt for VS 2026"（或 2022）
- 在该终端中构建项目

**检查 Build Tools 是否已安装**：
```powershell
# Visual Studio 2026
Test-Path "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

# 或 Visual Studio 2022
Test-Path "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
```

- [ ] 返回 True（表示 Build Tools 已安装）
- [ ] 如果返回 False，需要安装 Visual Studio Build Tools（见 windows-setup.md）

### 3. Node.js 环境
```powershell
node --version
npm --version
pnpm --version
```
- [ ] Node.js ≥ 20.x
- [ ] npm 可正常运行（sidecar bundle 会用 npm 安装生产依赖）
- [ ] pnpm 已安装

### 4. WebView2
```powershell
Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -Name pv
```
- [ ] WebView2 已安装（Windows 11 通常自带）

## 🔧 项目依赖检查

### 5. 安装依赖
```powershell
pnpm install
```
- [ ] 所有依赖安装成功
- [ ] 没有 WARN 或 ERROR
- [ ] `node_modules` 目录存在
- [ ] `pnpm-workspace.yaml` 已允许 `esbuild` 和 `sharp` 的 build scripts

### 6. 构建 Sidecar
```powershell
pnpm run build:sidecar
```
- [ ] TypeScript 编译成功
- [ ] `apps/sidecar/dist/` 目录生成

### 7. 准备 Sidecar Bundle
```powershell
pnpm run prepare:sidecar-bundle
```
- [ ] 脚本执行成功
- [ ] `apps/desktop/src-tauri/resources/sidecar/` 目录存在
- [ ] 该目录包含：
  - [ ] `node.exe`
  - [ ] `package.json`
  - [ ] `dist/` 目录
  - [ ] `node_modules/` 目录（包含 sharp 等依赖）
- [ ] `node_modules/sharp` 是真实目录，不是符号链接 / junction
- [ ] `@img/sharp-win32-x64/lib/sharp-win32-x64.node` 存在
- [ ] `resources/sidecar` 下符号链接 / junction 数量为 0

### 8. 构建前端资源
```powershell
pnpm run build:web
```
- [ ] Vue 应用构建成功
- [ ] `apps/desktop/dist/` 目录生成
- [ ] 包含 `index.html` 和静态资源

## 🚀 执行构建

**推荐方式 - 使用自动化脚本**：

```powershell
# PowerShell 版本（推荐）
.\scripts\build-with-msvc.ps1

# 或 CMD 版本
.\scripts\build-with-msvc.bat
```

这些脚本会自动：
1. 设置 MSVC 环境变量
2. 构建 sidecar
3. 准备 sidecar bundle（使用 npm 安装生产依赖，避免 pnpm 链接进入安装包）
4. 构建桌面应用

**手动方式 - 在开发者命令提示符中**：

1. 在开始菜单搜索："x64 Native Tools Command Prompt for VS 2026"
2. 运行：
   ```cmd
   cd "d:\claude blog\new\movie-cover-downloader"
   pnpm run build:desktop
   ```

### 9. 桌面应用构建
```powershell
pnpm run build:desktop
```
- [ ] Cargo 编译成功
- [ ] Bundle 打包完成
- [ ] 输出目录：`apps/desktop/src-tauri/target/release/bundle/`

## 📦 验证构建产物

### 10. 检查构建产物
```powershell
ls "apps/desktop/src-tauri/target/release/bundle/msi/"
ls "apps/desktop/src-tauri/target/release/bundle/nsis/"
```
- [ ] `.msi` 安装包已生成
- [ ] `.exe` NSIS 安装包已生成
- [ ] 文件大小合理（NSIS 约 228 MB，MSI 约 239 MB，随依赖版本小幅波动正常）
- [ ] 记录 `LastWriteTime` 和 SHA256，确认是本次新产物

### 11. 测试安装包（可选）
- [ ] 双击安装包可正常安装
- [ ] 应用可正常启动
- [ ] 功能测试通过

## ❌ 常见错误快速修复

| 错误信息 | 解决方案 |
|---------|---------|
| `cargo metadata: program not found` | 安装 Rust 并重启终端 |
| `cl.exe not found` | 安装 Visual Studio Build Tools |
| `resource not found: resources/sidecar` | 执行 `pnpm run prepare:sidecar-bundle` |
| `sharp build failed` | 确认 npm 可用、网络可访问 npm registry，然后重新执行 `pnpm run prepare:sidecar-bundle` |
| `Sharp is a symlink` | 确认 `prepare-sidecar-bundle.ps1` 使用 npm 安装生产依赖，不要把 pnpm 链接结构打进安装包 |
| `WebView2 missing` | 安装 WebView2 Runtime |

## 🔄 完整构建流程（一键执行）

如果所有环境都已配置好，可以按顺序执行：

```powershell
# 清理旧构建
rm -rf apps/desktop/dist
rm -rf apps/desktop/src-tauri/target
rm -rf apps/desktop/src-tauri/resources/sidecar

# 完整构建
pnpm install
pnpm run build:sidecar
pnpm run prepare:sidecar-bundle
pnpm run build:web
pnpm run build:desktop
```

推荐日常直接使用：

```powershell
.\scripts\build-with-msvc.ps1
```

## 📝 注意事项

1. **首次构建很慢**：Rust 编译器需要下载和编译大量依赖，首次可能需要 10-30 分钟
2. **增量构建更快**：后续构建通常只需 1-5 分钟
3. **磁盘空间**：确保至少有 5 GB 可用空间（Rust target 目录很大）
4. **网络要求**：首次构建需要下载 Rust crates，确保网络畅通

---

**完成所有检查项后，你的构建应该会顺利完成！**
