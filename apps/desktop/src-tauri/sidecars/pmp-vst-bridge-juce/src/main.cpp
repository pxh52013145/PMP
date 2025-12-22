#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
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
#endif

namespace {

constexpr uint8_t MSG_SET_PARAMS = 1;
constexpr uint8_t MSG_PROCESS_AUDIO = 2;
constexpr uint8_t MSG_OPEN_EDITOR = 3;
constexpr uint8_t MSG_CLOSE_EDITOR = 4;
constexpr uint8_t MSG_ERROR = 255;

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

std::vector<uint8_t> encodeErrorPayload(const std::string& message) {
  auto* obj = new juce::DynamicObject();
  obj->setProperty("message", juce::String(message));
  juce::var payloadVar(obj);
  const auto json = juce::JSON::toString(payloadVar, true);
  const auto utf8 = json.toRawUTF8();
  std::vector<uint8_t> out;
  out.assign(reinterpret_cast<const uint8_t*>(utf8),
             reinterpret_cast<const uint8_t*>(utf8) + std::strlen(utf8));
  return out;
}

bool writeError(std::FILE* stdoutFile, const std::string& message) {
  const auto payload = encodeErrorPayload(message);
  return writeMessage(stdoutFile, MSG_ERROR, payload);
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

PluginDescriptor demoGainDescriptor() {
  PluginDescriptor desc;
  desc.id = "demo.gain";
  desc.name = "Demo Gain";
  desc.vendor = std::string("Pixel Matrix Player");

  ParamDescriptor gain;
  gain.key = "gainDb";
  gain.title = "Gain";
  gain.min = -60.0f;
  gain.max = 24.0f;
  gain.def = 0.0f;
  gain.step = 0.1f;
  gain.unit = std::string("dB");
  desc.parameters.push_back(std::move(gain));
  return desc;
}

juce::var pluginDescriptorToVar(const PluginDescriptor& desc) {
  auto* obj = new juce::DynamicObject();
  obj->setProperty("id", juce::String(desc.id));
  obj->setProperty("name", juce::String(desc.name));
  if (desc.vendor.has_value()) obj->setProperty("vendor", juce::String(*desc.vendor));

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
  Vst3ScanResult scan;
  juce::File deadMansPedalFile =
      juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
          .getChildFile("PixelMatrixPlayer")
          .getChildFile("vst3_scanner_deadman.txt");
  deadMansPedalFile.getParentDirectory().createDirectory();

  juce::PluginDirectoryScanner scanner(scan.knownList,
                                       *scan.format,
                                       scan.format->getDefaultLocationsToSearch(),
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
  const auto types = scanVst3Plugins();
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

std::optional<PluginDescriptor> buildDescriptorForPluginId(const std::string& pluginId) {
  if (pluginId == "demo.gain") return demoGainDescriptor();

  const auto typeOpt = findVst3PluginById(pluginId);
  if (!typeOpt.has_value()) return std::nullopt;
  const auto& type = *typeOpt;
  if (type.isInstrument) return std::nullopt;

  Vst3ScanResult scan;
  juce::String error;
  auto instance = scan.formatManager.createPluginInstance(type, 48'000.0, 512, error);
  if (!instance) return std::nullopt;

  PluginDescriptor desc;
  desc.id = pluginId;
  desc.name = type.name.toStdString();
  if (type.manufacturerName.isNotEmpty()) desc.vendor = type.manufacturerName.toStdString();

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
  PluginEditorWindow(const juce::String& title, std::unique_ptr<juce::AudioProcessorEditor> editor)
      : DocumentWindow(title,
                       juce::Colours::darkgrey,
                       juce::DocumentWindow::closeButton | juce::DocumentWindow::minimiseButton) {
    setUsingNativeTitleBar(true);
    setResizable(true, true);
    setContentOwned(editor.release(), true);

    const int width = std::max(320, getContentComponent()->getWidth());
    const int height = std::max(240, getContentComponent()->getHeight());
    centreWithSize(width, height);
    setVisible(true);
  }

  void closeButtonPressed() override { setVisible(false); }
};

struct LivePluginHost {
  std::unique_ptr<juce::AudioPluginInstance> instance;
  double sampleRate = 48'000.0;
  int channels = 2;
  int blockSize = 512;

  std::mutex editorMutex;
  std::unique_ptr<PluginEditorWindow> editorWindow;
};

bool applyParamSet(LivePluginHost& host, const std::vector<uint8_t>& payload) {
  const juce::String jsonText = juce::String::fromUTF8(
      reinterpret_cast<const char*>(payload.data()), static_cast<int>(payload.size()));
  juce::var parsed;
  const auto result = juce::JSON::parse(jsonText, parsed);
  if (result.failed()) return false;
  auto* obj = parsed.getDynamicObject();
  if (obj == nullptr) return false;
  const auto paramsVar = obj->getProperty("params");
  auto* paramsArr = paramsVar.getArray();
  if (paramsArr == nullptr) return true;

  const auto& params = host.instance->getParameters();
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
    param->beginChangeGesture();
    param->setValueNotifyingHost(normalized);
    param->endChangeGesture();
  }
  return true;
}

struct OpenEditorRequest {
  std::optional<std::string> title;
};

OpenEditorRequest decodeOpenEditorRequest(const std::vector<uint8_t>& payload) {
  OpenEditorRequest out;
  const juce::String jsonText = juce::String::fromUTF8(
      reinterpret_cast<const char*>(payload.data()), static_cast<int>(payload.size()));
  juce::var parsed;
  const auto result = juce::JSON::parse(jsonText, parsed);
  if (result.failed()) return out;
  auto* obj = parsed.getDynamicObject();
  if (obj == nullptr) return out;
  const auto titleVar = obj->getProperty("title");
  if (titleVar.isString()) {
    const auto title = titleVar.toString();
    if (title.isNotEmpty()) out.title = title.toStdString();
  }
  return out;
}

std::optional<std::string> openEditor(LivePluginHost& host, const OpenEditorRequest& request) {
  auto promise = std::make_shared<std::promise<std::optional<std::string>>>();
  auto future = promise->get_future();

  juce::MessageManager::callAsync([&host, reqTitle = request.title, promise]() mutable {
    std::lock_guard<std::mutex> guard(host.editorMutex);

    if (host.instance == nullptr) {
      promise->set_value(std::string("Plugin instance is not available"));
      return;
    }

    if (host.editorWindow && host.editorWindow->isVisible()) {
      host.editorWindow->toFront(true);
      promise->set_value(std::nullopt);
      return;
    }

    if (!host.instance->hasEditor()) {
      promise->set_value(std::string("Plugin does not provide a native editor UI"));
      return;
    }

    std::unique_ptr<juce::AudioProcessorEditor> editor(host.instance->createEditorIfNeeded());
    if (!editor) {
      promise->set_value(std::string("Failed to create plugin editor UI"));
      return;
    }

    const juce::String title =
        reqTitle.has_value() ? juce::String(*reqTitle) : juce::String("VST3 Editor");
    host.editorWindow = std::make_unique<PluginEditorWindow>(title, std::move(editor));
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
    promise->set_value(std::nullopt);
  });

  const auto result = future.get();
  return result;
}

int runDemoGain() {
  float gainLinear = 1.0f;

  std::FILE* stdinFile = stdin;
  std::FILE* stdoutFile = stdout;

  std::vector<uint8_t> payload;
  std::vector<float> samples;
  while (true) {
    uint8_t type = 0;
    if (!readMessage(stdinFile, type, payload)) break;

    switch (type) {
      case MSG_SET_PARAMS: {
        const juce::String jsonText = juce::String::fromUTF8(
            reinterpret_cast<const char*>(payload.data()), static_cast<int>(payload.size()));
        juce::var parsed;
        const auto result = juce::JSON::parse(jsonText, parsed);
        if (result.failed()) {
          writeError(stdoutFile, "Bad params payload");
          break;
        }
        if (auto* obj = parsed.getDynamicObject()) {
          if (auto* arr = obj->getProperty("params").getArray()) {
            for (const auto& entry : *arr) {
              if (auto* entryObj = entry.getDynamicObject()) {
                const auto key = entryObj->getProperty("key").toString();
                if (key == "gainDb") {
                  const float db = static_cast<float>(static_cast<double>(entryObj->getProperty("value")));
                  const float clamped = clampFinite(db, -60.0f, 24.0f, 0.0f);
                  gainLinear = std::pow(10.0f, clamped / 20.0f);
                }
              }
            }
          }
        }
        writeMessage(stdoutFile, MSG_SET_PARAMS, {});
        break;
      }
      case MSG_PROCESS_AUDIO: {
        if (!decodeAudioPayload(payload, samples)) {
          writeError(stdoutFile, "Bad audio payload");
          return 2;
        }
        for (auto& s : samples) s *= gainLinear;
        const auto out = encodeAudioPayload(samples);
        writeMessage(stdoutFile, MSG_PROCESS_AUDIO, out);
        break;
      }
      case MSG_OPEN_EDITOR: {
        writeMessage(stdoutFile, MSG_OPEN_EDITOR, {});
        break;
      }
      case MSG_CLOSE_EDITOR: {
        writeMessage(stdoutFile, MSG_CLOSE_EDITOR, {});
        break;
      }
      default:
        writeError(stdoutFile, "Unsupported message type");
        return 2;
    }
  }
  return 0;
}

int runVst3Plugin(const std::string& pluginId, uint32_t sampleRate, int channels) {
  std::FILE* stdinFile = stdin;
  std::FILE* stdoutFile = stdout;

  const auto typeOpt = findVst3PluginById(pluginId);
  if (!typeOpt.has_value()) {
    std::fprintf(stderr, "VST3 plugin not found: %s\n%s\n", pluginId.c_str(), getVst3ScanIdHint().toRawUTF8());
    return 2;
  }
  const auto& type = *typeOpt;
  if (type.isInstrument) {
    std::fprintf(stderr, "Unsupported plugin type: Instrument (MVP supports effects only)\n");
    return 2;
  }

  Vst3ScanResult scan;
  juce::String error;

  const int safeChannels = std::max(1, channels);
  const int blockSize = std::max(1, 8192 / safeChannels);
  LivePluginHost host;
  host.sampleRate = static_cast<double>(sampleRate);
  host.channels = safeChannels;
  host.blockSize = blockSize;

  host.instance = scan.formatManager.createPluginInstance(type, host.sampleRate, blockSize, error);
  if (!host.instance) {
    std::fprintf(stderr, "Failed to load VST3 plugin: %s\n", error.toRawUTF8());
    return 2;
  }

  host.instance->prepareToPlay(host.sampleRate, blockSize);

  std::vector<uint8_t> payload;
  std::vector<float> interleaved;
  juce::AudioBuffer<float> buffer(safeChannels, blockSize);
  juce::MidiBuffer midi;

  while (true) {
    uint8_t typeByte = 0;
    if (!readMessage(stdinFile, typeByte, payload)) break;

    switch (typeByte) {
      case MSG_SET_PARAMS: {
        if (!applyParamSet(host, payload)) {
          writeError(stdoutFile, "Bad params payload");
          break;
        }
        writeMessage(stdoutFile, MSG_SET_PARAMS, {});
        break;
      }
      case MSG_PROCESS_AUDIO: {
        if (!decodeAudioPayload(payload, interleaved)) {
          writeError(stdoutFile, "Bad audio payload");
          return 2;
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
        host.instance->processBlock(buffer, midi);

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
        const auto err = openEditor(host, request);
        if (err.has_value()) {
          writeError(stdoutFile, *err);
        } else {
          writeMessage(stdoutFile, MSG_OPEN_EDITOR, {});
        }
        break;
      }
      case MSG_CLOSE_EDITOR: {
        const auto err = closeEditor(host);
        if (err.has_value()) {
          writeError(stdoutFile, *err);
        } else {
          writeMessage(stdoutFile, MSG_CLOSE_EDITOR, {});
        }
        break;
      }
      default:
        writeError(stdoutFile, "Unsupported message type");
        return 2;
    }
  }

  closeEditor(host);
  host.instance->releaseResources();
  host.instance.reset();

  return 0;
}

std::optional<std::string> readArgValue(int argc, char* argv[], const char* key) {
  for (int i = 1; i + 1 < argc; i++) {
    if (std::strcmp(argv[i], key) == 0) return std::string(argv[i + 1]);
  }
  return std::nullopt;
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
    out.add(pluginDescriptorToVar(demoGainDescriptor()));

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
      // Avoid enumerating parameters here: loading each plugin is expensive and can hang/crash.
      out.add(pluginDescriptorToVar(desc));
    }

    writeJsonToStdout(juce::var(out));
    return 0;
  }

  if (const auto describeId = readArgValue(argc, argv, "--describe-plugin")) {
    const auto descriptor = buildDescriptorForPluginId(*describeId);
    if (!descriptor.has_value()) {
      std::fprintf(stderr, "Failed to describe plugin: %s\n", describeId->c_str());
      return 2;
    }
    writeJsonToStdout(pluginDescriptorToVar(*descriptor));
    return 0;
  }

  const auto pluginId = readArgValue(argc, argv, "--plugin-id").value_or("demo.gain");
  const uint32_t sampleRate = static_cast<uint32_t>(std::stoul(readArgValue(argc, argv, "--sample-rate").value_or("48000")));
  const int channels = std::max(1, std::stoi(readArgValue(argc, argv, "--channels").value_or("2")));

  if (pluginId == "demo.gain") {
    return runDemoGain();
  }

  std::atomic<int> engineExitCode = 0;
  std::thread engine([&]() {
    engineExitCode.store(runVst3Plugin(pluginId, sampleRate, channels));
    juce::MessageManager::getInstance()->stopDispatchLoop();
  });

  juce::MessageManager::getInstance()->runDispatchLoop();
  if (engine.joinable()) engine.join();
  return engineExitCode.load();
}
