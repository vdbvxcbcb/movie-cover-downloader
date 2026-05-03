# Sidecar Service

`apps/sidecar` 是后续真实抓取链路的执行层，目标是承接：

- 豆瓣适配器
- 匹配评分
- Cookie 池
- 下载调度
- 结构化日志

## 当前状态

当前已经从占位目录升级为可扩展的 `Node.js + TypeScript` 骨架，包含：

- 可运行入口 `src/index.ts`
- 事件与任务契约 `src/shared/contracts.ts`
- 结构化日志器 `src/shared/logger.ts`
- 调度器、匹配器、下载器、Cookie 池的服务骨架

## 目录结构

```text
src/
  adapters/
    base.ts
    douban.ts
  services/
    cookie-pool.ts
    downloader.ts
    matcher.ts
    scheduler.ts
  shared/
    contracts.ts
    logger.ts
    runtime-config.ts
  index.ts
```

## 目标交互方式

后续推荐让 sidecar 通过以下方式与桌面端对接：

- Tauri command 负责启动、停止、传参
- sidecar 输出结构化事件
- Rust 桥接层将事件转发给前端
- 前端只消费状态与日志，不直接承担抓取逻辑

## 当前限制

- 还没有接 SQLite
- 还没有接标准输入 / IPC / HTTP 控制面
- 还没有接入真实下载落盘流程
