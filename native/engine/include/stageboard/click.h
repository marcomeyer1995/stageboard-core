#pragma once

#include <cmath>

namespace stageboard {

/**
 * The click, computed (docs/30 §8h) - the same sound as stage-pwa's clickEngine.ts: a sine,
 * 1500 Hz on the downbeat and 1000 Hz otherwise, from 0.5 / 0.35 decaying exponentially to 0.001
 * within 30 ms. Starts at a fractional frame, so its onset is exact to below one sample.
 */
class ClickVoice {
 public:
  static constexpr double kDurationS = 0.03;
  static constexpr double kFloor = 0.001;

  /** Starts at fractional frame `start` of the next render (may be ≥ its length - then it waits). */
  void trigger(double start, bool accent, double sampleRate) {
    active_ = true;
    start_ = start;
    sampleRate_ = sampleRate;
    hz_ = accent ? 1500 : 1000;
    gain_ = accent ? 0.5 : 0.35;
    // gain · (floor / gain)^(t / duration) = gain · e^(−t / tau)
    tau_ = kDurationS / std::log(gain_ / kFloor);
  }

  bool active() const { return active_; }

  /** Adds `frames` mono samples into `out`, then moves its start to the next render's frame 0. */
  void render(float* out, int frames) {
    if (!active_) return;
    const double endFrame = start_ + kDurationS * sampleRate_;
    const int first = start_ <= 0 ? 0 : static_cast<int>(std::ceil(start_));
    const int last = endFrame < frames ? static_cast<int>(std::ceil(endFrame)) : frames;
    constexpr double twoPi = 6.283185307179586;
    for (int i = first; i < last; ++i) {
      const double t = (i - start_) / sampleRate_;
      out[i] += static_cast<float>(gain_ * std::exp(-t / tau_) * std::sin(twoPi * hz_ * t));
    }
    start_ -= frames;
    if (endFrame <= frames) active_ = false;
  }

 private:
  bool active_ = false;
  double start_ = 0;
  double sampleRate_ = 48000;
  double hz_ = 1000;
  double gain_ = 0.35;
  double tau_ = 0.01;
};

}  // namespace stageboard
