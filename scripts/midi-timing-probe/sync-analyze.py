"""Analyzes a sync-receiver.py log: per MIDI port the offset of each marked second from server time
(arrival - second), offsets between ports for the same second, and mic click onsets vs the second."""
import json, sys, statistics as st
lines = [json.loads(l) for l in open(sys.argv[1], errors="ignore") if l.strip().startswith("{")]
notes = [l for l in lines if "port" in l and "m" in l]
by_port = {}
for n in notes:
    ms = n["t"] / 1e6
    second = round(ms / 1000) * 1000  # nearest full second of server time
    by_port.setdefault(n["port"], {})[second] = ms - second
def summary(values):
    v = sorted(values); med = st.median(v)
    return f"n={len(v)} median {med:+.2f} ms, spread (p5-p95) {v[int(len(v)*.05)]:+.1f}..{v[int(len(v)*.95)-1 if len(v)>1 else 0]:+.1f} ms, sd {st.pstdev(v):.2f} ms"
for port, d in by_port.items():
    print(f"{port}: offset from server time: {summary(list(d.values()))}")
ports = list(by_port)
for i in range(len(ports)):
    for j in range(i + 1, len(ports)):
        common = set(by_port[ports[i]]) & set(by_port[ports[j]])
        if common:
            diffs = [by_port[ports[i]][s] - by_port[ports[j]][s] for s in common]
            print(f"{ports[i]} minus {ports[j]}: {summary(diffs)}")
base = [l for l in lines if "mic_base" in l]
onsets = [l for l in lines if "onset_frame" in l]
if base and onsets:
    b, fs = base[-1]["mic_base"], base[-1]["fs"]
    offs = []
    for o in onsets:
        ms = (b + o["onset_frame"] * 10**9 // fs) / 1e6
        second = round(ms / 1000) * 1000
        offs.append(ms - second)
    print(f"mic onsets vs server second, all (room noise included): {summary(offs)}")
    # The device's clicks form one tight cluster; room noise is spread out. Take the 2 ms bin with
    # the most onsets and everything within 10 ms of it.
    bins = {}
    for o in offs:
        bins[round(o / 2)] = bins.get(round(o / 2), 0) + 1
    mode = max(bins, key=bins.get) * 2
    cluster = [o for o in offs if abs(o - mode) <= 10]
    print(f"mic click cluster (noise removed, includes the laptop's capture bias of a few ms): {summary(cluster)} - {len(offs) - len(cluster)} noise onsets dropped")
