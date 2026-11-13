#pragma once

#include <cstdint>
#include <string>
#include <vector>

struct OpusEncoder;

namespace stageboard {

/**
 * Makes the track format (docs/30 §8h): Ogg Opus (RFC 7845), 48 kHz, by libopus - on the device
 * that uploads a song (as WebAssembly, stage-pwa lib/engine/opusEncode.ts).
 *
 * Fed in pieces, so a long song never has to be in memory as PCM; finished pages collect in
 * `output`. The header carries the encoder's look-ahead as pre-skip and the last page the exact
 * length: OpusClip (and any other decoder) gives back exactly the frames that went in, starting
 * on the same sample - MP3/AAC can't promise that (docs/30 §8h).
 */
class OpusWriter {
 public:
  struct Options {
    int channels = 2;
    /** The track format: 160 kbit/s (docs/30 §8h). */
    int bitrate = 160000;
    /** libopus' best (0-10) - it only costs encoding time, once per upload. */
    int complexity = 10;
  };

  static constexpr int kRate = 48000;
  /** 20 ms packets - Opus' usual size for music. */
  static constexpr int kFrameSize = 960;

  OpusWriter() = default;
  ~OpusWriter();
  OpusWriter(const OpusWriter&) = delete;
  OpusWriter& operator=(const OpusWriter&) = delete;

  /** Input must be 48 kHz (resample first); 1 or 2 channels. */
  bool start(const Options& options, std::string* error = nullptr);
  /** Interleaved frames; may be any number, any number of times. */
  void write(const float* pcm, long frames);
  /** Pads the last packet with silence and writes the last page with the exact length. */
  void finish();

  /** The file so far (all of it after `finish`). */
  const std::vector<uint8_t>& output() const { return out_; }
  /** Hands over what is there and starts collecting anew - for writing out piece by piece. */
  std::vector<uint8_t> take();

  int preSkip() const { return preSkip_; }
  long framesIn() const { return framesIn_; }

 private:
  void encodeFrame();
  void addPacket(const uint8_t* data, int size, int64_t granule);
  void flushPage(bool last);
  void page(const uint8_t* body, const std::vector<uint8_t>& lacing, size_t bodySize, int64_t granule, uint8_t flags);

  OpusEncoder* encoder_ = nullptr;
  int channels_ = 2;
  int preSkip_ = 0;
  uint32_t serial_ = 0x53426f70;  // "SBop"
  uint32_t sequence_ = 0;
  long framesIn_ = 0;
  int64_t samplesEncoded_ = 0;  // granule positions: the pre-skip counts
  std::vector<float> frame_;
  int frameFill_ = 0;
  bool finished_ = false;

  // The page being filled.
  std::vector<uint8_t> body_;
  std::vector<uint8_t> lacing_;
  int64_t pageGranule_ = 0;
  int packetsInPage_ = 0;

  std::vector<uint8_t> out_;
};

}  // namespace stageboard
