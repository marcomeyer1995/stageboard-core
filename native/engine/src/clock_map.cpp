#include "stageboard/clock_map.h"

#include <algorithm>
#include <cmath>

namespace stageboard {

ClockMap::ClockMap(double sampleRate, Options options) : options_(options), nominalMsPerFrame_(1000.0 / sampleRate) {}

void ClockMap::observe(int64_t frame, double bandMs) {
  if (!valid_) {
    valid_ = true;
    anchorFrame_ = frame;
    anchorBandMs_ = bandMs;
    lastFrame_ = frame;
    return;
  }
  const double predicted = bandMsAt(static_cast<double>(frame));
  const double error = bandMs - predicted;
  if (std::fabs(error) > options_.jumpMs) {
    ++jumps_;
    anchorFrame_ = frame;
    anchorBandMs_ = bandMs;
    slewPerFrame_ = 0;
    slewFrames_ = 0;
    lastFrame_ = frame;
    return;
  }
  // Learn the drift gently from what was off since the last observation.
  const double elapsedMs = static_cast<double>(frame - lastFrame_) * nominalMsPerFrame_;
  if (elapsedMs > 0) {
    const double maxRatio = options_.maxDriftPpm * 1e-6;
    ratio_ = std::clamp(ratio_ + options_.driftGain * error / elapsedMs, 1 - maxRatio, 1 + maxRatio);
  }
  lastFrame_ = frame;
  // Continue from where the map stands now and glide the rest of the error in.
  anchorFrame_ = frame;
  anchorBandMs_ = predicted;
  const double minFrames = std::fabs(error) / (options_.maxSlewPpm * 1e-6 * msPerFrame());
  slewFrames_ = std::max(options_.slewMs / nominalMsPerFrame_, minFrames);
  slewPerFrame_ = error / slewFrames_;
}

double ClockMap::bandMsAt(double frame) const {
  const double since = frame - static_cast<double>(anchorFrame_);
  const double glided = since <= 0 ? 0 : std::min(since, slewFrames_);
  return anchorBandMs_ + since * msPerFrame() + glided * slewPerFrame_;
}

double ClockMap::frameAt(double bandMs) const {
  const double gliding = msPerFrame() + slewPerFrame_;
  const double slewEndBandMs = anchorBandMs_ + slewFrames_ * gliding;
  const double anchor = static_cast<double>(anchorFrame_);
  if (bandMs <= anchorBandMs_) return anchor + (bandMs - anchorBandMs_) / msPerFrame();
  if (bandMs <= slewEndBandMs) return anchor + (bandMs - anchorBandMs_) / gliding;
  return anchor + slewFrames_ + (bandMs - slewEndBandMs) / msPerFrame();
}

}  // namespace stageboard
