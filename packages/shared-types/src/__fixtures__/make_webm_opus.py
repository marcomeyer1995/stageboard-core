"""Makes the WebM/Opus file the remux test reads (oggOpus.test.ts): 1.5 s stereo, libopus and the
WebM muxer of ffmpeg (PyAV) - as YouTube, browsers and the stem plugin write it.

    ~/stageboard-data/stems/venv/bin/python -I make_webm_opus.py <out dir>
"""
import math
import sys

import av
import numpy as np

RATE, FRAMES = 48000, 72000
t = np.arange(FRAMES) / RATE
k = (8000 - 200) / (FRAMES / RATE)
data = np.stack([0.4 * np.sin(2 * math.pi * 440 * t), 0.3 * np.sin(2 * math.pi * (200 * t + 0.5 * k * t * t))]).astype(np.float32)
with av.open(f'{sys.argv[1]}/stereo.webm', 'w', format='webm') as out:
    stream = out.add_stream('libopus', rate=RATE, layout='stereo')
    stream.bit_rate = 160000
    for start in range(0, FRAMES, 960):
        frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(data[:, start:start + 960]), format='fltp', layout='stereo')
        frame.sample_rate = RATE
        frame.pts = start
        for packet in stream.encode(frame):
            out.mux(packet)
    for packet in stream.encode(None):
        out.mux(packet)
