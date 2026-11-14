#include "stageboard/opus_clip.h"

#include <opus.h>

#include "ogg_crc.h"

#include <algorithm>
#include <array>
#include <cstring>
#include <memory>

namespace stageboard {

namespace {

/** Largest Opus packet: 120 ms. */
constexpr int kMaxPacketFrames = 5760;

uint32_t le32(const uint8_t* p) {
  return static_cast<uint32_t>(p[0]) | static_cast<uint32_t>(p[1]) << 8 | static_cast<uint32_t>(p[2]) << 16 |
         static_cast<uint32_t>(p[3]) << 24;
}

int64_t le64(const uint8_t* p) {
  return static_cast<int64_t>(static_cast<uint64_t>(le32(p)) | static_cast<uint64_t>(le32(p + 4)) << 32);
}

bool fail(std::string* error, const char* reason) {
  if (error) *error = reason;
  return false;
}

}  // namespace

OpusClip::~OpusClip() {
  if (decoder_) opus_decoder_destroy(decoder_);
}

bool OpusClip::open(const uint8_t* data, size_t size, std::string* error) {
  if (decoder_) opus_decoder_destroy(decoder_);
  decoder_ = nullptr;
  index_.reset();
  position_ = 0;
  auto index = std::make_shared<Index>();
  Index& x = *index;

  // 1. Pages into packets. Every page is checked: a damaged or cut-off download must not play.
  struct PageEnd {
    size_t packets;  // packets complete after this page
    int64_t granule;
  };
  std::vector<PageEnd> pageEnds;
  std::vector<size_t> starts;  // offset in x.data of each packet, plus one past the last
  x.data.reserve(size);
  uint32_t serial = 0;
  uint32_t sequence = 0;
  bool open = false;  // a packet continues on the next page
  bool ended = false;
  size_t pos = 0;
  while (pos < size && !ended) {
    if (size - pos < 27) return fail(error, "Datei abgeschnitten");
    const uint8_t* page = data + pos;
    if (std::memcmp(page, "OggS", 4) != 0 || page[4] != 0) return fail(error, "keine Ogg-Datei");
    const uint8_t flags = page[5];
    const size_t segments = page[26];
    if (size - pos < 27 + segments) return fail(error, "Datei abgeschnitten");
    size_t body = 0;
    for (size_t s = 0; s < segments; ++s) body += page[27 + s];
    const size_t length = 27 + segments + body;
    if (size - pos < length) return fail(error, "Datei abgeschnitten");

    // The checksum is taken with its own four bytes as zero.
    const uint8_t zero[4] = {};
    const uint32_t crc = detail::oggCrc(detail::oggCrc(detail::oggCrc(0, page, 22), zero, 4), page + 26, length - 26);
    if (crc != le32(page + 22)) return fail(error, "Datei beschädigt (Prüfsumme)");

    const bool first = pageEnds.empty() && starts.empty() && !open;
    if (first) {
      if (!(flags & 0x02)) return fail(error, "Anfang der Datei fehlt");
      serial = le32(page + 14);
    } else {
      if (le32(page + 14) != serial) return fail(error, "mehrere Spuren in einer Datei - nicht unterstützt");
      if (le32(page + 18) != sequence + 1) return fail(error, "Datei unvollständig (Seite fehlt)");
    }
    sequence = le32(page + 18);
    if (static_cast<bool>(flags & 0x01) != open) return fail(error, "Datei beschädigt (Paketgrenzen)");

    const uint8_t* bytes = page + 27 + segments;
    for (size_t s = 0; s < segments; ++s) {
      const uint8_t lace = page[27 + s];
      if (!open) starts.push_back(x.data.size());
      x.data.insert(x.data.end(), bytes, bytes + lace);
      bytes += lace;
      open = lace == 255;
    }
    const size_t complete = starts.size() - (open ? 1 : 0);
    const int64_t granule = le64(page + 6);
    if (granule != -1) pageEnds.push_back({complete, granule});
    ended = flags & 0x04;
    pos += length;
  }
  if (!ended || open) return fail(error, "Datei abgeschnitten");
  starts.push_back(x.data.size());
  const size_t count = starts.size() - 1;

  // 2. The two header packets (RFC 7845 §5).
  if (count < 2) return fail(error, "keine Audiodaten");
  const uint8_t* head = x.data.data() + starts[0];
  const size_t headSize = starts[1] - starts[0];
  if (headSize < 19 || std::memcmp(head, "OpusHead", 8) != 0) return fail(error, "keine Opus-Datei");
  if ((head[8] & 0xf0) != 0) return fail(error, "Opus-Version nicht unterstützt");
  x.channels = head[9];
  x.preSkip = head[10] | head[11] << 8;
  x.gain = static_cast<int16_t>(head[16] | head[17] << 8);
  if (head[18] != 0 || x.channels < 1 || x.channels > 2) return fail(error, "nur Mono und Stereo unterstützt");
  if (starts[2] - starts[1] < 8 || std::memcmp(x.data.data() + starts[1], "OpusTags", 8) != 0)
    return fail(error, "keine Opus-Datei");

  // 3. Each audio packet's place in time, checked against the pages' granule positions.
  int64_t total = 0;
  for (size_t i = 2; i < count; ++i) {
    const int bytes = static_cast<int>(starts[i + 1] - starts[i]);
    const int samples = bytes > 0 ? opus_packet_get_nb_samples(x.data.data() + starts[i], bytes, kRate) : -1;
    if (samples <= 0) return fail(error, "Datei beschädigt (Audiopaket)");
    x.packets.push_back({starts[i], bytes, samples, total});
    total += samples;
  }
  if (x.packets.empty()) return fail(error, "keine Audiodaten");
  // The first audio page may say the stream begins before 0 (the start is cut, RFC 7845 §4.5);
  // a stream that begins later than 0 is a cut-out piece of a live stream - not a track.
  int64_t base = 0;
  bool firstPage = true;
  int64_t lastGranule = 0;
  for (const PageEnd& end : pageEnds) {
    if (end.packets <= 2) continue;  // header pages
    const Packet& last = x.packets[end.packets - 3];
    const int64_t sum = last.start + last.samples;  // samples of the packets complete so far
    if (firstPage) {
      base = end.granule - sum;
      if (base > 0) return fail(error, "Datei beginnt nicht am Anfang");
      firstPage = false;
    } else if (end.packets - 2 < x.packets.size() && end.granule != base + sum) {
      return fail(error, "Datei beschädigt (Zeitangaben)");
    }
    lastGranule = end.granule;
  }
  for (Packet& packet : x.packets) packet.start += base;
  // The last page may end before its last packet does: that is the trim at the end.
  if (lastGranule > base + total || lastGranule < x.preSkip) return fail(error, "Datei beschädigt (Länge)");
  x.frames = static_cast<long>(lastGranule - x.preSkip);

  index_ = std::move(index);
  if (!startDecoder()) return fail(error, "Opus-Decoder nicht verfügbar");
  return true;
}

bool OpusClip::openLike(const OpusClip& other) {
  if (decoder_) opus_decoder_destroy(decoder_);
  decoder_ = nullptr;
  index_ = other.index_;
  position_ = 0;
  return index_ && startDecoder();
}

bool OpusClip::startDecoder() {
  int status = OPUS_OK;
  decoder_ = opus_decoder_create(kRate, index_->channels, &status);
  if (status != OPUS_OK || !decoder_) {
    decoder_ = nullptr;
    index_.reset();
    return false;
  }
  opus_decoder_ctl(decoder_, OPUS_SET_GAIN(index_->gain));
  buffer_.assign(static_cast<size_t>(kMaxPacketFrames) * static_cast<size_t>(index_->channels), 0.0f);
  seek(0);
  return true;
}

void OpusClip::decodePacket(size_t index) {
  const Index& x = *index_;
  const Packet& packet = x.packets[index];
  int n = opus_decode_float(decoder_, x.data.data() + packet.offset, packet.size, buffer_.data(), kMaxPacketFrames, 0);
  // Cannot happen after the checks in `open` - but if it does, libopus conceals it rather than a gap.
  if (n != packet.samples) n = opus_decode_float(decoder_, nullptr, 0, buffer_.data(), packet.samples, 0);
  if (n != packet.samples)
    std::fill(buffer_.begin(), buffer_.begin() + static_cast<long>(packet.samples) * x.channels, 0.0f);
  bufferStart_ = packet.start;
  bufferFrames_ = packet.samples;
}

void OpusClip::seek(long frame) {
  if (!decoder_) return;
  const Index& x = *index_;
  position_ = std::clamp(frame, 0L, x.frames);
  const int64_t target = position_ + x.preSkip;
  // Near the start the pre-skip is the pre-roll: decoding from the very first packet is exactly
  // what playing from the start gives.
  size_t from = 0;
  if (target - kPreRoll >= x.preSkip) {
    const int64_t at = target - kPreRoll;
    auto it = std::upper_bound(x.packets.begin(), x.packets.end(), at, [](int64_t g, const Packet& p) { return g < p.start; });
    from = static_cast<size_t>(it - x.packets.begin()) - 1;
  }
  opus_decoder_ctl(decoder_, OPUS_RESET_STATE);
  next_ = from;
  decodePacket(next_++);
  while (bufferStart_ + bufferFrames_ <= target && next_ < x.packets.size()) decodePacket(next_++);
}

int OpusClip::read(float* out, int frames) {
  if (!decoder_) return 0;
  const Index& x = *index_;
  int done = 0;
  while (done < frames && position_ < x.frames) {
    const int64_t at = position_ + x.preSkip;
    if (at >= bufferStart_ + bufferFrames_) {
      if (next_ >= x.packets.size()) break;
      decodePacket(next_++);
      continue;
    }
    const long inBuffer = static_cast<long>(bufferStart_ + bufferFrames_ - at);
    const int n = static_cast<int>(std::min({static_cast<long>(frames - done), inBuffer, x.frames - position_}));
    std::memcpy(out + static_cast<size_t>(done) * static_cast<size_t>(x.channels),
                buffer_.data() + static_cast<size_t>(at - bufferStart_) * static_cast<size_t>(x.channels),
                sizeof(float) * static_cast<size_t>(n) * static_cast<size_t>(x.channels));
    done += n;
    position_ += n;
  }
  return done;
}

bool decodeOpus(const uint8_t* data, size_t size, ClipData& out, std::string* error) {
  OpusClip clip;
  if (!clip.open(data, size, error)) return false;
  out.channels = clip.channels();
  out.samples.assign(static_cast<size_t>(clip.frames()) * static_cast<size_t>(clip.channels()), 0.0f);
  const int chunk = 48000;
  for (long done = 0; done < clip.frames();) {
    const int n = clip.read(out.samples.data() + static_cast<size_t>(done) * static_cast<size_t>(clip.channels()),
                            static_cast<int>(std::min<long>(chunk, clip.frames() - done)));
    if (n <= 0) return fail(error, "Datei beschädigt (Länge)");
    done += n;
  }
  return true;
}

}  // namespace stageboard
