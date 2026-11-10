#pragma once

#include <cmath>
#include <vector>

namespace stageboard {

/** Decoded audio of one clip - a track, a stem, an announcement. Float, interleaved, at the engine's
 * sample rate (other rates go through the resampler first). Built on the control thread. */
struct ClipData {
  std::vector<float> samples;
  int channels = 2;
  long frames() const { return channels > 0 ? static_cast<long>(samples.size()) / channels : 0; }
};

/**
 * Plays one clip so that its frame (songMs - songStartMs) · rate is heard exactly when the song is
 * there. Each piece of output gets the source positions wanted at its start and end; in between it
 * reads at the speed that lands on them - so it follows the device's drift and the clock map's
 * gliding without a step. Too far off (a jump, a seek) it cross-fades to the new place over 5 ms;
 * stopping and resuming mid-clip fade too, so nothing clicks.
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
  /** Linear interpolation between two source frames; silence outside the clip. */
  void add(float* out, int frame, int channels, double pos, float gain) const {
    const long frames = data_->frames();
    if (pos < 0 || pos >= frames || gain == 0) return;
    const long i = static_cast<long>(pos);
    const float frac = static_cast<float>(pos - static_cast<double>(i));
    const int src = data_->channels;
    const float* a = data_->samples.data() + i * src;
    const float* b = i + 1 < frames ? a + src : a;
    for (int c = 0; c < channels; ++c) {
      const int s = c < src ? c : src - 1;  // mono to every channel, stereo to L/R
      out[frame * channels + c] += gain * (a[s] + (b[s] - a[s]) * frac);
    }
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
