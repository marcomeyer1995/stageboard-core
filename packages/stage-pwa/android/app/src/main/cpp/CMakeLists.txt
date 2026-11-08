cmake_minimum_required(VERSION 3.22.1)
project(stageboard_native_output LANGUAGES CXX)

# Native audio output (docs/30). AAudio exists from Android 8 (API 26); the app's minSdk is 24, so
# the symbols are weak and the Java side only loads this library on API 26+.
# Native Engine N1 (docs/30 §8): includes click synthesizer, playback plan queue, clock sync, and
# announcement player for lock-screen playback.
add_library(native_output SHARED 
    native_output.cpp
    click_synth.cpp
    playback_plan.cpp
    clock_sync.cpp
    announcement_player.cpp
)
target_compile_definitions(native_output PRIVATE __ANDROID_UNAVAILABLE_SYMBOLS_ARE_WEAK__)
target_compile_options(native_output PRIVATE -Wall -Wno-unguarded-availability-new -Wno-unguarded-availability)
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
target_link_libraries(native_output ${CMAKE_SYSROOT}/usr/lib/${AAUDIO_TRIPLE}/26/libaaudio.so log)
