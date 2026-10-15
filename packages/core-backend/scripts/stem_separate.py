"""Stem separation for the Stage-Server's stem-separation plugin (#9, docs/21).

Usage: stem_separate.py <input> <outdir> <standard|extended> [--split-guitar]

Decodes any audio the browser could upload (WebM/Opus, MP3, M4A, WAV ...) with PyAV - no ffmpeg
program needed - separates it with Demucs (htdemucs: drums, bass, vocals, other; htdemucs_6s: also
guitar and piano) and writes one WebM/Opus file per stem (256 kbit/s). `--split-guitar` splits the guitar stem by stereo
side (two main guitars panned left and right). Prints `PROGRESS <0..1>` lines while working and,
last, `RESULT <json>` with the stems written.
"""
import json
import sys

import av
import numpy as np
import torch
from demucs.api import Separator

MODELS = {'standard': 'htdemucs', 'extended': 'htdemucs_6s'}
# Opus, not MP3 (2026-10-15): MP3 at 192 kbit/s cut the highs of the summed stems (error -10 dB
# at 10-16 kHz, -2 dB above, vs -17/-13 dB with Opus 256) and every stem started 25 ms late - its
# encoder delay was written without the header that tells decoders to skip it. Opus' pre-skip is
# honoured by every decoder. Same format the browser's own recordings use.
OPUS_BITRATE = 256_000
OPUS_RATE = 48_000
# Decoding is quick, separating takes ~95 % of the time, writing the rest.
DECODE_SHARE, SEPARATE_SHARE = 0.03, 0.92


def progress(value):
    print(f'PROGRESS {min(1.0, max(0.0, value)):.3f}', flush=True)


def decode(path, samplerate):
    container = av.open(path)
    resampler = av.AudioResampler(format='fltp', layout='stereo', rate=samplerate)
    chunks = []
    for frame in container.decode(audio=0):
        chunks.extend(f.to_ndarray() for f in resampler.resample(frame))
    chunks.extend(f.to_ndarray() for f in resampler.resample(None))
    container.close()
    return torch.from_numpy(np.concatenate(chunks, axis=1))


def write_opus(audio, path, samplerate):
    # Clamped, not rescaled: every stem keeps its level, so they add up to the mix.
    data = np.clip(audio.numpy(), -1.0, 1.0).astype(np.float32)
    container = av.open(path, 'w', format='webm')
    stream = container.add_stream('libopus', rate=OPUS_RATE)
    stream.bit_rate = OPUS_BITRATE
    stream.layout = 'stereo'
    resampler = av.AudioResampler(format=stream.codec_context.format.name, layout='stereo', rate=OPUS_RATE)
    step = samplerate // 10
    for start in range(0, data.shape[1], step):
        frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(data[:, start:start + step].T.reshape(1, -1)), format='flt', layout='stereo')
        frame.sample_rate = samplerate
        for resampled in resampler.resample(frame):
            for packet in stream.encode(resampled):
                container.mux(packet)
    for resampled in resampler.resample(None):
        for packet in stream.encode(resampled):
            container.mux(packet)
    for packet in stream.encode(None):
        container.mux(packet)
    container.close()


def main():
    src, outdir, model = sys.argv[1], sys.argv[2], sys.argv[3]
    split_guitar = '--split-guitar' in sys.argv[4:]

    def on_chunk(info):
        if info.get('state') == 'end' and info.get('audio_length'):
            done = (info['segment_offset'] + info.get('segment_length', 0)) / info['audio_length']
            progress(DECODE_SHARE + SEPARATE_SHARE * done)

    separator = Separator(model=MODELS[model], device='cpu', callback=on_chunk)
    samplerate = separator.samplerate
    wav = decode(src, samplerate)
    progress(DECODE_SHARE)
    _, stems = separator.separate_tensor(wav, samplerate)

    outputs = []
    for key, audio in stems.items():
        if key == 'guitar' and split_guitar:
            # One side each, as mono in both ears.
            for side, channel in (('guitar-left', 0), ('guitar-right', 1)):
                mono = audio[channel:channel + 1].repeat(2, 1)
                write_opus(mono, f'{outdir}/{side}.webm', samplerate)
                outputs.append({'key': side, 'file': f'{side}.webm'})
            continue
        write_opus(audio, f'{outdir}/{key}.webm', samplerate)
        outputs.append({'key': key, 'file': f'{key}.webm'})
    progress(1)
    print('RESULT ' + json.dumps({'stems': outputs}), flush=True)


if __name__ == '__main__':
    main()
