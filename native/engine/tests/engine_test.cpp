// Offline tests of the engine core (docs/30 §8h stage 1): render into a buffer, check against known
// values.

#include <cmath>
#include <cstdio>
#include <random>
#include <vector>

#include "check.h"
#include "stageboard/engine.h"

using namespace stageboard;

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

  // A clock-sync step of 100 ms: confirmed by three observations in a row, then re-anchored and
  // counted; the learned drift stays.
  ClockMap stepped(kRate);
  for (int s = 0; s <= 20; ++s) stepped.observe(static_cast<int64_t>(s * kRate), s * 1000.0);
  for (int s = 21; s <= 23; ++s) stepped.observe(static_cast<int64_t>(s * kRate), s * 1000.0 + 100);
  CHECK(stepped.jumps() == 1);
  CHECK(stepped.outliers() == 0);
  CHECK_NEAR(stepped.bandMsAt(23 * kRate), 23100, 1e-9);
  CHECK_NEAR(stepped.driftPpm(), 0, 1e-6);

  // A small, lasting offset glides in - continuous at every observation, no jump.
  ClockMap glide(kRate);
  glide.observe(0, 0);
  glide.observe(48000, 1005);
  CHECK_NEAR(glide.bandMsAt(48000), 1000, 1e-6);  // no step where it was noticed
  for (int s = 2; s <= 12; ++s) glide.observe(static_cast<int64_t>(s * kRate), s * 1000.0 + 5);
  CHECK(glide.jumps() == 0);
  CHECK_NEAR(glide.bandMsAt(16 * kRate), 16005, 0.2);
  CHECK_NEAR(glide.frameAt(glide.bandMsAt(70000)), 70000, 1e-6);
}


static void testClockMapNoisy() {
  std::printf("clock map with noisy observations\n");
  // Noise uniform within ±3 ms (a rough clock) and ±12 ms (the laptop's raw output timestamps in
  // Chrome, 2026-11-10), two observations a second, a crystal 30 ppm slow: the drift must not be
  // fooled, the position stays near the line. (The old per-observation drift learning ran to its
  // ±1000 ppm limit at ±3 ms already.)
  for (double noiseMs : {3.0, 12.0}) {
    ClockMap map(kRate);
    const double ppm = -30;
    auto truth = [&](double frame) { return frame * (1000.0 / kRate) / (1 + ppm * 1e-6); };
    std::mt19937 rng(4);
    std::uniform_real_distribution<double> noise(-noiseMs, noiseMs);
    double worst = 0;
    for (int i = 0; i <= 240; ++i) {
      const int64_t frame = static_cast<int64_t>(i * 0.5 * kRate);
      map.observe(frame, truth(static_cast<double>(frame)) + noise(rng));
      if (i >= 40) worst = std::fmax(worst, std::fabs(map.bandMsAt(static_cast<double>(frame) + 12000) - truth(static_cast<double>(frame) + 12000)));
    }
    std::printf("  ±%.0f ms noise: drift learned %.1f ppm (true %.0f), worst position error %.2f ms\n", noiseMs, map.driftPpm(), -ppm, worst);
    CHECK(map.jumps() == 0);
    CHECK_NEAR(map.driftPpm(), -ppm, noiseMs * 10);
    CHECK(worst < noiseMs * 0.6);
  }
  // The Fire's glitches: now and then one observation 68 ms off. Ignored - no jump, no dent.
  {
    ClockMap map(kRate);
    std::mt19937 rng(7);
    std::uniform_real_distribution<double> noise(-0.4, 0.4);
    double worst = 0;
    for (int i = 0; i <= 120; ++i) {
      const int64_t frame = static_cast<int64_t>(i * kRate);
      const double glitch = i % 17 == 16 ? 68 : 0;
      map.observe(frame, i * 1000.0 + noise(rng) + glitch);
      if (i >= 20) worst = std::fmax(worst, std::fabs(map.bandMsAt(static_cast<double>(frame) + 24000) - (i * 1000.0 + 500)));
    }
    std::printf("  68 ms glitches: %d ignored, worst position error %.3f ms\n", map.outliers(), worst);
    CHECK(map.jumps() == 0);
    CHECK(map.outliers() == 7);
    CHECK(worst < 0.5);
  }
  // The frame count going back (the output stream restarted) starts over.
  {
    ClockMap map(kRate);
    map.observe(96000, 2000);
    map.observe(0, 5000);
    CHECK(map.jumps() == 1);
    CHECK_NEAR(map.bandMsAt(48000), 6000, 1e-9);
  }
}

static void testAndroidCallback() {
  std::printf("as in the AAudio callback (stage 3)\n");
  // The Fire: 240-frame bursts, its crystal 256 ppm fast, AAudio's heard time smoothed to ±0.4 ms,
  // fed every 0.5 s straight in the callback (observeClockNow). At 30 s the stream is reopened
  // (headphones plugged in): the frame count starts at 0 again. Every click must still be heard
  // on its beat in band time.
  Engine engine(kRate, 2);
  const double ppm = 256;
  const double startedAt = 100000;  // band ms
  Transport t = playingFrom(startedAt);
  engine.setTransport(t);
  engine.setBeats(beatsEvery(500, 200, 4));
  std::mt19937 rng(11);
  std::uniform_real_distribution<double> jitter(-0.4, 0.4);
  const int burst = 240;
  const int64_t total = static_cast<int64_t>(60 * kRate);
  // Band time at which output frame g (counted over the whole run) is heard.
  const double band0 = startedAt - 1000;
  auto heard = [&](int64_t g) { return band0 + g * (1000.0 / kRate) / (1 + ppm * 1e-6); };
  std::vector<float> out(static_cast<size_t>(total) * 2);
  int64_t frames = 0, clockAt = -1;  // the callback's own count, restarted by the reopen
  for (int64_t g = 0; g < total; g += burst) {
    if (g == static_cast<int64_t>(30 * kRate)) frames = 0, clockAt = -1;
    if (clockAt < 0 || (frames - clockAt) * (1000.0 / kRate) >= 500) {
      engine.observeClockNow(frames, heard(g) + jitter(rng));
      clockAt = frames;
    }
    engine.render(out.data() + g * 2, burst, frames);
    frames += burst;
  }
  std::vector<float> left(static_cast<size_t>(total));
  for (int64_t g = 0; g < total; ++g) left[static_cast<size_t>(g)] = out[static_cast<size_t>(g) * 2];
  const auto found = onsets(left);
  double worst = 0;
  for (int f : found) {
    const double ms = heard(f) - startedAt;
    const double e = ms - 500 * std::round(ms / 500);
    worst = std::fmax(worst, std::fabs(e));
  }
  std::printf("  %zu clicks, worst %.3f ms off the beat, clock restarts %d\n", found.size(), worst, engine.clockJumps());
  CHECK(found.size() == 118);  // beats from band 100 s to 159 s
  CHECK(worst < 1.0);
  CHECK(engine.clockJumps() == 1);  // the reopen, nothing else
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
    const auto out = renderAll(engine, 2.0, 300);
    const auto found = onsets(out);
    const int expected[] = {0, 24000, 48000, 60000, 84000};
    CHECK(found.size() == 5);
    for (size_t i = 0; i < found.size() && i < 5; ++i) CHECK_NEAR(found[i], expected[i], 1);
    // The jump (frame 60000) lies right on a block end (200 × 300): the beats it leaps over
    // (1500…3500) must not pile up there - the click after it is one click, as loud as any.
    float peakJump = 0, peakBefore = 0;
    for (int i = 0; i < 1440; ++i) {
      peakBefore = std::fmax(peakBefore, std::fabs(out[24000 + i]));
      peakJump = std::fmax(peakJump, std::fabs(out[60000 - 200 + i]));
    }
    CHECK_NEAR(peakJump, 0.5, 0.02);  // 4000 ms is a downbeat (4/4 at 120 BPM)
    CHECK_NEAR(peakBefore, 0.35, 0.02);
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
  // After the peak it lets go completely - not stuck a hair below 1.
  std::vector<float> quiet(2 * 96000, 0.1f);  // 2 s: 40 release times
  limiter.process(quiet.data(), 96000, 2);
  CHECK(limiter.gain() == 1);
  CHECK(quiet.back() == 0.1f);

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


static ClipData* makeClip(long frames, int channels, float (*sample)(long, int)) {
  auto* clip = new ClipData();
  clip->channels = channels;
  clip->samples.resize(static_cast<size_t>(frames) * channels);
  for (long i = 0; i < frames; ++i)
    for (int c = 0; c < channels; ++c) clip->samples[static_cast<size_t>(i) * channels + c] = sample(i, c);
  return clip;
}

static float noiseSample(long i, int c) {
  unsigned x = static_cast<unsigned>(i) * 2654435761u + static_cast<unsigned>(c) * 40503u;
  x ^= x >> 13;
  return (static_cast<float>(x % 2001) / 1000.0f - 1.0f) * 0.4f;  // ±0.4, under the limiter's ceiling
}

static float rampSample(long i, int) { return static_cast<float>(i % 48000) / 48000.0f * 0.8f; }
static float sineSample(long i, int) { return 0.5f * std::sin(6.283185307179586f * 440.0f * static_cast<float>(i) / 48000.0f); }

static void testClipExact() {
  std::printf("clip plays sample-exact on its place\n");
  Engine engine(kRate, 2);
  engine.observeClock(0, 0);
  engine.setTransport(playingFrom(0));
  engine.setClip(0, makeClip(48000, 2, noiseSample), 100, Bus::Track);
  std::vector<float> out(static_cast<size_t>(1.2 * kRate) * 2);
  for (int64_t f = 0; f < static_cast<int64_t>(out.size() / 2); f += 333) {
    const int n = static_cast<int>(std::min<int64_t>(333, static_cast<int64_t>(out.size() / 2) - f));
    engine.render(out.data() + f * 2, n, f);
  }
  double diff = 0;
  for (long f = 0; f < 4800; ++f) diff = std::fmax(diff, std::fabs(out[f * 2]));  // silent before 100 ms
  for (long f = 4800; f < 4800 + 48000; ++f)
    for (int c = 0; c < 2; ++c) diff = std::fmax(diff, std::fabs(out[f * 2 + c] - noiseSample(f - 4800, c)));
  CHECK(diff < 1e-6);
}

static void testClipFollowsDrift() {
  std::printf("clip follows the device's drift\n");
  // Fire: frames come 256 ppm too fast. Fed once a second, the clip must stay on band time.
  Engine engine(kRate, 1);
  engine.setTransport(playingFrom(0));
  engine.setClip(0, makeClip(static_cast<long>(130 * kRate), 1, rampSample), 0, Bus::Track);
  const double ppm = 256;
  auto band = [&](double frame) { return frame * (1000.0 / kRate) / (1 + ppm * 1e-6); };
  std::vector<float> block(480);
  double worst = 0;
  unsigned noise = 777;
  for (int64_t f = 0; f < static_cast<int64_t>(120 * kRate); f += 480) {
    if (f % 48000 == 0) {
      noise = noise * 1103515245u + 12345u;  // clock sync is only good to about ±0.5 ms
      engine.observeClock(f, band(static_cast<double>(f)) + ((noise >> 16) % 1000) / 1000.0 - 0.5);
    }
    engine.render(block.data(), 480, f);
    if (f >= 30 * 48000 && f % 48000 == 0) {
      // The ramp value tells which source frame is playing.
      const double heard = block[100] / 0.8 * 48000;
      double expected = std::fmod(band(static_cast<double>(f + 100)) * 48, 48000);
      double err = std::fabs(heard - expected);
      if (err > 24000) err = 48000 - err;
      worst = std::fmax(worst, err);
    }
  }
  std::printf("  worst offset %.2f frames (%.3f ms)\n", worst, worst / 48);
  CHECK(worst < 48);  // under 1 ms
}

static void testClipJumpAndPauseNoClick() {
  std::printf("jump and pause without a click\n");
  auto maxStep = [](const std::vector<float>& s) {
    double m = 0;
    for (size_t i = 1; i < s.size(); ++i) m = std::fmax(m, std::fabs(s[i] - s[i - 1]));
    return m;
  };
  // A 440 Hz sine of 0.5 changes by at most 0.029 per sample; a hard cut would jump up to 1.
  {
    Engine engine(kRate, 1);
    engine.observeClock(0, 0);
    Transport t = playingFrom(0);
    t.hasJump = true;
    t.jumpAt = 500;
    t.jumpToMs = 2000.6;  // lands mid-cycle
    engine.setTransport(t);
    engine.setClip(0, makeClip(static_cast<long>(4 * kRate), 1, sineSample), 0, Bus::Track);
    const auto out = renderAll(engine, 1.0, 256);
    CHECK(maxStep(out) < 0.06);
    CHECK(std::fabs(out[36000]) > 0.01);  // still playing after the jump
  }
  {
    Engine engine(kRate, 1);
    engine.observeClock(0, 0);
    engine.setTransport(playingFrom(0));
    engine.setClip(0, makeClip(static_cast<long>(4 * kRate), 1, sineSample), 0, Bus::Track);
    std::vector<float> out(static_cast<size_t>(kRate));
    engine.render(out.data(), 24000, 0);
    Transport paused;
    paused.status = PlaybackStatus::Paused;
    paused.accumulatedMs = 500;
    engine.setTransport(paused);
    engine.render(out.data() + 24000, 24000, 24000);
    CHECK(maxStep(out) < 0.06);
    float tail = 0;
    for (size_t i = 24000 + 300; i < out.size(); ++i) tail = std::fmax(tail, std::fabs(out[i]));
    CHECK(tail == 0);  // faded out within 5 ms
    // Resuming mid-clip fades in again.
    Transport resumed = playingFrom(1000, 500);
    engine.setTransport(resumed);
    std::vector<float> more(24000);
    engine.render(more.data(), 24000, 48000);
    CHECK(std::fabs(more[0]) < 0.01);
    CHECK(maxStep(more) < 0.06);
  }
}

static void testClipBusesAndSwap() {
  std::printf("clip buses, replace and remove\n");
  Engine engine(kRate, 1);
  engine.observeClock(0, 0);
  engine.setTransport(playingFrom(0));
  engine.setClip(0, makeClip(48000, 1, sineSample), 0, Bus::Track);
  engine.setClip(1, makeClip(48000, 1, sineSample), 0, Bus::Stem, 0.5f);
  engine.setGain(Bus::Track, 0);
  std::vector<float> out(4800);
  engine.render(out.data(), 4800, 0);
  // Only the stem at 0.5 is left: 0.25 peak (the track fades out over the first 5 ms).
  float peak = 0;
  for (size_t i = 2400; i < out.size(); ++i) peak = std::fmax(peak, std::fabs(out[i]));
  CHECK_NEAR(peak, 0.25, 0.01);
  engine.setClip(1, makeClip(48000, 1, sineSample), 0, Bus::Stem, 1);  // replaces - old one retired
  engine.removeClip(0);
  engine.render(out.data(), 4800, 4800);
  engine.collectGarbage();
  peak = 0;
  for (size_t i = 0; i < out.size(); ++i) peak = std::fmax(peak, std::fabs(out[i]));
  CHECK_NEAR(peak, 0.5, 0.01);
}

int main() {
  setvbuf(stdout, nullptr, _IONBF, 0);
  testQueue();
  testTransport();
  testClockMap();
  testClockMapNoisy();
  testAndroidCallback();
  testClickOnsets();
  testFractionalOnset();
  testBlockSizeIndependence();
  testPauseAndJump();
  testLimiterAndGains();
  testPlanSwap();
  testClipExact();
  testClipFollowsDrift();
  testClipJumpAndPauseNoClick();
  testClipBusesAndSwap();
  runOpusClipTests();
  runResampleTests();
  runStreamClipTests();
  runOpusWriterTests();
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("all checks passed\n");
  return 0;
}
