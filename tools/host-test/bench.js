(async () => {
  // A fixed workload close to what audio models do: float32 multiply-accumulate over big arrays (matrix-vector style),
  // single thread, then the same on every core at once with workers. Reports ms and MFLOP/s. Not a model benchmark.
  const n = 1 << 20
  const a = new Float32Array(n), b = new Float32Array(n)
  for (let i = 0; i < n; i++) { a[i] = (i % 97) / 97; b[i] = (i % 89) / 89 }
  const run = () => { let s = 0; for (let r = 0; r < 40; r++) for (let i = 0; i < n; i++) s += a[i] * b[i]; return s }
  run()
  const t0 = performance.now(); run(); const single = performance.now() - t0
  const flops = 2 * n * 40
  const src = `onmessage=()=>{const n=${n},a=new Float32Array(n),b=new Float32Array(n);for(let i=0;i<n;i++){a[i]=(i%97)/97;b[i]=(i%89)/89}let s=0;for(let r=0;r<40;r++)for(let i=0;i<n;i++)s+=a[i]*b[i];postMessage(s)}`
  const url = URL.createObjectURL(new Blob([src]))
  const cores = navigator.hardwareConcurrency || 1
  const t1 = performance.now()
  await Promise.all(Array.from({ length: cores }, () => new Promise((res) => { const w = new Worker(url); w.onmessage = () => { w.terminate(); res() }; w.postMessage(0) })))
  const parallel = performance.now() - t1
  const mem = performance.memory ? { jsHeapLimitMb: Math.round(performance.memory.jsHeapLimit / 1048576) } : {}
  return JSON.stringify({ cores, deviceMemoryGb: navigator.deviceMemory ?? null, ...mem, singleMs: Math.round(single), singleMflops: Math.round(flops / single / 1000), allCoresMs: Math.round(parallel), wasm: typeof WebAssembly === 'object', simd: (() => { try { return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])) } catch { return false } })(), ua: navigator.userAgent.slice(0, 90) })
})()
