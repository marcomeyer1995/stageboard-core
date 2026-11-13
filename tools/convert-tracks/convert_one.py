"""Converts one track to the track format (Ogg Opus 48 kHz, 160 kbit/s - docs/30 §8h) and checks
the result. Called by `npm run tracks:convert -w core-backend` for the one-time conversion of the
library on the Stage-Server (Marco, 2026-11-13); prints one JSON line.

    python convert_one.py <source> <out.opus> <opus_encode binary>

Decoded with ffmpeg (PyAV) - measured on all 70 tracks of the library: sample-identical to Chrome's
decodeAudioData, which the waveform, the track analysis and the grid refinement use (lag 0,
correlation 1.0). Checks before it reports ok:
- length: the Opus file decodes to exactly the frames that went in
- position: no shift against the source (at most MAX_LAG samples of codec phase noise, < 0.1 ms)
  in every 10-s window with signal - a real shift is the encoder's 312-sample pre-skip or MP3's
  25 ms and runs through the whole file
- sound: the energy per octave band over time (50-ms frames) within MAX_BAND_DB of the source -
  finds gaps, drop-outs, a wrong channel. Not the waveform: Opus changes phase and stereo coding
  on purpose, ~20-25 dB waveform SNR is normal at 160 kbit/s (dry run on the library, 2026-11-13)
"""
import json, subprocess, sys
import numpy as np
import av

RATE = 48000
MAX_LAG = 4
MAX_BAND_DB = 1.5
QUIET = 10 ** (-50 / 20)  # windows quieter than -50 dBFS don't tell a lag


def decode(path):
    """All of the file as float32 (frames, channels) at 48 kHz; mono stays mono, more than two
    channels go down to stereo."""
    container = av.open(path)
    stream = container.streams.audio[0]
    channels = 1 if stream.codec_context.channels == 1 else 2
    resampler = av.AudioResampler(format='flt', layout='mono' if channels == 1 else 'stereo', rate=RATE)
    parts = []
    for frame in container.decode(stream):
        for out in resampler.resample(frame):
            parts.append(out.to_ndarray().reshape(-1, channels))
    for out in resampler.resample(None):
        parts.append(out.to_ndarray().reshape(-1, channels))
    container.close()
    pcm = np.concatenate(parts) if parts else np.zeros((0, channels), np.float32)
    return np.ascontiguousarray(pcm, dtype=np.float32), channels, stream.codec_context.name, container.format.name


def lag(a, b, maxlag=2400):
    n = min(len(a), len(b))
    if n < 2 * maxlag:
        return 0
    a, b = a[:n], b[:n]
    size = 1 << int(np.ceil(np.log2(2 * n)))
    x = np.fft.irfft(np.fft.rfft(a, size) * np.conj(np.fft.rfft(b, size)), size)
    x = np.concatenate([x[-maxlag:], x[: maxlag + 1]])
    return int(np.argmax(x)) - maxlag


def snr(src, back):
    """Waveform signal-to-error ratio in dB - reported only (see the module comment)."""
    sig = float(np.sum(src.astype(np.float64) ** 2))
    err = float(np.sum((back.astype(np.float64) - src) ** 2))
    return 200.0 if err == 0 or sig == 0 else float(10 * np.log10(sig / err))


def band_difference(src, back):
    """Mean |dB difference| of the energy in octave bands 63 Hz-16 kHz, over 50-ms frames with
    signal (above -60 dBFS in that band)."""
    hop = RATE // 20
    n = len(src) // hop
    if n == 0:
        return 0.0
    f = np.fft.rfftfreq(hop, 1 / RATE)
    edges = [44, 88, 177, 355, 710, 1420, 2840, 5680, 11360, 22720]
    total = count = 0.0
    for k in range(0, n, 200):  # 10 s at a time
        a = src[k * hop:min(n, k + 200) * hop].astype(np.float64).reshape(-1, hop)
        b = back[k * hop:min(n, k + 200) * hop].astype(np.float64).reshape(-1, hop)
        A, B = np.abs(np.fft.rfft(a, axis=1)) ** 2, np.abs(np.fft.rfft(b, axis=1)) ** 2
        for lo, hi in zip(edges, edges[1:]):
            sel = (f >= lo) & (f < hi)
            ea, eb = A[:, sel].sum(axis=1) / hop ** 2, B[:, sel].sum(axis=1) / hop ** 2
            live = ea > 1e-6
            if live.any():
                total += float(np.sum(np.abs(10 * np.log10(eb[live] + 1e-12) - 10 * np.log10(ea[live]))))
                count += float(live.sum())
    return total / count if count else 0.0


def main():
    source, out_path, encoder = sys.argv[1:4]
    result = {'source': source}
    try:
        pcm, channels, codec, fmt = decode(source)
        result.update(codec=codec, container=fmt, channels=channels, frames=len(pcm))
        enc = subprocess.run([encoder, str(channels)], input=pcm.tobytes(), capture_output=True, check=False)
        if enc.returncode != 0:
            raise RuntimeError('encoder: ' + enc.stderr.decode(errors='replace').strip())
        with open(out_path, 'wb') as f:
            f.write(enc.stdout)
        back, _, _, _ = decode(out_path)
        result.update(sizeBytes=len(enc.stdout), framesBack=len(back))
        if len(back) != len(pcm):
            raise RuntimeError(f'length {len(back)} frames instead of {len(pcm)}')
        mono_in, mono_back = pcm.mean(axis=1), back.mean(axis=1)
        win = 10 * RATE
        lags = []
        for start in range(0, max(1, len(pcm) - win + 1), win):
            piece = mono_in[start:start + win]
            if np.sqrt(np.mean(piece.astype(np.float64) ** 2)) < QUIET:
                continue
            lags.append(lag(mono_back[start:start + win], piece))
        result['lagMax'] = max((abs(x) for x in lags), default=0)
        if result['lagMax'] > MAX_LAG:
            raise RuntimeError(f'shifted: {lags}')
        result['snrDb'] = round(snr(mono_in, mono_back), 1)
        result['bandDb'] = round(band_difference(mono_in, mono_back), 2)
        if result['bandDb'] > MAX_BAND_DB:
            raise RuntimeError(f"octave bands {result['bandDb']} dB off the source")
        result['durationMs'] = int(round(len(pcm) * 1000 / RATE))
        result['ok'] = True
    except Exception as e:  # one JSON line either way - the caller decides
        result['ok'] = False
        result['error'] = str(e)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
