// Opus decoder against files from another encoder (ffmpeg's libopus + Ogg muxer, made by
// fixtures/make_opus_fixtures.py) and the signal they were made from.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "check.h"
#include "stageboard/opus_clip.h"

using namespace stageboard;

namespace {

constexpr long kFixtureFrames = 72000;

std::vector<uint8_t> load(const char* name) {
  std::ifstream in(std::string(STAGEBOARD_FIXTURES) + "/" + name, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

/** The signal the fixtures were encoded from - as in make_opus_fixtures.py. */
std::vector<float> fixtureSignal(int channels) {
  const double pi = 3.14159265358979323846;
  const double k = (8000.0 - 200.0) / (kFixtureFrames / 48000.0);
  std::vector<float> out(static_cast<size_t>(kFixtureFrames) * static_cast<size_t>(channels));
  for (long i = 0; i < kFixtureFrames; ++i) {
    const double t = i / 48000.0;
    const double left = 0.4 * std::sin(2 * pi * 440 * t);
    const double right = 0.3 * std::sin(2 * pi * (200 * t + 0.5 * k * t * t));
    if (channels == 1) {
      out[static_cast<size_t>(i)] = static_cast<float>(0.5 * (left + right));
    } else {
      out[static_cast<size_t>(i) * 2] = static_cast<float>(left);
      out[static_cast<size_t>(i) * 2 + 1] = static_cast<float>(right);
    }
  }
  return out;
}

/** Shift (in frames) of `a` against `b` in channel `c` with the highest correlation, within ±range. */
int bestLag(const std::vector<float>& a, const std::vector<float>& b, int channels, int c, int range) {
  const long frames = static_cast<long>(a.size()) / channels;
  int best = 0;
  double bestSum = -1e300;
  for (int lag = -range; lag <= range; ++lag) {
    double sum = 0;
    for (long i = range; i < frames - range; ++i) sum += a[(i + lag) * channels + c] * b[i * channels + c];
    if (sum > bestSum) bestSum = sum, best = lag;
  }
  return best;
}

/** Signal to error in dB, channel `c`. */
double snrDb(const std::vector<float>& decoded, const std::vector<float>& ref, int channels, int c) {
  double signal = 0, error = 0;
  for (size_t i = static_cast<size_t>(c); i < ref.size(); i += static_cast<size_t>(channels)) {
    signal += double(ref[i]) * ref[i];
    error += double(decoded[i] - ref[i]) * (decoded[i] - ref[i]);
  }
  return 10 * std::log10(signal / error);
}

std::vector<float> readAll(OpusClip& clip, int chunk) {
  std::vector<float> out(static_cast<size_t>(clip.frames()) * static_cast<size_t>(clip.channels()));
  long done = 0;
  while (true) {
    const int n = clip.read(out.data() + done * clip.channels(), static_cast<int>(std::min<long>(chunk, clip.frames() - done)));
    if (n == 0) break;
    done += n;
  }
  CHECK(done == clip.frames());
  return out;
}

/** Ogg's page checksum, written again here (not taken from the decoder) to patch test files. */
uint32_t pageCrc(const uint8_t* page, size_t length) {
  uint32_t crc = 0;
  for (size_t i = 0; i < length; ++i) {
    crc ^= static_cast<uint32_t>(i >= 22 && i < 26 ? 0 : page[i]) << 24;
    for (int b = 0; b < 8; ++b) crc = crc & 0x80000000u ? (crc << 1) ^ 0x04c11db7u : crc << 1;
  }
  return crc;
}

void setPageCrc(std::vector<uint8_t>& file, size_t page) {
  size_t length = 27 + file[page + 26];
  for (size_t s = 0; s < file[page + 26]; ++s) length += file[page + 27 + s];
  const uint32_t crc = pageCrc(file.data() + page, length);
  for (int i = 0; i < 4; ++i) file[page + 22 + static_cast<size_t>(i)] = static_cast<uint8_t>(crc >> (8 * i));
}

void testDecodesFixture(const char* name, int channels, double minSnr) {
  const std::vector<uint8_t> file = load(name);
  CHECK(!file.empty());
  OpusClip clip;
  std::string error;
  CHECK(clip.open(file.data(), file.size(), &error));
  CHECK(clip.channels() == channels);
  // Exactly the encoded length: pre-skip dropped at the start, the last page's trim at the end.
  CHECK(clip.frames() == kFixtureFrames);
  const std::vector<float> decoded = readAll(clip, 4096);
  const std::vector<float> ref = fixtureSignal(channels);
  // The first sample is the first sample of the signal - not a single one early or late. Only the
  // chirp shows it (a sine correlates every period); the SNR then says the sine sits right too -
  // one sample off would leave 440 Hz at ~25 dB.
  CHECK(bestLag(decoded, ref, channels, channels - 1, 400) == 0);
  for (int c = 0; c < channels; ++c) {
    const double snr = snrDb(decoded, ref, channels, c);
    std::printf("  %s channel %d: SNR %.1f dB\n", name, c, snr);
    CHECK(snr > minSnr);
  }
}

void testChunkSizesAndWholeDecode() {
  const std::vector<uint8_t> file = load("stereo.opus");
  OpusClip clip;
  CHECK(clip.open(file.data(), file.size()));
  const std::vector<float> ref = readAll(clip, 4096);
  for (int chunk : {1, 7, 960, 1000, 100000}) {
    clip.seek(0);
    CHECK(readAll(clip, chunk) == ref);
  }
  ClipData whole;
  CHECK(decodeOpus(file.data(), file.size(), whole));
  CHECK(whole.channels == 2 && whole.samples == ref);
}

void testSeek() {
  const std::vector<uint8_t> file = load("stereo.opus");
  OpusClip clip;
  CHECK(clip.open(file.data(), file.size()));
  const std::vector<float> ref = readAll(clip, 4096);
  const int n = 4800;
  std::vector<float> got(static_cast<size_t>(n) * 2);
  double worstDb = -1e9;
  for (long target : {0L, 1L, 500L, 11519L, 11520L, 20000L, 33333L, 50001L, 60000L, kFixtureFrames - n}) {
    clip.seek(target);
    CHECK(clip.position() == target);
    CHECK(clip.read(got.data(), n) == n);
    CHECK(clip.position() == target + n);
    double signal = 0, error = 0;
    for (size_t i = 0; i < got.size(); ++i) {
      const float r = ref[static_cast<size_t>(target) * 2 + i];
      signal += double(r) * r;
      error += double(got[i] - r) * (got[i] - r);
    }
    if (target < OpusClip::kPreRoll) {
      // Within the pre-roll of the start the decoder starts from the first packet: exact.
      CHECK(error == 0);
    } else {
      // From the middle the decoder starts 240 ms early and has converged by the target.
      worstDb = std::max(worstDb, 10 * std::log10(error / signal + 1e-30));
    }
  }
  std::printf("  seek mid-clip: error at most %.1f dB below the signal\n", -worstDb);
  CHECK(worstDb < -60);
  // Past the end: nothing more to read.
  clip.seek(kFixtureFrames + 100);
  CHECK(clip.position() == kFixtureFrames);
  CHECK(clip.read(got.data(), n) == 0);
}

void testOutputGain() {
  std::vector<uint8_t> file = load("stereo.opus");
  OpusClip plain;
  CHECK(plain.open(file.data(), file.size()));
  const std::vector<float> ref = readAll(plain, 4096);
  // OpusHead's output gain (Q7.8 dB) at byte 16 of the first packet - +6.0206 dB doubles.
  const size_t head = 28;
  CHECK(std::string(file.begin() + head, file.begin() + head + 8) == "OpusHead");
  const int16_t gain = 1541;
  file[head + 16] = static_cast<uint8_t>(gain & 0xff);
  file[head + 17] = static_cast<uint8_t>(gain >> 8);
  setPageCrc(file, 0);
  OpusClip louder;
  std::string error;
  CHECK(louder.open(file.data(), file.size(), &error));
  const std::vector<float> got = readAll(louder, 4096);
  double worst = 0;
  for (size_t i = 0; i < ref.size(); ++i) worst = std::max(worst, std::fabs(got[i] - 2.0 * ref[i]));
  CHECK(worst < 2e-3);
}

void testRejectsDamage() {
  const std::vector<uint8_t> file = load("stereo.opus");
  std::string error;
  OpusClip clip;
  // One flipped bit in the audio: the page checksum catches it - nothing plays.
  std::vector<uint8_t> flipped = file;
  flipped[file.size() / 2] ^= 0x10;
  CHECK(!clip.open(flipped.data(), flipped.size(), &error));
  CHECK(error.find("Prüfsumme") != std::string::npos);
  // Cut off mid-page (an interrupted download).
  CHECK(!clip.open(file.data(), file.size() / 2, &error));
  CHECK(error.find("abgeschnitten") != std::string::npos);
  // Cut off exactly between pages: still incomplete, the last page is missing.
  size_t lastPage = 0;
  for (size_t i = 1; i + 4 < file.size(); ++i)
    if (std::equal(file.begin() + static_cast<long>(i), file.begin() + static_cast<long>(i) + 4, "OggS")) lastPage = i;
  CHECK(lastPage > 0);
  CHECK(!clip.open(file.data(), lastPage, &error));
  CHECK(error.find("abgeschnitten") != std::string::npos);
  // Not Ogg at all, or nothing.
  const uint8_t junk[64] = {'R', 'I', 'F', 'F'};
  CHECK(!clip.open(junk, sizeof junk, &error));
  CHECK(!clip.open(nullptr, 0, &error));
  CHECK(clip.frames() == 0 && clip.read(nullptr, 0) == 0);
  // A failed open leaves nothing half-open; the good file still opens afterwards.
  CHECK(clip.open(file.data(), file.size(), &error));
  CHECK(clip.frames() == kFixtureFrames);
}

}  // namespace

void runOpusClipTests() {
  testDecodesFixture("stereo.opus", 2, 33);
  testDecodesFixture("mono.opus", 1, 33);
  testChunkSizesAndWholeDecode();
  testSeek();
  testOutputGain();
  testRejectsDamage();
}
