cmake_minimum_required(VERSION 3.22.1)
project(stageboard_native_output LANGUAGES CXX)

# Native audio output (docs/30). AAudio exists from Android 8 (API 26); the app's minSdk is 24, so
# the symbols are weak and the Java side only loads this library on API 26+.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# The engine core (docs/30 §8h stage 3) - its sources straight from native/engine, the same files
# the laptop's tests and the WebAssembly build use; with stage 4 the Opus tracks (libopus, vendored
# in native/engine/third_party, decoder only).
set(ENGINE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../../native/engine)
set(OPUS_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(OPUS_BUILD_PROGRAMS OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_PKG_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_CMAKE_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
add_subdirectory(${ENGINE_DIR}/third_party/opus ${CMAKE_CURRENT_BINARY_DIR}/opus EXCLUDE_FROM_ALL)
add_library(native_output SHARED native_output.cpp ${ENGINE_DIR}/src/clock_map.cpp ${ENGINE_DIR}/src/engine.cpp
            ${ENGINE_DIR}/src/opus_clip.cpp ${ENGINE_DIR}/src/stream_clip.cpp)
target_include_directories(native_output PRIVATE ${ENGINE_DIR}/include)
target_compile_definitions(native_output PRIVATE __ANDROID_UNAVAILABLE_SYMBOLS_ARE_WEAK__)
target_compile_options(native_output PRIVATE -Wall -Wno-unguarded-availability-new -Wno-unguarded-availability)
# Optimised in debug builds too: this code races the audio callback's deadline, and the dev app is
# what the devices are tested with - at -O0 the engine took the Fire's callback past its 20 ms
# (161 underruns in a song, audible hangs) and the Redmi's USB thread to half a core (2026-11-14).
target_compile_options(native_output PRIVATE -O2)
target_compile_options(opus PRIVATE -O2)
# libaaudio's stub only exists in the API 26+ sysroot folders - link that one explicitly.
if(ANDROID_ABI STREQUAL "arm64-v8a")
  set(AAUDIO_TRIPLE aarch64-linux-android)
elseif(ANDROID_ABI STREQUAL "armeabi-v7a")
  set(AAUDIO_TRIPLE arm-linux-androideabi)
elseif(ANDROID_ABI STREQUAL "x86_64")
  set(AAUDIO_TRIPLE x86_64-linux-android)
else()
  set(AAUDIO_TRIPLE i686-linux-android)
endif()
target_link_libraries(native_output ${CMAKE_SYSROOT}/usr/lib/${AAUDIO_TRIPLE}/26/libaaudio.so log opus)
