#include "rack_vst3.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"

#include <vector>
#include <string>
#include <algorithm>
#include <cstring>
#include <cctype>
#include <cstdlib>
#include <cstdio>

#if defined(__APPLE__)
    #include <CoreFoundation/CoreFoundation.h>
    #include <dirent.h>
    #include <sys/stat.h>
#elif defined(_WIN32)
    #include <windows.h>
    #include <shlobj.h>
#else
    #include <unistd.h>
    #include <pwd.h>
    #include <dirent.h>
    #include <sys/stat.h>
#endif

using namespace VST3;
using namespace Steinberg;
using namespace Steinberg::Vst;

// Internal scanner state
struct RackVST3Scanner {
    std::vector<std::string> search_paths;
};

// Helper: Scan a directory for .vst3 bundles/folders
// Returns list of full paths to .vst3 bundles found
static std::vector<std::string> scan_directory_for_vst3(const std::string& dir_path) {
    std::vector<std::string> vst3_paths;

#if defined(_WIN32)
    auto ends_with_case_insensitive = [](const std::string& s, const char* suffix) -> bool {
        const size_t n = s.size();
        const size_t m = std::strlen(suffix);
        if (n < m) return false;
        for (size_t i = 0; i < m; i++) {
            const char a = static_cast<char>(std::tolower(static_cast<unsigned char>(s[n - m + i])));
            const char b = static_cast<char>(std::tolower(static_cast<unsigned char>(suffix[i])));
            if (a != b) return false;
        }
        return true;
    };

    // Prefer x64 plugin binaries inside a VST3 "bundle" directory if present.
    auto scan_bundle_binaries = [&](const std::string& bundle_dir, std::vector<std::string>& out) {
        const std::string x64_dir = bundle_dir + "\\Contents\\x86_64-win";
        const std::string search_path = x64_dir + "\\*.vst3";

        WIN32_FIND_DATAA find_data;
        HANDLE find_handle = FindFirstFileA(search_path.c_str(), &find_data);
        if (find_handle == INVALID_HANDLE_VALUE) {
            return;
        }
        do {
            if (!(find_data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) {
                out.push_back(x64_dir + "\\" + find_data.cFileName);
            }
        } while (FindNextFileA(find_handle, &find_data));
        FindClose(find_handle);
    };

    // Windows VST3 can be either:
    // - a module file `*.vst3` (common)
    // - a directory `*.vst3` containing `Contents\\x86_64-win\\*.vst3` (bundle-style installers)
    // Some installers nest plugins under vendor subdirectories, so we scan a few levels deep,
    // skipping reparse points (junctions/symlinks) to avoid cycles.
    struct DirEntry {
        std::string path;
        int depth;
    };

    std::vector<DirEntry> queue;
    queue.push_back({dir_path, 0});

    const int max_depth = 4;
    int dir_budget = 10000;

    while (!queue.empty() && dir_budget-- > 0) {
        DirEntry current = std::move(queue.back());
        queue.pop_back();

        // 1) Collect *.vst3 (files or directories) in this directory
        {
            const std::string pattern = current.path + "\\*.vst3";
            WIN32_FIND_DATAA find_data;
            HANDLE find_handle = FindFirstFileA(pattern.c_str(), &find_data);
            if (find_handle != INVALID_HANDLE_VALUE) {
                do {
                    const char* name = find_data.cFileName;
                    if (std::strcmp(name, ".") == 0 || std::strcmp(name, "..") == 0) continue;
                    const std::string full_path = current.path + "\\" + name;

                    if (find_data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
                        const size_t before = vst3_paths.size();
                        scan_bundle_binaries(full_path, vst3_paths);
                        (void)before;
                    } else {
                        vst3_paths.push_back(full_path);
                    }
                } while (FindNextFileA(find_handle, &find_data));
                FindClose(find_handle);
            }
        }

        // 2) Walk into subdirectories (bounded depth)
        if (current.depth >= max_depth) {
            continue;
        }
        const std::string pattern = current.path + "\\*";
        WIN32_FIND_DATAA find_data;
        HANDLE find_handle = FindFirstFileA(pattern.c_str(), &find_data);
        if (find_handle == INVALID_HANDLE_VALUE) {
            continue;
        }
        do {
            const char* name = find_data.cFileName;
            if (std::strcmp(name, ".") == 0 || std::strcmp(name, "..") == 0) continue;
            if (!(find_data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;

            if (find_data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) {
                // Avoid following junctions/symlinks.
                continue;
            }

            // Avoid recursing into bundle internals; we already handle bundle scanning above.
            if (ends_with_case_insensitive(name, ".vst3")) {
                continue;
            }
            if (_stricmp(name, "Contents") == 0) {
                continue;
            }

            queue.push_back({current.path + "\\" + name, current.depth + 1});
        } while (FindNextFileA(find_handle, &find_data));
        FindClose(find_handle);
    }
#else
    // macOS/Linux implementation using dirent
    DIR* dir = opendir(dir_path.c_str());
    if (!dir) {
        return vst3_paths;
    }

    struct dirent* entry;
    while ((entry = readdir(dir)) != nullptr) {
        std::string name = entry->d_name;

        // Skip . and ..
        if (name == "." || name == "..") {
            continue;
        }

        // Check for .vst3 extension
        if (name.length() > 5 && name.substr(name.length() - 5) == ".vst3") {
            std::string full_path = dir_path + "/" + name;

            // Verify it's a directory (VST3 bundles are folders on macOS/Linux)
            struct stat st;
            if (stat(full_path.c_str(), &st) == 0 && S_ISDIR(st.st_mode)) {
                vst3_paths.push_back(full_path);
            }
        }
    }

    closedir(dir);
#endif

    return vst3_paths;
}

// Helper: Get default VST3 plugin paths for the current platform
static std::vector<std::string> get_default_vst3_paths() {
    std::vector<std::string> paths;

#if defined(__APPLE__)
    // macOS paths
    paths.push_back("/Library/Audio/Plug-Ins/VST3");

    // User library
    const char* home = getenv("HOME");
    if (home) {
        std::string user_path = std::string(home) + "/Library/Audio/Plug-Ins/VST3";
        paths.push_back(user_path);
    }

#elif defined(_WIN32)
    // Windows paths
    char common_files[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_PROGRAM_FILES_COMMON, NULL, 0, common_files))) {
        std::string path = std::string(common_files) + "\\VST3";
        paths.push_back(path);
    }

#else
    // Linux paths
    paths.push_back("/usr/lib/vst3");
    paths.push_back("/usr/local/lib/vst3");

    // User home
    const char* home = getenv("HOME");
    if (home) {
        std::string user_path = std::string(home) + "/.vst3";
        paths.push_back(user_path);
    }
#endif

    return paths;
}

// Helper: Convert VST3 UID to hex string
static std::string uid_to_string(const VST3::UID& uid) {
    return uid.toString();
}

// Helper: Determine plugin type from subcategories
static RackVST3PluginType determine_plugin_type(const std::string& subcategories) {
    if (subcategories.find("Instrument") != std::string::npos) {
        return RACK_VST3_TYPE_INSTRUMENT;
    } else if (subcategories.find("Analyzer") != std::string::npos) {
        return RACK_VST3_TYPE_ANALYZER;
    } else if (subcategories.find("Spatial") != std::string::npos) {
        return RACK_VST3_TYPE_SPATIAL;
    } else if (subcategories.find("Fx") != std::string::npos) {
        return RACK_VST3_TYPE_EFFECT;
    }
    return RACK_VST3_TYPE_OTHER;
}

// ============================================================================
// Scanner Implementation
// ============================================================================

RackVST3Scanner* rack_vst3_scanner_new(void) {
    return new(std::nothrow) RackVST3Scanner();
}

void rack_vst3_scanner_free(RackVST3Scanner* scanner) {
    delete scanner;
}

int rack_vst3_scanner_add_path(RackVST3Scanner* scanner, const char* path) {
    if (!scanner || !path) {
        return RACK_VST3_ERROR_INVALID_PARAM;
    }

    scanner->search_paths.push_back(path);
    return RACK_VST3_OK;
}

int rack_vst3_scanner_add_default_paths(RackVST3Scanner* scanner) {
    if (!scanner) {
        return RACK_VST3_ERROR_INVALID_PARAM;
    }

    auto paths = get_default_vst3_paths();
    scanner->search_paths.insert(scanner->search_paths.end(), paths.begin(), paths.end());
    return RACK_VST3_OK;
}

int rack_vst3_scanner_scan(RackVST3Scanner* scanner, RackVST3PluginInfo* plugins, size_t max_plugins) {
    if (!scanner) {
        return RACK_VST3_ERROR_INVALID_PARAM;
    }

    const bool debug_scan = std::getenv("PMP_RACK_VST3_DEBUG") != nullptr;

    bool count_only = (plugins == nullptr);
    size_t count = 0;

    // Determine which paths to scan
    std::vector<std::string> paths_to_scan = scanner->search_paths;
    if (paths_to_scan.empty()) {
        // No custom paths - use system defaults
        paths_to_scan = get_default_vst3_paths();
    }

    // Collect all module paths by scanning directories for .vst3 bundles
    std::vector<std::string> module_paths;

    for (const auto& search_path : paths_to_scan) {
        auto found_bundles = scan_directory_for_vst3(search_path);
        module_paths.insert(module_paths.end(), found_bundles.begin(), found_bundles.end());
    }

    // Also include system-discovered modules (from getModulePaths)
    // This ensures we find all plugins even if custom paths are specified
    auto system_modules = Hosting::Module::getModulePaths();
    module_paths.insert(module_paths.end(), system_modules.begin(), system_modules.end());

    // Normalize Windows paths (avoid duplicated scans from different separators).
#if defined(_WIN32)
    for (auto& p : module_paths) {
        std::replace(p.begin(), p.end(), '/', '\\');
        if (p.size() >= 2 && p[1] == ':') {
            p[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(p[0])));
        }
    }
#endif

    // Remove duplicates (in case same plugin is in both custom and system paths)
    std::sort(module_paths.begin(), module_paths.end());
    module_paths.erase(std::unique(module_paths.begin(), module_paths.end()), module_paths.end());

    if (debug_scan) {
        std::fprintf(stderr, "[rack/vst3] scanning %zu module paths\n", module_paths.size());
        for (const auto& p : module_paths) {
            std::fprintf(stderr, "[rack/vst3] module path: %s\n", p.c_str());
        }
    }

    // Scan all found modules
    for (const auto& module_path : module_paths) {
        std::string error_description;
        auto module = Hosting::Module::create(module_path, error_description);

        if (!module) {
            // Failed to load module, skip it
            if (debug_scan) {
                std::fprintf(
                    stderr,
                    "[rack/vst3] failed to load module: %s (%s)\n",
                    module_path.c_str(),
                    error_description.c_str()
                );
            }
            continue;
        }

        const auto& factory = module->getFactory();
        auto class_infos = factory.classInfos();

        // Enumerate all classes in this module
        for (const auto& class_info : class_infos) {
            // Only process audio effect classes
            if (class_info.category() != kVstAudioEffectClass) {
                continue;
            }

            // If we're just counting, increment and continue
            if (count_only) {
                count++;
                continue;
            }

            // If array is full, continue counting but don't fill
            if (count >= max_plugins) {
                count++;
                continue;
            }

            // Fill in plugin info
            RackVST3PluginInfo& info = plugins[count];

            // Name
            std::string name = class_info.name();
            strncpy(info.name, name.c_str(), sizeof(info.name) - 1);
            info.name[sizeof(info.name) - 1] = '\0';

            // Manufacturer
            std::string vendor = class_info.vendor();
            if (vendor.empty()) {
                vendor = factory.info().vendor();
            }
            strncpy(info.manufacturer, vendor.c_str(), sizeof(info.manufacturer) - 1);
            info.manufacturer[sizeof(info.manufacturer) - 1] = '\0';

            // Path (full path to the .vst3 bundle/folder)
            strncpy(info.path, module_path.c_str(), sizeof(info.path) - 1);
            info.path[sizeof(info.path) - 1] = '\0';

            // Unique ID (UID as hex string)
            std::string uid_str = uid_to_string(class_info.ID());
            strncpy(info.unique_id, uid_str.c_str(), sizeof(info.unique_id) - 1);
            info.unique_id[sizeof(info.unique_id) - 1] = '\0';

            // Version - parse version string (e.g., "1.0.0" or "1.2.3.4") to uint32_t
            // Format: major.minor.patch.build -> pack into uint32_t
            std::string version_str = class_info.version();
            uint32_t version = 0;
            if (!version_str.empty()) {
                int major = 0, minor = 0, patch = 0, build = 0;
                // Try to parse up to 4 components
                int parsed = sscanf(version_str.c_str(), "%d.%d.%d.%d", &major, &minor, &patch, &build);
                if (parsed >= 1) {
                    // Clamp each component to valid byte range [0, 255]
                    // This prevents integer overflow and handles negative/oversized values
                    auto clamp_byte = [](int val) -> uint8_t {
                        return static_cast<uint8_t>((std::max)(0, (std::min)(255, val)));
                    };

                    uint8_t major_byte = clamp_byte(major);
                    uint8_t minor_byte = clamp_byte(minor);
                    uint8_t patch_byte = clamp_byte(patch);
                    uint8_t build_byte = clamp_byte(build);

                    // Pack into uint32_t: major(8) | minor(8) | patch(8) | build(8)
                    version = (static_cast<uint32_t>(major_byte) << 24) |
                             (static_cast<uint32_t>(minor_byte) << 16) |
                             (static_cast<uint32_t>(patch_byte) << 8) |
                             static_cast<uint32_t>(build_byte);
                }
            }
            info.version = version;

            // Type (from subcategories)
            std::string subcategories = class_info.subCategoriesString();
            info.plugin_type = determine_plugin_type(subcategories);

            // Category (subcategories string)
            strncpy(info.category, subcategories.c_str(), sizeof(info.category) - 1);
            info.category[sizeof(info.category) - 1] = '\0';

            count++;
        }
    }

    return static_cast<int>(count);
}
