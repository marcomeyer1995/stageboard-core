// The track encoder as WebAssembly (docs/30 §8h): the uploading device makes the Opus file itself
// (stage-pwa lib/engine/opusEncode.ts). Its own module - the audio engine's (engine_wasm.cpp) stays
// small and carries no encoder.

#include <cstdint>
#include <cstdlib>
#include <string>

#include "stageboard/opus_clip.h"
#include "stageboard/opus_writer.h"

#define SB_EXPORT(name) extern "C" __attribute__((export_name(name)))

using stageboard::OpusWriter;

SB_EXPORT("sb_alloc") void* sb_alloc(uint32_t bytes) { return std::malloc(bytes); }
SB_EXPORT("sb_free") void sb_free(void* p) { std::free(p); }

/** 0 when libopus refuses the settings. */
SB_EXPORT("sb_enc_start") OpusWriter* sb_enc_start(int channels, int bitrate) {
  auto* w = new OpusWriter();
  OpusWriter::Options o;
  o.channels = channels;
  o.bitrate = bitrate;
  if (w->start(o)) return w;
  delete w;
  return nullptr;
}

/** `frames` interleaved 48 kHz frames from `pcm`. */
SB_EXPORT("sb_enc_write") void sb_enc_write(OpusWriter* w, const float* pcm, int frames) { w->write(pcm, frames); }
SB_EXPORT("sb_enc_finish") void sb_enc_finish(OpusWriter* w) { w->finish(); }

/** What is finished so far: its bytes at sb_enc_data, sb_enc_size long - read them, then sb_enc_clear. */
SB_EXPORT("sb_enc_data") const uint8_t* sb_enc_data(OpusWriter* w) { return w->output().data(); }
SB_EXPORT("sb_enc_size") uint32_t sb_enc_size(OpusWriter* w) { return static_cast<uint32_t>(w->output().size()); }
SB_EXPORT("sb_enc_clear") void sb_enc_clear(OpusWriter* w) { w->take(); }
SB_EXPORT("sb_enc_destroy") void sb_enc_destroy(OpusWriter* w) { delete w; }

/**
 * Reads a finished file as the players will (OpusClip): its playable frames, or -1 when it is
 * broken - checked before it is uploaded.
 */
SB_EXPORT("sb_check") double sb_check(const uint8_t* data, uint32_t size) {
  stageboard::OpusClip clip;
  return clip.open(data, size) ? static_cast<double>(clip.frames()) : -1;
}
