// The resampler (sinc.h) inside the clip player: clips at one rate played on an output at another,
// compared with the signal computed directly at the output's times.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "check.h"
#include "stageboard/engine.h"

using namespace stageboard;

namespace {

const double kPi = 3.14159265358979323846;

ClipData* sineClip(double rate, double hz, double seconds) {
  auto* clip = new ClipData();
  clip->channels = 1;
  clip->rate = rate;
  clip->samples.resize(static_cast<size_t>(rate * seconds));
  for (size_t i = 0; i < clip->samples.size(); ++i)
    clip->samples[i] = static_cast<float>(0.5 * std::sin(2 * kPi * hz * static_cast<double>(i) / rate));
  return clip;
}

/** Plays `clip` from song time `startMs` on a mono output at `outRate`; band time = output time. */
std::vector<float> play(double outRate, ClipData* clip, double startMs, double seconds) {
  Engine engine(outRate, 1);
  engine.observeClock(0, 0);
  Transport t;
  t.status = PlaybackStatus::Playing;
  engine.setTransport(t);
  engine.setClip(0, clip, startMs, Bus::Track);
  std::vector<float> out(static_cast<size_t>(outRate * seconds));
  for (size_t f = 0; f < out.size(); f += 256) {
    const int n = static_cast<int>(std::min<size_t>(256, out.size() - f));
    engine.render(out.data() + f, n, static_cast<int64_t>(f));
  }
  return out;
}

/** Signal to error in dB against the sine computed at the output's own sample times. */
double sineSnr(const std::vector<float>& out, double outRate, double hz, double startMs, double fromS, double toS) {
  double signal = 0, error = 0;
  for (size_t m = static_cast<size_t>(fromS * outRate); m < static_cast<size_t>(toS * outRate); ++m) {
    const double t = static_cast<double>(m) / outRate - startMs / 1000;
    const double want = 0.5 * std::sin(2 * kPi * hz * t);
    signal += want * want;
    error += (out[m] - want) * (out[m] - want);
  }
  return 10 * std::log10(signal / error);
}

double rmsDb(const std::vector<float>& out, double outRate, double fromS, double toS) {
  double sum = 0;
  const size_t a = static_cast<size_t>(fromS * outRate), b = static_cast<size_t>(toS * outRate);
  for (size_t m = a; m < b; ++m) sum += double(out[m]) * out[m];
  return 10 * std::log10(sum / static_cast<double>(b - a) / (0.5 * 0.5 / 2));
}

void testFortyEightToFortyFour() {
  std::printf("48 kHz clip on a 44.1 kHz output\n");
  // An odd start puts every output sample between two source samples, differently each time.
  const double start = 100.0137;
  for (double hz : {100.0, 1000.0, 5000.0, 10000.0, 15000.0, 18000.0, 20000.0}) {
    const std::vector<float> out = play(44100, sineClip(48000, hz, 1.2), start, 1.2);
    const double snr = sineSnr(out, 44100, hz, start, 0.2, 1.2);
    std::printf("  %5.0f Hz: SNR %.1f dB\n", hz, snr);
    // Far below Opus' own coding noise (~36 dB) up to 20 kHz, where Opus stops.
    CHECK(snr > (hz <= 18000 ? 90 : 65));
  }
}

void testFoldBack() {
  std::printf("above the output's Nyquist (22.05 kHz)\n");
  // 23 kHz can't exist at 44.1 kHz; what is let through folds back to 21.1 kHz - above hearing,
  // and Opus carries nothing above 20 kHz. Damped, not removed: sinc.h says why.
  for (double hz : {21000.0, 22000.0, 23000.0}) {
    const double db = rmsDb(play(44100, sineClip(48000, hz, 1.2), 100, 1.2), 44100, 0.2, 1.2);
    std::printf("  %5.0f Hz: %.1f dB\n", hz, db);
    if (hz >= 23000) CHECK(db < -18);
  }
}

void testBetweenSamples() {
  std::printf("48 kHz clip on 48 kHz, read between samples (drift): highs keep their level\n");
  // Between samples linear interpolation took up to 2 dB off 10 kHz; the sinc doesn't.
  for (double hz : {1000.0, 10000.0, 16000.0, 20000.0}) {
    const std::vector<float> out = play(48000, sineClip(48000, hz, 1.2), 100.0104, 1.2);
    const double snr = sineSnr(out, 48000, hz, 100.0104, 0.2, 1.2);
    std::printf("  %5.0f Hz between samples: SNR %.1f dB\n", hz, snr);
    CHECK(snr > (hz <= 16000 ? 80 : 30));
  }
}

void testAnnouncementRate() {
  std::printf("22.05 kHz announcement on 48 kHz\n");
  for (double hz : {300.0, 3000.0, 8000.0}) {
    const std::vector<float> out = play(48000, sineClip(22050, hz, 1.2), 50.003, 1.2);
    const double snr = sineSnr(out, 48000, hz, 50.003, 0.2, 1.2);
    std::printf("  %5.0f Hz: SNR %.1f dB\n", hz, snr);
    CHECK(snr > 80);
  }
}

void testRejectsBadClip() {
  Engine engine(48000, 2);
  auto* clip = new ClipData();
  clip->rate = 0;
  CHECK(!engine.setClip(0, clip, 0, Bus::Track));  // and freed - ASan would say otherwise
  CHECK(!engine.setClip(0, nullptr, 0, Bus::Track));
}

}  // namespace

void runResampleTests() {
  testFortyEightToFortyFour();
  testFoldBack();
  testBetweenSamples();
  testAnnouncementRate();
  testRejectsBadClip();
}
