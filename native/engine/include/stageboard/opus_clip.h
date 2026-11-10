#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "stageboard/clip.h"

struct OpusDecoder;

namespace stageboard {

/**
 * One Ogg Opus file (RFC 7845) held in memory - the only track format (docs/30 §8h): 48 kHz,
 * decoded by libopus, independent of the device's codecs.
 *
 * `open` reads the whole file once on the control thread: checks every page (CRC, one stream,
 * complete up to the last page), copies the packets into one buffer and notes where each starts.
 * After that `read` and `seek` allocate nothing and take no lock, so they can run in a decoding
 * thread that fills the clip player's ring buffer (stage 4).
 *
 * Frame 0 is the first sample of the song's audio: the encoder's pre-skip (in the Opus header) is
 * dropped and the end trimmed to the last page's granule position - so every device starts the
 * track on the same sample, unlike MP3/AAC. The header's output gain is applied.
 */
class OpusClip {
 public:
  static constexpr int kRate = 48000;
  /**
   * Decoded before a seek target so the decoder has converged. RFC 7845 §4.6 asks for at least
   * 80 ms, but measured on the track format that still leaves the first 10 ms −18 dB off the
   * sequential decode (CELT predicts across frames); 160 ms: −44 dB, 240 ms: −67 dB, 320 ms:
   * −90 dB. Opus' own coding noise is ~−36 dB, so after 240 ms a jump sounds like playing through.
   */
  static constexpr long kPreRoll = 11520;

  OpusClip() = default;
  ~OpusClip();
  OpusClip(const OpusClip&) = delete;
  OpusClip& operator=(const OpusClip&) = delete;

  /** False with a reason in `error` when the file is damaged, cut off or not supported. */
  bool open(const uint8_t* data, size_t size, std::string* error = nullptr);

  int channels() const { return channels_; }
  /** Playable frames at 48 kHz. */
  long frames() const { return frames_; }
  /** The frame the next `read` starts at. */
  long position() const { return position_; }

  /** The next `read` starts at `frame` (clamped to the clip). Decodes the pre-roll. */
  void seek(long frame);
  /** Up to `frames` interleaved frames into `out`; returns how many - fewer only at the end. */
  int read(float* out, int frames);

 private:
  struct Packet {
    size_t offset;
    int size;
    int samples;
    int64_t start;  // in granule positions: the pre-skip counts, the song's frame 0 is at preSkip_
  };

  /** Decodes packet `index` into `buffer_`; a damaged packet is concealed by libopus. */
  void decodePacket(size_t index);

  OpusDecoder* decoder_ = nullptr;
  int channels_ = 0;
  int preSkip_ = 0;
  long frames_ = 0;
  std::vector<uint8_t> data_;
  std::vector<Packet> packets_;

  long position_ = 0;
  size_t next_ = 0;  // packet to decode after the one in buffer_
  std::vector<float> buffer_;
  int64_t bufferStart_ = 0;  // granule position of buffer_'s first frame
  int bufferFrames_ = 0;
};

/** Decodes a whole file into `out` - for short clips like announcements; tracks stream (stage 4). */
bool decodeOpus(const uint8_t* data, size_t size, ClipData& out, std::string* error = nullptr);

}  // namespace stageboard
