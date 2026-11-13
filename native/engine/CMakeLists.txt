cmake_minimum_required(VERSION 3.18)
project(stageboard_engine LANGUAGES CXX)

# The audio engine's core (docs/30 §8h, stage 1): plain C++17, the one dependency (libopus) is in
# third_party/, so the same code builds offline for the laptop's tests, Android (later inside
# native_output) and WASM (stage 2).
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(STAGEBOARD_ENGINE_TESTS "Build the offline tests" ON)
option(STAGEBOARD_ENGINE_SANITIZE "Build with AddressSanitizer + UBSan" OFF)
if(STAGEBOARD_ENGINE_SANITIZE)
  # Before libopus, so its code is checked too.
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()

# libopus 1.5.2 as released by Xiph (third_party/opus/VENDOR.md): only the decoder is used, the
# neural extensions (DRED, OSCE, deep PLC) stay off - their weights are not even vendored.
set(OPUS_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(OPUS_BUILD_PROGRAMS OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_PKG_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_CMAKE_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
add_subdirectory(third_party/opus EXCLUDE_FROM_ALL)

add_library(stageboard_engine STATIC src/clock_map.cpp src/engine.cpp src/opus_clip.cpp src/stream_clip.cpp src/opus_writer.cpp)
target_include_directories(stageboard_engine PUBLIC include)
target_link_libraries(stageboard_engine PRIVATE opus)
target_compile_options(stageboard_engine PRIVATE -Wall -Wextra -Wpedantic)
# One-off converter for the library on the server (tools/convert-tracks): PCM in, Ogg Opus out.
add_executable(opus_encode tools/opus_encode.cpp)
target_link_libraries(opus_encode stageboard_engine)
target_compile_options(opus_encode PRIVATE -Wall -Wextra -Wpedantic)
if(STAGEBOARD_ENGINE_TESTS)
  enable_testing()
  add_executable(engine_test tests/engine_test.cpp tests/opus_clip_test.cpp tests/resample_test.cpp tests/stream_clip_test.cpp tests/opus_writer_test.cpp)
  find_package(Threads REQUIRED)
  target_link_libraries(engine_test stageboard_engine Threads::Threads)
  target_compile_definitions(engine_test PRIVATE STAGEBOARD_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures")
  target_compile_options(engine_test PRIVATE -Wall -Wextra)
  add_test(NAME engine_test COMMAND engine_test)
endif()
