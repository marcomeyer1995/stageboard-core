#pragma once

#include <cstdint>
#include <vector>

#include "stageboard/click.h"
#include "stageboard/clip.h"
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

/** Where a source is mixed - each with its own level (Mein Mix / Bühnen-Mix). */
enum class Bus { Click = 0, Track, Stem, Announce, Count };

/**
 * The audio engine's core, stage 1 of docs/30 §8h: no output of its own - `render` fills a buffer,
 * so it runs the same in a test, in AAudio's callback and (stage 2) as WASM in an AudioWorklet.
 *
 * Two sides: the control thread calls the setters, the audio thread only `render`. They meet in
 * lock-free queues; `render` never allocates, locks or frees. Replaced beat plans and clip data
 * travel back and are deleted by `collectGarbage` on the control thread.
 */
class Engine {
 public:
  static constexpr int kMaxChannels = 2;
  static constexpr int kMaxClips = 32;

  /** `channels` 1 or 2 (several outputs come with stage 5). */
  Engine(double sampleRate, int channels);
  ~Engine();
  Engine(const Engine&) = delete;
  Engine& operator=(const Engine&) = delete;

  // Control thread. False when the queue is full (the audio thread is not running) - try again.
  bool setTransport(const Transport& transport);
  /** Takes ownership. */
  bool setBeats(BeatPlan* plan);
  /**
   * Places clip `id` (0..kMaxClips-1) so its first frame sounds at song time `songStartMs`; takes
   * ownership of `data` (mono or stereo, any rate - resampled to the output). Replaces what had
   * that id.
   */
  bool setClip(int id, ClipData* data, double songStartMs, Bus bus, float gain = 1);
  bool removeClip(int id);
  bool setClipGain(int id, float gain);
  bool setGain(Bus bus, float gain);
  bool setMasterGain(float gain);
  /** Output frame `frame` is heard at band time `bandMs` (output timestamp + clock sync). */
  bool observeClock(int64_t frame, double bandMs);
  /** Deletes what the audio thread no longer uses. */
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
    enum class Type { Transport, Beats, Clip, RemoveClip, ClipGain, Gain, MasterGain, Clock } type;
    Transport transport;
    BeatPlan* plan;
    ClipData* clip;
    int id;
    double songStartMs;
    int bus;
    float gain;
    int64_t frame;
    double bandMs;
  };

  /** A stretch of one block in which the song runs on one line (a jump splits a block in two). */
  struct Segment {
    double from, to;  // frames within the block
    double songFrom, songTo;
    bool afterJump;
  };

  struct ClipSlot {
    ClipVoice voice;
    ClipData* data = nullptr;
    double songStartMs = 0;
    int bus = 0;
    float gain = 1;
  };

  void apply(const Command& command);
  void retire(ClipData* data);
  void renderBlock(float* out, int frames, int64_t firstFrame);
  int segments(int frames, int64_t firstFrame, Segment* out) const;
  void scheduleClicks(const Segment& segment, int64_t firstFrame);
  void triggerClick(double frameInBlock, bool accent);

  double sampleRate_;
  int channels_;
  SpscQueue<Command, 256> commands_;
  SpscQueue<BeatPlan*, 64> retiredPlans_;
  SpscQueue<ClipData*, 128> retiredClips_;

  // Audio thread only.
  Transport transport_;
  BeatPlan* plan_ = nullptr;
  ClockMap clock_;
  static constexpr int kVoices = 8;
  ClickVoice voices_[kVoices];
  ClipSlot clips_[kMaxClips];
  static constexpr int kBuses = static_cast<int>(Bus::Count);
  float targetGain_[kBuses];
  float gain_[kBuses];
  float targetMaster_ = 1;
  float master_ = 1;
  float gainStep_;
  Limiter limiter_;
  static constexpr int kMaxBlock = 2048;
  float click_[kMaxBlock];
  float bus_[kBuses][kMaxBlock * kMaxChannels];
};

}  // namespace stageboard
