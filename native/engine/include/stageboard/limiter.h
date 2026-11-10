#pragma once

#include <cmath>

namespace stageboard {

/**
 * The last thing before the output (docs/30 §8h): no sample ever leaves above `ceiling` (−1 dBFS),
 * however many sources add up. Reacts at once (no look-ahead - that would add latency) and lets go
 * over `releaseMs`. One gain for all channels, so the stereo image stays.
 */
class Limiter {
 public:
  explicit Limiter(double sampleRate, float ceiling = 0.891f, double releaseMs = 50)
      : ceiling_(ceiling), release_(1 - std::exp(-1000.0 / (releaseMs * sampleRate))) {}

  void process(float* interleaved, int frames, int channels) {
    for (int f = 0; f < frames; ++f) {
      float* frame = interleaved + f * channels;
      float peak = 0;
      for (int c = 0; c < channels; ++c) peak = std::fmax(peak, std::fabs(frame[c]));
      const double wanted = peak > ceiling_ ? ceiling_ / peak : 1.0;
      gain_ = wanted < gain_ ? wanted : gain_ + (wanted - gain_) * release_;
      // In double: in float the step near 1 fell below the resolution and the gain stayed at
      // 0.99993 for good after the first limited peak. The last billionth it jumps.
      if (wanted - gain_ < 1e-9) gain_ = wanted;
      for (int c = 0; c < channels; ++c) frame[c] = static_cast<float>(frame[c] * gain_);
    }
  }

  double gain() const { return gain_; }

 private:
  float ceiling_;
  double release_;
  double gain_ = 1;
};

}  // namespace stageboard
