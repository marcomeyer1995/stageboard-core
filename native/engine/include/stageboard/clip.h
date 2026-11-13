#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

#include "stageboard/sinc.h"

namespace stageboard {

/**
 * Where a clip's audio comes from - a track, a stem, an announcement. Float, interleaved, at any
 * rate (Opus: 48 kHz, Piper: 22.05 kHz); the clip player resamples to the output. Made on the
 * control thread, handed to the engine whole (Engine::setClip).
 *
 * All of it in memory (ClipData) - or a window of it, decoded as the song moves (StreamedClip,
 * stream_clip.h): then a frame can be missing for a moment, and a piece read while the window
 * moved under it is thrown away (`endRead`), never played.
 */
class ClipSource {
 public:
  virtual ~ClipSource() = default;
  int channels = 2;
  double rate = 48000;
  /** Filled by Engine::setClip for the engine's output rate. */
  SincTable sinc;

  virtual long frames() const = 0;

  // Audio thread.
  /** The voice is about to read around `at`, nothing below `low` (source frames). */
  virtual void beginRead(double at, double low) {
    (void)at;
    (void)low;
  }
  /**
   * Source frames first .. first + n - 1 (`channels` floats each): where they lie one after
   * another (nearly always), `*run` points at the first; else `*run` is nullptr and `out` holds a
   * pointer per frame - nullptr for one outside the clip (silence). False if one inside isn't
   * there right now.
   */
  virtual bool fetch(long first, int n, const float** run, const float** out) = 0;
  /** Whether what was read since beginRead held - false: throw the piece away. */
  virtual bool endRead() { return true; }

  // Control thread.
  /**
   * Where the song is or starts (`start`), and where it goes next (`next`: a jump's target, or
   * where Play will start while it stands; -1 none) - in source frames.
   */
  virtual void prefetch(long start, long next) {
    (void)start;
    (void)next;
  }
  /** Does a bounded piece of decoding work (StreamedClip); nothing for a clip in memory. */
  virtual void pump() {}
};

/** A clip wholly in memory - announcements, tests; long tracks stream (stream_clip.h). */
struct ClipData : ClipSource {
  std::vector<float> samples;
  long frames() const override { return channels > 0 ? static_cast<long>(samples.size()) / channels : 0; }
  bool fetch(long first, int n, const float** run, const float** out) override {
    const long count = frames();
    if (first >= 0 && first + n <= count) {
      *run = samples.data() + first * channels;
      return true;
    }
    *run = nullptr;
    for (int j = 0; j < n; ++j) {
      const long i = first + j;
      out[j] = i < 0 || i >= count ? nullptr : samples.data() + i * channels;
    }
    return true;
  }
};

/**
 * Plays one clip so that its frame (songMs - songStartMs) · rate is heard exactly when the song is
 * there. Each piece of output gets the source positions wanted at its start and end; in between it
 * reads at the speed that lands on them - so it follows the device's drift and the clock map's
 * gliding without a step. Too far off (a jump, a seek) it cross-fades to the new place over 5 ms;
 * stopping and resuming mid-clip fade too, so nothing clicks. Positions are in the clip's own
 * frames; reading between them is the resampler (sinc.h), so a 48 kHz clip plays on a 44.1 kHz
 * output and follows the drift in one go.
 *
 * Where the source has no data yet (a stream still decoding), the voice is silent and fades back
 * in once it has - a gap, never a click or stale sound.
 *
 * Speed ≠ 1 (the loop trainer's slower passes) changes the pitch for now - time-stretching
 * (Signalsmith) comes with stage 4.
 */
class ClipVoice {
 public:
  /** Beyond this the voice re-places instead of catching up (20 ms at 48 kHz). */
  static constexpr double kSeekFrames = 960;
  /** Fades and cross-fades. */
  static constexpr int kFadeFrames = 240;
  /** Catching up never reads faster/slower than ±0.5 % (≈ 9 cents) - the clock map glides far
   * less, so in practice only a fresh start or tiny rounding uses it. */
  static constexpr double kMaxSpeedChange = 0.005;

  void setData(ClipSource* data) {
    data_ = data;
    started_ = false;
    gain_ = 0;
    fadeLeft_ = 0;
  }
  const ClipSource* data() const { return data_; }

  /**
   * Adds `frames` frames into the interleaved `out` (`channels` wide). `playing`: the song runs;
   * `from` / `to`: source positions wanted at this piece's first frame and just after its last.
   * False when the source's data moved while it was read - the caller drops what this piece added
   * (it rendered into a scratch buffer) and the voice fades in again.
   */
  bool render(float* out, int frames, int channels, bool playing, double from, double to, float level) {
    if (!data_ || frames <= 0) return true;
    const double margin = data_->sinc.left() + 2;
    if (!playing) {
      // Pause/stop: let the sound fade out from where it is.
      if (!started_ || gain_ <= 0) {
        started_ = false;
        return true;
      }
      data_->beginRead(pos_, pos_ - margin);
      for (int i = 0; i < frames && gain_ > 0; ++i) {
        gain_ = std::fmax(0.0f, gain_ - 1.0f / kFadeFrames);
        if (!add(out, i, channels, pos_, gain_ * level)) gain_ = 0;
        pos_ += 1;
      }
      if (gain_ <= 0) started_ = false;
      return intact();
    }
    data_->beginRead(from, std::fmin(started_ ? pos_ : from, from) - margin);
    if (!started_ || std::fabs(from - pos_) > kSeekFrames) {
      if (started_ && gain_ > 0) {
        // Jump/seek: the old place fades out while the new one fades in.
        oldPos_ = pos_;
        oldGain_ = gain_;
        fadeLeft_ = kFadeFrames;
      }
      pos_ = from;
      // At (or before) the clip's own beginning there is nothing to fade: it starts with silence.
      gain_ = from <= 0.5 && !fadeLeft_ ? 1.0f : 0.0f;
      started_ = true;
    }
    double speed = (to - pos_) / frames;
    speed = std::fmin(std::fmax(speed, (to - from) / frames * (1 - kMaxSpeedChange)), (to - from) / frames * (1 + kMaxSpeedChange));
    for (int i = 0; i < frames; ++i) {
      if (gain_ < 1) gain_ = std::fmin(1.0f, gain_ + 1.0f / kFadeFrames);
      // Nothing there (yet): silent, and fading in from nothing once there is.
      if (!add(out, i, channels, pos_, gain_ * level)) gain_ = 0;
      if (fadeLeft_ > 0) {
        if (!add(out, i, channels, oldPos_, oldGain_ * level * static_cast<float>(fadeLeft_) / kFadeFrames)) fadeLeft_ = 1;
        oldPos_ += speed;
        --fadeLeft_;
      }
      pos_ += speed;
    }
    return intact();
  }

  double position() const { return pos_; }

 private:
  bool intact() {
    if (data_->endRead()) return true;
    gain_ = 0;
    fadeLeft_ = 0;
    return false;
  }

  /** The clip at source position `pos`, band-limited (sinc.h); silence outside the clip. False
   * when the source hasn't got those frames now. */
  bool add(float* out, int frame, int channels, double pos, float gain) const {
    const SincTable& sinc = data_->sinc;
    const int taps = sinc.taps();
    const double whole = std::floor(pos);
    const long first = static_cast<long>(whole) - sinc.left();  // first tap's source frame
    if (first >= data_->frames() || first + taps <= 0) return true;
    const float* run = nullptr;
    const float* tap[SincTable::kMaxTaps];
    if (!data_->fetch(first, taps, &run, tap)) return false;
    if (gain == 0) return true;
    float w[SincTable::kMaxTaps];
    sinc.weights(pos - whole, w);
    float sum[2] = {0, 0};
    const int src = data_->channels;
    if (run && src == 1) {
      for (int j = 0; j < taps; ++j) sum[0] += w[j] * run[j];
      sum[1] = sum[0];
    } else if (run) {
      for (int j = 0; j < taps; ++j) {
        sum[0] += w[j] * run[2 * j];
        sum[1] += w[j] * run[2 * j + 1];
      }
    } else if (src == 1) {
      for (int j = 0; j < taps; ++j)
        if (tap[j]) sum[0] += w[j] * tap[j][0];
      sum[1] = sum[0];
    } else {
      for (int j = 0; j < taps; ++j) {
        if (!tap[j]) continue;
        sum[0] += w[j] * tap[j][0];
        sum[1] += w[j] * tap[j][1];
      }
    }
    for (int c = 0; c < channels; ++c) out[frame * channels + c] += gain * sum[c < 2 ? c : 1];
    return true;
  }

  ClipSource* data_ = nullptr;
  bool started_ = false;
  double pos_ = 0;
  float gain_ = 0;
  double oldPos_ = 0;
  float oldGain_ = 0;
  int fadeLeft_ = 0;
};

}  // namespace stageboard
