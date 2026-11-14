#include "stageboard/opus_writer.h"

#include <opus.h>

#include <algorithm>
#include <cstring>

#include "ogg_crc.h"

namespace stageboard {

namespace {

/** Packets per page: a second of audio - a page is the unit a damaged download loses. */
constexpr int kPacketsPerPage = 50;
/** libopus never makes a packet larger than this. */
constexpr int kMaxPacket = 4000;

void le16(std::vector<uint8_t>& v, uint32_t x) {
  for (int i = 0; i < 2; ++i) v.push_back(static_cast<uint8_t>(x >> (8 * i)));
}
void le32(std::vector<uint8_t>& v, uint32_t x) {
  for (int i = 0; i < 4; ++i) v.push_back(static_cast<uint8_t>(x >> (8 * i)));
}

bool fail(std::string* error, const char* reason) {
  if (error) *error = reason;
  return false;
}

}  // namespace

OpusWriter::~OpusWriter() {
  if (encoder_) opus_encoder_destroy(encoder_);
}

bool OpusWriter::start(const Options& options, std::string* error) {
  if (encoder_) opus_encoder_destroy(encoder_);
  encoder_ = nullptr;
  if (options.channels < 1 || options.channels > 2) return fail(error, "nur Mono und Stereo");
  int status = OPUS_OK;
  encoder_ = opus_encoder_create(kRate, options.channels, OPUS_APPLICATION_AUDIO, &status);
  if (status != OPUS_OK || !encoder_) {
    encoder_ = nullptr;
    return fail(error, "Opus-Encoder nicht verfügbar");
  }
  opus_encoder_ctl(encoder_, OPUS_SET_BITRATE(options.bitrate));
  opus_encoder_ctl(encoder_, OPUS_SET_COMPLEXITY(options.complexity));
  opus_encoder_ctl(encoder_, OPUS_SET_SIGNAL(OPUS_SIGNAL_MUSIC));
  // Free VBR, as opusenc and ffmpeg: hard passages get more bits, easy ones fewer - the average
  // stays near the bitrate. libopus' own default holds every packet near it (constrained): on
  // the test chirp the right channel fell from 36 to 25 dB.
  opus_encoder_ctl(encoder_, OPUS_SET_VBR(1));
  opus_encoder_ctl(encoder_, OPUS_SET_VBR_CONSTRAINT(0));
  opus_int32 lookahead = 0;
  opus_encoder_ctl(encoder_, OPUS_GET_LOOKAHEAD(&lookahead));
  channels_ = options.channels;
  preSkip_ = lookahead;
  sequence_ = 0;
  framesIn_ = 0;
  samplesEncoded_ = 0;
  frame_.assign(static_cast<size_t>(kFrameSize) * static_cast<size_t>(channels_), 0.0f);
  frameFill_ = 0;
  finished_ = false;
  body_.clear();
  lacing_.clear();
  packetsInPage_ = 0;
  out_.clear();

  // RFC 7845 §5.1: the identification header, a page of its own, the stream's first.
  std::vector<uint8_t> head = {'O', 'p', 'u', 's', 'H', 'e', 'a', 'd', 1, static_cast<uint8_t>(channels_)};
  le16(head, static_cast<uint32_t>(preSkip_));
  le32(head, kRate);
  le16(head, 0);   // output gain
  head.push_back(0);  // mapping family 0: mono or stereo
  page(head.data(), {static_cast<uint8_t>(head.size())}, head.size(), 0, 0x02);
  // §5.2: the comment header - who made it, no tags.
  const std::string vendor = std::string("StageBoard, libopus ") + opus_get_version_string();
  std::vector<uint8_t> tags = {'O', 'p', 'u', 's', 'T', 'a', 'g', 's'};
  le32(tags, static_cast<uint32_t>(vendor.size()));
  tags.insert(tags.end(), vendor.begin(), vendor.end());
  le32(tags, 0);
  std::vector<uint8_t> lacing(tags.size() / 255, 255);
  lacing.push_back(static_cast<uint8_t>(tags.size() % 255));
  page(tags.data(), lacing, tags.size(), 0, 0);
  return true;
}

void OpusWriter::write(const float* pcm, long frames) {
  if (!encoder_ || finished_) return;
  framesIn_ += frames;
  while (frames > 0) {
    const int n = static_cast<int>(std::min<long>(frames, kFrameSize - frameFill_));
    std::memcpy(frame_.data() + static_cast<size_t>(frameFill_) * static_cast<size_t>(channels_), pcm,
                sizeof(float) * static_cast<size_t>(n) * static_cast<size_t>(channels_));
    frameFill_ += n;
    pcm += static_cast<size_t>(n) * static_cast<size_t>(channels_);
    frames -= n;
    if (frameFill_ == kFrameSize) encodeFrame();
  }
}

void OpusWriter::encodeFrame() {
  uint8_t packet[kMaxPacket];
  const int size = opus_encode_float(encoder_, frame_.data(), kFrameSize, packet, kMaxPacket);
  samplesEncoded_ += kFrameSize;
  frameFill_ = 0;
  // A failed packet would be a hole in the file - libopus doesn't fail on valid input, but if
  // it did, an empty packet keeps the timing (decoded as concealment).
  addPacket(packet, size > 0 ? size : 0, samplesEncoded_);
}

void OpusWriter::addPacket(const uint8_t* data, int size, int64_t granule) {
  const size_t segments = static_cast<size_t>(size / 255 + 1);
  // A full page goes out before the next packet - so the last packet always waits for finish().
  if (packetsInPage_ >= kPacketsPerPage || lacing_.size() + segments > 255) flushPage(false);
  body_.insert(body_.end(), data, data + size);
  // 255s and the rest - a packet of a multiple of 255 bytes ends with a 0 lace.
  for (int left = size; left >= 0; left -= 255) lacing_.push_back(static_cast<uint8_t>(std::min(left, 255)));
  pageGranule_ = granule;
  ++packetsInPage_;
}

void OpusWriter::flushPage(bool last) {
  if (packetsInPage_ == 0 && !last) return;
  page(body_.data(), lacing_, body_.size(), pageGranule_, last ? 0x04 : 0);
  body_.clear();
  lacing_.clear();
  packetsInPage_ = 0;
}

void OpusWriter::finish() {
  if (!encoder_ || finished_) return;
  // The decoder drops `preSkip` samples first: what went in ends at preSkip + framesIn - encode
  // silence until that is covered, then say on the last page where it ends.
  const int64_t end = preSkip_ + static_cast<int64_t>(framesIn_);
  while (samplesEncoded_ < end || frameFill_ > 0) {
    std::fill(frame_.begin() + static_cast<long>(frameFill_) * channels_, frame_.end(), 0.0f);
    frameFill_ = kFrameSize;
    encodeFrame();
  }
  pageGranule_ = end;
  flushPage(true);
  finished_ = true;
}

std::vector<uint8_t> OpusWriter::take() {
  std::vector<uint8_t> taken;
  taken.swap(out_);
  return taken;
}

void OpusWriter::page(const uint8_t* body, const std::vector<uint8_t>& lacing, size_t bodySize, int64_t granule, uint8_t flags) {
  const size_t start = out_.size();
  const uint8_t header[] = {'O', 'g', 'g', 'S', 0, flags};
  out_.insert(out_.end(), header, header + sizeof header);
  for (int i = 0; i < 8; ++i) out_.push_back(static_cast<uint8_t>(static_cast<uint64_t>(granule) >> (8 * i)));
  le32(out_, serial_);
  le32(out_, sequence_++);
  le32(out_, 0);  // checksum, filled in below
  out_.push_back(static_cast<uint8_t>(lacing.size()));
  out_.insert(out_.end(), lacing.begin(), lacing.end());
  out_.insert(out_.end(), body, body + bodySize);
  const uint32_t crc = detail::oggCrc(0, out_.data() + start, out_.size() - start);
  for (int i = 0; i < 4; ++i) out_[start + 22 + static_cast<size_t>(i)] = static_cast<uint8_t>(crc >> (8 * i));
}

}  // namespace stageboard
