#!/usr/bin/env bash
# Builds the engine core as WebAssembly (docs/30 §8h stage 2) with wasi-sdk 29:
#   https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-29
#   wasi-sdk-29.0-x86_64-linux.tar.gz, sha256 87d1d1a2879d139cdc624b968efad3d4a97b8078cdff95e63ac88ecafd1a0171
# Usage: build.sh <out.wasm>   (WASI_SDK=<dir> if not in ~/.local/opt)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sdk="${WASI_SDK:-$HOME/.local/opt/wasi-sdk-29.0-x86_64-linux}"
out="${1:?usage: build.sh <out.wasm>}"
# A reactor: no main, the worklet calls the exports. No exceptions/RTTI - nothing in the core
# throws, and it keeps the module small. Only the click/clip core: Opus decoding comes with stage 4.
"$sdk/bin/clang++" --target=wasm32-wasip1 --sysroot="$sdk/share/wasi-sysroot" \
  -std=c++17 -O2 -fno-exceptions -fno-rtti -Wall -Wextra -Wpedantic \
  -mexec-model=reactor -Wl,--strip-all -Wl,--gc-sections \
  -I"$here/../include" \
  "$here/engine_wasm.cpp" "$here/../src/clock_map.cpp" "$here/../src/engine.cpp" \
  -o "$out"
