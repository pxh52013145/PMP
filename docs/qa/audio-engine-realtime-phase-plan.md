# 音频引擎抗干扰与 Bit-Perfect 升级计划（Phase Plan + 验收用例）

> 更新时间：2026-02-09
> 
> 适用范围：`apps/desktop/src/services/audio/*`、`apps/desktop/src-tauri/src/audio/*`、`apps/desktop/src-tauri/src/native_audio.rs`

---

## 1. 背景与目标

当前用户场景中，音频播放在以下情况下仍会出现缓冲欠载（underrun）与杂音：

- 音乐库操作（扫描/翻页/封面加载）与播放并行。
- 外部进程高干扰（看图软件删图/切图、系统前台切换）。
- 后台播放时被系统调度降权。

本轮目标：

1. 将“外部干扰导致的欠载”显著压低，并保持长时间稳定。
2. 在模块解耦前提下，建立可持续演进的音频引擎基座。
3. 为 `Transport-Exact（后DSP传输位完美）` 与高质量 DSP（dither / noise shaping）建立双通路架构。
4. 将升频链路升级为“数学高保真”路径，重点抑制镜像混叠与采样间峰值削波。
5. 将缓冲层升级为“可验证完整性”的双层缓冲，不再依赖忙等与脆弱时序。

### 1.1 需求映射（本次确认）

| 需求ID | 需求描述 | 文档落点 |
|---|---|---|
| R1 | 解决缓冲欠载痛点，提升抗干扰稳定性 | 第 3 节、第 4 节、第 5 节 |
| R2 | 动态保护 CPU 对音频计算的支撑能力 | 第 3.1 节、Phase 1 |
| R3 | 对标 JRiver 级升频质量（抑制镜像混叠与 ISP 削波） | 第 3.3 节、Phase 4 |
| R4 | 建立“PCM 准确写入”缓冲层（完整性可验证） | 第 3.4 节、Phase 2 |
| R5 | `Transport-Exact` 与 HQ DSP 双通路严格分离 | 第 3.2 节、Phase 3 |

### 1.2 边界说明（必须明确）

- “**完全不受干扰**”在通用桌面 OS 上无法做数学绝对保证（驱动/固件/系统抢占不可完全控制）。
- 本方案目标是“**工程上的硬实时逼近**”：在定义的干扰包络内将欠载压到接近 0，并保持可重复验证。
- “PCM 准确无损写入 buffer”在 `Transport-Exact` / `Robust` 模式可做严格约束；`HQ DSP` 模式中 PCM 会被算法有意变换，但仍需可追溯、可测量。

### 1.3 已拍板技术决策（锁定）

1. `TransportExact` 默认量化容器：**Int32**
   - 24-bit 内容采用 32-bit 容器承载，低 8 bit 置零。
   - 原因：SIMD/对齐效率更高，且与主流 WASAPI/ASIO 实践一致。
2. `HQ SRC` 阻带目标：**140 dB**
   - 作为 V1 默认硬指标，不追求 160 dB 的计算成本。
3. `HQ DSP Extreme(GPU)`：**V1 不启用**
   - 先完成 CPU SIMD 实时链路与稳定性门禁，再评估独立扩展。

---

## 2. 设计原则（必须遵守）

1. **实时优先**：输出线程 deadline 第一优先级，禁止被重任务阻塞。
2. **模块解耦**：调度策略、缓冲策略、解码、输出后端、DSP 处理拆分，接口契约明确。
3. **可回滚**：每个 Phase 必须有 feature flag 或后端回退策略。
4. **可观测**：所有关键优化必须有指标（underrun、buffer ahead、rebuffer、切后端次数）可量化验证。
5. **模式分离**：`TransportExact` 与 `HQ DSP` 分离，避免互相污染。
6. **质量参数独立**：抗干扰优化不得通过偷偷降画质/降采样来“伪优化”。

---

## 3. 目标架构（To-Be）

### 3.1 核心模块分层

1. `RealtimeScheduler`（实时调度控制器）
   - 负责线程优先级与系统调度策略。
   - 按状态机动态升降（Normal / Guarded / Critical）。

2. `DecodePipeline`
   - 解码线程 + 重采样 + 预解码缓冲。
   - 与输出线程通过无锁/低锁队列交互。

3. `BufferController`
   - 管理预缓冲阈值、回填策略、欠载恢复窗口。
   - 根据 underrun 与 buffer ahead 自适应调节。

4. `OutputDriver`
   - WASAPI Exclusive / WASAPI Shared / Rodio-CPAL / ASIO。
   - 统一输出能力探测与降级策略。

5. `AudioQualityMode`
   - `TransportExact`
   - `HqDsp`
   - `Robust`

### 3.2 模式定义

#### A. TransportExact（后DSP传输位完美）

- 强制独占输出（WASAPI Exclusive/ASIO）。
- 允许用户在前级 DSP 链中做处理，但一旦离开 DSP 输出总线，进入 `TransportExact` 传输通路后必须满足：
  - 传输链不再二次改样本（禁止额外 gain/重采样/混音注入）
  - 量化与打包策略固定且可验证
  - buffer block 序列与样本载荷完整性可审计
- 适用语义：强调“后 DSP 传输链路位模式稳定”，而不是“源文件原始位完全直通”。

#### B. HqDsp

- 保留 DSP 链，末端量化时启用：
  - TPDF dither
  - 可选 noise shaping（按位深策略）
- 明确与 `TransportExact` 在链路职责上互补：
  - DSP 计算阶段：可变换
  - 传输阶段：按模式约束固定

#### C. Robust

- 主打抗干扰稳定性：动态预缓冲、调度升降级、后端自动回退。

### 3.2.1 线性相位优先策略（本次确认）

- `HQ SRC` 默认采用 `Linear Phase`，优先保证群延迟一致性与数学可验证性。
- “听感型”修饰统一放在可插拔 DSP 层，不污染传输层语义。

### 3.3 升频算法路线（对标高端播放器）

目标：在 `HQ DSP` 模式下，将重采样从“可用”升级为“高保真”，显式控制镜像混叠与采样间峰值（Inter-Sample Peak, ISP）。

#### 3.3.1 统一升频链路（建议）

`Decode PCM -> HQ SRC -> ISP Headroom/TruePeak Guard -> Dither/Noise Shaping -> Output`

#### 3.3.2 HQ SRC 技术要求

1. **高阻带抑制**：
   - 目标阻带衰减固定为 >= 140 dB（HQ 档，V1 锁定）。
2. **低通带波纹**：
   - 通带纹波建议 <= 0.001 dB。
3. **可配置最小相位/线性相位**：
   - 线性相位用于绝对幅相一致；
   - 最小相位用于降低预振铃感知。
4. **多质量档位**：
   - `Ultra`（离线/高性能）
   - `High`（默认实时）
   - `Safe`（高干扰 fallback）

#### 3.3.3 ISP / True Peak 保护

1. 在重采样后做过采样 true-peak 估计（建议 4x~8x）。
2. 提供 `Headroom` 控制（默认 -1.0 dBTP）。
3. 若预测超限，优先执行“透明增益回退”，避免硬削波。

#### 3.3.4 借鉴改进方向（算法层）

1. 分段 polyphase FIR 核缓存，减少实时系数计算开销。
2. 预计算窗函数与核表，运行时只做索引与插值。
3. 关键路径 SIMD 化（Rust `std::arch`），以 profiler 结果驱动。
4. 对固定比率（44.1->48, 48->96 等）提供专门快速核。

#### 3.3.5 V1 范围冻结

1. V1 不引入 GPU Compute 升频路径。
2. V1 先完成 CPU SIMD（AVX2/NEON）关键核优化。
3. GPU 方案保留为后续独立 Phase（不阻塞 P1/P2/P3/P4 主线）。

### 3.4 缓冲层升级目标（从“软缓冲”到“可验证缓冲”）

#### 3.4.1 问题定义

当前缓冲具备容量，但在高干扰下仍可能因调度/忙等导致“看似有缓冲却仍欠载”。

#### 3.4.2 目标结构

1. **双层缓冲**：
   - `Decode Reservoir`：解码侧大水库（秒级）。
   - `Render Queue`：输出侧 deadline 安全队列（毫秒级、块对齐）。
2. **块级写入协议**：
   - 以 frame block 为最小单位提交，不做逐 sample 拉扯。
3. **完整性元数据**：
   - 每块带 `seq`、`frameCount`、`crc32(optional)`、`timestamp`。
4. **无忙等策略**：
   - 明确 backpressure 与 wakeup 机制，避免空转抢 CPU。

#### 3.4.3 “PCM 准确写入”保证范围

1. `TransportExact`：DSP 输出总线到输出提交前保持位模式一致（除封装/布局）。
2. `Robust`：不做音质变换，允许调度与缓冲策略调整。
3. `HQ DSP`：允许算法变换，但每块变换可追踪、可复现、可验证。

### 3.5 五个“降维打击”升级维度（激进版）

#### 3.5.1 内存层：反缺页优化（Page-Fault Hardening）

1. 仅锁定热路径内存（建议 2~8MB）：
   - `Render Queue`
   - 关键 DSP context
2. 禁止锁定整段大水库（Decode Reservoir），防止拖慢系统。
3. 引入 `AudioMemoryPool`：
   - 输出回调线程中零动态分配。
   - DSP 临时 buffer 启动预分配。

#### 3.5.2 调度层：软亲和 + MMCSS

1. 优先使用 MMCSS（`Pro Audio`/`Audio`），禁止 `REALTIME_PRIORITY_CLASS`。
2. 使用 QoS High + 关闭 Power Throttling，软性避开 E-Core。
3. 可选专家模式：启用线程亲和策略（仅在用户确认后）。

#### 3.5.2.1 “激进但不伤系统”约束

1. 禁止使用 `REALTIME_PRIORITY_CLASS`。
2. 输出/解码线程以 MMCSS + QoS 为主，保留系统 20% 周期。
3. 仅在 `critical` 窗口短时升权，恢复后自动回落。
4. 扫描/封面等非实时任务明确进入 background 模式。

#### 3.5.3 数据结构层：Wait-Free 热路径

1. SPSC ring queue（Acquire/Release 原子语义）。
2. 音频线程不做阻塞等待：无数据时输出受控静音帧并记录指标。
3. 参数热更新采用原子指针切换（非实时线程构建新参数快照）。

#### 3.5.4 DSP 算法层：高精度与相位控制

1. SRC/DSP 关键节点优先 `f64` 计算（按 CPU 预算降级到混合精度）。
2. 默认线性相位；可选最小相位与中间相位（实验特性）。
3. FIR/SRC 内核按 profiler 结果做 SIMD intrinsics 优化。

#### 3.5.5 异构计算层（Nuclear Option）

1. `HQ DSP Extreme` 模式允许 GPU Compute 参与长抽头升频。
2. 仅用于高延迟容忍场景（如 500ms+ buffer），默认关闭。
3. 与常规实时模式严格隔离，防止 PCIe 往返放大 jitter。

---

## 4. Phase Plan（分阶段实施）

## Phase 0：基线与观测加固（1 周）

### 目标

- 建立统一指标口径与回归脚本门禁。

### 交付

- 统一输出指标：
  - `underrunEvents`
  - `underrunFrames`
  - `bufferedAhead(min/avg/current)`
  - `rebufferCount`
  - backend 自动切换次数
- 将压力参数纳入 `audio-smoke` 标准命令模板。

### 验收

- 在 `scripts/audio-smoke.ps1` 下可重复复现干扰场景并输出稳定指标。

---

## Phase 1：实时调度控制器（2 周）

### 目标

- 把“线程调度”从分散调用升级为状态机化调度模块。

### 交付

- 新增 `RealtimeScheduler`（Rust）
  - 输出线程：固定高优先级（MMCSS Pro Audio）。
  - 解码线程：根据 buffer pressure 动态 boost。
  - 音乐库扫描/封面线程：后台降权（background / EcoQoS）。
- 新增状态机：`normal -> guarded -> critical -> recover`。
- 新增调度策略表：
  - `normal`：输出高优先级，解码常规优先级。
  - `guarded`：解码短时 boost，压制非关键线程。
  - `critical`：输出与解码均短时高保护，限制后台重任务并发。
  - `recover`：缓冲恢复后平滑回落，防止抖动切档。

### 风险与回滚

- 风险：过度升权影响系统交互流畅度。
- 回滚：`PMP_AUDIO_RT_SCHEDULER=off` 一键关闭，退回当前策略。

### 验收

- 外部 CPU 干扰下（8~12 stress threads）`underrunEvents` 比当前基线下降 >= 70%。

---

## Phase 2：缓冲与队列重构（2 周）

### 目标

- 消除 decode->buffer->output 链路中的忙等与抖动放大。

### 交付

- 将当前 ring buffer 的等待/写入策略升级为块级推拉，减少空转。
- 输出侧改块渲染路径，减少逐 sample 调用开销。
- 自适应预缓冲策略：按设备/后端/underrun 窗口动态调节。
- 实现双层缓冲：Decode Reservoir + Render Queue。
- 每块引入序列号与完整性字段，支持 end-to-end 校验。

### 风险与回滚

- 风险：seek/crossfade 边界行为变化。
- 回滚：保留旧 buffer adapter，feature flag 切回。

### 验收

- 30 分钟连续播放 + 干扰场景下无持续增长型欠载趋势。

---

## Phase 3：TransportExact 通路（2 周）

### 目标

- 提供可验证的 TransportExact 模式，不与 DSP 模式混用。

### 交付

- 新增 `TransportExact` 模式开关与能力检测。
- 进入模式时自动禁用冲突功能并给出提示。
- 输出端实现位深/采样率协商策略。

### 验收

- 在支持设备上，模式进入成功率 > 95%。
- 模式中所有冲突 DSP 功能被正确屏蔽。

---

## Phase 4：高质量量化（Dither/Noise Shaping）（2 周）

### 目标

- 在非 TransportExact 路径下，实现高质量量化而非简单 round。
- 在非 TransportExact 路径下，实现高保真升频与 ISP 防削波。

### 交付

- 量化器支持：
  - 16/24-bit TPDF dither
  - 可配置 noise shaping 曲线
- 新增可回归测试：静音底噪、低电平线性、失真阈值。
- 升频链路升级：
  - HQ SRC（高阻带抑制 + 低通带纹波）
  - True Peak 估计与 Headroom 控制
  - 线性相位/最小相位可配置

### 验收

- 对比旧量化路径，低电平失真可测降低。
- 对比旧升频路径，镜像混叠与 ISP 削波事件显著下降。

---

## Phase 5：稳定性收敛与发布门禁（1 周）

### 目标

- 形成稳定的发布前门禁（自动 + 手工）。

### 交付

- 回归脚本组合：`audio-smoke` + `perf-snapshot`。
- 形成固定报告模板（日志 + 快照 + 结论）。

### 验收

- 满足本文件第 6 节门禁阈值后方可发布。

---

## 5. 关键验收场景（测试用例矩阵）

## 5.1 自动化用例（CLI）

### 用例 A1：基础播放稳定性

- 命令：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/audio-smoke.ps1 \
  -TrackPath .\Eagles_Hotel_California.flac \
  -PlayMs 30000 \
  -SeekCount 4 \
  -SeekSeconds 12
```

- 断言：无报错，最终状态可正常 `stop`。

### 用例 A2：CPU 干扰抗压

- 命令（通过 rust `--audio-smoke` 参数链路）：

```powershell
cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml -- \
  --audio-smoke \
  --path .\Eagles_Hotel_California.flac \
  --play-ms 120000 \
  --stress-cpu-threads 8 \
  --max-underrun-events 20
```

- 断言：欠载事件不超过阈值，且播放不中断。

### 用例 A3：后端切换鲁棒性

- 命令：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/audio-smoke.ps1 \
  -TrackPath .\Eagles_Hotel_California.flac \
  -SwitchBackends "wasapi-exclusive,wasapi,rodio-cpal" \
  -SwitchIntervalMs 1200
```

- 断言：切换过程中无 crash，无“永久 error state”。

### 用例 A4：track 高频切换 + crossfade

- 命令：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/audio-smoke.ps1 \
  -TrackPath .\Eagles_Hotel_California.flac \
  -SwitchTracks ".\Eagles_Hotel_California.flac,.\Eagles_Hotel_California.flac" \
  -SwitchTrackIntervalMs 1000 \
  -CrossfadeMs 300
```

- 断言：无 click 爆音、无 deadlock。

---

## 5.2 手工场景用例（真实干扰）

### 用例 M1：播放 + 音乐库滚动 + 专辑页滚动

- 步骤：播放中进入音乐库连续滚动 3 分钟，再进入专辑页滚动 3 分钟。
- 断言：无明显连续杂音，内存与 CPU 曲线可恢复。

### 用例 M2：播放 + 外部看图软件高频操作

- 步骤：播放中在看图软件执行删图/切图/批量浏览。
- 断言：无长时间卡顿；短瞬态干扰后 1~2 秒内恢复稳定。

### 用例 M3：后台播放稳定性

- 步骤：播放器最小化，前台运行高负载应用 10 分钟。
- 断言：播放不中断，不出现持续性破音。

### 用例 M4：长稳播放

- 步骤：连续播放 2 小时（含切曲/seek）。
- 断言：无内存异常增长趋势，无错误状态累计失控。

---

## 5.3 TransportExact 专项用例（Phase 3 起）

### 用例 B1：模式约束验证

- 步骤：启用 TransportExact 后尝试对传输链注入二次增益/重采样。
- 断言：冲突注入被拒绝，UI 给出明确原因。

### 用例 B2：设备能力与采样率协商

- 步骤：切换 44.1k / 48k / 96k 文件。
- 断言：协商成功且不中断；失败时自动回退并提示。

### 用例 B3：数字一致性（条件允许）

- 步骤：在可用链路做 loopback/数字抓取比对。
- 断言：输出与输入位模式一致（允许封装层头差异，不允许样本变化）。

---

## 5.4 升频与抗混叠专项用例（Phase 4 起）

### 用例 S1：镜像混叠抑制

- 步骤：使用高频扫频与多音测试信号，执行 44.1k->48k、48k->96k 升频。
- 断言：阻带镜像能量低于目标阈值（按 HQ 档定义）。

### 用例 S2：通带纹波验证

- 步骤：对白噪 + 正弦采样点做频响估计。
- 断言：通带纹波满足设定阈值，且跨设备结果一致。

### 用例 S3：Inter-Sample Peak 防削波

- 步骤：使用已知易触发 ISP 的测试片段，分别在旧/新路径播放。
- 断言：新路径 ISP 超限事件明显少于旧路径。

### 用例 S4：相位模式验证

- 步骤：比较线性相位与最小相位模式输出差异。
- 断言：两模式行为符合预期且无异常毛刺。

---

## 5.5 缓冲完整性专项用例（Phase 2 起）

### 用例 RQ1：块序列连续性

- 步骤：高压场景运行 20 分钟，记录 block seq。
- 断言：无 seq 回退/跳变（除明确 drop 策略记录外）。

### 用例 RQ2：端到端一致性（TransportExact）

- 步骤：在 TransportExact 路径开启 block 完整性校验。
- 断言：提交块样本与输入块一致（位模式）。

### 用例 RQ3：回压与恢复

- 步骤：人为降低解码吞吐，观察 backpressure 行为。
- 断言：无 busy-loop；进入保护档后可自动恢复。

---

## 6. 发布门禁阈值（建议初版）

1. `P0/P1` 稳定门禁：
   - 2 分钟 CPU 干扰播放测试：`underrunEvents <= 20`
   - 10 分钟真实操作测试：无持续破音（>3 秒连续）

2. `P2` 收敛门禁：
   - 相比 Phase 0 基线，`underrunEvents` 降低 >= 70%
   - `rebufferCount` 降低 >= 60%

3. `P3` TransportExact 门禁：
   - 支持设备进入成功率 > 95%
   - 冲突功能拦截覆盖率 100%

4. `P4` 音质门禁：
  - 量化新增路径通过全部单元与回归测试
  - 低电平线性对比优于旧 round-only 路径
  - 镜像混叠与 ISP 指标满足 HQ 档阈值

---

## 7. 与现有代码映射（实施入口）

- 调度与线程：`apps/desktop/src-tauri/src/audio/threading.rs`
- 引擎状态与预缓冲：`apps/desktop/src-tauri/src/audio/engine.rs`
- 缓冲结构：`apps/desktop/src-tauri/src/audio/buffer.rs`
- 流式输入：`apps/desktop/src-tauri/src/audio/input/symphonia.rs`、`apps/desktop/src-tauri/src/audio/input/streaming.rs`
- 输出后端：`apps/desktop/src-tauri/src/audio/output/wasapi_exclusive.rs`
- TS 侧鲁棒治理：`apps/desktop/src/services/audio/NativeAudioService.ts`
- 冒烟脚本：`scripts/audio-smoke.ps1`
- 快照脚本：`scripts/perf-snapshot.ps1`、`scripts/perf-snapshot-4rounds.ps1`

---

## 8. 说明：关于 “JRiver 64-bit”

- “64-bit”包含两个层面：
  1. 应用位宽（x64）
  2. DSP 内部处理精度（常见 64-bit float 路径）
- 本项目目标是“在实时稳定 + 模块解耦前提下”逐步对齐其体验，不以单一位宽指标替代整体音频品质与稳定性。
