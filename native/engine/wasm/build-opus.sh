#!/usr/bin/env bash
# Builds the track encoder (libopus + opus_writer.cpp) as WebAssembly with wasi-sdk 29 - see
# build.sh for where the SDK comes from. Usage: build-opus.sh <out.wasm>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sdk="${WASI_SDK:-$HOME/.local/opt/wasi-sdk-29.0-x86_64-linux}"
out="${1:?usage: build-opus.sh <out.wasm>}"
opus="$here/../third_party/opus"
# libopus' own source lists (what its CMake reads too): the float build without x86/ARM code and
# without the neural extensions.
lists() {
  for v in "$@"; do
    awk -v v="$v" '$1 == v && $2 == "=" { on = 1; sub(/^[^=]*= */, ""); }
      on { line = $0; cont = sub(/\\[ \t]*$/, "", line); n = split(line, f, /[ \t]+/); for (i = 1; i <= n; i++) if (f[i] != "") print f[i]; if (!cont) on = 0 }' "$opus"/*.mk
  done
}
mapfile -t sources < <(lists CELT_SOURCES SILK_SOURCES SILK_SOURCES_FLOAT OPUS_SOURCES OPUS_SOURCES_FLOAT)
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
objects=()
for s in "${sources[@]}"; do
  o="$work/$(echo "$s" | tr / _).o"
  "$sdk/bin/clang" --target=wasm32-wasip1 --sysroot="$sdk/share/wasi-sysroot" -O2 -std=c99 \
    -DOPUS_BUILD -DVAR_ARRAYS -DHAVE_LRINT -DHAVE_LRINTF -DDISABLE_DEBUG_FLOAT -DNDEBUG -DPACKAGE_VERSION='"1.5.2"' \
    -I"$opus/include" -I"$opus/celt" -I"$opus/silk" -I"$opus/silk/float" -I"$opus/src" -I"$opus/dnn" -I"$opus" \
    -ffile-prefix-map="$opus"=opus -c "$opus/$s" -o "$o"
  objects+=("$o")
done
"$sdk/bin/clang++" --target=wasm32-wasip1 --sysroot="$sdk/share/wasi-sysroot" \
  -std=c++17 -O2 -fno-exceptions -fno-rtti -Wall -Wextra \
  -mexec-model=reactor -Wl,--strip-all -Wl,--gc-sections \
  -I"$here/../include" -I"$opus/include" -I"$here/../src" \
  "$here/opus_wasm.cpp" "$here/../src/opus_writer.cpp" "$here/../src/opus_clip.cpp" "${objects[@]}" \
  -o "$out"
