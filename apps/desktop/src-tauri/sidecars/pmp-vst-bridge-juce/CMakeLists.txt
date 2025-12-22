cmake_minimum_required(VERSION 3.21)

project(pmp_vst_bridge_juce VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Prefer an existing JUCE checkout (avoid network) if provided.
set(PMP_JUCE_DIR "$ENV{PMP_JUCE_DIR}" CACHE PATH "Path to a JUCE source checkout")

if(PMP_JUCE_DIR AND EXISTS "${PMP_JUCE_DIR}/CMakeLists.txt")
  message(STATUS "Using JUCE from PMP_JUCE_DIR=${PMP_JUCE_DIR}")
  add_subdirectory("${PMP_JUCE_DIR}" juce)
else()
  set(PMP_JUCE_GIT_URL "$ENV{PMP_JUCE_GIT_URL}" CACHE STRING "JUCE git repository URL for FetchContent")
  if(NOT PMP_JUCE_GIT_URL)
    set(PMP_JUCE_GIT_URL "https://github.com/juce-framework/JUCE.git")
  endif()

  include(FetchContent)
  FetchContent_Declare(
    juce
    GIT_REPOSITORY ${PMP_JUCE_GIT_URL}
    GIT_TAG 7.0.12
    GIT_SHALLOW TRUE
  )
  FetchContent_MakeAvailable(juce)
endif()

juce_add_console_app(pmp_vst_bridge_juce PRODUCT_NAME "pmp-vst-bridge")
set_target_properties(pmp_vst_bridge_juce PROPERTIES OUTPUT_NAME "pmp-vst-bridge")

target_sources(pmp_vst_bridge_juce PRIVATE src/main.cpp)

target_compile_definitions(
  pmp_vst_bridge_juce
  PRIVATE
    JUCE_PLUGINHOST_VST3=1
    JUCE_PLUGINHOST_VST=0
    JUCE_PLUGINHOST_AU=0
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
    JUCE_REPORT_APP_USAGE=0
)

target_link_libraries(
  pmp_vst_bridge_juce
  PRIVATE
    juce::juce_audio_processors
    juce::juce_gui_extra
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)
