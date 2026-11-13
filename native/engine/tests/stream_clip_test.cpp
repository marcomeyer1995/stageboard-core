// Streamed clips (stream_clip.h) against the same file wholly in memory: the stream must play the
// same, jump without a gap where the jump was announced, and never play anything stale.

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <thread>
#include <vector>

#include "check.h"
#include "stageboard/engine.h"
#include "stageboard/stream_clip.h"

using namespace stageboard;

namespace {

constexpr int kBlock = 256;
/** A small window on purpose: 85 ms, so a 1.5 s clip wraps it many times. */
constexpr int kRing = 4096;

std::vector<uint8_t> load() {
  std::ifstream in(std::string(STAGEBOARD_FIXTURES) + "/stereo.opus", std::ios::binary);
  return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

ClipSource* inMemory(const std::vector<uint8_t>& file) {
  auto* clip = new ClipData();
  decodeOpus(file.data(), file.size(), *clip);
  return clip;
}

StreamedClip* streamed(const std::vector<uint8_t>& file) {
  auto* clip = new StreamedClip(kRing);
  CHECK(clip->open(file.data(), file.size()));
  return clip;
}

Transport playing(double accumulatedMs = 0) {
  Transport t;
  t.status = PlaybackStatus::Playing;
  t.startedAt = 0;
  t.accumulatedMs = accumulatedMs;
  return t;
}

/** Renders `seconds` of an engine with clip 0; `each(frame)` before every block (pump, changes). */
template <typename Each>
std::vector<float> render(ClipSource* clip, const Transport& t, double seconds, Each each) {
  Engine engine(48000, 2);
  engine.observeClock(0, 0);
  engine.setTransport(t);
  engine.setClip(0, clip, 0, Bus::Track);
  std::vector<float> out(static_cast<size_t>(seconds * 48000) * 2);
  const int64_t total = static_cast<int64_t>(out.size() / 2);
  for (int64_t f = 0; f < total; f += kBlock) {
    each(engine, f);
    engine.render(out.data() + f * 2, static_cast<int>(std::min<int64_t>(kBlock, total - f)), f);
  }
  return out;
}

/** Error below the reference in dB over frames [from, to). */
double errorDb(const std::vector<float>& got, const std::vector<float>& ref, long from, long to) {
  double signal = 0, error = 0;
  for (long i = from * 2; i < to * 2; ++i) {
    signal += double(ref[i]) * ref[i];
    error += double(got[i] - ref[i]) * (got[i] - ref[i]);
  }
  return 10 * std::log10(error / signal + 1e-30);
}

double maxStep(const std::vector<float>& s) {
  double worst = 0;
  for (size_t i = 2; i < s.size(); ++i) worst = std::fmax(worst, std::fabs(s[i] - s[i - 2]));
  return worst;
}

void testPlaysThrough() {
  std::printf("streamed clip plays as the clip in memory\n");
  const auto file = load();
  const auto pumping = [](Engine& e, int64_t) { e.pump(); };
  const auto ref = render(inMemory(file), playing(), 1.6, pumping);
  StreamedClip* clip = streamed(file);
  const auto got = render(clip, playing(), 1.6, pumping);
  double diff = 0;
  for (size_t i = 0; i < ref.size(); ++i) diff = std::fmax(diff, std::fabs(got[i] - ref[i]));
  std::printf("  1.6 s through an 85 ms window: largest difference %.2g\n", diff);
  CHECK(diff == 0);
}

void testAnnouncedJump(double atMs, double toMs) {
  std::printf("announced jump at %.0f ms to %.0f ms: no gap\n", atMs, toMs);
  const auto file = load();
  Transport t = playing();
  t.hasJump = true;
  t.jumpAt = atMs;
  t.jumpToMs = toMs;
  const auto pumping = [](Engine& e, int64_t) { e.pump(); };
  const auto ref = render(inMemory(file), t, 1.4, pumping);
  int broken = -1;
  StreamedClip* clip = streamed(file);
  const auto got = render(clip, t, 1.4, [&](Engine& e, int64_t) {
    e.pump();
    broken = clip->brokenReads();
  });
  const long jump = static_cast<long>(atMs * 48);
  const double before = errorDb(got, ref, 0, jump);
  const double after = errorDb(got, ref, jump, jump + 9600);
  std::printf("  before %.0f dB, the 200 ms after it %.1f dB below the signal\n", before, -after);
  CHECK(before < -200);
  CHECK(after < -55);
  CHECK(broken == 0);
}

void testUnannouncedSeek() {
  std::printf("seek nobody announced: short silence, faded in, no click\n");
  const auto file = load();
  // At 0.5 s the transport is set anew: playing from 1.1 s of the song.
  const auto change = [](Engine& e, int64_t f) {
    if (f == 24064) {
      Transport t = playing(1100);
      t.startedAt = f / 48.0;
      e.setTransport(t);
    }
    e.pump();
  };
  const auto ref = render(inMemory(file), playing(), 1.0, change);
  const auto got = render(streamed(file), playing(), 1.0, change);
  // The old place fades out (5 ms), then silence until decoded, then the new place fades in.
  long firstSound = 24064 + 240;
  while (firstSound < 48000 && got[firstSound * 2] == 0 && got[firstSound * 2 + 1] == 0) ++firstSound;
  const double gapMs = (firstSound - 24064 - 240) / 48.0;
  std::printf("  gap %.1f ms, then %.1f dB below the signal, largest step %.3f (in memory %.3f)\n", gapMs, -errorDb(got, ref, firstSound + 960, 48000), maxStep(got),
              maxStep(ref));
  CHECK(gapMs < 15);
  CHECK(errorDb(got, ref, firstSound + 960, 48000) < -55);
  CHECK(maxStep(got) <= maxStep(ref) + 0.02);  // the chirp itself steps 0.31 at 8 kHz
}

void testStarvedDecoder() {
  std::printf("decoder held up: silence, never stale sound\n");
  const auto file = load();
  StreamedClip* clip = streamed(file);
  const auto ref = render(inMemory(file), playing(), 1.2, [](Engine& e, int64_t) { e.pump(); });
  // No decoding from 0.3 s to 0.6 s. (The clip is the engine's: read it while it lives.)
  int broken = 0, missing = 0;
  const long ahead = clip->aheadFrames();
  const auto got = render(clip, playing(), 1.2, [&](Engine& e, int64_t f) {
    if (f < 14400 || f >= 28800) e.pump();
    broken = clip->brokenReads();
    missing = clip->missingReads();
  });
  // Up to where the window ran out it is the clip; after that only silence until the decoder
  // is back, then the clip again (faded in).
  long silentFrom = 14400;
  while (silentFrom < 28800 && got[silentFrom * 2] != 0) ++silentFrom;
  bool stale = false;
  for (long f = silentFrom + 240; f < 28800; ++f) stale = stale || got[f * 2] != 0 || got[f * 2 + 1] != 0;
  std::printf("  sound until %.0f ms (window ahead %.0f ms), silent until the decoder came back; %d pieces missing, %d broken\n", silentFrom / 48.0,
              ahead / 48.0, missing, broken);
  CHECK(errorDb(got, ref, 0, silentFrom - 240) < -200);
  CHECK(!stale);
  CHECK(errorDb(got, ref, 28800 + 2400, 57600) < -55);
  CHECK(missing > 0);  // counted for self-monitoring
  // Running dry cuts off (nothing to fade out with) - coming back fades in, no click.
  const std::vector<float> back(got.begin() + 28800 * 2, got.end());
  CHECK(maxStep(back) <= maxStep(ref) + 0.02);  // the chirp itself steps 0.31 at 8 kHz
}

void testDecodingThread() {
  std::printf("decoding on its own thread while the audio thread renders\n");
  const auto file = load();
  const auto ref = render(inMemory(file), playing(), 1.5, [](Engine&, int64_t) {});
  Engine engine(48000, 2);
  engine.observeClock(0, 0);
  engine.setTransport(playing());
  StreamedClip* clip = streamed(file);
  engine.setClip(0, clip, 0, Bus::Track);
  // Filled before Play, as the Play lead gives time for.
  for (int i = 0; i < 4; ++i) engine.pump();
  std::atomic<bool> stop{false};
  std::thread decoder([&] {
    while (!stop.load()) {
      engine.pump();
      std::this_thread::sleep_for(std::chrono::microseconds(500));
    }
  });
  std::vector<float> got(ref.size());
  const int64_t total = static_cast<int64_t>(got.size() / 2);
  for (int64_t f = 0; f < total; f += kBlock) {
    engine.render(got.data() + f * 2, static_cast<int>(std::min<int64_t>(kBlock, total - f)), f);
    std::this_thread::sleep_for(std::chrono::microseconds(1500));  // ~3.5× faster than real time
  }
  stop = true;
  decoder.join();
  double diff = 0;
  for (size_t i = 0; i < ref.size(); ++i) diff = std::fmax(diff, std::fabs(got[i] - ref[i]));
  std::printf("  largest difference %.2g, broken reads %d\n", diff, clip->brokenReads());
  CHECK(diff == 0);
  CHECK(clip->brokenReads() == 0);
}

}  // namespace

void runStreamClipTests() {
  testPlaysThrough();
  testAnnouncedJump(700, 200);
  testAnnouncedJump(400, 1000);
  testUnannouncedSeek();
  testStarvedDecoder();
  testDecodingThread();
}
