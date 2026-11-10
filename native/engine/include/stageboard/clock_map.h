#pragma once

#include <cstdint>

namespace stageboard {

/**
 * Maps the frames this device's output plays (the moment a frame is *heard*) to band time
 * (docs/29): a sample counter alone drifts - audio crystals run apart (Fire +256 ppm ≈ 15 ms per
 * minute). Fed with observations "frame F is heard at band time B" (output timestamp + clock sync),
 * it follows small errors softly - the click never jumps audibly - and learns the device's drift;
 * only an error beyond `jumpMs` re-anchors at once (and is counted, for self-monitoring §8i).
 */
class ClockMap {
 public:
  struct Options {
    /** Above this the map re-anchors instead of gliding. */
    double jumpMs = 20;
    /** A small error is absorbed over this long. */
    double slewMs = 2000;
    /** Never glide faster than this - stays inaudible (2000 ppm ≈ 3.5 cents). */
    double maxSlewPpm = 2000;
    /** How fast the learned drift follows (0..1 per observation). */
    double driftGain = 0.1;
    /** The learned drift is held within ± this. */
    double maxDriftPpm = 1000;
  };

  explicit ClockMap(double sampleRate) : ClockMap(sampleRate, Options()) {}
  ClockMap(double sampleRate, Options options);

  /** Frame `frame` is heard at band time `bandMs`. */
  void observe(int64_t frame, double bandMs);

  bool valid() const { return valid_; }
  double bandMsAt(double frame) const;
  /** Inverse of bandMsAt, as a fractional frame. */
  double frameAt(double bandMs) const;

  double driftPpm() const { return (ratio_ - 1) * 1e6; }
  int jumps() const { return jumps_; }

 private:
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
  int64_t lastFrame_ = 0;
  int jumps_ = 0;

  double msPerFrame() const { return nominalMsPerFrame_ * ratio_; }
};

}  // namespace stageboard
