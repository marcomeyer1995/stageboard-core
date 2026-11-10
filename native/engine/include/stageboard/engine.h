#pragma once

#include <cstdint>
#include <vector>

#include "stageboard/click.h"
#include "stageboard/clock_map.h"
#include "stageboard/limiter.h"
#include "stageboard/spsc_queue.h"
#include "stageboard/transport.h"

namespace stageboard {

/** One beat of the rigid grid (docs/14 §5a), in song ms - the app computes them, not the engine. */
struct Beat {
  double songMs;
  bool accent;
};

/** The beats of one song, sorted by time. Built on the control thread, handed over whole. */
struct BeatPlan {
  std::vector<Beat> beats;
};

enum class Bus { Click = 0, Count };

/**
 * The audio engine's core, stage 1 of docs/30 §8h: no output of its own - `render` fills a buffer,
 * so it runs the same in a test, in AAudio's callback and (stage 2) as WASM in an AudioWorklet.
 *
 * Two sides: the control thread calls the setters, the audio thread only `render`. They meet in
 * lock-free queues; `render` never allocates, locks or frees. A replaced beat plan travels back
 * and is deleted by `collectGarbage` on the control thread.
 */
class Engine {
 public:
  Engine(double sampleRate, int channels);
  ~Engine();
  Engine(const Engine&) = delete;
  Engine& operator=(const Engine&) = delete;

  // Control thread. False when the queue is full (the audio thread is not running) - try again.
  bool setTransport(const Transport& transport);
  /** Takes ownership. */
  bool setBeats(BeatPlan* plan);
  bool setGain(Bus bus, float gain);
  bool setMasterGain(float gain);
  /** Output frame `frame` is heard at band time `bandMs` (output timestamp + clock sync). */
  bool observeClock(int64_t frame, double bandMs);
  /** Deletes beat plans the audio thread no longer uses. */
  void collectGarbage();

  /**
   * Audio thread: fills `frames` interleaved frames, the first of which is output frame
   * `firstFrame` - the same count `observeClock` speaks of.
   */
  void render(float* out, int frames, int64_t firstFrame);

  // Readable by the audio thread's owner for self-monitoring (§8i).
  int clockJumps() const { return clock_.jumps(); }
  double clockDriftPpm() const { return clock_.driftPpm(); }

 private:
  struct Command {
    enum class Type { Transport, Beats, Gain, MasterGain, Clock } type;
    Transport transport;
    BeatPlan* plan;
    int bus;
    float gain;
    int64_t frame;
    double bandMs;
  };

  void apply(const Command& command);
  void renderBlock(float* out, int frames, int64_t firstFrame);
  void scheduleClicks(double fromFrame, double toFrame, double startSongMs, double endSongMs, bool afterJump, int64_t firstFrame);
  void triggerClick(double frameInBlock, bool accent);

  double sampleRate_;
  int channels_;
  SpscQueue<Command, 256> commands_;
  SpscQueue<BeatPlan*, 64> retired_;

  // Audio thread only.
  Transport transport_;
  BeatPlan* plan_ = nullptr;
  ClockMap clock_;
  static constexpr int kVoices = 8;
  ClickVoice voices_[kVoices];
  float targetGain_[static_cast<int>(Bus::Count)];
  float gain_[static_cast<int>(Bus::Count)];
  float targetMaster_ = 1;
  float master_ = 1;
  float gainStep_;
  Limiter limiter_;
  static constexpr int kMaxBlock = 4096;
  float bus_[kMaxBlock];
};

}  // namespace stageboard
