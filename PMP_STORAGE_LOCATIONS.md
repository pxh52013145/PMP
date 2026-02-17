# PMP 存储与产物路径清单

更新时间：2026-02-16
适用范围：`apps/desktop`（桌面主应用）为主，附带 `community/*` 子项目说明。

---

## 1. 路径基准（先看这个）

PMP 桌面端的大部分落盘文件都在 Tauri 的 `app_data_dir()` 下。

- 记号：`<APP_DATA_DIR>` = `app.path_resolver().app_data_dir()`
- 仅封面缓存有兜底：若 `app_data_dir` 不可用，会尝试 `app_cache_dir`

> 说明：不同系统实际绝对路径不同，本文统一使用相对 `<APP_DATA_DIR>` 的路径表示，方便检索。

---

## 2. 桌面端会产生的文件（重点）

### 2.1 音频 / VST / DSP

- `<APP_DATA_DIR>/audio/native-audio-dsp-graph.json`
  - 用途：DSP Graph 持久化
  - 代码：`apps/desktop/src-tauri/src/dsp_graph.rs`

- `<APP_DATA_DIR>/audio/vst-settings.json`
  - 用途：VST 设置（buffer profile / sidechain 等）
  - 代码：`apps/desktop/src-tauri/src/vst_settings.rs`

- `<APP_DATA_DIR>/audio/vst-compat.json`
  - 用途：VST 兼容性规则
  - 代码：`apps/desktop/src-tauri/src/vst_compat.rs`

- `<APP_DATA_DIR>/audio/vst-governance-v1.json`
  - 用途：VST 治理策略
  - 代码：`apps/desktop/src-tauri/src/vst_governance.rs`

- `<APP_DATA_DIR>/audio/vst-presets.json`
  - 用途：VST 预设
  - 代码：`apps/desktop/src-tauri/src/vst_presets.rs`

- `<APP_DATA_DIR>/audio/vst-audit-log-v1.json`
  - 用途：VST 审计日志
  - 代码：`apps/desktop/src-tauri/src/vst_audit.rs`

- `<APP_DATA_DIR>/audio/vst-library-v1.sqlite3`
  - 用途：VST 插件库（SQLite）
  - 代码：`apps/desktop/src-tauri/src/vst_library.rs`

### 2.2 音乐库封面缓存（文件）

- `<APP_DATA_DIR>/music-covers/*`
  - 用途：Rust 侧生成的封面缓存文件（含缩略图变体）
  - 代码：`apps/desktop/src-tauri/src/music_library.rs`

### 2.3 背景/挂件资源

- `<APP_DATA_DIR>/background-media/background-<ts>-<seq>.<ext>`
  - 用途：背景导入资源
  - 代码：`apps/desktop/src-tauri/src/background_media.rs`

- `<APP_DATA_DIR>/background-media/ornaments/ornament-<ts>-<seq>.<ext>`
  - 用途：ornament 挂件图像资源
  - 代码：`apps/desktop/src-tauri/src/ornament_media.rs`

### 2.4 Magnet 布局存储

- `<APP_DATA_DIR>/pmp-store/magnet-layout-store-v1.json`
  - 用途：Magnet layout store 主文件
  - 代码：`apps/desktop/src-tauri/src/magnet_layout_store.rs`

- `<APP_DATA_DIR>/pmp-store/magnet-layout-store-v1.corrupt.<timestamp>.json`
  - 用途：损坏恢复时的备份文件
  - 代码：`apps/desktop/src-tauri/src/magnet_layout_store.rs`

### 2.5 调试配置

- `<APP_DATA_DIR>/debug/debug-config.json`
  - 用途：Debug Center / VST bridge debug 配置
  - 代码：`apps/desktop/src-tauri/src/debug_config.rs`

### 2.6 Durable 文本存储（插件/Shader/备份）

命名规则：`<APP_DATA_DIR>/pmp-durable/<namespace>/<id>.txt`

已使用 namespace：

- `pmpm-entry`：插件入口代码
- `pmps-fragment`：Shader fragment 代码
- `migration-backup`：迁移备份
- `profile-pack-backup`：主题/配置包备份

代码：`apps/desktop/src/modules/storage/durableTextStore.ts`

### 2.7 背景快照（根级 AppData 文件）

- `<APP_DATA_DIR>/pixel-matrix-background-settings.snapshot.json`
- `<APP_DATA_DIR>/pixel-matrix-background-history.snapshot.json`

用途：背景设置/历史的 snapshot 恢复
代码：`apps/desktop/src/modules/background/backgroundSnapshot.ts`

---

## 3. 桌面端“数据库”与浏览器存储

### 3.1 IndexedDB（MusicLibrary）

- DB：`MusicLibrary`
- Version：`4`
- ObjectStore：
  - `tracks`（音乐轨道元数据）
  - `libraryPaths`（库目录）
  - `coverCache`（封面缓存索引）

代码：`apps/desktop/src/services/audio/MusicLibraryService.ts`

### 3.2 IndexedDB（durableText，Web fallback）

- DB：`pixel-matrix-player`
- Store：`durableText`

代码：`apps/desktop/src/modules/storage/durableTextStore.ts`

### 3.3 localStorage（配置主入口）

统一 key 定义：`apps/desktop/src/utils/windowCommunication.ts`

典型 key（举例）：

- `pixel-matrix-locale`（语言设置）
- `pixel-matrix-native-audio-*`（音频设置）
- `pixel-matrix-pmpm-*`（插件安装/治理/审计）
- `pixel-matrix-pmps-*`（shader pack 安装/绑定）
- `pixel-matrix-player-config`（磁贴配置）

> 注意：localStorage / IndexedDB 在磁盘上的真实文件由 WebView2 管理，不在仓库内固定路径。

---

## 4. 音乐库元数据到底存哪

结论（桌面端当前实现）：

1. 元数据主存：IndexedDB `MusicLibrary.tracks`
2. 扫描来源：Rust `music_library_scan` 命令返回
3. 封面二进制：`<APP_DATA_DIR>/music-covers/*`
4. 封面索引：IndexedDB `MusicLibrary.coverCache`

关键代码：

- `apps/desktop/src/services/audio/MusicLibraryService.ts`
- `apps/desktop/src-tauri/src/music_library.rs`
- `apps/desktop/src-tauri/src/commands/library.rs`

---

## 5. 语言（本地化）设置位置

- 存储 key：`pixel-matrix-locale`
- 读取与迁移：`apps/desktop/src/i18n/persistedLocale.ts`
- 设置页写入：`apps/desktop/src/components/settings-panels/LanguageSettingsPanel.tsx`
- 语言资源：
  - `apps/desktop/src/i18n/locales/zh-CN.json`
  - `apps/desktop/src/i18n/locales/en-US.json`

---

## 6. Community 子项目（补充）

### 6.1 `community/community-platform`

- IndexedDB：`pmp-community-platform`
- 代码：`community/community-platform/src/storage/communityDb.ts`

### 6.2 `community/community-server`

- SQLite：`<DATA_DIR>/community.sqlite`
- Blob 文件：`<DATA_DIR>/blobs/<sha256-prefix>/<sha256>.<ext>`
- 代码：`community/community-server/src/server.mjs`

---

## 7. 快速排查建议

- 找“插件代码丢失”：优先查 `<APP_DATA_DIR>/pmp-durable/pmpm-entry/*.txt` 与 localStorage `pixel-matrix-pmpm-plugins`
- 找“Shader 包代码丢失”：查 `<APP_DATA_DIR>/pmp-durable/pmps-fragment/*.txt` 与 localStorage `pixel-matrix-pmps-shaders`
- 找“音乐库封面异常”：查 `<APP_DATA_DIR>/music-covers/*` + IndexedDB `coverCache`
- 找“VST 列表/参数异常”：查 `<APP_DATA_DIR>/audio/vst-library-v1.sqlite3`

