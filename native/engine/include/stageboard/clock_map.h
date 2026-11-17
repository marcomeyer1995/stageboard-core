#pragma once

#include <cstdint>

namespace stageboard {

/**
 * Maps the frames this device's output plays (the moment a frame is *heard*) to band time
 * (docs/29): a sample counter alone drifts - audio crystals run apart (Fire +256 ppm ≈ 15 ms per
 * minute). Fed with observations "frame F is heard at band time B" (output timestamp + clock sync).
 *
 * Observations are noisy - ±0.5 ms from the clock sync at best, the laptop's raw output timestamps
 * −6…+19 ms, the Fire's now and then 68 ms off - so no single one moves the map much:
 * - the drift is the robust slope over the last window (middle mean of the slopes between pairs
 *   half a window apart), once that spans `minSpanMs`;
 * - the position follows the middle mean of the last `recent` residuals, glided in softly - the click
 *   never jumps audibly;
 * - only `confirmations` observations in a row off by more than `jumpMs` the same way re-anchor
 *   (counted, for self-monitoring §8i); a single wild one is ignored.
 *
 * Fixed buffers: `observe` runs on the audio thread (engine.cpp applies it between renders).
 */
class ClockMap {
 public:
  struct Options {
    /** Beyond this an observation is a jump (if confirmed) or an outlier, never glided. */
    double jumpMs = 20;
    /** This many in a row beyond `jumpMs`, the same way, re-anchor. */
    int confirmations = 3;
    /** A small error is absorbed over this long. */
    double slewMs = 2000;
    /** Never glide faster than this - stays inaudible (2000 ppm ≈ 3.5 cents). */
    double maxSlewPpm = 2000;
    /** The drift is fitted once the window spans this much. */
    double minSpanMs = 10000;
    /** After a re-anchor with the drift already known: the learned drift is kept until the new
     * window spans this much - refitted from 10 s it swung to 930 ppm and back on the Redmi after
     * every Play (true 247, night 2026-11-13/14). */
    double refitSpanMs = 60000;
    /** The learned drift is held within ± this. */
    double maxDriftPpm = 1000;
    /** The position follows the middle mean of the residuals of this many latest observations - */
    int recent = 32;
    /** - and of only this many until the drift is known: before, the residuals drift too, and a
     * mean over many lags behind (the Fire: 1.5 ms after 9 s with 32). */
    int recentUnfitted = 4;
  };

  /** Observations kept for the drift: at one every 0.5-1 s, 1-2 minutes. */
  static constexpr int kWindow = 128;

  explicit ClockMap(double sampleRate) : ClockMap(sampleRate, Options()) {}
  ClockMap(double sampleRate, Options options);

  /** Frame `frame` is heard at `ms` on the observed clock - band time itself, or the device's
   * wall clock when the band offset comes separately (setOffset). */
  void observe(int64_t frame, double ms);

  /**
   * Band time minus the observed clock (server offset + this output's trim), from `frame` on. Kept
   * out of the observations: fed into them, a step of a few ms (below `jumpMs`, so no re-anchor)
   * was read as drift by the slope fit until it left the window - 400-870 ppm for up to 46 s after
   * every Play on the Redmi (#874). Here a change moves the map directly and never the drift: it
   * glides in at `maxSlewPpm` (the track never skips), beyond `jumpMs` it steps at once (counted).
   * Unset, the offset is 0. Call it as often as you like; the same value changes nothing.
   */
  void setOffset(double offsetMs, int64_t frame);

  /**
   * The output says its frame clock stepped: frames went missing or were played twice (a USB
   * transfer late under load, a confirmed timestamp jump), so from here a frame is heard earlier or
   * later than before - a step, not drift. The next observation re-anchors at once (counted as a
   * jump) and the learned drift is kept. Fed as ordinary observations, such steps of 3-16 ms (below
   * `jumpMs`) were read as drift by the slope fit: 340-750 ppm for up to a minute after Play on the
   * Redmi (#874).
   */
  void markStep() { stepPending_ = true; }

  bool valid() const { return valid_; }
  double bandMsAt(double frame) const;
  /** Inverse of bandMsAt, as a fractional frame. */
  double frameAt(double bandMs) const;

  /** The offset in effect at `frame` (gliding toward the last one set). */
  double offsetAt(double frame) const;
  double driftPpm() const { return (ratio_ - 1) * 1e6; }
  int jumps() const { return jumps_; }
  /** Observations ignored as single outliers. */
  int outliers() const { return outliers_; }

 private:
  struct Observation {
    int64_t frame;
    double bandMs;
  };

  /** The map on the observed clock alone (without the offset), and its inverse. */
  double clockMsAt(double frame) const;
  double frameAtClock(double ms) const;

  void anchorAt(int64_t frame, double bandMs);
  /** A new window from this observation (first one, restart, confirmed jump). */
  void restartWindow(int64_t frame, double bandMs);
  void push(int64_t frame, double bandMs);
  const Observation& at(int i) const { return window_[(head_ + kWindow - count_ + i) % kWindow]; }
  double fittedRatio() const;

  Options options_;
  double nominalMsPerFrame_;
  bool valid_ = false;
  int64_t anchorFrame_ = 0;
  double anchorBandMs_ = 0;
  /** Band ms per nominal ms - the learned drift. */
  double ratio_ = 1;
  /** Extra band ms per frame while gliding, for `slewFrames_` frames after the anchor. */
  double slewPerFrame_ = 0;
  double slewFrames_ = 0;
  int jumps_ = 0;
  int outliers_ = 0;
  /** The drift has been fitted at least once (kept across a restart). */
  bool driftKnown_ = false;
  /** Re-anchored with the drift known: keep it until the window spans `refitSpanMs`. */
  bool holdDrift_ = false;
  /** Observations beyond jumpMs in a row, and their direction. */
  int off_ = 0;
  int offSign_ = 0;
  /** markStep() was called: the next observation starts a new window. */
  bool stepPending_ = false;

  /** The offset glides from `offsetFrom_` at `offsetFrame_` to `offsetTo_` over `offsetFrames_`. */
  bool offsetSet_ = false;
  double offsetFrom_ = 0;
  double offsetTo_ = 0;
  int64_t offsetFrame_ = 0;
  double offsetFrames_ = 0;

  Observation window_[kWindow] = {};
  int head_ = 0;
  int count_ = 0;

  double msPerFrame() const { return nominalMsPerFrame_ * ratio_; }
};

}  // namespace stageboard
