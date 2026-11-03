cmake_minimum_required(VERSION 3.22.1)
project(stageboard_native_audio LANGUAGES CXX)

# AAudio exists from Android 8 (API 26); the app's minSdk is 24, so the symbols are weak and the
# Java side only loads this library on API 26+.
add_library(native_audio_test SHARED native_audio_test.cpp usb_audio_test.cpp)
target_compile_definitions(native_audio_test PRIVATE __ANDROID_UNAVAILABLE_SYMBOLS_ARE_WEAK__)
target_compile_options(native_audio_test PRIVATE -Wall -Wno-unguarded-availability-new -Wno-unguarded-availability)
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
target_link_libraries(native_audio_test ${CMAKE_SYSROOT}/usr/lib/${AAUDIO_TRIPLE}/26/libaaudio.so log)
