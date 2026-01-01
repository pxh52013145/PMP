#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <future>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <unordered_set>
#include <utility>
#include <vector>

#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#undef min
#undef max
#endif

namespace {

constexpr uint8_t MSG_SET_PARAMS = 1;
constexpr uint8_t MSG_PROCESS_AUDIO = 2;
constexpr uint8_t MSG_OPEN_EDITOR = 3;
constexpr uint8_t MSG_CLOSE_EDITOR = 4;
constexpr uint8_t MSG_PING = 5;
constexpr uint8_t MSG_SCAN_PLUGINS = 6;
constexpr uint8_t MSG_DESCRIBE_PLUGIN = 7;
constexpr uint8_t MSG_GET_PARAMS = 8;
constexpr uint8_t MSG_INSTANTIATE = 9;
constexpr uint8_t MSG_DISPOSE = 10;
constexpr uint8_t MSG_ERROR = 255;

constexpr uint32_t BRIDGE_PROTOCOL_VERSION = 1;
constexpr char SHM_RING_MAGIC[8] = {'P', 'M', 'P', '_', 'S', 'H', 'M', '1'};
constexpr uint32_t SHM_RING_VERSION = 1;
constexpr uint32_t SHM_FLAG_PEER_READY = 1u << 1;
constexpr uint32_t SHM_FLAG_PLUGIN_LOADED = 1u << 2;
constexpr uint32_t SHM_FLAG_PROCESSING_ACTIVE = 1u << 3;
constexpr uint32_t SHM_FLAG_PLUGIN_ERROR = 1u << 4;

struct ShmRingHeaderV1 {
  char magic[8];
  uint32_t version;
  uint32_t channels;
  uint32_t sampleRate;
  uint32_t capacityFrames;
  std::atomic<uint32_t> flags;
  std::atomic<uint32_t> heartbeat;
  uint32_t reserved[2];
  std::atomic<uint64_t> writeIndex;
  std::atomic<uint64_t> readIndex;
  uint64_t reservedTail;
};

static_assert(sizeof(ShmRingHeaderV1) == 64, "ShmRingHeaderV1 size mismatch");
static_assert(alignof(ShmRingHeaderV1) == 8, "ShmRingHeaderV1 alignment mismatch");
static_assert(std::atomic<uint32_t>::is_always_lock_free, "atomic<uint32_t> must be lock-free");
static_assert(std::atomic<uint64_t>::is_always_lock_free, "atomic<uint64_t> must be lock-free");

struct ParamUpdate {
  int index = 0;
  float normalized = 0.0f;
};

class ParamUpdateQueue {
 public:
  static constexpr uint32_t kCapacity = 256;

  bool push(int index, float normalized) {
    const uint32_t write = writeIndex_.load(std::memory_order_relaxed);
    const uint32_t read = readIndex_.load(std::memory_order_acquire);
    if (write - read >= kCapacity) {
      dropped_.fetch_add(1, std::memory_order_relaxed);
      return false;
    }

    buffer_[write % kCapacity] = ParamUpdate{index, normalized};
    writeIndex_.store(write + 1, std::memory_order_release);
    return true;
  }

  bool pop(ParamUpdate& out) {
    const uint32_t read = readIndex_.load(std::memory_order_relaxed);
    const uint32_t write = writeIndex_.load(std::memory_order_acquire);
    if (read == write) return false;

    out = buffer_[read % kCapacity];
    readIndex_.store(read + 1, std::memory_order_release);
    return true;
  }

  void clear() {
    const uint32_t write = writeIndex_.load(std::memory_order_relaxed);
    readIndex_.store(write, std::memory_order_release);
  }

  uint64_t dropped() const { return dropped_.load(std::memory_order_relaxed); }

 private:
  std::atomic<uint32_t> writeIndex_{0};
  std::atomic<uint32_t> readIndex_{0};
  std::atomic<uint64_t> dropped_{0};
  ParamUpdate buffer_[kCapacity] = {};
};

inline uint32_t floatToBits(float value) {
  uint32_t bits = 0;
  static_assert(sizeof(bits) == sizeof(value), "floatToBits expects 32-bit float");
  std::memcpy(&bits, &value, sizeof(bits));
  return bits;
}

inline float bitsToFloat(uint32_t bits) {
  float value = 0.0f;
  static_assert(sizeof(bits) == sizeof(value), "bitsToFloat expects 32-bit float");
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}

struct ParamDescriptor {
  std::string key;
  std::string title;
  float min = 0.0f;
  float max = 1.0f;
  float def = 0.0f;
  float step = 0.01f;
  std::optional<std::string> unit;
};

struct PluginDescriptor {
  std::string id;
  std::string name;
  std::optional<std::string> vendor;
  std::optional<std::string> version;
  std::optional<std::string> path;
  std::vector<ParamDescriptor> parameters;
};

bool readExact(std::FILE* file, void* out, size_t size) {
  auto* ptr = static_cast<uint8_t*>(out);
  size_t read = 0;
  while (read < size) {
    const size_t chunk = std::fread(ptr + read, 1, size - read, file);
    if (chunk == 0) return false;
    read += chunk;
  }
  return true;
}

bool writeExact(std::FILE* file, const void* data, size_t size) {
  const auto* ptr = static_cast<const uint8_t*>(data);
  size_t written = 0;
  while (written < size) {
    const size_t chunk = std::fwrite(ptr + written, 1, size - written, file);
    if (chunk == 0) return false;
    written += chunk;
  }
  return true;
}

void writeU32LE(std::FILE* file, uint32_t value) {
  uint8_t bytes[4] = {
      static_cast<uint8_t>(value & 0xFFu),
      static_cast<uint8_t>((value >> 8) & 0xFFu),
      static_cast<uint8_t>((value >> 16) & 0xFFu),
      static_cast<uint8_t>((value >> 24) & 0xFFu),
  };
  writeExact(file, bytes, 4);
}

bool readU32LE(std::FILE* file, uint32_t& valueOut) {
  uint8_t bytes[4] = {};
  if (!readExact(file, bytes, 4)) return false;
  valueOut = static_cast<uint32_t>(bytes[0]) | (static_cast<uint32_t>(bytes[1]) << 8) |
             (static_cast<uint32_t>(bytes[2]) << 16) | (static_cast<uint32_t>(bytes[3]) << 24);
  return true;
}

bool writeMessage(std::FILE* stdoutFile, uint8_t type, const std::vector<uint8_t>& payload) {
  const uint32_t payloadLen = static_cast<uint32_t>(payload.size());
  if (!writeExact(stdoutFile, &type, 1)) return false;
  writeU32LE(stdoutFile, payloadLen);
  if (payloadLen > 0 && !writeExact(stdoutFile, payload.data(), payloadLen)) return false;
  std::fflush(stdoutFile);
  return true;
}

std::vector<uint8_t> encodeJsonPayload(const juce::var& payloadVar) {
  const auto json = juce::JSON::toString(payloadVar, true);
  const auto utf8 = json.toRawUTF8();
  std::vector<uint8_t> out;
  out.assign(reinterpret_cast<const uint8_t*>(utf8),
             reinterpret_cast<const uint8_t*>(utf8) + std::strlen(utf8));
  return out;
}

std::vector<uint8_t> encodeErrorPayload(const std::string& message) {
  auto* obj = new juce::DynamicObject();
  obj->setProperty("message", juce::String(message));
  return encodeJsonPayload(juce::var(obj));
}

std::vector<uint8_t> encodePingPayload(const std::string& pluginId, bool editorOpen) {
  auto* obj = new juce::DynamicObject();
  obj->setProperty("protocolVersion", static_cast<int>(BRIDGE_PROTOCOL_VERSION));
  obj->setProperty("pluginId", juce::String(pluginId));
  obj->setProperty("editorOpen", editorOpen);
  return encodeJsonPayload(juce::var(obj));
}

bool writeError(std::FILE* stdoutFile, const std::string& message) {
  const auto payload = encodeErrorPayload(message);
  return writeMessage(stdoutFile, MSG_ERROR, payload);
}

#if defined(_WIN32)

struct SharedMemoryView {
  HANDLE handle = nullptr;
  void* view = nullptr;
  ShmRingHeaderV1* header = nullptr;
  float* data = nullptr;
  size_t channels = 0;
  size_t capacityFrames = 0;

  void close() {
    if (view != nullptr) {
      UnmapViewOfFile(view);
      view = nullptr;
    }
    if (handle != nullptr) {
      CloseHandle(handle);
      handle = nullptr;
    }
    header = nullptr;
    data = nullptr;
    channels = 0;
    capacityFrames = 0;
  }

  ~SharedMemoryView() { close(); }

  SharedMemoryView() = default;
  SharedMemoryView(const SharedMemoryView&) = delete;
  SharedMemoryView& operator=(const SharedMemoryView&) = delete;
};

std::wstring widenUtf8(const std::string& input) {
  if (input.empty()) return std::wstring();
  const int needed = MultiByteToWideChar(CP_UTF8, 0, input.c_str(), -1, nullptr, 0);
  if (needed <= 0) return std::wstring();
  std::wstring out;
  out.resize(static_cast<size_t>(needed));
  MultiByteToWideChar(CP_UTF8, 0, input.c_str(), -1, out.data(), needed);
  return out;
}

bool openSharedMemory(const std::string& name, SharedMemoryView& out, std::string& errorOut) {
  out.close();

  const auto wide = widenUtf8(name);
  if (wide.empty()) {
    errorOut = "Failed to convert shared memory name to UTF-16";
    return false;
  }

  HANDLE handle = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, wide.c_str());
  if (handle == nullptr) {
    errorOut = "OpenFileMappingW failed";
    return false;
  }

  void* view = MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, 0);
  if (view == nullptr) {
    CloseHandle(handle);
    errorOut = "MapViewOfFile failed";
    return false;
  }

  auto* header = reinterpret_cast<ShmRingHeaderV1*>(view);
  if (std::memcmp(header->magic, SHM_RING_MAGIC, 8) != 0) {
    UnmapViewOfFile(view);
    CloseHandle(handle);
    errorOut = "Shared memory magic mismatch";
    return false;
  }

  if (header->version != SHM_RING_VERSION) {
    UnmapViewOfFile(view);
    CloseHandle(handle);
    errorOut = "Shared memory version mismatch";
    return false;
  }

  if (header->channels == 0 || header->capacityFrames == 0) {
    UnmapViewOfFile(view);
    CloseHandle(handle);
    errorOut = "Shared memory header invalid (channels/capacityFrames)";
    return false;
  }

  header->flags.fetch_or(SHM_FLAG_PEER_READY, std::memory_order_acq_rel);

  out.handle = handle;
  out.view = view;
  out.header = header;
  out.channels = static_cast<size_t>(header->channels);
  out.capacityFrames = static_cast<size_t>(header->capacityFrames);
  out.data = reinterpret_cast<float*>(reinterpret_cast<uint8_t*>(view) + sizeof(ShmRingHeaderV1));
  return true;
}

size_t ringTryWrite(SharedMemoryView& view, const float* samples, size_t frames) {
  if (view.header == nullptr || view.data == nullptr) return 0;
  const size_t channels = view.channels;
  const size_t capacity = view.capacityFrames;
  if (channels == 0 || capacity == 0) return 0;
  if (frames == 0) return 0;

  ShmRingHeaderV1* header = view.header;
  const uint64_t write = header->writeIndex.load(std::memory_order_relaxed);
  const uint64_t read = header->readIndex.load(std::memory_order_acquire);
  const size_t used = write >= read ? static_cast<size_t>(write - read) : 0;
  const size_t freeFrames = used >= capacity ? 0 : (capacity - used);
  const size_t framesToWrite = std::min(frames, freeFrames);
  if (framesToWrite == 0) return 0;

  const size_t startFrame = static_cast<size_t>(write % static_cast<uint64_t>(capacity));
  const size_t firstFrames = std::min(framesToWrite, capacity - startFrame);

  if (firstFrames > 0) {
    const size_t startSample = startFrame * channels;
    const size_t countSamples = firstFrames * channels;
    std::memcpy(view.data + startSample, samples, countSamples * sizeof(float));
  }

  const size_t remainingFrames = framesToWrite - firstFrames;
  if (remainingFrames > 0) {
    const size_t offsetSamples = firstFrames * channels;
    const size_t countSamples = remainingFrames * channels;
    std::memcpy(view.data, samples + offsetSamples, countSamples * sizeof(float));
  }

  header->writeIndex.store(write + static_cast<uint64_t>(framesToWrite), std::memory_order_release);
  return framesToWrite;
}

size_t ringTryRead(SharedMemoryView& view, float* outSamples, size_t maxFrames) {
  if (view.header == nullptr || view.data == nullptr) return 0;
  const size_t channels = view.channels;
  const size_t capacity = view.capacityFrames;
  if (channels == 0 || capacity == 0) return 0;
  if (maxFrames == 0) return 0;

  ShmRingHeaderV1* header = view.header;
  const uint64_t write = header->writeIndex.load(std::memory_order_acquire);
  const uint64_t read = header->readIndex.load(std::memory_order_relaxed);
  const size_t availableFrames = write >= read ? static_cast<size_t>(write - read) : 0;
  const size_t framesToRead = std::min(maxFrames, availableFrames);
  if (framesToRead == 0) return 0;

  const size_t startFrame = static_cast<size_t>(read % static_cast<uint64_t>(capacity));
  const size_t firstFrames = std::min(framesToRead, capacity - startFrame);

  if (firstFrames > 0) {
    const size_t startSample = startFrame * channels;
    const size_t countSamples = firstFrames * channels;
    std::memcpy(outSamples, view.data + startSample, countSamples * sizeof(float));
  }

  const size_t remainingFrames = framesToRead - firstFrames;
  if (remainingFrames > 0) {
    const size_t offsetSamples = firstFrames * channels;
    const size_t countSamples = remainingFrames * channels;
    std::memcpy(outSamples + offsetSamples, view.data, countSamples * sizeof(float));
  }

  header->readIndex.store(read + static_cast<uint64_t>(framesToRead), std::memory_order_release);
  return framesToRead;
}

struct ShmAudioArgs {
  std::string shmInName;
  std::string shmOutName;
  std::string mode;
};

class AudioShmBypass {
 public:
  AudioShmBypass() = default;
  AudioShmBypass(const AudioShmBypass&) = delete;
  AudioShmBypass& operator=(const AudioShmBypass&) = delete;

  ~AudioShmBypass() { stopAndJoin(); }

  bool start(const ShmAudioArgs& args, std::string& errorOut) {
    stopAndJoin();

    std::string err;
    if (!openSharedMemory(args.shmInName, inView_, err)) {
      errorOut = "Failed to open shm-in: " + err;
      return false;
    }
    if (!openSharedMemory(args.shmOutName, outView_, err)) {
      errorOut = "Failed to open shm-out: " + err;
      return false;
    }
    if (inView_.channels != outView_.channels) {
      errorOut = "Shared memory channels mismatch";
      return false;
    }

    stopFlag_.store(false, std::memory_order_release);
    worker_ = std::thread([this]() { this->runLoop(); });
    return true;
  }

  void setPluginState(bool loaded, bool processingActive, bool error) {
    const uint32_t clearMask = SHM_FLAG_PLUGIN_LOADED | SHM_FLAG_PROCESSING_ACTIVE | SHM_FLAG_PLUGIN_ERROR;
    uint32_t setMask = 0;
    if (loaded) setMask |= SHM_FLAG_PLUGIN_LOADED;
    if (processingActive) setMask |= SHM_FLAG_PROCESSING_ACTIVE;
    if (error) setMask |= SHM_FLAG_PLUGIN_ERROR;

    auto apply = [&](SharedMemoryView& view) {
      if (view.header == nullptr) return;
      view.header->flags.fetch_and(~clearMask, std::memory_order_acq_rel);
      view.header->flags.fetch_or(setMask, std::memory_order_acq_rel);
    };
    apply(inView_);
    apply(outView_);
  }

  void stopAndJoin() {
    stopFlag_.store(true, std::memory_order_release);
    if (worker_.joinable()) worker_.join();
    inView_.close();
    outView_.close();
  }

 private:
  void runLoop() {
    constexpr size_t kMaxFramesPerTick = 512;
    const size_t channels = inView_.channels;
    std::vector<float> buffer;
    buffer.resize(kMaxFramesPerTick * channels);

    while (!stopFlag_.load(std::memory_order_acquire)) {
      if (inView_.header) inView_.header->heartbeat.fetch_add(1, std::memory_order_relaxed);
      if (outView_.header) outView_.header->heartbeat.fetch_add(1, std::memory_order_relaxed);

      const size_t framesRead = ringTryRead(inView_, buffer.data(), kMaxFramesPerTick);
      if (framesRead == 0) {
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
        continue;
      }

      (void)ringTryWrite(outView_, buffer.data(), framesRead);
    }
  }

  SharedMemoryView inView_;
  SharedMemoryView outView_;
  std::atomic<bool> stopFlag_{false};
  std::thread worker_;
};

class AudioShmVstProcessor {
 public:
  AudioShmVstProcessor() = default;
  AudioShmVstProcessor(const AudioShmVstProcessor&) = delete;
  AudioShmVstProcessor& operator=(const AudioShmVstProcessor&) = delete;

  ~AudioShmVstProcessor() { stopAndJoin(); }

  bool start(const ShmAudioArgs& args,
             juce::AudioPluginInstance* instance,
             int channels,
             int blockSize,
             ParamUpdateQueue* paramQueue,
             std::string& errorOut) {
    stopAndJoin();

    if (instance == nullptr) {
      errorOut = "VST processor requires a plugin instance";
      return false;
    }

    std::string err;
    if (!openSharedMemory(args.shmInName, inView_, err)) {
      errorOut = "Failed to open shm-in: " + err;
      return false;
    }
    if (!openSharedMemory(args.shmOutName, outView_, err)) {
      errorOut = "Failed to open shm-out: " + err;
      return false;
    }
    if (inView_.channels != outView_.channels) {
      errorOut = "Shared memory channels mismatch";
      return false;
    }

    const int safeChannels = std::max(1, channels);
    if (static_cast<int>(inView_.channels) != safeChannels) {
      errorOut = "Shared memory channels do not match requested channels";
      return false;
    }

    instance_ = instance;
    paramQueue_ = paramQueue;
    channels_ = static_cast<size_t>(safeChannels);
    const size_t maxByShm = std::max<size_t>(1, std::min<size_t>(512, inView_.capacityFrames));
    const size_t maxByBlock = std::max<size_t>(1, std::min<size_t>(512, static_cast<size_t>(std::max(1, blockSize))));
    maxFramesPerTick_ = std::min(maxByShm, maxByBlock);
    fadeFramesTotal_ = 256;
    fadeFramesRemaining_ = fadeFramesTotal_;

    setPluginState(true, true, false);

    stopFlag_.store(false, std::memory_order_release);
    worker_ = std::thread([this]() { this->runLoop(); });
    return true;
  }

  void setPluginState(bool loaded, bool processingActive, bool error) {
    const uint32_t clearMask = SHM_FLAG_PLUGIN_LOADED | SHM_FLAG_PROCESSING_ACTIVE | SHM_FLAG_PLUGIN_ERROR;
    uint32_t setMask = 0;
    if (loaded) setMask |= SHM_FLAG_PLUGIN_LOADED;
    if (processingActive) setMask |= SHM_FLAG_PROCESSING_ACTIVE;
    if (error) setMask |= SHM_FLAG_PLUGIN_ERROR;

    auto apply = [&](SharedMemoryView& view) {
      if (view.header == nullptr) return;
      view.header->flags.fetch_and(~clearMask, std::memory_order_acq_rel);
      view.header->flags.fetch_or(setMask, std::memory_order_acq_rel);
    };
    apply(inView_);
    apply(outView_);
  }

  void stopAndJoin() {
    stopFlag_.store(true, std::memory_order_release);
    if (worker_.joinable()) worker_.join();
    inView_.close();
    outView_.close();
    instance_ = nullptr;
    paramQueue_ = nullptr;
    channels_ = 0;
    maxFramesPerTick_ = 0;
    fadeFramesTotal_ = 0;
    fadeFramesRemaining_ = 0;
  }

 private:
  void applyQueuedParams() {
    if (instance_ == nullptr || paramQueue_ == nullptr) return;

    ParamUpdate update;
    auto& params = instance_->getParameters();
    while (paramQueue_->pop(update)) {
      const int index = update.index;
      if (index < 0 || static_cast<size_t>(index) >= params.size()) continue;
      auto* param = params[static_cast<size_t>(index)];
      if (param == nullptr) continue;

      float normalized = update.normalized;
      if (!std::isfinite(normalized)) normalized = 0.0f;
      if (normalized < 0.0f) normalized = 0.0f;
      if (normalized > 1.0f) normalized = 1.0f;
      param->setValue(normalized);
    }
  }

  void runLoop() {
    if (instance_ == nullptr) return;

    const size_t channels = channels_;
    const size_t maxFrames = maxFramesPerTick_ > 0 ? maxFramesPerTick_ : 1;

    std::vector<float> interleaved;
    interleaved.resize(maxFrames * channels);
    std::vector<float> dryInterleaved;
    dryInterleaved.resize(maxFrames * channels);

    juce::AudioBuffer<float> buffer(static_cast<int>(channels), static_cast<int>(maxFrames));
    juce::MidiBuffer midi;

    while (!stopFlag_.load(std::memory_order_acquire)) {
      if (inView_.header) inView_.header->heartbeat.fetch_add(1, std::memory_order_relaxed);
      if (outView_.header) outView_.header->heartbeat.fetch_add(1, std::memory_order_relaxed);

      const size_t framesRead = ringTryRead(inView_, interleaved.data(), maxFrames);
      if (framesRead == 0) {
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
        continue;
      }

      std::memcpy(dryInterleaved.data(), interleaved.data(), framesRead * channels * sizeof(float));

      applyQueuedParams();

      buffer.setSize(static_cast<int>(channels), static_cast<int>(framesRead), false, false, true);
      for (size_t ch = 0; ch < channels; ch++) {
        float* dst = buffer.getWritePointer(static_cast<int>(ch));
        for (size_t frame = 0; frame < framesRead; frame++) {
          dst[frame] = interleaved[frame * channels + ch];
        }
      }

      midi.clear();
      instance_->processBlock(buffer, midi);

      for (size_t ch = 0; ch < channels; ch++) {
        const float* src = buffer.getReadPointer(static_cast<int>(ch));
        for (size_t frame = 0; frame < framesRead; frame++) {
          interleaved[frame * channels + ch] = src[frame];
        }
      }

      if (fadeFramesRemaining_ > 0 && fadeFramesTotal_ > 0) {
        const float total = static_cast<float>(fadeFramesTotal_);
        for (size_t frame = 0; frame < framesRead; frame++) {
          if (fadeFramesRemaining_ == 0) break;
          const float remaining = static_cast<float>(fadeFramesRemaining_);
          const float wet = 1.0f - (remaining / total);
          const float dry = 1.0f - wet;
          for (size_t ch = 0; ch < channels; ch++) {
            const size_t idx = frame * channels + ch;
            interleaved[idx] = dryInterleaved[idx] * dry + interleaved[idx] * wet;
          }
          fadeFramesRemaining_--;
        }
      }

      (void)ringTryWrite(outView_, interleaved.data(), framesRead);
    }
  }

  SharedMemoryView inView_;
  SharedMemoryView outView_;
  juce::AudioPluginInstance* instance_ = nullptr;
  ParamUpdateQueue* paramQueue_ = nullptr;
  size_t channels_ = 0;
  size_t maxFramesPerTick_ = 0;
  size_t fadeFramesTotal_ = 0;
  size_t fadeFramesRemaining_ = 0;
  std::atomic<bool> stopFlag_{false};
  std::thread worker_;
};

#else

struct ShmAudioArgs {
  std::string shmInName;
  std::string shmOutName;
  std::string mode;
};

class AudioShmBypass {
 public:
  bool start(const ShmAudioArgs&, std::string& errorOut) {
    errorOut = "Shared memory is only supported on Windows";
    return false;
  }
  void stopAndJoin() {}
};

class AudioShmVstProcessor {
 public:
  bool start(const ShmAudioArgs&,
             juce::AudioPluginInstance*,
             int,
             int,
             ParamUpdateQueue*,
             std::string& errorOut) {
    errorOut = "Shared memory is only supported on Windows";
    return false;
  }
  void stopAndJoin() {}
};

#endif

juce::var decodeJson(const std::vector<uint8_t>& payload) {
  const juce::String jsonText = juce::String::fromUTF8(reinterpret_cast<const char*>(payload.data()),
                                                       static_cast<int>(payload.size()));
  juce::var parsed;
  const auto result = juce::JSON::parse(jsonText, parsed);
  if (result.failed()) return {};
  return parsed;
}

std::optional<std::string> decodeStringField(const std::vector<uint8_t>& payload, const char* field) {
  const auto parsed = decodeJson(payload);
  auto* obj = parsed.getDynamicObject();
  if (obj == nullptr) return std::nullopt;
  const auto valueVar = obj->getProperty(field);
  if (!valueVar.isString()) return std::nullopt;
  const auto value = valueVar.toString();
  if (value.isEmpty()) return std::nullopt;
  return value.toStdString();
}

bool readMessage(std::FILE* stdinFile, uint8_t& typeOut, std::vector<uint8_t>& payloadOut) {
  uint8_t type = 0;
  if (!readExact(stdinFile, &type, 1)) return false;
  uint32_t payloadLen = 0;
  if (!readU32LE(stdinFile, payloadLen)) return false;

  payloadOut.clear();
  payloadOut.resize(payloadLen);
  if (payloadLen > 0 && !readExact(stdinFile, payloadOut.data(), payloadLen)) return false;
  typeOut = type;
  return true;
}

bool decodeAudioPayload(const std::vector<uint8_t>& payload, std::vector<float>& samplesOut) {
  if (payload.size() < 4) return false;
  uint32_t sampleCount = 0;
  sampleCount = static_cast<uint32_t>(payload[0]) | (static_cast<uint32_t>(payload[1]) << 8) |
                (static_cast<uint32_t>(payload[2]) << 16) | (static_cast<uint32_t>(payload[3]) << 24);
  const size_t expected = 4ull + static_cast<size_t>(sampleCount) * 4ull;
  if (payload.size() != expected) return false;

  samplesOut.resize(sampleCount);
  const uint8_t* cursor = payload.data() + 4;
  for (size_t idx = 0; idx < sampleCount; idx++) {
    float value = 0.0f;
    std::memcpy(&value, cursor, 4);
    samplesOut[idx] = value;
    cursor += 4;
  }
  return true;
}

std::vector<uint8_t> encodeAudioPayload(const std::vector<float>& samples) {
  const uint32_t sampleCount = static_cast<uint32_t>(samples.size());
  std::vector<uint8_t> out;
  out.resize(4ull + static_cast<size_t>(sampleCount) * 4ull);
  out[0] = static_cast<uint8_t>(sampleCount & 0xFFu);
  out[1] = static_cast<uint8_t>((sampleCount >> 8) & 0xFFu);
  out[2] = static_cast<uint8_t>((sampleCount >> 16) & 0xFFu);
  out[3] = static_cast<uint8_t>((sampleCount >> 24) & 0xFFu);
  uint8_t* cursor = out.data() + 4;
  for (uint32_t idx = 0; idx < sampleCount; idx++) {
    std::memcpy(cursor, &samples[idx], 4);
    cursor += 4;
  }
  return out;
}

float clampFinite(float value, float min, float max, float fallback) {
  if (!std::isfinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

float guessStep(float min, float max) {
  if (!std::isfinite(min) || !std::isfinite(max)) return 0.01f;
  const float range = std::abs(max - min);
  if (range <= 0.0f) return 0.01f;
  const float step = range / 500.0f;
  if (step < 0.0001f) return 0.0001f;
  if (step > 1.0f) return 1.0f;
  return step;
}

juce::var pluginDescriptorToVar(const PluginDescriptor& desc) {
  auto* obj = new juce::DynamicObject();
  obj->setProperty("id", juce::String(desc.id));
  obj->setProperty("name", juce::String(desc.name));
  if (desc.vendor.has_value()) obj->setProperty("vendor", juce::String(*desc.vendor));
  if (desc.version.has_value()) obj->setProperty("version", juce::String(*desc.version));
  if (desc.path.has_value()) obj->setProperty("path", juce::String(*desc.path));

  juce::Array<juce::var> params;
  for (const auto& param : desc.parameters) {
    auto* paramObj = new juce::DynamicObject();
    paramObj->setProperty("key", juce::String(param.key));
    paramObj->setProperty("title", juce::String(param.title));
    paramObj->setProperty("min", param.min);
    paramObj->setProperty("max", param.max);
    paramObj->setProperty("default", param.def);
    paramObj->setProperty("step", param.step);
    if (param.unit.has_value()) paramObj->setProperty("unit", juce::String(*param.unit));
    params.add(juce::var(paramObj));
  }
  obj->setProperty("parameters", juce::var(params));
  return juce::var(obj);
}

std::vector<juce::PluginDescription> scanVst3Plugins();
std::vector<juce::PluginDescription> scanVst3Plugins(const std::vector<std::string>& scanPaths);
std::vector<juce::PluginDescription> scanVst3Plugins(const std::vector<std::string>& scanPaths,
                                                     bool includeDefaultPaths);
std::optional<juce::PluginDescription> findVst3PluginById(const std::string& pluginId,
                                                          const std::vector<std::string>& scanPaths,
                                                          bool includeDefaultPaths);
std::optional<PluginDescriptor> buildDescriptorForPluginId(const std::string& pluginId,
                                                           const std::vector<std::string>& scanPaths,
                                                           bool includeDefaultPaths,
                                                           const std::optional<std::string>& pluginPath);

std::vector<uint8_t> encodeScanPluginsPayload() {
  juce::Array<juce::var> out;

  const auto types = scanVst3Plugins();
  std::unordered_set<std::string> seen;
  for (const auto& type : types) {
    if (type.isInstrument) continue;
    const auto id = type.createIdentifierString().toStdString();
    if (!seen.insert(id).second) continue;

    PluginDescriptor desc;
    desc.id = id;
    desc.name = type.name.toStdString();
    if (type.manufacturerName.isNotEmpty()) desc.vendor = type.manufacturerName.toStdString();
    if (type.version.isNotEmpty()) desc.version = type.version.toStdString();
    if (type.fileOrIdentifier.isNotEmpty()) desc.path = type.fileOrIdentifier.toStdString();
    // Avoid enumerating parameters here: loading each plugin is expensive and can hang/crash.
    out.add(pluginDescriptorToVar(desc));
  }

  return encodeJsonPayload(juce::var(out));
}

std::vector<uint8_t> encodeParamValuesPayload(const std::vector<std::pair<std::string, float>>& params) {
  auto* obj = new juce::DynamicObject();
  obj->setProperty("protocolVersion", static_cast<int>(BRIDGE_PROTOCOL_VERSION));

  juce::Array<juce::var> out;
  for (const auto& entry : params) {
    auto* item = new juce::DynamicObject();
    item->setProperty("key", juce::String(entry.first));
    item->setProperty("value", entry.second);
    out.add(juce::var(item));
  }
  obj->setProperty("params", juce::var(out));
  return encodeJsonPayload(juce::var(obj));
}

void writeJsonToStdout(const juce::var& jsonVar) {
  const auto json = juce::JSON::toString(jsonVar, true);
  std::fwrite(json.toRawUTF8(), 1, static_cast<size_t>(json.getNumBytesAsUTF8()), stdout);
  std::fwrite("\n", 1, 1, stdout);
  std::fflush(stdout);
}

struct Vst3ScanResult {
  juce::AudioPluginFormatManager formatManager;
  juce::KnownPluginList knownList;
  juce::VST3PluginFormat* format = nullptr;

  Vst3ScanResult() {
    format = new juce::VST3PluginFormat();
    formatManager.addFormat(format);
  }
};

std::vector<juce::PluginDescription> scanVst3Plugins() {
  static const std::vector<std::string> emptyPaths;
  return scanVst3Plugins(emptyPaths, true);
}

std::vector<juce::PluginDescription> scanVst3Plugins(const std::vector<std::string>& scanPaths) {
  return scanVst3Plugins(scanPaths, false);
}

std::vector<juce::PluginDescription> scanVst3Plugins(const std::vector<std::string>& scanPaths,
                                                     bool includeDefaultPaths) {
  Vst3ScanResult scan;
  juce::File deadMansPedalFile =
      juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
          .getChildFile("PixelMatrixPlayer")
          .getChildFile("vst3_scanner_deadman.txt");
  deadMansPedalFile.getParentDirectory().createDirectory();

  juce::FileSearchPath searchPaths = scan.format->getDefaultLocationsToSearch();
  if (!scanPaths.empty() && !includeDefaultPaths) {
    searchPaths = juce::FileSearchPath{};
  }

  if (!scanPaths.empty()) {
    std::unordered_set<std::string> seen;
    for (const auto& raw : scanPaths) {
      juce::String pathStr{raw};
      pathStr = pathStr.trim();
      if (pathStr.isEmpty()) continue;

      const juce::File dir{pathStr};
      if (!dir.exists()) continue;
      const auto full = dir.getFullPathName();
      const auto key = full.toLowerCase().toStdString();
      if (!seen.insert(key).second) continue;
      searchPaths.add(full);
    }

    if (searchPaths.getNumPaths() == 0) {
      searchPaths = scan.format->getDefaultLocationsToSearch();
    }
  }

  juce::PluginDirectoryScanner scanner(scan.knownList,
                                       *scan.format,
                                       searchPaths,
                                       true,
                                       deadMansPedalFile,
                                       true);

  juce::String pluginBeingScanned;
  while (scanner.scanNextFile(true, pluginBeingScanned)) {
    // keep scanning
  }

  std::vector<juce::PluginDescription> out;
  const auto types = scan.knownList.getTypes();
  out.reserve(static_cast<size_t>(types.size()));
  for (const auto& type : types) {
    out.push_back(type);
  }
  return out;
}

std::optional<juce::PluginDescription> findVst3PluginById(const std::string& pluginId) {
  static const std::vector<std::string> emptyPaths;
  return findVst3PluginById(pluginId, emptyPaths, true);
}

std::optional<juce::PluginDescription> findVst3PluginById(const std::string& pluginId,
                                                          const std::vector<std::string>& scanPaths) {
  return findVst3PluginById(pluginId, scanPaths, false);
}

std::optional<juce::PluginDescription> findVst3PluginById(const std::string& pluginId,
                                                          const std::vector<std::string>& scanPaths,
                                                          bool includeDefaultPaths) {
  const auto types = scanVst3Plugins(scanPaths, includeDefaultPaths);
  for (const auto& type : types) {
    const auto id = type.createIdentifierString();
    if (id.toStdString() == pluginId) {
      return type;
    }
  }
  return std::nullopt;
}

juce::String getVst3ScanIdHint() {
  // Help users understand what the bridge expects when passing ids around.
  return "Use the id returned by --list-plugins (JUCE PluginDescription identifier).";
}

std::optional<juce::PluginDescription> findVst3PluginInFile(Vst3ScanResult& scan,
                                                            const std::string& pluginId,
                                                            const std::string& pluginPath) {
  if (scan.format == nullptr) return std::nullopt;
  const juce::File pluginFile{juce::String(pluginPath)};
  if (!pluginFile.existsAsFile() && !pluginFile.isDirectory()) return std::nullopt;

  juce::OwnedArray<juce::PluginDescription> types;
  scan.format->findAllTypesForFile(types, pluginFile.getFullPathName());
  for (auto* type : types) {
    if (type == nullptr) continue;
    if (type->isInstrument) continue;
    const auto id = type->createIdentifierString().toStdString();
    if (id == pluginId) return *type;
  }
  return std::nullopt;
}

std::optional<PluginDescriptor> buildDescriptorForPluginId(const std::string& pluginId) {
  static const std::vector<std::string> emptyPaths;
  return buildDescriptorForPluginId(pluginId, emptyPaths, true, std::nullopt);
}

std::optional<PluginDescriptor> buildDescriptorForPluginId(const std::string& pluginId,
                                                           const std::vector<std::string>& scanPaths,
                                                           const std::optional<std::string>& pluginPath) {
  return buildDescriptorForPluginId(pluginId, scanPaths, false, pluginPath);
}

std::optional<PluginDescriptor> buildDescriptorForPluginId(const std::string& pluginId,
                                                           const std::vector<std::string>& scanPaths,
                                                           bool includeDefaultPaths,
                                                           const std::optional<std::string>& pluginPath) {
  std::optional<juce::PluginDescription> typeOpt;

  Vst3ScanResult scan;
  if (pluginPath.has_value() && !pluginPath->empty()) {
    typeOpt = findVst3PluginInFile(scan, pluginId, *pluginPath);
  }
  if (!typeOpt.has_value()) {
    typeOpt = findVst3PluginById(pluginId, scanPaths, includeDefaultPaths);
  }
  if (!typeOpt.has_value()) return std::nullopt;

  const auto& type = *typeOpt;
  if (type.isInstrument) return std::nullopt;

  juce::String error;
  auto instance = scan.formatManager.createPluginInstance(type, 48'000.0, 512, error);
  if (!instance) return std::nullopt;

  PluginDescriptor desc;
  desc.id = pluginId;
  desc.name = type.name.toStdString();
  if (type.manufacturerName.isNotEmpty()) desc.vendor = type.manufacturerName.toStdString();
  if (type.version.isNotEmpty()) desc.version = type.version.toStdString();
  if (type.fileOrIdentifier.isNotEmpty()) desc.path = type.fileOrIdentifier.toStdString();

  const auto& params = instance->getParameters();
  const int maxParams = std::min<int>(static_cast<int>(params.size()), 256);
  desc.parameters.reserve(static_cast<size_t>(maxParams));
  for (int idx = 0; idx < maxParams; idx++) {
    auto* param = params[static_cast<size_t>(idx)];
    if (param == nullptr) continue;

    ParamDescriptor out;
    out.key = std::to_string(idx);
    out.title = param->getName(128).toStdString();
    const auto label = param->getLabel().toStdString();
    if (!label.empty()) out.unit = label;

    const int steps = param->getNumSteps();
    const auto stepFromSteps = [&]() -> float {
      if (steps > 1 && steps <= 2048 && std::isfinite(out.min) && std::isfinite(out.max)) {
        const float denom = static_cast<float>(steps - 1);
        const float raw = (out.max - out.min) / denom;
        if (raw > 0.0f && std::isfinite(raw)) return raw;
      }
      return guessStep(out.min, out.max);
    };

    if (auto* ranged = dynamic_cast<juce::RangedAudioParameter*>(param)) {
      const auto range = ranged->getNormalisableRange();
      out.min = range.start;
      out.max = range.end;
      out.def = range.convertFrom0to1(ranged->getDefaultValue());
      const float interval = range.interval;
      if (interval > 0.0001f && std::isfinite(interval)) {
        out.step = interval;
      } else {
        out.step = stepFromSteps();
      }
    } else {
      out.min = 0.0f;
      out.max = 1.0f;
      out.def = param->getDefaultValue();
      out.step = stepFromSteps();
    }

    desc.parameters.push_back(std::move(out));
  }

  return desc;
}

class PluginEditorWindow : public juce::DocumentWindow {
 public:
  PluginEditorWindow(const juce::String& title,
                     std::unique_ptr<juce::Component> content,
                     uint64_t ownerHwnd,
                     bool pinned,
                     std::function<void()> onRequestDestroy)
      : DocumentWindow(title,
                       juce::Colours::darkgrey,
                       juce::DocumentWindow::closeButton | juce::DocumentWindow::minimiseButton),
        ownerHwnd_(ownerHwnd),
        pinned_(pinned),
        onRequestDestroy_(std::move(onRequestDestroy)) {
    setUsingNativeTitleBar(false);
    setResizable(false, false);
    setContentOwned(content.release(), true);

    pinButton_.setButtonText("Pin");
    pinButton_.setClickingTogglesState(true);
    pinButton_.setToggleState(pinned_, juce::dontSendNotification);
    pinButton_.onClick = [this]() { setPinned(pinButton_.getToggleState()); };
    addAndMakeVisible(pinButton_);

    const int width = std::max(320, getContentComponent()->getWidth());
    const int height = std::max(240, getContentComponent()->getHeight());
    centreWithSize(width, height);

    // Create the native peer while hidden so we can apply Win32 styles/owner before the first
    // show(), avoiding a transient taskbar icon flash on open.
    setVisible(false);
    if (!isOnDesktop()) {
      addToDesktop(getDesktopWindowStyleFlags());
    }
    applyWin32Style();
    setVisible(true);
  }

  int getDesktopWindowStyleFlags() const override {
    int styleFlags = juce::DocumentWindow::getDesktopWindowStyleFlags();
    styleFlags |= juce::ComponentPeer::windowIsTemporary;
    styleFlags &= ~juce::ComponentPeer::windowAppearsOnTaskbar;
    return styleFlags;
  }

  void closeButtonPressed() override {
    if (!onRequestDestroy_) {
      setVisible(false);
      return;
    }

    auto callback = onRequestDestroy_;
    juce::MessageManager::callAsync([callback]() mutable { callback(); });
  }

  void minimiseButtonPressed() override { setVisible(false); }

  void resized() override {
    juce::DocumentWindow::resized();

    const int margin = 6;
    const int buttonWidth = 48;
    const int buttonHeight = 20;
    pinButton_.setBounds(margin, margin, buttonWidth, buttonHeight);
  }

  void setPinned(bool pinned) {
    pinned_ = pinned;
    applyWin32Style();
    bringToFront(false);
  }

  void setOwnerHwnd(uint64_t ownerHwnd) {
    if (ownerHwnd == 0) return;
    ownerHwnd_ = ownerHwnd;
    applyWin32Style();
  }

  void bringToFront(bool activate) {
#if defined(_WIN32)
    if (auto* peer = getPeer()) {
      HWND hwnd = (HWND)peer->getNativeHandle();
      if (hwnd != nullptr) {
        const UINT baseFlags = SWP_NOMOVE | SWP_NOSIZE;
        if (activate) {
          SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, baseFlags);
          SetForegroundWindow(hwnd);
          SetActiveWindow(hwnd);
        } else {
          const UINT noActivateFlags = baseFlags | SWP_NOACTIVATE;
          SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, noActivateFlags);
          // Topmost toggle trick: ensures the window is raised above other normal windows
          // without permanently becoming "always on top".
          SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, noActivateFlags);
          SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, noActivateFlags);
        }
      }
    }
#endif

    toFront(activate);
  }

  void replaceContent(std::unique_ptr<juce::Component> content) {
    if (!content) return;
    setContentOwned(content.release(), true);
    const int width = std::max(320, getContentComponent()->getWidth());
    const int height = std::max(240, getContentComponent()->getHeight());
    centreWithSize(width, height);
    resized();
  }

 private:
  void applyWin32Style() {
#if defined(_WIN32)
    auto* peer = getPeer();
    if (peer == nullptr) {
      juce::Component::SafePointer<PluginEditorWindow> safeThis(this);
      juce::MessageManager::callAsync([safeThis]() mutable {
        if (safeThis != nullptr) safeThis->applyWin32Style();
      });
      return;
    }

    HWND hwnd = (HWND)peer->getNativeHandle();
    if (hwnd == nullptr) return;

    LONG_PTR exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
    exStyle |= static_cast<LONG_PTR>(WS_EX_TOOLWINDOW);
    exStyle &= ~static_cast<LONG_PTR>(WS_EX_APPWINDOW);
    SetWindowLongPtr(hwnd, GWL_EXSTYLE, exStyle);

    const LONG_PTR owner =
        (pinned_ && ownerHwnd_ != 0) ? static_cast<LONG_PTR>(ownerHwnd_) : static_cast<LONG_PTR>(0);
    SetWindowLongPtr(hwnd, GWLP_HWNDPARENT, owner);

    SetWindowPos(hwnd,
                 nullptr,
                 0,
                 0,
                 0,
                 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
#endif
  }

  uint64_t ownerHwnd_ = 0;
  bool pinned_ = true;
  juce::TextButton pinButton_;
  std::function<void()> onRequestDestroy_;
};

class PlaceholderEditorContent : public juce::Component {
 public:
  explicit PlaceholderEditorContent(const juce::String& message) {
    label_.setText(message, juce::dontSendNotification);
    label_.setJustificationType(juce::Justification::centred);
    label_.setColour(juce::Label::textColourId, juce::Colours::white);
    addAndMakeVisible(label_);
    setSize(480, 260);
  }

  void resized() override { label_.setBounds(getLocalBounds().reduced(16)); }

 private:
  juce::Label label_;
};

struct LivePluginHost {
  std::mutex instanceMutex;
  std::unique_ptr<juce::AudioPluginInstance> instance;
  double sampleRate = 48'000.0;
  int channels = 2;
  int blockSize = 512;

  std::mutex editorMutex;
  std::unique_ptr<PluginEditorWindow> editorWindow;
  bool editorIsPlaceholder = false;
  std::optional<std::string> lastEditorTitle;
  std::optional<uint64_t> lastEditorOwnerHwnd;
  bool lastEditorPinned = true;
  bool hasEditorRequest = false;
};

bool applyParamSet(LivePluginHost& host, const std::vector<uint8_t>& payload, ParamUpdateQueue* realtimeQueue) {
  juce::AudioPluginInstance* instance = nullptr;
  {
    std::lock_guard<std::mutex> guard(host.instanceMutex);
    instance = host.instance.get();
  }
  if (instance == nullptr) return false;

  const auto parsed = decodeJson(payload);
  if (parsed.isVoid()) return false;
  auto* obj = parsed.getDynamicObject();
  if (obj == nullptr) return false;
  const auto paramsVar = obj->getProperty("params");
  auto* paramsArr = paramsVar.getArray();
  if (paramsArr == nullptr) return true;

  const auto& params = instance->getParameters();
  for (const auto& entry : *paramsArr) {
    auto* entryObj = entry.getDynamicObject();
    if (entryObj == nullptr) continue;

    const auto key = entryObj->getProperty("key").toString();
    const auto valueVar = entryObj->getProperty("value");
    const float value = static_cast<float>(static_cast<double>(valueVar));

    const int index = key.getIntValue();
    if (index < 0 || static_cast<size_t>(index) >= params.size()) continue;
    auto* param = params[static_cast<size_t>(index)];
    if (param == nullptr) continue;

    float normalized = value;
    if (auto* ranged = dynamic_cast<juce::RangedAudioParameter*>(param)) {
      const auto range = ranged->getNormalisableRange();
      const float actual =
          clampFinite(value, range.start, range.end, range.convertFrom0to1(ranged->getDefaultValue()));
      normalized = range.convertTo0to1(actual);
    } else {
      normalized = clampFinite(value, 0.0f, 1.0f, param->getDefaultValue());
    }

    if (realtimeQueue != nullptr) {
      realtimeQueue->push(index, normalized);
      continue;
    }

    param->beginChangeGesture();
    param->setValueNotifyingHost(normalized);
    param->endChangeGesture();
  }
  return true;
}

struct OpenEditorRequest {
  std::optional<std::string> title;
  std::optional<uint64_t> ownerHwnd;
  bool pinned = true;
  bool bringOnly = false;
  bool show = true;
  bool activate = true;
};

OpenEditorRequest decodeOpenEditorRequest(const std::vector<uint8_t>& payload) {
  OpenEditorRequest out;
  const auto parsed = decodeJson(payload);
  if (parsed.isVoid()) return out;
  auto* obj = parsed.getDynamicObject();
  if (obj == nullptr) return out;
  const auto titleVar = obj->getProperty("title");
  if (titleVar.isString()) {
    const auto title = titleVar.toString();
    if (title.isNotEmpty()) out.title = title.toStdString();
  }

  const auto ownerVar = obj->getProperty("ownerHwnd");
  if (ownerVar.isString()) {
    const auto raw = ownerVar.toString().toStdString();
    try {
      const uint64_t value = std::stoull(raw);
      if (value != 0) out.ownerHwnd = value;
    } catch (...) {
      // ignore
    }
  } else if (ownerVar.isInt() || ownerVar.isDouble()) {
    const auto value = static_cast<uint64_t>(static_cast<double>(ownerVar));
    if (value != 0) out.ownerHwnd = value;
  }

  const auto pinnedVar = obj->getProperty("pinned");
  if (pinnedVar.isBool()) {
    out.pinned = static_cast<bool>(pinnedVar);
  }

  const auto bringOnlyVar = obj->getProperty("bringOnly");
  if (bringOnlyVar.isBool()) {
    out.bringOnly = static_cast<bool>(bringOnlyVar);
  }

  const auto showVar = obj->getProperty("show");
  if (showVar.isBool()) {
    out.show = static_cast<bool>(showVar);
  }

  const auto activateVar = obj->getProperty("activate");
  if (activateVar.isBool()) {
    out.activate = static_cast<bool>(activateVar);
  }
  return out;
}

std::optional<std::string> openEditor(
    LivePluginHost& host,
    const OpenEditorRequest& request,
    const std::optional<std::string>& placeholderError) {
  auto promise = std::make_shared<std::promise<std::optional<std::string>>>();
  auto future = promise->get_future();

  juce::MessageManager::callAsync([&host,
                                   reqTitle = request.title,
                                   reqOwnerHwnd = request.ownerHwnd,
                                   reqPinned = request.pinned,
                                   reqBringOnly = request.bringOnly,
                                   reqShow = request.show,
                                   reqActivate = request.activate,
                                   reqPlaceholderError = placeholderError,
                                   promise]() mutable {
    std::lock_guard<std::mutex> guard(host.editorMutex);

    host.lastEditorTitle = reqTitle;
    host.lastEditorOwnerHwnd = reqOwnerHwnd;
    host.lastEditorPinned = reqPinned;
    host.hasEditorRequest = true;

    if (host.editorWindow) {
      const uint64_t ownerHwnd = reqOwnerHwnd.value_or(0);
      if (ownerHwnd != 0) {
        host.editorWindow->setOwnerHwnd(ownerHwnd);
      }
      host.editorWindow->setPinned(reqPinned);
      if (reqShow) {
        host.editorWindow->setVisible(true);
      }
      if (host.editorWindow->isVisible()) {
        host.editorWindow->bringToFront(reqActivate);
      }
      promise->set_value(std::nullopt);
      return;
    }

    if (reqBringOnly) {
      promise->set_value(std::nullopt);
      return;
    }

    juce::AudioPluginInstance* instance = nullptr;
    {
      std::lock_guard<std::mutex> instanceGuard(host.instanceMutex);
      instance = host.instance.get();
    }

    const juce::String title =
        reqTitle.has_value() ? juce::String(*reqTitle) : juce::String("VST3 Editor");
    const uint64_t ownerHwnd = reqOwnerHwnd.value_or(0);
    const bool pinned = reqPinned;

    if (instance == nullptr) {
      const juce::String message = reqPlaceholderError.has_value()
                                       ? juce::String("Plugin failed to load:\n") +
                                             juce::String(*reqPlaceholderError)
                                       : juce::String("Loading plugin...");
      host.editorWindow = std::make_unique<PluginEditorWindow>(
          title,
          std::make_unique<PlaceholderEditorContent>(message),
          ownerHwnd,
          pinned,
          [&host]() {
            std::lock_guard<std::mutex> guard(host.editorMutex);
            if (host.editorWindow) {
              host.editorWindow->setVisible(false);
              host.editorWindow.reset();
            }
          });
      host.editorIsPlaceholder = true;
      host.editorWindow->bringToFront(reqActivate);
      promise->set_value(std::nullopt);
      return;
    }

    if (!instance->hasEditor()) {
      promise->set_value(std::string("Plugin does not provide a native editor UI"));
      return;
    }

    std::unique_ptr<juce::AudioProcessorEditor> editor(instance->createEditorIfNeeded());
    if (!editor) {
      promise->set_value(std::string("Failed to create plugin editor UI"));
      return;
    }

    host.editorWindow = std::make_unique<PluginEditorWindow>(
        title,
        std::move(editor),
        ownerHwnd,
        pinned,
        [&host]() {
          std::lock_guard<std::mutex> guard(host.editorMutex);
          if (host.editorWindow) {
            host.editorWindow->setVisible(false);
             host.editorWindow.reset();
           }
         });
    host.editorIsPlaceholder = false;
    host.editorWindow->bringToFront(reqActivate);
    promise->set_value(std::nullopt);
  });

  const auto result = future.get();
  return result;
}

std::optional<std::string> closeEditor(LivePluginHost& host) {
  auto promise = std::make_shared<std::promise<std::optional<std::string>>>();
  auto future = promise->get_future();

  juce::MessageManager::callAsync([&host, promise]() mutable {
    std::lock_guard<std::mutex> guard(host.editorMutex);
    if (host.editorWindow) {
      host.editorWindow->setVisible(false);
      host.editorWindow.reset();
    }
    host.editorIsPlaceholder = false;
    promise->set_value(std::nullopt);
  });

  const auto result = future.get();
  return result;
}

std::vector<std::pair<std::string, float>> collectCurrentParams(LivePluginHost& host) {
  std::vector<std::pair<std::string, float>> out;

  juce::AudioPluginInstance* instance = nullptr;
  {
    std::lock_guard<std::mutex> guard(host.instanceMutex);
    instance = host.instance.get();
  }
  if (instance == nullptr) return out;

  const auto& params = instance->getParameters();
  const int maxParams = std::min<int>(static_cast<int>(params.size()), 256);
  out.reserve(static_cast<size_t>(maxParams));
  for (int idx = 0; idx < maxParams; idx++) {
    auto* param = params[static_cast<size_t>(idx)];
    if (param == nullptr) continue;

    float actual = param->getValue();
    if (auto* ranged = dynamic_cast<juce::RangedAudioParameter*>(param)) {
      const auto range = ranged->getNormalisableRange();
      actual = range.convertFrom0to1(param->getValue());
    }

    out.emplace_back(std::to_string(idx), actual);
  }

  return out;
}

struct PluginInstanceLoadResult {
  std::unique_ptr<juce::AudioPluginInstance> instance;
  std::optional<std::string> error;
};

PluginInstanceLoadResult loadPluginInstance(Vst3ScanResult& scan,
                                            const std::string& pluginId,
                                            const std::string& pluginPath,
                                            double sampleRate,
                                            int blockSize) {
  const auto typeOpt = findVst3PluginInFile(scan, pluginId, pluginPath);
  if (!typeOpt.has_value()) {
    return PluginInstanceLoadResult{
        nullptr,
        std::string("VST3 plugin not found in cached path: ") + pluginPath,
    };
  }
  const auto& type = *typeOpt;
  if (type.isInstrument) {
    return PluginInstanceLoadResult{
        nullptr,
        std::string("Unsupported plugin type: Instrument (effects only)"),
    };
  }

  juce::String error;
  auto instance = scan.formatManager.createPluginInstance(type, sampleRate, blockSize, error);
  if (!instance) {
    return PluginInstanceLoadResult{
        nullptr,
        std::string("Failed to load VST3 plugin: ") + error.toStdString(),
    };
  }
  instance->prepareToPlay(sampleRate, blockSize);
  return PluginInstanceLoadResult{std::move(instance), std::nullopt};
}

enum class SessionLoadState : int {
  Loading = 0,
  Ready = 1,
  Error = 2,
};

struct ReadyBeforeLoadSession {
  LivePluginHost host;
  ParamUpdateQueue realtimeParamQueue;

  std::mutex pendingParamsMutex;
  std::vector<uint8_t> pendingParamsPayload;
  bool hasPendingParams = false;

  std::mutex shmMutex;
  std::unique_ptr<AudioShmBypass> shmBypass;
  std::unique_ptr<AudioShmVstProcessor> shmVst;
  std::atomic<bool> shmProcessingActive{false};

  std::atomic<int> loadState{static_cast<int>(SessionLoadState::Loading)};
  std::mutex loadErrorMutex;
  std::string loadError;

  std::atomic<bool> disposed{false};
  std::optional<ShmAudioArgs> shmArgs;

  std::string pluginId;
  std::string pluginPath;
};

int runVst3Plugin(const std::string& pluginId,
                  const std::string& pluginPath,
                  uint32_t sampleRate,
                  int channels,
                  const std::optional<ShmAudioArgs>& shmArgs) {
  std::FILE* stdinFile = stdin;
  std::FILE* stdoutFile = stdout;

  const int safeChannels = std::max(1, channels);
  const int blockSize = std::max(1, 8192 / safeChannels);
  const double safeSampleRate = static_cast<double>(sampleRate > 0 ? sampleRate : 48'000u);

  auto session = std::make_shared<ReadyBeforeLoadSession>();
  session->pluginId = pluginId;
  session->pluginPath = pluginPath;
  session->shmArgs = shmArgs;
  session->host.sampleRate = safeSampleRate;
  session->host.channels = safeChannels;
  session->host.blockSize = blockSize;

  if (session->shmArgs.has_value()) {
    std::string err;
    auto bypass = std::make_unique<AudioShmBypass>();
    if (!bypass->start(*session->shmArgs, err)) {
      std::fprintf(stderr, "%s\n", err.c_str());
      return 2;
    }
    std::lock_guard<std::mutex> guard(session->shmMutex);
    session->shmBypass = std::move(bypass);
  }

  std::thread([session]() {
    if (session->disposed.load(std::memory_order_acquire)) {
      return;
    }

    Vst3ScanResult scan;
    auto result = loadPluginInstance(
        scan, session->pluginId, session->pluginPath, session->host.sampleRate, session->host.blockSize);

    if (session->disposed.load(std::memory_order_acquire)) {
      return;
    }

    if (result.error.has_value() || !result.instance) {
      const std::string message = result.error.value_or("Failed to load VST3 plugin");
      std::fprintf(stderr,
                   "Failed to load VST3 plugin: %s\npath=%s\n%s\n%s\n",
                   session->pluginId.c_str(),
                   session->pluginPath.c_str(),
                   message.c_str(),
                   getVst3ScanIdHint().toRawUTF8());
      {
        std::lock_guard<std::mutex> guard(session->loadErrorMutex);
        session->loadError = message;
      }
      session->loadState.store(static_cast<int>(SessionLoadState::Error), std::memory_order_release);

      {
        std::lock_guard<std::mutex> guard(session->shmMutex);
        if (session->shmBypass) {
          session->shmBypass->setPluginState(false, false, true);
        }
        if (session->shmVst) {
          session->shmVst->setPluginState(false, false, true);
        }
      }

      juce::MessageManager::callAsync([session, message]() mutable {
        std::lock_guard<std::mutex> guard(session->host.editorMutex);
        if (!session->host.editorWindow || !session->host.editorIsPlaceholder) return;
        session->host.editorWindow->replaceContent(std::make_unique<PlaceholderEditorContent>(
            juce::String("Plugin failed to load:\n") + juce::String(message)));
        session->host.editorIsPlaceholder = true;
      });
      return;
    }

    {
      std::lock_guard<std::mutex> guard(session->host.instanceMutex);
      session->host.instance = std::move(result.instance);
    }

    std::vector<uint8_t> pending;
    bool hasPending = false;
    {
      std::lock_guard<std::mutex> guard(session->pendingParamsMutex);
      hasPending = session->hasPendingParams;
      if (hasPending) {
        pending = session->pendingParamsPayload;
        session->pendingParamsPayload.clear();
        session->hasPendingParams = false;
      }
    }
    if (hasPending && !session->disposed.load(std::memory_order_acquire)) {
      (void)applyParamSet(session->host, pending, nullptr);
    }

    {
      std::lock_guard<std::mutex> guard(session->shmMutex);
      if (session->shmBypass) {
        session->shmBypass->setPluginState(true, false, false);
      }
    }

    if (session->shmArgs.has_value() && session->shmArgs->mode == "process" &&
        !session->disposed.load(std::memory_order_acquire)) {
      std::unique_ptr<AudioShmBypass> bypassToStop;
      {
        std::lock_guard<std::mutex> guard(session->shmMutex);
        bypassToStop = std::move(session->shmBypass);
      }
      if (bypassToStop) {
        bypassToStop->stopAndJoin();
      }

      juce::AudioPluginInstance* instance = nullptr;
      {
        std::lock_guard<std::mutex> guard(session->host.instanceMutex);
        instance = session->host.instance.get();
      }

      if (instance != nullptr) {
        std::string err;
        auto processor = std::make_unique<AudioShmVstProcessor>();
        if (processor->start(*session->shmArgs,
                             instance,
                             session->host.channels,
                             session->host.blockSize,
                             &session->realtimeParamQueue,
                             err)) {
          std::lock_guard<std::mutex> guard(session->shmMutex);
          session->shmVst = std::move(processor);
          session->shmProcessingActive.store(true, std::memory_order_release);
        } else {
          std::fprintf(stderr, "%s\n", err.c_str());
          session->shmProcessingActive.store(false, std::memory_order_release);

          if (!session->disposed.load(std::memory_order_acquire)) {
            std::string bypassErr;
            auto fallbackBypass = std::make_unique<AudioShmBypass>();
            if (fallbackBypass->start(*session->shmArgs, bypassErr)) {
              fallbackBypass->setPluginState(true, false, false);
              std::lock_guard<std::mutex> guard(session->shmMutex);
              session->shmBypass = std::move(fallbackBypass);
            } else {
              std::fprintf(stderr, "%s\n", bypassErr.c_str());
            }
          }
        }
      }
    }

    session->loadState.store(static_cast<int>(SessionLoadState::Ready), std::memory_order_release);

    juce::MessageManager::callAsync([session]() mutable {
      std::lock_guard<std::mutex> guard(session->host.editorMutex);
      if (!session->host.editorWindow || !session->host.editorIsPlaceholder) return;

      juce::AudioPluginInstance* instance = nullptr;
      {
        std::lock_guard<std::mutex> instanceGuard(session->host.instanceMutex);
        instance = session->host.instance.get();
      }
      if (instance == nullptr) return;

      if (!instance->hasEditor()) {
        session->host.editorWindow->replaceContent(
            std::make_unique<PlaceholderEditorContent>("Plugin does not provide a native editor UI"));
        session->host.editorIsPlaceholder = true;
        return;
      }

      std::unique_ptr<juce::AudioProcessorEditor> editor(instance->createEditorIfNeeded());
      if (!editor) {
        session->host.editorWindow->replaceContent(
            std::make_unique<PlaceholderEditorContent>("Failed to create plugin editor UI"));
        session->host.editorIsPlaceholder = true;
        return;
      }

      session->host.editorWindow->replaceContent(std::move(editor));
      session->host.editorIsPlaceholder = false;
    });
  }).detach();

  std::vector<uint8_t> payload;
  std::vector<float> interleaved;
  juce::AudioBuffer<float> buffer(safeChannels, blockSize);
  juce::MidiBuffer midi;

  while (true) {
    uint8_t typeByte = 0;
    if (!readMessage(stdinFile, typeByte, payload)) break;

    switch (typeByte) {
      case MSG_SET_PARAMS: {
        bool hasInstance = false;
        {
          std::lock_guard<std::mutex> guard(session->host.instanceMutex);
          hasInstance = session->host.instance != nullptr;
        }
        if (!hasInstance) {
          std::lock_guard<std::mutex> guard(session->pendingParamsMutex);
          session->pendingParamsPayload = payload;
          session->hasPendingParams = true;
          writeMessage(stdoutFile, MSG_SET_PARAMS, {});
          break;
        }

        ParamUpdateQueue* queue =
            session->shmProcessingActive.load(std::memory_order_acquire) ? &session->realtimeParamQueue : nullptr;
        if (!applyParamSet(session->host, payload, queue)) {
          writeError(stdoutFile, "Bad params payload");
        } else {
          writeMessage(stdoutFile, MSG_SET_PARAMS, {});
        }
        break;
      }
      case MSG_PROCESS_AUDIO: {
        if (!decodeAudioPayload(payload, interleaved)) {
          writeError(stdoutFile, "Bad audio payload");
          return 2;
        }
        juce::AudioPluginInstance* instance = nullptr;
        {
          std::lock_guard<std::mutex> guard(session->host.instanceMutex);
          instance = session->host.instance.get();
        }
        const int totalSamples = static_cast<int>(interleaved.size());
        if (totalSamples % safeChannels != 0) {
          writeError(stdoutFile, "Interleaved audio length is not divisible by channels");
          return 2;
        }
        const int frames = totalSamples / safeChannels;
        if (frames <= 0) {
          writeMessage(stdoutFile, MSG_PROCESS_AUDIO, encodeAudioPayload(interleaved));
          break;
        }

        buffer.setSize(safeChannels, frames, false, false, true);
        for (int ch = 0; ch < safeChannels; ch++) {
          auto* writePtr = buffer.getWritePointer(ch);
          for (int frame = 0; frame < frames; frame++) {
            writePtr[frame] = interleaved[static_cast<size_t>(frame * safeChannels + ch)];
          }
        }

        midi.clear();
        if (instance != nullptr) {
          instance->processBlock(buffer, midi);
        }

        for (int frame = 0; frame < frames; frame++) {
          const int base = frame * safeChannels;
          for (int ch = 0; ch < safeChannels; ch++) {
            interleaved[static_cast<size_t>(base + ch)] = buffer.getSample(ch, frame);
          }
        }

        const auto out = encodeAudioPayload(interleaved);
        writeMessage(stdoutFile, MSG_PROCESS_AUDIO, out);
        break;
      }
      case MSG_OPEN_EDITOR: {
        const auto request = decodeOpenEditorRequest(payload);
        std::optional<std::string> placeholderError;
        if (session->loadState.load(std::memory_order_acquire) == static_cast<int>(SessionLoadState::Error)) {
          std::lock_guard<std::mutex> guard(session->loadErrorMutex);
          if (!session->loadError.empty()) {
            placeholderError = session->loadError;
          } else {
            placeholderError = std::string("Failed to load plugin");
          }
        }
        const auto err = openEditor(session->host, request, placeholderError);
        if (err.has_value()) {
          writeError(stdoutFile, *err);
        } else {
          writeMessage(stdoutFile, MSG_OPEN_EDITOR, {});
        }
        break;
      }
      case MSG_CLOSE_EDITOR: {
        const auto err = closeEditor(session->host);
        if (err.has_value()) {
          writeError(stdoutFile, *err);
        } else {
          writeMessage(stdoutFile, MSG_CLOSE_EDITOR, {});
        }
        break;
      }
      case MSG_PING: {
        bool editorOpen = false;
        {
          std::lock_guard<std::mutex> guard(session->host.editorMutex);
          editorOpen = session->host.editorWindow != nullptr;
        }
        writeMessage(stdoutFile, MSG_PING, encodePingPayload(session->pluginId, editorOpen));
        break;
      }
      case MSG_SCAN_PLUGINS: {
        writeMessage(stdoutFile, MSG_SCAN_PLUGINS, encodeScanPluginsPayload());
        break;
      }
      case MSG_DESCRIBE_PLUGIN: {
        const auto requestId = decodeStringField(payload, "pluginId");
        if (!requestId.has_value()) {
          writeError(stdoutFile, "Missing pluginId");
          break;
        }
        const auto descriptor = buildDescriptorForPluginId(*requestId);
        if (!descriptor.has_value()) {
          writeError(stdoutFile, "Failed to describe plugin");
          break;
        }
        writeMessage(stdoutFile, MSG_DESCRIBE_PLUGIN, encodeJsonPayload(pluginDescriptorToVar(*descriptor)));
        break;
      }
      case MSG_GET_PARAMS: {
        const auto params = collectCurrentParams(session->host);
        writeMessage(stdoutFile, MSG_GET_PARAMS, encodeParamValuesPayload(params));
        break;
      }
      case MSG_INSTANTIATE: {
        const auto requested = decodeStringField(payload, "pluginId");
        if (!requested.has_value()) {
          writeError(stdoutFile, "Missing pluginId");
          break;
        }

        if (*requested != session->pluginId) {
          writeError(stdoutFile, "Plugin replace is not supported: restart bridge required");
          break;
        }

        bool editorOpen = false;
        {
          std::lock_guard<std::mutex> guard(session->host.editorMutex);
          editorOpen = session->host.editorWindow != nullptr;
        }
        writeMessage(stdoutFile, MSG_INSTANTIATE, encodePingPayload(session->pluginId, editorOpen));
        break;
      }
      case MSG_DISPOSE: {
        session->disposed.store(true, std::memory_order_release);
        closeEditor(session->host);
        {
          std::lock_guard<std::mutex> guard(session->shmMutex);
          session->shmProcessingActive.store(false, std::memory_order_release);
          if (session->shmVst) session->shmVst->stopAndJoin();
          session->shmVst.reset();
          if (session->shmBypass) session->shmBypass->stopAndJoin();
          session->shmBypass.reset();
        }
        session->realtimeParamQueue.clear();
        {
          std::lock_guard<std::mutex> guard(session->host.instanceMutex);
          if (session->host.instance) session->host.instance->releaseResources();
          session->host.instance.reset();
        }
        writeMessage(stdoutFile, MSG_DISPOSE, {});
        return 0;
      }
      default:
        writeError(stdoutFile, "Unsupported message type");
        return 2;
    }
  }

  session->disposed.store(true, std::memory_order_release);
  closeEditor(session->host);
  {
    std::lock_guard<std::mutex> guard(session->shmMutex);
    session->shmProcessingActive.store(false, std::memory_order_release);
    if (session->shmVst) session->shmVst->stopAndJoin();
    session->shmVst.reset();
    if (session->shmBypass) session->shmBypass->stopAndJoin();
    session->shmBypass.reset();
  }
  session->realtimeParamQueue.clear();
  {
    std::lock_guard<std::mutex> guard(session->host.instanceMutex);
    if (session->host.instance) session->host.instance->releaseResources();
    session->host.instance.reset();
  }

  return 0;
}

std::optional<std::string> readArgValue(int argc, char* argv[], const char* key) {
  for (int i = 1; i + 1 < argc; i++) {
    if (std::strcmp(argv[i], key) == 0) return std::string(argv[i + 1]);
  }
  return std::nullopt;
}

std::vector<std::string> readArgValues(int argc, char* argv[], const char* key) {
  std::vector<std::string> out;
  for (int i = 1; i + 1 < argc; i++) {
    if (std::strcmp(argv[i], key) == 0) out.emplace_back(argv[i + 1]);
  }
  return out;
}

bool hasArg(int argc, char* argv[], const char* key) {
  for (int i = 1; i < argc; i++) {
    if (std::strcmp(argv[i], key) == 0) return true;
  }
  return false;
}

}  // namespace

int main(int argc, char* argv[]) {
#if defined(_WIN32)
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif

  juce::ScopedJuceInitialiser_GUI juceInit;

  if (hasArg(argc, argv, "--list-plugins")) {
    juce::Array<juce::var> out;

    const auto scanPaths = readArgValues(argc, argv, "--scan-path");
    const auto includeDefaultPaths = hasArg(argc, argv, "--include-default-paths");
    const auto types = scanVst3Plugins(scanPaths, includeDefaultPaths);
    std::unordered_set<std::string> seen;
    for (const auto& type : types) {
      if (type.isInstrument) continue;
      const auto id = type.createIdentifierString().toStdString();
      if (!seen.insert(id).second) continue;

      PluginDescriptor desc;
      desc.id = id;
      desc.name = type.name.toStdString();
      if (type.manufacturerName.isNotEmpty()) desc.vendor = type.manufacturerName.toStdString();
      if (type.version.isNotEmpty()) desc.version = type.version.toStdString();
      if (type.fileOrIdentifier.isNotEmpty()) desc.path = type.fileOrIdentifier.toStdString();
      // Avoid enumerating parameters here: loading each plugin is expensive and can hang/crash.
      out.add(pluginDescriptorToVar(desc));
    }

    writeJsonToStdout(juce::var(out));
    return 0;
  }

  if (const auto describeId = readArgValue(argc, argv, "--describe-plugin")) {
    const auto scanPaths = readArgValues(argc, argv, "--scan-path");
    const auto includeDefaultPaths = hasArg(argc, argv, "--include-default-paths");
    std::optional<std::string> pluginPath;
    if (const auto rawPluginPath = readArgValue(argc, argv, "--plugin-path")) {
      juce::String pathStr{*rawPluginPath};
      pathStr = pathStr.trim();
      if (pathStr.isNotEmpty()) pluginPath = pathStr.toStdString();
    }
    const auto descriptor = buildDescriptorForPluginId(*describeId, scanPaths, includeDefaultPaths, pluginPath);
    if (!descriptor.has_value()) {
      std::fprintf(stderr, "Failed to describe plugin: %s\n", describeId->c_str());
      return 2;
    }
    writeJsonToStdout(pluginDescriptorToVar(*descriptor));
    return 0;
  }

  const auto pluginId = readArgValue(argc, argv, "--plugin-id").value_or("");
  if (pluginId.empty()) {
    std::fprintf(stderr, "Missing required arg: --plugin-id\n");
    return 2;
  }
  const auto pluginPath = readArgValue(argc, argv, "--plugin-path").value_or("");
  if (pluginPath.empty()) {
    std::fprintf(stderr, "Missing required arg: --plugin-path\n");
    return 2;
  }
  const uint32_t sampleRate = static_cast<uint32_t>(std::stoul(readArgValue(argc, argv, "--sample-rate").value_or("48000")));
  const int channels = std::max(1, std::stoi(readArgValue(argc, argv, "--channels").value_or("2")));

  const auto shmInName = readArgValue(argc, argv, "--shm-in");
  const auto shmOutName = readArgValue(argc, argv, "--shm-out");
  const auto shmMode = readArgValue(argc, argv, "--shm-audio-mode").value_or("bypass");
  std::optional<ShmAudioArgs> shmArgs;
  if (shmInName.has_value() && shmOutName.has_value()) {
    shmArgs = ShmAudioArgs{*shmInName, *shmOutName, shmMode};
  }

  std::atomic<int> engineExitCode = 0;
  std::thread engine([&]() {
    engineExitCode.store(runVst3Plugin(pluginId, pluginPath, sampleRate, channels, shmArgs));
    juce::MessageManager::getInstance()->stopDispatchLoop();
  });

  juce::MessageManager::getInstance()->runDispatchLoop();
  if (engine.joinable()) engine.join();
  return engineExitCode.load();
}
