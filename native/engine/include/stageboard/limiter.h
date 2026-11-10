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
      : ceiling_(ceiling), release_(static_cast<float>(1 - std::exp(-1000.0 / (releaseMs * sampleRate)))) {}

  void process(float* interleaved, int frames, int channels) {
    for (int f = 0; f < frames; ++f) {
      float* frame = interleaved + f * channels;
      float peak = 0;
      for (int c = 0; c < channels; ++c) peak = std::fmax(peak, std::fabs(frame[c]));
      const float wanted = peak > ceiling_ ? ceiling_ / peak : 1.0f;
      gain_ = wanted < gain_ ? wanted : gain_ + (wanted - gain_) * release_;
      for (int c = 0; c < channels; ++c) frame[c] *= gain_;
    }
  }

  float gain() const { return gain_; }

 private:
  float ceiling_;
  float release_;
  float gain_ = 1;
};

}  // namespace stageboard
