#pragma once

namespace stageboard {

enum class PlaybackStatus { Stopped, Playing, Paused };

/**
 * The band's transport, as in ShowState (stage-pwa lib/playbackTransport.ts): all times are band
 * time in ms (= server time, docs/29), song positions in ms. The engine only reads it - who may
 * change it stays in the app.
 */
struct Transport {
  PlaybackStatus status = PlaybackStatus::Stopped;
  /** Band time the current run began - only meaningful while playing. */
  double startedAt = 0;
  /** Song position at `startedAt` (or the frozen position while paused/stopped). */
  double accumulatedMs = 0;
  /** Song ms per band ms (#683 loop trainer); 1 in the Gig. */
  double rate = 1;
  /** A queued section jump (#479): from band time `jumpAt` on, the song continues at `jumpToMs`. */
  bool hasJump = false;
  double jumpAt = 0;
  double jumpToMs = 0;
  double jumpRate = 1;
};

/** Song position at band time `bandMs` - the same as computeActiveMs in playbackTransport.ts. */
inline double songMsAt(const Transport& t, double bandMs) {
  if (t.status != PlaybackStatus::Playing) return t.accumulatedMs;
  if (t.hasJump && bandMs >= t.jumpAt) return t.jumpToMs + (bandMs - t.jumpAt) * t.jumpRate;
  const double run = bandMs - t.startedAt;
  return t.accumulatedMs + (run > 0 ? run : 0) * t.rate;
}

/**
 * Band time at which the song reaches `songMs` within one stretch of the transport: before the
 * jump (`afterJump` false) or after it. Only meaningful while playing.
 */
inline double bandMsAt(const Transport& t, double songMs, bool afterJump) {
  if (afterJump) return t.jumpAt + (songMs - t.jumpToMs) / t.jumpRate;
  return t.startedAt + (songMs - t.accumulatedMs) / t.rate;
}

}  // namespace stageboard
