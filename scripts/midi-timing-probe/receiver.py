"""Virtual ALSA MIDI input that logs every message with a monotonic arrival time (ns)."""
import sys, time, json, rtmidi
name = sys.argv[1] if len(sys.argv) > 1 else "SB Timing Probe"
m = rtmidi.MidiIn(rtmidi.API_LINUX_ALSA)
m.ignore_types(sysex=False, timing=False, active_sense=True)
def cb(ev, _):
    msg, _delta = ev
    print(json.dumps({"t": time.monotonic_ns(), "m": msg}), flush=True)
m.set_callback(cb)
m.open_virtual_port(name)
print(json.dumps({"ready": name}), flush=True)
try:
    while True: time.sleep(1)
except KeyboardInterrupt: pass
