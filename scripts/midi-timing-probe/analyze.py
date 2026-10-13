"""Usage: analyze.py receiver.log [stepMs] - jitter of ch1 (timestamped) vs ch2 (baseline), clear test."""
import sys, json, statistics as st
step = float(sys.argv[2]) if len(sys.argv) > 2 else 20.833
ev = [json.loads(l) for l in open(sys.argv[1]) if l.startswith('{"t"')]
def run(status):
    pts = sorted((e["m"][1], e["t"]) for e in ev if e["m"][0] == status)
    if not pts: return None
    t0 = pts[0][1]
    err = [((t - t0) / 1e6) - k * step for k, t in pts]
    m = st.mean(err)
    dev = [e - m for e in err]
    return {"n": len(pts), "jitter_sd_ms": round(st.pstdev(dev), 3), "max_abs_dev_ms": round(max(abs(d) for d in dev), 3)}
clr = sorted(e["m"][1] for e in ev if e["m"][0] == 0x92)
print(json.dumps({"timestamped": run(0x90), "baseline_setTimeout": run(0x91), "clear_test_notes_arrived": clr, "clear_worked": 100 not in clr and 101 not in clr and 102 in clr}, indent=1))
