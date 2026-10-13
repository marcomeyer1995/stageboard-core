"""Sync-test receiver (docs/21 §4). Run on the laptop that IS the Stage-Server, so its wall clock is
server time. Logs every MIDI note-on from all input ports whose name contains one of the patterns
(argv[1], comma-separated, e.g. "Fire,Redmi") with time.time_ns(), and - with --mic - click onsets
from the laptop microphone (arecord), as JSON lines on stdout.

Mic timestamps: frame -> wall clock from the least-buffered chunk (t_read - frames/fs, minimum over
the run); what remains is a constant capture-path bias of the laptop (a few ms), the same for every
device - device-to-device differences are exact, absolute values carry that bias.
"""
import json, subprocess, sys, threading, time, rtmidi

patterns = [p.lower() for p in sys.argv[1].split(",")] if len(sys.argv) > 1 else ["fire", "redmi"]
use_mic = "--mic" in sys.argv
lock = threading.Lock()

def emit(obj):
    with lock:
        print(json.dumps(obj), flush=True)

inputs = []
probe = rtmidi.MidiIn(rtmidi.API_LINUX_ALSA)
for idx, name in enumerate(probe.get_ports()):
    if any(p in name.lower() for p in patterns):
        m = rtmidi.MidiIn(rtmidi.API_LINUX_ALSA)
        m.ignore_types(sysex=True, timing=True, active_sense=True)
        m.set_callback(lambda ev, port, n=name: emit({"t": time.time_ns(), "port": n, "m": ev[0]}) if ev[0][0] & 0xF0 == 0x90 else None)
        m.open_port(idx)
        inputs.append(m)
        emit({"midi_port": name})

def mic():
    fs, chunk = 48000, 240  # 5 ms chunks
    proc = subprocess.Popen(["arecord", "-q", "-D", "plughw:1,0", "-f", "S16_LE", "-r", str(fs), "-c", "1", "-t", "raw", "--period-size", str(chunk), "--buffer-size", str(chunk * 4)], stdout=subprocess.PIPE)
    frames, base, prev, noise, last_onset = 0, None, 0, 200.0, -10**9
    while True:
        data = proc.stdout.read(chunk * 2)
        if not data:
            break
        t_read = time.time_ns()
        n = len(data) // 2
        frames += n
        start_wall = t_read - frames * 10**9 // fs
        base = start_wall if base is None else min(base, start_wall)
        samples = memoryview(data).cast("h")
        for i in range(n):
            s = samples[i]
            hp = abs(s - prev)  # crude high-pass: the click is 1-1.5 kHz, room noise mostly low
            prev = s
            noise = 0.9995 * noise + 0.0005 * hp
            frame = frames - n + i
            if frame > fs * 0.2 and hp > max(8 * noise, 600) and frame - last_onset > fs * 0.3:
                last_onset = frame
                emit({"onset_frame": frame, "level": hp, "noise": round(noise)})
        if frames % (fs * 5) < n:
            emit({"mic_base": base, "frames": frames, "fs": fs})

if use_mic:
    threading.Thread(target=mic, daemon=True).start()
emit({"ready": True, "ports": len(inputs), "mic": use_mic})
while True:
    time.sleep(1)
