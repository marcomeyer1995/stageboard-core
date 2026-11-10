// The engine core as WebAssembly (docs/30 §8h stage 2): a flat C interface for the AudioWorklet
// (stage-pwa lib/engineWorklet). JS can't pass 64-bit integers without BigInt, so frames travel as
// doubles - exact up to 2^53, ~5900 years at 48 kHz.
//
// In the worklet one thread does everything: messages from the main thread are applied between two
// `render` calls. The engine's queues still separate setters from rendering, so the core behaves
// exactly as in the native build.

#include <cstdint>
#include <cstdlib>

#include "stageboard/engine.h"

#define SB_EXPORT(name) extern "C" __attribute__((export_name(name)))

using stageboard::Engine;

namespace {

/** Planar output for the worklet: render interleaved, split per channel. */
struct Instance {
  Instance(double rate, int channels) : engine(rate, channels), channels(channels < 2 ? 1 : 2) {}
  Engine engine;
  int channels;
  float interleaved[128 * Engine::kMaxChannels];
};

}  // namespace

/** Memory for arguments JS fills in (beat lists, output buffers). */
SB_EXPORT("sb_alloc") void* sb_alloc(uint32_t bytes) { return std::malloc(bytes); }
SB_EXPORT("sb_free") void sb_free(void* p) { std::free(p); }

SB_EXPORT("sb_create") Instance* sb_create(double sampleRate, int channels) { return new Instance(sampleRate, channels); }
SB_EXPORT("sb_destroy") void sb_destroy(Instance* i) { delete i; }

/** `status`: 0 stopped, 1 playing, 2 paused (PlaybackStatus). */
SB_EXPORT("sb_set_transport")
int sb_set_transport(Instance* i, int status, double startedAt, double accumulatedMs, double rate, int hasJump,
                     double jumpAt, double jumpToMs, double jumpRate) {
  stageboard::Transport t;
  t.status = status == 1 ? stageboard::PlaybackStatus::Playing
             : status == 2 ? stageboard::PlaybackStatus::Paused
                           : stageboard::PlaybackStatus::Stopped;
  t.startedAt = startedAt;
  t.accumulatedMs = accumulatedMs;
  t.rate = rate;
  t.hasJump = hasJump != 0;
  t.jumpAt = jumpAt;
  t.jumpToMs = jumpToMs;
  t.jumpRate = jumpRate;
  return i->engine.setTransport(t);
}

/** `count` beats: song ms in `songMs`, 1 = downbeat in `accent` (both from sb_alloc, still JS's). */
SB_EXPORT("sb_set_beats")
int sb_set_beats(Instance* i, const double* songMs, const uint8_t* accent, int count) {
  auto* plan = new stageboard::BeatPlan();
  plan->beats.reserve(static_cast<size_t>(count));
  for (int b = 0; b < count; ++b) plan->beats.push_back({songMs[b], accent[b] != 0});
  return i->engine.setBeats(plan);
}

SB_EXPORT("sb_set_gain") int sb_set_gain(Instance* i, int bus, float gain) {
  if (bus < 0 || bus >= static_cast<int>(stageboard::Bus::Count)) return 0;
  return i->engine.setGain(static_cast<stageboard::Bus>(bus), gain);
}
SB_EXPORT("sb_set_master_gain") int sb_set_master_gain(Instance* i, float gain) { return i->engine.setMasterGain(gain); }

SB_EXPORT("sb_observe_clock") int sb_observe_clock(Instance* i, double frame, double bandMs) {
  return i->engine.observeClock(static_cast<int64_t>(frame), bandMs);
}

SB_EXPORT("sb_collect") void sb_collect(Instance* i) { i->engine.collectGarbage(); }

/** Up to 128 frames (one render quantum) into `left`/`right` (`right` ignored for mono). */
SB_EXPORT("sb_render")
void sb_render(Instance* i, float* left, float* right, int frames, double firstFrame) {
  if (frames > 128) frames = 128;
  i->engine.render(i->interleaved, frames, static_cast<int64_t>(firstFrame));
  if (i->channels == 1) {
    for (int f = 0; f < frames; ++f) left[f] = i->interleaved[f];
    return;
  }
  for (int f = 0; f < frames; ++f) {
    left[f] = i->interleaved[2 * f];
    right[f] = i->interleaved[2 * f + 1];
  }
}

SB_EXPORT("sb_clock_jumps") int sb_clock_jumps(Instance* i) { return i->engine.clockJumps(); }
SB_EXPORT("sb_clock_drift_ppm") double sb_clock_drift_ppm(Instance* i) { return i->engine.clockDriftPpm(); }
