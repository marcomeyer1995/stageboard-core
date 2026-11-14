"""Makes the Ogg Opus test files for engine_test from a known signal (docs/30 §8h).

Encoded and muxed by ffmpeg's libopus + Ogg muxer (PyAV) - an encoder that isn't ours, so the
test checks our demuxer and timing against someone else's files. The signal is computed the same
way in engine_test.cpp (`fixtureSignal`), which compares against it.

    ~/stageboard-data/stems/venv/bin/python -I make_opus_fixtures.py <out dir>
"""
import math
import sys

import av
import numpy as np

RATE = 48000
FRAMES = 72000  # 1.5 s - not a multiple of the 20 ms packet, so the end trim is tested too


def signal(channels):
    t = np.arange(FRAMES) / RATE
    left = 0.4 * np.sin(2 * math.pi * 440 * t)
    # A chirp 200 Hz -> 8 kHz: broadband, so a shift of even one sample shows in the correlation.
    k = (8000 - 200) / (FRAMES / RATE)
    right = 0.3 * np.sin(2 * math.pi * (200 * t + 0.5 * k * t * t))
    if channels == 1:
        return (0.5 * (left + right)).astype(np.float32)[np.newaxis, :]
    return np.stack([left, right]).astype(np.float32)


def write(path, channels, bitrate):
    data = signal(channels)
    with av.open(path, "w", format="ogg") as out:
        stream = out.add_stream("libopus", rate=RATE, layout="mono" if channels == 1 else "stereo")
        stream.bit_rate = bitrate
        for start in range(0, FRAMES, 960):
            chunk = np.ascontiguousarray(data[:, start : start + 960])
            frame = av.AudioFrame.from_ndarray(chunk, format="fltp", layout=stream.layout.name)
            frame.sample_rate = RATE
            frame.pts = start
            for packet in stream.encode(frame):
                out.mux(packet)
        for packet in stream.encode(None):
            out.mux(packet)


out = sys.argv[1]
write(f"{out}/stereo.opus", 2, 160000)  # the track format: 48 kHz stereo 160 kbit/s
write(f"{out}/mono.opus", 1, 64000)
