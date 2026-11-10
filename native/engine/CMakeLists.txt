cmake_minimum_required(VERSION 3.18)
project(stageboard_engine LANGUAGES CXX)

# The audio engine's core (docs/30 §8h, stage 1): plain C++17 without dependencies, so the same
# code builds for the laptop's tests, Android (later inside native_output) and WASM (stage 2).
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(stageboard_engine STATIC src/clock_map.cpp src/engine.cpp)
target_include_directories(stageboard_engine PUBLIC include)
target_compile_options(stageboard_engine PRIVATE -Wall -Wextra -Wpedantic)

option(STAGEBOARD_ENGINE_TESTS "Build the offline tests" ON)
option(STAGEBOARD_ENGINE_SANITIZE "Build with AddressSanitizer + UBSan" OFF)
if(STAGEBOARD_ENGINE_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
  target_compile_options(stageboard_engine PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
endif()
if(STAGEBOARD_ENGINE_TESTS)
  enable_testing()
  add_executable(engine_test tests/engine_test.cpp)
  target_link_libraries(engine_test stageboard_engine)
  target_compile_options(engine_test PRIVATE -Wall -Wextra)
  add_test(NAME engine_test COMMAND engine_test)
endif()
