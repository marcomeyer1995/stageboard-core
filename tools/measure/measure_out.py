#!/usr/bin/env python3
"""Measurements for the device test of #742 (the sound follows the map), block 2.

The tablet plays the Rig-Check song (System -> Rig-Check, quick run): click 1000/1500 Hz from
the app, track = beeps 300-840 Hz on every beat plus drums. The tablet's headphone jack goes
through a Y cable into inputs 1 (left) and 2 (right) of the UMC204HD on the laptop.

  rec      record from the UMC204HD (or --device) into a WAV
  analyze  click/track offset from a recording with both playing (click L, track R)
  crosstalk  a recording with only one source playing: how much reaches the other side
  unplug   level over time from the laptop microphone: does anything sound after unplugging?
  selftest synthesise recordings with known values and check that analyze finds them

Start every recording a second or two BEFORE Play: that stretch is the noise floor.
Needs numpy - the stem separation's venv has it (~/stageboard-data/stems/venv/bin/python).
"""
import argparse, json, os, re, subprocess, sys, wave
import numpy as np

CLICK_BAND = (900.0, 1650.0)   # click: 1000 Hz, downbeat 1500 Hz (clickEngine.ts)
BEEP_BAND = (260.0, 900.0)     # Rig-Check beeps 300..840 Hz (rigCheckSong.ts)
ENV_MS = 0.25                  # envelope resolution


# ---------- audio in ----------

def load(path):
    with wave.open(path) as w:
        n, ch, width, rate = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(n)
    if width == 2:
        a = np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768.0
    elif width == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        v = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        v = np.where(v & 0x800000, v - 0x1000000, v)
        a = v.astype(np.float64) / 8388608.0
    elif width == 4:
        a = np.frombuffer(raw, dtype='<i4').astype(np.float64) / 2147483648.0
    else:
        sys.exit(f'{path}: {width * 8}-bit samples not supported')
    return a.reshape(-1, ch), rate


def save(path, data, rate):
    data = np.clip(data, -1, 1)
    with wave.open(path, 'wb') as w:
        # 32-bit like the UMC204HD's own format, so quiet test signals are not lost to 16-bit steps.
        w.setnchannels(data.shape[1]); w.setsampwidth(4); w.setframerate(rate)
        w.writeframes((data * 2147483647).astype('<i4').tobytes())


def band(x, rate, lo, hi):
    f = np.fft.rfftfreq(len(x), 1 / rate)
    X = np.fft.rfft(x)
    X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, len(x))


def envelope(x, rate):
    hop = max(1, int(rate * ENV_MS / 1000))
    n = len(x) // hop
    return np.abs(x[: n * hop]).reshape(n, hop).max(1), hop


def db(v):
    return 20 * np.log10(max(v, 1e-12))


def rms(x):
    return float(np.sqrt(np.mean(x * x))) if len(x) else 0.0


# ---------- onsets ----------

def onsets(env, hop, rate, floor, min_gap_ms, rel=0.3):
    """First crossing of a threshold above the floor, one per min_gap."""
    peak = np.percentile(env, 99.9)
    thr = max(floor * 8, peak * rel)
    gap = int(min_gap_ms / ENV_MS)
    out, i = [], 0
    above = np.flatnonzero(env > thr)
    for k in above:
        if out and k - out[-1] < gap:
            continue
        out.append(k)
    return [k * hop / rate for k in out], thr


def first_onset_near(env, hop, rate, t, before_ms, after_ms, floor):
    lo = max(0, int((t - before_ms / 1000) * rate / hop))
    hi = min(len(env), int((t + after_ms / 1000) * rate / hop))
    win = env[lo:hi]
    if len(win) == 0:
        return None
    thr = max(floor * 8, win.max() * 0.3)
    if win.max() < floor * 8:
        return None
    k = int(np.argmax(win > thr))
    return (lo + k) * hop / rate


# ---------- analyze ----------

def floor_of(env, hop, rate, pre_s):
    n = int(pre_s * rate / hop)
    head = env[:n] if n > 10 else env[: max(10, len(env) // 20)]
    return float(np.median(head)) + 1e-9


def crosstalk(path, pre_s, as_json):
    """A recording in which only ONE source plays (the other taken out of the matrix): the quiet
    channel's level relative to the playing one, over the moments the playing one sounds."""
    data, rate = load(path)
    if data.shape[1] < 2:
        sys.exit('crosstalk needs a stereo recording')
    L, R = (band(data[:, i], rate, 60.0, 12000.0) for i in (0, 1))
    pre = int(pre_s * rate)
    body = slice(pre, len(L))
    active, quiet, names = (L, R, ('L', 'R')) if rms(L[body]) >= rms(R[body]) else (R, L, ('R', 'L'))
    blk = int(0.01 * rate)  # 10 ms blocks
    nb = len(active) // blk
    pa = (active[: nb * blk].reshape(nb, blk) ** 2).mean(1)
    pq = (quiet[: nb * blk].reshape(nb, blk) ** 2).mean(1)
    loud = pa > pa[pre // blk:].max() * 10 ** (-20 / 10)        # within 20 dB of the loudest block
    loud[: pre // blk] = False
    floor_q = float(np.median(pq[: max(1, pre // blk)]))
    sig_a, sig_q = float(pa[loud].mean()), float(pq[loud].mean())
    excess = sig_q - floor_q
    masked = excess < floor_q  # less than 3 dB above the quiet channel's own noise
    x = 10 * np.log10(max(excess, 1e-24) / sig_a)
    f = 10 * np.log10(max(floor_q, 1e-24) / sig_a)
    res = {'file': os.path.basename(path), 'playing': names[0], 'quiet': names[1], 'crosstalk_db': round(float(x), 1),
           'floor_db': round(float(f), 1), 'below_noise': bool(masked)}
    if as_json:
        print(json.dumps(res))
        return res
    head = f"{res['file']}: spielt auf {names[0]}, {names[1]} sollte still sein"
    if masked:
        print(f"{head}\n  crosstalk below the noise: < {f:.0f} dB  {'OK' if f < -60 else '(noise too high to say -60 dB - turn the input up)'}")
    else:
        print(f"{head}\n  crosstalk {x:.1f} dB (noise {f:.0f} dB)  {'OK' if x < -60 else 'TOO HIGH (target < -60 dB)'}")
    return res


def analyze(path, click_ch, track_ch, pre_s, as_json):
    """Offset of each track beep against the click before it (same beat)."""
    data, rate = load(path)
    if data.shape[1] < 2 and click_ch != track_ch:
        sys.exit('mono recording: use --click L --track L')
    idx = {'L': 0, 'R': 1}
    c = data[:, idx[click_ch]]
    t = data[:, idx[track_ch]]
    c_click = band(c, rate, *CLICK_BAND)
    t_beep = band(t, rate, *BEEP_BAND)
    ec, hop = envelope(c_click, rate)
    et, _ = envelope(t_beep, rate)
    fc, ft = floor_of(ec, hop, rate, pre_s), floor_of(et, hop, rate, pre_s)

    clicks, _ = onsets(ec, hop, rate, fc, 150)
    # Search each beep up to 45 % of a beat away from its click, so a neighbouring beat never pairs.
    spacing = float(np.median(np.diff(clicks))) * 1000 if len(clicks) > 2 else 500.0
    reach = 0.45 * spacing
    pairs = []
    for tc in clicks:
        tb = first_onset_near(et, hop, rate, tc, reach, reach, ft)
        if tb is not None:
            pairs.append((tc, (tb - tc) * 1000))
    d = np.array([p[1] for p in pairs]) if pairs else np.zeros(0)

    res = {'file': os.path.basename(path), 'rate': rate, 'clicks': len(clicks), 'paired': len(pairs)}
    if len(d):
        res.update(offset_ms_median=round(float(np.median(d)), 2), offset_ms_p10=round(float(np.percentile(d, 10)), 2),
                   offset_ms_p90=round(float(np.percentile(d, 90)), 2),
                   offset_ms_first=round(float(d[0]), 2), offset_ms_last=round(float(d[-1]), 2))

    if as_json:
        print(json.dumps(res))
        return res
    print(f"{res['file']}: {res['clicks']} clicks, {res['paired']} paired with a beep")
    if len(d):
        print(f"  offset track - click: median {res['offset_ms_median']:+.1f} ms "
              f"(10..90 %: {res['offset_ms_p10']:+.1f} .. {res['offset_ms_p90']:+.1f}), "
              f"erster {res['offset_ms_first']:+.1f}, letzter {res['offset_ms_last']:+.1f}")
        print('  positive = the track comes later than the click')
    else:
        print('  no pairs found - do click and track play? channels right (--click/--track)?')
    return res


# ---------- unplug ----------

def unplug(path, at, pre_s, step):
    data, rate = load(path)
    x = data.mean(1)
    bc, bb = band(x, rate, *CLICK_BAND), band(x, rate, *BEEP_BAND)
    ec, hop = envelope(bc, rate)
    eb, _ = envelope(bb, rate)
    # Floor = the loudest noise peaks of the silence before Play (block maxima are compared to it).
    npre = max(10, int(pre_s * rate / hop))
    fc, fb = float(np.percentile(ec[:npre], 99.5)) + 1e-9, float(np.percentile(eb[:npre], 99.5)) + 1e-9
    n = int(step * rate / hop)
    print(f"{os.path.basename(path)}: peaks above the noise per {step:.1f} s  (K = click band, T = track beeps)")
    loud_after = []
    for i in range(0, len(ec), n):
        s = i * hop / rate
        k, b = db(ec[i:i + n].max() / fc), db(eb[i:i + n].max() / fb)
        mark = ''
        if at is not None and s >= at:
            mark = '  <- after unplugging' if (k > 10 or b > 10) else ''
            if k > 10 or b > 10:
                loud_after.append(s)
        bar = lambda v: '#' * int(max(0, min(30, v / 2)))
        print(f"  {s:6.1f} s  K {k:5.1f} dB {bar(k):<15} T {b:5.1f} dB {bar(b):<15}{mark}")
    if at is not None:
        if loud_after:
            print(f"FAULT: still audible after {at:.1f} s, from {loud_after[0]:.1f} s ({len(loud_after)} blocks)")
        else:
            print(f"OK: nothing above the noise (+10 dB) after {at:.1f} s")


# ---------- rec ----------

def find_umc():
    out = subprocess.run(['arecord', '-l'], capture_output=True, text=True).stdout
    for line in out.splitlines():
        m = re.match(r'\D+(\d+): (\S+) \[(.*?)\], \D+(\d+):', line)
        if m and re.search(r'UMC|U-PHORIA|BEHRINGER', line, re.I):
            return f'hw:{m.group(1)},{m.group(4)}'
    return None


def rec(out, secs, device, rate):
    device = device or find_umc()
    if not device:
        sys.exit('UMC204HD not found (arecord -l). Give --device hw:N,0.')
    print(f'recording {secs} s from {device} into {out} - press Play in 1-2 s')
    # The UMC204HD only takes S32_LE at 2 channels; plughw converts for anything else.
    for fmt, dev in (('S32_LE', device), ('S16_LE', device.replace('hw:', 'plughw:'))):
        r = subprocess.run(['arecord', '-q', '-D', dev, '-f', fmt, '-r', str(rate), '-c', '2', '-d', str(secs), out])
        if r.returncode == 0:
            return
    sys.exit('arecord failed')


# ---------- selftest ----------

def synth(track, beats, rate, pre, offset_ms, click_on=True, track_on=True):
    n = pre + len(track) + rate
    click = np.zeros(n)
    if click_on:
        for b in beats:
            if b['silent']:
                continue
            s0 = pre + int(round((b['t'] - offset_ms) / 1000 * rate))  # the click offset_ms EARLIER than the track
            hz, amp = (1500, 0.5) if b['beat'] == 0 else (1000, 0.35)
            k = np.arange(int(0.03 * rate)) / rate
            click[s0:s0 + len(k)] += amp * (0.001 / amp) ** (k / 0.03) * np.sin(2 * np.pi * hz * k)
    tr = np.zeros(n)
    if track_on:
        tr[pre:pre + len(track)] = track
    return click, tr


def make_track(dirpath):
    """The real Rig-Check track from the app's own code (rigcheck-track.ts), once."""
    if os.path.exists(os.path.join(dirpath, 'track.f32')):
        return
    os.makedirs(dirpath, exist_ok=True)
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, '..', '..'))
    bundle = os.path.join(dirpath, 'rigcheck-track.mjs')
    subprocess.run([os.path.join(root, 'node_modules', '.bin', 'esbuild'), os.path.join(here, 'rigcheck-track.ts'), '--bundle', '--platform=node',
                    '--format=esm', f'--outfile={bundle}', '--log-level=warning'], check=True)
    subprocess.run(['node', bundle, dirpath], check=True)


def selftest(dirpath):
    """The real Rig-Check track with clicks at a known offset and known crosstalk."""
    make_track(dirpath)
    rate, pre = 48000, int(1.5 * 48000)
    track = np.fromfile(os.path.join(dirpath, 'track.f32'), dtype='<f4').astype(np.float64)
    beats = json.load(open(os.path.join(dirpath, 'beats.json')))
    rng = np.random.default_rng(7)
    fails = 0
    for offset_ms in (0.0, 12.0, -7.5, 25.0, 180.0):
        click, tr = synth(track, beats, rate, pre, offset_ms)
        n = len(click)
        st = np.stack([click + tr * 1e-4, tr + click * 1e-4], 1) + rng.normal(0, 3e-5, (n, 2))
        p = os.path.join(dirpath, f'selftest_offset_{offset_ms:+.1f}.wav'); save(p, st, rate)
        r = analyze(p, 'L', 'R', 1.0, True)
        ok = abs(r.get('offset_ms_median', 999) - offset_ms) < 1.0 and r['paired'] >= 60
        fails += not ok
        print(f"offset {offset_ms:+6.1f} ms -> {r.get('offset_ms_median')} ({r['paired']}/{r['clicks']} paired)  {'ok' if ok else 'WRONG'}")
    # Crosstalk: only one source playing; truth in dB, noise level in dBFS.
    for which, truth, noise_db in (('click', -70, -100), ('click', -45, -100), ('track', -63, -100), ('track', -80, -70)):
        click, tr = synth(track, beats, rate, pre, 0.0, click_on=which == 'click', track_on=which == 'track')
        src = click if which == 'click' else tr
        a, q = src, src * 10 ** (truth / 20)
        st = np.stack([a, q] if which == 'click' else [q, a], 1) + rng.normal(0, 10 ** (noise_db / 20), (len(src), 2))
        p = os.path.join(dirpath, f'selftest_xt_{which}_{truth}.wav'); save(p, st, rate)
        r = crosstalk(p, 1.0, True)
        ok = (r['below_noise'] and truth < r['floor_db'] + 3) or (not r['below_noise'] and abs(r['crosstalk_db'] - truth) < 2)
        fails += not ok
        got = f"< {r['floor_db']} (below noise)" if r['below_noise'] else r['crosstalk_db']
        print(f"crosstalk {which:5} {truth} dB, noise {noise_db} dBFS -> {got}  playing {r['playing']}  {'ok' if ok else 'WRONG'}")
    print('SELFTEST', 'OK' if not fails else f'{fails} WRONG')
    return fails


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('rec'); r.add_argument('out'); r.add_argument('--secs', type=int, default=45)
    r.add_argument('--device'); r.add_argument('--rate', type=int, default=48000)
    a = sub.add_parser('analyze'); a.add_argument('wav', nargs='+')
    a.add_argument('--click', default='L', choices=['L', 'R']); a.add_argument('--track', default='R', choices=['L', 'R'])
    a.add_argument('--pre', type=float, default=1.0, help='seconds of silence at the start (noise floor)')
    a.add_argument('--json', action='store_true')
    x = sub.add_parser('crosstalk'); x.add_argument('wav', nargs='+')
    x.add_argument('--pre', type=float, default=1.0); x.add_argument('--json', action='store_true')
    u = sub.add_parser('unplug'); u.add_argument('wav'); u.add_argument('--at', type=float, help='second of the unplugging')
    u.add_argument('--pre', type=float, default=1.0); u.add_argument('--step', type=float, default=0.5)
    s = sub.add_parser('selftest'); s.add_argument('--dir', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'))
    args = ap.parse_args()
    if args.cmd == 'rec':
        rec(args.out, args.secs, args.device, args.rate)
    elif args.cmd == 'analyze':
        for w in args.wav:
            analyze(w, args.click, args.track, args.pre, args.json)
    elif args.cmd == 'crosstalk':
        for w in args.wav:
            crosstalk(w, args.pre, args.json)
    elif args.cmd == 'unplug':
        unplug(args.wav, args.at, args.pre, args.step)
    else:
        sys.exit(1 if selftest(args.dir) else 0)


if __name__ == '__main__':
    main()
