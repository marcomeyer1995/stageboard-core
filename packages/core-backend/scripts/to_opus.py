"""Any audio file → the track format, Ogg Opus (docs/30 §8h), for the Stage-Server: a YouTube
download without Opus (YouTube's format 251 is re-wrapped losslessly in Node instead).

Usage: to_opus.py <input> <output.opus>

Runs in the stem-separation virtualenv (PyAV, no ffmpeg program needed). Prints `RESULT <json>`
with the samples written (48 kHz).
"""
import json
import sys

import av

from opus_ogg import OpusOggWriter

# The track bitrate (docs/30 §8h); the encoder's free VBR lands near it.
TRACK_BITRATE = 160_000


def main():
    src, dst = sys.argv[1], sys.argv[2]
    container = av.open(src)
    writer = OpusOggWriter(dst, TRACK_BITRATE)
    for frame in container.decode(audio=0):
        frame.pts = None
        writer.write(frame)
    container.close()
    writer.close()
    print('RESULT ' + json.dumps({'samples': writer.written}), flush=True)


if __name__ == '__main__':
    main()
