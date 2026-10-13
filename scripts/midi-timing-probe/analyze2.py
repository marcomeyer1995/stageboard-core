import json, sys, statistics as st
ev=[json.loads(l) for l in open(sys.argv[1], errors='ignore') if l.strip().startswith('{"t"')]
runs={}; cur=None
for e in ev:
    m=e['m']
    if m[0]==0xb0 and m[1]==119: cur=m[2]; runs[cur]=[]; continue
    if cur is not None: runs[cur].append(e)
names={0x90:'A up-front ',0x91:'B timer-now',0x92:'C scheduler'}
for r,evs in runs.items():
    for status,name in names.items():
        pts=sorted((e['m'][1],e['t']) for e in evs if e['m'][0]==status)
        if len(pts)<3: print(r,name,'n=',len(pts)); continue
        t0=pts[0][1]; err=[(t-t0)/1e6-k*20.833 for k,t in pts[1:]]
        med=st.median(err); dev=[e-med for e in err]
        print(f"run {r} {name}: n={len(pts)} median|dev| {st.median(abs(d) for d in dev):5.2f} ms  ±2ms {sum(abs(d)<=2 for d in dev):2d}/{len(dev)}  late>5ms {sum(d>5 for d in dev):2d}  max late {max(dev):6.1f} ms")
