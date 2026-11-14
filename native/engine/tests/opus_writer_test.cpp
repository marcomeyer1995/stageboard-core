// The track encoder (opus_writer.h) round trip through the strict reader (opus_clip.h): exactly the
// frames that went in, on the same sample, whatever pieces they came in.

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "check.h"
#include "stageboard/opus_clip.h"
#include "stageboard/opus_writer.h"

using namespace stageboard;

namespace {

/** A sine left, a chirp right (as the fixtures) - `frames` long. */
std::vector<float> signal(long frames, int channels) {
  const double pi = 3.14159265358979323846;
  std::vector<float> out(static_cast<size_t>(frames) * static_cast<size_t>(channels));
  const double k = (8000.0 - 200.0) / 1.5;
  for (long i = 0; i < frames; ++i) {
    const double t = i / 48000.0;
    const double left = 0.4 * std::sin(2 * pi * 440 * t), right = 0.3 * std::sin(2 * pi * (200 * t + 0.5 * k * t * t));
    if (channels == 1) out[static_cast<size_t>(i)] = static_cast<float>(0.5 * (left + right));
    else out[static_cast<size_t>(i) * 2] = static_cast<float>(left), out[static_cast<size_t>(i) * 2 + 1] = static_cast<float>(right);
  }
  return out;
}

std::vector<uint8_t> encode(const std::vector<float>& pcm, int channels, long chunk) {
  OpusWriter w;
  OpusWriter::Options o;
  o.channels = channels;
  CHECK(w.start(o));
  const long frames = static_cast<long>(pcm.size()) / channels;
  for (long f = 0; f < frames; f += chunk) w.write(pcm.data() + f * channels, std::min(chunk, frames - f));
  w.finish();
  return w.output();
}

std::vector<float> decode(const std::vector<uint8_t>& file, int* channels, std::string* error) {
  ClipData clip;
  if (!decodeOpus(file.data(), file.size(), clip, error)) return {};
  *channels = clip.channels;
  return clip.samples;
}

void testRoundTrip() {
  std::printf("encoder round trip: length, place, sound\n");
  for (int channels : {2, 1}) {
    const auto pcm = signal(72000, channels);
    const auto file = encode(pcm, channels, 4096);
    int got = 0;
    std::string error;
    const auto back = decode(file, &got, &error);
    CHECK(error.empty());
    CHECK(got == channels);
    CHECK(back.size() == pcm.size());
    // On the same sample: the chirp's correlation peaks at lag 0.
    const int c = channels - 1;
    int best = 0;
    double bestSum = -1e300;
    for (int lag = -50; lag <= 50; ++lag) {
      double sum = 0;
      for (long i = 100; i < 71900; ++i) sum += back[static_cast<size_t>((i + lag) * channels + c)] * pcm[static_cast<size_t>(i * channels + c)];
      if (sum > bestSum) bestSum = sum, best = lag;
    }
    double signalE = 0, errorE = 0;
    for (size_t i = 0; i < pcm.size(); ++i) signalE += double(pcm[i]) * pcm[i], errorE += double(back[i] - pcm[i]) * (back[i] - pcm[i]);
    const double snr = 10 * std::log10(signalE / errorE);
    std::printf("  %s: %zu bytes for 1.5 s (%.0f kbit/s), lag %d, SNR %.1f dB\n", channels == 2 ? "stereo" : "mono", file.size(), file.size() * 8 / 1.5 / 1000, best, snr);
    CHECK(best == 0);
    CHECK(snr > 33);
  }
}

void testAnyPieces() {
  std::printf("encoder: same bytes whatever pieces the frames come in\n");
  const auto pcm = signal(50000, 2);
  const auto whole = encode(pcm, 2, 50000);
  for (long chunk : {1L, 333L, 960L, 961L}) CHECK(encode(pcm, 2, chunk) == whole);
  // Taken piece by piece (written out while encoding) and put together: the same file.
  OpusWriter w;
  CHECK(w.start({}));
  std::vector<uint8_t> joined;
  for (long f = 0; f < 50000; f += 7000) {
    w.write(pcm.data() + f * 2, std::min(7000L, 50000 - f));
    const auto piece = w.take();
    joined.insert(joined.end(), piece.begin(), piece.end());
  }
  w.finish();
  const auto rest = w.take();
  joined.insert(joined.end(), rest.begin(), rest.end());
  CHECK(joined == whole);
}

void testExactLengths() {
  std::printf("encoder: exact length for any length\n");
  OpusWriter probe;
  CHECK(probe.start({}));
  const long preSkip = probe.preSkip();
  for (long frames : {0L, 1L, 959L, 960L, 961L, 960 - preSkip, 960 - preSkip + 1, 48000L * 3 + 17}) {
    const auto pcm = signal(frames, 2);
    int channels = 0;
    std::string error;
    const auto back = decode(encode(pcm, 2, 2048), &channels, &error);
    if (back.size() != pcm.size() || !error.empty()) std::printf("  %ld frames: got %zu values (%s)\n", frames, back.size(), error.c_str());
    CHECK(back.size() == pcm.size());
  }
  std::printf("  pre-skip %ld frames (the encoder's look-ahead)\n", preSkip);
}

}  // namespace

void runOpusWriterTests() {
  testRoundTrip();
  testAnyPieces();
  testExactLengths();
}
