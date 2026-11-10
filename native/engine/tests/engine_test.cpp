// Offline tests of the engine core (docs/30 §8h stage 1): render into a buffer, check against known
// values. No framework - one file, plain checks, exit code 1 on any failure.

#include <cmath>
#include <cstdio>
#include <vector>

#include "stageboard/engine.h"

using namespace stageboard;

static int failures = 0;
#define CHECK(cond)                                                     \
  do {                                                                  \
    if (!(cond)) {                                                      \
      std::printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);     \
      ++failures;                                                       \
    }                                                                   \
  } while (0)
#define CHECK_NEAR(a, b, tol)                                                                                      \
  do {                                                                                                             \
    const double a_ = (a), b_ = (b);                                                                               \
    if (std::fabs(a_ - b_) > (tol)) {                                                                              \
      std::printf("  FAIL %s:%d  %s = %.6f, expected %.6f ± %g\n", __FILE__, __LINE__, #a, a_, b_, (double)(tol)); \
      ++failures;                                                                                                  \
    }                                                                                                              \
  } while (0)

static constexpr double kRate = 48000;

/** Renders `seconds` of a mono engine in blocks of `block` frames, starting at output frame 0. */
static std::vector<float> renderAll(Engine& engine, double seconds, int block) {
  std::vector<float> out(static_cast<size_t>(seconds * kRate));
  int64_t frame = 0;
  while (frame < static_cast<int64_t>(out.size())) {
    const int n = static_cast<int>(std::min<int64_t>(block, static_cast<int64_t>(out.size()) - frame));
    engine.render(out.data() + frame, n, frame);
    frame += n;
  }
  return out;
}

/** Frames where a click starts: the first non-silent sample after ≥ 10 ms of silence. */
static std::vector<int> onsets(const std::vector<float>& s) {
  std::vector<int> found;
  int quiet = 1 << 30;
  for (size_t i = 0; i < s.size(); ++i) {
    if (std::fabs(s[i]) > 1e-6f) {
      if (quiet >= 480) found.push_back(static_cast<int>(i));
      quiet = 0;
    } else {
      ++quiet;
    }
  }
  return found;
}

static BeatPlan* beatsEvery(double ms, int count, int perBar) {
  auto* plan = new BeatPlan();
  for (int i = 0; i < count; ++i) plan->beats.push_back({i * ms, i % perBar == 0});
  return plan;
}

static Transport playingFrom(double startedAt, double accumulatedMs = 0) {
  Transport t;
  t.status = PlaybackStatus::Playing;
  t.startedAt = startedAt;
  t.accumulatedMs = accumulatedMs;
  return t;
}

static void testQueue() {
  std::printf("queue\n");
  SpscQueue<int, 4> q;
  CHECK(q.push(1));
  CHECK(q.push(2));
  CHECK(q.push(3));
  CHECK(!q.push(4));  // holds Capacity - 1
  int v = 0;
  CHECK(q.pop(v) && v == 1);
  CHECK(q.pop(v) && v == 2);
  CHECK(q.push(4));
  CHECK(q.pop(v) && v == 3);
  CHECK(q.pop(v) && v == 4);
  CHECK(!q.pop(v));
}

static void testTransport() {
  std::printf("transport (as playbackTransport.ts)\n");
  Transport t = playingFrom(1000, 500);
  CHECK_NEAR(songMsAt(t, 900), 500, 1e-9);  // before the start (Play lead): stands
  CHECK_NEAR(songMsAt(t, 3000), 2500, 1e-9);
  t.rate = 0.8;
  CHECK_NEAR(songMsAt(t, 3000), 500 + 2000 * 0.8, 1e-9);
  CHECK_NEAR(bandMsAt(t, songMsAt(t, 3000), false), 3000, 1e-9);
  t.rate = 1;
  t.hasJump = true;
  t.jumpAt = 2000;
  t.jumpToMs = 10000;
  CHECK_NEAR(songMsAt(t, 1999), 1499, 1e-9);
  CHECK_NEAR(songMsAt(t, 2500), 10500, 1e-9);
  CHECK_NEAR(bandMsAt(t, 10500, true), 2500, 1e-9);
  Transport paused;
  paused.status = PlaybackStatus::Paused;
  paused.accumulatedMs = 4200;
  CHECK_NEAR(songMsAt(paused, 99999), 4200, 1e-9);
}

static void testClockMap() {
  std::printf("clock map\n");
  ClockMap identity(kRate);
  identity.observe(0, 5000);
  CHECK_NEAR(identity.bandMsAt(48000), 6000, 1e-9);
  CHECK_NEAR(identity.frameAt(6000), 48000, 1e-6);

  // A device whose crystal runs 256 ppm fast (the Fire): its frames come too quickly. Observed
  // every second with ±0.5 ms of clock-sync noise, the map must follow without a single jump.
  ClockMap fire(kRate);
  const double ppm = 256;
  double worst = 0;
  unsigned noise = 12345;
  for (int s = 0; s <= 600; ++s) {
    const int64_t frame = static_cast<int64_t>(s * kRate);
    const double truth = frame * (1000.0 / kRate) / (1 + ppm * 1e-6);
    noise = noise * 1103515245u + 12345u;
    const double jitter = ((noise >> 16) % 1000) / 1000.0 - 0.5;
    fire.observe(frame, truth + jitter);
    if (s >= 60) worst = std::fmax(worst, std::fabs(fire.bandMsAt(static_cast<double>(frame) + kRate / 2) - (frame + kRate / 2) * (1000.0 / kRate) / (1 + ppm * 1e-6)));
  }
  CHECK(fire.jumps() == 0);
  CHECK_NEAR(fire.driftPpm(), -ppm, 40);  // band ms per frame: slightly fewer
  CHECK(worst < 1.0);                       // within 1 ms after the first minute
  std::printf("  drift learned %.1f ppm, worst error %.3f ms\n", fire.driftPpm(), worst);

  // A clock-sync step of 100 ms re-anchors at once and is counted.
  ClockMap stepped(kRate);
  stepped.observe(0, 0);
  stepped.observe(48000, 1100);
  CHECK(stepped.jumps() == 1);
  CHECK_NEAR(stepped.bandMsAt(48000), 1100, 1e-9);

  // A small error glides: right after it the map is still continuous.
  ClockMap glide(kRate);
  glide.observe(0, 0);
  glide.observe(48000, 1005);
  CHECK(glide.jumps() == 0);
  CHECK_NEAR(glide.bandMsAt(48000), 1000, 1e-6);
  CHECK(glide.bandMsAt(48000 + 4 * 48000) > 5004);
  CHECK_NEAR(glide.frameAt(glide.bandMsAt(70000)), 70000, 1e-6);
}

static void testClickOnsets() {
  std::printf("click on the exact frame\n");
  Engine engine(kRate, 1);
  engine.observeClock(0, 10000);            // frame 0 is heard at band time 10 s
  engine.setTransport(playingFrom(10000));  // the song starts there
  engine.setBeats(beatsEvery(500, 4, 4));   // 120 BPM
  const auto out = renderAll(engine, 2.2, 256);
  const auto found = onsets(out);
  CHECK(found.size() == 4);
  for (size_t i = 0; i < found.size() && i < 4; ++i) CHECK_NEAR(found[i], i * 24000, 1);
  // Downbeat louder than the other beats (0.5 vs 0.35 peak).
  float peak0 = 0, peak1 = 0;
  for (int i = 0; i < 1440; ++i) {
    peak0 = std::fmax(peak0, std::fabs(out[i]));
    peak1 = std::fmax(peak1, std::fabs(out[24000 + i]));
  }
  CHECK_NEAR(peak0, 0.5, 0.02);
  CHECK_NEAR(peak1, 0.35, 0.02);
  // Pitch: zero crossings in the first 20 ms → 1500 Hz downbeat, 1000 Hz otherwise.
  auto hz = [&](int from) {
    int crossings = 0;
    for (int i = from + 1; i < from + 960; ++i)
      if ((out[i - 1] < 0) != (out[i] < 0)) ++crossings;
    return crossings / 2.0 / 0.02;
  };
  CHECK_NEAR(hz(0), 1500, 60);
  CHECK_NEAR(hz(24000), 1000, 60);
}

static void testFractionalOnset() {
  std::printf("onset between two samples\n");
  // Beat 0 at band time 10 s + 0.5 frame: the first sample is frame 1, already slightly in.
  Engine engine(kRate, 1);
  engine.observeClock(0, 10000 - 0.5 * 1000 / kRate);
  engine.setTransport(playingFrom(10000));
  engine.setBeats(beatsEvery(500, 1, 4));
  const auto out = renderAll(engine, 0.1, 128);
  CHECK(out[0] == 0);
  const double t = 0.5 / kRate;
  CHECK_NEAR(out[1], 0.5 * std::exp(-t / (0.03 / std::log(500.0))) * std::sin(6.283185307179586 * 1500 * t), 1e-6);
}

static void testBlockSizeIndependence() {
  std::printf("same output for any block size\n");
  std::vector<std::vector<float>> runs;
  for (int block : {64, 97, 256, 1024, 4096}) {
    Engine engine(kRate, 1);
    engine.observeClock(0, 0);
    engine.setTransport(playingFrom(123.4));
    engine.setBeats(beatsEvery(431.7, 12, 3));
    runs.push_back(renderAll(engine, 5, block));
  }
  for (size_t r = 1; r < runs.size(); ++r) {
    double diff = 0;
    for (size_t i = 0; i < runs[0].size(); ++i) diff = std::fmax(diff, std::fabs(runs[0][i] - runs[r][i]));
    CHECK(diff < 1e-6);
  }
}

static void testPauseAndJump() {
  std::printf("pause, jump\n");
  {
    Engine engine(kRate, 1);
    engine.observeClock(0, 0);
    engine.setTransport(playingFrom(0));
    engine.setBeats(beatsEvery(500, 8, 4));
    std::vector<float> out(static_cast<size_t>(3 * kRate));
    engine.render(out.data(), 48000, 0);  // 1 s: beats at 0 and 500
    Transport paused;
    paused.status = PlaybackStatus::Paused;
    paused.accumulatedMs = 1000;
    engine.setTransport(paused);
    for (int64_t f = 48000; f < 3 * 48000; f += 480) engine.render(out.data() + f, 480, f);
    CHECK(onsets(out).size() == 2);
  }
  {
    // At band 1250 the song jumps from 1250 to 4000: beats 0, 500, 1000, then 4000, 4500.
    Engine engine(kRate, 1);
    engine.observeClock(0, 0);
    Transport t = playingFrom(0);
    t.hasJump = true;
    t.jumpAt = 1250;
    t.jumpToMs = 4000;
    engine.setTransport(t);
    engine.setBeats(beatsEvery(500, 12, 4));
    const auto found = onsets(renderAll(engine, 2.0, 300));
    const int expected[] = {0, 24000, 48000, 60000, 84000};
    CHECK(found.size() == 5);
    for (size_t i = 0; i < found.size() && i < 5; ++i) CHECK_NEAR(found[i], expected[i], 1);
  }
}

static void testLimiterAndGains() {
  std::printf("limiter, gains\n");
  Limiter limiter(kRate);
  std::vector<float> loud(2 * 4800);
  for (size_t i = 0; i < loud.size(); ++i) loud[i] = 3.0f * std::sin(i * 0.05f);
  limiter.process(loud.data(), 4800, 2);
  float peak = 0;
  for (float s : loud) peak = std::fmax(peak, std::fabs(s));
  CHECK(peak <= 0.8911f);

  Engine engine(kRate, 2);
  engine.observeClock(0, 0);
  engine.setTransport(playingFrom(0));
  engine.setBeats(beatsEvery(500, 4, 4));
  engine.setGain(Bus::Click, 0);
  std::vector<float> out(static_cast<size_t>(2 * kRate) * 2);
  for (int64_t f = 0; f < 2 * 48000; f += 480) engine.render(out.data() + f * 2, 480, f);
  float after = 0;
  for (size_t i = 2 * 24000; i < out.size(); ++i) after = std::fmax(after, std::fabs(out[i]));
  CHECK(after < 1e-6f);  // muted (the 5 ms glide only touches the very first click)
}

static void testPlanSwap() {
  std::printf("beat plan swapped without freeing on the audio thread\n");
  Engine engine(kRate, 1);
  engine.observeClock(0, 0);
  engine.setTransport(playingFrom(0));
  std::vector<float> out(512);
  for (int i = 0; i < 200; ++i) {
    engine.setBeats(beatsEvery(500, 4, 4));
    engine.render(out.data(), 512, i * 512);
    if (i % 10 == 0) engine.collectGarbage();
  }
  engine.collectGarbage();
  CHECK(true);  // no crash or leak under ASan
}

int main() {
  setvbuf(stdout, nullptr, _IONBF, 0);
  testQueue();
  testTransport();
  testClockMap();
  testClickOnsets();
  testFractionalOnset();
  testBlockSizeIndependence();
  testPauseAndJump();
  testLimiterAndGains();
  testPlanSwap();
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("all checks passed\n");
  return 0;
}
