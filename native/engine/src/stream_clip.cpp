#include "stageboard/stream_clip.h"

#include <algorithm>
#include <climits>
#include <cmath>

namespace stageboard {

StreamedClip::StreamedClip(int ringFrames)
    : ringFrames_(ringFrames), mask_(ringFrames - 1), ahead_(std::min<long>(ringFrames / 2, 48000)) {}

bool StreamedClip::open(const uint8_t* data, size_t size, std::string* error) {
  if (ringFrames_ < 4096 || (ringFrames_ & mask_) != 0) {
    if (error) *error = "Fenster muss eine Zweierpotenz ab 4096 sein";
    return false;
  }
  if (!lanes_[0].decoder.open(data, size, error)) return false;
  if (!lanes_[1].decoder.openLike(lanes_[0].decoder)) {
    if (error) *error = "Opus-Decoder nicht verfügbar";
    return false;
  }
  channels = lanes_[0].decoder.channels();
  rate = OpusClip::kRate;
  frames_ = lanes_[0].decoder.frames();
  for (Lane& lane : lanes_) lane.ring.assign(static_cast<size_t>(ringFrames_) * static_cast<size_t>(channels), 0.0f);
  return true;
}

// --- Audio thread -------------------------------------------------------------------------

void StreamedClip::beginRead(double at, double low) {
  at_.store(at, std::memory_order_release);
  low_.store(low, std::memory_order_release);
  reading_.store(true, std::memory_order_release);
  read_[0] = read_[1] = Read{};
  missing_ = false;
}

bool StreamedClip::fetch(long first, int n, const float** run, const float** out) {
  const long a = std::max(first, 0L);
  const long b = std::min(first + n, frames_);
  int lane = -1;
  if (a < b) {
    for (int l = 0; l < 2 && lane < 0; ++l) {
      const unsigned generation = lanes_[l].generation.load(std::memory_order_acquire);
      const long lo = lanes_[l].lo.load(std::memory_order_acquire);
      const long hi = lanes_[l].hi.load(std::memory_order_acquire);
      if (lo > a || b > hi) continue;
      lane = l;
      Read& r = read_[l];
      if (!r.used) r = {true, a, generation};
      else if (generation != r.generation) r.min = LONG_MIN;  // moved within this piece: broken
      else r.min = std::min(r.min, a);
    }
    if (lane < 0) {
      missing_ = true;
      return false;
    }
  }
  const float* ring = lane >= 0 ? lanes_[lane].ring.data() : nullptr;
  // Inside the clip and not across the ring's end: one run.
  if (ring && first >= 0 && first + n <= frames_ && (first & mask_) + n <= ringFrames_) {
    *run = ring + (first & mask_) * channels;
    return true;
  }
  *run = nullptr;
  for (int j = 0; j < n; ++j) {
    const long i = first + j;
    out[j] = i < 0 || i >= frames_ ? nullptr : ring + (i & mask_) * channels;
  }
  return true;
}

bool StreamedClip::endRead() {
  std::atomic_thread_fence(std::memory_order_acquire);
  bool ok = true;
  for (int l = 0; l < 2; ++l) {
    const Read& r = read_[l];
    if (!r.used) continue;
    // Still the same window, and nothing below what was read given up for new frames?
    if (r.min == LONG_MIN || lanes_[l].generation.load(std::memory_order_acquire) != r.generation || lanes_[l].lo.load(std::memory_order_acquire) > r.min) ok = false;
  }
  if (!ok) broken_.fetch_add(1, std::memory_order_relaxed);
  if (missing_) missingCount_.fetch_add(1, std::memory_order_relaxed);
  read_[0] = read_[1] = Read{};
  return ok;
}

// --- Control thread -----------------------------------------------------------------------

void StreamedClip::prefetch(long start, long next) {
  start_ = std::clamp(start, 0L, frames_);
  want_ = next < 0 ? -1 : std::clamp(next, 0L, frames_);
}

int StreamedClip::covering(long frame, long until) const {
  // A lane holds `frame` - or ends right at it and decodes on from there.
  for (int l = 0; l < 2; ++l) {
    const long lo = lanes_[l].lo.load(std::memory_order_relaxed);
    const long hi = lanes_[l].hi.load(std::memory_order_relaxed);
    if (hi > lo && lo <= frame && frame <= hi && frame < until) return l;
  }
  return -1;
}

void StreamedClip::place(int l, long frame) {
  Lane& lane = lanes_[l];
  const long start = std::max(0L, frame - kBehind);
  // A new generation first: a reader that was in this lane learns its piece is gone.
  lane.generation.fetch_add(1, std::memory_order_acq_rel);
  lane.hi.store(start, std::memory_order_release);
  lane.lo.store(start, std::memory_order_release);
  lane.decoder.seek(start);
}

void StreamedClip::fill(int l, long until, long low) {
  Lane& lane = lanes_[l];
  long hi = lane.hi.load(std::memory_order_relaxed);
  long lo = lane.lo.load(std::memory_order_relaxed);
  until = std::min(until, frames_);
  if (hi >= until) return;
  long n = std::min<long>(kChunk, until - hi);
  // New frames take the ring slots of frames a ring behind - never of one the reader still wants.
  const long overwriteBelow = hi + n - ringFrames_;
  if (overwriteBelow > low) n -= overwriteBelow - low;
  if (n <= 0) return;
  const long newLo = std::max(lo, hi + n - ringFrames_);
  if (newLo > lo) {
    lane.lo.store(newLo, std::memory_order_release);
    std::atomic_thread_fence(std::memory_order_seq_cst);
    lo = newLo;
  }
  long done = 0;
  while (done < n) {
    // Up to the ring's end, then on from its start.
    const long at = hi + done;
    const long slot = at & mask_;
    const int part = static_cast<int>(std::min<long>(n - done, ringFrames_ - slot));
    const int got = lane.decoder.read(lane.ring.data() + slot * channels, part);
    done += got;
    if (got < part) break;  // the clip's end
  }
  lane.hi.store(hi + done, std::memory_order_release);
}

void StreamedClip::pump() {
  if (frames_ <= 0) return;
  const bool reading = reading_.load(std::memory_order_acquire);
  // Where the voice reads - or, before it ever did, where the song starts.
  const double atRead = reading ? at_.load(std::memory_order_acquire) : static_cast<double>(start_);
  const long at = std::clamp(static_cast<long>(std::floor(atRead)), 0L, frames_);
  const long low = reading ? static_cast<long>(std::floor(low_.load(std::memory_order_acquire))) : at - kBehind;

  int primary = covering(at, LONG_MAX);
  if (primary < 0) {
    // Nobody announced this place (a seek): a lane that holds neither the old place the voice
    // still fades out from (`low`) nor the announced next one.
    const int holdsLow = covering(std::max(0L, low), LONG_MAX);
    const int holdsWant = want_ >= 0 ? covering(want_, LONG_MAX) : -1;
    primary = 0;
    for (int l : {1, 0})
      if (l != holdsLow && l != holdsWant) primary = l;
    if (primary == holdsLow) primary = 1 - holdsLow;  // both held something: keep the fading one
    place(primary, at);
  }
  fill(primary, at + ahead_, low);

  if (want_ < 0) return;
  int next = covering(want_, LONG_MAX);
  if (next < 0) {
    const int other = 1 - primary;
    // Not while the voice still reads there (the old place during a cross-fade).
    if (covering(std::max(0L, low), LONG_MAX) == other) return;
    place(other, want_);
    next = other;
  }
  // Filled from its target on, never so far that the target itself is given up again.
  if (next != primary) fill(next, want_ + kPrefetchFrames, want_ - kBehind);
}

}  // namespace stageboard
