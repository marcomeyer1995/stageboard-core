#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "stageboard/clip.h"
#include "stageboard/opus_clip.h"

namespace stageboard {

/**
 * A track or stem streamed from its Opus file (docs/30 §8h stage 4): the file stays compressed in
 * memory (~6 MB for 5 minutes at 160 kbit/s), only a window around the playing place is decoded -
 * 2 × 2.7 s per stereo clip instead of 115 MB for the whole song.
 *
 * Two windows ("lanes"), each with its own decoder over the shared file: one follows where the
 * voice reads, the other is filled ahead for where the song goes next - a section jump's target,
 * where Play starts (`prefetch`). At the jump the voice cross-fades from one to the other, nothing
 * to wait for. After it the roles swap. A place nobody announced (a seek) is decoded once the voice
 * asks for it; until then the voice is silent and fades in.
 *
 * Threads: the control thread decodes (`pump`, bounded work per call - Engine::pump), the audio
 * thread reads (`fetch` between `beginRead` / `endRead`). Each lane's readable frames [lo, hi) are
 * published atomically; the decoder never overwrites below the lowest frame the reader announced
 * (`beginRead`), and a lane it moves elsewhere gets a new generation - a piece read across that is
 * reported broken by `endRead` and dropped by the voice, never played.
 */
class StreamedClip : public ClipSource {
 public:
  /** `ringFrames`: each lane's window, a power of two (default 2^17 ≈ 2.7 s at 48 kHz). */
  explicit StreamedClip(int ringFrames = 1 << 17);

  /** Control thread: parses the file (checks as OpusClip::open). */
  bool open(const uint8_t* data, size_t size, std::string* error = nullptr);

  long frames() const override { return frames_; }

  // Audio thread.
  void beginRead(double at, double low) override;
  bool fetch(long first, int n, const float** run, const float** out) override;
  bool endRead() override;

  // Control thread.
  void prefetch(long start, long next) override;
  void pump() override;

  /** Decoded ahead of the reading place - well above any block. */
  long aheadFrames() const { return ahead_; }
  /** A lane is placed this far before its target - room for the resampler's taps and a fade. */
  static constexpr long kBehind = 1024;
  /** Decoded per lane and `pump` call at most (100 ms at 48 kHz) - one call stays short. */
  static constexpr int kChunk = 4800;
  /** A prefetched lane is filled this far past its target (at most its window), the rest once it plays. */
  static constexpr long kPrefetchFrames = 24000;

  /** Self-monitoring (docs/30 §8i): pieces dropped because a window moved while read, and
   * pieces with frames missing - the decoder fell behind or a seek came unannounced. Running dry
   * cuts the sound off hard (there is nothing to fade out with); it fades in again. */
  int brokenReads() const { return broken_.load(std::memory_order_relaxed); }
  int missingReads() const { return missingCount_.load(std::memory_order_relaxed); }

 private:
  struct Lane {
    std::vector<float> ring;
    std::atomic<long> lo{0};
    std::atomic<long> hi{0};
    std::atomic<unsigned> generation{0};
    OpusClip decoder;  // control thread; decodes frame hi next
  };

  int covering(long frame, long until) const;
  void place(int lane, long frame);
  void fill(int lane, long until, long low);

  int ringFrames_;
  long mask_;
  long frames_ = 0;
  long ahead_;
  Lane lanes_[2];

  // Published by the reader.
  std::atomic<double> at_{0};
  std::atomic<double> low_{0};
  std::atomic<bool> reading_{false};
  std::atomic<int> broken_{0};
  std::atomic<int> missingCount_{0};

  // Reader only: which lanes this piece read, from which frame, at which generation.
  struct Read {
    bool used = false;
    long min = 0;
    unsigned generation = 0;
  };
  Read read_[2];
  bool missing_ = false;

  // Control only.
  long start_ = 0;
  long want_ = -1;
};

}  // namespace stageboard
