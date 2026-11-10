#pragma once

#include <cmath>
#include <vector>

#include "stageboard/sinc.h"

namespace stageboard {

/** Decoded audio of one clip - a track, a stem, an announcement. Float, interleaved, at any rate
 * (Opus: 48 kHz, Piper: 22.05 kHz); the clip player resamples to the output. Built on the control
 * thread. */
struct ClipData {
  std::vector<float> samples;
  int channels = 2;
  double rate = 48000;
  /** Filled by Engine::setClip for the engine's output rate. */
  SincTable sinc;
  long frames() const { return channels > 0 ? static_cast<long>(samples.size()) / channels : 0; }
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

  void setData(const ClipData* data) {
    data_ = data;
    started_ = false;
    gain_ = 0;
    fadeLeft_ = 0;
  }
  const ClipData* data() const { return data_; }

  /**
   * Adds `frames` frames into the interleaved `out` (`channels` wide). `playing`: the song runs;
   * `from` / `to`: source positions wanted at this piece's first frame and just after its last.
   */
  void render(float* out, int frames, int channels, bool playing, double from, double to, float level) {
    if (!data_ || frames <= 0) return;
    if (!playing) {
      // Pause/stop: let the sound fade out from where it is.
      if (started_ && gain_ > 0) {
        for (int i = 0; i < frames && gain_ > 0; ++i) {
          gain_ = std::fmax(0.0f, gain_ - 1.0f / kFadeFrames);
          add(out, i, channels, pos_, gain_ * level);
          pos_ += 1;
        }
      }
      if (gain_ <= 0) started_ = false;
      return;
    }
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
      add(out, i, channels, pos_, gain_ * level);
      if (fadeLeft_ > 0) {
        add(out, i, channels, oldPos_, oldGain_ * level * static_cast<float>(fadeLeft_) / kFadeFrames);
        oldPos_ += speed;
        --fadeLeft_;
      }
      pos_ += speed;
    }
  }

  double position() const { return pos_; }

 private:
  /** The clip at source position `pos`, band-limited (sinc.h); silence outside the clip. */
  void add(float* out, int frame, int channels, double pos, float gain) const {
    const SincTable& sinc = data_->sinc;
    const int taps = sinc.taps();
    const long frames = data_->frames();
    const double whole = std::floor(pos);
    const long first = static_cast<long>(whole) - sinc.left();  // first tap's source frame
    if (gain == 0 || first >= frames || first + taps <= 0) return;
    float w[SincTable::kMaxTaps];
    sinc.weights(pos - whole, w);
    const int src = data_->channels;
    const float* s = data_->samples.data();
    float sum[2] = {0, 0};
    // Taps beyond either end of the clip read silence.
    const int from = first < 0 ? static_cast<int>(-first) : 0;
    const int to = first + taps > frames ? static_cast<int>(frames - first) : taps;
    if (src == 1) {
      for (int j = from; j < to; ++j) sum[0] += w[j] * s[first + j];
      sum[1] = sum[0];
    } else {
      for (int j = from; j < to; ++j) {
        const float* f = s + (first + j) * 2;
        sum[0] += w[j] * f[0];
        sum[1] += w[j] * f[1];
      }
    }
    for (int c = 0; c < channels; ++c) out[frame * channels + c] += gain * sum[c < 2 ? c : 1];
  }

  const ClipData* data_ = nullptr;
  bool started_ = false;
  double pos_ = 0;
  float gain_ = 0;
  double oldPos_ = 0;
  float oldGain_ = 0;
  int fadeLeft_ = 0;
};

}  // namespace stageboard
