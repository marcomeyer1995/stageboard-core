#pragma once

#include <cmath>
#include <vector>

namespace stageboard {

/**
 * The resampler: windowed-sinc interpolation between source samples, read at any position. The
 * clip player reads its source at the speed that lands on the song's place - the ratio of the clip's
 * rate to the output's (48 → 44.1 kHz) times the device's drift - so this one table does both, with
 * no buffer and no delay of its own.
 *
 * `cutoff` (relative to the source's Nyquist) is min(1, output rate / source rate): below 1 it
 * keeps what the output can't carry from folding back. At exactly 1 a whole-sample position is the
 * sample itself, so a clip at the output's own rate plays bit-exact.
 *
 * Length, measured (resample_test): at the same rate (only drift) 32 taps keep 10-16 kHz > 90 dB
 * clean. 48 → 44.1 kHz needs 64 for 20 kHz (72 dB; 32 taps: 23 dB, 48: 39 dB). What lies above
 * 22.05 kHz is only damped 21 dB at 23 kHz, but it folds back to above 20 kHz - inaudible, and
 * Opus carries nothing above 20 kHz anyway. A lower cutoff would damp it more but cost 20 kHz
 * itself (×0.96: 27 dB). Cost on the laptop for 6 stereo clips: 32 taps 0.7 %, 64 taps 1.3 % of a core.
 *
 * Built on the control thread (allocates); `weights` is real-time safe.
 */
class SincTable {
 public:
  static constexpr int kMaxTaps = 64;
  static constexpr int kPhases = 256;

  void build(double cutoff) {
    cutoff_ = cutoff;
    taps_ = cutoff >= 1 ? 32 : 64;
    left_ = taps_ / 2 - 1;
    table_.assign(static_cast<size_t>(kPhases + 1) * static_cast<size_t>(taps_), 0.0f);
    const double pi = 3.14159265358979323846;
    const double half = taps_ / 2.0;
    for (int p = 0; p <= kPhases; ++p) {
      const double frac = static_cast<double>(p) / kPhases;
      float* row = &table_[static_cast<size_t>(p) * static_cast<size_t>(taps_)];
      double sum = 0;
      double w[kMaxTaps];
      for (int j = 0; j < taps_; ++j) {
        const double x = (j - left_) - frac;  // distance of the tap from the read position
        const double r = x / half;
        const double window = std::fabs(r) >= 1 ? 0 : besselI0(kBeta * std::sqrt(1 - r * r)) / besselI0(kBeta);
        const double s = x == 0 ? 1 : std::sin(pi * cutoff * x) / (pi * cutoff * x);
        w[j] = cutoff * s * window;
        sum += w[j];
      }
      // Unity gain at DC for every phase: no ripple in level as the position moves.
      for (int j = 0; j < taps_; ++j) row[j] = static_cast<float>(w[j] / sum);
      if (cutoff >= 1 && (p == 0 || p == kPhases)) {
        // sin(πk) isn't exactly 0 in floating point - make the whole-sample rows a clean pulse.
        for (int j = 0; j < taps_; ++j) row[j] = 0;
        row[p == 0 ? left_ : left_ + 1] = 1;
      }
    }
  }

  bool ready() const { return !table_.empty(); }
  double cutoff() const { return cutoff_; }
  int taps() const { return taps_; }
  /** Tap j weights the source sample at floor(position) + j - left(). */
  int left() const { return left_; }

  /** The taps() weights for a read position `frac` (0 ≤ frac < 1) past a whole sample. */
  void weights(double frac, float* out) const {
    const double at = frac * kPhases;
    const int p = static_cast<int>(at);
    const float t = static_cast<float>(at - p);
    const float* a = &table_[static_cast<size_t>(p) * static_cast<size_t>(taps_)];
    const float* b = a + taps_;
    if (t == 0) {
      for (int j = 0; j < taps_; ++j) out[j] = a[j];
      return;
    }
    for (int j = 0; j < taps_; ++j) out[j] = a[j] + (b[j] - a[j]) * t;
  }

 private:
  /** Kaiser window shape: ~−90 dB side lobes. */
  static constexpr double kBeta = 9;

  static double besselI0(double x) {
    double sum = 1, term = 1;
    for (int k = 1; k < 50; ++k) {
      term *= (x / (2 * k)) * (x / (2 * k));
      sum += term;
      if (term < 1e-12 * sum) break;
    }
    return sum;
  }

  double cutoff_ = 0;
  int taps_ = 0;
  int left_ = 0;
  std::vector<float> table_;
};

}  // namespace stageboard
