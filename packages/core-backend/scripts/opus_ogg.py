"""Writes the track format, Ogg Opus at 48 kHz stereo (docs/30 §8h), with PyAV - shared by
stem_separate.py and to_opus.py."""
from fractions import Fraction

import av

OPUS_RATE = 48_000


class OpusOggWriter:
    """Feed it audio frames at any rate and layout; `close()` flushes and finishes the file."""

    def __init__(self, path, bitrate):
        # Ogg: its header carries the pre-skip and its last page the exact length.
        self.container = av.open(path, 'w', format='ogg')
        self.stream = self.container.add_stream('libopus', rate=OPUS_RATE)
        self.stream.bit_rate = bitrate
        self.stream.layout = 'stereo'
        self.resampler = av.AudioResampler(format=self.stream.codec_context.format.name, layout='stereo', rate=OPUS_RATE)
        self.written = 0

    def write(self, frame):
        for resampled in self.resampler.resample(frame):
            self._encode(resampled)

    def close(self):
        self.write(None)
        for packet in self.stream.encode(None):
            self.container.mux(packet)
        self.container.close()

    def _encode(self, resampled):
        # Each frame's time in samples: without it the Ogg muxer doesn't take the encoder's delay
        # (the pre-skip) off - the first page then says the audio starts 312 samples (6.5 ms) late,
        # and the players' reader (OpusClip) refuses it.
        resampled.pts = self.written
        resampled.time_base = Fraction(1, OPUS_RATE)
        self.written += resampled.samples
        for packet in self.stream.encode(resampled):
            self.container.mux(packet)
