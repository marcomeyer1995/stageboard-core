#include "stageboard/clock_map.h"

#include <algorithm>
#include <cmath>

namespace stageboard {

namespace {

/** Mean of the middle half of `n` values (the interquartile mean), reordering them: as robust as
 * the median against wild values, but steadier on plain noise - it averages the middle instead of
 * picking one value from it. */
double middleMean(double* v, int n) {
  if (n < 4) {
    std::sort(v, v + n);
    return n % 2 ? v[n / 2] : 0.5 * (v[n / 2 - 1] + v[n / 2]);
  }
  std::sort(v, v + n);
  const int from = n / 4, to = n - n / 4;
  double sum = 0;
  for (int i = from; i < to; ++i) sum += v[i];
  return sum / (to - from);
}

}  // namespace

ClockMap::ClockMap(double sampleRate, Options options) : options_(options), nominalMsPerFrame_(1000.0 / sampleRate) {}

void ClockMap::restartWindow(int64_t frame, double bandMs) {
  stepPending_ = false;
  anchorAt(frame, bandMs);
  count_ = 0;
  off_ = 0;
  holdDrift_ = driftKnown_;
  push(frame, bandMs);
}

void ClockMap::anchorAt(int64_t frame, double bandMs) {
  anchorFrame_ = frame;
  anchorBandMs_ = bandMs;
  slewPerFrame_ = 0;
  slewFrames_ = 0;
}

void ClockMap::push(int64_t frame, double bandMs) {
  window_[head_] = {frame, bandMs};
  head_ = (head_ + 1) % kWindow;
  count_ = std::min(count_ + 1, kWindow);
}

double ClockMap::fittedRatio() const {
  // Each slope spans half the window: a few ms of noise move it by little, and the middle mean
  // leaves the wild ones out.
  const int half = count_ / 2;
  double slopes[kWindow];
  int n = 0;
  for (int i = 0; i + half < count_; ++i) {
    const Observation& a = at(i);
    const Observation& b = at(i + half);
    slopes[n++] = (b.bandMs - a.bandMs) / (static_cast<double>(b.frame - a.frame) * nominalMsPerFrame_);
  }
  return middleMean(slopes, n);
}

void ClockMap::observe(int64_t frame, double bandMs) {
  if (!valid_ || (count_ > 0 && frame <= at(count_ - 1).frame)) {
    // The first observation - or the frame count went back (the output restarted): start over.
    if (valid_) ++jumps_;
    valid_ = true;
    restartWindow(frame, bandMs);
    return;
  }
  if (stepPending_) {
    // The output's frame clock stepped (markStep): the old observations describe the old clock.
    stepPending_ = false;
    ++jumps_;
    restartWindow(frame, bandMs);
    return;
  }
  const double predicted = clockMsAt(static_cast<double>(frame));
  const double error = bandMs - predicted;
  if (std::fabs(error) > options_.jumpMs) {
    const int sign = error > 0 ? 1 : -1;
    off_ = sign == offSign_ ? off_ + 1 : 1;
    offSign_ = sign;
    if (off_ < options_.confirmations) {
      ++outliers_;
      return;
    }
    // Confirmed: the clock really moved (a clock-sync step, a new latency). The old observations
    // describe the old clock; the learned drift stays.
    ++jumps_;
    outliers_ -= options_.confirmations - 1;
    restartWindow(frame, bandMs);
    return;
  }
  off_ = 0;
  push(frame, bandMs);

  // From here the map runs on from where it stands now - no step at this frame.
  anchorAt(frame, predicted);
  const double span = static_cast<double>(frame - at(0).frame) * nominalMsPerFrame_;
  if (span >= (holdDrift_ ? options_.refitSpanMs : options_.minSpanMs)) {
    holdDrift_ = false;
    const double maxRatio = options_.maxDriftPpm * 1e-6;
    ratio_ = std::clamp(fittedRatio(), 1 - maxRatio, 1 + maxRatio);
    driftKnown_ = true;
  }
  // Where the line should be: the middle mean of the latest residuals against it - glided in.
  const int k = std::min(driftKnown_ ? options_.recent : options_.recentUnfitted, count_);
  double residuals[kWindow];
  for (int i = 0; i < k; ++i) {
    const Observation& o = at(count_ - k + i);
    residuals[i] = o.bandMs - clockMsAt(static_cast<double>(o.frame));
  }
  const double offset = middleMean(residuals, k);
  const double minFrames = std::fabs(offset) / (options_.maxSlewPpm * 1e-6 * msPerFrame());
  slewFrames_ = std::max(options_.slewMs / nominalMsPerFrame_, minFrames);
  slewPerFrame_ = offset / slewFrames_;
}

double ClockMap::clockMsAt(double frame) const {
  const double since = frame - static_cast<double>(anchorFrame_);
  const double glided = since <= 0 ? 0 : std::min(since, slewFrames_);
  return anchorBandMs_ + since * msPerFrame() + glided * slewPerFrame_;
}

double ClockMap::frameAtClock(double bandMs) const {
  const double gliding = msPerFrame() + slewPerFrame_;
  const double slewEndBandMs = anchorBandMs_ + slewFrames_ * gliding;
  const double anchor = static_cast<double>(anchorFrame_);
  if (bandMs <= anchorBandMs_) return anchor + (bandMs - anchorBandMs_) / msPerFrame();
  if (bandMs <= slewEndBandMs) return anchor + (bandMs - anchorBandMs_) / gliding;
  return anchor + slewFrames_ + (bandMs - slewEndBandMs) / msPerFrame();
}

void ClockMap::setOffset(double offsetMs, int64_t frame) {
  if (!offsetSet_ || frame < offsetFrame_) {
    // The first one - or the frame count went back (the output restarted): from here, at once.
    offsetSet_ = true;
    offsetFrom_ = offsetTo_ = offsetMs;
    offsetFrame_ = frame;
    offsetFrames_ = 0;
    return;
  }
  if (offsetMs == offsetTo_) return;
  const double now = offsetAt(static_cast<double>(frame));
  const double delta = offsetMs - now;
  offsetFrame_ = frame;
  if (std::fabs(delta) > options_.jumpMs) {
    // A real step (a clock-sync step, the other clock in Solo Üben): at once, counted.
    ++jumps_;
    offsetFrom_ = offsetTo_ = offsetMs;
    offsetFrames_ = 0;
    return;
  }
  offsetFrom_ = now;
  offsetTo_ = offsetMs;
  offsetFrames_ = std::max(options_.slewMs / nominalMsPerFrame_, std::fabs(delta) / (options_.maxSlewPpm * 1e-6 * nominalMsPerFrame_));
}

double ClockMap::offsetAt(double frame) const {
  const double since = frame - static_cast<double>(offsetFrame_);
  if (since <= 0) return offsetFrom_;
  if (since >= offsetFrames_) return offsetTo_;
  return offsetFrom_ + (offsetTo_ - offsetFrom_) * since / offsetFrames_;
}

double ClockMap::bandMsAt(double frame) const { return clockMsAt(frame) + offsetAt(frame); }

double ClockMap::frameAt(double bandMs) const {
  // The offset changes by at most maxSlewPpm per frame's time (or not at all), so a few rounds
  // settle on the exact frame.
  double frame = frameAtClock(bandMs - offsetTo_);
  for (int i = 0; i < 4; ++i) frame = frameAtClock(bandMs - offsetAt(frame));
  return frame;
}

}  // namespace stageboard
