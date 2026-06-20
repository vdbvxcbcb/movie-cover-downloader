# Rust 代码拆分方案

## 当前状态
- `lib.rs`: 3562 行，包含所有功能

## 拆分后结构

```
src/
├── lib.rs                    # 主入口 (~100 行) ✅ 需要重写
├── constants.rs              # 常量定义 (~50 行) ✅ 已创建
├── types.rs                  # 类型定义 (~200 行) ✅ 已创建
├── utils.rs                  # 工具函数 (~200 行) ✅ 已创建
├── crypto.rs                 # Cookie 加密解密 (~150 行) ✅ 已创建
├── task_control.rs           # 任务控制 (~200 行) ✅ 已创建
├── sqlite/
│   ├── mod.rs               # SQLite 模块导出
│   ├── connection.rs        # 连接和初始化
│   ├── state.rs             # 状态读写
│   └── migration.rs         # 数据迁移和恢复
├── sidecar/
│   ├── mod.rs               # Sidecar 模块导出
│   ├── runtime.rs           # Sidecar 运行时
│   ├── parser.rs            # 输出解析
│   ├── download.rs          # 下载任务
│   └── douban.rs            # 豆瓣相关
└── commands/
    ├── mod.rs               # 命令模块导出
    ├── state.rs             # 状态持久化
    ├── task.rs              # 任务控制
    ├── fs.rs                # 文件系统
    ├── image.rs             # 图片处理
    └── login.rs             # 登录窗口
```

## 模块职责

### 1. constants.rs ✅
- 应用级常量
- 队列配置常量
- 平台相关常量

### 2. types.rs ✅
- TableName 枚举
- RuntimeLogPayload/Event
- DownloadTaskPayload
- 所有前端交互类型

### 3. utils.rs ✅
- validate_task_id
- timestamp_now
- hex_encode/decode
- 文件名清理
- 路径验证

### 4. crypto.rs ✅
- protect_bytes/unprotect_bytes
- serialize_cookie_payload
- deserialize_cookie_payload

### 5. task_control.rs ✅
- TaskControlRegistry
- terminate_task_process
- 控制文件管理

### 6. sqlite/ (待拆分)
**connection.rs**:
- open_state_db_path
- open_state_db
- sqlite_db_path
- is_recoverable_sqlite_error
- rotate_corrupted_state_db

**state.rs**:
- load_snapshot_from_sqlite
- write_snapshot_to_sqlite
- count_rows
- next_runtime_log_seed

**migration.rs**:
- migrate_json_snapshot_if_needed
- save_snapshot_to_sqlite_path_with_recovery

### 7. sidecar/ (待拆分)
**runtime.rs**:
- resolve_sidecar_root/entry/node
- resolve_request_interval_ms
- format_sidecar_exit_error

**parser.rs**:
- parse_sidecar_stdout_line
- parse_sidecar_stderr_line
- parse_douban_photos_discover_stdout_line
- parse_sidecar_json_result

**download.rs**:
- run_download_task_blocking
- run_selected_photo_download

**douban.rs**:
- discover_douban_photos_blocking
- search_douban_movies_blocking
- resolve_douban_movie_title_blocking
- resolve_douban_movie_preview_blocking

### 8. commands/ (待拆分)
**state.rs**:
- load_persisted_state
- save_persisted_state
- emit_runtime_log

**task.rs**:
- pause_download_task
- resume_download_task
- clear_download_tasks
- run_download_task
- discover_douban_photos
- run_selected_photo_download

**fs.rs**:
- delete_directory_path
- clear_directory_contents
- pick_output_directory
- open_directory_path
- reveal_file_path

**image.rs**:
- read_local_image_file
- read_dropped_image_file
- save_custom_cropped_image
- save_processed_image

**login.rs**:
- check_login_window_cookie_status
- close_login_window
- resolve_douban_login_cookie_status

## 拆分原则

### Apollo Rust Best Practices 应用

1. **模块化** (Chapter 1)
   - 每个模块职责单一
   - 公共接口清晰
   - 避免循环依赖

2. **类型安全** (Chapter 1)
   - TableName 枚举防止 SQL 注入
   - 强类型 payload 结构

3. **错误处理** (Chapter 4)
   - 统一使用 Result<T, String>
   - 避免 unwrap/expect
   - 使用 ? 传播错误

4. **性能** (Chapter 3)
   - 使用引用而非克隆
   - Option<&str> 代替 Option<String>
   - 迭代器优化

5. **测试** (Chapter 5)
   - 每个模块独立测试
   - 集成测试保留在 lib.rs

## 下一步行动

1. ✅ 创建基础模块 (constants, types, utils, crypto, task_control)
2. 🔄 创建 sqlite 模块
3. 🔄 创建 sidecar 模块
4. 🔄 创建 commands 模块
5. 🔄 重写 lib.rs 主入口
6. 🔄 运行测试验证
7. 🔄 运行 cargo clippy 检查

## 预期效果

- **可维护性**: 每个文件 < 300 行，职责清晰
- **可测试性**: 模块独立，易于单元测试
- **可读性**: 新开发者快速定位功能
- **性能**: 无运行时开销，编译时模块化
