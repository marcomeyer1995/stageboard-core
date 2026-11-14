// opus_encode: interleaved float32 PCM at 48 kHz on stdin -> Ogg Opus (the track format, docs/30
// §8h) on stdout, with the same OpusWriter the uploading devices use as WASM. For converting the
// existing library once on the server (tools/convert-tracks).
//
//   opus_encode <channels 1|2> [bitrate] < pcm.f32 > track.opus
//
// Exit code 0 and "frames <n> preskip <p>" on stderr when done.
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "stageboard/opus_writer.h"

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: opus_encode <channels 1|2> [bitrate] < pcm.f32 > track.opus\n");
    return 2;
  }
  stageboard::OpusWriter::Options options;
  options.channels = std::atoi(argv[1]);
  if (argc > 2) options.bitrate = std::atoi(argv[2]);
  if (options.channels != 1 && options.channels != 2) {
    std::fprintf(stderr, "channels must be 1 or 2\n");
    return 2;
  }
  stageboard::OpusWriter writer;
  std::string error;
  if (!writer.start(options, &error)) {
    std::fprintf(stderr, "start: %s\n", error.c_str());
    return 1;
  }
  const size_t chunkFrames = 48000;
  std::vector<float> buf(chunkFrames * static_cast<size_t>(options.channels));
  std::vector<uint8_t> leftover;
  for (;;) {
    const size_t got = std::fread(buf.data(), sizeof(float), buf.size(), stdin);
    const long frames = static_cast<long>(got / static_cast<size_t>(options.channels));
    if (frames > 0) writer.write(buf.data(), frames);
    if (got % static_cast<size_t>(options.channels) != 0) {
      std::fprintf(stderr, "input ends inside a frame\n");
      return 1;
    }
    const std::vector<uint8_t> out = writer.take();
    if (!out.empty() && std::fwrite(out.data(), 1, out.size(), stdout) != out.size()) return 1;
    if (got < buf.size()) break;
  }
  if (std::ferror(stdin)) return 1;
  writer.finish();
  const std::vector<uint8_t> out = writer.take();
  if (!out.empty() && std::fwrite(out.data(), 1, out.size(), stdout) != out.size()) return 1;
  if (std::fflush(stdout) != 0) return 1;
  std::fprintf(stderr, "frames %ld preskip %d\n", writer.framesIn(), writer.preSkip());
  return 0;
}
